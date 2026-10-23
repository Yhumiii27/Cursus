// Migrations nommées du chantier « prévention » (lot 7, chantier B). Étape 1, compte professionnel de prévention (t052,
// shared/rules/c2p.ts) : colonnes `postes.c2p` (facteurs d'exposition cochés sur le poste) et `horaires.alternant`
// (équipes successives alternantes) déclarées dans TABLES et ajoutées vides à l'ouverture, ce qui vaut « aucun facteur »
// et « à qualifier » : rien n'est coché d'office, ni sur les postes ni sur les horaires d'exemple (choix du cadrage), donc
// rien à reprendre. Sur une base existante, la migration est seulement notée faite : son nom marque les bases passées par
// cette version (une version plus ancienne, qui ne lirait pas les qualifications, les refuse). Les horaires de nuit à
// qualifier sont signalés sur l'écran Expositions (C2P) et dans Référentiels → Horaires. Serveur PostgreSQL :
// 0006_prevention.sql.
import type { Migration } from './cadre.ts';

export const C2P_COLONNES: Migration = {
  nom: 'lot7-prevention-c2p',
  // Base neuve : exécutée, sans effet ; base existante : notée faite.
  necessaire: db => db.neuve,
  executer: () => {},
};
