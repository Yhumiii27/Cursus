// Fenêtre des notes de frais dans l'instantané (lot 12, chantier C2, étape 1) : une note payée depuis plus de 13 mois sort
// de la lecture brute, avec ses dépenses et leurs justificatifs (`FENETRES` de server/src/lecture-brute.ts). Elle reste en
// base (conservation comptable de 10 ans, server/src/conservation.ts) et se lit à la demande par la route d'historique
// (server/src/frais-historique.ts). Les règles qui ont besoin de l'historique (indemnités kilométriques de l'année,
// doublons, notes à exporter, déductions d'avance) le lisent en base (server/src/frais-base.ts). Une note hors de la
// fenêtre est archivée : toute écriture qui la vise est refusée (409).
import { addM } from '../dates.ts';
import type { NoteFrais } from '../types.ts';

/** Mois après le paiement pendant lesquels une note reste dans l'instantané (choix par défaut du lot 12). */
export const FENETRE_FRAIS_MOIS = 13;
/** Notes par page de la route d'historique. */
export const HISTORIQUE_FRAIS_PAGE = 100;
/** Période d'une requête d'historique : 24 mois au plus. */
export const HISTORIQUE_FRAIS_MAX_MOIS = 24;

/** Borne de la fenêtre au jour `today` (jour de Paris, AAAA-MM-JJ) : une note payée avant cette date est archivée. */
export const borneFrais = (today: string): string => addM(today, -FENETRE_FRAIS_MOIS);

/** Note payée avant la borne du jour `today` : hors de l'instantané, consultée par l'historique seulement. */
export const noteArchivee = (n: Pick<NoteFrais, 'statut' | 'payeeLe'>, today: string): boolean =>
  n.statut === 'payee' && !!n.payeeLe && n.payeeLe < borneFrais(today);

/** Message du refus d'une écriture sur une note archivée. */
export const refusNoteArchivee = (id: number) =>
  `Note de frais n° ${id} archivée (payée depuis plus de ${FENETRE_FRAIS_MOIS} mois) : elle se consulte dans l’historique, sans modification`;

/** Mois AAAA-MM d'un paramètre (AAAA-MM ou AAAA-MM-JJ), ou null. */
export function moisDe(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(\d{2}))?$/.exec(v);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Nombre de mois de `du` à `au` inclus (AAAA-MM). */
export const moisEntre = (du: string, au: string) => (Number(au.slice(0, 4)) * 12 + Number(au.slice(5, 7))) - (Number(du.slice(0, 4)) * 12 + Number(du.slice(5, 7))) + 1;

/**
 * Période d'une recherche dans l'historique (mois des dépenses de la note, `periode`) : `du` et `au` en AAAA-MM ou
 * AAAA-MM-JJ (le mois seul compte) ; par défaut les 24 derniers mois jusqu'au mois de `today`. Erreur en clair si la
 * période est invalide, à l'envers ou dépasse 24 mois.
 */
export function periodeHistorique(q: { du?: unknown; au?: unknown }, today: string): { du: string; au: string } | { erreur: string } {
  const vide = (v: unknown) => v === undefined || v === null || v === '';
  const au = vide(q.au) ? today.slice(0, 7) : moisDe(q.au);
  if (!au) return { erreur: 'Fin de période invalide (AAAA-MM)' };
  const du = vide(q.du) ? addM(`${au}-01`, -(HISTORIQUE_FRAIS_MAX_MOIS - 1)).slice(0, 7) : moisDe(q.du);
  if (!du) return { erreur: 'Début de période invalide (AAAA-MM)' };
  if (du > au) return { erreur: 'Période à l’envers : le début suit la fin' };
  if (moisEntre(du, au) > HISTORIQUE_FRAIS_MAX_MOIS) return { erreur: `Période de ${HISTORIQUE_FRAIS_MAX_MOIS} mois au plus par recherche` };
  return { du, au };
}
