// Reprise d'une base SQLite de Cursus sur le serveur PostgreSQL commun (sous-étape 8.c de la bascule, Matrix,
// docs/architecture-postgres.md § 8) : à lancer une fois, service arrêté, par npm run reprise-postgres
// (server/src/reprise-postgres-cli.ts). La base SQLite n'est jamais modifiée : Cursus en lit une copie cohérente
// (VACUUM INTO), y applique les reprises et migrations nommées de cette version, contrôle les valeurs et les références,
// puis copie toutes les tables de TABLES dans le schéma cursus, en une seule transaction, sous le verrou d'écriture de
// Cursus, identifiants et ordre des référentiels gardés. Comptes contrôlés table par table avant la validation, tracé au
// journal (`migration.postgres`). Rejouable : une base cible déjà reprise est laissée telle quelle ; un échec n'écrit
// rien. `aBlanc` : tout est fait puis annulé, pour lire le compte rendu avant la reprise réelle.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { dossierPieces } from './chemins.ts';
import { journaliser } from './comptes.ts';
import { snake, type SqlValeur, SqliteDb, type TableName, TABLES } from './db.ts';
import { type PgDb, TABLES_RANG } from './db-pg.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations } from './migrations/cadre.ts';
import { dossierPiecesDe, NOM_LOCAL } from './pieces.ts';
import { serveurActif, verifier } from './sauvegarde.ts';

/** Action du journal qui marque la reprise (une ligne, écrite dans la base cible). */
export const ACTION_REPRISE = 'migration.postgres';
/** Tables qu'un premier démarrage sur une base neuve remplit déjà (amorçages de server/src/demarrage.ts) : remplacées. */
export const TABLES_AMORCEES: readonly TableName[] = ['projets', 'horaires', 'settings'];
/** Lignes au plus par INSERT (et 60 000 paramètres au plus : le protocole de PostgreSQL en admet 65 535). */
const LOT = 1000;
const MAX_PARAMETRES = 60_000;
/** Exemples cités par type d'anomalie. */
const EXEMPLES = 5;

export class RepriseError extends Error {}

export interface OptionsReprise {
  /** Tout faire puis annuler (aucune écriture dans la base cible). */
  aBlanc?: boolean;
  /** Ignorer le verrou du serveur SQLite (tests). */
  ignorerVerrou?: boolean;
}

export interface CompteRendu {
  statut: 'faite' | 'a-blanc' | 'deja-faite';
  source: string;
  /** Lignes par table (source = cible, contrôlé). */
  tables: Record<string, number>;
  lignes: number;
  /** Migrations nommées et reprises appliquées à la copie (base SQLite d'une version antérieure). */
  migrations: string[];
  /** Valeurs « aucun » (0 ou chaîne vide) d'une clé étrangère, écrites NULL : « table.colonne » → nombre. */
  aucunVersNull: Record<string, number>;
  /** Chaînes vides d'une colonne de date ou d'horodatage, écrites NULL. */
  videsVersNull: Record<string, number>;
  /** Colonnes de la base SQLite absentes de TABLES, avec des valeurs, non reprises : « table.colonne » → nombre. */
  nonReprises: Record<string, number>;
  /** Pièces justificatives en vigueur dont le fichier manque dans le dossier des pièces de la cible. */
  pieces: { fichiers: number; manquants: number; dossierCible: string; dossierSource: string };
  /** Reprise déjà faite : date et compte rendu de la ligne du journal. */
  deja?: { le: string; message: string };
}

interface Colonne { nom: string; type: string }
interface Cle { table: string; colonne: string; cible: string; cle: string; differee: boolean }
interface TablePrete { nom: TableName; table: string; colonnes: string[]; lignes: unknown[][]; autoRef: Cle[]; pk: string }

const ajouter = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Copie cohérente de la base SQLite (VACUUM INTO, lecture seule de l'original), contrôlée, dans un dossier temporaire. */
function copier(source: string, dossier: string): string {
  const copie = join(dossier, 'cursus.db');
  const sql = new DatabaseSync(source, { readOnly: true });
  try {
    sql.prepare('VACUUM INTO ?').run(copie);
  } finally {
    sql.close();
  }
  verifier(copie);
  return copie;
}

/** Colonnes des tables du schéma courant (hors colonnes générées), avec leur type. */
async function colonnesCible(db: PgDb): Promise<Map<string, Colonne[]>> {
  const r = await db.query<{ t: string; c: string; type: string }>(`SELECT table_name AS t, column_name AS c, data_type AS type
    FROM information_schema.columns WHERE table_schema = current_schema() AND is_generated = 'NEVER' ORDER BY table_name, ordinal_position`);
  const m = new Map<string, Colonne[]>();
  for (const x of r) m.set(x.t, [...(m.get(x.t) ?? []), { nom: x.c, type: x.type }]);
  return m;
}

/** Clés étrangères à une colonne du schéma courant. */
async function clesCible(db: PgDb): Promise<Cle[]> {
  return (await db.query<{ t: string; c: string; ct: string; cc: string; d: boolean }>(`SELECT tc.relname AS t, a.attname AS c,
      tp.relname AS ct, ap.attname AS cc, k.condeferrable AS d
    FROM pg_constraint k
    JOIN pg_class tc ON tc.oid = k.conrelid JOIN pg_namespace n ON n.oid = tc.relnamespace
    JOIN pg_class tp ON tp.oid = k.confrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_attribute ap ON ap.attrelid = k.confrelid AND ap.attnum = k.confkey[1]
    WHERE k.contype = 'f' AND n.nspname = current_schema() AND array_length(k.conkey, 1) = 1
    ORDER BY 1, 2`)).map(x => ({ table: x.t, colonne: x.c, cible: x.ct, cle: x.cc, differee: !!x.d }));
}

/** Ordre d'insertion : une table après celles qu'elle référence (clés non différables, hors références à elle-même). */
function ordre(noms: string[], cles: Cle[]): string[] {
  const avant = new Map(noms.map(n => [n, new Set(cles.filter(k => k.table === n && k.cible !== n && !k.differee).map(k => k.cible))]));
  const vus = new Set<string>(), out: string[] = [];
  const visiter = (n: string, chemin: string[]) => {
    if (vus.has(n)) return;
    if (chemin.includes(n)) throw new RepriseError(`Clés étrangères en cycle : ${[...chemin, n].join(' → ')}`);
    for (const p of avant.get(n) ?? []) visiter(p, [...chemin, n]);
    vus.add(n);
    out.push(n);
  };
  for (const n of noms) visiter(n, []);
  return out;
}

/** Valeur SQLite convertie pour la colonne PostgreSQL de type `type` ; une valeur impossible lève une RepriseError. */
function convertir(v: unknown, type: string, ou: () => string): unknown {
  if (type === 'boolean') return v == null ? false : !!Number(v);
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'integer': case 'bigint': {
      if (v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n)) throw new RepriseError(`${ou()} : « ${String(v).slice(0, 40)} » n’est pas un entier`);
      return n;
    }
    case 'numeric': {
      if (v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new RepriseError(`${ou()} : « ${String(v).slice(0, 40)} » n’est pas un nombre`);
      return n;
    }
    case 'date': {
      const s = String(v);
      if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new RepriseError(`${ou()} : « ${s.slice(0, 40)} » n’est pas une date AAAA-MM-JJ`);
      return s;
    }
    case 'timestamp with time zone': {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(Date.parse(s))) throw new RepriseError(`${ou()} : « ${s.slice(0, 40)} » n’est pas un horodatage`);
      return s;
    }
    case 'json': {
      const s = String(v);
      try { JSON.parse(s); } catch { throw new RepriseError(`${ou()} : texte JSON illisible`); }
      return s;
    }
    default: return typeof v === 'string' ? v : String(v);
  }
}

/** Lit et convertit toutes les tables de la copie ; les anomalies bloquantes sont réunies dans une seule RepriseError. */
async function preparer(copie: SqliteDb, cibles: Map<string, Colonne[]>, cles: Cle[], cr: CompteRendu): Promise<TablePrete[]> {
  const erreurs: string[] = [];
  const out: TablePrete[] = [];
  const pkDe = new Map((Object.entries(TABLES) as [TableName, { pk: string }][]).map(([n, d]) => [snake(n), snake(d.pk)]));
  for (const nom of Object.keys(TABLES) as TableName[]) {
    const table = snake(nom);
    const cols = cibles.get(table);
    if (!cols) throw new RepriseError(`Table ${table} absente du schéma cible : migrations de cette version non appliquées`);
    const sourceCols = await copie.columns(nom);
    // Colonnes de TABLES (et `rang`) ; les colonnes prérequises du partage (0002_partage : site, unité, sortie), que
    // Cursus ne remplit pas encore, restent vides comme sur une base neuve.
    const declarees = Object.keys(TABLES[nom].cols).map(snake);
    const colonnes = cols.map(c => c.nom).filter(c => (c === 'rang' && TABLES_RANG.has(nom)) || declarees.includes(c));
    const manquantes = declarees.filter(c => !sourceCols.includes(c) || !cols.some(x => x.nom === c));
    if (manquantes.length) throw new RepriseError(`Colonnes ${manquantes.join(', ')} de ${table} absentes de la copie SQLite ou du schéma cible`);
    for (const c of sourceCols.filter(c => !declarees.includes(c))) {
      const n = Number((await copie.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE "${c}" IS NOT NULL AND "${c}" <> ''`))!.n);
      if (n) ajouter(cr.nonReprises, `${table}.${c}`, n);
    }
    const types = new Map(cols.map(c => [c.nom, c.type]));
    const fk = new Map(cles.filter(k => k.table === table).map(k => [k.colonne, k]));
    const rang = TABLES_RANG.has(nom);
    const brutes = await copie.query<Record<string, unknown>>(`SELECT ${rang ? 'rowid AS "__rang", ' : ''}* FROM ${table} ORDER BY ${rang ? 'rowid' : pkDe.get(table)}`);
    const lignes: unknown[][] = [];
    for (const b of brutes) {
      const pk = b[pkDe.get(table)!];
      lignes.push(colonnes.map(c => {
        if (c === 'rang') return Number(b.__rang);
        let v = b[c];
        const type = types.get(c)!;
        if (fk.has(c) && (v === 0 || v === '')) { ajouter(cr.aucunVersNull, `${table}.${c}`); v = null; }
        if ((type === 'date' || type === 'timestamp with time zone') && v === '') { ajouter(cr.videsVersNull, `${table}.${c}`); v = null; }
        try {
          return convertir(v, type, () => `${table}.${c} (ligne ${String(pk)})`);
        } catch (e) {
          if (erreurs.length < 50) erreurs.push((e as Error).message);
          return null;
        }
      }));
    }
    out.push({ nom, table, colonnes, lignes, autoRef: cles.filter(k => k.table === table && k.cible === table), pk: pkDe.get(table)! });
  }
  // Références que les clés étrangères du schéma refuseraient (valeur absente de la table visée).
  for (const k of cles) {
    const t = out.find(x => x.table === k.table)!, c = out.find(x => x.table === k.cible)!;
    const i = t.colonnes.indexOf(k.colonne), j = c.colonnes.indexOf(k.cle);
    const connues = new Set(c.lignes.map(l => l[j]));
    const orphelines = t.lignes.filter(l => l[i] != null && !connues.has(l[i]));
    if (orphelines.length) {
      const ex = [...new Set(orphelines.map(l => String(l[i])))].slice(0, EXEMPLES).join(', ');
      erreurs.push(`${k.table}.${k.colonne} → ${k.cible} : ${orphelines.length} référence${orphelines.length > 1 ? 's' : ''} sans ligne visée (${ex})`);
    }
  }
  if (erreurs.length) throw new RepriseError(`Reprise impossible, base SQLite à corriger d’abord :\n  – ${erreurs.join('\n  – ')}`);
  return out;
}

/** Insère les lignes d'une table par lots ; les références d'une table à elle-même sont posées ensuite. */
async function inserer(db: PgDb, t: TablePrete): Promise<void> {
  if (!t.lignes.length) return;
  const auto = new Map(t.autoRef.map(k => [t.colonnes.indexOf(k.colonne), k]));
  const parLot = Math.max(1, Math.min(LOT, Math.floor(MAX_PARAMETRES / t.colonnes.length)));
  const liste = t.colonnes.map(c => `"${c}"`).join(', ');
  for (let i = 0; i < t.lignes.length; i += parLot) {
    const lot = t.lignes.slice(i, i + parLot);
    const params = lot.flatMap(l => l.map((v, k) => (auto.has(k) ? null : v)));
    const valeurs = lot.map(() => `(${t.colonnes.map(() => '?').join(', ')})`).join(', ');
    await db.run(`INSERT INTO ${t.table} (${liste}) VALUES ${valeurs}`, params as SqlValeur[]);
  }
  const ipk = t.colonnes.indexOf(t.pk);
  for (const [k, cle] of auto) {
    for (const l of t.lignes) if (l[k] != null) await db.run(`UPDATE ${t.table} SET "${cle.colonne}" = ? WHERE "${t.pk}" = ?`, [l[k], l[ipk]] as SqlValeur[]);
  }
}

/** Tables non vides de la cible, hors amorçages d'une base neuve. */
async function tablesUtilisees(db: PgDb): Promise<string[]> {
  const out: string[] = [];
  for (const nom of Object.keys(TABLES) as TableName[]) {
    if (TABLES_AMORCEES.includes(nom)) continue;
    const n = await db.count(nom);
    if (n) out.push(`${snake(nom)} (${n})`);
  }
  return out;
}

class Annulee extends Error {}

/**
 * Reprend la base SQLite `source` dans la base PostgreSQL `cible` (déjà migrée par openDb). Lève une RepriseError
 * (rien d'écrit) quand la source ou la cible ne s'y prêtent pas.
 */
export async function reprendreSurPostgres(source: string, cible: PgDb, opts: OptionsReprise = {}): Promise<CompteRendu> {
  // Reprise déjà faite : rien à refaire (la base a pu servir depuis, ses comptes ne se comparent plus).
  const deja = await cible.one<{ at: string; message: string }>('SELECT at, message FROM journal WHERE action = ? ORDER BY id LIMIT 1', [ACTION_REPRISE]);
  if (!deja && !existsSync(source)) throw new RepriseError(`Base SQLite introuvable : ${source}`);
  const reel = deja ? source : realpathSync(source);
  const cr: CompteRendu = {
    statut: opts.aBlanc ? 'a-blanc' : 'faite', source: reel, tables: {}, lignes: 0, migrations: [], aucunVersNull: {}, videsVersNull: {}, nonReprises: {},
    pieces: { fichiers: 0, manquants: 0, dossierCible: dossierPiecesDe(cible), dossierSource: dossierPieces(reel) },
  };
  if (deja) return { ...cr, statut: 'deja-faite', deja: { le: deja.at, message: deja.message } };
  if (!opts.ignorerVerrou) {
    const v = serveurActif(reel);
    if (v) throw new RepriseError(`La base SQLite est en service (processus ${v.pid}, depuis ${v.depuis}) : arrêtez Cursus avant la reprise, sinon ce qui serait saisi ensuite serait perdu.`);
  }
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-reprise-'));
  try {
    const copie = new SqliteDb(copier(reel, dossier));
    try {
      // Base d'une version antérieure : mise au niveau de cette version sur la copie, jamais sur l'original.
      await migrate(copie);
      cr.migrations = await appliquerMigrations(copie);
      const tables = await preparer(copie, await colonnesCible(cible), await clesCible(cible), cr);
      const pieces = await copie.query<{ fichier: string }>('SELECT fichier FROM pieces WHERE fichier IS NOT NULL AND retiree_le IS NULL');
      cr.pieces.fichiers = pieces.filter(p => NOM_LOCAL.test(p.fichier)).length;
      cr.pieces.manquants = pieces.filter(p => NOM_LOCAL.test(p.fichier) && !existsSync(join(cr.pieces.dossierCible, p.fichier))).length;
      const ordreTables = ordre(tables.map(t => t.table), await clesCible(cible));
      try {
        await cible.tx(async () => {
          // Sous le verrou d'écriture : aucune instance de Cursus n'écrit pendant la reprise.
          const utilisees = await tablesUtilisees(cible);
          if (utilisees.length) throw new RepriseError(`La base PostgreSQL contient déjà des données (${utilisees.join(', ')}) : la reprise ne se fait que sur une base neuve.`);
          for (const nom of TABLES_AMORCEES) await cible.exec(`DELETE FROM ${snake(nom)}`);
          for (const nom of ordreTables) await inserer(cible, tables.find(t => t.table === nom)!);
          await cible.exec('SET CONSTRAINTS ALL IMMEDIATE');
          await cible.resyncIds();
          // Comptes : chaque table de la cible a exactement les lignes de la copie.
          const ecarts: string[] = [];
          for (const t of tables) {
            const n = await cible.count(t.nom);
            cr.tables[t.table] = t.lignes.length;
            if (n !== t.lignes.length) ecarts.push(`${t.table} : ${t.lignes.length} lues, ${n} écrites`);
          }
          if (ecarts.length) throw new RepriseError(`Comptes différents après la copie : ${ecarts.join(' ; ')}`);
          cr.lignes = Object.values(cr.tables).reduce((a, b) => a + b, 0);
          if (opts.aBlanc) throw new Annulee();
          const nTables = Object.values(cr.tables).filter(Boolean).length;
          await journaliser(cible, {
            actor: 'Cursus', role: null, action: ACTION_REPRISE,
            message: `Reprise de la base SQLite ${basename(reel)} : ${cr.lignes} lignes dans ${nTables} tables, comptes contrôlés`,
            payload: { lignes: cr.lignes, tables: nTables, migrations: cr.migrations.length, aucunVersNull: cr.aucunVersNull, videsVersNull: cr.videsVersNull },
          });
        });
      } catch (e) {
        if (!(e instanceof Annulee)) throw e;
      }
      return cr;
    } finally {
      await copie.fermer();
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}
