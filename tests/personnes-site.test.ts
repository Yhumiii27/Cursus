// lot 14 — personnes sur site (demande de Vigie du 4 novembre 2026, décision CV-10 ; shared/rules/personnes-site.ts) :
// - règles : catégorie, entreprise, matricule de site suivant (jamais réattribué), saisie d'un extérieur ;
// - intérimaire : matricule I à la création, au passage à l'intérim et à la reprise (migration nommée) ; le matricule
//   Cursus EMP-… reste ;
// - extérieur : fiche E créée par le service RH seulement, rangée à part (`Dataset.exterieurs`), hors de `employes` et
//   des actions des salariés, titres tenus comme ceux d'un salarié ;
// - vues : référent HSE et lecture seule en liste blanche, paie, manager et collaborateur sans extérieur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, PG, sqlite, SQLITE_SEUL } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, vueDe } = await import('../server/src/dataset.ts');
const { identifiantKeystone } = await import('../shared/rules/matricules.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { PERSONNES_SITE } = await import('../server/src/migrations/lot14-personnes-site.ts');
const { Domain } = await import('../shared/domain.ts');
const { profilOf } = await import('../shared/rules/profil.ts');
const R = await import('../shared/rules/personnes-site.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o as { message?: string; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp, status?: number) =>
    await assert.rejects(async () => await run(u, name, p),
      (e: unknown) => e instanceof ActionError && re.test(e.message) && (status == null || e.status === status), `${name} : refus ${re}`);
  const ADMIN = await user(null, 'rh');
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[] }>('journal')).filter(l => l.action === action);
  return {
    db, run, refus, journal, ADMIN, d: async () => new Domain(await loadFull(db, ADMIN)),
    HSE: await user(23, 'rh'), PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur'),
  };
}

test('lot 14 règles : catégorie, entreprise, matricule de site suivant, saisie d’un extérieur', () => {
  assert.equal(R.categorieDe({ typeContrat: 'cdi' }), 'salarie');
  assert.equal(R.categorieDe({ typeContrat: 'interim' }), 'interimaire');
  assert.equal(R.categorieDe({ typeContrat: 'cdi', exterieur: true }), 'exterieur');
  assert.equal(R.entrepriseDe({ typeContrat: 'interim', agence: ' Proman Lyon ' }), 'Proman Lyon');
  assert.equal(R.entrepriseDe({ typeContrat: 'cdi', agence: null, exterieur: true, entreprise: 'Levage Est' }), 'Levage Est');
  assert.equal(R.entrepriseDe({ typeContrat: 'cdi', agence: 'X' }), null, 'un salarié n’a pas d’entreprise publiée');
  assert.equal(R.prochainMatriculeSite('I', []), 'I00001');
  assert.equal(R.prochainMatriculeSite('E', ['I00007', 'E00002', null, 'E0003', 'E00041']), 'E00042', 'plus grand du préfixe, formes invalides ignorées');
  assert.throws(() => R.prochainMatriculeSite('E', ['E99999']), /Plus de matricule E/);
  const s = R.normaliserExterieur({ nom: '  Paul   Durand ', entreprise: 'Levage  Est', email: ' Paul.Durand@Levage-Est.example ' });
  assert.deepEqual(s, { nom: 'Paul Durand', entreprise: 'Levage Est', email: 'paul.durand@levage-est.example' });
  assert.deepEqual(R.erreursExterieur(s), []);
  assert.deepEqual(R.erreursExterieur({ nom: 'P', entreprise: '', email: null }), ['Indiquez le nom et le prénom.', 'Indiquez l’entreprise de la personne.']);
  assert.deepEqual(R.erreursExterieur(s, { 'paul.durand@levage-est.example': 'Paul Martin' }), ['Adresse e-mail déjà attribuée à Paul Martin.']);
});

test('lot 14 intérimaire : matricule I à la création et au passage à l’intérim, matricule Cursus gardé', async () => {
  const { run, d, ADMIN } = await fresh();
  const d0 = await d();
  assert.equal(d0.emp(15)!.matriculeSite, 'I00001', 'intérimaire de la démonstration');
  assert.equal(d0.emp(2)!.matriculeSite ?? null, null, 'un salarié n’en a pas');
  const o = await run(ADMIN, 'employe.creer', {
    ...profilOf(d0.emp(15)!), nom: 'Inès Garcia', matriculePaie: null, email: null, naissanceLe: '1998-04-02', entree: '2026-10-12', fin: '2026-12-18',
  });
  const d1 = await d(), ines = d1.emp(o.result.id)!;
  assert.equal(ines.matriculeSite, 'I00002');
  assert.match(identifiantKeystone(undefined, ines), /^EMP-/, 'le matricule Cursus reste l’identifiant échangé avec Keystone');
  // Passage d'un CDD à l'intérim : matricule attribué une fois, gardé ensuite.
  const lucas = d1.ds.employes.find(e => e.typeContrat === 'cdd')!;
  await run(ADMIN, 'employe.modifier', { id: lucas.id, typeContrat: 'interim', agence: 'Proman Lyon', fin: '2027-01-29' });
  assert.equal((await d()).emp(lucas.id)!.matriculeSite, 'I00003');
});

test('lot 14 extérieur : fiche E du service RH, rangée à part, titres tenus, actions des salariés refusées, journal', async () => {
  const { run, refus, d, journal, ADMIN, HSE, MEHDI, KARIM } = await fresh();
  const saisie = { nom: 'Paul Durand', entreprise: 'Levage Est', email: 'paul.durand@levage-est.example' };
  await refus(HSE, 'exterieur.creer', saisie, /service RH/, 403);
  await refus(KARIM, 'exterieur.creer', saisie, /./, 403);
  await refus(ADMIN, 'exterieur.creer', { ...saisie, entreprise: ' ' }, /Indiquez l’entreprise/);
  const o = await run(ADMIN, 'exterieur.creer', saisie);
  assert.equal(o.result.matriculeSite, 'E00001');
  assert.match(o.message!, /matricule E00001/);
  const id = o.result.id as number;
  const d1 = await d();
  assert.ok(!d1.ds.employes.some(e => e.id === id), 'hors des salariés (paie, congés, temps, effectifs…)');
  const paul = d1.emp(id)!;
  assert.deepEqual([paul.exterieur, paul.entreprise, paul.matriculeSite], [true, 'Levage Est', 'E00001']);
  // Même adresse refusée pour une seconde fiche ; second extérieur : E00002.
  await refus(ADMIN, 'exterieur.creer', { ...saisie, nom: 'Paul Martin' }, /déjà attribuée à Paul Durand/);
  assert.equal((await run(ADMIN, 'exterieur.creer', { nom: 'Anna Roth', entreprise: 'Levage Est', email: null })).result.matriculeSite, 'E00002');
  // Titres : une certification se tient comme pour un salarié (référent HSE compris).
  await run(HSE, 'cert.ajouter', { empId: id, f: 'sst', date: '2026-10-06' });
  const titres = (await d()).titresDe((await d()).emp(id)!, 60);
  assert.deepEqual(titres.certs.map(c => c.f), ['sst']);
  // Les actions des salariés ne la trouvent pas.
  await refus(ADMIN, 'employe.modifier', { id, nom: 'Paul D.' }, /Collaborateur introuvable/, 404);
  await refus(MEHDI, 'exterieur.modifier', { id, nom: 'Paul D.' }, /./, 403);
  await refus(ADMIN, 'exterieur.modifier', { id: 2, nom: 'X Y' }, /Fiche d’extérieur introuvable/, 404);
  await run(ADMIN, 'exterieur.modifier', { id, entreprise: 'Levage Est SAS' });
  assert.equal((await d()).emp(id)!.entreprise, 'Levage Est SAS');
  const [c] = await journal('exterieur.creer');
  assert.deepEqual(c.salaries, [id]);
  assert.equal(c.payload.matriculeSite, 'E00001');
  assert.ok(!JSON.stringify(c.payload).includes('levage-est.example'), 'ni adresse ni nom au journal');
  assert.ok((await journal('exterieur.modifier')).length === 1);
});

test('lot 14 vues : extérieurs en liste blanche pour le référent HSE et la lecture seule, rien pour la paie, le manager, le salarié', async () => {
  const { db, run, ADMIN, HSE, PAIE, LECTURE, KARIM, MEHDI } = await fresh();
  const id = (await run(ADMIN, 'exterieur.creer', { nom: 'Paul Durand', entreprise: 'Levage Est', email: null })).result.id as number;
  await db.update('employes', id, { restrictions: ['port de charges'] });
  await run(ADMIN, 'cert.ajouter', { empId: id, f: 'sst', date: '2026-10-06' });
  const vue = async (u: User) => vueDe(await loadFull(db, ADMIN), u).exterieurs ?? [];
  for (const u of [HSE, LECTURE]) {
    const [e] = await vue(u);
    assert.equal(e?.id, id);
    assert.deepEqual([e.entreprise, e.matriculeSite, e.certs.length, e.restrictions], ['Levage Est', 'E00001', 1, []]);
    assert.equal('posteId' in e || 'urgenceNom' in e || 'naissance' in e, false, 'liste blanche');
  }
  for (const u of [PAIE, KARIM, MEHDI]) assert.deepEqual(await vue(u), [], `profil ${u.profilRh ?? u.role}`);
  assert.equal((await vue(ADMIN)).length, 1);
});

test('lot 14 migration nommée : unicité du matricule de site, matricule I des intérimaires existants', { skip: PG && SQLITE_SEUL }, async () => {
  const { db, d } = await fresh();
  await db.exec('DROP INDEX IF EXISTS employes_matricule_site_unique; UPDATE employes SET matricule_site = NULL');
  assert.equal(await PERSONNES_SITE.necessaire!(sqlite(db)), true);
  assert.match(String(await PERSONNES_SITE.executer(sqlite(db))), /1 intérimaire\(s\)/);
  assert.equal((await d()).emp(15)!.matriculeSite, 'I00001');
  assert.equal(await PERSONNES_SITE.necessaire!(sqlite(db)), false);
  await assert.rejects(async () => await db.exec('UPDATE employes SET matricule_site = \'I00001\' WHERE id = 2'), /UNIQUE/);
});
