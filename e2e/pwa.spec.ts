// Application mobile (lot 11, chantier C2, t196) en démonstration : manifeste et service worker servis (CURSUS_PWA active
// par défaut), coque gardée sans aucune réponse de l'API, saisie des heures gardée pendant une coupure du réseau puis
// envoyée à son retour, page « Hors ligne » d'une ouverture sans réseau, refus en conflit placé dans « À reprendre », barre
// d'onglets de l'application installée sur téléphone. http://127.0.0.1 est un contexte sécurisé : le service worker s'y
// enregistre comme en HTTPS.
import type { Page } from '@playwright/test';
import { connecter, expect, test } from './outils.ts';

/** Erreurs de la console attendues hors ligne (requêtes refusées par le navigateur coupé du réseau). */
const RESEAU = /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|ERR_FAILED/;
const sansErreursReseau = (erreurs: string[]) => erreurs.splice(0, erreurs.length, ...erreurs.filter(e => !RESEAU.test(e)));

/** Service worker actif et maître de la page (la page est rechargée une fois s'il vient de s'installer). */
async function serviceWorkerActif(page: Page) {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.active, null, { timeout: 15_000 });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

/** Feuille de Mehdi Benali, semaine du 5 octobre, ligne INT-MAINT ; champ du lundi. */
async function feuilleDuLundi(page: Page, telephone: boolean) {
  await page.goto('/temps?semaine=2026-10-05');
  await expect(page.getByRole('heading', { name: 'Temps de travail' })).toBeVisible();
  await page.getByLabel('Ajouter un projet').selectOption('INT-MAINT');
  if (telephone) await page.getByRole('group', { name: 'Jour affiché' }).getByRole('button', { name: /^Lun/ }).click();
  const lundi = page.getByLabel(/^INT-MAINT · .* — lundi 5 octobre$/);
  await expect(lundi).toBeVisible();
  return lundi;
}

test('manifeste, icônes et service worker : servis en démonstration, jamais une réponse /api dans le cache', async ({ page, request }) => {
  const manifeste = await (await request.get('/manifest.webmanifest')).json();
  expect(manifeste.start_url).toBe('/?source=pwa');
  expect(manifeste.display).toBe('standalone');
  expect(manifeste.shortcuts.map((s: { name: string }) => s.name)).toEqual(['Saisir mes heures', 'Demander une absence']);
  for (const i of manifeste.icons) expect((await request.get(i.src)).headers()['content-type']).toBe('image/png');
  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toBe('no-cache');
  expect(await sw.text()).not.toContain('__CURSUS_VERSION__');

  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await serviceWorkerActif(page);
  const gardes = await page.evaluate(async () => {
    const noms = await caches.keys();
    const urls = (await Promise.all(noms.map(async n => (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname)))).flat();
    return { noms, urls };
  });
  expect(gardes.noms).toHaveLength(1);
  expect(gardes.noms[0]).toMatch(/^cursus-coque-[0-9a-f]{12}$/);
  expect(gardes.urls).toContain('/index.html');
  expect(gardes.urls.some(u => u.startsWith('/assets/'))).toBe(true);
  expect(gardes.urls.filter(u => u.startsWith('/api'))).toEqual([]);
});

test('coupure du réseau : heures gardées sur l’appareil, page « Hors ligne » à la réouverture, envoyées au retour', async ({ page, context, isMobile, erreurs }) => {
  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await serviceWorkerActif(page);
  const lundi = await feuilleDuLundi(page, isMobile);

  await context.setOffline(true);
  await expect(page.getByText(/^Hors ligne : vos heures et vos demandes de congé/)).toBeVisible();
  await lundi.fill('7,5');
  await lundi.press('Enter');
  await expect(page.getByText('1 saisie en attente d’envoi')).toBeVisible();
  await expect(lundi).toHaveValue('7,5');
  await page.getByRole('button', { name: 'Voir' }).click();
  await expect(page.getByText(/^Heures · INT-MAINT · lundi 5 octobre : 7,5 h$/)).toBeVisible();

  // Réouverture sans réseau : la coque vient du service worker, seule la file d'attente s'affiche.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hors ligne' })).toBeVisible();
  await expect(page.getByText(/^Heures · INT-MAINT · lundi 5 octobre : 7,5 h$/)).toBeVisible();

  // Retour du réseau : Cursus s'ouvre et envoie la saisie (même compte, même espace).
  await context.setOffline(false);
  await expect(page.getByText('1 saisie envoyée au retour du réseau')).toBeVisible();
  await expect(page.getByText('1 saisie en attente d’envoi')).toHaveCount(0);
  await page.goto('/temps?semaine=2026-10-05');
  if (isMobile) await page.getByRole('group', { name: 'Jour affiché' }).getByRole('button', { name: /^Lun/ }).click();
  await expect(page.getByLabel(/^INT-MAINT · .* — lundi 5 octobre$/)).toHaveValue('7,5');
  sansErreursReseau(erreurs);
});

test('conflit : la cellule changée ailleurs pendant la coupure n’est pas écrasée, la saisie passe « À reprendre »', async ({ page, context, isMobile, erreurs }) => {
  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await serviceWorkerActif(page);
  const lundi = await feuilleDuLundi(page, isMobile);
  await context.setOffline(true);
  await lundi.fill('7');
  await lundi.press('Enter');
  await expect(page.getByText('1 saisie en attente d’envoi')).toBeVisible();

  // Pendant ce temps, depuis le PC (même compte) : 5 h sur la même cellule.
  const pc = await page.request.post('/api/actions/temps.saisir', {
    headers: { 'x-cursus-espace': 'collaborateur' },
    data: { empId: 2, week: '2026-10-05', projet: 'INT-MAINT', di: 0, value: '5', base: '0' },
  });
  expect(pc.status()).toBe(200);

  await context.setOffline(false);
  await expect(page.getByText('1 saisie refusée par le serveur : voyez « À reprendre »')).toBeVisible();
  await page.getByRole('button', { name: 'Voir' }).click();
  await expect(page.getByText(/^Conflit : la cellule du 5 oct\. 2026 \(INT-MAINT\) vaut maintenant 5 h/)).toBeVisible();
  await expect(lundi).toHaveValue('5');
  // Conflit : jamais « Renvoyer » (refusé de nouveau à coup sûr) ; « Ouvrir la feuille » ou « Abandonner… ».
  await expect(page.getByRole('button', { name: 'Renvoyer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ouvrir la feuille' })).toBeVisible();
  // Abandon par le dialogue « confirmer » : la file est vide, la valeur du serveur reste.
  await page.getByRole('button', { name: 'Abandonner…' }).click();
  await page.getByRole('dialog', { name: 'Abandonner la saisie' }).getByRole('button', { name: 'Abandonner la saisie' }).click();
  await expect(page.getByText(/à reprendre/)).toHaveCount(0);
  sansErreursReseau(erreurs);
});

test('application installée : barre d’onglets sur téléphone, raccourci « Demander une absence »', async ({ page, isMobile }) => {
  await connecter(page, 'Utilisateur', 'Mehdi Benali');
  await page.goto('/absences?nouveau=1&source=pwa');
  await expect(page.getByRole('dialog', { name: 'Poser une absence' })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  const barre = page.getByRole('navigation', { name: 'Accès rapide' });
  if (!isMobile) { await expect(barre).toBeHidden(); return; }
  await expect(barre).toBeVisible();
  await barre.getByRole('link', { name: /Mes heures/ }).click();
  await expect(page.getByRole('heading', { name: 'Temps de travail' })).toBeVisible();
  await expect(barre.getByRole('link', { name: /Mes heures/ })).toHaveAttribute('aria-current', 'page');
});
