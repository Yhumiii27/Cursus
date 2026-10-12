// Données de santé : motif de reprise en liste fermée, sans information médicale (saisie, reprise automatique,
// migration des anciennes fiches) ; vaccinations (vaccin et date d'injection) réservées au service RH et à
// l'intéressé ; information de la personne (art. 13 du RGPD) avant la saisie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { motifRepriseDuTexte, motifsDeReprise } = await import('../server/src/migrate.ts');
const { INFO_VACCINATIONS, MOTIFS_REPRISE, NATURES_ABSENCE, estMotifReprise } = await import('../shared/constants.ts');
const { validerProfil, profilOf } = await import('../shared/rules/profil.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;

// Comptes de démonstration : Sandrine Vidal (administratrice RH), Antoine Leroy (14, gestionnaire RH), Sarah Cohen
// (23, référente HSE), Aïcha Diallo (7, paie), Élodie Bernard (11, lecture seule) ; Karim Haddad (12) encadre Mehdi (2).
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteId = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteId(empId), role, methode: 'demo' })!;
  const run = (u: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, u, loadFull(db, u)), payload));
  return { db, user, run, RH: user(null, 'rh') };
}

test('motif de reprise : liste fermée, aucune saisie libre, aucun libellé médical', () => {
  const { db, run, RH } = fresh();
  // Aucun motif de la liste ne nomme une maladie ; l'arrêt longue maladie s'inscrit « absence longue ».
  assert.ok(MOTIFS_REPRISE.every(m => !/maladie|médic|patholog|arrêt/i.test(m)));
  assert.equal(NATURES_ABSENCE.ALD.reprise, 'absence longue');
  assert.ok(Object.values(NATURES_ABSENCE).every(n => !n.reprise || estMotifReprise(n.reprise)));
  // Texte libre refusé, au serveur comme au formulaire (règle partagée).
  assert.throws(() => run(RH, 'employe.modifier', { id: 6, repriseMotif: 'longue maladie (dépression)', repriseDate: '2026-09-15' }),
    (e: unknown) => e instanceof ActionError && /Motif de reprise à choisir dans la liste/.test(e.message));
  const fiche = profilOf(loadFull(db, RH).employes.find(e => e.id === 6)!);
  assert.deepEqual(validerProfil({ ...fiche, repriseMotif: 'cancer', repriseDate: '2026-09-15' }, { equipes: ['Maintenance', 'Production', 'Logistique', 'Qualité'], year: 2026 }).errors
    .filter(e => /Motif de reprise/.test(e)), ['Motif de reprise à choisir dans la liste (aucune information médicale).']);
  run(RH, 'employe.modifier', { id: 6, repriseMotif: 'congé de proche aidant', repriseDate: '2026-09-15' });
  assert.equal(loadFull(db, RH).employes.find(e => e.id === 6)!.repriseMotif, 'congé de proche aidant');
});

test('migration : un motif de reprise en texte libre est ramené à la liste, le texte d’origine n’est pas conservé', () => {
  assert.equal(motifRepriseDuTexte('congé de maternité'), 'congé de maternité');
  assert.equal(motifRepriseDuTexte('arrêt longue maladie'), 'absence longue');
  assert.equal(motifRepriseDuTexte('Congé parental'), 'congé parental d’éducation');
  assert.equal(motifRepriseDuTexte('temps partiel (congé parental)'), 'temps partiel parental');
  assert.equal(motifRepriseDuTexte('Congé sabbatique 2025'), 'congé sabbatique');
  assert.equal(motifRepriseDuTexte('Fin de mandat syndical'), 'mandat syndical');
  assert.equal(motifRepriseDuTexte('Mobilité volontaire sécurisée'), 'mobilité volontaire sécurisée');
  assert.equal(motifRepriseDuTexte('Burn-out'), 'absence longue', 'texte inconnu : mention générique, masquée au manager');
  // Un terme médical l'emporte sur un cas de la liste : jamais de motif non médical faux, que le manager recevrait.
  for (const t of ['Temps partiel thérapeutique', 'reprise à temps partiel thérapeutique', 'Mi-temps thérapeutique', 'Congé de présence parentale',
    'Congé maternité pathologique', 'Proche aidant puis arrêt maladie', 'Accident de trajet', 'Congé parental, puis ALD']) {
    assert.equal(motifRepriseDuTexte(t), 'absence longue', t);
  }
  assert.equal(motifRepriseDuTexte('Congé parental à temps partiel'), 'temps partiel parental');
  assert.equal(motifRepriseDuTexte('Congé parental d’éducation'), 'congé parental d’éducation');
  assert.equal(motifRepriseDuTexte('Congé de proche aidant'), 'congé de proche aidant');
  assert.equal(motifRepriseDuTexte('Temps partiel choisi'), 'absence longue', 'temps partiel sans congé parental : hors liste');
  const { db, RH } = fresh();
  db.sql.prepare('UPDATE employes SET reprise_motif = ?, reprise_date = ? WHERE id = ?').run('Chimiothérapie', '2026-09-01', 2);
  db.sql.prepare('UPDATE employes SET reprise_motif = ?, reprise_date = ? WHERE id = ?').run('congé parental', '2026-09-01', 6);
  db.sql.prepare('UPDATE employes SET reprise_motif = ?, reprise_date = ? WHERE id = ?').run('Temps partiel thérapeutique', '2026-09-14', 18);
  let sauvegarde = 0;
  motifsDeReprise(db, () => { sauvegarde++; });
  const fiches = loadFull(db, RH).employes;
  assert.equal(sauvegarde, 1, 'copie de la base avant la migration');
  assert.equal(fiches.find(e => e.id === 2)!.repriseMotif, 'absence longue');
  assert.equal(fiches.find(e => e.id === 6)!.repriseMotif, 'congé parental d’éducation');
  assert.ok(fiches.every(e => !e.repriseMotif || estMotifReprise(e.repriseMotif)));
  assert.equal((db.sql.prepare(`SELECT COUNT(*) AS n FROM employes WHERE reprise_motif LIKE '%Chimio%'`).get() as { n: number }).n, 0);
  assert.equal(fiches.find(e => e.id === 18)!.repriseMotif, 'absence longue');
  // Reprise d'un arrêt devenu « absence longue » : masquée au manager, comme un arrêt longue maladie.
  const equipe = buildSnapshot(db, { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' }).employes;
  for (const id of [2, 18]) {
    const e = equipe.find(x => x.id === id)!;
    assert.deepEqual([e.repriseMotif, e.repriseDate], [null, null], e.nom);
  }
  // Rien à faire au démarrage suivant.
  motifsDeReprise(db, () => { sauvegarde++; });
  assert.equal(sauvegarde, 1);
});

test('vaccinations : vaccin et date d’injection au service RH et à l’intéressé seulement', () => {
  const { db, user, RH } = fresh();
  const vaccins = (u: User, empId: number) => buildSnapshot(db, u).employes.find(e => e.id === empId)?.vaccins ?? [];
  const complet = loadFull(db, RH).employes.find(e => e.id === 2)!.vaccins;
  assert.ok(complet.length > 0 && complet.every(v => v.v && v.date), 'tous les vaccins, avec leur date');
  assert.deepEqual(vaccins(RH, 2), complet, 'administratrice RH');
  assert.deepEqual(vaccins(user(14, 'rh'), 2), complet, 'gestionnaire RH');
  assert.deepEqual(vaccins(user(2, 'collaborateur'), 2), complet, 'l’intéressé');
  for (const [label, u] of [['référente HSE', user(23, 'rh')], ['paie', user(7, 'rh')], ['lecture seule', user(11, 'rh')], ['manager', user(12, 'manager')]] as const) {
    const ds = buildSnapshot(db, u);
    assert.ok(ds.employes.filter(e => e.id !== u.salarieId || u.role === 'rh').every(e => e.vaccins.length === 0), label);
    assert.ok(!ds.demandesCollab.some(r => r.declaration?.kind === 'vaccin' && r.empId !== u.salarieId), `${label} : aucune déclaration de vaccination`);
  }
  assert.ok(vaccins(user(12, 'manager'), 12).length > 0, 'le manager garde ses propres vaccinations');
});

test('information art. 13 du RGPD avant la saisie d’une vaccination : éléments obligatoires', () => {
  const rubriques = INFO_VACCINATIONS.points.map(([k]) => k);
  for (const r of ['Responsable', 'Finalité', 'Base légale', 'Destinataires', 'Conservation', 'Vos droits']) assert.ok(rubriques.includes(r), r);
  const texte = INFO_VACCINATIONS.points.map(([, v]) => v).join(' ');
  assert.match(texte, /service RH seulement/);
  assert.match(texte, /CNIL/);
  assert.match(texte, /9\.2\.b du RGPD/);
  // Conservation : la règle réellement appliquée (aucune purge ; déclarations et journal gardent les injections
  // antérieures), la durée restant à fixer par le DPO — rien de ce que l'outil ne fait pas.
  const conservation = INFO_VACCINATIONS.points.find(([k]) => k === 'Conservation')![1];
  assert.doesNotMatch(conservation, /pendant votre contrat|remplace la précédente/);
  assert.match(conservation, /délégué à la protection des données/);
  assert.match(conservation, /rien n’est encore effacé automatiquement/);
  assert.match(conservation, /déclarations successives et le journal des actions gardent les précédentes/);
});
