// Parcours du manager (Karim Haddad, Maintenance) : validation d'une feuille de temps et d'un congé de son équipe,
// inscription d'un membre de l'équipe à une session de formation.
import { connecter, dialogue, expect, soumettreFeuille, test } from './outils.ts';

test('feuille de temps soumise par le collaborateur, validée par son manager depuis « Feuilles à valider »', async ({ page, isMobile }) => {
  await soumettreFeuille(page, isMobile);
  await connecter(page, 'Manager', 'Karim Haddad');
  await page.goto('/temps');
  const file = page.locator('.panel', { has: page.getByRole('heading', { name: 'Feuilles à valider' }) });
  const ligne = file.getByRole('row').filter({ hasText: 'Mehdi Benali' });
  await expect(ligne).toHaveCount(1);
  await ligne.getByRole('button', { name: 'Valider' }).click();
  await expect(ligne).toHaveCount(0);
});

test('congé de l’équipe : une demande validée, une autre refusée avec son motif', async ({ page }) => {
  await connecter(page, 'Manager', 'Karim Haddad');
  await page.goto('/absences');
  const demande = (nom: string) => page.getByRole('row').filter({ hasText: nom }).filter({ has: page.getByRole('button', { name: 'Valider' }) });
  await demande('Mehdi Benali').getByRole('button', { name: 'Valider' }).click();
  await expect(demande('Mehdi Benali')).toHaveCount(0);
  // Refus : dialogue « confirmer », motif obligatoire.
  await demande('Romain Chevalier').getByRole('button', { name: 'Refuser' }).click();
  const d = dialogue(page, 'Refuser la demande d’absence');
  await d.getByRole('button', { name: 'Refuser la demande' }).click();
  await expect(d.getByText('Indiquez le motif du refus.')).toBeVisible();
  await d.getByLabel(/Motif du refus/).fill('Arrêt technique programmé cette semaine-là');
  await d.getByRole('button', { name: 'Refuser la demande' }).click();
  await expect(d).toHaveCount(0);
  await expect(demande('Romain Chevalier')).toHaveCount(0);
});

test('inscription d’un membre de l’équipe à une session (renouvellement)', async ({ page }) => {
  await connecter(page, 'Manager', 'Karim Haddad');
  await page.goto('/collaborateurs?fiche=2');
  await page.getByRole('button', { name: 'Planifier un renouvellement' }).first().click();
  const d = dialogue(page, 'Planifier un renouvellement');
  await expect(d).toBeVisible();
  const session = d.getByRole('radio').and(d.locator(':not([disabled])')).first();
  await session.check({ force: true });
  await d.getByRole('button', { name: 'Confirmer l’inscription' }).click();
  await expect(d).toHaveCount(0);
});
