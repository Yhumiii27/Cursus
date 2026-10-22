// Rendu des dialogues et des écrans critiques du client (t159, étape 2), sous node --test : DOM de happy-dom, .tsx
// compilés à la volée, Testing Library (tests/outils/rendu.ts), base de démonstration en mémoire dont les vraies actions
// répondent au dialogue (tests/outils/banc-client.ts). Chaque test vérifie ce que voit la personne (libellés, erreurs
// sous les champs, bouton jamais grisé pour une saisie incomplète) et ce qui part au serveur.
// Parcours : feuille de temps (saisie et soumission), demande et validation de congé, refus avec motif obligatoire
// (dialogue « confirmer »), réouverture d'une feuille par l'administrateur RH (motif obligatoire), sortie d'un salarié,
// inscription à une session.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { ConfirmerDialog } = await import('../client/src/dialogs/ConfirmerDialog.tsx');
const { AbsDialog } = await import('../client/src/dialogs/AbsDialog.tsx');
const { RouvrirFeuilleDialog } = await import('../client/src/dialogs/RouvrirFeuilleDialog.tsx');
const { SortieDialog } = await import('../client/src/dialogs/SortieDialog.tsx');
const { PlanDialog } = await import('../client/src/dialogs/PlanDialog.tsx');
const { Temps } = await import('../client/src/pages/Temps.tsx');
const { Absences } = await import('../client/src/pages/Absences.tsx');
const { refusAbsence } = await import('../client/src/state/confirmations.ts');

afterEach(() => cleanup());

/** Envoi du formulaire par son bouton principal, puis attente des réponses (actions asynchrones). */
async function cliquer(nom: string | RegExp) {
  const b = screen.getByRole('button', { name: nom });
  assert.equal((b as HTMLButtonElement).disabled, false, `« ${b.textContent} » ne doit pas être grisé`);
  await act(async () => { fireEvent.click(b); });
}
const saisir = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const erreurDe = (champ: HTMLElement) => {
  const id = champ.getAttribute('aria-describedby');
  return id ? document.getElementById(id.split(' ').pop()!)?.textContent ?? null : null;
};

test('refus d’un congé (dialogue « confirmer ») : motif obligatoire, puis refus enregistré avec son motif', async () => {
  const { db, personne } = await baseDemo();
  const karim = await personne(12, 'manager');
  const b = await monter(db, karim, () => createElement(ConfirmerDialog, { c: refusAbsence({ id: 5 }, 'Mehdi Benali', 'CP du 2 novembre') }));
  render(b.element);
  const motif = screen.getByLabelText(/Motif du refus/);
  assert.equal(motif.getAttribute('aria-required'), 'true');
  // Envoi sans motif : l'erreur s'affiche sous le champ, rien ne part.
  await cliquer('Refuser la demande');
  assert.equal(erreurDe(motif), 'Indiquez le motif du refus.');
  assert.equal(motif.getAttribute('aria-invalid'), 'true');
  assert.equal(b.trace.actions.length, 0);
  // Avec un motif : le serveur enregistre le refus, le dialogue se ferme.
  saisir(motif, '  Période de forte activité  ');
  await cliquer('Refuser la demande');
  assert.equal(b.trace.actions.length, 1);
  const [a] = b.trace.actions;
  assert.equal(a.name, 'absence.decider');
  assert.deepEqual(a.payload, { id: 5, ok: false, motif: 'Période de forte activité' });
  assert.equal(a.r.ok, true, a.r.error);
  assert.equal(b.trace.fermetures, 1);
  const abs = b.donnees().absences.find(x => x.id === 5)!;
  assert.equal(abs.statut, 'refusee');
});

test('refus refusé par le serveur : le dialogue reste ouvert avec le motif saisi', async () => {
  const { db, personne } = await baseDemo();
  // Absence d'une autre équipe (Logistique) : le manager de la Maintenance n'en décide pas.
  const b = await monter(db, await personne(12, 'manager'), () => createElement(ConfirmerDialog, { c: refusAbsence({ id: 3 }, 'Camille Roux', 'CP') }));
  render(b.element);
  saisir(screen.getByLabelText(/Motif du refus/), 'Effectif minimum');
  await cliquer('Refuser la demande');
  assert.equal(b.trace.actions.length, 1);
  assert.equal(b.trace.actions[0].r.ok, false);
  assert.equal(b.trace.fermetures, 0, 'dialogue gardé ouvert');
  assert.equal((screen.getByLabelText(/Motif du refus/) as HTMLTextAreaElement).value, 'Effectif minimum');
  assert.equal(b.trace.messages.at(-1)?.error, true);
});

test('demande de congé par le collaborateur : dates obligatoires, puis demande envoyée au manager', async () => {
  const { db, personne } = await baseDemo();
  const mehdi = await personne(2, 'collaborateur');
  const b = await monter(db, mehdi, () => createElement(AbsDialog, { empId: 2 }));
  render(b.element);
  // Bouton actif dès l'ouverture ; l'envoi incomplet signale les deux dates.
  await cliquer('Envoyer la demande');
  assert.equal(erreurDe(screen.getByLabelText(/^Du/)), 'Indiquez le premier jour d’absence.');
  assert.equal(b.trace.actions.length, 0);
  // Le premier jour remplit le dernier ; une journée seule propose la demi-journée.
  saisir(screen.getByLabelText(/^Du/), '2026-11-16');
  assert.equal((screen.getByLabelText(/^Au/) as HTMLInputElement).value, '2026-11-16');
  saisir(screen.getByLabelText(/^Durée/), 'matin');
  await cliquer('Envoyer la demande');
  const [a] = b.trace.actions;
  assert.equal(a.name, 'absence.demander');
  assert.equal(a.r.ok, true, a.r.error);
  assert.deepEqual({ du: a.payload.du, au: a.payload.au, debutDemi: a.payload.debutDemi }, { du: '2026-11-16', au: '2026-11-16', debutDemi: 'matin' });
  assert.equal(b.trace.fermetures, 1);
  const cree = b.donnees().absences.find(x => x.empId === 2 && x.du === '2026-11-16')!;
  assert.equal(cree.statut, 'demandee');
});

test('congé posé par le manager pour son équipe : « Poser et valider », absence validée d’emblée', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(12, 'manager'), () => createElement(AbsDialog, { empId: 18 }));
  render(b.element);
  saisir(screen.getByLabelText(/^Du/), '2026-11-23');
  saisir(screen.getByLabelText(/^Au/), '2026-11-24');
  await cliquer('Poser et valider');
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.donnees().absences.find(x => x.empId === 18 && x.du === '2026-11-23')?.statut, 'validee');
});

test('validation d’un congé par le manager depuis l’écran Congés & absences, refus par le dialogue « confirmer »', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(12, 'manager'), () => createElement(Absences));
  render(b.element);
  // Demandes en attente de l'équipe : Mehdi Benali (5) et Romain Chevalier (9).
  const ligne = (nom: string) => screen.getAllByRole('row').find(r => r.textContent?.includes(nom) && within(r).queryByRole('button', { name: 'Valider' }))!;
  await act(async () => { fireEvent.click(within(ligne('Mehdi Benali')).getByRole('button', { name: 'Valider' })); });
  await waitFor(() => assert.equal(b.trace.actions.length, 1));
  assert.deepEqual(b.trace.actions[0].payload, { id: 5, ok: true });
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.equal(b.donnees().absences.find(x => x.id === 5)?.statut, 'validee');
  // Refus : jamais en un clic, le dialogue « confirmer » s'ouvre avec le motif obligatoire.
  fireEvent.click(within(ligne('Romain Chevalier')).getByRole('button', { name: 'Refuser' }));
  assert.equal(b.trace.actions.length, 1, 'rien n’est envoyé avant la confirmation');
  const ouvert = b.trace.ouverts.at(-1);
  assert.equal(ouvert?.type, 'confirmer');
  const c = (ouvert as { c: { action: string; payload: unknown; motif?: { requis: boolean } } }).c;
  assert.deepEqual([c.action, c.payload, c.motif?.requis], ['absence.decider', { id: 9, ok: false }, true]);
});

test('feuille de temps : projet ajouté, heures saisies, puis soumission au manager', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(2, 'collaborateur'), () => createElement(Temps), { weekStart: '2026-10-05' });
  render(b.element);
  // Semaine sans heure : la soumission attend une saisie (bouton de page, pas de formulaire).
  assert.equal((screen.getByRole('button', { name: 'Soumettre au manager' }) as HTMLButtonElement).disabled, true);
  const choix = screen.getByLabelText('Ajouter un projet') as HTMLSelectElement;
  const projet = [...choix.options].find(o => o.value)!.value;
  await act(async () => { saisir(choix, projet); });
  await waitFor(() => assert.equal(b.trace.actions.at(-1)?.name, 'temps.addLine'));
  assert.equal(b.trace.actions.at(-1)?.r.ok, true, b.trace.actions.at(-1)?.r.error);
  // Lundi : 7,5 h, enregistrées en quittant la cellule.
  const cellules = await screen.findAllByLabelText(new RegExp(`${projet}.*lundi`, 'i'));
  saisir(cellules[0], '7,5');
  await act(async () => { fireEvent.blur(cellules[0]); });
  const cell = b.trace.actions.find(a => a.name === 'temps.setCell')!;
  assert.equal(cell.r.ok, true, cell.r.error);
  assert.equal(cell.payload.week, '2026-10-05');
  await cliquer('Soumettre au manager');
  const soumis = b.trace.actions.at(-1)!;
  assert.equal(soumis.name, 'temps.submit');
  assert.equal(soumis.r.ok, true, soumis.r.error);
  assert.equal(b.donnees().feuilles.find(f => f.empId === 2 && f.week === '2026-10-05')?.statut, 'soumise');
});

test('réouverture d’une feuille validée : administrateur RH seul, motif obligatoire, feuille renvoyée au salarié', async () => {
  const { db, personne } = await baseDemo();
  // Gestionnaire RH : le dialogue ne s'affiche pas (réservé à l'administrateur RH, comme le serveur).
  const gest = await monter(db, await personne(14, 'rh'), () => createElement(RouvrirFeuilleDialog, { empId: 2, week: '2026-09-28' }));
  const { container } = render(gest.element);
  assert.equal(container.innerHTML, '');
  cleanup();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(RouvrirFeuilleDialog, { empId: 2, week: '2026-09-28' }));
  render(b.element);
  const motif = screen.getByLabelText(/Motif de la réouverture/);
  await cliquer('Rouvrir la feuille');
  assert.ok(erreurDe(motif), 'motif exigé');
  assert.equal(b.trace.actions.length, 0);
  saisir(motif, 'Journée oubliée le jeudi');
  fireEvent.click(screen.getByRole('radio', { name: /Renvoyer au salarié/ }));
  await cliquer('Rouvrir la feuille');
  const [a] = b.trace.actions;
  assert.deepEqual(a.payload, { empId: 2, week: '2026-09-28', motif: 'Journée oubliée le jeudi', renvoyer: true });
  assert.equal(a.r.ok, true, a.r.error);
  // « À corriger » : renvoyée au salarié, motif en commentaire.
  const sh = b.donnees().feuilles.find(f => f.empId === 2 && f.week === '2026-09-28')!;
  assert.equal(sh.statut, 'rejetee');
  assert.equal(sh.reouverture?.motif, 'Journée oubliée le jeudi');
});

test('réouverture d’une feuille déjà transmise à la paie : suites annoncées avant l’envoi (lot correctif)', async () => {
  const { db, personne } = await baseDemo();
  // Semaine du 21 septembre : feuille validée et transmise dans le lot de paie n° 1.
  const b = await monter(db, await personne(null, 'rh'), () => createElement(RouvrirFeuilleDialog, { empId: 2, week: '2026-09-21' }));
  render(b.element);
  assert.ok(screen.getByText(/Validée · transmise à Sage Paie/));
  assert.ok(screen.getByText(/seul l’écart partira dans le prochain lot de paie \(lot correctif\)/));
  saisir(screen.getByLabelText(/Motif de la réouverture/), 'Heures imputées au mauvais projet');
  await cliquer('Rouvrir la feuille');
  const [a] = b.trace.actions;
  assert.equal(a.payload.renvoyer, false, 'par défaut : corrigée par son valideur');
  assert.equal(a.r.ok, true, a.r.error);
  assert.equal(b.donnees().feuilles.find(f => f.empId === 2 && f.week === '2026-09-21')?.statut, 'soumise');
});

test('sortie d’un salarié : date et motif obligatoires (liste fermée), solde des compteurs montré, sortie enregistrée', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(14, 'rh'), () => createElement(SortieDialog, { empId: 8 }));
  render(b.element);
  await cliquer('Enregistrer la sortie');
  assert.equal(erreurDe(screen.getByLabelText(/Dernier jour du contrat/)), 'Indiquez le dernier jour du contrat.');
  assert.equal(erreurDe(screen.getByLabelText(/Motif de sortie/)), 'Choisissez le motif de sortie.');
  assert.equal(b.trace.actions.length, 0);
  saisir(screen.getByLabelText(/Dernier jour du contrat/), '2026-12-31');
  const motif = screen.getByLabelText(/Motif de sortie/) as HTMLSelectElement;
  saisir(motif, [...motif.options].find(o => o.value === 'demission')?.value ?? motif.options[1].value);
  // Solde des compteurs à la date, photographié pour la paie.
  assert.ok(screen.getByText(/^Solde des compteurs au /));
  await cliquer('Enregistrer la sortie');
  const [a] = b.trace.actions;
  assert.equal(a.name, 'employe.sortie');
  assert.equal(a.r.ok, true, a.r.error);
  assert.equal(b.trace.fermetures, 1);
  assert.equal(b.donnees().employes.find(e => e.id === 8)?.fin, '2026-12-31');
});

test('inscription à une session (Planifier un renouvellement) : session à choisir, puis inscription et convocation', async () => {
  const { db, personne } = await baseDemo();
  // Mehdi Benali, travail en hauteur (certification 6) : session du 4 novembre.
  const b = await monter(db, await personne(14, 'rh'), () => createElement(PlanDialog, { empId: 2, certId: 6 }));
  render(b.element);
  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  assert.ok(radios.length >= 1);
  // Session présélectionnée quand il n'y en a qu'une ; sinon le choix est exigé à l'envoi.
  if (!radios.some(r => r.checked)) {
    await cliquer('Confirmer l’inscription');
    assert.ok(screen.getByText('Choisissez une session.'));
    assert.equal(b.trace.actions.length, 0);
    fireEvent.click(radios[0]);
  }
  await cliquer('Confirmer l’inscription');
  const [a] = b.trace.actions;
  assert.equal(a.name, 'plan.inscrire');
  assert.equal(a.payload.conv, 'now');
  assert.equal(a.r.ok, true, a.r.error);
  assert.equal(b.trace.fermetures, 1);
  const cert = b.donnees().employes.find(e => e.id === 2)!.certs.find(c => c.id === 6)!;
  assert.equal(cert.sessionId, a.payload.sessionId);
});
