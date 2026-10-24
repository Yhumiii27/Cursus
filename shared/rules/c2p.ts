// Compte professionnel de prévention (C2P, t052 ; art. L4163-1 et suivants, D4163-2) : expositions de chaque salarié, par
// année civile, aux six facteurs de risques professionnels, pour la déclaration que la paie saisit dans la DSN de Sage.
// - Travail de nuit et équipes successives alternantes : comptés par Cursus d'après les horaires de poste figés sur les
//   feuilles validées (shared/rules/horaires.ts) ; une nuit est un jour qui compte au moins 1 h de travail entre 0 h et
//   5 h (`heuresDeNuit` de shared/rules/repos-nuit.ts sur la plage 0 h – 5 h, rattachée au jour où commence le poste ;
//   la pause est placée hors de la plage tant qu'elle y tient, voir `heuresC2p`). Une nuit faite sous un horaire qualifié « équipes successives alternantes » (Référentiels →
//   Horaires) compte au seuil de 50 nuits ; les autres au seuil de 120, sans double compte. Un horaire de nuit pas encore
//   qualifié compte au travail de nuit et il est signalé « à qualifier ».
// - Seuils et plage réglementaires (art. D4163-2), en constantes non réglables : un accord ne les modifie pas, et un
//   réglage abaissé à tort ferait sous-déclarer. Au prorata de la période du contrat dans l'année ; un contrat de moins
//   d'un mois n'est pas déclaré.
// - Travail répétitif, milieu hyperbare, températures extrêmes et bruit : Cursus ne les mesure pas. Ils se cochent sur le
//   poste (`Poste.c2p`, par le service RH ou le référent HSE) quand ses titulaires y sont exposés au-delà du seuil après
//   protections ; l'exposition d'un salarié est celle du poste qu'il occupe, sur sa période dans l'année.
// - Une feuille sans horaire ne compte aucune nuit (la synthèse le signale) ; seules les feuilles validées comptent.
// - Intérimaire : la déclaration revient à l'entreprise de travail temporaire, à qui l'entreprise utilisatrice transmet
//   les expositions ; la ligne le dit et ne part pas dans l'export DSN.
// Calculé par le serveur (server/src/dataset.ts, `Dataset.c2p`), pour le service RH, le référent HSE et la lecture seule.
import { FACTEURS_C2P } from '../constants.ts';
import { addD, addM, days, parse } from '../dates.ts';
import { matricule, num } from '../format.ts';
import type { Dataset, Employe, FacteurC2p, FacteurPoste, FeuilleTemps, Horaire, ISODate, LigneC2p, Poste, Referentiels, SyntheseC2p } from '../types.ts';
import { posteDe } from './exigences.ts';
import { dureeHoraire, horairesDe } from './horaires.ts';
import { heuresDeNuit, plageDuJour, type PlageTravail } from './repos-nuit.ts';
import { JOURS_FEUILLE } from './semaine.ts';

// — Règles fixes (art. D4163-2) —

/** Plage horaire du C2P : de 0 h à 5 h (et non la plage de nuit des Paramètres, qui sert aux heures de nuit payées). */
export const C2P_PLAGE = { nuitDebut: 0, nuitFin: 5 } as const;
/** Heures de travail dans la plage qui font une nuit. */
export const C2P_HEURES_MIN = 1;
/** Nuits par année civile au-delà desquelles le salarié est exposé : travail de nuit, équipes successives alternantes. */
export const C2P_SEUIL_NUIT = 120;
export const C2P_SEUIL_ALTERNANT = 50;
/** Durée minimale d'un contrat déclaré, en mois. */
export const C2P_CONTRAT_MIN_MOIS = 1;
export const ARTICLE_C2P = 'art. D4163-2';
/** Mention de l'export : la paie saisit les lignes dans la DSN de Sage, codes à confirmer avant. */
export const MENTION_C2P = 'À saisir dans la DSN — codes de facteur à confirmer par la paie';

/** Facteurs dans l'ordre de l'écran ; ceux du poste (cochés par le service RH ou le référent HSE). */
export const FACTEURS: readonly FacteurC2p[] = Object.keys(FACTEURS_C2P) as FacteurC2p[];
export const FACTEURS_POSTE: readonly FacteurPoste[] = FACTEURS.filter((f): f is FacteurPoste => !!FACTEURS_C2P[f].poste);
export const estFacteurPoste = (v: unknown): v is FacteurPoste => typeof v === 'string' && (FACTEURS_POSTE as readonly string[]).includes(v);

/** Facteurs cochés sur un poste, dans l'ordre de l'écran (valeurs inconnues écartées). */
export const facteursDuPoste = (p: Pick<Poste, 'c2p'> | null | undefined): FacteurPoste[] =>
  FACTEURS_POSTE.filter(f => (p?.c2p ?? []).includes(f));

/** Facteurs reçus pour un poste (`referentiel.poste.expositions`) : liste de codes connus, sinon le refus. */
export function controlerFacteursPoste(v: unknown): { facteurs: FacteurPoste[]; erreur: string | null } {
  if (!Array.isArray(v)) return { facteurs: [], erreur: 'Facteurs d’exposition : une liste est attendue' };
  const inconnu = v.find(x => !estFacteurPoste(x));
  if (inconnu !== undefined) return { facteurs: [], erreur: `Facteur d’exposition inconnu : ${String(inconnu).slice(0, 40)}` };
  return { facteurs: FACTEURS_POSTE.filter(f => v.includes(f)), erreur: null };
}

/** Qualification reçue pour un horaire (`referentiel.horaire.alternant`) : oui, non, ou à qualifier (null) ; undefined : invalide. */
export function qualificationAlternant(v: unknown): boolean | null | undefined {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  if (v === null || v === '') return null;
  return undefined;
}
/** « Équipes successives alternantes », « Non alternant », « À qualifier ». */
export const alternantTexte = (v: boolean | null | undefined) => (v === true ? 'Équipes successives alternantes' : v === false ? 'Non alternant' : 'À qualifier');

// — Nuits —

/**
 * Heures de travail entre 0 h et 5 h d'une plage de travail (au centième d'heure). Convention du C2P : la pause est placée
 * d'abord hors de la plage, et n'en est retirée que pour la part qui n'y tient pas. Le retrait au prorata des heures de
 * nuit payées (`heuresDeNuit`) ferait manquer le seuil d'une heure à un poste de soirée qui finit à 1 h (20 h – 1 h, pause
 * de 30 min prise avant minuit : 1 h de travail dans la plage, 0,9 au prorata), soit une sous-déclaration.
 */
export function heuresC2p(p: PlageTravail | null): number {
  if (!p || p.fin <= p.debut) return 0;
  const dans = Math.round(heuresDeNuit({ ...p, pause: 0 }, C2P_PLAGE) * 60);
  const pauseDans = Math.max(0, p.pause - (p.fin - p.debut - dans));
  return Math.round((Math.max(0, dans - pauseDans) / 60) * 100) / 100;
}

/** Heures entre 0 h et 5 h d'un horaire, à sa durée nominale : un horaire de nuit au sens du C2P en compte 1 au moins. */
export const heuresC2pHoraire = (h: Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'>) => heuresC2p(plageDuJour(h, dureeHoraire(h), 0));
export const horaireDeNuitC2p = (h: Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'>) => heuresC2pHoraire(h) >= C2P_HEURES_MIN;

/** Nuit d'une feuille : jour où commence le poste, code de l'horaire figé, heures entre 0 h et 5 h, qualification de l'horaire. */
export interface NuitC2p { jour: ISODate; code: string; heures: number; alternant: boolean | null }

const heuresDuJour = (sh: Pick<FeuilleTemps, 'lignes'>, i: number) => sh.lignes.reduce((n, l) => n + num(l.h[i]), 0);

/**
 * Nuits d'une feuille validée, d'après ses horaires figés (aucune pour une autre feuille) : chaque jour qui compte au moins
 * 1 h de travail entre 0 h et 5 h. La qualification est celle de l'horaire au référentiel (le roulement d'un horaire ne
 * se fige pas avec ses heures) ; un code absent du référentiel est à qualifier.
 */
export function nuitsC2pDeLaFeuille(sh: Pick<FeuilleTemps, 'week' | 'statut' | 'lignes' | 'horairesFiges'>, horaires: readonly Horaire[]): NuitC2p[] {
  if (sh.statut !== 'validee' || !sh.horairesFiges) return [];
  const out: NuitC2p[] = [];
  for (let i = 0; i < JOURS_FEUILLE; i++) {
    const h = sh.horairesFiges[i];
    if (!h) continue;
    const heures = heuresC2p(plageDuJour(h, heuresDuJour(sh, i), i));
    if (heures >= C2P_HEURES_MIN) out.push({ jour: addD(sh.week, i), code: h.code, heures, alternant: horaires.find(x => x.code === h.code)?.alternant ?? null });
  }
  return out;
}

/** Jours de la feuille qui portent des heures sans horaire figé (aucune nuit n'y est comptée), dans l'intervalle donné. */
function joursSansHoraire(sh: Pick<FeuilleTemps, 'week' | 'lignes' | 'horairesFiges'>, du: ISODate, au: ISODate): number {
  let n = 0;
  for (let i = 0; i < JOURS_FEUILLE; i++) {
    const jour = addD(sh.week, i);
    if (jour >= du && jour <= au && heuresDuJour(sh, i) > 0 && !sh.horairesFiges?.[i]) n++;
  }
  return n;
}

// — Synthèse annuelle —

/** Contrat de moins d'un mois (entrée et fin connues) : pas de déclaration. */
export const contratMoinsDUnMois = (e: Pick<Employe, 'entree' | 'fin'>) => !!e.fin && addM(e.entree, C2P_CONTRAT_MIN_MOIS) > addD(e.fin, 1);

/** Seuil au prorata, au centième de nuit. */
const auProrata = (seuil: number, prorata: number) => Math.round(seuil * prorata * 100) / 100;

/**
 * Exposition d'un salarié sur l'année civile `annee`, ou null s'il n'y était pas sous contrat. `feuilles` : celles du
 * salarié (toutes, pour signaler celles qui ne sont pas validées).
 */
export function ligneC2p(ds: Pick<Dataset, 'referentiels'>, e: Employe, feuilles: readonly FeuilleTemps[], annee: number): LigneC2p | null {
  const debutAn = `${annee}-01-01`, finAn = `${annee}-12-31`;
  const du = e.entree > debutAn ? e.entree : debutAn, au = e.fin && e.fin < finAn ? e.fin : finAn;
  if (du > au) return null;
  const prorata = Math.min(1, (days(parse(du), parse(au)) + 1) / (days(parse(debutAn), parse(finAn)) + 1));
  const horaires = horairesDe(ds.referentiels);
  let nuits = 0, nuitsAlternantes = 0, nuitsAQualifier = 0, semainesSansHoraire = 0, feuillesNonValidees = 0;
  for (const sh of feuilles) {
    // Semaine qui touche la période (une semaine à cheval sur deux années compte pour chacune ses jours).
    if (sh.week > au || addD(sh.week, JOURS_FEUILLE - 1) < du) continue;
    if (sh.statut !== 'validee') {
      if (sh.lignes.some(l => l.h.some(v => num(v) > 0))) feuillesNonValidees++;
      continue;
    }
    if (joursSansHoraire(sh, du, au) > 0) semainesSansHoraire++;
    for (const n of nuitsC2pDeLaFeuille(sh, horaires)) {
      if (n.jour < du || n.jour > au) continue;
      if (n.alternant === true) nuitsAlternantes++;
      else {
        nuits++;
        if (n.alternant == null) nuitsAQualifier++;
      }
    }
  }
  const declarant = contratMoinsDUnMois(e) ? null : e.typeContrat === 'interim' ? 'ett' : 'employeur';
  const seuilNuit = auProrata(C2P_SEUIL_NUIT, prorata), seuilAlternant = auProrata(C2P_SEUIL_ALTERNANT, prorata);
  const facteursPoste = facteursDuPoste(posteDe(ds, e));
  const expositions: FacteurC2p[] = declarant == null ? [] : [
    ...(nuits >= seuilNuit ? ['nuit' as const] : []),
    ...(nuitsAlternantes >= seuilAlternant ? ['alternant' as const] : []),
    ...facteursPoste,
  ];
  return { empId: e.id, du, au, prorata, declarant, nuits, nuitsAlternantes, nuitsAQualifier, seuilNuit, seuilAlternant, facteursPoste, expositions, semainesSansHoraire, feuillesNonValidees };
}

/**
 * Horaires de nuit au sens du C2P pas encore qualifiés : ceux en vigueur dont la durée nominale compte 1 h entre 0 h et
 * 5 h, et ceux (archivés compris) sous lesquels une nuit de l'année a été comptée. Codes, dans l'ordre du référentiel.
 */
export function horairesAQualifier(r: Pick<Referentiels, 'horaires'>, utilises: ReadonlySet<string> = new Set()): string[] {
  return horairesDe(r).filter(h => h.alternant == null && ((!h.archive && horaireDeNuitC2p(h)) || utilises.has(h.code))).map(h => h.code);
}

/**
 * Synthèse de l'année : une ligne par salarié sous contrat cette année-là, dans l'ordre des fiches ; `arrete` : date du
 * calcul (l'année en cours n'est comptée que jusqu'aux feuilles validées).
 */
export function syntheseC2p(ds: Pick<Dataset, 'referentiels' | 'employes' | 'feuilles' | 'today'>, annee: number): SyntheseC2p {
  const parSalarie = new Map<number, FeuilleTemps[]>();
  for (const sh of ds.feuilles) {
    const l = parSalarie.get(sh.empId);
    if (l) l.push(sh);
    else parSalarie.set(sh.empId, [sh]);
  }
  const lignes = ds.employes.map(e => ligneC2p(ds, e, parSalarie.get(e.id) ?? [], annee)).filter((x): x is LigneC2p => !!x);
  // Horaires sous lesquels une nuit à qualifier a été comptée cette année (un horaire archivé depuis compris).
  const horaires = horairesDe(ds.referentiels), utilises = new Set<string>();
  for (const sh of ds.feuilles) {
    if (sh.week.slice(0, 4) !== String(annee) && addD(sh.week, JOURS_FEUILLE - 1).slice(0, 4) !== String(annee)) continue;
    for (const n of nuitsC2pDeLaFeuille(sh, horaires)) if (n.alternant == null && n.jour.slice(0, 4) === String(annee)) utilises.add(n.code);
  }
  return { annee, arrete: ds.today, lignes, horairesAQualifier: horairesAQualifier(ds.referentiels, utilises) };
}

/** Années de la synthèse transmise : l'année en cours et la précédente (déclarée dans la DSN de décembre ou en janvier). */
export const anneesC2p = (today: ISODate) => [Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1];

// — Export pour la paie (DSN) —

/** JJ/MM/AAAA. */
const jma = (iso: ISODate) => iso.split('-').reverse().join('/');
const nombre = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/**
 * Lignes « à saisir dans la DSN » de l'année : une par salarié déclaré par l'employeur et par facteur exposé (intérimaires
 * et contrats de moins d'un mois exclus). Codes internes de Cursus et code DSN présumé, à confirmer par la paie.
 */
export function exportC2p(ds: Pick<Dataset, 'employes'>, s: SyntheseC2p): { fichier: string; head: string[]; rows: (string | number)[][] } {
  const emp = new Map(ds.employes.map(e => [e.id, e]));
  const rows: (string | number)[][] = [];
  for (const l of s.lignes) {
    const e = emp.get(l.empId);
    if (!e || l.declarant !== 'employeur') continue;
    for (const f of l.expositions) {
      const x = FACTEURS_C2P[f], nuit = f === 'nuit' || f === 'alternant';
      rows.push([s.annee, e.matriculePaie ?? '', matricule(e.id), e.nom, x.code, x.label, `${x.dsn} (à confirmer)`, jma(l.du), jma(l.au),
        nuit ? (f === 'nuit' ? l.nuits : l.nuitsAlternantes) : '', nuit ? nombre(f === 'nuit' ? l.seuilNuit : l.seuilAlternant) : '', nuit ? 'Nuits comptées par Cursus' : 'Poste occupé', MENTION_C2P]);
    }
  }
  return {
    fichier: `c2p-${s.annee}-${s.arrete}.csv`,
    head: ['Année', 'Matricule de paie', 'Matricule', 'Collaborateur', 'Code Cursus', 'Facteur', 'Code DSN présumé', 'Du', 'Au', 'Nuits', 'Seuil (nuits)', 'Origine', 'Mention'],
    rows,
  };
}
