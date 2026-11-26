// Planning d'équipe, habilitations des postes déjà planifiés à l'écran (CU-142, lot 18), sur le jeu de démonstration du
// 10 octobre 2026 (Karim Haddad, 12, manager de la Maintenance ; Mehdi Benali, 2, habilitation électrique expirée) : « ! »
// dans la grille du planificateur, panneau de l'onglet Planning d'équipe et du tableau de bord RH ; rien pour la
// consultation (paie, lecture seule), ni module désactivé.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { cleanup, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { PlanningEquipe } = await import('../client/src/components/planning/PlanningEquipe.tsx');
const { HabilitationsPlanifieesPanel } = await import('../client/src/components/planning/HabilitationsPlanifiees.tsx');
type Db = Awaited<ReturnType<typeof baseDemo>>['db'];
type User = Parameters<typeof makeCtx>[1];

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
afterEach(() => cleanup());

const agir = async (db: Db, u: User, nom: string, p: Record<string, unknown>) => await db.tx(async () => await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p));

/** Mehdi et Romain au 2x8 du 19 octobre, deux semaines générées (brouillons) ; un poste de Mehdi publié le 12. */
async function prepare(actif = true) {
  const { db, personne } = await baseDemo();
  const RH = await personne(null, 'rh'), KARIM = await personne(12, 'manager');
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 2, cycle: '2X8', groupe: 'A', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.roulement.affecter', { empId: 18, cycle: '2X8', groupe: 'B', du: '2026-10-19' });
  await agir(db, KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-11-01' });
  await db.insert('creneaux', {
    empId: 2, jour: '2026-10-12', equipe: 'Maintenance', horaire: 'M', debut: '05:00', fin: '13:00', pause: 30, source: 'manuel', statut: 'publie', version: 1,
    publieLe: '2026-10-01T08:00:00.000Z', publiePar: 'Karim Haddad', communiqueLe: '2026-10-01', horsDelai: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
  });
  if (!actif) await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: false });
  return { db, personne, RH, KARIM };
}

test('onglet Planning d’équipe : « ! » sur le poste et liste des postes à revoir pour le manager', async () => {
  const { db, KARIM } = await prepare();
  const p = await monter(db, KARIM, () => createElement(PlanningEquipe), { weekStart: '2026-10-12' });
  render(p.element);
  const c = screen.getByRole('button', { name: /Mehdi Benali, lundi 12 octobre 2026 .*habilitation exigée .+ expirée le / });
  assert.equal(c.textContent, 'M!');
  assert.ok(screen.getByText('Habilitations à revoir sur les postes planifiés'));
  assert.ok(screen.getByText(/dont 1 déjà publié$/));
  assert.ok(screen.getAllByText('À publier').length > 0);
  assert.ok(screen.getByText(/ou habilitation exigée non valide à la date du poste/));
});

test('tableau de bord RH : panneau toutes équipes ; consultation et module désactivé : rien', async () => {
  const { db, personne, RH } = await prepare();
  const r = await monter(db, RH, () => createElement(HabilitationsPlanifieesPanel));
  render(r.element);
  assert.ok(screen.getByText('Habilitations à revoir sur les postes planifiés'));
  assert.ok(screen.getAllByText('Équipe Maintenance').length > 0);
  cleanup();
  const lecture = await personne(11, 'rh');
  const l = await monter(db, lecture, () => createElement(HabilitationsPlanifieesPanel));
  assert.equal(render(l.element).container.textContent, '');
  cleanup();
  const off = await prepare(false);
  const o = await monter(off.db, off.RH, () => createElement(HabilitationsPlanifieesPanel));
  assert.equal(render(o.element).container.textContent, '');
});
