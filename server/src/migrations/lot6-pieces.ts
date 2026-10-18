// Migrations nommées du chantier « pièces justificatives » (lot 6, t133). La table `pieces` elle-même est déclarée dans
// TABLES (server/src/db.ts) : seuls ses index de lecture passent par ici — pièces d'un salarié (instantané, export de ses
// données) et d'un objet (dialogues, retrait des pièces d'une déclaration refusée).
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const INDEX: Record<string, string> = {
  pieces_emp: 'CREATE INDEX IF NOT EXISTS pieces_emp ON pieces (emp_id)',
  pieces_objet: 'CREATE INDEX IF NOT EXISTS pieces_objet ON pieces (objet, objet_id)',
};

export const INDEX_PIECES: Migration = {
  nom: 'lot6-pieces-index',
  necessaire: (db: Db) => Object.keys(INDEX).some(i => !indexExiste(db, i)),
  executer: (db: Db) => {
    for (const sql of Object.values(INDEX)) db.sql.exec(sql);
    return `index ${Object.keys(INDEX).join(', ')}`;
  },
};
