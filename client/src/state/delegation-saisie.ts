// Saisie d'une délégation des validations (t135, dialogs/DelegationDialog.tsx) : suppléants proposés et contrôles avant
// envoi, sur l'instantané de la personne connectée. Le service RH a toutes les fiches ; le manager qui délègue pour
// lui-même (Mon espace, espace manager) n'a que la sienne et celles de son équipe : ses suppléants possibles viennent de
// `Dataset.suppleantsPossibles` (annuaire réduit, filtré par le serveur), et la présence du suppléant sur la période comme
// les validations croisées sont alors contrôlées par le serveur seul (`controleDelegation`, mêmes règles).
import type { Domain } from '../../../shared/domain.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { controleDelegation, suppleantPropose } from '../../../shared/rules/delegations-manager.ts';
import type { PerimetreDelegation, Personne } from '../../../shared/types.ts';

/** Suppléants possibles : présents, hors intérim et hors le manager ; le N+1 proposé en tête, puis par nom. */
export function suppleantsCandidats(d: Domain, managerId: number): { liste: Personne[]; n1: number } {
  const n1 = suppleantPropose(d.ds, managerId);
  const liste = d.ds.suppleantsPossibles?.filter(p => p.id !== managerId)
    ?? d.ds.employes.filter(e => e.id !== managerId && present(e, d.ti) && !d.contratOf(e).interim);
  return { liste: [...liste].sort((a, b) => Number(b.id === n1) - Number(a.id === n1) || a.nom.localeCompare(b.nom)), n1 };
}

/** Saisie du dialogue : identifiant du suppléant (texte vide : non choisi), dates et périmètre cochés. */
export interface SaisieDelegation { suppleant: string; du: string; au: string; perimetre: PerimetreDelegation[] }

/** Motifs de refus avant envoi, par champ (null : rien à redire) ; la période porte le contrôle commun. */
export function verifierDelegation(d: Domain, managerId: number, s: SaisieDelegation, candidats: readonly Personne[]) {
  const id = Number(s.suppleant) || 0;
  const suppleant = !s.suppleant ? 'Choisissez le suppléant' : null;
  const perimetre = !s.perimetre.length ? 'Cochez au moins un type de demande' : null;
  // Fiche absente de l'instantané (Mon espace) mais suppléant proposé par le serveur : contrôles de présence au serveur.
  const fiche = id ? d.emp(id) : undefined;
  const refus = controleDelegation(d.ds, { managerId, suppleantId: id, du: s.du, au: s.au, perimetre: s.perimetre },
    { suppleant: fiche, nom: x => d.personName(x), horsInstantane: !fiche && candidats.some(p => p.id === id) });
  return { suppleant, perimetre, periode: !suppleant && !perimetre ? refus : null };
}
