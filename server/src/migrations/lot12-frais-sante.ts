// Migration nommée du lot 12, chantier C2 (activation des notes de frais), étape 2 : scission des frais médicaux. La table
// `lignes_frais_sante` est déclarée dans TABLES (server/src/db.ts) et créée par SQLite à l'ouverture ; passent ici la
// reprise des dépenses des notes médicales, déplacées de `lignes_frais` avec leur identifiant (leurs justificatifs
// `ligneFraisSante` les désignent déjà par lui), et les index des dépenses d'une note et d'un salarié. PostgreSQL : même
// reprise et mêmes index dans server/migrations-pg/0029_frais_sante.sql.
import { snake, type SqliteDb, TABLES } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const INDEX: Record<string, string> = {
  lignes_frais_sante_note: 'CREATE INDEX IF NOT EXISTS lignes_frais_sante_note ON lignes_frais_sante (note_id)',
  lignes_frais_sante_emp: 'CREATE INDEX IF NOT EXISTS lignes_frais_sante_emp ON lignes_frais_sante (emp_id)',
};
/** Dépenses de notes médicales encore rangées avec les autres. */
const MEDICALES = 'FROM lignes_frais WHERE note_id IN (SELECT id FROM notes_frais WHERE medicale = 1)';

export const FRAIS_SANTE: Migration = {
  nom: 'lot12-frais-sante',
  necessaire: async (db: SqliteDb) => Object.keys(INDEX).some(i => !indexExiste(db, i)) || !!await db.one(`SELECT 1 AS x ${MEDICALES} LIMIT 1`),
  executer: async (db: SqliteDb) => {
    const cols = Object.keys(TABLES.lignesFraisSante.cols).map(snake).join(', ');
    const n = Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n ${MEDICALES}`))?.n ?? 0);
    await db.run(`INSERT INTO lignes_frais_sante (${cols}) SELECT ${cols} ${MEDICALES}`);
    await db.run(`DELETE ${MEDICALES}`);
    for (const sql of Object.values(INDEX)) await db.exec(sql);
    return `${n} dépense${n > 1 ? 's' : ''} de frais médicaux déplacée${n > 1 ? 's' : ''} ; index ${Object.keys(INDEX).join(', ')}`;
  },
};
