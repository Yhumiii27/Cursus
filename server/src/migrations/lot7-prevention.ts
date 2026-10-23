// Migrations nommées du chantier « prévention » (lot 7, chantier B). Étape 1, compte professionnel de prévention (t052,
// shared/rules/c2p.ts) : colonnes `postes.c2p` (facteurs d'exposition cochés sur le poste) et `horaires.alternant`
// (équipes successives alternantes) déclarées dans TABLES et ajoutées vides à l'ouverture, ce qui vaut « aucun facteur »
// et « à qualifier » : rien n'est coché d'office, ni sur les postes ni sur les horaires d'exemple (choix du cadrage), donc
// rien à reprendre. Sur une base existante, la migration est seulement notée faite : son nom marque les bases passées par
// cette version (une version plus ancienne, qui ne lirait pas les qualifications, les refuse). Les horaires de nuit à
// qualifier sont signalés sur l'écran Expositions (C2P) et dans Référentiels → Horaires. Serveur PostgreSQL :
// 0006_prevention.sql.
import { plural } from '../../../shared/format.ts';
import { journaliser } from '../comptes.ts';
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

export const C2P_COLONNES: Migration = {
  nom: 'lot7-prevention-c2p',
  // Base neuve : exécutée, sans effet ; base existante : notée faite.
  necessaire: db => db.neuve,
  executer: () => {},
};

// Étape 2, Passeport de prévention (t066, shared/rules/passeport-prevention.ts) : colonne `formations.passeport_prevention`
// et table `declarations_passeport` déclarées dans TABLES (ajoutées vides à l'ouverture). La migration coche la case sur
// les formations santé-sécurité déjà au catalogue (SST, CACES, ATEX, électrique, AIPR, EPI incendie, travail en hauteur,
// PRAP), reconnues sur le code, le nom court ou l'intitulé ; le service RH ou le référent HSE la corrige ensuite dans
// Référentiels → Formations. Une base neuve n'a pas encore de catalogue : sans effet (le référentiel type et la
// démonstration portent la case). Liste figée ici, en SQL (même résultat sur une base restée ancienne qui la recevra plus
// tard) ; même liste en SQL dans server/migrations-pg/0009_passeport_prevention.sql et, pour l'aide du dialogue,
// `MOTS_PASSEPORT` de shared/rules/passeport-prevention.ts. Tracée au journal : codes des formations cochées. Ajoute aussi
// l'index de lecture des déclarations par salarié (même index dans 0009).

/** Formations santé-sécurité reconnues (code, nom court, intitulé ; LIKE ignore la casse des lettres sans accent). */
export const SANTE_SECURITE_SQL = `(
  ' ' || lower(id) || ' ' || lower(court) || ' ' || lower(nom) || ' ' LIKE '% sst %'
  OR lower(nom) LIKE '%(sst)%' OR lower(nom) LIKE '%sauveteur%'
  OR lower(id) LIKE '%caces%' OR lower(court) LIKE '%caces%' OR lower(nom) LIKE '%caces%'
  OR lower(id) LIKE '%atex%' OR lower(court) LIKE '%atex%' OR lower(nom) LIKE '%atex%'
  OR lower(id) = 'elec' OR lower(court) LIKE '%lectri%' OR lower(nom) LIKE '%lectri%' OR lower(court) LIKE '%lec.%'
  OR lower(id) LIKE '%aipr%' OR lower(court) LIKE '%aipr%' OR lower(nom) LIKE '%aipr%'
  OR lower(id) = 'epi' OR lower(court) LIKE '%incendie%' OR lower(nom) LIKE '%incendie%'
  OR lower(id) LIKE '%hauteur%' OR lower(court) LIKE '%hauteur%' OR lower(nom) LIKE '%hauteur%'
  OR lower(id) LIKE '%prap%' OR lower(court) LIKE '%prap%' OR lower(nom) LIKE '%prap%'
)`;

/** Formations santé-sécurité du catalogue pas encore cochées. */
const aCocher = async (db: Db) =>
  (await db.query<{ id: string }>(`SELECT id FROM formations WHERE passeport_prevention IS NOT TRUE AND ${SANTE_SECURITE_SQL} ORDER BY id`)).map(f => f.id);

const INDEX_DECLARATIONS = 'CREATE INDEX IF NOT EXISTS declarations_passeport_emp ON declarations_passeport (emp_id)';

export const PASSEPORT_PREVENTION: Migration = {
  nom: 'lot7-prevention-passeport',
  // Base neuve : exécutée, sans effet sur le catalogue (vide) ; base existante : s'il reste une formation à cocher ou si
  // l'index manque.
  necessaire: async (db: SqliteDb) => db.neuve || !indexExiste(db, 'declarations_passeport_emp') || (await aCocher(db)).length > 0,
  executer: async db => {
    await db.exec(INDEX_DECLARATIONS);
    const codes = await aCocher(db);
    if (!codes.length) return 'index declarations_passeport_emp';
    await db.run(`UPDATE formations SET passeport_prevention = TRUE WHERE id IN (${codes.map(() => '?').join(', ')})`, codes);
    const texte = plural(codes.length, 'formation santé-sécurité marquée', 'formations santé-sécurité marquées');
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.passeportPrevention',
      message: `Reprise : Passeport de prévention, ${texte} au catalogue (${codes.join(', ')})`, payload: { formations: codes },
    });
    return `${texte} pour le Passeport de prévention`;
  },
};
