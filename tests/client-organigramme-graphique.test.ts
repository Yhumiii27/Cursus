// Organigramme, lot 12 — C7 (pages/Organigramme.tsx, components/organigramme/) sous node --test (tests/outils/rendu.ts) :
// vue graphique en arbre vertical (boîtes, traits, sémantique ARIA, clavier, « N personnes » au-delà de 8, zoom borné),
// choix d'un service (champ et liste, fil d'Ariane, « Voir ce service seul »), service choisi déplié (aussi depuis
// l'adresse), Entrée de la recherche sur une équipe trouvée, export du service seul tracé avec le nom de l'équipe,
// collaborateur sans étiquette ni « À affecter », liste indentée d'office sur un écran étroit, arbre vertical imprimé.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
// Messages d'échec courts : le DOM de l'organigramme entier rendrait chaque erreur de recherche très lente.
process.env.DEBUG_PRINT_LIMIT = '2000';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { amorcerEntites } = await import('../server/src/demarrage.ts');
const { Organigramme } = await import('../client/src/pages/Organigramme.tsx');
const { arbreVerticalHtml } = await import('../client/src/print.ts');

afterEach(() => cleanup());

/**
 * Base de démonstration avec l'entité amorcée, la Maintenance rattachée à la Production (service > atelier) et la
 * Logistique grossie de quatre opérateurs de la Production (neuf présents : au-delà du seuil de huit).
 */
async function base() {
  const b = await baseDemo();
  await amorcerEntites(b.db);
  await b.db.run(`UPDATE equipes SET parente = 'Production' WHERE nom = 'Maintenance'`);
  await b.db.run(`UPDATE employes SET equipe = 'Logistique' WHERE equipe = 'Production' AND id <> 3`);
  return b;
}
const noeud = (nom: string | RegExp) => screen.getAllByRole('treeitem').find(li => li.querySelector(':scope > .orgg-boite > .orgg-tete, :scope > .org-ligne')?.textContent?.match(nom))!;
const appuyer = async (cle: string) => { await act(async () => { fireEvent.keyDown(document.activeElement!, { key: cle }); }); };

test('vue graphique : boîtes reliées par des traits, arbre ARIA au clavier, « N personnes » repliées, zoom borné', async () => {
  const { db, personne } = await base();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme), { orgVue: 'graphique' });
  render(b.element);
  const arbre = screen.getByRole('tree', { name: 'Organigramme' });
  assert.ok(arbre.classList.contains('orgg-arbre'), 'arbre vertical');
  assert.ok(screen.getByRole('radio', { name: 'Graphique' }).matches(':checked'));
  const entreprise = noeud(/^Entreprise/);
  assert.equal(entreprise.getAttribute('aria-level'), '1');
  assert.equal(entreprise.getAttribute('aria-expanded'), 'true');
  assert.equal(entreprise.tabIndex, 0, 'focus itinérant : le premier nœud');
  // Boîtes des équipes racines sous l'entité, dans un groupe tracé (traits CSS de .orgg-enfants).
  const groupe = entreprise.querySelector(':scope > ul[role="group"].orgg-enfants')!;
  assert.ok(groupe, 'équipes reliées sous l’entité');
  const production = noeud(/^Production/);
  assert.ok(production.parentElement === groupe);
  assert.equal(production.getAttribute('aria-level'), '2');
  assert.match(production.querySelector('.orgg-tete')!.textContent!, /manager : Sophie Lemaire/);
  assert.match(production.querySelector('.orgg-tete')!.textContent!, /présents?/);
  // Production dépliée (équipe racine) : sa manager dans la boîte, la Maintenance dessous, repliée.
  assert.ok(within(production.querySelector('.orgg-membres') as HTMLElement).getByText('Sophie Lemaire'));
  const maintenance = noeud(/^Maintenance/);
  assert.equal(maintenance.getAttribute('aria-level'), '3');
  assert.equal(maintenance.getAttribute('aria-expanded'), 'false');
  assert.equal(maintenance.querySelector('.orgg-membres'), null, 'repliée : ni membres ni sous-équipes');
  // Logistique : neuf présents, derrière « 9 personnes » (nœud dépliable, replié).
  const logistique = noeud(/^Logistique/);
  const replie = within(logistique).getByRole('treeitem', { name: /9 personnes/ });
  assert.equal(replie.getAttribute('aria-expanded'), 'false');
  assert.equal(within(logistique).queryByText('Julien Moreau'), null);
  await act(async () => { fireEvent.click(replie.querySelector('.orgg-replie-ligne')!); });
  assert.ok(within(noeud(/^Logistique/)).getByText('Julien Moreau'));
  // Clavier (comparaisons d'éléments par ===, un échec n'imprime pas tout le DOM) : bas (Logistique, première équipe
  // racine), droite (déjà dépliée : « 9 personnes »), gauche (retour) ; droite sur Production (son premier membre) ;
  // droite sur la Maintenance repliée (dépliée).
  entreprise.focus();
  await appuyer('ArrowDown');
  assert.ok(document.activeElement === noeud(/^Logistique/), 'bas : Logistique');
  await appuyer('ArrowRight');
  assert.equal((document.activeElement as HTMLElement).dataset.cle, 'm:Logistique');
  await appuyer('ArrowLeft');
  assert.equal((document.activeElement as HTMLElement).dataset.cle, 'm:Logistique', 'dépliée : gauche la replie d’abord');
  assert.equal((document.activeElement as HTMLElement).getAttribute('aria-expanded'), 'false');
  await appuyer('ArrowLeft');
  assert.ok(document.activeElement === noeud(/^Logistique/), 'gauche : nœud parent');
  noeud(/^Production/).focus();
  await appuyer('ArrowRight');
  assert.match((document.activeElement as HTMLElement).dataset.cle!, /^p:/, 'premier membre de la boîte');
  await appuyer('ArrowLeft');
  assert.ok(document.activeElement === noeud(/^Production/), 'retour à la Production');
  noeud(/^Maintenance/).focus();
  await appuyer('ArrowRight');
  assert.equal(noeud(/^Maintenance/).getAttribute('aria-expanded'), 'true');
  assert.ok(within(noeud(/^Maintenance/)).getByText('Mehdi Benali'));
  await appuyer('Enter');
  assert.equal(noeud(/^Maintenance/).getAttribute('aria-expanded'), 'false');
  await appuyer('End');
  await appuyer('Home');
  assert.ok(document.activeElement === noeud(/^Entreprise/), 'Début : premier nœud');
  // Tout déplier : aussi les « N personnes » ; tout replier.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tout déplier' })); });
  assert.equal(within(noeud(/^Logistique/)).getByRole('treeitem', { name: /9 personnes/ }).getAttribute('aria-expanded'), 'true');
  assert.equal(noeud(/^Maintenance/).getAttribute('aria-expanded'), 'true');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tout replier' })); });
  assert.equal(noeud(/^Entreprise/).getAttribute('aria-expanded'), 'false');
  // Zoom : par dizaines, borné à 150 %.
  const plan = document.querySelector<HTMLElement>('.orgg-plan')!;
  assert.equal(plan.style.transform, '');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agrandir' })); });
  assert.equal(plan.style.transform, 'scale(1.1)');
  assert.ok(screen.getByText('110 %'));
  for (let i = 0; i < 6; i++) await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agrandir' })); });
  assert.ok(screen.getByText('150 %'));
  assert.equal((screen.getByRole('button', { name: 'Agrandir' }) as HTMLButtonElement).disabled, true);
  // Retour à la liste : même arbre, présentation indentée.
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Liste' })); });
  assert.ok(screen.getByRole('tree', { name: 'Organigramme' }).classList.contains('org-arbre'));
});

test('choix d’un service : liste des chemins, service seul déplié avec son rattachement, « Voir ce service seul », export du service', async () => {
  const { db, personne } = await base();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme), { orgVue: 'graphique' });
  render(b.element);
  const champ = screen.getByRole('combobox', { name: 'Service' }) as HTMLInputElement;
  const options = [...document.querySelectorAll(`#${CSS.escape(champ.getAttribute('list')!)} option`)].map(o => (o as HTMLOptionElement).value);
  assert.ok(options.includes('Production › Maintenance'), 'chemin de la sous-équipe');
  assert.ok(options.indexOf('Production') < options.indexOf('Production › Maintenance'));
  // Saisie d'un chemin de la liste : la Maintenance seule, en haut ; fil d'Ariane jusqu'à la Production.
  await act(async () => { fireEvent.change(champ, { target: { value: 'Production › Maintenance' } }); });
  const racine = screen.getAllByRole('treeitem')[0];
  assert.match(racine.querySelector('.orgg-tete')!.textContent!, /^Maintenance/);
  assert.equal(racine.getAttribute('aria-level'), '1');
  // Le service choisi s'ouvre déplié : ses membres sont visibles d'emblée (sous-équipe, hors du dépliage initial).
  assert.equal(racine.getAttribute('aria-expanded'), 'true', 'service choisi déplié');
  assert.ok(within(racine).getByText('Mehdi Benali'));
  assert.equal(noeud(/^Production/), undefined, 'aucune autre équipe');
  const ariane = screen.getByRole('navigation', { name: 'Rattachement du service' });
  assert.match(ariane.textContent!, /Tous les services.*Entreprise.*Production.*Maintenance/);
  // Recherche limitée au service : Sophie Lemaire (Production) n'y est pas.
  await act(async () => { fireEvent.change(screen.getByPlaceholderText('Nom ou poste dans Maintenance'), { target: { value: 'sophie' } }); });
  assert.ok(screen.getByText('Aucune équipe ni personne ne correspond à ces filtres.'));
  await act(async () => { fireEvent.change(screen.getByPlaceholderText('Nom ou poste dans Maintenance'), { target: { value: '' } }); });
  // Export : les cinq présents de la Maintenance, tracés par l'entité et le nombre de lignes seulement.
  const urlAvant = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:essai';
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' })); });
  } finally {
    URL.createObjectURL = urlAvant;
  }
  const exp = b.trace.actions.find(a => a.name === 'organigramme.exporter')!;
  assert.deepEqual(exp.payload, { entite: '', lignes: 5, service: 'Maintenance' });
  assert.equal(exp.r.ok, true, exp.r.error);
  // Remonter d'un niveau : la Production et sa sous-équipe.
  await act(async () => { fireEvent.click(within(ariane).getByRole('button', { name: 'Production' })); });
  assert.match(screen.getAllByRole('treeitem')[0].querySelector('.orgg-tete')!.textContent!, /^Production/);
  assert.equal((screen.getByRole('combobox', { name: 'Service' }) as HTMLInputElement).value, 'Production');
  // Clic sur une équipe : « Voir ce service seul ».
  await act(async () => { fireEvent.click(noeud(/^Maintenance/).querySelector('.orgg-tete')!); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voir ce service seul' })); });
  assert.match(screen.getAllByRole('treeitem')[0].querySelector('.orgg-tete')!.textContent!, /^Maintenance/);
  // Tous les services (fil d'Ariane) : l'arbre entier revient ; la croix du champ fait de même.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tous les services' })); });
  assert.ok(noeud(/^Entreprise/));
  await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Service' }), { target: { value: 'Maintenance' } }); });
  assert.equal(noeud(/^Entreprise/), undefined, 'nom exact accepté aussi');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Effacer le service/ })); });
  assert.ok(noeud(/^Entreprise/));
  assert.equal((screen.getByRole('combobox', { name: 'Service' }) as HTMLInputElement).value, '');
  assert.equal(screen.queryByRole('navigation', { name: 'Rattachement du service' }), null);
  // En liste aussi : « Voir ce service seul » après un clic sur une équipe.
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Liste' })); });
  await act(async () => { fireEvent.click(noeud(/^Logistique/).querySelector('.org-ligne')!); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voir ce service seul' })); });
  assert.match(screen.getAllByRole('treeitem')[0].querySelector('.org-ligne')!.textContent!, /^Logistique/);
  // Texte qui ne correspond à aucun service : refusé, le champ revient au service affiché en perdant le focus.
  const c = screen.getByRole('combobox', { name: 'Service' }) as HTMLInputElement;
  await act(async () => { fireEvent.change(c, { target: { value: 'Inconnu' } }); });
  await act(async () => { fireEvent.blur(c); });
  assert.equal(c.value, 'Logistique');
});

test('collaborateur en vue graphique : ni étiquette de contrat, ni « À affecter », ni anomalie ; liste d’office sur un téléphone', async () => {
  const { db, personne } = await base();
  await db.run(`UPDATE employes SET equipe = NULL WHERE id = 8`);
  const rh = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme), { orgVue: 'graphique' });
  render(rh.element);
  assert.ok(noeud(/^À affecter/), 'salarié à affecter montré au service RH');
  assert.ok(screen.getAllByText('Intérim').length > 0);
  cleanup();
  const b = await monter(db, await personne(2, 'collaborateur'), () => createElement(Organigramme), { orgVue: 'graphique' });
  render(b.element);
  assert.ok(screen.getByRole('tree').classList.contains('orgg-arbre'));
  assert.equal(screen.queryByText('Intérim'), null);
  assert.equal(screen.queryByText('À affecter'), null);
  assert.equal(screen.queryByText('À vérifier'), null);
  cleanup();
  // Écran étroit (600 px au plus) : la liste indentée, avec un message ; le choix reste « Graphique ».
  const avant = globalThis.matchMedia;
  globalThis.matchMedia = ((q: string) => ({ matches: q === '(max-width: 600px)', media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;
  try {
    const t = await monter(db, await personne(2, 'collaborateur'), () => createElement(Organigramme), { orgVue: 'graphique' });
    render(t.element);
    assert.ok(screen.getByRole('tree').classList.contains('org-arbre'));
    assert.ok(screen.getByText(/Vue graphique indisponible sur un écran étroit/));
    assert.ok(screen.getByRole('radio', { name: 'Graphique' }).matches(':checked'));
  } finally {
    globalThis.matchMedia = avant;
  }
});

test('arbre vertical imprimé : boîtes, membres dans la boîte, équipes dessous, échelle par classe, texte échappé', () => {
  const html = arbreVerticalHtml([{ libelle: 'Production <A&B>', detail: 'manager : Sophie', groupe: true, enfants: [
    { libelle: 'Sophie Lemaire', detail: 'Cheffe' }, { libelle: 'Maintenance', groupe: true, enfants: [{ libelle: 'Mehdi Benali' }] },
  ] }], 70);
  assert.match(html, /^<div class="arbre-vertical echelle-70"><ul class="racines"><li><div class="boite">/);
  assert.match(html, /Production &lt;A&amp;B&gt;/);
  assert.match(html, /<ul class="membres"><li>Sophie Lemaire <span class="detail">Cheffe<\/span><\/li><\/ul><\/div><ul class="enfants"><li><div class="boite"><span class="libelle">Maintenance/);
  assert.ok(!/style=|<script/.test(html), 'ni style ni script en ligne (CSP)');
  assert.match(arbreVerticalHtml([{ libelle: 'Seul', groupe: true }]), /^<div class="arbre-vertical"><ul/);
  assert.match(arbreVerticalHtml([{ libelle: 'Seul', groupe: true }], 12), /echelle-30/, 'jamais sous 30 %');
});

test('service choisi par l’adresse : déplié en graphique comme en liste ; Entrée de la recherche sur une équipe trouvée', async () => {
  const { db, personne } = await base();
  for (const orgVue of ['graphique', 'liste'] as const) {
    const b = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme), { orgVue, orgService: 'Maintenance' });
    render(b.element);
    const racine = screen.getAllByRole('treeitem')[0];
    assert.equal(racine.dataset.cle, 'q:Maintenance', orgVue);
    assert.equal(racine.getAttribute('aria-expanded'), 'true', `${orgVue} : service déplié`);
    assert.ok(within(racine).getByText('Mehdi Benali'), orgVue);
    cleanup();
  }
  // Recherche d'une équipe par son seul nom (« Logistique » : aucun nom ni poste de personne), puis Entrée : le focus va
  // sur l'équipe, en graphique comme en liste.
  for (const orgVue of ['graphique', 'liste'] as const) {
    const b = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme), { orgVue });
    render(b.element);
    const champ = screen.getByPlaceholderText('Nom, poste ou équipe');
    await act(async () => { fireEvent.change(champ, { target: { value: 'Logistique' } }); });
    champ.focus();
    await act(async () => { fireEvent.keyDown(champ, { key: 'Enter' }); });
    assert.equal((document.activeElement as HTMLElement).dataset.cle, 'q:Logistique', `${orgVue} : Entrée sur l’équipe trouvée`);
    cleanup();
  }
});
