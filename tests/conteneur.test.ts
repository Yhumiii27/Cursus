// Image Docker : volume /data rendu au compte du service au démarrage (server/src/conteneur.ts). Les images d'avant le
// lot 4 tournaient sous root ; leur volume, repris par une image qui tourne sous `cursus`, empêchait le démarrage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.CURSUS_CONTENEUR;
const { compteService, reprendreDossier } = await import('../server/src/conteneur.ts');

test('compte du service lu dans /etc/passwd', () => {
  const passwd = 'root:x:0:0:root:/root:/bin/bash\ncursus:x:999:998::/data:/usr/sbin/nologin\n';
  assert.deepEqual(compteService(passwd), { uid: 999, gid: 998 });
  assert.equal(compteService('root:x:0:0:root:/root:/bin/bash\n'), null);
  assert.equal(compteService('cursus:x:abc:998::/data:/usr/sbin/nologin'), null);
  assert.equal(compteService('cursusbis:x:1000:1000::/home:/bin/sh'), null, 'nom exact');
});

test('dossier des données : tout son contenu rendu au compte, liens symboliques sans les suivre, rien de plus', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-conteneur-'));
  writeFileSync(join(dir, 'cursus.db'), '');
  writeFileSync(join(dir, 'cursus.db-wal'), '');
  mkdirSync(join(dir, 'backups'));
  writeFileSync(join(dir, 'backups', 'cursus-avant-migration.db'), '');
  symlinkSync('/etc/passwd', join(dir, 'lien'));
  const chown: string[] = [], lchown: string[] = [];
  const n = reprendreDossier(dir, 4242, 4243, { chown: p => { chown.push(p); }, lchown: p => { lchown.push(p); } });
  assert.equal(n, 6);
  assert.deepEqual(chown.map(p => p.slice(dir.length)).sort(), ['', '/backups', '/backups/cursus-avant-migration.db', '/cursus.db', '/cursus.db-wal']);
  assert.deepEqual(lchown, [join(dir, 'lien')], 'le lien est repris, pas sa cible');
  // Déjà au bon compte : rien n'est touché.
  const uid = process.getuid!(), gid = process.getgid!();
  const fait: string[] = [];
  assert.equal(reprendreDossier(join(dir, 'backups'), uid, gid, { chown: p => { fait.push(p); }, lchown: p => { fait.push(p); } }), 0);
  assert.deepEqual(fait, []);
});
