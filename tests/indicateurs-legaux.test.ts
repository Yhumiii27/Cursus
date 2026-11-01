// Lot 11, chantier C3 (t197), étape 1 : règles des indicateurs sociaux légaux (shared/rules/indicateurs-legaux.ts), testées
// par valeurs sur un jeu construit à la main, et masquage au seuil d'anonymat :
// - présence (entrée ≤ date ≤ fin), l'année civile pour seule période, ETP, effectifs de fin de période, moyen (Sécurité sociale) et
//   au sens du Code du travail (L1111-2, L1111-3) ;
// - entrées, sorties, fins de contrat prévues, taux de rotation ;
// - absentéisme compté dans les jours ouvrés théoriques du régime (temps partiel, férié, arrêt en jours calendaires) ;
// - formation, âges, préparation de l'index ;
// - masquer : masque primaire, secondaire (ligne, colonne, total, groupes explicites, cases liées et dérivées), propriété
//   sur des tableaux tirés au hasard ; recoupements par différence dans une ligne (motifs d'absence et taux, taux de
//   rotation et sorties) et entre tableaux d'une même réponse (détail de la santé et tableau principal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const L = await import('../shared/rules/indicateurs-legaux.ts');
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Employe = Dataset['employes'][number];
type Absence = Dataset['absences'][number];
type Tableau = import('../shared/rules/indicateurs-legaux.ts').TableauIndicateur;
type CaseBrute = import('../shared/rules/indicateurs-legaux.ts').CaseBrute;

const ADMIN = { role: 'rh' as const, empId: null, nom: 'Sandrine Vidal', intitule: '', profilRh: 'rh_admin' as const };
const base = await (async () => { const db = await nouvelleBase(); await seedDemo(db); return await loadFull(db, ADMIN); })();

/** Fiche construite d'après une fiche de démonstration, sans titres ni dossier médical. */
const modele = base.employes[0];
const emp = (id: number, o: Partial<Employe>): Employe => ({
  ...modele, id, nom: `Salarié ${id}`, equipe: 'Atelier', poste: 'Opérateur', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', heures: null,
  forfaitHeures: null, forfaitJours: null, jourOff: [], tempsDepuis: null, entree: '2020-01-01', fin: null, motifSortie: null, motifRecours: null,
  naissance: 1980, naissanceLe: null, sexe: 'F', categorie: 'ouvrier', certs: [], certsAnnulees: [], habs: [], visas: [], vaccins: [], ...o,
});
const cert = (id: number, f: string, obtenue: string) => ({ ...base.employes.flatMap(e => e.certs)[0], id, f, obtenue, sessionId: null });
let n = 0;
const absence = (empId: number, type: string, du: string, au: string, statut = 'validee'): Absence =>
  ({ ...base.absences[0], id: ++n, empId, type, du, au, statut } as Absence);

// Jeu de 2025 :
//   1 F CDI 35 h · 2 F CDI temps partiel 28 h, vendredi non travaillé · 3 M cadre forfait jours (218)
//   4 M CDD (accroissement) du 01/07 au 31/12, sans sortie enregistrée · 5 M CDD de remplacement du 01/01 au 31/03
//   6 F alternance · 7 M intérim en juin · 8 F entrée en 2026 · 9 M démission au 30/04
const EMPLOYES: Employe[] = [
  emp(1, { naissance: 1980, certs: [cert(9001, 'sst', '2025-03-01')] }),
  emp(2, { temps: 'partiel', heures: 28, jourOff: [4], naissance: 1990, categorie: 'employe', certs: [cert(9002, 'caces489', '2025-05-12')] }),
  emp(3, { sexe: 'M', statut: 'cadre', categorie: 'cadre', temps: 'forfait_jours', forfaitJours: 218, naissance: 1970, certs: [cert(9003, 'inconnue', '2025-09-15')] }),
  emp(4, { sexe: 'M', typeContrat: 'cdd', motifRecours: 'accroissement', entree: '2025-07-01', fin: '2025-12-31', naissance: 2002 }),
  emp(5, { sexe: 'M', typeContrat: 'cdd', motifRecours: 'remplacement', entree: '2025-01-01', fin: '2025-03-31', naissance: 1985 }),
  emp(6, { typeContrat: 'alternance', entree: '2024-09-01', fin: '2026-08-31', naissance: 2005 }),
  emp(7, { sexe: 'M', typeContrat: 'interim', agence: 'Agence', entree: '2025-06-01', fin: '2025-06-30', naissance: 1999 }),
  emp(8, { entree: '2026-01-05', naissance: 1995 }),
  emp(9, { sexe: 'M', entree: '2018-03-01', fin: '2025-04-30', motifSortie: 'demission', naissance: 1975 }),
];
const ABSENCES: Absence[] = [
  absence(1, 'MALADIE', '2025-01-06', '2025-01-12'),
  absence(5, 'AT', '2025-01-13', '2025-01-14'),
  absence(6, 'SANS_SOLDE', '2025-01-20', '2025-01-20'),
  absence(9, 'CP', '2025-01-21', '2025-01-22'),
  absence(2, 'ENFANT_MALADE', '2025-01-09', '2025-01-10'),
  absence(3, 'ABSENCE', '2025-01-27', '2025-01-27', 'signalee'),
  absence(1, 'MALADIE', '2025-01-28', '2025-01-28', 'demandee'),
  absence(2, 'MATERNITE', '2025-02-01', '2025-05-23'),
];
const ds: Dataset = {
  ...base, employes: EMPLOYES, absences: ABSENCES, participations: [], sessions: [], inscriptions: [], formationsSuivies: [], contratsHistorique: [], calendrierFeries: {},
};
const d = new Domain(ds);
const calcul = (periode: import('../shared/rules/indicateurs-legaux.ts').PeriodeIndicateurs, groupe: import('../shared/rules/indicateurs-legaux.ts').GroupeIndicateurs, annee = 2025) =>
  L.indicateursLegaux(d, { annee, periode, groupe, seuil: 3, natures: L.NATURES_ABSENTEISME_DEFAUT })!;
const tab = (r: ReturnType<typeof calcul>, id: string) => r.tableaux.find(t => t.id === id)!;
/** Valeurs (null : masquée) d'un tableau. */
const valeurs = (t: Tableau) => t.cases.map(l => l.map(c => c.valeur));
const masques = (t: Tableau) => t.cases.map(l => l.map(c => c.masque));

/** Aucun groupe additif (ligne, colonne avec son total) n'a une seule case masquée. */
function sansDifference(t: { cases: { masque: boolean }[][] }, o: { totalLigne?: boolean; totalColonne?: boolean }) {
  const nl = t.cases.length, nc = t.cases[0].length;
  if (o.totalLigne) for (let j = 0; j < nc; j++) assert.notEqual(t.cases.filter(l => l[j].masque).length, 1, `colonne ${j}`);
  if (o.totalColonne) for (let i = 0; i < nl; i++) assert.notEqual(t.cases[i].filter(c => c.masque).length, 1, `ligne ${i}`);
}

test('présence à une date : entrée au plus tard ce jour, contrat non terminé', () => {
  assert.equal(L.presentA({ entree: '2026-11-02', fin: null }, '2026-10-10'), false, 'embauche à venir : pas encore dans l’effectif');
  assert.equal(L.presentA({ entree: '2026-10-10', fin: null }, '2026-10-10'), true);
  assert.equal(L.presentA({ entree: '2020-01-01', fin: '2026-10-10' }, '2026-10-10'), true, 'dernier jour compris');
  assert.equal(L.presentA({ entree: '2020-01-01', fin: '2026-10-09' }, '2026-10-10'), false);
});

test('période imposée : l’année civile seulement (trimestres et mois se recouperaient avec elle) ; fins de mois', () => {
  assert.deepEqual(L.bornesPeriode(2026, 'annee'), { du: '2026-01-01', au: '2026-12-31', libelle: 'Année 2026' });
  // Un mois masqué se retrouverait en retranchant de l'année les onze autres, visibles : ni trimestre ni mois.
  for (const p of ['T1', 'T4', '01', '12', 'T5']) assert.equal(L.bornesPeriode(2026, p as never), null, p);
  assert.equal(L.bornesPeriode(1999, 'annee'), null);
  assert.equal(L.bornesPeriode(2026.5, 'annee'), null);
  assert.deepEqual(L.finsDeMois('2026-11-01', '2027-01-31'), ['2026-11-30', '2026-12-31', '2027-01-31']);
  assert.deepEqual(L.finsDeMois('2026-01-15', '2026-02-27'), ['2026-01-31'], 'mois incomplet en fin de période : sans sa fin');
  assert.ok(L.estPeriodeIndicateurs('annee') && !L.estPeriodeIndicateurs('09') && !L.estPeriodeIndicateurs('T3') && !L.estPeriodeIndicateurs('2026-09-01') && !L.estPeriodeIndicateurs(3));
  assert.ok(L.estGroupeIndicateurs('equipe') && !L.estGroupeIndicateurs('site') && !L.estGroupeIndicateurs('constructor'));
});

test('sexe et catégorie : listes fermées, catégorie proposée d’après le statut, modalités des groupements', () => {
  assert.ok(L.estSexe('F') && L.estSexe('M') && !L.estSexe('X') && !L.estSexe(null));
  assert.ok(L.estCategorieEmploi('tam') && !L.estCategorieEmploi('technicien'));
  assert.deepEqual(['ouvrier', 'technicien', 'cadre'].map(s => L.categorieProposee(s as never)), [null, 'tam', 'cadre']);
  const e = emp(50, { sexe: null, categorie: null, equipe: null, statut: 'technicien', typeContrat: 'cdd' });
  assert.deepEqual((Object.keys(L.GROUPES_INDICATEURS) as (keyof typeof L.GROUPES_INDICATEURS)[]).map(g => L.modaliteDe(e, g)),
    ['Ensemble', 'Non renseigné', 'Non renseigné', 'Technicien / agent de maîtrise', 'CDD', 'À affecter']);
  assert.deepEqual([L.modaliteDe(EMPLOYES[0], 'sexe'), L.modaliteDe(EMPLOYES[2], 'categorie')], ['Femmes', 'Ingénieurs et cadres']);
});

test('ETP au régime en vigueur : temps partiel, forfait jours, forfait annuel, plein temps', () => {
  assert.equal(L.etpA(d, EMPLOYES[1], '2025-06-30'), 0.8);
  assert.equal(L.etpA(d, emp(51, { temps: 'forfait_jours', forfaitJours: 109, statut: 'cadre' }), '2025-06-30'), 0.5);
  assert.equal(L.etpA(d, emp(52, { temps: 'forfait_heures_annuel', forfaitHeures: 1607 }), '2025-06-30'), 1);
  assert.equal(L.etpA(d, emp(53, { temps: '39h_rtt' }), '2025-06-30'), 1);
});

test('effectifs 2025 : fin de période, moyen (Sécurité sociale), ETP, Code du travail, intérim', () => {
  const r = calcul('annee', 'aucun');
  const t = tab(r, 'effectifs');
  assert.deepEqual(t.lignes, ['Ensemble']);
  // Fin : 1, 2, 3, 4 et l'alternant 6 (ni l'intérimaire, ni l'embauche de 2026, ni la démission d'avril).
  // Moyen : 6 présents de janvier à mars, 5 en avril, 4 en mai et juin, 5 de juillet à décembre → 61 / 12.
  // ETP : 1 + 0,8 + 1 + 1 + 1. L1111-2 : sans l'alternant ni le CDD de remplacement, intérimaire compté en juin → 44,6 / 12.
  // Intérim : un seul intérimaire, case masquée (seuil 3).
  assert.deepEqual(valeurs(t), [[5, 5.08, 4.8, 3.72, null]]);
  assert.match(t.definition, /L130-1 du CSS/);
  assert.match(t.definition, /L1111-2 et L1111-3/);
  assert.equal(t.completude, 100);
  // Par sexe (seuil 3) : 2 hommes en fin de période, masqués, et les femmes avec eux (le total les révélerait) ; la colonne
  // du Code du travail ne compte que 2 femmes (sans l'alternante) : masquée, les hommes avec elle ; total d'intérim
  // masqué (une personne). Fin de période, moyen, ETP et Code du travail d'une ligne se confondent souvent (effectif
  // stable à temps plein) : masqués ensemble.
  const s = tab(calcul('annee', 'sexe'), 'effectifs');
  assert.deepEqual(s.lignes, ['Femmes', 'Hommes', 'Non renseigné', 'Total']);
  assert.deepEqual(masques(s), [
    [true, true, true, true, false],
    [true, true, true, true, true],
    [false, false, false, false, false],
    [false, false, false, false, true],
  ]);
  assert.deepEqual(valeurs(s).map(l => l[1]), [null, null, 0, 5.08]);
  assert.deepEqual(valeurs(s)[3].slice(0, 4), [5, 5.08, 4.8, 3.72]);
  sansDifference(s, { totalLigne: true });
});

test('mouvements 2025 : entrées, sorties enregistrées, fins prévues, taux de rotation, par motif et par contrat', () => {
  const r = calcul('annee', 'aucun');
  const t = tab(r, 'mouvements');
  // 2 entrées (CDD 4 et 5), 1 sortie (démission), 2 fins de contrat prévues sans sortie : toutes sous le seuil ; taux de
  // rotation (2 + 1) / 2 / 5,08 = 29,51 %, porté par 3 mouvements, mais masqué avec les entrées et les sorties : l'effectif
  // moyen est publié, le taux les redonnerait.
  assert.deepEqual(valeurs(t), [[null, null, null, null]]);
  const motifs = tab(r, 'sortiesMotifs');
  assert.equal(motifs.lignes.at(-1), 'Total');
  assert.ok(motifs.cases[motifs.lignes.indexOf('Démission')][0].masque && motifs.cases.at(-1)![0].masque);
  sansDifference(motifs, { totalLigne: true });
  const contrats = tab(r, 'entreesContrats');
  assert.ok(!contrats.lignes.includes('Intérim'), 'intérim à part (effectifs)');
  assert.ok(contrats.cases[contrats.lignes.indexOf('CDD')][0].masque);
});

test('absentéisme 2025 : jours ouvrés théoriques du régime, toutes natures comptées dans ces jours', () => {
  // Janvier : 22 jours ouvrés (1er janvier férié), 17 pour 2 (vendredi non travaillé).
  assert.equal(L.joursTheoriques(d, EMPLOYES[0], '2025-01-01', '2025-01-31').length, 22);
  assert.equal(L.joursTheoriques(d, EMPLOYES[1], '2025-01-01', '2025-01-31').length, 17);
  // L'année : 251 jours ouvrés hors fériés pour un temps plein présent toute l'année.
  assert.equal(L.joursTheoriques(d, EMPLOYES[0], '2025-01-01', '2025-12-31').length, 251);
  assert.equal(L.joursTheoriques(d, EMPLOYES[3], '2025-01-01', '2025-01-31').length, 0, 'entré en juillet');
  // Arrêt maladie du lundi 6 au dimanche 12 (jours calendaires) : 5 jours ouvrés ; enfant malade jeudi et vendredi non
  // travaillé : 1 jour ; congés payés, demande en attente : non comptés.
  const r = calcul('annee', 'aucun');
  const t = tab(r, 'absenteisme');
  // 9 jours d'absence pour 4 personnes sur 1 228 jours théoriques : jours et taux visibles ; chaque motif ne concerne
  // qu'une personne : masqué.
  assert.deepEqual(valeurs(t), [[1228, 9, 0.73, null, null, null, null]]);
  // Complétude : une absence signalée reste à qualifier (sans nature) sur six absences hors congés (maternité comprise).
  assert.equal(t.completude, 83.33);
  assert.match(t.completudeTexte!, /^1 absence à qualifier/);
  assert.match(t.definition, /Arrêt maladie|Maladie/);
  // Détail de la santé : la maladie ne concerne qu'une personne, tout le détail est masqué.
  const sante = tab(r, 'absenteismeSante');
  assert.deepEqual(sante.lignes, ['Arrêt maladie', 'Arrêt longue maladie (ALD)', 'Accident du travail', 'Accident de trajet', 'Maladie professionnelle', 'Total']);
  assert.ok(sante.cases.slice(0, -1).every(l => l[0].masque));
  // Jours d'un salarié : un jour couvert par deux absences comptées ne compte qu'une fois.
  const th = L.joursTheoriques(d, EMPLOYES[0], '2025-01-06', '2025-01-10');
  const jours = L.joursAbsence(th, [absence(1, 'MALADIE', '2025-01-06', '2025-01-08'), absence(1, 'AT', '2025-01-07', '2025-01-09')], new Set(['MALADIE', 'AT']));
  assert.deepEqual([...jours], [['MALADIE', 3], ['AT', 1]]);
  // Natures réglées : sans la maladie, l'arrêt du 6 au 12 ne compte plus.
  const sansMaladie = L.indicateursLegaux(d, { annee: 2025, periode: 'annee', groupe: 'aucun', seuil: 3, natures: ['AT', 'SANS_SOLDE', 'ENFANT_MALADE'] })!;
  assert.equal(tab(sansMaladie, 'absenteisme').cases[0][1].valeur, 4);
});

test('formation 2025 : stagiaires, heures connues, taux d’accès, durées inconnues ; croisement catégorie × sexe', () => {
  const r = calcul('annee', 'aucun');
  const t = tab(r, 'formation');
  // SST 7 h, CACES R489 21 h, formation hors catalogue de durée inconnue : 3 stagiaires, 28 h, 3 / 5,08 = 59,02 %.
  assert.deepEqual(valeurs(t), [[3, 28, 9.33, 59.02, 1]]);
  assert.equal(t.completude, 66.67);
  assert.match(t.completudeTexte!, /1 formation de durée inconnue/);
  const croise = tab(r, 'formationStagiaires');
  assert.deepEqual(croise.colonnes, ['Femmes', 'Hommes', 'Non renseigné', 'Total']);
  assert.equal(croise.cases.at(-1)!.at(-1)!.valeur, 3, 'total général visible');
  sansDifference(croise, { totalLigne: true, totalColonne: true });
  for (const l of tab(r, 'formationHeures').cases) for (const c of l) assert.ok(c.masque || c.valeur === 0 || c.valeur === 28, 'heures masquées avec les stagiaires');
  // Année sans formation : rien, sans division par zéro.
  assert.deepEqual(valeurs(tab(calcul('annee', 'aucun', 2024), 'formation')), [[0, 0, 0, 0, 0]]);
});

test('âges, ancienneté et index 2025 : tranches par sexe masquées, effectifs pris en compte, retours de maternité', () => {
  const r = calcul('annee', 'aucun');
  for (const id of ['ages', 'anciennete']) {
    const t = tab(r, id);
    assert.equal(t.cases.at(-1)!.at(-1)!.valeur, 5);
    for (const l of t.cases) for (const c of l) assert.ok(c.masque || c.valeur === 0 || c.valeur! >= 3, `${id} : aucune case visible sous le seuil`);
    sansDifference(t, { totalLigne: true, totalColonne: true });
  }
  assert.deepEqual(tab(r, 'ages').lignes.slice(0, 2), ['Moins de 25 ans', '25 à 29 ans']);
  // Index : présents six mois au moins, ni alternance ni intérim → 1, 2, 3, 4 (le CDD de remplacement et la démission
  // d'avril n'y sont pas) ; aucun groupe catégorie × âge n'a 3 femmes et 3 hommes.
  const i = r.index;
  assert.equal(i.effectifs.cases.at(-1)!.at(-1)!.valeur, 4);
  assert.deepEqual([i.groupesValides, i.groupes, i.partGroupesValides], [0, 16, 0]);
  assert.deepEqual(i.retoursMaternite, { valeur: null, masque: true }, 'un retour : sous le seuil');
  assert.deepEqual(i.indicateurs.map(x => x.etat), ['hors_cursus', 'hors_cursus', 'partiel', 'hors_cursus']);
  assert.deepEqual(r.avertissements, ['Intérimaires sans fiche dans Cursus non comptés']);
});

test('calcul refusé (période, groupement), seuil borné de 3 à 10, période en cours provisoire, export CSV', () => {
  assert.equal(L.indicateursLegaux(d, { annee: 2025, periode: 'T9' as never, groupe: 'aucun', seuil: 5, natures: [] }), null);
  assert.equal(L.indicateursLegaux(d, { annee: 2025, periode: 'annee', groupe: 'site' as never, seuil: 5, natures: [] }), null);
  assert.equal(L.indicateursLegaux(d, { annee: 2025, periode: 'annee', groupe: 'aucun', seuil: 50, natures: ['XX' as never] })!.seuil, 10);
  assert.equal(L.indicateursLegaux(d, { annee: 2025, periode: 'annee', groupe: 'aucun', seuil: Number.NaN, natures: [] })!.seuil, 5);
  const r = calcul('annee', 'equipe', 2026);
  assert.ok(r.avertissements.includes('Période pas encore terminée : chiffres provisoires'));
  assert.deepEqual(tab(r, 'effectifs').lignes, ['Atelier', 'Total']);
  const lignes = L.lignesCsvIndicateurs(calcul('annee', 'aucun'));
  assert.deepEqual(lignes[0], ['Effectifs', 'Année 2025', 'Ensemble', 'Ensemble', 'Effectif fin de période', '5', '']);
  assert.deepEqual(lignes[1], ['Effectifs', 'Année 2025', 'Ensemble', 'Ensemble', 'Effectif moyen (Sécurité sociale)', '5,08', '']);
  assert.deepEqual(lignes.find(l => l[4] === 'Intérimaires (moyenne)'), ['Effectifs', 'Année 2025', 'Ensemble', 'Ensemble', 'Intérimaires (moyenne)', '', '< 3']);
  assert.deepEqual(lignes.at(-1), ['Retours de congé de maternité ou d’adoption', 'Année 2025', 'Ensemble', 'Ensemble', 'Retours', '', '< 3']);
  assert.ok(lignes.every(l => l.length === L.ENTETE_CSV_INDICATEURS.length));
  // Groupement par sexe avec une fiche sans sexe : complétude et avertissement.
  const sans = new Domain({ ...ds, employes: [...EMPLOYES, emp(10, { sexe: null, categorie: null, entree: '2025-01-01' })] });
  const x = L.indicateursLegaux(sans, { annee: 2025, periode: 'annee', groupe: 'sexe', seuil: 3, natures: [] })!;
  assert.equal(tab(x, 'effectifs').completude, 88.89, '8 fiches sur 9 présentes dans l’année, intérimaire compris');
  assert.equal(tab(x, 'effectifs').completudeTexte, '1 fiche sans sexe');
  assert.ok(x.avertissements.includes('1 fiche sans sexe : comptée « Non renseigné »'));
  assert.ok(x.avertissements.includes('1 fiche sans catégorie d’emploi : comptée « Non renseigné »'));
});

/**
 * Aucune case masquée d'une ligne ne se déduit des autres cases de la même ligne : jours et taux d'absence masqués
 * ensemble ; dans le groupe Maladie + AT/MP + Famille + Autres = taux, jamais une seule case masquée ; taux de rotation
 * masqué dès que les entrées ou les sorties le sont.
 */
function sansDeductionLigne(t: Tableau) {
  for (const [i, l] of t.cases.entries()) {
    if (t.id === 'absenteisme') {
      assert.equal(l[1].masque, l[2].masque, `${t.lignes[i]} : jours et taux d’absence liés`);
      assert.notEqual([3, 4, 5, 6, 2].filter(j => l[j].masque).length, 1, `${t.lignes[i]} : un motif seul masqué se retrouverait par différence`);
    }
    if (t.id === 'mouvements' && (l[0].masque || l[1].masque)) assert.ok(l[3].masque, `${t.lignes[i]} : taux de rotation`);
  }
}

// Jeu de 2025 du constat de relecture : 36 salariés en CDI (30 toute l'année, 6 entrés le 3 mars), 2 sortis le 30 juin ;
// 8 arrêts maladie, 7 congés sans solde, 1 enfant malade (une seule personne, 2 jours).
const GRAND: Employe[] = [
  ...Array.from({ length: 30 }, (_, i) => emp(101 + i, { sexe: i % 2 ? 'M' : 'F', equipe: i % 3 ? 'Atelier' : 'Laboratoire' })),
  ...Array.from({ length: 6 }, (_, i) => emp(131 + i, { sexe: i % 2 ? 'M' : 'F', entree: '2025-03-03' })),
  emp(137, { sexe: 'M', fin: '2025-06-30', motifSortie: 'demission' }),
  emp(138, { sexe: 'F', fin: '2025-06-30', motifSortie: 'licenciement' }),
];
const ABS_GRAND: Absence[] = [
  ...Array.from({ length: 8 }, (_, i) => absence(101 + i, 'MALADIE', '2025-03-10', '2025-03-14')),
  ...Array.from({ length: 7 }, (_, i) => absence(109 + i, 'SANS_SOLDE', '2025-04-07', '2025-04-08')),
  absence(116, 'ENFANT_MALADE', '2025-05-12', '2025-05-13'),
];
const grand = (employes: Employe[], absences: Absence[], groupe: import('../shared/rules/indicateurs-legaux.ts').GroupeIndicateurs, natures = L.NATURES_ABSENTEISME_DEFAUT) =>
  L.indicateursLegaux(new Domain({ ...ds, employes, absences }), { annee: 2025, periode: 'annee', groupe, seuil: 5, natures })!;

test('absentéisme : un motif masqué ne se retrouve pas par différence avec le taux et les autres motifs', () => {
  const t = tab(grand(GRAND, ABS_GRAND, 'aucun'), 'absenteisme');
  const [l] = t.cases;
  // Famille (une personne) masquée ; sans masque secondaire dans la ligne, Taux − Maladie − AT/MP − Autres la redonnait.
  assert.ok(l[5].masque);
  assert.ok(!l[1].masque && !l[2].masque, 'jours et taux d’ensemble visibles (16 personnes)');
  assert.ok(l[6].masque, 'Autres (la plus petite partie non nulle) masquée avec elle');
  assert.ok(!l[3].masque && l[4].valeur === 0, 'Maladie et AT/MP (zéro) visibles');
  sansDeductionLigne(t);
  for (const g of ['sexe', 'categorie', 'equipe', 'statut'] as const) {
    const x = tab(grand(GRAND, ABS_GRAND, g), 'absenteisme');
    sansDeductionLigne(x);
    sansDifference(x, { totalLigne: true });
  }
});

test('mouvements : 6 entrées et 2 sorties, le taux de rotation ne redonne pas les sorties masquées', () => {
  const r = grand(GRAND, ABS_GRAND, 'aucun');
  // Sans masque du taux : S = taux × 2 × effectif moyen (publié) / 100 − entrées.
  assert.deepEqual(valeurs(tab(r, 'mouvements')), [[6, null, 0, null]]);
  assert.ok(tab(r, 'effectifs').cases[0][1].valeur! > 30, 'effectif moyen publié');
  for (const g of ['sexe', 'equipe'] as const) {
    const t = tab(grand(GRAND, ABS_GRAND, g), 'mouvements');
    sansDeductionLigne(t);
    sansDifference(t, { totalLigne: true });
  }
});

test('absentéisme : un accident du travail seul ne se retrouve ni dans la ligne ni par le total du détail de la santé', () => {
  // 12 CDI ; 6 arrêts maladie de 2 jours en mars, un accident du travail du 5 au 16 mai (le 8 mai férié : 9 jours).
  const douze = Array.from({ length: 12 }, (_, i) => emp(201 + i, { sexe: i % 2 ? 'M' : 'F' }));
  const abs = [...Array.from({ length: 6 }, (_, i) => absence(201 + i, 'MALADIE', '2025-03-10', '2025-03-11')), absence(207, 'AT', '2025-05-05', '2025-05-16')];
  const r = grand(douze, abs, 'aucun');
  const t = tab(r, 'absenteisme'), sante = tab(r, 'absenteismeSante');
  assert.deepEqual(t.cases[0].map(c => c.masque), [false, false, false, true, true, false, false], 'AT/MP masqué, Maladie avec lui');
  assert.equal(t.cases[0][1].valeur, 21);
  // Le total du détail de la santé (Maladie + AT/MP) redonnerait AT/MP : masqué avec tout le détail.
  assert.ok(sante.cases.every(l => l[0].masque), 'détail de la santé masqué, total compris');
  sansDeductionLigne(t);
  // Recoupement entre tableaux : un total de la santé visible n'est jamais la somme d'une case masquée du tableau principal.
  for (const g of ['aucun', 'sexe'] as const) {
    const x = grand(douze, abs, g), p = tab(x, 'absenteisme').cases.at(-1)!, st = tab(x, 'absenteismeSante').cases.at(-1)![0];
    if (!st.masque) assert.ok(!p[3].masque && !p[4].masque, g);
  }
  // Natures réglées sur la maladie et l'accident du travail, chacune pour 5 personnes : détail donné, et son total est
  // la somme des taux Maladie et AT/MP visibles du tableau principal.
  const cinq = [...Array.from({ length: 5 }, (_, i) => absence(201 + i, 'MALADIE', '2025-03-10', '2025-03-11')), ...Array.from({ length: 5 }, (_, i) => absence(206 + i, 'AT', '2025-05-05', '2025-05-06'))];
  const v = grand(douze, cinq, 'aucun', ['MALADIE', 'AT']);
  const pv = tab(v, 'absenteisme').cases[0], sv = tab(v, 'absenteismeSante');
  assert.deepEqual(sv.lignes, ['Arrêt maladie', 'Accident du travail', 'Total']);
  assert.ok(sv.cases.every(l => !l[0].masque));
  assert.deepEqual(sv.cases.map(l => l[0].valeur), [pv[3].valeur, pv[4].valeur, pv[3].valeur! + pv[4].valeur!]);
});

test('masquer : primaire sous le seuil, zéro jamais masqué, personnes concernées (n2)', () => {
  const c = (valeur: number, n = valeur, n2?: number): CaseBrute => ({ valeur, n, ...(n2 === undefined ? {} : { n2 }) });
  assert.deepEqual(L.masquer([[c(1)], [c(5)], [c(0)]], 3), [[{ valeur: null, masque: true }], [{ valeur: 5, masque: false }], [{ valeur: 0, masque: false }]]);
  // Taux d'un groupe de 10 personnes dont 2 absentes : masqué ; 0 absente : visible.
  assert.deepEqual(L.masquer([[c(4.5, 10, 2), c(0, 10, 0)]], 3).map(l => l.map(x => x.masque)), [[true, false]]);
  assert.equal(L.sousSeuil(c(3), 3), false);
  assert.deepEqual(L.masquer([], 3), []);
});

test('masquer : secondaire — plus petite partie non nulle, sinon le total, en ligne et en colonne', () => {
  const c = (valeur: number): CaseBrute => ({ valeur, n: valeur });
  const m = (cases: CaseBrute[][], o: Parameters<typeof L.masquer>[2]) => L.masquer(cases, 3, o).map(l => l.map(x => x.masque));
  // Ligne avec son total : B masquée, A (la plus petite non nulle) avec elle, pas le zéro.
  assert.deepEqual(m([[c(0), c(2), c(6), c(4), c(12)]], { totalColonne: true }), [[false, true, false, true, false]]);
  // Une seule partie : le total est masqué avec elle.
  assert.deepEqual(m([[c(2)], [c(2)]], { totalLigne: true }), [[true], [true]]);
  // Total seul masqué (une personne) : une partie l'est avec lui, sinon le total se recalculerait.
  assert.deepEqual(m([[c(0), c(1), c(1)]], { totalColonne: true }), [[false, true, true]]);
  // En cascade : la seconde case masquée d'une ligne en appelle une autre dans sa colonne.
  const t = L.masquer([[c(2), c(5), c(7)], [c(6), c(8), c(14)], [c(8), c(13), c(21)]], 3, { totalLigne: true, totalColonne: true });
  sansDifference({ cases: t }, { totalLigne: true, totalColonne: true });
  assert.ok(t[0][0].masque && t[0][1].masque && t[1][0].masque && t[1][1].masque);
});

test('masquer : propriété sur 300 tableaux tirés au hasard — rien sous le seuil, rien par différence', () => {
  let graine = 20261031;
  const hasard = (max: number) => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % (max + 1); };
  for (let essai = 0; essai < 300; essai++) {
    const nl = 1 + hasard(5), nc = 1 + hasard(4), k = 3 + hasard(7);
    const parts = Array.from({ length: nl }, () => Array.from({ length: nc }, () => hasard(12)));
    const ligne = (l: number[]) => [...l, l.reduce((a, b) => a + b, 0)];
    const cases = [...parts.map(ligne), ligne(parts[0].map((_, j) => parts.reduce((a, l) => a + l[j], 0)))].map(l => l.map(v => ({ valeur: v, n: v })));
    const o = { totalLigne: true, totalColonne: true };
    const r = L.masquer(cases, k, o);
    sansDifference({ cases: r }, o);
    r.forEach((l, i) => l.forEach((x, j) => {
      if (L.sousSeuil(cases[i][j], k)) assert.ok(x.masque, 'case sous le seuil masquée');
      if (!x.masque) assert.equal(x.valeur, cases[i][j].valeur);
    }));
  }
});

test('masquer : propriété sur 300 tableaux à motifs tirés au hasard — groupes explicites, cases liées et dérivées', () => {
  let graine = 20261101;
  const hasard = (max: number) => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % (max + 1); };
  for (let essai = 0; essai < 300; essai++) {
    // Lignes : quatre motifs (personnes concernées), leur total (taux) et une copie liée du total (jours) ; colonne
    // dérivée des deux premiers motifs (comme le taux de rotation). Dernière ligne : total des colonnes.
    const nl = 1 + hasard(4), k = 3 + hasard(7);
    const parts = Array.from({ length: nl }, () => Array.from({ length: 4 }, () => (hasard(2) ? hasard(12) : 0)));
    const ligne = (l: number[]) => { const t = l.reduce((a, b) => a + b, 0); return [...l, t, t, l[0] + l[1]]; };
    const lignes = [...parts.map(ligne), ligne(parts[0].map((_, j) => parts.reduce((a, l) => a + l[j], 0)))];
    const cases = lignes.map(l => l.map(v => ({ valeur: v, n: 40, n2: v })));
    const idx = lignes.map((_, i) => i);
    const o = {
      totalLigne: nl > 0,
      groupes: idx.map(i => [0, 1, 2, 3, 4].map(j => [i, j] as const)),
      lies: idx.map(i => [[i, 4], [i, 5]] as const),
      derives: idx.map(i => ({ cible: [i, 6] as const, sources: [[i, 0], [i, 1]] as const })),
    };
    const r = L.masquer(cases, k, o);
    sansDifference({ cases: r }, { totalLigne: true });
    r.forEach((l, i) => {
      assert.notEqual([0, 1, 2, 3, 4].filter(j => l[j].masque).length, 1, `ligne ${i} : groupe explicite`);
      assert.equal(l[4].masque, l[5].masque, `ligne ${i} : cases liées`);
      if (l[0].masque || l[1].masque) assert.ok(l[6].masque, `ligne ${i} : case dérivée`);
      l.forEach((x, j) => { if (L.sousSeuil(cases[i][j], k)) assert.ok(x.masque, 'case sous le seuil masquée'); });
    });
  }
});

// Étape 2 : échéance agrégée du service RH « N fiches sans sexe ou catégorie » (une seule ligne, écran Échéances).
test('fiche à compléter : présente, hors intérimaires, sans sexe ou sans catégorie', () => {
  const le = '2025-06-15';
  assert.equal(L.aCompleterIndicateurs(emp(20, { sexe: null }), le), true);
  assert.equal(L.aCompleterIndicateurs(emp(21, { categorie: null }), le), true);
  assert.equal(L.aCompleterIndicateurs(emp(22, {}), le), false, 'complète');
  assert.equal(L.aCompleterIndicateurs(emp(23, { sexe: null, typeContrat: 'interim', agence: 'A' }), le), false, 'intérimaire : hors des tableaux par sexe');
  assert.equal(L.aCompleterIndicateurs(emp(24, { sexe: null, entree: '2025-09-01' }), le), false, 'embauche à venir');
  assert.equal(L.aCompleterIndicateurs(emp(25, { sexe: null, fin: '2025-01-31', motifSortie: 'demission' }), le), false, 'sorti');
  // Le jeu de 2025 : la seule fiche présente au 15 juin et incomplète serait comptée une fois, jamais une échéance par fiche.
  assert.equal(EMPLOYES.filter(e => L.aCompleterIndicateurs(e, le)).length, 0);
});
