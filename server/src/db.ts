// Accès SQLite (module node:sqlite) : schéma déclaratif et requêtes génériques.
// Les champs sont en camelCase côté code et en snake_case dans la base.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

type ColType = 'text' | 'int' | 'real' | 'bool' | 'json';
interface TableDef { pk: string; auto?: boolean; cols: Record<string, ColType>; unique?: string[][] }

export const TABLES = {
  formations: { pk: 'id', cols: { id: 'text', nom: 'text', court: 'text', type: 'text', validite: 'int', duree: 'text', organisme: 'text', cout: 'real' } },
  habilitations: { pk: 'id', cols: { id: 'text', nom: 'text', detail: 'text', prereqs: 'json', medical: 'bool', validite: 'int', signataire: 'text' } },
  destinations: { pk: 'code', cols: { code: 'text', pays: 'text', visa: 'text', visaSub: 'text', oblig: 'json', rec: 'json', passMois: 'int' } },
  equipes: { pk: 'nom', cols: { nom: 'text', managerId: 'int', ordre: 'int' } },
  projets: { pk: 'code', cols: { code: 'text', nom: 'text', statut: 'text' } },
  chantiers: { pk: 'id', cols: { id: 'text', nom: 'text', client: 'text', lieu: 'text', pays: 'text', debut: 'text', fin: 'text', chef: 'text', habs: 'json', certs: 'json', ressources: 'json', statut: 'text' } },
  employes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', nom: 'text', equipe: 'text', poste: 'text', statut: 'text', typeContrat: 'text', temps: 'text', heures: 'real',
      forfaitHeures: 'real', forfaitJours: 'real', jourOff: 'json', tempsDepuis: 'text', entree: 'text', fin: 'text',
      naissance: 'int', agence: 'text', repriseMotif: 'text', repriseDate: 'text', visite: 'text', passeportNumero: 'text', passeportExpire: 'text',
    },
  },
  certifications: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', f: 'text', obtenue: 'text', sessionId: 'int', convoc: 'text' } },
  habTitres: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', h: 'text', delivree: 'text', par: 'text', demande: 'text', mesure: 'text', mesureDate: 'text', mesureMotif: 'text', mesurePar: 'text' } },
  visas: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', dest: 'text', type: 'text', obtenu: 'text', expire: 'text' } },
  vaccinations: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', v: 'text', date: 'text' } },
  sessions: { pk: 'id', auto: true, cols: { id: 'int', formation: 'text', date: 'text', lieu: 'text', places: 'int', inscrits: 'int', statut: 'text' } },
  inscriptions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', sessionId: 'int', convoc: 'text', date: 'text' }, unique: [['empId', 'sessionId']] },
  planActions: { pk: 'id', auto: true, cols: { id: 'int', exercice: 'int', f: 'text', libelle: 'text', equipe: 'text', periode: 'text', effectif: 'int', cout: 'real', statut: 'text', origine: 'text' } },
  budgets: { pk: 'id', auto: true, cols: { id: 'int', exercice: 'int', equipe: 'text', montant: 'real' }, unique: [['exercice', 'equipe']] },
  voyages: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', dest: 'text', depart: 'text', retour: 'text', motif: 'text', origine: 'text', ref: 'text', chantier: 'text' } },
  // Références Keystone (`ref`) uniques : index créés au démarrage (server/src/integrations/keystone-entrant.ts).
  demandesKeystone: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', chantier: 'text', dest: 'text', depart: 'text', retour: 'text', recue: 'text', ref: 'text', statut: 'text', decidee: 'text', decideur: 'text', voyageId: 'int' },
  },
  missions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', projet: 'text', lieu: 'text', du: 'text', au: 'text', type: 'text', ref: 'text' } },
  taches: { pk: 'id', auto: true, cols: { id: 'int', ref: 'text', empId: 'int', projet: 'text', tache: 'text', debut: 'text', fin: 'text', heures: 'json' } },
  feuilles: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', week: 'text', statut: 'text', comment: 'text', sage: 'bool', keystone: 'bool', lignes: 'json', contrat: 'json' }, unique: [['empId', 'week']] },
  absences: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', du: 'text', au: 'text', statut: 'text', keystone: 'bool' } },
  cet: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', jours: 'real', date: 'text', periode: 'text' } },
  reports: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', jours: 'real', motif: 'text', par: 'text', date: 'text', sens: 'text' } },
  soldesReprise: { pk: 'empId', cols: { empId: 'int', cpPris: 'real', rttPris: 'real', recupAcquis: 'real', recupPris: 'real' } },
  entretiens: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', date: 'text', statut: 'text', cr: 'json', info: 'bool', signSal: 'text', signMgr: 'text' } },
  demandesCollab: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', type: 'text', f: 'text', h: 'text', libelle: 'text', label: 'text', sessionId: 'int', motif: 'text', date: 'text', statut: 'text', reponse: 'text', parId: 'int', declaration: 'json' },
  },
  settings: { pk: 'key', cols: { key: 'text', value: 'json' } },
  journal: { pk: 'id', auto: true, cols: { id: 'int', at: 'text', actor: 'text', role: 'text', action: 'text', message: 'text', payload: 'json' } },
  // Sessions de connexion (server/src/auth.ts) ; `sessions` désigne les sessions de formation.
  connexions: {
    pk: 'id',
    cols: { id: 'text', role: 'text', rh: 'bool', managerId: 'int', collabId: 'int', creation: 'text', expiration: 'text', revocation: 'text', activite: 'text' },
  },
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

const snake = (s: string) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const SQL_TYPE: Record<ColType, string> = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER', json: 'TEXT' };

function toDb(t: ColType, v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (t === 'bool') return v ? 1 : 0;
  if (t === 'json') return JSON.stringify(v);
  if (t === 'int' || t === 'real') return Number(v);
  return String(v);
}
function fromDb(t: ColType, v: unknown): unknown {
  if (v === null || v === undefined) return t === 'bool' ? false : null;
  if (t === 'bool') return !!v;
  if (t === 'json') return JSON.parse(String(v));
  if (t === 'int' || t === 'real') return Number(v);
  return v;
}

export class Db {
  sql: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.createSchema();
  }

  private createSchema() {
    // Base existante à laquelle il manque des tables ou des colonnes : copie de sécurité d'abord.
    if (this.schemaAMigrer()) sauvegarderAvantMigration(this);
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) {
      const cols = Object.entries(def.cols).map(([c, t]) => {
        const pk = c === def.pk ? (def.auto ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY') : '';
        return `${snake(c)} ${SQL_TYPE[t]}${pk}`;
      });
      for (const u of def.unique ?? []) cols.push(`UNIQUE (${u.map(snake).join(', ')})`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${snake(name)} (${cols.join(', ')})`);
      // Base existante : ajoute les colonnes apparues depuis sa création.
      const existing = new Set((this.sql.prepare(`PRAGMA table_info(${snake(name)})`).all() as { name: string }[]).map(c => c.name));
      for (const [c, t] of Object.entries(def.cols)) {
        if (!existing.has(snake(c))) this.sql.exec(`ALTER TABLE ${snake(name)} ADD COLUMN ${snake(c)} ${SQL_TYPE[t]}`);
      }
    }
  }

  /** Vrai si la base contient déjà des tables de Cursus mais pas toutes les tables ou colonnes du schéma. */
  private schemaAMigrer(): boolean {
    const tables = new Set((this.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
    if (!Object.keys(TABLES).some(n => tables.has(snake(n)))) return false; // base neuve
    return (Object.entries(TABLES) as [TableName, TableDef][]).some(([name, def]) => {
      if (!tables.has(snake(name))) return true;
      const cols = new Set(this.columns(name));
      return Object.keys(def.cols).some(c => !cols.has(snake(c)));
    });
  }

  /** Noms des colonnes physiques d'une table (y compris celles qui ne sont plus utilisées). */
  columns(table: TableName): string[] {
    return (this.sql.prepare(`PRAGMA table_info(${snake(table)})`).all() as { name: string }[]).map(c => c.name);
  }

  private def(table: TableName): TableDef { return TABLES[table] as TableDef; }

  private decode<T>(table: TableName, r: Row): T {
    const def = this.def(table), o: Row = {};
    for (const [c, t] of Object.entries(def.cols)) o[c] = fromDb(t, r[snake(c)]);
    return o as T;
  }

  all<T>(table: TableName, orderBy?: string): T[] {
    const def = this.def(table);
    const order = orderBy ?? def.pk;
    return this.sql.prepare(`SELECT * FROM ${snake(table)} ORDER BY ${snake(order)}`).all().map(r => this.decode<T>(table, r as Row));
  }

  where<T>(table: TableName, field: string, value: unknown): T[] {
    const def = this.def(table);
    return this.sql.prepare(`SELECT * FROM ${snake(table)} WHERE ${snake(field)} = ? ORDER BY ${snake(def.pk)}`)
      .all(toDb(def.cols[field], value)).map(r => this.decode<T>(table, r as Row));
  }

  get<T>(table: TableName, id: unknown): T | undefined {
    const def = this.def(table);
    const r = this.sql.prepare(`SELECT * FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`).get(toDb(def.cols[def.pk], id));
    return r ? this.decode<T>(table, r as Row) : undefined;
  }

  insert<T = Row>(table: TableName, obj: Partial<T> | Row): T {
    const def = this.def(table);
    const o = obj as Row;
    const cols = Object.keys(def.cols).filter(c => o[c] !== undefined && !(c === def.pk && def.auto && o[c] == null));
    const res = this.sql.prepare(`INSERT INTO ${snake(table)} (${cols.map(snake).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map(c => toDb(def.cols[c], o[c])));
    const id = def.auto && o[def.pk] == null ? Number(res.lastInsertRowid) : o[def.pk];
    return this.get<T>(table, id)!;
  }

  update<T = Row>(table: TableName, id: unknown, patch: Partial<T> | Row): T {
    const def = this.def(table);
    const p = patch as Row;
    const cols = Object.keys(p).filter(c => c !== def.pk && c in def.cols);
    if (cols.length) {
      this.sql.prepare(`UPDATE ${snake(table)} SET ${cols.map(c => `${snake(c)} = ?`).join(', ')} WHERE ${snake(def.pk)} = ?`)
        .run(...cols.map(c => toDb(def.cols[c], p[c])), toDb(def.cols[def.pk], id));
    }
    return this.get<T>(table, id)!;
  }

  remove(table: TableName, id: unknown) {
    const def = this.def(table);
    this.sql.prepare(`DELETE FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`).run(toDb(def.cols[def.pk], id));
  }

  count(table: TableName): number {
    return Number((this.sql.prepare(`SELECT COUNT(*) AS n FROM ${snake(table)}`).get() as Row).n);
  }

  /** Vide les données (les sessions de connexion restent ouvertes). */
  clearAll() {
    for (const name of Object.keys(TABLES)) if (name !== 'connexions') this.sql.exec(`DELETE FROM ${snake(name)}`);
    this.sql.exec(`DELETE FROM sqlite_sequence`);
  }

  /** Exécute `fn` dans une transaction (annulée en cas d'erreur). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // transaction englobante déjà ouverte
    this.sql.exec('BEGIN');
    this.depth++;
    try {
      const r = fn();
      this.sql.exec('COMMIT');
      return r;
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  // — Paramètres clé / valeur —
  getSetting<T>(key: string, fallback: T): T {
    const r = this.get<{ key: string; value: T }>('settings', key);
    return r ? r.value : fallback;
  }
  setSetting(key: string, value: unknown) {
    if (this.get('settings', key)) this.update('settings', key, { value });
    else this.insert('settings', { key, value });
  }
}

/** Fichier de la base : CURSUS_DB, sinon data/cursus.db. */
export const dbFile = () => process.env.CURSUS_DB || 'data/cursus.db';

export function openDb(file = dbFile()) {
  return new Db(file);
}
