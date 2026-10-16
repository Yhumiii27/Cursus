// Transmission réelle à Sage Paie (SAGE_MODE=fichier, lu à chaque transmission) : contrôle bloquant qui nomme les salariés
// du lot sans matricule de paie (t021) ; une fois le matricule saisi, ce contrôle passe et le fichier porte ce matricule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.SAGE_MODE = 'fichier';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { buildSagePayload } = await import('../shared/rules/temps.ts');
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
  assert.throws(() => run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }),
    (e: unknown) => e instanceof ActionError && e.status === 400 && /Transmission refusée : 1 salarié sans matricule de paie \(Bastien Morel\)/.test(e.message));
  assert.ok(loadFull(db, ADMIN).feuilles.filter(f => f.week === '2026-10-05').every(f => !f.sage), 'rien de transmis');
  run(ADMIN, 'employe.modifier', { id: 24, matriculePaie: '004124' });
  // Matricule saisi : ce contrôle passe ; la suite (codes Sage à confirmer, fichier d'import) ne concerne plus le matricule.
  assert.throws(() => run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), (e: unknown) => e instanceof ActionError && !/matricule/.test(e.message));
  const ds = loadFull(db, ADMIN), d = new Domain(ds);
  const lignes = buildSagePayload(d, ds.feuilles.filter(f => f.week === '2026-10-05' && [2, 24].includes(f.empId)), 'TEST', new Date(), 'fichier').lignes;
  assert.ok(lignes.some(l => l.matricule === '004124') && lignes.every(l => !l.matricule.startsWith('EMP-')), 'matricules de paie seulement');
});
