// Forfait annuel en heures (lot 12, chantier C1, t044, étape 1) : régularisation de fin de période de référence.
// - `cumulAnnuel` corrigé : seules les feuilles décomptées au forfait annuel (régime figé), cumul et cible bornés au début
//   du suivi (avenant en juillet : les heures supplémentaires déjà payées des semaines à 35 h ne comptent pas deux fois) ;
// - règle pure `clotureForfaitHeures`, par valeurs : année complète (CP légaux non déduits, arrêts et demi-journée déduits
//   au forfait divisé par les jours ouvrés théoriques, férié non déduit), tranches à 25 % et 50 %, avenant en juillet (entrée
//   au forfait), avenant qui fait quitter le forfait, entrée, sortie, début du suivi (période partielle), temps partiel
//   annualisé (dixième, tiers avec accord, durée légale atteinte), droits à CP incomplets, blocages ;
// - réglages (COHERENCE), émission, écart d'une nouvelle version, imputation sur le contingent ;
// - actions sur la base de démonstration (deux moteurs) : clôture, lot de paie (rubriques désactivées : à saisir dans Sage,
//   réglées hors fichier), ligne « à revoir » après la réouverture d'une feuille, réouverture après transmission (nouvelle
//   version, écart seul dans un lot correctif), annulation, sortie (lot du solde de sortie), droits de lecture, journal sans
//   heures, lecture incrémentale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { lireBrut, assembler } = await import('../server/src/lecture-brute.ts');
const { appliquerDelta, lireDelta } = await import('../server/src/delta.ts');
const { Domain } = await import('../shared/domain.ts');
const { addD, mondayOf, isFerie } = await import('../shared/dates.ts');
const { cumulAnnuel } = await import('../shared/rules/temps.ts');
const { contingentAnnuel } = await import('../shared/rules/durees.ts');
const { periodeSortie } = await import('../shared/rules/solde-sortie.ts');
const L = await import('../shared/rules/lots-paie.ts');
const F = await import('../shared/rules/forfait-heures.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Employe = Dataset['employes'][number];
type Feuille = Dataset['feuilles'][number];
type Ligne = import('../shared/types.ts').ClotureForfaitHeures;
type Lot = Dataset['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };

/** Cadre au forfait annuel en heures de la démonstration (Élodie Bernard, 1 607 h, entrée en 2022). */
const EMP = 11;
const ANNUEL = { statut: 'cadre', typeContrat: 'cdi', temps: 'forfait_heures_annuel', heures: null, forfaitHeures: 1607, forfaitJours: null, jourOff: [] } as const;
const H35 = { statut: 'cadre', typeContrat: 'cdi', temps: '35h', heures: null, forfaitHeures: null, forfaitJours: null, jourOff: [] } as const;

const base = await (async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  return await loadFull(db, { role: 'rh', empId: null, nom: 'Essai', intitule: 'RH', profilRh: 'rh_admin' });
})();
// Calendrier des fériés de la démonstration posé une fois (isFerie, pour fabriquer les feuilles).
new Domain(base);

let nid = 1;
/** Feuille de la semaine `week` du cadre, heures du lundi au dimanche, régime figé `contrat`. */
const feuille = (week: string, h: number[], contrat: Record<string, unknown> = ANNUEL, statut = 'validee'): Feuille => ({
  id: nid++, empId: EMP, week, statut, comment: null, sage: true, keystone: false, contrat, lignes: [{ projet: 'INT-LOG', tache: 'Logistique', ks: false, h }],
} as unknown as Feuille);
/**
 * Feuilles de `du` à `au` : `h` heures chaque jour ouvré non férié (heures d'un jour donné par `jour`), rien ailleurs ; une
 * semaine sans aucune heure n'a pas de feuille (congés, fériés). Une feuille par semaine, comme dans l'application ; régime
 * figé `contrat`, ou celui que la fonction rend pour le lundi de la semaine (avenant en milieu de semaine).
 */
function feuilles(du: string, au: string, h: number, contrat: Record<string, unknown> | ((lundi: string) => Record<string, unknown>) = ANNUEL, jour: (j: string) => number | null = () => null): Feuille[] {
  const out: Feuille[] = [];
  for (let w = mondayOf(du); w <= au; w = addD(w, 7)) {
    const hs = Array.from({ length: 7 }, (_, i) => { const j = addD(w, i); return j < du || j > au || i >= 5 || isFerie(j) ? 0 : jour(j) ?? h; });
    if (hs.some(x => x > 0)) out.push(feuille(w, hs, typeof contrat === 'function' ? contrat(w) : contrat));
  }
  return out;
}
const absence = (type: string, du: string, au: string, o: Record<string, unknown> = {}) => ({ id: nid++, empId: EMP, type, du, au, statut: 'validee', ...o });
/** Domaine d'essai : le cadre seul en feuilles et absences, réglages et historique au choix, jour d'essai le 20 janvier 2028. */
function domaine(o: { employe?: Partial<Employe>; feuilles?: Feuille[]; absences?: unknown[]; historique?: unknown[]; settings?: Record<string, unknown>; today?: string; lignes?: Ligne[] } = {}) {
  const e = { ...base.employes.find(x => x.id === EMP)!, entree: '2022-09-05', fin: null, tempsDepuis: null, ...ANNUEL, ...o.employe } as Employe;
  return new Domain({
    ...base, today: o.today ?? '2028-01-20', employes: base.employes.map(x => (x.id === EMP ? e : x)), feuilles: o.feuilles ?? [], absences: (o.absences ?? []) as Dataset['absences'],
    contratsHistorique: (o.historique ?? []) as Dataset['contratsHistorique'], cloturesForfaitHeures: o.lignes ?? [],
    settings: { ...base.settings, forfaitHeuresDebutSuivi: '2027-01-01', ...o.settings } as Dataset['settings'],
  });
}
/** Ligne de l'historique des contrats du cadre. */
const histo = (effet: string, regime: Record<string, unknown>, nature = 'avenant') => ({ id: nid++, empId: EMP, effet, nature, regime, jusquau: null, signeLe: null, reference: null, le: effet, par: null, parId: null, applique: true, annuleLe: null, fin: null });
const AN_2027 = { debut: '2027-01-01', fin: '2027-12-31' };
const cloture = (d: InstanceType<typeof Domain>, ref = AN_2027, debut?: string) => F.clotureForfaitHeures(d, d.emp(EMP)!, ref, debut)!;
const valeurs = (c: ReturnType<typeof cloture>) => ({ debut: c.debut, fin: c.fin, motifFin: c.motifFin, cible: c.cible, absences: c.absences, cibleNette: c.cibleNette, realise: c.realise, ecart: c.ecart, hfa25: c.hfa25, hfa50: c.hfa50, hca10: c.hca10, hca25: c.hca25, nonRealise: c.nonRealise, semaines: c.semaines });

// — Règles pures —

test('cumulAnnuel : avenant en juillet, seules les feuilles au forfait annuel comptent (heures supplémentaires déjà payées non comptées deux fois)', () => {
  // 35 h jusqu'au 30 juin 2027 (8 h par jour : 5 h supplémentaires payées chaque semaine), forfait annuel ensuite.
  const historique = [histo('2022-09-05', H35, 'embauche'), histo('2027-07-01', ANNUEL)];
  // Une feuille par semaine, au régime du lundi : celle du lundi 28 juin, à 35 h, compte aussi le jeudi 1er et le vendredi 2.
  const d = domaine({ historique, feuilles: feuilles('2027-01-01', '2027-12-31', 8, w => (w < '2027-07-01' ? H35 : ANNUEL)) });
  const k = cumulAnnuel(d, d.emp(EMP)!, 2027);
  // 127 jours ouvrés du 5 juillet au 31 décembre 2027 (14 juillet, 1er et 11 novembre fériés) : le jeudi 1er et le vendredi
  // 2 juillet sont décomptés à 35 h par la feuille du 28 juin ; sans la correction, 254 jours.
  assert.equal(k.done, 127 * 8);
  assert.equal(k.cible, 792, 'cible : 1 607 h × 180 / 365, du lundi 5 juillet, comme le réalisé');
  // Clôture de la plage sous forfait : du lundi qui suit l'avenant (la feuille de la semaine du 28 juin est à 35 h), cible au
  // prorata des mêmes jours que le réalisé, 26 semaines travaillées (8 h à 25 % chacune).
  assert.deepEqual(valeurs(cloture(d)), {
    debut: '2027-07-05', fin: '2027-12-31', motifFin: 'periode', cible: 792.49, absences: 0, cibleNette: 792.49, realise: 1016, ecart: 223.51,
    hfa25: 208, hfa50: 15.51, hca10: 0, hca25: 0, nonRealise: 0, semaines: 26,
  });
  // Avenant pris un lundi (5 juillet) : la plage commence ce jour-là, sans changement.
  const lundi = domaine({ historique: [histo('2022-09-05', H35, 'embauche'), histo('2027-07-05', ANNUEL)], feuilles: d.ds.feuilles });
  assert.deepEqual(valeurs(cloture(lundi)), valeurs(cloture(d)));
  // Sans feuille la semaine de l'avenant (régime du lundi) : même plage.
  const sansFeuille = domaine({ historique, feuilles: d.ds.feuilles.filter(f => f.week !== '2027-06-28') });
  assert.deepEqual([cloture(sansFeuille).debut, cloture(sansFeuille).cible], ['2027-07-05', 792.49]);
});

test('cumulAnnuel : cumul et cible bornés au début du suivi', () => {
  const d = domaine({ feuilles: [...feuilles('2026-12-01', '2027-01-15', 7)] });
  const k2026 = cumulAnnuel(d, d.emp(EMP)!, 2026);
  assert.deepEqual([k2026.done, k2026.cible], [0, 0], '2026 : avant le début du suivi (1er janvier 2027)');
  // Semaine du lundi 28 décembre 2026 : seul le vendredi 1er janvier 2027 est suivi, et il est férié.
  assert.equal(cumulAnnuel(d, d.emp(EMP)!, 2027).done, 2 * 5 * 7);
  assert.equal(cumulAnnuel(d, d.emp(EMP)!, 2027).cible, 1607);
  // Suivi depuis 2026 : décembre 2026 compte de nouveau.
  const avant = domaine({ feuilles: d.ds.feuilles, settings: { forfaitHeuresDebutSuivi: '2026-01-01' } });
  assert.equal(cumulAnnuel(avant, avant.emp(EMP)!, 2026).done, 22 * 7, 'du 1er au 31 décembre 2026 (25 décembre férié)');
});

test('clôture : année complète, CP légaux non déduits, arrêts et demi-journée déduits au forfait / jours ouvrés théoriques, férié non déduit', () => {
  const cp = [absence('CP', '2027-08-02', '2027-08-27'), absence('CP', '2027-12-20', '2027-12-24')];
  const arrets = [
    absence('MALADIE', '2027-03-01', '2027-03-03'),
    // Jeudi 11 novembre férié : seuls le mercredi et le vendredi sont déduits.
    absence('MALADIE', '2027-11-10', '2027-11-12'),
    // Demi-journée (matin) : moitié de la durée journalière.
    absence('ENFANT_MALADE', '2027-04-07', '2027-04-07', { debutDemi: 'matin' }),
  ];
  const absent = new Set(['2027-03-01', '2027-03-02', '2027-03-03', '2027-11-10', '2027-11-12']);
  const enCp = (j: string) => (j >= '2027-08-02' && j <= '2027-08-27') || (j >= '2027-12-20' && j <= '2027-12-24');
  const d = domaine({ absences: [...cp, ...arrets], feuilles: feuilles('2027-01-01', '2027-12-31', 7, ANNUEL, j => (absent.has(j) || enCp(j) ? 0 : j === '2027-04-07' ? 3.5 : null)) });
  assert.equal(F.joursOuvresTheoriques(AN_2027), 254 - 25);
  const c = cloture(d);
  // 5,5 jours × 1 607 / 229 = 38,6 h ; réalisé : 223 jours à 7 h et une demi-journée ; 3,9 h non réalisées (informatives).
  assert.deepEqual(valeurs(c), {
    debut: '2027-01-01', fin: '2027-12-31', motifFin: 'periode', cible: 1607, absences: 38.6, cibleNette: 1568.4, realise: 1564.5, ecart: -3.9,
    hfa25: 0, hfa50: 0, hca10: 0, hca25: 0, nonRealise: 3.9, semaines: 47,
  });
  assert.deepEqual([c.alertes, c.blocages], [[], []]);
  // Liste réglable : sans la maladie, seule la demi-journée est déduite ; durée de l'accord : 7 h par jour.
  assert.equal(F.clotureForfaitHeures(domaine({ absences: [...cp, ...arrets], settings: { forfaitHeuresAbsencesDeduites: ['ENFANT_MALADE'] } }), d.emp(EMP)!, AN_2027)!.absences, 3.51);
  assert.equal(F.clotureForfaitHeures(domaine({ absences: [...cp, ...arrets], settings: { forfaitHeuresJour: 7 } }), d.emp(EMP)!, AN_2027)!.absences, 38.5);
  // Jamais de nature d'absence dans le résultat : un total d'heures.
  assert.ok(!/MALADIE|ENFANT|maladie/.test(JSON.stringify(c)));
});

test('clôture : heures au-delà du forfait, 25 % jusqu’à 8 h par semaine travaillée, 50 % au-delà ; heures non réalisées jamais majorées', () => {
  const c = cloture(domaine({ feuilles: feuilles('2027-01-01', '2027-12-31', 9) }));
  assert.deepEqual([c.realise, c.ecart, c.semaines, c.seuil25, c.hfa25, c.hfa50], [254 * 9, 679, 52, 416, 416, 263]);
  // Seuil de l'accord : 5 h par semaine.
  const s = cloture(domaine({ feuilles: feuilles('2027-01-01', '2027-12-31', 9), settings: { forfaitHeuresSeuil25: 5, forfaitHeuresAccord: 'Accord du 1er mars 2027' } }));
  assert.deepEqual([s.hfa25, s.hfa50], [260, 419]);
  const n = cloture(domaine({ feuilles: feuilles('2027-01-01', '2027-12-31', 6) }));
  assert.deepEqual([n.ecart, n.nonRealise, n.hfa25, n.hfa50], [-83, 83, 0, 0]);
});

test('clôture : avenant qui fait quitter le forfait (fin de la semaine de l’avenant), entrée, sortie, début du suivi', () => {
  // Forfait jusqu'au 30 juin 2027, 35 h à partir du jeudi 1er juillet : la feuille du 28 juin, au régime du lundi, est au
  // forfait ; la plage va jusqu'au dimanche 4 juillet, et compte le jeudi et le vendredi dans la cible comme dans le réalisé.
  const quitte = domaine({ employe: { ...H35 } as unknown as Partial<Employe>, historique: [histo('2022-09-05', ANNUEL, 'embauche'), histo('2027-07-01', H35)], feuilles: feuilles('2027-01-01', '2027-12-31', 7, w => (w < '2027-07-01' ? ANNUEL : H35)) });
  assert.deepEqual(valeurs(cloture(quitte)), {
    debut: '2027-01-01', fin: '2027-07-04', motifFin: 'avenant', cible: 814.51, absences: 0, cibleNette: 814.51, realise: 889, ecart: 74.49,
    hfa25: 74.49, hfa50: 0, hca10: 0, hca25: 0, nonRealise: 0, semaines: 26,
  });
  // Entrée le 1er mars 2027 : cible au prorata, droits à congés payés incomplets (alerte, sans calcul).
  const entree = cloture(domaine({ employe: { entree: '2027-03-01' }, feuilles: feuilles('2027-03-01', '2027-12-31', 7) }));
  assert.deepEqual([entree.debut, entree.cible, entree.realise], ['2027-03-01', 1347.24, 214 * 7]);
  assert.ok(entree.alertes.some(a => /Droits à congés payés incomplets \(embauche le 1 mars 2027\)/.test(a)));
  // Sortie le 31 mai 2027 : plage close à la sortie ; heures émises sur la période du solde de sortie.
  const sortie = cloture(domaine({ employe: { fin: '2027-05-31' }, feuilles: feuilles('2027-01-01', '2027-05-31', 7) }));
  assert.deepEqual([sortie.fin, sortie.motifFin, sortie.cible, sortie.realise, sortie.ecart], ['2027-05-31', 'sortie', 664.81, 103 * 7, 56.19]);
  for (const today of ['2027-06-01', '2027-07-15']) {
    assert.equal(F.periodeEmission({ fin: '2027-05-31', motifFin: 'sortie', confirmeeLe: `${today}T09:00:00.000Z` }, { forfaitHeuresEmission: 'cloture' }, today), periodeSortie('2027-05-31', today, 0));
  }
  // Période de référence de juin à mai (accord), commencée avant le début du suivi : partielle.
  const juin = domaine({ settings: { forfaitHeuresDebutPeriode: '06-01', forfaitHeuresAccord: 'Accord du 1er mars 2026' }, feuilles: feuilles('2027-01-01', '2027-05-31', 7) });
  const ref = F.periodeReference(juin.ds.settings, '2027-03-01');
  assert.deepEqual(ref, { debut: '2026-06-01', fin: '2027-05-31' });
  const p = cloture(juin, ref);
  assert.deepEqual([p.debut, p.fin, p.partielle, p.cible], ['2027-01-01', '2027-05-31', true, 664.81]);
  assert.ok(p.alertes.some(a => /partielle, le début est à compléter dans Sage/.test(a)));
  // Deux plages dans la période (forfait quitté en juillet, repris en octobre) : une clôture chacune.
  const deux = domaine({ historique: [histo('2022-09-05', ANNUEL, 'embauche'), histo('2027-07-01', H35), histo('2027-10-01', ANNUEL)], feuilles: feuilles('2027-01-01', '2027-12-31', 7, w => (w < '2027-07-01' || w >= '2027-10-01' ? ANNUEL : H35)) });
  // Avenants du jeudi 1er juillet et du vendredi 1er octobre : chaque plage suit les semaines de ses feuilles.
  assert.deepEqual(F.cloturesDeLaPeriode(deux, deux.emp(EMP)!, AN_2027).map(c => [c.debut, c.fin, c.motifFin]), [['2027-01-01', '2027-07-04', 'avenant'], ['2027-10-04', '2027-12-31', 'periode']]);
  // Aucune plage sous forfait (régime 35 h toute l'année) : rien à clôturer.
  assert.equal(F.clotureForfaitHeures(domaine({ employe: { ...H35 } as unknown as Partial<Employe> }), domaine({ employe: { ...H35 } as unknown as Partial<Employe> }).emp(EMP)!, AN_2027), null);
});

test('clôture : temps partiel annualisé, 10 % jusqu’au dixième, 25 % au-delà, plafond, durée légale atteinte (art. L3123-9)', () => {
  const P1200 = { ...ANNUEL, forfaitHeures: 1200 };
  const d = domaine({ employe: { forfaitHeures: 1200 }, feuilles: feuilles('2027-01-01', '2027-12-31', 5.5, P1200) });
  const c = cloture(d);
  assert.deepEqual([c.partiel, c.cible, c.realise, c.ecart, c.hca10, c.hca25, c.hfa25, c.hfa50], [true, 1200, 1397, 197, 120, 77, 0, 0]);
  assert.ok(c.alertes.some(a => /au-delà du dixième/.test(a)), 'au-delà du dixième');
  assert.ok(c.alertes.some(a => /temps partiel annualisé, vérifier les mentions du contrat \(art\. L3123-6\)/.test(a)));
  assert.deepEqual(c.blocages, []);
  // Tiers avec un accord : dans le plafond.
  const tiers = cloture(domaine({ employe: { forfaitHeures: 1200 }, feuilles: d.ds.feuilles, settings: { plafondHeuresComplementaires: 'tiers', heuresComplementairesAccord: 'Accord de branche' } }));
  assert.ok(!tiers.alertes.some(a => /au-delà du/.test(a)));
  // 7 h par jour : 1 778 h, la durée légale est atteinte.
  const legal = cloture(domaine({ employe: { forfaitHeures: 1200 }, feuilles: feuilles('2027-01-01', '2027-12-31', 7, P1200) }));
  assert.ok(legal.blocages.some(b => /art\. L3123-9/.test(b)));
});

test('clôture : alertes (non cadre) et blocages (plage en cours, feuille non validée, semaine sans feuille ni absence)', () => {
  const tout = feuilles('2027-01-01', '2027-12-31', 7).filter(f => f.week !== '2027-03-08');
  const sem = tout.map(f => (f.week === '2027-04-12' ? { ...f, statut: 'soumise' } as Feuille : f));
  const c = cloture(domaine({ employe: { statut: 'technicien' }, feuilles: sem }));
  assert.deepEqual(c.blocages, ['Feuille de la semaine du 12 avr. 2027 non validée', 'Semaine du 8 mars 2027 sans feuille de temps ni absence']);
  assert.ok(c.alertes.some(a => /non cadre/.test(a) && /L3121-56/.test(a)));
  // Absence sur toute la semaine manquante : plus de blocage.
  assert.deepEqual(cloture(domaine({ feuilles: tout, absences: [absence('CP', '2027-03-08', '2027-03-12')] })).blocages, []);
  assert.deepEqual(cloture(domaine({ feuilles: feuilles('2027-01-01', '2027-12-31', 7), today: '2027-12-31' })).blocages, ['Plage en cours : clôture possible à partir du 1 janv. 2028']);
});

test('lignes : écart d’une nouvelle version, émission, à saisir dans Sage, à revoir, contingent', () => {
  const ligne = (o: Partial<Ligne>): Ligne => ({
    id: nid++, empId: EMP, debut: '2027-01-01', fin: '2027-12-31', motifFin: 'periode', version: 1, remplaceId: null, forfait: 1607, cible: 1607, absences: 0, realise: 1650,
    hfa25: 40, hfa50: 3, hca10: 0, hca25: 0, nonRealise: 0, statut: 'confirmee', confirmeeLe: '2028-01-10T09:00:00.000Z', confirmeePar: 'Essai', lotId: null, sage: false, horsFichier: false,
    rouverteLe: null, rouvertePar: null, rouverteMotif: null, annuleeLe: null, annuleePar: null, annuleeMotif: null, ...o,
  });
  const v1 = ligne({ sage: true, lotId: 3 }), v2 = ligne({ version: 2, remplaceId: v1.id, hfa25: 38, hfa50: 0 });
  const table = [{ code: 'HFA25', codeSage: '420', active: true }, { code: 'HFA50', codeSage: '421', active: false }];
  const d = domaine({ lignes: [v1, v2] });
  assert.deepEqual(F.quantitesAEmettre(d.ds.cloturesForfaitHeures, v2), { HFA25: -2, HFA50: -3 });
  // Écart négatif : sous son code avec un format qui l'accepte, à saisir dans Sage sinon ; rubrique désactivée : à saisir.
  const el = F.elementsForfaitHeures(d, '2028-12', table);
  assert.deepEqual(el.map(x => [x.cloture, x.rubrique, x.quantite, x.codeSage, x.periode, x.correctif]), [[v2.id, 'HFA25', -2, '420', '2028-01', true], [v2.id, 'HFA50', -3, null, '2028-01', true]]);
  assert.deepEqual(F.elementsForfaitHeures(d, '2028-12', table, false).map(x => x.codeSage), [null, null]);
  assert.deepEqual(F.elementsForfaitHeures(d, '2027-12', table), [], 'émise au mois de la confirmation');
  // Émission « période » : dernier mois de la plage, ou la période ouverte s'il est clos.
  assert.equal(F.periodeEmission(v2, { forfaitHeuresEmission: 'periode' }, '2028-01-20'), '2028-01');
  assert.equal(F.periodeEmission(v2, { forfaitHeuresEmission: 'periode' }, '2027-12-15'), '2027-12');
  // Résumé du lot : à saisir dans Sage, sans nature.
  const aSaisir = L.resumeContenu({ lignes: [], forfaitHeures: el }).aSaisir!;
  assert.deepEqual(aSaisir.map(x => [x.famille, x.rubrique, x.quantite]), [['forfaitHeures', 'HFA50', -3]]);
  assert.match(aSaisir[0].detail, /Forfait annuel en heures du 1 janv\. 2027 au 31 déc\. 2027 · version 2, écart avec la version transmise/);
  assert.equal(F.etatClotureForfait(v1), 'transmise à la paie (lot n° 3)');
  assert.deepEqual([v2, { ...v2, lotId: 4 }, { ...v2, statut: 'proposee' as const }, { ...v2, statut: 'proposee' as const, rouverteLe: 'x' }, { ...v2, statut: 'annulee' as const }].map(F.etatClotureForfait),
    ['confirmée, en attente du prochain lot de paie', 'dans le lot de paie n° 4, import à confirmer', 'à confirmer', 'rouverte, à confirmer', 'annulée']);
  assert.equal(F.ligneEnVigueur([v1, { ...v2, statut: 'annulee' }], EMP, '2027-01-01'), v1);
  assert.equal(F.ligneEnVigueur([], EMP, '2027-01-01'), null);
  // À revoir : feuille rouverte après la confirmation, puis réalisé recalculé différent.
  const f = feuilles('2027-01-01', '2027-12-31', 7);
  const conf = ligne({ realise: 254 * 7 });
  assert.equal(F.aRevoir(domaine({ feuilles: f, lignes: [conf] }), conf), null);
  const rouverte = f.map(x => (x.week === '2027-06-07' ? { ...x, reouverture: { le: '2028-01-15T10:00:00.000Z', par: 'Essai', motif: 'x', renvoyee: false, transmise: true, lot: 1, rubriques: null } } as unknown as Feuille : x));
  assert.match(F.aRevoir(domaine({ feuilles: rouverte, lignes: [conf] }), conf)!, /semaine du 7 juin 2027 rouverte après la clôture/);
  assert.match(F.aRevoir(domaine({ feuilles: f.slice(1), lignes: [conf] }), conf)!, /réalisé recalculé/);
  // Absence posée après la clôture (arrêt déclaré tard) : total déduit recalculé, donc « à revoir » ; puis une absence
  // photographiée qui devient un CP (non déduit) : de même. Jamais la nature dans le motif.
  const arret = absence('MALADIE', '2027-03-01', '2027-03-01');
  const motif = F.aRevoir(domaine({ feuilles: f, lignes: [conf], absences: [arret] }), conf)!;
  assert.match(motif, /absences déduites recalculées : 7 h au lieu de 0 h/);
  assert.ok(!/MALADIE|maladie|arrêt/.test(motif));
  const deduite = ligne({ realise: 254 * 7, absences: 7.02 });
  assert.equal(F.aRevoir(domaine({ feuilles: f, lignes: [deduite], absences: [arret] }), deduite), null);
  assert.match(F.aRevoir(domaine({ feuilles: f, lignes: [deduite], absences: [{ ...arret, type: 'CP' }] }), deduite)!, /absences déduites recalculées/);
  // Plage qui ne finit plus le même jour (sortie posée après la clôture) : à revoir.
  assert.match(F.aRevoir(domaine({ employe: { fin: '2027-11-30' }, feuilles: f, lignes: [conf] }), conf)!, /plage sous forfait recalculée différente/);
  // Version sans écart avec la version transmise : réglée sans lot.
  const v3 = ligne({ version: 2, remplaceId: v1.id, sage: true });
  assert.equal(F.sansEcartTransmis([v1, v3], v3), true);
  assert.equal(F.sansEcartTransmis([v1, v2], v2), false);
  assert.equal(F.sansEcartTransmis([v1], v1), false, 'première version : jamais « sans écart »');
  assert.equal(F.etatClotureForfait(v3), 'aucun écart avec la version transmise : rien à transmettre');
  // Contingent : imputation désactivée par défaut ; activée, les heures HFA de la dernière version confirmée.
  assert.equal(F.heuresForfaitContingent(d, EMP, 2027), 0);
  const avec = domaine({ lignes: [v1, { ...v2, statut: 'confirmee' }], settings: { forfaitHeuresContingent: true } });
  assert.equal(F.heuresForfaitContingent(avec, EMP, 2027), 38);
  assert.equal(contingentAnnuel(avec, avec.emp(EMP)!, 2027)!.cumul, 38);
  assert.equal(contingentAnnuel(d, d.emp(EMP)!, 2027), null, 'forfait annuel sans imputation : pas de contingent');
});

test('réglages : défauts, référence de l’accord exigée hors défaut (COHERENCE), libellés et journal', () => {
  const s = domaine().ds.settings;
  assert.deepEqual([s.forfaitHeuresDebutPeriode, s.forfaitHeuresSeuil25, s.forfaitHeuresJour, s.forfaitHeuresEmission, s.forfaitHeuresContingent], ['01-01', 8, 0, 'cloture', false]);
  assert.ok(!s.forfaitHeuresAbsencesDeduites.includes('CP') && s.forfaitHeuresAbsencesDeduites.includes('MALADIE') && s.forfaitHeuresAbsencesDeduites.includes('AT'));
  const base0 = { ...s, forfaitHeuresAccord: '' };
  for (const p of [{ forfaitHeuresSeuil25: 10 }, { forfaitHeuresDebutPeriode: '06-01' }, { forfaitHeuresJour: 7 }, { forfaitHeuresAbsencesDeduites: ['MALADIE'] }]) {
    assert.throws(() => appliquerReglages(base0, p), (e: unknown) => e instanceof ReglageInvalide && /Forfait annuel en heures/.test(e.message), JSON.stringify(p));
    assert.doesNotThrow(() => appliquerReglages(base0, { ...p, forfaitHeuresAccord: 'Accord d’entreprise du 1er mars 2027' }));
  }
  // Émission et contingent sont des choix de la paie, sans accord.
  assert.doesNotThrow(() => appliquerReglages(base0, { forfaitHeuresEmission: 'periode', forfaitHeuresContingent: true }));
  assert.throws(() => appliquerReglages(base0, { forfaitHeuresDebutSuivi: '' }), ReglageInvalide);
  assert.throws(() => appliquerReglages(base0, { forfaitHeuresDebutPeriode: '02-29' }), ReglageInvalide);
  assert.deepEqual(appliquerReglages(base0, { forfaitHeuresAbsencesDeduites: ['MALADIE', 'inconnue', 'AT'], forfaitHeuresAccord: 'Accord' }).forfaitHeuresAbsencesDeduites, ['MALADIE', 'AT']);
  for (const a of ['forfaitHeures.cloturer', 'forfaitHeures.rouvrir', 'forfaitHeures.annuler']) {
    assert.ok(JOURNAL_LABEL[a] && estActionPaie(a), a);
    assert.equal(familleAction(a)?.id, 'forfaitHeures');
  }
});

// — Actions, sur la base de démonstration —

/** Base de démonstration : période de référence d'octobre à septembre (accord), suivi depuis le 31 août 2026. */
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
    return String(o.message);
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), forfaitHeuresDebutPeriode: '10-01', forfaitHeuresAccord: 'Accord d’entreprise du 1er mars 2026', forfaitHeuresDebutSuivi: '2026-08-31' });
  // Plage du 31 août au 30 septembre 2026 : feuilles validées (déjà transmises), 9 h par jour, aucune absence.
  await db.run('DELETE FROM feuilles WHERE emp_id = ? AND week >= ?', [EMP, '2026-08-24']);
  await db.run('DELETE FROM absences WHERE emp_id = ? AND au >= ?', [EMP, '2026-08-31']);
  for (const f of feuilles('2026-08-31', '2026-10-02', 9)) await db.insert('feuilles', { ...f, id: undefined });
  const ADMIN = await user(null, 'rh');
  const lignes = async () => (await db.all<Ligne>('cloturesForfaitHeures')).sort((a, b) => a.id - b.id);
  const lots = async () => await db.all<Lot>('lotsPaie');
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[]; message: string | null }>('journal')).filter(l => l.action === action);
  const d = async () => new Domain(await loadFull(db, ADMIN));
  return { db, run, refus, lignes, lots, journal, d, user, ADMIN, PAIE: await user(7, 'rh'), GEST: await user(14, 'rh') };
}
const PLAGE = { empId: EMP, debut: '2026-08-31' };

test('actions : clôture confirmée, jamais refaite ; lot de paie (à saisir dans Sage, réglée hors fichier) ; ligne « à revoir » après la réouverture d’une feuille', async () => {
  const { db, run, refus, lignes, lots, journal, d, user, ADMIN, PAIE, GEST } = await fresh();
  const attendu = F.clotureForfaitHeures(await d(), (await d()).emp(EMP)!, { debut: '2025-10-01', fin: '2026-09-30' }, '2026-08-31')!;
  // 23 jours ouvrés à 9 h ; cible : 1 607 h × 31 / 365 ; 5 semaines travaillées.
  assert.deepEqual([attendu.fin, attendu.partielle, attendu.realise, attendu.cible, attendu.semaines, attendu.hfa25, attendu.hfa50], ['2026-09-30', true, 207, 136.48, 5, 40, 30.52]);
  await refus(GEST, 'forfaitHeures.cloturer', { lignes: [PLAGE] }, 403);
  await refus(ADMIN, 'forfaitHeures.cloturer', { lignes: [] }, 400, /Cochez au moins une ligne/);
  await refus(ADMIN, 'forfaitHeures.cloturer', { lignes: [{ empId: EMP, debut: '2026-09-01' }] }, 404, /aucune plage/);
  assert.match(await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] }), /1 ligne clôturée \(Élodie Bernard\)/);
  const [l] = await lignes();
  assert.deepEqual([l.version, l.statut, l.motifFin, l.realise, l.cible, l.hfa25, l.hfa50, l.nonRealise, l.lotId, l.sage, l.confirmeePar], [1, 'confirmee', 'periode', 207, 136.48, 40, 30.52, 0, null, false, 'Sandrine Vidal']);
  assert.match(await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] }), /1 ligne déjà confirmée, rien n’est refait/);
  assert.equal((await lignes()).length, 1);
  // Journal : identifiants, plage, version ; jamais d'heures.
  const j = (await journal('forfaitHeures.cloturer'))[0];
  assert.deepEqual(j.payload.clotures, [{ id: l.id, empId: EMP, debut: '2026-08-31', fin: '2026-09-30', version: 1 }]);
  assert.deepEqual(j.salaries, [EMP]);
  assert.ok(!/207|136|30\.52|cible|realise|absences/.test(JSON.stringify(j.payload) + j.message));

  // Lot d'octobre (mois de la confirmation) : rubriques désactivées, à saisir dans Sage, réservées par le lot.
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /clôture de forfait annuel en heures/);
  let lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.forfaitHeures, [{ id: l.id, empId: EMP }]);
  assert.deepEqual(lot.resume.forfaitHeures, { elements: 2, salaries: 1 });
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'forfaitHeures').map(x => [x.rubrique, x.quantite]), [['HFA25', 40], ['HFA50', 30.52]]);
  assert.ok(!L.lignesFichier(lot.contenu!).some(x => /HFA/.test(x.rubrique)));
  assert.deepEqual((await journal('paie.lotGenerer')).at(-1)!.payload.forfaitHeures, [l.id]);
  // Lecture seule (lots de paie sans le droit « paie ») : ni les heures nominatives à saisir, ni les lignes emportées ; la
  // paie les reçoit.
  const lotVu = async (u: User) => (await buildSnapshot(db, u)).lotsPaie.find(x => x.id === lot.id)!;
  const lu = await lotVu(await user(EMP, 'rh'));
  assert.ok(!(lu.resume.aSaisir ?? []).some(x => x.famille === 'forfaitHeures'), 'lecture seule : aucune quantité');
  assert.ok(!/HFA|HCA/.test(JSON.stringify(lu)));
  assert.equal(lu.forfaitHeures, undefined);
  assert.deepEqual(lu.resume.forfaitHeures, { elements: 2, salaries: 1 });
  assert.deepEqual((await lotVu(PAIE)).resume.aSaisir?.filter(x => x.famille === 'forfaitHeures').map(x => x.quantite), [40, 30.52]);
  // Dans un lot à confirmer : ni réouverture, ni annulation.
  await refus(ADMIN, 'forfaitHeures.rouvrir', { id: l.id, motif: 'Erreur' }, 409, /annulez d’abord ce lot/);
  await refus(ADMIN, 'forfaitHeures.annuler', { id: l.id, motif: 'Erreur' }, 409, /annulez d’abord ce lot/);
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  let v1 = (await lignes())[0];
  assert.deepEqual([v1.lotId, v1.sage, v1.horsFichier], [lot.id, true, true]);
  assert.equal(F.etatClotureForfait(v1), 'réglée hors fichier (saisie dans Sage)');
  await refus(ADMIN, 'forfaitHeures.annuler', { id: l.id, motif: 'Erreur' }, 409, /déjà transmise/);

  // Feuille de la plage rouverte après la clôture : la ligne est « à revoir », sans être modifiée.
  assert.equal(F.aRevoir(await d(), v1), null);
  await run(ADMIN, 'temps.rouvrir', { empId: EMP, week: '2026-09-14', motif: 'Heures du mardi saisies deux fois' });
  assert.match(F.aRevoir(await d(), (await lignes())[0])!, /semaine du 14 sept\. 2026 rouverte après la clôture/);
  assert.deepEqual((await lignes())[0], v1);

  // Réouverture après transmission : nouvelle version à confirmer ; la feuille corrigée (7 h le mardi), revalidée, la
  // version 2 est confirmée et seul l'écart part, dans un lot correctif.
  await refus(ADMIN, 'forfaitHeures.rouvrir', { id: l.id }, 400, /motif/);
  assert.match(await run(ADMIN, 'forfaitHeures.rouvrir', { id: l.id, motif: 'Feuille du 14 septembre corrigée' }), /version 2 à confirmer, seul l’écart partira dans un lot correctif/);
  let [, v2] = await lignes();
  assert.deepEqual([v2.version, v2.remplaceId, v2.statut, v2.rouverteMotif], [2, l.id, 'proposee', 'Feuille du 14 septembre corrigée']);
  assert.ok(!JSON.stringify((await journal('forfaitHeures.rouvrir'))[0].payload).includes('14 septembre'), 'motif masqué au journal');
  const f = (await db.where<Feuille>('feuilles', 'empId', EMP)).find(x => x.week === '2026-09-14')!;
  await db.update('feuilles', f.id, { lignes: [{ ...f.lignes[0], h: [9, 7, 9, 9, 9, 0, 0] }] });
  await run(ADMIN, 'temps.validate', { empId: EMP, week: '2026-09-14' });
  assert.match(await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] }), /1 ligne clôturée/);
  [v1, v2] = await lignes();
  assert.deepEqual([v2.statut, v2.realise, v2.hfa25, v2.hfa50, (await lignes()).length], ['confirmee', 205, 40, 28.52, 2]);
  assert.equal(v1.sage, true, 'version transmise gardée');
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = (await lots()).at(-1)!;
  assert.equal(lot.type, 'correctif');
  assert.deepEqual(lot.contenu!.forfaitHeures!.map(x => [x.cloture, x.rubrique, x.quantite, x.correctif]), [[v2.id, 'HFA50', -2, true]]);
  // Lot annulé : la version 2 se libère, s'annule (avant transmission), puis la plage se clôture en version 3, qui corrige v1.
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  await refus(ADMIN, 'forfaitHeures.annuler', { id: v2.id }, 400, /motif/);
  assert.match(await run(ADMIN, 'forfaitHeures.annuler', { id: v2.id, motif: 'Clôture faite trop tôt' }), /de nouveau à clôturer/);
  assert.equal((await lignes())[1].statut, 'annulee');
  await refus(ADMIN, 'forfaitHeures.rouvrir', { id: v2.id, motif: 'x' }, 409, /annulée/);
  await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] });
  const v3 = (await lignes())[2];
  assert.deepEqual([v3.version, v3.remplaceId, v3.statut], [3, l.id, 'confirmee']);
  assert.deepEqual(F.quantitesAEmettre(await lignes(), v3), { HFA50: -2 });
});

test('actions : version rouverte après transmission et confirmée sans écart, réglée sans lot', async () => {
  const { run, lignes, lots, ADMIN, PAIE } = await fresh();
  await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  await run(PAIE, 'paie.lotConfirmer', { id: (await lots()).at(-1)!.id });
  const [v1] = await lignes();
  await run(ADMIN, 'forfaitHeures.rouvrir', { id: v1.id, motif: 'Vérification de la feuille du 14 septembre' });
  // Rien n'a changé : la version 2 est confirmée, réglée tout de suite, et aucun lot ne l'attend.
  assert.match(await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] }), /aucun écart avec la version transmise : rien à transmettre/);
  const v2 = (await lignes())[1];
  assert.deepEqual([v2.version, v2.statut, v2.sage, v2.lotId, v2.hfa25, v2.hfa50], [2, 'confirmee', true, null, v1.hfa25, v1.hfa50]);
  assert.equal(F.etatClotureForfait(v2), 'aucun écart avec la version transmise : rien à transmettre');
  const n = (await lots()).length;
  await assert.rejects(async () => await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }));
  assert.equal((await lots()).length, n, 'aucun lot pour une version sans écart');
  // Elle peut encore être rouverte : la version 3 corrigera la version 2 (transmise de fait), écart seul.
  assert.match(await run(ADMIN, 'forfaitHeures.rouvrir', { id: v2.id, motif: 'Nouvelle vérification' }), /version 3 à confirmer/);
});

test('démonstration : début du suivi au 1er janvier 2026 posé dans une base antérieure, jamais un réglage choisi', async () => {
  const { suiviForfaitHeuresDemo } = await import('../server/src/seed.ts');
  const db = await nouvelleBase();
  await seedDemo(db);
  assert.equal((await db.getSetting<Record<string, unknown>>('app', {})).forfaitHeuresDebutSuivi, '2026-01-01');
  // Base de démonstration créée avant le lot 12 : réglage absent, repris au démarrage.
  const { forfaitHeuresDebutSuivi: _s, ...app } = await db.getSetting<Record<string, unknown>>('app', {});
  await db.setSetting('app', app);
  assert.equal(await suiviForfaitHeuresDemo(db), true);
  assert.equal((await db.getSetting<Record<string, unknown>>('app', {})).forfaitHeuresDebutSuivi, '2026-01-01');
  // Réglage déjà choisi : jamais touché.
  await db.setSetting('app', { ...app, forfaitHeuresDebutSuivi: '2026-06-01' });
  assert.equal(await suiviForfaitHeuresDemo(db), false);
  assert.equal((await db.getSetting<Record<string, unknown>>('app', {})).forfaitHeuresDebutSuivi, '2026-06-01');
});

test('actions : blocage, sortie dans le lot du solde de sortie, droits de lecture, lecture incrémentale', async () => {
  const { db, run, refus, lignes, lots, user, ADMIN, PAIE } = await fresh();
  // Feuille de la plage encore soumise : clôture refusée, rien n'est enregistré.
  const f = (await db.where<Feuille>('feuilles', 'empId', EMP)).find(x => x.week === '2026-09-07')!;
  await db.update('feuilles', f.id, { statut: 'soumise' });
  await refus(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] }, 409, /Élodie Bernard : Feuille de la semaine du 7 sept\. 2026 non validée/);
  assert.deepEqual(await lignes(), []);
  await db.update('feuilles', f.id, { statut: 'validee' });

  // Clôture de la plage (période d'octobre à septembre).
  await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] });
  const [l] = await lignes();

  // Droits de lecture : service RH tout ; paie, les lignes confirmées sans motif ; le salarié, la sienne sans auteur ni motif ;
  // ni le manager, ni le référent HSE, ni la lecture seule.
  await db.update('cloturesForfaitHeures', l.id, { rouverteMotif: 'Motif interne' });
  const vue = async (u: User) => (await buildSnapshot(db, u)).cloturesForfaitHeures ?? [];
  assert.equal((await vue(ADMIN))[0].rouverteMotif, 'Motif interne');
  const paie = (await vue(PAIE))[0];
  assert.deepEqual([paie.id, paie.hfa25, paie.rouverteMotif], [l.id, l.hfa25, null]);
  const moi = (await vue(await user(EMP, 'collaborateur')))[0];
  assert.deepEqual([moi.id, moi.realise, moi.confirmeePar, moi.rouverteMotif], [l.id, l.realise, null, null]);
  const mgr = new Domain(await loadFull(db, ADMIN)).mgrOf(new Domain(await loadFull(db, ADMIN)).emp(EMP)!)!;
  assert.deepEqual(await vue(await user(mgr, 'manager')), [], 'manager : aucune quantité');
  assert.deepEqual(await vue(await user(23, 'rh')), [], 'référent HSE');
  assert.deepEqual(await vue(await user(EMP, 'rh')), [], 'lecture seule');
  assert.deepEqual(await vue(await user(2, 'collaborateur')), [], 'autre salarié');

  // Lecture incrémentale : écriture d'une ligne relue par clé, même lecture brute que la relecture complète.
  const T = '2026-10-10', HSE = { role: 'rh' as const, empId: null, nom: 'Essai', intitule: 'HSE', profilRh: 'referent_hse' as const };
  const avant = await db.lecture(async () => ({ n: (await db.etatRevision()).n, brut: await lireBrut(db, T) }));
  await db.update('cloturesForfaitHeures', l.id, { cible: 140 });
  await db.lecture(async () => {
    const { n } = await db.etatRevision();
    const ch = await db.lireChangements(avant.n, n);
    assert.ok(ch && ch.get('cloturesForfaitHeures') instanceof Set, 'clés inscrites au journal des changements');
    const fusion = appliquerDelta(avant.brut, await lireDelta(db, avant.brut, ch!));
    const ref = await lireBrut(db, T);
    assert.deepStrictEqual(fusion.brut, ref);
    assert.deepStrictEqual(assembler(fusion.brut, T, 1, HSE), assembler(ref, T, 1, HSE));
    assert.deepEqual([...fusion.touches], [EMP]);
  });

  // Sortie le vendredi 2 octobre 2026 : plage close à la sortie, heures dans le lot du solde de sortie.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), forfaitHeuresDebutPeriode: '01-01', forfaitHeuresAccord: '' });
  await run(ADMIN, 'employe.sortie', { id: EMP, date: '2026-10-02', motif: 'demission' });
  // La ligne confirmée de la période (pas encore transmise) est annulée, puis la plage close par la sortie clôturée (version 2).
  await run(ADMIN, 'forfaitHeures.annuler', { id: l.id, motif: 'Sortie du salarié' });
  await run(ADMIN, 'forfaitHeures.cloturer', { lignes: [PLAGE] });
  const s2 = (await lignes())[1];
  assert.deepEqual([s2.version, s2.remplaceId, s2.fin, s2.motifFin, s2.realise], [2, null, '2026-10-02', 'sortie', 25 * 9]);
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.forfaitHeures, [{ id: s2.id, empId: EMP }]);
  // Solde de sortie (rubriques de sortie désactivées) listé à saisir dans Sage par le même lot.
  assert.ok((lot.resume.aSaisir ?? []).some(x => x.famille === 'sorties' && x.empId === EMP), 'même lot que le solde de sortie');
  const periodes = new Set([...lot.contenu!.forfaitHeures!.map(x => x.periode), ...(lot.resume.aSaisir ?? []).filter(x => x.famille === 'sorties').map(x => x.periode)]);
  assert.deepEqual([...periodes], [periodeSortie('2026-10-02', '2026-10-10', 0)]);
});
