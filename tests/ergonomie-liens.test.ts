// Ergonomie, étape 1 (lot 6, chantier 6) : sélection et filtres dans l'adresse de la page (t154), retour au dialogue
// « Planifier » après « Créer une session » (t107), planning des missions lisible sans la couleur (t148).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { pageDeRetour } = await import('../server/src/microsoft.ts');
const { Domain } = await import('../shared/domain.ts');
const { adresse, ecrireUrl, lireUrl, ouvreUneFiche, pageDeRetourClient, PARAMS_URL, RETOUR_MAX } = await import('../client/src/state/url.ts');
const { apresCreation, sessionPreselectionnee } = await import('../client/src/dialogs/retour-session.ts');
const { lireBrouillon, sauverBrouillon, effacerBrouillon } = await import('../client/src/state/brouillon.ts');
const { MARQUE, planningMissions, resumeLigne } = await import('../client/src/pages/planning-missions.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type UiState = import('../client/src/state/store.tsx').UiState;

/** État de départ de l'écran (INITIAL_UI de client/src/state/store.tsx). */
const UI: UiState = {
  horizon: null, search: '', equipe: 'Toutes', statut: 'tous', selectedId: null, typeForm: 'toutes', formationFilter: null,
  habFilter: 'tous', habType: null, tripSel: null, echType: 'tous', goSel: null, exercice: null, planFilter: 'tous', weekStart: null, tsEmp: null,
  refOnglet: 'formations', tsJour: null, tris: {},
  // lot 11 — organigramme
  orgEntite: null, orgSite: null,
};

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const r = ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    return typeof r === 'object' && r !== null ? r : { message: r };
  });
  return { db, run, RH: await user(null, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}

// — t154 : état dans l'adresse —

test('adresse : paramètres en français, valeurs par défaut absentes, jamais la recherche en texte libre', async () => {
  const { db, RH } = await fresh();
  const ds = await buildSnapshot(db, RH);
  const id = ds.employes[0].id, eq = ds.referentiels.equipes[0].nom;
  const ui: UiState = { ...UI, selectedId: id, statut: 'due', equipe: eq, search: 'Dupont' };
  const q = ecrireUrl('collaborateurs', ui);
  assert.equal(q, `?fiche=${id}&equipe=${encodeURIComponent(eq).replace(/%20/g, '+')}&statut=a-renouveler`);
  assert.ok(!q.includes('Dupont'), 'la recherche reste en mémoire');
  assert.equal(ecrireUrl('collaborateurs', UI), '', 'écran par défaut : adresse sans paramètre');
  assert.equal(adresse('temps', { ...UI, tsEmp: id, weekStart: '2027-01-04' }), `/temps?salarie=${id}&semaine=2027-01-04`);
  assert.equal(ecrireUrl('echeances', { ...UI, echType: 'med' }), '?type=visites-medicales');
  assert.equal(ecrireUrl('referentiels', { ...UI, refOnglet: 'activites' }), '?onglet=activites');
  assert.equal(ecrireUrl('dashboard', ui), '', 'vue sans paramètre');
  // Aller-retour : chaque vue relit exactement ce qu'elle écrit.
  const cas: [Parameters<typeof ecrireUrl>[0], Partial<UiState>][] = [
    ['collaborateurs', { selectedId: id, statut: 'sortis', equipe: '' }],
    ['temps', { tsEmp: id, weekStart: '2026-10-05' }],
    ['formations', { formationFilter: ds.referentiels.formations[0].id, typeForm: 'int' }],
    ['habilitations', { habType: ds.referentiels.habilitations[0].id, habFilter: 'pending' }],
    ['voyages', { tripSel: ds.voyages[0].id }],
    ['chantiers', { goSel: ds.referentiels.chantiers[0].id }],
    ['budget', { exercice: 2027, planFilter: 'engage' }],
  ];
  for (const [v, patch] of cas) {
    const lu = lireUrl(v, ecrireUrl(v, { ...UI, ...patch }), ds);
    for (const [k, val] of Object.entries(patch)) assert.equal(lu[k as keyof UiState], val, `${v}.${k}`);
  }
  // Toutes les vues déclarées ont des noms de paramètre distincts.
  for (const [v, ps] of Object.entries(PARAMS_URL)) assert.equal(new Set(ps!.map(p => p.nom)).size, ps!.length, v);
});

test('adresse : valeur invalide ou inconnue ignorée sans erreur, la vue s’ouvre sans sélection', async () => {
  const { db, RH } = await fresh();
  const ds = await buildSnapshot(db, RH);
  const lu = (v: string, q: string) => lireUrl(v, q, ds);
  for (const q of ['?fiche=999999', '?fiche=12abc', '?fiche=1e1', '?fiche=-3', '?fiche=', '?fiche=0'])
    assert.equal(lu('collaborateurs', q).selectedId, null, q);
  assert.equal(lu('collaborateurs', '?statut=tout-va-bien').statut, 'tous');
  assert.equal(lu('collaborateurs', '?statut=due').statut, 'tous', 'code interne refusé : seul le libellé français est lu');
  assert.equal(lu('collaborateurs', '?equipe=Équipe+inventée').equipe, 'Toutes');
  assert.equal(lu('temps', '?semaine=2026-10-07').weekStart, null, 'un mercredi n’est pas un début de semaine');
  assert.equal(lu('temps', '?semaine=2026-02-30').weekStart, null);
  assert.equal(lu('budget', '?exercice=1900').exercice, null);
  assert.equal(lu('formations', '?formation=inconnue').formationFilter, null);
  assert.equal(lu('voyages', '?voyage=424242').tripSel, null);
  // Paramètre inconnu, code d'échec de la connexion Microsoft : ignorés ; rien d'autre que les champs de la vue.
  assert.deepEqual(Object.keys(lu('voyages', '?connexion=refus&dialogue=sortie&voyage=1')), ['tripSel']);
});

test('adresse : un salarié hors du périmètre du manager est ignoré (le serveur a déjà filtré le jeu de données)', async () => {
  const { db, RH, KARIM, MEHDI } = await fresh();
  const tous = (await buildSnapshot(db, RH)).employes.map(e => e.id);
  const equipe = await buildSnapshot(db, KARIM);
  const dehors = tous.find(id => !equipe.employes.some(e => e.id === id))!;
  const dedans = equipe.employes.find(e => e.id !== 12)!.id;
  assert.ok(dehors && dedans);
  assert.equal(lireUrl('collaborateurs', `?fiche=${dehors}`, equipe).selectedId, null);
  assert.equal(lireUrl('collaborateurs', `?fiche=${dedans}`, equipe).selectedId, dedans);
  assert.equal(lireUrl('temps', `?salarie=${dehors}`, equipe).tsEmp, null);
  // Collaborateur : seule sa propre fiche est dans son jeu de données.
  assert.equal(lireUrl('temps', `?salarie=${dedans}`, await buildSnapshot(db, MEHDI)).tsEmp, dedans === 2 ? 2 : null);
});

test('historique : ouvrir une fiche ajoute une entrée, la fermer ou filtrer remplace l’entrée courante', () => {
  assert.equal(ouvreUneFiche('collaborateurs', UI, { ...UI, selectedId: 3 }), true);
  assert.equal(ouvreUneFiche('collaborateurs', { ...UI, selectedId: 3 }, { ...UI, selectedId: 4 }), true, 'autre fiche');
  assert.equal(ouvreUneFiche('collaborateurs', { ...UI, selectedId: 3 }, UI), false, 'fermeture');
  assert.equal(ouvreUneFiche('collaborateurs', UI, { ...UI, statut: 'exp' }), false, 'filtre');
  assert.equal(ouvreUneFiche('temps', UI, { ...UI, tsEmp: 3 }), true, 'feuille d’un autre salarié');
  assert.equal(ouvreUneFiche('temps', { ...UI, tsEmp: 3 }, { ...UI, tsEmp: 3, weekStart: '2026-10-12' }), false, 'semaine');
  assert.equal(ouvreUneFiche('voyages', UI, { ...UI, tripSel: 1 }), true);
  assert.equal(ouvreUneFiche('dashboard', UI, { ...UI, selectedId: 3 }), false, 'champ d’une autre vue');
});

test('connexion Microsoft : la page de retour garde les paramètres, dans la limite du serveur', () => {
  const page = '/collaborateurs?fiche=12&statut=a-renouveler';
  assert.equal(pageDeRetour(page), page, 'le serveur accepte un chemin avec paramètres');
  assert.equal(pageDeRetourClient('/collaborateurs', '?fiche=12&statut=a-renouveler&connexion=refus'), page, 'code d’échec retiré');
  assert.equal(pageDeRetourClient('/temps', ''), '/temps');
  const long = `?equipe=${'x'.repeat(RETOUR_MAX)}`;
  assert.equal(pageDeRetourClient('/collaborateurs', long), '/collaborateurs', 'trop long : le seul chemin (le brouillon garde les filtres)');
  assert.equal(pageDeRetour(pageDeRetourClient('/collaborateurs', long)), '/collaborateurs');
  // Code de store.tsx : retour de la reconnexion Microsoft avec les paramètres, adresse lue au chargement, sur Précédent et à la connexion.
  const store = readFileSync(new URL('../client/src/state/store.tsx', import.meta.url), 'utf8');
  assert.match(store, /lienMicrosoft\(\{ retour: pageDeRetourClient\(`\/\$\{view\}`, ecrireUrl\(view, ui\)\)/);
  assert.equal(store.match(/lireUrl\(/g)?.length, 3, 'chargement, Précédent, connexion');
  assert.ok(!/openDialog\([^)]*location/.test(store) && !/setDialog\([^)]*lireUrl/.test(store), 'aucun dialogue ouvert depuis l’adresse');
  // Sortie de session : l'adresse revient à « / » avant la déconnexion Microsoft et sur « Changer de compte »,
  // sinon connect() rouvrirait la fiche et les filtres de la personne précédente.
  const corps = (nom: string) => store.slice(store.indexOf(`const ${nom} = useCallback`), store.indexOf('}, [', store.indexOf(`const ${nom} = useCallback`)));
  const logout = corps('logout');
  assert.ok(logout.indexOf("history.replaceState(null, '', '/')") >= 0 && logout.indexOf("history.replaceState(null, '', '/')") < logout.indexOf('location.assign(s.deconnexion)'),
    'déconnexion : adresse remise à « / » avant la redirection Microsoft');
  const abandon = corps('abandonnerReconnexion');
  assert.ok(abandon.indexOf("history.replaceState(null, '', '/')") >= 0 && abandon.indexOf("history.replaceState(null, '', '/')") < abandon.indexOf('reinitialiser()'),
    '« Changer de compte » : adresse remise à « / »');
});

test('adresse : les valeurs par défaut de PARAMS_URL sont celles de INITIAL_UI (store.tsx)', () => {
  const store = readFileSync(new URL('../client/src/state/store.tsx', import.meta.url), 'utf8');
  const litteral = /const INITIAL_UI: UiState = (\{[\s\S]*?\n\});/.exec(store)?.[1];
  assert.ok(litteral, 'INITIAL_UI trouvé dans store.tsx');
  const initial = new Function(`return (${litteral});`)() as UiState;
  assert.deepEqual(initial, UI, 'la constante UI de ce test recopie INITIAL_UI');
  for (const [v, params] of Object.entries(PARAMS_URL))
    for (const p of params ?? []) assert.equal(p.defaut, initial[p.cle], `${v}.${p.nom} : défaut identique à INITIAL_UI.${p.cle}`);
});

// — t107 : Planifier → Créer une session → inscription —

test('t107 : la session créée depuis « Planifier » y revient présélectionnée, même si une autre session est ouverte', async () => {
  const { db, run, RH } = await fresh();
  const avant = new Domain(await buildSnapshot(db, RH));
  const f = avant.ds.referentiels.formations.find(x => avant.upcoming(new Set([x.id])).some(s => s.inscrits < s.places))!.id;
  const premiere = sessionPreselectionnee(avant.upcoming(new Set([f])));
  assert.ok(premiere, 'une session ouverte existe déjà pour cette formation');
  const r = (await run(RH, 'session.creer', { f, date: '2026-12-15', lieu: 'Salle B', places: 6 })) as { result?: { id: number } };
  const retour = { type: 'plan' as const, empId: 3, certId: 7 };
  const rouvert = apresCreation(retour, r.result);
  assert.deepEqual(rouvert, { type: 'plan', empId: 3, certId: 7, sessionId: r.result!.id });
  const apres = new Domain(await buildSnapshot(db, RH)).upcoming(new Set([f]));
  assert.equal(sessionPreselectionnee(apres, r.result!.id), r.result!.id);
  assert.notEqual(sessionPreselectionnee(apres), r.result!.id, 'sans retour, la première session ouverte comme avant');
  // Session demandée complète ou inconnue : la première ouverte ; aucune ouverte : aucune.
  assert.equal(sessionPreselectionnee([{ id: 1, places: 4, inscrits: 4 }, { id: 2, places: 4, inscrits: 1 }], 1), 2);
  assert.equal(sessionPreselectionnee([{ id: 2, places: 4, inscrits: 1 }], 99), 2);
  assert.equal(sessionPreselectionnee([{ id: 1, places: 4, inscrits: 4 }]), null);
  assert.deepEqual(apresCreation(retour, undefined), retour, 'réponse sans identifiant : retour sans présélection');
});

test('t107 : le dialogue de retour se conserve dans le brouillon de la reconnexion ; branchements des dialogues', (t) => {
  const m = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  // Aucun dialogue affiché (pas de DOM) : seuls l'état du dialogue et son retour sont conservés.
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  t.after(() => { effacerBrouillon(); delete (globalThis as { sessionStorage?: unknown }).sessionStorage; delete (globalThis as { document?: unknown }).document; });
  const dialog = { type: 'session' as const, f: 'fco', retour: { type: 'plan' as const, empId: 3, inscriptionId: 5 } };
  sauverBrouillon({ compteId: 1, role: 'rh', view: 'collaborateurs', ui: UI, dialog });
  assert.deepEqual(lireBrouillon()!.dialog, dialog);
  const src = (f: string) => readFileSync(new URL(`../client/src/dialogs/${f}`, import.meta.url), 'utf8');
  assert.match(src('PlanDialog.tsx'), /openDialog\(\{ type: 'session', f, retour: \{ type: 'plan', empId, certId, inscriptionId \} \}\)/);
  assert.match(src('PlanDialog.tsx'), /sessionPreselectionnee\(sessions, demandee\)/);
  const sess = src('SessionDialog.tsx');
  assert.match(sess, /else if \(retour\) openDialog\(apresCreation\(retour, r\.result\)\)/);
  assert.match(sess, /fermer=\{retour \? \(\) => openDialog\(retour\) : undefined\}/, 'Annuler, Échap, fond : retour à la planification');
});

// — t148 : planning des missions —

test('t148 : chaque case a un texte complet et une lettre, chaque ligne un résumé ; tableau sémantique et détail annoncé', async () => {
  const { db, RH } = await fresh();
  const d = new Domain(await buildSnapshot(db, RH));
  const { days, lignes } = planningMissions(d, false);
  assert.equal(days.length, 20);
  assert.ok(lignes.length > 0);
  const toutes = lignes.flatMap(l => l.cases);
  for (const c of toutes) {
    assert.match(c.texte, /^(lundi|mardi|mercredi|jeudi|vendredi) \d{1,2} \S+ \d{4} — \S/, c.texte);
    assert.equal(MARQUE[c.nature] === '', c.nature === 'present');
  }
  assert.ok(toutes.some(c => c.nature === 'mission' && /— Mission /.test(c.texte)), 'une mission en démonstration');
  assert.ok(toutes.every(c => c.nature !== 'ferie' || c.texte.endsWith('— Férié')));
  assert.equal(resumeLigne([{ nature: 'mission' }, { nature: 'mission' }, { nature: 'absence' }, { nature: 'demande' }, { nature: 'ferie' }]), '2 j de mission · 1 j d’absence · 1 j demandé');
  assert.equal(resumeLigne([{ nature: 'present' }, { nature: 'ferie' }]), 'Présent');
  // Manager : toute son équipe, même présente.
  const mgr = planningMissions(new Domain(await buildSnapshot(db, (await fresh()).KARIM)), true);
  assert.ok(mgr.lignes.length >= 1);
  const grille = readFileSync(new URL('../client/src/pages/PlanningMissions.tsx', import.meta.url), 'utf8');
  for (const m of ['<table', '<caption', 'scope="col"', 'scope="row"', 'aria-live="polite"', 'tabIndex={l === li && i === co ? 0 : -1}', 'onFocus=', 'ArrowDown', 'jourComplet(s)'])
    assert.ok(grille.includes(m), m);
  // Au clavier, le libellé de la case est lu au focus : la zone aria-live n'est remplie qu'au toucher ou au clic.
  assert.match(grille, /onFocus=\{\(\) => montrer\(l, i\)\}/);
  assert.match(grille, /onClick=\{\(\) => toucher\(l, i\)\}/);
  assert.ok(!grille.slice(grille.indexOf('const montrer'), grille.indexOf('const toucher')).includes('setAnnonce'), 'le focus n’annonce rien');
  assert.match(grille, /<p className="sr-only" aria-live="polite">\{annonce\}<\/p>/);
});
