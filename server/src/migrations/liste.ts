// Migrations nommées, dans l'ordre d'exécution : une ligne par migration, ajoutée à la fin, jamais retirée ni renommée
// (une base qui porte un nom absent de cette liste est refusée au démarrage). Cadre : server/src/migrations/cadre.ts ;
// mode d'emploi : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import type { Migration } from './cadre.ts';
import { DEMI_JOURNEES } from './conges.ts';
import { COUT_REEL } from './entretiens.ts';
import { INDEX_ENVOIS, INDEX_JOURNAL, INDEX_KEYSTONE, INDEX_SALARIES } from './exploitation.ts';
import { SOLDES_DATES } from './reprise.ts';
import { ABSENCES_ANTERIEURES, HEURES_SUP, LOTS_HISTORIQUES, MODE_API_RETIRE, RUBRIQUES_PAR_FEUILLE } from './paie.ts';
import { POSTES } from './referentiels.ts';
import { REFERENCES_DEPLACEMENTS } from './voyages.ts';
import { ACTIVITES_INTERNES, SEMAINE_7_JOURS } from './temps.ts';
import { ACTIVITE_FORMATION_PROJET, PLAGE_SESSIONS } from './formations.ts';
import { INDEX_PIECES } from './lot6-pieces.ts';
import { HIERARCHIE_EQUIPES } from './lot6-hierarchie.ts';
import { DEPLACEMENTS_DEPART } from './lot6-paie.ts';
import { HORAIRES_EXEMPLES_MIGRATION, HORAIRES_NUIT_FIGEE } from './lot6-horaires.ts';
import { CONTRATS_HISTORIQUE } from './lot6-contrats.ts';

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
  INDEX_SALARIES,
  ABSENCES_ANTERIEURES,
  RUBRIQUES_PAR_FEUILLE,
  INDEX_PIECES,
  HIERARCHIE_EQUIPES,
  DEPLACEMENTS_DEPART,
  HORAIRES_EXEMPLES_MIGRATION,
  CONTRATS_HISTORIQUE,
  HORAIRES_NUIT_FIGEE,
];
