// Décision M-18 de Matrix (1er novembre 2026) : Matrix définit et applique les vues pub_ des outils (écran
// « Publications », rôle matrix_gestion). Après la reprise de ses vues par Matrix (partage/14-reprise-publications.sql),
// une migration de Cursus qui créerait, remplacerait, supprimerait ou commenterait une vue pub_, ou poserait un droit
// dessus, échouerait sur le serveur commun (la vue appartient à matrix_gestion) : aucune migration après 0029 n'en
// contient. Les migrations publiées 0002, 0004 et 0011, qui ont créé les vues, restent intactes (empreintes figées) :
// elles ne sont jamais rejouées sur une base déjà migrée, et sur une base neuve les vues qu'elles créent sont ensuite
// reprises par Matrix (docs/DEPLOIEMENT.md, « Variante : serveur PostgreSQL commun EPC2I »).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { migrationsPg } = await import('../server/src/db-pg.ts');

/** Dernière migration publiée avant M-18 : celles qui suivent ne touchent plus aux vues pub_. */
const DERNIERE_AVANT_M18 = '0029';

/** Instructions SQL (commentaires retirés) qui créent, modifient, suppriment, commentent ou ouvrent une vue pub_. */
export function ddlPublications(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const motifs = [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?"?pub_\w+/gi,
    /\b(?:ALTER|DROP)\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?(?:"?\w+"?\.)?"?pub_\w+/gi,
    /\bCOMMENT\s+ON\s+(?:VIEW|COLUMN)\s+(?:"?\w+"?\.)?"?pub_\w+/gi,
    /\b(?:GRANT|REVOKE)\b[^;]*\bON\s+(?:TABLE\s+)?(?:"?\w+"?\.)?"?pub_\w+/gi,
  ];
  return motifs.flatMap(m => code.match(m) ?? []);
}

test('M-18 : aucune migration postérieure à 0029 ne touche à une vue pub_ (Matrix les définit et les applique)', () => {
  const touchees = migrationsPg().filter(m => m.nom.slice(0, 4) > DERNIERE_AVANT_M18)
    .map(m => ({ nom: m.nom, ddl: ddlPublications(m.sql) })).filter(m => m.ddl.length);
  assert.deepEqual(touchees, [], 'demander la publication à Matrix (écran « Publications », docs/demandes/LISEZ-MOI.md)');
});

test('M-18 : le contrôle reconnaît les instructions sur une vue pub_ et ignore les commentaires', () => {
  assert.deepEqual(ddlPublications('-- CREATE VIEW pub_x AS SELECT 1;\n/* DROP VIEW pub_y; */ SELECT 1;'), []);
  assert.equal(ddlPublications('CREATE OR REPLACE VIEW "cursus"."pub_salaries" WITH (security_barrier) AS SELECT 1;').length, 1);
  assert.equal(ddlPublications('DROP VIEW IF EXISTS pub_titres;').length, 1);
  assert.equal(ddlPublications("COMMENT ON VIEW pub_absences IS 'x';").length, 1);
  assert.equal(ddlPublications('GRANT SELECT ON cursus.pub_absences TO crucible_app;').length, 1);
  assert.equal(ddlPublications('CREATE TABLE publications (id int); CREATE VIEW v_interne AS SELECT 1;').length, 0);
  // Les migrations publiées qui ont créé les vues sont bien reconnues (garde-fou effectif).
  const creees = migrationsPg().filter(m => ddlPublications(m.sql).some(d => /CREATE/i.test(d))).map(m => m.nom);
  assert.deepEqual(creees, ['0002_partage', '0004_pub_absences', '0011_pub_titres_valides']);
});
