// Écrans du planning d'équipe (lot 12, chantier C5, étape 2) sous node --test (tests/outils/rendu.ts), sur le jeu de
// démonstration du 10 octobre 2026 (Karim Haddad, 12, manager de la Maintenance ; Thomas Garnier, 6 ; Romain Chevalier, 18 ;
// Mehdi Benali, 2) : grille, ligne de couverture et affichage réglementaire (calcul sans React), Paramètres → Planning,
// Référentiels → Cycles et Besoins, onglet Planning d'équipe et ses dialogues (Générer, Publier, Modifier, Affecter, Reprise,
// Valider un échange), « Mon planning » et la proposition d'un échange. Les dialogues envoient la vraie action du serveur.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const V = await import('../client/src/components/planning/planning-vue.ts');
const { PlanningEquipe, planifieEquipe } = await import('../client/src/components/planning/PlanningEquipe.tsx');
const D = await import('../client/src/dialogs/PlanningDialog.tsx');
const { RefBesoinDialog, RefCycleDialog, lireGroupes, lireSequence, ecrireGroupes } = await import('../client/src/dialogs/RefCycleDialog.tsx');
const { Besoins, Cycles, archivageBesoin, archivageCycle } = await import('../client/src/pages/ReferentielsCycles.tsx');
const { MonPlanning } = await import('../client/src/pages/MonPlanning.tsx');
const { Planning } = await import('../client/src/pages/parametres/Planning.tsx');
const { useDomain } = await import('../client/src/state/derived.ts');
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type User = Parameters<typeof makeCtx>[1];

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
afterEach(() => cleanup());

/** Action du serveur faite hors de l'écran (préparation). */
const agir = async (db: Db, u: User, nom: string, p: Record<string, unknown>) => await db.tx(async () => await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p));
const derniere = (b: { trace: { actions: { name: string; r: { ok: boolean; error?: string } }[] } }) => b.trace.actions.at(-1)!;

/** Démonstration avec le module activé, Thomas (A) et Romain (B) au 2x8 de la Maintenance, deux semaines générées. */
async function prepare() {
  const { db, personne } = await baseDemo();
  const RH = await personne(null, 'rh'), KARIM = await personne(12, 'manager');
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'A', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 18, cycle: '2X8', groupe: 'B', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-11-01' });
  return { db, personne, RH, KARIM };
}

test('grille de l’équipe : lettres, brouillons, absences au planificateur seul, couverture ; affichage et CSV ; Mon planning', async () => {
  const { db, KARIM, personne } = await prepare();
  await agir(db, await personne(null, 'rh'), 'planning.besoin.creer', { equipe: 'Maintenance', horaire: 'M', jours: [0, 1, 2, 3, 4], effectifMin: 2, du: '2026-10-01' });
  await agir(db, KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2026-10-20', horaire: 'N' });
  await agir(db, KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  // Absence validée de Romain le 21 octobre.
  await db.insert('absences', { empId: 18, type: 'CP', du: '2026-10-21', au: '2026-10-21', jours: 1, statut: 'validee', creeLe: '2026-10-01T08:00:00Z' });
  const d = new Domain(await loadFull(db, KARIM));
  const jours = V.joursDe('2026-10-19', 14);
  assert.equal(jours.at(-1), '2026-11-01');
  const g = V.grilleEquipe(d, 'Maintenance', jours, true);
  const thomas = g.lignes.find(l => l.empId === 6)!, romain = g.lignes.find(l => l.empId === 18)!, pourvoir = g.lignes.at(-1)!;
  assert.deepEqual(thomas.cases.slice(0, 7).map(c => c.marque), ['AM', 'AM', 'AM', 'AM', 'AM', 'R', 'R']);
  assert.ok(thomas.cases[7].brouillon && thomas.cases[7].marque === 'M', 'semaine suivante en brouillon');
  assert.match(thomas.cases[0].texte, /^lundi 19 octobre 2026 — poste AM · 13 h – 21 h, publié \(version 1\)$/);
  assert.match(thomas.resume, /^10 postes · 75 h · 7 à publier$/);
  assert.equal(romain.cases[2].etat, 'absent');
  assert.match(romain.cases[2].texte, /absent \(absence en vigueur\), poste M prévu/);
  assert.doesNotMatch(romain.cases[2].texte, /CP|congé/i, 'jamais la nature');
  assert.deepEqual([pourvoir.nom, pourvoir.cases[1].etat, pourvoir.cases[1].marque], ['À pourvoir', 'a_pourvoir', 'N']);
  assert.ok(g.lignes.some(l => l.empId === 2 && l.resume === 'Aucun poste'));
  // Couverture du lundi : un seul matin pour un besoin de deux.
  assert.deepEqual([g.couverture[0].court, g.couverture[0].manque], ['!1/2', true]);
  assert.match(g.couverture[0].texte, /2 postes planifiés \(AM 1, M 1 sur 2\) : besoin non couvert pour M/);
  assert.deepEqual([g.couverture[5].court, g.couverture[5].manque], ['', false], 'samedi : ni poste ni besoin');
  // Lecteur qui ne planifie pas : pas d'absence.
  assert.equal(V.grilleEquipe(d, 'Maintenance', jours, false).lignes.find(l => l.empId === 18)!.cases[2].etat, 'poste');
  assert.ok(V.equipesDuPlanning(d, 12, false).includes('Maintenance'));
  assert.ok(planifieEquipe(d, { rh: false, manager: true, me: 12 }, 'Maintenance'));
  assert.equal(planifieEquipe(d, { rh: false, manager: true, me: 12 }, 'Logistique'), false);
  assert.equal(planifieEquipe(d, { rh: false, manager: false, me: 2 }, 'Maintenance'), false);
  assert.ok(planifieEquipe(d, { rh: true, manager: false, me: null }, 'Logistique'));
  // Affichage D3171-7 : horaires tenus, composition nominative par jour et groupes de roulement ; CSV sans motif.
  const a = V.affichageEquipe(d, 'Maintenance', jours);
  assert.deepEqual(a.horaires.map(h => [h.code, h.plage]), [['AM', '13 h – 21 h'], ['M', '5 h – 13 h'], ['N', '21 h – 5 h (lendemain)']].filter(([c]) => a.horaires.some(h => h.code === c)));
  assert.deepEqual(a.composition.find(x => x.jour === '2026-10-19' && x.horaire === 'M')!.salaries, ['Romain Chevalier']);
  assert.deepEqual(a.groupes.map(x => [x.groupe, x.salaries]), [['A', ['Thomas Garnier']], ['B', ['Romain Chevalier']]]);
  const csv = V.csvAffichage('Maintenance', jours, a);
  assert.equal(csv.fichier, 'affichage-equipes-maintenance-2026-10-19.csv');
  assert.deepEqual(csv.rows[0], ['Maintenance', '19/10/2026', 'AM', '13 h – 21 h', 'Thomas Garnier']);
  // Mon planning de Thomas : postes publiés seulement.
  const dt = new Domain(await loadFull(db, await personne(6, 'collaborateur')));
  const siens = V.joursDuSalarie(dt.ds.creneaux, 6, V.joursDe('2026-10-19', 14));
  assert.deepEqual([siens[0].texte, siens[5].texte, siens[7].texte], ['Poste AM · 13 h – 21 h, pause 30 min', 'Repos', '—']);
});

test('Paramètres → Planning : activation, valeurs de l’accord exigeant sa référence, collègues ; reprise proposée', async () => {
  const { db, personne } = await baseDemo();
  function Section() { const d = useDomain(); return createElement(Planning, { s: d.ds.settings, envois: {} as never }); }
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Section));
  render(b.element);
  assert.ok(screen.getByText(/Module désactivé/));
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Activer le planning/ })); });
  assert.equal(b.donnees().settings.planningActif, true);
  const n = b.trace.actions.length;
  fireEvent.change(screen.getByLabelText(/Délai de prévenance/), { target: { value: '4' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les valeurs' })); });
  assert.equal(b.trace.actions.length, n, 'refus à l’écran');
  assert.ok(screen.getByText(/supposent un accord collectif/));
  fireEvent.change(screen.getByLabelText(/Référence de l’accord/), { target: { value: 'Accord du 1er mars 2026' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les valeurs' })); });
  assert.equal(derniere(b).r.ok, true, derniere(b).r.error);
  assert.deepEqual([b.donnees().settings.planningDelaiPrevenance, b.donnees().settings.planningAccord], [4, 'Accord du 1er mars 2026']);
  fireEvent.change(screen.getByLabelText(/Poste de nuit au plus/), { target: { value: '30' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les valeurs' })); });
  assert.ok(screen.getByText(/Un nombre entier de 8 à 12/));
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /postes planifiés de ses collègues/ })); });
  assert.equal(b.donnees().settings.planningCollegues, true);
  fireEvent.click(screen.getByRole('button', { name: 'Reprendre…' }));
  assert.deepEqual(b.trace.ouverts.at(-1), { type: 'planningReprise' });
  cleanup();
  // Lecture seule : rien ne se modifie.
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(Section));
  render(lect.element);
  assert.equal((screen.getByRole('checkbox', { name: /Activer le planning/ }) as HTMLInputElement).disabled, true);
});

test('Référentiels : cycles (création, indicateurs, archivage) et besoins de poste', async () => {
  const { db, personne } = await baseDemo();
  const RH = await personne(null, 'rh');
  assert.deepEqual(lireSequence('M m - r AM'), ['M', 'M', '', '', 'AM']);
  assert.deepEqual(lireGroupes('a:0 B:7'), [{ code: 'A', decalage: 0 }, { code: 'B', decalage: 7 }]);
  assert.equal(ecrireGroupes([{ code: 'A', decalage: 0 }]), 'A:0');
  const c = await monter(db, RH, () => createElement(RefCycleDialog, {}));
  render(c.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter au référentiel' })); });
  assert.equal(c.trace.actions.length, 0, 'saisie incomplète : erreurs, rien n’est envoyé');
  assert.ok(screen.getByText(/Indiquez le code du cycle/));
  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: '4x8' } });
  fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: '4x8 d’essai' } });
  fireEvent.change(screen.getByLabelText(/^Séquence/), { target: { value: 'M M AM AM N N - -' } });
  fireEvent.change(screen.getByLabelText(/^Groupes/), { target: { value: 'A:0 B:2 C:4 D:6' } });
  assert.ok(screen.getByText(/par semaine en moyenne/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter au référentiel' })); });
  assert.equal(derniere(c).r.ok, true, derniere(c).r.error);
  assert.equal(c.trace.fermetures, 1);
  cleanup();
  const m = await monter(db, RH, () => createElement(RefCycleDialog, { code: '4X8' }));
  render(m.element);
  fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: '4x8 modifié' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(derniere(m).name, 'planning.cycle.modifier');
  cleanup();
  render((await monter(db, RH, () => createElement(RefCycleDialog, { code: 'NUL' }))).element);
  assert.ok(screen.getByText('Ce cycle n’existe plus.'));
  cleanup();
  const l = await monter(db, RH, () => createElement(Cycles));
  render(l.element);
  assert.ok(screen.getByText(/4x8 modifié/));
  fireEvent.click(screen.getAllByRole('button', { name: 'Archiver' })[0]);
  assert.equal(l.trace.ouverts.at(-1)!.type, 'confirmer');
  assert.deepEqual(archivageCycle({ code: '2X8', nom: 'x' }).payload, { code: '2X8' });
  await agir(db, RH, 'planning.cycle.archiver', { code: '4X8' });
  cleanup();
  const l2 = await monter(db, RH, () => createElement(Cycles));
  render(l2.element);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher les archivés' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rétablir' })); });
  assert.equal(derniere(l2).r.ok, true);
  cleanup();
  // Besoin de poste.
  const bd = await monter(db, RH, () => createElement(RefBesoinDialog, { equipe: 'Maintenance' }));
  render(bd.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter' })); });
  assert.equal(bd.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/^Horaire/), { target: { value: 'N' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sam.' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter' })); });
  assert.equal(derniere(bd).r.ok, true, derniere(bd).r.error);
  const id = (await db.all<{ id: number }>('besoinsPoste'))[0].id;
  cleanup();
  const bm = await monter(db, RH, () => createElement(RefBesoinDialog, { id }));
  render(bm.element);
  fireEvent.change(screen.getByLabelText(/^Effectif minimal/), { target: { value: '3' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(derniere(bm).name, 'planning.besoin.modifier');
  cleanup();
  const lb = await monter(db, RH, () => createElement(Besoins));
  render(lb.element);
  assert.ok(screen.getByText('Lun. Mar. Mer. Jeu. Ven. Sam.'));
  fireEvent.click(screen.getByRole('button', { name: 'Archiver' }));
  assert.equal(lb.trace.ouverts.at(-1)!.type, 'confirmer');
  assert.deepEqual(archivageBesoin({ id, equipe: 'Maintenance', horaire: 'N', effectifMin: 3 }).payload, { id });
});

test('onglet Planning d’équipe : grille, Générer, Publier (délai court et alertes à motiver), Modifier, Affecter', async () => {
  const { db, KARIM, RH } = await prepare();
  const p = await monter(db, KARIM, () => createElement(PlanningEquipe), { weekStart: '2026-10-19' });
  render(p.element);
  assert.ok(screen.getByRole('table', { name: /Planning de l’équipe sur deux semaines/ }));
  assert.ok(screen.getByLabelText(/Thomas Garnier, lundi 19 octobre 2026 — poste AM · 13 h – 21 h, brouillon à publier/));
  // Clavier : flèche à droite, puis clic : la case ouvre le dialogue du créneau.
  const lundi = screen.getByLabelText(/Thomas Garnier, lundi 19 octobre/);
  fireEvent.focus(lundi);
  fireEvent.keyDown(lundi, { key: 'ArrowRight' });
  fireEvent.click(lundi);
  assert.deepEqual({ ...p.trace.ouverts.at(-1), id: undefined }, { type: 'planningCreneau', equipe: 'Maintenance', jour: '2026-10-19', empId: 6, id: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'Générer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
  fireEvent.click(screen.getByRole('button', { name: 'Affecter' }));
  assert.deepEqual(p.trace.ouverts.slice(-3).map(x => x.type), ['planningGenerer', 'planningPublier', 'planningRoulement']);
  fireEvent.change(screen.getByLabelText('Équipe'), { target: { value: 'Maintenance' } });
  cleanup();

  // Générer : période passée refusée à l'écran ; période valide envoyée.
  const g = await monter(db, KARIM, () => createElement(D.PlanningGenererDialog, { equipe: 'Maintenance', du: '2026-11-02' }));
  render(g.element);
  fireEvent.change(screen.getByLabelText(/Dernier jour/), { target: { value: '2027-06-01' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Générer en brouillon' })); });
  assert.equal(g.trace.actions.length, 0);
  assert.ok(screen.getByText(/limitée à 12 semaines/));
  fireEvent.change(screen.getByLabelText(/Dernier jour/), { target: { value: '2026-11-08' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Générer en brouillon' })); });
  assert.equal(derniere(g).r.ok, true, derniere(g).r.error);
  cleanup();

  // Publier la semaine du 12 : rien à publier ; celle du 19 : alerte d'aptitude de Thomas à motiver.
  const pv = await monter(db, KARIM, () => createElement(D.PlanningPublierDialog, { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }));
  render(pv.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(pv.trace.actions.length, 0);
  assert.ok(screen.getAllByText(/Aucun brouillon/).length);
  cleanup();
  const pb = await monter(db, KARIM, () => createElement(D.PlanningPublierDialog, { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25' }));
  render(pb.element);
  assert.ok(screen.getByText(/14 créneaux à publier pour 2 salariés/));
  assert.ok(screen.getByText('Thomas Garnier — Aptitude médicale à vérifier avec le service RH'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(pb.trace.actions.length, 0);
  assert.ok(screen.getByText(/Indiquez pourquoi le planning est publié malgré les alertes/));
  fireEvent.change(screen.getByLabelText(/Motif des alertes acceptées/), { target: { value: 'Visite programmée' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(derniere(pb).r.ok, true, derniere(pb).r.error);
  cleanup();
  // Délai court : motif des circonstances exceptionnelles.
  await agir(db, KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2026-10-13', horaire: 'J', empId: 6 });
  const pc = await monter(db, KARIM, () => createElement(D.PlanningPublierDialog, { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }));
  render(pc.element);
  assert.ok(screen.getByText(/1 créneau communiqué moins de 7 jours avant leur date/));
  fireEvent.change(screen.getByLabelText(/Circonstances exceptionnelles/), { target: { value: 'Remplacement' } });
  fireEvent.change(screen.getByLabelText(/Motif des alertes acceptées/), { target: { value: 'Visite programmée' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(derniere(pc).r.ok, true, derniere(pc).r.error);
  cleanup();
  // Mehdi au roulement : refus d'habilitation, publication bloquée à l'écran.
  await agir(db, KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2026-10-27', horaire: 'J', empId: 2 });
  const pr = await monter(db, KARIM, () => createElement(D.PlanningPublierDialog, { equipe: 'Maintenance', du: '2026-10-26', au: '2026-11-01' }));
  render(pr.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(pr.trace.actions.length, 0);
  assert.ok(screen.getByText(/corrigez d’abord les refus/));
  cleanup();

  // Modifier un créneau publié ; retirer un brouillon ; ajouter un poste à pourvoir ; jour passé.
  const ds = await loadFull(db, KARIM);
  const publie = ds.creneaux!.find(c => c.empId === 6 && c.jour === '2026-10-20' && c.statut === 'publie')!;
  const cm = await monter(db, KARIM, () => createElement(D.PlanningCreneauDialog, { equipe: 'Maintenance', jour: '2026-10-20', empId: 6, id: publie.id }));
  render(cm.element);
  fireEvent.change(screen.getByLabelText(/^Horaire/), { target: { value: 'J' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(derniere(cm).r.ok, true, derniere(cm).r.error);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler le poste publié…' }));
  assert.equal((cm.trace.ouverts.at(-1) as { c: { action: string } }).c.action, 'planning.creneau.annuler');
  cleanup();
  const brouillon = (await loadFull(db, KARIM)).creneaux!.find(c => c.empId === 2 && c.jour === '2026-10-27')!;
  const cr = await monter(db, KARIM, () => createElement(D.PlanningCreneauDialog, { equipe: 'Maintenance', jour: '2026-10-27', empId: 2, id: brouillon.id }));
  render(cr.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer le brouillon' })); });
  assert.equal(derniere(cr).r.ok, true, derniere(cr).r.error);
  cleanup();
  const ca = await monter(db, KARIM, () => createElement(D.PlanningCreneauDialog, { equipe: 'Maintenance', jour: '2026-10-28', empId: null }));
  render(ca.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter en brouillon' })); });
  assert.equal(ca.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/^Horaire/), { target: { value: 'N' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ajouter en brouillon' })); });
  assert.equal(derniere(ca).r.ok, true, derniere(ca).r.error);
  cleanup();
  render((await monter(db, KARIM, () => createElement(D.PlanningCreneauDialog, { equipe: 'Maintenance', jour: '2026-10-05', empId: 6 }))).element);
  assert.ok(screen.getByText(/Jour passé/));
  cleanup();
  render((await monter(db, KARIM, () => createElement(D.PlanningCreneauDialog, { equipe: 'Maintenance', jour: '2026-10-28', empId: 6, id: 999999 }))).element);
  assert.ok(screen.getByText('Ce créneau n’existe plus.'));
  cleanup();

  // Affecter, puis terminer une affectation.
  const ra = await monter(db, KARIM, () => createElement(D.PlanningRoulementDialog, { equipe: 'Maintenance' }));
  render(ra.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Affecter' })); });
  assert.equal(ra.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/^Salarié/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/^Cycle/), { target: { value: '3X8' } });
  assert.ok(screen.getByText(/Première semaine/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Affecter' })); });
  assert.equal(derniere(ra).r.ok, true, derniere(ra).r.error);
  cleanup();
  const rt = await monter(db, KARIM, () => createElement(D.PlanningRoulementDialog, { equipe: 'Maintenance', id: 1 }));
  render(rt.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminer l’affectation' })); });
  assert.equal(rt.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/^Dernier jour/), { target: { value: '2026-12-31' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminer l’affectation' })); });
  assert.equal(derniere(rt).r.ok, true, derniere(rt).r.error);
  cleanup();
  render((await monter(db, KARIM, () => createElement(D.PlanningRoulementDialog, { equipe: 'Maintenance', id: 999 }))).element);
  assert.ok(screen.getByText('Cette affectation n’existe plus.'));
  cleanup();

  // Reprise des équipes par quart (service RH).
  const rp = await monter(db, RH, () => createElement(D.PlanningRepriseDialog));
  render(rp.element);
  assert.ok(screen.getByText(/Aucune équipe par quart repérée/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Affecter au cycle' })); });
  assert.equal(rp.trace.actions.length, 0);
  fireEvent.click(screen.getByRole('checkbox', { name: /^Logistique/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Affecter au cycle' })); });
  assert.equal(derniere(rp).name, 'planning.reprise');
  assert.equal(derniere(rp).r.ok, true, derniere(rp).r.error);
});

test('Mon planning : postes publiés, échange proposé, accepté puis validé par le manager', async () => {
  const { db, KARIM, personne } = await prepare();
  await agir(db, KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  const THOMAS = await personne(6, 'collaborateur'), ROMAIN = await personne(18, 'collaborateur');
  const m = await monter(db, THOMAS, () => createElement(MonPlanning), { weekStart: '2026-10-19' });
  render(m.element);
  assert.ok(screen.getByText(/version 1 · communiquée le 10 oct\. 2026/));
  fireEvent.click(screen.getByRole('button', { name: 'Proposer un échange du poste du lundi 19 octobre 2026' }));
  const ouvert = m.trace.ouverts.at(-1) as { type: string; creneauId: number };
  assert.equal(ouvert.type, 'planningEchange');
  fireEvent.click(screen.getByRole('button', { name: 'Semaines suivantes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
  cleanup();
  const e = await monter(db, THOMAS, () => createElement(D.PlanningEchangeDialog, { creneauId: ouvert.creneauId }));
  render(e.element);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Proposer l’échange' })); });
  assert.equal(e.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/^Collègue/), { target: { value: '18' } });
  assert.ok(screen.getByText(/cession/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Proposer l’échange' })); });
  // Romain travaille aussi le lundi 19 : la cession est refusée à la validation ; ici, la proposition passe.
  assert.equal(derniere(e).r.ok, true, derniere(e).r.error);
  cleanup();
  render((await monter(db, THOMAS, () => createElement(D.PlanningEchangeDialog, { creneauId: 999999 }))).element);
  assert.ok(screen.getByText('Ce poste n’est plus publié.'));
  cleanup();
  // Romain : à traiter ; il accepte.
  const r = await monter(db, ROMAIN, () => createElement(MonPlanning), { weekStart: '2026-10-19' });
  render(r.element);
  assert.ok(screen.getByText(/proposé par Thomas Garnier — Proposé au collègue/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accepter' })); });
  assert.equal(derniere(r).r.ok, true, derniere(r).r.error);
  cleanup();
  // Karim : l'aperçu relève que Romain travaille déjà ce jour-là ; validation bloquée à l'écran ; refus par confirmation.
  const v = await monter(db, KARIM, () => createElement(D.PlanningEchangeValiderDialog, { id: 1 }));
  render(v.element);
  assert.ok(screen.getByText(/Le collègue travaille déjà le 19 oct\. 2026/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’échange' })); });
  assert.equal(v.trace.actions.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Refuser…' }));
  assert.equal((v.trace.ouverts.at(-1) as { c: { action: string } }).c.action, 'planning.echange.refuser');
  cleanup();
  render((await monter(db, KARIM, () => createElement(D.PlanningEchangeValiderDialog, { id: 99 }))).element);
  assert.ok(screen.getByText('Cet échange n’est plus à valider.'));
  cleanup();
  // Échange contre un poste du même jour : aucun refus ; Thomas, réserve d'aptitude : motif exigé.
  const ds = await loadFull(db, KARIM);
  const a = ds.creneaux!.find(c => c.empId === 6 && c.jour === '2026-10-20' && c.statut === 'publie')!, b = ds.creneaux!.find(c => c.empId === 18 && c.jour === '2026-10-20' && c.statut === 'publie')!;
  await agir(db, THOMAS, 'planning.echange.proposer', { creneauId: a.id, partenaireId: 18, creneauPartenaire: b.id });
  const id = (await db.all<{ id: number }>('echangesPoste')).at(-1)!.id;
  await agir(db, ROMAIN, 'planning.echange.accepter', { id });
  const v2 = await monter(db, KARIM, () => createElement(D.PlanningEchangeValiderDialog, { id }));
  render(v2.element);
  assert.ok(screen.getByText(/échange son poste du mar\. 20 oct\./));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’échange' })); });
  assert.equal(v2.trace.actions.length, 0);
  fireEvent.change(screen.getByLabelText(/Motif des alertes acceptées/), { target: { value: 'Visite programmée' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’échange' })); });
  assert.equal(derniere(v2).r.ok, true, derniere(v2).r.error);
  cleanup();
  // Thomas : l'échange validé ; retrait d'une proposition ouverte.
  const t = await monter(db, THOMAS, () => createElement(MonPlanning), { weekStart: '2026-10-19' });
  render(t.element);
  assert.ok(screen.getAllByText('Validé').length);
  const enCours = (await loadFull(db, THOMAS)).creneaux!.find(c => c.empId === 6 && c.jour === '2026-10-21' && c.statut === 'publie')!;
  await agir(db, THOMAS, 'planning.echange.proposer', { creneauId: enCours.id, partenaireId: 18 });
  cleanup();
  const t2 = await monter(db, THOMAS, () => createElement(MonPlanning), { weekStart: '2026-10-19' });
  render(t2.element);
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' }).at(-1)!); });
  assert.equal(derniere(t2).r.ok, true, derniere(t2).r.error);
  assert.equal(V.echangeTexte(new Domain(t2.donnees()), t2.donnees().echangesPoste!.find(x => x.statut === 'annule')!, 6), 'proposé à Romain Chevalier — Annulé');
});
