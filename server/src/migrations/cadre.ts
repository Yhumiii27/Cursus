// Migrations nommées : chacune s'exécute une seule fois par base, dans une transaction, après la copie
// « avant-migration », et son nom est enregistré dans la table `migrations`. Pas de numéro de version global
// (PRAGMA user_version reste à 0) : deux chantiers menés en parallèle ajoutent chacun la leur sans collision.
// Une base qui porte une migration inconnue de ce code (mise à jour par une version plus récente) est refusée.
// Liste ordonnée : server/src/migrations/liste.ts ; mode d'emploi : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
// Le schéma déclaratif (tables et colonnes ajoutées, server/src/db.ts) et les reprises rejouées à chaque démarrage
// (server/src/migrate.ts) passent avant.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { plural } from '../../../shared/format.ts';
import type { Db } from '../db.ts';
import { dossierSauvegardes, fmtDateHeure, sauvegarderAvantMigration, serveurActif } from '../sauvegarde.ts';
import { MIGRATIONS } from './liste.ts';

export interface Migration {
  /** Nom unique et définitif, en minuscules et tirets (« lot4-paie-lots-historiques ») : jamais renommé ni réutilisé. */
  nom: string;
  /**
   * Vrai si la base a besoin de la migration (anciennes valeurs à reprendre, index absent…). Faux : elle est seulement
   * notée faite, sans être exécutée (base neuve, ou déjà dans l'état visé). Absent : toujours vrai.
   */
  necessaire?: (db: Db) => boolean;
  /**
   * Modifie la base, dans la transaction de la migration : une erreur annule tout ce qu'elle a fait et arrête le
   * démarrage. Peut renvoyer un court compte rendu, affiché au démarrage (« 12 lots repris »).
   */
  executer: (db: Db) => string | void;
}

/** Démarrage refusé : base trop récente, ou migration interrompue (message en français, pour le service informatique). */
export class MigrationError extends Error {}

/**
 * Table des migrations faites, hors du schéma déclaratif : la réinitialisation de la démonstration ne la vide pas.
 * `copie` : copie « avant-migration » faite juste avant que la mise à jour n'enregistre son premier nom (null pour une
 * base neuve), celle qu'une version plus ancienne demande de restaurer.
 */
const TABLE = 'CREATE TABLE IF NOT EXISTS migrations (nom TEXT PRIMARY KEY, appliquee TEXT NOT NULL, executee INTEGER NOT NULL, copie TEXT)';
const NOM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Migration enregistrée dans une base : son nom, l'instant (ISO) de son enregistrement et la copie faite avant. */
interface Enregistree { nom: string; appliquee: string; copie: string | null }

function lireMigrations(sql: DatabaseSync): Enregistree[] {
  if (!sql.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'`).get()) return [];
  // `*` : table créée avant la colonne `copie` lisible aussi (lecture seule, rien n'est ajouté ici).
  return (sql.prepare('SELECT * FROM migrations ORDER BY rowid').all() as Record<string, unknown>[])
    .map(r => ({ nom: String(r.nom), appliquee: String(r.appliquee), copie: typeof r.copie === 'string' && r.copie ? r.copie : null }));
}

/** Noms des migrations enregistrées dans une base, dans l'ordre où elles ont été faites (aucun avant ce cadre). */
export function migrationsEnregistrees(sql: DatabaseSync): string[] {
  return lireMigrations(sql).map(r => r.nom);
}

/** Migrations enregistrées dans un fichier de base, lu sans l'ouvrir en écriture ; null s'il est absent ou illisible. */
function lireFichier(fichier: string): Enregistree[] | null {
  if (!existsSync(fichier)) return null;
  try {
    const sql = new DatabaseSync(fichier, { readOnly: true });
    try { return lireMigrations(sql); } finally { sql.close(); }
  } catch {
    return null; // journal à rejouer, fichier endommagé…
  }
}

/** Liste valide : noms bien formés et uniques (erreur de programmation sinon, vue par les tests). */
export function verifierListe(liste: readonly Migration[]) {
  const vus = new Set<string>();
  for (const m of liste) {
    if (!NOM.test(m.nom)) throw new Error(`Migration mal nommée : « ${m.nom} » (minuscules, chiffres et tirets)`);
    if (vus.has(m.nom)) throw new Error(`Migration déclarée deux fois : ${m.nom}`);
    vus.add(m.nom);
  }
}

const inconnuesDe = (faites: Enregistree[], liste: readonly Migration[]) => faites.filter(f => !liste.some(m => m.nom === f.nom));

/** Copie enregistrée, à son emplacement d'origine ou, déplacée, dans le dossier actuel des sauvegardes ; null sinon. */
function retrouverCopie(fichier: string | null | undefined, copie: string): string | null {
  if (existsSync(copie)) return copie;
  try {
    const ici = fichier ? join(dossierSauvegardes(fichier), basename(copie)) : null;
    return ici && existsSync(ici) ? ici : null;
  } catch {
    return null;
  }
}

/**
 * Refus d'une base mise à jour par une version plus récente. La copie à restaurer est celle enregistrée avec la première
 * migration inconnue : faite juste avant que cette mise à jour n'enregistre son premier nom, cette version l'accepte.
 * Aucune copie enregistrée (base créée par la version plus récente) ou fichier disparu : renvoi à la sauvegarde faite
 * avant la mise à jour, jamais à une autre copie, plus ancienne (des mois de saisies perdues) ou plus récente (refusée).
 */
function refusBaseRecente(fichier: string | null | undefined, inconnues: Enregistree[]): MigrationError {
  const premiere = inconnues[0];
  const copie = premiere.copie ? retrouverCopie(fichier, premiere.copie) : null;
  const date = Date.parse(premiere.appliquee);
  const aDefaut = ' ; à défaut, restaurer la sauvegarde faite juste avant la mise à jour (docs/DEPLOIEMENT.md, « Mise à jour »)';
  const aRestaurer = copie ? ` (${copie})`
    : premiere.copie ? ` (${basename(premiere.copie)}, introuvable : supprimée ou déplacée depuis)${aDefaut}`
      : ` : aucune pour cette base (créée par la version plus récente ?)${aDefaut}`;
  return new MigrationError('la base a été mise à jour par une version plus récente de Cursus'
    + (Number.isFinite(date) ? ` le ${fmtDateHeure(new Date(date))}` : '')
    + ` (${plural(inconnues.length, 'migration inconnue', 'migrations inconnues')} de cette version : ${inconnues.map(m => m.nom).join(', ')}).`
    + ` Pour revenir à cette version, restaurer la copie avant-migration faite au début de cette mise à jour${aRestaurer}`
    + ' avec npm run restore -- <fichier>, les saisies faites depuis étant perdues (docs/SAUVEGARDE.md) ; sinon, réinstaller la version plus récente.');
}

/**
 * Contrôle d'une base avant de l'ouvrir : MigrationError si elle porte une migration que ce code ne connaît pas. Lecture
 * seule : une base refusée n'est pas touchée, pas même par les colonnes du schéma déclaratif. Base absente ou illisible
 * ici (journal à rejouer…) : pas de refus, appliquerMigrations refait le contrôle une fois la base ouverte.
 */
export function controlerMigrations(fichier: string, liste: readonly Migration[] = MIGRATIONS) {
  const faites = lireFichier(fichier);
  if (!faites) return;
  const inconnues = inconnuesDe(faites, liste);
  if (inconnues.length) throw refusBaseRecente(fichier, inconnues);
}

/**
 * Contrôle d'une base par un outil en ligne de commande qui y écrit (npm run comptes, npm run reset-demo), avant de
 * l'ouvrir : celui de controlerMigrations, puis refus si un serveur en service ne l'a pas encore mise à jour pour ce code
 * (nouvelle version installée, service pas encore redémarré) : l'outil écrirait selon le nouveau schéma des lignes
 * qu'une migration reprendrait ensuite (colonne renommée remplie depuis l'ancienne, vide pour elles). Renvoie vrai si
 * aucun serveur n'est en service : l'outil met alors lui-même la base à jour, comme le serveur au démarrage (migrate
 * puis appliquerMigrations) avant d'y écrire ; faux : le serveur en service l'a déjà fait.
 */
export function controlerPourOutil(fichier: string, liste: readonly Migration[] = MIGRATIONS): boolean {
  controlerMigrations(fichier, liste);
  const serveur = serveurActif(fichier);
  if (!serveur) return true;
  const faites = new Set((lireFichier(fichier) ?? []).map(f => f.nom));
  const enAttente = liste.filter(m => !faites.has(m.nom)).map(m => m.nom);
  if (enAttente.length) {
    throw new MigrationError(`le serveur Cursus en service (processus ${serveur.pid}) n’a pas encore mis la base à jour pour cette version `
      + `(${plural(enAttente.length, 'migration en attente', 'migrations en attente')} : ${enAttente.join(', ')}). `
      + 'Redémarrer d’abord le service (sudo systemctl restart cursus), puis relancer la commande.');
  }
  return false;
}

/**
 * Applique, dans l'ordre de la liste, les migrations que la base n'a pas encore : chacune dans sa transaction, avec
 * l'enregistrement de son nom. Base existante : copie « avant-migration » avant le premier nom enregistré, même d'une
 * migration seulement notée faite, car ce nom suffit à faire refuser la base par la version précédente, qui demande de
 * restaurer cette copie : son chemin est enregistré avec chaque nom (une seule copie par ouverture, partagée avec le
 * schéma déclaratif et server/src/migrate.ts ; son échec arrête tout). Une erreur annule la migration en cours (les
 * précédentes restent faites) et lève une MigrationError : le serveur refuse de démarrer, et la retentera au démarrage
 * suivant. Renvoie les noms des migrations exécutées.
 */
export function appliquerMigrations(db: Db, liste: readonly Migration[] = MIGRATIONS): string[] {
  verifierListe(liste);
  const enregistrees = lireMigrations(db.sql);
  const inconnues = inconnuesDe(enregistrees, liste);
  if (inconnues.length) throw refusBaseRecente(db.sql.location(), inconnues);
  const faites = new Set(enregistrees.map(m => m.nom));
  const aFaire = liste.filter(x => !faites.has(x.nom));
  if (!aFaire.length) return [];
  // Base antérieure au cadre comprise : un retour à une version intermédiaire, qui connaît le cadre mais pas tous ces
  // noms, doit aussi trouver sa copie. Elle est enregistrée avec chaque nom.
  const copie = db.neuve ? null : sauvegarderAvantMigration(db);
  db.sql.exec(TABLE);
  // Table créée avant la colonne `copie` (version de développement du cadre) : colonne ajoutée.
  if (!(db.sql.prepare('PRAGMA table_info(migrations)').all() as { name: string }[]).some(c => c.name === 'copie')) db.sql.exec('ALTER TABLE migrations ADD COLUMN copie TEXT');
  const noter = db.sql.prepare('INSERT INTO migrations (nom, appliquee, executee, copie) VALUES (?, ?, ?, ?)');
  const executees: string[] = [];
  let notees = 0;
  for (const m of aFaire) {
    const utile = m.necessaire ? m.necessaire(db) : true;
    let compteRendu: string | void;
    try {
      compteRendu = db.tx(() => {
        const r = utile ? m.executer(db) : undefined;
        noter.run(m.nom, new Date().toISOString(), utile ? 1 : 0, copie);
        return r;
      });
    } catch (err) {
      throw new MigrationError(`migration ${m.nom} interrompue, aucune de ses modifications n’est conservée (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!utile) notees++;
    else {
      executees.push(m.nom);
      // Base neuve : rien à reprendre, les index et tables sont simplement créés.
      if (!db.neuve) console.log(`Migration ${m.nom} faite${compteRendu ? ` : ${compteRendu}` : ''}.`);
    }
  }
  if (notees && !db.neuve) console.log(`Migrations : ${plural(notees, 'migration notée faite', 'migrations notées faites')} sans modification (base déjà dans l’état visé).`);
  return executees;
}
