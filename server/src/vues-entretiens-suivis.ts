// Entretiens suivis et feedback 360° dans l'instantané envoyé au navigateur (lot 12, chantier C3), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts), sur le
// modèle de server/src/frais-vues.ts. Le service RH (droit « rh ») reçoit l'instantané complet.
// - Manager et collaborateur : objectifs comme les entretiens (`direct(mine(…))`, dataset.ts) : les siens ; ceux de l'équipe
//   directe et des délégations « entretiens » pour le manager ; ni la consultation N+2, ni un suppléant d'un autre
//   périmètre, qui ne reçoivent que des compteurs par équipe (`compteursObjectifs`, seuil d'anonymat). Les souhaits de
//   formation voyagent avec l'entretien (colonne `souhaits`), donc avec les mêmes règles.
// - Profils restreints : aucun objectif ; la lecture seule (direction, DPO, auditeur) reçoit les compteurs par équipe, et
//   ses entretiens sans compte rendu (dataset.ts) ni souhaits ni synthèse 360° ; référent HSE et paie : rien.
// - Feedback 360° (étape 3) : le service RH, qui conduit lui aussi des entretiens (évaluateur d'un salarié sans manager,
//   d'un membre de son équipe), reçoit toutes les sollicitations masquées comme l'évaluateur (`entretiensSuivisVueRh`) :
//   qui est sollicité, jamais qui a répondu, avec un compteur global par collecte ; l'évaluateur et l'évalué, celles des
//   entretiens de leur périmètre direct, sans savoir lesquelles ont répondu (`sollicitationMasquee`), avec le même
//   compteur (`suiviFeedback`) ; le répondant, les siennes seulement. Les réponses versées
//   n'entrent dans aucun instantané (synthèse jointe à l'entretien) ; ni la consultation N+2, ni les profils restreints.
import { sollicitationMasquee, suivi360 } from '../../shared/rules/feedback360.ts';
import { compteursObjectifs } from '../../shared/rules/objectifs.ts';
import { needsFinCarriere } from '../../shared/rules/entretiens.ts';
import { deleguesA } from '../../shared/rules/delegations-manager.ts';
import type { Dataset, Entretien, Objectif } from '../../shared/types.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Entretien vu sans ses textes : ni compte rendu, ni souhaits de formation, ni synthèse du feedback 360°. */
export const entretienSansTextes = (x: Entretien): Entretien => ({ ...x, cr: {}, souhaits: null, syntheseFeedback: null });

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function entretiensSuivisVueSalarie(x: ContexteVueSalarie): Projection {
  const { full, d, user, mine, lecture } = x;
  // Salariés dont il décide par délégation sans le périmètre « entretiens » : ni leurs entretiens ni leurs objectifs.
  const sansEntretiens = user.role === 'manager' && user.empId
    ? new Set(deleguesA(d.ds, user.empId, d.ti).filter(g => !g.perimetre.includes('entretiens')).map(g => g.empId)) : new Set<number>();
  const lignes = mine(full.objectifs ?? []);
  const directs: Objectif[] = lignes.filter(o => !lecture.has(o.empId) && !sansEntretiens.has(o.empId));
  // Feedback 360° : collectes des entretiens qu'il voit (les siens ; ceux qu'il conduit), masquées ; ses sollicitations de répondant.
  const sollicitations = full.feedbackSollicitations ?? [];
  // Un suppléant à la fois évaluateur et répondant d'une même collecte ne reçoit que sa sollicitation de répondant.
  const evalues = mine(sollicitations).filter(s => !lecture.has(s.empId) && !sansEntretiens.has(s.empId) && s.repondantEmpId !== user.empId);
  const repondant = user.empId == null ? [] : sollicitations.filter(s => s.repondantEmpId === user.empId && s.statut !== 'proposee');
  return {
    objectifs: directs,
    // Consultation N+2 : nombres par équipe seulement, jamais un libellé ni un résultat.
    compteursObjectifs: lecture.size ? compteursObjectifs(lignes.filter(o => lecture.has(o.empId)), full.employes) : [],
    feedbackSollicitations: [...evalues.map(sollicitationMasquee), ...repondant],
    suiviFeedback: [...new Set(evalues.map(s => s.entretienId))].map(id => suivi360(sollicitations, id)),
  };
}

/**
 * Feedback 360° vu par le service RH (droit « rh », instantané complet par ailleurs) : sollicitations masquées et compteur
 * global par collecte. Le service RH conduit des entretiens (il est l'évaluateur de tout salarié, `isValidatorOf`) ; le
 * texte promis aux répondants (« ni l'évalué ni son évaluateur ne savent qui a répondu ») vaut donc aussi pour lui. Les
 * actions lisent l'état réel côté serveur (`loadFull`).
 */
export function entretiensSuivisVueRh(full: Dataset): Pick<Projection, 'feedbackSollicitations' | 'suiviFeedback'> {
  const sollicitations = full.feedbackSollicitations ?? [];
  return {
    feedbackSollicitations: sollicitations.map(sollicitationMasquee),
    suiviFeedback: [...new Set(sollicitations.map(s => s.entretienId))].map(id => suivi360(sollicitations, id)),
  };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function entretiensSuivisVueProfil(x: ContexteVueProfil): Projection {
  const { full, d, droits } = x;
  const lecture = droits.includes('consultation');
  return {
    objectifs: [],
    compteursObjectifs: lecture ? compteursObjectifs(full.objectifs ?? [], full.employes) : [],
    // Entretiens de la lecture seule : comme dataset.ts (sections « fin de carrière » calculées ici, sans la date de
    // naissance), sans compte rendu, souhaits ni synthèse ; rien pour le référent HSE et la paie.
    entretiens: lecture ? full.entretiens.map(e => {
      const emp = d.emp(e.empId);
      return entretienSansTextes(emp ? { ...e, finCarriere: needsFinCarriere(d, emp, e) } : e);
    }) : [],
    feedbackSollicitations: [],
    suiviFeedback: [],
  };
}
