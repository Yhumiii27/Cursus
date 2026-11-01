// Banc de rendu d'un écran ou d'un dialogue du client (t159, étape 2) sur une base de démonstration en mémoire, à
// importer après tests/outils/rendu.ts. Le magasin factice (store-factice.ts) reçoit l'instantané de la personne et
// un `run` qui exécute la vraie action du serveur (server/src/actions) avec ses droits : le contenu envoyé par le
// dialogue doit être accepté par le serveur, et l'écran se redessine avec l'instantané renvoyé, comme dans le navigateur.
import { createElement, useState, type ReactElement } from 'react';
import type { ActionResponse, NomAction } from '../../client/src/api.ts';
import type { DialogState, Store, UiState } from '../../client/src/state/store.tsx';
import { ACTIONS } from '../../server/src/actions/index.ts';
import { ActionError, makeCtx } from '../../server/src/actions/context.ts';
import { SqliteDb } from '../../server/src/db.ts';
import { buildSnapshot, currentUser, loadFull } from '../../server/src/dataset.ts';
import { seedDemo } from '../../server/src/seed.ts';
import type { Role } from '../../shared/types.ts';
import { poserMagasin } from './store-factice.ts';

/** État de l'interface au démarrage (INITIAL_UI de state/store.tsx), à compléter par le test. */
export const UI_DEPART: UiState = {
  horizon: null, search: '', equipe: 'Toutes', statut: 'tous', selectedId: null, typeForm: 'toutes', formationFilter: null,
  habFilter: 'tous', habType: null, tripSel: null, echType: 'tous', goSel: null, exercice: 2026, planFilter: 'tous', weekStart: null, tsEmp: null,
  refOnglet: 'formations', tsJour: null, tris: {},
  // lot 11 — dossiers OPCO
  budgetOnglet: 'plan', opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null, opcoSel: null,
};

type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Base de démonstration neuve (une par test : les actions y écrivent). Comptes : `null` pour l'administratrice RH
 * (Sandrine Vidal, sans fiche), sinon le salarié du compte (14 gestionnaire RH, 12 manager de la Maintenance, 2
 * collaborateur de la Maintenance).
 */
export async function baseDemo() {
  // SQLite sur les deux moteurs de test : les clics du banc (act) n'attendent que les microtâches, que les échanges avec
  // un serveur PostgreSQL dépasseraient ; l'écran ne dépend pas du moteur, les actions sont vérifiées par les autres tests.
  const db = new SqliteDb(':memory:');
  await seedDemo(db);
  const personne = async (empId: number | null, role: Role): Promise<User> => {
    const c = ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
    return (await currentUser(db, { compteId: c, role, methode: 'demo' }))!;
  };
  return { db, personne };
}

/** Ce que l'écran a fait : actions envoyées (et réponse du serveur), dialogues ouverts, fermeture, messages. */
export interface Trace {
  actions: { name: NomAction; payload: Record<string, unknown>; r: ActionResponse }[];
  ouverts: DialogState[];
  fermetures: number;
  messages: { text: string; error: boolean }[];
}

/**
 * Monte `vue()` pour la personne `user` : magasin posé, puis redessiné après chaque action réussie et chaque
 * changement de `ui` (setUi), avec le nouvel instantané. Rend la trace et l'accès à la base.
 */
export async function monter(db: SqliteDb, user: User, vue: () => ReactElement, ui: Partial<UiState> = {}) {
  const trace: Trace = { actions: [], ouverts: [], fermetures: 0, messages: [] };
  let data = await buildSnapshot(db, user);
  let etat: UiState = { ...UI_DEPART, horizon: data.settings.horizonAlerte, ...ui };
  let redessiner = () => {};
  const notify = (text: string, error = false) => { trace.messages.push({ text, error }); };
  const run = async (name: NomAction, payload: Record<string, unknown> = {}, opts?: { silent?: boolean }): Promise<ActionResponse> => {
    let r: ActionResponse;
    try {
      // Comme POST /api/actions/:nom : action dans une transaction, puis instantané relu.
      const out = await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
      const message = out && typeof out === 'object' ? out.message : out;
      data = await buildSnapshot(db, user);
      r = { ok: true, message, result: out && typeof out === 'object' ? out.result : undefined, data };
      if (message && !opts?.silent) notify(message);
    } catch (err) {
      r = { ok: false, message: null, error: (err as Error).message, status: err instanceof ActionError ? err.status : 500 };
      notify(r.error!, true);
    }
    trace.actions.push({ name, payload, r });
    poser();
    redessiner();
    return r;
  };
  const poser = () => poserMagasin({
    data, ui: etat, run, notify, reconnexion: null, dialog: null, session: null,
    setUi: (p: Partial<UiState>) => { etat = { ...etat, ...p }; poser(); redessiner(); },
    openDialog: (d: DialogState) => { trace.ouverts.push(d); },
    closeDialog: () => { trace.fermetures++; },
    go: () => {}, prendreChamps: () => null, fermerNotification: () => {},
  } as Partial<Store>);
  poser();
  function Banc() {
    const [, setN] = useState(0);
    // Banc de test : le rendu publie son « redessiner » pour que run et setUi relancent l'écran.
    // oxlint-disable-next-line react/globals -- voulu, un seul banc monté à la fois
    redessiner = () => setN(n => n + 1);
    return vue();
  }
  return { trace, element: createElement(Banc), donnees: () => data };
}
