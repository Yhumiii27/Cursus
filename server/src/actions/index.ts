// Registre des actions métier exposées par POST /api/actions/:nom.
import { absencesActions } from './absences.ts';
import { budgetActions } from './budget.ts';
import { comptesActions } from './comptes.ts';
import { conformiteActions } from './conformite.ts';
import type { ActionHandler } from './context.ts';
import { entretiensActions } from './entretiens.ts';
import { envoisActions } from './envois.ts';
import { equipesActions } from './equipes.ts';
import { parametresActions } from './parametres.ts';
import { sessionsActions } from './sessions.ts';
import { tempsActions } from './temps.ts';
import { voyagesActions } from './voyages.ts';

export const ACTIONS: Record<string, ActionHandler> = {
  ...conformiteActions,
  ...sessionsActions,
  ...voyagesActions,
  ...budgetActions,
  ...tempsActions,
  ...absencesActions,
  ...entretiensActions,
  ...equipesActions,
  ...parametresActions,
  ...comptesActions,
  ...envoisActions,
};

/** Actions de saisie fréquentes, non tracées dans le journal. */
export const QUIET_ACTIONS = new Set(['temps.setCell', 'entretien.modifier']);

/**
 * Familles d'actions sans effet sur un verdict Go / No Go (temps, compteurs de congés, entretiens, budget, équipes) :
 * après toute autre action, les verdicts transmis à Keystone sont recalculés (integrations/keystone-verdicts.ts).
 * Les actions d'absence en font partie : une absence pendant la présence sur un chantier bloque la ressource.
 */
const SANS_EFFET_VERDICT = ['temps.', 'cet.', 'report.', 'entretien.', 'budget.', 'equipe.', 'envoi.'];
export const changeVerdicts = (nom: string) => !SANS_EFFET_VERDICT.some(p => nom.startsWith(p));
