// Sauvegarde de la base SQLite : copie cohérente à chaud (VACUUM INTO), vérification,
// rotation, restauration, et verrou qui signale qu'un serveur utilise la base.
// Utilisé par npm run backup / npm run restore, avant une migration de schéma et
// avant la réinitialisation de la démonstration. Procédure d'exploitation : docs/SAUVEGARDE.md.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Db } from './db.ts';

export class SauvegardeError extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Mise en forme des comptes rendus (npm run backup / restore).
export function fmtTaille(o: number) {
  if (o < 1024 * 1024) return `${Math.max(1, Math.round(o / 1024))} Ko`;
  const [v, u] = o < 1024 ** 3 ? [o / 1024 ** 2, 'Mo'] : [o / 1024 ** 3, 'Go'];
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${u}`;
}
export const fmtDuree = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
export const fmtDateHeure = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Chemin réel d'une base : un lien symbolique est suivi, une base pas encore créée est acceptée. */
function cheminReel(f: string): string {
  try { return realpathSync(f); } catch { /* base pas encore créée */ }
  try { return join(realpathSync(dirname(f)), basename(f)); } catch { return resolve(f); }
}

/**
 * Dossier des copies : CURSUS_BACKUP_DIR, sinon `backups/` à côté de la base (data/backups par défaut).
 * Derrière un lien symbolique, à côté de sa cible : copies manuelles et automatiques au même endroit.
 */
export function dossierSauvegardes(base: string): string {
  return resolve(process.env.CURSUS_BACKUP_DIR || join(dirname(cheminReel(base)), 'backups'));
}

/** Copies conservées par type de sauvegarde : CURSUS_BACKUP_KEEP (14 par défaut, 0 = toutes). */
export function copiesConservees(): number {
  const v = process.env.CURSUS_BACKUP_KEEP?.trim();
  if (!v) return 14;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new SauvegardeError(`CURSUS_BACKUP_KEEP invalide (« ${v} ») : nombre entier attendu, 0 pour tout conserver`);
  return n;
}

// — Vérification —

export interface Verification {
  employes: number;
  /** Date de la dernière action tracée dans le journal : l'état de la base « au ». */
  dernierJournal: string | null;
  taille: number;
}

/**
 * Vérifie qu'un fichier est une base SQLite intègre (PRAGMA integrity_check) et, avec `cursus`,
 * qu'il s'agit bien d'une base Cursus (tables employes et journal) ; lève une SauvegardeError sinon.
 */
export function verifier(fichier: string, { cursus = true } = {}): Verification {
  if (!existsSync(fichier) || !statSync(fichier).isFile()) throw new SauvegardeError(`Fichier introuvable : ${fichier}`);
  let sql: DatabaseSync;
  try {
    sql = new DatabaseSync(fichier, { readOnly: true });
  } catch (e) {
    throw new SauvegardeError(`Fichier illisible : ${fichier} (${message(e)})`);
  }
  try {
    const erreurs = (sql.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map(r => r.integrity_check).filter(r => r !== 'ok');
    if (erreurs.length) throw new SauvegardeError(`Base endommagée : ${fichier} (${erreurs.slice(0, 3).join(' ; ')})`);
    const tables = new Set((sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
    if (cursus && (!tables.has('employes') || !tables.has('journal'))) throw new SauvegardeError(`${fichier} n’est pas une base Cursus (tables employes et journal absentes)`);
    const employes = tables.has('employes') ? Number((sql.prepare('SELECT COUNT(*) AS n FROM employes').get() as { n: number }).n) : 0;
    const dernier = tables.has('journal') ? (sql.prepare('SELECT MAX(at) AS at FROM journal').get() as { at: string | null }).at : null;
    return { employes, dernierJournal: dernier ?? null, taille: statSync(fichier).size };
  } catch (e) {
    if (e instanceof SauvegardeError) throw e;
    throw new SauvegardeError(`${fichier} n’est pas une base SQLite valide (${message(e)})`);
  } finally {
    sql.close();
  }
}

// — Nommage et rotation —
// <base>-<horodatage UTC>[-n][-motif].db, par exemple cursus-2026-10-10T021500Z-avant-migration.db.
// L'horodatage est en UTC pour rester dans l'ordre aux changements d'heure.

export type Motif = 'avant-migration' | 'avant-reinitialisation' | 'avant-restauration';

export interface Copie {
  fichier: string;
  nom: string;
  /** Nom de la base sauvegardée (cursus pour data/cursus.db). */
  base: string;
  date: Date;
  motif: string | null;
  taille: number;
}

const NOM = /^(.+?)-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-(\d+))?(?:-([a-z]+(?:-[a-z]+)*))?\.db$/;
const prefixe = (base: string) => basename(base).replace(/\.(db|sqlite3?)$/i, '');
const horodatage = (d: Date) => d.toISOString().replace(/:/g, '').replace(/\.\d+Z$/, 'Z');

function nomLibre(dir: string, base: string, date: Date, motif?: string): string {
  for (let n = 1; ; n++) {
    const f = join(dir, `${prefixe(base)}-${horodatage(date)}${n > 1 ? `-${n}` : ''}${motif ? `-${motif}` : ''}.db`);
    if (!existsSync(f) && !existsSync(f + '.partiel')) return f;
  }
}

/** Copies présentes dans un dossier, de la plus récente à la plus ancienne (les autres fichiers sont ignorés). */
export function listerSauvegardes(dir: string): Copie[] {
  if (!existsSync(dir)) return [];
  const out: (Copie & { rang: number })[] = [];
  for (const nom of readdirSync(dir)) {
    const m = NOM.exec(nom);
    if (!m) continue;
    const fichier = join(dir, nom);
    const st = statSync(fichier);
    if (!st.isFile()) continue;
    out.push({ fichier, nom, base: m[1], date: new Date(`${m[2]}T${m[3]}:${m[4]}:${m[5]}Z`), motif: m[7] ?? null, taille: st.size, rang: Number(m[6] ?? 1) });
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime() || b.rang - a.rang).map(({ rang: _, ...c }) => c);
}

/**
 * Ne garde que les `keep` copies les plus récentes de la même base et du même motif : une série de
 * réinitialisations de la démo n'efface pas les copies quotidiennes. La copie `garder` (celle qui
 * vient d'être faite) n'est jamais supprimée, même si l'horloge a reculé. Renvoie les fichiers supprimés.
 */
export function rotation(dir: string, base: string, motif: string | null, keep: number, garder?: string): string[] {
  if (keep <= 0) return [];
  const copies = listerSauvegardes(dir).filter(c => c.base === prefixe(base) && c.motif === motif);
  const ordre = [...copies.filter(c => c.fichier === garder), ...copies.filter(c => c.fichier !== garder)];
  const trop = ordre.slice(keep).map(c => c.fichier);
  trop.forEach(f => rmSync(f, { force: true }));
  return trop;
}

// — Sauvegarde —

export interface Sauvegarde extends Verification {
  fichier: string;
  /** Copies de ce type présentes après la rotation. */
  conservees: number;
  supprimees: string[];
  duree: number;
}

export interface OptionsSauvegarde {
  motif?: Motif;
  /** Dossier des copies (dossierSauvegardes par défaut). */
  dir?: string;
  /** Copies conservées (copiesConservees() par défaut). */
  keep?: number;
  date?: Date;
  /**
   * Lecture seule : la base n'est jamais modifiée, même si la copie échoue. Une connexion en écriture
   * qui se ferme la dernière reporte le journal -wal dans la base, puis le supprime.
   */
  lectureSeule?: boolean;
}

/** Délai au-delà duquel une copie provisoire (.partiel) est celle d'une sauvegarde interrompue. */
const PARTIEL_ABANDONNE = 60 * 60 * 1000;

/** Supprime les copies provisoires de cette base laissées par une sauvegarde interrompue (arrêt brutal, coupure). */
function purgerPartiels(dir: string, source: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    if (!nom.endsWith('.db.partiel') || NOM.exec(nom.slice(0, -'.partiel'.length))?.[1] !== prefixe(source)) continue;
    const f = join(dir, nom);
    try {
      // Une copie en cours d'écriture a une date de modification récente.
      if (Date.now() - statSync(f).mtimeMs > PARTIEL_ABANDONNE) { rmSync(f, { force: true }); out.push(f); }
    } catch { /* déjà supprimée */ }
  }
  return out;
}

/**
 * Copie cohérente de la base, même serveur démarré : VACUUM INTO lit un instantané de la base
 * (journal WAL compris) et écrit un fichier autonome. La copie est écrite sous un nom provisoire,
 * vérifiée, puis renommée : une sauvegarde interrompue ne laisse jamais de fichier d'apparence valide.
 */
export function sauvegarder(base: string, opts: OptionsSauvegarde = {}): Sauvegarde {
  const t0 = Date.now();
  // Chemin réel : derrière un lien symbolique, mêmes noms de copies que db.sql.location() (copies automatiques).
  const source = cheminReel(base);
  // Sans ce contrôle, SQLite créerait une base vide à la place de celle attendue.
  if (!existsSync(source)) throw new SauvegardeError(`Base introuvable : ${source}`);
  const keep = opts.keep ?? copiesConservees();
  const dir = resolve(opts.dir ?? dossierSauvegardes(source));
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    throw new SauvegardeError(`Copie impossible vers ${dir} (${message(e)})`);
  }
  const fichier = nomLibre(dir, source, opts.date ?? new Date(), opts.motif);
  const partiel = fichier + '.partiel';
  let verification: Verification;
  try {
    // Fichier vide créé d'abord en 600 (VACUUM INTO l'accepte) : données de santé et de paie, jamais
    // lisibles par un autre compte, même pendant la copie ou si elle est interrompue.
    writeFileSync(partiel, '', { mode: 0o600, flag: 'wx' });
    // Connexion distincte : VACUUM INTO est impossible dans une transaction ouverte (action en cours).
    const sql = new DatabaseSync(source, { readOnly: opts.lectureSeule ?? false });
    try {
      sql.exec('PRAGMA busy_timeout = 10000');
      sql.prepare('VACUUM INTO ?').run(partiel);
    } finally {
      sql.close();
    }
    verification = verifier(partiel, { cursus: false }); // copie fidèle, même d'une base très ancienne
    renameSync(partiel, fichier);
  } catch (e) {
    rmSync(partiel, { force: true });
    throw e instanceof SauvegardeError ? e : new SauvegardeError(`Copie impossible vers ${dir} (${message(e)})`);
  }
  const supprimees = [...rotation(dir, source, opts.motif ?? null, keep, fichier), ...purgerPartiels(dir, source)];
  const conservees = listerSauvegardes(dir).filter(c => c.base === prefixe(source) && c.motif === (opts.motif ?? null)).length;
  return { ...verification, fichier, conservees, supprimees, duree: Date.now() - t0 };
}

/** Sauvegarde de la base ouverte par `db` (null pour une base en mémoire, sans fichier). */
export function sauvegarderBase(db: Db, motif: Motif): Sauvegarde | null {
  const file = db.sql.location();
  return file ? sauvegarder(file, { motif }) : null;
}

const avantMigration = new WeakMap<Db, string>();

/** Copie « avant-migration » d'une base existante, une seule par ouverture même si plusieurs étapes la modifient. */
export function sauvegarderAvantMigration(db: Db): string | null {
  if (avantMigration.has(db)) return avantMigration.get(db)!;
  const s = sauvegarderBase(db, 'avant-migration');
  if (!s) return null;
  console.log(`Sauvegarde avant migration : ${s.fichier}`);
  avantMigration.set(db, s.fichier);
  return s.fichier;
}

/** Copie « avant-migration » faite à cette ouverture de la base, ou null (signalée par le journal, server/src/journal.ts). */
export const copieAvantMigration = (db: Db): string | null => avantMigration.get(db) ?? null;

// — Verrou du serveur —
// Le serveur écrit <base>.pid au démarrage et le retire à l'arrêt ; il refuse de démarrer si un autre
// serveur en service a déjà posé le sien. Un verrou laissé par un arrêt brutal est reconnu comme
// périmé : processus disparu, numéro de processus réattribué, ou machine redémarrée depuis sa pose.

export interface Verrou {
  pid: number;
  depuis: string;
  /** Linux : identifiant du démarrage de la machine (/proc/sys/kernel/random/boot_id). */
  boot?: string | null;
  /** Linux : instant de lancement du processus, en tops d'horloge depuis le démarrage (/proc/<pid>/stat). */
  lancement?: string | null;
}

// Ces deux repères ne dépendent pas de l'horloge murale, qui peut être corrigée après le démarrage (NTP).
function lireProc(f: string): string | null {
  try { return readFileSync(f, 'utf8').trim(); } catch { return null; }
}
const bootId = () => lireProc('/proc/sys/kernel/random/boot_id');
function lancement(pid: number): string | null {
  const stat = lireProc(`/proc/${pid}/stat`); // « pid (nom) état … » : le nom peut contenir espaces et parenthèses
  return stat ? stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null : null; // 22e champ
}
/** Sans identifiant de démarrage (hors Linux), marge sur la date de démarrage déduite de l'horloge murale. */
const MARGE_HORLOGE = 10 * 60 * 1000;

export const fichierVerrou = (base: string) => cheminReel(base) + '.pid';

function lireVerrou(f: string): Verrou | null {
  try {
    const v = JSON.parse(readFileSync(f, 'utf8'));
    return Number.isInteger(v?.pid) ? v : null;
  } catch {
    return null;
  }
}

/** Serveur qui utilise la base d'après son verrou, ou null (pas de verrou, ou verrou périmé). */
export function serveurActif(base: string): Verrou | null {
  const v = lireVerrou(fichierVerrou(base));
  if (!v) return null;
  const boot = bootId();
  if (v.boot && boot) {
    if (v.boot !== boot) return null; // posé avant le dernier démarrage de la machine
  } else if (Date.parse(v.depuis) < Date.now() - uptime() * 1000 - MARGE_HORLOGE) return null;
  const l = v.lancement ? lancement(v.pid) : null;
  if (l && l !== v.lancement) return null; // numéro réattribué à un autre processus
  try {
    process.kill(v.pid, 0); // signal 0 : teste l'existence du processus sans le toucher
    return v;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? v : null; // EPERM : processus d'un autre compte
  }
}

/**
 * Pose le verrou du serveur ; il est retiré à la sortie du processus et sur SIGINT / SIGTERM.
 * Lève une SauvegardeError si un autre serveur en service utilise déjà la base : son verrou reste
 * en place, sinon l'arrêt de la seconde instance le retirerait et npm run restore ne serait plus bloqué.
 */
export function poserVerrou(base: string) {
  mkdirSync(dirname(resolve(base)), { recursive: true }); // premier démarrage : dossier pas encore créé
  const f = fichierVerrou(base);
  const contenu = JSON.stringify({ pid: process.pid, depuis: new Date().toISOString(), boot: bootId(), lancement: lancement(process.pid) }) + '\n';
  for (let essai = 1; ; essai++) {
    try {
      writeFileSync(f, contenu, { flag: 'wx' }); // création exclusive : de deux serveurs lancés ensemble, un seul l'obtient
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const autre = serveurActif(base);
      if (autre && autre.pid !== process.pid) {
        throw new SauvegardeError(`Un autre serveur Cursus utilise déjà cette base (processus ${autre.pid}, verrou ${f}). `
          + 'Arrêtez-le avant d’en démarrer un autre, ou donnez à celui-ci sa propre base (CURSUS_DB) ; '
          + 'si ce processus n’est pas un serveur Cursus, supprimez le verrou.');
      }
      if (essai === 3) throw new SauvegardeError(`Verrou ${f} impossible à poser`);
      rmSync(f, { force: true }); // verrou périmé : arrêt brutal d'un serveur précédent
    }
  }
  const retirer = () => {
    try { if (lireVerrou(f)?.pid === process.pid) unlinkSync(f); } catch { /* déjà retiré */ }
  };
  process.once('exit', retirer);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    const h = () => {
      retirer();
      process.removeListener(sig, h);
      // Sans autre gestionnaire (arrêt propre), le signal reprend son effet par défaut : l'arrêt.
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    process.on(sig, h);
  }
  return retirer;
}

// — Restauration —

export interface Restauration {
  verification: Verification;
  /** Copie de la base remplacée (null si elle n'existait pas). */
  avant: string | null;
  /** Dossier des fichiers bruts de la base remplacée, quand elle n'a pas pu être copiée proprement (--force). */
  brut: string | null;
  /** Serveur encore actif, restauration forcée. */
  serveur: Verrou | null;
}

/**
 * Remplace la base par une sauvegarde : vérifie le fichier, refuse si un serveur utilise la base
 * (sauf `force`), sauvegarde la base actuelle (« avant-restauration »), puis remplace le fichier
 * et supprime les journaux -wal / -shm de l'ancienne base, qui ne doivent pas être rejoués sur la nouvelle.
 */
export function restaurer(fichier: string, base: string, opts: { force?: boolean; dir?: string; keep?: number } = {}): Restauration {
  // Derrière un lien symbolique, c'est sa cible qui est remplacée : le lien reste en place.
  const source = resolve(fichier), cible = cheminReel(base);
  const verification = verifier(source);
  if (cheminReel(source) === cheminReel(cible)) throw new SauvegardeError('Le fichier à restaurer est la base elle-même');
  const serveur = serveurActif(cible);
  if (serveur && !opts.force) {
    throw new SauvegardeError(`Le serveur Cursus semble démarré (processus ${serveur.pid}, verrou ${fichierVerrou(cible)}). `
      + 'Arrêtez-le avant de restaurer, ou relancez avec --force si ce verrou est périmé.');
  }
  const dir = resolve(opts.dir ?? dossierSauvegardes(cible));
  const keep = opts.keep ?? copiesConservees();
  let avant: string | null = null, brut: string | null = null;
  // Copie vérifiée à côté de la base d'abord : le fichier source peut venir d'un support amovible,
  // ou être supprimé par la rotation qui suit ; le renommage final ne laisse jamais une base à moitié écrite.
  const provisoire = cible + '.restauration';
  mkdirSync(dirname(cible), { recursive: true });
  try {
    copyFileSync(source, provisoire);
    chmodSync(provisoire, 0o600);
    verifier(provisoire);
    if (existsSync(cible)) {
      try {
        // Lecture seule : une base illisible et ses journaux restent tels quels, pour le refus comme pour la copie brute.
        avant = sauvegarder(cible, { motif: 'avant-restauration', dir, keep, lectureSeule: true }).fichier;
      } catch (e) {
        if (!opts.force) {
          throw new SauvegardeError(`La base actuelle n’a pas pu être sauvegardée (${message(e)}) : restauration annulée. `
            + 'Relancez avec --force pour la remplacer quand même ; ses fichiers seront d’abord copiés tels quels dans le dossier des sauvegardes.');
        }
        // Base actuelle illisible (c'est souvent la raison de la restauration) : copie brute de ses fichiers.
        brut = join(dir, `${prefixe(cible)}-${horodatage(new Date())}-avant-restauration-brut`);
        mkdirSync(brut, { recursive: true, mode: 0o700 });
        for (const ext of ['', '-wal', '-shm', '-journal']) if (existsSync(cible + ext)) copyFileSync(cible + ext, join(brut, basename(cible) + ext));
      }
    }
    for (const ext of ['-wal', '-shm', '-journal']) rmSync(cible + ext, { force: true });
    renameSync(provisoire, cible);
  } finally {
    for (const ext of ['', '-wal', '-shm']) rmSync(provisoire + ext, { force: true });
  }
  return { verification, avant, brut, serveur };
}
