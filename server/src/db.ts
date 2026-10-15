// Accès SQLite (module node:sqlite) : schéma déclaratif et requêtes génériques.
// Les champs sont en camelCase côté code et en snake_case dans la base.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fichierBase } from './chemins.ts';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

type ColType = 'text' | 'int' | 'real' | 'bool' | 'json';
interface TableDef { pk: string; auto?: boolean; cols: Record<string, ColType>; unique?: string[][] }

export const TABLES = {
  // Référentiels administrés par le service RH (server/src/actions/referentiels.ts) : `archive`, date d'archivage (null :
  // en vigueur) ; on archive au lieu de supprimer.
  formations: { pk: 'id', cols: { id: 'text', nom: 'text', court: 'text', type: 'text', validite: 'int', duree: 'text', organisme: 'text', cout: 'real', validation: 'text', archive: 'text' } },
  habilitations: { pk: 'id', cols: { id: 'text', nom: 'text', detail: 'text', prereqs: 'json', medical: 'bool', validite: 'int', signataire: 'text', archive: 'text' } },
  // `secu` : formalité de sécurité sociale du détachement (null : déduite du code pays, shared/constants.ts).
  destinations: { pk: 'code', cols: { code: 'text', pays: 'text', visa: 'text', visaSub: 'text', oblig: 'json', rec: 'json', passMois: 'int', secu: 'text', archive: 'text' } },
  equipes: { pk: 'nom', cols: { nom: 'text', managerId: 'int', ordre: 'int' } },
  projets: { pk: 'code', cols: { code: 'text', nom: 'text', statut: 'text' } },
  chantiers: { pk: 'id', cols: { id: 'text', nom: 'text', client: 'text', lieu: 'text', pays: 'text', debut: 'text', fin: 'text', chef: 'text', habs: 'json', certs: 'json', ressources: 'json', statut: 'text' } },
  employes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', nom: 'text', equipe: 'text', poste: 'text', statut: 'text', typeContrat: 'text', temps: 'text', heures: 'real',
      forfaitHeures: 'real', forfaitJours: 'real', jourOff: 'json', tempsDepuis: 'text', entree: 'text', fin: 'text',
      naissance: 'int', agence: 'text', repriseMotif: 'text', repriseDate: 'text', visite: 'text', passeportNumero: 'text', passeportExpire: 'text',
      email: 'text', notifications: 'text', // adresse professionnelle et réglage des notifications (server/src/notifications.ts)
      // Avis du médecin du travail à la dernière visite et restrictions datées (`medical.avis`) : données de santé.
      avis: 'text', restrictions: 'json',
      // Matricule du dossier de paie (Sage) : unique, contrôlé par le serveur (une réembauche confirmée le réutilise).
      matriculePaie: 'text',
    },
  },
  // Demandes de visite médicale du service RH, closes par la saisie de la visite (server/src/actions/sante.ts).
  demandesVisite: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', motif: 'text', le: 'text', par: 'text', statut: 'text', closeLe: 'text', closePar: 'text' } },
  certifications: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', f: 'text', obtenue: 'text', sessionId: 'int', convoc: 'text', convocLe: 'text' } },
  habTitres: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', h: 'text', delivree: 'text', par: 'text', demande: 'text', mesure: 'text', mesureDate: 'text', mesureMotif: 'text', mesurePar: 'text' } },
  visas: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', dest: 'text', type: 'text', obtenu: 'text', expire: 'text' } },
  vaccinations: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', v: 'text', date: 'text' } },
  // Le nombre d'inscrits n'est pas stocké : il est calculé au chargement (server/src/dataset.ts).
  sessions: { pk: 'id', auto: true, cols: { id: 'int', formation: 'text', date: 'text', lieu: 'text', places: 'int', statut: 'text', planId: 'int', bilan: 'json' } },
  inscriptions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', sessionId: 'int', convoc: 'text', date: 'text', convocLe: 'text' }, unique: [['empId', 'sessionId']] },
  // `reussi` peut rester indéterminé (null) : stocké en JSON pour garder true / false / null.
  participations: { pk: 'id', auto: true, cols: { id: 'int', sessionId: 'int', empId: 'int', parcours: 'text', present: 'bool', reussi: 'json', certId: 'int' }, unique: [['sessionId', 'empId']] },
  planActions: { pk: 'id', auto: true, cols: { id: 'int', exercice: 'int', f: 'text', libelle: 'text', equipe: 'text', periode: 'text', effectif: 'int', cout: 'real', statut: 'text', origine: 'text' } },
  budgets: { pk: 'id', auto: true, cols: { id: 'int', exercice: 'int', equipe: 'text', montant: 'real' }, unique: [['exercice', 'equipe']] },
  // Formalités de détachement tenues par le RH (`voyage.detachement`) : certificat de sécurité sociale, information écrite.
  voyages: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', dest: 'text', depart: 'text', retour: 'text', motif: 'text', origine: 'text', ref: 'text', chantier: 'text', detachementLe: 'text', informationLe: 'text' },
  },
  // Références Keystone (`ref`) uniques : index créés au démarrage (server/src/integrations/keystone-entrant.ts).
  demandesKeystone: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', chantier: 'text', dest: 'text', depart: 'text', retour: 'text', recue: 'text', ref: 'text', statut: 'text', decidee: 'text', decideur: 'text', voyageId: 'int',
      // Motif d'un refus par le service RH : conservé dans Cursus, jamais transmis à Keystone.
      motifRefus: 'text' },
  },
  missions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', projet: 'text', lieu: 'text', du: 'text', au: 'text', type: 'text', ref: 'text' } },
  taches: { pk: 'id', auto: true, cols: { id: 'int', ref: 'text', empId: 'int', projet: 'text', tache: 'text', debut: 'text', fin: 'text', heures: 'json' } },
  // `motifDepassement` : motif d'un dépassement des durées maximales de travail (server/src/actions/temps.ts).
  feuilles: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', week: 'text', statut: 'text', comment: 'text', sage: 'bool', keystone: 'bool', lignes: 'json', contrat: 'json', motifDepassement: 'text' }, unique: [['empId', 'week']] },
  absences: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', type: 'text', du: 'text', au: 'text', statut: 'text', keystone: 'bool',
      // Absences hors congés : signalement, justificatif, prolongation ; annulation (toutes absences).
      signaleLe: 'text', signalePar: 'text', justificatif: 'bool', justificatifLe: 'text', finInitiale: 'text', annuleeLe: 'text', annuleePar: 'text',
      signaleParInteresse: 'bool',
      // Motif d'une demande refusée, montré au salarié et à son manager.
      motifRefus: 'text',
    },
  },
  cet: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', jours: 'real', date: 'text', periode: 'text' } },
  // `periode` : année de prise de la période dont les droits reçoivent les jours ; `expire` : échéance (shared/rules/conges.ts).
  reports: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', jours: 'real', motif: 'text', par: 'text', date: 'text', sens: 'text', periode: 'int', expire: 'text' } },
  // `arreteLe` : date d'arrêté des compteurs repris, qui fixe la période CP et l'année RTT sur lesquelles ils comptent.
  soldesReprise: { pk: 'empId', cols: { empId: 'int', cpPris: 'real', rttPris: 'real', recupAcquis: 'real', recupPris: 'real', arreteLe: 'text' } },
  // Clôtures des périodes de congés (`conges.cloturer`) : solde photographié et décision, une ligne par salarié et période.
  clotures: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', type: 'text', periode: 'int', solde: 'real', decision: 'text', reportes: 'real', perdus: 'real', expire: 'text',
      reportId: 'int', motif: 'text', le: 'text', par: 'text',
    },
    unique: [['empId', 'type', 'periode']],
  },
  // `planifieLe` : jour de la planification (ou de la reprogrammation), borne de la date réelle saisie à la clôture.
  entretiens: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', date: 'text', statut: 'text', cr: 'json', info: 'bool', signSal: 'text', signMgr: 'text', planifieLe: 'text' } },
  demandesCollab: {
    pk: 'id', auto: true,
    // `motifRefus` : motif d'un refus par le service RH, montré au collaborateur seul (server/src/dataset.ts).
    cols: { id: 'int', empId: 'int', type: 'text', f: 'text', h: 'text', libelle: 'text', label: 'text', sessionId: 'int', motif: 'text', date: 'text', statut: 'text', reponse: 'text', parId: 'int', declaration: 'json', motifRefus: 'text' },
  },
  settings: { pk: 'key', cols: { key: 'text', value: 'json' } },
  // `actor` : nom de la personne connectée ; `compteId` et `identifiant` : son compte (server/src/comptes.ts).
  // `payload` : champs retenus par la liste blanche de l'action ; `salaries` : salariés concernés ; `paie` : action
  // liée à la paie, archivée (`archivee`) au bout d'un an au lieu d'être supprimée (server/src/journal.ts).
  journal: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', at: 'text', actor: 'text', role: 'text', action: 'text', message: 'text', payload: 'json', compteId: 'int', identifiant: 'text',
      salaries: 'json', paie: 'bool', archivee: 'text',
    },
  },
  // Comptes de connexion (server/src/comptes.ts) : un par personne, salarié (`empId`) ou externe (`nom`, `adresse`).
  // `identifiant` en minuscules (adresse Microsoft 365 pour un compte Microsoft) ; `oid` : identifiant Microsoft,
  // renseigné à la première connexion ; `motDePasse` : empreinte scrypt d'un compte local.
  comptes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', nom: 'text', adresse: 'text', identifiant: 'text', type: 'text', oid: 'text', profilRh: 'text', actif: 'bool',
      motDePasse: 'text', changerMotDePasse: 'bool', echecs: 'int', blocageFin: 'text', creation: 'text', creePar: 'text', derniereConnexion: 'text',
    },
    unique: [['identifiant'], ['oid']],
  },
  // Sessions de connexion (server/src/auth.ts) ; `sessions` désigne les sessions de formation.
  // Une session porte un compte et l'espace actif ; `demoComptes` : comptes choisis par espace (démonstration).
  connexions: {
    pk: 'id',
    cols: {
      id: 'text', compteId: 'int', role: 'text', methode: 'text', demoComptes: 'json', creation: 'text', expiration: 'text', revocation: 'text', activite: 'text',
    },
  },
  // File d'envoi des messages sortants (server/src/envois.ts) : une clé d'idempotence par message.
  envois: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', cible: 'text', type: 'text', cle: 'text', contenu: 'json', statut: 'text', tentatives: 'int', prochaine: 'text',
      erreur: 'text', accuse: 'text', creation: 'text', tentative: 'text', envoi: 'text',
      classe: 'text', // échec examiné et classé par le RH : ne compte plus dans l'état de l'intégration
    },
    unique: [['cle']],
  },
  // Notifications d'étapes en attente du récapitulatif quotidien (server/src/notifications.ts) : `empId` null pour
  // le service RH ; `adresse` : trace (le récapitulatif part à l'adresse en vigueur) ; `envoiId` : e-mail du
  // récapitulatif qui les a portées (0 : close sans envoi, destinataire sans adresse ou sorti).
  notifications: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', adresse: 'text', type: 'text', objet: 'text', texte: 'text', creation: 'text', envoiId: 'int' } },
  // Relevés d'heures des intérimaires transmis aux agences, un par envoi (server/src/releves.ts) ; `enAttente` :
  // feuilles non validées au moment de l'envoi (relevé incomplet, complété automatiquement ensuite).
  releves: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', agence: 'text', semaine: 'text', adresse: 'text', creation: 'text', par: 'text', envoiId: 'int', interimaires: 'int', heures: 'real',
      enAttente: 'int',
    },
  },
  // Dernier verdict Go / No Go transmis à Keystone, par chantier et ressource (server/src/integrations/keystone-verdicts.ts).
  verdictsKeystone: { pk: 'id', auto: true, cols: { id: 'int', chantier: 'text', empId: 'int', statut: 'text', motifs: 'json', date: 'text' }, unique: [['chantier', 'empId']] },
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

export const snake = (s: string) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const SQL_TYPE: Record<ColType, string> = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER', json: 'TEXT' };

/** Colonnes et contraintes d'une table du schéma, telles que CREATE TABLE les attend (reprises par reconstruireTable). */
export function colonnesSql(name: TableName): string {
  const def = TABLES[name] as TableDef;
  const cols = Object.entries(def.cols).map(([c, t]) => {
    const pk = c === def.pk ? (def.auto ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY') : '';
    return `${snake(c)} ${SQL_TYPE[t]}${pk}`;
  });
  for (const u of def.unique ?? []) cols.push(`UNIQUE (${u.map(snake).join(', ')})`);
  return cols.join(', ');
}

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
  /** Base sans aucune table de Cursus à l'ouverture, créée à l'instant : les migrations nommées s'y appliquent sans copie. */
  readonly neuve: boolean;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
      // Base neuve créée vide en 600 avant que SQLite ne l'ouvre (données de santé et de paie) : ses fichiers -wal et
      // -shm prennent les mêmes droits. Base existante : droits contrôlés au démarrage (server/src/protection.ts).
      try { writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); } catch { /* déjà présente */ }
    }
    this.sql = new DatabaseSync(file);
    // Base occupée par une autre connexion (npm run comptes, sauvegarde) : attente jusqu'à 5 s plutôt qu'un échec immédiat.
    this.sql.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const tables = this.tablesSql();
    this.neuve = !Object.keys(TABLES).some(n => tables.has(snake(n)));
    this.createSchema();
  }

  private tablesSql(): Set<string> {
    return new Set((this.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
  }

  private createSchema() {
    // Base existante à laquelle il manque des tables ou des colonnes : copie de sécurité d'abord.
    if (this.schemaAMigrer()) sauvegarderAvantMigration(this);
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${snake(name)} (${colonnesSql(name)})`);
      // Base existante : ajoute les colonnes apparues depuis sa création.
      const existing = new Set((this.sql.prepare(`PRAGMA table_info(${snake(name)})`).all() as { name: string }[]).map(c => c.name));
      for (const [c, t] of Object.entries(def.cols)) {
        if (!existing.has(snake(c))) this.sql.exec(`ALTER TABLE ${snake(name)} ADD COLUMN ${snake(c)} ${SQL_TYPE[t]}`);
      }
    }
  }

  /** Vrai si la base contient déjà des tables de Cursus mais pas toutes les tables ou colonnes du schéma. */
  private schemaAMigrer(): boolean {
    if (this.neuve) return false;
    const tables = this.tablesSql();
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

  /** Vide les données (les sessions de connexion restent ouvertes, le journal des actions est conservé). */
  clearAll() {
    for (const name of Object.keys(TABLES)) if (name !== 'connexions' && name !== 'journal') this.sql.exec(`DELETE FROM ${snake(name)}`);
    this.sql.exec(`DELETE FROM sqlite_sequence WHERE name <> 'journal'`);
  }

  /** Exécute `fn` dans une transaction (annulée en cas d'erreur). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // transaction englobante déjà ouverte
    // IMMEDIATE : verrou d'écriture pris d'emblée, en attendant au besoin (busy_timeout) qu'une autre connexion libère la
    // base ; une transaction différée qui lit puis écrit échouerait sans attendre si une autre connexion a écrit entre-temps.
    this.sql.exec('BEGIN IMMEDIATE');
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

/** Fichier de la base, en chemin absolu : CURSUS_DB, sinon data/cursus.db du projet (server/src/chemins.ts). */
export const dbFile = () => fichierBase();

export function openDb(file = dbFile()) {
  return new Db(file);
}
