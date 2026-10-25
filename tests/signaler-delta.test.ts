// Suivi des verdicts des actions de conformité (lot 9, chantier 3, complément au chantier 2) : `signaler`
// (server/src/actions/conformite.ts : suspension et levée d'une habilitation, avis du médecin du travail, corrections)
// dérive le jeu des verdicts et l'état d'après l'écriture du jeu de l'action et du delta de ses écritures (`jeuApres`),
// comme le suivi des autres actions, au lieu de relire toute la base. Sur une même suite d'actions, messages, réponses,
// verdicts mémorisés et envois à Keystone sont identiques avec le cache incrémental et en relecture complète
// (CURSUS_CACHE_INCREMENTAL=0) ; avec le cache incrémental, l'action ne relit plus la table des feuilles en entier.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CACHE_INCREMENTAL;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type Compte = import('../server/src/comptes.ts').Compte;

const serveurs: Server[] = [];
after(() => { for (const s of serveurs) { s.close(); s.closeAllConnections(); } });

/** Base de démonstration servie sur une boucle locale, avec une session de l'administrateur RH et un compteur des relectures complètes des feuilles. */
async function banc(): Promise<{ db: Db; post: (nom: string, p: unknown) => Promise<string>; lire: () => Promise<void>; relectures: () => number }> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  let n = 0;
  const query = db.query.bind(db);
  db.query = (async (sql: string, params?: readonly never[]) => {
    if (/^\s*SELECT \* FROM feuilles\s+ORDER BY/i.test(sql)) n++;
    return await query(sql, params);
  }) as typeof db.query;
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const compte = (await db.all<Compte>('comptes')).find(c => c.profilRh === 'rh_admin' && c.actif)!;
  const sid = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(sid), compteId: compte.id, role: 'rh', methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: new Date().toISOString() });
  const headers = { cookie: `cursus_session=${sid}.${await sign(db, sid)}`, 'x-cursus-espace': 'rh', 'content-type': 'application/json' };
  return {
    db,
    post: async (nom, p) => {
      const r = await fetch(`${base}/api/actions/${nom}`, { method: 'POST', headers, body: JSON.stringify(p) });
      const texte = await r.text();
      assert.equal(r.status, 200, texte.slice(0, 200));
      return texte;
    },
    lire: async () => { assert.equal((await fetch(`${base}/api/data`, { headers })).status, 200); },
    relectures: () => n,
  };
}

/** Réponse comparable d'un mode à l'autre : révision (horloge de la base), horodatages et UUID (clés des lots du jeu de démonstration) neutralisés. */
const neutre = (s: string) => s.replace(/"revision":\d+/g, '"revision":0').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z/g, 'T')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'U');

test('conformité : verdicts suivis par le delta de l’action, mêmes réponses et mêmes envois qu’en relecture complète', async () => {
  const suite: [string, Record<string, unknown>][] = [
    ['hab.suspendre', { empId: 18, h: 'he', motif: 'Incident sur armoire électrique', date: '2026-10-09' }],
    ['hab.lever', { empId: 18, h: 'he' }],
    ['hab.retirer', { empId: 18, h: 'he', motif: 'Titre retiré', date: '2026-10-10' }],
  ];
  const jouer = async (incremental: boolean) => {
    if (!incremental) process.env.CURSUS_CACHE_INCREMENTAL = '0';
    try {
      const b = await banc();
      const reponses: string[] = [], relectures: number[] = [];
      for (const [nom, p] of suite) {
        await b.lire();
        const avant = b.relectures();
        reponses.push(neutre(await b.post(nom, p)));
        relectures.push(b.relectures() - avant);
      }
      const verdicts = (await b.db.all<{ chantier: string; empId: number; statut: string; motifs: unknown }>('verdictsKeystone')).map(v => [v.chantier, v.empId, v.statut, v.motifs]);
      const envois = (await b.db.all<{ type: string; payload: unknown }>('envois')).map(e => neutre(JSON.stringify([e.type, e.payload])));
      return { reponses, relectures, verdicts, envois };
    } finally { delete process.env.CURSUS_CACHE_INCREMENTAL; }
  };
  const inc = await jouer(true), complet = await jouer(false);
  assert.ok(inc.reponses.some(r => /chantiers? signalés? à Keystone/.test(r)), 'verdicts signalés');
  assert.deepEqual(inc.reponses, complet.reponses, 'mêmes messages et instantanés');
  assert.deepEqual(inc.verdicts, complet.verdicts, 'mêmes verdicts mémorisés');
  assert.deepEqual(inc.envois, complet.envois, 'mêmes envois à Keystone');
  assert.deepEqual(inc.relectures, suite.map(() => 0), 'cache incrémental : aucune relecture complète des feuilles pendant l’action');
  assert.ok(complet.relectures.every(n => n > 0), 'relecture complète : la table des feuilles est relue');
});
