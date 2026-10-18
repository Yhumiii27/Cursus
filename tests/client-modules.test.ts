// Modules du client restés sans test (t159, étape 1) : données dérivées partagées par les écrans (state/derived.ts),
// confirmations des corrections (state/confirmations-corrections.ts), requête média et panneau de détail sur écran
// étroit (components/media.ts, components/panneau.ts), compte rendu d'entretien imprimable (dialogs/compteRendu.ts),
// éléments communs des sections de Paramètres (pages/parametres/commun.ts). Sous node --test, sans navigateur : le
// magasin est factice et les hooks se rendent par react-dom/server (tests/outils/client-node.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { rendreHook } = await import('./outils/client-node.ts');
const { poserMagasin } = await import('./outils/store-factice.ts');
const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const { ENT_TYPES } = await import('../shared/constants.ts');
const derived = await import('../client/src/state/derived.ts');
const corrections = await import('../client/src/state/confirmations-corrections.ts');
const { lireMedia, suivreMedia } = await import('../client/src/components/media.ts');
const { ECRAN_ETROIT, placerPanneau } = await import('../client/src/components/panneau.ts');
const compteRendu = await import('../client/src/dialogs/compteRendu.ts');
const { MONO, quand, useEnregistrerReglages } = await import('../client/src/pages/parametres/commun.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof buildSnapshot>;
type Store = Parameters<typeof poserMagasin>[0];

// Comptes de démonstration : Sandrine Vidal (administratrice RH, externe), Antoine Leroy (14, gestionnaire RH),
// Sarah Cohen (23, référente HSE), Aïcha Diallo (7, paie), Élodie Bernard (11, lecture seule), Karim Haddad (12,
// manager), Mehdi Benali (2, collaborateur).
const db = new Db(':memory:');
seedDemo(db);
function donnees(empId: number | null, role: User['role']): Dataset {
  const c = (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL').get(...(empId ? [empId] : [])) as { id: number }).id;
  return buildSnapshot(db, currentUser(db, { compteId: c, role, methode: 'demo' })!);
}
const RH = donnees(null, 'rh');
/** Magasin minimal d'un écran authentifié : instantané, état de l'interface (seul `horizon` compte ici), `run` fourni. */
const magasin = (data: Dataset, o: { horizon?: number | null; run?: NonNullable<Store>['run'] } = {}) =>
  poserMagasin({ data, ui: { horizon: o.horizon ?? null } as NonNullable<Store>['ui'], run: o.run });

// — state/derived.ts —

test('derived : un domaine par instantané, partagé par les écrans, recréé pour un nouvel instantané', () => {
  const d = derived.domaineDe(RH);
  assert.ok(d instanceof Domain);
  assert.equal(derived.domaineDe(RH), d, 'même instantané : même domaine (calculs mémorisés faits une fois)');
  const autre = donnees(null, 'rh');
  assert.notEqual(derived.domaineDe(autre), d, 'nouvel instantané : nouveau domaine');
  magasin(RH);
  assert.equal(rendreHook(() => derived.useDomain()), d);
  poserMagasin(null);
  assert.throws(() => rendreHook(() => derived.useDomain()), /hors de <StoreProvider>/);
  poserMagasin({ data: null });
  assert.throws(() => rendreHook(() => derived.useDomain()), /Données non chargées/);
});

test('derived : collaborateurs enrichis au seuil d’alerte de l’écran, sinon à celui des réglages', () => {
  const d = derived.domaineDe(RH), s = RH.settings;
  magasin(RH);
  const e = rendreHook(() => derived.useEnriched());
  assert.equal(e.d, d);
  assert.deepEqual([e.horizon, e.onlyReg], [s.horizonAlerte, s.uniquementReglementaire]);
  assert.deepEqual(e.emps.map(x => [x.id, x.worst]), d.enrich(s.horizonAlerte, s.uniquementReglementaire).map(x => [x.id, x.worst]));
  assert.deepEqual([...e.formIds].sort(), e.forms.map(f => f.id).sort());
  assert.deepEqual(e.upcoming.map(x => x.id), d.upcoming(e.formIds).map(x => x.id));
  // Seuil choisi sur l'écran (ui.horizon) : il remplace celui des réglages.
  magasin(RH, { horizon: 365 });
  const large = rendreHook(() => derived.useEnriched());
  assert.equal(large.horizon, 365);
  assert.deepEqual(large.emps.map(x => [x.id, x.worst]), d.enrich(365, s.uniquementReglementaire).map(x => [x.id, x.worst]));
  assert.ok(large.emps.filter(x => x.worst !== 'ok').length > e.emps.filter(x => x.worst !== 'ok').length, 'horizon plus large : plus d’alertes');
  magasin(RH);
  assert.deepEqual(rendreHook(() => derived.useTrips()).map(t => t.id), d.tripsAll().map(t => t.id));
});

test('derived : collaborateurs visibles, ceux que le serveur a envoyés', () => {
  magasin(RH);
  assert.deepEqual(rendreHook(() => derived.useScopeIds()), RH.employes.map(e => e.id));
  const mgr = donnees(12, 'manager');
  magasin(mgr);
  const ids = rendreHook(() => derived.useScopeIds());
  assert.deepEqual(ids, mgr.employes.map(e => e.id));
  assert.ok(ids.length < RH.employes.length && ids.includes(12), 'manager : son équipe et lui-même');
});

test('derived : rôle et droits de chaque profil, propositions d’action permises', () => {
  const role = (data: Dataset) => { magasin(data); return rendreHook(() => derived.useRole()); };
  const droits = (r: ReturnType<typeof role>) => ({ espaceRh: r.espaceRh, rh: r.rh, admin: r.admin, formations: r.formations, paie: r.paie, consultation: r.consultation, manager: r.manager, collab: r.collab });
  const non = { espaceRh: false, rh: false, admin: false, formations: false, paie: false, consultation: false, manager: false, collab: false };
  const attendu: [string, Dataset, Partial<typeof non>][] = [
    ['administrateur RH', RH, { espaceRh: true, rh: true, admin: true, formations: true, paie: true, consultation: true }],
    ['gestionnaire RH', donnees(14, 'rh'), { espaceRh: true, rh: true, formations: true, consultation: true }],
    ['référent HSE', donnees(23, 'rh'), { espaceRh: true, formations: true }],
    ['gestionnaire de paie', donnees(7, 'rh'), { espaceRh: true, paie: true }],
    ['lecture seule', donnees(11, 'rh'), { espaceRh: true, consultation: true }],
    ['manager', donnees(12, 'manager'), { manager: true }],
    ['collaborateur', donnees(2, 'collaborateur'), { collab: true }],
  ];
  for (const [nom, data, oui] of attendu) assert.deepEqual(droits(role(data)), { ...non, ...oui }, nom);
  // Salarié rattaché au compte : `soi` (un membre du RH ne décide pas de ses propres demandes).
  const gest = role(donnees(14, 'rh'));
  assert.deepEqual([gest.me, gest.soi, gest.role], [null, 14, 'rh'], 'espace RH : aucun salarié « courant », mais le sien');
  const admin = role(RH);
  assert.equal(admin.soi, null, 'compte externe : aucun salarié');

  // Propositions du domaine : visite médicale, formalités et contrat pour le service RH ; le reste pour les formations.
  const permis = (data: Dataset) => { magasin(data); return rendreHook(() => derived.useIntentPermis()); };
  const intents = [
    { type: 'medical', empId: 2 }, { type: 'openFormalite', empId: 2, kind: 'passeport' }, { type: 'openContrat', empId: 2, quoi: 'fiche' },
    { type: 'openHab', empId: 2, h: 'he', mode: 'renew' }, { type: 'openCloture', sessionId: 1 }, { type: 'goFormation', f: 'sst' },
  ] as Parameters<ReturnType<typeof permis>>[0][];
  const lignes = (data: Dataset) => intents.map(permis(data));
  assert.deepEqual(lignes(donnees(14, 'rh')), [true, true, true, true, true, true], 'gestionnaire RH : tout');
  assert.deepEqual(lignes(donnees(23, 'rh')), [false, false, false, true, true, true], 'référent HSE : formations seulement');
  assert.deepEqual(lignes(donnees(7, 'rh')), [false, false, false, false, false, false], 'paie : rien');
  assert.deepEqual(lignes(donnees(12, 'manager')), [false, false, false, false, false, false], 'manager : rien depuis l’espace RH');
});

// — state/confirmations-corrections.ts —

test('confirmations des corrections : action, paramètres, motif obligatoire gardé au service RH', () => {
  const sup = corrections.suppressionCertification({ id: 7 }, 'Mehdi Benali', 'SST du 3 mai 2025', {
    precedente: '2023-05-03', session: 'SST du 12 nov.',
    rendues: [
      { session: 'H0B0 du 4 déc.', refus: 'session complète', ouverte: true },
      { session: 'CACES du 9 janv.', refus: null, ouverte: true },
      { session: 'ATEX du 2 févr.', refus: null, ouverte: false },
    ],
  });
  assert.deepEqual([sup.action, sup.payload, sup.bouton], ['cert.annuler', { id: 7 }, 'Supprimer la certification']);
  assert.equal(sup.question, 'Supprimer la certification SST du 3 mai 2025 du dossier de Mehdi Benali ?');
  assert.ok(sup.suites!.includes('La certification du 3 mai 2023 redevient en vigueur.'));
  assert.ok(sup.suites!.some(s => /Sa place à la session SST du 12 nov\. est libérée/.test(s)));
  assert.ok(sup.suites!.some(s => /H0B0 du 4 déc\., qui ne peut plus l’accueillir \(session complète\) : réinscrivez-le/.test(s)));
  assert.ok(sup.suites!.some(s => /CACES du 9 janv\. : l’inscription est rétablie/.test(s)));
  assert.ok(sup.suites!.some(s => /ATEX du 2 févr\. : sa formation initiale redevient à replanifier/.test(s)));
  assert.deepEqual(sup.motif, { label: 'Motif de la suppression', requis: true, placeholder: 'Saisie sur la mauvaise fiche, attestation inexistante…', aide: corrections.AIDE_MOTIF_CORRECTION });
  assert.match(corrections.AIDE_MOTIF_CORRECTION, /jamais recopié au journal/);
  assert.match(corrections.AIDE_MOTIF_CORRECTION, /aucune information médicale/);
  // Sans précédente ni session : aucune ligne vide.
  const seule = corrections.suppressionCertification({ id: 8 }, 'Mehdi Benali', 'SST du 3 mai 2025');
  assert.equal(seule.suites!.length, 2);
  assert.ok(seule.suites!.every(Boolean));

  const plan = corrections.suppressionLignePlan({ id: 3, equipe: 'Production', periode: 'T1', exercice: 2027, cout: 1250 }, 'SST initial');
  assert.deepEqual([plan.action, plan.payload, plan.motif?.requis], ['plan.supprimer', { id: 3 }, true]);
  assert.match(plan.question, /^Supprimer SST initial — Production, T1 2027 \(1\s?250\s€ prévus\) \?$/);

  // Retrait par son auteur : sans motif (sa propre demande) ; faite par un manager pour un salarié : le nom.
  const retrait = corrections.retraitDemande({ id: 5 }, 'formation SST');
  assert.deepEqual([retrait.action, retrait.payload, retrait.motif], ['demande.annuler', { id: 5 }, undefined]);
  assert.equal(retrait.question, 'Retirer votre demande : formation SST ?');
  assert.equal(corrections.retraitDemande({ id: 5 }, 'formation SST', 'Mehdi Benali').question, 'Retirer la demande faite pour Mehdi Benali : formation SST ?');

  const rouvrir = corrections.reouvertureDemande({ id: 9, statut: 'acceptee' }, 'Mehdi Benali', 'formation SST', ['L’inscription à la session SST du 12 nov. est retirée.']);
  assert.deepEqual([rouvrir.action, rouvrir.payload, rouvrir.motif?.requis, rouvrir.motif?.label], ['demande.reouvrir', { id: 9 }, true, 'Motif de la réouverture']);
  assert.equal(rouvrir.question, 'Rouvrir la demande de Mehdi Benali : formation SST (acceptée) ?');
  assert.equal(rouvrir.suites![0], 'L’inscription à la session SST du 12 nov. est retirée.', 'effets défaits annoncés d’abord');
  assert.match(corrections.reouvertureDemande({ id: 9, statut: 'refusee' }, 'M', 'x', []).question, /\(refusée\)/);
});

// — components/media.ts et components/panneau.ts —

/** matchMedia factice : requêtes satisfaites dans `actives`, changements déclenchés par `basculer`. */
function fauxMedia(actives: Set<string>) {
  const suivis = new Map<string, Set<() => void>>();
  const g = globalThis as { matchMedia?: unknown };
  g.matchMedia = (q: string) => ({
    get matches() { return actives.has(q); },
    addEventListener: (_: string, f: () => void) => { (suivis.get(q) ?? suivis.set(q, new Set()).get(q)!).add(f); },
    removeEventListener: (_: string, f: () => void) => { suivis.get(q)?.delete(f); },
  });
  return {
    basculer(q: string) { if (actives.has(q)) actives.delete(q); else actives.add(q); suivis.get(q)?.forEach(f => f()); },
    suivis: (q: string) => suivis.get(q)?.size ?? 0,
    retirer() { delete g.matchMedia; },
  };
}

test('requête média : état lu aussitôt, suivi des changements, arrêt du suivi ; rien hors navigateur', () => {
  assert.equal(lireMedia(ECRAN_ETROIT), false, 'sans matchMedia');
  const sansNavigateur: boolean[] = [];
  suivreMedia(ECRAN_ETROIT, ok => sansNavigateur.push(ok))();
  assert.deepEqual(sansNavigateur, [], 'rien à suivre');
  const m = fauxMedia(new Set([ECRAN_ETROIT]));
  try {
    assert.equal(lireMedia(ECRAN_ETROIT), true);
    assert.equal(lireMedia('(pointer: coarse)'), false);
    const vus: boolean[] = [];
    const arreter = suivreMedia(ECRAN_ETROIT, ok => vus.push(ok));
    assert.deepEqual(vus, [true], 'état courant aussitôt');
    m.basculer(ECRAN_ETROIT);
    m.basculer(ECRAN_ETROIT);
    assert.deepEqual(vus, [true, false, true], 'rotation de l’écran, fenêtre agrandie puis réduite');
    assert.equal(m.suivis(ECRAN_ETROIT), 1);
    arreter();
    assert.equal(m.suivis(ECRAN_ETROIT), 0, 'composant démonté : plus suivi');
    m.basculer(ECRAN_ETROIT);
    assert.deepEqual(vus, [true, false, true]);
  } finally { m.retirer(); }
});

test('panneau de détail : sur écran étroit, défilement et focus à la sélection, retour à la liste à la fermeture', () => {
  const g = globalThis as { window?: unknown };
  const appels: string[] = [];
  const fenetre = { scrollY: 840, scrollTo: (o: { top: number }) => appels.push(`retour ${o.top}`) };
  g.window = fenetre;
  const panneau = {
    scrollIntoView: (o: ScrollIntoViewOptions) => appels.push(`vers le panneau ${o.block} ${o.behavior}`),
    focus: (o: FocusOptions) => appels.push(`focus ${o.preventScroll ? 'sans défilement' : ''}`),
  } as unknown as HTMLElement;
  const m = fauxMedia(new Set([ECRAN_ETROIT]));
  try {
    const position = { current: null as number | null };
    placerPanneau(panneau, 5, position);
    assert.deepEqual(appels, ['vers le panneau start smooth', 'focus sans défilement']);
    assert.equal(position.current, 840, 'position dans la liste gardée');
    // Autre ligne choisie depuis le panneau : la position d'origine reste celle de la liste.
    fenetre.scrollY = 1600;
    placerPanneau(panneau, 6, position);
    assert.equal(position.current, 840);
    appels.length = 0;
    placerPanneau(panneau, null, position);
    assert.deepEqual(appels, ['retour 840'], 'fermeture : retour là où la personne était');
    assert.equal(position.current, null);
    // Mouvements réduits : défilement immédiat. Panneau pas encore rendu : rien.
    m.basculer('(prefers-reduced-motion: reduce)');
    appels.length = 0;
    placerPanneau(panneau, 7, position);
    assert.equal(appels[0], 'vers le panneau start auto');
    appels.length = 0;
    placerPanneau(null, 8, { current: null });
    assert.deepEqual(appels, []);
    // Grand écran : le panneau est déjà à côté de la liste, rien ne bouge et la position est oubliée.
    m.basculer(ECRAN_ETROIT);
    placerPanneau(panneau, 9, position);
    placerPanneau(panneau, null, position);
    assert.deepEqual(appels, []);
    assert.equal(position.current, null);
  } finally { m.retirer(); delete g.window; }
});

// — dialogs/compteRendu.ts —

test('compte rendu d’entretien : sections du type, fin de carrière à 58 ans, signatures et document imprimé', () => {
  const d = derived.domaineDe(RH);
  const annuel = RH.entretiens.find(x => x.id === 41)!; // Fatou Ndiaye : entretien annuel signé par l'évaluateur seul
  assert.deepEqual(compteRendu.sectionsDe(d, annuel), ENT_TYPES.annuel.sections);
  assert.deepEqual(compteRendu.sectionsDe(d, { ...annuel, empId: 999 }), [], 'salarié absent de l’instantané');
  // Entretien professionnel de Manon Faure (née en 1966) : 58 ans passés, section « fin de carrière » ajoutée.
  const epp = { ...RH.entretiens.find(x => x.empId === 21 && x.type === 'epp')!, date: '2026-10-10' };
  assert.deepEqual(compteRendu.sectionsDe(d, epp), [...ENT_TYPES.epp.sections, compteRendu.FIN_CARRIERE]);
  assert.deepEqual(compteRendu.sectionsDe(d, { ...epp, finCarriere: false }), ENT_TYPES.epp.sections, 'décochée par l’évaluateur');
  assert.deepEqual([compteRendu.whoLabel('mgr'), compteRendu.whoLabel('sal')], ['Évaluateur', 'Salarié']);

  // Impression : sans cadre (navigateur ancien), le document s'écrit dans un nouvel onglet ; l'export est signalé.
  const g = globalThis as { document?: unknown; window?: unknown; location?: unknown; fetch?: unknown };
  const avant = g.fetch;
  let html = '';
  const signales: unknown[] = [];
  g.location = { href: 'https://cursus.example.fr/entretiens' };
  g.document = { createElement: () => ({ setAttribute() {}, remove() {}, contentDocument: null, contentWindow: null }), body: { appendChild() {} } };
  g.window = { open: () => ({ document: { open() {}, write: (s: string) => { html += s; }, close() {} } }) };
  g.fetch = (_url: string, o: { body: string }) => { signales.push(JSON.parse(o.body)); return Promise.resolve(new Response('{}')); };
  try {
    assert.equal(compteRendu.imprimerCompteRendu(d, { ...annuel, empId: 999 }), false, 'salarié absent : rien');
    assert.equal(compteRendu.imprimerCompteRendu(d, annuel), true);
    const e = d.emp(annuel.empId)!;
    assert.match(html, /<title>Entretien annuel[^<]* — compte rendu<\/title>/);
    assert.ok(html.includes(`${e.nom} · ${e.poste}`) && html.includes('non signé par le salarié'), 'sous-titre');
    assert.ok(html.includes('Non signé par le salarié'), 'signature du salarié absente, dite');
    assert.ok(html.includes(`matricule Cursus EMP-${String(e.id).padStart(4, '0')}`), 'matricules du salarié');
    for (const [, label] of ENT_TYPES.annuel.sections) assert.ok(html.includes(label), label);
    assert.ok(html.includes('Non renseigné'), 'section vide : dite non renseignée');
    assert.doesNotMatch(html, /<style/, 'CSP : feuille servie, aucun style en ligne');
    assert.match(html, /href="https:\/\/cursus\.example\.fr\/print\.css"/);
    assert.deepEqual(signales, [{ nature: 'impression', titre: `${ENT_TYPES.annuel.nom} — compte rendu`, empId: e.id }]);
  } finally {
    delete g.document; delete g.window; delete g.location; g.fetch = avant;
  }
});

// — pages/parametres/commun.ts —

test('paramètres : enregistrement par parametres.maj, horodatage lisible, police des codes', async () => {
  const appels: [string, unknown][] = [];
  magasin(RH, { run: async (name, payload) => { appels.push([name, payload]); return { ok: true, message: null }; } });
  const enregistrer = rendreHook(() => useEnregistrerReglages());
  await enregistrer({ horizonAlerte: 60 });
  assert.deepEqual(appels, [['parametres.maj', { horizonAlerte: 60 }]]);
  const at = new Date(2026, 9, 10, 9, 12).toISOString(); // heure locale du navigateur
  assert.equal(quand(at), '10 oct. 2026 à 09:12');
  assert.match(MONO.fontFamily, /monospace$/);
  assert.equal(MONO.fontSize, 12);
});
