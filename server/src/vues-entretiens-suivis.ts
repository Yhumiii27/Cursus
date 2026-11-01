// Entretiens suivis et feedback 360° dans l'instantané envoyé au navigateur (lot 12, chantier C3), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts), sur le
// modèle de server/src/frais-vues.ts. Le service RH (droit « rh ») reçoit l'instantané complet.
// - Manager et collaborateur : objectifs comme les entretiens (`direct(mine(…))`, dataset.ts) : les siens ; ceux de l'équipe
//   directe et des délégations « entretiens » pour le manager ; ni la consultation N+2, ni un suppléant d'un autre
//   périmètre, qui ne reçoivent que des compteurs par équipe (`compteursObjectifs`, seuil d'anonymat). Les souhaits de
//   formation voyagent avec l'entretien (colonne `souhaits`), donc avec les mêmes règles.
// - Profils restreints : aucun objectif ; la lecture seule (direction, DPO, auditeur) reçoit les compteurs par équipe, et
//   ses entretiens sans compte rendu (dataset.ts) ni souhaits ni synthèse 360° ; référent HSE et paie : rien.
// - Feedback 360° (étape 3, module désactivé) : sollicitations et réponses versées au service RH seulement.
import { compteursObjectifs } from '../../shared/rules/objectifs.ts';
import { needsFinCarriere } from '../../shared/rules/entretiens.ts';
import { deleguesA } from '../../shared/rules/delegations-manager.ts';
import type { Entretien, Objectif } from '../../shared/types.ts';
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
  return {
    objectifs: directs,
    // Consultation N+2 : nombres par équipe seulement, jamais un libellé ni un résultat.
    compteursObjectifs: lecture.size ? compteursObjectifs(lignes.filter(o => lecture.has(o.empId)), full.employes) : [],
    feedbackSollicitations: [],
    feedbackReponses: [],
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
    feedbackReponses: [],
  };
}
