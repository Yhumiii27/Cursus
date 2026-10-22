// Conservation des dossiers des salariés sortis (t016, lot 6 chantier 7 étape 2) : règles des durées et des dossiers
// échus, cohérence des réglages, cascade d'anonymisation fondée sur REFERENCES (toute colonne qui désigne un salarié a son
// traitement : test générique, à rejouer après chaque fusion), effacement par catégorie, droit à l'effacement avant
// l'échéance, journal sans nom, signalement quotidien au service RH sans effacement, instantané réservé à l'administrateur RH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';

const { Db, TABLES, snake } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { currentUser, loadFull, buildSnapshot, DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { REFERENCES, controlerOrphelins } = await import('../server/src/integrite.ts');
const { TRAITEMENTS, dossiersEchus, verifierConservation, aEffacer } = await import('../server/src/conservation.ts');
const { journaliser } = await import('../server/src/comptes.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const regles = await import('../shared/rules/conservation.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;

function base() {
  const db = new Db(':memory:');
  appliquerMigrations(db);
  seedDemo(db);
  return db;
}
const compteDe = (db: Db, empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL').get(...(empId ? [empId] : [])) as { id: number }).id;
const personne = (db: Db, empId: number | null, role: 'rh' | 'manager' | 'collaborateur' = 'rh') => currentUser(db, { compteId: compteDe(db, empId), role, methode: 'demo' })!;
/** Action exécutée comme par POST /api/actions/:nom : transaction, journal. */
function agir(db: Db, u: User, nom: string, p: Record<string, unknown>) {
  return db.tx(() => {
    const trace = preparerTrace(db, nom, p);
    const r = ACTIONS[nom](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, trace, { user: u, compte: { id: u.compteId!, identifiant: 'essai' } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
}
const refus = (f: () => unknown, status: number, motif?: RegExp) => assert.throws(f, (e: unknown) => e instanceof ActionError && e.status === status && (!motif || motif.test(e.message)));
const reglages = (db: Db, r: Record<string, unknown>) => db.setSetting('app', { ...db.getSetting<Record<string, unknown>>('app', {}), ...r });
const activer = (db: Db) => reglages(db, { conservationActive: true, conservationDecisionDpo: 'Décision DPO n° 2026-04' });
const compter = (db: Db, sql: string, ...args: (string | number)[]) => Number((db.sql.prepare(sql).get(...args) as { n: number }).n);

// — Règles —

test('règles : échéance par catégorie, passeport à la sortie, dossier à 5 ans, rien sans la décision du DPO', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(regles.echeanceConservation('2026-03-31', 0), '2026-04-01');
  assert.equal(regles.echeanceConservation('2021-02-28', 5), '2026-03-01');
  assert.equal(regles.echeanceConservation('2024-02-29', 1), '2025-03-01', 'fin de mois ramenée au 28 février');
  // Défauts (réponse de l'entreprise du 18 octobre 2026) : préremplis, inactifs.
  assert.deepEqual(regles.dureesConservation(s), { dossier: 5, temps: 3, paie: 5, sante: 5, passeport: 0, titreSejour: 5, entretiens: 5, formations: 5 });
  assert.equal(s.conservationActive, false);
  assert.equal(regles.conservationActive(s), false);
  assert.equal(regles.conservationActive({ conservationActive: true, conservationDecisionDpo: '  ' }), false);
  // Sorti au 31 mars 2026 : passeport et visas échus dès le lendemain ; le dossier en 2031.
  const ti = '2026-10-10';
  assert.deepEqual(regles.categoriesEchues({ fin: '2026-03-31' }, s, ti), { categories: ['passeport'], dossier: false });
  assert.deepEqual(regles.categoriesEchues({ fin: '2023-03-31' }, s, ti), { categories: ['temps', 'passeport'], dossier: false });
  assert.deepEqual(regles.categoriesEchues({ fin: '2021-03-31' }, s, ti)?.categories, ['dossier', 'temps', 'sante', 'passeport', 'titreSejour', 'entretiens', 'formations']);
  assert.equal(regles.categoriesEchues({ fin: '2021-03-31' }, s, ti)?.dossier, true);
  // Présent, sorti du jour, déjà anonymisé, catégorie déjà effacée ou sans données : rien.
  assert.equal(regles.categoriesEchues({ fin: null }, s, ti), null);
  assert.equal(regles.categoriesEchues({ fin: ti }, s, ti), null, 'dernier jour : encore présent');
  assert.equal(regles.categoriesEchues({ fin: '2021-03-31', anonymiseLe: '2026-05-01' }, s, ti), null);
  assert.equal(regles.categoriesEchues({ fin: '2026-03-31' }, s, ti, new Set(['passeport'])), null);
  assert.equal(regles.categoriesEchues({ fin: '2026-03-31' }, s, ti, new Set(), () => false), null);
  assert.equal(regles.nomAnonyme(12), 'Salarié anonymisé n° 12');
  assert.match(regles.categoriesTexte(['passeport', 'entretiens']), /^passeport et visas, entretiens professionnels$/);
});

test('réglages : décision du DPO exigée pour activer, dossier 3 ans au moins et jamais avant une autre catégorie', () => {
  const s = DEFAULT_SETTINGS;
  assert.throws(() => appliquerReglages(s, { conservationActive: true }), (e: unknown) => e instanceof ReglageInvalide && /décision du DPO/.test(e.message));
  const ok = appliquerReglages(s, { conservationActive: true, conservationDecisionDpo: '  Décision   DPO 2026-04 ' });
  assert.equal(ok.conservationDecisionDpo, 'Décision DPO 2026-04');
  assert.throws(() => appliquerReglages(s, { conservationDossierAns: 2, conservationTempsAns: 2, conservationPaieAns: 2, conservationSanteAns: 2, conservationTitreSejourAns: 2, conservationEntretiensAns: 2, conservationFormationsAns: 2 }),
    (e: unknown) => e instanceof ReglageInvalide && /3 ans au moins/.test(e.message));
  assert.throws(() => appliquerReglages(s, { conservationSanteAns: 8 }), (e: unknown) => e instanceof ReglageInvalide && /santé au travail et vaccinations au-delà/.test(e.message));
  assert.equal(appliquerReglages(s, { conservationDossierAns: 42, conservationPasseportAns: 42 }).conservationPasseportAns, regles.DUREE_MAX_ANS, 'bornée');
  assert.ok(JOURNAL_LABEL['employe.anonymiser'] && JOURNAL_LABEL['conservation.signalement']);
  assert.equal(familleAction('employe.anonymiser')?.id, 'fiches');
  assert.equal(familleAction('conservation.signalement')?.id, 'conservation');
});

// — Cascade —

test('cascade : chaque colonne de REFERENCES qui désigne un salarié a son traitement (à rejouer après chaque fusion)', () => {
  const salaries = REFERENCES.filter(r => r.cible === 'employes').map(r => `${r.table}.${r.colonne}`);
  const sans = salaries.filter(k => !TRAITEMENTS[k]);
  assert.deepEqual(sans, [], 'référence à un salarié sans traitement dans TRAITEMENTS (server/src/conservation.ts)');
  const inconnus = Object.keys(TRAITEMENTS).filter(k => !salaries.includes(k));
  assert.deepEqual(inconnus, [], 'traitement d’une référence absente de REFERENCES');
  // Toute table du schéma qui porte un salarié (emp_id) figure dans REFERENCES, donc ici.
  for (const [nom, def] of Object.entries(TABLES)) {
    if ('empId' in def.cols && nom !== 'employes') assert.ok(TRAITEMENTS[`${snake(nom)}.emp_id`], `${nom}.empId traité`);
  }
});

/** Dossier de Mehdi (2) garni : passeport, visa, vaccin, demande de visite, déclaration, demande de formation, journal, envoi. */
function garnir(db: Db, fin: string) {
  db.update('employes', 2, { fin, motifSortie: 'demission', naissanceLe: '1990-04-12', urgenceNom: 'Mme Benali', urgenceTel: '06 00 00 00 00', autorisationTravail: { type: 'carte_sejour', numero: 'AB1234567', expire: '2027-01-01', demandeLe: null, verifieLe: null } });
  db.insert('visas', { empId: 2, dest: 'MA', type: 'visa', obtenu: '2025-01-01', expire: '2027-01-01' });
  db.insert('demandesVisite', { empId: 2, motif: 'periodique', le: '2025-01-01', par: 'Sandrine Vidal', statut: 'demandee' });
  db.insert('demandesCollab', { empId: 2, type: 'document', label: 'Passeport', date: '2025-01-01', statut: 'acceptee', declaration: { kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' } });
  db.insert('demandesCollab', { empId: 2, type: 'formation', f: 'sst', motif: 'Mehdi Benali souhaite se former', date: '2025-01-01', statut: 'refusee' });
  db.insert('notifications', { empId: 2, adresse: 'mehdi.benali@entreprise.example', type: 'absence.decision', objet: 'Demande validée', texte: 'Bonjour Mehdi Benali', creation: '2025-01-01T08:00:00.000Z' });
  db.insert('pieces', { empId: 2, objet: 'voyage', objetId: 1, nom: 'billet Mehdi Benali.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', fichier: 'c'.repeat(32), deposeLe: '2025-01-01T08:00:00.000Z', deposePar: 'Mehdi Benali' });
  db.insert('envois', { cible: 'email', type: 'absence.decision', cle: 'essai-conservation', contenu: { a: ['mehdi.benali@entreprise.example'], objet: 'Congés', texte: 'Bonjour Mehdi Benali' }, statut: 'envoye', tentatives: 1, creation: '2025-01-01T08:00:00.000Z' });
  db.insert('jetonsAgenda', { empId: 2, empreinte: 'f'.repeat(64), creeLe: '2025-01-01T08:00:00.000Z' });
  // Autre salarié dont la ligne cite Mehdi comme auteur.
  db.insert('absences', { empId: 6, type: 'ABSENCE', du: '2025-02-03', au: '2025-02-03', statut: 'signalee', keystone: false, justificatif: false, signaleLe: '2025-02-03', signalePar: 'Mehdi Benali' });
  journaliser(db, { actor: 'Mehdi Benali', role: 'collaborateur', action: 'absence.demander', message: 'Demande de congés payés de Mehdi Benali', compte: { id: compteDe(db, 2), identifiant: 'mehdi.benali@entreprise.example' } as never, salaries: [2] });
}

/** Valeurs de texte de toute la base qui contiennent l'un des termes : « table.colonne ». */
function occurrences(db: Db, termes: string[]): string[] {
  const out: string[] = [];
  for (const [nom, def] of Object.entries(TABLES)) {
    for (const [col, type] of Object.entries(def.cols)) {
      if (type !== 'text' && type !== 'json') continue;
      for (const t of termes) if (compter(db, `SELECT COUNT(*) AS n FROM ${snake(nom)} WHERE instr(${snake(col)}, ?) > 0`, t)) out.push(`${snake(nom)}.${snake(col)}`);
    }
  }
  return out;
}

test('anonymisation d’un dossier échu : cascade complète, nom retiré de toute la base, agrégats gardés, journal sans nom', () => {
  const db = base();
  garnir(db, '2020-06-30');
  const admin = personne(db, null);
  // Désactivé : aucune proposition, action refusée.
  assert.deepEqual(dossiersEchus(db), []);
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Durées échues' }), 409, /désactivée/);
  activer(db);
  const echu = dossiersEchus(db).find(d => d.empId === 2);
  assert.ok(echu?.dossier, 'dossier échu proposé');
  assert.ok(echu!.categories.includes('passeport') && echu!.categories.includes('sante'));
  // Motif exigé ; un gestionnaire RH ne confirme pas.
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2], motif: ' ' }), 400, /Motif requis/);
  refus(() => agir(db, personne(db, 14), 'employe.anonymiser', { ids: [2], motif: 'x' }), 403);
  const feuilles = compter(db, 'SELECT COUNT(*) AS n FROM feuilles WHERE emp_id = 2');
  const certs = compter(db, 'SELECT COUNT(*) AS n FROM certifications WHERE emp_id = 2');
  const r = agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Durées validées par le DPO' });
  assert.match(r.message, /^Données échues effacées le 10 oct\. 2026 — 1 dossier anonymisé \(n° 2\) · \d+ éléments effacés ; les sauvegardes les gardent jusqu’à leur rotation$/);
  // Fiche : identité neutre, compte fermé, sessions supprimées.
  const e = db.get<Record<string, any>>('employes', 2)!;
  assert.equal(e.nom, 'Salarié anonymisé n° 2');
  assert.equal(e.anonymiseLe, '2026-10-10');
  for (const c of ['email', 'naissanceLe', 'matriculePaie', 'urgenceNom', 'urgenceTel', 'passeportNumero', 'autorisationTravail', 'visite', 'avis']) assert.equal(e[c], null, c);
  const compte = db.where<Record<string, any>>('comptes', 'empId', 2)[0];
  assert.equal(compte.actif, false);
  assert.match(compte.identifiant, /^anonyme-\d+$/);
  assert.equal(compter(db, 'SELECT COUNT(*) AS n FROM connexions WHERE compte_id = ?', compte.id), 0);
  // Références traitées : lignes supprimées, textes vidés, agrégats gardés.
  for (const [k, t] of Object.entries(TRAITEMENTS)) {
    const [table, colonne] = k.split('.');
    if (t.mode === 'lignes') assert.equal(compter(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = 2`), 0, `${k} supprimées`);
    if (t.mode === 'detachee') assert.equal(compter(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = 2`), 0, `${k} détachée`);
  }
  assert.equal(compter(db, 'SELECT COUNT(*) AS n FROM pieces WHERE emp_id = 2 AND retiree_le IS NULL'), 0, 'pièces retirées');
  assert.equal(compter(db, `SELECT COUNT(*) AS n FROM pieces WHERE emp_id = 2 AND nom LIKE 'piece-%'`), 1, 'nom d’origine retiré');
  assert.equal(compter(db, 'SELECT COUNT(*) AS n FROM feuilles WHERE emp_id = 2'), feuilles, 'heures par projet gardées');
  assert.equal(compter(db, 'SELECT COUNT(*) AS n FROM certifications WHERE emp_id = 2'), certs, 'certifications et coûts gardés');
  // Plus aucune trace du nom, de l'adresse ni de l'identifiant, dans aucune table (journal, file d'envoi, autres dossiers).
  assert.deepEqual(occurrences(db, ['Mehdi Benali', 'mehdi.benali@entreprise.example']), []);
  assert.equal(db.where<Record<string, any>>('absences', 'empId', 6).find(a => a.du === '2025-02-03')?.signalePar, 'Salarié anonymisé n° 2', 'auteur nommé ailleurs');
  // Journal : ligne de l'action sans nom, motif masqué, salarié et catégories ; trace de l'effacement gardée.
  const j = db.sql.prepare(`SELECT message, payload, salaries FROM journal WHERE action = 'employe.anonymiser'`).get() as { message: string; payload: string; salaries: string };
  assert.equal(JSON.parse(j.salaries)[0], 2);
  assert.equal(JSON.parse(j.payload).motif, '[texte renseigné]');
  assert.ok(JSON.parse(j.payload).effacements[0].categories.includes('dossier'));
  const trace = db.where<Record<string, any>>('effacements', 'empId', 2);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].motif, 'Durées validées par le DPO');
  // Plus rien à proposer ; une seconde confirmation est refusée ; aucune référence orpheline.
  assert.equal(dossiersEchus(db).some(d => d.empId === 2), false);
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'x' }), 409, /sans donnée échue/);
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'x', avantEcheance: true }), 409, /déjà anonymisé/);
  // Références seules (le fichier fictif de la pièce n'existe pas sur le disque de l'essai).
  assert.equal(controlerOrphelins(db, [...REFERENCES]).orphelins, 0);
});

test('effacement par catégorie : passeport et visas à la sortie, le reste gardé ; le dossier vient ensuite', () => {
  const db = base();
  garnir(db, '2026-03-31');
  activer(db);
  const admin = personne(db, null);
  const d = dossiersEchus(db).find(x => x.empId === 2)!;
  assert.deepEqual(d.categories, ['passeport']);
  assert.equal(d.dossier, false);
  assert.ok(aEffacer(db, 2, 'passeport') >= 3, 'passeport, visa, déclaration');
  const r = agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Passeport : effacé à la sortie' });
  assert.match(r.message, /dossier n° 2 : passeport et visas effacés/);
  const e = db.get<Record<string, any>>('employes', 2)!;
  assert.equal(e.nom, 'Mehdi Benali', 'identité gardée');
  assert.equal(e.passeportNumero, null);
  assert.equal(compter(db, 'SELECT COUNT(*) AS n FROM visas WHERE emp_id = 2'), 0);
  assert.equal(compter(db, `SELECT COUNT(*) AS n FROM demandes_collab WHERE emp_id = 2 AND type = 'document'`), 0);
  assert.ok(compter(db, 'SELECT COUNT(*) AS n FROM vaccinations WHERE emp_id = 2') > 0, 'santé gardée 5 ans');
  assert.equal(dossiersEchus(db).some(x => x.empId === 2), false, 'rien d’autre d’échu');
  // Durée du dossier ramenée au minimum, passé de 3 ans : le dossier n'est pas encore échu (sortie de mars 2026).
  db.sql.prepare(`UPDATE feuilles SET comment = 'Heures du samedi à reprendre' WHERE emp_id = 2`).run();
  reglages(db, { conservationTempsAns: 0, conservationPaieAns: 0, conservationDossierAns: 3 });
  assert.deepEqual(dossiersEchus(db).find(x => x.empId === 2)?.categories, ['temps']);
});

test('droit à l’effacement avant l’échéance : un salarié sorti, dossier anonymisé ; jamais un salarié présent', () => {
  const db = base();
  const admin = personne(db, null);
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande', avantEcheance: true }), 409, /encore présent/);
  refus(() => agir(db, admin, 'employe.anonymiser', { ids: [2, 6], motif: 'Demande', avantEcheance: true }), 400, /un salarié à la fois/);
  garnir(db, '2026-09-30');
  // Fonction désactivée : le droit à l'effacement reste exerçable par l'administrateur RH.
  const r = agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande du salarié du 1er octobre', avantEcheance: true });
  assert.match(r.message, /^Droit à l’effacement exercé le 10 oct\. 2026 — 1 dossier anonymisé \(n° 2\)/);
  assert.equal(db.get<Record<string, any>>('employes', 2)!.nom, 'Salarié anonymisé n° 2');
  assert.equal(db.where<Record<string, any>>('effacements', 'empId', 2)[0].avantEcheance, true);
});

test('signalement quotidien : notification au service RH sans nom, une fois par jour et pour les nouveaux dossiers ; rien n’est effacé', () => {
  const db = base();
  garnir(db, '2020-06-30');
  assert.equal(verifierConservation(db, '2026-10-10'), 0, 'désactivé : rien');
  activer(db);
  assert.equal(verifierConservation(db, '2026-10-10'), null, 'déjà passé ce jour');
  assert.equal(verifierConservation(db, '2026-10-11'), 1);
  const n = db.sql.prepare(`SELECT objet, texte FROM notifications WHERE type = 'conservation.echus'`).all() as { objet: string; texte: string }[];
  assert.equal(n.length, 1);
  assert.match(n[0].texte, /^1 dossier de salarié sorti a une durée de conservation échue \(1 nouveau/);
  assert.doesNotMatch(n[0].texte, /Benali/);
  assert.equal(db.get<Record<string, any>>('employes', 2)!.nom, 'Mehdi Benali', 'rien n’est effacé');
  // Le lendemain, même dossier : pas de nouveau signalement.
  assert.equal(verifierConservation(db, '2026-10-12'), 1);
  assert.equal(compter(db, `SELECT COUNT(*) AS n FROM notifications WHERE type = 'conservation.echus'`), 1);
  const j = db.sql.prepare(`SELECT message, salaries FROM journal WHERE action = 'conservation.signalement'`).all() as { message: string; salaries: string }[];
  assert.equal(j.length, 1);
  assert.doesNotMatch(j[0].message, /Benali/);
});

test('instantané : dossiers échus pour l’administrateur RH seulement ; date d’anonymisation retirée pour le manager', () => {
  const db = base();
  garnir(db, '2020-06-30');
  activer(db);
  assert.equal(buildSnapshot(db, personne(db, null)).conservation?.[0]?.empId, 2);
  for (const u of [personne(db, 14), personne(db, 11), personne(db, 7), personne(db, 23), personne(db, 12, 'manager'), personne(db, 6, 'collaborateur')]) {
    assert.equal(buildSnapshot(db, u).conservation, undefined, u.nom);
  }
  agir(db, personne(db, null), 'employe.anonymiser', { ids: [2], motif: 'Durées validées' });
  // Mehdi n'apparaît plus dans la vue du manager s'il est sorti ; s'il y figure, sans date d'anonymisation.
  const vue = buildSnapshot(db, personne(db, 12, 'manager')).employes.find(x => x.id === 2);
  assert.equal(vue?.anonymiseLe ?? null, null);
});
