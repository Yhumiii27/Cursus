// Colonnes de Cursus fermées à matrix_lecture sur le serveur commun (lot 8, chantier D), lues dans les fichiers du dépôt
// (aucune base) : commentaires « Sensible » des migrations PostgreSQL, liste droits.colonnes_sensibles de la copie du
// socle de Matrix (infra/postgres-socle/03-droits.sql) et demande à Matrix (docs/demandes/matrix-lot8-colonnes-sensibles.sql).
// Sert à tests/socle-colonnes-sensibles.test.ts et tests/db-pg.test.ts.
import { readdirSync, readFileSync } from 'node:fs';

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
  const re = /\(\s*'cursus'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_*]+)'\s*,\s*'(?:[^']|'')*'\s*,\s*'([a-z]+)'\s*\)/g;
  for (const m of sql.matchAll(re)) out.push({ table: m[1], colonne: m[2], origine: m[3] });
  return out;
}

/** Entrées pour cursus de droits.colonnes_sensibles dans la copie du socle (dernière origine écrite). */
export function socleCursus(): Map<string, ColonneSensible> {
  return new Map(lignesCursus(lire('infra/postgres-socle/03-droits.sql')).map(c => [cle(c), c]));
}

/** Lignes de la demande à Matrix (toutes en 'convention'). */
export function demandeMatrix(): ColonneSensible[] {
  // lot 11 : demandes des chantiers (docs/demandes/matrix-lot11-*.sql), même forme, en attente de validation.
  const lot11 = readdirSync(new URL('docs/demandes/', racine)).filter(f => /^matrix-lot11-[a-z0-9-]+\.sql$/.test(f)).sort();
  return [...lignesCursus(lire('docs/demandes/matrix-lot8-colonnes-sensibles.sql')), ...lot11.flatMap(f => lignesCursus(lire(`docs/demandes/${f}`)))];
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
    for (const m of sql.matchAll(/COMMENT ON COLUMN "([a-z_]+)"\."([a-z_]+)" IS '((?:[^']|'')*)'/g)) dernier.set(`${m[1]}.${m[2]}`, m[3]);
    for (const m of sql.matchAll(/COMMENT ON TABLE "([a-z_]+)" IS '((?:[^']|'')*)'/g)) dernier.set(`${m[1]}.*`, m[2]);
  }
  return [...dernier].filter(([, texte]) => MARQUE.test(texte)).map(([k]) => {
    const [table, colonne] = k.split('.');
    return { table, colonne };
  });
}
