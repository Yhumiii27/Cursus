// Sessions de connexion (lot 8, chantier D) : la table connexions ne garde que l'empreinte SHA-256 de l'identifiant
// du cookie, jamais l'identifiant lui-même ; toute recherche, mise à jour ou révocation passe par l'empreinte. Une
// session enregistrée avant le lot 8 (identifiant en clair) n'ouvre plus rien : elle est fermée au déploiement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { compteDeLaRequete, empreinteSession, openSession, readSession, revokeSession, revokeSessionsDuCompte, sign, updateSession } = await import('../server/src/auth.ts');

interface Ligne { id: string; role: string; revocation: string | null }

test('connexions : seule l’empreinte de l’identifiant est stockée, le cookie se retrouve par elle', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const cookies: string[] = [];
  const res = { setHeader: (_: string, v: string) => cookies.push(v.match(/cursus_session=([^;]*)/)![1]) } as unknown as Response;
  const req = (valeur: string) => ({ headers: { cookie: `cursus_session=${valeur}` } }) as unknown as Request;
  const compteId = (await db.where<{ id: number }>('comptes', 'empId', 12))[0].id;

  const s = await openSession(db, res, { compteId, role: 'collaborateur', methode: 'local' });
  const [id] = cookies[0].split('.');
  assert.equal(s.id, id, 'la session en mémoire garde l’identifiant du cookie');
  const attendue = createHash('sha256').update(id).digest('base64url');
  assert.equal(empreinteSession(id), attendue);
  const lignes = await db.all<Ligne>('connexions');
  assert.deepEqual(lignes.map(l => l.id), [attendue], 'empreinte SHA-256 en base');
  assert.ok(!lignes.some(l => l.id === id), 'identifiant du cookie jamais en base');

  // Lecture, compte de la requête et changement d'espace : par l'empreinte.
  assert.equal((await readSession(db, req(cookies[0])))?.compteId, compteId);
  assert.equal(await compteDeLaRequete(db, req(cookies[0])), compteId);
  await updateSession(db, { ...s, role: 'manager' });
  assert.equal((await db.get<Ligne>('connexions', attendue))!.role, 'manager');

  // Une ligne dont la clé est l'identifiant en clair (format d'avant le lot 8) n'ouvre rien, même bien signée.
  const ancien = 'identifiant-de-session-en-clair';
  await db.insert('connexions', { id: ancien, compteId, role: 'collaborateur', methode: 'local', creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(await readSession(db, req(`${ancien}.${await sign(db, ancien)}`)), null);
  assert.equal(await compteDeLaRequete(db, req(`${ancien}.${await sign(db, ancien)}`)), null);
  // Un lecteur de la table ne peut pas rejouer la clé stockée comme cookie, même signée (clé de signature connue).
  assert.equal(await readSession(db, req(`${attendue}.${await sign(db, attendue)}`)), null);

  // Révocation d'une session, puis des autres sessions du compte sauf celle désignée par son identifiant de cookie.
  const s2 = await openSession(db, res, { compteId, role: 'collaborateur', methode: 'local' });
  const s3 = await openSession(db, res, { compteId, role: 'collaborateur', methode: 'local' });
  await revokeSession(db, s2.id!);
  assert.ok((await db.get<Ligne>('connexions', empreinteSession(s2.id!)))!.revocation, 'révoquée par son identifiant');
  // Restent ouvertes : la première session et l'ancienne ligne ; celle désignée par `sauf` est gardée.
  assert.equal(await revokeSessionsDuCompte(db, compteId, s3.id), 2);
  assert.equal((await db.get<Ligne>('connexions', empreinteSession(s3.id!)))!.revocation, null, 'session gardée');
  assert.ok(await readSession(db, req(cookies[2])), 'la session gardée reste ouverte');
  assert.equal(await readSession(db, req(cookies[0])), null);
});
