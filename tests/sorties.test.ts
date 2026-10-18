// Sortie des salariés (t124) et garde-fou d'un changement de régime de temps (t074) : date et motif de sortie pour tous
// les contrats, CDI compris ; contrôles (manager d'équipe, heures ou absence au-delà de la date) ; annulations (absences,
// Keystone prévenu ; inscriptions et convocations ; entretiens ; demandes de visite d'une sortie passée ; feuilles vides) ;
// sessions fermées ; rien ne se planifie après la date ; salarié sorti retiré de la conformité, des échéances et des
// obligations (et, avant la date, de ce qui échoit après), gardé en « No Go CONTRAT » pour Keystone ; annulation d'une
// sortie ; motif réservé au service RH, à la paie et à l'intéressé ; sortie d'un membre de l'espace RH réservée à
// l'administrateur, qui en garde toujours un après la date. Changement de régime : feuilles des
// 8 semaines précédentes figées sur l'ancien régime, confirmation et solde gardé au journal quand des RTT sont perdus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { refusDuCompte } = await import('../server/src/comptes.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { Domain } = await import('../shared/domain.ts');
const { matricule } = await import('../shared/format.ts');
const { iso } = await import('../shared/dates.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { rttInfo } = await import('../shared/rules/conges.ts');
const { present, semainesAFiger, sorti } = await import('../shared/rules/contrats.ts');
const { profilOf, validerProfil } = await import('../shared/rules/profil.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Compte = import('../server/src/comptes.ts').Compte;
interface Ligne { action: string; payload: Record<string, any>; salaries: number[] | null; paie: boolean; message: string | null }

/** Exécute `fn` à une autre date du jour (CURSUS_TODAY), puis revient au 10 octobre 2026. */
function le<T>(date: string, fn: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = date;
  try { return fn(); } finally { process.env.CURSUS_TODAY = avant; }
}

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (journal, puis verdicts transmis à Keystone). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get<Compte>('comptes', u.compteId!)!, message: o.message ?? null, result: o.result });
    if (changeVerdicts(name)) suivreVerdicts(db);
    return o;
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : ${re}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const derniere = (action: string) => db.all<Ligne>('journal').findLast(j => j.action === action);
  const envois = (type: string) => db.all<{ type: string; cible: string; contenu: Record<string, any> }>('envois').filter(e => e.type === type);
  /** Chantier et affectations reçus de Keystone, puis premier verdict mémorisé. */
  const chantier = (id: string, debut: string, fin: string, empIds: number[]) => db.tx(() => {
    enregistrerChantier(contexte(db), id, { nom: 'Arrêt technique', lieu: 'Feyzin', pays: 'FR', debut, fin });
    empIds.forEach((empId, i) => enregistrerAffectation(contexte(db), `AF-${id}-${i}`, { matricule: matricule(empId), chantier: id, du: debut, au: fin }));
    suivreVerdicts(db);
  });
  return { db, user, run, refus, RH, domain, derniere, envois, chantier, compteDe };
}

test('fiche : la date de fin sert de date de sortie pour tous les contrats ; un CDI ne prend fin qu’avec son motif', () => {
  const { domain } = fresh();
  const d = domain(), opts = { equipes: d.equipes, year: 2026 };
  const mehdi = profilOf(d.emp(2)!);
  assert.ok(!validerProfil({ ...mehdi, fin: '2026-12-31' }, opts).errors.every(e => !/CDI ne prend fin/.test(e)), 'CDI sans motif : refusé');
  const v = validerProfil({ ...mehdi, fin: '2026-12-31', motifSortie: 'demission' }, opts);
  assert.ok(v.ok, v.errors.join(' '));
  assert.equal(v.profil.fin, '2026-12-31', 'la date de fin d’un CDI n’est plus effacée');
  assert.ok(validerProfil({ ...mehdi, fin: '2026-12-31', motifSortie: 'faute' as never }, opts).errors.some(e => /Motif de sortie à choisir/.test(e)));
  assert.ok(validerProfil({ ...mehdi, motifSortie: 'demission' }, opts).errors.some(e => /Date de sortie requise/.test(e)));
  // Présence : la date de sortie est le dernier jour ; une embauche à venir compte comme présente.
  assert.ok(present({ fin: '2026-10-10' }, '2026-10-10') && sorti({ fin: '2026-10-09' }, '2026-10-10') && present({ fin: null }, '2026-10-10'));
});

test('sortie : contrôles, annulations (Keystone prévenu, convocation annulée), journal, salarié retiré des calculs et gardé en No Go CONTRAT', () => {
  const { db, user, run, refus, RH, domain, derniere, envois, chantier } = fresh();
  // Mehdi Benali (CDI) : entretien annuel planifié le 20 octobre, RTT demandé le 2 novembre ; on y ajoute une affectation
  // Keystone, une absence validée transmise à Keystone, un recyclage SST convoqué, une demande de visite, une feuille vide.
  chantier('K-SO', '2026-10-26', '2026-10-30', [2]);
  run(RH, 'absence.saisir', { empId: 2, nature: 'MARIAGE', du: '2026-11-16', au: '2026-11-17', justificatif: false });
  const sst = domain().emp(2)!.certs.find(c => c.f === 'sst')!;
  run(RH, 'plan.inscrire', { empId: 2, certId: sst.id, sessionId: 2, conv: 'now' });
  run(RH, 'medical.demander', { empId: 2 });
  db.insert('feuilles', { empId: 2, week: '2026-10-26', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [] });
  const absValidee = db.all<{ id: number; type: string; statut: string; empId: number }>('absences').find(a => a.empId === 2 && a.type === 'MARIAGE')!;

  // Contrôles : manager d'équipe, heures ou absence au-delà de la date, date avant l'entrée, motif hors liste.
  refus(RH, 'employe.sortie', { id: 12, date: '2026-10-16', motif: 'demission' }, /Manager de l’équipe Maintenance : désignez d’abord un autre manager/);
  const f = db.insert<{ id: number }>('feuilles', { empId: 2, week: '2026-10-12', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7] }] });
  refus(RH, 'employe.sortie', { id: 2, date: '2026-10-14', motif: 'demission' }, /Heures saisies après le 14 oct\. 2026 \(semaine 42\)/);
  db.remove('feuilles', f.id);
  const a = db.insert<{ id: number }>('absences', { empId: 2, type: 'CP', du: '2026-10-15', au: '2026-10-19', statut: 'validee', keystone: false, justificatif: false });
  refus(RH, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' }, /Absence du 15 oct\. au 19 oct\. 2026 à cheval sur la date de sortie/);
  db.remove('absences', a.id);
  refus(RH, 'employe.sortie', { id: 2, date: '2010-01-01', motif: 'demission' }, /précède l’entrée/);
  refus(RH, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'faute grave' }, /liste/);
  refus(user(12, 'manager'), 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' }, /service RH/, 403);

  const o = run(RH, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' }) as { message: string };
  assert.match(o.message, /^Sortie de Mehdi Benali enregistrée le 16 oct\. 2026 — Démission/);
  assert.match(o.message, /2 absences annulées \(Keystone prévenu\) · 1 inscription à une session retirée · 1 entretien planifié retiré · 1 feuille de temps vide retirée/);
  assert.match(o.message, /annulation de convocation envoyée par e-mail · solde de sortie photographié : [^·]+( · [^·]+)* · accès à Cursus jusqu’au 16 oct\. 2026 inclus$/);
  const e = db.get<{ fin: string; motifSortie: string; finPrevue: string | null }>('employes', 2)!;
  assert.deepEqual([e.fin, e.motifSortie, e.finPrevue], ['2026-10-16', 'demission', null]);
  // Annulations : absences (la validée prévient Keystone), recyclage détaché et convocation annulée, entretien, visite, feuille vide.
  assert.deepEqual(db.all<{ empId: number; statut: string; du: string }>('absences').filter(x => x.empId === 2 && x.du > '2026-10-16').map(x => x.statut), ['annulee', 'annulee']);
  assert.ok(envois('absence.annulee').some(x => x.contenu.absence === absValidee.id), 'Keystone prévenu');
  assert.equal(db.get<{ sessionId: number | null }>('certifications', sst.id)!.sessionId, null);
  assert.equal(envois('convocation.annulee').length, 1);
  assert.ok(!db.all<{ empId: number; statut: string }>('entretiens').some(x => x.empId === 2 && x.statut === 'planifie'));
  // Sortie à venir : la demande de visite reste suivie jusqu'au départ (une visite de reprise reste due).
  assert.deepEqual(db.all<{ empId: number; statut: string }>('demandesVisite').filter(x => x.empId === 2).map(x => x.statut), ['demandee']);
  assert.ok(!db.all<{ empId: number; week: string }>('feuilles').some(x => x.empId === 2 && x.week === '2026-10-26'));
  // Journal : date, motif (code), anciennes et nouvelles valeurs, nombre d'éléments annulés ; archive paie.
  const j = derniere('employe.sortie')!;
  assert.deepEqual(j.payload, {
    id: 2, date: '2026-10-16', motif: 'demission', absences: 2, inscriptions: 1, entretiens: 1, visites: 0, feuilles: 1, sessions: 0,
    soldeSortie: db.where<{ id: number }>('soldesSortie', 'empId', 2)[0].id,
    avant: { fin: null, motifSortie: null }, apres: { fin: '2026-10-16', motifSortie: 'demission' },
  });
  assert.deepEqual([j.salaries, j.paie], [[2], true]);
  // Keystone : la ressource passe en No Go CONTRAT (verdict recalculé après l'action).
  const v = envois('verdict.modifie').at(-1)!.contenu;
  assert.deepEqual([v.chantier, v.ressource.matricule, v.ressource.statut, v.ressource.motifs], ['K-SO', 'EMP-0002', 'NO_GO', [{ code: 'CONTRAT', niveau: 'NO_GO' }]]);

  // Rien ne se planifie après le dernier jour : session, entretien (ni dans le dialogue, ni par le serveur).
  const hors = /Date postérieure au dernier jour du contrat de Mehdi Benali \(16 oct\. 2026\)/;
  refus(RH, 'plan.inscrire', { empId: 2, certId: sst.id, sessionId: 2, conv: 'now' }, hors);
  refus(RH, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-20' }, hors);
  refus(user(12, 'manager'), 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-20' }, hors);
  // Avant la date, les échéances et obligations postérieures au départ disparaissent (passeport du 2 décembre, campagne
  // annuelle au 15 décembre : l'entretien retiré par la sortie ne réapparaît pas « à planifier ») ; les échues restent.
  const d0 = domain();
  assert.deepEqual(d0.echeances(d0.enrich(180, false), 180).filter(x => x.emp.id === 2 && iso(x.exp) > '2026-10-16').map(x => x.label), []);
  assert.deepEqual(obligations(d0, [2]).filter(x => x.due > '2026-10-16').map(x => x.kind), []);
  // Avant la date : toujours présent ; après : retiré de la conformité, des échéances et des obligations d'entretien, mais
  // consultable (filtre « Sortis ») et gardé en No Go CONTRAT sur le chantier.
  assert.ok(domain().enrich(90, false).some(x => x.id === 2));
  le('2026-10-19', () => {
    const d = domain();
    assert.ok(!d.enrich(90, false).some(x => x.id === 2), 'sorti : hors de la conformité');
    assert.ok(d.enrich(90, false, { sortis: true }).some(x => x.id === 2), 'filtre « Sortis »');
    assert.ok(!d.echeances(d.enrich(90, false, { sortis: true }), 90).some(x => x.emp.id === 2), 'aucune échéance');
    assert.deepEqual(obligations(d, [2]), [], 'aucune obligation d’entretien');
    const r = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-SO')!.res.find(x => x.e.id === 2)!;
    assert.deepEqual([r.status, r.reasons.map(x => x.code)], ['nogo', ['CONTRAT']]);
    // Connexion refusée passé la date (déjà en place pour les CDD : vaut désormais pour un CDI).
    const c = db.sql.prepare('SELECT * FROM comptes WHERE emp_id = 2').get() as Record<string, unknown>;
    assert.match(refusDuCompte(db, db.get<Compte>('comptes', Number(c.id))!)!, /date de sortie de ce salarié est passée/);
    // Plus de visite à demander passé la date.
    refus(RH, 'medical.demander', { empId: 2 }, /dernier jour du contrat de Mehdi Benali/);
  });
});

test('sortie : une date passée ferme les sessions ; motif réservé au RH, à la paie et à l’intéressé ; fiche verrouillée', () => {
  const { db, user, run, refus, RH, compteDe } = fresh();
  const maintenant = new Date();
  db.insert('connexions', {
    id: 'session-essai', compteId: compteDe(6).id, role: 'collaborateur', methode: 'demo', demoComptes: {},
    creation: maintenant.toISOString(), expiration: new Date(maintenant.getTime() + 3600_000).toISOString(), activite: maintenant.toISOString(),
  });
  run(RH, 'medical.demander', { empId: 6 });
  const o = run(RH, 'employe.sortie', { id: 6, date: '2026-10-09', motif: 'rupture_conventionnelle' }) as { message: string };
  assert.match(o.message, /demande de visite médicale annulée · sessions de connexion fermées · solde de sortie photographié : /);
  assert.deepEqual(db.all<{ empId: number; statut: string }>('demandesVisite').filter(x => x.empId === 6).map(x => x.statut), ['annulee'], 'sortie passée : visite annulée');
  assert.ok(db.get<{ revocation: string | null }>('connexions', 'session-essai')!.revocation, 'session révoquée');
  // Motif : ni le manager ni le référent HSE ; la paie et la lecture seule, oui.
  const vu = (u: User) => buildSnapshot(db, u).employes.find(x => x.id === 6);
  assert.deepEqual([vu(user(12, 'manager'))!.fin, vu(user(12, 'manager'))!.motifSortie], ['2026-10-09', null]);
  assert.equal(vu(user(23, 'rh'))!.motifSortie, null);
  assert.equal(vu(user(7, 'rh'))!.motifSortie, 'rupture_conventionnelle');
  assert.equal(vu(user(11, 'rh'))!.motifSortie, 'rupture_conventionnelle');
  // La fiche ne change ni le motif ni la date d'une sortie enregistrée ; un salarié sorti n'est pas désigné manager.
  refus(RH, 'employe.modifier', { id: 6, fin: '2026-10-30' }, /bouton « Sortie »/);
  refus(RH, 'employe.modifier', { id: 6, motifSortie: 'licenciement' }, /bouton « Sortie »/);
  refus(RH, 'employe.modifier', { id: 2, fin: '2026-12-31' }, /CDI ne prend fin que par une sortie/);
  refus(RH, 'equipe.manager', { nom: 'Commercial', managerId: 6 }, /a quitté l’entreprise le 9 oct\. 2026/);
  run(RH, 'employe.modifier', { id: 6, poste: 'Technicien de maintenance (parti)' });
  // Une équipe qui ne compte plus que des salariés sortis se supprime : ils en sont détachés.
  run(RH, 'equipe.creer', { nom: 'Atelier' });
  run(RH, 'employe.modifier', { id: 6, equipe: 'Atelier' });
  assert.match((run(RH, 'equipe.supprimer', { nom: 'Atelier' }) as { message: string }).message, /Équipe Atelier supprimée · 1 salarié sorti détaché de l’équipe/);
  assert.equal(db.get<{ equipe: string | null }>('employes', 6)!.equipe, null);
  // Annulation : contrat de nouveau sans date de fin.
  const a = run(RH, 'employe.annulerSortie', { id: 6 }) as { message: string };
  assert.match(a.message, /contrat sans date de fin · les absences, inscriptions, entretiens et demandes de visite annulés par la sortie ne sont pas rétablis/);
  const e = db.get<{ fin: string | null; motifSortie: string | null }>('employes', 6)!;
  assert.deepEqual([e.fin, e.motifSortie], [null, null]);
  refus(RH, 'employe.annulerSortie', { id: 6 }, /Aucune sortie enregistrée/);
});

test('sortie d’un CDD : jamais au-delà de la fin prévue, rétablie par l’annulation ; passage en CDI sans date de fin', () => {
  const { db, run, refus, RH } = fresh();
  // Lucas Martin : CDD jusqu'au 29 janvier 2027.
  refus(RH, 'employe.sortie', { id: 4, date: '2027-02-15', motif: 'fin_cdd' }, /dépasse la fin prévue du contrat \(29 janv\. 2027\)/);
  run(RH, 'employe.sortie', { id: 4, date: '2026-11-30', motif: 'fin_periode_essai' });
  // Modifiée : la fin prévue d'origine est gardée.
  run(RH, 'employe.sortie', { id: 4, date: '2026-12-04', motif: 'autre' });
  assert.deepEqual(db.get<Record<string, unknown>>('employes', 4)!.finPrevue, '2027-01-29');
  refus(RH, 'employe.annulerSortie', { id: 1 }, /Aucune sortie enregistrée/);
  run(RH, 'employe.annulerSortie', { id: 4 });
  const e = db.get<{ fin: string; motifSortie: string | null; finPrevue: string | null }>('employes', 4)!;
  assert.deepEqual([e.fin, e.motifSortie, e.finPrevue], ['2027-01-29', null, null]);
  // Embauche en CDI à l'issue du CDD : la fin du CDD s'efface avec le changement de contrat.
  refus(RH, 'employe.modifier', { id: 4, typeContrat: 'cdi' }, /CDI ne prend fin que par une sortie/);
  run(RH, 'employe.modifier', { id: 4, typeContrat: 'cdi', fin: null });
  assert.equal(db.get<{ fin: string | null }>('employes', 4)!.fin, null);
});

test('sortie d’un CDD devenu CDI : l’annulation ne rétablit pas la fin du CDD', () => {
  const { db, run, RH } = fresh();
  run(RH, 'employe.sortie', { id: 4, date: '2026-11-30', motif: 'fin_cdd' });
  run(RH, 'employe.modifier', { id: 4, typeContrat: 'cdi' });
  assert.match((run(RH, 'employe.annulerSortie', { id: 4 }) as { message: string }).message, /contrat sans date de fin/);
  const e = db.get<{ typeContrat: string; fin: string | null; motifSortie: string | null; finPrevue: string | null }>('employes', 4)!;
  assert.deepEqual([e.typeContrat, e.fin, e.motifSortie, e.finPrevue], ['cdi', null, null, null]);
  run(RH, 'employe.modifier', { id: 4, poste: 'Technicien' });
});

test('sortie d’un membre de l’espace RH : réservée à l’administrateur, qui en garde toujours un après la date', () => {
  const { db, user, run, refus, RH, compteDe } = fresh();
  const gestionnaire = user(14, 'rh');
  // Le gestionnaire RH saisit la sortie d'un salarié, pas celle d'un membre de l'espace RH (comptes : administrateur seul).
  refus(gestionnaire, 'employe.sortie', { id: 7, date: '2026-10-31', motif: 'demission' }, /administrateur RH/, 403);
  db.update('comptes', compteDe(1).id, { profilRh: 'rh_admin' });
  refus(gestionnaire, 'employe.sortie', { id: 1, date: '2026-10-09', motif: 'autre' }, /administrateur RH/, 403);
  run(gestionnaire, 'employe.sortie', { id: 6, date: '2026-10-31', motif: 'demission' });
  // Deux administrateurs salariés en CDI, le compte non rattaché désactivé : une sortie à venir ne compte pas.
  db.update('comptes', compteDe(2).id, { profilRh: 'rh_admin' });
  db.update('comptes', compteDe(null).id, { actif: false });
  run(RH, 'employe.sortie', { id: 1, date: '2026-10-31', motif: 'demission' });
  refus(RH, 'employe.sortie', { id: 2, date: '2026-10-31', motif: 'demission' }, /dernier administrateur RH actif après le 31 oct\. 2026/);
  refus(RH, 'employe.sortie', { id: 2, date: '2026-11-15', motif: 'demission' }, /dernier administrateur RH actif/);
  // Ni désactivation ni changement de profil du seul administrateur sans date de sortie.
  refus(RH, 'compte.activer', { id: compteDe(2).id, actif: false }, /au moins un administrateur RH actif, sans date de sortie/);
  refus(RH, 'compte.profil', { id: compteDe(2).id, profilRh: 'rh_gestionnaire' }, /au moins un administrateur RH actif/);
  // Annulée, la première sortie rend la seconde possible.
  run(RH, 'employe.annulerSortie', { id: 1 });
  run(RH, 'employe.sortie', { id: 2, date: '2026-10-31', motif: 'demission' });
});

test('t074 : un changement de régime fige les 8 semaines précédentes, garde les RTT acquis au prorata', () => {
  const { db, run, RH, domain } = fresh();
  const d0 = domain(), mehdi = d0.emp(2)!;
  const rtt = rttInfo(d0, mehdi)!;
  assert.ok(rtt.pris > 0, 'RTT de l’année déjà pris');
  const semaines = semainesAFiger(mehdi, '2026-10-05', d0.ds.feuilles);
  // Huit semaines du 10 août au 28 septembre, sauf celles qui ont déjà une feuille (21 et 28 septembre, validées).
  assert.deepEqual(semaines, ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
  // 39 h + RTT → 35 h au 5 octobre : les RTT de janvier à septembre restent acquis (historique des contrats), sans confirmation.
  const o = run(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-10-05' }) as { message: string };
  assert.match(o.message, /6 semaines sans feuille figées sur l’ancien régime$/);
  const apres = rttInfo(domain(), domain().emp(2)!)!;
  assert.deepEqual([apres.label, apres.droit, apres.pris], ['RTT', Math.round(23 * 9 / 12), rtt.pris]);
  // La feuille du 7 septembre, saisie après le changement, reste au régime de 39 h : 39 heures, aucune heure supplémentaire.
  const fige = db.all<{ empId: number; week: string; statut: string; contrat: { temps: string } | null; lignes: unknown[] }>('feuilles').find(f => f.empId === 2 && f.week === '2026-09-07')!;
  assert.deepEqual([fige.statut, fige.contrat?.temps, fige.lignes], ['brouillon', '39h_rtt', []]);
  run(RH, 'temps.addLine', { empId: 2, week: '2026-09-07', projet: 'INT-MAINT' });
  for (let di = 0; di < 5; di++) run(RH, 'temps.setCell', { empId: 2, week: '2026-09-07', li: 0, di, value: '7,8' });
  const d1 = domain(), sh = d1.ds.feuilles.find(f => f.empId === 2 && f.week === '2026-09-07')!;
  const c = calcSheet(d1, d1.emp(2)!, sh);
  assert.deepEqual([c.c.temps, c.total, c.sup25], ['39h_rtt', 39, 0]);
  // Retour au 39 h + RTT : aucune confirmation ; les semaines déjà couvertes ne reçoivent rien de plus.
  const n = db.all('feuilles').length;
  run(RH, 'employe.modifier', { id: 2, temps: '39h_rtt', tempsDepuis: '2026-10-05' });
  assert.equal(db.all('feuilles').length, n, 'semaines déjà pourvues d’une feuille');
});

test('t074 : un changement de régime qui ne laisse aucun RTT acquis se confirme, le solde est gardé au journal', () => {
  const { run, refus, RH, domain, derniere } = fresh();
  const rtt = rttInfo(domain(), domain().emp(2)!)!;
  // Passage au 35 h dès janvier : aucun mois de l'année sous le 39 h, le compteur disparaîtrait.
  // Le RTT posé le 2 novembre, sous le 35 h, est cité pour être revu.
  refus(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-01-05' }, /n’ouvre ni RTT ni jours de repos.*et 1 j de RTT reste posé ou validé à partir du 5 janv\. 2026.*Confirmez le changement : ce solde sera gardé au journal pour la paie/);
  const o = run(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-01-05', confirmerRtt: true }) as { message: string };
  assert.match(o.message, /solde RTT 2026 : .* gardé au journal pour la paie$/);
  const j = derniere('employe.rtt')!;
  assert.deepEqual(j.payload.soldeRtt, { annee: 2026, droit: rtt.droit, pris: rtt.pris, poses: rtt.poses, solde: rtt.solde, effet: '2026-01-05', nouveauDroit: null, apresEffet: 1 });
  assert.ok(j.paie, 'archive paie');
  assert.deepEqual(j.payload.champsModifies, ['temps', 'tempsDepuis']);
  assert.equal(rttInfo(domain(), domain().emp(2)!), null);
});
