// Forfait annuel en heures dans l'instantané envoyé au navigateur (lot 12, chantier C1), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Le service
// RH (droit « rh ») reçoit l'instantané complet : toutes les lignes de clôture, motifs compris. Ailleurs :
// - collaborateur, et manager pour lui-même : ses lignes confirmées, sans motif ni auteur (ce qui lui sera payé) ;
// - manager pour son équipe : rien — le cumul de l'équipe se lit sur les feuilles, jamais les quantités de paie, ni le total
//   des absences déduites (il peut laisser deviner un arrêt) ;
// - paie (droit « paie ») : les lignes confirmées, sans motif ;
// - référent HSE et lecture seule : rien ; la comptabilité garde sa liste blanche (server/src/frais-vues.ts), sans elles.
//   La lecture seule, qui reçoit les lots de paie, les reçoit sans les heures de clôture nominatives : ni les éléments
//   « à saisir dans Sage » de la famille « forfaitHeures » (salarié, rubrique HFA ou HCA, quantité), ni les lignes que le
//   lot emporte ; seul le décompte du résumé (éléments, salariés) reste, comme pour les autres familles.
import type { ClotureForfaitHeures, LotPaie } from '../../shared/types.ts';
import { sansCodesAbsences } from './absences-paie.ts';
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

/** Lot de paie sans les heures de clôture nominatives (éléments à saisir de la famille, lignes emportées). */
function lotSansForfaitHeures(l: LotPaie): LotPaie {
  const aSaisir = l.resume.aSaisir;
  if (!l.forfaitHeures && !aSaisir?.some(x => x.famille === 'forfaitHeures')) return l;
  const { forfaitHeures: _lignes, ...lot } = l;
  const reste = aSaisir?.filter(x => x.famille !== 'forfaitHeures');
  const { aSaisir: _a, ...resume } = l.resume;
  return { ...lot, resume: reste?.length ? { ...resume, aSaisir: reste } : resume };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function forfaitHeuresVueProfil({ full, droits }: ContexteVueProfil): Projection {
  const paie = droits.includes('paie');
  return {
    cloturesForfaitHeures: paie ? (full.cloturesForfaitHeures ?? []).filter(l => l.statut === 'confirmee').map(sansMotif) : [],
    // Lecture seule (lots de paie sans le droit « paie ») : lots tels que les lui rend server/src/dataset.ts (rubriques
    // d'absence retirées), sans les heures de clôture ; les autres profils restreints n'ont pas de lots (ou tous, la paie).
    ...(!paie && droits.includes('consultation') ? { lotsPaie: sansCodesAbsences(full).lotsPaie.map(lotSansForfaitHeures) } : {}),
  };
}
