// lot 12 — C3 (entretiens suivis) : onglets de l'écran Entretiens, partagés avec l'adresse de la page (state/url.ts) et
// l'état d'écran (state/store.tsx) : échéances et comptes rendus (l'écran d'origine), objectifs de l'équipe (filtres par
// statut et par échéance), points de suivi (mi-année, point) ; feedback 360° (étape 3 : service RH, module activé). Sans
// import d'interface : lu aussi par les tests.
export const ONGLETS_ENTRETIENS = ['echeances', 'objectifs', 'points', 'feedback'] as const;
export type OngletEntretiens = typeof ONGLETS_ENTRETIENS[number];
