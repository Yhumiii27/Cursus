// Badgeage virtuel et pointages dans l'instantané envoyé au navigateur (lot 12, chantier C6), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Seules
// les demandes de correction de pointage entrent dans l'instantané (file de validation) : les pointages bruts, l'état du
// jour et le débit-crédit dépendent de l'heure et se lisent à la demande (GET /api/pointages et /etat,
// server/src/pointages.ts). Le service RH (droit « rh ») reçoit l'instantané complet.
// - Manager : demandes de son équipe directe et des salariés dont il valide les feuilles par délégation (périmètre
//   « feuilles »), et les siennes ; jamais celles des salariés qu'il ne voit qu'en consultation (N+2).
// - Collaborateur : les siennes.
// - Profils restreints (paie, référent HSE, lecture seule) : aucune (ils lisent la feuille de temps) ; la comptabilité a
//   sa liste blanche (server/src/frais-vues.ts), sans elles.
import { delegationPour } from '../../shared/rules/delegations-manager.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function pointageVueSalarie(x: ContexteVueSalarie): Projection {
  const { full, d, user, mine } = x;
  const corrections = mine(full.correctionsPointage ?? []);
  if (user.role !== 'manager' || !user.empId) return { correctionsPointage: corrections };
  const moi = user.empId;
  // Valideur des feuilles : manager direct, ou suppléant au périmètre « feuilles » (t135) ; jamais la consultation N+2.
  const valide = new Map<number, boolean>();
  const voit = (empId: number) => {
    if (empId === moi) return true;
    let v = valide.get(empId);
    if (v === undefined) {
      const e = d.emp(empId);
      v = !!e && (d.mgrOf(e) === moi || !!delegationPour(full, e, moi, full.today, 'feuilles'));
      valide.set(empId, v);
    }
    return v;
  };
  return { correctionsPointage: corrections.filter(c => voit(c.empId)) };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule) : aucun. */
export function pointageVueProfil(_x: ContexteVueProfil): Projection {
  return { correctionsPointage: [] };
}
