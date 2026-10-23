// Rendu du Passeport de prévention (lot 7, t066) sous node --test (tests/outils/rendu.ts) : panneau de l'écran Formations
// (lignes à déclarer de l'année, déjà déclarées, export et marque) pour le service RH et la lecture seule ; dialogue
// « Marquer déclarées » (formulaire, jour contrôlé, vraie action du serveur) ; case du catalogue dans le dialogue d'une
// formation ; colonnes de l'export dans Paramètres.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { PasseportPrevention } = await import('../client/src/components/PasseportPrevention.tsx');
const { PasseportDeclarerDialog } = await import('../client/src/dialogs/PasseportDeclarerDialog.tsx');
const { RefFormationDialog } = await import('../client/src/dialogs/RefFormationDialog.tsx');
const { PasseportPrevention: SectionPasseport } = await import('../client/src/pages/parametres/PasseportPrevention.tsx');

afterEach(() => cleanup());

test('panneau du Passeport de prévention : lignes à déclarer de l’année, marque proposée, déjà déclarées et retrait', async () => {
  const { db, personne } = await baseDemo();
  const sst = ((await db.one(`SELECT id FROM certifications WHERE emp_id = 17 AND f = 'sst'`)) as { id: number }).id;
  await db.insert('declarationsPasseport', { empId: 17, certId: sst, suivieId: null, declareLe: '2026-10-01', le: '2026-10-01', auteur: 'Sarah Cohen', auteurId: 23 });
  const b = await monter(db, await personne(null, 'rh'), () => createElement(PasseportPrevention));
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Passeport de prévention' }));
  assert.match(document.body.textContent!, /\d+ lignes à déclarer · 1 déjà déclarée en 2026 · 9 formations marquées au catalogue/);
  assert.match(document.body.textContent!, /Format à confirmer sur la plateforme/);
  assert.equal(screen.queryByText('Fatou Ndiaye'), null, 'ligne déclarée : plus proposée');
  assert.ok(screen.getAllByText('Intérimaire : voir avec l’agence').length > 0);
  assert.ok(screen.getByRole('button', { name: 'Exporter (CSV)' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Marquer déclarées/ })); });
  const d = b.trace.ouverts[0] as { type: string; cles: string[]; du: string; au: string };
  assert.deepEqual([d.type, d.du, d.au], ['passeportDeclarer', '2026-01-01', '2026-10-10']);
  assert.ok(d.cles.length > 5 && !d.cles.includes(`cert:${sst}`));
  // Déjà déclarées : la date et le retrait de la marque (confirmé).
  await act(async () => { fireEvent.click(screen.getByLabelText('Déjà déclarées')); });
  const ligne = screen.getByText('Fatou Ndiaye').closest('tr')!;
  assert.ok(within(ligne).getByText(/Déclarée le 1 oct/));
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' })); });
  const c = b.trace.ouverts[1] as { type: string; c: { action: string; payload: unknown } };
  assert.deepEqual([c.type, c.c.action, c.c.payload], ['confirmer', 'passeport.retirer', { cle: `cert:${sst}` }]);
  // Année précédente : d'autres lignes, aucune déclarée.
  await act(async () => { fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2025' } }); });
  assert.match(document.body.textContent!, /Aucune ligne déclarée en 2025/);
});

test('lecture seule : consultation sans export ni marque ; paie : rien', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(11, 'rh'), () => createElement(PasseportPrevention));
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Passeport de prévention' }));
  assert.equal(screen.queryByRole('button', { name: 'Exporter (CSV)' }), null);
  assert.equal(screen.queryByRole('button', { name: /Marquer déclarées/ }), null);
  cleanup();
  const p = await monter(db, await personne(7, 'rh'), () => createElement(PasseportPrevention));
  render(p.element);
  assert.equal(screen.queryByRole('heading', { name: 'Passeport de prévention' }), null);
});

test('dialogue « Marquer déclarées » : jour contrôlé (à venir refusé), puis lignes marquées par le serveur', async () => {
  const { db, personne } = await baseDemo();
  const cle = `cert:${((await db.one(`SELECT id FROM certifications WHERE emp_id = 17 AND f = 'sst'`)) as { id: number }).id}`;
  const b = await monter(db, await personne(23, 'rh'), () => createElement(PasseportDeclarerDialog, { cles: [cle, 'cert:999999'], du: '2026-01-01', au: '2026-10-10' }));
  render(b.element);
  assert.match(document.body.textContent!, /1 ligne \(1 salarié\) du 1 janv\. 2026 au 10 oct\. 2026/);
  const jour = screen.getByLabelText(/Déclarées sur la plateforme le/) as HTMLInputElement;
  assert.equal(jour.value, '2026-10-10');
  await act(async () => { fireEvent.change(jour, { target: { value: '2026-10-11' } }); });
  const bouton = screen.getByRole('button', { name: 'Marquer déclarées' }) as HTMLButtonElement;
  assert.equal(bouton.disabled, false, 'jamais grisé : validation explicite');
  await act(async () => { fireEvent.click(bouton); });
  assert.equal(b.trace.actions.length, 0);
  assert.ok(screen.getByText(/ne peut pas être datée d’un jour à venir/));
  await act(async () => { fireEvent.change(jour, { target: { value: '2026-03-01' } }); });
  assert.ok(screen.getByText(/se termine le 1 avr\. 2026/));
  await act(async () => { fireEvent.change(jour, { target: { value: '2026-10-09' } }); });
  await act(async () => { fireEvent.click(bouton); });
  assert.deepEqual(b.trace.actions[0].payload, { cles: [cle], le: '2026-10-09' });
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.trace.fermetures, 1);
  assert.equal(b.donnees().declarationsPasseport!.length, 1);
  // Rouvert alors que tout est marqué : rien à enregistrer.
  cleanup();
  const encore = await monter(db, await personne(23, 'rh'), () => createElement(PasseportDeclarerDialog, { cles: [cle], du: '2026-01-01', au: '2026-10-10' }));
  render(encore.element);
  assert.ok(screen.getByText(/Plus aucune de ces lignes n’est à déclarer/));
  assert.equal(screen.queryByRole('button', { name: 'Marquer déclarées' }), null);
});

test('catalogue : case « Passeport de prévention » du dialogue d’une formation, enregistrée par le serveur', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(23, 'rh'), () => createElement(RefFormationDialog, { id: 'fco' }));
  render(b.element);
  const caseP = screen.getByRole('checkbox', { name: /Passeport de prévention/ }) as HTMLInputElement;
  assert.equal(caseP.checked, false, 'FCO : non marquée');
  fireEvent.click(caseP);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(b.trace.actions[0].name, 'referentiel.formation.enregistrer');
  assert.equal((b.trace.actions[0].payload as { passeportPrevention: boolean }).passeportPrevention, true);
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.donnees().referentiels.formations.find(f => f.id === 'fco')!.passeportPrevention, true);
  cleanup();
  // Nouvelle formation santé-sécurité : proposée, jamais cochée d'office.
  const n = await monter(db, await personne(23, 'rh'), () => createElement(RefFormationDialog, {}));
  render(n.element);
  await act(async () => { fireEvent.change(screen.getByLabelText(/Intitulé/), { target: { value: 'Sauveteur secouriste — recyclage' } }); });
  assert.equal((screen.getByRole('checkbox', { name: /Passeport de prévention/ }) as HTMLInputElement).checked, false);
  assert.match(document.body.textContent!, /formation santé-sécurité : à cocher \?/);
});

test('Paramètres : colonnes de l’export, la dernière ne se décoche pas ; consultation hors administrateur', async () => {
  const { db, personne } = await baseDemo();
  const admin = await personne(null, 'rh');
  const b = await monter(db, admin, () => createElement(SectionPasseport, { s: { passeportColonnes: ['nom'] } as never, envois: {} as never }));
  render(b.element);
  assert.ok(screen.getByText(/Format à confirmer sur la plateforme/));
  assert.equal((screen.getByRole('checkbox', { name: /^Nom$/ }) as HTMLInputElement).disabled, true, 'dernière colonne');
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /^NIR/ })); });
  assert.deepEqual(b.trace.actions.at(-1)!.payload, { passeportColonnes: ['nom', 'nir'] });
  assert.equal(b.trace.actions.at(-1)!.r.ok, true, b.trace.actions.at(-1)!.r.error);
  cleanup();
  const g = await monter(db, await personne(14, 'rh'), () => createElement(SectionPasseport, { s: { passeportColonnes: ['nom', 'prenom'] } as never, envois: {} as never }));
  render(g.element);
  assert.equal((screen.getByRole('checkbox', { name: /^Prénom/ }) as HTMLInputElement).disabled, true, 'gestionnaire RH : consultation');
});
