// Migrations nommées : chacune s'exécute une seule fois par base, dans une transaction, après la copie
// « avant-migration », et son nom est enregistré dans la table `migrations`. Pas de numéro de version global
// (PRAGMA user_version reste à 0) : deux chantiers menés en parallèle ajoutent chacun la leur sans collision.
// Une base qui porte une migration inconnue de ce code (mise à jour par une version plus récente) est refusée.
// Liste ordonnée : server/src/migrations/liste.ts ; mode d'emploi : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
// Le schéma déclaratif (tables et colonnes ajoutées, server/src/db.ts) et les reprises rejouées à chaque démarrage
// (server/src/migrate.ts) passent avant.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { plural } from '../../../shared/format.ts';
import type { Db } from '../db.ts';
import { dossierSauvegardes, listerSauvegardes, sauvegarderAvantMigration } from '../sauvegarde.ts';
import { MIGRATIONS } from './liste.ts';

export interface Migration {
  /** Nom unique et définitif, en minuscules et tirets (« lot4-paie-lots-historiques ») : jamais renommé ni réutilisé. */
  nom: string;
  /**
   * Vrai si la base a besoin de la migration (anciennes valeurs à reprendre, index absent…). Faux : elle est seulement
   * notée faite, sans copie ni modification (base neuve, ou déjà dans l'état visé). Absent : toujours vrai.
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

/** Table des migrations faites, hors du schéma déclaratif : la réinitialisation de la démonstration ne la vide pas. */
const TABLE = 'CREATE TABLE IF NOT EXISTS migrations (nom TEXT PRIMARY KEY, appliquee TEXT NOT NULL, executee INTEGER NOT NULL)';
const NOM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Noms des migrations enregistrées dans une base, dans l'ordre où elles ont été faites (aucun avant ce cadre). */
export function migrationsEnregistrees(sql: DatabaseSync): string[] {
  if (!sql.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'`).get()) return [];
  return (sql.prepare('SELECT nom FROM migrations ORDER BY rowid').all() as { nom: string }[]).map(r => r.nom);
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

/** Copie « avant-migration » la plus récente de cette base, ou null. */
function derniereCopie(fichier: string): string | null {
  try {
    const base = basename(fichier).replace(/\.(db|sqlite3?)$/i, '');
    return listerSauvegardes(dossierSauvegardes(fichier)).find(c => c.base === base && c.motif === 'avant-migration')?.fichier ?? null;
  } catch {
    return null; // dossier illisible : le message reste utile sans le nom de la copie
  }
}

function refusBaseRecente(fichier: string | null | undefined, inconnues: string[]): MigrationError {
  const copie = fichier ? derniereCopie(fichier) : null;
  return new MigrationError(`la base a été mise à jour par une version plus récente de Cursus (${plural(inconnues.length, 'migration inconnue', 'migrations inconnues')} `
    + `de cette version : ${inconnues.join(', ')}). Pour revenir à cette version, restaurer la copie avant-migration faite à cette mise à jour`
    + (copie ? ` (la plus récente : ${copie})` : ' (fichier …-avant-migration.db du dossier des sauvegardes)')
    + ' avec npm run restore -- <fichier>, les saisies faites depuis étant perdues (docs/SAUVEGARDE.md) ; sinon, réinstaller la version plus récente.');
}

const inconnuesDe = (noms: string[], liste: readonly Migration[]) => noms.filter(n => !liste.some(m => m.nom === n));

/**
 * Contrôle d'une base avant de l'ouvrir : MigrationError si elle porte une migration que ce code ne connaît pas. Lecture
 * seule : une base refusée n'est pas touchée, pas même par les colonnes du schéma déclaratif. Base absente ou illisible
 * ici (journal à rejouer…) : pas de refus, appliquerMigrations refait le contrôle une fois la base ouverte.
 */
export function controlerMigrations(fichier: string, liste: readonly Migration[] = MIGRATIONS) {
  if (!existsSync(fichier)) return;
  let noms: string[];
  try {
    const sql = new DatabaseSync(fichier, { readOnly: true });
    try { noms = migrationsEnregistrees(sql); } finally { sql.close(); }
  } catch {
    return;
  }
  const inconnues = inconnuesDe(noms, liste);
  if (inconnues.length) throw refusBaseRecente(fichier, inconnues);
}

/**
 * Applique, dans l'ordre de la liste, les migrations que la base n'a pas encore : chacune dans sa transaction, avec
 * l'enregistrement de son nom. Avant la première qui modifie une base existante, copie « avant-migration » (une seule
 * par ouverture, partagée avec le schéma déclaratif et server/src/migrate.ts ; son échec arrête tout). Une erreur
 * annule la migration en cours (les précédentes restent faites) et lève une MigrationError : le serveur refuse de
 * démarrer, et la retentera au démarrage suivant. Renvoie les noms des migrations exécutées.
 */
export function appliquerMigrations(db: Db, liste: readonly Migration[] = MIGRATIONS): string[] {
  verifierListe(liste);
  db.sql.exec(TABLE);
  const faites = new Set(migrationsEnregistrees(db.sql));
  const inconnues = inconnuesDe([...faites], liste);
  if (inconnues.length) throw refusBaseRecente(db.sql.location(), inconnues);
  const noter = db.sql.prepare('INSERT INTO migrations (nom, appliquee, executee) VALUES (?, ?, ?)');
  const executees: string[] = [];
  let notees = 0;
  for (const m of liste.filter(x => !faites.has(x.nom))) {
    const utile = m.necessaire ? m.necessaire(db) : true;
    if (utile && !db.neuve) sauvegarderAvantMigration(db);
    let compteRendu: string | void;
    try {
      compteRendu = db.tx(() => {
        const r = utile ? m.executer(db) : undefined;
        noter.run(m.nom, new Date().toISOString(), utile ? 1 : 0);
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
