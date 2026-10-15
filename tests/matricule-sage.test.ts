// Transmission réelle à Sage Paie (SAGE_URL définie, lue au chargement de l'adaptateur) : contrôle bloquant qui nomme les
// salariés du lot sans matricule de paie (t021) ; une fois le matricule saisi, la transmission part sous ce matricule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.SAGE_URL = 'http://sage.essai';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
type User = Parameters<typeof loadFull>[1];

const PAIE: User = { role: 'rh', empId: null, nom: 'Aïcha Diallo', intitule: '', profilRh: 'paie' };
const ADMIN: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '', profilRh: 'rh_admin' };

test('t021 transmission réelle : refusée tant qu’un salarié du lot n’a pas de matricule de paie', () => {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p));
  for (const empId of [2, 24]) {
    db.insert('feuilles', { empId, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7] }], contrat: null });
  }
  assert.throws(() => run(PAIE, 'temps.pushSage', {}),
    (e: unknown) => e instanceof ActionError && e.status === 400 && /Transmission refusée : 1 salarié sans matricule de paie \(Bastien Morel\)/.test(e.message));
  assert.ok(loadFull(db, ADMIN).feuilles.filter(f => f.week === '2026-10-05').every(f => !f.sage), 'rien de transmis');
  run(ADMIN, 'employe.modifier', { id: 24, matriculePaie: '004124' });
  assert.match(String(run(PAIE, 'temps.pushSage', {})), /feuilles transmises à Sage Paie — accusé de réception reçu$/);
  const lignes = loadFull(db, ADMIN).lastSagePush!.lignes;
  assert.ok(lignes.some(l => l.matricule === '004124') && lignes.every(l => !l.matricule.startsWith('EMP-')), 'matricules de paie seulement');
});
