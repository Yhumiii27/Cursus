// Contrat des actions entre le client et le serveur (t164, étape 1). Les familles d'actions sont déclarées avec
// « satisfies Record<string, ActionHandler> » : leurs noms forment le type NomAction (server/src/actions/index.ts), qui
// type `run` (state/store.tsx), `api.action` (api.ts) et `Confirmation.action` (state/confirmations.ts). tsc signale
// donc une faute dans un nom littéral ; ce test relit en plus les sources du client, au cas où un nom passerait par
// une chaîne (`as`, variable mal typée), et vérifie que chaque nom appelé existe dans le registre du serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NomAction } from '../server/src/actions/index.ts';
import type { Store } from '../client/src/state/store.tsx';

const { ACTIONS } = await import('../server/src/actions/index.ts');

const CLIENT = new URL('../client/src/', import.meta.url).pathname;
function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap(f =>
    f.isDirectory() ? sources(join(dossier, f.name)) : /\.tsx?$/.test(f.name) ? [join(dossier, f.name)] : []);
}

/**
 * Noms d'action écrits en toutes lettres dans le client : `run('…')`, `api.action('…')`, les enveloppes des écrans
 * (`agir('…')`, `act('…')`, `agir(c, '…')` des comptes) et les confirmations (`action: '…'`).
 */
const APPEL = /\b(?:run|action|agir|act)\(\s*(?:\w+,\s*)?'([a-zA-Z]+\.[a-zA-Z.]+)'|\baction:\s*'([a-zA-Z]+\.[a-zA-Z.]+)'/g;
function nomsAppeles() {
  const noms = new Map<string, string>();
  for (const f of sources(CLIENT)) {
    for (const m of readFileSync(f, 'utf8').matchAll(APPEL)) noms.set(m[1] ?? m[2], f.slice(CLIENT.length));
  }
  return noms;
}

test('chaque nom d’action appelé par le client existe dans le registre du serveur', () => {
  const noms = nomsAppeles();
  // Garde-fou du relevé lui-même : s'il ne trouvait plus rien (format changé), le test ne prouverait rien.
  assert.ok(noms.size >= 100, `${noms.size} noms relevés seulement`);
  for (const n of ['temps.setCell', 'temps.submit', 'absence.demander', 'absence.decider', 'employe.sortie', 'demande.refuser']) {
    assert.ok(noms.has(n), `${n} devrait être relevé dans le client`);
  }
  const inconnus = [...noms].filter(([n]) => !Object.hasOwn(ACTIONS, n)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(inconnus, [], 'actions appelées par le client mais absentes du serveur');
});

test('les noms construits par le client (gabarits) désignent des actions existantes', () => {
  // Seul gabarit du client : `hab.${action}` (dialogs/HabMesureDialog.tsx), action « suspendre » ou « lever ».
  const gabarits = sources(CLIENT).flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\brun\(`([^`]*)`/g)].map(m => m[1]));
  assert.deepEqual(gabarits, ['hab.${action}']);
  for (const n of ['hab.suspendre', 'hab.lever']) assert.ok(Object.hasOwn(ACTIONS, n), n);
});

test('le registre garde les noms de chaque famille : NomAction couvre toutes les actions', () => {
  // Contrôlé par tsc (npm run typecheck) : un nom inconnu n'est pas un NomAction, un nom existant l'est.
  // @ts-expect-error — nom d'action inexistant, refusé à la compilation.
  const faux: NomAction = 'temps.soumetre';
  const vrai: NomAction = 'temps.submit';
  type Run = Store['run'];
  // @ts-expect-error — `run` refuse lui aussi un nom inconnu.
  const appel: Parameters<Run>[0] = 'absence.demande';
  assert.ok(!Object.hasOwn(ACTIONS, faux) && !Object.hasOwn(ACTIONS, appel));
  assert.ok(Object.hasOwn(ACTIONS, vrai));
  // Chaque nom est une chaîne « famille.action » et chaque entrée une fonction.
  for (const [n, h] of Object.entries(ACTIONS)) {
    assert.match(n, /^[a-zA-Z]+(\.[a-zA-Z]+)+$/, n);
    assert.equal(typeof h, 'function', n);
  }
});
