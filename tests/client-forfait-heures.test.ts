// Écrans du forfait annuel en heures (lot 12, chantier C1, étape 2) sous node --test (tests/outils/rendu.ts), sur le jeu de
// démonstration lu le 20 janvier 2027 (suivi depuis le 1er janvier 2026 : la plage 2026 d'Élodie Bernard, 11, est
// terminée ; ses feuilles de 2026 sont validées ici, 7,5 h par jour ouvré) :
// - bandeau de l'onglet « Forfait annuel en heures » (service RH) et dialogue de clôture : ligne cochée d'office, aucune
//   cochée refusée par l'écran, envoi de la vraie action du serveur ; ligne enregistrée, réouverture et annulation par le
//   dialogue de confirmation (motif) ;
// - manager (Sarah Cohen, 23) : réalisé et cible, sans cible nette ni lignes de clôture ;
// - Paramètres → Décompte des heures : seuil hors défaut refusé sans la référence de l'accord, puis enregistré ;
// - Lots de paie : heures à saisir dans Sage ;
// - paie, liste d'absences déduites hors défaut : ni « à revoir » ni cible nette recalculés sur un instantané qui masque la
//   nature des absences (quantités photographiées des lignes confirmées seulement).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2027-01-20';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { addD, isFerie, mondayOf } = await import('../shared/dates.ts');
const { RecapForfaitHeures } = await import('../client/src/components/temps/RecapForfaitHeures.tsx');
const { ForfaitHeuresEnAttente } = await import('../client/src/components/temps/ForfaitHeuresFiche.tsx');
const { ReglagesForfaitHeures, erreursForfaitHeures } = await import('../client/src/components/temps/ReglagesForfaitHeures.tsx');
const { ClotureForfaitHeuresDialog } = await import('../client/src/dialogs/ClotureForfaitHeuresDialog.tsx');
const { useDomain } = await import('../client/src/state/derived.ts');
const { Domain } = await import('../shared/domain.ts');
const F = await import('../shared/rules/forfait-heures.ts');
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type Feuille = import('../shared/types.ts').FeuilleTemps;

afterEach(() => cleanup());

const EMP = 11;
const ANNUEL = { statut: 'cadre', typeContrat: 'cdi', temps: 'forfait_heures_annuel', heures: null, forfaitHeures: 1607, forfaitJours: null, jourOff: [] };

/** Feuilles validées de 2026 d'Élodie Bernard, 7,5 h par jour ouvré non férié hors absences (celles du jeu reprises). */
async function annee2026(db: Db) {
  const absences = await db.where<{ empId: number; du: string; au: string; statut: string }>('absences', 'empId', EMP);
  const existantes = await db.where<Feuille>('feuilles', 'empId', EMP);
  for (let w = mondayOf('2026-01-01'); w <= '2026-12-31'; w = addD(w, 7)) {
    const h = Array.from({ length: 7 }, (_, i) => {
      const j = addD(w, i);
      return i >= 5 || j < '2026-01-01' || j > '2026-12-31' || isFerie(j) || absences.some(a => a.du <= j && a.au >= j && ['validee', 'signalee'].includes(a.statut)) ? 0 : 7.5;
    });
    const lignes = [{ projet: 'INT-LOG', tache: 'Logistique', ks: false, h }];
    const f = existantes.find(x => x.week === w);
    if (f) await db.update('feuilles', f.id, { statut: 'validee', contrat: ANNUEL, lignes });
    else await db.insert('feuilles', { empId: EMP, week: w, statut: 'validee', comment: null, sage: true, keystone: false, lignes, contrat: ANNUEL });
  }
}

/** Section de Paramètres relue dans l'instantané à chaque rendu, comme la page. */
function Section() {
  const d = useDomain();
  return createElement(ReglagesForfaitHeures, { s: d.ds.settings });
}

test('bandeau et dialogue de clôture : ligne cochée d’office, aucune cochée refusée, clôture envoyée au serveur', async () => {
  const { db, personne } = await baseDemo();
  await annee2026(db);
  const admin = await personne(null, 'rh');
  const onglet = await monter(db, admin, () => createElement(RecapForfaitHeures));
  render(onglet.element);
  assert.ok(screen.getByRole('heading', { name: 'Clôtures du forfait annuel en heures à faire' }));
  assert.ok(screen.getByText(/1 plage à clôturer \(1 salarié\)/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clôturer' })); });
  assert.deepEqual(onglet.trace.ouverts.at(-1), { type: 'clotureForfaitHeures', periode: '2026-01-01' });
  cleanup();

  const dlg = await monter(db, admin, () => createElement(ClotureForfaitHeuresDialog, { periode: '2026-01-01' }));
  render(dlg.element);
  const ligne = screen.getByText('Élodie Bernard').closest('.boxed') as HTMLElement;
  assert.ok(within(ligne).getByText(/fin de la période/));
  assert.ok(within(ligne).getByText('Cible nette'));
  assert.match(ligne.textContent ?? '', /HFA25/);
  const coche = within(ligne).getByRole('checkbox') as HTMLInputElement;
  assert.equal(coche.checked, true, 'cochée d’office : rien ne la bloque');
  // Décochée : l'envoi est refusé par l'écran (bouton jamais grisé), sans action.
  await act(async () => { fireEvent.click(coche); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clôturer 0 ligne' })); });
  assert.ok(screen.getByText('Cochez au moins une ligne à clôturer.'));
  assert.equal(dlg.trace.actions.length, 0);
  await act(async () => { fireEvent.click(coche); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clôturer 1 ligne' })); });
  const a = dlg.trace.actions.at(-1)!;
  assert.deepEqual([a.name, a.payload, a.r.ok], ['forfaitHeures.cloturer', { lignes: [{ empId: EMP, debut: '2026-01-01' }] }, true]);
  assert.equal(dlg.trace.fermetures, 1);
  cleanup();

  // Ligne enregistrée : plus de bandeau ; réouverture et annulation par le dialogue de confirmation, motif exigé.
  const apres = await monter(db, admin, () => createElement(RecapForfaitHeures));
  render(apres.element);
  assert.equal(screen.queryByRole('heading', { name: 'Clôtures du forfait annuel en heures à faire' }), null);
  const tr = screen.getByRole('heading', { name: 'Clôtures enregistrées' }).closest('.panel')!.querySelector('tbody tr') as HTMLElement;
  assert.match(tr.textContent ?? '', /confirmée, en attente du prochain lot de paie/);
  await act(async () => { fireEvent.click(within(tr).getByRole('button', { name: 'Rouvrir' })); });
  const c = apres.trace.ouverts.at(-1) as { type: 'confirmer'; c: { action: string; motif?: { requis: boolean } } };
  assert.deepEqual([c.type, c.c.action, c.c.motif?.requis], ['confirmer', 'forfaitHeures.rouvrir', true]);
  await act(async () => { fireEvent.click(within(tr).getByRole('button', { name: 'Annuler' })); });
  assert.equal((apres.trace.ouverts.at(-1) as { c: { action: string } }).c.action, 'forfaitHeures.annuler');
  cleanup();

  // Lots de paie : rubriques HFA désactivées, heures à saisir dans Sage.
  const lots = await monter(db, admin, () => createElement(ForfaitHeuresEnAttente));
  render(lots.element);
  assert.ok(screen.getByText(/Heures de clôture du forfait annuel en heures à saisir dans Sage .*Élodie Bernard \(HFA25/));
});

test('manager : réalisé et cible de son équipe, sans cible nette, absences déduites ni lignes de clôture', async () => {
  const { db, personne } = await baseDemo();
  await annee2026(db);
  const b = await monter(db, await personne(23, 'manager'), () => createElement(RecapForfaitHeures));
  render(b.element);
  assert.equal(screen.queryByRole('heading', { name: 'Clôtures du forfait annuel en heures à faire' }), null);
  assert.equal(screen.queryByRole('heading', { name: 'Clôtures enregistrées' }), null);
  const table = screen.getByRole('heading', { name: /Suivi du forfait annuel en heures/ }).closest('.panel') as HTMLElement;
  assert.ok(within(table).getByText('Élodie Bernard'));
  assert.equal(within(table).queryByText('Cible nette'), null);
  assert.ok(within(table).getByText('Cible'));
  assert.ok(within(table).getByText(/les absences déduites et les heures de paie restent au service RH/));
});

test('Paramètres → Décompte des heures : seuil hors défaut refusé sans la référence de l’accord, puis enregistré', async () => {
  assert.deepEqual(erreursForfaitHeures({ suivi: '2027-01-01', seuil: '8', jour: '', accord: '', horsDefaut: false }), { suivi: null, seuil: null, jour: null, accord: null });
  const e = erreursForfaitHeures({ suivi: '2027-02-30', seuil: '49', jour: '13', accord: ' ', horsDefaut: true });
  assert.ok(e.suivi && e.seuil && e.jour && e.accord);
  assert.equal(erreursForfaitHeures({ suivi: '2027-01-01', seuil: '8', jour: '7,02', accord: '', horsDefaut: false }).jour, null);

  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Section));
  render(b.element);
  const seuil = screen.getByLabelText(/Heures à 25 % par semaine travaillée/) as HTMLInputElement;
  await act(async () => { fireEvent.change(seuil, { target: { value: '6' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le forfait annuel en heures' })); });
  assert.ok(screen.getByText('Indiquez la référence de l’accord collectif qui fixe ces règles.'));
  assert.equal(b.trace.actions.length, 0);
  await act(async () => { fireEvent.change(screen.getByLabelText(/Référence de l’accord collectif/), { target: { value: 'Accord d’entreprise du 1er mars 2027' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le forfait annuel en heures' })); });
  const a = b.trace.actions.at(-1)!;
  assert.equal(a.name, 'parametres.maj');
  assert.equal(a.r.ok, true, a.r.error);
  assert.deepEqual([a.payload.forfaitHeuresSeuil25, a.payload.forfaitHeuresAccord], [6, 'Accord d’entreprise du 1er mars 2027']);
  assert.equal(b.donnees().settings.forfaitHeuresSeuil25, 6);
});

test('paie, absences déduites hors défaut : ni « à revoir » ni cible nette recalculés sur l’instantané qui masque la nature des absences', async () => {
  const { db, personne } = await baseDemo();
  await db.insert('absences', { empId: EMP, type: 'MALADIE', du: '2026-03-09', au: '2026-03-13', statut: 'validee' });
  await annee2026(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), forfaitHeuresAbsencesDeduites: ['MALADIE', 'AT', 'RTT'], forfaitHeuresAccord: 'Accord d’entreprise du 1er mars 2026' });
  const admin = await personne(null, 'rh');
  const dlg = await monter(db, admin, () => createElement(ClotureForfaitHeuresDialog, { periode: '2026-01-01' }));
  render(dlg.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clôturer 1 ligne' })); });
  assert.equal(dlg.trace.actions.at(-1)!.r.ok, true);
  cleanup();
  const ligne = (await db.all<import('../shared/types.ts').ClotureForfaitHeures>('cloturesForfaitHeures'))[0];
  assert.ok(ligne.absences > 20, 'arrêt déduit par le serveur');

  const paie = await monter(db, await personne(7, 'rh'), () => createElement(RecapForfaitHeures));
  // Le défaut est réel : recalculé sur l'instantané de la paie (« ABSENCE »), l'arrêt ne serait plus déduit.
  assert.match(F.aRevoir(new Domain(paie.donnees()), ligne) ?? '', /absences déduites recalculées : 0 h/);
  render(paie.element);
  assert.equal(screen.queryByText('À revoir'), null, 'la paie ne voit jamais un faux « à revoir »');
  assert.equal(screen.queryByText(/à revoir :/), null);
  const suivi = screen.getByRole('heading', { name: /Suivi du forfait annuel en heures/ }).closest('.panel') as HTMLElement;
  assert.equal(within(suivi).queryByText('Cible nette'), null, 'cible nette recalculée : service RH et salarié seulement');
  assert.ok(within(suivi).getByText('Cible'));
  // Lignes confirmées : quantités photographiées par le serveur (cible nette de la clôture).
  const tr = screen.getByRole('heading', { name: 'Clôtures enregistrées' }).closest('.panel')!.querySelector('tbody tr') as HTMLElement;
  assert.match(tr.textContent ?? '', /confirmée, en attente du prochain lot de paie/);
  cleanup();

  // Service RH : mêmes données, vraies natures : rien à revoir.
  const rh = await monter(db, admin, () => createElement(RecapForfaitHeures));
  assert.equal(F.aRevoir(new Domain(rh.donnees()), ligne), null);
});
