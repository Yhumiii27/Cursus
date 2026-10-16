// Paramètres de suivi et réinitialisation de la démonstration (administrateur RH).
import { basename } from 'node:path';
import { appliquerReglages, ReglageInvalide } from '../../../shared/reglages.ts';
import type { Settings } from '../../../shared/types.ts';
import { DEMO } from '../auth.ts';
import { loadSettings } from '../dataset.ts';
import { sauvegarderBase, type Sauvegarde } from '../sauvegarde.ts';
import { seedDemo } from '../seed.ts';
import { ActionError, requireRhAdmin, type ActionHandler } from './context.ts';

/** Réglages envoyés par l'écran Paramètres : chaque champ passe par son contrôle (table REGLAGES de shared/reglages.ts). */
const maj: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  let next: Settings;
  try {
    next = appliquerReglages(loadSettings(ctx.db), p);
  } catch (err) {
    if (err instanceof ReglageInvalide) throw new ActionError(err.message, 400);
    throw err;
  }
  ctx.db.setSetting('app', next);
  return p.silent ? null : 'Paramètres enregistrés';
};

const reinitialiser: ActionHandler = (ctx) => {
  requireRhAdmin(ctx);
  if (!DEMO) throw new ActionError('Réinitialisation disponible uniquement en mode démonstration', 403);
  // Copie de la base telle qu'avant la réinitialisation (dernier état validé, hors de la transaction en cours).
  let copie: Sauvegarde | null;
  try {
    copie = sauvegarderBase(ctx.db, 'avant-reinitialisation');
  } catch (err) {
    console.error(err);
    throw new ActionError('Sauvegarde préalable impossible : réinitialisation annulée', 500);
  }
  seedDemo(ctx.db);
  return copie ? `Données de démonstration réinitialisées (sauvegarde ${basename(copie.fichier)})` : 'Données de démonstration réinitialisées';
};

export const parametresActions: Record<string, ActionHandler> = {
  'parametres.maj': maj,
  'demo.reinitialiser': reinitialiser,
};
