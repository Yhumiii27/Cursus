// Interface fiable (lot 5, chantier H, étape 1) : révision de la base dans chaque instantané et réponses arrivées dans le
// désordre ignorées (t102) ; modification concurrente d'une fiche refusée champ par champ (t108) ; modification d'une
// équipe en une seule transaction (t105) ; références des déplacements importés sans référence et demandeur (t090) ;
// horodatage réel du verdict Keystone (t089, aussi dans tests/domain.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { REFERENCES_DEPLACEMENTS } = await import('../server/src/migrations/voyages.ts');
const { AppelsEnCours } = await import('../client/src/state/actions.ts');
const { instantanePerime } = await import('../client/src/state/revision.ts');
const { champsAEnvoyer, champsEnConflit, messageConflit } = await import('../shared/rules/fiche-concurrente.ts');
const { profilOf } = await import('../shared/rules/profil.ts');
const { parseTrips, referenceDeplacement } = await import('../shared/rules/imports.ts');
const { Domain } = await import('../shared/domain.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof buildSnapshot>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (transaction, trace au journal, instantané). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => {
    const o = db.tx(() => {
      const ctx = makeCtx(db, u, loadFull(db, u));
      const t = preparerTrace(db, name, p);
      const r = ACTIONS[name](ctx, p);
      const o = typeof r === 'object' && r !== null ? r : { message: r };
      journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
      return o;
    });
    return { ...o, data: buildSnapshot(db, u) };
  };
  const refus = (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) => assert.throws(() => run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status} attendu`);
  return { db, run, refus, RH: user(null, 'rh'), ANTOINE: user(14, 'rh'), KARIM: user(12, 'manager'), MEHDI: user(2, 'collaborateur') };
}

// — t102 : révision de la base, réponses dans le désordre —

test('révision : croît à chaque transaction validée, pas sur une transaction annulée, portée par chaque instantané', () => {
  const { db, run, RH } = fresh();
  const r0 = buildSnapshot(db, RH).revision;
  assert.equal(typeof r0, 'number');
  assert.equal(buildSnapshot(db, RH).revision, r0, 'lecture sans écriture : même révision');
  const a = run(RH, 'notification.regler', { empId: 2, mode: 'quotidien' }).data.revision;
  assert.ok(a > r0);
  assert.throws(() => db.tx(() => { db.update('employes', 2, { nom: 'X' }); throw new Error('annulée'); }));
  assert.equal(buildSnapshot(db, RH).revision, a, 'transaction annulée : révision inchangée');
  // Toutes les vues portent la même révision (une seule base) : un changement d'espace ne passe pas pour un retour en arrière.
  assert.equal(buildSnapshot(db, { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' }).revision, a);
  // Redémarrage (nouvelle connexion, base restaurée comprise) : partie de l'heure, donc au-delà des révisions d'avant.
  const ouverture = Date.now();
  assert.ok(new Db(':memory:').revision >= ouverture);
});

test('instantané plus ancien que celui affiché : ignoré ; égal, ou sans révision (ancien serveur) : appliqué', () => {
  assert.equal(instantanePerime({ revision: 5 }, { revision: 6 }), true);
  assert.equal(instantanePerime({ revision: 6 }, { revision: 6 }), false);
  assert.equal(instantanePerime({ revision: 7 }, { revision: 6 }), false);
  assert.equal(instantanePerime({ revision: 7 }, null), false, 'rien d’affiché');
  assert.equal(instantanePerime({} as { revision: number }, { revision: 6 }), false);
});

test('deux saisies d’heures dont les réponses arrivent dans le désordre : les deux cellules restent affichées', async () => {
  const { run, MEHDI } = fresh();
  const week = '2026-10-05';
  const l = run(MEHDI, 'temps.addLine', { empId: 2, week, projet: 'INT-MAINT' }).data;
  const li = l.feuilles.find(f => f.empId === 2 && f.week === week)!.lignes.length - 1;
  const cellules = (d: Dataset) => d.feuilles.find(f => f.empId === 2 && f.week === week)!.lignes[li].h.slice(0, 2);
  // Écran : comme `recevoir` de store.tsx, un instantané plus ancien que celui affiché est ignoré.
  let affiche: Dataset | null = l;
  const recevoir = (d: Dataset) => { if (!instantanePerime(d, affiche)) affiche = d; };
  // Le serveur traite A (lundi) puis B (mardi) ; la réponse de B revient d'abord, celle de A ensuite.
  const repA = run(MEHDI, 'temps.setCell', { empId: 2, week, li, di: 0, value: '7' }).data;
  const repB = run(MEHDI, 'temps.setCell', { empId: 2, week, li, di: 1, value: '6' }).data;
  const appels = new AppelsEnCours<Dataset>();
  let lacherA!: () => void, lacherB!: () => void;
  const pA = appels.lancer('A', () => new Promise<Dataset>(r => { lacherA = () => r(repA); }), 'temps.setCell').then(recevoir);
  const pB = appels.lancer('B', () => new Promise<Dataset>(r => { lacherB = () => r(repB); }), 'temps.setCell').then(recevoir);
  lacherB();
  await pB;
  lacherA();
  await pA;
  assert.deepEqual(cellules(affiche!), [7, 6], 'la réponse de A, plus ancienne, ne vide pas la cellule de B');
  // Ordre inverse de traitement : B puis A ; la réponse de A (la plus récente) arrive la première et fait foi.
  const repB2 = run(MEHDI, 'temps.setCell', { empId: 2, week, li, di: 1, value: '5' }).data;
  const repA2 = run(MEHDI, 'temps.setCell', { empId: 2, week, li, di: 0, value: '4' }).data;
  recevoir(repA2);
  recevoir(repB2);
  assert.deepEqual(cellules(affiche!), [4, 5]);
});

// — t108 : modification concurrente d'une fiche —

test('champs envoyés : seuls ceux modifiés, avec les champs liés ; dans la liste ouverte au rôle', () => {
  const { db, RH } = fresh();
  const p = profilOf(new Domain(loadFull(db, RH)).emp(2)!);
  assert.deepEqual(champsAEnvoyer(p, { ...p, nom: 'Mehdi Benali-Martin' }), ['nom']);
  assert.deepEqual(champsAEnvoyer(p, { ...p, poste: 'Technicien confirmé' }), ['poste', 'posteId']);
  assert.deepEqual(champsAEnvoyer(p, { ...p, heures: 32, temps: 'partiel' }), ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis']);
  assert.deepEqual(champsAEnvoyer(p, { ...p, poste: 'Technicien confirmé', jourOff: [2] }, ['poste', 'jourOff']), ['poste', 'jourOff'], 'manager : ni posteId ni régime');
  assert.deepEqual(champsAEnvoyer(p, p), []);
  assert.deepEqual(champsEnConflit({ nom: p.nom, email: 'autre@exemple.fr', inconnu: 1 }, p), ['email']);
  assert.deepEqual(champsEnConflit(null, p), []);
  assert.match(messageConflit(['email', 'poste'], 'Claire Martin'), /^Fiche modifiée entre-temps par Claire Martin \(Adresse e-mail, Poste\) : rien n’a été enregistré/);
});

test('fiche modifiée entre-temps : refus 412 qui nomme les champs et leur auteur, rien n’est enregistré ; sinon accepté', () => {
  const { db, run, refus, RH } = fresh();
  const emp = () => new Domain(loadFull(db, RH)).emp(2)!;
  const ouverture = profilOf(emp());
  // Une première personne change l'adresse e-mail (sans `avant` : ancien écran, import).
  run(RH, 'employe.modifier', { id: 2, email: 'mehdi.benali@exemple.fr' });
  // La seconde, ouverte avant, change l'adresse et le poste : refus, ni l'un ni l'autre n'est enregistré.
  refus(RH, 'employe.modifier', {
    id: 2, email: 'm.benali@exemple.fr', poste: 'Technicien confirmé', posteId: null,
    avant: { email: ouverture.email, poste: ouverture.poste, posteId: ouverture.posteId ?? null },
  }, 412, /^Fiche modifiée entre-temps par Sandrine Vidal \(Adresse e-mail\) : rien n’a été enregistré/);
  assert.equal(emp().email, 'mehdi.benali@exemple.fr');
  assert.equal(emp().poste, ouverture.poste);
  // Un champ que l'autre n'a pas touché : accepté, l'adresse enregistrée entre-temps est gardée.
  run(RH, 'employe.modifier', { id: 2, nom: 'Mehdi Benali-Martin', avant: { nom: ouverture.nom } });
  assert.deepEqual([emp().nom, emp().email], ['Mehdi Benali-Martin', 'mehdi.benali@exemple.fr']);
  // Les valeurs d'origine ne sont jamais recopiées au journal (seulement le nom des champs modifiés).
  const j = db.sql.prepare(`SELECT payload FROM journal WHERE action = 'employe.modifier' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  const payload = JSON.parse(j.payload);
  assert.deepEqual(payload.champsModifies, ['nom']);
  assert.ok(!('avant' in payload) || !JSON.stringify(payload.avant).includes(ouverture.email ?? '§'), j.payload);
});

test('manager : modification limitée contrôlée de même ; sans `avant`, aucun contrôle', () => {
  const { db, run, refus, RH, KARIM } = fresh();
  const avant = profilOf(new Domain(loadFull(db, RH)).emp(2)!).poste;
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance senior' });
  refus(KARIM, 'employe.modifier', { id: 2, poste: 'Technicien confirmé', avant: { poste: avant } }, 412, /\(Poste\)/);
  run(KARIM, 'employe.modifier', { id: 2, poste: 'Technicien confirmé' });
  assert.equal(new Domain(loadFull(db, RH)).emp(2)!.poste, 'Technicien confirmé');
});

test('manager : une valeur d’origine pour un champ non envoyé est refusée (400), quelle qu’elle soit ; jamais d’auteur nommé', () => {
  const { db, run, refus, RH, KARIM } = fresh();
  const vraie = profilOf(new Domain(loadFull(db, RH)).emp(2)!);
  // Champs masqués au manager (visite médicale, motif de reprise, matricule de paie) : même refus pour la vraie valeur et
  // pour une fausse, sans quoi la réponse dirait si la valeur devinée est la bonne.
  for (const [k, faux] of [['visite', '1999-01-01'], ['repriseMotif', 'zz'], ['matriculePaie', '999999']] as const) {
    for (const v of [vraie[k], faux]) refus(KARIM, 'employe.modifier', { id: 2, avant: { [k]: v } }, 400, /^Valeurs d’origine reçues pour des champs non envoyés/);
    refus(KARIM, 'employe.modifier', { id: 2, poste: vraie.poste, avant: { poste: vraie.poste, [k]: faux } }, 400);
  }
  refus(KARIM, 'employe.modifier', { id: 2, poste: 'X', avant: 'texte' }, 400);
  // Service RH : de même, seuls les champs envoyés sont comparés.
  refus(RH, 'employe.modifier', { id: 2, nom: vraie.nom, avant: { nom: vraie.nom, email: 'faux@exemple.fr' } }, 400);
  // Conflit réel sur un champ ouvert au manager : refus 412 sans le nom de l'auteur.
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance senior' });
  refus(KARIM, 'employe.modifier', { id: 2, poste: 'Technicien confirmé', avant: { poste: vraie.poste } }, 412, /^Fiche modifiée entre-temps \(Poste\) : rien/);
});

test('auteur du refus 412 : la dernière action qui a écrit l’un des champs en conflit sur la fiche, sinon personne', () => {
  const { db, run, refus, RH, ANTOINE } = fresh();
  const emp = () => new Domain(loadFull(db, RH)).emp(2)!;
  const auteur = (nom: string) => new RegExp(`^Fiche modifiée entre-temps par ${nom} \\(Adresse e-mail\\)`);
  // Sandrine Vidal change l'adresse e-mail, puis Antoine renomme le poste dans le référentiel (fiches mises à jour sans
  // être nommées au journal) : le conflit sur le poste n'est attribué à personne, et surtout pas à Sandrine Vidal.
  run(RH, 'employe.modifier', { id: 2, email: 'mehdi.benali@exemple.fr' });
  const ouverture = profilOf(emp());
  run(ANTOINE, 'referentiel.poste.enregistrer', { id: ouverture.posteId, nom: 'Technicien de maintenance industrielle', formations: ['elec', 'sst'], habilitations: ['he'] });
  assert.equal(emp().poste, 'Technicien de maintenance industrielle');
  refus(RH, 'employe.modifier', { id: 2, poste: 'Technicien confirmé', posteId: null, avant: { poste: ouverture.poste, posteId: ouverture.posteId } },
    412, /^Fiche modifiée entre-temps \(Poste\) : rien/);
  // Antoine change ensuite l'adresse : un conflit sur l'adresse le nomme, lui.
  run(ANTOINE, 'employe.modifier', { id: 2, email: 'm.benali@exemple.fr', avant: { email: 'mehdi.benali@exemple.fr' } });
  refus(RH, 'employe.modifier', { id: 2, email: 'autre@exemple.fr', avant: { email: 'mehdi.benali@exemple.fr' } }, 412, auteur(ANTOINE.nom));
  // Un avis médical plus récent, sans rapport avec l'adresse, ne change pas l'auteur nommé.
  run(RH, 'medical.avis', { empId: 2, date: '2026-10-06', avis: 'apte', restrictions: [] });
  refus(RH, 'employe.modifier', { id: 2, email: 'autre@exemple.fr', avant: { email: 'mehdi.benali@exemple.fr' } }, 412, auteur(ANTOINE.nom));
});

// — t105 : modification d'une équipe en une seule action —

test('equipe.modifier : renommage et manager ensemble ; un refus n’enregistre rien', () => {
  const { db, run, refus, RH } = fresh();
  const equipe = (nom: string) => loadFull(db, RH).referentiels.equipes.find(q => q.nom === nom);
  const avant = equipe('Commercial')!;
  // Manager refusé (intérimaire) : le renommage n'est pas fait non plus.
  const interim = loadFull(db, RH).employes.find(e => e.typeContrat === 'interim')!;
  refus(RH, 'equipe.modifier', { nom: 'Commercial', nouveau: 'Ventes', managerId: interim.id }, 400, /intérimaire/);
  assert.ok(equipe('Commercial') && !equipe('Ventes'), 'renommage annulé avec le refus du manager');
  const r = run(RH, 'equipe.modifier', { nom: 'Commercial', nouveau: 'Ventes', managerId: 19 });
  assert.match(String(r.message), /^Équipe Commercial renommée en Ventes — .+ devient manager de l’équipe Ventes$/);
  assert.equal(equipe('Ventes')!.managerId, 19);
  assert.ok(loadFull(db, RH).employes.filter(e => e.equipe === 'Ventes').length > 0, 'membres suivis');
  const j = db.sql.prepare(`SELECT payload, salaries FROM journal WHERE action = 'equipe.modifier'`).get() as { payload: string; salaries: string };
  assert.deepEqual(JSON.parse(j.payload).avant, { nom: 'Commercial', managerId: avant.managerId ?? null });
  assert.deepEqual(JSON.parse(j.payload).apres, { nom: 'Ventes', managerId: 19 });
  assert.ok(JSON.parse(j.salaries).includes(19));
  // Un seul des deux, ou rien.
  assert.match(String(run(RH, 'equipe.modifier', { nom: 'Ventes', managerId: null }).message), /n’a plus de manager/);
  assert.match(String(run(RH, 'equipe.modifier', { nom: 'Ventes', nouveau: 'Commercial' }).message), /renommée en Commercial$/);
  assert.equal(run(RH, 'equipe.modifier', { nom: 'Commercial', nouveau: 'Commercial' }).message, 'Aucune modification à enregistrer');
  refus(RH, 'equipe.modifier', { nom: 'Inconnue', nouveau: 'X' }, 404);
});

// — t090 : déplacements importés sans référence —

test('import sans référence : DD-<n°> sans doublon, demandeur reconnu ou gardé tel que saisi, masqué hors du service RH', () => {
  const { db, run, RH, MEHDI } = fresh();
  assert.equal(referenceDeplacement(12, new Set()), 'DD-12');
  assert.equal(referenceDeplacement(12, new Set(['DD-12', 'DD-12-2'])), 'DD-12-3');
  const texte = 'reference;collaborateur;destination;depart;retour;motif;demandeur\n'
    + ';Mehdi Benali;Maroc;02/03/2027;05/03/2027;Visite client;nadia kaci\n'
    + ';Clara Roussel;Maroc;09/03/2027;12/03/2027;Visite client;Agence Voyages Sud';
  const lignes = parseTrips(new Domain(loadFull(db, RH)), texte);
  assert.deepEqual(lignes.map(r => [r.ok, r.demandeur, r.demandeurConnu]), [[true, 'Nadia Kaci', true], [true, 'Agence Voyages Sud', false]]);
  const max = Number((db.sql.prepare('SELECT MAX(id) AS n FROM voyages').get() as { n: number }).n);
  // Une référence « DD-<n°> » déjà prise par un import précédent : la suivante reçoit un suffixe.
  db.sql.prepare(`UPDATE voyages SET ref = ? WHERE id = ?`).run(`DD-${max + 1}`, max);
  run(RH, 'voyages.importer', { texte });
  const crees = loadFull(db, RH).voyages.filter(v => v.id > max);
  assert.deepEqual(crees.map(v => [v.ref, v.demandeur]), [[`DD-${max + 1}-2`, 'Nadia Kaci'], [`DD-${max + 2}`, 'Agence Voyages Sud']]);
  // Une ligne sans référence suivie d'une ligne qui porte « DD-<prochain n°> » : la première ne prend pas cette référence.
  run(RH, 'voyages.importer', { texte: 'reference;collaborateur;destination;depart;retour;motif\n'
    + `;Mehdi Benali;Maroc;02/04/2027;05/04/2027;Visite client\nDD-${max + 3};Clara Roussel;Maroc;09/04/2027;12/04/2027;Visite client` });
  assert.deepEqual(loadFull(db, RH).voyages.filter(v => v.id > max + 2).map(v => v.ref), [`DD-${max + 3}-2`, `DD-${max + 3}`]);
  const d = new Domain(loadFull(db, RH));
  assert.equal(d.originLabel(crees[0]), `Formulaire de demande DD-${max + 1}-2`);
  assert.equal(d.originLabel({ ...crees[0], ref: null }), 'Formulaire de demande', 'jamais « null »');
  // Le demandeur (nom saisi) reste au service RH.
  const mien = buildSnapshot(db, MEHDI).voyages.find(v => v.id === crees[0].id)!;
  assert.equal(mien.demandeur, null);
});

test('migration : référence DD-<n°> donnée une fois aux déplacements importés sans référence, tracée', () => {
  const { db } = fresh();
  const max = Number((db.sql.prepare('SELECT MAX(id) AS n FROM voyages').get() as { n: number }).n);
  db.sql.prepare(`UPDATE voyages SET ref = NULL WHERE id = ?`).run(max);
  db.sql.prepare(`UPDATE voyages SET origine = 'formulaire' WHERE id = ?`).run(max);
  assert.equal(REFERENCES_DEPLACEMENTS.necessaire!(db), true);
  assert.ok(appliquerMigrations(db).includes('lot5-voyages-references'));
  assert.equal((db.get<{ ref: string }>('voyages', max))!.ref, `DD-${max}`);
  const j = db.sql.prepare(`SELECT payload FROM journal WHERE action = 'migration.referencesDeplacements'`).get() as { payload: string };
  assert.deepEqual(JSON.parse(j.payload), { deplacements: 1 });
  assert.deepEqual(appliquerMigrations(db), [], 'une seule fois');
  assert.equal((db.sql.prepare(`SELECT COUNT(*) AS n FROM voyages WHERE origine = 'formulaire' AND ref IS NULL`).get() as { n: number }).n, 0);
});

// — t106 et t153 : listes vides et impression (contrôles du code de l'interface, sans rendu) —

const { readFileSync } = await import('node:fs');
const source = (f: string) => readFileSync(new URL(`../client/src/${f}`, import.meta.url), 'utf8');

test('listes vides : un message plutôt qu’un cadre vide (tableau de bord, missions)', () => {
  const dash = source('pages/Dashboard.tsx'), missions = source('pages/Missions.tsx');
  for (const m of ['Aucune échéance dans les {horizon} jours.', 'Aucune équipe.', 'Aucune session à venir.', 'Aucun déplacement à préparer.']) assert.ok(dash.includes(`<Empty`) && dash.includes(m), m);
  for (const m of ['Personne en mission ni absent sur les 4 semaines.', 'Aucune mission en cours ou à venir.']) assert.ok(missions.includes(m), m);
});

test('impression : jetons clairs pour Ctrl+P, A4 à 15 mm, cadre caché avec l’onglet en secours, en-tête employeur, matricules', () => {
  const app = source('styles/app.css'), css = source('styles/print.css'), print = source('print.ts');
  const media = app.slice(app.indexOf('@media print'));
  for (const jeton of ['--color-text: #1d1f2b', '--color-bg: #fff', '--color-surface: #fff', '--color-neutral-300:', '--color-divider:']) assert.ok(media.includes(jeton), jeton);
  assert.match(media, /@page \{ size: A4; margin: 15mm; \}/);
  assert.match(css, /@page \{ size: A4; margin: 15mm; \}/);
  assert.match(css, /h2 \{[^}]*break-after: avoid/);
  assert.match(print, /createElement\('iframe'\)/);
  assert.match(print, /window\.open\('', '_blank'\)/, 'nouvel onglet en secours');
  assert.match(print, /api\.confidentialite\(\)/, 'en-tête : responsable du traitement');
  // Une réponse vide n'est pas gardée, et la coordonnée est relue après son réglage (même onglet, sans recharger).
  assert.match(print, /if \(!v && employeur === lecture\) employeur = null/);
  assert.match(source('pages/parametres/Rgpd.tsx'), /oublierEnteteEmployeur\(\)/);
  assert.doesNotMatch(print, /<style/, 'CSP : aucun style en ligne');
  for (const f of ['pages/Collaborateurs.tsx', 'dialogs/compteRendu.ts', 'components/Aptitude.tsx']) assert.match(source(f), /matriculesImprimes\(e\)/, f);
});
