// File des écritures de l'instance (lot 8, chantier E, étape 2 ; server/src/db-pg.ts, `FileEcritures`) et seuil
// « attente du verrou d'écriture » de l'essai de charge (scripts/charge/seuils.ts) :
// - la file mesure l'attente de chaque écriture avant son tour (en cours et plus longue terminée, refus compris) : sur
//   une instance, une seule écriture à la fois atteint pg_advisory_xact_lock, les autres attendent en mémoire, sans
//   connexion, et pg_stat_activity ne les voit pas ;
// - le seuil de 10 s est jugé sur la plus longue de l'attente vue sur le serveur et de l'attente dans la file.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FileEcritures } = await import('../server/src/db-pg.ts');
const { juger, statistiques } = await import('../scripts/charge/seuils.ts');
type StatSonde = import('../scripts/charge/seuils.ts').StatSonde;

const pause = (ms: number) => new Promise(ok => setTimeout(ok, ms));

test('file des écritures : attente en cours et plus longue attente terminée, refus compris', async () => {
  const file = new FileEcritures();
  assert.deepEqual([file.enAttente, file.attenteEnCours, file.attenteMax], [0, 0, 0]);
  let rendre!: () => void;
  const fin = new Promise<void>(ok => { rendre = ok; });
  const longue = file.passer(0, async () => await fin);
  // La première passe aussitôt : aucune attente.
  await pause(5);
  assert.equal(file.enAttente, 0);
  assert.ok(file.attenteMax < 20, String(file.attenteMax));
  const suivante = file.passer(0, async () => 'faite');
  await pause(120);
  assert.equal(file.enAttente, 1);
  assert.ok(file.attenteEnCours >= 100, `attente en cours : ${file.attenteEnCours}`);
  rendre();
  await longue;
  assert.equal(await suivante, 'faite');
  assert.deepEqual([file.enAttente, file.attenteEnCours], [0, 0]);
  assert.ok(file.attenteMax >= 100, `plus longue attente : ${file.attenteMax}`);
  // Refus au-delà du délai (55P03) : son attente compte aussi.
  file.attenteMax = 0;
  let rendre2!: () => void;
  const fin2 = new Promise<void>(ok => { rendre2 = ok; });
  const tenue = file.passer(0, async () => await fin2);
  await assert.rejects(file.passer(80, async () => 'jamais'), (e: { code?: string }) => e.code === '55P03');
  assert.ok(file.attenteMax >= 75, `attente refusée : ${file.attenteMax}`);
  rendre2();
  await tenue;
});

test('essai de charge : attente du verrou jugée aussi sur la file des écritures de l’instance', () => {
  const sante = statistiques([100, 200], { e4xx: 0, e5xx: 0, e503: 0, delais: 0 });
  const sonde = (attenteVerrouMax: number, attenteFileMax: number): StatSonde => ({
    sante, attenteVerrouMax, attentesMax: 0, tenueVerrouMax: 1000, attentePoolMax: 0, poolAttenteMax: 0, lecturesAttenteMax: 0,
    ecrituresAttenteMax: 20, attenteFileMax, rssMax: 0, tasMax: 0,
  });
  const verrou = (s: StatSonde, marge = 1) => juger({}, s, { marge }).find(v => v.critere === 'attente du verrou d’écriture')!;
  // Presque aucune attente Advisory sur le serveur, mais 26 s d'attente dans la file (S2 sur 5 ans) : échec.
  assert.deepEqual([verrou(sonde(40, 26_000)).ok, verrou(sonde(40, 26_000)).mesure], [false, '26.0 s']);
  assert.equal(verrou(sonde(40, 26_000), 3).ok, true, 'marge ×3 de la CI : 30 s');
  assert.equal(verrou(sonde(12_000, 0)).ok, false, 'attente sur le serveur (plusieurs instances)');
  assert.equal(verrou(sonde(40, 900)).ok, true);
});
