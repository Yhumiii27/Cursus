// Enchaînement « Planifier » → « Créer une session » → inscription (t107) : la session créée depuis le dialogue de
// planification y ramène, présélectionnée, au lieu de renvoyer vers l'écran Formations où il faudrait retrouver le
// salarié. Annuler la création ramène aussi au dialogue d'origine.
import type { Session } from '../../../shared/types.ts';
import type { DialogePlan, DialogState } from '../state/store.tsx';

/**
 * Session cochée à l'ouverture de « Planifier » : celle demandée (retour de la création) si elle est proposée et a
 * encore une place, sinon la première session ouverte de la formation, sinon aucune.
 */
export function sessionPreselectionnee(sessions: Pick<Session, 'id' | 'places' | 'inscrits'>[], demandee?: number | null): number | null {
  const ouverte = (s: Pick<Session, 'places' | 'inscrits'>) => s.inscrits < s.places;
  const choisie = demandee != null ? sessions.find(s => s.id === demandee && ouverte(s)) : undefined;
  return (choisie ?? sessions.find(ouverte))?.id ?? null;
}

/** Dialogue « Planifier » à rouvrir après la création (réponse de `session.creer` : `{ id }`), la session présélectionnée. */
export function apresCreation(retour: DialogePlan, result: unknown): DialogState {
  const id = (result as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'number' ? { ...retour, sessionId: id } : { ...retour };
}
