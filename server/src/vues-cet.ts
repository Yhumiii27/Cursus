// lot 13 — CET (monétisation) : demandes de monétisation du compte épargne-temps dans l'instantané envoyé au navigateur,
// appelé par server/src/dataset.ts (contexte : server/src/vues-lot12.ts). Le service RH (droit « rh ») reçoit l'instantané
// complet : toutes les demandes, motifs et auteurs compris. Ailleurs :
// - collaborateur, et manager pour lui-même : ses demandes, motif d'un refus ou d'une annulation compris, sans les noms
//   des membres du service RH qui ont demandé ou décidé ;
// - manager pour son équipe : jours, année et état seulement (le solde du CET de ses membres en dépend : shared/rules/conges.ts),
//   ni motif, ni auteur, ni lot de paie ;
// - paie et lecture seule (droits « paie » ou « consultation ») : toutes, sans motif ; référent HSE : rien. La comptabilité
//   garde sa liste blanche (server/src/frais-vues.ts), sans elles.
import type { MonetisationCet } from '../../shared/types.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Demande vue par l'intéressé : ni l'auteur de la demande (s'il n'est pas lui), ni le décideur. */
const pourLeSalarie = (m: MonetisationCet): MonetisationCet => ({ ...m, demandePar: m.demandeParInteresse ? m.demandePar : '', decidePar: null });
/** Demande d'un membre de l'équipe vue par son manager : jours, année, dates et état seulement. */
const pourLeManager = (m: MonetisationCet): MonetisationCet => ({ ...pourLeSalarie(m), demandePar: '', motif: null, lotId: null, sage: false, horsFichier: false });

/** Champs du lot 13 vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function cetVueSalarie({ full, user, mine }: ContexteVueSalarie): Projection {
  return {
    monetisationsCet: mine(full.monetisationsCet ?? []).map(m => (m.empId === user.empId ? pourLeSalarie(m) : pourLeManager(m))),
  };
}

/** Champs du lot 13 vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function cetVueProfil({ full, droits }: ContexteVueProfil): Projection {
  const paie = droits.includes('paie') || droits.includes('consultation');
  return { monetisationsCet: paie ? (full.monetisationsCet ?? []).map(m => ({ ...m, motif: null })) : [] };
}
