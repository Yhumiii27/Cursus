// Registre des actions métier exposées par POST /api/actions/:nom.
import { absencesActions } from './absences.ts';
import { budgetActions } from './budget.ts';
import { comptesActions } from './comptes.ts';
import { conformiteActions } from './conformite.ts';
import type { ActionHandler } from './context.ts';
import { entretiensActions } from './entretiens.ts';
import { equipesActions } from './equipes.ts';
import { parametresActions } from './parametres.ts';
import { tempsActions } from './temps.ts';
import { voyagesActions } from './voyages.ts';

export const ACTIONS: Record<string, ActionHandler> = {
  ...conformiteActions,
  ...voyagesActions,
  ...budgetActions,
  ...tempsActions,
  ...absencesActions,
  ...entretiensActions,
  ...equipesActions,
  ...parametresActions,
  ...comptesActions,
};

/** Actions de saisie fréquentes, non tracées dans le journal. */
export const QUIET_ACTIONS = new Set(['temps.setCell', 'entretien.modifier']);
