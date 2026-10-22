// Mise en service (lot 4, chantier « reprise depuis Lucca et compteurs datés », étape 1) :
// - t021 : matricule de paie sur la fiche (format, unicité, réembauche confirmée par l'administrateur RH), transmis à
//   Sage, liste des salariés sans matricule, identifiant envoyé à Keystone réglable (matricule Cursus par défaut) ;
// - t072 : compteurs repris et reports de CP datés (justes après le 1er janvier et le 1er juin), clôture des CP ligne
//   par ligne sans perte d'office (report imposé après une absence de santé), clôture des RTT, migration nommée ;
// - t087 : RTT de l'année suivante posables avant le 1er janvier, demande à cheval sur deux années refusée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { SOLDES_DATES } = await import('../server/src/migrations/reprise.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { mettreEnFile } = await import('../server/src/envois.ts');
const { contexte, enregistrerAffectation, ErreurKeystone } = await import('../server/src/integrations/keystone-entrant.ts');
const { Domain } = await import('../shared/domain.ts');
const { PROFIL_VIDE, validerProfil } = await import('../shared/rules/profil.ts');
const { identifiantKeystone, matriculeDe, matriculesPris, sansMatriculePaie } = await import('../shared/rules/matricules.ts');
const { checkAbsence, cetInfo, cpInfo, reposForfait, rttInfo } = await import('../shared/rules/conges.ts');
const { cloturesAFaire, lignesClotureCp, lignesClotureRtt } = await import('../shared/rules/clotures.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Dataset = ReturnType<typeof loadFull>;

const ADMIN: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '', profilRh: 'rh_admin' };
const GEST: User = { role: 'rh', empId: null, nom: 'Antoine Leroy', intitule: '', profilRh: 'rh_gestionnaire', salarieId: 14 };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });

/**
 * Base de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace au journal après) ;
 * `le(date, fn)` exécute avec une autre date du jour (actions et instantanés).
 */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, payload);
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: o.message ?? null, result: o.result });
    return r;
  });
  const refused = (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status?: number) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message) && (!status || e.status === status), `${name} devait être refusé (${motif})`);
  const domain = (today?: string) => { const ds = loadFull(db, ADMIN); return new Domain(today ? { ...ds, today } : ds); };
  return { db, run, refused, domain };
}
function le<T>(date: string, fn: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = date;
  try { return fn(); } finally { process.env.CURSUS_TODAY = avant; }
}
const message = (r: unknown) => String(typeof r === 'object' && r ? (r as { message: string }).message : r);

// — t021 : matricule de paie —

test('t021 matricule de paie : format, majuscules, unicité, réembauche à confirmer', () => {
  const { domain } = fresh();
  const d = domain();
  const base = { ...PROFIL_VIDE('Maintenance', d.ti), nom: 'Paul Neuf', poste: 'Technicien', naissance: 1990, email: 'paul.neuf@entreprise.example' };
  const valider = (matriculePaie: string | null, o: { actuel?: string | null; reutiliser?: boolean; employes?: Dataset['employes'] } = {}) =>
    validerProfil({ ...base, matriculePaie }, { equipes: d.equipes, year: d.year, matricules: { pris: matriculesPris(o.employes ?? d.ds.employes, d.ti), ...o } });
  assert.equal(valider(' ab 12 ').profil.matriculePaie, 'AB12', 'espaces retirés, majuscules');
  assert.ok(valider('AB-12').errors.some(m => /Matricule de paie invalide/.test(m)));
  assert.ok(valider('1'.repeat(21)).errors.some(m => /Matricule de paie invalide/.test(m)));
  assert.equal(valider('1'.repeat(20)).ok, true);
  assert.ok(valider(null).warnings.some(m => /Matricule de paie manquant/.test(m)), 'facultatif : un rappel seulement');
  // Mehdi Benali (2), présent : 004102 déjà attribué.
  assert.ok(valider('004102').errors.some(m => /déjà attribué à Mehdi Benali/.test(m)));
  assert.deepEqual(valider('004102', { actuel: '004102' }).errors, [], 'matricule inchangé de la fiche : rien à recontrôler');
  // Mehdi sorti : la réutilisation (réembauche) est à confirmer, puis seulement signalée.
  const sorti = d.ds.employes.map(e => e.id === 2 ? { ...e, fin: '2026-06-30' } : e);
  const a = valider('004102', { employes: sorti });
  assert.ok(a.errors.some(m => /sorti le 30 juin 2026 : sa réutilisation \(réembauche\) est à confirmer par l’administrateur RH/.test(m)));
  assert.equal(a.matriculeAConfirmer?.id, 2);
  const b = valider('004102', { employes: sorti, reutiliser: true });
  assert.equal(b.ok, true);
  assert.ok(b.warnings.some(m => /Matricule de paie réutilisé : celui de Mehdi Benali/.test(m)));
});

test('t021 fiche : saisie, unicité côté serveur, réembauche confirmée par l’administrateur RH seul, journal', () => {
  const { db, run, refused, domain } = fresh();
  const nouveau = (matriculePaie: string, extra: Record<string, unknown> = {}) => ({
    ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Paul Neuf', poste: 'Technicien', naissance: 1990, matriculePaie, ...extra,
  });
  refused(ADMIN, 'employe.creer', nouveau('004102'), /déjà attribué à Mehdi Benali/);
  refused(ADMIN, 'employe.creer', nouveau('AB-1'), /Matricule de paie invalide/);
  // Thomas Garnier (6) sorti : son matricule 004106 ne se reprend qu'avec la confirmation de l'administrateur RH.
  db.update('employes', 6, { fin: '2026-09-30', motifSortie: 'demission' }); // sortie enregistrée (un CDI ne finit que par elle)
  refused(ADMIN, 'employe.creer', nouveau('004106'), /à confirmer par l’administrateur RH/);
  refused(GEST, 'employe.creer', nouveau('004106', { reutiliserMatricule: true }), /administrateur RH/, 403);
  const id = (run(ADMIN, 'employe.creer', nouveau('004106', { reutiliserMatricule: true })) as { result: { id: number } }).result.id;
  assert.equal(domain().emp(id)!.matriculePaie, '004106');
  // Une modification ultérieure de la fiche réembauchée ne redemande rien.
  run(GEST, 'employe.modifier', { id, poste: 'Technicien confirmé' });
  // Compteurs repris de la nouvelle fiche : à zéro, datés du jour de sa création.
  assert.equal(db.get<{ arreteLe: string }>('soldesReprise', id)!.arreteLe, '2026-10-10');
  // Modification du matricule par le gestionnaire RH : ancienne et nouvelle valeur au journal.
  run(GEST, 'employe.modifier', { id: 24, matriculePaie: ' 4124 ' });
  assert.equal(domain().emp(24)!.matriculePaie, '4124');
  const j = db.sql.prepare(`SELECT payload FROM journal WHERE action = 'employe.modifier' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  assert.deepEqual(JSON.parse(j.payload).apres, { matriculePaie: '4124' });
  // Le manager ne modifie pas le matricule de paie (fiche réservée au service RH).
  refused(KARIM, 'employe.modifier', { id: 2, matriculePaie: '9999' }, /réservés au service RH/, 403);
});

test('t021 réembauche : le gestionnaire RH ne vide ni ne change un matricule enregistré (confirmation non contournable)', () => {
  const { db, run, refused, domain } = fresh();
  // Mehdi (2, 004102) sorti : le gestionnaire RH ne reprend pas son matricule sans l'administrateur RH…
  db.update('employes', 2, { fin: '2026-06-30', motifSortie: 'demission' }); // sortie enregistrée (un CDI ne finit que par elle)
  const paul = { ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Paul Neuf', poste: 'Technicien', naissance: 1990, matriculePaie: '004102' };
  refused(GEST, 'employe.creer', paul, /à confirmer par l’administrateur RH/);
  // … ni en vidant d'abord la fiche du salarié sorti, ni en la changeant.
  refused(GEST, 'employe.modifier', { id: 2, matriculePaie: null }, /seul l’administrateur RH le change ou le retire/, 403);
  refused(GEST, 'employe.modifier', { id: 2, matriculePaie: '9999' }, /seul l’administrateur RH/, 403);
  refused(GEST, 'employe.modifier', { id: 3, matriculePaie: '' }, /seul l’administrateur RH/, 403);
  refused(GEST, 'employe.creer', paul, /à confirmer par l’administrateur RH/);
  assert.equal(domain().emp(2)!.matriculePaie, '004102');
  // L'administrateur RH corrige un matricule ; le gestionnaire saisit un matricule manquant (apprenti, 24).
  run(ADMIN, 'employe.modifier', { id: 3, matriculePaie: '004199' });
  run(GEST, 'employe.modifier', { id: 24, matriculePaie: '004124' });
  assert.deepEqual([domain().emp(3)!.matriculePaie, domain().emp(24)!.matriculePaie], ['004199', '004124']);
});

test('t021 export des données après une réembauche : messages Keystone de la seule fiche concernée', () => {
  const { db, run } = fresh();
  run(ADMIN, 'parametres.maj', { identifiantKeystone: 'paie' });
  // Absence de Mehdi (2) partie à Keystone sous 004102 en mars ; Mehdi sort, Paul est embauché avec le même matricule.
  const envoi = (contenu: Record<string, unknown>, creation: string) => {
    const e = db.tx(() => mettreEnFile(db, 'keystone', String(contenu.type), contenu, true));
    db.sql.prepare('UPDATE envois SET creation = ? WHERE id = ?').run(creation, e.id);
  };
  envoi({ type: 'absence.validee', absence: 999, matricule: '004102', du: '2026-03-02', au: '2026-03-06' }, '2026-03-01T09:00:00.000Z');
  db.update('employes', 2, { fin: '2026-06-30', motifSortie: 'demission' }); // sortie enregistrée (un CDI ne finit que par elle)
  const id = (run(ADMIN, 'employe.creer', {
    ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Paul Neuf', poste: 'Technicien', naissance: 1990, matriculePaie: '004102', reutiliserMatricule: true,
  }) as { result: { id: number } }).result.id;
  envoi({ type: 'heures.validees', matricule: '004102', semaine: '2026-10-12', projets: { 'K-2614': 35 } }, '2026-10-16T16:00:00.000Z');
  const messages = (empId: number) => (donneesSalarie(db, empId, { journal: false, par: 'test' })!.sections['Messages envoyés à Keystone'] as { contenu: Record<string, unknown> }[])
    .map(m => m.contenu.type);
  assert.deepEqual(messages(id), ['heures.validees'], 'Paul : jamais l’absence de Mehdi');
  assert.deepEqual(messages(2), ['absence.validee'], 'Mehdi : jamais les heures de Paul');
});

test('t021 données : matricule de paie au service RH, aux profils restreints et à l’intéressé, jamais aux membres pour le manager', () => {
  const { db } = fresh();
  const mehdi = (u: User) => buildSnapshot(db, u).employes.find(e => e.id === 2)?.matriculePaie;
  assert.equal(mehdi(ADMIN), '004102');
  assert.equal(mehdi(collab(2)), '004102', 'l’intéressé (portail)');
  assert.equal(mehdi(KARIM), null, 'membre de l’équipe du manager');
  assert.equal(buildSnapshot(db, KARIM).employes.find(e => e.id === 12)!.matriculePaie, '004112', 'le sien');
  assert.equal(mehdi({ role: 'rh', empId: null, nom: 'Aïcha Diallo', intitule: '', profilRh: 'paie' }), '004102', 'gestionnaire de paie');
});

test('t021 salariés sans matricule de paie : présents, hors intérim ; matriculeDe pour la paie', () => {
  const { domain } = fresh();
  const d = domain();
  // L'apprenti (24) n'a pas encore son matricule ; l'intérimaire (15), payé par son agence, n'en a pas besoin.
  assert.deepEqual(sansMatriculePaie(d.ds.employes, d.ti).map(e => e.id), [24]);
  assert.equal(matriculeDe(d.emp(2)!), '004102');
  assert.equal(matriculeDe(d.emp(24)!), null);
  assert.deepEqual(sansMatriculePaie(d.ds.employes, d.ti, [2, 24, 15]).map(e => e.id), [24], 'restreint aux salariés d’un lot');
});

test('t021 transmission à Sage (simulation) : matricule de paie, salarié sans matricule signalé', () => {
  const { db, run } = fresh();
  const semaine = '2026-10-05';
  for (const empId of [2, 24]) {
    db.insert('feuilles', { empId, week: semaine, statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7] }], contrat: null });
  }
  const msg = message(run(ADMIN, 'temps.pushSage', {}));
  assert.match(msg, /simulation, rien n’est envoyé à Sage Paie.* · 1 salarié sans matricule de paie \(Bastien Morel\), sous le matricule Cursus et refusés d’une transmission réelle · 5 absences · 3 séjours \(déplacements\) · \d+ éléments à saisir dans Sage \(rubrique désactivée ou réglage décoché : voir le résumé du lot\)$/);
  const lot = db.all<{ contenu: { lignes: { matricule: string; semaine: string }[] } }>('lotsPaie').at(-1)!;
  const lignes = lot.contenu.lignes.filter(l => l.semaine === '2026-S41');
  assert.deepEqual(lignes.map(l => l.matricule).sort(), ['004102', 'EMP-0024']);
});

test('t021 Keystone : matricule Cursus par défaut ; réglage « matricule de paie » dans les deux sens', () => {
  const { db, run, domain } = fresh();
  const d = domain();
  assert.equal(identifiantKeystone(d.ds.settings.identifiantKeystone, d.emp(2)!), 'EMP-0002', 'défaut : contrat de l’API v1 inchangé');
  run(ADMIN, 'parametres.maj', { identifiantKeystone: 'paie' });
  assert.equal(loadFull(db, ADMIN).settings.identifiantKeystone, 'paie');
  // Absence posée et validée par le manager : Keystone reçoit le matricule de paie.
  run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  const envoi = db.sql.prepare(`SELECT contenu FROM envois WHERE type = 'absence.validee' ORDER BY id DESC LIMIT 1`).get() as { contenu: string };
  assert.equal(JSON.parse(envoi.contenu).matricule, '004102');
  // Appels reçus : le matricule de paie désigne le salarié, l'ancien matricule Cursus n'est plus reconnu…
  const cx = contexte(db);
  assert.equal(cx.salaries.get('004102')?.id, 2);
  assert.equal(cx.salaries.get('EMP-0002'), undefined);
  // … sauf pour un salarié sans matricule de paie, qui garde le sien.
  assert.equal(cx.salaries.get('EMP-0024')?.id, 24);
  assert.equal(cx.matricule(24), 'EMP-0024');
  db.tx(() => {
    const a = enregistrerAffectation(cx, 'AF-T021', { matricule: '004102', chantier: 'K-2614', du: '2026-10-27', au: '2026-10-30' });
    assert.equal(a.objet.matricule, '004102');
  });
  assert.throws(() => db.tx(() => enregistrerAffectation(contexte(db), 'AF-T021-B', { matricule: 'EMP-0002', chantier: 'K-2614', du: '2026-10-27', au: '2026-10-30' })),
    (e: unknown) => e instanceof ErreurKeystone && e.details.some(x => x.champ === 'matricule'));
  // Verdict Go / No Go : ressources désignées par le matricule de paie.
  const dp = domain();
  const ch = dp.evaluateChantiers(dp.enrich(90, false), dp.tripsAll()).find(x => x.c.id === 'K-2614')!;
  assert.ok(dp.verdictKeystone(ch, false, '2026-10-10T05:00:00.000Z').ressources.some(r => r.matricule === '004102'));
  assert.ok(dp.verdictKeystone(ch, false, '2026-10-10T05:00:00.000Z').ressources.every(r => !/^EMP-0002$/.test(r.matricule)));
});

test('t021 réembauche : deux fiches au même matricule de paie, Keystone désigne la fiche présente', () => {
  const { db, run } = fresh();
  run(ADMIN, 'parametres.maj', { identifiantKeystone: 'paie' });
  db.update('employes', 6, { fin: '2026-09-30', motifSortie: 'demission' }); // sortie enregistrée (un CDI ne finit que par elle)
  const id = (run(ADMIN, 'employe.creer', {
    ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Thomas Garnier', poste: 'Électromécanicien', naissance: 1976, matriculePaie: '004106', reutiliserMatricule: true,
  }) as { result: { id: number } }).result.id;
  assert.equal(contexte(db).salaries.get('004106')?.id, id);
});

// — t072 : compteurs repris et reports datés —

test('t072 compteurs repris datés : RTT justes au 1er janvier, CP au 1er juin', () => {
  const { domain } = fresh();
  // Mehdi (2) : RTT et CP repris, arrêtés au chargement de la démonstration (période 2025-2026 à prendre, RTT 2026).
  const r = domain().ds.soldesReprise.find(s => s.empId === 2)!;
  assert.ok(r.rttPris > 0 && r.cpPris > 0);
  assert.equal(r.arreteLe, '2026-10-10');
  const oct = domain('2026-10-10'), mehdi = oct.emp(2)!;
  assert.ok(rttInfo(oct, mehdi)!.pris >= r.rttPris, 'RTT 2026 : compteur repris décompté');
  assert.ok(cpInfo(oct, mehdi)!.pris >= r.cpPris);
  // Au 1er février 2027, aucun RTT posé sur 2027 : rien de pris (le défaut relevé : 16 RTT « pris »).
  const fev = domain('2027-02-01');
  assert.equal(rttInfo(fev, fev.emp(2)!)!.pris, 0);
  // Au 15 juin 2027, la période 2026-2027 ne reprend pas les CP de l'ancien outil.
  const juin = domain('2027-06-15');
  assert.equal(cpInfo(juin, juin.emp(2)!)!.pris, 0);
});

test('t072 reports datés : reçu compté sur sa période seulement, accordé appliqué à la clôture', () => {
  const { run, refused, domain } = fresh();
  // Thomas Garnier (6) : 4 j reçus sur la période 2025-2026 (année de prise 2026), jusqu'au 31 août 2027.
  const oct = domain('2026-10-10');
  assert.equal(cpInfo(oct, oct.emp(6)!)!.recu, 4);
  const juin = domain('2027-06-15');
  assert.equal(cpInfo(juin, juin.emp(6)!)!.recu, 0, 'plus compté sur la période suivante (défaut relevé : +4 j à vie)');
  // Report accordé en cours de période : vers la période suivante, plafonné au solde non encore reporté.
  const solde = cpInfo(oct, oct.emp(2)!)!.solde;
  refused(ADMIN, 'report.accorder', { empId: 2, jours: solde + 1, motif: 'Charge de projet' }, /au plus/);
  refused(ADMIN, 'report.accorder', { empId: 2, jours: 2, motif: 'Charge de projet', expire: '2027-05-31' }, /Échéance du report invalide/);
  assert.match(message(run(ADMIN, 'report.accorder', { empId: 2, jours: 2, motif: 'Charge de projet' })), /sur la période 2026-2027 \(appliqués à la clôture du 31 mai 2027\) — utilisables jusqu’au 31 mai 2028/);
  const apres = domain('2026-10-10'), cp = cpInfo(apres, apres.emp(2)!)!;
  assert.equal(cp.accorde, 2);
  const r = apres.ds.reports.find(x => x.empId === 2 && x.sens === 'accorde')!;
  assert.deepEqual([r.periode, r.expire], [2027, '2028-05-31']);
  refused(ADMIN, 'report.accorder', { empId: 2, jours: cp.solde - 1, motif: 'Encore' }, /solde non encore reporté/);
  // Pas encore dans les droits de 2027 : la clôture le plafonnera au solde restant au 31 mai.
  const juin2 = domain('2027-06-15');
  assert.equal(cpInfo(juin2, juin2.emp(2)!)!.recu, 0);
});

test('t072 migration nommée : compteurs et reports d’une base existante datés une fois, tracé', () => {
  const { db } = fresh();
  db.sql.exec('UPDATE soldes_reprise SET arrete_le = NULL; UPDATE reports SET periode = NULL, expire = NULL');
  db.insert('reports', { empId: 2, jours: 3, motif: 'Ancien report accordé', par: 'RH', date: '2026-04-15', sens: 'accorde' });
  const aDater = () => (db.sql.prepare('SELECT (SELECT COUNT(*) FROM soldes_reprise WHERE arrete_le IS NULL) + (SELECT COUNT(*) FROM reports WHERE periode IS NULL) AS n').get() as { n: number }).n;
  assert.equal(aDater(), 26);
  assert.equal(SOLDES_DATES.necessaire!(db), true);
  // Lot 5 : sessions sur plusieurs jours (base neuve : exécutée, sans effet) ; INT-FORM déjà chargée par la démonstration.
  assert.deepEqual(appliquerMigrations(db), ['lot4-exploitation-index-journal', 'lot4-exploitation-index-envois', 'lot4-exploitation-index-keystone', 'lot4-reprise-soldes-dates', 'lot4-paie-heures-sup', 'lot4-entretiens-cout-reel', 'lot4-referentiels-postes', 'lot4-paie-lots-historiques', 'lot5-paie-mode-api-retire', 'lot5-voyages-references', 'lot5-temps-semaine-7-jours', 'lot5-conges-demi-journees', 'lot5-formations-plage-sessions', 'lot5-exploitation-index-salaries', 'lot5-paie-absences-anterieures', 'lot5-paie-rubriques-par-feuille', 'lot6-pieces-index', 'lot6-hierarchie-equipes', 'lot6-paie-deplacements-depart', 'lot6-contrats-historique', 'lot6-pieces-index-conservation-agenda']);
  const ds = loadFull(db, ADMIN);
  assert.ok(ds.soldesReprise.every(s => s.arreteLe === '2026-10-10'), 'date de mise en service de cette version');
  const recu = ds.reports.find(r => r.empId === 6)!, accorde = ds.reports.find(r => r.empId === 2)!;
  assert.deepEqual([recu.periode, recu.expire], [2026, '2027-05-31'], 'reçu le 2 juin 2026 : période 2025-2026 (année de prise 2026)');
  assert.deepEqual([accorde.periode, accorde.expire], [2026, '2027-05-31'], 'accordé en avril 2026 : vers la période suivante');
  // Période visée déjà commencée à la migration : devenu reçu, ses 3 jours comptent aussitôt (aucune clôture de la
  // période 2024-2025, tenue par l'ancien outil, ne l'appliquera).
  assert.equal(accorde.sens, 'recu');
  const oct = new Domain(ds);
  assert.deepEqual([cpInfo(oct, oct.emp(2)!)!.recu, cpInfo(oct, oct.emp(2)!)!.accorde], [3, 0]);
  const j = db.sql.prepare(`SELECT payload, paie FROM journal WHERE action = 'migration.soldes'`).get() as { payload: string; paie: number };
  assert.deepEqual(JSON.parse(j.payload), { arreteLe: '2026-10-10', soldes: 24, reports: 2, accordesRecus: 1 });
  assert.equal(j.paie, 1, 'archive paie de 3 ans');
  assert.equal(aDater(), 0);
  assert.deepEqual(appliquerMigrations(db), [], 'une seule fois');
});

// — t072 : clôtures —

test('t072 clôture des RTT : proposée au 1er janvier, soldes photographiés, sans effet si relancée', () => {
  const { db, run, refused, domain } = fresh();
  assert.deepEqual(cloturesAFaire(domain('2026-10-10')), [], 'rien avant la fin de la première année tenue par Cursus');
  refused(ADMIN, 'conges.cloturer', { type: 'RTT', periode: 2026 }, /à partir du 1er janvier 2027/);
  const jan = domain('2027-01-04');
  const a = cloturesAFaire(jan);
  assert.deepEqual(a.map(x => [x.type, x.periode]), [['RTT', 2026]]);
  // Rappel du CET avant la confirmation : les RTT 2026 restent plaçables (5 par an), puis plus.
  const nicolas = lignesClotureRtt(jan, 2026).find(l => l.e.id === 22)!;
  assert.ok(nicolas.solde > 0 && nicolas.cet > 0);
  assert.equal(cetInfo(jan, jan.emp(22)!).placeRttPrec, nicolas.cet);
  le('2027-01-04', () => run(GEST, 'cet.placer', { empId: 22, kind: 'RTT', annee: 2026, jours: 1 }));
  // Mehdi (2) a une demande de RTT 2026 en attente : il n'est pas clôturé (un refus rendrait des jours à l'année close).
  const attente = lignesClotureRtt(jan, 2026).find(l => l.e.id === 2)!.attente;
  assert.equal(attente.length, 1);
  const msg = le('2027-01-04', () => message(run(GEST, 'conges.cloturer', { type: 'RTT', periode: 2026 })));
  assert.match(msg, /^Clôture des RTT 2026 : \d+ salariés, [\d,]+ j non pris perdus \(non reportables\) · 1 salarié non clôturé, demande de RTT en attente de décision : Mehdi Benali$/);
  assert.deepEqual(cloturesAFaire(domain('2027-01-04')).map(x => [x.type, x.restants]), [['RTT', 1]]);
  le('2027-01-04', () => run(ADMIN, 'absence.decider', { id: attente[0].id, ok: false, motif: 'Charge' }));
  assert.match(le('2027-01-04', () => message(run(GEST, 'conges.cloturer', { type: 'RTT', periode: 2026 }))), /^Clôture des RTT 2026 : 1 salarié/);
  const lignes = loadFull(db, ADMIN).clotures.filter(c => c.type === 'RTT' && c.periode === 2026);
  assert.equal(lignes.length, a[0].total);
  const n = lignes.find(c => c.empId === 22)!;
  assert.deepEqual([n.decision, n.perdus], ['perdre', nicolas.solde - 1]);
  assert.match(le('2027-01-04', () => message(run(GEST, 'conges.cloturer', { type: 'RTT', periode: 2026 }))), /déjà clôturée/);
  assert.equal(loadFull(db, ADMIN).clotures.length, lignes.length, 'relance sans effet');
  assert.deepEqual(cloturesAFaire(domain('2027-01-04')), []);
  // Année close : ni RTT posé sur 2026, ni placement sur le CET.
  const apres = domain('2027-01-04');
  assert.match(checkAbsence(apres, apres.emp(2)!, 'RTT', '2026-12-30', '2026-12-30').msgs.find(m => m.bad)!.text, /Les RTT 2026 sont clos/);
  assert.equal(cetInfo(apres, apres.emp(22)!).placeRttPrec, 0);
  le('2027-01-04', () => refused(GEST, 'cet.placer', { empId: 22, kind: 'RTT', annee: 2026, jours: 1 }, /Les RTT 2026 ne se placent plus .*année close/));
  // Journal : une ligne, décisions et salariés, jamais de motif.
  const j = db.sql.prepare(`SELECT payload, salaries, paie FROM journal WHERE action = 'conges.cloturer' ORDER BY id LIMIT 1`).get() as { payload: string; salaries: string; paie: number };
  const p = JSON.parse(j.payload);
  assert.deepEqual([p.type, p.periode, p.lignes.length, j.paie], ['RTT', 2026, lignes.length - 1, 1], 'première clôture : sans Mehdi');
  assert.ok(JSON.parse(j.salaries).includes(22));
  assert.ok(!j.payload.includes('motif'));
});

test('t072 clôture des CP : aucune perte d’office, report imposé après une absence de santé, décision ligne par ligne', () => {
  const { db, run, refused, domain } = fresh();
  // Report accordé à Mehdi en cours de période : il préremplit sa ligne.
  run(ADMIN, 'report.accorder', { empId: 2, jours: 2, motif: 'Charge de projet' });
  refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026 }, /se termine le 31 mai 2027/);
  const juin = domain('2027-06-15');
  assert.deepEqual(cloturesAFaire(juin).map(x => [x.type, x.periode]), [['CP', 2026], ['RTT', 2026]]);
  const lignes = lignesClotureCp(juin, 2026), ligne = (id: number) => lignes.find(l => l.e.id === id)!;
  assert.ok(!lignes.some(l => l.e.id === 15), 'intérimaire : congés gérés par l’agence');
  // Arrêt maladie (13, 3 j ouvrés), maternité (19, plus que son solde), absence à qualifier (20, 8 j ouvrés) dans la période
  // de prise : les jours qu'ils ont empêché de prendre sont reportés 15 mois, dans la limite du solde (lot 5, t041). La
  // proposition reporte tout le solde : le reste n'est jamais prérempli comme perdu (aucune perte d'office).
  for (const [id, legal] of [[13, 3], [19, ligne(19).solde], [20, 8]]) {
    assert.equal(ligne(id).impose, 'report_legal', `salarié ${id}`);
    assert.deepEqual([ligne(id).legal, ligne(id).expireLegal, ligne(id).proposition.decision, ligne(id).proposition.jours], [legal, '2028-08-31', 'reporter', ligne(id).solde]);
  }
  assert.ok(ligne(13).solde > 3 && ligne(20).solde > 8, 'le reste du solde est au choix du service RH');
  assert.deepEqual([ligne(13).empeches, ligne(13).acquisArret], [3, 0]);
  // Thomas (6) : seuls les 4 j de son report légal (jusqu'au 31 août 2027) sont imposés ; le reste est au choix du RH.
  assert.deepEqual([ligne(6).impose, ligne(6).legal, ligne(6).expireLegal], ['report_en_cours', 4, '2027-08-31']);
  assert.ok(ligne(6).solde > 4);
  // Mehdi (2) : report accordé ; Camille (1) : sans décision proposée (politique au cas par cas), demande de CP en attente.
  assert.deepEqual([ligne(2).accorde, ligne(2).proposition.decision, ligne(2).proposition.jours], [2, 'reporter', 2]);
  assert.equal(ligne(1).proposition.decision, null);
  assert.equal(ligne(1).attente.length, 1);
  le('2027-06-15', () => {
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 13, decision: 'perdre' }] }, /Marion Petit : perte impossible/);
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 13, decision: 'reporter', jours: 1 }] }, /au moins sont à reporter \(report légal\), jusqu’au 31 août 2028/);
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 6, decision: 'perdre' }] }, /Thomas Garnier : perte impossible, 4 j sont à reporter/);
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 2, decision: 'reporter', jours: ligne(2).solde + 1 }] }, /au plus/);
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 15, decision: 'perdre' }] }, /hors de la clôture/);
    // Demande de CP de la période en attente : à décider d'abord, la demande est nommée.
    refused(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 1, decision: 'perdre' }] }, /Camille Roux : demande de congés payés en attente \(du 26 oct\. au 30 oct\. 2026\)/);
    // Le gestionnaire RH, salarié (14), ne décide pas de son propre solde.
    refused(GEST, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 14, decision: 'perdre' }] }, /propres congés/, 403);
    const msg = message(run(GEST, 'conges.cloturer', {
      type: 'CP', periode: 2026, lignes: [
        { empId: 13, decision: 'reporter', jours: ligne(13).solde },
        { empId: 2, decision: 'reporter', jours: 2 },
        { empId: 6, decision: 'reporter', jours: 4 },
        { empId: 3, decision: 'perdre' },
      ],
    }));
    assert.match(msg, /^Clôture des congés payés 2025-2026 : 3 reports, 1 perte, \d+ salariés? sans solde · \d+ lignes restent à décider \(demandes de CP en attente de décision : Camille Roux, Pierre Fontaine, Romain Chevalier\)$/);
  });
  const apres = loadFull(db, ADMIN);
  const c = (id: number) => apres.clotures.find(x => x.empId === id && x.type === 'CP' && x.periode === 2026);
  assert.deepEqual([c(3)!.decision, c(3)!.perdus, c(3)!.reportes], ['perdre', ligne(3).solde, 0]);
  // Tout le solde de Marion reporté : 3 j de report légal jusqu'au 31 août 2028, le reste jusqu'au 31 mai 2028.
  assert.deepEqual([c(13)!.decision, c(13)!.motif, c(13)!.expire], ['reporter', 'report_legal', '2028-05-31']);
  assert.deepEqual(apres.reports.filter(r => r.empId === 13 && r.sens === 'recu').map(r => [r.jours, r.expire]).sort(), [[3, '2028-08-31'], [ligne(13).solde - 3, '2028-05-31']]);
  assert.equal(c(1), undefined, 'demande en attente : reste à clôturer');
  assert.equal(c(10), undefined, 'solde nul mais demande en attente : pas clos d’office');
  // Thomas : 4 j reportés jusqu'au 31 août 2027 (report légal), le reste perdu sur décision du RH.
  assert.deepEqual([c(6)!.reportes, c(6)!.perdus, c(6)!.expire], [4, ligne(6).solde - 4, '2027-08-31']);
  // Reports reçus sur la période 2026-2027 : comptés dans ses droits ; le report accordé n'est plus en attente.
  const juin2 = domain('2027-06-15'), mehdi = cpInfo(juin2, juin2.emp(2)!)!;
  assert.equal(mehdi.recu, 2);
  assert.equal(apres.reports.find(r => r.empId === 2 && r.sens === 'recu')!.expire, '2028-05-31', 'report décidé par le RH : 31 mai suivant');
  const marion = cpInfo(juin2, juin2.emp(13)!)!;
  assert.equal(marion.recu, ligne(13).solde);
  // Relance : sans effet sur les lignes clôturées.
  le('2027-06-15', () => run(GEST, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 3, decision: 'reporter', jours: 1 }] }));
  assert.equal(loadFull(db, ADMIN).clotures.filter(x => x.empId === 3).length, 1);
  assert.equal(c(3)!.decision, 'perdre');
  // Période close : aucun congé ne s'y pose plus.
  const close = domain('2027-06-15');
  assert.match(checkAbsence(close, close.emp(3)!, 'CP', '2027-05-24', '2027-05-25').msgs.find(m => m.bad)!.text, /congés payés de la période 2025-2026 sont clos/);
  // Le motif d'un report imposé (absence de santé) reste au service RH et à l'intéressé.
  const motifs = (u: User) => le('2027-06-15', () => buildSnapshot(db, u)).clotures.filter(x => x.empId === 13).map(x => x.motif);
  assert.deepEqual(motifs(ADMIN), ['report_legal']);
  assert.deepEqual(motifs(collab(13)), ['report_legal']);
  assert.deepEqual(motifs({ role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: '' }), [null]);
  assert.deepEqual(motifs({ role: 'rh', empId: null, nom: 'Aïcha Diallo', intitule: '', profilRh: 'paie' }), [null]);
});

test('t072 clôture des CP : demande en attente, refus et annulation après la clôture, aucun jour perdu sans trace', () => {
  const { db, run, refused, domain } = fresh();
  // Scénario 1 : Camille (1) demande des CP du 24 au 28 mai 2027, en attente à la clôture. Sa demande d'octobre est validée.
  const camilleOct = domain().ds.absences.find(a => a.empId === 1 && a.type === 'CP' && a.statut === 'demandee')!;
  run(ADMIN, 'absence.decider', { id: camilleOct.id, ok: true });
  le('2027-05-10', () => run(collab(1), 'absence.demander', { empId: 1, kind: 'CP', du: '2027-05-24', au: '2027-05-28' }));
  const mai = domain('2027-06-15').ds.absences.find(a => a.empId === 1 && a.du === '2027-05-24')!;
  const l1 = lignesClotureCp(domain('2027-06-15'), 2026).find(l => l.e.id === 1)!;
  assert.deepEqual([l1.solde, l1.attente.map(a => a.id)], [0, [mai.id]]);
  // Scénario 2 : CP du 24 au 28 mai 2027 posés et validés par le manager de Mehdi (2).
  le('2027-05-10', () => run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2027-05-24', au: '2027-05-28' }));
  const soldeMehdi = lignesClotureCp(domain('2027-06-15'), 2026).find(l => l.e.id === 2)!.solde;
  le('2027-06-15', () => {
    const msg = message(run(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 2, decision: 'reporter', jours: soldeMehdi }] }));
    assert.match(msg, /demandes de CP en attente de décision : .*Camille Roux/);
  });
  const cl = () => loadFull(db, ADMIN).clotures;
  assert.equal(cl().find(c => c.empId === 1), undefined, 'solde nul, demande en attente : ligne non close');
  // Le 20 juin, la demande de Camille est refusée : son solde de 5 j revient, la ligne reste proposée.
  le('2027-06-20', () => run(ADMIN, 'absence.decider', { id: mai.id, ok: false, motif: 'Charge' }));
  const l1b = lignesClotureCp(domain('2027-06-20'), 2026).find(l => l.e.id === 1)!;
  assert.deepEqual([l1b.solde, l1b.attente.length, l1b.deja], [5, 0, null]);
  assert.ok(cloturesAFaire(domain('2027-06-20')).some(x => x.type === 'CP' && x.periode === 2026));
  // Le 20 juin, le RH annule les CP de mai de Mehdi : les 5 j rendus à la période close sont reportés sur 2026-2027.
  const cpMai = domain('2027-06-20').ds.absences.find(a => a.empId === 2 && a.du === '2027-05-24')!;
  const avant = cpInfo(domain('2027-06-20'), domain('2027-06-20').emp(2)!)!.recu;
  const msg = message(le('2027-06-20', () => run(ADMIN, 'absence.annuler', { id: cpMai.id })));
  assert.match(msg, /5 j de CP rendus : 5 j de la période close 2025-2026 reportés sur 2026-2027 \(jusqu’au 31 mai 2028\)/);
  assert.doesNotMatch(msg, /recrédités sur le solde/);
  const juin = domain('2027-06-20');
  assert.equal(cpInfo(juin, juin.emp(2)!)!.recu, avant + 5);
  // Tracé au journal : jours, période et échéance du report, jamais son motif.
  const j = db.sql.prepare(`SELECT payload FROM journal WHERE action = 'absence.annuler' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  const p = JSON.parse(j.payload);
  assert.deepEqual(p.reportsRendus.map((r: { jours: number; periode: number; expire: string }) => [r.jours, r.periode, r.expire]), [[5, 2027, '2028-05-31']]);
  assert.ok(!j.payload.includes('motif'));
  // Une relance de l'annulation n'en crée pas d'autre.
  refused(ADMIN, 'absence.annuler', { id: cpMai.id }, /.+/);
  assert.equal(loadFull(db, ADMIN).reports.filter(r => r.empId === 2 && r.periode === 2027 && r.sens === 'recu').length, 2);
});

test('t072 reports légaux et discrétionnaires : échéance propre, extinction, 31 mai pour une décision du RH', () => {
  const { db, run, refused, domain } = fresh();
  // Report accordé au-delà du 31 mai suivant : refusé (seul un report légal court au-delà).
  refused(ADMIN, 'report.accorder', { empId: 1, jours: 2, motif: 'Projet', expire: '2029-05-31' }, /Échéance du report invalide/);
  // Thomas (6) : 4 j légaux reportés jusqu'au 31 août 2027, 2 j décidés par le RH jusqu'au 31 mai 2028.
  const camilleOct = domain().ds.absences.find(x => x.empId === 1 && x.type === 'CP' && x.statut === 'demandee')!;
  run(ADMIN, 'absence.decider', { id: camilleOct.id, ok: true });
  le('2027-06-15', () => run(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 6, decision: 'reporter', jours: 6 }, { empId: 1, decision: 'reporter', jours: 2 }] }));
  const recus = loadFull(db, ADMIN).reports.filter(r => r.empId === 6 && r.periode === 2027).map(r => [r.jours, r.expire]);
  assert.deepEqual(recus.sort(), [[2, '2028-05-31'], [4, '2027-08-31']]);
  const juillet = domain('2027-07-01');
  assert.equal(cpInfo(juillet, juillet.emp(6)!)!.recu, 6);
  // 2 j pris le 5 et 6 juillet 2027 : imputés d'abord sur le report légal. Le 1er septembre, ses 2 j restants s'éteignent.
  le('2027-07-01', () => run(ADMIN, 'absence.demander', { empId: 6, kind: 'CP', du: '2027-07-05', au: '2027-07-06' }));
  const a = domain('2027-07-01').ds.absences.find(x => x.empId === 6 && x.du === '2027-07-05')!;
  le('2027-07-01', () => run(ADMIN, 'absence.decider', { id: a.id, ok: true }));
  assert.equal(cpInfo(domain('2027-08-31'), domain('2027-08-31').emp(6)!)!.recu, 6, 'jusqu’à l’échéance');
  const sept = domain('2027-09-01');
  assert.equal(cpInfo(sept, sept.emp(6)!)!.recu, 4, '2 j pris sur le report légal + 2 j du report du RH');
  // À la clôture 2027, rien n'est plus imposé à Thomas : les jours légaux sont échus avant le 31 mai.
  const l6 = lignesClotureCp(domain('2028-06-15'), 2027).find(l => l.e.id === 6)!;
  assert.deepEqual([l6.impose, l6.legal], [null, 0]);
  // Camille (1) : report du RH à la clôture 2026, échéance au 31 mai 2028 ; sa ligne 2027 n'est pas imposée.
  assert.equal(loadFull(db, ADMIN).reports.find(r => r.empId === 1 && r.sens === 'recu')!.expire, '2028-05-31');
  const l1 = lignesClotureCp(domain('2028-06-15'), 2027).find(l => l.e.id === 1)!;
  assert.deepEqual([l1.impose, l1.legal], [null, 0]);
  le('2028-06-15', () => run(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2027, lignes: [{ empId: 1, decision: 'perdre' }] }));
  assert.equal(loadFull(db, ADMIN).clotures.find(c => c.empId === 1 && c.periode === 2027)!.decision, 'perdre');
});

test('t072 échéances des reports et des clôtures : neutres pour le manager et les profils restreints', () => {
  const { db, run } = fresh();
  le('2027-06-15', () => run(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 6, decision: 'reporter', jours: 4 }] }));
  const KARIM_ = KARIM, PAIE: User = { role: 'rh', empId: null, nom: 'Aïcha Diallo', intitule: '', profilRh: 'paie' };
  const LECT: User = { role: 'rh', empId: null, nom: 'Lecteur', intitule: '', profilRh: 'lecture_seule' };
  const vue = (u: User) => le('2027-06-15', () => buildSnapshot(db, u));
  // Thomas (6), membre de l'équipe de Karim (12) : le 31 août d'un report légal n'est transmis qu'au RH et à l'intéressé.
  for (const u of [KARIM_, PAIE, LECT]) {
    const v = vue(u);
    assert.ok(v.reports.filter(r => r.empId === 6).every(r => r.expire === `${r.periode! + 1}-05-31` && r.motif === ''), u.nom);
    assert.ok(v.clotures.filter(c => c.empId === 6).every(c => c.motif === null && c.expire === '2028-05-31'), u.nom);
  }
  assert.ok(vue(ADMIN).reports.some(r => r.empId === 6 && r.expire === '2027-08-31'));
  assert.ok(vue(collab(6)).reports.some(r => r.empId === 6 && r.expire === '2027-08-31'));
  assert.equal(vue(collab(6)).clotures.find(c => c.empId === 6)!.expire, '2027-08-31');
});

test('t072 politique « proposer le report » : toutes les lignes préremplies, aucune perte', () => {
  const { run, domain } = fresh();
  run(ADMIN, 'parametres.maj', { politiqueReportCp: 'proposer_report' });
  const juin = domain('2027-06-15');
  const l = lignesClotureCp(juin, 2026).filter(x => x.solde > 0);
  assert.ok(l.length > 0 && l.every(x => x.proposition.decision === 'reporter' && x.proposition.jours <= x.solde));
});

// — t087 : RTT de l'année suivante —

test('t087 RTT de l’année suivante posés avant le 1er janvier, sur le droit de cette année-là', () => {
  const { db, run, domain } = fresh();
  const d = domain('2026-10-15');
  for (const id of [2, 3, 6]) {
    const chk = checkAbsence(d, d.emp(id)!, 'RTT', '2027-01-05', '2027-01-05');
    assert.equal(chk.cant, false, `${d.emp(id)!.nom} : ${chk.msgs.map(m => m.text).join(' | ')}`);
    assert.equal(chk.soldeLabel, 'Disponible sur 2027 : 23 j', 'réglage des RTT 39 h, année entière');
  }
  // Forfait jours : jours de repos de 2027.
  assert.equal(rttInfo(d, d.emp(9)!, 2027)!.droit, reposForfait(2027, 218));
  // À cheval sur deux années : refusé ; année d'après : pas encore.
  const cheval = checkAbsence(d, d.emp(2)!, 'RTT', '2026-12-31', '2027-01-04');
  assert.equal(cheval.cant, true);
  assert.match(cheval.msgs.find(m => m.bad)!.text, /à cheval sur 2026 et 2027 : posez une demande par année/);
  assert.match(checkAbsence(d, d.emp(2)!, 'RTT', '2028-01-04', '2028-01-04').msgs.find(m => m.bad)!.text, /Les RTT 2028 ne se posent pas encore/);
  // Année passée, tenue par l'ancien outil (compteurs arrêtés en 2026) : close.
  assert.match(checkAbsence(d, d.emp(2)!, 'RTT', '2025-12-29', '2025-12-29').msgs.find(m => m.bad)!.text, /Les RTT 2025 sont clos/);
  // Par l'action : décomptés sur 2027, sans toucher au solde de 2026.
  const avant = rttInfo(d, d.emp(2)!)!.solde;
  le('2026-10-15', () => run(collab(2), 'absence.demander', { empId: 2, kind: 'RTT', du: '2027-01-05', au: '2027-01-06' }));
  const apres = domain('2026-10-15');
  assert.equal(rttInfo(apres, apres.emp(2)!)!.solde, avant);
  assert.deepEqual([rttInfo(apres, apres.emp(2)!, 2027)!.poses, rttInfo(apres, apres.emp(2)!, 2027)!.solde], [2, 21]);
  // Au-delà du droit de 2027 : solde insuffisant.
  assert.equal(checkAbsence(apres, apres.emp(2)!, 'RTT', '2027-02-01', '2027-03-31').cant, true);
  // Réglage « posables à partir du 1er novembre » : refus avant, accepté ensuite.
  run(ADMIN, 'parametres.maj', { rttAnneeSuivanteDes: '11-01' });
  assert.equal(loadFull(db, ADMIN).settings.rttAnneeSuivanteDes, '11-01');
  const oct = domain('2026-10-15'), nov = domain('2026-11-02');
  assert.match(checkAbsence(oct, oct.emp(3)!, 'RTT', '2027-01-05', '2027-01-05').msgs.find(m => m.bad)!.text, /Les RTT 2027 se posent à partir du 1 nov\. 2026/);
  assert.equal(checkAbsence(nov, nov.emp(3)!, 'RTT', '2027-01-05', '2027-01-05').cant, false);
});
