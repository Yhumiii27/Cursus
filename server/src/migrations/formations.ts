// Migrations nommées du chantier « formations » (lot 5) : sessions sur plusieurs jours (t118). Les sessions d'une base
// existante tiennent en un jour : leur dernier jour est le premier, sans horaire. L'activité interne des heures de
// formation (INT-FORM) est ajoutée aux projets imputables des feuilles de temps.
import { ACTIVITE_FORMATION } from '../../../shared/constants.ts';
import { plural } from '../../../shared/format.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Sessions sans dernier jour (écrites avant le lot 5). */
const sansFin = (db: Db) => Number((db.sql.prepare('SELECT COUNT(*) AS n FROM sessions WHERE fin IS NULL').get() as { n: number }).n);

/** Sessions existantes : dernier jour = premier jour, un seul jour, aucun horaire (journée entière). */
export const PLAGE_SESSIONS: Migration = {
  nom: 'lot5-formations-plage-sessions',
  // Base neuve : exécutée, sans effet ; base existante dont chaque session a son dernier jour : notée faite.
  necessaire: db => db.neuve || sansFin(db) > 0,
  executer: db => {
    const n = Number(db.sql.prepare(`UPDATE sessions SET fin = date, jours = json_array(date), horaires = '[]' WHERE fin IS NULL`).run().changes);
    return `${plural(n, 'session', 'sessions')} sur un jour`;
  },
};

/**
 * Activité interne INT-FORM (« Formation ») parmi les projets, si elle manque : les lignes de formation proposées dans
 * les feuilles de temps y portent leurs heures, et elle reste imputable à la main. Keystone ne la reçoit jamais (INT-*)
 * et ne la retire pas (codes internes ignorés par l'API entrante). Base neuve comprise, comme les autres codes internes.
 */
export const ACTIVITE_FORMATION_PROJET: Migration = {
  nom: 'lot5-formations-activite-interne',
  necessaire: db => !db.sql.prepare('SELECT 1 FROM projets WHERE code = ?').get(ACTIVITE_FORMATION.code),
  executer: db => {
    db.sql.prepare(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif') ON CONFLICT (code) DO NOTHING`).run(ACTIVITE_FORMATION.code, ACTIVITE_FORMATION.nom);
    return `activité interne ${ACTIVITE_FORMATION.code} ajoutée`;
  },
};
