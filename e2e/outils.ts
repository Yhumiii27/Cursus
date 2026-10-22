// Outils communs des tests de bout en bout (t165) : jeu de démonstration remis à neuf, choix de l'espace et connexion
// de démonstration, menu en tiroir du téléphone, erreurs de la console relevées (aucune violation de la CSP permise).
import { expect, test as base, type Page } from '@playwright/test';

/** Libellés de l'espace dans le sélecteur de vue de la démonstration (layout/Shell.tsx). */
export type Vue = 'RH' | 'Manager' | 'Utilisateur';

/**
 * Test qui repart du jeu de démonstration (`demo.reinitialiser`, par la session RH ouverte d'office en démonstration) et
 * qui échoue sur toute erreur de la console du navigateur (script refusé par la CSP, erreur de rendu).
 */
export const test = base.extend<{ erreurs: string[] }>({
  erreurs: [async ({ page }, use) => {
    const erreurs: string[] = [];
    page.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
    page.on('pageerror', e => erreurs.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    const r = await page.evaluate(async () => {
      const rep = await fetch('/api/actions/demo.reinitialiser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return rep.status;
    });
    expect(r, 'réinitialisation de la démonstration').toBe(200);
    await page.goto('/');
    await use(erreurs);
    expect(erreurs, 'erreurs de la console').toEqual([]);
  }, { auto: true }],
});
export { expect };

/** Écran étroit : la navigation et le sélecteur de vue sont dans le menu en tiroir. */
export async function ouvrirMenu(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
}

/** Passe à l'espace `vue` puis se connecte au compte de démonstration dont le libellé contient `compte`. */
export async function connecter(page: Page, vue: Vue, compte: string) {
  await ouvrirMenu(page);
  await page.locator('label').filter({ has: page.getByRole('radio', { name: vue, exact: true }) }).click();
  const choix = page.getByLabel('Compte');
  await expect(choix).toBeVisible();
  const valeur = await page.locator('#lg-id option', { hasText: compte }).getAttribute('value');
  await choix.selectOption(valeur!);
  // Démonstration : n'importe quel mot de passe.
  const mdp = page.getByLabel('Mot de passe');
  if (await mdp.isVisible()) await mdp.fill('demo');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toHaveCount(0);
}

/** Dialogue ouvert (fenêtre modale nommée par son titre). */
export const dialogue = (page: Page, titre: string | RegExp) => page.getByRole('dialog', { name: titre });

/** Message de confirmation affiché après une action (notification). */
export async function notification(page: Page, texte: string | RegExp) {
  await expect(page.getByText(texte).first()).toBeVisible();
}

/** Mehdi Benali saisit 7,5 h le lundi 5 octobre (activité INT-MAINT) et soumet sa feuille à Karim Haddad. */
export async function soumettreFeuille(page: Page, telephone: boolean) {
  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await page.goto('/temps?semaine=2026-10-05');
  await expect(page.getByRole('heading', { name: 'Temps de travail' })).toBeVisible();
  await page.getByLabel('Ajouter un projet').selectOption('INT-MAINT');
  // Téléphone : un jour à la fois, choisi dans la barre des jours (pages/SaisieJour.tsx).
  if (telephone) await page.getByRole('group', { name: 'Jour affiché' }).getByRole('button', { name: /^Lun/ }).click();
  const lundi = page.getByLabel(/^INT-MAINT · .* — lundi 5 octobre$/);
  await lundi.fill('7,5');
  await lundi.press('Enter');
  await expect(page.getByText(/7,5 h/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Soumettre au manager' }).click();
  await expect(page.getByText('En attente de validation par Karim Haddad')).toBeVisible();
}
