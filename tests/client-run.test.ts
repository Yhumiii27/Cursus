// Exécution des actions du client et reprise après l'expiration de la session (t159, étape 2 : client/src/state/run.ts,
// sorti de state/store.tsx). Sans navigateur : l'appel de l'API et les suites (instantané, message, attente, relecture)
// sont des fonctions espionnées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionResponse, NomAction } from '../client/src/api.ts';
import type { Dataset } from '../shared/types.ts';

const { AppelsEnCours } = await import('../client/src/state/actions.ts');
const { executeurActions, FileAttente, lancerAction, NON_ENREGISTREE, rejouable, suiteReconnexion } = await import('../client/src/state/run.ts');
type Attente = Parameters<InstanceType<typeof FileAttente>['ajouter']>[0];

/** Réponse différée : le test choisit quand le serveur répond. */
function differee<T>() {
  let resoudre!: (v: T) => void;
  const p = new Promise<T>(r => { resoudre = r; });
  return { p, resoudre };
}
const instantane = (n: number) => ({ revision: n }) as unknown as Dataset;

/** Magasin espionné : réponses du serveur dans l'ordre de `reponses`, file d'attente réelle. */
function banc(reponses: ActionResponse[], o: { connecte?: boolean } = {}) {
  const j = {
    appels: [] as { name: string; payload: Record<string, unknown> }[],
    recus: [] as Dataset[], messages: [] as [string, boolean][], suivis: 0, relus: 0,
    file: new FileAttente(),
  };
  const executer = executeurActions({
    appeler: async (name, payload) => {
      j.appels.push({ name, payload });
      const r = reponses.shift();
      if (!r) throw new Error('réponse inattendue');
      return r;
    },
    connecte: () => o.connecte ?? true,
    recevoir: d => j.recus.push(d),
    notifier: (t, e = false) => j.messages.push([t, e]),
    attendre: (a: Attente) => { j.file.ajouter(a); },
    suivre: () => { j.suivis++; },
    rafraichir: () => { j.relus++; },
  });
  return { j, executer };
}

test('action réussie : instantané reçu et message affiché, sauf en silence', async () => {
  const { j, executer } = banc([{ ok: true, message: 'Feuille soumise', data: instantane(3) }, { ok: true, message: 'Enregistré' }]);
  const r = await executer('temps.submit', { empId: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(j.recus, [instantane(3)]);
  assert.deepEqual(j.messages, [['Feuille soumise', false]]);
  await executer('temps.setCell', {}, { silent: true });
  assert.equal(j.messages.length, 1, 'silent : pas de message');
  assert.equal(j.relus + j.suivis, 0);
});

test('refus : message d’erreur et relecture ; 409 : l’onglet suit la session sans relire', async () => {
  const { j, executer } = banc([
    { ok: false, message: null, error: 'Demande déjà traitée', status: 400 },
    { ok: false, message: null, status: 403 },
    { ok: false, message: null, error: 'Espace changé', status: 409 },
  ]);
  await executer('absence.decider', { id: 1 });
  await executer('absence.decider', { id: 2 });
  assert.deepEqual(j.messages, [['Demande déjà traitée', true], ['Action impossible', true]]);
  assert.equal(j.relus, 2);
  const r = await executer('absence.decider', { id: 3 });
  assert.equal(r.status, 409);
  assert.equal(j.suivis, 1);
  assert.equal(j.relus, 2, '409 : rien n’a été fait, pas de relecture');
});

test('session expirée : l’action attend la reconnexion puis est rejouée, l’écran reçoit la réponse rejouée', async () => {
  const { j, executer } = banc([
    { ok: false, message: null, status: 401 },
    { ok: true, message: 'Congé demandé', data: instantane(5) },
  ]);
  let fini: ActionResponse | null = null;
  const p = executer('absence.demander', { type: 'cp' }).then(r => { fini = r; return r; });
  await new Promise(r => setImmediate(r));
  assert.equal(fini, null, 'l’écran attend');
  assert.equal(j.file.taille, 1);
  assert.deepEqual(j.messages, [], 'aucune erreur affichée pendant l’attente');
  await j.file.rejouerTout();
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.message, 'Congé demandé');
  assert.equal(j.appels.length, 2);
  assert.deepEqual(j.appels[1], { name: 'absence.demander', payload: { type: 'cp' } }, 'même action, mêmes paramètres');
  assert.equal(j.file.taille, 0);
});

test('session expirée puis abandon (« Changer de compte ») : « action non enregistrée »', async () => {
  const { j, executer } = banc([{ ok: false, message: null, status: 401 }, { ok: false, message: null, status: 401 }]);
  const p1 = executer('temps.submit', { empId: 2 });
  const p2 = executer('absence.demander', {});
  await new Promise(r => setImmediate(r));
  assert.equal(j.file.taille, 2);
  j.file.abandonnerTout();
  for (const r of await Promise.all([p1, p2])) assert.deepEqual(r, { ok: false, message: null, error: NON_ENREGISTREE, status: 401 });
  assert.equal(j.appels.length, 2, 'rien n’est renvoyé');
  assert.equal(j.relus, 0);
});

test('401 sans personne connectée : rien en attente, pas de relecture (l’écran de connexion s’affiche)', async () => {
  const { j, executer } = banc([{ ok: false, message: null, error: 'Non connecté', status: 401 }], { connecte: false });
  const r = await executer('temps.submit', {});
  assert.equal(r.status, 401);
  assert.equal(j.file.taille, 0);
  assert.deepEqual(j.messages, [['Non connecté', true]]);
  assert.equal(j.relus + j.suivis, 0);
});

test('les actions rejouées partent une à une, dans l’ordre où elles ont été lancées', async () => {
  const file = new FileAttente();
  const ordre: string[] = [];
  const d1 = differee<void>();
  file.ajouter({ rejouer: async () => { ordre.push('1 début'); await d1.p; ordre.push('1 fin'); }, abandonner: () => {} });
  assert.equal(file.ajouter({ rejouer: async () => { ordre.push('2'); }, abandonner: () => {} }), 2);
  const fin = file.rejouerTout();
  assert.equal(file.taille, 0, 'file vidée tout de suite : une nouvelle expiration repart de zéro');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(ordre, ['1 début'], 'la deuxième attend la réponse de la première');
  d1.resoudre();
  await fin;
  assert.deepEqual(ordre, ['1 début', '1 fin', '2']);
});

test('double clic : la même action en cours rend la même réponse, sans second appel', async () => {
  const appels = new AppelsEnCours<ActionResponse>();
  const d = differee<ActionResponse>();
  let n = 0;
  const executer = (_name: NomAction, _payload: Record<string, unknown>) => { n++; return d.p; };
  const a = lancerAction(appels, executer, 'temps.submit', { empId: 2 });
  const b = lancerAction(appels, executer, 'temps.submit', { empId: 2 });
  assert.equal(n, 1);
  assert.equal(appels.taille, 1);
  // Autres paramètres : un autre appel.
  lancerAction(appels, executer, 'temps.submit', { empId: 3 });
  assert.equal(n, 2);
  d.resoudre({ ok: true, message: 'ok' });
  assert.strictEqual(await a, await b);
});

test('reconnexion : reprise dans l’espace d’origine, abandon pour un mot de passe à remplacer ou un autre compte', () => {
  const compte = { id: 7, identifiant: 'k.haddad', espaces: ['manager', 'collaborateur'] } as never;
  const rc = { compte, role: 'manager' as const };
  // Même compte, connexion ouverte sur le premier espace : retour à l'espace « manager ».
  assert.deepEqual(suiteReconnexion(rc, { role: 'collaborateur', user: {}, compte }), { quoi: 'reprendre', espace: 'manager' });
  assert.deepEqual(suiteReconnexion(rc, { role: 'manager', user: {}, compte }), { quoi: 'reprendre', espace: null });
  // Espace retiré entre-temps : rien à rétablir, et les actions ne sont pas rejouées ailleurs.
  const retire = { id: 7, identifiant: 'k.haddad', espaces: ['collaborateur'] } as never;
  assert.deepEqual(suiteReconnexion(rc, { role: 'collaborateur', user: {}, compte: retire }), { quoi: 'reprendre', espace: null });
  assert.equal(rejouable(rc, { role: 'collaborateur' }), false);
  assert.equal(rejouable(rc, { role: 'manager' }), true);
  // Mot de passe provisoire à remplacer (pas de personne connectée) ; autre compte.
  assert.deepEqual(suiteReconnexion(rc, { role: 'manager', user: null, compte }), { quoi: 'remplacer', autreCompte: false });
  assert.deepEqual(suiteReconnexion(rc, { role: 'manager', user: {}, compte: { id: 9, espaces: ['manager'] } as never }), { quoi: 'remplacer', autreCompte: true });
});
