// Rendu de sa propre fiche dans l'espace RH (lot 8, chantier C, étape 2) sous node --test (tests/outils/rendu.ts,
// tests/outils/banc-client.ts) : les boutons que le serveur refuse pour soi-même (certification, délivrance, levée et
// retrait d'une habilitation, suivi médical, décision sur sa propre demande) sont remplacés par l'explication de
// shared/rules/soi-meme.ts ; se suspendre reste proposé ; « Modifier ma fiche » n'ouvre que l'adresse e-mail et les jours non
// travaillés (SOI_MEME_FIELDS), et l'envoi est accepté par le serveur. Sur la fiche d'un autre salarié, rien ne change.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { Collaborateurs } = await import('../client/src/pages/Collaborateurs.tsx');
const { Dashboard } = await import('../client/src/pages/Dashboard.tsx');
const { FichePropreDialog } = await import('../client/src/dialogs/FichePropreDialog.tsx');
const { AIDE_SOI_MEME, fichePropre } = await import('../shared/rules/soi-meme.ts');
const { api, definirEspaceOnglet } = await import('../client/src/api.ts');

// Historique de la fiche (journal lu par fetch) : une page vide, sans serveur ; en-tête d'espace de chaque appel noté.
const fetchAvant = globalThis.fetch;
const espaces: (string | null)[] = [];
before(() => {
  globalThis.fetch = (async (_u: string, o?: { headers?: Record<string, string> }) => {
    espaces.push(o?.headers?.['x-cursus-espace'] ?? null);
    return new Response(JSON.stringify({ lignes: [], total: 0, page: 1, taille: 5 }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = fetchAvant; });
afterEach(() => cleanup());

// Sarah Cohen (23) : référente HSE / formation ; Antoine Leroy (14) : gestionnaire RH ; tous deux rattachés à leur fiche.
const SARAH = 23, ANTOINE = 14;
const bouton = (nom: string | RegExp) => screen.queryByRole('button', { name: nom });

test('règle partagée : sa propre fiche, dans l’espace RH seulement', () => {
  assert.equal(fichePropre({ role: 'rh', salarieId: 14 }, 14), true);
  assert.equal(fichePropre({ role: 'rh', salarieId: 14 }, 2), false);
  assert.equal(fichePropre({ role: 'rh', salarieId: null }, 14), false, 'compte RH sans fiche (administratrice de la démonstration)');
  assert.equal(fichePropre({ role: 'collaborateur', salarieId: 14 }, 14), false, 'espace collaborateur : ses propres écrans');
});

test('fiche de la référente HSE : ni certification, ni levée ni retrait ; se suspendre reste proposé', async () => {
  const { db, personne } = await baseDemo();
  const sarah = await personne(SARAH, 'rh');
  const b = await monter(db, sarah, () => createElement(Collaborateurs), { selectedId: SARAH });
  render(b.element);
  assert.equal(bouton('Ajouter une certification'), null);
  assert.ok(bouton('Suspendre'), 'se suspendre : permis');
  assert.equal(bouton('Retirer'), null);
  assert.ok(screen.getByText(AIDE_SOI_MEME.titres));
  cleanup();
  // Fiche d'un autre salarié (Mehdi Benali, habilitation travail en hauteur) : les boutons restent.
  const autre = await monter(db, sarah, () => createElement(Collaborateurs), { selectedId: 2 });
  render(autre.element);
  assert.ok(bouton('Ajouter une certification'));
  assert.equal(screen.queryByText(AIDE_SOI_MEME.titres), null);
});

test('fiche du gestionnaire RH : suivi médical tenu par un autre ; « Modifier ma fiche » : e-mail et jours non travaillés seulement', async () => {
  const { db, personne } = await baseDemo();
  const antoine = await personne(ANTOINE, 'rh');
  const b = await monter(db, antoine, () => createElement(Collaborateurs), { selectedId: ANTOINE });
  render(b.element);
  assert.equal(bouton('Avis du médecin du travail'), null);
  assert.equal(bouton('Type de suivi'), null);
  assert.ok(screen.getByText(AIDE_SOI_MEME.medical));
  cleanup();
  const autre = await monter(db, antoine, () => createElement(Collaborateurs), { selectedId: 2 });
  render(autre.element);
  assert.ok(bouton('Avis du médecin du travail'));
  cleanup();

  // « Modifier la fiche » sur sa propre fiche ouvre ce dialogue (EmployeDialog).
  const fiche = autre.donnees().employes.find(e => e.id === ANTOINE)!;
  const dlg = await monter(db, antoine, () => createElement(FichePropreDialog, { emp: fiche }));
  render(dlg.element);
  assert.ok(screen.getByText(AIDE_SOI_MEME.fiche));
  assert.equal(screen.queryByLabelText('Nature du contrat'), null, 'contrat en lecture seule');
  assert.equal(screen.queryByLabelText(/Matricule de paie/), null);
  // Adresse invalide : signalée à l'envoi, rien ne part ; bouton jamais grisé.
  fireEvent.change(screen.getByLabelText('Adresse e-mail professionnelle'), { target: { value: 'pas une adresse' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(dlg.trace.actions.length, 0);
  assert.ok(screen.getByText(/e-mail/, { selector: 'p.bloquant' }));
  fireEvent.change(screen.getByLabelText('Adresse e-mail professionnelle'), { target: { value: 'a.leroy@entreprise.example' } });
  const enregistrer = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement;
  assert.equal(enregistrer.disabled, false);
  await act(async () => { fireEvent.click(enregistrer); });
  assert.equal(dlg.trace.actions.length, 1, JSON.stringify(dlg.trace));
  const [a] = dlg.trace.actions;
  assert.equal(a.r.ok, true, a.r.error);
  assert.deepEqual(Object.keys(a.payload).sort(), ['avant', 'email', 'id'], 'seul le champ permis part');
  assert.equal(dlg.donnees().employes.find(e => e.id === ANTOINE)!.email, 'a.leroy@entreprise.example');
});

test('tableau de bord : sa propre demande de formation n’offre ni « Accepter » ni « Refuser »', async () => {
  const { db, personne } = await baseDemo();
  await db.insert('demandesCollab', { empId: SARAH, type: 'formation', f: 'sst', motif: 'Recyclage', date: '2026-10-05', statut: 'attente' });
  const b = await monter(db, await personne(SARAH, 'rh'), () => createElement(Dashboard));
  render(b.element);
  const ligne = screen.getByText(AIDE_SOI_MEME.demande).closest('tr')!;
  assert.match(ligne.textContent!, /Sarah Cohen/);
  assert.equal(ligne.querySelector('button.btn-secondary'), null, 'pas d’« Accepter » sur sa propre demande');
  assert.ok(screen.getAllByRole('button', { name: 'Accepter' }).length > 0, 'les demandes des autres restent à décider');
});

test('lecture du journal et téléchargements : l’en-tête d’espace de l’onglet part avec l’appel (lot 8, S8)', async () => {
  const urlAvant = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:essai';
  try {
    definirEspaceOnglet('rh');
    espaces.length = 0;
    await api.journal({ vue: 'archive' });
    await api.donneesSalarie(2);
    await api.fichierLotPaie(1);
    assert.deepEqual(espaces, ['rh', 'rh', 'rh']);
    // Sans session (avant la connexion) : aucun en-tête.
    definirEspaceOnglet(undefined);
    await api.journal();
    assert.equal(espaces.at(-1), null);
  } finally {
    URL.createObjectURL = urlAvant;
  }
});
