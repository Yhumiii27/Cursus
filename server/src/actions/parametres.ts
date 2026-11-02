// Paramètres de suivi et réinitialisation de la démonstration (administrateur RH).
import { basename } from 'node:path';
import { appliquerReglages, ReglageInvalide } from '../../../shared/reglages.ts';
import type { Settings } from '../../../shared/types.ts';
import { reactivationAbsences } from '../absences-paie.ts';
import { DEMO } from '../auth.ts';
import { refusPiecesLocales } from '../config.ts';
import { loadSettings } from '../dataset.ts';
import { sauvegarderBase, type Sauvegarde } from '../sauvegarde.ts';
import { seedDemo } from '../seed.ts';
import { ActionError, requireRhAdmin, type ActionHandler } from './context.ts';
import { amorcerEntites } from '../demarrage.ts';
// lot 12 — C1 (forfait annuel en heures)
import { refusChangementDebutForfait } from '../../../shared/rules/forfait-heures.ts';
import type { ClotureForfaitHeures } from '../../../shared/types.ts';

/** Réglages envoyés par l'écran Paramètres : chaque champ passe par son contrôle (table REGLAGES de shared/reglages.ts). */
const maj: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  let next: Settings;
  const avant = await loadSettings(ctx.db);
  try {
    next = appliquerReglages(avant, p);
  } catch (err) {
    if (err instanceof ReglageInvalide) throw new ActionError(err.message, 400);
    throw err;
  }
  // Pièces justificatives dans le dossier local : refusées en production sans clé de chiffrement (lot 8, config.ts).
  const refusPieces = next.piecesStockage === 'local' && avant.piecesStockage !== 'local' ? refusPiecesLocales() : null;
  if (refusPieces) throw new ActionError(refusPieces, 409);
  // lot 12 — C1 : début du suivi ou de la période du forfait annuel en heures déplacé alors que des clôtures sont enregistrées
  // (repérées par leur début de plage) : confirmation explicite de l'écran exigée.
  const refusForfait = refusChangementDebutForfait(avant, next, await ctx.db.all<ClotureForfaitHeures>('cloturesForfaitHeures'), p.forfaitHeuresChangementConfirme === true);
  if (refusForfait) throw new ActionError(refusForfait, 409);
  await ctx.db.setSetting('app', next);
  // Absences de nouveau dans le fichier de paie (t028) : celles saisies dans Sage entre-temps n'y repartent pas.
  const absences = await reactivationAbsences(ctx.db, avant, next, ctx.user, ctx.d.ti);
  return p.silent && !absences ? null : `Paramètres enregistrés${absences}`;
};

const reinitialiser: ActionHandler = async (ctx) => {
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
  await seedDemo(ctx.db);
  // lot 11 — organigramme : entité unique reposée, comme au démarrage (server/src/demarrage.ts).
  await amorcerEntites(ctx.db);
  return copie ? `Données de démonstration réinitialisées (sauvegarde ${basename(copie.fichier)})` : 'Données de démonstration réinitialisées';
};

export const parametresActions = {
  'parametres.maj': maj,
  'demo.reinitialiser': reinitialiser,
} satisfies Record<string, ActionHandler>;
