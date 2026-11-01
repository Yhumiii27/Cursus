// Écrans des dossiers OPCO (lot 11, chantier C4, étape 2) sous node --test (tests/outils/rendu.ts) : onglet « Dossiers
// OPCO » de Plan & budget (indicateurs, retards en tête, filtres, panneau de détail, étapes proposées), colonne OPCO des
// lignes du plan, dialogues (création préremplie, étapes, versement, pièce) avec la vraie action du serveur, consultation
// par la lecture seule (ni motif, ni pièce, ni bouton), échéances de l'écran Échéances, section de Paramètres, exports CSV
// (sans motif), confirmations, adresse de l'écran ; règles d'écran de shared/rules/opco.ts ; familles du journal (une
// seule famille « formations », qui porte 'opco.').
// Jeu de démonstration au 10 octobre 2026 : ligne 1 du plan (SST, Production, réalisée, 1 260 € réels), ligne 11 (FCO,
// Logistique, prévue, 1 800 €). Comptes : administratrice RH (null), gestionnaire RH (14), lecture seule (11).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { REGLAGES } = await import('../shared/reglages.ts');
const { FAMILLES_JOURNAL, familleAction } = await import('../shared/journal.ts');
const R = await import('../shared/rules/opco.ts');
const { Budget } = await import('../client/src/pages/Budget.tsx');
const { OpcoDossierDialog } = await import('../client/src/dialogs/OpcoDossierDialog.tsx');
const { OpcoEtapeDialog } = await import('../client/src/dialogs/OpcoEtapeDialog.tsx');
const { OpcoVersementDialog } = await import('../client/src/dialogs/OpcoVersementDialog.tsx');
const { OpcoPieceDialog } = await import('../client/src/dialogs/OpcoPieceDialog.tsx');
const { EcheancesOpcoPanel } = await import('../client/src/components/opco/EcheancesOpco.tsx');
const { passeFiltre } = await import('../client/src/components/opco/commun.ts');
const { Opco: SectionOpco, BORNES_DELAIS_OPCO, erreurDelaiOpco } = await import('../client/src/pages/parametres/Opco.tsx');
const { csvOpco, csvVersementsOpco } = await import('../client/src/listes-csv.ts');
const { annulationVersementOpco, reouvertureOpco, suppressionDossierOpco } = await import('../client/src/state/confirmations-opco.ts');
const { lireUrl, ecrireUrl } = await import('../client/src/state/url.ts');
const { UI_DEPART } = await import('./outils/banc-client.ts');
const { useStore } = await import('./outils/store-factice.ts');
/** Section de Paramètres avec les réglages de l'instantané en cours (relu après chaque action). */
const Section = () => createElement(SectionOpco, { s: useStore().data!.settings, envois: {} as never });
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type User = Parameters<typeof makeCtx>[1];
type DossierOpco = import('../shared/types.ts').DossierOpco;
type VersementOpco = import('../shared/types.ts').VersementOpco;

afterEach(() => cleanup());

const SST = 1, FCO = 11;

/** Action du serveur, comme POST /api/actions/:nom (sans passer par l'écran). */
async function agir(db: Db, user: User, nom: keyof typeof ACTIONS, payload: Record<string, unknown>) {
  return await db.tx(async () => await ACTIONS[nom](makeCtx(db, user, await loadFull(db, user)), payload));
}

/** Base avec un dossier accordé sur la ligne SST (1 200 € accordés) et un dossier refusé sur la ligne FCO. */
async function avecDossiers() {
  const b = await baseDemo();
  const admin = await b.personne(null, 'rh');
  const a = (await agir(b.db, admin, 'opco.creer', { planActionId: SST, du: '2026-02-10', au: '2026-02-11', montantDemande: '1440', reference: 'OP-12' })) as { result: { id: number } };
  await agir(b.db, admin, 'opco.deposer', { id: a.result.id, de: 'a_deposer', deposeLe: '2026-01-05' });
  await agir(b.db, admin, 'opco.accorder', { id: a.result.id, de: 'depose', accordLe: '2026-01-20', montantAccorde: '1200' });
  const r = (await agir(b.db, admin, 'opco.creer', { planActionId: FCO, du: '2026-11-02', au: '2026-11-06', montantDemande: '1800' })) as { result: { id: number } };
  await agir(b.db, admin, 'opco.deposer', { id: r.result.id, de: 'a_deposer', deposeLe: '2026-10-01' });
  await agir(b.db, admin, 'opco.refuser', { id: r.result.id, de: 'depose', refusLe: '2026-10-05', motif: 'budget_epuise' });
  return { ...b, admin, accorde: a.result.id, refuse: r.result.id };
}

// — Règles d'écran (shared/rules/opco.ts) —

const dossier = (o: Partial<DossierOpco> = {}): DossierOpco => ({
  id: 1, planActionId: 1, empId: null, exercice: 2026, opco: 'opco2i', dispositif: 'plan', statut: 'a_deposer', reference: null, du: null, au: null,
  heures: null, effectif: null, montantDemande: 1000, montantDemandeAnnexes: null, subrogation: false, organismeSiret: null, organismeNda: null,
  organismeQualiopi: true, deposeLe: null, accordLe: null, montantAccorde: null, accordReference: null, plafondHoraire: null, refusLe: null, refusMotif: null,
  factureLe: null, montantFacture: null, soldeLe: null, soldeEcart: null, soldeNature: null, abandonLe: null, abandonMotif: null, creeLe: '2026-10-01T08:00:00Z',
  creePar: 'RH', ...o,
});
const versement = (o: Partial<VersementOpco> = {}): VersementOpco => ({
  id: 1, dossierId: 1, le: '2026-06-01', montant: 500, destinataire: 'entreprise', reference: null, saisiLe: '', saisiPar: 'RH', ...o,
});

test('règles d’écran : proposition de dossier, étapes proposées, coût net, versements d’une période', () => {
  const l = { id: 5, statut: 'realise' as const, cout: 1000, coutReel: 1200.555, effectif: 4, effectifReel: 3 };
  const sessions = [
    { planId: 5, date: '2026-03-02', fin: '2026-03-03', statut: 'Clôturée' as const },
    { planId: 5, date: '2026-02-10', fin: '2026-02-10', statut: 'Confirmée' as const },
    { planId: 5, date: '2026-01-01', fin: '2026-01-02', statut: 'Annulée' as const },
    { planId: 6, date: '2025-01-01', fin: '2025-01-01', statut: 'Confirmée' as const },
  ];
  assert.deepEqual(R.propositionDossier(l, sessions, 14), { du: '2026-02-10', au: '2026-03-03', heures: 14, effectif: 3, montantDemande: 1200.56 });
  assert.deepEqual(R.propositionDossier({ ...l, statut: 'prevu', coutReel: null }, [], undefined), { du: null, au: null, heures: null, effectif: 4, montantDemande: 1000 });

  const e = R.etapesProposees(dossier(), 0);
  assert.deepEqual(Object.entries(e).filter(([, v]) => v).map(([k]) => k), ['modifier', 'deposer', 'abandonner']);
  const accorde = R.etapesProposees(dossier({ statut: 'accorde', deposeLe: '2026-01-01', accordLe: '2026-01-02', montantAccorde: 800 }), 0);
  assert.deepEqual(Object.entries(accorde).filter(([, v]) => v).map(([k]) => k), ['modifier', 'facturer', 'versement', 'abandonner', 'rouvrir']);
  // Remboursé par un acompte, justificatifs pas encore envoyés : envoi possible, solde pas encore.
  const acompte = R.etapesProposees(dossier({ statut: 'rembourse', deposeLe: '2026-01-01', accordLe: '2026-01-02' }), 1);
  assert.equal(acompte.facturer, true);
  assert.equal(acompte.solder, false);
  assert.equal(acompte.rouvrir, false, 'remboursé : annuler le versement d’abord');
  assert.ok(Object.values(R.etapesProposees(dossier({ annuleLe: '2026-10-01' }), 0)).every(v => !v), 'dossier supprimé : rien');

  const plan = [{ id: 1, statut: 'realise' as const }, { id: 2, statut: 'engage' as const }];
  const dossiers = [dossier({ id: 1, planActionId: 1 }), dossier({ id: 2, planActionId: 2 }), dossier({ id: 3, planActionId: 1, exercice: 2025 }), dossier({ id: 4, planActionId: 1, annuleLe: '2026-01-01' })];
  const versements = [versement({ id: 1, dossierId: 1, montant: 300 }), versement({ id: 2, dossierId: 1, montant: 200, destinataire: 'organisme' }),
    versement({ id: 3, dossierId: 1, montant: 999, annuleLe: '2026-06-02' }), versement({ id: 4, dossierId: 2, montant: 50 }), versement({ id: 5, dossierId: 3, montant: 70 }),
    versement({ id: 6, dossierId: 4, montant: 80 })];
  assert.deepEqual(R.coutNetPlan(2000, 2026, plan, dossiers, versements), { verse: 500, net: 1500 }, 'actions réalisées de l’exercice, versements en vigueur');
  assert.deepEqual(R.coutNetPlan(2000, 2026, plan, undefined, undefined), { verse: 0, net: 2000 });
  assert.deepEqual(R.versementsDeLaPeriode(versements, '2026-06-01', '2026-06-01').map(v => v.id), [1, 2, 4, 5, 6]);
  assert.deepEqual(R.versementsDeLaPeriode(versements, '2026-07-01', '2026-12-31'), []);
  assert.deepEqual(R.dossiersDeLaLigne(dossiers, 1).map(x => x.id), [3, 1]);
  assert.equal(R.eurosOpco(1234.5).replace(/\s/g, ' '), '1 234,50 €');
  assert.equal(passeFiltre('tous', dossier(), false), true);
  assert.equal(passeFiltre('retards', dossier(), false), false);
  assert.equal(passeFiltre('en_cours', dossier({ statut: 'solde' }), false), false);
  assert.equal(passeFiltre('clos', dossier({ statut: 'refuse' }), false), true);
});

test('journal : une seule famille par identifiant, les actions OPCO dans « Formations, plan et budget »', () => {
  const ids = FAMILLES_JOURNAL.map(f => f.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'aucune famille en double (fusion de la vague 1)');
  assert.equal(familleAction('opco.creer')?.id, 'formations');
  assert.equal(familleAction('plan.avancer')?.id, 'formations');
  assert.equal(familleAction('entite.creer')?.id, 'fiches');
});

// — Plan & budget —

test('Plan & budget : colonne OPCO, création préremplie depuis la ligne, onglet des dossiers et panneau de détail', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(14, 'rh'), () => createElement(Budget));
  render(b.element);
  const ligne = screen.getAllByText('FCO Marchandises')[0].closest('tr')!;
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Créer un dossier OPCO' })); });
  assert.deepEqual(b.trace.ouverts.at(-1), { type: 'opcoDossier', planActionId: FCO });
  cleanup();

  // Dialogue : proposé d'après la ligne et les réglages, puis vraie action du serveur.
  const d = await monter(db, await personne(14, 'rh'), () => createElement(OpcoDossierDialog, { planActionId: FCO }));
  render(d.element);
  assert.equal((screen.getByLabelText(/^OPCO/) as HTMLSelectElement).value, 'opco2i');
  assert.equal((screen.getByLabelText(/Coûts pédagogiques/) as HTMLInputElement).value, '1800');
  assert.equal(screen.queryByLabelText(/Frais annexes/), null, 'plan de développement : ni frais annexes ni rémunération');
  fireEvent.change(screen.getByLabelText(/SIRET/), { target: { value: '123' } });
  assert.match(document.body.textContent!, /SIRET de l’organisme : 14 chiffres/, 'saisie incorrecte signalée dès la saisie');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Créer le dossier' })); });
  assert.equal(d.trace.actions.length, 0, 'saisie bloquée : rien n’est envoyé');
  fireEvent.change(screen.getByLabelText(/SIRET/), { target: { value: '732 829 320 00074' } });
  fireEvent.change(screen.getByLabelText(/Dispositif/), { target: { value: 'pro_a' } });
  fireEvent.change(screen.getByLabelText(/Frais annexes/), { target: { value: '150,5' } });
  fireEvent.change(screen.getByLabelText(/Formation du/), { target: { value: '2026-11-02' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Créer le dossier' })); });
  const creation = d.trace.actions[0];
  assert.equal(creation.name, 'opco.creer');
  assert.equal(creation.r.ok, true, creation.r.error);
  assert.equal(d.trace.fermetures, 1);
  const x = d.donnees().dossiersOpco!.find(y => y.planActionId === FCO)!;
  assert.deepEqual([x.dispositif, x.montantDemande, x.montantDemandeAnnexes, x.organismeSiret, x.statut, x.du, x.heures], ['pro_a', 1800, 150.5, '73282932000074', 'a_deposer', '2026-11-02', 35]);
  cleanup();

  // Onglet : le nouveau dossier ouvert, ses étapes ; « Dossier déposé » ouvre le dialogue de l'étape.
  const o = await monter(db, await personne(14, 'rh'), () => createElement(Budget), { budgetOnglet: 'opco', opcoSel: x.id });
  render(o.element);
  assert.ok(screen.getByRole('heading', { name: 'Dossiers OPCO 2026' }));
  assert.ok(screen.getByRole('heading', { level: 3, name: /FCO Marchandises — Logistique, T4 2026/ }));
  assert.match(document.body.textContent!, /Dossier à déposer avant le début de la formation : 3 oct\. 2026 \(dépassée depuis 7 j\)/);
  assert.ok(screen.getByText('Dossiers en retard'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dossier déposé' })); });
  assert.deepEqual(o.trace.ouverts.at(-1), { type: 'opcoEtape', id: x.id, etape: 'deposer' });
  assert.equal(screen.queryByRole('button', { name: /Revenir à/ }), null, 'gestionnaire : pas de retour d’un cran');
  assert.equal(screen.queryByRole('button', { name: 'Supprimer' }), null);
  // Filtre « Clos » : aucun dossier clos.
  await act(async () => { fireEvent.click(screen.getByLabelText('Clos')); });
  assert.ok(screen.getByText('Aucun dossier avec ces filtres.'));
  // Retour à l'onglet du plan.
  await act(async () => { fireEvent.click(screen.getByLabelText('Plan & budget')); });
  assert.ok(screen.getByRole('heading', { name: 'Plan prévisionnel 2026' }));
  assert.ok(within(screen.getAllByText('FCO Marchandises')[0].closest('tr')!).getByRole('button', { name: /Dossier OPCO : À déposer/ }));
});

test('étapes : dépôt, accord contrôlé, versement, coût net du réalisé, retour d’un cran par l’administrateur RH', async () => {
  const { db, personne, accorde } = await avecDossiers();
  const admin = await personne(null, 'rh');
  // Accord : montant mal saisi, refusé à l'écran.
  const reouv = await agir(db, admin, 'opco.rouvrir', { id: accorde, de: 'accorde', motif: 'Accord saisi trop tôt' });
  assert.match(String(reouv), /de nouveau « Déposé »/);
  const a = await monter(db, admin, () => createElement(OpcoEtapeDialog, { id: accorde, etape: 'accorder' }));
  render(a.element);
  assert.equal((screen.getByLabelText(/Montant accordé/) as HTMLInputElement).value, '1440', 'proposé : le demandé');
  fireEvent.change(screen.getByLabelText(/Montant accordé/), { target: { value: 'abc' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’accord' })); });
  assert.equal(a.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/Montant accordé/), { target: { value: '1 100,50' } });
  fireEvent.change(screen.getByLabelText(/Accordé le/), { target: { value: '2026-01-25' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’accord' })); });
  assert.equal(a.trace.actions[0].r.ok, true, a.trace.actions[0].r.error);
  assert.deepEqual(a.trace.actions[0].payload.de, 'depose');
  cleanup();

  // Versement : proposé à ce qui reste à récupérer ; le nombre de versements affichés part avec la demande.
  const v = await monter(db, admin, () => createElement(OpcoVersementDialog, { id: accorde }));
  render(v.element);
  assert.equal((screen.getByLabelText(/Montant/) as HTMLInputElement).value, '1100,5');
  fireEvent.change(screen.getByLabelText(/Versé le/), { target: { value: '2026-03-01' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le versement' })); });
  assert.equal(v.trace.actions[0].r.ok, true, v.trace.actions[0].r.error);
  assert.equal(v.trace.actions[0].payload.versements, 0);
  assert.equal(v.donnees().dossiersOpco!.find(x => x.id === accorde)!.statut, 'rembourse');
  cleanup();

  // Plan : le réalisé affiche le coût net après les versements de l'OPCO.
  const p = await monter(db, admin, () => createElement(Budget));
  render(p.element);
  assert.match(document.body.textContent!, /coût net .* après 1\s101\s€ versés par l’OPCO/);
  cleanup();

  // Panneau (administrateur) : annulation du versement proposée, retour d'un cran impossible tant qu'il est remboursé.
  const o = await monter(db, admin, () => createElement(Budget), { budgetOnglet: 'opco', opcoSel: accorde });
  render(o.element);
  assert.equal(screen.queryByRole('button', { name: /Revenir à/ }), null);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annuler' })); });
  const c = o.trace.ouverts.at(-1) as { type: 'confirmer'; c: { action: string; payload: unknown } };
  assert.equal(c.c.action, 'opco.annulerVersement');
  assert.match(document.body.textContent!, /Justificatifs envoyés/);
});

test('justificatifs : pièces exigées à l’écran quand les pièces sont activées ; dialogue de pièce avec sa nature', async () => {
  const { db, personne, accorde } = await avecDossiers();
  const admin = await personne(null, 'rh');
  await agir(db, admin, 'parametres.maj', { piecesStockage: 'local' });
  const f = await monter(db, admin, () => createElement(OpcoEtapeDialog, { id: accorde, etape: 'facturer' }));
  render(f.element);
  assert.match(document.body.textContent!, /Joignez d’abord au dossier : facture, certificat de réalisation/);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’envoi' })); });
  assert.equal(f.trace.actions.length, 0, 'bloqué à l’écran comme par le serveur');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Joindre une pièce' })); });
  assert.deepEqual(f.trace.ouverts.at(-1), { type: 'opcoPiece', id: accorde, nature: 'facture' });
  cleanup();

  // Dialogue de pièce : nature proposée (première pièce requise absente), fichier exigé.
  const p = await monter(db, admin, () => createElement(OpcoPieceDialog, { id: accorde }));
  render(p.element);
  assert.equal((screen.getByLabelText(/Nature/) as HTMLSelectElement).value, 'convention');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Joindre la pièce' })); });
  assert.equal(p.trace.actions.length, 0);
  assert.match(document.body.textContent!, /Choisissez le fichier à joindre/);
  cleanup();

  // Pièces désactivées : seulement indiquées.
  await agir(db, admin, 'parametres.maj', { piecesStockage: 'desactive' });
  const s = await monter(db, admin, () => createElement(OpcoPieceDialog, { id: accorde, nature: 'accord' }));
  render(s.element);
  assert.match(document.body.textContent!, /Pièces justificatives désactivées/);
});

test('refus et solde : motif de la liste fermée exigé, écart proposé', async () => {
  const { db, personne, accorde } = await avecDossiers();
  const admin = await personne(null, 'rh');
  const ab = await monter(db, admin, () => createElement(OpcoEtapeDialog, { id: accorde, etape: 'abandonner' }));
  render(ab.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abandonner le dossier' })); });
  assert.equal(ab.trace.actions.length, 0);
  assert.match(document.body.textContent!, /Choisissez le motif/);
  fireEvent.change(screen.getByLabelText(/Motif de l’abandon/), { target: { value: 'renonciation' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abandonner le dossier' })); });
  assert.equal(ab.trace.actions[0].r.ok, true, ab.trace.actions[0].r.error);
  cleanup();
  await agir(db, admin, 'opco.rouvrir', { id: accorde, de: 'abandonne', motif: 'Abandon par erreur' });
  await agir(db, admin, 'opco.versement', { id: accorde, le: '2026-03-01', montant: '700', versements: 0 });
  await agir(db, admin, 'opco.facturer', { id: accorde, de: 'rembourse', factureLe: '2026-03-02', montantFacture: '1200' });
  const so = await monter(db, admin, () => createElement(OpcoEtapeDialog, { id: accorde, etape: 'solder' }));
  render(so.element);
  assert.equal((screen.getByLabelText(/Écart restant/) as HTMLSelectElement).value, 'partiel');
  fireEvent.change(screen.getByLabelText(/Écart restant/), { target: { value: 'perte' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Solder le dossier' })); });
  assert.equal(so.trace.actions[0].r.ok, true, so.trace.actions[0].r.error);
  assert.equal(so.trace.actions[0].payload.nature, 'perte');
  const x = so.donnees().dossiersOpco!.find(y => y.id === accorde)!;
  assert.deepEqual([x.statut, x.soldeEcart, x.soldeNature], ['solde', 500, 'perte']);
});

test('lecture seule : dossiers consultés sans motif, sans pièce ni bouton ; ni création depuis le plan', async () => {
  const { db, personne, refuse } = await avecDossiers();
  const b = await monter(db, await personne(11, 'rh'), () => createElement(Budget), { budgetOnglet: 'opco', opcoSel: refuse });
  render(b.element);
  assert.ok(screen.getByRole('heading', { level: 3, name: /FCO Marchandises/ }));
  assert.doesNotMatch(document.body.textContent!, /Budget de l’OPCO épuisé|budget de l’OPCO épuisé/, 'motif du refus jamais reçu');
  assert.match(document.body.textContent!, /Refusé/);
  assert.match(document.body.textContent!, /Consultation : les motifs/);
  assert.equal(screen.queryByText('Pièces'), null);
  for (const nom of ['Dossier déposé', 'Accord reçu', 'Corriger', 'Modifier', 'Abandonner', 'Supprimer']) assert.equal(screen.queryByRole('button', { name: nom }), null, nom);
  await act(async () => { fireEvent.click(screen.getByLabelText('Plan & budget')); });
  assert.equal(screen.queryByRole('button', { name: 'Créer un dossier OPCO' }), null);
  cleanup();
  // Le service RH voit le motif dans la chronologie.
  const rh = await monter(db, await personne(null, 'rh'), () => createElement(Budget), { budgetOnglet: 'opco', opcoSel: refuse });
  render(rh.element);
  assert.match(document.body.textContent!, /Refusé — budget de l’OPCO épuisé/);
  assert.ok(screen.getByRole('button', { name: 'Revenir à « Déposé »' }));
});

test('Échéances : dossiers en cours par date, dépassées comprises ; rien pour le référent HSE', async () => {
  const { db, personne } = await avecDossiers();
  const b = await monter(db, await personne(14, 'rh'), () => createElement(EcheancesOpcoPanel));
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Dossiers OPCO' }));
  const ligne = screen.getByText(/Sauveteur secouriste du travail \(SST\) — Production, T1 2026/).closest('tr')!;
  assert.ok(within(ligne).getByText('Justificatifs à envoyer à l’OPCO après la formation'));
  assert.ok(within(ligne).getByText('dépassée depuis 151 j'));
  assert.equal(screen.queryByText(/FCO Marchandises/), null, 'dossier refusé : plus d’échéance');
  cleanup();
  const hse = await monter(db, await personne(23, 'rh'), () => createElement(EcheancesOpcoPanel));
  render(hse.element);
  assert.equal(screen.queryByRole('heading', { name: 'Dossiers OPCO' }), null);
});

test('Paramètres → Dossiers OPCO : OPCO, subrogation et délais (bornes de shared/reglages.ts)', async () => {
  for (const [k, [min, max]] of Object.entries(BORNES_DELAIS_OPCO)) {
    const c = REGLAGES[k as keyof typeof BORNES_DELAIS_OPCO].controle!;
    assert.deepEqual([c(min - 1, 50), c(max + 1, 50)], [min, max], `${k} : mêmes bornes que le serveur`);
    assert.equal(erreurDelaiOpco(k as keyof typeof BORNES_DELAIS_OPCO, String(min)), null);
    assert.match(erreurDelaiOpco(k as keyof typeof BORNES_DELAIS_OPCO, String(max + 1))!, /Nombre de jours entier/);
  }
  assert.match(erreurDelaiOpco('opcoDelaiDepot', '1,5')!, /entier/);
  const { db, personne } = await baseDemo();
  const admin = await personne(null, 'rh');
  const b = await monter(db, admin, () => createElement(Section));
  render(b.element);
  fireEvent.change(screen.getByLabelText(/Dépôt avant le début/), { target: { value: '400' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les délais' })); });
  assert.equal(b.trace.actions.length, 0);
  assert.match(document.body.textContent!, /de 0 à 180/);
  fireEvent.change(screen.getByLabelText(/Dépôt avant le début/), { target: { value: '45' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les délais' })); });
  assert.equal(b.trace.actions[0].name, 'parametres.maj');
  assert.deepEqual(b.trace.actions[0].payload, { opcoDelaiDepot: 45, opcoDelaiJustificatifs: 90, opcoDelaiRemboursement: 60 });
  assert.equal(b.donnees().settings.opcoDelaiDepot, 45);
  await act(async () => { fireEvent.click(screen.getByLabelText(/Proposer la subrogation/)); });
  assert.deepEqual(b.trace.actions[1].payload, { opcoSubrogation: true });
  cleanup();
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(Section));
  render(lect.element);
  assert.equal((screen.getByLabelText(/OPCO proposé/) as HTMLSelectElement).disabled, true, 'consultation seulement');
});

test('exports CSV : dossiers sans motif, versements d’une période ; confirmations ; adresse de l’écran', async () => {
  const { db, personne, accorde, refuse } = await avecDossiers();
  const admin = await personne(null, 'rh');
  await agir(db, admin, 'opco.versement', { id: accorde, le: '2026-03-01', montant: '600', reference: 'VIR-1', versements: 0 });
  const full = await loadFull(db, admin);
  const d = new Domain(full);
  const dossiers = full.dossiersOpco!;
  const x = csvOpco(d, 2026, dossiers);
  assert.equal(x.fichier, 'dossiers-opco-2026-2026-10-10.csv');
  assert.equal(x.head.length, x.rows[0].length);
  const sst = x.rows.find(r => r[1] === 'Sauveteur secouriste du travail (SST)')!;
  assert.deepEqual([sst[7], sst[10], sst[17], sst[19], sst[22], sst[24]], ['OPCO 2i', 'Remboursé', '1440', '1200', '600', '600']);
  assert.ok(!x.rows.flat().some(c => /épuisé/i.test(String(c))), 'jamais le motif du refus');
  assert.equal(x.rows.find(r => r[10] === 'Refusé')![9], '');
  const v = csvVersementsOpco(d, '2026-01-01', '2026-12-31', R.versementsDeLaPeriode(full.versementsOpco, '2026-01-01', '2026-12-31'));
  assert.deepEqual(v.rows, [['01/03/2026', '600', 'Entreprise', 'VIR-1', 'OPCO 2i', 'OP-12', 2026, 'Sauveteur secouriste du travail (SST)', 'Production']]);

  const dos = dossiers.find(y => y.id === accorde)!, ref = dossiers.find(y => y.id === refuse)!;
  assert.equal(reouvertureOpco(dos, 'SST', 1), null, 'remboursé : pas de retour direct');
  const r = reouvertureOpco(ref, 'FCO', 0)!;
  assert.deepEqual([r.action, r.payload], ['opco.rouvrir', { id: refuse, de: 'refuse' }]);
  assert.match(r.question, /de « Refusé » à « Déposé »/);
  const vers = full.versementsOpco!.find(y => y.dossierId === accorde)!;
  const an = annulationVersementOpco(vers, 'SST', true, 'Accordé');
  assert.equal(an.action, 'opco.annulerVersement');
  assert.ok(an.suites!.some(s => /redevient « Accordé »/.test(s)));
  assert.deepEqual(suppressionDossierOpco(ref, 'FCO').ensuite, { ui: { opcoSel: null } });

  // Adresse : onglet, filtres et dossier ouvert ; un dossier inconnu est ignoré.
  const ui = { ...UI_DEPART, budgetOnglet: 'opco' as const, opcoFiltre: 'retards' as const, opcoCode: 'opco2i' as const, opcoDispositif: 'pro_a' as const, opcoSel: accorde };
  const q = ecrireUrl('budget', ui);
  assert.equal(q, `?exercice=2026&onglet=dossiers-opco&etat=en-retard&opco=opco2i&dispositif=pro-a&dossier-opco=${accorde}`);
  const lu = lireUrl('budget', q, full);
  assert.deepEqual([lu.budgetOnglet, lu.opcoFiltre, lu.opcoCode, lu.opcoDispositif, lu.opcoSel], ['opco', 'retards', 'opco2i', 'pro_a', accorde]);
  assert.equal(lireUrl('budget', '?dossier-opco=999', full).opcoSel, null);
  assert.equal(lireUrl('echeances', '?type=dossiers-opco', full).echType, 'opco');
});
