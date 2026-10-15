// Dialogues : focus (cycle de Tab), contrôles des champs affichés sous chaque champ, confirmations des refus et des
// actions irréversibles (motif obligatoire, paramètres envoyés, lecteurs annoncés) ; côté serveur, motif d'un refus
// conservé, montré à ceux qu'annonce la confirmation et à eux seuls, jamais transmis à Keystone. Garde-fous sur le
// code des dialogues : plus de window.confirm, chaque dialogue de saisie est un formulaire envoyé par Entrée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { rangTabulation } = await import('../client/src/components/focus.ts');
const { erreurDate, erreurEntier, erreurJours, erreursPeriode, erreursSession, erreurTexte } = await import('../client/src/components/controles.ts');
const C = await import('../client/src/state/confirmations.ts');
const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
type User = Parameters<typeof buildSnapshot>[1];

// — Focus —

test('Tab boucle dans le dialogue : du dernier élément au premier, et inversement', () => {
  assert.equal(rangTabulation(4, 3, false), 0, 'Tab sur le dernier : premier');
  assert.equal(rangTabulation(4, 0, true), 3, 'Maj+Tab sur le premier : dernier');
  assert.equal(rangTabulation(4, 1, false), null, 'au milieu : le navigateur avance seul');
  assert.equal(rangTabulation(4, 2, true), null);
  assert.equal(rangTabulation(4, -1, false), 0, 'focus sur la fenêtre ou hors d’elle : premier élément');
  assert.equal(rangTabulation(4, -1, true), 3);
  assert.equal(rangTabulation(0, -1, false), null, 'aucun élément : rien à cibler');
  assert.equal(rangTabulation(1, 0, false), 0);
});

// — Contrôles des champs —

test('champs : message sous le champ pour ce qui manque ou est mal saisi', () => {
  assert.equal(erreurTexte('  ', 'Indiquez le motif.'), 'Indiquez le motif.');
  assert.equal(erreurTexte(' Arrêt ', 'Indiquez le motif.'), null);
  assert.equal(erreurDate('', 'Indiquez la date.'), 'Indiquez la date.');
  assert.equal(erreurDate('26-10-12', 'Indiquez la date.'), 'Date invalide.');
  assert.equal(erreurDate('2026-10-12', 'Indiquez la date.'), null);
  const vides = { du: 'Indiquez le premier jour.', au: 'Indiquez le dernier jour.' };
  assert.deepEqual(erreursPeriode('', '', vides), { du: vides.du, au: vides.au });
  assert.deepEqual(erreursPeriode('2026-10-12', '2026-10-09', vides), { du: null, au: 'La fin précède le début.' }, 'erreur sous la fin');
  assert.deepEqual(erreursPeriode('2026-10-12', '2026-10-12', vides), { du: null, au: null });
  assert.equal(erreurJours('', 5), 'Indiquez le nombre de jours.');
  assert.match(erreurJours('1.3', 5)!, /demi-journée/);
  assert.equal(erreurJours('6', 5), '5 j au plus.');
  assert.equal(erreurJours('2.5', 2.5), null);
  assert.equal(erreurJours('1', 0), 'Aucun jour disponible.');
  assert.equal(erreurEntier('', 1, 'Indiquez le nombre de places.'), 'Indiquez le nombre de places.');
  assert.equal(erreurEntier('2.5', 1, 'Indiquez le nombre de places.'), 'Nombre entier, au moins 1.');
  assert.equal(erreurEntier('0', 1, 'Indiquez le nombre de places.'), 'Nombre entier, au moins 1.');
  assert.equal(erreurEntier('12', 1, 'Indiquez le nombre de places.'), null);
});

test('session de formation : une erreur sous chaque champ à la fois, vide à l’envoi, saisie incorrecte dès la saisie', () => {
  // Date et lieu vides : les deux champs sont signalés au même envoi (le contrôle partagé s'arrête au premier).
  const vide = erreursSession('2026-10-10', { date: '', lieu: '  ', places: '8' });
  assert.deepEqual(vide.champs, { date: 'Indiquez la date de la session.', lieu: 'Indiquez le lieu.', places: null });
  assert.deepEqual(vide.vides, { date: true, lieu: true, places: false }, 'champs vides : signalés à l’envoi seulement');
  assert.equal(vide.bloque, true);
  const tout = erreursSession('2026-10-10', { date: '', lieu: '', places: '' });
  assert.deepEqual(Object.keys(tout.champs).filter(k => tout.champs[k as 'date']), ['date', 'lieu', 'places']);
  // Date passée (règle du serveur) et lieu vide : la règle sous la date, dès la saisie ; le manque sous le lieu.
  const passee = erreursSession('2026-10-10', { date: '2026-10-01', lieu: '', places: '8' });
  assert.equal(passee.champs.date, 'La date de la session doit être postérieure à aujourd’hui.');
  assert.equal(passee.vides.date, false);
  assert.equal(passee.champs.lieu, 'Indiquez le lieu.');
  // Nombre de places mal saisi : signalé dès la saisie, comme avant la séparation des erreurs par champ.
  const zero = erreursSession('2026-10-10', { date: '2026-11-05', lieu: 'Lyon', places: '0' });
  assert.deepEqual([zero.champs.places, zero.vides.places, zero.bloque], ['Nombre entier, au moins 1.', false, true]);
  // Places inférieures au nombre d'inscrits d'une session existante.
  const places = erreursSession('2026-10-10', { date: '2026-11-05', lieu: 'Lyon', places: '3' }, { dateActuelle: '2026-11-05', inscrits: 5 });
  assert.equal(places.champs.places, 'Nombre de places inférieur au nombre d’inscrits (5).');
  const ok = erreursSession('2026-10-10', { date: '2026-11-05', lieu: 'Lyon', places: '8' });
  assert.deepEqual([ok.champs, ok.bloque], [{ date: null, lieu: null, places: null }, false]);
});

// — Confirmations —

test('refus : motif obligatoire, envoyé avec les paramètres de l’action, lecteurs annoncés', () => {
  const c = C.refusDemande({ id: 7, type: 'formation' }, 'Mehdi Benali', 'CACES R489', { manager: 'Karim Haddad' });
  assert.equal(c.action, 'demande.refuser');
  assert.equal(c.motif?.requis, true);
  // Demande au service RH : le motif n'est montré qu'au collaborateur, même quand son manager a fait la demande.
  assert.match(c.motif!.aide, /^Le motif est visible de Mehdi Benali : /);
  assert.ok(c.suites!.some(s => /Le refus n’apparaît pas dans l’espace de Karim Haddad, qui a fait la demande/.test(s)));
  assert.equal(C.erreurMotif(c, '   '), 'Indiquez le motif du refus.');
  assert.match(C.erreurMotif(c, 'x'.repeat(C.MOTIF_MAX + 1))!, /trop long/);
  assert.equal(C.erreurMotif(c, 'Budget engagé'), null);
  assert.deepEqual(C.parametres(c, '  Budget engagé '), { id: 7, motif: 'Budget engagé' });
  const doc = C.refusDemande({ id: 8, type: 'document' }, 'Mehdi Benali', 'Passeport', { retire: true });
  assert.equal(doc.bouton, 'Refuser la déclaration');
  assert.ok(doc.suites!.some(s => /en est retiré/.test(s)));
  assert.deepEqual(C.parametres(C.refusAbsence({ id: 3 }, 'Mehdi Benali', 'CP, le 12 oct.'), 'Pic d’activité'), { id: 3, ok: false, motif: 'Pic d’activité' });
  // Absence refusée par le service RH : le manager du salarié voit aussi le motif dans ses absences.
  const abs = C.refusAbsence({ id: 3 }, 'Mehdi Benali', 'CP, le 12 oct.', 'Karim Haddad');
  assert.match(abs.motif!.aide, /^Le motif est visible de Mehdi Benali et de son manager, Karim Haddad : /);
  assert.ok(abs.suites!.some(s => /comme son manager, Karim Haddad/.test(s)));
  assert.match(C.refusAbsence({ id: 3 }, 'Mehdi Benali', 'CP, le 12 oct.', null).motif!.aide, /^Le motif est visible de Mehdi Benali : /, 'refus par le manager lui-même');
  const ks = C.refusKeystone({ id: 4 }, 'Inès Dupont', 'K-2614 · Kenitra');
  assert.match(ks.motif!.aide, /jamais transmis à Keystone/);
});

test('actions irréversibles : confirmation sans motif, paramètres inchangés, suite après succès', () => {
  const ligne = { empId: 2, week: '2026-10-12', li: 0, projet: 'INT-MAINT', tache: 'Maintenance', lignes: 2 };
  const c = C.suppressionLigne(ligne, 'INT-MAINT · Maintenance', 14);
  assert.equal(c.motif, undefined);
  assert.equal(C.erreurMotif(c, ''), null);
  assert.deepEqual(C.parametres(c, 'ignoré'), ligne, 'la ligne visée part telle quelle (temps.removeLine)');
  assert.match(c.question, /14 h/);
  assert.match(C.transmissionSage(3, 2).question, /3 feuilles validées \(2 salariés\)/);
  assert.deepEqual(C.retraitEquipe(2, 'Mehdi Benali', 'Maintenance', { selectedId: null }).ensuite, { ui: { selectedId: null } });
  assert.deepEqual(C.changementManager('Logistique', 'Hugo Lambert', null).payload, { nom: 'Logistique', managerId: null });
  assert.deepEqual(C.nouveauMotDePasse({ id: 9, nom: 'Paul Martin', identifiant: 'paul.martin' }).ensuite, { motDePasse: { nom: 'Paul Martin', identifiant: 'paul.martin' } });
  // Données seulement : la confirmation se garde dans le brouillon d'une reconnexion Microsoft.
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
});

// — Motif des refus côté serveur —

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  return { db, run };
}

test('refus d’une absence : motif conservé et montré au salarié comme à son manager', () => {
  const { db, run } = fresh();
  const a = db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`).get() as { id: number };
  assert.throws(() => run(KARIM, 'absence.decider', { id: a.id, ok: false, motif: 'x'.repeat(501) }), /Motif trop long/);
  assert.match(String(run(KARIM, 'absence.decider', { id: a.id, ok: false, motif: '  Période de forte activité ' })), /refusée · motif communiqué au salarié/);
  const vue = (u: User) => buildSnapshot(db, u).absences.find(x => x.id === a.id);
  assert.equal(vue(MEHDI)?.motifRefus, 'Période de forte activité');
  assert.equal(vue(KARIM)?.motifRefus, 'Période de forte activité');
  assert.equal(vue(MEHDI)?.statut, 'refusee');
  // Validation : aucun motif de refus.
  const b = db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 1 AND statut = 'demandee'`).get() as { id: number } | undefined;
  if (b) {
    run(RH, 'absence.decider', { id: b.id, ok: true, motif: 'ignoré' });
    assert.equal(loadFull(db, RH).absences.find(x => x.id === b.id)?.motifRefus ?? null, null);
  }
});

test('refus d’une demande au service RH : motif à côté de la réponse, dans l’espace du collaborateur seul', () => {
  const { db, run } = fresh();
  const id = db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'habilitation', f: null, h: 'aipr', libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
  }).id;
  run(RH, 'demande.refuser', { id, motif: 'Formation AIPR prévue en janvier' });
  const r = buildSnapshot(db, MEHDI).demandesCollab.find(x => x.id === id)!;
  assert.equal(r.statut, 'refusee');
  assert.equal(r.reponse, 'Refusée par le service RH');
  assert.equal(r.motifRefus, 'Formation AIPR prévue en janvier');
  // Appel sans motif (ancien client, API) : accepté, réponse par défaut seule.
  const id2 = db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'habilitation', f: null, h: 'h0b0', libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
  }).id;
  run(RH, 'demande.refuser', { id: id2 });
  assert.equal(loadFull(db, RH).demandesCollab.find(x => x.id === id2)?.motifRefus ?? null, null);
  // Le manager ne reçoit pas le motif, que la demande vienne du collaborateur ou de lui (la confirmation l'annonce).
  const id3 = db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'formation', f: 'sst', h: null, libelle: null, label: null, sessionId: null, motif: 'Équipe', date: '2026-10-06', statut: 'attente', reponse: null, parId: 12,
  }).id;
  run(RH, 'demande.refuser', { id: id3, motif: 'Budget engagé' });
  const vueKarim = buildSnapshot(db, KARIM).demandesCollab;
  for (const x of [id, id3]) {
    assert.equal(vueKarim.find(y => y.id === x)?.statut, 'refusee');
    assert.equal(vueKarim.find(y => y.id === x)?.motifRefus, null, `demande ${x} : motif réservé au collaborateur`);
  }
  assert.equal(buildSnapshot(db, MEHDI).demandesCollab.find(x => x.id === id3)?.motifRefus, 'Budget engagé', 'demande faite par le manager');
});

test('refus d’une demande Keystone : motif conservé dans Cursus, absent du message envoyé à Keystone', () => {
  const { db, run } = fresh();
  const dm = loadFull(db, RH).demandesKeystone.find(x => x.statut === 'attente')!;
  // Le message de l'action, inscrit au journal (lu par le service RH), porte le motif.
  assert.match(String(run(RH, 'keystone.refuser', { id: dm.id, motif: 'Visa impossible à obtenir à temps' })), / · motif : Visa impossible à obtenir à temps$/);
  assert.equal(loadFull(db, RH).demandesKeystone.find(x => x.id === dm.id)?.motifRefus, 'Visa impossible à obtenir à temps');
  const envois = db.sql.prepare(`SELECT contenu FROM envois WHERE type = 'demande.decision'`).all() as { contenu: string }[];
  assert.ok(envois.length > 0);
  assert.ok(envois.every(e => !e.contenu.includes('Visa impossible')), 'texte libre jamais transmis');
  assert.deepEqual(buildSnapshot(db, KARIM).demandesKeystone, [], 'réservé au service RH');
});

// — Garde-fous sur le code des dialogues —

const lire = (p: string) => readFileSync(new URL(`../client/src/${p}`, import.meta.url), 'utf8');
const DIALOGUES = readdirSync(new URL('../client/src/dialogs/', import.meta.url)).filter(f => f.endsWith('Dialog.tsx'));

test('plus aucun window.confirm : les confirmations passent par le dialogue de confirmation', () => {
  // Sous-dossiers compris (sections de Paramètres : pages/parametres/).
  const fichiers = ['pages', 'dialogs', 'layout', 'components'].flatMap(d => readdirSync(new URL(`../client/src/${d}/`, import.meta.url), { recursive: true }).map(f => `${d}/${f}`));
  const avec = fichiers.filter(f => /\.tsx?$/.test(f) && /window\.confirm\(|\bconfirm\(['`]/.test(lire(f)));
  assert.deepEqual(avec, []);
});

test('dialogues de saisie : formulaires envoyés par Entrée, bouton principal jamais grisé pour une saisie incomplète', () => {
  // L'entretien enregistre chaque section en quittant le champ : pas d'envoi global.
  const sansEnvoi = new Set(['EntDialog.tsx']);
  const saisie = DIALOGUES.filter(f => !sansEnvoi.has(f) && /<(input|select|textarea)\b/.test(lire(`dialogs/${f}`)));
  assert.ok(saisie.length >= 20, `${saisie.length} dialogues de saisie`);
  for (const f of saisie) {
    const src = lire(`dialogs/${f}`);
    assert.match(src, /onSubmit=/, `${f} : formulaire (onSubmit)`);
    assert.match(src, /SubmitButton|type="submit"/, `${f} : bouton d'envoi`);
    assert.doesNotMatch(src, /btn-primary" disabled=\{[^}]*(cant|!valid|!ok\b|!sel|err)/, `${f} : bouton principal grisé sans explication`);
  }
});
