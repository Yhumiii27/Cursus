// Confirmations des entités (lot 11, chantier C1, étape 2 ; Référentiels → Entités et sites) : fermeture d'une entité,
// réservée à l'administrateur RH, refusée par le serveur tant qu'elle porte des équipes ou des établissements ouverts
// (shared/rules/entites.ts, `refusFermeture`). Fichier à part de state/confirmations.ts pour ne pas mêler les chantiers.
import { TYPES_ENTITE } from '../../../shared/rules/entites.ts';
import type { Entite } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

export function fermetureEntite(x: Pick<Entite, 'code' | 'nom' | 'type'>): Confirmation {
  const type = TYPES_ENTITE[x.type].toLowerCase();
  return {
    titre: t(x.type === 'societe' ? 'Close the company' : 'Close the establishment'),
    question: `${t(x.type === 'societe' ? 'Close the company' : 'Close the establishment')} ${x.nom}${t('?#question')}`,
    suites: [
      t(x.type === 'societe' ? 'It is no longer offered for attaching teams or establishments.' : 'It is no longer offered for attaching teams.'),
      `${t('Nothing is deleted: ')}${type}${x.type === 'societe' ? t(' and its history stay in the reference data, and the HR administrator reopens it at any time.#fem') : t(' and its history stay in the reference data, and the HR administrator reopens it at any time.#masc')}`,
      t('No approver changes: the approvals follow the managers and the parent teams.'),
    ],
    bouton: t('Close#verb'),
    action: 'entite.fermer',
    payload: { code: x.code },
  };
}
