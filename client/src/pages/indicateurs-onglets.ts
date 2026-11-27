// lot 11 — indicateurs : onglets de l'écran Indicateurs sociaux (pages/Indicateurs.tsx), partagés avec l'adresse de la
// page (state/url.ts) et l'état d'écran (state/store.tsx). Sans import d'interface : lu aussi par les tests.
export const ONGLETS_INDICATEURS = ['effectifs', 'mouvements', 'absenteisme', 'formation', 'ages', 'bdese', 'egalite', 'arretes'] as const;
export type OngletIndicateurs = typeof ONGLETS_INDICATEURS[number];

/** Libellés des onglets : chaînes sources anglaises, traduites au rendu (`t(LIBELLE_ONGLET[o])`). */
export const LIBELLE_ONGLET: Record<OngletIndicateurs, string> = {
  effectifs: 'Headcounts', mouvements: 'Movements', absenteisme: 'Absenteeism', formation: 'Training#course', ages: 'Ages and seniority',
  bdese: 'BDESE', egalite: 'Equality', arretes: 'Freezes',
};

/** Tableaux de la réponse du serveur (identifiants de shared/rules/indicateurs-legaux.ts) montrés par chaque onglet. */
export const TABLEAUX_ONGLET: Partial<Record<OngletIndicateurs, readonly string[]>> = {
  effectifs: ['effectifs'],
  mouvements: ['mouvements', 'sortiesMotifs', 'entreesContrats'],
  absenteisme: ['absenteisme', 'absenteismeSante'],
  formation: ['formation', 'formationStagiaires', 'formationHeures'],
  ages: ['ages', 'anciennete'],
};
