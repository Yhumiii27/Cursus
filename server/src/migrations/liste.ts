// Migrations nommées, dans l'ordre d'exécution : une ligne par migration, ajoutée à la fin, jamais retirée ni renommée
// (une base qui porte un nom absent de cette liste est refusée au démarrage). Cadre : server/src/migrations/cadre.ts ;
// mode d'emploi : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import type { Migration } from './cadre.ts';
import { DEMI_JOURNEES } from './conges.ts';
import { COUT_REEL } from './entretiens.ts';
import { INDEX_ENVOIS, INDEX_JOURNAL, INDEX_KEYSTONE } from './exploitation.ts';
import { SOLDES_DATES } from './reprise.ts';
import { HEURES_SUP, LOTS_HISTORIQUES, MODE_API_RETIRE } from './paie.ts';
import { POSTES } from './referentiels.ts';
import { REFERENCES_DEPLACEMENTS } from './voyages.ts';
import { ACTIVITES_INTERNES, SEMAINE_7_JOURS } from './temps.ts';
import { ACTIVITE_FORMATION_PROJET, PLAGE_SESSIONS } from './formations.ts';

export const MIGRATIONS: readonly Migration[] = [
  INDEX_JOURNAL,
  INDEX_ENVOIS,
  INDEX_KEYSTONE,
  SOLDES_DATES,
  HEURES_SUP,
  COUT_REEL,
  POSTES,
  LOTS_HISTORIQUES,
  MODE_API_RETIRE,
  REFERENCES_DEPLACEMENTS,
  SEMAINE_7_JOURS,
  ACTIVITES_INTERNES,
  DEMI_JOURNEES,
  PLAGE_SESSIONS,
  ACTIVITE_FORMATION_PROJET,
];
