// Socle commun du lot 12 (S0) : contrainte PostgreSQL des objets de pièce élargie d'avance (0021_lot12_socle), registre des
// fenêtres de lecture (`FENETRES`, vide au socle), périmètre de délégation « planning » fermé, onglets de l'écran Temps
// de travail et blocs réservés aux six chantiers. Les contrôles suivent les registres quand les chantiers les remplissent :
// une fenêtre porte sur une table lue par l'instantané, triée par sa clé entière, et ne dépend que du jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { migrationsPg } = await import('../server/src/db-pg.ts');
const { TABLES } = await import('../server/src/db.ts');
const { FENETRES, ORDRE_LECTURE, TABLES_LUES, COLONNES_OMISES } = await import('../server/src/lecture-brute.ts');
const { controleDelegation, estPerimetre, perimetreEffectif, PERIMETRES_DELEGATION } = await import('../shared/rules/delegations-manager.ts');
const { ONGLETS_TEMPS } = await import('../client/src/pages/temps-onglets.ts');
type TableName = keyof typeof TABLES;

/** Valeurs de la dernière définition de pieces_objet_check dans la chaîne des migrations PostgreSQL. */
function objetsAdmisPg(): string[] {
  let valeurs: string[] = [];
  for (const m of migrationsPg()) {
    for (const r of m.sql.matchAll(/"pieces_objet_check" CHECK \("objet" IN \(([^)]*)\)\)/g)) valeurs = [...r[1].matchAll(/'([^']+)'/g)].map(v => v[1]);
  }
  return valeurs;
}

test('0021_lot12_socle : pieces_objet_check admet les objets existants et les trois objets du lot 12', () => {
  const m = migrationsPg().find(x => x.nom === '0021_lot12_socle');
  assert.ok(m, 'migration 0021_lot12_socle absente');
  assert.match(m.sql, /ALTER TABLE "pieces" DROP CONSTRAINT "pieces_objet_check";/);
  // Seule la contrainte change : ni table, ni colonne, ni vue, ni schéma.
  assert.doesNotMatch(m.sql.replace(/^--.*$/gm, ''), /CREATE|ADD COLUMN|DROP TABLE|DROP COLUMN|pub_/);
  const admis = objetsAdmisPg();
  for (const objet of ['absence', 'certification', 'habTitre', 'declaration', 'voyage', 'dossierOpco', 'ligneFrais', 'ligneFraisSante', 'vehiculePerso',
    'inscriptionElearning', 'organisme', 'correctionPointage']) assert.ok(admis.includes(objet), `${objet} refusé par pieces_objet_check`);
});

test('fenêtres de lecture : table lue par l’instantané, clé entière, sans autre ordre ; condition fonction du seul jour', () => {
  for (const [t, f] of Object.entries(FENETRES) as [TableName, (today: string) => { where: string; params: readonly unknown[] }][]) {
    assert.ok(t in TABLES, `${t} : table inconnue`);
    assert.ok(TABLES_LUES.has(t), `${t} : jamais lue par l’instantané, une fenêtre n'y sert à rien`);
    const def = TABLES[t] as { pk: string; cols: Record<string, string> };
    assert.ok(def.cols[def.pk] === 'int', `${t} : la fusion du delta par clé suppose une clé entière`);
    assert.equal(ORDRE_LECTURE[t], undefined, `${t} : une table à fenêtre se lit dans l'ordre de sa clé`);
    assert.equal(COLONNES_OMISES[t]?.includes(def.pk) ?? false, false);
    const a = f('2026-10-10'), b = f('2026-10-10');
    assert.deepEqual(a, b, `${t} : même jour, même fenêtre`);
    assert.equal(a.where.split('?').length - 1, a.params.length, `${t} : un paramètre par « ? »`);
  }
});

test('délégation : périmètre « planning » connu, mais ni retenu ni accepté tant que le chantier C5 ne l’ouvre pas', () => {
  assert.ok(estPerimetre('planning'));
  assert.ok(PERIMETRES_DELEGATION.planning.label);
  const s = { delegationEntretiens: true, notesFraisActives: true };
  assert.deepEqual(perimetreEffectif(s, { perimetre: ['feuilles', 'planning'] }), ['feuilles']);
  const ds = {
    today: '2026-10-10', settings: s, delegations: [],
    employes: [{ id: 1, equipe: 'A', entree: '2020-01-01', fin: null }, { id: 2, equipe: 'A', entree: '2020-01-01', fin: null }],
    referentiels: { equipes: [{ nom: 'A', managerId: 1, parente: null }] },
  };
  const noms = { suppleant: ds.employes[1], nom: (id: number) => `Salarié ${id}` };
  const refus = (perimetre: string[]) => controleDelegation(ds as never, { managerId: 1, suppleantId: 2, du: '2026-10-12', au: '2026-10-16', perimetre } as never, noms as never);
  assert.equal(refus(['feuilles']), null);
  assert.match(refus(['feuilles', 'planning']) ?? '', /planning/);
});

test('onglets de l’écran Temps de travail : les feuilles d’abord (onglet par défaut), sans doublon', () => {
  assert.equal(ONGLETS_TEMPS[0], 'feuilles');
  assert.equal(new Set(ONGLETS_TEMPS).size, ONGLETS_TEMPS.length);
  const temps = readFileSync('client/src/pages/Temps.tsx', 'utf8');
  for (const o of ONGLETS_TEMPS) assert.ok(temps.includes(`'${o}'`), `${o} : onglet sans libellé dans pages/Temps.tsx`);
});

test('blocs réservés « lot 12 — Cx » posés dans les fichiers partagés', () => {
  const FICHIERS: Record<string, readonly string[]> = {
    'server/src/db.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/lecture-brute.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/vues-cache.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/dataset.ts': ['C1', 'C3', 'C4', 'C5', 'C6'],
    'server/src/journal.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/actions/index.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/elements-lot.ts': ['C1'],
    'server/src/conservation.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'server/src/app.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'tests/support/oracle.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/types.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/reglages.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/journal.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/constants.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/notifications-push.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'shared/hors-ligne.ts': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'client/src/App.tsx': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'client/src/state/store.tsx': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'client/src/layout/Shell.tsx': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    'client/src/pages/Temps.tsx': ['C1', 'C5', 'C6'],
  };
  for (const [f, chantiers] of Object.entries(FICHIERS)) {
    const texte = readFileSync(f, 'utf8');
    for (const c of chantiers) assert.ok(texte.includes(`lot 12 — ${c} (`), `${f} : bloc « lot 12 — ${c} » absent`);
  }
});
