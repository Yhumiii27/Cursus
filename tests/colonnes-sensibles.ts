// Colonnes de Cursus fermées à matrix_lecture sur le serveur commun (lot 8, chantier D), lues dans les fichiers du dépôt
// (aucune base) : commentaires « Sensible » des migrations PostgreSQL, liste droits.colonnes_sensibles de la copie du
// socle de Matrix (infra/postgres-socle/03-droits.sql) et demande à Matrix (docs/demandes/matrix-lot8-colonnes-sensibles.sql).
// Sert à tests/socle-colonnes-sensibles.test.ts et tests/db-pg.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
// lot 11 : une demande par chantier (docs/demandes/matrix-lot11-*.sql), lues avec celle du lot 8.

const racine = new URL('..', import.meta.url);
export const lire = (chemin: string) => readFileSync(new URL(chemin, racine), 'utf8');

/** Colonne d'une table du schéma cursus ; `colonne = '*'` : table entière. */
export interface ColonneSensible { table: string; colonne: string; origine?: string }
export const cle = (c: ColonneSensible) => `${c.table}.${c.colonne}`;

/** Marque d'une colonne déclarée sensible (même règle que scripts/colonnes-sensibles-pg.sql). */
export const MARQUE = /Sensible|à exclure de matrix_lecture/;

/** Lignes `('cursus', 'table', 'colonne', 'motif', 'origine')` d'un fichier SQL (apostrophes doublées comprises). */
function lignesCursus(sql: string): ColonneSensible[] {
  const out: ColonneSensible[] = [];
  // lot 12 — C1 : chiffres admis dans un nom de colonne (hfa25, hca10…).
  const re = /\(\s*'cursus'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z0-9_*]+)'\s*,\s*'(?:[^']|'')*'\s*,\s*'([a-z]+)'\s*\)/g;
  for (const m of sql.matchAll(re)) out.push({ table: m[1], colonne: m[2], origine: m[3] });
  return out;
}

/** Entrées pour cursus de droits.colonnes_sensibles dans la copie du socle (dernière origine écrite). */
export function socleCursus(): Map<string, ColonneSensible> {
  return new Map(lignesCursus(lire('infra/postgres-socle/03-droits.sql')).map(c => [cle(c), c]));
}

/**
 * Lignes des demandes à Matrix (toutes en 'convention') : docs/demandes/matrix-lot8-colonnes-sensibles.sql et, depuis le
 * lot 11, chaque fichier docs/demandes/matrix-*.sql d'un chantier (même forme), dans l'ordre de leur nom.
 */
export function demandeMatrix(): ColonneSensible[] {
  const dossier = new URL('docs/demandes/', racine);
  return readdirSync(dossier).filter(f => /^matrix-.*\.sql$/.test(f)).sort().flatMap(f => lignesCursus(lire(`docs/demandes/${f}`)));
}

/**
 * Colonnes et tables (« * ») que les migrations PostgreSQL de Cursus déclarent sensibles : dernier commentaire posé
 * (une migration plus récente remplace le commentaire d'une plus ancienne) qui porte la marque.
 */
export function declareesSensibles(): ColonneSensible[] {
  const dernier = new Map<string, string>();
  const dossier = new URL('server/migrations-pg/', racine);
  for (const f of readdirSync(dossier).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()) {
    const sql = readFileSync(new URL(f, dossier), 'utf8');
    for (const m of sql.matchAll(/COMMENT ON COLUMN "([a-z_]+)"\."([a-z0-9_]+)" IS '((?:[^']|'')*)'/g)) dernier.set(`${m[1]}.${m[2]}`, m[3]);
    for (const m of sql.matchAll(/COMMENT ON TABLE "([a-z_]+)" IS '((?:[^']|'')*)'/g)) dernier.set(`${m[1]}.*`, m[2]);
  }
  return [...dernier].filter(([, texte]) => MARQUE.test(texte)).map(([k]) => {
    const [table, colonne] = k.split('.');
    return { table, colonne };
  });
}
