// Entretiens suivis (lot 12, chantier C3, t194), étape 2 : ce que les écrans, les rappels et les indicateurs calculent à
// partir des objectifs et des souhaits de formation (règles de fond : shared/rules/objectifs.ts et souhaits.ts).
// - Rappels : objectifs en cours arrivant à échéance sans mise à jour récente (« À faire » du collaborateur, récapitulatif
//   des échéances du manager et du service RH, shared/rules/relances.ts), jamais avec le texte de l'objectif ; souhaits et
//   propositions à arbitrer avant la clôture, pour l'évaluateur (écran Entretiens).
// - Indicateurs de campagne, calculés et jamais stockés : taux d'entretiens annuels avec objectifs fixés, taux d'objectifs
//   évalués, résultats par équipe (masqués sous le seuil d'anonymat, `SEUIL_ANONYMAT`), souhaits exprimés, favorables,
//   versés, acceptés et réalisés.
import { addD } from '../dates.ts';
import type { DemandeCollab, Entretien, ISODate, Objectif, PlanAction, Session } from '../types.ts';
import { SEUIL_ANONYMAT } from './evaluation-formation.ts';
import { estEvalue, objectifsFixesA, type StatutEvaluation, STATUTS_EVALUATION, TYPES_FIXATION } from './objectifs.ts';
import { souhaitsDe, souhaitsSansAvis } from './souhaits.ts';

/** Délai sans mise à jour (jours) au-delà duquel un objectif proche de son échéance est rappelé. */
export const SANS_MISE_A_JOUR_JOURS = 30;
/** Horizon (jours) de l'« À faire » du collaborateur : échéances des 30 prochains jours, et celles déjà passées. */
export const HORIZON_OBJECTIFS_JOURS = 30;

/** Jour de la dernière mise à jour d'un objectif (avancement, ajustement, modification), ou de sa création. */
export const derniereMiseAJour = (o: Pick<Objectif, 'creeLe' | 'modifieLe'>): ISODate => (o.modifieLe ?? o.creeLe).slice(0, 10);

/**
 * Objectifs en cours (fixés à un entretien clos) qui ont une échéance, ne sont pas atteints à 100 % et n'ont pas été mis à
 * jour depuis `SANS_MISE_A_JOUR_JOURS` jours. `horizon` : échéance au plus tard ce jour-là (null : toutes).
 */
export function objectifsSansMiseAJour(objectifs: readonly Objectif[], entretiens: readonly Pick<Entretien, 'id' | 'statut'>[], today: ISODate,
  horizon: ISODate | null = null): Objectif[] {
  const clos = new Set(entretiens.filter(e => e.statut === 'realise').map(e => e.id));
  const limite = addD(today, -SANS_MISE_A_JOUR_JOURS);
  return objectifs.filter(o => o.statut === 'ouvert' && clos.has(o.entretienId) && !!o.echeance && o.avancement < 100
    && derniereMiseAJour(o) <= limite && (horizon === null || o.echeance <= horizon))
    .sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? '') || a.id - b.id);
}

/** « À faire » du collaborateur : ses objectifs à mettre à jour, échéance dans les 30 prochains jours ou dépassée. */
export const objectifsAMettreAJour = (objectifs: readonly Objectif[], entretiens: readonly Pick<Entretien, 'id' | 'statut'>[], empId: number, today: ISODate) =>
  objectifsSansMiseAJour(objectifs.filter(o => o.empId === empId), entretiens, today, addD(today, HORIZON_OBJECTIFS_JOURS));

/** Ce qu'un entretien planifié attend de l'évaluateur avant la clôture : souhaits sans avis, objectifs proposés à valider. */
export interface AArbitrer { entretien: Entretien; souhaits: number; propositions: number }

/** Entretiens planifiés du périmètre (`ids`) qui ont des souhaits sans avis ou des objectifs proposés par le salarié. */
export function aArbitrer(entretiens: readonly Entretien[], objectifs: readonly Objectif[], ids: ReadonlySet<number>): AArbitrer[] {
  return entretiens.filter(x => x.statut === 'planifie' && ids.has(x.empId)).map(x => ({
    entretien: x,
    souhaits: souhaitsSansAvis(x).length,
    propositions: objectifsFixesA(objectifs, x.id).filter(o => o.statut === 'propose').length,
  })).filter(a => a.souhaits || a.propositions).sort((a, b) => a.entretien.date.localeCompare(b.entretien.date) || a.entretien.id - b.entretien.id);
}

/** Résultats des objectifs évalués dans l'année, par équipe ; `masque` : moins de 3 salariés évalués, rien n'est donné. */
export interface ResultatsEquipe { equipe: string; salaries: number; resultats: Record<StatutEvaluation, number>; masque?: boolean }

export interface IndicateursSuivi {
  /** Entretiens annuels clos dans l'année, et ceux où au moins un objectif a été fixé. */
  annuels: number; annuelsAvecObjectifs: number;
  /** Objectifs à évaluer dans l'année (fixés à un entretien annuel clos l'année précédente), et ceux déjà évalués. */
  aEvaluer: number; evalues: number;
  resultats: ResultatsEquipe[];
  souhaits: { exprimes: number; favorables: number; verses: number; acceptes: number; realises: number };
}

/** Pourcentage arrondi, ou null sans dénominateur. */
export const taux = (n: number, sur: number): number | null => (sur ? Math.round(n / sur * 100) : null);

/** Sources des indicateurs : celles de l'instantané (`Dataset`), à défaut vides. */
export interface SourcesSuivi {
  entretiens: readonly Entretien[]; objectifs?: readonly Objectif[]; demandesCollab: readonly DemandeCollab[];
  plan: readonly Pick<PlanAction, 'id' | 'statut'>[]; sessions: readonly Pick<Session, 'id' | 'statut'>[];
  employes: readonly { id: number; equipe: string | null }[];
}

/**
 * Indicateurs de l'année `annee` pour les salariés `ids` (périmètre de l'écran) ; `seuil` : seuil d'anonymat des résultats
 * par équipe (3 par défaut, comme les évaluations de formation et les compteurs du profil consultation).
 */
export function indicateursSuivi(src: SourcesSuivi, ids: ReadonlySet<number>, annee: number, seuil = SEUIL_ANONYMAT): IndicateursSuivi {
  const objectifs = (src.objectifs ?? []).filter(o => ids.has(o.empId) && o.statut !== 'propose');
  const dansLAnnee = (x: Entretien, a: number) => x.date.startsWith(`${a}-`);
  const annuels = src.entretiens.filter(x => ids.has(x.empId) && TYPES_FIXATION.includes(x.type) && x.statut === 'realise' && dansLAnnee(x, annee));
  // Objectifs fixés à l'entretien, reconduits compris.
  const avecObjectifs = annuels.filter(x => objectifs.some(o => o.entretienId === x.id));
  // Objectifs de la période précédente : fixés à un entretien annuel clos l'année d'avant.
  const precedents = new Set(src.entretiens.filter(x => ids.has(x.empId) && TYPES_FIXATION.includes(x.type) && x.statut === 'realise' && dansLAnnee(x, annee - 1)).map(x => x.id));
  const aEvaluer = objectifs.filter(o => precedents.has(o.entretienId));
  // Résultats : objectifs évalués à un entretien de l'année (clos ou encore planifié, l'évaluation est posée).
  const deLAnnee = new Set(src.entretiens.filter(x => dansLAnnee(x, annee)).map(x => x.id));
  const evalues = objectifs.filter(o => estEvalue(o) && o.evalueEntretienId != null && deLAnnee.has(o.evalueEntretienId));
  const equipeDe = new Map(src.employes.map(e => [e.id, e.equipe || '']));
  const parEquipe = new Map<string, { salaries: Set<number>; resultats: Record<StatutEvaluation, number> }>();
  for (const o of evalues) {
    const eq = equipeDe.get(o.empId) ?? '';
    const c = parEquipe.get(eq) ?? { salaries: new Set<number>(), resultats: Object.fromEntries(STATUTS_EVALUATION.map(s => [s, 0])) as Record<StatutEvaluation, number> };
    c.salaries.add(o.empId);
    c.resultats[o.statut as StatutEvaluation]++;
    parEquipe.set(eq, c);
  }
  const resultats = [...parEquipe].sort(([a], [b]) => a.localeCompare(b)).map(([equipe, c]): ResultatsEquipe => (c.salaries.size < seuil
    ? { equipe, salaries: 0, resultats: Object.fromEntries(STATUTS_EVALUATION.map(s => [s, 0])) as Record<StatutEvaluation, number>, masque: true }
    : { equipe, salaries: c.salaries.size, resultats: c.resultats }));
  // Souhaits exprimés aux entretiens de l'année, puis suite de la demande versée.
  const souhaits = src.entretiens.filter(x => ids.has(x.empId) && dansLAnnee(x, annee)).flatMap(x => souhaitsDe(x));
  const demandes = new Map(src.demandesCollab.map(r => [r.id, r]));
  const versees = souhaits.filter(s => s.demandeId && !s.nonVerse).map(s => demandes.get(s.demandeId!)).filter((r): r is DemandeCollab => !!r);
  const acceptees = versees.filter(r => r.statut === 'acceptee');
  const realisees = acceptees.filter(r => {
    const plan = r.suite?.planId ? src.plan.find(l => l.id === r.suite!.planId) : undefined;
    const session = r.suite?.sessionId ? src.sessions.find(s => s.id === r.suite!.sessionId) : undefined;
    return plan?.statut === 'realise' || session?.statut === 'Clôturée';
  });
  return {
    annuels: annuels.length, annuelsAvecObjectifs: avecObjectifs.length,
    aEvaluer: aEvaluer.length, evalues: aEvaluer.filter(o => estEvalue(o)).length,
    resultats,
    souhaits: {
      exprimes: souhaits.length, favorables: souhaits.filter(s => s.avis === 'favorable').length,
      verses: souhaits.filter(s => s.demandeId && !s.nonVerse).length, acceptes: acceptees.length, realises: realisees.length,
    },
  };
}

/**
 * Plan & budget (components/IndicateursFormation.tsx) : demandes versées dans l'exercice depuis un souhait exprimé en
 * entretien, celles acceptées, et lignes du plan de l'exercice d'origine « entretien » (bilan formation, dossier OPCO).
 */
export function souhaitsVersesDeLExercice(src: Pick<SourcesSuivi, 'demandesCollab'> & { plan: readonly Pick<PlanAction, 'exercice' | 'origine'>[] }, exercice: number) {
  const versees = src.demandesCollab.filter(r => r.type === 'formation' && !!r.entretienId && r.date.startsWith(`${exercice}-`));
  return {
    versees: versees.length,
    acceptees: versees.filter(r => r.statut === 'acceptee').length,
    lignesPlan: src.plan.filter(l => l.exercice === exercice && l.origine === 'entretien').length,
  };
}
