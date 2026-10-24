// npm run reprise-postgres -- [<base SQLite>] [--a-blanc] : reprise de la base SQLite de Cursus sur le serveur
// PostgreSQL commun de DATABASE_URL (sous-étape 8.c), service arrêté, une fois avant la bascule ; procédure dans
// docs/DEPLOIEMENT.md, « Variante : serveur PostgreSQL commun EPC2I ». Sans fichier : CURSUS_DB (data/cursus.db par
// défaut). La base SQLite n'est jamais modifiée. --a-blanc : contrôles et copie faits puis annulés, compte rendu affiché.
// Code de sortie 0 : reprise faite, à blanc réussie ou déjà faite ; 1 : refus ou échec, rien n'a été écrit.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { resolve } from 'node:path';
import { plural } from '../../shared/format.ts';
import { enProduction, verifierConfig } from './config.ts';
import { dbFile, openDb, urlPostgres } from './db.ts';
import type { PgDb } from './db-pg.ts';
import { mettreAJourBase } from './demarrage.ts';
import { type CompteRendu, reprendreSurPostgres } from './reprise-postgres.ts';

const USAGE = 'Usage : DATABASE_URL=postgres://cursus_app:…@<hôte>:5432/epc2i npm run reprise-postgres -- [<base SQLite>] [--a-blanc]';
const args = process.argv.slice(2);
const aBlanc = args.includes('--a-blanc');
const inconnues = args.filter(a => a.startsWith('-') && a !== '--a-blanc');
const fichiers = args.filter(a => !a.startsWith('-'));

if (inconnues.length || fichiers.length > 1) {
  if (inconnues.length) console.error(`Option inconnue : ${inconnues.join(' ')}`);
  console.error(USAGE);
  process.exit(1);
}
if (!urlPostgres()) {
  console.error(`Reprise impossible : DATABASE_URL (serveur PostgreSQL de destination) est absente.\n${USAGE}`);
  process.exit(1);
}

// Configuration contrôlée comme au démarrage du serveur (en production, refus sur une configuration dangereuse : rôle
// postgres, base d'un autre outil…), avant toute connexion.
// Hors production, la commande ne répète pas les avertissements que le serveur écrit déjà au démarrage.
if (enProduction()) verifierConfig(process.env, { commande: 'npm run reprise-postgres' });

const liste = (titre: string, r: Record<string, number>) => {
  const e = Object.entries(r);
  if (e.length) console.log(`  ${titre} : ${e.map(([k, n]) => `${k} (${n})`).join(', ')}`);
};

function afficher(cr: CompteRendu) {
  if (cr.statut === 'deja-faite') {
    console.log(`Reprise déjà faite le ${cr.deja!.le} : ${cr.deja!.message}. Rien n’a été modifié.`);
    return;
  }
  console.log(`${cr.statut === 'a-blanc' ? 'Reprise à blanc (rien n’a été écrit)' : 'Reprise faite'} depuis ${cr.source}`);
  if (cr.migrations.length) console.log(`  Copie mise au niveau de cette version : ${cr.migrations.join(', ')}`);
  const pleines = Object.entries(cr.tables).filter(([, n]) => n);
  console.log(`  ${plural(cr.lignes, 'ligne', 'lignes')} dans ${plural(pleines.length, 'table', 'tables')}, comptes identiques table par table :`);
  for (const [t, n] of pleines) console.log(`    ${t.padEnd(22)} ${String(n).padStart(8)}`);
  liste('Valeurs « aucun » (0 ou vide) de références écrites NULL', cr.aucunVersNull);
  liste('Dates vides écrites NULL', cr.videsVersNull);
  liste('Attention, colonnes anciennes non reprises (absentes de cette version)', cr.nonReprises);
  const p = cr.pieces;
  if (p.fichiers) {
    console.log(`  Pièces justificatives : ${plural(p.fichiers, 'fichier', 'fichiers')} attendu${p.fichiers > 1 ? 's' : ''} dans ${p.dossierCible}`);
    if (p.manquants) console.error(`  Attention : ${plural(p.manquants, 'fichier absent', 'fichiers absents')} de ce dossier : copiez-y ceux de ${p.dossierSource}.`);
  }
  if (cr.statut === 'a-blanc') console.log('Relancez sans --a-blanc pour faire la reprise.');
  else console.log('Démarrez Cursus avec DATABASE_URL, puis posez le partage (20-cursus.sql, 90-droits.sql, 95-matrix-journal-unifie.sql).');
}

let db: PgDb | null = null;
try {
  const source = resolve(process.env.INIT_CWD || process.cwd(), fichiers[0] ?? dbFile());
  // Migrations de server/migrations-pg/ et amorçages d'une base neuve, comme au démarrage du serveur.
  db = await openDb() as PgDb;
  await mettreAJourBase(db);
  afficher(await reprendreSurPostgres(source, db, { aBlanc }));
} catch (err) {
  console.error(`Reprise refusée : ${err instanceof Error ? err.message : err}`);
  console.error('La base PostgreSQL n’a pas été modifiée (la base SQLite ne l’est jamais).');
  process.exitCode = 1;
} finally {
  await db?.fermer();
}
