// Exercices du plan de formation : exercices consultables (plan ou enveloppes en base, plus l'année en cours et la
// suivante), clôture d'un exercice (`plan.cloturerExercice`, administrateur RH) avec le report, coché action par action,
// des actions prévues ou engagées sur l'exercice suivant ; coût et effectif réels saisis à la clôture d'une action.
// Un exercice clos est en lecture seule : ni avancement, ni import, ni enveloppes. Partagé par l'écran et le serveur.
import { fmtIso } from '../format.ts';
import type { Dataset, ExerciceClos, PlanAction } from '../types.ts';

/** Coût réel au-delà duquel la saisie est refusée (faute de frappe : un zéro de trop). */
export const COUT_REEL_MAX = 1_000_000;
export const EFFECTIF_REEL_MAX = 10_000;

/** Clôture de l'exercice, ou undefined s'il est ouvert. */
export const clotureDe = (ds: Pick<Dataset, 'exercicesClos'>, exercice: number): ExerciceClos | undefined =>
  ds.exercicesClos.find(x => x.exercice === exercice);

/** Exercices proposés au sélecteur : ceux qui ont un plan ou des enveloppes, l'année en cours et la suivante. */
export function exercicesProposes(ds: Pick<Dataset, 'plan' | 'budgets' | 'exercicesClos'>, annee: number): number[] {
  const tous = [annee, annee + 1, ...ds.plan.map(l => l.exercice), ...Object.keys(ds.budgets).map(Number), ...ds.exercicesClos.map(x => x.exercice)];
  return [...new Set(tous.filter(n => Number.isInteger(n) && n > 2000))].sort((a, z) => a - z);
}

/** Premier exercice ouvert à partir de `annee` : celui où s'ajoute une demande de formation acceptée. */
export function exerciceOuvert(ds: Pick<Dataset, 'exercicesClos'>, annee: number): number {
  let ex = annee;
  while (clotureDe(ds, ex)) ex++;
  return ex;
}

/** Actions reportables à la clôture : prévues ou engagées (les réalisées restent dans l'exercice). */
export const reportables = (ds: Pick<Dataset, 'plan'>, exercice: number): PlanAction[] =>
  ds.plan.filter(l => l.exercice === exercice && (l.statut === 'prevu' || l.statut === 'engage'));

/**
 * Clôture possible de l'exercice : message du refus, ou null. Seul un exercice passé se clôt : clos en cours d'année,
 * ses actions engagées reportées réaliseraient leurs sessions de l'année sur l'enveloppe suivante, et la clôture est
 * définitive.
 */
export function controleCloture(ds: Pick<Dataset, 'exercicesClos'>, exercice: number, annee: number): string | null {
  if (!Number.isInteger(exercice) || exercice <= 2000) return 'Exercice invalide';
  const clos = clotureDe(ds, exercice);
  if (clos) return `Exercice ${exercice} déjà clos (le ${fmtIso(clos.le)} par ${clos.par})`;
  if (exercice >= annee) return `Exercice ${exercice} en cours ou à venir : il se clôt à partir du 1er janvier ${exercice + 1}`;
  return null;
}

/** Coût réel saisi : montant en euros, 0 ou plus, borné ; null si la saisie ne convient pas. */
export function montantReel(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.').replace(/\s/g, '')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= COUT_REEL_MAX ? Math.round(n * 100) / 100 : null;
}

/** Effectif réel saisi : entier, 0 ou plus ; null si la saisie ne convient pas. */
export function effectifReel(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= EFFECTIF_REEL_MAX ? n : null;
}

/** Coût retenu d'une action : le coût réel une fois réalisée (le coût prévu pour une action réalisée sans coût réel). */
export const coutRetenu = (l: Pick<PlanAction, 'statut' | 'cout' | 'coutReel'>) => (l.statut === 'realise' ? l.coutReel ?? l.cout : l.cout);
