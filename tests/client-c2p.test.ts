// Rendu des écrans du compte professionnel de prévention (lot 7, t052) sous node --test (tests/outils/rendu.ts) : écran
// Expositions (C2P) du service RH avec des nuits comptées, horaire à qualifier et export ; facteurs d'un poste cochés par
// le référent HSE (dialogue en formulaire, vraie action du serveur) ; qualification d'un horaire dans Référentiels, archivé
// compris.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { Prevention } = await import('../client/src/pages/Prevention.tsx');
const { RefPosteC2pDialog } = await import('../client/src/dialogs/RefPosteC2pDialog.tsx');
const { Horaires } = await import('../client/src/pages/ReferentielsHoraires.tsx');

afterEach(() => cleanup());

const N = { code: 'N', debut: '21:00', fin: '05:00', pause: 30 };
/** 24 semaines de nuits validées de Julien Moreau (Production), à partir du 5 janvier 2026 : 120 nuits. */
async function nuits(db: Awaited<ReturnType<typeof baseDemo>>['db']) {
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2026, 0, 5 + 7 * i));
    await db.insert('feuilles', {
      empId: 8, week: d.toISOString().slice(0, 10), statut: 'validee', comment: null, sage: false, keystone: false,
      lignes: [{ projet: 'INT-PROD', tache: 'Production', ks: false, h: [7.5, 7.5, 7.5, 7.5, 7.5, 0, 0] }],
      horairesFiges: [N, N, N, N, N, null, null],
    });
  }
}

test('écran Expositions (C2P) : salarié exposé au travail de nuit, horaire à qualifier, export pour la DSN', async () => {
  const { db, personne } = await baseDemo();
  await nuits(db);
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Prevention));
  render(b.element);
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Expositions (C2P)' }));
  const ligne = screen.getByText('Julien Moreau').closest('tr')!;
  assert.ok(within(ligne).getByText('120 / 120'));
  assert.ok(within(ligne).getByText('Exposé'));
  assert.ok(within(ligne).getByText(/120 nuits sous un horaire à qualifier/));
  assert.match(document.body.textContent!, /1 horaire de nuit à qualifier.*: N\./);
  assert.ok(screen.getByRole('button', { name: 'Exporter pour la DSN (CSV)' }));
  // Tous les salariés : ceux sans exposition apparaissent aussi.
  const avant = document.querySelectorAll('tbody tr').length;
  await act(async () => { fireEvent.click(screen.getByLabelText('Tous')); });
  assert.ok(document.querySelectorAll('tbody tr').length > avant);
  // Année précédente : rien à déclarer, pas d'export.
  await act(async () => { fireEvent.click(screen.getByLabelText('2025')); });
  assert.equal(screen.queryByRole('button', { name: 'Exporter pour la DSN (CSV)' }), null);
});

test('facteurs d’un poste : le référent HSE coche le bruit, enregistré par le serveur', async () => {
  const { db, personne } = await baseDemo();
  const id = ((await db.one(`SELECT id FROM postes WHERE nom = 'Cariste'`)) as { id: number }).id;
  const b = await monter(db, await personne(23, 'rh'), () => createElement(RefPosteC2pDialog, { id }));
  render(b.element);
  const bruit = screen.getByRole('checkbox', { name: /Bruit/ }) as HTMLInputElement;
  assert.equal(bruit.checked, false, 'décoché par défaut');
  fireEvent.click(bruit);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(b.trace.actions[0].name, 'referentiel.poste.expositions');
  assert.deepEqual(b.trace.actions[0].payload, { id, facteurs: ['bruit'] });
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.trace.fermetures, 1);
  assert.deepEqual(b.donnees().referentiels.postes.find(p => p.id === id)!.c2p, ['bruit']);
});

test('qualification d’un horaire de nuit dans Référentiels → Horaires ; la lecture seule la consulte', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(23, 'rh'), () => createElement(Horaires));
  render(b.element);
  const choix = screen.getByLabelText(/Horaire N : équipes successives alternantes/) as HTMLSelectElement;
  assert.equal(choix.value, '');
  assert.equal(screen.queryByLabelText(/Horaire J : équipes/), null, 'horaire de jour : rien à qualifier');
  await act(async () => { fireEvent.change(choix, { target: { value: 'oui' } }); });
  assert.deepEqual(b.trace.actions[0].payload, { id: 'N', alternant: true });
  assert.equal(b.donnees().referentiels.horaires!.find(h => h.code === 'N')!.alternant, true);
  cleanup();
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(Horaires));
  render(lect.element);
  assert.equal(screen.queryByLabelText(/Horaire N : équipes/), null);
  assert.ok(screen.getByText('Équipes successives alternantes'));
});

test('horaire de nuit archivé : le référent HSE le qualifie encore (ses nuits de l’année restent comptées)', async () => {
  const { db, personne } = await baseDemo();
  await db.update('horaires', 'N', { archive: '2026-10-01' });
  const b = await monter(db, await personne(23, 'rh'), () => createElement(Horaires));
  render(b.element);
  await act(async () => { fireEvent.click(screen.getByLabelText('Afficher les archivés')); });
  const choix = screen.getByLabelText(/Horaire N : équipes successives alternantes/) as HTMLSelectElement;
  await act(async () => { fireEvent.change(choix, { target: { value: 'oui' } }); });
  assert.deepEqual(b.trace.actions[0].payload, { id: 'N', alternant: true });
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.donnees().referentiels.horaires!.find(h => h.code === 'N')!.alternant, true);
});
