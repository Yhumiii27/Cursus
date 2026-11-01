// Rendu des écrans de l'organigramme (lot 11, chantier C1, étape 2) sous node --test (tests/outils/rendu.ts) : arbre ARIA
// et clavier, recherche, export tracé par `organigramme.exporter` (entité, lignes) ; vue d'un collaborateur (ni étiquette
// de contrat ni anomalie) et réglage qui la ferme ; Référentiels → Entités et sites (création contrôlée, fermeture
// confirmée) ; rattachement d'une équipe (une action par champ, site des membres recalculé) ; alerte de l'écran Équipes.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { amorcerEntites } = await import('../server/src/demarrage.ts');
const { Organigramme } = await import('../client/src/pages/Organigramme.tsx');
const { EntitesEtSites } = await import('../client/src/pages/ReferentielsEntites.tsx');
const { RefEntiteDialog } = await import('../client/src/dialogs/RefEntiteDialog.tsx');
const { RefSiteDialog } = await import('../client/src/dialogs/RefSiteDialog.tsx');
const { EquipeRattachementDialog } = await import('../client/src/dialogs/EquipeRattachementDialog.tsx');
const { Equipes } = await import('../client/src/pages/Equipes.tsx');

afterEach(() => cleanup());

/** Base de démonstration avec l'entité amorcée (comme au démarrage du serveur). */
async function base() {
  const b = await baseDemo();
  await amorcerEntites(b.db);
  return b;
}
const noeud = (nom: string | RegExp) => screen.getAllByRole('treeitem').find(li => li.querySelector('.org-ligne')?.textContent?.match(nom))!;

test('organigramme du service RH : arbre ARIA au clavier, étiquettes de contrat, recherche, export tracé sans nom', async () => {
  const { db, personne } = await base();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme));
  render(b.element);
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Organigramme' }));
  const arbre = screen.getByRole('tree', { name: 'Organigramme' });
  const entreprise = noeud(/^Entreprise/);
  assert.equal(entreprise.getAttribute('aria-expanded'), 'true');
  assert.equal(entreprise.getAttribute('aria-level'), '1');
  assert.equal(entreprise.tabIndex, 0, 'focus itinérant : le premier nœud');
  assert.ok(within(arbre).getAllByText('Intérim').length > 0, 'étiquette de contrat pour le service RH');
  // Clavier : bas, puis gauche replie l'équipe, droite la déplie, gauche (replié) remonte au parent.
  entreprise.focus();
  await act(async () => { fireEvent.keyDown(entreprise, { key: 'ArrowDown' }); });
  const logistique = noeud(/^Logistique/);
  assert.equal(document.activeElement, logistique);
  await act(async () => { fireEvent.keyDown(logistique, { key: 'ArrowLeft' }); });
  assert.equal(noeud(/^Logistique/).getAttribute('aria-expanded'), 'false');
  await act(async () => { fireEvent.keyDown(noeud(/^Logistique/), { key: 'ArrowRight' }); });
  assert.equal(noeud(/^Logistique/).getAttribute('aria-expanded'), 'true');
  await act(async () => { fireEvent.keyDown(noeud(/^Logistique/), { key: 'ArrowRight' }); });
  assert.equal(document.activeElement?.getAttribute('data-cle')?.startsWith('p:'), true, 'premier membre');
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); });
  assert.equal(document.activeElement, noeud(/^Logistique/), 'retour au parent');
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'End' }); });
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Home' }); });
  assert.equal(document.activeElement, noeud(/^Entreprise/));
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); });
  assert.equal(noeud(/^Entreprise/).getAttribute('aria-expanded'), 'false');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tout déplier' })); });
  assert.equal(noeud(/^Entreprise/).getAttribute('aria-expanded'), 'true');
  // Recherche : Mehdi Benali surligné, seul dans l'arbre.
  await act(async () => { fireEvent.change(screen.getByPlaceholderText('Nom, poste ou équipe'), { target: { value: 'mehdi' } }); });
  const trouves = document.querySelectorAll('.org-arbre [role="treeitem"].trouve');
  assert.equal(trouves.length, 1);
  assert.match(trouves[0].textContent!, /Mehdi Benali/);
  await act(async () => { fireEvent.keyDown(screen.getByPlaceholderText('Nom, poste ou équipe'), { key: 'Enter' }); });
  assert.equal(document.activeElement, trouves[0]);
  // Export : action tracée (entité, nombre de lignes), sans nom.
  const urlAvant = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:essai';
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' })); });
  } finally {
    URL.createObjectURL = urlAvant;
  }
  const exp = b.trace.actions.find(a => a.name === 'organigramme.exporter')!;
  assert.deepEqual(exp.payload, { entite: '', lignes: 1 });
  assert.equal(exp.r.ok, true, exp.r.error);
});

test('organigramme d’un collaborateur : annuaire des présents sans étiquette ni anomalie ; réglage qui le ferme', async () => {
  const { db, personne } = await base();
  await db.run(`UPDATE equipes SET manager_id = NULL WHERE nom = 'Commercial'`);
  const rh = await monter(db, await personne(null, 'rh'), () => createElement(Organigramme));
  render(rh.element);
  assert.ok(screen.getByText('À vérifier'), 'équipe sans manager signalée au service RH');
  cleanup();
  const b = await monter(db, await personne(2, 'collaborateur'), () => createElement(Organigramme));
  render(b.element);
  assert.ok(screen.getByRole('tree'));
  assert.equal(screen.queryByText('Intérim'), null);
  assert.equal(screen.queryByText('À vérifier'), null);
  assert.ok(noeud(/^Maintenance/));
  cleanup();
  // Réglage « Service RH seulement » (action de l'administrateur RH) : plus aucun présent transmis au collaborateur.
  const { ACTIONS } = await import('../server/src/actions/index.ts');
  const { makeCtx } = await import('../server/src/actions/context.ts');
  const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
  const admin = await personne(null, 'rh');
  await db.tx(async () => await ACTIONS['parametres.maj'](makeCtx(db, admin, await loadFull(db, admin)), { organigrammeOuvert: 'rh' }));
  const ferme = await buildSnapshot(db, await personne(2, 'collaborateur'));
  assert.equal(ferme.settings.organigrammeOuvert, 'rh');
  assert.deepEqual(ferme.presentsOrganigramme, [], 'réglage fermé : aucun présent transmis');
});

test('Référentiels → Entités et sites : entités et sites listés ; fermeture confirmée par l’administrateur RH', async () => {
  const { db, personne } = await base();
  await db.insert('entites', { code: 'lyon', nom: 'Établissement de Lyon', type: 'etablissement', parente: 'entreprise', siren: null, siret: '55210055400013', idcc: null, siteCode: null, ordre: 1, actif: true, fermeLe: null, source: 'local' });
  await db.insert('sites', { code: 'lab67', libelle: 'Laboratoire 67', actif: true, ordre: 0 });
  const b = await monter(db, await personne(null, 'rh'), () => createElement(EntitesEtSites));
  render(b.element);
  const ligne = screen.getByText('— Établissement de Lyon').closest('tr')!;
  assert.ok(within(ligne).getByText('552 100 554 00013'));
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Fermer' })); });
  const d = b.trace.ouverts.at(-1) as { type: string; c: { action: string; payload: unknown } };
  assert.equal(d.type, 'confirmer');
  assert.equal(d.c.action, 'entite.fermer');
  assert.deepEqual(d.c.payload, { code: 'lyon' });
  assert.ok(screen.getByText('Laboratoire 67'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nouveau site' })); });
  assert.deepEqual(b.trace.ouverts.at(-1), { type: 'refSite' });
  cleanup();
  // Lecture seule : aucun bouton.
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(EntitesEtSites));
  render(lect.element);
  assert.equal(screen.queryByRole('button', { name: 'Nouvelle entité' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Modifier' }), null);
});

test('nouvelle entité : SIRET contrôlé dans le dialogue, puis créée par le serveur ; nouveau site', async () => {
  const { db, personne } = await base();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(RefEntiteDialog, {}));
  render(b.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter au référentiel' })); });
  assert.equal(b.trace.actions.length, 0, 'saisie incomplète : rien n’est envoyé');
  assert.ok(screen.getByText(/Choisissez le type/));
  fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'etablissement' } });
  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: 'lyon' } });
  fireEvent.change(screen.getByLabelText(/Nom de l’établissement/), { target: { value: 'Établissement de Lyon' } });
  fireEvent.change(screen.getByLabelText(/^Société/), { target: { value: 'entreprise' } });
  fireEvent.change(screen.getByLabelText(/^SIRET/), { target: { value: '552 100 554 00014' } });
  assert.ok(screen.getByText(/dernier est la clé de contrôle/), 'clé de Luhn contrôlée dès la saisie');
  fireEvent.change(screen.getByLabelText(/^SIRET/), { target: { value: '552 100 554 00013' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter au référentiel' })); });
  assert.equal(b.trace.actions[0].name, 'entite.creer');
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.donnees().referentiels.entites!.find(x => x.code === 'lyon')!.siret, '55210055400013');
  assert.equal(b.trace.fermetures, 1);
  cleanup();
  const s = await monter(db, await personne(null, 'rh'), () => createElement(RefSiteDialog, {}));
  render(s.element);
  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: 'lab67' } });
  fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: 'Laboratoire 67' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter au référentiel' })); });
  assert.deepEqual(s.trace.actions[0].payload, { code: 'lab67', libelle: 'Laboratoire 67', actif: true });
  assert.equal(s.trace.actions[0].r.ok, true, s.trace.actions[0].r.error);
});

test('rattachement d’une équipe : site et unité, une action par champ ; site des membres recalculé', async () => {
  const { db, personne } = await base();
  await db.insert('sites', { code: 'lab67', libelle: 'Laboratoire 67', actif: true, ordre: 0 });
  const b = await monter(db, await personne(null, 'rh'), () => createElement(EquipeRattachementDialog, { nom: 'Maintenance' }));
  render(b.element);
  fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'lab67' } });
  fireEvent.change(screen.getByLabelText('Unité Matrix'), { target: { value: 'prd-maint' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.deepEqual(b.trace.actions.map(a => [a.name, a.r.ok]), [['equipe.site', true], ['equipe.unite', true]]);
  assert.deepEqual(b.trace.actions[1].payload, { nom: 'Maintenance', uniteCode: 'PRD-MAINT' });
  assert.equal(b.trace.fermetures, 1);
  assert.equal(b.donnees().employes.find(e => e.id === 2)!.siteCode, 'lab67');
  // Code d'unité mal formé : refusé dans le dialogue, rien n'est envoyé.
  cleanup();
  const c = await monter(db, await personne(null, 'rh'), () => createElement(EquipeRattachementDialog, { nom: 'Production' }));
  render(c.element);
  fireEvent.change(screen.getByLabelText('Unité Matrix'), { target: { value: 'pr' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(c.trace.actions.length, 0);
  assert.ok(screen.getByText(/trois lettres majuscules/));
});

test('Équipes & managers : entité de chaque équipe, alerte « Équipes sans entité »', async () => {
  const { db, personne } = await base();
  await db.run(`UPDATE equipes SET entite = NULL WHERE nom = 'Commercial'`);
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Equipes));
  render(b.element);
  const alerte = screen.getByRole('heading', { name: 'Équipes sans entité' }).closest('section')!;
  assert.match(alerte.textContent!, /Commercial/);
  assert.ok(screen.getAllByText(/^Entreprise/).length > 0);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rattachement' })); });
  assert.equal((b.trace.ouverts.at(-1) as { type: string }).type, 'equipeRattachement');
});
