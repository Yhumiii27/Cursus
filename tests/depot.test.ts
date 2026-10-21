// Contenu du dépôt (t177) : la maquette Claude Design n'est gardée qu'en un exemplaire, design/maquette-handoff.zip ;
// toute autre archive est ignorée par Git et exclue de l'image Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('dépôt : une seule archive de la maquette, dans design/, citée par la documentation', () => {
  assert.deepEqual(readdirSync(ROOT).filter(f => f.endsWith('.zip')), [], 'aucune archive à la racine');
  assert.deepEqual(readdirSync(join(ROOT, 'design')).filter(f => f.endsWith('.zip')), ['maquette-handoff.zip']);
  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n');
  assert.ok(gitignore.includes('*.zip') && gitignore.includes('!design/maquette-handoff.zip'), '.gitignore : archives ignorées, sauf la maquette');
  assert.ok(readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').includes('**/*.zip'), 'image Docker : aucune archive');
  assert.match(readFileSync(join(ROOT, 'design/handoff-README.md'), 'utf8'), /design\/maquette-handoff\.zip/);
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /design\/maquette-handoff\.zip/);
  assert.ok(existsSync(join(ROOT, 'design/prototype-suivi-formations.dc.html')), 'prototype de référence toujours extrait');
});
