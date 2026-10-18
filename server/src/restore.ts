// npm run restore -- <fichier> [--force] : remplace la base par une sauvegarde vérifiée, après
// avoir copié la base actuelle (« avant-restauration »). Le serveur doit être arrêté.
// Sans argument : liste des sauvegardes disponibles. Procédure complète : docs/SAUVEGARDE.md.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { resolve } from 'node:path';
import { dbFile, urlPostgres } from './db.ts';
import { dossierSauvegardes, fmtDateHeure, fmtTaille, listerSauvegardes, restaurer, SauvegardeError } from './sauvegarde.ts';

if (urlPostgres()) {
  console.error('Restauration refusée : la base est sur le serveur PostgreSQL commun (DATABASE_URL) : la restauration se fait sur le serveur (pg_restore du schéma cursus, docs/DEPLOIEMENT.md). npm run restore ne remplace que le fichier SQLite de repli : DATABASE_URL= npm run restore -- <fichier>.');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const inconnues = args.filter(a => a.startsWith('-') && a !== '--force');
const fichiers = args.filter(a => !a.startsWith('-'));
const base = resolve(dbFile());

if (inconnues.length || fichiers.length !== 1) {
  if (inconnues.length) console.error(`Option inconnue : ${inconnues.join(' ')}`);
  console.error('Usage : npm run restore -- <fichier de sauvegarde> [--force]');
  const dir = dossierSauvegardes(base);
  const copies = listerSauvegardes(dir);
  console.error(copies.length ? `\nSauvegardes disponibles dans ${dir} (plus récentes d’abord) :` : `\nAucune sauvegarde dans ${dir}.`);
  copies.slice(0, 20).forEach(c => console.error(`  ${c.nom}  ·  ${fmtDateHeure(c.date)}  ·  ${fmtTaille(c.taille)}`));
  process.exit(1);
}

try {
  // npm run lance le script depuis la racine du projet : un chemin relatif part du dossier d'appel.
  const source = resolve(process.env.INIT_CWD || process.cwd(), fichiers[0]);
  const r = restaurer(source, base, { force });
  const v = r.verification;
  console.log(`Restauration de ${source}`);
  console.log(`  Fichier vérifié : ${v.employes} collaborateurs · dernière action du journal : ${v.dernierJournal ? fmtDateHeure(v.dernierJournal) : 'aucune'} · ${fmtTaille(v.taille)}`);
  if (r.avant) console.log(`  Base actuelle sauvegardée : ${r.avant}`);
  else if (r.brut) console.log(`  Base actuelle illisible, fichiers copiés tels quels dans : ${r.brut}`);
  else console.log('  Aucune base actuelle : rien à sauvegarder.');
  console.log(`  Base remplacée : ${base} (journaux -wal et -shm de l’ancienne base supprimés)`);
  if (r.serveur) console.error(`Attention : le serveur (processus ${r.serveur.pid}) utilise encore l’ancienne base. Redémarrez-le immédiatement.`);
  else console.log('Démarrez le serveur Cursus pour reprendre le service.');
} catch (err) {
  console.error(`Restauration impossible : ${err instanceof Error ? err.message : err}`);
  // Les refus (fichier invalide, serveur démarré…) interviennent avant toute modification.
  console.error(err instanceof SauvegardeError ? 'La base actuelle n’a pas été modifiée.'
    : `Vérifiez la base ; sa copie « avant-restauration » est dans ${dossierSauvegardes(base)}.`);
  process.exitCode = 1;
}
