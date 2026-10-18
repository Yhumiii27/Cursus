#!/usr/bin/env node
// npm run test:pg : la suite de tests sur PostgreSQL (CURSUS_TEST_ENGINE=pg, tests/base.ts). CURSUS_TEST_DATABASE_URL
// désigne la base d'administration d'un serveur PostgreSQL 16 de test (chaque fichier de test y crée puis supprime sa
// propre base) : jamais le serveur commun EPC2I.
//   CURSUS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:pg
// npm run test:coverage:pg : même suite, couverture de l'adaptateur PostgreSQL (server/src/db-pg.ts), exclu de la
// couverture de npm run test:coverage, qui tourne sur SQLite ; seuils écrits ci-dessous, fixés juste sous la mesure.
import { spawnSync } from 'node:child_process';

if (!process.env.CURSUS_TEST_DATABASE_URL?.trim()) {
  console.error('npm run test:pg : définissez CURSUS_TEST_DATABASE_URL (base d’administration d’un serveur PostgreSQL de test, '
    + 'par exemple postgres://postgres@127.0.0.1:5432/postgres).');
  process.exit(2);
}
const couverture = process.argv.includes('--couverture');
const args = ['--test'];
if (couverture) {
  args.push('--experimental-test-coverage', '--test-coverage-include=server/src/db-pg.ts',
    '--test-coverage-lines=99', '--test-coverage-branches=92', '--test-coverage-functions=97');
}
args.push('tests/**/*.test.ts');
const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, CURSUS_TEST_ENGINE: 'pg' } });
process.exit(r.status ?? 1);
