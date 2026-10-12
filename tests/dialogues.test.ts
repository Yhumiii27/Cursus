// Dialogues : focus (cycle de Tab), contrôles des champs affichés sous chaque champ, confirmations des refus et des
// actions irréversibles (motif obligatoire, paramètres envoyés) ; côté serveur, motif d'un refus conservé et montré
// à l'intéressé, jamais transmis à Keystone. Garde-fous sur le code des dialogues : plus de window.confirm, chaque
// dialogue de saisie est un formulaire envoyé par Entrée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { rangTabulation } = await import('../client/src/components/focus.ts');
const { erreurDate, erreurJours, erreursPeriode, erreurTexte } = await import('../client/src/components/controles.ts');
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
});

// — Confirmations —

test('refus : motif obligatoire, envoyé avec les paramètres de l’action, lecteurs annoncés', () => {
  const c = C.refusDemande({ id: 7, type: 'formation' }, 'Mehdi Benali', 'CACES R489', { manager: 'Karim Haddad' });
  assert.equal(c.action, 'demande.refuser');
  assert.equal(c.motif?.requis, true);
  assert.match(c.motif!.aide, /Mehdi Benali et de son manager/);
  assert.ok(c.suites!.some(s => /Karim Haddad, qui a fait la demande/.test(s)));
  assert.equal(C.erreurMotif(c, '   '), 'Indiquez le motif du refus.');
  assert.match(C.erreurMotif(c, 'x'.repeat(C.MOTIF_MAX + 1))!, /trop long/);
  assert.equal(C.erreurMotif(c, 'Budget engagé'), null);
  assert.deepEqual(C.parametres(c, '  Budget engagé '), { id: 7, motif: 'Budget engagé' });
  const doc = C.refusDemande({ id: 8, type: 'document' }, 'Mehdi Benali', 'Passeport', { retire: true });
  assert.equal(doc.bouton, 'Refuser la déclaration');
  assert.ok(doc.suites!.some(s => /en est retiré/.test(s)));
  assert.deepEqual(C.parametres(C.refusAbsence({ id: 3 }, 'Mehdi Benali', 'CP, le 12 oct.'), 'Pic d’activité'), { id: 3, ok: false, motif: 'Pic d’activité' });
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

test('refus d’une demande au service RH : motif à côté de la réponse, dans l’espace du collaborateur', () => {
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
});

test('refus d’une demande Keystone : motif conservé dans Cursus, absent du message envoyé à Keystone', () => {
  const { db, run } = fresh();
  const dm = loadFull(db, RH).demandesKeystone.find(x => x.statut === 'attente')!;
  run(RH, 'keystone.refuser', { id: dm.id, motif: 'Visa impossible à obtenir à temps' });
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
  const fichiers = ['pages', 'dialogs', 'layout', 'components'].flatMap(d => readdirSync(new URL(`../client/src/${d}/`, import.meta.url)).map(f => `${d}/${f}`));
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
