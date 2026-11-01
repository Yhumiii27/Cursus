// lot 12 — C2 (notes de frais : activation) : prérequis de l'activation du module, affichés dans Paramètres → Notes de
// frais (client/src/pages/parametres/NotesFrais.tsx). Le réglage `notesFraisActives` reste faux par défaut tant que l'essai de
// charge ne tient pas tous ses budgets (npm run charge:frais, docs/ARCHITECTURE.md) ; en production, l'activation est une
// décision de l'administrateur RH, guidée par cette liste : rien n'y est bloquant, chaque point dit ce qui part
// autrement (« à saisir dans Sage », comptes proposés, alerte « barème de l'année manquant »).
import { RUBRIQUES_PAIE } from '../constants.ts';
import type { BaremeKm, RubriquePaie, Settings } from '../types.ts';
import { baremeSaisi } from './frais-km.ts';
import { rubriquesPaie } from './paie.ts';

/** Un prérequis : fait ou non, et ce qu'il reste à faire. */
export interface PrerequisFrais { cle: 'comptes' | 'rubriques' | 'bareme'; libelle: string; ok: boolean; detail: string }

/** Rubriques de paie des notes de frais (FRAIS_*), dans l'ordre de RUBRIQUES_PAIE. */
export const RUBRIQUES_FRAIS = Object.keys(RUBRIQUES_PAIE).filter(c => c.startsWith('FRAIS_'));

/**
 * Prérequis de l'activation pour l'année `annee` :
 * - comptes de charge des catégories saisis (sinon les comptes 625x proposés partent tels quels) ;
 * - rubriques FRAIS_* actives et leur code Sage confirmé par la paie (sinon les remboursements sont « à saisir dans Sage ») ;
 * - barème kilométrique de l'année saisi (sinon les indemnités kilométriques sont bloquées par l'alerte du barème).
 */
export function prerequisFrais(s: Pick<Settings, 'fraisComptes'>, rubriques: readonly RubriquePaie[], baremes: readonly BaremeKm[] | undefined, annee: number): PrerequisFrais[] {
  const table = rubriquesPaie(rubriques).filter(r => RUBRIQUES_FRAIS.includes(r.code));
  const aFaire = table.filter(r => !r.active || !r.confirmee);
  const comptes = Object.keys(s.fraisComptes ?? {}).length;
  return [
    {
      cle: 'comptes', libelle: 'Comptes de charge des catégories', ok: comptes > 0,
      detail: comptes > 0 ? `${comptes} catégorie${comptes > 1 ? 's' : ''} avec son compte` : 'Aucun compte saisi : les comptes 625x proposés partiront tels quels, à faire confirmer par la comptabilité',
    },
    {
      cle: 'rubriques', libelle: 'Rubriques de paie FRAIS_*', ok: aFaire.length === 0,
      detail: aFaire.length === 0 ? 'Actives, codes Sage confirmés par la paie'
        : `À activer ou confirmer par la paie (Paramètres → Sage Paie, rubriques) : ${aFaire.map(r => r.code).join(', ')} ; d'ici là, les remboursements sont « à saisir dans Sage »`,
    },
    {
      cle: 'bareme', libelle: `Barème kilométrique ${annee}`, ok: baremeSaisi(baremes, annee),
      detail: baremeSaisi(baremes, annee) ? 'Saisi' : `Barème ${annee} manquant : les indemnités kilométriques de l'année sont signalées et ne se soumettent pas`,
    },
  ];
}
