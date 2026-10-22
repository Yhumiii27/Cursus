// Migrations nommées du chantier « variables de paie » (lot 6, chantier 2). La table des éléments de déplacement émis
// (`deplacementsPaie`) et les nouvelles colonnes (vigilance des destinations, coordonnées sur place des déplacements,
// contact d'urgence des fiches, grand déplacement des chantiers, séjours d'un lot) sont déclarées dans TABLES
// (server/src/db.ts) : elles n'en demandent pas.
import { periodeOuverte } from '../../../shared/rules/paie.ts';
import { loadSettings, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import { CLE_DEPUIS_DEPLACEMENTS, poserDepartDeplacements } from '../deplacements-paie.ts';
import type { Migration } from './cadre.ts';

/** Séjours d'une base existante : déplacements en vigueur et missions (affectations Keystone). */
const sejours = async (db: Db) => Number(((await db.one(`SELECT (SELECT COUNT(*) FROM voyages WHERE annule_le IS NULL) + (SELECT COUNT(*) FROM missions) AS n`)) as { n: number }).n);

/** Lots de paie déjà générés (annulés compris : la base a servi à la paie). */
const lots = async (db: Db) => Number(((await db.one('SELECT COUNT(*) AS n FROM lots_paie')) as { n: number }).n);

/**
 * Lot 6 (t031) : les déplacements partent dans le lot de paie (fichier d'import ou liste « à saisir dans Sage »). Sur une
 * base qui porte déjà des déplacements, des missions ou des lots de paie, la paie a traité dans Sage ceux des périodes
 * passées : Cursus ne transmet que les jours à partir du premier jour de la période de paie ouverte (date de départ),
 * sans quoi ils repartiraient tous en rappel. Base neuve : la date est posée par le premier lot de paie (la date de mise en service se
 * règle dans Paramètres → Déplacements et paie). Tracé au journal (`migration.deplacementsPaie` : date, nombre de séjours).
 */
export const DEPLACEMENTS_DEPART: Migration = {
  nom: 'lot6-paie-deplacements-depart',
  // Base neuve : exécutée, sans effet ; base existante sans séjour ni lot de paie, ou date déjà posée : notée faite. Une
  // base qui a déjà des lots sans aucun séjour (Keystone pas encore branché) reçoit aussi la date : les affectations
  // passées reçues ensuite ne repartent pas en rappel (le premier lot ne la pose plus, la base ayant des lots).
  necessaire: async db => db.neuve || (((await sejours(db)) > 0 || (await lots(db)) > 0) && (await db.getSetting(CLE_DEPUIS_DEPLACEMENTS, null)) === null),
  executer: async db => {
    if (!(await sejours(db)) && !(await lots(db))) return;
    const date = await poserDepartDeplacements(db, `${periodeOuverte(todayIso(), (await loadSettings(db)).clotureJour)}-01`, { actor: 'Cursus', role: null }, 'Reprise');
    return `déplacements transmis à la paie à partir du ${date}`;
  },
};
