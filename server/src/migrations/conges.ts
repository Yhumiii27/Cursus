// Migrations nommées du chantier « congés » (lot 5) : demi-journées des congés payés, RTT et récupération.
import { plural } from '../../../shared/format.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/**
 * Demi-journées hors de la règle (shared/rules/demi-journees.ts) : valeur inconnue, nature en journées entières, congé
 * d'un seul jour qui porte sa demi-journée en fin, premier jour au matin ou dernier jour l'après-midi d'un congé de
 * plusieurs jours. Les colonnes `debut_demi` et `fin_demi` sont ajoutées vides par le schéma déclaratif (server/src/db.ts) :
 * toute absence existante reste en journées entières.
 */
const HORS_REGLE = {
  debut: `debut_demi IS NOT NULL AND (debut_demi NOT IN ('matin', 'apres_midi') OR type NOT IN ('CP', 'RTT', 'RECUP') OR (du <> au AND debut_demi = 'matin'))`,
  fin: `fin_demi IS NOT NULL AND (fin_demi NOT IN ('matin', 'apres_midi') OR type NOT IN ('CP', 'RTT', 'RECUP') OR du = au OR fin_demi = 'apres_midi')`,
};
const aReprendre = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n FROM absences WHERE (${HORS_REGLE.debut}) OR (${HORS_REGLE.fin})`) as { n: number }).n);

/**
 * Demi-journées des congés (t129). Les absences d'une base existante sont en journées entières (colonnes vides) : la
 * migration n'y trouve rien et n'est que notée faite. Une demi-journée hors de la règle, écrite par un outil ou une
 * restauration partielle, est ramenée à la journée entière plutôt que de fausser les soldes. Même résultat pour une base
 * restée ancienne qui la recevra plus tard.
 */
export const DEMI_JOURNEES: Migration = {
  nom: 'lot5-conges-demi-journees',
  // Base existante sans demi-journée à reprendre : notée faite. Base neuve : exécutée, sans effet.
  necessaire: async db => db.neuve || await aReprendre(db) > 0,
  executer: async db => {
    if (!await aReprendre(db)) return;
    const debut = Number((await db.run(`UPDATE absences SET debut_demi = NULL WHERE ${HORS_REGLE.debut}`)).changes);
    const fin = Number((await db.run(`UPDATE absences SET fin_demi = NULL WHERE ${HORS_REGLE.fin}`)).changes);
    return `${plural(debut + fin, 'demi-journée hors de la règle', 'demi-journées hors de la règle')} ramenée${debut + fin > 1 ? 's' : ''} à la journée entière`;
  },
};
