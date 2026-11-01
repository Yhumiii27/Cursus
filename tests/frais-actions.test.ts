// Notes de frais (lot 11, chantier C5, étape 1) sur le jeu de démonstration (module activé) le 10 octobre 2026 : circuit
// (soumission, validation par le manager, contrôle par la comptabilité), droits (refuserSoiMeme, profil « Comptabilité »),
// frais médicaux isolés (jamais au manager, ni dans ses totaux ; « autre » au journal), filtre manager propre aux frais
// (N+2, suppléant « absences », suppléant « frais »), vues des profils restreints, journal en liste blanche, justificatifs
// scellés et immuables, famille « frais » des lots de paie (colonne montant exigée, lot ancien inchangé), avances, devises,
// barème manquant, cascade de conservation (notes payées gardées jusqu'à leur terme comptable), registres du cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
// Bilans du nettoyage des pièces (fichiers fictifs) : hors de la sortie du test.
(await import('../server/src/logs.ts')).reglerJournaux({ sortie: () => {} });
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { verifierSceaux } = await import('../server/src/sceaux.ts');
const { effacer } = await import('../server/src/conservation.ts');
const { REFUS_SANS_MONTANT } = await import('../server/src/frais-paie.ts');
const { controlerOrphelins, REFERENCES } = await import('../server/src/integrite.ts');
const { HORS_INSTANTANE, LECTURES } = await import('../server/src/lecture-brute.ts');
const { CHAMPS_PAR_SALARIE } = await import('../server/src/vues-cache.ts');
const { TABLES_CHANGEMENTS_SANS_CLE, TABLES_SANS_REVISION } = await import('../server/src/db.ts');
const { controleDelegation } = await import('../shared/rules/delegations-manager.ts');
const L = await import('../shared/rules/lots-paie.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;

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
    return o as { message: string; result?: any };
  });
  /** Refus d'une action : statut HTTP et message. */
  const refus = async (u: User, name: string, p: Record<string, unknown>) => {
    try { await run(u, name, p); } catch (e) { if (e instanceof ActionError) return { status: e.status, message: e.message }; throw e; }
    assert.fail(`${name} aurait dû être refusée`);
  };
  const vue = async (u: User) => await db.lecture(async () => await buildSnapshot(db, u, { cache: false })) as Dataset;
  const journal = async () => await db.all<{ action: string; message: string | null; payload: Record<string, unknown>; salaries: number[] | null }>('journal');
  return {
    db, run, refus, vue, journal, user,
    ADMIN: await user(null, 'rh'), KARIM: await user(12, 'manager'), HUGO: await user(16, 'manager'), NADIA: await user(9, 'manager'), MEHDI: await user(2, 'collaborateur'),
    MANON: await user(21, 'rh'), PAIE: await user(7, 'rh'), LECT: await user(11, 'rh'), HSE: await user(23, 'rh'),
  };
}

/** Dépense sans justificatif, avec attestation (« divers », hors du cumul avec les forfaits). */
const DEPENSE = { date: '2026-10-06', categorie: 'divers', montant: 20, sansJustificatif: true, attestation: true };

test('circuit : soumise, validée par le manager, contrôlée par la comptabilité ; jamais sa propre note ; profil Comptabilité limité', async () => {
  const { db, run, refus, MEHDI, KARIM, MANON, ADMIN, HUGO } = await fresh();
  assert.equal(MANON.profilRh, 'comptabilite');
  const { result: { note } } = await run(MEHDI, 'frais.note.creer', { periode: '2026-10' });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, commercant: 'Quincaillerie Secrète' });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-07', categorie: 'repas_affaires', montant: 64, invites: 'Jean Client', sansJustificatif: true, attestation: true });
  // Refusées : saisie pour un autre, validation de sa propre note, contrôle par le manager, saisie par la comptabilité.
  assert.equal((await refus(MEHDI, 'frais.note.creer', { empId: 6, periode: '2026-10' })).status, 403);
  assert.equal((await refus(MANON, 'frais.note.creer', { empId: 2, periode: '2026-10' })).status, 403);
  assert.equal((await refus(MEHDI, 'frais.note.valider', { id: note })).status, 403);
  const s = await run(MEHDI, 'frais.note.soumettre', { id: note });
  assert.match(s.message, /^Note de frais n° \d+ soumise — 2 dépenses · en attente de la validation du manager$/);
  assert.equal((await refus(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE })).status, 409, 'note soumise');
  assert.equal((await refus(HUGO, 'frais.note.valider', { id: note })).status, 403, 'autre manager');
  assert.equal((await refus(KARIM, 'frais.note.controler', { id: note })).status, 403);
  assert.match((await run(KARIM, 'frais.note.valider', { id: note })).message, /validée · en attente du contrôle/);
  assert.equal((await refus(MANON, 'frais.note.valider', { id: note + 1000 })).status, 403, 'même refus qu’un identifiant hors périmètre');
  assert.match((await run(MANON, 'frais.note.controler', { id: note })).message, /contrôlée · remboursée avec la prochaine paie/);
  assert.equal((await db.get<{ statut: string }>('notesFrais', note))!.statut, 'controlee');
  // La comptabilité ne contrôle pas sa propre note (Manon Faure, salariée 21).
  const propre = (await run(ADMIN, 'frais.note.creer', { empId: 21, periode: '2026-10' })).result.note;
  await run(ADMIN, 'frais.ligne.ajouter', { noteId: propre, ...DEPENSE });
  await run(ADMIN, 'frais.note.soumettre', { id: propre });
  await run(ADMIN, 'frais.note.valider', { id: propre });
  assert.match((await refus(MANON, 'frais.note.controler', { id: propre })).message, /propre note de frais/);
  // Ni les autres actions du service RH, ni les référentiels de l'administrateur.
  assert.equal((await refus(MANON, 'frais.bareme.enregistrer', { annee: 2027, tranches: [{ cvMin: 0, kmMin: 0, a: 0.5 }] })).status, 403);
  assert.match((await run(MANON, 'frais.taux.enregistrer', { devise: 'usd', mois: '2026-10', taux: '0,91' })).message, /Taux USD enregistré pour octobre 2026/);
});

test('circuit : renvoi pour correction (motif jamais au journal), manager sans N+1 et circuit « manager », annulation', async () => {
  const { db, run, refus, MEHDI, KARIM, ADMIN, journal } = await fresh();
  const note = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE });
  await run(MEHDI, 'frais.note.soumettre', { id: note });
  await run(KARIM, 'frais.note.renvoyer', { id: note, motif: 'Motif très confidentiel' });
  const n = (await db.get<{ statut: string; renvoiMotif: string }>('notesFrais', note))!;
  assert.deepEqual([n.statut, n.renvoiMotif], ['a_corriger', 'Motif très confidentiel']);
  assert.ok(!JSON.stringify(await journal()).includes('Motif très confidentiel'));
  // Karim Haddad (manager de la Maintenance) n'a pas de N+1 : sa note va directement au contrôle.
  const k = (await run(KARIM, 'frais.note.creer', { periode: '2026-10' })).result.note;
  await run(KARIM, 'frais.ligne.ajouter', { noteId: k, ...DEPENSE });
  assert.match((await run(KARIM, 'frais.note.soumettre', { id: k })).message, /transmise directement au contrôle/);
  // Circuit « manager » : la validation vaut contrôle.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), fraisCircuit: 'manager' });
  await run(MEHDI, 'frais.note.soumettre', { id: note });
  assert.match((await run(KARIM, 'frais.note.valider', { id: note })).message, /en attente de la paie/);
  assert.equal((await db.get<{ statut: string }>('notesFrais', note))!.statut, 'controlee');
  assert.equal((await refus(MEHDI, 'frais.note.annuler', { id: note })).status, 409, 'validée : le salarié ne l’annule plus');
  assert.match((await run(ADMIN, 'frais.note.annuler', { id: note, motif: 'Doublon' })).message, /annulée/);
  // Module désactivé : refus, référentiels préparés quand même.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), notesFraisActives: false });
  assert.match((await refus(MEHDI, 'frais.note.creer', { periode: '2026-10' })).message, /désactivées/);
  assert.match((await run(ADMIN, 'frais.forfait.enregistrer', { annee: 2027, code: 'panier', montant: 7.4 })).message, /enregistrée/);
});

test('frais médicaux : note séparée, jamais au manager ni dans ses totaux, contrôlée directement ; « autre » au journal', async () => {
  const { run, refus, vue, journal, MEHDI, KARIM, MANON, PAIE } = await fresh();
  const m = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10', medicale: true })).result.note;
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { noteId: m, ...DEPENSE })).message, /que des frais médicaux/);
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: m, ...DEPENSE, categorie: 'medical', montant: 35, commercant: 'Pharmacie du Port' });
  const o = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { noteId: o, ...DEPENSE, categorie: 'medical' })).message, /note séparée/);
  assert.match((await run(MEHDI, 'frais.note.soumettre', { id: m })).message, /transmise directement au contrôle/);
  assert.equal((await refus(KARIM, 'frais.note.valider', { id: m })).status, 403);
  assert.equal((await refus(KARIM, 'frais.note.renvoyer', { id: m, motif: 'x' })).status, 403);
  // Vue du manager : ni la note médicale ni sa ligne ; la note ordinaire de Mehdi, oui.
  const vk = await vue(KARIM);
  assert.ok(vk.notesFrais!.some(n => n.id === o) && !vk.notesFrais!.some(n => n.id === m || n.medicale));
  assert.ok(!vk.lignesFrais!.some(l => l.categorie === 'medical'));
  // Le salarié voit la sienne ; la comptabilité aussi ; la paie : la note, sans ses lignes ni la mention médicale.
  assert.ok((await vue(MEHDI)).notesFrais!.some(n => n.id === m && n.medicale));
  const vm = await vue(MANON);
  assert.ok(vm.notesFrais!.some(n => n.id === m) && vm.lignesFrais!.some(l => l.noteId === m && l.categorie === 'medical'));
  await run(MANON, 'frais.note.controler', { id: m });
  const vp = await vue(PAIE);
  assert.deepEqual(vp.lignesFrais, []);
  assert.equal(vp.notesFrais!.find(n => n.id === m)?.medicale, false);
  // Journal : catégorie « autre », ni le mot « médical », ni le commerçant, ni le montant d'une ligne.
  const j = JSON.stringify((await journal()).filter(l => l.action.startsWith('frais.')));
  assert.ok(j.includes('"categorie":"autre"'));
  assert.ok(!/medical|médic|Pharmacie|"montant"/i.test(j), j);
});

test('filtre manager propre aux frais : ni N+2 (consultation activée), ni suppléant « absences » ; suppléant « frais » sans note médicale', async () => {
  const { db, run, vue, MEHDI, NADIA, HUGO, ADMIN } = await fresh();
  const o = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  const m = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10', medicale: true })).result.note;
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: o, ...DEPENSE });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: m, ...DEPENSE, categorie: 'medical' });
  // N+2 : la Maintenance rattachée au Commercial (Nadia Kaci), consultation N+2 activée.
  await db.update('equipes', 'Maintenance', { parente: 'Commercial' });
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), consultationN2: true });
  const vn = await vue(NADIA);
  assert.ok(vn.lectureSeule!.includes(2), 'Mehdi en lecture seule pour son N+2');
  assert.ok(!vn.notesFrais!.some(n => n.empId === 2) && !vn.lignesFrais!.some(l => l.empId === 2) && !vn.vehiculesPerso!.some(v => v.empId === 2) && !vn.avancesFrais!.some(a => a.empId === 2));
  await db.update('equipes', 'Maintenance', { parente: null });
  // Suppléant « absences » seulement : rien des frais ; puis « frais » : notes ordinaires, véhicules et avances.
  const g = await db.insert<{ id: number }>('delegations', { managerId: 12, suppleantId: 16, du: '2026-10-01', au: '2026-10-20', perimetre: ['absences'], creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad' });
  const va = await vue(HUGO);
  assert.ok(va.delegues!.some(x => x.empId === 2) && !va.notesFrais!.some(n => n.empId === 2));
  await db.update('delegations', g.id, { perimetre: ['absences', 'frais'] });
  const vf = await vue(HUGO);
  assert.ok(vf.notesFrais!.some(n => n.id === o) && !vf.notesFrais!.some(n => n.id === m));
  assert.ok(vf.vehiculesPerso!.some(v => v.empId === 2) && vf.avancesFrais!.some(a => a.empId === 2));
  await run(MEHDI, 'frais.note.soumettre', { id: o });
  assert.match((await run(HUGO, 'frais.note.valider', { id: o })).message, /validée/);
  // Module désactivé : le périmètre « frais » d'une délégation ne vaut plus, et ne se donne plus.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), notesFraisActives: false });
  assert.ok(!(await vue(HUGO)).notesFrais!.some(n => n.empId === 2));
  const ds = await loadFull(db, ADMIN);
  assert.match(controleDelegation(ds, { managerId: 12, suppleantId: 16, du: '2026-11-01', au: '2026-11-10', perimetre: ['frais'] }, { suppleant: ds.employes.find(e => e.id === 16), nom: String })!, /pas activées/);
});

test('vues des profils restreints : comptabilité (aucun dossier RH), paie (notes à rembourser), référent HSE et lecture seule (rien)', async () => {
  const { vue, MANON, PAIE, HSE, LECT } = await fresh();
  const c = await vue(MANON);
  assert.deepEqual([c.employes.length, c.absences.length, c.feuilles.length, c.entretiens.length, c.voyages.length, c.demandesVisite.length], [0, 0, 0, 0, 0, 0]);
  assert.ok(c.annuaire.length > 20 && c.notesFrais!.length >= 4 && c.lignesFrais!.some(l => l.categorie === 'medical'));
  assert.ok(c.referentiels.baremesKm!.length && c.referentiels.forfaitsFrais!.length && c.referentiels.tauxDevises!.length);
  assert.equal(c.referentiels.postes.length, 0);
  assert.equal(c.couverture, undefined);
  const p = await vue(PAIE);
  assert.ok(p.notesFrais!.every(n => ['controlee', 'en_paiement', 'payee'].includes(n.statut)));
  assert.deepEqual([p.lignesFrais, p.vehiculesPerso], [[], []]);
  for (const v of [await vue(HSE), await vue(LECT)]) assert.deepEqual([v.notesFrais, v.lignesFrais, v.vehiculesPerso, v.avancesFrais], [[], [], [], []]);
});

test('justificatifs : joints à la ligne, scellés à la soumission (chaîne d’empreintes), immuables ensuite', async () => {
  const { db, run, refus, MEHDI, ADMIN, journal } = await fresh();
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  const compte = MEHDI.compteId!;
  const piece = async (jeton: string, empreinte: string) => await db.insert('pieces', {
    jeton, empId: null, objet: null, objetId: null, nom: 'recu.pdf', type: 'application/pdf', taille: 10, empreinte, fichier: `f-${jeton}`,
    deposeLe: new Date().toISOString(), deposePar: 'Mehdi Benali', deposeCompteId: compte,
  });
  await piece('j1', 'a'.repeat(64));
  await piece('j2', 'a'.repeat(64));
  const note = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  const l1 = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-06', categorie: 'divers', montant: 20, jetons: ['j1'] })).result.ligne;
  // Même reçu sur une autre ligne : doublon par empreinte (alerte, sans blocage).
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-07', categorie: 'divers', montant: 12, jetons: ['j2'] });
  const s = await run(MEHDI, 'frais.note.soumettre', { id: note });
  assert.equal(s.result.pieces, 2);
  assert.deepEqual(await verifierSceaux(db), []);
  const p1 = (await db.one<{ id: number }>('SELECT id FROM pieces WHERE objet_id = ? AND objet = ?', [l1, 'ligneFrais']))!.id;
  assert.match((await refus(ADMIN, 'piece.retirer', { id: p1, motif: 'Essai' })).message, /scellé/);
  await piece('j3', 'b'.repeat(64));
  assert.equal((await refus(MEHDI, 'piece.joindre', { objet: 'ligneFrais', objetId: l1, jeton: 'j3' })).status, 409);
  // Altération de l'empreinte : la chaîne se rompt à ce maillon.
  await db.run('UPDATE pieces SET empreinte = ? WHERE id = ?', ['c'.repeat(64), p1]);
  assert.equal((await verifierSceaux(db)).length, 1);
  // Journal : nombre de pièces, objet de pièce jamais « ligneFraisSante ».
  assert.ok((await journal()).some(l => l.action === 'frais.ligne.ajouter' && l.payload.pieces === 1));
  const m = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10', medicale: true })).result.note;
  const lm = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: m, ...DEPENSE, categorie: 'medical' })).result.ligne;
  await piece('j4', 'd'.repeat(64));
  assert.equal((await refus(MEHDI, 'piece.joindre', { objet: 'ligneFrais', objetId: lm, jeton: 'j4' })).status, 403, 'objet de santé pour une note médicale');
  await run(MEHDI, 'piece.joindre', { objet: 'ligneFraisSante', objetId: lm, jeton: 'j4' });
  const j = JSON.stringify(await journal());
  assert.ok(!j.includes('ligneFraisSante') && !/médic/i.test(j));
  // Ligne supprimée en brouillon : ses pièces retirées, aucune référence orpheline.
  await run(MEHDI, 'frais.ligne.supprimer', { id: lm });
  // Références seulement : les fichiers des pièces de l'essai n'existent pas.
  assert.deepEqual((await controlerOrphelins(db, [...REFERENCES])).parReference, {});
});

test('devises, indemnités kilométriques (barème, barème manquant), allocations forfaitaires, avances', async () => {
  const { db, run, refus, MEHDI, KARIM, ADMIN } = await fresh();
  const note = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  const ligne = async (id: number) => (await db.get<{ montantEur: number; taux: number | null; montant: number }>('lignesFrais', id))!;
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, devise: 'USD' })).message, /Taux de la devise USD manquant/);
  const usd = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, devise: 'USD', montant: 100, taux: 0.9 })).result.ligne;
  assert.deepEqual([(await ligne(usd)).montantEur, (await ligne(usd)).taux], [90, 0.9]);
  const carte = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, devise: 'GBP', montant: 50, montantEur: 58.37 })).result.ligne;
  assert.equal((await ligne(carte)).montantEur, 58.37, 'montant débité saisi (relevé de carte)');
  await run(MEHDI, 'frais.ligne.modifier', { id: carte, invites: null });
  assert.equal((await ligne(carte)).montantEur, 58.37, 'gardé sans taux à la modification');
  const mad = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, date: '2026-09-20', devise: 'MAD', montant: 1000 })).result.ligne;
  assert.equal((await ligne(mad)).montantEur, 92, 'taux du mois saisi par la comptabilité');
  // Indemnités kilométriques : véhicule déclaré, part marginale du barème (120 km déjà parcourus dans l'année).
  const v = (await db.one<{ id: number }>('SELECT id FROM vehicules_perso WHERE emp_id = 2'))!.id;
  const ik = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-08', categorie: 'ik', km: 100, vehiculeId: v, montant: 9999 })).result.ligne;
  assert.equal((await ligne(ik)).montantEur, 63.6, 'calculé au barème, jamais saisi');
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-08', categorie: 'ik', km: 10, vehiculeId: 999 })).message, /véhicule personnel déclaré/);
  // Barème de l'année manquant (2027) : indemnité nulle, soumission refusée.
  process.env.CURSUS_TODAY = '2027-01-15';
  try {
    const n27 = (await run(MEHDI, 'frais.note.creer', { periode: '2027-01' })).result.note;
    await run(MEHDI, 'frais.ligne.ajouter', { noteId: n27, date: '2027-01-12', categorie: 'ik', km: 10, vehiculeId: v });
    assert.match((await refus(MEHDI, 'frais.note.soumettre', { id: n27 })).message, /barème kilométrique 2027 manquant/);
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
  // Allocation forfaitaire : montant à la limite de l'année quand il n'est pas saisi.
  const f = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-08', categorie: 'forfait', forfait: 'repas_restaurant' })).result.ligne;
  assert.equal((await ligne(f)).montantEur, 21.1);
  // Avances : demandée, validée par le manager, jamais par soi-même.
  const a = (await run(MEHDI, 'frais.avance.demander', { montant: 250 })).result.avance;
  assert.equal((await refus(MEHDI, 'frais.avance.valider', { id: a })).status, 403);
  await run(KARIM, 'frais.avance.valider', { id: a });
  assert.equal((await db.get<{ statut: string }>('avancesFrais', a))!.statut, 'validee');
  assert.match((await run(ADMIN, 'frais.bareme.enregistrer', { annee: 2027, type: 'voiture', tranches: [{ cvMin: 0, cvMax: null, kmMin: 0, kmMax: null, a: '0,6', b: 0 }] })).message, /1 tranche/);
});

test('paie : famille « frais » (rubriques désactivées : à saisir dans Sage), colonne montant exigée, réservation, annulation, confirmation', async () => {
  const { db, run, refus, MEHDI, KARIM, MANON, PAIE } = await fresh();
  const note = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, ...DEPENSE, montant: 42.5 });
  await run(MEHDI, 'frais.note.soumettre', { id: note });
  await run(KARIM, 'frais.note.valider', { id: note });
  await run(MANON, 'frais.note.controler', { id: note });
  const a = (await run(MEHDI, 'frais.avance.demander', { montant: 100 })).result.avance;
  await run(KARIM, 'frais.avance.valider', { id: a });
  const statut = async () => [(await db.get<{ statut: string }>('notesFrais', note))!.statut, (await db.get<{ statut: string }>('avancesFrais', a))!.statut];
  // Rubriques désactivées : réservées par le lot, listées à saisir dans Sage, sans nature de dépense.
  const g = await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.match(g.message, /remboursements de frais/);
  const lot = (await db.get<any>('lotsPaie', g.result.lot))!;
  assert.deepEqual(lot.frais, [{ id: note, empId: 2 }, { id: a, empId: 2, avance: true }]);
  assert.deepEqual(lot.resume.frais, { elements: 2, salaries: 1, montant: 142.5 });
  assert.deepEqual(lot.resume.aSaisir.filter((x: any) => x.famille === 'frais').map((x: any) => [x.rubrique, x.quantite, x.detail]),
    [['FRAIS_REMB', 42.5, `note de frais n° ${note}, en euros`], ['FRAIS_AVANCE', 100, `avance sur frais n° ${a}, en euros`]]);
  assert.deepEqual(await statut(), ['en_paiement', 'en_paiement']);
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  assert.deepEqual(await statut(), ['controlee', 'validee']);
  // Rubrique active sans colonne « montant » : lot refusé ; avec elle : montant dans le fichier, quantité 1.
  await run(PAIE, 'paie.rubrique', { code: 'FRAIS_REMB', codeSage: 'R900', active: true });
  const r = await refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.deepEqual([r.status, r.message], [409, REFUS_SANS_MONTANT]);
  await run(PAIE, 'paie.formatFichier', { colonnes: ['matricule', 'periode', 'rubrique', 'quantite', 'montant'] });
  const g2 = await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot2 = (await db.get<any>('lotsPaie', g2.result.lot))!;
  const fichier = L.fichierLot(lot2.contenu, { ...L.FORMAT_FICHIER_DEFAUT, colonnes: ['matricule', 'periode', 'rubrique', 'quantite', 'montant'] }, lot2.contenu.libelles);
  assert.ok(fichier.split('\r\n').includes('004102;2026-10;R900;1;42,50'), fichier);
  assert.equal(lot2.contenu.libelles.R900, 'Remboursement de frais professionnels (non soumis)', 'libellé générique');
  await run(PAIE, 'paie.lotConfirmer', { id: lot2.id });
  assert.deepEqual(await statut(), ['payee', 'versee']);
  assert.equal((await db.get<{ payeeLe: string }>('notesFrais', note))!.payeeLe, '2026-10-10');
  assert.ok(lot2.contenu.frais.every((x: any) => x.quantite === 1));
});

test('fichier d’un lot ancien inchangé : format par défaut identique, colonne montant vide pour les quantités', () => {
  const contenu = { dossier: 'X', envoye_le: '', lignes: [{ matricule: '004102', semaine: '2026-10-05', periode: '2026-10', rubriques: { HN: 35, HS25: 4 } }] };
  assert.equal(L.fichierLot(contenu), 'matricule;periode;rubrique;quantite\r\n004102;2026-10;HN;35\r\n004102;2026-10;HS25;4\r\n');
  assert.equal(L.fichierLot(contenu, { ...L.FORMAT_FICHIER_DEFAUT, colonnes: ['matricule', 'rubrique', 'quantite', 'montant'], decimale: '.' }),
    'matricule;rubrique;quantite;montant\r\n004102;HN;35;\r\n004102;HS25;4;\r\n');
  // Montant nul (avance déduite égale au remboursement) : omis ; montants additionnés par code Sage.
  const frais = [
    { note: 1, avance: null, empId: 2, matricule: '004102', periode: '2026-10', rubrique: 'FRAIS_REMB', codeSage: 'R900', quantite: 1, montant: 10.1 },
    { note: 2, avance: null, empId: 2, matricule: '004102', periode: '2026-10', rubrique: 'FRAIS_REMB', codeSage: 'R900', quantite: 1, montant: 5.2 },
    { note: 2, avance: null, empId: 2, matricule: '004102', periode: '2026-10', rubrique: 'FRAIS_AVANCE_DED', codeSage: 'R905', quantite: 1, montant: 0 },
    { note: 3, avance: null, empId: 2, matricule: '004102', periode: '2026-10', rubrique: 'FRAIS_IK', codeSage: null, quantite: 1, montant: 63.6 },
  ];
  assert.deepEqual(L.lignesFichier({ lignes: [], frais }), [{ matricule: '004102', periode: '2026-10', rubrique: 'R900', quantite: 1, montant: 15.3 }]);
});

test('conservation : notes payées gardées jusqu’au terme comptable (10 ans), le reste effacé, aucune référence orpheline', async () => {
  const { db, run, MEHDI } = await fresh();
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  const note = async (statut: string, payeeLe: string | null) => {
    const id = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
    await run(MEHDI, 'frais.ligne.ajouter', { noteId: id, ...DEPENSE });
    await db.update('notesFrais', id, { statut, payeeLe });
    return id;
  };
  const gardee = await note('payee', '2020-03-31'), ancienne = await note('payee', '2015-01-31'), brouillon = await note('brouillon', null);
  const lg = (await db.one<{ id: number }>('SELECT id FROM lignes_frais WHERE note_id = ?', [gardee]))!.id;
  await db.insert('pieces', { jeton: null, empId: 2, objet: 'ligneFrais', objetId: lg, nom: 'recu-mehdi-benali.pdf', type: 'application/pdf', taille: 10, empreinte: 'e'.repeat(64), fichier: 'fg', deposeLe: '2020-03-01T08:00:00.000Z', deposePar: 'Mehdi Benali' });
  await db.update('employes', 2, { fin: '2019-12-31' });
  await db.tx(async () => { await effacer(db, 2, ['dossier'], { ti: '2026-10-10', le: '2026-10-10T08:00:00.000Z', par: 'Essai' }, { motif: 'Essai', avantEcheance: false }); });
  const restantes = (await db.where<{ id: number }>('notesFrais', 'empId', 2)).map(n => n.id);
  assert.ok(restantes.includes(gardee) && !restantes.includes(ancienne) && !restantes.includes(brouillon));
  const p = (await db.one<{ retiree_le: string | null; nom: string }>('SELECT retiree_le, nom FROM pieces WHERE objet_id = ? AND objet = ?', [lg, 'ligneFrais']))!;
  assert.equal(p.retiree_le, null, 'justificatif d’une note gardée : en vigueur');
  assert.match(p.nom, /^piece-\d+$/, 'nom d’origine retiré (il peut nommer la personne)');
  assert.equal((await db.get<{ nom: string }>('employes', 2))!.nom, 'Salarié anonymisé n° 2');
  // Références seulement : les fichiers des pièces de l'essai n'existent pas.
  assert.deepEqual((await controlerOrphelins(db, [...REFERENCES])).parReference, {});
});

test('registres : tables lues par l’instantané, champs par salarié, exports hors de l’instantané, sceaux sans révision, dépenses sans clé', () => {
  for (const c of ['notesFrais', 'lignesFrais', 'vehiculesPerso', 'avancesFrais'] as const) {
    assert.deepEqual(LECTURES[c], [c]);
    assert.ok(CHAMPS_PAR_SALARIE.has(c));
  }
  assert.ok(LECTURES.referentiels.includes('baremesKm') && LECTURES.referentiels.includes('forfaitsFrais') && LECTURES.referentiels.includes('tauxDevises'));
  assert.ok(HORS_INSTANTANE.has('exportsFrais') && TABLES_SANS_REVISION.has('sceauxPieces') && TABLES_CHANGEMENTS_SANS_CLE.has('lignesFrais'));
});
