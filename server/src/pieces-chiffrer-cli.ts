// npm run pieces:chiffrer [-- --apercu] : chiffre les pièces justificatives déjà déposées dans le dossier local (lot 8,
// chantier D ; règles dans server/src/pieces-chiffrer.ts). À lancer avec l'environnement de l'application, une fois
// CURSUS_PIECES_KEY posée et Cursus redémarré avec elle (sinon le serveur ne pourrait plus ouvrir les pièces chiffrées).
// --apercu : rien n'est écrit, le bilan dit ce qui serait fait.
// npm run pieces:verifier (--verifier) : contrôle complet, sans rien écrire, de chaque fichier que désigne la base (lu,
// déchiffré au besoin, empreinte comparée à celle de l'envoi), après une restauration (docs/SAUVEGARDE.md, section 10).
// Code de sortie 0 : fait, rien à faire ou tout conforme ; 1 : refus, ou fichiers absents, altérés ou illisibles.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { clePieces, enProduction, verifierConfig } from './config.ts';
import { dbFile, openDb, urlPostgres } from './db.ts';
import { mettreAJourBase } from './demarrage.ts';
import { controlerPourOutil } from './migrations/cadre.ts';
import { dossierPiecesDe } from './pieces.ts';
import { bilanChiffrementTexte, bilanVerificationTexte, chiffrerPiecesExistantes, verifierPieces } from './pieces-chiffrer.ts';

const USAGE = 'Usage : npm run pieces:chiffrer [-- --apercu], ou npm run pieces:verifier';

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const inconnue = args.find(a => a !== '--apercu' && a !== '--verifier');
if (inconnue) arreter(`Option inconnue : ${inconnue}\n${USAGE}`);
const apercu = args.includes('--apercu'), verifier = args.includes('--verifier');

// Configuration contrôlée comme au démarrage du serveur (en production, refus sur une configuration dangereuse).
if (enProduction()) verifierConfig(process.env, { commande: verifier ? 'npm run pieces:verifier' : 'npm run pieces:chiffrer' });
// Contrôle complet : sans clé, les fichiers en clair se vérifient, les fichiers chiffrés sont comptés illisibles.
const cle = clePieces();
if (!cle && !verifier) arreter('Chiffrement refusé : CURSUS_PIECES_KEY est absente ou invalide (64 caractères hexadécimaux : openssl rand -hex 32). Posez-la dans l’environnement de Cursus, redémarrez le service, puis relancez la commande.');

// Fichier SQLite : base mise à jour par une version plus récente de Cursus, ou pas encore par le serveur en service :
// refusée. Serveur PostgreSQL (DATABASE_URL) : openDb applique les migrations et contrôle le schéma, sous verrou.
let aMettreAJour = true;
try {
  if (!urlPostgres()) aMettreAJour = controlerPourOutil(dbFile());
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
let db: Awaited<ReturnType<typeof openDb>>;
try {
  db = await openDb();
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
try {
  // Service arrêté : base mise à jour comme au démarrage du serveur (colonne pieces.chiffree, migrations nommées).
  if (aMettreAJour) await mettreAJourBase(db);
  console.log(`Dossier des pièces : ${dossierPiecesDe(db)}`);
  if (verifier) {
    const v = await verifierPieces(db, cle);
    console.log(`Contrôle des pièces : ${bilanVerificationTexte(v)}.`);
    if (v.absentes + v.alterees + v.illisibles) {
      console.error('Pièces non conformes : restaurez les fichiers manquants ou altérés depuis la copie du volume prise avec la sauvegarde de la base (docs/SAUVEGARDE.md, section 10), et vérifiez CURSUS_PIECES_KEY.');
      process.exitCode = 1;
    }
  } else {
    const b = await chiffrerPiecesExistantes(db, cle!, { apercu, auteur: 'Ligne de commande (npm run pieces:chiffrer)' });
    console.log(`${apercu ? 'Aperçu, rien n’a été écrit' : 'Chiffrement des pièces'} : ${bilanChiffrementTexte(b)}.`);
    if (b.absentes) console.error('Fichiers absents : restaurez-les depuis les sauvegardes (docs/SAUVEGARDE.md), puis relancez la commande.');
    if (b.alterees) console.error('Fichiers laissés tels quels : empreinte différente de celle de l’envoi, ou chiffrés avec une autre clé. Examinez-les avec le contrôle d’intégrité avant toute autre opération.');
    if (b.absentes || b.alterees) process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await db.fermer();
}
