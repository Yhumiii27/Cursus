// Dialogue de correction d'une ligne du plan (lot 12, chantier C4, étape 2) sous node --test (tests/outils/rendu.ts) :
// coût proposé d'après le tarif en vigueur de l'organisme (unité « par jour » : multiplié par les journées du catalogue),
// organisme prévu remis au catalogue quand la formation change (ce que montre l'écran est ce qui est enregistré).
// Jeu de démonstration au 10 octobre 2026 : ligne 11 du plan (FCO, 35 h, prévue en T4, 2 personnes, 1 800 €), catalogue
// FCO chez la fiche 1 ; SST (7 h) chez la fiche 3.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { PlanLigneDialog } = await import('../client/src/dialogs/PlanLigneDialog.tsx');

afterEach(() => cleanup());

const FCO = 11;

test('tarif « par jour » : coût proposé pour les journées du catalogue, repris par « Reprendre ce coût »', async () => {
  const { db, personne } = await baseDemo();
  await db.insert('organismeTarifs', {
    organismeId: 1, formation: 'fco', libelle: null, modalite: 'inter', unite: 'jour', montantHt: 400, valableDu: '2026-01-01', valableAu: null, archive: null,
    creeLe: null, creePar: null,
  });
  const gest = await personne(14, 'rh');
  const m = await monter(db, gest, () => createElement(PlanLigneDialog, { id: FCO }));
  render(m.element);
  // 35 h : 5 journées de 7 h, soit 2 000 € (et non le prix d'une journée).
  assert.match(document.body.textContent!, /Tarif en vigueur : 400\s€ par jour, soit 2\s000\s€\./);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reprendre ce coût' })); });
  assert.equal((screen.getByLabelText(/Coût prévu/) as HTMLInputElement).value, '2000');
  fireEvent.change(screen.getByLabelText(/Motif de la correction/), { target: { value: 'Tarif 2026' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la correction' })); });
  assert.equal(m.trace.actions.at(-1)!.r.ok, true);
  assert.equal((await db.one<{ cout: number }>('SELECT cout FROM plan_actions WHERE id = ?', [FCO]))!.cout, 2000);
});

test('organisme prévu propre : une autre formation remet le sélecteur au catalogue, et le serveur enregistre la même chose', async () => {
  const { db, personne } = await baseDemo();
  const gest = await personne(14, 'rh');
  const socotec = (await db.one<{ id: number }>(`SELECT id FROM organismes WHERE code = 'SOCOTEC'`))!.id;
  await db.tx(async () => await ACTIONS['plan.modifier'](makeCtx(db, gest, await loadFull(db, gest)), { id: FCO, organismeId: socotec, motif: 'Prestataire' }));
  const m = await monter(db, gest, () => createElement(PlanLigneDialog, { id: FCO }));
  render(m.element);
  const choix = () => (screen.getByLabelText(/Organisme prévu/) as HTMLSelectElement).value;
  assert.equal(choix(), String(socotec));
  fireEvent.change(screen.getByLabelText(/^Formation/), { target: { value: 'sst' } });
  assert.equal(choix(), '', 'le sélecteur montre l’organisme du catalogue de la nouvelle formation');
  fireEvent.change(screen.getByLabelText(/Motif de la correction/), { target: { value: 'Autre formation' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la correction' })); });
  const envoi = m.trace.actions.at(-1)!;
  assert.equal(envoi.r.ok, true, envoi.r.error);
  assert.equal(envoi.payload.organismeId, '', 'le choix affiché est envoyé avec la nouvelle formation');
  assert.deepEqual({ ...(await db.one('SELECT f, organisme_id FROM plan_actions WHERE id = ?', [FCO])) }, { f: 'sst', organisme_id: null });
});
