// Grands corps en octets, lignes sérialisées une fois et corps compressés gardés avec la vue (lot 10, chantier A ;
// server/src/vues-cache.ts, server/src/corps-compresses.ts) :
// - le corps en octets d'une vue, tête recollée, est octet pour octet Buffer.from(JSON.stringify({ ...vue, ...tete }))
//   (grands tableaux avec trous, undefined, null, objets à toJSON, caractères hors Latin-1, tête placée ou absente) ;
//   `corpsAvecTete` rend le même texte ;
// - une ligne partagée par deux vues n'est sérialisée qu'une fois ;
// - GET /api/data d'une grande vue : brotli gardé avec la vue (une seule compression pour deux requêtes de la même
//   tête), gzip pour un client sans brotli, corps tel quel sans Accept-Encoding ; décompressé, égal au corps lu sans
//   cache ; CURSUS_CORPS_COMPRESSES=0 et compression coupée : même corps.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CORPS_COMPRESSES;

const { grosseDemo, lecteurs, serveur, session } = await import('./support/vues-lot10.ts');
const vc = await import('../server/src/vues-cache.ts');
const { corpsAvecTete, corpsEnOctets, grandCorps, JsonBrut, LIGNES, LIGNES_MEMO, SEUIL_CORPS_OCTETS } = vc;
const cc = await import('../server/src/corps-compresses.ts');
type Session = import('./support/vues-lot10.ts').Session;

const fermetures: (() => void)[] = [];
after(() => { for (const f of fermetures) f(); });

test('corps en octets : JSON.stringify({ ...vue, ...tete }) octet pour octet, grands tableaux compris', () => {
  const creux: unknown[] = [];
  creux.length = LIGNES_MEMO + 3; // tableau creux : trous sérialisés « null »
  creux[0] = { a: 1 };
  creux[5] = undefined;
  creux[6] = null;
  creux[7] = () => 1;
  creux[8] = new Date('2026-10-10T08:00:00Z');
  creux[9] = [1, [2, undefined], { b: 'l’été — ✓ 🚀' }];
  creux[10] = 'texte';
  creux[11] = '\ud800';
  const lignes = Array.from({ length: LIGNES_MEMO * 2 }, (_, i) => ({ id: i, nom: `Ligne ${i} — l’essai`, h: [i, 0.5, null], vide: undefined }));
  const cas: [object, Record<string, unknown>][] = [
    [{ user: { nom: 'A' }, revision: 1, feuilles: lignes, creux, petit: [1, 2], conservation: [] }, { user: { nom: 'B' }, revision: 7 }],
    [{ feuilles: lignes, user: null }, { user: { nom: 'C' }, revision: 2, agendaJeton: null }],
    [{ feuilles: lignes, absences: lignes.slice(0, 10), texte: 'x'.repeat(SEUIL_CORPS_OCTETS) }, {}],
  ];
  for (const [i, [vue, tete]] of cas.entries()) {
    const cle = `rh|essai${i}`;
    assert.equal(grandCorps(vue, cle), true, `cas ${i} : grand corps`);
    const attendu = JSON.stringify({ ...vue, ...tete });
    assert.ok(corpsEnOctets(vue, cle, tete).equals(Buffer.from(attendu, 'utf8')), `cas ${i} : octets`);
    assert.equal(corpsAvecTete(vue, cle, tete).json, attendu, `cas ${i} : texte`);
    // Seconde tête sur le même corps.
    assert.ok(corpsEnOctets(vue, cle, { user: { nom: 'D' } }).equals(Buffer.from(JSON.stringify({ ...vue, user: { nom: 'D' } }))), `cas ${i} : autre tête`);
  }
  assert.equal(grandCorps({ petit: [1, 2, 3] }, 'rh|petit'), false, 'petit corps : en texte');
  assert.throws(() => corpsEnOctets(cas[0][0], 'rh|autre', {}), /demandé pour la clé rh\|autre/);
  assert.throws(() => corpsEnOctets(cas[0][0], 'rh|essai0', { feuilles: [] }), /hors de la tête/);
  // Lignes partagées par une autre vue : reprises, pas resérialisées.
  const avant = { ...LIGNES };
  const autre = { feuilles: lignes };
  assert.ok(corpsEnOctets(autre, 'rh|autre-vue', {}).equals(Buffer.from(JSON.stringify(autre))));
  assert.equal(LIGNES.serialisees - avant.serialisees, 0, 'aucune ligne resérialisée');
  assert.equal(LIGNES.reprises - avant.reprises, lignes.length);
  assert.ok(new JsonBrut('{}'));
});

/** GET /api/data de la session, encodage demandé ; corps décompressé et en-têtes. */
async function lire(base: string, s: Session, encodage?: string) {
  const r = await fetch(`${base}/api/data`, { headers: { cookie: s.cookie, 'x-cursus-espace': s.espace, ...(encodage !== undefined ? { 'accept-encoding': encodage } : {}) } });
  assert.equal(r.status, 200);
  const octets = Buffer.from(await r.arrayBuffer());
  return { encodage: r.headers.get('content-encoding'), type: r.headers.get('content-type'), vary: r.headers.get('vary'), octets };
}

/** Lecture brute (node:http, sans décompression automatique) : fetch décompresse toujours ce qu'il reçoit. */
async function lireBrut(base: string, s: Session, encodage: string | null) {
  const http = await import('node:http');
  return await new Promise<{ encodage: string | undefined; texte: string }>((ok, ko) => {
    const req = http.request(`${base}/api/data`, { headers: { cookie: s.cookie, 'x-cursus-espace': s.espace, ...(encodage ? { 'accept-encoding': encodage } : {}) } }, res => {
      const m: Buffer[] = [];
      res.on('data', (x: Buffer) => m.push(x));
      res.on('end', () => {
        const brut = Buffer.concat(m), enc = res.headers['content-encoding'];
        const texte = (enc === 'br' ? brotliDecompressSync(brut) : enc === 'gzip' ? gunzipSync(brut) : brut).toString('utf8');
        ok({ encodage: enc, texte });
      });
    });
    req.on('error', ko);
    req.end();
  });
}

const sansRevision = (corps: string) => corps.replace(/"revision":\d+/g, '"revision":0');

test('HTTP : grande vue envoyée compressée telle que gardée, gzip sans brotli, telle quelle sans encodage, égale au corps sans cache', async () => {
  const db = await grosseDemo();
  const { base, fermer } = await serveur(db, { compression: true });
  fermetures.push(fermer);
  const sessions: Session[] = [];
  for (const { compte, user } of await lecteurs(db)) if (user.role === 'rh') sessions.push(await session(db, compte, user));
  const admin = sessions.find(s => s.user.profilRh === 'rh_admin')!;
  assert.ok(admin);
  // Référence : corps lu sans cache (sérialisé pour la requête, compressé par le module de compression).
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  let reference: string;
  try {
    reference = (await lireBrut(base, admin, 'br')).texte;
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
  assert.ok(reference.length >= SEUIL_CORPS_OCTETS, 'vue RH assez grande');
  const n0 = cc.compressionsFaites;
  const br = await lireBrut(base, admin, 'gzip;q=0.5, br');
  assert.equal(br.encodage, 'br');
  assert.equal(sansRevision(br.texte), sansRevision(reference), 'brotli : corps identique');
  assert.equal(cc.compressionsFaites - n0, 1, 'une compression');
  const encore = await lire(base, admin, 'br');
  assert.equal(encore.encodage, 'br');
  assert.equal(encore.type, 'application/json; charset=utf-8');
  assert.match(encore.vary ?? '', /Accept-Encoding/i);
  assert.equal(cc.compressionsFaites - n0, 1, 'seconde requête de la même tête : corps gardé');
  const gz = await lireBrut(base, admin, 'gzip');
  assert.equal(gz.encodage, 'gzip');
  assert.equal(sansRevision(gz.texte), sansRevision(reference), 'gzip : corps identique');
  const brut = await lireBrut(base, admin, null);
  assert.equal(brut.encodage, undefined, 'sans Accept-Encoding : corps tel quel');
  assert.equal(sansRevision(brut.texte), sansRevision(reference));
  const refuse = await lireBrut(base, admin, 'br;q=0, gzip;q=0');
  assert.equal(refuse.encodage, undefined);
  // Chaque profil RH : corps identique à celui lu sans cache.
  for (const s of sessions) {
    const servi = await lireBrut(base, s, 'br');
    process.env.CURSUS_CACHE_INSTANTANE = '0';
    try {
      assert.equal(sansRevision(servi.texte), sansRevision((await lireBrut(base, s, 'br')).texte), `profil ${s.user.profilRh}`);
    } finally {
      delete process.env.CURSUS_CACHE_INSTANTANE;
    }
  }
  // Cache des corps compressés coupé : compression par le module, même corps.
  process.env.CURSUS_CORPS_COMPRESSES = '0';
  try {
    const n1 = cc.compressionsFaites;
    const x = await lireBrut(base, admin, 'br');
    assert.equal(x.encodage, 'br');
    assert.equal(sansRevision(x.texte), sansRevision(reference));
    assert.equal(cc.compressionsFaites, n1, 'aucun corps gardé');
  } finally {
    delete process.env.CURSUS_CORPS_COMPRESSES;
  }
  // Compression coupée (CURSUS_COMPRESSION=0) : corps en octets, sans encodage.
  const sansCompression = await serveur(db, { compression: false });
  fermetures.push(sansCompression.fermer);
  const y = await lireBrut(sansCompression.base, admin, 'br');
  assert.equal(y.encodage, undefined);
  assert.equal(sansRevision(y.texte), sansRevision(reference));
});

test('corps compressé : clé par tête et par encodage, place limitée, compression en échec non gardée', async () => {
  const vue = {};
  let n = 0;
  const corps = () => { n++; return Buffer.from(JSON.stringify({ x: 'y'.repeat(2000) })); };
  const a = await cc.corpsCompresse(vue, { user: 1 }, corps, 'br');
  assert.equal(await cc.corpsCompresse(vue, { user: 1 }, corps, 'br'), a);
  assert.equal(n, 1, 'même tête : corps assemblé une fois');
  assert.notEqual(await cc.corpsCompresse(vue, { user: 2 }, corps, 'br'), a, 'autre tête');
  assert.notEqual(await cc.corpsCompresse(vue, { user: 1 }, corps, 'gzip'), a, 'autre encodage');
  assert.equal(brotliDecompressSync(a).toString(), corps().toString());
  for (let i = 0; i < cc.CORPS_PAR_VUE + 2; i++) await cc.corpsCompresse(vue, { user: 100 + i }, corps, 'br');
  const avant = n;
  await cc.corpsCompresse(vue, { user: 1 }, corps, 'br');
  assert.equal(n, avant + 1, 'la plus ancienne a cédé sa place');
  await assert.rejects(cc.corpsCompresse(vue, { user: 'échec' }, () => { throw new Error('assemblage'); }, 'br'), /assemblage/);
  assert.equal(cc.corpsCompressesActifs({ CURSUS_CORPS_COMPRESSES: '0' }), false);
  assert.equal(cc.corpsCompressesActifs({}), true);
});
