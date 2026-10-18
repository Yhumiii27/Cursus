// Réponses arrivées dans le désordre : deux actions parties presque ensemble (deux cellules d'heures saisies l'une après
// l'autre) peuvent être traitées par le serveur dans un ordre et revenir dans l'autre. Chaque instantané porte la révision
// de la base (`Dataset.revision`, augmentée à chaque transaction d'écriture : server/src/db.ts) ; un instantané plus ancien
// que celui affiché est ignoré, sans quoi la cellule enregistrée par la seconde action paraîtrait vidée jusqu'à la
// relecture suivante. Une numérotation des envois par le client ne suffirait pas : l'ordre de traitement par le serveur
// peut différer de l'ordre d'envoi, et la réponse la plus récente serait alors écartée.
import type { Dataset } from '../../../shared/types.ts';

/**
 * Vrai si l'instantané reçu est plus ancien que celui affiché : il ne doit pas le remplacer. Une révision égale (même état
 * de la base, relu après un délai) est appliquée ; un instantané sans révision (serveur d'une version précédente) aussi.
 */
export function instantanePerime(recu: Pick<Dataset, 'revision'>, affiche: Pick<Dataset, 'revision'> | null | undefined): boolean {
  if (!affiche || typeof recu.revision !== 'number' || typeof affiche.revision !== 'number') return false;
  return recu.revision < affiche.revision;
}
