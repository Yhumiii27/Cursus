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
  // Sans export depuis l'ouverture de l'écran : le dialogue ne coche rien d'office.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Marquer déclarées/ })); });
  const d = b.trace.ouverts[0] as { type: string; exportees: string[] | null; du: string; au: string };
  assert.deepEqual([d.type, d.du, d.au, d.exportees], ['passeportDeclarer', '2026-01-01', '2026-10-10', null]);
  // Export des lignes à déclarer : le serveur renvoie les clés exportées, que le dialogue reçoit ensuite.
  const urls: string[] = [];
  const fetchAvant = globalThis.fetch, urlAvant = URL.createObjectURL;
  globalThis.fetch = (async (u: string) => {
    urls.push(String(u));
    return new Response('Nom\r\n', { headers: { 'content-disposition': 'attachment; filename="p.csv"', 'X-Passeport-Lignes': 'cert:1,suivie:2', 'X-Passeport-Nombre': '2', 'X-Passeport-Interimaires': '3' } });
  }) as typeof fetch;
  URL.createObjectURL = () => 'blob:essai';
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' })); });
    assert.match(urls[0], /du=2026-01-01&au=2026-10-10&vue=a-declarer$/);
    assert.match(b.trace.messages.at(-1)!.text, /2 lignes exportées \(3 lignes d’intérimaires écartées : déclarées par l’agence\)/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Marquer déclarées/ })); });
    assert.deepEqual((b.trace.ouverts[1] as { exportees: string[] }).exportees, ['cert:1', 'suivie:2']);
    // Déjà déclarées : l'export ne demande que celles-là.
    await act(async () => { fireEvent.click(screen.getByLabelText('Déjà déclarées')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' })); });
    assert.match(urls[1], /vue=declarees$/);
  } finally {
    globalThis.fetch = fetchAvant;
    URL.createObjectURL = urlAvant;
  }
  // Déjà déclarées : la date et le retrait de la marque (confirmé).
  const ligne = screen.getByText('Fatou Ndiaye').closest('tr')!;
  assert.ok(within(ligne).getByText(/Déclarée le 1 oct/));
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' })); });
  const c = b.trace.ouverts[2] as { type: string; c: { action: string; payload: unknown } };
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

test('dialogue « Marquer déclarées » : lignes de l’export seules cochées, jour contrôlé, puis lignes marquées par le serveur', async () => {
  const { db, personne } = await baseDemo();
  const cle = `cert:${((await db.one(`SELECT id FROM certifications WHERE emp_id = 17 AND f = 'sst'`)) as { id: number }).id}`;
  // Export fait depuis l'écran : la seule ligne de Fatou Ndiaye ; une ligne saisie depuis (ou absente du fichier) n'est
  // pas cochée.
  const b = await monter(db, await personne(23, 'rh'), () => createElement(PasseportDeclarerDialog, { du: '2026-01-01', au: '2026-10-10', exportees: [cle, 'cert:999999'] }));
  render(b.element);
  const cases = within(screen.getByRole('group', { name: 'Lignes déclarées' })).getAllByRole('checkbox') as HTMLInputElement[];
  assert.ok(cases.length > 5);
  assert.equal(cases.filter(c => c.checked).length, 1, 'la seule ligne de l’export');
  assert.ok(screen.getAllByText('Absente de l’export').length === cases.length - 1);
  assert.match(document.body.textContent!, /1 ligne cochée \(1 salarié\) sur \d+ lignes à déclarer du 1 janv\. 2026 au 10 oct\. 2026/);
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
  // Tout décoché : refusé, message explicite.
  await act(async () => { fireEvent.change(jour, { target: { value: '2026-10-09' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' })); });
  await act(async () => { fireEvent.click(bouton); });
  assert.equal(b.trace.actions.length, 0);
  assert.ok(screen.getByText('Cochez les lignes acceptées par la plateforme.'));
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Fatou Ndiaye — Sauveteur secouriste du travail/ })); });
  await act(async () => { fireEvent.click(bouton); });
  assert.deepEqual(b.trace.actions[0].payload, { cles: [cle], le: '2026-10-09' });
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.trace.fermetures, 1);
  assert.equal(b.donnees().declarationsPasseport!.length, 1);
  cleanup();
  // Sans export connu (écran rechargé) : rien n'est coché d'office.
  const sans = await monter(db, await personne(23, 'rh'), () => createElement(PasseportDeclarerDialog, { du: '2026-01-01', au: '2026-10-10', exportees: null }));
  render(sans.element);
  assert.ok(screen.getByText(/Aucun export depuis l’ouverture de l’écran/));
  assert.ok((within(screen.getByRole('group', { name: 'Lignes déclarées' })).getAllByRole('checkbox') as HTMLInputElement[]).every(c => !c.checked));
  cleanup();
  // Plus rien à déclarer sur la période : rien à enregistrer.
  const vide = await monter(db, await personne(23, 'rh'), () => createElement(PasseportDeclarerDialog, { du: '2026-04-01', au: '2026-04-01', exportees: [cle] }));
  render(vide.element);
  assert.ok(screen.getByText(/Plus aucune ligne n’est à déclarer/));
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
