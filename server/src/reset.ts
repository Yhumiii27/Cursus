// npm run reset-demo : recharge les données de démonstration.
import { openDb } from './db.ts';
import { seedDemo } from './seed.ts';

const db = openDb();
seedDemo(db);
console.log(`Données de démonstration rechargées (${db.count('employes')} collaborateurs).`);
