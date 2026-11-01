// Forfait annuel en heures dans l'instantané envoyé au navigateur (lot 12, chantier C1), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Le service
// RH (droit « rh ») reçoit l'instantané complet : toutes les lignes de clôture, motifs compris. Ailleurs :
// - collaborateur, et manager pour lui-même : ses lignes confirmées, sans motif ni auteur (ce qui lui sera payé) ;
// - manager pour son équipe : rien — le cumul de l'équipe se lit sur les feuilles, jamais les quantités de paie, ni le total
//   des absences déduites (il peut laisser deviner un arrêt) ;
// - paie (droit « paie ») : les lignes confirmées, sans motif ;
// - référent HSE et lecture seule : rien ; la comptabilité garde sa liste blanche (server/src/frais-vues.ts), sans elles.
import type { ClotureForfaitHeures } from '../../shared/types.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Ligne sans les textes de l'administrateur RH (motifs de réouverture et d'annulation). */
const sansMotif = (l: ClotureForfaitHeures): ClotureForfaitHeures => ({ ...l, rouverteMotif: null, annuleeMotif: null });
/** Ligne vue par le salarié lui-même : ni motif, ni auteur. */
const pourLeSalarie = (l: ClotureForfaitHeures): ClotureForfaitHeures => ({ ...sansMotif(l), confirmeePar: null, rouvertePar: null, annuleePar: null });

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function forfaitHeuresVueSalarie({ full, user, mine }: ContexteVueSalarie): Projection {
  return {
    cloturesForfaitHeures: user.empId == null ? [] : mine(full.cloturesForfaitHeures ?? []).filter(l => l.empId === user.empId && l.statut === 'confirmee').map(pourLeSalarie),
  };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function forfaitHeuresVueProfil({ full, droits }: ContexteVueProfil): Projection {
  return {
    cloturesForfaitHeures: droits.includes('paie') ? (full.cloturesForfaitHeures ?? []).filter(l => l.statut === 'confirmee').map(sansMotif) : [],
  };
}
