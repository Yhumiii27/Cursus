// Tests : modèle de contrat, fiches, équipes, managers et migration des anciennes bases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-07';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { recupInfo, rttInfo, reposForfait } = await import('../shared/rules/conges.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { profilOf, validerProfil } = await import('../shared/rules/profil.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Responsable RH' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const forbidden = (user: User, name: string, payload: Record<string, unknown>) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403, `${name} devait être refusé`);
  const domain = () => new Domain(loadFull(db, RH));
  return { db, run, forbidden, domain };
}
const ligne = (h: number[]) => ({ lignes: [{ projet: 'X', tache: '', ks: false, h }] });

test('lecture du contrat : statut, nature et organisation du temps', () => {
  const { domain } = fresh();
  const d = domain();
  const nadia = d.contratOf(d.emp(9)!);
  assert.equal(nadia.forfait, true);
  assert.equal(nadia.cadre, true);
  assert.equal(nadia.seuil, null);
  assert.match(nadia.libelle, /CDI · Ingénieur \/ cadre · Forfait annuel en jours · 218 j/);
  const antoine = d.contratOf(d.emp(14)!);
  assert.equal(antoine.hebdo, true);
  assert.equal(antoine.seuil, 38.5);
  assert.equal(d.contratOf(d.emp(15)!).interim, true);
  assert.deepEqual(d.contratOf(d.emp(1)!).jourOff, [], 'jours non travaillés réservés au temps partiel');
});

test('feuilles de temps par régime', () => {
  const { domain } = fresh();
  const d = domain();
  const hebdo = calcSheet(d, d.emp(14)!, ligne([9, 9, 9, 9, 9])); // forfait 38,5 h, 45 h travaillées
  assert.equal(hebdo.normal, 35);
  assert.equal(hebdo.incluses, 3.5);
  assert.equal(hebdo.sup25, 4.5);
  assert.equal(hebdo.sup50, 2);
  const annuel = calcSheet(d, d.emp(11)!, ligne([9, 9, 9, 9, 9])); // forfait annuel 1 607 h
  assert.equal(annuel.sup25 + annuel.sup50, 0, 'pas de décompte hebdomadaire');
  assert.equal(recupInfo(d, d.emp(11)!), null);
  assert.equal(rttInfo(d, d.emp(11)!), null);
});

test('forfait jours : jours de repos selon le nombre de jours du forfait', () => {
  assert.equal(reposForfait(2026), 9);
  assert.equal(reposForfait(2026, 210), 17);
});

test('contrôles de la fiche', () => {
  const { domain } = fresh();
  const d = domain();
  const opts = { equipes: d.equipes, year: 2026 };
  const base = profilOf(d.emp(1)!);
  assert.ok(validerProfil(base, opts).ok);
  assert.ok(!validerProfil({ ...base, temps: 'dirigeant' }, opts).ok, 'cadre dirigeant réservé aux cadres');
  assert.ok(validerProfil({ ...base, statut: 'cadre', temps: 'dirigeant' }, opts).ok);
  assert.ok(!validerProfil({ ...base, temps: 'forfait_jours', forfaitJours: 230 }, opts).ok, '218 jours au plus');
  const nonCadre = validerProfil({ ...base, temps: 'forfait_jours', forfaitJours: 218 }, opts);
  assert.ok(nonCadre.ok && nonCadre.warnings.length > 0, 'forfait jours non-cadre : avertissement');
  const partiel = validerProfil({ ...base, temps: 'partiel', heures: 20, jourOff: [2] }, opts);
  assert.ok(partiel.ok && partiel.warnings.some(w => w.includes('24 h')));
  assert.ok(!validerProfil({ ...base, typeContrat: 'cdd', fin: null }, opts).ok, 'CDD sans date de fin');
  assert.equal(validerProfil({ ...base, temps: '35h', jourOff: [1, 2] }, opts).profil.jourOff.length, 0);
});

test('RH : création et modification de fiche', () => {
  const { run, domain } = fresh();
  const r = run(RH, 'employe.creer', {
    nom: 'Zoé Martin', poste: 'Ingénieure procédés', equipe: 'Production', statut: 'cadre', typeContrat: 'cdi', temps: 'forfait_jours',
    forfaitJours: 214, entree: '2026-10-01', naissance: 1990,
  }) as { result: { id: number } };
  const zoe = domain().emp(r.result.id)!;
  assert.equal(zoe.forfaitJours, 214);
  assert.equal(zoe.heures, null);
  run(RH, 'employe.modifier', { id: 1, statut: 'technicien', temps: '39h_rtt' });
  const d = domain();
  assert.equal(d.emp(1)!.temps, '39h_rtt');
  assert.ok(rttInfo(d, d.emp(1)!), 'passage à 39 h : RTT ouverts');
  assert.throws(() => run(RH, 'employe.modifier', { id: 1, temps: 'dirigeant' }), /réservé au statut cadre/);
});

test('manager : fiche limitée aux membres de son équipe', () => {
  const { run, forbidden, domain } = fresh();
  run(KARIM, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance confirmé' });
  assert.equal(domain().emp(2)!.poste, 'Technicien de maintenance confirmé');
  forbidden(KARIM, 'employe.modifier', { id: 2, statut: 'cadre' });
  forbidden(KARIM, 'employe.modifier', { id: 2, temps: 'forfait_jours' });
  forbidden(KARIM, 'employe.modifier', { id: 1, poste: 'X' }); // Logistique
  forbidden(KARIM, 'employe.modifier', { id: 12, poste: 'X' }); // lui-même
  forbidden(MEHDI, 'employe.modifier', { id: 2, poste: 'X' });
});

test('RH : équipes et désignation des managers', () => {
  const { run, forbidden, domain, db } = fresh();
  run(RH, 'equipe.creer', { nom: 'Méthodes', managerId: 5 });
  run(RH, 'equipe.affecter', { empId: 11, equipe: 'Méthodes' });
  let d = domain();
  assert.equal(d.mgrOf(d.emp(11)!), 5);
  run(RH, 'equipe.renommer', { nom: 'Méthodes', nouveau: 'Méthodes & industrialisation' });
  d = domain();
  assert.equal(d.emp(11)!.equipe, 'Méthodes & industrialisation');
  assert.equal(d.mgrOf(d.emp(11)!), 5);
  assert.throws(() => run(RH, 'equipe.supprimer', { nom: 'Méthodes & industrialisation' }), /compte encore/);
  run(RH, 'equipe.manager', { nom: 'Logistique', managerId: 1 });
  assert.ok(buildSnapshot(db, { ...HUGO, empId: 1 }).employes.some(e => e.id === 4), 'nouveau manager : voit son équipe');
  forbidden(KARIM, 'equipe.manager', { nom: 'Maintenance', managerId: 2 });
  forbidden(KARIM, 'equipe.creer', { nom: 'X' });
});

test('manager : composition de son équipe', () => {
  const { run, forbidden, domain } = fresh();
  run(KARIM, 'equipe.affecter', { empId: 2, equipe: null });
  let d = domain();
  assert.equal(d.emp(2)!.equipe, null);
  assert.equal(d.mgrOf(d.emp(2)!), 0, 'à affecter : relève du RH');
  run(KARIM, 'equipe.affecter', { empId: 2, equipe: 'Maintenance' });
  forbidden(KARIM, 'equipe.affecter', { empId: 2, equipe: 'Logistique' });
  forbidden(KARIM, 'equipe.affecter', { empId: 1, equipe: null }); // membre de Logistique
  forbidden(KARIM, 'equipe.affecter', { empId: 12, equipe: null }); // lui-même
  forbidden(MEHDI, 'equipe.affecter', { empId: 2, equipe: null });
  run(KARIM, 'equipe.affecter', { empId: 20, equipe: 'Maintenance' });
  d = domain();
  assert.equal(d.emp(20)!.equipe, 'Maintenance');
});

test('manager : formations, absences et feuilles de temps de son équipe', () => {
  const { run, forbidden, domain } = fresh();
  const d0 = domain();
  const certSst = d0.emp(2)!.certs.find(c => c.f === 'elec')!;
  run(KARIM, 'plan.inscrire', { empId: 2, certId: certSst.id, sessionId: 5, conv: 'now' });
  assert.equal(domain().emp(2)!.certs.find(c => c.id === certSst.id)!.sessionId, 5);
  forbidden(KARIM, 'plan.inscrire', { empId: 1, certId: d0.emp(1)!.certs[0].id, sessionId: 1 });
  run(KARIM, 'demande.formation', { empId: 18, f: 'aipr', motif: 'Recyclage AIPR' });
  const dem = domain().ds.demandesCollab.find(r => r.empId === 18 && r.f === 'aipr')!;
  assert.equal(dem.parId, 12, 'demande émise par le manager');
  assert.equal(dem.statut, 'attente');
  forbidden(KARIM, 'demande.formation', { empId: 1, f: 'sst', motif: 'x' });
  run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  const a = domain().ds.absences.find(x => x.empId === 2 && x.du === '2026-12-07')!;
  assert.equal(a.statut, 'validee', 'posée par le manager : validée');
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-14', au: '2026-12-14' });
  assert.equal(domain().ds.absences.find(x => x.empId === 2 && x.du === '2026-12-14')!.statut, 'demandee');
  const week = '2026-10-05';
  run(KARIM, 'temps.suggest', { empId: 2, week });
  run(MEHDI, 'temps.submit', { empId: 2, week });
  run(KARIM, 'temps.setCell', { empId: 2, week, li: 0, di: 0, value: '6' });
  const sh = domain().ds.feuilles.find(f => f.empId === 2 && f.week === week)!;
  assert.equal(sh.statut, 'soumise', 'correction du valideur : reste soumise');
  assert.equal(sh.lignes[0].h[0], 6);
  forbidden(HUGO, 'temps.setCell', { empId: 2, week, li: 0, di: 0, value: '1' });
  assert.throws(() => run(MEHDI, 'temps.setCell', { empId: 2, week, li: 0, di: 1, value: '1' }), /déjà soumise/);
});

test('entretien forfait jours selon le nouveau modèle', () => {
  const { domain } = fresh();
  const d = domain();
  const o = obligations(d, d.ds.employes.map(e => e.id));
  assert.ok(o.some(x => x.id === 19 && x.kind === 'forfait'), 'forfait jours : entretien annuel L3121-64');
  assert.ok(!o.some(x => x.id === 11 && x.kind === 'forfait'), 'forfait heures : pas d’entretien forfait jours');
});

test('migration d’une base créée avec l’ancien champ « contrat »', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-'));
  const file = join(dir, 'ancienne.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT, equipe TEXT, poste TEXT, contrat TEXT, heures REAL, jour_off TEXT, entree TEXT, fin TEXT, naissance INTEGER, agence TEXT, reprise_motif TEXT, reprise_date TEXT, visite TEXT, passeport_numero TEXT, passeport_expire TEXT)`);
    old.exec(`INSERT INTO employes (nom, equipe, poste, contrat, jour_off, entree, naissance) VALUES
      ('A', 'Production', 'Responsable production', 'forfait', '[]', '2020-01-01', 1980),
      ('B', 'Production', 'Opérateur', '39h', '[]', '2020-01-01', 1990),
      ('C', 'Production', 'Technicien', 'partiel', '[2]', '2020-01-01', 1985),
      ('D', 'Administration', 'Assistante de direction', 'partiel', '[4]', '2010-09-13', 1966),
      ('E', 'Maintenance', 'Apprenti électromécanicien', 'alternance', '[]', '2025-09-01', 2006)`);
    old.close();
    const db = new Db(file);
    migrate(db);
    const rows = db.all<{ nom: string; statut: string; temps: string; typeContrat: string; forfaitJours: number | null }>('employes');
    assert.deepEqual(rows.map(r => [r.nom, r.statut, r.temps, r.typeContrat, r.forfaitJours]), [
      ['A', 'cadre', 'forfait_jours', 'cdi', 218],
      ['B', 'ouvrier', '39h_rtt', 'cdi', null],
      ['C', 'technicien', 'partiel', 'cdi', null],
      ['D', 'ouvrier', 'partiel', 'cdi', null],
      ['E', 'ouvrier', '35h', 'alternance', null],
    ]);
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
