// Filtre facultatif de l'API Keystone par adresse (lot 8, chantier B, étape 2 ; server/src/filtre-keystone.ts) :
// CURSUS_KEYSTONE_ADRESSES lue (adresses, réseaux IPv4 et IPv6, adresses IPv4 notées en IPv6), contrôlée au démarrage,
// et appliquée par l'application (server/src/app.ts) : appel d'une autre adresse refusé (403 ADRESSE_REFUSEE) avant la
// clé, adresse du client lue derrière le proxy de confiance ; vide, aucun filtre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.KEYSTONE_API_KEY = 'cle-keystone-de-test';

const { adresseAdmise, filtreKeystone, lireAdressesKeystone, REFUS_ADRESSE } = await import('../server/src/filtre-keystone.ts');
const { problemesConfig } = await import('../server/src/config.ts');
const { createApp } = await import('../server/src/app.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const { nouvelleBase } = await import('./base.ts');

test('CURSUS_KEYSTONE_ADRESSES : adresses et réseaux IPv4 et IPv6, entrées illisibles refusées au démarrage', () => {
  assert.deepEqual(lireAdressesKeystone(undefined), { liste: null, entrees: [], invalides: [] });
  assert.equal(lireAdressesKeystone('  , ').liste, null, 'vide : aucun filtre');
  const a = lireAdressesKeystone('10.0.1.5, 10.0.2.0/24 fd00::/8,::1');
  assert.deepEqual([a.entrees, a.invalides], [['10.0.1.5', '10.0.2.0/24', 'fd00::/8', '::1'], []]);
  for (const ip of ['10.0.1.5', '::ffff:10.0.1.5', '10.0.2.200', 'fd12:3456::1', '::1']) assert.ok(adresseAdmise(a, ip), ip);
  for (const ip of ['10.0.1.6', '10.0.3.1', '203.0.113.7', '2001:db8::1', '', undefined, 'keystone']) assert.ok(!adresseAdmise(a, ip), String(ip));
  assert.ok(adresseAdmise(lireAdressesKeystone(''), '203.0.113.7'), 'sans liste : tout passe');
  // Adresse IPv4 notée en IPv6 dans la liste elle-même.
  assert.ok(adresseAdmise(lireAdressesKeystone('::ffff:10.0.1.5'), '10.0.1.5'));
  const ko = lireAdressesKeystone('10.0.0.0/33, keystone, 10.0.0.1/8/2, fd00::/129, 10.1.0.0/x, 192.168.0.1');
  assert.deepEqual(ko.invalides, ['10.0.0.0/33', 'keystone', '10.0.0.1/8/2', 'fd00::/129', '10.1.0.0/x']);
  assert.ok(adresseAdmise(ko, '192.168.0.1'), 'entrées lisibles gardées');
  assert.ok(!adresseAdmise(lireAdressesKeystone('keystone'), '10.0.0.1'), 'aucune entrée lisible : tout est refusé');
  // Contrôle de configuration : bloquant en production, comme les autres.
  const pbs = (v: string) => problemesConfig({ CURSUS_KEYSTONE_ADRESSES: v }).filter(p => /CURSUS_KEYSTONE_ADRESSES/.test(p));
  assert.deepEqual(pbs('10.0.1.0/24, fd00::/8'), []);
  assert.deepEqual(pbs('keystone'), ['CURSUS_KEYSTONE_ADRESSES : « keystone » n’est ni une adresse IP ni un réseau (10.0.1.5, 10.0.1.0/24, fd00::/8, séparés par des virgules).']);
  assert.match(pbs('keystone, 10.0.0.0/40')[0], /« keystone », « 10\.0\.0\.0\/40 » ne sont ni des adresses IP ni des réseaux/);
});

test('application : appel d’une adresse non admise refusé avant la clé ; adresse lue derrière le proxy de confiance ; santé jamais filtrée', async () => {
  const db = await nouvelleBase();
  const retablir = reglerJournaux({ format: 'json', sortie: () => {} });
  const dist = join(mkdtempSync(join(tmpdir(), 'cursus-filtre-')), 'absent');
  const ecouter = (adresses: string | undefined) => {
    const avant = process.env.CURSUS_KEYSTONE_ADRESSES;
    if (adresses === undefined) delete process.env.CURSUS_KEYSTONE_ADRESSES; else process.env.CURSUS_KEYSTONE_ADRESSES = adresses;
    try {
      const srv = createApp(db, { dist, production: false }).listen(0, '127.0.0.1');
      return new Promise<{ srv: Server; url: string }>(ok => srv.once('listening', () => ok({ srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` })));
    } finally {
      if (avant === undefined) delete process.env.CURSUS_KEYSTONE_ADRESSES; else process.env.CURSUS_KEYSTONE_ADRESSES = avant;
    }
  };
  const openapi = '/api/integrations/keystone/v1/openapi.json';
  const servis: Server[] = [];
  try {
    const sans = await ecouter(undefined);
    servis.push(sans.srv);
    assert.equal((await fetch(`${sans.url}${openapi}`)).status, 401, 'sans filtre : la clé décide');
    assert.equal((await fetch(`${sans.url}${openapi}`, { headers: { 'x-api-key': 'cle-keystone-de-test' } })).status, 200);

    // Keystone sur le réseau interne : le poste du test (127.0.0.1) n'y est pas.
    const filtre = await ecouter('10.0.1.0/24');
    servis.push(filtre.srv);
    const refus = await fetch(`${filtre.url}${openapi}`, { headers: { 'x-api-key': 'cle-keystone-de-test' } });
    assert.equal(refus.status, 403, 'refusé même avec la bonne clé');
    assert.deepEqual(await refus.json(), REFUS_ADRESSE);
    // Relayé par le proxy de confiance (boucle locale, CURSUS_TRUST_PROXY par défaut) : l'adresse est celle du client.
    const relaye = await fetch(`${filtre.url}${openapi}`, { headers: { 'x-api-key': 'cle-keystone-de-test', 'x-forwarded-for': '10.0.1.20' } });
    assert.equal(relaye.status, 200);
    assert.equal((await fetch(`${filtre.url}${openapi}`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 403);
    assert.equal((await fetch(`${filtre.url}/api/health`)).status, 200, 'point de santé hors du filtre');

    const local = await ecouter('127.0.0.1');
    servis.push(local.srv);
    assert.equal((await fetch(`${local.url}${openapi}`)).status, 401, 'adresse admise : la clé décide ensuite');
  } finally {
    for (const s of servis) s.close();
    retablir();
  }
  // Middleware seul, sans adresse de connexion connue : refusé.
  let statut = 0;
  filtreKeystone({ CURSUS_KEYSTONE_ADRESSES: '10.0.0.0/8' })({ socket: {} } as never, { status: (s: number) => { statut = s; return { json: () => {} }; } } as never, () => { statut = -1; });
  assert.equal(statut, 403);
});
