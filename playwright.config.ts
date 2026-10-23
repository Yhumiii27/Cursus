// Tests de bout en bout (t165) : parcours complets par rôle, rejoués dans Chrome, Edge et un téléphone simulé (appareils
// retenus par l'entreprise : PC Windows sous Edge ou Chrome, téléphone ou tablette fournis). npm run e2e, après
// npm run build. Le serveur (scripts/e2e-serveur.mjs) sert l'interface compilée en mode démonstration, sur une base
// jetable à date figée ; chaque test repart du jeu de démonstration (e2e/outils.ts), d'où un seul test à la fois.
// Variables : CURSUS_E2E_PORT (4310), CURSUS_E2E_CHROMIUM (chemin d'un Chromium déjà installé, sinon celui de
// Playwright), CURSUS_E2E_SANS_EDGE=1 (poste sans Microsoft Edge). Rapport : playwright-report/ (ignoré par Git).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.CURSUS_E2E_PORT || 4310);
const chromium = process.env.CURSUS_E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.CURSUS_E2E_CHROMIUM } } : {};

export default defineConfig({
  testDir: 'e2e',
  // La base est remise au jeu de démonstration avant chaque test : jamais deux tests en même temps.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
    ...(process.env.CURSUS_E2E_SANS_EDGE === '1' ? [] : [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }]),
    // Téléphone : écran étroit et tactile (menu en tiroir, saisie des heures jour par jour), moteur Chromium.
    { name: 'telephone', use: { ...devices['Pixel 7'], ...chromium } },
  ],
  webServer: {
    command: 'node scripts/e2e-serveur.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
