// lot 12 — C5 (planning d'équipe) : lecture à la demande des créneaux hors de la fenêtre de l'instantané (8 semaines passées
// à 12 semaines à venir, shared/rules/planning.ts) par GET /api/planning/historique (server/src/planning-historique.ts),
// filtrée par droits comme l'instantané. La grille de l'équipe, l'affichage réglementaire (art. D3171-7, registre gardé au
// moins un an pour l'inspection du travail, art. D3171-16) et « Mon planning » s'en servent dès que la période affichée
// sort de la fenêtre. Adresse gardée contre une navigation provoquée depuis un autre site (`exigerNavigationInterne`) :
// l'appel porte l'en-tête d'espace, qu'aucun lien ne peut poser. Fichier à part de client/src/api.ts (mêmes messages, même délai).
import { useEffect, useState } from 'react';
import type { ISODate, Role } from '../../shared/types.ts';
import type { Creneau } from '../../shared/types-planning.ts';
import { DELAI_LECTURE_MS, messageHttp, MSG_DELAI, MSG_RESEAU } from './api.ts';

/** Paramètres d'adresse d'une demande : période, équipe facultative. */
export function requeteHistorique(du: ISODate, au: ISODate, equipe: string | null): string {
  const p = new URLSearchParams({ du, au });
  if (equipe) p.set('equipe', equipe);
  return `?${p}`;
}

/** Créneaux de la période (un an au plus), déjà filtrés par le serveur selon les droits de la personne connectée. */
export async function lireHistoriquePlanning(du: ISODate, au: ISODate, equipe: string | null, espace: Role): Promise<Creneau[]> {
  let res: Response;
  try {
    res = await fetch(`/api/planning/historique${requeteHistorique(du, au, equipe)}`, { credentials: 'same-origin', headers: { 'x-cursus-espace': espace }, signal: AbortSignal.timeout(DELAI_LECTURE_MS) });
  } catch (err) {
    throw new Error((err as { name?: string } | null)?.name === 'TimeoutError' ? MSG_DELAI : MSG_RESEAU);
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(json.error || messageHttp(res.status));
  }
  return ((await res.json()) as { creneaux: Creneau[] }).creneaux;
}

/** Créneaux lus, ou en cours de lecture (null), ou l'erreur de la lecture. */
export type Historique = { creneaux: Creneau[] | null; erreur: string | null };

/**
 * Créneaux de la période `q` lus à la demande (null : rien à lire, la période est dans l'instantané). Relus quand la période,
 * l'équipe ou la révision de l'instantané changent (une écriture a pu toucher la période).
 */
export function useHistoriquePlanning(q: { du: ISODate; au: ISODate; equipe: string | null } | null, espace: Role, revision: unknown): Historique | null {
  const cle = q ? `${q.du}|${q.au}|${q.equipe ?? ''}|${espace}` : null;
  const [etat, setEtat] = useState<{ cle: string; h: Historique } | null>(null);
  useEffect(() => {
    if (!q || !cle) return;
    let actif = true;
    void lireHistoriquePlanning(q.du, q.au, q.equipe, espace).then(
      creneaux => { if (actif) setEtat({ cle, h: { creneaux, erreur: null } }); },
      (err: unknown) => { if (actif) setEtat({ cle, h: { creneaux: null, erreur: err instanceof Error ? err.message : String(err) } }); },
    );
    return () => { actif = false; };
  // oxlint-disable-next-line react/exhaustive-deps -- q et espace se résument à la clé
  }, [cle, revision]);
  if (!cle) return null;
  return etat?.cle === cle ? etat.h : { creneaux: null, erreur: null };
}
