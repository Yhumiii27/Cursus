// npm run backup : copie cohérente de la base, serveur démarré ou non (VACUUM INTO),
// vérifiée puis rotation. Code de sortie 1 en cas d'échec, pour la supervision
// (timer systemd ou cron, voir docs/SAUVEGARDE.md).
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dbFile, urlPostgres } from './db.ts';
import { copiesConservees, fmtDateHeure, fmtDuree, fmtTaille, sauvegarder } from './sauvegarde.ts';

if (urlPostgres()) {
  console.error('Sauvegarde refusée : la base est sur le serveur PostgreSQL commun (DATABASE_URL) : sa sauvegarde est celle du serveur (pg_dump du schéma cursus, docs/DEPLOIEMENT.md). npm run backup ne copie que le fichier SQLite de repli : DATABASE_URL= npm run backup.');
  process.exit(1);
}

try {
  const keep = copiesConservees();
  const s = sauvegarder(dbFile(), { keep });
  const n = s.supprimees.length, pl = (k: number) => (k > 1 ? 's' : '');
  console.log(`Sauvegarde de ${resolve(dbFile())}`);
  console.log(`  Copie : ${s.fichier}`);
  console.log(`  ${fmtTaille(s.taille)} · ${s.employes} collaborateurs · dernière action du journal : ${s.dernierJournal ? fmtDateHeure(s.dernierJournal) : 'aucune'}`);
  console.log(`  Intégrité vérifiée · durée ${fmtDuree(s.duree)}`);
  console.log(`  Rotation : ${s.conservees} copie${pl(s.conservees)} conservée${pl(s.conservees)} (${keep ? `${keep} au plus` : 'sans limite'})${n ? `, ${n} supprimée${pl(n)}` : ''}`);
  s.supprimees.forEach(f => console.log(`    − ${f}`));
  const fs = statfsSync(dirname(s.fichier));
  console.log(`  Espace libre : ${fmtTaille(fs.bavail * fs.bsize)}`);
} catch (err) {
  console.error(`Échec de la sauvegarde : ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
