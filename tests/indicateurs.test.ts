// Lot 11, chantier C3 (t197), étape 1 : sexe et catégorie sur la fiche, arrêtés annuels et route des indicateurs sociaux.
// - vues sans sexe ni catégorie : service RH et intéressé seulement ; jamais le manager (pour son équipe), le référent HSE,
//   la paie ni la lecture seule ; arrêtés transmis au service RH et à la lecture seule (sans auteurs ni motif) ;
// - saisie par le service RH (listes fermées), journal sans la valeur ; reprise depuis Lucca ou Sage ;
// - arrêtés : année close, un seul en vigueur, annulation motivée (motif jamais au journal), mise à disposition du CSE ;
// - GET /api/indicateurs et /csv : droit « consultation », refus tracé, garde de navigation interne, agrégats masqués
//   seulement (aucun nom, aucun identifiant), mémorisation par révision, export tracé sans valeur, arrêtés figés.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, json } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { STATS_INDICATEURS } = await import('../server/src/indicateurs.ts');
const { Domain } = await import('../shared/domain.ts');
const { analyserReprise, reconnaitreColonnes } = await import('../shared/rules/reprise.ts');
const { validerProfil, PROFIL_VIDE } = await import('../shared/rules/profil.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = Awaited<ReturnType<typeof nouvelleBase>>;

const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const personne = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const P = {
    admin: await personne(null, 'rh'), gest: await personne(14, 'rh'), mgr: await personne(12, 'manager'), coll: await personne(2, 'collaborateur'),
    hse: await personne(23, 'rh'), paie: await personne(7, 'rh'), lect: await personne(11, 'rh'),
  };
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: { id: number } };
  });
  const refuse = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status = 400) =>
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message) && e.status === status, `${name} : ${motif}`);
  const journal = async (action: string) => (await db.query<{ message: string; payload: unknown; salaries: unknown }>('SELECT message, payload, salaries FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ message: l.message, payload: json<Record<string, unknown>>(l.payload), salaries: json<number[]>(l.salaries) }));
  return { db, P, run, refuse, journal, compteDe };
}

test('sexe et catégorie : service RH et intéressé seulement, retirés des vues du manager et des profils restreints', async () => {
  const { db, P } = await fresh();
  const mehdi = async (u: User) => (await buildSnapshot(db, u)).employes.find(e => e.id === 2);
  for (const u of [P.admin, P.gest]) assert.deepEqual([(await mehdi(u))!.sexe, (await mehdi(u))!.categorie], ['M', 'tam'], u.nom);
  assert.deepEqual([(await mehdi(P.coll))!.sexe, (await mehdi(P.coll))!.categorie], ['M', 'tam'], 'l’intéressé');
  const mgr = await buildSnapshot(db, P.mgr);
  assert.deepEqual([mgr.employes.find(e => e.id === 2)!.sexe, mgr.employes.find(e => e.id === 2)!.categorie], [null, null], 'membre de l’équipe');
  assert.deepEqual([mgr.employes.find(e => e.id === 12)!.sexe, mgr.employes.find(e => e.id === 12)!.categorie], ['M', 'cadre'], 'sa propre fiche');
  for (const u of [P.hse, P.paie, P.lect]) {
    const ds = await buildSnapshot(db, u);
    assert.ok(ds.employes.every(e => e.sexe == null && e.categorie == null), u.nom);
  }
});

test('arrêtés : année close, un seul en vigueur, annulation motivée, CSE ; vues et journal sans chiffre ni motif', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  await refuse(P.admin, 'indicateurs.arreter', { annee: 2026 }, /L’année 2026 n’est pas terminée/);
  await refuse(P.admin, 'indicateurs.arreter', { annee: 1890 }, /Année invalide/);
  await refuse(P.gest, 'indicateurs.arreter', { annee: 2025 }, /administrateur RH/, 403);
  const a = (await run(P.admin, 'indicateurs.arreter', { annee: 2025 })).result!.id;
  await refuse(P.admin, 'indicateurs.arreter', { annee: 2025 }, /déjà arrêtés \(arrêté n° \d+\)/);
  // Agrégats figés en base, par groupement (sans l'équipe) ; jamais dans l'instantané.
  const ligne = (await db.get<{ donnees: Record<string, { tableaux: unknown[]; seuil: number; regles: string }>; seuil: number; reglesVersion: string }>('indicateursArretes', a))!;
  assert.deepEqual(Object.keys(ligne.donnees), ['aucun', 'sexe', 'categorie', 'statut', 'contrat']);
  assert.equal(ligne.donnees.sexe.seuil, 5);
  assert.equal(ligne.reglesVersion, ligne.donnees.aucun.regles);
  const rh = await buildSnapshot(db, P.admin);
  assert.equal(rh.indicateursArretes!.length, 1);
  assert.ok(!('donnees' in rh.indicateursArretes![0]), 'agrégats hors de l’instantané');
  assert.equal(rh.indicateursArretes![0].arretePar, 'Sandrine Vidal');
  // Mise à disposition du CSE : service RH, ni dans le futur, ni avant l'arrêté.
  await refuse(P.gest, 'indicateurs.marquerCse', { id: a, le: '2026-10-11' }, /futur/);
  await refuse(P.gest, 'indicateurs.marquerCse', { id: a, le: 'demain' }, /invalide/);
  await refuse(P.lect, 'indicateurs.marquerCse', { id: a, le: '2026-10-09' }, /service RH/, 403);
  await db.run('UPDATE indicateurs_arretes SET arrete_le = ? WHERE id = ?', ['2026-10-05T08:00:00.000Z', a]);
  await refuse(P.gest, 'indicateurs.marquerCse', { id: a, le: '2026-10-04' }, /précéder l’arrêté/);
  await run(P.gest, 'indicateurs.marquerCse', { id: a, le: '2026-10-09' });
  await refuse(P.gest, 'indicateurs.marquerCse', { id: 999, le: '2026-10-09' }, /introuvable/, 404);
  // Annulation : motif obligatoire, gardé avec l'arrêté, jamais au journal ni hors du service RH.
  await refuse(P.admin, 'indicateurs.annulerArrete', { id: a, motif: '  ' }, /Motif requis/);
  await refuse(P.admin, 'indicateurs.annulerArrete', { id: a, motif: 'x'.repeat(501) }, /trop long/);
  await run(P.admin, 'indicateurs.annulerArrete', { id: a, motif: 'Absences de décembre de Mehdi Benali corrigées' });
  await refuse(P.admin, 'indicateurs.annulerArrete', { id: a, motif: 'Encore' }, /déjà annulé/);
  await refuse(P.gest, 'indicateurs.marquerCse', { id: a, le: '2026-10-09' }, /annulé/);
  const lect = await buildSnapshot(db, P.lect);
  assert.deepEqual(lect.indicateursArretes!.map(x => [x.annuleMotif, x.arretePar, x.csePar, x.annulePar, x.cseLe]), [[null, null, null, null, '2026-10-09']]);
  assert.equal((await buildSnapshot(db, P.admin)).indicateursArretes![0].annuleMotif, 'Absences de décembre de Mehdi Benali corrigées');
  for (const u of [P.hse, P.paie, P.mgr, P.coll]) assert.deepEqual((await buildSnapshot(db, u)).indicateursArretes, [], u.nom);
  // Un nouvel arrêté pour la même année, une fois le premier annulé.
  const b = (await run(P.admin, 'indicateurs.arreter', { annee: 2025 })).result!.id;
  assert.ok(b > a);
  const traces = [...await journal('indicateurs.arreter'), ...await journal('indicateurs.annulerArrete'), ...await journal('indicateurs.marquerCse')];
  assert.deepEqual((await journal('indicateurs.arreter'))[0].payload, { annee: 2025, perimetre: 'global', arrete: a });
  assert.deepEqual((await journal('indicateurs.annulerArrete'))[0].payload.annee, 2025);
  assert.ok(traces.every(t => !JSON.stringify(t).includes('Mehdi') && !JSON.stringify(t).includes('décembre')), 'ni motif ni nom au journal');
  assert.ok(traces.every(t => !JSON.stringify(t).includes('tableaux')), 'aucun chiffre au journal');
});

test('fiche : sexe et catégorie saisis par le service RH en listes fermées, journal sans la valeur ; reprise de Lucca', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  await refuse(P.gest, 'employe.modifier', { id: 20, sexe: 'X' }, /Sexe à choisir/);
  await refuse(P.gest, 'employe.modifier', { id: 20, categorie: 'technicien' }, /Catégorie d’emploi à choisir/);
  await refuse(P.mgr, 'employe.modifier', { id: 2, sexe: 'F' }, /réservés au service RH/, 403);
  await run(P.gest, 'employe.modifier', { id: 20, sexe: 'm', categorie: 'OUVRIER', avant: { sexe: null, categorie: 'ouvrier' } });
  assert.deepEqual({ ...await db.one('SELECT sexe, categorie FROM employes WHERE id = 20') }, { sexe: 'M', categorie: 'ouvrier' });
  // Valeur d'origine dépassée (modification concurrente) : refus 412, comme tout champ de la fiche.
  await refuse(P.gest, 'employe.modifier', { id: 20, sexe: 'F', avant: { sexe: 'F' } }, /Sexe/, 412);
  const t = (await journal('employe.modifier')).at(-1)!;
  assert.deepEqual(t.payload.champsModifies, ['sexe', 'categorie', 'avant'].filter(k => k !== 'avant'));
  assert.ok(!/"M"|ouvrier/.test(JSON.stringify(t)), 'ni le sexe ni la catégorie au journal');
  // Validation du profil (dialogue, reprise) : vide permis, à compléter.
  assert.deepEqual(validerProfil({ ...PROFIL_VIDE(null, '2026-10-10'), nom: 'Essai', poste: 'Opérateur', sexe: 'F', categorie: 'employe' }, { equipes: [], year: 2026 }).errors, []);
  assert.equal(validerProfil({ ...PROFIL_VIDE(null, '2026-10-10'), nom: 'Essai', poste: 'Opérateur' }, { equipes: [], year: 2026 }).profil.sexe, null);
  // Reprise : colonnes reconnues (« Catégorie » seule reste le statut), codes de la DSN et libellés.
  assert.deepEqual(reconnaitreColonnes('salaries', ['Nom', 'Date d’entrée', 'Sexe', 'Catégorie d’emploi', 'Catégorie']), ['nom', 'entree', 'sexe', 'categorie', 'statut']);
  const d = new Domain(await loadFull(db, P.admin));
  const csv = ['Nom;Poste;Date d’entrée;Naissance;Sexe;Catégorie d’emploi', 'Zoé Martin;Opératrice;01/03/2026;1990;2;TAM', 'Paul Roy;Comptable;01/03/2026;1988;Homme;Employé',
    'Léo Blanc;Cariste;01/03/2026;1991;X;Ouvrier / employé', 'Ana Vidal;Opératrice;01/03/2026;1992;;'].join('\n');
  const a = analyserReprise(d, 'salaries', csv, { colonnes: ['nom', 'poste', 'entree', 'naissance', 'sexe', 'categorie'] });
  assert.deepEqual(a.lignes.map(l => l.ecriture?.type === 'salaries' ? [l.ecriture.profil.sexe, l.ecriture.profil.categorie] : l.erreurs),
    [['F', 'tam'], ['M', 'employe'], ['Sexe non reconnu : « X »', 'Catégorie d’emploi non reconnu : « Ouvrier / employé »'], [null, null]]);
});

/** Session ouverte en base pour un compte, cookie signé comme par Cursus. */
async function cookieDe(db: Db, compteId: number, role: User['role']) {
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(id), compteId, role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: null });
  return `cursus_session=${id}.${await sign(db, id)}`;
}

test('GET /api/indicateurs et /csv : consultation seulement, refus tracé, agrégats masqués, mémorisés, export tracé', async () => {
  const { db, P, run, journal, compteDe } = await fresh();
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const get = async (chemin: string, cookie?: string, espace: string | null = 'rh') =>
    await fetch(`${base}${chemin}`, { headers: { ...(cookie ? { cookie } : {}), ...(espace ? { 'x-cursus-espace': espace } : {}) } });
  const admin = await cookieDe(db, await compteDe(null), 'rh'), lect = await cookieDe(db, await compteDe(11), 'rh');
  assert.equal((await get('/api/indicateurs')).status, 401);
  // Garde de navigation : un appel sans l'en-tête d'espace (lien ouvert depuis un autre site) est refusé avant tout.
  assert.equal((await get('/api/indicateurs', admin, null)).status, 403);
  assert.equal((await fetch(`${base}/api/indicateurs/csv`, { headers: { cookie: admin, 'x-cursus-espace': 'rh', 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (const [empId, role] of [[23, 'rh'], [7, 'rh'], [12, 'manager'], [2, 'collaborateur']] as const) {
    const r = await get('/api/indicateurs', await cookieDe(db, await compteDe(empId), role), role);
    assert.equal(r.status, 403, `${empId} ${role}`);
  }
  assert.equal((await journal('acces.refuse')).filter(t => t.message === 'Indicateurs sociaux — réservé au service RH et à la lecture seule').length, 4);
  // Paramètres : année, période calendaire, groupement.
  for (const q of ['?annee=1890', '?periode=2026-03-15', '?groupe=site', '?groupe=constructor']) assert.equal((await get(`/api/indicateurs${q}`, admin)).status, 400, q);
  const avant = { ...STATS_INDICATEURS };
  const r = await get('/api/indicateurs?annee=2026&periode=T3&groupe=sexe', lect);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const texte = await r.text(), x = JSON.parse(texte);
  assert.deepEqual([x.annee, x.periode, x.du, x.au, x.groupe, x.seuil, x.arrete], [2026, 'T3', '2026-07-01', '2026-09-30', 'sexe', 5, null]);
  assert.deepEqual(x.tableaux.find((t: { id: string }) => t.id === 'effectifs').lignes, ['Femmes', 'Hommes', 'Non renseigné', 'Total']);
  // Agrégats seulement : aucun nom de salarié, aucun identifiant.
  const noms = (await loadFull(db, P.admin)).employes.map(e => e.nom);
  assert.ok(noms.every(nom => !texte.includes(nom)), 'aucun nom');
  assert.ok(!/empId|"nom"|"salaries"/.test(texte), 'aucun identifiant ni nom de salarié');
  // Même révision : servi par la mémoire ; après une écriture, recalculé.
  assert.equal((await get('/api/indicateurs?annee=2026&periode=T3&groupe=sexe', admin)).status, 200);
  assert.deepEqual([STATS_INDICATEURS.calculs - avant.calculs, STATS_INDICATEURS.memorises - avant.memorises], [1, 1]);
  await run(P.gest, 'employe.modifier', { id: 20, sexe: 'M' });
  const apres = await (await get('/api/indicateurs?annee=2026&periode=T3&groupe=sexe', admin)).json() as typeof x;
  assert.equal(STATS_INDICATEURS.calculs - avant.calculs, 2);
  assert.notDeepEqual(apres.tableaux[0], x.tableaux[0], 'fiche complétée : l’effectif par sexe change');
  // Export CSV : fichier, trace sans valeur.
  const c = await get('/api/indicateurs/csv?annee=2026&periode=annee&groupe=statut', lect);
  assert.equal(c.status, 200);
  assert.equal(c.headers.get('content-disposition'), 'attachment; filename="indicateurs-2026-annee-statut.csv"');
  const lignes = (await c.text()).split('\r\n');
  assert.equal(lignes[0].replace(/^\uFEFF/, ''), 'Indicateur;Période;Dimension;Modalité;Mesure;Valeur;Masquée');
  assert.ok(lignes.some(l => l.endsWith(';< 5')), 'cases masquées « < 5 »');
  const t = (await journal('indicateurs.export')).at(-1)!;
  assert.deepEqual(t.payload, { periode: '2026-annee', groupe: 'statut', lignes: lignes.length - 1 });
  assert.deepEqual(t.salaries, []);
  assert.match(t.message, /^Indicateurs sociaux exportés — Année 2026 — \d+ lignes$/);
  // Refus de l'export tracé de même.
  assert.equal((await get('/api/indicateurs/csv', await cookieDe(db, await compteDe(7), 'rh'))).status, 403);
  assert.equal((await journal('acces.refuse')).at(-1)!.message, 'Export des indicateurs sociaux — réservé au service RH et à la lecture seule');
  // Arrêté figé : lu tel quel, même après une modification des fiches ; équipe non figée ; arrêté inconnu.
  const a = (await run(P.admin, 'indicateurs.arreter', { annee: 2025 })).result!.id;
  const fige = await (await get(`/api/indicateurs?arrete=${a}&groupe=sexe`, lect)).json() as typeof x;
  assert.deepEqual([fige.annee, fige.periode, fige.arrete.id, fige.arrete.annule], [2025, 'annee', a, false]);
  await run(P.gest, 'employe.modifier', { id: 2, sexe: 'F' });
  assert.deepEqual((await (await get(`/api/indicateurs?arrete=${a}&groupe=sexe`, lect)).json() as typeof x).tableaux, fige.tableaux, 'chiffres figés');
  assert.notDeepEqual((await (await get('/api/indicateurs?annee=2025&groupe=sexe', lect)).json() as typeof x).tableaux, fige.tableaux, 'calcul à la demande : à jour');
  assert.equal((await get(`/api/indicateurs?arrete=${a}&groupe=equipe`, lect)).status, 400);
  assert.equal((await get('/api/indicateurs?arrete=999', lect)).status, 404);
  assert.equal((await get('/api/indicateurs?arrete=abc', lect)).status, 404);
  const ca = await get(`/api/indicateurs/csv?arrete=${a}`, admin);
  assert.equal(ca.headers.get('content-disposition'), `attachment; filename="indicateurs-2025-annee-aucun-arrete-${a}.csv"`);
  assert.equal((await journal('indicateurs.export')).at(-1)!.payload.arrete, a);
  assert.equal((await get('/api/indicateurs/csv?groupe=site', admin)).status, 400);
});
