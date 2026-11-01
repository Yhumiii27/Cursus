// Onglets de l'écran Temps de travail (lot 12, socle), partagés avec l'adresse de la page (state/url.ts) et l'état
// d'écran (state/store.tsx). Au socle, un seul onglet (les feuilles de temps) : la barre d'onglets n'est montrée qu'à
// partir de deux. Chaque chantier ajoute le sien dans son bloc, ici et dans pages/Temps.tsx (liste des onglets
// seulement), et met son contenu dans un composant à lui. Sans import d'interface : lu aussi par les tests.
export const ONGLETS_TEMPS = ['feuilles',
  // lot 12 — C1 (forfait annuel en heures) : récapitulatif du forfait (RecapForfaitHeures)
  // lot 12 — C5 (planning d'équipe) : planning (PlanningEquipe)
  // lot 12 — C6 (badgeage virtuel) : pointages (Pointages)
] as const;
export type OngletTemps = typeof ONGLETS_TEMPS[number];
