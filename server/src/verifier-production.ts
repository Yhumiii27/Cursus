// npm run verifier-production -- [--config-seule] [--json] [--strict]
// Pré-vol de la mise en production (lot 8, chantier B ; procédure : docs/BASCULE-PRODUCTION.md) : dit en une page si
// l'instance est prête, avec exactement l'environnement de l'application (terminal du conteneur Coolify, ou
// `docker exec`). Ne modifie rien : configuration jugée comme en production (NODE_ENV=production forcé), base ouverte en
// lecture seule et sans migration (serveur PostgreSQL : server/src/db-pg-lecture.ts ; fichier SQLite : copie
// instantanée dans un dossier temporaire, supprimée à la fin). Règles : server/src/pre-vol.ts.
// Codes de sortie : 0 conforme, 1 au moins un bloquant (ou un avertissement avec --strict), 2 avertissements seulement.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import) : l'accès en
// écriture au dossier des pièces est ainsi jugé pour le compte cursus.
import './conteneur.ts';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isoParis } from '../../shared/dates.ts';
import { dossierPieces, VERSION } from './chemins.ts';
import { cibleBase } from './config.ts';
import { dbFile, SqliteDb, urlPostgres } from './db.ts';
import { migrationsPg } from './db-pg.ts';
import { faitsServeur, ouvrirPgLecture } from './db-pg-lecture.ts';
import { codeSortie, controlerBase, controlesConfig, type Controle, rapportTexte } from './pre-vol.ts';
import { dossierPiecesDe } from './pieces.ts';

const USAGE = `Usage : npm run verifier-production -- [--config-seule] [--json] [--strict]
  --config-seule  configuration seulement, sans ouvrir la base (application créée, pas encore démarrée)
  --json          sortie JSON (à archiver avec la recette), au lieu du texte
  --strict        un avertissement compte comme bloquant (code de sortie 1)
Codes de sortie : 0 prête pour la production, 1 au moins un bloquant, 2 avertissements seulement.`;

const OPTIONS = ['--config-seule', '--json', '--strict'];
const args = process.argv.slice(2);
if (args.includes('--aide') || args.includes('-h') || args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}
const inconnues = args.filter(a => !OPTIONS.includes(a));
if (inconnues.length) {
  console.error(`Option inconnue : ${inconnues.join(' ')}\n${USAGE}`);
  process.exit(1);
}
const configSeule = args.includes('--config-seule'), json = args.includes('--json'), strict = args.includes('--strict');

const bloquant = (code: string, message: string, remede?: string): Controle => ({ code, domaine: 'base', niveau: 'bloquant', message, ...(remede ? { remede } : {}) });

/** Contrôles de la base : serveur PostgreSQL en lecture seule, ou copie instantanée du fichier SQLite. */
async function controlesBase(): Promise<{ controles: Controle[]; cible: string }> {
  const url = urlPostgres();
  if (url) {
    const c = cibleBase();
    const cible = c ? `PostgreSQL ${c.hote}/${c.base}, schéma cursus` : 'PostgreSQL (adresse illisible)';
    let ouverte: Awaited<ReturnType<typeof ouvrirPgLecture>>;
    try {
      ouverte = await ouvrirPgLecture(url);
    } catch (err) {
      return { cible, controles: [bloquant('base.connexion', `Base injoignable : ${err instanceof Error ? err.message : String(err)}.`, 'Vérifiez DATABASE_URL, le réseau vers le serveur commun et le mot de passe de cursus_app.')] };
    }
    const { db, dureeConnexionMs } = ouverte;
    try {
      const serveur = await faitsServeur(db, dureeConnexionMs);
      return { cible, controles: await controlerBase(db, { serveur, migrations: migrationsPg(), dossierPieces: dossierPiecesDe(db) }) };
    } finally {
      await db.fermer();
    }
  }
  const fichier = dbFile();
  if (!existsSync(fichier)) return { cible: `fichier ${fichier}`, controles: [bloquant('base.fichier', `Base SQLite ${fichier} introuvable.`, 'Vérifiez CURSUS_DB (ou DATABASE_URL pour le serveur commun).')] };
  // Copie instantanée (VACUUM INTO, depuis une connexion en lecture seule) : l'ouverture par la classe Db compléterait
  // le schéma d'une base ancienne ; c'est la copie qui l'est, jamais le fichier en service.
  // La copie porte toute la base RH (santé, titres de séjour, paie) hors de ses protections : supprimée à la fin, et
  // aussi si la commande est interrompue (Ctrl-C, terminal fermé, arrêt du conteneur) ; dossier en 700 (mkdtemp).
  // Gestionnaires posés avant la création du dossier : un signal reçu juste après ne laisse jamais la copie en place.
  let dossier: string | null = null;
  const nettoyer = () => { if (dossier) rmSync(dossier, { recursive: true, force: true }); };
  const SIGNAUX = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
  const surSignal = (signal: keyof typeof SIGNAUX) => { nettoyer(); process.exit(SIGNAUX[signal]); };
  for (const sig of Object.keys(SIGNAUX) as (keyof typeof SIGNAUX)[]) process.once(sig, surSignal);
  process.once('exit', nettoyer);
  dossier = mkdtempSync(join(tmpdir(), 'cursus-pre-vol-'));
  const copie = join(dossier, 'copie.db');
  // Pièces : celles du fichier réel (la copie est ailleurs).
  process.env.CURSUS_PIECES_DIR ||= dossierPieces(realpathSync(fichier));
  try {
    const source = new DatabaseSync(fichier, { readOnly: true });
    try { source.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`); } finally { source.close(); }
    const db = new SqliteDb(copie);
    try {
      return { cible: `fichier ${fichier}`, controles: await controlerBase(db, { serveur: null, migrations: [], dossierPieces: process.env.CURSUS_PIECES_DIR }) };
    } finally {
      await db.fermer();
    }
  } catch (err) {
    return { cible: `fichier ${fichier}`, controles: [bloquant('base.fichier', `Base SQLite ${fichier} illisible : ${err instanceof Error ? err.message : String(err)}.`)] };
  } finally {
    nettoyer();
    for (const sig of Object.keys(SIGNAUX) as (keyof typeof SIGNAUX)[]) process.off(sig, surSignal);
    process.off('exit', nettoyer);
  }
}

const le = new Date();
const controles = controlesConfig(process.env, isoParis(le));
let cible = 'non ouverte (--config-seule)';
if (!configSeule) {
  const b = await controlesBase();
  controles.push(...b.controles);
  cible = b.cible;
}
const code = codeSortie(controles, strict);
if (json) {
  console.log(JSON.stringify({ version: VERSION, le: le.toISOString(), base: cible, strict, code, controles }, null, 2));
} else {
  const quand = le.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
  console.log(rapportTexte(controles, `Cursus ${VERSION} — vérification de production du ${quand} · base : ${cible}`, strict));
}
process.exit(code);
