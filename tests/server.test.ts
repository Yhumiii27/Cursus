// Tests serveur : périmètre des données par rôle et contrôles d'accès des actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
type User = Parameters<typeof buildSnapshot>[1];

const db = new Db(':memory:');
await seedDemo(db);
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const MGR: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const COLLAB: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };

async function run(user: User, name: string, payload: Record<string, unknown>) {
  return await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
}
async function expectForbidden(user: User, name: string, payload: Record<string, unknown>) {
  await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403);
}

test('manager : son équipe uniquement, sans données de santé', async () => {
  const s = await buildSnapshot(db, MGR);
  assert.deepEqual(s.employes.map(e => e.id).sort((a, b) => a - b), [2, 6, 12, 18, 24]);
  const mehdi = s.employes.find(e => e.id === 2)!;
  assert.equal(mehdi.visite, null);
  assert.equal(typeof mehdi.aptitude?.ok, 'boolean');
  assert.deepEqual(mehdi.vaccins, []);
  assert.ok(s.employes.find(e => e.id === 12)!.visite, 'ses propres données restent complètes');
  // Passeport d'un membre : la date d'expiration seule (l'écran n'affiche qu'elle) ; les visas restent transmis.
  const complet = (await loadFull(db, RH)).employes.find(e => e.id === 2)!;
  assert.ok(complet.passeport?.numero, 'le service RH a le numéro');
  assert.deepEqual(mehdi.passeport, { expire: complet.passeport!.expire });
  assert.ok(!JSON.stringify(s).includes(complet.passeport!.numero!), 'le numéro ne figure nulle part dans les données du manager');
  for (const e of s.employes.filter(x => x.id !== 12)) {
    assert.equal(e.passeport?.numero, undefined, `numéro de passeport de ${e.nom} non transmis`);
    assert.deepEqual(e.visas, (await loadFull(db, RH)).employes.find(x => x.id === e.id)!.visas, 'visas affichés volontairement');
  }
  assert.equal(s.employes.find(e => e.id === 12)!.passeport?.numero, '16AE···58', 'son propre passeport reste complet');
  // Motif d'un report de CP (texte libre, « arrêt de travail »…) : au service RH et à l'intéressé seulement.
  const motifs = async (u: User) => (await buildSnapshot(db, u)).reports.filter(r => r.empId === 6).map(r => r.motif);
  assert.ok((await motifs(RH)).some(m => /arrêt de travail/.test(m)), 'jeu de démonstration : report de CP motivé par un arrêt');
  const membres = s.reports.filter(r => r.empId !== 12);
  assert.ok(membres.some(r => r.empId === 6) && membres.every(r => r.motif === ''), 'motif du report d’un membre non transmis');
  assert.deepEqual(await motifs({ role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: '' }), await motifs(RH), 'l’intéressé garde le motif');
  assert.equal(s.plan.length, 0);
  assert.equal(s.demandesKeystone.length, 0);
  assert.ok(s.voyages.filter(v => v.empId !== 12).every(v => v.dossierStatut));
});

test('collaborateur : ses propres données uniquement', async () => {
  const s = await buildSnapshot(db, COLLAB);
  assert.deepEqual(s.employes.map(e => e.id), [2]);
  assert.ok(s.absences.every(a => a.empId === 2));
  assert.ok(s.feuilles.every(f => f.empId === 2));
  assert.equal(s.annuaire.length, 24, 'annuaire (noms, équipes) visible');
});

test('droits des actions', async () => {
  await expectForbidden(COLLAB, 'hab.delivrer', { empId: 2, h: 'he', date: '2026-10-07', par: 'X' });
  await expectForbidden(MGR, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-10-01' });
  await expectForbidden(COLLAB, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  await expectForbidden(MGR, 'temps.validate', { empId: 3, week: '2026-09-28' }); // hors équipe
});

test('habilitation refusée si les prérequis manquent', async () => {
  await assert.rejects(async () => await run(RH, 'hab.delivrer', { empId: 2, h: 'he', date: '2026-10-07', par: 'Karim Haddad', mode: 'renew' }), /Délivrance impossible/);
});

test('circuit d’une absence : demande, décision du manager, transmission', async () => {
  const msg = await run(COLLAB, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  assert.match(String(msg), /Karim Haddad/);
  const a = (await loadFull(db, RH)).absences.find(x => x.empId === 2 && x.du === '2026-12-07')!;
  assert.equal(a.statut, 'demandee');
  await run(MGR, 'absence.decider', { id: a.id, ok: true });
  assert.equal((await loadFull(db, RH)).absences.find(x => x.id === a.id)!.statut, 'validee');
});

test('feuille de temps : saisie, soumission, validation, paie', async () => {
  const week = '2026-10-05';
  await run(COLLAB, 'temps.suggest', { empId: 2, week });
  await run(COLLAB, 'temps.setCell', { empId: 2, week, li: 0, di: 0, value: '9,5' });
  let sh = (await loadFull(db, RH)).feuilles.find(f => f.empId === 2 && f.week === week)!;
  assert.equal(sh.lignes[0].h[0], 9.5);
  await run(COLLAB, 'temps.submit', { empId: 2, week });
  await assert.rejects(async () => await run(COLLAB, 'temps.setCell', { empId: 2, week, li: 0, di: 1, value: '1' }), /déjà soumise/);
  await run(MGR, 'temps.validate', { empId: 2, week });
  sh = (await loadFull(db, RH)).feuilles.find(f => f.id === sh.id)!;
  assert.equal(sh.statut, 'validee');
  await run(RH, 'temps.pushSage', {});
  assert.ok((await loadFull(db, RH)).feuilles.find(f => f.id === sh.id)!.sage);
  // Matricule du dossier de paie de Mehdi Benali (t021), et non plus le matricule Cursus EMP-0002.
  const lot = (await db.all<{ contenu: { lignes: { matricule: string }[] } }>('lotsPaie')).at(-1)!;
  assert.ok(lot.contenu.lignes.some(l => l.matricule === '004102'));
});
