// Outils des migrations nommées (server/src/migrations/cadre.ts) : index présents, reconstruction d'une table.
import { colonnesSql, type Db, snake, TABLES, type TableName } from '../db.ts';

/** Ligne telle qu'en base : noms de colonnes en snake_case, JSON en texte, booléens en 0 / 1. */
export type LigneSql = Record<string, unknown>;

/** Vrai si l'index existe dans la base. */
export const indexExiste = (db: Db, nom: string) => !!db.sql.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`).get(nom);

/** Vrai si la table a cette colonne physique (nom en camelCase ou snake_case). */
export const colonneExiste = (db: Db, table: TableName, colonne: string) => db.columns(table).includes(snake(colonne));

export interface Reconstruction {
  /**
   * Colonne de la table reconstruite (camelCase, comme dans TABLES) → expression SQL sur l'ancienne table : ancien nom
   * d'une colonne renommée (`'montant_ht'`), valeur calculée (`"COALESCE(statut, 'actif')"`). Sans entrée, la colonne
   * de même nom, ou NULL si l'ancienne table ne l'a pas.
   */
  depuis?: Record<string, string>;
  /**
   * Transformation en JavaScript de chaque ligne, après `depuis`, pour ce que SQL ne sait pas faire (chiffrement d'une
   * colonne…) : reçoit et renvoie une ligne telle qu'en base (LigneSql).
   */
  ligne?: (r: LigneSql) => LigneSql;
}

/**
 * Reconstruit une table selon sa définition actuelle dans TABLES (server/src/db.ts) : avec SQLite, seul moyen de
 * renommer ou supprimer proprement une colonne, d'en changer le type ou d'ajouter une contrainte (UNIQUE…). Nouvelle
 * table créée à côté, lignes recopiées, ancienne table supprimée, nouvelle renommée ; les index de la table sont
 * recréés et le compteur AUTOINCREMENT conservé (identifiants jamais réutilisés). Les colonnes de l'ancienne table
 * absentes de TABLES sont abandonnées : un index qui en porte une est à supprimer avant (DROP INDEX). Une ligne qui
 * viole une nouvelle contrainte fait échouer la migration, et toute la reconstruction est annulée. À appeler dans
 * `executer` d'une migration (transaction ouverte). Renvoie le nombre de lignes recopiées.
 */
export function reconstruireTable(db: Db, table: TableName, opts: Reconstruction = {}): number {
  if (!db.sql.isTransaction) throw new Error(`Reconstruction de ${table} hors transaction : à faire dans une migration nommée`);
  const nom = snake(table), provisoire = `${nom}__reconstruction`;
  const anciennes = new Set(db.columns(table));
  if (!anciennes.size) throw new Error(`Table ${nom} absente : rien à reconstruire`);
  // Index créés par Cursus (les index des contraintes UNIQUE, sans `sql`, suivent la définition de la table).
  const index = db.sql.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`).all(nom) as { sql: string }[];
  const compteur = db.sql.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(nom) as { seq: number } | undefined;
  const cols = Object.keys(TABLES[table].cols);
  const source = (c: string) => opts.depuis?.[c] ?? (anciennes.has(snake(c)) ? snake(c) : 'NULL');
  const liste = cols.map(snake).join(', ');
  db.sql.exec(`DROP TABLE IF EXISTS ${provisoire}`);
  db.sql.exec(`CREATE TABLE ${provisoire} (${colonnesSql(table)})`);
  let n: number;
  if (opts.ligne) {
    const lignes = db.sql.prepare(`SELECT ${cols.map(c => `${source(c)} AS ${snake(c)}`).join(', ')} FROM ${nom}`).all() as LigneSql[];
    const inserer = db.sql.prepare(`INSERT INTO ${provisoire} (${liste}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of lignes) {
      const x = opts.ligne({ ...r });
      inserer.run(...cols.map(c => (x[snake(c)] ?? null) as string | number | null));
    }
    n = lignes.length;
  } else {
    n = Number(db.sql.prepare(`INSERT INTO ${provisoire} (${liste}) SELECT ${cols.map(source).join(', ')} FROM ${nom}`).run().changes);
  }
  db.sql.exec(`DROP TABLE ${nom}`);
  db.sql.exec(`ALTER TABLE ${provisoire} RENAME TO ${nom}`);
  for (const i of index) db.sql.exec(i.sql);
  if (compteur) {
    // Le compteur de l'ancienne table disparaît avec elle : le plus grand identifiant déjà attribué est conservé.
    db.sql.prepare(`DELETE FROM sqlite_sequence WHERE name IN (?, ?)`).run(nom, provisoire);
    db.sql.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, MAX(?, (SELECT COALESCE(MAX(rowid), 0) FROM ${nom})))`).run(nom, compteur.seq);
  }
  return n;
}
