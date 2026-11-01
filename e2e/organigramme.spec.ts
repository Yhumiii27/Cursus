// Organigramme (lot 12 — C7) : choix d'un service, vue graphique en arbre vertical, dépliage d'une équipe. Sur le
// téléphone (moins de 600 px), la vue graphique laisse la place à la liste indentée, avec un message.
import { expect, test } from './outils.ts';

test('organigramme : choisir un service, passer en vue graphique, déplier une équipe', async ({ page, isMobile }) => {
  await page.goto('/organigramme');
  await expect(page.getByRole('heading', { name: 'Organigramme' })).toBeVisible();
  // Service : la Maintenance seule, son rattachement en fil d'Ariane, gardée dans l'adresse.
  await page.getByRole('combobox', { name: 'Service' }).fill('Maintenance');
  await expect(page).toHaveURL(/service=Maintenance/);
  await expect(page.getByRole('navigation', { name: 'Rattachement du service' })).toContainText('Maintenance');
  const arbre = page.getByRole('tree', { name: 'Organigramme' });
  await expect(arbre.getByRole('treeitem', { name: /^Production/ })).toHaveCount(0);
  // Présentation graphique.
  await page.locator('label').filter({ has: page.getByRole('radio', { name: 'Graphique' }) }).click();
  await expect(page).toHaveURL(/vue=graphique/);
  const maintenance = arbre.getByRole('treeitem', { name: /^Maintenance/ }).first();
  if (isMobile) {
    await expect(page.getByText(/Vue graphique indisponible sur un écran étroit/)).toBeVisible();
    await expect(arbre).toHaveClass(/org-arbre/);
  } else {
    await expect(arbre).toHaveClass(/orgg-arbre/);
  }
  // Dépliage : la Maintenance, repliée par « Tout replier », montre ses membres une fois dépliée.
  await page.getByRole('button', { name: 'Tout replier' }).click();
  await expect(maintenance).toHaveAttribute('aria-expanded', 'false');
  await maintenance.locator(isMobile ? '.org-ligne' : '.orgg-tete').first().click();
  await expect(maintenance).toHaveAttribute('aria-expanded', 'true');
  await expect(arbre.getByText('Mehdi Benali')).toBeVisible();
  // La page ne déborde pas : l'arbre défile dans son cadre.
  const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(largeurs[0]).toBeLessThanOrEqual(largeurs[1]);
});
