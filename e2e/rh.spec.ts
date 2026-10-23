// Parcours du service RH (Sandrine Vidal, administratrice RH, connectée d'office en démonstration) : refus d'une demande
// avec motif, réouverture d'une feuille validée avec motif, sortie d'un salarié, export CSV téléchargé.
import { readFileSync } from 'node:fs';
import { dialogue, expect, test } from './outils.ts';

test('demande de formation refusée avec un motif obligatoire', async ({ page }) => {
  await page.goto('/dashboard');
  const panneau = page.locator('.panel', { has: page.getByRole('heading', { name: 'Demandes des collaborateurs' }) });
  const ligne = panneau.getByRole('row').filter({ hasText: 'Marion Petit' });
  await ligne.getByRole('button', { name: 'Refuser' }).click();
  const d = dialogue(page, 'Refuser la demande');
  await d.getByRole('button', { name: 'Refuser la demande' }).click();
  await expect(d.getByText('Indiquez le motif du refus.')).toBeVisible();
  await d.getByLabel(/Motif du refus/).fill('Budget de l’exercice engagé');
  await d.getByRole('button', { name: 'Refuser la demande' }).click();
  await expect(d).toHaveCount(0);
  await expect(ligne).toHaveCount(0);
});

test('réouverture d’une feuille validée par l’administrateur RH, motif obligatoire', async ({ page }) => {
  await page.goto('/temps?salarie=2&semaine=2026-09-28');
  await page.getByRole('button', { name: 'Rouvrir la feuille' }).click();
  const d = dialogue(page, /^Rouvrir la feuille/);
  await d.getByRole('button', { name: 'Rouvrir la feuille' }).click();
  await expect(d.getByLabel(/Motif de la réouverture/)).toHaveAttribute('aria-invalid', 'true');
  await d.getByLabel(/Motif de la réouverture/).fill('Journée oubliée le jeudi');
  await d.getByText('Renvoyer au salarié').click();
  await d.getByRole('button', { name: 'Rouvrir la feuille' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText(/motif : Journée oubliée le jeudi/)).toBeVisible();
});

test('sortie d’un salarié : date et motif, solde des compteurs, sortie enregistrée sur la fiche', async ({ page }) => {
  await page.goto('/collaborateurs?fiche=8');
  await page.getByRole('button', { name: 'Enregistrer une sortie' }).click();
  const d = dialogue(page, /^Enregistrer la sortie/);
  await d.getByRole('button', { name: 'Enregistrer la sortie' }).click();
  await expect(d.getByText('Choisissez le motif de sortie.')).toBeVisible();
  await d.getByLabel('Dernier jour du contrat').fill('2026-12-31');
  await d.getByLabel('Motif de sortie').selectOption({ index: 1 });
  await expect(d.getByText(/^Solde des compteurs au /)).toBeVisible();
  await d.getByRole('button', { name: 'Enregistrer la sortie' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modifier la sortie' })).toBeVisible();
});

test('export CSV de l’annuaire téléchargé', async ({ page }) => {
  await page.goto('/collaborateurs');
  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exporter/ }).first().click(),
  ]);
  expect(telechargement.suggestedFilename()).toMatch(/\.csv$/);
  const contenu = readFileSync((await telechargement.path())!, 'utf8');
  expect(contenu).toContain('Mehdi Benali');
  // Une ligne d'en-tête et une ligne par salarié au moins.
  expect(contenu.trim().split(/\r?\n/).length).toBeGreaterThan(10);
});
