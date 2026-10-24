// Décisions refusées sur soi-même (lot 8, chantier C) : règle commune au serveur (refuserSoiMeme de
// server/src/actions/context.ts) et à l'interface, qui masque sur sa propre fiche les boutons que le serveur refuserait
// et dit à qui la décision revient. Réponse de l'entreprise du 24 octobre 2026 : aucune exception pour soi-même, même
// pour la seule personne habilitée ; un autre membre habilité, sinon la direction par un compte RH dédié.
import type { HabMesureAction } from '../constants.ts';
import type { CurrentUser } from '../types.ts';

/** Membre du service RH sur sa propre fiche (compte de l'espace RH rattaché à ce salarié). */
export const fichePropre = (u: Pick<CurrentUser, 'role' | 'salarieId'>, empId: number) => u.role === 'rh' && u.salarieId != null && u.salarieId === empId;

/**
 * Mesures sur sa propre habilitation : se suspendre reste permis (cela restreint) ; lever la suspension et retirer
 * reviennent à un autre membre habilité (le retrait pourrait masquer une suspension).
 */
export const MESURES_SOI_MEME: readonly HabMesureAction[] = ['suspendre'];

/** À qui revient la décision, rappelé à la place des boutons masqués. */
const AUTRE = 'à défaut, la direction, par un compte RH dédié';
export const AIDE_SOI_MEME = {
  medical: `Votre propre suivi médical (demande de visite, avis du médecin du travail, type de suivi) est tenu par un autre membre du service RH — ${AUTRE}.`,
  titres: `Vos propres certifications et habilitations (ajout, délivrance, levée d’une suspension, retrait) sont enregistrées par un autre membre du service RH ou le référent HSE / formation — ${AUTRE}. Vous pouvez suspendre vous-même votre habilitation.`,
  fiche: `Sur votre propre fiche, seuls l’adresse e-mail et les jours non travaillés se modifient : le contrat, le temps de travail, l’équipe, le matricule de paie et la période d’essai passent par un autre membre du service RH — ${AUTRE}.`,
  demande: `Votre propre demande : décidée par un autre membre habilité — ${AUTRE}.`,
} as const;
