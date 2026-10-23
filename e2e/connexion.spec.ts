// Connexion par compte Cursus (compte local) : l'administrateur RH crée le compte d'une personne, le mot de passe
// provisoire s'affiche une seule fois ; la personne se connecte avec lui et doit le remplacer avant d'entrer.
import { dialogue, expect, ouvrirMenu, test } from './outils.ts';

test('compte local : mot de passe provisoire, changement obligatoire à la première connexion', async ({ page }) => {
  await page.goto('/parametres');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  const d = dialogue(page, 'Nouveau compte');
  // Tous les salariés de la démonstration ont déjà un compte : compte d'une personne externe (auditeur), profil Lecture seule.
  await d.locator('label').filter({ hasText: 'Personne externe' }).click();
  await d.getByLabel('Nom').fill('Claire Auditrice');
  await d.getByLabel('Adresse e-mail').fill('claire.auditrice@cabinet.fr');
  await d.locator('label').filter({ hasText: 'Compte Cursus' }).click();
  await d.getByLabel('Profil RH').selectOption('lecture_seule');
  const identifiant = await d.getByLabel('Identifiant').inputValue();
  expect(identifiant).not.toBe('');
  await d.getByRole('button', { name: 'Créer le compte' }).click();

  // Affiché une seule fois : ni le fond ni Échap ne ferment ce dialogue.
  const mdp = dialogue(page, 'Mot de passe provisoire');
  const provisoire = (await mdp.locator('.mono-input.tnum').textContent())!.trim();
  expect(provisoire.length).toBeGreaterThanOrEqual(8);
  await mdp.getByRole('button', { name: 'J’ai transmis le mot de passe' }).click();

  // Déconnexion, puis connexion avec l'identifiant et le mot de passe provisoire.
  await ouvrirMenu(page);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.getByRole('button', { name: 'Se connecter avec un compte Cursus' }).click();
  await page.getByLabel('Identifiant').fill(identifiant);
  await page.getByLabel('Mot de passe').fill(provisoire);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

  // Mot de passe à remplacer avant d'entrer.
  await expect(page.getByRole('heading', { name: 'Changer mon mot de passe' })).toBeVisible();
  await page.getByLabel('Mot de passe provisoire').fill(provisoire);
  await page.getByLabel(/^Nouveau mot de passe/).fill('Chantier-Feyzin-2027');
  await page.getByLabel('Confirmation').fill('Chantier-Feyzin-2027');
  await page.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Changer mon mot de passe' })).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();
});
