// Garde-fous de npm run reset-demo (server/src/reset.ts), qui efface toute la base pour recharger la démonstration :
// refus hors mode démonstration et en production (sauf l'application de bureau, démonstration sur la boucle locale),
// refus si un serveur en service utilise la base (sauf --force), confirmation exigée (--yes, ou le mot EFFACER tapé dans
// un terminal). Contrôles sans effet, testés sans lancer la commande (tests/sauvegarde.test.ts).
import { demoActive, demoPublique, demoSurBoucleLocale, type Env, enProduction } from './config.ts';
import type { Verrou } from './sauvegarde.ts';

/** Mot à taper pour confirmer dans un terminal, faute de --yes. */
export const MOT_CONFIRMATION = 'EFFACER';
export const USAGE_REINITIALISATION = 'Usage : CURSUS_DEMO=1 npm run reset-demo -- --yes [--force]';

export class ReinitialisationRefusee extends Error {}

export interface OptionsReinitialisation {
  /** --yes : effacement confirmé d'avance (scripts, terminal non interactif). */
  oui: boolean;
  /** --force : réinitialiser même si un serveur en service utilise la base. */
  force: boolean;
}

/** Options de la ligne de commande ; une option inconnue est refusée (une faute de frappe sur --yes n'efface rien). */
export function lireOptions(args: readonly string[]): OptionsReinitialisation {
  const inconnues = args.filter(a => a !== '--yes' && a !== '--force');
  if (inconnues.length) throw new ReinitialisationRefusee(`option inconnue ${inconnues.join(' ')}. ${USAGE_REINITIALISATION}`);
  return { oui: args.includes('--yes'), force: args.includes('--force') };
}

/**
 * Contrôle fait avant tout accès à la base : mode démonstration exigé ; production refusée, sauf l'application de bureau
 * (démonstration sur la boucle locale posée explicitement, `demoSurBoucleLocale`) et l'instance de démonstration publiée
 * (`demoPublique`, données fictives).
 */
export function controlerMode(env: Env) {
  if (!demoActive(env)) throw new ReinitialisationRefusee('elle efface toute la base et n’est permise qu’en mode démonstration (CURSUS_DEMO=1 npm run reset-demo -- --yes).');
  if (enProduction(env) && !demoSurBoucleLocale(env) && !demoPublique(env)) {
    throw new ReinitialisationRefusee('NODE_ENV=production : une base de production ne se réinitialise pas (seules l’application de bureau, démonstration sur 127.0.0.1, et l’instance de démonstration publiée, CURSUS_DEMO_PUBLIQUE=1, le permettent).');
  }
}

/**
 * Serveur en service sur la base (`serveurActif`, d'après son verrou), après le contrôle des migrations : refusé sans
 * --force. Il garderait en mémoire une révision et des sessions qui ne correspondent plus à rien, et ses tâches de fond
 * (file d'envoi, e-mails planifiés) écriraient pendant le rechargement.
 */
export function controlerServeur(serveur: Pick<Verrou, 'pid'> | null, options: Pick<OptionsReinitialisation, 'force'>) {
  if (serveur && !options.force) {
    throw new ReinitialisationRefusee(`le serveur Cursus (processus ${serveur.pid}) utilise cette base. Arrêtez-le d’abord (service arrêté, ou Ctrl+C), `
      + 'ou ajoutez --force pour réinitialiser quand même, puis redémarrez-le.');
  }
}

/** Réponse tapée dans le terminal : seul le mot exact confirme (espaces autour admis). */
export const confirmationTapee = (reponse: string | null | undefined) => (reponse ?? '').trim() === MOT_CONFIRMATION;
