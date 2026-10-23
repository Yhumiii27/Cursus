// Serveur des tests de bout en bout (npm run e2e, t165), lancé par Playwright (playwright.config.ts, webServer) :
// l'interface compilée (npm run build, dist/ ou CURSUS_DIST) servie par l'API, en mode démonstration, sur une base
// jetable créée dans un dossier temporaire et effacée à l'arrêt, à une date figée. Aucune donnée réelle.
// Variables : CURSUS_E2E_PORT (4310 par défaut), CURSUS_E2E_DATE (2026-10-10, celle du jeu de démonstration).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const dossier = mkdtempSync(join(tmpdir(), 'cursus-e2e-'));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  CURSUS_DEMO: '1',
  CURSUS_HOST: '127.0.0.1',
  CURSUS_API_PORT: process.env.CURSUS_E2E_PORT || '4310',
  CURSUS_DB: join(dossier, 'e2e.db'),
  CURSUS_TODAY: process.env.CURSUS_E2E_DATE || '2026-10-10',
};
const serveur = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(racine, 'server/src/index.ts')], { stdio: 'inherit', env, cwd: racine });
let fin = false;
const arreter = () => {
  if (fin) return;
  fin = true;
  serveur.kill('SIGTERM');
};
serveur.on('exit', code => {
  rmSync(dossier, { recursive: true, force: true });
  process.exit(code ?? 0);
});
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
