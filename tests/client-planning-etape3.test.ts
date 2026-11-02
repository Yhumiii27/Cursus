// Planning d'équipe (lot 12, chantier C5, étape 3) à l'écran, sur le jeu de démonstration du 10 octobre 2026 (Karim
// Haddad, 12, manager de la Maintenance ; Thomas Garnier, 6, sans SST, groupe A du 2x8 ; Romain Chevalier, 18, SST valide,
// groupe B ; Laura, 23, référente HSE) : conflits marqués dans la grille (planificateur seul), couverture minimale par
// créneau dans la ligne de couverture et l'aperçu de la publication, panneau du tableau de bord (service RH avec les
// absences, référent HSE sans elles).
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
const { PlanningEquipe } = await import('../client/src/components/planning/PlanningEquipe.tsx');
const { CouvertureCreneauxPanel } = await import('../client/src/components/planning/CouvertureCreneaux.tsx');
const D = await import('../client/src/dialogs/PlanningDialog.tsx');
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type User = Parameters<typeof makeCtx>[1];

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
afterEach(() => cleanup());

const agir = async (db: Db, u: User, nom: string, p: Record<string, unknown>) => await db.tx(async () => await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p));

/** Module activé, un SST au moins par horaire de la Maintenance, Thomas et Romain au 2x8, deux semaines générées. */
async function prepare() {
  const { db, personne } = await baseDemo();
  const RH = await personne(null, 'rh'), KARIM = await personne(12, 'manager'), HSE = await personne(23, 'rh');
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  await db.update('equipes', 'Maintenance', { couverture: [{ formation: 'sst', min: 1 }] });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'A', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 18, cycle: '2X8', groupe: 'B', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-11-01' });
  await db.insert('missions', { empId: 6, projet: 'HLT-026', lieu: 'Lyon', du: '2026-10-20', au: '2026-10-20', type: 'Mission', ref: null });
  return { db, personne, RH, KARIM, HSE };
}

test('grille : conflit marqué « ! » pour le planificateur seul, secouristes manquants dans la couverture ; aperçu de la publication', async () => {
  const { db, KARIM } = await prepare();
  const d = new Domain(await loadFull(db, KARIM));
  const jours = V.joursDe('2026-10-19', 14);
  const g = V.grilleEquipe(d, 'Maintenance', jours, true);
  const thomas = g.lignes.find(l => l.empId === 6)!;
  assert.equal(thomas.cases[1].conflit, true);
  assert.match(thomas.cases[1].texte, /; conflit : mission Keystone HLT-026 \(Lyon\) pendant le poste AM planifié$/);
  assert.equal(thomas.cases[0].conflit, false);
  assert.equal(V.grilleEquipe(d, 'Maintenance', jours, false).lignes.find(l => l.empId === 6)!.cases[1].conflit, false, 'consultation : aucun conflit');
  // Lundi 19 : Thomas (sans SST) seul l'après-midi, Romain (SST) le matin.
  assert.deepEqual([g.couverture[0].court, g.couverture[0].manque], ['!2', true]);
  assert.match(g.couverture[0].texte, /; couverture minimale non tenue : SST au poste AM \(0 sur 1\)$/);
  assert.doesNotMatch(g.couverture[0].texte, /au poste M/);
  // À l'écran : la marque « ! » et le texte complet du conflit.
  const p = await monter(db, KARIM, () => createElement(PlanningEquipe), { weekStart: '2026-10-19' });
  render(p.element);
  const caseConflit = screen.getByRole('button', { name: /Thomas Garnier, mardi 20 octobre 2026 .*conflit : mission Keystone HLT-026/ });
  assert.equal(caseConflit.textContent, 'AM*!');
  assert.ok(screen.getByText(/! : conflit avec une mission ou une tâche Keystone/));
  cleanup();
  // Publier : conflits et couverture en information, sans motif propre.
  const pb = await monter(db, KARIM, () => createElement(D.PlanningPublierDialog, { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25' }));
  render(pb.element);
  assert.ok(screen.getByText('Thomas Garnier — 20 oct. 2026 : mission Keystone HLT-026 (Lyon) pendant le poste AM planifié'));
  assert.ok(screen.getByText('Couverture lun. 19 oct. — AM : 1 poste · SST 0 sur 1 : sous le minimum'));
  fireEvent.change(screen.getByLabelText(/Motif des alertes acceptées/), { target: { value: 'Visite programmée' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  assert.equal(pb.trace.actions.at(-1)!.r.ok, true, pb.trace.actions.at(-1)!.r.error);
});

test('tableau de bord : couverture par poste publié, absences retirées pour le service RH, jamais pour le référent HSE', async () => {
  const { db, RH, KARIM, HSE } = await prepare();
  await agir(db, KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  // Absence validée de Romain (SST) le mercredi 21 : le matin perd son secouriste pour le service RH seulement.
  await db.insert('absences', { empId: 18, type: 'CP', du: '2026-10-21', au: '2026-10-21', jours: 1, statut: 'validee', creeLe: '2026-10-01T08:00:00Z' });
  const rh = V.couvertureAVenir(new Domain(await loadFull(db, RH)), 14, true);
  const hse = V.couvertureAVenir(new Domain(await loadFull(db, HSE)), 14, false);
  const cle = (x: { jour: string; horaire: string }) => `${x.jour} ${x.horaire}`;
  assert.ok(rh.manques.some(x => cle(x) === '2026-10-21 M'));
  assert.ok(!hse.manques.some(x => cle(x) === '2026-10-21 M'), 'sans absences : le référent HSE ne peut pas désigner l’absent');
  assert.deepEqual(hse.manques.map(cle), ['2026-10-19 AM', '2026-10-20 AM', '2026-10-21 AM', '2026-10-22 AM', '2026-10-23 AM']);
  assert.equal(hse.creneaux, 10);
  assert.deepEqual(hse.manques[0].manques, ['SST']);
  // Panneau : référent HSE (sans absences) et service RH (avec).
  const h = await monter(db, HSE, () => createElement(CouvertureCreneauxPanel));
  render(h.element);
  assert.ok(screen.getByText('Couverture minimale par poste planifié'));
  assert.ok(screen.getByText(/Couverture calculée sans les absences/));
  assert.equal(screen.getAllByText('SST').length, 5);
  cleanup();
  const r = await monter(db, RH, () => createElement(CouvertureCreneauxPanel));
  render(r.element);
  assert.ok(screen.getByText(/Les salariés absents ce jour-là ne comptent pas/));
  assert.ok(screen.getByText(/6 postes sous le minimum/));
  cleanup();
  // Minimum tenu partout : le panneau le dit ; module désactivé ou manager : rien.
  await db.update('equipes', 'Maintenance', { couverture: [] });
  const ok = await monter(db, HSE, () => createElement(CouvertureCreneauxPanel));
  render(ok.element);
  assert.ok(screen.getByText(/Effectif et secouristes au minimum sur tous les postes publiés/));
  cleanup();
  const m = await monter(db, KARIM, () => createElement(CouvertureCreneauxPanel));
  assert.equal(render(m.element).container.textContent, '');
  cleanup();
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: false });
  const off = await monter(db, RH, () => createElement(CouvertureCreneauxPanel));
  assert.equal(render(off.element).container.textContent, '');
});
