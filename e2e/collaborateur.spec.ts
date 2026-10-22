// Parcours du collaborateur (Mehdi Benali, Maintenance, validé par Karim Haddad) : feuille de temps saisie et soumise,
// congé demandé à la demi-journée. Sur téléphone, la feuille se saisit jour par jour (pages/SaisieJour.tsx).
import { connecter, dialogue, expect, soumettreFeuille, test } from './outils.ts';

test('feuille de temps : projet ajouté, heures du lundi saisies, feuille soumise au manager', async ({ page, isMobile }) => {
  await soumettreFeuille(page, isMobile);
});

test('congé : demande d’une demi-journée de CP, en attente de validation', async ({ page }) => {
  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await page.goto('/absences');
  await page.getByRole('button', { name: 'Poser une absence' }).click();
  const d = dialogue(page, 'Poser une absence');
  // Envoi incomplet : les erreurs s'affichent sous les champs, le bouton n'est jamais grisé.
  await d.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(d.getByText('Indiquez le premier jour d’absence.')).toBeVisible();
  await d.getByLabel('Du').fill('2026-11-16');
  await expect(d.getByLabel('Au (inclus)')).toHaveValue('2026-11-16');
  await d.getByLabel('Durée').selectOption('matin');
  await d.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText(/16 nov/).first()).toBeVisible();
});
