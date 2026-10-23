// Délégation des validations (t135) côté écran : la personne connectée décide-t-elle pour ce salarié ? Son valideur
// hiérarchique (`Domain.mgrOf`), ou son suppléant pendant une délégation du périmètre (`Dataset.delegues`, calculé par le
// serveur avec les mêmes règles que ses contrôles : shared/rules/delegations-manager.ts).
import type { Domain } from '../../../shared/domain.ts';
import type { Employe, PerimetreDelegation } from '../../../shared/types.ts';

/** Manager connecté (`me`) qui décide des demandes de ce salarié pour ce périmètre, directement ou par délégation. */
export function decideur(d: Domain, e: Pick<Employe, 'id' | 'equipe'>, me: number | null, perimetre: PerimetreDelegation): boolean {
  if (!me || e.id === me) return false;
  return d.mgrOf(e) === me || !!d.ds.delegues?.some(x => x.empId === e.id && x.perimetre.includes(perimetre));
}

/** Délégation par laquelle le manager connecté voit ce salarié (aucune : équipe directe ou hors délégation). */
export const delegueDe = (d: Domain, empId: number) => d.ds.delegues?.find(x => x.empId === empId) ?? null;

/** Membre de son équipe, directe ou reçue par délégation (tout périmètre). */
export const membreOuDelegue = (d: Domain, e: Pick<Employe, 'id' | 'equipe'>, me: number | null) =>
  !!me && e.id !== me && (d.mgrOf(e) === me || !!delegueDe(d, e.id));
