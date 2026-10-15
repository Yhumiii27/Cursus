// Journal des actions : liste blanche par action (jamais de numéro de passeport, de CSV, de texte libre, de nature
// d'absence ni de donnée de santé), anciennes et nouvelles valeurs, salariés concernés (transmission à la paie,
// import, session annulée), corrections d'heures du manager ou du RH quel que soit le statut de la feuille,
// regroupement des comptes rendus, reprise des anciennes lignes, durées de conservation (archive paie, bilan
// quotidien, envois anciens), réinitialisation de la démonstration sans effacer le journal, droits de lecture par
// profil, refus bornés, données d'un salarié. Scénario HTTP (vrai serveur) : consultation filtrée et paginée,
// export CSV (formules neutralisées), archive sur demande (chaque page tracée), refus d'accès, connexions,
// changements d'espace et exports tracés, export RH et téléchargement par l'intéressé.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db, TABLES } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const {
  appliquerConservation, celluleCsv, DETAIL_RESERVE, expurgerMessage, journaliserAction, lireJournal, marquerPaie, MENTION_NATURE, MENTION_SANTE, pourLecteur,
  preparerTrace, REGLES, reprendreJournal, tracerRefus,
} = await import('../server/src/journal.ts');
const { journaliser } = await import('../server/src/comptes.ts');
const { ActionError } = await import('../server/src/actions/context.ts');
const { donneesSalarie, TABLES_SALARIE } = await import('../server/src/donnees.ts');
const { changementsTexte, dossierComplet, JOURNAL_LABEL, lecteurJournal } = await import('../shared/journal.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
const { SAMPLE_TRIPS_CSV } = await import('../shared/rules/imports.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;
interface Ligne {
  id: number; at: string; actor: string; role: string | null; action: string; message: string | null; payload: Record<string, any>;
  salaries: number[] | null; paie: boolean; archivee: string | null; compteId: number | null;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-journal-'));
const procs: ChildProcess[] = [];
after(() => {
  procs.forEach(p => p.kill());
  rmSync(dir, { recursive: true, force: true });
});
const SANTE = new RegExp(MENTION_SANTE.replace(/[[\]]/g, '\\$&'));
const NATURE = new RegExp(MENTION_NATURE.replace(/[[\]]/g, '\\$&'));

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace après). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const ctx = makeCtx(db, u, loadFull(db, u));
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](ctx, p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return o;
  });
  const lignes = () => db.all<Ligne>('journal');
  const derniere = (action: string) => lignes().findLast(j => j.action === action);
  const id = (sql: string, ...a: (string | number)[]) => (db.sql.prepare(sql).get(...a) as { id: number }).id;
  return { db, user, run, lignes, derniere, id, RH: user(null, 'rh'), KARIM: user(12, 'manager'), MEHDI: user(2, 'collaborateur') };
}

test('liste blanche : ni numéro de passeport, ni vaccin, ni CSV importé, ni motif libre', () => {
  const { db, run, derniere, lignes, RH, MEHDI } = fresh();
  run(RH, 'formalite.enregistrer', { empId: 2, kind: 'passeport', numero: '21XY99887', expire: '2033-05-01' });
  assert.deepEqual(derniere('formalite.enregistrer')!.payload, { empId: 2, kind: 'passeport', expire: '2033-05-01' });
  run(RH, 'formalite.enregistrer', { empId: 2, kind: 'vaccin', v: 'fj', date: '2026-09-01' });
  const vaccin = derniere('formalite.enregistrer')!;
  assert.deepEqual(vaccin.payload, { empId: 2, kind: 'vaccin' });
  assert.deepEqual(vaccin.salaries, [2]);
  assert.match(vaccin.message!, /^Vaccination \[donnée de santé\] enregistrée — Mehdi Benali$/);
  run(MEHDI, 'formalite.enregistrer', { empId: 2, kind: 'vaccin', v: 'hepA', date: '2026-09-15' });
  const dernierVoyage = db.sql.prepare('SELECT MAX(id) AS n FROM voyages').get() as { n: number };
  run(RH, 'voyages.importer', { texte: SAMPLE_TRIPS_CSV.replace('Audit fournisseur', 'Chantier secret 12345') });
  // Import : nombre de déplacements créés et leurs salariés (historique de leur fiche), jamais le CSV.
  const crees = (db.sql.prepare('SELECT emp_id AS e FROM voyages WHERE id > ? ORDER BY id').all(dernierVoyage.n) as { e: number }[]).map(r => r.e);
  assert.ok(crees.length > 0);
  assert.deepEqual(derniere('voyages.importer')!.payload, { deplacements: crees.length });
  assert.deepEqual(derniere('voyages.importer')!.salaries, [...new Set(crees)]);
  run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Restriction médicale : vertiges' });
  assert.deepEqual(derniere('hab.suspendre')!.payload, { empId: 2, h: 'hauteur' });
  run(RH, 'report.accorder', { empId: 2, jours: 1, motif: 'CP non pris — arrêt de travail pour lombalgie' });
  const tout = JSON.stringify(lignes());
  for (const secret of ['21XY99887', 'Fièvre jaune', 'Hépatite', '"fj"', 'hepA', 'Chantier secret', '12345', 'vertiges', 'Restriction', 'lombalgie']) {
    assert.ok(!tout.includes(secret), `absent du journal : ${secret}`);
  }
  // Les actions actuelles ont chacune leur règle et leur libellé (une action sans règle ne recopie aucun champ).
  assert.deepEqual(Object.keys(REGLES).filter(a => !ACTIONS[a]), [], 'règle d’une action qui n’existe plus');
  assert.deepEqual(['employe.modifier', 'temps.validate', 'absence.qualifier', 'formalite.enregistrer'].filter(a => !REGLES[a] || !JOURNAL_LABEL[a]), []);
});

test('absences : jamais de nature, ni dans le contenu ni dans le message', () => {
  const { run, derniere, lignes, id, RH, KARIM } = fresh();
  run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-16', justificatif: true, justificatifLe: '2026-10-09' });
  const s = derniere('absence.saisir')!;
  assert.equal(s.payload.nature, undefined);
  assert.deepEqual(s.salaries, [2]);
  assert.ok(s.paie, 'absence saisie, validée d’emblée : action liée à la paie');
  assert.match(s.message!, NATURE);
  // Même marqueur pour une nature médicale ou non : il ne dit pas que l'absence touchait à la santé.
  run(RH, 'absence.saisir', { empId: 2, nature: 'NAISSANCE', du: '2026-11-09', au: '2026-11-11', justificatif: true, justificatifLe: '2026-10-09' });
  const naissance = derniere('absence.saisir')!.message!;
  run(RH, 'absence.saisir', { empId: 2, nature: 'ENFANT_MALADE', du: '2026-11-16', au: '2026-11-17', justificatif: true, justificatifLe: '2026-10-09' });
  const enfant = derniere('absence.saisir')!.message!;
  const sansDates = (m: string) => m.replace(/du \d+ \S+ au \d+ \S+ 2026/, 'du … au …');
  assert.equal(sansDates(naissance), sansDates(enfant));
  assert.equal(sansDates(naissance), sansDates(s.message!));
  assert.match(naissance, NATURE);
  run(RH, 'absence.annuler', { id: id(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-11-16'`) });
  assert.match(derniere('absence.annuler')!.message!, /^Absence de Mehdi Benali \(\[nature d’absence\]\) annulée/);
  const texte = JSON.stringify(lignes());
  assert.ok(!/naissance|enfant malade/i.test(texte) && !SANTE.test(texte), 'aucune nature, ni marqueur de santé');
  // Signalée par le manager, qualifiée ensuite en accident du travail par le RH : dates et statut, jamais la nature.
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-12-21', au: '2026-12-22' });
  const a = id(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-21'`);
  run(RH, 'absence.qualifier', { id: a, nature: 'AT', du: '2026-12-21', au: '2026-12-23', justificatif: true, justificatifLe: '2026-10-09' });
  const q = derniere('absence.qualifier')!;
  assert.deepEqual([q.payload.avant, q.payload.apres], [{ au: '2026-12-22', statut: 'signalee', justificatif: false }, { au: '2026-12-23', statut: 'validee', justificatif: true }]);
  assert.deepEqual(q.salaries, [2]);
  const tout = JSON.stringify(lignes());
  assert.ok(!tout.includes('MALADIE') && !tout.includes('"AT"') && !/maladie|accident/i.test(tout), 'aucune nature médicale au journal');
  assert.equal(expurgerMessage('Absence de X qualifiée : accident du travail du 1 au 2 déc.'), `Absence de X qualifiée : ${MENTION_NATURE} du 1 au 2 déc.`);
  assert.equal(expurgerMessage('Absence de X enregistrée : congé de maternité'), `Absence de X enregistrée : ${MENTION_NATURE}`, 'nature non médicale masquée aussi');
  assert.equal(expurgerMessage('Absence de X (congés payés) annulée'), 'Absence de X (congés payés) annulée', 'congés payés : pas une nature');
  assert.equal(expurgerMessage('Vaccination Fièvre jaune enregistrée'), `Vaccination ${MENTION_SANTE} enregistrée`);
});

test('archive paie : une absence saisie, prolongée puis annulée y figure en entier', () => {
  const { db, run, lignes, id, RH } = fresh();
  run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-16', justificatif: true, justificatifLe: '2026-10-09' });
  const a = id(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-14'`);
  run(RH, 'absence.prolonger', { id: a, au: '2026-12-23' });
  run(RH, 'absence.annuler', { id: a });
  const absences = () => lignes().filter(l => l.action.startsWith('absence.'));
  assert.deepEqual(absences().map(l => [l.action, l.paie]), [['absence.saisir', true], ['absence.prolonger', true], ['absence.annuler', true]]);
  // Une ligne écrite avant que l'action ne soit « liée à la paie » est marquée au démarrage.
  db.sql.prepare(`UPDATE journal SET paie = 0 WHERE action = 'absence.annuler'`).run();
  assert.equal(marquerPaie(db), 1);
  appliquerConservation(db, new Date(Date.now() + 400 * 86_400_000));
  const archive = lireJournal(db, { vue: 'archive', du: null, au: null, auteur: null, action: null, salarie: 2 }).lignes;
  assert.deepEqual(archive.map(l => l.action).reverse(), ['absence.saisir', 'absence.prolonger', 'absence.annuler']);
});

test('anciennes et nouvelles valeurs : fiche, équipe, profil, paramètres', () => {
  const { run, derniere, RH, KARIM } = fresh();
  // La visite médicale s'enregistre avec l'avis (`medical.avis`) : l'année de naissance sert ici de champ hors fiche.
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien confirmé', naissance: 1985 });
  const m = derniere('employe.modifier')!;
  assert.deepEqual(m.payload, { id: 2, champsModifies: ['poste', 'naissance'], avant: { poste: 'Technicien de maintenance' }, apres: { poste: 'Technicien confirmé' } });
  assert.equal(changementsTexte(m.payload), 'Poste : Technicien de maintenance → Technicien confirmé');
  assert.deepEqual(m.salaries, [2]);
  run(KARIM, 'equipe.affecter', { empId: 2, equipe: null });
  assert.deepEqual([derniere('equipe.affecter')!.payload.avant, derniere('equipe.affecter')!.payload.apres], [{ equipe: 'Maintenance' }, { equipe: null }]);
  run(RH, 'parametres.maj', { horizonAlerte: 60 });
  assert.deepEqual([derniere('parametres.maj')!.payload.avant, derniere('parametres.maj')!.payload.apres], [{ horizonAlerte: 90 }, { horizonAlerte: 60 }]);
  const created = run(RH, 'employe.creer', { nom: 'Nouvel Embauché', poste: 'Technicien', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-05', naissance: 1990, jourOff: [] });
  assert.deepEqual(derniere('employe.creer')!.salaries, [(created.result as { id: number }).id]);
  assert.equal(derniere('employe.creer')!.payload.naissance, undefined);
});

test('feuilles de temps : saisie du salarié non tracée, correction du valideur tracée (paie), validation', () => {
  const { db, run, derniere, lignes, user, KARIM } = fresh();
  const n = lignes().length;
  run(user(1, 'collaborateur'), 'temps.setCell', { empId: 1, week: '2026-10-05', li: 0, di: 2, value: '7' });
  assert.equal(lignes().length, n, 'saisie d’une feuille en brouillon : pas de ligne');
  db.insert('feuilles', { empId: 2, week: '2026-10-12', statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance', ks: false, h: [7, 7, 7, 7, 7] }] });
  run(KARIM, 'temps.setCell', { empId: 2, week: '2026-10-12', li: 0, di: 0, value: '6,5' });
  const c = derniere('temps.correction')!;
  assert.deepEqual(c.payload, { empId: 2, week: '2026-10-12', projet: 'INT-MAINT', jour: '2026-10-12', feuille: 'soumise', avant: { heures: 7 }, apres: { heures: 6.5 } });
  assert.ok(c.paie);
  assert.deepEqual([c.actor, c.role, c.salaries], ['Karim Haddad', 'manager', [2]]);
  assert.match(c.message!, /^Correction d’heures — Mehdi Benali, INT-MAINT le 12 oct\. 2026 : 7 h → 6,5 h \(feuille à valider\)$/);
  const avant = lignes().length;
  run(KARIM, 'temps.setCell', { empId: 2, week: '2026-10-12', li: 0, di: 0, value: '6.5' });
  assert.equal(lignes().length, avant, 'même valeur : rien à tracer');
  run(KARIM, 'temps.removeLine', { empId: 2, week: '2026-10-12', li: 0 });
  assert.deepEqual([derniere('temps.correction')!.payload.projet, derniere('temps.correction')!.payload.apres], ['INT-MAINT', { heures: 0 }]);
  run(KARIM, 'temps.addLine', { empId: 2, week: '2026-10-12', projet: 'INT-MAINT' });
  run(KARIM, 'temps.setCell', { empId: 2, week: '2026-10-12', li: 0, di: 1, value: '7' });
  run(KARIM, 'temps.validate', { empId: 2, week: '2026-10-12' });
  const v = derniere('temps.validate')!;
  assert.deepEqual([v.payload.avant, v.payload.apres, v.payload.heures, v.paie], [{ statut: 'soumise' }, { statut: 'validee' }, 7, true]);
});

test('feuilles de temps : renvoi, saisie, soumission et validation par le manager, tout est tracé', () => {
  const { db, run, lignes, RH, KARIM } = fresh();
  db.insert('feuilles', { empId: 2, week: '2026-10-19', statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance', ks: false, h: [7, 7, 7, 7, 7] }] });
  const n = lignes().length;
  run(KARIM, 'temps.reject', { empId: 2, week: '2026-10-19', comment: 'À revoir' });
  // Feuille renvoyée : le manager peut la modifier lui-même, chaque cellule est une correction (action liée à la paie).
  for (let di = 0; di < 5; di++) run(KARIM, 'temps.setCell', { empId: 2, week: '2026-10-19', li: 0, di, value: '4' });
  run(KARIM, 'temps.submit', { empId: 2, week: '2026-10-19' });
  run(KARIM, 'temps.validate', { empId: 2, week: '2026-10-19' });
  // Les e-mails de notification (simulés) ont leurs propres lignes : seules les actions des personnes sont comptées ici.
  const toutes = lignes().slice(n);
  assert.ok(toutes.some(l => l.action === 'email.temps.renvoyee'), 'feuille renvoyée : salarié prévenu');
  const ls = toutes.filter(l => !l.action.startsWith('email.'));
  assert.deepEqual(ls.map(l => l.action), ['temps.reject', ...Array(5).fill('temps.correction'), 'temps.submit', 'temps.validate']);
  const corrections = ls.filter(l => l.action === 'temps.correction');
  assert.ok(corrections.every(l => l.paie && l.payload.feuille === 'rejetee' && l.payload.avant.heures === 7 && l.payload.apres.heures === 4 && l.actor === 'Karim Haddad'));
  assert.match(corrections[0].message!, /: 7 h → 4 h \(feuille à corriger\)$/);
  // Soumission et validation portent le total d'heures : 15 h retirées entre la feuille soumise et la feuille validée.
  assert.deepEqual(ls.filter(l => l.action === 'temps.submit' || l.action === 'temps.validate').map(l => l.payload.heures), [20, 20]);
  // Le service RH qui complète une feuille en brouillon est tracé aussi ; un ajout de ligne vide ne change aucune heure.
  run(RH, 'temps.addLine', { empId: 2, week: '2026-10-26', projet: 'INT-MAINT' });
  assert.equal(lignes().at(-1)!.action, 'temps.addLine');
  run(RH, 'temps.setCell', { empId: 2, week: '2026-10-26', li: 0, di: 0, value: '7' });
  const rh = lignes().at(-1)!;
  assert.deepEqual([rh.action, rh.payload.feuille, rh.payload.apres, rh.actor], ['temps.correction', 'brouillon', { heures: 7 }, 'Sandrine Vidal']);
});

test('transmission à la paie : feuilles transmises et salariés concernés (archive, historique, export de ses données)', () => {
  const { db, run, derniere, RH } = fresh();
  const avant = (db.sql.prepare(`SELECT id FROM feuilles WHERE statut = 'validee' AND sage = 0 ORDER BY id`).all() as { id: number }[]).map(f => f.id);
  const r = run(RH, 'temps.pushSage', {});
  // Celles qui viennent d'être transmises (les feuilles transmises auparavant n'y figurent pas ; intérim et dirigeants non plus).
  const transmises = (db.sql.prepare(`SELECT emp_id AS empId, week FROM feuilles WHERE sage = 1 AND id IN (${avant.join(', ')}) ORDER BY id`).all() as { empId: number; week: string }[]);
  assert.ok(transmises.length > 0 && transmises.length <= avant.length);
  assert.match(String(r.message), new RegExp(`^${transmises.length} feuilles transmises`));
  const l = derniere('temps.pushSage')!;
  assert.ok(l.paie);
  assert.deepEqual(l.payload.feuilles, transmises.map(f => ({ ...f })));
  assert.deepEqual(l.salaries, [...new Set(transmises.map(f => f.empId))]);
  assert.ok(transmises.some(f => f.empId === 1 && f.week === '2026-09-28'));
  const j = (donneesSalarie(db, 1, { journal: true, par: 'Sandrine Vidal' })!.sections as Record<string, { code: string; detail: Record<string, any> }[]>)['Journal des actions le concernant'];
  assert.ok(j.some(x => x.code === 'temps.pushSage' && x.detail.feuilles.some((f: { empId: number; week: string }) => f.empId === 1 && f.week === '2026-09-28')));
});

test('compte rendu d’entretien : section nommée sans son contenu, une ligne par compte et par demi-heure', () => {
  const { run, lignes, id, KARIM, MEHDI } = fresh();
  const e = id(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`);
  run(KARIM, 'entretien.modifier', { id: e, section: 'bilan', value: 'Texte confidentiel du bilan' });
  run(KARIM, 'entretien.modifier', { id: e, section: 'objectifs', value: 'Objectifs personnels' });
  run(KARIM, 'entretien.modifier', { id: e, section: 'bilan', value: 'Texte confidentiel corrigé' });
  run(MEHDI, 'entretien.modifier', { id: e, section: 'avis', value: 'Mon avis' });
  const ls = lignes().filter(j => j.action === 'entretien.modifier');
  assert.deepEqual(ls.map(j => [j.actor, j.payload.sections]), [['Karim Haddad', ['bilan', 'objectifs']], ['Mehdi Benali', ['avis']]]);
  assert.ok(ls.every(j => JSON.stringify(j.salaries) === '[2]'));
  assert.ok(!/confidentiel|Objectifs personnels|Mon avis/.test(JSON.stringify(lignes())));
});

test('salariés concernés : décision sur une absence, clôture d’une session', () => {
  const { db, run, derniere, id, RH, KARIM, MEHDI } = fresh();
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  run(KARIM, 'absence.decider', { id: id(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`), ok: true });
  const d = derniere('absence.decider')!;
  assert.deepEqual([d.salaries, d.paie, d.payload.apres], [[2], true, { statut: 'validee' }]);
  const s = db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-10-01', lieu: 'Site de Lyon', places: 8, statut: 'Confirmée', planId: null, bilan: null }).id;
  db.insert('inscriptions', { empId: 6, sessionId: s, convoc: 'now', date: '2026-09-01' });
  run(RH, 'session.cloturer', { id: s, participants: [{ empId: 6, present: true, reussi: true }], note: 4, commentaire: 'Formateur remarquable' });
  const c = derniere('session.cloturer')!;
  assert.deepEqual([c.salaries, c.payload.participants], [[6], [{ empId: 6, present: true, reussi: true }]]);
  assert.ok(!JSON.stringify(c).includes('remarquable'));
});

test('annulation d’une session : les recyclages rattachés, détachés par l’annulation, restent concernés', () => {
  const { db, run, derniere, RH } = fresh();
  const s = (db.sql.prepare(`SELECT id FROM sessions WHERE id IN (SELECT session_id FROM certifications) AND id IN (SELECT session_id FROM inscriptions) AND statut = 'Confirmée' ORDER BY id LIMIT 1`).get() as { id: number }).id;
  const recyclages = (db.sql.prepare('SELECT emp_id AS e FROM certifications WHERE session_id = ?').all(s) as { e: number }[]).map(r => r.e);
  const inscriptions = (db.sql.prepare('SELECT emp_id AS e FROM inscriptions WHERE session_id = ?').all(s) as { e: number }[]).map(r => r.e);
  assert.ok(recyclages.length && inscriptions.length);
  run(RH, 'session.annuler', { id: s });
  assert.equal((db.sql.prepare('SELECT COUNT(*) AS n FROM certifications WHERE session_id = ?').get(s) as { n: number }).n, 0, 'recyclages détachés');
  assert.deepEqual([...derniere('session.annuler')!.salaries!].sort((a, b) => a - b), [...new Set([...recyclages, ...inscriptions])].sort((a, b) => a - b));
});

test('anciennes lignes (contenu complet de la requête) : expurgées une fois au démarrage', () => {
  const { db, lignes } = fresh();
  const at = new Date().toISOString();
  const ins = (action: string, payload: unknown, message: string | null = null) => db.insert('journal', { at, actor: 'Sandrine Vidal', role: 'rh', action, message, payload });
  ins('formalite.enregistrer', { empId: 2, kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' }, 'Passeport de Mehdi Benali enregistré');
  ins('voyages.importer', { texte: 'ligne;secrète' });
  ins('absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-01', au: '2026-12-02' }, 'Absence de Mehdi Benali enregistrée : arrêt maladie');
  ins('temps.validate', { empId: 2, week: '2026-09-28', comment: 'x' });
  ins('connexion', { ip: '10.0.0.8' }, 'Connexion');
  ins('action.disparue', { secret: 'valeur' });
  reprendreJournal(db);
  const ls = lignes();
  assert.deepEqual(ls.map(l => l.payload), [
    { empId: 2, kind: 'passeport', expire: '2032-01-01' }, {}, { empId: 2, du: '2026-12-01', au: '2026-12-02' }, { empId: 2, week: '2026-09-28' }, { ip: '10.0.0.8' }, {},
  ]);
  assert.deepEqual(ls.map(l => l.salaries), [[2], [], [2], [2], [], []]);
  assert.deepEqual(ls.map(l => l.paie), [false, false, true, true, false, false]);
  assert.match(ls[2].message!, NATURE);
  // Une seule fois : une ligne écrite ensuite n'est plus reprise.
  ins('voyages.importer', { texte: 'gardé tel quel' });
  reprendreJournal(db);
  assert.deepEqual(lignes().at(-1)!.payload, { texte: 'gardé tel quel' });
  // Réglage effacé (réinitialisation de la démonstration) : les lignes au nouveau format ne sont pas reprises.
  db.insert('journal', { at, actor: 'Sandrine Vidal', role: 'rh', action: 'employe.modifier', message: null, payload: { id: 2, avant: { poste: 'A' }, apres: { poste: 'B' } }, salaries: [2] });
  db.setSetting('journalExpurge', false);
  reprendreJournal(db);
  assert.deepEqual(lignes().at(-1)!.payload, { id: 2, avant: { poste: 'A' }, apres: { poste: 'B' } });
});

test('conservation : 1 an, archive paie de 3 ans, envois anciens retirés de la file', () => {
  const { db, lignes } = fresh();
  const ins = (action: string, at: string, paie = false) => db.insert<Ligne>('journal', { at, actor: 'Cursus', role: null, action, message: null, payload: {}, salaries: [2], paie }).id;
  const A = ins('employe.modifier', '2026-10-15T08:00:00.000Z');
  const B = ins('temps.validate', '2026-10-15T08:00:00.000Z', true);
  const C = ins('temps.pushSage', '2024-10-01T08:00:00.000Z', true);
  const D = ins('connexion', '2027-06-01T08:00:00.000Z');
  const E = ins('connexion', '2026-10-20T08:00:00.000Z');
  const envoi = (statut: string, creation: string, classe: string | null = null) => db.insert<{ id: number }>('envois', {
    cible: 'keystone', type: 'heures.validees', cle: `cle-${statut}-${creation}-${classe}`, contenu: {}, statut, tentatives: 1, prochaine: null,
    erreur: null, accuse: null, creation, tentative: creation, envoi: statut === 'envoye' ? creation : null, classe,
  }).id;
  const anciens = [envoi('envoye', '2026-09-01T08:00:00.000Z'), envoi('simule', '2026-09-01T08:00:00.000Z'), envoi('echec', '2026-09-01T08:00:00.000Z', '2026-09-02T08:00:00.000Z')];
  const gardes = [envoi('echec', '2026-09-01T08:00:00.000Z'), envoi('a_envoyer', '2026-09-01T08:00:00.000Z'), envoi('envoye', '2027-10-01T08:00:00.000Z')];
  const maintenant = new Date('2027-11-01T00:00:00.000Z');
  const b = appliquerConservation(db, maintenant);
  assert.deepEqual(b, { supprimees: 2, archivees: 1, supprimeesArchive: 1, envois: 3 });
  const ids = lignes().map(l => l.id);
  assert.ok(!ids.includes(A) && !ids.includes(C) && !ids.includes(E) && ids.includes(B) && ids.includes(D));
  assert.equal(db.get<Ligne>('journal', B)!.archivee, maintenant.toISOString());
  assert.deepEqual(db.all<{ id: number }>('envois').map(e => e.id), gardes);
  assert.ok(anciens.every(x => !db.get('envois', x)));
  const resume = lignes().find(l => l.action === 'journal.conservation')!;
  assert.match(resume.message!, /2 lignes supprimées \(plus d’un an\) · 1 action liée à la paie archivée · 1 ligne supprimée de l’archive \(plus de 3 ans\) · 3 envois anciens retirés/);
  // L'archive n'apparaît pas dans le journal affiché ; elle se consulte à part.
  const vue = lireJournal(db, { vue: 'tout', du: null, au: null, auteur: null, action: null, salarie: null });
  assert.ok(!vue.lignes.some(l => l.id === B));
  assert.deepEqual(lireJournal(db, { vue: 'archive', du: null, au: null, auteur: null, action: null, salarie: 2 }).lignes.map(l => l.id), [B]);
  // Plus de 3 ans : l'archive elle-même est vidée.
  appliquerConservation(db, new Date('2029-11-01T00:00:00.000Z'));
  assert.equal(db.get('journal', B), undefined);
});

test('conservation : un seul bilan par jour, complété à chaque passage horaire', () => {
  const { db, lignes } = fresh();
  const ins = (at: string) => db.insert('journal', { at, actor: 'Cursus', role: 'integration', action: 'keystone.appel', message: null, payload: {}, salaries: [], paie: false });
  ins('2026-10-01T08:00:00.000Z');
  ins('2026-10-01T08:30:00.000Z');
  appliquerConservation(db, new Date('2027-10-01T12:00:00.000Z'));
  ins('2026-10-01T09:00:00.000Z');
  appliquerConservation(db, new Date('2027-10-01T12:30:00.000Z'));
  appliquerConservation(db, new Date('2027-10-01T12:45:00.000Z'));
  const bilans = lignes().filter(l => l.action === 'journal.conservation');
  assert.equal(bilans.length, 1, 'passages du même jour regroupés ; un passage sans effet n’écrit rien');
  assert.deepEqual([bilans[0].payload.supprimees, bilans[0].payload.passages, bilans[0].at], [3, 2, '2027-10-01T12:30:00.000Z']);
  assert.match(bilans[0].message!, /^Durée de conservation : 3 lignes supprimées \(plus d’un an\)$/);
  // Le lendemain : nouveau bilan.
  ins('2026-10-02T08:00:00.000Z');
  appliquerConservation(db, new Date('2027-10-02T12:00:00.000Z'));
  assert.equal(lignes().filter(l => l.action === 'journal.conservation').length, 2);
});

test('filtre « Action » : les appels de Keystone, absents de la vue Tout, s’y retrouvent quand on les demande', () => {
  const { db } = fresh();
  db.insert('journal', { at: new Date().toISOString(), actor: 'Keystone', role: 'integration', action: 'keystone.appel', message: 'GET /v1/ressources', payload: {}, salaries: [], paie: false });
  const f = (vue: 'tout' | 'operations' | 'keystone', action: string | null) => lireJournal(db, { vue, du: null, au: null, auteur: null, action, salarie: null }).total;
  assert.equal(f('tout', null), 0);
  assert.equal(f('tout', 'keystone.appel'), 1);
  assert.equal(f('tout', 'famille:integrations'), 1);
  assert.equal(f('operations', 'keystone.appel'), 1);
  assert.equal(f('keystone', null), 1);
  assert.equal(f('tout', 'famille:deplacements'), 0);
});

test('droits : journal au droit « rh » ou « consultation », dossier complet au droit « rh » seul', () => {
  const { db, run, RH, MEHDI } = fresh();
  // Profils du chantier « droits » (référent HSE, paie, lecture seule), simulés s'ils n'existent pas encore.
  const profils = PROFILS_RH as unknown as Record<string, { label: string; aide: string; droits: readonly string[] }>;
  const ajoutes = Object.entries({ referent_hse: ['formations'], paie: ['paie'], lecture_seule: ['consultation'] }).filter(([p]) => !profils[p]);
  for (const [p, droits] of ajoutes) profils[p] = { label: p, aide: '', droits };
  try {
    const u = (profilRh: string, role: User['role'] = 'rh') => ({ ...RH, role, profilRh }) as User;
    const table = ['rh_admin', 'rh_gestionnaire', 'lecture_seule', 'referent_hse', 'paie', 'aucun'].map(p => [p, lecteurJournal(u(p)), dossierComplet(u(p))]);
    assert.deepEqual(table, [
      ['rh_admin', true, true], ['rh_gestionnaire', true, true], ['lecture_seule', true, false], ['referent_hse', false, false], ['paie', false, false], ['aucun', false, false],
    ]);
    assert.equal(lecteurJournal(u('rh_admin', 'manager')), false, 'hors de l’espace RH : aucun droit');
    assert.equal(lecteurJournal({ ...RH, profilRh: undefined }), false, 'profil inconnu : aucun droit');
    // Lecture seule : message et détail des actions touchant à la santé masqués, le reste intact.
    run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-16', justificatif: true, justificatifLe: '2026-10-09' });
    run(MEHDI, 'formalite.enregistrer', { empId: 2, kind: 'vaccin', v: 'fj', date: '2026-09-01' });
    run(RH, 'employe.modifier', { id: 2, poste: 'Technicien confirmé' });
    const page = lireJournal(db, { vue: 'tout', du: null, au: null, auteur: null, action: null, salarie: null }).lignes;
    assert.deepEqual(pourLecteur(RH, page), page);
    const vues = pourLecteur(u('lecture_seule'), page);
    const de = (a: string) => vues.find(l => l.action === a)!;
    assert.deepEqual([de('absence.saisir').message, de('absence.saisir').details, de('absence.saisir').salaries], [DETAIL_RESERVE, {}, [2]]);
    assert.deepEqual([de('formalite.enregistrer').message, de('formalite.enregistrer').details], [DETAIL_RESERVE, {}]);
    assert.equal(de('employe.modifier').details.apres.poste, 'Technicien confirmé');
  } finally {
    for (const [p] of ajoutes) delete profils[p];
  }
});

test('refus d’accès : motif borné, quelle que soit la taille de ce qu’envoie le client', () => {
  const { db, run, lignes, KARIM } = fresh();
  const cle = 'x'.repeat(100_000);
  let motif = '';
  try { run(KARIM, 'employe.modifier', { id: 2, [cle]: 1 }); } catch (err) { assert.ok(err instanceof ActionError && err.status === 403); motif = err.message; }
  assert.ok(motif.length > 100_000, 'le motif reprend la clé envoyée');
  tracerRefus(db, { user: KARIM, compte: db.get('comptes', KARIM.compteId!)! }, 'Modification d’une fiche', motif, { action: 'employe.modifier', p: { id: 2, [cle]: 1 } });
  const l = lignes().at(-1)!;
  assert.equal(l.action, 'acces.refuse');
  assert.ok(l.message!.length < 300 && l.message!.endsWith('…'), `message borné (${l.message!.length})`);
  assert.ok(JSON.stringify(l.payload).length < 3000);
  // Par sécurité, tout message du journal est borné.
  journaliser(db, { actor: 'Cursus', role: null, action: 'export', message: 'y'.repeat(50_000) });
  assert.equal(lignes().at(-1)!.message!.length, 2001);
});

test('réinitialisation de la démonstration : le journal est conservé', () => {
  const { db, run, lignes, RH } = fresh();
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien confirmé' });
  const avant = lignes();
  seedDemo(db);
  assert.deepEqual(lignes().map(l => l.id), avant.map(l => l.id));
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien expert' });
  assert.ok(lignes().at(-1)!.id > avant.at(-1)!.id, 'numérotation poursuivie');
});

test('données d’un salarié : toutes les tables qui le concernent, sans secret', () => {
  const { db, run, RH, MEHDI } = fresh();
  run(RH, 'employe.modifier', { id: 2, poste: 'Technicien confirmé' });
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  db.update('comptes', (db.where<{ id: number }>('comptes', 'empId', 2)[0]).id, { motDePasse: 'scrypt$15$8$1$sel$empreinte-secrete' });
  db.insert('connexions', { id: 'identifiant-de-session-secret', compteId: db.where<{ id: number }>('comptes', 'empId', 2)[0].id, role: 'collaborateur', methode: 'local', creation: '2026-10-10T08:00:00.000Z', expiration: '2026-10-10T20:00:00.000Z' });
  // Toute table du schéma qui porte empId est exportée (une table ajoutée plus tard le sera aussi).
  const avecEmpId = Object.entries(TABLES).filter(([n, d]) => 'empId' in d.cols && n !== 'employes').map(([n]) => n);
  assert.deepEqual([...TABLES_SALARIE].sort(), avecEmpId.sort());
  const x = donneesSalarie(db, 2, { journal: true, par: 'Sandrine Vidal' })!;
  const s = x.sections as Record<string, any>;
  assert.equal(s.Fiche.nom, 'Mehdi Benali');
  assert.ok(s['Certifications'].length && s['Absences et congés'].some((a: { du: string }) => a.du === '2026-12-07'));
  assert.equal(s['Compte de connexion'].length, 1);
  assert.equal(s['Sessions de connexion'].length, 1);
  assert.ok(s['Journal des actions le concernant'].some((j: { code: string }) => j.code === 'employe.modifier'));
  assert.ok(s['Journal des actions le concernant'].some((j: { code: string; auteur: string }) => j.code === 'absence.demander' && j.auteur === 'Mehdi Benali'));
  const texte = JSON.stringify(x);
  assert.ok(!texte.includes('empreinte-secrete') && !texte.includes('motDePasse') && !texte.includes('identifiant-de-session-secret'));
  assert.ok(!JSON.stringify(s['Certifications']).includes('"empId":6'), 'aucune donnée d’un autre salarié');
  // Sans le journal pour l'intéressé (il cite d'autres personnes) ; salarié inconnu : rien.
  assert.equal((donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' })!.sections as Record<string, unknown>)['Journal des actions le concernant'], undefined);
  assert.equal(donneesSalarie(db, 999, { journal: true, par: 'x' }), null);
});

test('CSV : formules neutralisées, séparateur et guillemets protégés', () => {
  assert.equal(celluleCsv('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  for (const v of ['+33 6', '-2', '@SOMME(A1)', '\tx']) assert.equal(celluleCsv(v)[0] === '"' ? celluleCsv(v)[1] : celluleCsv(v)[0], `'`, v);
  assert.equal(celluleCsv('a;b'), '"a;b"');
  assert.equal(celluleCsv(null), '');
  assert.equal(celluleCsv('Texte ordinaire'), 'Texte ordinaire');
});

// — Serveur —

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
    s.on('error', rej);
  });
}

async function serveur(db: string) {
  const port = await freePort();
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: db, CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', CURSUS_DEMO: '1' },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  const brut = (path: string, init: { cookie?: string; body?: unknown } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.body !== undefined ? 'POST' : 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const call = async (path: string, init: { cookie?: string; body?: unknown } = {}) => {
    const r = await brut(path, init);
    const cookie = r.headers.get('set-cookie')?.match(/cursus_session=[^;]*/)?.[0] ?? null;
    return { status: r.status, cookie, json: await r.json().catch(() => ({})) };
  };
  return { call, brut };
}

test('serveur : journal consultable, filtré, paginé, exporté ; accès et exports tracés', async t => {
  const file = join(dir, 'demo.db');
  const srv = await serveur(file);
  const db = new Db(file);
  const s = await srv.call('/api/session');
  const rh = s.cookie!;
  const opts = s.json.loginOptions;
  const karim = opts.manager.find((o: { nom: string }) => o.nom.startsWith('Karim Haddad')).id;
  type Page = { lignes: (Omit<Ligne, 'salaries'> & { salaries: number[]; details: Record<string, any> })[]; total: number; page: number; taille: number };
  const journal = async (q = '', cookie = rh) => (await srv.call(`/api/journal${q}`, { cookie })).json as Page;
  let ck = '';

  await t.test('connexions, changements d’espace, refus d’accès et exports de l’interface', async () => {
    assert.equal((await srv.call('/api/actions/employe.modifier', { cookie: rh, body: { id: 2, poste: 'Technicien confirmé' } })).status, 200);
    // Autre poste : Karim Haddad se connecte dans l'espace manager.
    const k = await srv.call('/api/login', { body: { role: 'manager', compteId: karim, password: 'x' } });
    ck = k.cookie!;
    assert.equal((await srv.call('/api/actions/temps.pushSage', { cookie: ck, body: {} })).status, 403);
    assert.equal((await srv.call('/api/journal', { cookie: ck })).status, 403);
    assert.equal((await srv.call('/api/salaries/2/donnees', { cookie: ck })).status, 403);
    assert.equal((await srv.call('/api/journal')).status, 401, 'sans session : rien de tracé');
    assert.equal((await srv.call('/api/mode', { cookie: ck, body: { role: 'collaborateur' } })).status, 200);
    assert.equal((await srv.brut('/api/exports', { cookie: ck, body: { nature: 'impression', titre: 'Entretien annuel — compte rendu', empId: 2 } })).status, 204);
    assert.equal((await srv.brut('/api/exports', { cookie: ck, body: { nature: 'csv', titre: 'mes-echeances.csv', lignes: 3, empId: 12 } })).status, 204);
    const lignes = db.all<Ligne>('journal');
    const de = (a: string) => lignes.filter(l => l.action === a);
    assert.ok(de('connexion').some(l => l.actor === 'Sandrine Vidal') && de('connexion').some(l => l.actor === 'Karim Haddad' && l.message!.includes('Manager')));
    assert.deepEqual(de('acces.refuse').map(l => [l.actor, l.payload.action ?? null]), [['Karim Haddad', 'temps.pushSage'], ['Karim Haddad', null], ['Karim Haddad', null]]);
    assert.equal(de('acces.refuse')[0].message, 'Transmission à la paie — Transmission à la paie réservée à l’administrateur RH et au gestionnaire de paie');
    assert.equal(de('acces.refuse')[1].message, 'Journal des actions — réservé au service RH');
    assert.ok(de('espace.change').some(l => l.actor === 'Karim Haddad' && l.message === 'Espace Manager → Collaborateur'));
    const exports = de('export');
    assert.deepEqual(exports.map(l => [l.message, l.salaries]), [['Impression : Entretien annuel — compte rendu', []], ['Export CSV : mes-echeances.csv (3 lignes)', [12]]],
      'un salarié hors du périmètre n’est pas rattaché');
  });

  await t.test('téléchargement de ses données par l’intéressé (espace collaborateur)', async () => {
    const r = await srv.brut('/api/mes-donnees', { cookie: ck });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition')!, /attachment; filename="donnees-EMP-0012-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const x = await r.json() as { salarie: { id: number }; sections: Record<string, unknown>; note: string };
    assert.equal(x.salarie.id, 12);
    assert.equal(x.sections['Journal des actions le concernant'], undefined);
    assert.match(x.note, /sur demande par le service RH/);
    assert.ok(!JSON.stringify(x).includes('motDePasse'));
    assert.ok(db.all<Ligne>('journal').some(l => l.action === 'donnees.export' && JSON.stringify(l.salaries) === '[12]'));
    assert.equal((await srv.call('/api/mes-donnees', { cookie: rh })).status, 403, 'espace RH : pas de dossier salarié');
  });

  await t.test('consultation : vue, filtres, pagination', async () => {
    const tout = await journal();
    assert.ok(tout.total >= 8);
    assert.ok(tout.lignes.every((l, i, a) => i === 0 || a[i - 1].id > l.id), 'les plus récentes d’abord');
    const fiche = await journal('?action=employe.modifier');
    assert.equal(fiche.total, 1);
    assert.deepEqual([fiche.lignes[0].details.avant, fiche.lignes[0].details.apres, fiche.lignes[0].salaries], [{ poste: 'Technicien de maintenance' }, { poste: 'Technicien confirmé' }, [2]]);
    assert.ok((await journal('?salarie=2')).lignes.some(l => l.action === 'employe.modifier'));
    assert.ok((await journal('?salarie=2')).lignes.every(l => l.salaries.includes(2)));
    const karimL = await journal('?auteur=KARIM');
    assert.ok(karimL.total >= 4 && karimL.lignes.every(l => l.actor === 'Karim Haddad'));
    const cx = await journal('?vue=connexions');
    assert.ok(cx.lignes.every(l => /^(connexion|deconnexion|motdepasse\.|espace\.|acces\.)/.test(l.action)) && cx.lignes.some(l => l.action === 'acces.refuse'));
    assert.equal((await journal('?action=famille:connexions')).total, cx.total);
    assert.ok(!(await journal('?vue=operations')).lignes.some(l => l.action === 'connexion'));
    // Dates à l'heure locale ; toutes les lignes de ce scénario datent d'aujourd'hui.
    const d = new Date(), jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal((await journal(`?du=${jour}&au=${jour}`)).total, tout.total);
    assert.equal((await journal('?au=2026-01-01')).total, 0);
    const p2 = await journal('?taille=2&page=2');
    assert.deepEqual([p2.lignes.length, p2.page, p2.taille, p2.total], [2, 2, 2, (await journal()).total]);
    assert.deepEqual(p2.lignes.map(l => l.id), (await journal('?taille=4')).lignes.slice(2, 4).map(l => l.id));
  });

  await t.test('export CSV : toutes les lignes filtrées, formules neutralisées, export tracé', async () => {
    db.insert('journal', { at: new Date().toISOString(), actor: '@pirate', role: 'rh', action: 'export', message: '=HYPERLINK("http://exemple.invalid")', payload: {}, salaries: [], paie: false });
    const r = await srv.brut('/api/journal/csv?vue=operations', { cookie: rh });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type')!, /^text\/csv/);
    assert.match(r.headers.get('content-disposition')!, /attachment; filename="journal-\d{4}-\d{2}-\d{2}\.csv"/);
    // UTF-8 avec BOM (Excel) : lu en octets, text() le retirerait.
    const octets = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...octets.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const [tete, ...corps] = octets.subarray(3).toString('utf8').trim().split('\r\n');
    assert.match(tete, /^Date;Heure;Auteur;Identifiant;Espace;Action;Code;Salariés concernés;Message;Anciennes et nouvelles valeurs;Détail;Archivée le$/);
    assert.ok(corps.some(l => l.includes(`'@pirate`) && l.includes(`"'=HYPERLINK(""http://exemple.invalid"")"`)));
    assert.ok(corps.some(l => l.includes('Modification d’une fiche') && l.includes('Mehdi Benali (EMP-0002)') && l.includes('Poste : Technicien de maintenance → Technicien confirmé')));
    const trace = db.all<Ligne>('journal').findLast(l => l.action === 'journal.export')!;
    assert.match(trace.message!, /^Export CSV du journal — \d+ lignes \(opérations\)$/);
    assert.equal((await srv.call('/api/journal/csv', { cookie: ck })).status, 403);
  });

  await t.test('archive paie : hors de l’écran, consultée sur demande (consultation tracée)', async () => {
    const id = db.insert<Ligne>('journal', { at: '2025-06-02T08:00:00.000Z', actor: 'Antoine Leroy', role: 'rh', action: 'temps.validate', message: 'Semaine 22 validée', payload: { empId: 2 }, salaries: [2], paie: true, archivee: '2026-06-03T00:00:00.000Z' }).id;
    assert.ok(!(await journal('?taille=200')).lignes.some(l => l.id === id));
    const a = await journal('?vue=archive');
    assert.deepEqual(a.lignes.map(l => l.id), [id]);
    const consultations = () => db.all<Ligne>('journal').filter(l => l.action === 'journal.archive');
    assert.match(consultations().at(-1)!.message!, /^Consultation de l’archive paie — 1 ligne \(archive paie\)$/);
    // Toute page est tracée, pas seulement la première ; les pages lues d'affilée complètent la même ligne.
    await journal('?vue=archive&page=2&taille=1');
    await journal('?vue=archive&page=3&taille=1');
    assert.equal(consultations().length, 1);
    assert.match(consultations().at(-1)!.message!, /^Consultation de l’archive paie — 1 ligne \(archive paie\) · pages 1, 2, 3$/);
    assert.deepEqual(consultations().at(-1)!.payload.pages, [1, 2, 3]);
    // Autre filtre : autre ligne, rattachée au salarié.
    await journal('?vue=archive&salarie=2&page=2');
    assert.equal(consultations().length, 2);
    assert.deepEqual([consultations().at(-1)!.salaries, consultations().at(-1)!.message], [[2], 'Consultation de l’archive paie — 1 ligne (archive paie, salarié Mehdi Benali) · page 2']);
  });

  await t.test('export des données d’un salarié par le service RH (droit d’accès)', async () => {
    const r = await srv.brut('/api/salaries/2/donnees', { cookie: rh });
    assert.equal(r.status, 200);
    const x = await r.json() as { salarie: { nom: string }; par: string; sections: Record<string, any> };
    assert.deepEqual([x.salarie.nom, x.par], ['Mehdi Benali', 'Sandrine Vidal']);
    const j = x.sections['Journal des actions le concernant'] as { code: string; action: string }[];
    assert.ok(j.some(l => l.code === 'employe.modifier' && l.action === 'Modification d’une fiche'));
    assert.ok(j.some(l => l.code === 'temps.validate'), 'archive paie comprise');
    const trace = db.all<Ligne>('journal').findLast(l => l.action === 'salarie.export')!;
    assert.deepEqual([trace.actor, trace.salaries], ['Sandrine Vidal', [2]]);
    assert.match(trace.message!, /^Export des données personnelles de Mehdi Benali \(droit d’accès\) — \d+ éléments$/);
    assert.equal((await srv.call('/api/salaries/999/donnees', { cookie: rh })).status, 404);
    assert.ok((await journal('?salarie=2&action=salarie.export')).total === 1, 'visible dans l’historique de la fiche');
  });

  await t.test('déconnexion tracée', async () => {
    await srv.call('/api/logout', { cookie: ck, body: {} });
    assert.ok(db.all<Ligne>('journal').some(l => l.action === 'deconnexion' && l.actor === 'Karim Haddad'));
  });
  db.sql.close();
});
