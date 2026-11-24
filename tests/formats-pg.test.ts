// Formats dans la base (Norma § 4, CU-191 ; server/migrations-pg/0034_formats.sql) : noms et libellés non vides, forme
// des codes choisis une fois pour toutes, fin de période après son début. Vérifie que les contraintes sont posées et
// validées sur la base de démonstration (ses lignes les respectent toutes), qu'elles refusent une écriture contraire, et
// qu'elles reprennent les expressions des règles du code (une seule définition de chaque forme). PostgreSQL seulement :
// la base SQLite (démonstration, application de bureau) n'en déclare pas, en attendant la décision CU-N02 (PostgreSQL seul).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { CODE_HORAIRE } = await import('../shared/rules/horaires.ts');
const { CODE_PAYS, CODE_TITRE } = await import('../shared/rules/referentiels.ts');
const { CODE_MODULE } = await import('../shared/rules/elearning.ts');
const { CODE_ORGANISME } = await import('../shared/rules/organismes.ts');

const SEUL = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const SQL = readFileSync(new URL('../server/migrations-pg/0034_formats.sql', import.meta.url), 'utf8');

test('0034 : mêmes formes que les règles du code (CODE_HORAIRE, CODE_PAYS, CODE_MODULE, CODE_ORGANISME, CODE_TITRE)', () => {
  const forme = (t: string, c: string) => SQL.match(new RegExp(`"${t}_${c}_format" CHECK \\("${c}" ~ '([^']+)'\\)`))?.[1];
  assert.equal(forme('horaires', 'code'), CODE_HORAIRE.source);
  assert.equal(forme('destinations', 'code'), CODE_PAYS.source);
  assert.equal(forme('modules_elearning', 'code'), CODE_MODULE.source);
  assert.equal(forme('organismes', 'code'), CODE_ORGANISME.source);
  // Identifiants des titres : sans règle (une reprise garde ceux de l'existant, CODE_TITRE vaut pour les codes créés).
  assert.equal(forme('formations', 'id'), undefined);
  assert.ok(CODE_TITRE.test('sst'));
  const code = SQL.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\b(DROP|UPDATE|DELETE|TRUNCATE)\b|\bpub_/i, 'aucune ligne changée, aucune publication touchée');
});

test('0034 : contraintes posées et validées sur la base de démonstration', SEUL, async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const lignes = await db.query(`SELECT conname, convalidated FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND contype = 'c'
    AND (conname LIKE '%\\_non\\_vide' OR conname LIKE '%\\_format' OR conname LIKE '%\\_apres\\_%')`) as { conname: string; convalidated: boolean }[];
  const attendues = [...SQL.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map(m => m[1]);
  assert.equal(attendues.length, 32);
  assert.deepEqual(lignes.map(l => l.conname).filter(n => attendues.includes(n)).sort(), [...attendues].sort());
  assert.deepEqual(lignes.filter(l => attendues.includes(l.conname) && !l.convalidated).map(l => l.conname), [], 'toutes validées');
});

test('0034 : un nom vide, un code mal formé, une fin avant le début sont refusés par la base', SEUL, async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const refus = async (sql: string, params: string[], contrainte: string) =>
    await assert.rejects(async () => { await db.run(sql, params); }, (e: { constraint?: string; message: string }) => (e.constraint ?? e.message).includes(contrainte));
  await refus('UPDATE postes SET nom = ? WHERE id = (SELECT min(id) FROM postes)', ['  '], 'postes_nom_non_vide');
  await refus('UPDATE horaires SET code = ? WHERE code = (SELECT min(code) FROM horaires)', ['matin'], 'horaires_code_format');
  await refus('UPDATE modules_elearning SET code = ? WHERE id = (SELECT min(id) FROM modules_elearning)', ['module 1'], 'modules_elearning_code_format');
  await refus(`UPDATE absences SET au = (du - 1) WHERE id = (SELECT min(id) FROM absences)`, [], 'absences_au_apres_du');
  // Admis : NULL là où la colonne l'admet, période d'un jour.
  await db.run(`UPDATE absences SET au = du WHERE id = (SELECT min(id) FROM absences)`, []);
});
