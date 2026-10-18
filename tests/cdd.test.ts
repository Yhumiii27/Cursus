// CDD et intérim (t053) : motif de recours, durée maximale renouvellements compris et nombre de renouvellements selon le
// motif et les réglages (accord de branche), fin repoussée sans renouvellement, renouvellement d'un CDD (historique des
// contrats, journal sans texte libre), délai de carence avant un nouveau contrat sur le même poste. Tout en avertissement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { carences, carenceTexte, controleCdd, dureeMaxCdd, MOTIFS_RECOURS, renouvellementsMax } = await import('../shared/rules/cdd.ts');
const { profilOf, validerProfil } = await import('../shared/rules/profil.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Employe = import('../shared/types.ts').Employe;

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get<Compte>('comptes', u.compteId!)!, message: o.message ?? null, result: o.result });
    return o as { message: string | null; result?: any };
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : ${re}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  return { db, user, run, refus, RH, domain };
}

const LOI = { cddRenouvellementsMax: 2, cddDureeMaxMois: 0, cddAccordBranche: '' };
const cdd = (o: Partial<Parameters<typeof controleCdd>[0]> = {}) => ({ typeContrat: 'cdd' as const, entree: '2026-01-05', fin: '2026-12-31', motifRecours: 'accroissement', ...o });

test('t053 durée maximale et renouvellements selon le motif (loi), avertissements sans blocage', () => {
  // 18 mois pour un accroissement d'activité : jusqu'au 4 juillet 2027 pour une entrée le 5 janvier 2026.
  assert.deepEqual(controleCdd(cdd({ fin: '2027-07-04' }), { renouvellements: 2, reglages: LOI }), { errors: [], warnings: [] });
  const long = controleCdd(cdd({ fin: '2027-07-05' }), { renouvellements: 2, reglages: LOI });
  assert.equal(long.errors.length, 0);
  assert.match(long.warnings[0], /^Durée du CDD au-delà du maximum, renouvellements compris \(18 mois pour ce motif, art\. L1242-8-1\) : le 4 juil\. 2027 au plus tard\./);
  // 9 mois en attente d'un salarié recruté en CDI (terme imprécis possible, rappelé) ; 36 mois et un seul renouvellement pour un CDD senior.
  assert.match(controleCdd(cdd({ motifRecours: 'attente_cdi', fin: '2026-10-05' }), { renouvellements: 0, reglages: LOI }).warnings[0], /9 mois pour ce motif.*terme imprécis/);
  assert.deepEqual(dureeMaxCdd('senior', LOI), { mois: 36, texte: '36 mois pour ce motif, art. L1242-8-1' });
  assert.match(controleCdd(cdd({ motifRecours: 'senior' }), { renouvellements: 2, reglages: LOI }).warnings[0], /^2 renouvellements pour 1 admis \(art\. D1242-7\)/);
  assert.match(controleCdd(cdd(), { renouvellements: 3, reglages: LOI }).warnings[0], /^3 renouvellements pour 2 admis \(art\. L1243-13-1\) : le contrat peut être requalifié/);
  // Emploi saisonnier ou d'usage : aucune durée maximale légale.
  assert.equal(dureeMaxCdd('saisonnier_usage', LOI), null);
  assert.deepEqual(controleCdd(cdd({ motifRecours: 'saisonnier_usage', fin: '2029-01-01' }), { renouvellements: 0, reglages: LOI }).warnings, []);
  // Motif manquant : rappel ; motif inconnu, terme initial incohérent : bloquants.
  assert.deepEqual(controleCdd(cdd({ motifRecours: null }), { renouvellements: 0, reglages: LOI }).warnings, ['Motif de recours du CDD à renseigner : il est écrit au contrat (art. L1242-2 et L1242-12).']);
  assert.deepEqual(controleCdd(cdd({ motifRecours: 'pour voir' }), { renouvellements: 0, reglages: LOI }).errors, ['Motif de recours à choisir dans la liste.']);
  assert.deepEqual(controleCdd(cdd({ cddFinInitiale: '2027-02-01' }), { renouvellements: 0, reglages: LOI }).errors, ['Le terme initial du CDD dépasse sa fin actuelle.']);
  // Intérim : motif facultatif, contrôlé seulement s'il est donné ; CDI : rien.
  assert.deepEqual(controleCdd({ typeContrat: 'interim', entree: '2026-01-05', fin: null }, { renouvellements: 0, reglages: LOI }), { errors: [], warnings: [] });
  assert.deepEqual(controleCdd({ typeContrat: 'interim', entree: '2026-01-05', fin: null, motifRecours: 'x' }, { renouvellements: 0, reglages: LOI }).errors, ['Motif de recours à choisir dans la liste.']);
  assert.deepEqual(controleCdd({ typeContrat: 'cdi', entree: '2026-01-05', fin: null }, { renouvellements: 9, reglages: LOI }), { errors: [], warnings: [] });
  // Sortie enregistrée : la fin n'est plus le terme, ni durée ni renouvellements contrôlés.
  assert.deepEqual(controleCdd(cdd({ fin: '2029-01-01' }), { renouvellements: 5, reglages: LOI, sortie: true }).warnings, []);
  assert.equal(Object.keys(MOTIFS_RECOURS).length, 9);
});

test('t053 accord de branche : durée et renouvellements réglés, référence exigée (Paramètres → Contrats)', () => {
  const accord = { cddRenouvellementsMax: 3, cddDureeMaxMois: 24, cddAccordBranche: 'Accord de branche du 1er mars 2026' };
  assert.deepEqual(dureeMaxCdd('accroissement', accord), { mois: 24, texte: '24 mois, accord de branche : Accord de branche du 1er mars 2026' });
  assert.deepEqual(renouvellementsMax('accroissement', accord), { n: 3, texte: 'accord de branche : Accord de branche du 1er mars 2026' });
  assert.deepEqual(controleCdd(cdd({ fin: '2027-07-05' }), { renouvellements: 3, reglages: accord }).warnings, []);
  // Une valeur autre que celle de la loi sans la référence de l'accord : refusée, rien n'est enregistré.
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { cddRenouvellementsMax: 3 }), (e: unknown) => e instanceof ReglageInvalide && /accord de branche étendu/.test(e.message));
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { cddDureeMaxMois: 24 }), ReglageInvalide);
  const s = appliquerReglages(DEFAULT_SETTINGS, accord);
  assert.deepEqual([s.cddRenouvellementsMax, s.cddDureeMaxMois, s.cddAccordBranche], [3, 24, 'Accord de branche du 1er mars 2026']);
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { cddRenouvellementsMax: 99, cddAccordBranche: 'x' }).cddRenouvellementsMax, 6, 'borné');
});

test('t053 fiche : motif rappelé tant qu’il manque, fin repoussée sans renouvellement signalée', () => {
  const { run, RH, domain } = fresh();
  const d = domain(), lucas = d.emp(4)!;
  const opts = { equipes: d.equipes, year: 2026, cdd: { renouvellements: 1, finEnregistree: lucas.fin, reglages: d.ds.settings } };
  assert.ok(!validerProfil(profilOf(lucas), opts).warnings.some(w => /Motif de recours/.test(w)), 'motif renseigné');
  assert.ok(validerProfil({ ...profilOf(lucas), motifRecours: null }, opts).warnings.includes('Motif de recours du CDD à renseigner : il est écrit au contrat (art. L1242-2 et L1242-12).'));
  // Motif et terme initial vidés pour un autre contrat que le CDD (intérim : motif seul).
  const cdi = validerProfil({ ...profilOf(lucas), typeContrat: 'cdi', fin: null }, opts).profil;
  assert.deepEqual([cdi.motifRecours, cdi.cddFinInitiale], [null, null]);
  // Fin repoussée directement dans la fiche : enregistrée, avec le rappel du renouvellement.
  const o = run(RH, 'employe.modifier', { id: 4, fin: '2027-03-31' });
  assert.match(o.message!, /Fin du CDD repoussée du 29 janv\. 2027 au 31 mars 2027 sans renouvellement : enregistrez plutôt un renouvellement/);
  // Création d'un CDD : terme initial pris de la fin saisie, embauche inscrite dans l'historique.
  const c = run(RH, 'employe.creer', {
    ...profilOf(lucas), nom: 'Inès Garcia', matriculePaie: null, email: null, naissanceLe: '1998-04-02', typeContrat: 'cdd', entree: '2026-11-02', fin: '2027-04-30', cddFinInitiale: null, motifRecours: 'remplacement',
  });
  const id = c.result.id as number;
  const d1 = domain(), ines = d1.emp(id)!;
  assert.deepEqual([ines.cddFinInitiale, ines.motifRecours], ['2027-04-30', 'remplacement']);
  const [l] = (d1.ds.contratsHistorique ?? []).filter(x => x.empId === id);
  assert.deepEqual([l.nature, l.effet, l.jusquau, l.par], ['embauche', '2026-11-02', '2027-04-30', 'Sandrine Vidal']);
});

test('t053 renouvellement d’un CDD : historique, terme initial gardé, compte des renouvellements, journal sans texte libre', () => {
  const { db, run, refus, RH, user, domain } = fresh();
  // Lucas Martin : CDD du 2 février 2026, terme initial 31 juillet, déjà renouvelé jusqu'au 29 janvier 2027.
  const o = run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-07-30', signeLe: '2026-10-09', reference: 'Avenant n° 2' });
  assert.equal(o.message, 'CDD de Lucas Martin renouvelé jusqu’au 30 juil. 2027 (2 renouvellements)');
  const e = db.get<Employe>('employes', 4)!;
  assert.deepEqual([e.fin, e.cddFinInitiale], ['2027-07-30', '2026-07-31']);
  const lignes = db.where<{ nature: string; effet: string; jusquau: string; signeLe: string; reference: string }>('contratsHistorique', 'empId', 4).filter(l => l.nature === 'renouvellement');
  assert.deepEqual(lignes.map(l => [l.effet, l.jusquau]), [['2026-08-01', '2027-01-29'], ['2027-01-30', '2027-07-30']]);
  const j = db.all<{ action: string; payload: Record<string, any>; salaries: number[]; paie: boolean }>('journal').findLast(x => x.action === 'employe.renouvelerCdd')!;
  assert.deepEqual([j.payload.jusquau, j.payload.signeLe, j.payload.reference, j.payload.renouvellements, j.salaries], ['2027-07-30', '2026-10-09', '[texte renseigné]', 2, [4]]);
  assert.deepEqual(j.payload.apres, { fin: '2027-07-30' });
  assert.ok(j.paie, 'archive paie');
  assert.ok(!JSON.stringify(j.payload).includes('Avenant n° 2'), 'référence jamais recopiée');
  // Troisième renouvellement au-delà de 18 mois : enregistré, avec les avertissements.
  const t = run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-09-30' });
  assert.match(t.message!, /3 renouvellements\) · Durée du CDD au-delà du maximum.*le 1 août 2027 au plus tard.* · 3 renouvellements pour 2 admis/);
  // Échéance « Fin de CDD » au nouveau terme.
  const d = domain();
  assert.ok(d.echeances(d.enrich(400, false), 400).some(x => x.kind === 'contrat' && x.emp.id === 4 && x.label === 'Fin de CDD' && x.exp.getTime() === new Date(2027, 8, 30).getTime()));
  // Refus : autre contrat, terme qui ne suit pas la fin, signature future ou après une sortie enregistrée, hors du service RH.
  refus(RH, 'employe.renouvelerCdd', { id: 2, jusquau: '2027-01-01' }, /Seul un CDD se renouvelle/);
  refus(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-09-30' }, /Le nouveau terme doit suivre la fin actuelle du contrat \(30 sept\. 2027\)/);
  refus(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-12-31', signeLe: '2026-10-11' }, /Date de signature future/);
  refus(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-12-31', reference: 'x'.repeat(61) }, /60 caractères au plus/);
  refus(user(12, 'manager'), 'employe.renouvelerCdd', { id: 4, jusquau: '2027-12-31' }, /réservée au service RH/, 403);
  run(RH, 'employe.sortie', { id: 4, date: '2026-12-31', motif: 'fin_cdd' });
  refus(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-12-31' }, /Sortie enregistrée le 31 déc\. 2026 : annulez-la d’abord/);
});

test('t053 terme passé : plus de renouvellement (contrat devenu CDI s’il s’est poursuivi, ou nouvelle fiche)', () => {
  const { db, run, refus, RH } = fresh();
  db.update('employes', 4, { fin: '2026-10-09' });
  refus(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-01-29' }, /Contrat terminé le 9 oct\. 2026 : un renouvellement se signe avant le terme.*CDI \(art\. L1243-11\)/);
  // Terme du jour : renouvelable, avenant signé au plus tard aujourd'hui.
  db.update('employes', 4, { fin: '2026-10-10' });
  assert.match(run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-01-29' }).message!, /renouvelé jusqu’au 29 janv\. 2027/);
});

test('t053 délai de carence : même poste ou même titulaire, tiers de la durée, exceptions', () => {
  const { db, run, RH, domain } = fresh();
  // Le CDD de Lucas Martin s'est terminé le 2 octobre (243 jours) : 81 jours d'ouverture de carence sur son poste.
  db.update('employes', 4, { fin: '2026-10-02', motifSortie: 'fin_cdd', finPrevue: '2027-01-29' });
  const d = domain(), lucas = d.emp(4)!;
  const nouveau = { nom: 'Inès Garcia', typeContrat: 'cdd' as const, entree: '2026-10-12', fin: '2027-03-31', posteId: lucas.posteId, motifRecours: 'accroissement' };
  const [c] = carences(d.ds.employes, nouveau);
  assert.deepEqual([c.empId, c.duree, c.delai, c.meme, c.possibleLe], [4, 243, 81, 'poste', '2027-01-29']);
  assert.match(carenceTexte(c), /^Délai de carence non écoulé : le poste était pourvu par Lucas Martin jusqu’au 2 oct\. 2026 \(243 jours, renouvellements compris\)\. Délai de 81 jours d’ouverture \(tiers/);
  // Remplacement d'un salarié absent, emploi saisonnier : aucune carence ; entrée après le délai : rien ; CDI : rien.
  assert.deepEqual(carences(d.ds.employes, { ...nouveau, motifRecours: 'remplacement' }), []);
  assert.deepEqual(carences(d.ds.employes, { ...nouveau, entree: '2027-01-29' }), []);
  assert.deepEqual(carences(d.ds.employes, { ...nouveau, typeContrat: 'cdi' }), []);
  // Même titulaire, sur un autre poste (matricule de paie réutilisé) ; contrat de moins de 14 jours : la moitié.
  assert.equal(carences(d.ds.employes, { ...nouveau, posteId: null, matriculePaie: lucas.matriculePaie })[0].meme, 'titulaire');
  const court = carences([{ ...lucas, entree: '2026-09-21', fin: '2026-10-02' }], { ...nouveau, entree: '2026-10-05' })[0];
  assert.deepEqual([court.duree, court.delai], [12, 6]);
  // À la création de la fiche : avertissement dans le message, la fiche est créée.
  const o = run(RH, 'employe.creer', {
    ...profilOf(lucas), nom: 'Inès Garcia', matriculePaie: null, email: null, naissanceLe: '1998-04-02', motifSortie: null, finPrevue: null, entree: '2026-10-12', fin: '2027-03-31',
    motifRecours: 'accroissement', cddFinInitiale: null,
  });
  assert.match(o.message!, /^Fiche créée — Inès Garcia · équipe Logistique · Délai de carence non écoulé/);
});
