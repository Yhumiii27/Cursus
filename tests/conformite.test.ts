// Tests : certification en vigueur après un recyclage, suspension et retrait des habilitations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { libererPlacesRemplacees, migrate } = await import('../server/src/migrate.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const ROMAIN: User = { role: 'collaborateur', empId: 18, nom: 'Romain Chevalier', intitule: '' };

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const forbidden = (user: User, name: string, payload: Record<string, unknown>) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403, `${name} devait être refusé`);
  const domain = () => new Domain(loadFull(db, RH));
  const emp = (id: number) => { const d = domain(); return d.enrich(d.ds.settings.horizonAlerte, false).find(e => e.id === id)!; };
  /** Verdict d'une ressource sur un chantier, tel que transmis à Keystone. */
  const verdict = (chantier: string, empId: number) => {
    const d = domain();
    const ch = d.evaluateChantiers(d.enrich(d.ds.settings.horizonAlerte, false), d.tripsAll()).find(x => x.c.id === chantier)!;
    return ch.res.find(r => r.e.id === empId)!;
  };
  const keystone = () => db.all<{ action: string; payload: { chantier: string; ressource?: { matricule: string; statut: string; motifs: { code: string; niveau: string }[] } } }>('journal')
    .filter(j => j.action === 'keystone.verdict.modifie');
  return { db, run, forbidden, domain, emp, verdict, keystone };
}

// — t070 : seule la dernière certification compte après un renouvellement —

test('recyclage enregistré : seule la nouvelle certification compte, l’ancienne passe en historique', () => {
  const { run, domain, emp } = fresh();
  const elecIds = (id: number) => domain().emp(id)!.certs.filter(c => c.f === 'elec').map(c => c.id);
  const holders = () => domain().enrich(90, false).flatMap(e => e.certs).filter(c => c.f === 'elec').length;
  const echElec = () => { const d = domain(); return d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'cert' && x.emp.id === 2 && x.label === d.fm('elec').court); };

  assert.equal(emp(2).worst, 'exp');
  assert.deepEqual(echElec().map(x => x.key), ['exp']);
  const avant = holders();
  const [ancienne] = elecIds(2);

  run(RH, 'cert.ajouter', { empId: 2, f: 'elec', date: '2026-10-06' });
  const mehdi = emp(2);
  const elec = mehdi.certs.filter(c => c.f === 'elec');
  assert.equal(elec.length, 1, 'une seule certification en vigueur par formation');
  assert.equal(elec[0].obtenue, '2026-10-06');
  assert.equal(elec[0].key, 'ok');
  assert.deepEqual(mehdi.anciennes.map(c => [c.id, c.f, c.remplacee?.getDate()]), [[ancienne, 'elec', 6]], 'historique : remplacée le 6 octobre');
  assert.deepEqual(echElec().map(x => x.key), ['ok'], 'plus d’échéance expirée pour cette formation');
  assert.equal(holders(), avant, 'un titulaire compté une seule fois');
  // Le prérequis de l'habilitation électrique est de nouveau satisfait : il ne reste que son échéance dépassée.
  const he = mehdi.habs.find(h => h.h === 'he')!;
  assert.ok(he.checks.every(c => c.ok));
  assert.equal(he.key, 'exp');
  run(RH, 'hab.delivrer', { empId: 2, h: 'he', date: '2026-10-10', par: 'Karim Haddad', mode: 'renew' });
  assert.equal(emp(2).worst, 'ok', 'statut calculé sur la certification en vigueur');
  // L'ancienne certification ne se planifie plus.
  assert.throws(() => run(RH, 'plan.inscrire', { empId: 2, certId: ancienne, sessionId: 5 }), /remplacée/);
});

test('recyclage enregistré : la place de la certification remplacée dans une session à venir est libérée', () => {
  const { run, domain, emp } = fresh();
  const [ancienne] = domain().emp(2)!.certs.filter(c => c.f === 'elec').map(c => c.id);
  const inscrits = () => domain().session(5)!.inscrits;
  const avant = inscrits();
  run(RH, 'plan.inscrire', { empId: 2, certId: ancienne, sessionId: 5 }); // session elec du 27 octobre
  assert.equal(inscrits(), avant + 1);

  const msg = run(RH, 'cert.ajouter', { empId: 2, f: 'elec', date: '2026-10-06' });
  assert.match(String(msg), /inscription à la session du 27 oct.* annulée/);
  assert.equal(inscrits(), avant, 'place libérée');
  assert.deepEqual(emp(2).anciennes.map(c => [c.id, c.sessionId, c.convoc]), [[ancienne, null, null]]);
});

test('migration : place de session encore tenue par une certification remplacée', () => {
  const { db, run, domain } = fresh();
  const [ancienne] = domain().emp(2)!.certs.filter(c => c.f === 'elec').map(c => c.id);
  run(RH, 'plan.inscrire', { empId: 2, certId: ancienne, sessionId: 5 });
  const inscrits = domain().session(5)!.inscrits;
  // État laissé par une version antérieure : recyclage enregistré sans libérer la place.
  db.insert('certifications', { empId: 2, f: 'elec', obtenue: '2026-10-06', sessionId: null, convoc: null });
  libererPlacesRemplacees(db, '2026-10-10');
  assert.equal(domain().session(5)!.inscrits, inscrits - 1);
  assert.equal(db.get<{ sessionId: number | null }>('certifications', ancienne)!.sessionId, null);
  libererPlacesRemplacees(db, '2026-10-10');
  assert.equal(domain().session(5)!.inscrits, inscrits - 1, 'migration rejouable sans effet');
});

// — t054 : suspension et retrait des habilitations —

test('suspension par le RH : titre non valide et No Go, puis levée', () => {
  const { db, run, emp, verdict, keystone } = fresh();
  assert.equal(verdict('K-2614', 18).status, 'go');
  const msg = run(RH, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident sur armoire électrique', date: '2026-10-09' });
  assert.match(String(msg), /suspendue — Romain Chevalier/);

  const romain = emp(18), he = romain.habs.find(h => h.h === 'he')!;
  assert.equal(he.key, 'susp');
  assert.equal(he.mesurePar, 'Sandrine Vidal');
  assert.match(he.note, /Suspendue le .* par Sandrine Vidal — Incident sur armoire électrique/);
  assert.equal(romain.worst, 'exp', 'fiche non conforme');
  const d = new Domain(loadFull(db, RH));
  const ech = d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'hab' && x.emp.id === 18 && x.label === he.hm.nom)!;
  assert.equal(ech.key, 'exp');
  assert.equal(ech.statut, 'Suspendue');
  assert.equal(ech.d, -1, 'invalide depuis la date de suspension');

  const v = verdict('K-2614', 18);
  assert.equal(v.status, 'nogo');
  assert.ok(v.reasons.some(r => r.code === 'HABILITATION_SUSPENDUE'));
  // Keystone : matricule et codes de motif, jamais le motif saisi — même en partage détaillé.
  run(RH, 'parametres.maj', { partageKeystone: 'detaille' });
  const d2 = new Domain(loadFull(db, RH));
  const ch = d2.evaluateChantiers(d2.enrich(90, false), d2.tripsAll()).find(x => x.c.id === 'K-2614')!;
  assert.doesNotMatch(JSON.stringify(d2.keystonePayload(ch, true)), /armoire/);
  const ev = keystone();
  assert.deepEqual(ev.map(e => e.payload.chantier).sort(), ['K-2611', 'K-2614'], 'un événement par chantier concerné');
  assert.ok(ev.every(e => e.payload.ressource?.matricule === 'EMP-0018' && e.payload.ressource.statut === 'NO_GO' && e.payload.ressource.motifs.some(m => m.code === 'HABILITATION_SUSPENDUE' && m.niveau === 'NO_GO')));
  assert.doesNotMatch(JSON.stringify(ev), /armoire/);

  // Une suspension en cours bloque le renouvellement : elle se lève explicitement.
  assert.throws(() => run(RH, 'hab.delivrer', { empId: 18, h: 'he', date: '2026-10-10', par: 'Karim Haddad', mode: 'renew' }), /levez d’abord la suspension/);
  run(RH, 'hab.lever', { empId: 18, h: 'he' });
  const leve = emp(18).habs.find(h => h.h === 'he')!;
  assert.equal(leve.key, 'ok', 'valide de nouveau');
  assert.equal(leve.mesure, null);
  assert.equal(verdict('K-2614', 18).status, 'go');
  assert.equal(keystone().length, 4, 'retour au Go signalé à Keystone');
  assert.throws(() => run(RH, 'hab.lever', { empId: 18, h: 'he' }), /n’est pas suspendue/);
});

test('suspension par le manager : membres de son équipe uniquement, levée réservée au RH', () => {
  const { run, forbidden, emp, db } = fresh();
  forbidden(HUGO, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident', date: '2026-10-10' }); // autre équipe
  forbidden(KARIM, 'hab.suspendre', { empId: 12, h: 'he', motif: 'Incident', date: '2026-10-10' }); // lui-même
  forbidden(ROMAIN, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident', date: '2026-10-10' }); // collaborateur
  forbidden(KARIM, 'hab.retirer', { empId: 18, h: 'he', motif: 'Incident', date: '2026-10-10' });
  forbidden(ROMAIN, 'hab.retirer', { empId: 18, h: 'he', motif: 'Incident', date: '2026-10-10' });
  assert.throws(() => run(KARIM, 'hab.suspendre', { empId: 18, h: 'he', motif: '   ', date: '2026-10-10' }), (e: unknown) => e instanceof ActionError && e.status === 400 && /Motif obligatoire/.test(e.message));
  assert.throws(() => run(KARIM, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident', date: '2026-10-11' }), /postérieure à aujourd’hui/);
  assert.throws(() => run(KARIM, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident', date: '2025-01-01' }), /antérieure à la délivrance/);
  assert.throws(() => run(KARIM, 'hab.suspendre', { empId: 24, h: 'he', motif: 'Incident' }), /ne détient pas ce titre/); // en attente de délivrance

  const msg = run(KARIM, 'hab.suspendre', { empId: 18, h: 'hauteur', motif: 'Harnais non porté sur la toiture' });
  assert.match(String(msg), /levée réservée au service RH/);
  const h = emp(18).habs.find(x => x.h === 'hauteur')!;
  assert.equal(h.key, 'susp');
  assert.equal(h.mesureDate, '2026-10-10', 'aujourd’hui par défaut');
  assert.equal(h.mesurePar, 'Karim Haddad');
  forbidden(KARIM, 'hab.lever', { empId: 18, h: 'hauteur' });
  assert.throws(() => run(KARIM, 'hab.suspendre', { empId: 18, h: 'hauteur', motif: 'Encore' }), /déjà suspendue/);
  // État visible du manager et du collaborateur concerné.
  for (const u of [KARIM, ROMAIN]) {
    const t = buildSnapshot(db, u).employes.find(e => e.id === 18)!.habs.find(x => x.h === 'hauteur')!;
    assert.equal(t.mesure, 'suspension');
    assert.equal(t.mesureMotif, 'Harnais non porté sur la toiture');
  }
});

test('retrait par le RH : définitif, nouvelle délivrance possible', () => {
  const { db, run, emp, verdict, keystone } = fresh();
  assert.throws(() => run(RH, 'hab.retirer', { empId: 18, h: 'he', motif: '' }), /Motif obligatoire/);
  run(RH, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident' });
  run(RH, 'hab.retirer', { empId: 18, h: 'he', motif: 'Faute grave de consignation', date: '2026-10-10' });
  const he = emp(18).habs.find(x => x.h === 'he')!;
  assert.equal(he.key, 'retiree');
  assert.equal(he.mesureMotif, 'Faute grave de consignation');
  assert.equal(emp(18).worst, 'exp');
  assert.ok(verdict('K-2614', 18).reasons.some(r => r.code === 'HABILITATION_RETIREE'));
  assert.equal(keystone().length, 4, 'suspension puis retrait : code de motif modifié sur les deux chantiers');
  assert.throws(() => run(RH, 'hab.suspendre', { empId: 18, h: 'he', motif: 'x' }), /déjà retirée/);
  assert.throws(() => run(RH, 'hab.lever', { empId: 18, h: 'he' }), /n’est pas suspendue/);

  // Le collaborateur peut de nouveau demander le titre ; la demande acceptée reste notée sur le titre retiré.
  run(ROMAIN, 'demande.habilitation', { h: 'he', motif: 'Reprise des interventions' });
  const demande = db.all<{ id: number; empId: number; statut: string }>('demandesCollab').find(r => r.empId === 18 && r.statut === 'attente')!;
  assert.match(String(run(RH, 'demande.accepter', { id: demande.id })), /retirée : nouvelle délivrance à effectuer/);
  const accepte = emp(18).habs.find(x => x.h === 'he')!;
  assert.deepEqual([accepte.key, accepte.demande], ['retiree', '2026-10-10']);
  assert.match(accepte.note, /Nouvelle délivrance demandée le/);
  assert.throws(() => run(ROMAIN, 'demande.habilitation', { h: 'he', motif: 'Encore' }), /une demande est déjà en cours/);

  // Une délivrance antidatée annulerait le retrait : la nouvelle délivrance lui est postérieure.
  assert.throws(() => run(RH, 'hab.delivrer', { empId: 18, h: 'he', date: '2025-03-01', par: 'Karim Haddad', mode: 'deliver' }), /antérieure au retrait du 10 oct/);
  assert.equal(emp(18).habs.find(x => x.h === 'he')!.key, 'retiree');
  const msg = run(RH, 'hab.delivrer', { empId: 18, h: 'he', date: '2026-10-10', par: 'Karim Haddad', mode: 'deliver' });
  assert.match(String(msg), /2 chantiers signalés à Keystone/);
  const neuve = emp(18).habs.find(x => x.h === 'he')!;
  assert.equal(neuve.key, 'ok');
  assert.equal(neuve.mesure, null);
  assert.equal(neuve.demande, null);
  assert.equal(verdict('K-2614', 18).status, 'go');
  // Keystone, qui avait reçu le No Go du retrait, reçoit le verdict rétabli.
  const retour = keystone().slice(4);
  assert.deepEqual(retour.map(e => e.payload.chantier).sort(), ['K-2611', 'K-2614']);
  assert.ok(retour.every(e => !e.payload.ressource!.motifs.some(m => m.code.startsWith('HABILITATION'))));
  assert.deepEqual(retour.find(e => e.payload.chantier === 'K-2614')!.payload.ressource, { matricule: 'EMP-0018', statut: 'GO', motifs: [], precedent: 'NO_GO' });
});

test('migration d’une base antérieure aux suspensions d’habilitation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-'));
  const file = join(dir, 'ancienne.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE hab_titres (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_id INTEGER, h TEXT, delivree TEXT, par TEXT, demande TEXT)`);
    old.exec(`INSERT INTO hab_titres (emp_id, h, delivree, par) VALUES (18, 'he', '2025-03-01', 'Karim Haddad')`);
    old.close();
    // Démarrage : schéma (colonnes ajoutées) puis migrations, comme server/src/index.ts.
    const db = new Db(file);
    migrate(db);
    assert.ok(['mesure', 'mesure_date', 'mesure_motif', 'mesure_par'].every(c => db.columns('habTitres').includes(c)));
    const [t] = db.all<{ id: number; h: string; mesure: string | null }>('habTitres');
    assert.deepEqual([t.h, t.mesure], ['he', null], 'titre existant sans mesure : toujours valide');
    db.update('habTitres', t.id, { mesure: 'suspension', mesureDate: '2026-10-10', mesureMotif: 'Incident', mesurePar: 'Sandrine Vidal' });
    assert.equal(db.get<{ mesure: string }>('habTitres', t.id)!.mesure, 'suspension');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
