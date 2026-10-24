// Écrans des astreintes (t049, lot 7, étape 2) sous node --test (tests/outils/rendu.ts) sur le jeu de démonstration du
// 10 octobre 2026 (Karim Haddad, 12, manager de la Maintenance ; Mehdi Benali, 2) : Paramètres → Astreintes (délai et
// accord, compensation, mineurs ; consultation), planning de l'écran Temps (planifier, délai court et motif, annuler),
// déclaration d'une intervention et ligne INT-AST en lecture seule sur la feuille, récapitulatif mensuel du portail
// (R3121-2) et son document imprimé, astreintes en attente de la paie. Les dialogues envoient la vraie action du serveur.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { Astreintes } = await import('../client/src/pages/parametres/Astreintes.tsx');
const { AstreinteDialog } = await import('../client/src/dialogs/AstreinteDialog.tsx');
const { InterventionAstreinteDialog } = await import('../client/src/dialogs/InterventionAstreinteDialog.tsx');
const { AstreintesEnAttente, InterventionsFeuille, PlanningAstreintes } = await import('../client/src/components/Astreintes.tsx');
const { AstreintesPortail, compensationTexte, moisAstreintes, moisProvisoire, sectionsRecapitulatif, titreRecapitulatif } = await import('../client/src/components/AstreintesPortail.tsx');
const { etatAstreinte, maintenant, peutPlanifier } = await import('../client/src/components/astreintes-etat.ts');
const { Temps } = await import('../client/src/pages/Temps.tsx');
const { useDomain } = await import('../client/src/state/derived.ts');
const { instant } = await import('../shared/rules/astreintes.ts');
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type Astreinte = import('../shared/types.ts').Astreinte;
type Settings = import('../shared/types.ts').Settings;

// Heure présente des actions du serveur : 9 h à Paris le jour de la démonstration.
horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
afterEach(() => cleanup());

/** Astreinte écrite directement (passée ou commencée : hors des contrôles de la planification). */
const inserer = async (db: Db, du: string, au: string, o: Partial<Astreinte> = {}) => (await db.insert<Astreinte>('astreintes', {
  empId: 2, equipe: 'Maintenance', du, debut: '18:00', au, fin: '08:00', communiqueLe: '2026-09-10', motif: null, creeLe: '2026-09-10T08:00:00.000Z', creePar: 'Karim Haddad', ...o,
})).id;

/** Section de Paramètres relue dans l'instantané à chaque rendu, comme la page. */
function Section() {
  const d = useDomain();
  return createElement(Astreintes, { s: d.ds.settings, envois: {} as never });
}
const champ = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;

test('règles de l’écran : état d’une astreinte, planificateur (manager direct, service RH jamais pour soi), mois du récapitulatif', async () => {
  const a = { id: 1, empId: 2, du: '2026-10-09', debut: '18:00', au: '2026-10-12', fin: '08:00', annuleLe: null } as Astreinte;
  assert.equal(etatAstreinte(a, instant('2026-10-09', '17:59')), 'avenir');
  assert.equal(etatAstreinte(a, instant('2026-10-10', '09:00')), 'encours');
  assert.equal(etatAstreinte(a, instant('2026-10-12', '08:00')), 'terminee');
  assert.equal(etatAstreinte({ ...a, annuleLe: '2026-10-01T00:00:00Z' }, 0), 'annulee');
  assert.equal(maintenant('2026-10-10', new Date('2026-10-10T07:30:00Z')), instant('2026-10-10', '09:30'), 'heure de Paris (UTC+2 en octobre)');
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(12, 'manager'), () => createElement('div'));
  const d = new (await import('../shared/domain.ts')).Domain(b.donnees());
  const karim = { rh: false, manager: true, me: 12, soi: 12 };
  assert.equal(peutPlanifier(d, karim, d.emp(2)!), true);
  assert.equal(peutPlanifier(d, karim, d.emp(12)!), false, 'jamais pour soi-même');
  assert.equal(peutPlanifier(d, { rh: true, manager: false, me: 14, soi: 14 }, { id: 14, equipe: null }), false);
  const dix = instant('2026-10-10', '09:00');
  assert.deepEqual(moisAstreintes([{ ...a, du: '2026-09-28', au: '2026-11-02' }], 2, dix), ['2026-10', '2026-09'], 'jusqu’au mois en cours');
  // Astreinte pas encore commencée (encore annulable) : aucun récapitulatif, même dans le mois en cours (R3121-2 : heures accomplies).
  assert.deepEqual(moisAstreintes([{ ...a, du: '2026-10-23', au: '2026-10-30' }], 2, dix), []);
  // Fin le 1er à 0 h : aucune heure dans ce mois, qui n'est pas proposé (comme `partsAstreinte` de la paie).
  const finMinuit = { ...a, du: '2026-09-30', debut: '08:00', au: '2026-10-01', fin: '00:00' };
  assert.deepEqual(moisAstreintes([finMinuit], 2, instant('2026-11-05', '09:00')), ['2026-09']);
  assert.deepEqual(moisAstreintes([{ ...finMinuit, du: '2026-10-31', au: '2026-11-01' }], 2, instant('2026-11-05', '09:00')), ['2026-10']);
  assert.equal(moisProvisoire('2026-10', dix), true);
  assert.equal(moisProvisoire('2026-09', dix), false);
  assert.equal(titreRecapitulatif('2026-10', dix), 'Récapitulatif des astreintes — octobre 2026 (provisoire, mois en cours)');
  assert.equal(titreRecapitulatif('2026-09', dix), 'Récapitulatif des astreintes — septembre 2026');
  assert.equal(compensationTexte({ astreinteCompensation: 'repos', astreinteAccord: 'Accord du 1er mars 2026' }), 'En repos : durée fixée par l’accord sur les astreintes (Accord du 1er mars 2026)');
  assert.equal(compensationTexte(undefined), 'Financière : montant sur le bulletin de paie');
});

test('Paramètres → Astreintes : compensation et mineurs aussitôt, délai court refusé sans accord puis enregistré ; consultation', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Section));
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Astreintes' }));
  await act(async () => { fireEvent.click(screen.getByLabelText('En repos')); });
  assert.deepEqual(b.trace.actions.at(-1)!.payload, { astreinteCompensation: 'repos' });
  assert.equal(b.donnees().settings.astreinteCompensation, 'repos');
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /moins de 18 ans/ })); });
  assert.equal(b.donnees().settings.astreinteMineurs, true);
  // Délai de 10 jours sans accord : refus à l'écran, rien n'est envoyé ; avec la référence, enregistré.
  const n = b.trace.actions.length;
  fireEvent.change(champ(/Délai de prévenance/), { target: { value: '10' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le délai' })); });
  assert.equal(b.trace.actions.length, n);
  assert.ok(screen.getByText(/suppose un accord collectif/));
  fireEvent.change(champ(/Référence de l’accord/), { target: { value: 'Accord d’entreprise du 1er mars 2026' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le délai' })); });
  assert.equal(b.trace.actions.at(-1)!.r.ok, true, b.trace.actions.at(-1)!.r.error);
  const s: Settings = b.donnees().settings;
  assert.deepEqual([s.astreinteDelaiPrevenance, s.astreinteAccord], [10, 'Accord d’entreprise du 1er mars 2026']);
  cleanup();
  // Lecture seule : tout est consulté, rien ne se modifie.
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(Section));
  render(lect.element);
  assert.equal(champ(/Délai de prévenance/).disabled, true);
  assert.equal((screen.getByRole('checkbox', { name: /moins de 18 ans/ }) as HTMLInputElement).disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Enregistrer le délai' }), null);
});

test('planning : le manager planifie (15 jours), puis en délai court avec le motif exigé ; il annule une astreinte à venir', async () => {
  const { db, personne } = await baseDemo();
  const KARIM = await personne(12, 'manager');
  const p = await monter(db, KARIM, () => createElement(PlanningAstreintes, { wk: '2026-10-05' }));
  render(p.element);
  assert.ok(screen.getByText('Aucune astreinte cette semaine.'));
  fireEvent.click(screen.getByRole('button', { name: 'Planifier une astreinte' }));
  assert.deepEqual(p.trace.ouverts[0], { type: 'astreinte' });
  cleanup();

  const dlg = await monter(db, KARIM, () => createElement(AstreinteDialog, { empId: 2 }));
  render(dlg.element);
  fireEvent.change(champ(/^Premier jour/), { target: { value: '2026-10-30' } });
  fireEvent.change(champ(/^Dernier jour/), { target: { value: '2026-11-06' } });
  assert.equal(screen.queryByLabelText(/Circonstances exceptionnelles/), null, 'délai tenu : pas de motif');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Planifier l’astreinte' })); });
  assert.equal(dlg.trace.actions[0].name, 'astreinte.planifier');
  assert.deepEqual(dlg.trace.actions[0].payload, { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  assert.equal(dlg.trace.actions[0].r.ok, true, dlg.trace.actions[0].r.error);
  assert.equal(dlg.trace.fermetures, 1);
  cleanup();

  // Cinq jours avant : le motif des circonstances exceptionnelles est exigé avant tout envoi.
  const court = await monter(db, KARIM, () => createElement(AstreinteDialog, { empId: 6 }));
  render(court.element);
  fireEvent.change(champ(/^Premier jour/), { target: { value: '2026-10-15' } });
  fireEvent.change(champ(/^Dernier jour/), { target: { value: '2026-10-16' } });
  assert.ok(screen.getByText(/moins que le délai de prévenance de 15 jours/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Planifier l’astreinte' })); });
  assert.equal(court.trace.actions.length, 0);
  assert.ok(screen.getAllByText(/indiquez les circonstances exceptionnelles/).length > 0);
  fireEvent.change(champ(/Circonstances exceptionnelles/), { target: { value: 'Remplacement d’un technicien en arrêt' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Planifier l’astreinte' })); });
  assert.equal(court.trace.actions[0].r.ok, true, court.trace.actions[0].r.error);
  assert.match(court.trace.messages[0].text, /délai de prévenance de 5 jours : circonstances exceptionnelles notées/);
  cleanup();

  // Planning des astreintes à venir : les deux, modifiables et annulables par le manager.
  const plan = await monter(db, KARIM, () => createElement(PlanningAstreintes, { wk: '2026-10-05' }));
  render(plan.element);
  await act(async () => { fireEvent.click(screen.getByLabelText('En cours et à venir')); });
  const ligne = screen.getByText('Mehdi Benali').closest('tr')!;
  assert.ok(within(ligne).getByText('À venir'));
  assert.ok(within(ligne).getByText(/158 h · communiquée le 10 oct\. 2026/));
  fireEvent.click(within(ligne).getByRole('button', { name: /Annuler l’astreinte de Mehdi Benali/ }));
  const c = plan.trace.ouverts.at(-1)!;
  assert.equal(c.type, 'confirmer');
  assert.equal(c.type === 'confirmer' && c.c.action, 'astreinte.annuler');
  assert.equal(c.type === 'confirmer' && c.c.motif?.requis, true);
  fireEvent.click(within(ligne).getByRole('button', { name: /Modifier l’astreinte de Mehdi Benali/ }));
  assert.equal(plan.trace.ouverts.at(-1)!.type, 'astreinte');
});

test('feuille : intervention déclarée pendant l’astreinte, ligne INT-AST en lecture seule, retrait confirmé', async () => {
  const { db, personne } = await baseDemo();
  const id = await inserer(db, '2026-10-09', '2026-10-12');
  const MEHDI = await personne(2, 'collaborateur');
  const f = await monter(db, MEHDI, () => createElement(InterventionsFeuille, { emp: (f.donnees().employes.find(e => e.id === 2))!, wk: '2026-10-05', editable: true }));
  render(f.element);
  assert.ok(screen.getByText(/Vous êtes d’astreinte du 9 oct\. 2026 à 18 h au 12 oct\. 2026 à 8 h/));
  fireEvent.click(screen.getByRole('button', { name: 'Déclarer une intervention' }));
  assert.deepEqual(f.trace.ouverts[0], { type: 'interventionAstreinte', empId: 2, jour: '2026-10-10' });
  cleanup();

  const dlg = await monter(db, MEHDI, () => createElement(InterventionAstreinteDialog, { empId: 2, jour: '2026-10-09' }));
  render(dlg.element);
  assert.equal((screen.getByLabelText(/^Astreinte/) as HTMLSelectElement).value, String(id));
  fireEvent.change(champ(/^Début/), { target: { value: '22:00' } });
  fireEvent.change(champ(/^Fin/), { target: { value: '01:30' } });
  assert.ok(screen.getByText('3,5 h'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Déclarer l’intervention' })); });
  assert.equal(dlg.trace.actions[0].r.ok, true, dlg.trace.actions[0].r.error);
  assert.deepEqual(dlg.trace.actions[0].payload, { astreinteId: id, jour: '2026-10-09', debut: '22:00', fin: '01:30' });
  cleanup();

  // Feuille de la semaine : la ligne INT-AST porte 3,5 h le vendredi, en lecture seule, sans bouton de suppression.
  const t = await monter(db, MEHDI, () => createElement(Temps), { weekStart: '2026-10-05' });
  render(t.element);
  const cellule = screen.getByLabelText(/^INT-AST .*vendredi/i) as HTMLInputElement;
  assert.equal(cellule.disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Supprimer la ligne INT-AST' }), null);
  assert.ok(screen.getByText(/de 22 h à 1 h 30 \(le lendemain\)/));
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  const c = t.trace.ouverts.at(-1)!;
  assert.equal(c.type === 'confirmer' && c.c.action, 'astreinte.retirerIntervention');
  // Le collaborateur n'a pas de planning dans Temps : il voit ses astreintes dans son portail.
  assert.equal(screen.queryByRole('heading', { name: 'Planning des astreintes' }), null);
});

test('portail : récapitulatif mensuel (heures, interventions, compensation) et document imprimé', async () => {
  const { db, personne } = await baseDemo();
  const passee = await inserer(db, '2026-09-28', '2026-10-05');
  await db.insert('astreinteInterventions', { astreinteId: passee, empId: 2, jour: '2026-09-30', debut: '23:00', fin: '02:00', heures: 3, declareLe: '2026-10-01T08:00:00Z', declarePar: 'Mehdi Benali' });
  // Astreinte planifiée plus tard dans le mois (encore annulable) : ni dans les heures ni dans les périodes d'octobre.
  await inserer(db, '2026-10-23', '2026-10-30');
  const b = await monter(db, await personne(2, 'collaborateur'), () => {
    const d = useDomain();
    return createElement(AstreintesPortail, { e: d.emp(2)! });
  });
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Mes astreintes' }));
  assert.equal((screen.getByLabelText('Récapitulatif du mois') as HTMLSelectElement).value, '2026-10');
  assert.ok(screen.getByText('Provisoire (mois en cours, heures accomplies à ce jour) : 0 période, 104 h d’astreinte, 0 intervention'));
  assert.ok(screen.getByText(/Du 23 oct\. 2026 à 18 h au 30 oct\. 2026 à 8 h/), 'elle figure parmi les prochaines astreintes');
  await act(async () => { fireEvent.change(screen.getByLabelText('Récapitulatif du mois'), { target: { value: '2026-09' } }); });
  assert.ok(screen.getByText('1 période, 54 h d’astreinte, 1 intervention (3 h)'));
  assert.ok(screen.getByText(/Mercredi 30 septembre : intervention de 23 h à 2 h \(3 h\)/));
  assert.ok(screen.getByText('Compensation : Financière : montant sur le bulletin de paie'));
  assert.ok(screen.getByRole('button', { name: 'Imprimer le récapitulatif' }));
  // Document imprimé (art. R3121-2) : totaux, périodes (heures du mois), interventions, compensation.
  const neuf = instant('2026-10-10', '09:00');
  const sections = sectionsRecapitulatif(b.donnees(), { id: 2 }, '2026-09', neuf);
  assert.deepEqual(sections.map(s => s.title), ['Totaux du mois', 'Périodes d’astreinte', 'Interventions déclarées', 'À savoir']);
  assert.deepEqual(sections[0].rows, [['Heures d’astreinte', '54 h'], ['Périodes commencées dans le mois', '1'], ['Interventions (travail effectif)', '1 · 3 h'], ['Forme de la compensation', 'Financière : montant sur le bulletin de paie']]);
  assert.deepEqual(sections[1].table!.rows, [['Du 28 sept. 2026 à 18 h au 5 oct. 2026 à 8 h', '158 h', '54 h']]);
  assert.deepEqual(sections[2].table!.rows, [['30 sept. 2026', '23 h', '2 h (lendemain)', '3 h']]);
  assert.doesNotMatch(sections[3].text!, /provisoire/, 'mois écoulé : définitif');
  // Mois en cours : arrêté à l'instant présent, sans l'astreinte à venir, dit provisoire.
  const oct = sectionsRecapitulatif(b.donnees(), { id: 2 }, '2026-10', neuf);
  assert.deepEqual(oct[0].rows!.slice(0, 2), [['Heures d’astreinte', '104 h'], ['Périodes commencées dans le mois', '0']]);
  assert.deepEqual(oct[1].table!.rows, [['Du 28 sept. 2026 à 18 h au 5 oct. 2026 à 8 h', '158 h', '104 h']]);
  assert.match(oct.at(-1)!.text!, /^Mois en cours : récapitulatif provisoire, arrêté au 10 oct\. 2026 à 9 h/);
});

test('récapitulatif du mois en cours : astreinte commencée arrêtée à l’instant présent', async () => {
  const { db, personne } = await baseDemo();
  const id = await inserer(db, '2026-10-09', '2026-10-16');
  await db.insert('astreinteInterventions', { astreinteId: id, empId: 2, jour: '2026-10-11', debut: '02:00', fin: '04:00', heures: 2, declareLe: '2026-10-11T08:00:00Z', declarePar: 'Mehdi Benali' });
  const b = await monter(db, await personne(2, 'collaborateur'), () => createElement('div'));
  const ds = b.donnees();
  const s = sectionsRecapitulatif(ds, { id: 2 }, '2026-10', instant('2026-10-10', '09:00'));
  assert.deepEqual(s[0].rows!.slice(0, 3), [['Heures d’astreinte', '15 h'], ['Périodes commencées dans le mois', '1'], ['Interventions (travail effectif)', 'aucune']]);
  assert.deepEqual(s[1].table!.rows, [['Du 9 oct. 2026 à 18 h au 16 oct. 2026 à 8 h', '158 h prévues (en cours)', '15 h']]);
  // Plus tard dans le mois : l'intervention déclarée compte.
  const apres = sectionsRecapitulatif(ds, { id: 2 }, '2026-10', instant('2026-10-12', '09:00'));
  assert.deepEqual(apres[0].rows![2], ['Interventions (travail effectif)', '1 · 2 h']);
});

test('paie : astreintes terminées en attente, à saisir dans Sage tant que les rubriques sont désactivées', async () => {
  const { db, personne } = await baseDemo();
  await inserer(db, '2026-09-28', '2026-10-05');
  const b = await monter(db, await personne(7, 'rh'), () => createElement(AstreintesEnAttente));
  render(b.element);
  assert.ok(screen.getByText(/Astreintes terminées à saisir dans Sage \(rubriques AST_H et AST_PER désactivées\) : Mehdi Benali \(158 h d’astreinte \(AST_H\), 1 période \(AST_PER\), octobre 2026\)/));
});
