// Tests du chantier « entretiens et plan de formation », étape 1 : remise du compte rendu sans signature électronique
// (t057), campagne d'entretiens réglable (t134), propres entretiens du manager hors de son espace manager (t104), coût
// réel à la clôture d'une action du plan (t111), import « Remplacer » limité aux lignes importées (t092), exercices
// passés et clôture d'exercice avec report (t117).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET']) delete process.env[k];

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { Domain } = await import('../shared/domain.ts');
const { obligations, perimetreEntretiens } = await import('../shared/rules/entretiens.ts');
const { campagne, jourEtMois, populationCampagne } = await import('../shared/rules/campagne.ts');
const { statutEntretien, texteRemise } = await import('../shared/rules/remise.ts');
const { budgetSummary } = await import('../shared/rules/budget.ts');
const { exercicesProposes, montantReel } = await import('../shared/rules/exercices.ts');
const { appliquerReglages, REGLAGES, ReglageInvalide } = await import('../shared/reglages.ts');
const { SAMPLE_PLAN_CSV } = await import('../shared/rules/imports.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = Record<string, any>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace au journal après). */
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown> = {}) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} : refus attendu ${motif}`);
  const domain = async () => new Domain(await loadFull(db, await RH()));
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(j => j.action === action);
  const RH = async () => await user(null, 'rh');
  return { db, run, refus, domain, journal, user, RH: await RH(), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}
const entretien = async (db: Db, id: number) => (await db.get<Ligne>('entretiens', id))!;
const entretienDe = (db: Db, empId: number, statut: string) => (db.sql.prepare('SELECT id FROM entretiens WHERE emp_id = ? AND statut = ? ORDER BY id DESC').get(empId, statut) as { id: number }).id;
/** Entretien annuel de Mehdi (planifié le 20 octobre), clos par Karim : à signer, puis à remettre. */
async function clos(x: Awaited<ReturnType<typeof fresh>>) {
  const id = entretienDe(x.db, 2, 'planifie');
  await x.run(x.KARIM, 'entretien.modifier', { id, section: 'bilan', value: 'Année chargée, objectifs tenus' });
  await x.run(x.KARIM, 'entretien.clore', { id, date: '2026-10-08' });
  return id;
}

// — t057 : remise du compte rendu —

test('remise en main propre : sans signature du salarié, datée et tracée, puis les sections du salarié sont figées', async () => {
  const x = await fresh();
  const { db, run, refus, KARIM, MEHDI, RH } = x;
  const id = await clos(x);
  assert.equal((await entretien(db, id)).signSal, null);
  await refus(KARIM, 'entretien.remettre', { id, mode: 'main_propre', date: '2026-10-11' }, /aujourd’hui au plus tard/);
  await refus(KARIM, 'entretien.remettre', { id, mode: 'main_propre', date: '2026-10-07' }, /le 10 oct\. 2026 au plus tôt/, 400);
  await refus(KARIM, 'entretien.remettre', { id, mode: 'fax' }, /Mode de remise inconnu/);
  // Ni le salarié, ni un autre manager.
  await refus(MEHDI, 'entretien.remettre', { id, mode: 'main_propre' }, /évaluateur ou au service RH/, 403);
  await refus(await x.user(16, 'manager'), 'entretien.remettre', { id, mode: 'main_propre' }, /évaluateur ou au service RH/, 403);
  assert.equal(await run(KARIM, 'entretien.remettre', { id, mode: 'main_propre', date: '2026-10-10' }), 'Compte rendu remis en main propre à Mehdi Benali le 10 oct. 2026');
  const e = await entretien(db, id);
  assert.deepEqual([e.remiseLe, e.remiseMode, e.remisePar], ['2026-10-10', 'main_propre', 'Karim Haddad']);
  // Journal : identifiant et mode, date par la trace ; ni le compte rendu, ni aucun texte libre.
  const j = (await x.journal('entretien.remettre')).at(-1)!;
  assert.deepEqual(j.payload, { id, mode: 'main_propre', avant: { remiseLe: null, remiseMode: null }, apres: { remiseLe: '2026-10-10', remiseMode: 'main_propre' } });
  assert.deepEqual(j.salaries, [2]);
  assert.ok(!JSON.stringify(j).includes('objectifs tenus'));
  // Remise sur papier définitive ; la copie fait foi : le salarié ne modifie plus ses sections, il peut encore signer.
  await refus(RH, 'entretien.remettre', { id, mode: 'portail' }, /déjà remis en main propre le 10 oct\. 2026/);
  await refus(MEHDI, 'entretien.modifier', { id, section: 'avis', value: 'Ajout après coup' }, /Section non modifiable/, 403);
  await run(MEHDI, 'entretien.signer', { id });
  const vu = (await loadFull(db, RH)).entretiens.find(y => y.id === id)!;
  assert.deepEqual(statutEntretien(vu), ['Signé', 'tag-neutral']);
  assert.equal(texteRemise(vu), 'Remis en main propre le 10 oct. 2026 par Karim Haddad');
});

test('refus de signer : enregistré par le RH, refusé sur un compte rendu déjà signé', async () => {
  const x = await fresh();
  const { db, run, RH } = x;
  const id = await clos(x);
  assert.match(String(await run(RH, 'entretien.remettre', { id, mode: 'refus' })), /^Refus de signer de Mehdi Benali enregistré le 10 oct\. 2026 — copie du compte rendu remise$/);
  assert.deepEqual([(await entretien(db, id)).remiseMode, (await entretien(db, id)).remisePar], ['refus', 'Sandrine Vidal']);
  assert.deepEqual(statutEntretien((await loadFull(db, RH)).entretiens.find(y => y.id === id)!), ['Refus de signer', 'tag-neutral']);
  // Compte rendu signé : aucun refus à enregistrer.
  const y = await fresh();
  const id2 = await clos(y);
  await y.run(y.MEHDI, 'entretien.signer', { id: id2 });
  await y.refus(y.RH, 'entretien.remettre', { id: id2, mode: 'refus' }, /signé par le salarié le 10 oct\. 2026 : aucun refus/);
  // Planifié, pas encore clos : rien à remettre.
  await y.refus(y.RH, 'entretien.remettre', { id: entretienDe(y.db, 1, 'planifie'), mode: 'main_propre' }, /à clore d’abord/);
});

test('mise à disposition dans le portail : e-mail avec le seul lien vers Cursus, premier téléchargement daté', async () => {
  const x = await fresh();
  const { db, run, refus, KARIM, MEHDI, RH } = x;
  const id = await clos(x);
  const mails = async () => (await db.all<Ligne>('envois')).filter(e => e.type === 'entretien.remise');
  assert.equal(await run(KARIM, 'entretien.remettre', { id, mode: 'portail', date: '2026-10-09' }),
    'Compte rendu mis à disposition de Mehdi Benali dans son espace — e-mail envoyé avec le lien vers Cursus');
  assert.equal((await entretien(db, id)).remiseLe, '2026-10-10', 'datée du jour, quelle que soit la date envoyée');
  // La date envoyée, ignorée donc non contrôlée, n'entre pas au journal : seule la date enregistrée (trace) y figure.
  const j = (await x.journal('entretien.remettre')).at(-1)!;
  assert.deepEqual(j.payload, { id, mode: 'portail', avant: { remiseLe: null, remiseMode: null }, apres: { remiseLe: '2026-10-10', remiseMode: 'portail' } });
  const [m] = await mails();
  assert.deepEqual(m.contenu.a, ['mehdi.benali@entreprise.example']);
  assert.equal(m.contenu.objet, 'Compte rendu d’entretien disponible dans Cursus');
  assert.match(m.contenu.texte, /Cursus : https:\/\/cursus\.example\.fr/);
  assert.match(m.contenu.texte, /son contenu ne figure pas dans cet e-mail/);
  assert.ok(!m.contenu.texte.includes('objectifs tenus'), 'jamais le texte du compte rendu');
  await refus(RH, 'entretien.remettre', { id, mode: 'portail' }, /déjà mis à disposition dans le portail le 10 oct\. 2026/);
  // Le salarié peut encore compléter ses sections et signer ; son premier téléchargement est daté, une seule fois au journal.
  await run(MEHDI, 'entretien.modifier', { id, section: 'avis', value: 'Je reviens sur les objectifs' });
  assert.deepEqual(statutEntretien((await loadFull(db, RH)).entretiens.find(y => y.id === id)!), ['Mis à disposition', 'tag-outline']);
  await refus(KARIM, 'entretien.telecharger', { id }, /salarié seulement/, 403);
  await refus(RH, 'entretien.telecharger', { id }, /salarié seulement/, 403);
  assert.equal(await run(MEHDI, 'entretien.telecharger', { id }), null);
  await run(MEHDI, 'entretien.telecharger', { id });
  assert.equal((await entretien(db, id)).telechargeLe, '2026-10-10');
  assert.equal((await x.journal('entretien.telecharger')).length, 1, 'seul le premier téléchargement est tracé');
  const vu = (await loadFull(db, RH)).entretiens.find(y => y.id === id)!;
  assert.equal(texteRemise(vu), 'Mis à disposition dans le portail le 10 oct. 2026 par Karim Haddad — téléchargé par le salarié le 10 oct. 2026');
  assert.deepEqual(statutEntretien(vu), ['Téléchargé', 'tag-neutral']);
  // Une remise en main propre complète la mise à disposition.
  await run(KARIM, 'entretien.remettre', { id, mode: 'main_propre' });
  assert.equal((await entretien(db, id)).remiseMode, 'main_propre');
});

test('mise à disposition refusée sans compte actif : remise en main propre', async () => {
  const x = await fresh();
  const { db, refus, run, KARIM } = x;
  const id = await clos(x);
  db.sql.prepare('UPDATE comptes SET actif = 0 WHERE emp_id = 2').run();
  await refus(KARIM, 'entretien.remettre', { id, mode: 'portail' }, /Mehdi Benali n’a pas de compte Cursus actif : remettez-lui le compte rendu en main propre/);
  assert.match(String(await run(KARIM, 'entretien.remettre', { id, mode: 'main_propre' })), /remis en main propre/);
  // Sans adresse e-mail : mis à disposition, le salarié est à prévenir.
  const y = await fresh();
  const id2 = await clos(y);
  await y.db.update('employes', 2, { email: null });
  assert.match(String(await y.run(y.KARIM, 'entretien.remettre', { id: id2, mode: 'portail' })), /aucune adresse e-mail : prévenez-le$/);
});

test('remise : un membre du RH n’enregistre pas celle de son propre entretien ; données transmises sans le compte rendu à la lecture seule', async () => {
  const x = await fresh();
  const { db, refus, user } = x;
  // Antoine Leroy (14), gestionnaire RH : entretien clos par le service RH.
  const id = (await db.insert<{ id: number }>('entretiens', { empId: 14, type: 'annuel', date: '2026-10-05', statut: 'realise', cr: { bilan: 'Texte' }, info: false, signMgr: '2026-10-05', signSal: null })).id;
  await refus(await user(14, 'rh'), 'entretien.remettre', { id, mode: 'main_propre' }, /votre propre compte rendu/, 403);
  await x.run(x.RH, 'entretien.remettre', { id, mode: 'main_propre' });
  const lecture = (await buildSnapshot(db, await user(11, 'rh'))).entretiens.find(y => y.id === id)!;
  assert.deepEqual(lecture.cr, {});
  assert.deepEqual([lecture.remiseMode, lecture.remiseLe], ['main_propre', '2026-10-10']);
});

// — t134 : campagne d'entretiens réglable —

test('campagne : réglages par défaut identiques au fonctionnement d’origine', async () => {
  const { domain } = await fresh();
  const d = await domain();
  const annuels = obligations(d, d.ds.employes.map(e => e.id)).filter(o => o.kind === 'annuel');
  assert.ok(annuels.length > 10);
  assert.ok(annuels.every(o => o.due === '2026-12-15' && o.detail === 'Campagne 2026 — du 1er octobre au 15 décembre' && o.st === 'todo'));
  // Seul l'intérim est exclu : CDD (4) et alternance (24) concernés, intérimaire (15) jamais.
  const ids = new Set(annuels.map(o => o.id));
  assert.ok(ids.has(4) && ids.has(24) && !ids.has(15));
  assert.equal(jourEtMois('10-01'), '1er octobre');
  assert.equal(populationCampagne(d, d.ds.employes.map(e => e.id)).length, d.ds.employes.length - 1);
});

test('campagne : dates, ancienneté, contrats exclus et affichage avant l’ouverture, contrôlés à l’enregistrement', async () => {
  const { db, run, refus, domain, RH } = await fresh();
  const annuels = async () => { const d = await domain(); return obligations(d, d.ds.employes.map(e => e.id)).filter(o => o.kind === 'annuel'); };
  await run(RH, 'parametres.maj', { campagneDebut: '11-02', campagneFin: '12-20' });
  assert.ok((await annuels()).every(o => o.due === '2026-12-20' && o.detail === 'Campagne 2026 — du 2 novembre au 20 décembre'));
  // Ouverture après la clôture, jour qui n'existe pas chaque année : refusés, rien n'est enregistré.
  await refus(RH, 'parametres.maj', { campagneDebut: '12-21' }, /l’ouverture doit précéder la clôture/);
  await refus(RH, 'parametres.maj', { campagneFin: '02-29' }, /Date invalide/);
  await refus(RH, 'parametres.maj', { campagneExclus: 'cdd' }, /Liste de valeurs attendue/);
  assert.equal((await loadFull(db, RH)).settings.campagneDebut, '11-02');
  // CDD et alternance exclus (l'intérim l'est toujours) ; une valeur inconnue est écartée.
  await run(RH, 'parametres.maj', { campagneExclus: ['alternance', 'cdd', 'interim', 'cdi'] });
  assert.deepEqual((await loadFull(db, RH)).settings.campagneExclus, ['cdd', 'alternance']);
  let ids = new Set((await annuels()).map(o => o.id));
  assert.ok(!ids.has(4) && !ids.has(24) && ids.has(6));
  // Ancienneté de 12 mois à l'ouverture (2 novembre 2026) : Romain (19), entré le 3 novembre 2025, n'est pas concerné.
  await run(RH, 'parametres.maj', { campagneExclus: [], campagneAncienneteMois: 12 });
  ids = new Set((await annuels()).map(o => o.id));
  assert.ok(!ids.has(19) && !ids.has(4), 'entrés le 3 novembre 2025 et le 2 février 2026 : moins de 12 mois');
  assert.ok(ids.has(6) && ids.has(24), 'alternant entré le 1er septembre 2025 : plus de 12 mois');
  await run(RH, 'parametres.maj', { campagneAncienneteMois: 0 });
  // Affichage 15 jours avant l'ouverture (2 novembre) : pas encore le 10 octobre ; 30 jours : déjà.
  await run(RH, 'parametres.maj', { campagnePreavisJours: 15 });
  assert.equal((await annuels()).length, 0);
  assert.equal(campagne((await loadFull(db, RH)).settings, 2026).visibleDes, '2026-10-18');
  await run(RH, 'parametres.maj', { campagnePreavisJours: 30 });
  assert.ok((await annuels()).length > 10);
  // Journal : anciennes et nouvelles valeurs, sous leur libellé.
  const j = (await db.all<Ligne>('journal')).filter(l => l.action === 'parametres.maj').at(-1)!;
  assert.deepEqual([j.payload.avant, j.payload.apres], [{ campagnePreavisJours: 15 }, { campagnePreavisJours: 30 }]);
  // Contrôles de la table (sans passer par l'action).
  const s = (await loadFull(db, RH)).settings;
  assert.throws(() => appliquerReglages(s, { campagneDebut: '1-10' }), ReglageInvalide);
  assert.equal(appliquerReglages(s, { campagnePreavisJours: 900 }).campagnePreavisJours, 365);
  assert.ok(REGLAGES.campagneExclus.defaut.length === 0);
});

// — t104 : propres entretiens du manager —

test('espace manager : ses propres entretiens hors des échéances, de la liste et de la pastille ; espace collaborateur inchangé', async () => {
  const { db, KARIM, user } = await fresh();
  const vue = await buildSnapshot(db, KARIM);
  // Les données restent transmises (aucun changement côté serveur) ; l'écran les écarte.
  assert.ok(vue.employes.some(e => e.id === 12));
  const perim = perimetreEntretiens(vue);
  assert.ok(!perim.includes(12) && perim.includes(2) && perim.length === vue.employes.length - 1);
  const d = new Domain(vue);
  assert.ok(!obligations(d, perim).some(o => o.id === 12));
  assert.ok(obligations(d, vue.employes.map(e => e.id)).some(o => o.id === 12), 'Karim a ses propres échéances (forfait jours, campagne)');
  // Espace collaborateur de Karim : ses entretiens, comme tout salarié.
  const collab = await buildSnapshot(db, await user(12, 'collaborateur'));
  assert.deepEqual(perimetreEntretiens(collab), [12]);
  // Service RH : tout le monde.
  const rh = await buildSnapshot(db, await user(null, 'rh'));
  assert.equal(perimetreEntretiens(rh).length, rh.employes.length);
});

// — t111 : coût réel —

test('coût réel : exigé pour réaliser une action, 0 accepté, montant contrôlé ; réalisé et écart des enveloppes', async () => {
  const { db, run, refus, domain, RH } = await fresh();
  const engagee = (await db.insert<{ id: number }>('planActions', {
    exercice: 2026, f: null, libelle: 'Lean management', equipe: 'Production', periode: 'T4', effectif: 4, cout: 2400, statut: 'engage', origine: 'import',
  })).id;
  const avant = budgetSummary(await domain(), 2026, 85);
  await refus(RH, 'plan.avancer', { id: engagee, de: 'engage' }, /Coût réel de l’action à indiquer/);
  await refus(RH, 'plan.avancer', { id: engagee, de: 'engage', coutReel: -5 }, /Coût réel/);
  await refus(RH, 'plan.avancer', { id: engagee, de: 'engage', coutReel: '2 000 000' }, /Coût réel/);
  await refus(RH, 'plan.avancer', { id: engagee, de: 'engage', coutReel: 100, effectifReel: 2.5 }, /Effectif réel/);
  assert.equal(montantReel('2 150,50'), 2150.5);
  assert.equal(montantReel(0), 0);
  // Montants en euros arrondis (espaces insécables de fmtEur).
  assert.match(String(await run(RH, 'plan.avancer', { id: engagee, de: 'engage', coutReel: '2 150,50', effectifReel: '3' })),
    /^Lean management — Production · réalisé \(2\s151\s€, −250\s€ par rapport au prévu\)$/);
  const l = (await db.get<Ligne>('planActions', engagee))!;
  assert.deepEqual([l.statut, l.coutReel, l.effectifReel], ['realise', 2150.5, 3]);
  const apres = budgetSummary(await domain(), 2026, 85);
  assert.equal(apres.realise - avant.realise, 2150.5);
  assert.equal(apres.engage - avant.engage, -2400);
  assert.equal(apres.ecart - avant.ecart, -249.5);
  const j = (await db.all<Ligne>('journal')).filter(x => x.action === 'plan.avancer').at(-1)!;
  assert.deepEqual(j.payload.apres, { statut: 'realise', coutReel: 2150.5, effectifReel: 3 });
  // Démonstration : SST Production réalisée pour 1 260 € au lieu de 1 440 €, CACES Logistique pour 3 480 € au lieu de 3 250 €.
  assert.equal(avant.ecart, -180 + 230);
});

test('coût réel à la clôture d’une session : proposé, sinon le coût prévu ; effectif réel : les présents', async () => {
  const { db, run, refus, RH } = await fresh();
  const plan = (await db.insert<{ id: number }>('planActions', {
    exercice: 2026, f: 'epi', libelle: null, equipe: 'Qualité & HSE', periode: 'T4', effectif: 5, cout: 600, statut: 'engage', origine: 'import',
  })).id;
  await db.update('sessions', 6, { planId: plan });
  const participants = [{ empId: 5, present: true }, { empId: 11, present: true }, { empId: 14, present: false }, { empId: 17, present: true }, { empId: 20, present: false }];
  await refus(RH, 'session.cloturer', { id: 6, participants, coutReel: 'abc' }, /Coût réel de l’action du plan/);
  assert.match(String(await run(RH, 'session.cloturer', { id: 6, participants, coutReel: '540' })), /action du plan réalisée/);
  const l = (await db.get<Ligne>('planActions', plan))!;
  assert.deepEqual([l.statut, l.coutReel, l.effectifReel], ['realise', 540, 3]);
  // Le coût réel transmis entre dans la trace de l'action du plan, pas dans les paramètres recopiés.
  const j = (await db.all<Ligne>('journal')).filter(x => x.action === 'session.cloturer').at(-1)!;
  assert.equal(j.payload.coutReel, undefined);
  // Référent HSE (ni plan ni enveloppes) : le coût réel qu'il enverrait est ignoré, le coût prévu est retenu.
  const y = await fresh();
  const plan2 = (await y.db.insert<{ id: number }>('planActions', {
    exercice: 2026, f: 'epi', libelle: null, equipe: 'Qualité & HSE', periode: 'T4', effectif: 5, cout: 600, statut: 'engage', origine: 'import',
  })).id;
  await y.db.update('sessions', 6, { planId: plan2 });
  const realiseAvant = budgetSummary(await y.domain(), 2026, 85).realise;
  await y.run(await y.user(23, 'rh'), 'session.cloturer', { id: 6, participants, coutReel: 999999 });
  const l2 = (await y.db.get<Ligne>('planActions', plan2))!;
  assert.deepEqual([l2.statut, l2.coutReel], ['realise', 600]);
  assert.equal(budgetSummary(await y.domain(), 2026, 85).realise - realiseAvant, 600);
  // Session sans action du plan : un coût réel envoyé n'est pas contrôlé, il n'entre donc pas au journal (texte libre).
  const z = await fresh();
  await z.run(z.RH, 'session.cloturer', { id: 6, participants, coutReel: 'Absent : hospitalisé' });
  const jz = (await z.journal('session.cloturer')).at(-1)!;
  assert.ok(!JSON.stringify(jz).includes('hospitalisé'));
});

test('migration nommée : coût réel des actions déjà réalisées repris du coût prévu, une seule fois, tracée', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-cout-reel-'));
  try {
    const file = join(dir, 'cursus.db');
    const db = new Db(file);
    await appliquerMigrations(db);
    await seedDemo(db);
    // Base d'avant la mise à jour : coût réel vide, migration pas encore enregistrée.
    db.sql.exec(`UPDATE plan_actions SET cout_reel = NULL, effectif_reel = NULL; DELETE FROM migrations WHERE nom = 'lot4-entretiens-cout-reel'`);
    db.sql.close();
    const ancienne = new Db(file);
    assert.deepEqual(await appliquerMigrations(ancienne), ['lot4-entretiens-cout-reel']);
    const lignes = await ancienne.all<Ligne>('planActions');
    assert.ok(lignes.filter(l => l.statut === 'realise').every(l => l.coutReel === l.cout));
    assert.ok(lignes.filter(l => l.statut !== 'realise').every(l => l.coutReel === null), 'engagées et prévues : coût réel à saisir à leur clôture');
    const j = (await ancienne.all<Ligne>('journal')).filter(l => l.action === 'migration.coutReel');
    assert.equal(j.length, 1);
    assert.match(j[0].message, /coût réel des 8 actions réalisées du plan de formation égal à leur coût prévu/);
    assert.deepEqual(await appliquerMigrations(ancienne), [], 'rien à refaire');
    ancienne.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// — t092 : import « Remplacer » —

test('import « Remplacer » : seules les lignes prévues importées sont supprimées', async () => {
  const { db, run, RH } = await fresh();
  const ligne = async (origine: string | null, statut = 'prevu') => (await db.insert<{ id: number }>('planActions', {
    exercice: 2027, f: null, libelle: `Ligne ${origine ?? 'sans origine'} ${statut}`, equipe: 'Production', periode: 'T2', effectif: 1, cout: 100, statut, origine,
  })).id;
  const importee = await ligne('import'), demande = await ligne('demande'), sansOrigine = await ligne(null), engagee = await ligne('import', 'engage'), report = await ligne('report');
  await run(RH, 'plan.importer', { texte: SAMPLE_PLAN_CSV, exercice: 2027, mode: 'replace' });
  const ids = new Set((await db.all<Ligne>('planActions')).map(l => l.id));
  assert.ok(!ids.has(importee), 'ligne importée remplacée');
  assert.ok([demande, sansOrigine, engagee, report].every(id => ids.has(id)), 'demande acceptée, ancienne ligne, ligne engagée et report conservés');
  // Les lignes du jeu de démonstration (sans origine) restent aussi en 2026.
  const n2026 = (await db.all<Ligne>('planActions')).filter(l => l.exercice === 2026).length;
  await run(RH, 'plan.importer', { texte: SAMPLE_PLAN_CSV, exercice: 2026, mode: 'replace' });
  assert.ok((await db.all<Ligne>('planActions')).filter(l => l.exercice === 2026).length > n2026);
});

// — t117 : exercices passés et clôture —

test('exercices proposés : tous ceux du plan ou des enveloppes, l’année en cours et la suivante', async () => {
  const { db, domain } = await fresh();
  assert.deepEqual(exercicesProposes((await domain()).ds, 2026), [2026, 2027]);
  await db.insert('budgets', { exercice: 2024, equipe: 'Production', montant: 5000 });
  await db.insert('planActions', { exercice: 2025, f: 'sst', equipe: 'Production', periode: 'T1', effectif: 2, cout: 360, statut: 'realise', origine: 'import', coutReel: 360 });
  assert.deepEqual(exercicesProposes((await domain()).ds, 2026), [2024, 2025, 2026, 2027]);
  // Au 1er janvier 2027, l'exercice 2026 reste consultable.
  assert.deepEqual(exercicesProposes((await domain()).ds, 2027), [2024, 2025, 2026, 2027, 2028]);
});

/** Exécute `fn` au jour donné (CURSUS_TODAY, relu à chaque chargement du jeu de données), puis revient au 10 octobre. */
async function aLaDate<T>(jour: string, fn: () => T | Promise<T>): Promise<T> {
  process.env.CURSUS_TODAY = jour;
  try { return await fn(); } finally { process.env.CURSUS_TODAY = '2026-10-10'; }
}

test('clôture d’exercice : jamais l’exercice en cours, ni un exercice à venir', async () => {
  const { refus, RH } = await fresh();
  // Le 10 octobre 2026 : clos maintenant, la SST Logistique engagée, dont la session a lieu en 2026, serait réalisée
  // sur l'enveloppe 2027. La clôture est définitive : elle attend le 1er janvier.
  await refus(RH, 'plan.cloturerExercice', { exercice: 2026, reporter: [7] }, /Exercice 2026 en cours ou à venir : il se clôt à partir du 1er janvier 2027/);
  await refus(RH, 'plan.cloturerExercice', { exercice: 2027 }, /Exercice 2027 en cours ou à venir/);
  await aLaDate('2026-12-31', async () => await refus(RH, 'plan.cloturerExercice', { exercice: 2026 }, /en cours ou à venir/));
});

test('clôture d’exercice : report coché des actions engagées, sessions suivies, exercice figé', async () => await aLaDate('2027-01-05', async () => {
  const { db, run, refus, domain, RH, user } = await fresh();
  await refus(await user(14, 'rh'), 'plan.cloturerExercice', { exercice: 2026 }, /administrateur RH/, 403);
  await refus(RH, 'plan.cloturerExercice', { exercice: 2027 }, /en cours ou à venir/);
  await refus(RH, 'plan.cloturerExercice', { exercice: 2026, reporter: [1] }, /ni prévue ni engagée/, 400);
  const avant = budgetSummary(await domain(), 2026, 85);
  // Report de la SST Logistique (7, engagée, session 1 ouverte) et de la FCO (11, prévue) ; les autres restent en 2026.
  const msg = await run(RH, 'plan.cloturerExercice', { exercice: 2026, reporter: [7, 11] });
  assert.equal(msg, 'Exercice 2026 clos le 5 janv. 2027 · 2 actions reportées sur 2027 · 6 actions non réalisées laissées dans 2026');
  const plan = await db.all<Ligne>('planActions');
  const sst = plan.find(l => l.reportDe === 7)!, fco = plan.find(l => l.reportDe === 11)!;
  assert.deepEqual([sst.exercice, sst.statut, sst.origine, sst.periode, sst.cout, sst.equipe], [2027, 'engage', 'report', 'T1', 1080, 'Logistique']);
  assert.deepEqual([fco.exercice, fco.statut], [2027, 'prevu']);
  assert.deepEqual(plan.filter(l => [7, 11].includes(l.id)).map(l => l.statut), ['reporte', 'reporte']);
  assert.equal((await db.get<Ligne>('sessions', 1))!.planId, sst.id, 'la session ouverte suit l’action reportée');
  assert.deepEqual(await db.all<Ligne>('exercicesClos'), [{ exercice: 2026, le: '2027-01-05', par: 'Sandrine Vidal' }]);
  // Les actions reportées sortent des sommes de 2026 et entrent dans celles de 2027.
  const b26 = budgetSummary(await domain(), 2026, 85), b27 = budgetSummary(await domain(), 2027, 85);
  assert.equal(avant.engage - b26.engage, 1080);
  assert.equal(avant.prevu - b26.prevu, 1800);
  assert.deepEqual([b27.engage, b27.prevu], [1080, 1800]);
  assert.equal(b26.realise, avant.realise, 'les réalisées restent');
  // Exercice figé : ni avancement, ni import, ni enveloppes, ni nouvelle clôture, ni session sur une action prévue.
  await refus(RH, 'plan.avancer', { id: 8, de: 'engage', coutReel: 2600 }, /Exercice 2026 clos/);
  await refus(RH, 'plan.avancer', { id: 7, de: 'engage', coutReel: 1000 }, /reportée sur l’exercice 2027/);
  await refus(RH, 'plan.importer', { texte: SAMPLE_PLAN_CSV, exercice: 2026, mode: 'add' }, /Exercice 2026 clos/);
  await refus(RH, 'budget.enveloppes', { exercice: 2026, enveloppes: { Production: 1 } }, /Exercice 2026 clos/);
  await refus(RH, 'plan.cloturerExercice', { exercice: 2026 }, /déjà clos \(le 5 janv\. 2027 par Sandrine Vidal\)/);
  await refus(RH, 'session.creer', { f: 'caces486', date: '2027-02-01', lieu: 'Lyon', places: 4, planId: 12 }, /exercice clos/);
  // La session reportée se clôt sur l'action de 2027 ; une demande acceptée s'ajoute au plan 2027.
  assert.match(String(await run(RH, 'plan.avancer', { id: sst.id, de: 'engage', coutReel: 1000 })), /réalisé/);
  await run(RH, 'demande.accepter', { id: (await db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'formation', f: null, h: null, libelle: 'Anglais technique', label: null, sessionId: null, motif: 'Clients', date: '2026-10-09', statut: 'attente', reponse: null, parId: null,
  })).id });
  const ajoutee = (await db.all<Ligne>('planActions')).at(-1)!;
  assert.deepEqual([ajoutee.exercice, ajoutee.periode, ajoutee.origine], [2027, 'T1', 'demande']);
  // Journal : exercice et actions reportées (identifiants).
  assert.deepEqual((await db.all<Ligne>('journal')).filter(l => l.action === 'plan.cloturerExercice').map(l => l.payload), [{ exercice: 2026, reporter: [7, 11] }]);
}));

test('clôture d’exercice : données transmises au service RH et à la lecture seule seulement', async () => await aLaDate('2027-01-05', async () => {
  const { db, run, RH, KARIM, MEHDI, user } = await fresh();
  await run(RH, 'plan.cloturerExercice', { exercice: 2026, reporter: [] });
  assert.equal((await buildSnapshot(db, RH)).exercicesClos.length, 1);
  assert.equal((await buildSnapshot(db, await user(11, 'rh'))).exercicesClos.length, 1, 'lecture seule');
  for (const u of [KARIM, MEHDI, await user(23, 'rh'), await user(7, 'rh')]) assert.deepEqual((await buildSnapshot(db, u)).exercicesClos, []);
}));
