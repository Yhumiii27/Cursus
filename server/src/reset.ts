// npm run reset-demo : recharge les données de démonstration.
// Efface toute la base : refusé hors mode démonstration (CURSUS_DEMO=1 npm run reset-demo).
import { demoActive } from './config.ts';
import { openDb } from './db.ts';
import { seedDemo } from './seed.ts';

if (!demoActive()) {
  console.error('Réinitialisation refusée : elle efface toute la base et n’est permise qu’en mode démonstration (CURSUS_DEMO=1 npm run reset-demo).');
  process.exit(1);
}
const db = openDb();
seedDemo(db);
console.log(`Données de démonstration rechargées (${db.count('employes')} collaborateurs).`);
