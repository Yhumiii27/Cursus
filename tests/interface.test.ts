// Robustesse de l'interface : appels sans réponse abandonnés avec un message en français, messages des
// erreurs HTTP, actions identiques jamais envoyées deux fois en même temps, second clic d'un double clic
// ignoré, saisie modifiée d'un dialogue détectée, sections d'un compte rendu enregistrées au fil de la saisie
// (refus signalé, abandon respecté) ; côté serveur, transitions qui ne se refont pas
// (action du plan, décision d'absence, ligne de feuille de temps) quand l'écran envoie l'état attendu.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { api, DELAI_ACTION_MS, DELAI_LECTURE_MS, messageHttp, MSG_DELAI, MSG_DELAI_ACTION, MSG_RESEAU } = await import('../client/src/api.ts');
const { AppelsEnCours, cleAction, garde } = await import('../client/src/state/actions.ts');
const { saisieModifiee } = await import('../client/src/state/brouillon.ts');
const { EnregistrementAuFil } = await import('../client/src/state/enregistrement.ts');
const { nouvelleBase, json: jsonLu } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
type User = Parameters<typeof buildSnapshot>[1];

const fetchOrigine = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOrigine; });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// — Appels à l'API —

test('serveur sans réponse : appel abandonné après le délai, message en français selon lecture ou action', async () => {
  const delais: (number | null)[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    delais.push(init?.signal instanceof AbortSignal ? 1 : null);
    throw new DOMException('signal timed out', 'TimeoutError');
  }) as typeof fetch;
  await assert.rejects(api.session(), (e: Error & { status: number }) => e.message === MSG_DELAI && e.status === 0);
  await assert.rejects(api.data('rh'), (e: Error) => e.message === MSG_DELAI);
  const r = await api.action('plan.avancer', { id: 1 }, 'rh');
  assert.deepEqual([r.ok, r.error, r.status], [false, MSG_DELAI_ACTION, 0]);
  assert.match(MSG_DELAI_ACTION, /a pu être enregistrée/);
  assert.deepEqual(delais, [1, 1, 1], 'chaque appel porte un délai');
  assert.ok(DELAI_LECTURE_MS < DELAI_ACTION_MS);
});

test('corps de réponse interrompu par le délai : même message ; corps illisible sans délai : statut HTTP', async () => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('signal timed out', 'TimeoutError'); } })) as unknown as typeof fetch;
  await assert.rejects(api.data(), (e: Error) => e.message === MSG_DELAI);
  globalThis.fetch = (async () => new Response('<html>Payload Too Large</html>', { status: 413 })) as typeof fetch;
  const r = await api.action('plan.importer', { texte: 'x'.repeat(10) });
  assert.equal(r.error, messageHttp(413));
  assert.match(r.error!, /trop volumineux/);
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  await assert.rejects(api.session(), (e: Error) => e.message === MSG_RESEAU && !/Failed/.test(e.message));
});

test('erreurs HTTP sans message de Cursus : en français, jamais « Erreur 500 » seul', () => {
  assert.match(messageHttp(502), /^Serveur indisponible \(erreur 502\)/);
  assert.match(messageHttp(500), /^Erreur du serveur \(erreur 500\) : réessayez/);
  assert.match(messageHttp(404), /^Requête refusée par le serveur \(erreur 404\)/);
});

test('message de Cursus prioritaire sur le message générique', async () => {
  globalThis.fetch = (async () => await json(400, { error: 'Demande introuvable ou déjà traitée' })) as typeof fetch;
  const r = await api.action('absence.decider', { id: 1, ok: true });
  assert.equal(r.error, 'Demande introuvable ou déjà traitée');
});

// — Actions lancées depuis l'interface —

/** Promesse résolue à la demande. */
function differee<T>() {
  let resoudre!: (v: T) => void;
  const p = new Promise<T>(r => { resoudre = r; });
  return { p, resoudre };
}

test('même action déjà en cours : une seule requête, la même réponse pour les deux appels', async () => {
  const appels = new AppelsEnCours<string>();
  let n = 0;
  const d = differee<string>();
  const cle = cleAction('plan.avancer', { id: 4, de: 'prevu' });
  const a = appels.lancer(cle, () => { n++; return d.p; });
  const b = appels.lancer(cleAction('plan.avancer', { id: 4, de: 'prevu' }), () => { n++; return d.p; });
  const autre = appels.lancer(cleAction('plan.avancer', { id: 5, de: 'prevu' }), async () => { n++; return 'autre'; });
  assert.equal(appels.taille, 2);
  d.resoudre('engagé');
  assert.deepEqual(await Promise.all([a, b, autre]), ['engagé', 'engagé', 'autre']);
  assert.equal(n, 2, 'la seconde demande identique n’est pas envoyée');
  assert.equal(appels.taille, 0);
  // Une fois la réponse reçue, la même action peut être relancée (nouvelle intention).
  await appels.lancer(cle, async () => { n++; return 'réalisé'; });
  assert.equal(n, 3);
  // Un échec libère aussi la clé.
  await assert.rejects(appels.lancer('x', async () => { throw new Error('refus'); }));
  assert.equal(appels.taille, 0);
});

test('même action déjà en cours, mais un autre appel de cette action parti depuis : la dernière intention est envoyée', async () => {
  const appels = new AppelsEnCours<string>();
  const envoyes: boolean[] = [];
  const d = differee<string>();
  const info = (v: boolean) => appels.lancer(cleAction('entretien.modifier', { id: 42, info: v }), () => { envoyes.push(v); return d.p; }, 'entretien.modifier');
  // Case cochée, décochée puis recochée avant les réponses : le serveur doit finir sur « cochée ».
  const a = info(true), b = info(false), c = info(true);
  assert.deepEqual(envoyes, [true, false, true]);
  assert.equal(appels.taille, 3, 'la relecture périodique attend les trois réponses');
  // Double clic sur la dernière : toujours dédoublonné.
  const c2 = info(true);
  assert.equal(envoyes.length, 3);
  d.resoudre('ok');
  await Promise.all([a, b, c, c2]);
  assert.equal(appels.taille, 0);
  // Une autre action entre-temps ne compte pas : le groupe est le nom de l'action.
  const e = differee<string>();
  const avancer = () => appels.lancer(cleAction('plan.avancer', { id: 4, de: 'prevu' }), () => { envoyes.push(true); return e.p; }, 'plan.avancer');
  const p1 = avancer();
  void appels.lancer(cleAction('absence.decider', { id: 3, ok: true }), async () => 'ok', 'absence.decider');
  const p2 = avancer();
  assert.equal(envoyes.length, 4, 'double clic sur « Engager » : un seul envoi');
  e.resoudre('engagé');
  assert.deepEqual(await Promise.all([p1, p2]), ['engagé', 'engagé']);
});

test('boutons d’action : second clic d’un double clic ignoré, aucun autre clic pendant l’appel', async () => {
  const etats: boolean[] = [];
  const agir = garde(o => etats.push(o));
  let n = 0, arrets = 0;
  const d = differee<void>();
  const action = () => { n++; return d.p; };
  const clic = (detail: number) => ({ detail, stopPropagation: () => { arrets++; } });
  agir(action)(clic(1));
  agir(action)(clic(2)); // second clic du double clic
  agir(action)(clic(1)); // nouveau clic pendant l'appel
  await Promise.resolve();
  assert.equal(n, 1);
  assert.equal(arrets, 3, 'le clic ne remonte jamais à la ligne du tableau');
  d.resoudre();
  await d.p;
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(etats, [true, false]);
  agir(action)(clic(2));
  await Promise.resolve();
  assert.equal(n, 1, 'un double clic arrivé après la réponse ne relance rien (l’écran a pu changer sous le pointeur)');
  agir(action)(clic(0)); // clavier (Entrée, Espace)
  agir(action)(); // changement d'une liste
  await new Promise(r => setTimeout(r, 0));
  assert.equal(n, 2);
});

test('dialogue : saisie modifiée détectée par rapport aux valeurs de départ', () => {
  const depart = { '#nom': 'Mehdi', '#actif': true, 'radio:mode:0': true };
  assert.equal(saisieModifiee(depart, { ...depart }), false);
  assert.equal(saisieModifiee(depart, { ...depart, '#nom': 'Mehdi B.' }), true);
  assert.equal(saisieModifiee(depart, { ...depart, '#actif': false }), true);
  assert.equal(saisieModifiee(depart, { ...depart, '#motif': '' }), false, 'champ apparu, vide');
  assert.equal(saisieModifiee(depart, { ...depart, '#motif': 'Retard' }), true, 'champ apparu, rempli');
  assert.equal(saisieModifiee(null, { '#csv': '' }), false);
  assert.equal(saisieModifiee(null, { '#csv': 'nom;equipe' }), true, 'sans relevé de départ, une valeur compte');
  assert.equal(saisieModifiee(depart, null), false);
});

// — Compte rendu d'entretien : enregistrement au fil de la saisie —

/** Enregistrement d'essai : le serveur accepte ou refuse selon `refus`, les envois et l'état des sections sont relevés. */
function compteRendu(initial: Record<string, string> = {}) {
  const envois: [string, string][] = [];
  const etat: Record<string, string | null> = {};
  const serveur = { refus: null as string | null };
  const e = new EnregistrementAuFil(
    initial,
    async (k, v) => { envois.push([k, v]); return serveur.refus ? { ok: false, error: serveur.refus } : { ok: true }; },
    (k, refus) => { etat[k] = refus; },
  );
  return { e, envois, etat, serveur };
}

test('compte rendu : une section refusée n’est pas réputée enregistrée, la clôture la signale', async () => {
  const { e, envois, etat, serveur } = compteRendu({ bilan: 'Ancien bilan' });
  serveur.refus = 'Section non modifiable';
  await e.enregistrer('bilan', 'Nouveau bilan');
  assert.equal(etat.bilan, 'Section non modifiable');
  // Avant la clôture : la section refusée est renvoyée, toujours refusée, donc signalée.
  assert.deepEqual(await e.toutEnregistrer(['bilan', 'objectifs'], { bilan: 'Nouveau bilan', objectifs: '' }), ['bilan']);
  assert.equal(envois.length, 2, 'la même valeur, refusée, repart');
  serveur.refus = null;
  assert.deepEqual(await e.toutEnregistrer(['bilan', 'objectifs'], { bilan: 'Nouveau bilan', objectifs: '' }), []);
  assert.equal(etat.bilan, null);
  await e.enregistrer('bilan', 'Nouveau bilan');
  assert.equal(envois.length, 3, 'enregistrée : pas de nouvel envoi de la même valeur');
});

test('compte rendu : « Fermer sans enregistrer » n’envoie plus rien, ni au démontage du dialogue', async () => {
  const { e, envois, serveur } = compteRendu();
  serveur.refus = 'Section non modifiable';
  // Fermeture : l'enregistrement échoue, la confirmation propose de fermer sans enregistrer.
  assert.deepEqual(await e.toutEnregistrer(['bilan'], { bilan: 'Texte abandonné' }), ['bilan']);
  assert.equal(envois.length, 1);
  e.abandonner();
  serveur.refus = null; // le réseau ou les droits reviennent : rien ne doit partir pour autant
  // Démontage du dialogue (dernier envoi de ce qui reste) et champ quitté : aucun envoi.
  assert.deepEqual(await e.toutEnregistrer(['bilan'], { bilan: 'Texte abandonné' }), ['bilan']);
  await e.enregistrer('bilan', 'Texte abandonné, complété');
  assert.equal(envois.length, 1, 'le texte abandonné n’arrive jamais dans le compte rendu');
});

// — Transitions côté serveur —

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: '' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
  return { db, run };
}

test('plan : un second « Engager » n’avance pas l’action jusqu’à « Réalisé »', async () => {
  const { db, run } = await fresh();
  const id = (await db.insert<{ id: number }>('planActions', {
    exercice: 2026, f: null, libelle: 'Lean management', equipe: 'Production', periode: 'T4', effectif: 4, cout: 2400, statut: 'prevu', origine: 'import',
  })).id;
  const statut = async () => ((await db.one('SELECT statut FROM plan_actions WHERE id = ?', [id])) as { statut: string }).statut;
  assert.match(String(await run(RH, 'plan.avancer', { id, de: 'prevu' })), /Lean management — Production · engagé/);
  assert.match(String(await run(RH, 'plan.avancer', { id, de: 'prevu' })), /déjà engagé/);
  assert.equal((await statut()), 'engage');
  await run(RH, 'plan.avancer', { id, de: 'engage', coutReel: 2400 });
  assert.match(String(await run(RH, 'plan.avancer', { id, de: 'engage' })), /déjà réalisé/);
  assert.match(String(await run(RH, 'plan.avancer', { id, de: 'prevu' })), /déjà réalisé/);
  assert.equal((await statut()), 'realise');
  // Revenue « prévue » (session annulée) pendant que l'écran affichait « Clôturer » : refus, rien n'est clôturé.
  await db.update('planActions', id, { statut: 'prevu' });
  await assert.rejects(async () => await run(RH, 'plan.avancer', { id, de: 'engage' }), /de nouveau prévue/);
  await assert.rejects(async () => await run(RH, 'plan.avancer', { id, de: 'realise' }), /Statut attendu invalide/);
  assert.equal((await statut()), 'prevu');
  // Sans statut attendu (ancien client) : avance d'un cran, refus une fois réalisée.
  await run(RH, 'plan.avancer', { id });
  await run(RH, 'plan.avancer', { id, coutReel: 2400 });
  await assert.rejects(async () => await run(RH, 'plan.avancer', { id }), /déjà réalisée/);
  await assert.rejects(async () => await run(KARIM, 'plan.avancer', { id, de: 'prevu' }), /réservée au service RH/);
});

test('absence : la même décision prise deux fois n’est ni refaite ni renvoyée à Keystone', async () => {
  const { db, run } = await fresh();
  const a = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`)) as { id: number };
  const envois = async () => ((await db.one(`SELECT COUNT(*) AS n FROM envois WHERE type = 'absence.validee'`)) as { n: number }).n;
  const avant = (await envois());
  assert.match(String(await run(KARIM, 'absence.decider', { id: a.id, ok: true })), /validée — transmise à Keystone/);
  assert.equal(String(await run(KARIM, 'absence.decider', { id: a.id, ok: true })), 'Absence de Mehdi Benali déjà validée');
  assert.equal(String(await run(RH, 'absence.decider', { id: a.id, ok: true })), 'Absence de Mehdi Benali déjà validée');
  assert.equal((await envois()), avant + 1, 'un seul message pour Keystone');
  // Décision contraire, ou personne hors périmètre : refus, comme avant.
  await assert.rejects(async () => await run(KARIM, 'absence.decider', { id: a.id, ok: false }), /déjà traitée/);
  await assert.rejects(async () => await run(HUGO, 'absence.decider', { id: a.id, ok: true }), /déjà traitée/);
  await assert.rejects(async () => await run(MEHDI, 'absence.decider', { id: a.id, ok: true }), /déjà traitée/);
  const statut = (await db.one('SELECT statut FROM absences WHERE id = ?', [a.id])) as { statut: string };
  assert.equal(statut.statut, 'validee');
  // Refus répété : sans erreur non plus.
  const b = (await db.one(`SELECT id FROM absences WHERE emp_id = 1 AND statut = 'demandee'`)) as { id: number };
  await run(RH, 'absence.decider', { id: b.id, ok: false });
  assert.match(String(await run(RH, 'absence.decider', { id: b.id, ok: false })), /déjà refusée/);
});

test('feuille de temps : la croix supprime la ligne visée, jamais la suivante', async () => {
  const { db, run } = await fresh();
  const week = '2026-10-12';
  const lignes = async () => ((await db.one('SELECT lignes FROM feuilles WHERE emp_id = 2 AND week = ?', [week])) as { lignes: string } | undefined);
  const projets = async () => (jsonLu((await lignes())!.lignes) as { projet: string }[]).map(l => l.projet);
  await run(MEHDI, 'temps.addLine', { empId: 2, week, projet: 'INT-MAINT' });
  await run(MEHDI, 'temps.addLine', { empId: 2, week, projet: 'K-2620' });
  await run(MEHDI, 'temps.addLine', { empId: 2, week, projet: 'INT-QUA' });
  assert.deepEqual(await projets(), ['INT-MAINT', 'K-2620', 'INT-QUA']);
  // Ligne visée : projet et tâche affichés, nombre de lignes de la feuille affichée.
  const ligne0 = { empId: 2, week, li: 0, projet: 'INT-MAINT', tache: (jsonLu((await lignes())!.lignes) as { tache: string }[])[0].tache, lignes: 3 };
  await run(MEHDI, 'temps.removeLine', ligne0);
  // Second clic (même demande) : la ligne n'existe plus, rien n'est supprimé.
  assert.equal(await run(MEHDI, 'temps.removeLine', ligne0), null);
  assert.deepEqual(await projets(), ['K-2620', 'INT-QUA']);
  // Feuille changée entre-temps (ligne ajoutée ailleurs, lignes déplacées) : refus.
  await run(KARIM, 'temps.addLine', { empId: 2, week, projet: 'INT-PROD' });
  await assert.rejects(async () => await run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 1, projet: 'INT-QUA', lignes: 2 }), /La feuille a changé entre-temps/);
  await assert.rejects(async () => await run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 0, projet: 'INT-QUA', lignes: 3 }), /La feuille a changé entre-temps/);
  assert.deepEqual(await projets(), ['K-2620', 'INT-QUA', 'INT-PROD']);
  await run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 1, projet: 'INT-QUA', lignes: 3 });
  assert.deepEqual(await projets(), ['K-2620', 'INT-PROD']);
  // Sans ligne visée (ancien client) : suppression par l'indice, comme avant.
  await run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 0 });
  assert.deepEqual(await projets(), ['INT-PROD']);
});
