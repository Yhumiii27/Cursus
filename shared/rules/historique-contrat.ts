// Historique des contrats (t074) : régime de temps de travail en vigueur à une date, d'après les lignes datées de la table
// `contratsHistorique` (embauche, avenant, renouvellement d'un CDD) et la fiche, qui fait foi pour le régime en cours.
// Utilisé à la création d'une feuille de temps (régime de sa semaine), par `employeDeLaFeuille` en repli d'une feuille sans
// régime figé, par les droits à RTT et à jours de repos (somme au prorata des régimes de l'année, shared/rules/conges.ts),
// par la cible d'un forfait annuel en heures (`cumulAnnuel`) et par le décompte des jours non travaillés d'un temps partiel.
// Sans ligne (fiche créée avant l'historique, import, jeu de démonstration ancien) : régime de la fiche depuis l'entrée ou
// le dernier changement (`tempsDepuis`), régime inconnu avant ; chaque calcul garde alors son comportement d'avant.
// Avenant programmé (date d'effet future) : compté à sa date, appliqué à la fiche ce jour-là (server/src/avenants.ts).
import type { ContratFige, ContratHistorique, Dataset, Employe, ISODate, NatureLigneContrat } from '../types.ts';

/** Libellés des natures de ligne (fiche du collaborateur, journal). */
export const NATURES_LIGNE_CONTRAT: Record<NatureLigneContrat, string> = {
  embauche: 'Embauche', avenant: 'Avenant', renouvellement: 'Renouvellement du CDD',
};

/** Régime de temps de travail d'une fiche (celui que fige une feuille de temps : shared/rules/temps.ts, contratFige). */
export function regimeFiche(e: Pick<Employe, keyof ContratFige>): ContratFige {
  return { statut: e.statut, typeContrat: e.typeContrat, temps: e.temps, heures: e.heures, forfaitHeures: e.forfaitHeures, forfaitJours: e.forfaitJours, jourOff: [...(e.jourOff ?? [])] };
}
/** Deux régimes identiques (jours non travaillés compris). */
export const memeRegime = (a: ContratFige | null, b: ContratFige | null) => JSON.stringify(a) === JSON.stringify(b);

type AvecHistorique = { ds: Pick<Dataset, 'contratsHistorique'> } | Pick<Dataset, 'contratsHistorique'>;
const historique = (x: AvecHistorique): readonly ContratHistorique[] => ('ds' in x ? x.ds.contratsHistorique : x.contratsHistorique) ?? [];

/** Lignes en vigueur d'un salarié (annulées écartées), par date d'effet puis ordre d'enregistrement. */
export function lignesContrat(x: AvecHistorique, empId: number): ContratHistorique[] {
  return historique(x).filter(l => l.empId === empId && !l.annuleLe)
    .sort((a, b) => a.effet.localeCompare(b.effet) || a.id - b.id);
}

/** Renouvellements d'un CDD enregistrés (lignes `renouvellement`), dans l'ordre. */
export const renouvellementsDe = (x: AvecHistorique, empId: number) => lignesContrat(x, empId).filter(l => l.nature === 'renouvellement');

/** Avenant programmé d'un salarié, pas encore appliqué à la fiche (au plus un : server/src/actions/equipes.ts). */
export const avenantProgramme = (x: AvecHistorique, empId: number) => lignesContrat(x, empId).find(l => l.nature === 'avenant' && !l.applique) ?? null;

/**
 * Période d'un même régime : à compter de `du`, jusqu'à la suivante. `regime` null : inconnu. `ligne` : ligne de
 * l'historique qui l'ouvre (null : déduite de la fiche) ; `programme` : avenant à venir, pas encore appliqué à la fiche.
 */
export interface SegmentContrat { du: ISODate; regime: ContratFige | null; ligne: ContratHistorique | null; programme: boolean }

const memo = new WeakMap<readonly ContratHistorique[], WeakMap<object, SegmentContrat[]>>();
const VIDE: readonly ContratHistorique[] = [];

/**
 * Régimes successifs d'un salarié, dans l'ordre. Lignes appliquées (embauche, avenants ; un renouvellement ne change pas
 * le régime), la dernière prenant le régime de la fiche, qui fait foi pour le régime en cours (une fiche modifiée hors de
 * l'historique, par un import, l'emporte ; un changement daté après la dernière ligne, `tempsDepuis`, ouvre une période),
 * puis avenants programmés. Sans ligne : régime de la fiche depuis l'entrée, ou depuis `tempsDepuis` (inconnu avant).
 */
export function segmentsContrat(x: AvecHistorique, e: Employe): SegmentContrat[] {
  // Mémorisé par instantané (liste des lignes) et par fiche : appelé pour chaque jour décompté.
  const h = historique(x).length ? historique(x) : VIDE;
  let parFiche = memo.get(h);
  if (!parFiche) { parFiche = new WeakMap(); memo.set(h, parFiche); }
  const deja = parFiche.get(e);
  if (deja) return deja;
  const lignes = lignesContrat(x, e.id).filter(l => l.nature !== 'renouvellement');
  const fiche = regimeFiche(e);
  const segs: SegmentContrat[] = [];
  const ajouter = (s: SegmentContrat) => {
    // Deux lignes à la même date : la dernière enregistrée l'emporte.
    if (segs.length && segs.at(-1)!.du === s.du) segs[segs.length - 1] = s;
    else segs.push(s);
  };
  const appliquees = lignes.filter(l => l.applique);
  if (!appliquees.length) {
    const depuis = e.tempsDepuis && e.tempsDepuis > e.entree ? e.tempsDepuis : e.entree;
    if (depuis > e.entree) ajouter({ du: e.entree, regime: null, ligne: null, programme: false });
    ajouter({ du: depuis, regime: fiche, ligne: null, programme: false });
  } else {
    appliquees.forEach(l => ajouter({ du: l.effet, regime: l.regime, ligne: l, programme: false }));
    const derniere = segs.at(-1)!;
    // Changement daté sur la fiche après la dernière ligne (import, écriture hors de l'historique) : le régime d'avant est
    // celui de la ligne s'il diffère de la fiche, sinon inconnu (comme sans historique).
    if (e.tempsDepuis && e.tempsDepuis > derniere.du) {
      if (memeRegime(derniere.regime, fiche)) segs[segs.length - 1] = { ...derniere, regime: null };
      ajouter({ du: e.tempsDepuis, regime: fiche, ligne: null, programme: false });
    } else segs[segs.length - 1] = { ...derniere, regime: fiche };
  }
  lignes.filter(l => !l.applique && l.effet > segs.at(-1)!.du).forEach(l => ajouter({ du: l.effet, regime: l.regime, ligne: l, programme: true }));
  parFiche.set(e, segs);
  return segs;
}

/** Régime en vigueur le `date` dans une liste de périodes ; null : avant la première, ou régime inconnu. */
export function regimeDans(segs: readonly SegmentContrat[], date: ISODate): ContratFige | null {
  let r: ContratFige | null = null;
  for (const s of segs) { if (s.du <= date) r = s.regime; else break; }
  return r;
}

/** Régime de temps de travail en vigueur le `date` ; null : antérieur à l'historique et inconnu (la fiche sert alors). */
export const regimeAu = (x: AvecHistorique, e: Employe, date: ISODate): ContratFige | null => regimeDans(segmentsContrat(x, e), date);

/**
 * Régime à figer sur une feuille créée pour la semaine `week` (lundi) : celui de la semaine s'il diffère de la fiche
 * (semaine antérieure à un changement, ou postérieure à un avenant programmé) ; null sinon, la feuille suivant la fiche
 * comme avant l'historique (et figée à sa soumission).
 */
export function regimeAFiger(x: AvecHistorique, e: Employe, week: ISODate): ContratFige | null {
  const r = regimeAu(x, e, week);
  return r && !memeRegime(r, regimeFiche(e)) ? r : null;
}

/** Le salarié tel qu'il était sous le régime en vigueur le `date` (la fiche si le régime est inconnu). */
export function employeAu(x: AvecHistorique, e: Employe, date: ISODate): Employe {
  const r = regimeAu(x, e, date);
  return r && !memeRegime(r, regimeFiche(e)) ? { ...e, ...r } : e;
}
