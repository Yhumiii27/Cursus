// Confirmations des entités (lot 11, chantier C1, étape 2 ; Référentiels → Entités et sites) : fermeture d'une entité,
// réservée à l'administrateur RH, refusée par le serveur tant qu'elle porte des équipes ou des établissements ouverts
// (shared/rules/entites.ts, `refusFermeture`). Fichier à part de state/confirmations.ts pour ne pas mêler les chantiers.
import { TYPES_ENTITE } from '../../../shared/rules/entites.ts';
import type { Entite } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

export function fermetureEntite(x: Pick<Entite, 'code' | 'nom' | 'type'>): Confirmation {
  const type = TYPES_ENTITE[x.type].toLowerCase();
  return {
    titre: `Fermer ${x.type === 'societe' ? 'la société' : 'l’établissement'}`,
    question: `Fermer ${x.type === 'societe' ? 'la société' : 'l’établissement'} ${x.nom} ?`,
    suites: [
      `${x.type === 'societe' ? 'Elle' : 'Il'} n’est plus ${x.type === 'societe' ? 'proposée' : 'proposé'} au rattachement des équipes${x.type === 'societe' ? ' ni des établissements' : ''}.`,
      `Rien n’est supprimé : ${type} et son historique restent au référentiel, et l’administrateur RH ${x.type === 'societe' ? 'la' : 'le'} rouvre à tout moment.`,
      'Aucun valideur ne change : les validations suivent les managers et les équipes parentes.',
    ],
    bouton: 'Fermer',
    action: 'entite.fermer',
    payload: { code: x.code },
  };
}
