// Migration nommée du chantier « données personnelles sur le serveur commun » (lot 8, chantier D), étape 2 : chiffrement
// au repos des pièces justificatives (server/src/pieces-chiffrement.ts). La colonne `pieces.chiffree` est déclarée dans
// TABLES (server/src/db.ts) et ajoutée vide à l'ouverture ; la migration y note « en clair » (0) les pièces déjà
// déposées, toujours lisibles, et compte celles qui gardent un fichier : npm run pieces:chiffrer les chiffre une fois
// CURSUS_PIECES_KEY posée. Son nom marque aussi les bases passées par cette version : une version plus ancienne, qui
// servirait un fichier chiffré tel quel, les refuse. Serveur PostgreSQL : 0012_pieces_chiffrees.sql.
import { plural } from '../../../shared/format.ts';
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';

const aNoter = async (db: Db) => Number(((await db.one('SELECT COUNT(*) AS n FROM pieces WHERE chiffree IS NULL')) as { n: number }).n);

export const PIECES_CHIFFREES: Migration = {
  nom: 'lot8-pieces-chiffrees',
  // Base neuve : exécutée, sans effet ; base existante : s'il reste des pièces à noter.
  necessaire: async (db: SqliteDb) => db.neuve || (await aNoter(db)) > 0,
  executer: async db => {
    if (!(await aNoter(db))) return;
    await db.run('UPDATE pieces SET chiffree = 0 WHERE chiffree IS NULL');
    const fichiers = Number(((await db.one('SELECT COUNT(*) AS n FROM pieces WHERE fichier IS NOT NULL')) as { n: number }).n);
    if (!fichiers) return;
    return `${plural(fichiers, 'pièce justificative gardée en clair', 'pièces justificatives gardées en clair')} : npm run pieces:chiffrer, une fois CURSUS_PIECES_KEY posée`;
  },
};
