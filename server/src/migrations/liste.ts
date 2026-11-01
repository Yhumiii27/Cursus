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
import { DELEGATIONS_VALIDATION, HIERARCHIE_EQUIPES } from './lot6-hierarchie.ts';
import { DEPLACEMENTS_DEPART } from './lot6-paie.ts';
import { HORAIRES_EXEMPLES_MIGRATION, HORAIRES_NUIT_FIGEE } from './lot6-horaires.ts';
import { CONTRATS_HISTORIQUE } from './lot6-contrats.ts';
import { DUREE_HEURES, HAB_DELIVRANCES } from './lot6-securite.ts';
import { INDEX_CONSERVATION_AGENDA } from './lot6-pieces.ts';
import { ASTREINTES_ACTIVITE_INDEX, ASTREINTES_PAIE_INDEX } from './lot7-astreintes.ts';
import { C2P_COLONNES, PASSEPORT_PREVENTION } from './lot7-prevention.ts';
import { INDEX_ATTENTES, INDEX_EVALUATIONS } from './lot7-formations.ts';
import { PIECES_CHIFFREES } from './lot8-pieces.ts';
import { INDEX_JOURNAL_COMPTE } from './lot8-index-journal.ts';
// lot 12 — C1 (forfait annuel en heures)
import { FORFAIT_HEURES } from './lot12-forfait-heures.ts';
// lot 12 — C2 (notes de frais : activation)
import { INDEX_FRAIS_FENETRE } from './lot12-frais.ts';
// lot 12 — C3 (entretiens suivis et 360°)
import { ENTRETIENS_SUIVIS_INDEX } from './lot12-entretiens.ts';
// lot 12 — C4 (organismes de formation et e-learning)
import { ELEARNING_INDEX, ORGANISMES } from './lot12-organismes.ts';

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
  HAB_DELIVRANCES,
  DUREE_HEURES,
  DELEGATIONS_VALIDATION,
  INDEX_CONSERVATION_AGENDA,
  ASTREINTES_ACTIVITE_INDEX,
  C2P_COLONNES,
  INDEX_ATTENTES,
  ASTREINTES_PAIE_INDEX,
  PASSEPORT_PREVENTION,
  INDEX_EVALUATIONS,
  PIECES_CHIFFREES,
  INDEX_JOURNAL_COMPTE,
  // lot 12 — C1 (forfait annuel en heures)
  FORFAIT_HEURES,
  // lot 12 — C2 (notes de frais : activation)
  INDEX_FRAIS_FENETRE,
  // lot 12 — C3 (entretiens suivis et 360°)
  ENTRETIENS_SUIVIS_INDEX,
  // lot 12 — C4 (organismes de formation et e-learning)
  ORGANISMES,
  ELEARNING_INDEX,
];
