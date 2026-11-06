// lot 14, étape 2 — pré-déclarations de présence sur site (shared/rules/declarations-presence.ts, server/src/declarations.ts,
// server/src/actions/declarations.ts) :
// - règles : saisie, dates, conservation, rapprochement, publiable ;
// - lien : jeton montré une fois, empreinte seule gardée, jamais au journal ni dans l'instantané ; révocation ;
// - routes publiques : entreprise et sites seulement, dépôt « à valider », champ piège, jeton inconnu ou révoqué → 404,
//   débit limité, plafond par lien ;
// - décisions du service RH : validation (fiche E créée, ou fiche d'intérim rattachée), refus et annulation avec motif ;
// - vues : référent HSE et lecture seule ne voient que les déclarations publiables, sans adresse ni motif ; aucun lien ;
// - purge des refusées et des sans suite après la durée de conservation.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, vueDe } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { LimiteurDebit } = await import('../server/src/debit.ts');
const { cheminJournal } = await import('../server/src/logs.ts');
const { empreinteLien, PLAFOND_EN_ATTENTE, purgerDeclarations, routesDeclaration } = await import('../server/src/declarations.ts');
const R = await import('../shared/rules/declarations-presence.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Decl = import('../shared/types.ts').DeclarationPresence;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Site du référentiel commun (Matrix), absent de la démonstration seule.
  await db.insert('sites', { code: 'lyon', libelle: 'Lyon — siège et atelier', actif: true, ordre: 10 });
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o as { message?: string; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && re.test(e.message), `${name} : refus ${re}`);
  const ADMIN = await user(null, 'rh');
  const decls = async () => await db.all<Decl>('declarationsPresence');
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; message: string; salaries: number[] }>('journal')).filter(l => l.action === action);
  return { db, run, refus, decls, journal, ADMIN, HSE: await user(23, 'rh'), PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'), KARIM: await user(12, 'manager') };
}

test('lot 14 règles : saisie, dates de la venue, conservation, rapprochement, publiable', () => {
  const s = R.normaliserDeclaration({ nom: ' Delorme ', prenom: 'Marc', email: ' M.Delorme@Levage.example ', siteCode: ' LYON ', du: '2026-10-19', au: '2026-10-23', objet: ' Levage  presse ' });
  assert.deepEqual(s, { nom: 'Delorme', prenom: 'Marc', email: 'm.delorme@levage.example', siteCode: 'lyon', du: '2026-10-19', au: '2026-10-23', objet: 'Levage presse' });
  const o = { today: '2026-10-10', sites: ['lyon'] };
  assert.deepEqual(R.erreursDeclaration(s, o), []);
  assert.deepEqual(R.erreursDeclaration({ ...s, siteCode: 'paris' }, o), ['Choisissez le site de la venue.']);
  assert.deepEqual(R.erreursDeclaration({ ...s, du: '2026-10-09' }, o), ['La venue ne peut pas commencer avant aujourd’hui.']);
  assert.deepEqual(R.erreursDeclaration({ ...s, au: '2026-10-18' }, o), ['La fin de la venue précède son début.']);
  assert.match(R.erreursDeclaration({ ...s, au: '2027-01-30' }, o)[0], /92 jours au plus/);
  assert.match(R.erreursDeclaration({ ...s, du: '2027-11-01', au: '2027-11-02' }, o)[0], /plus d’un an/);
  assert.deepEqual(R.erreursDeclaration({ ...s, nom: '', objet: 'x' }, o), ['Indiquez le nom et le prénom de la personne.', 'Indiquez l’objet de la venue.']);
  assert.equal(R.refDeclaration(42), 'DP-000042');
  assert.equal(R.ajouterMois('2026-01-31', 1), '2026-02-28');
  assert.equal(R.ajouterMois('2026-11-30', 3), '2027-02-28');
  const base = { valideeLe: null, decideLe: '2026-10-09T08:00:00.000Z', au: '2026-10-23' };
  assert.equal(R.effaceeLe({ ...base, statut: 'refusee' }, 3), '2027-01-09', 'refusée : 3 mois après la décision');
  assert.equal(R.effaceeLe({ ...base, statut: 'a_valider', decideLe: null }, 3), '2027-01-23', 'sans suite : 3 mois après la fin de la venue');
  assert.equal(R.effaceeLe({ ...base, statut: 'validee', valideeLe: '2026-10-09T08:00:00.000Z' }, 3), null, 'validée : suit la fiche');
  assert.equal(R.effaceeLe({ ...base, statut: 'annulee', valideeLe: '2026-10-09T08:00:00.000Z' }, 3), null, 'annulée après validation : publiée, suit la fiche');
  assert.equal(R.effaceeLe({ ...base, statut: 'annulee' }, 3), '2027-01-09', 'annulée sans validation : comme un refus');
  assert.ok(R.publiable({ statut: 'validee', valideeLe: 'x' }) && R.publiable({ statut: 'annulee', valideeLe: 'x' }));
  assert.ok(!R.publiable({ statut: 'a_valider', valideeLe: null }) && !R.publiable({ statut: 'refusee', valideeLe: null }) && !R.publiable({ statut: 'annulee', valideeLe: null }));
  const fiches = [{ id: 1, nom: 'Léa Girard', email: null }, { id: 2, nom: 'Marc Delorme', email: 'autre@x.example' }, { id: 3, nom: 'Paul Roux', email: 'm.delorme@levage.example' }];
  assert.deepEqual(R.suggestions({ nom: 'Girard', prenom: 'Lea', email: null }, fiches).map(f => f.id), [1], 'sans accent ni ordre');
  assert.deepEqual(R.suggestions(s, fiches).map(f => f.id), [2, 3], 'même nom, ou même adresse');
});

test('lot 14 liens : jeton montré une fois, empreinte seule gardée, ni au journal ni dans l’instantané ; un lien en vigueur par entreprise', async () => {
  const { db, run, refus, journal, ADMIN } = await fresh();
  const o = await run(ADMIN, 'presence.lien.creer', { categorie: 'exterieur', entreprise: '  Échafaudages   du Sud ' });
  const jeton = o.result.jeton as string;
  assert.match(jeton, /^[A-Za-z0-9_-]{43}$/);
  const ligne = (await db.get<Record<string, unknown>>('liensDeclaration', o.result.id))!;
  assert.equal(ligne.empreinte, empreinteLien(jeton));
  assert.equal(ligne.entreprise, 'Échafaudages du Sud');
  assert.ok(!JSON.stringify(await db.all('journal')).includes(jeton), 'jamais au journal');
  assert.deepEqual([(await journal('presence.lien.creer'))[0].payload.categorie, (await journal('presence.lien.creer'))[0].payload.lien], ['exterieur', o.result.id]);
  const vue = vueDe(await loadFull(db, ADMIN), ADMIN);
  assert.ok(vue.liensDeclaration!.length >= 3 && vue.liensDeclaration!.every(l => !('empreinte' in l)), 'sans empreinte dans l’instantané');
  await refus(ADMIN, 'presence.lien.creer', { categorie: 'exterieur', entreprise: 'échafaudages du sud' }, /déjà un lien en vigueur/);
  await refus(ADMIN, 'presence.lien.creer', { categorie: 'autre', entreprise: 'X Y' }, /entreprise extérieure ou agence/);
  await run(ADMIN, 'presence.lien.revoquer', { id: o.result.id });
  await refus(ADMIN, 'presence.lien.revoquer', { id: o.result.id }, /déjà révoqué/);
  assert.ok((await run(ADMIN, 'presence.lien.creer', { categorie: 'exterieur', entreprise: 'Échafaudages du Sud' })).result.jeton !== jeton, 'nouveau lien après révocation');
  assert.equal(cheminJournal(`/api/declaration/${jeton}`), '/api/declaration/…');
  assert.equal(cheminJournal(`/declarer/${jeton}`), '/declarer/…');
});

let srv: Server;
let port = 0;
let ctx: Awaited<ReturnType<typeof fresh>>;
let jeton = '';
before(async () => {
  ctx = await fresh();
  jeton = (await ctx.run(ctx.ADMIN, 'presence.lien.creer', { categorie: 'exterieur', entreprise: 'Nettoyage Industriel' })).result.jeton;
  const app = express();
  app.use(express.json());
  app.use(routesDeclaration(ctx.db, { ip: new LimiteurDebit({ capacite: 1000, parMinute: 1000 }), depot: new LimiteurDebit({ capacite: 3, parMinute: 1 }) }));
  await new Promise<void>(ok => { srv = app.listen(0, '127.0.0.1', () => { port = (srv.address() as AddressInfo).port; ok(); }); });
});
after(() => srv?.close());

const appel = async (j: string, corps?: Record<string, unknown>) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/declaration/${j}`, corps ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) } : {});
  return { status: r.status, corps: await r.json() as Record<string, any> };
};
const SAISIE = { nom: 'Martin', prenom: 'Jeanne', email: 'j.martin@nettoyage.example', siteCode: 'lyon', du: '2026-10-20', au: '2026-10-21', objet: 'Nettoyage des fosses' };

test('lot 14 routes publiques : entreprise et sites, dépôt à valider, champ piège, 404 pour un jeton inconnu ou révoqué, débit par lien', async () => {
  const g = await appel(jeton);
  assert.equal(g.status, 200);
  assert.equal(g.corps.entreprise, 'Nettoyage Industriel');
  assert.ok(g.corps.sites.some((s: { code: string }) => s.code === 'lyon'));
  assert.deepEqual(Object.keys(g.corps).sort(), ['categorie', 'conservationMois', 'entreprise', 'sites', 'today'], 'rien d’autre (ni personne, ni déclaration)');
  assert.equal(g.corps.conservationMois, 3);
  assert.equal((await appel('x'.repeat(43))).status, 404);
  assert.equal((await appel('trop-court')).status, 404);
  const p = await appel(jeton, SAISIE);
  assert.equal(p.status, 201);
  assert.match(p.corps.ref, /^DP-\d{6}$/);
  const d = (await ctx.decls()).find(x => R.refDeclaration(x.id) === p.corps.ref)!;
  assert.deepEqual([d.statut, d.entreprise, d.categorie, d.empId, d.email], ['a_valider', 'Nettoyage Industriel', 'exterieur', null, 'j.martin@nettoyage.example']);
  // Champ piège : même réponse, rien de gardé.
  const n = (await ctx.decls()).length;
  assert.equal((await appel(jeton, { ...SAISIE, siteWeb: 'http://spam.example' })).status, 201);
  assert.equal((await ctx.decls()).length, n);
  const e = await appel(jeton, { ...SAISIE, du: '2026-10-01' });
  assert.equal(e.status, 400);
  assert.match(e.corps.error, /avant aujourd’hui/);
  // Débit du lien (3 dépôts dans l'essai) épuisé : 429.
  assert.equal((await appel(jeton, SAISIE)).status, 429);
  // Lien révoqué : 404, comme un jeton inconnu.
  const lien = (await ctx.db.all<{ id: number; entreprise: string }>('liensDeclaration')).find(l => l.entreprise === 'Nettoyage Industriel')!;
  await ctx.run(ctx.ADMIN, 'presence.lien.revoquer', { id: lien.id });
  assert.equal((await appel(jeton)).status, 404);
});

test('lot 14 plafond : au-delà des déclarations en attente d’un lien, le dépôt est refusé', async () => {
  const { db, run, ADMIN } = await fresh();
  const o = await run(ADMIN, 'presence.lien.creer', { categorie: 'interimaire', entreprise: 'Intérim Express' });
  for (let i = 0; i < PLAFOND_EN_ATTENTE; i++) {
    await db.insert('declarationsPresence', {
      lienId: o.result.id, categorie: 'interimaire', entreprise: 'Intérim Express', nom: `N${i}`, prenom: 'P', email: null, siteCode: 'lyon', du: '2026-10-20', au: '2026-10-20',
      objet: 'Mission', statut: 'a_valider', creeLe: '2026-10-09T08:00:00.000Z', empId: null, decideLe: null, decidePar: null, valideeLe: null, motif: null, majLe: '2026-10-09T08:00:00.000Z',
    });
  }
  const app = express();
  app.use(express.json());
  app.use(routesDeclaration(db));
  const s = await new Promise<Server>(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  try {
    const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/declaration/${o.result.jeton}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SAISIE) });
    assert.equal(r.status, 429);
    assert.match(((await r.json()) as { error: string }).error, /traiter les précédentes/);
  } finally { s.close(); }
});

test('lot 14 décisions : extérieur validé avec sa fiche E, intérimaire rattaché à sa fiche, refus et annulation avec motif, journal sans identité', async () => {
  const { db, run, refus, decls, journal, ADMIN } = await fresh();
  const marc = (await decls()).find(x => x.nom === 'Delorme')!;
  const lea = (await decls()).find(x => x.nom === 'Girard')!;
  await refus(ADMIN, 'presence.valider', { id: lea.id }, /Créez d’abord la fiche de l’intérimaire/);
  await refus(ADMIN, 'presence.valider', { id: lea.id, empId: 2 }, /fiche d’intérimaire/);
  const v = await run(ADMIN, 'presence.valider', { id: lea.id, empId: 15 });
  assert.equal(v.result.empId, 15);
  const m = await run(ADMIN, 'presence.valider', { id: marc.id });
  assert.equal(m.result.matriculeSite, 'E00001');
  const fiche = (await db.get<Record<string, any>>('employes', m.result.empId))!;
  assert.deepEqual([fiche.nom, fiche.entreprise, fiche.email, !!fiche.exterieur], ['Marc Delorme', 'Levage Rhône-Alpes', 'm.delorme@levage-ra.example', true]);
  assert.deepEqual((await decls()).filter(x => x.statut === 'validee').map(x => x.empId).sort(), [15, m.result.empId].sort());
  await refus(ADMIN, 'presence.valider', { id: marc.id }, /Seule une déclaration à valider/);
  await refus(ADMIN, 'presence.annuler', { id: marc.id }, /Indiquez le motif/);
  await run(ADMIN, 'presence.annuler', { id: marc.id, motif: 'Chantier reporté' });
  const annulee = (await decls()).find(x => x.id === marc.id)!;
  assert.deepEqual([annulee.statut, annulee.motif, !!annulee.valideeLe], ['annulee', 'Chantier reporté', true]);
  const [jv] = await journal('presence.valider');
  assert.ok(!JSON.stringify([...await journal('presence.valider'), ...await journal('presence.annuler')]).match(/Delorme|Girard|reporté|levage-ra/), 'ni nom, ni adresse, ni motif');
  assert.deepEqual(jv.salaries, [15]);
});

test('lot 14 vues : référent HSE et lecture seule, déclarations publiables seulement, sans adresse ni motif ; rien pour la paie et le manager', async () => {
  const { db, run, decls, ADMIN, HSE, LECTURE, PAIE, KARIM } = await fresh();
  const marc = (await decls()).find(x => x.nom === 'Delorme')!;
  await run(ADMIN, 'presence.valider', { id: marc.id });
  const full = await loadFull(db, ADMIN);
  assert.equal(vueDe(full, ADMIN).declarationsPresence!.length, 3, 'service RH : toutes');
  for (const u of [HSE, LECTURE]) {
    const v = vueDe(full, u);
    assert.deepEqual(v.declarationsPresence!.map(x => [x.nom, x.email, x.motif, x.decidePar]), [['Delorme', null, null, null]]);
    assert.deepEqual(v.liensDeclaration, []);
  }
  for (const u of [PAIE, KARIM]) {
    const v = vueDe(full, u);
    assert.deepEqual([v.declarationsPresence ?? [], v.liensDeclaration ?? []], [[], []]);
  }
});

test('lot 14 purge : refusées et sans suite effacées après 3 mois, validées gardées', async () => {
  const { db, run, decls, journal, ADMIN } = await fresh();
  const marc = (await decls()).find(x => x.nom === 'Delorme')!;
  await run(ADMIN, 'presence.valider', { id: marc.id });
  // Hugo Perrin : refusé le 9 octobre ; Léa Girard : à valider, venue jusqu'au 16 octobre.
  assert.equal(await purgerDeclarations(db, '2027-01-08'), 0);
  assert.equal(await purgerDeclarations(db, '2027-01-09'), 1);
  assert.deepEqual((await decls()).map(x => x.nom).sort(), ['Delorme', 'Girard']);
  assert.equal(await purgerDeclarations(db, '2027-01-16'), 1);
  assert.deepEqual((await decls()).map(x => x.nom), ['Delorme']);
  assert.equal(await purgerDeclarations(db, '2030-01-01'), 0, 'validée : suit la fiche');
  assert.deepEqual((await journal('presence.purge')).map(l => l.payload.declarations), [1, 1]);
});
