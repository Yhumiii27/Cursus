// Aides des tests du lot 10, chantier A (vues prêtes au démarrage, coalescence, mémos, corps compressés) : démonstration
// grossie de feuilles validées (dont des nuits, pour le C2P), assez pour que les vues RH dépassent le seuil des grands
// corps (server/src/vues-cache.ts, `SEUIL_CORPS_OCTETS` et `LIGNES_MEMO`), sessions de chaque compte et application
// montée sur une boucle locale.
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CurrentUser } from '../../shared/types.ts';
import { createApp, type OptionsApp } from '../../server/src/app.ts';
import { empreinteSession, sign } from '../../server/src/auth.ts';
import { type Compte, compteValide, espacesDuCompte } from '../../server/src/comptes.ts';
import { currentUser } from '../../server/src/dataset.ts';
import { comptesDemo, seedDemo } from '../../server/src/seed.ts';
import { nouvelleBase } from '../base.ts';

type Db = Awaited<ReturnType<typeof nouvelleBase>>;

/** Horaire de nuit (comme tests/c2p.test.ts) : 7,5 h de 21 h à 5 h, nuits comptées au C2P. */
const NUIT = { code: 'N', debut: '21:00', fin: '05:00', pause: 30 };

/** Lundis successifs à partir de `lundi`. */
export const lundis = (lundi: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${lundi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * i);
  return d.toISOString().slice(0, 10);
});

/**
 * Démonstration (comptes compris) grossie de feuilles validées de 2024-2026 pour quatre salariés, la moitié de nuit
 * (horaires figés), sans toucher aux semaines déjà saisies : plus de 300 feuilles, une vue RH de plus de 256 Ko.
 */
export async function grosseDemo(env: Record<string, string | undefined> = {}): Promise<Db> {
  const db = await nouvelleBase(env);
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  const prises = new Set((await db.all<{ empId: number; week: string }>('feuilles')).map(f => `${f.empId}|${f.week}`));
  await db.tx(async () => {
    for (const [i, empId] of [2, 8, 15, 3].entries()) {
      for (const week of lundis('2024-07-01', 95)) {
        if (prises.has(`${empId}|${week}`)) continue;
        const nuit = i % 2 === 1;
        await db.insert('feuilles', {
          empId, week, statut: 'validee', comment: null, sage: false, keystone: false,
          lignes: [{ projet: 'INT-PROD', tache: 'Production', ks: false, h: [7.5, 7.5, 7.5, 7.5, 7.5, 0, 0] }],
          horairesFiges: nuit ? [NUIT, NUIT, NUIT, NUIT, NUIT, null, null] : null,
        });
      }
    }
  });
  return db;
}

/** Comptes actifs dans chacun de leurs espaces, comme `currentUser` le donne à leur session. */
export async function lecteurs(db: Db): Promise<{ compte: Compte; user: CurrentUser }[]> {
  const out: { compte: Compte; user: CurrentUser }[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    if (!(await compteValide(db, c.id))) continue;
    for (const role of await espacesDuCompte(db, c)) {
      const user = await currentUser(db, { id: 'essai', compteId: c.id, role } as never);
      if (user) out.push({ compte: c, user });
    }
  }
  return out;
}

export interface Session { user: CurrentUser; cookie: string; espace: string }

/** Session ouverte en base pour `compte` dans l'espace de `user`, cookie signé comme par Cursus. */
export async function session(db: Db, compte: Compte, user: CurrentUser): Promise<Session> {
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', {
    id: empreinteSession(id), compteId: compte.id, role: user.role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(),
    expiration: new Date(Date.now() + 3600_000).toISOString(), activite: new Date().toISOString(),
  });
  return { user, cookie: `cursus_session=${id}.${await sign(db, id)}`, espace: user.role };
}

/** Application montée sur une boucle locale ; `fermer` l'arrête. */
export async function serveur(db: Db, options: OptionsApp = {}): Promise<{ base: string; fermer: () => void }> {
  const app = createApp(db, { production: false, journalRequetes: false, ...options });
  const s = await new Promise<Server>(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, fermer: () => { s.close(); s.closeAllConnections(); } };
}
