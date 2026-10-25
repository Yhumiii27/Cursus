// npm run charge -- --scenario S3 --duree 120 [--jeu <schéma>] [--marge 3] [--lot 200] : essai de charge sur un jeu
// généré par npm run charge:generer (lot 8, chantier E ; méthode et résultats : docs/ARCHITECTURE.md, « Performances »).
// L'application (createApp) est montée dans ce processus, sur un port libre de la boucle locale, sur le schéma jetable du
// jeu (serveur de test de CURSUS_TEST_DATABASE_URL, serveur commun refusé). Des utilisateurs simulés (sessions ouvertes
// en base, cookie signé comme par Cursus) enchaînent leurs requêtes avec un temps de réflexion ; chaque requête est
// chronométrée par route (p50, p95, p99, maximum, erreurs). Toutes les 500 ms, une sonde relève /api/health, l'attente et
// la tenue du verrou d'écriture sur le serveur (pg_locks, pg_stat_activity), le pool de connexions et la mémoire.
// Rapport JSON et Markdown dans data/charge/rapports/<horodatage>-<scénarios>/, verdicts des seuils (scripts/charge/seuils.ts).
// Scénarios (plusieurs : --scenario S1,S3 ; joués l'un après l'autre) :
//   S1 « matinée » : 22 collaborateurs, 6 managers et 2 RH lisent leurs données au retour sur l'onglet ;
//   S2 « vendredi après-midi » : 30 collaborateurs saisissent leur semaine (5 à 15 cellules, une ligne), puis la soumettent ;
//   S3 « fin de mois » : 6 managers valident ensemble 15 à 30 feuilles soumises (intérimaires compris), pendant que
//      20 collaborateurs consultent, que Keystone appelle une fois par minute et que les tâches du quart d'heure tournent ;
//   S4 « paie » : lot du mois, fichier d'import Sage, variables, puis annulation du lot (l'essai reste rejouable), sur fond de S1 ;
//   S5 « exports » : CSV du journal (100 000 lignes), données personnelles (RH et intéressé), 50 flux d'agenda, sur fond de S1 ;
//   S6 « tâches de fond » : conservation du journal (décalée de --decalage jours, 30 par défaut), relances, évaluations,
//      tâches du quart d'heure, sur fond de S1.
// --verifier-exactitude [k] (lot 9, chantier 4 ; scripts/charge/verifier.ts) : toutes les k actions validées (50 par
// défaut), et à la fin de chaque scénario, les écritures de l'essai (actions, Keystone, tâches) sont retenues à une porte le
// temps de comparer l'entrée du cache, la vue et le jeu d'action de 30 collaborateurs, 8 managers et de chaque profil RH à
// la relecture complète ; invariant « 0 divergence » (scripts/charge/seuils.ts). Les durées relevées ne comptent pas
// l'attente à la porte. Relevés du cache : relectures complètes (lectures de toute la table des feuilles hors
// comparaison), taille de la table `changements` quand elle existe, et, quand le cache les expose
// (`statistiquesCache` de server/src/cache-instantane.ts), durée du delta, vues reportées ou recalculées, replis.
// Chaque scénario remet d'abord en place ce qu'il consomme : feuilles soumises de la fin de mois (S3), semaine en cours
// en brouillon (S2), lot ouvert de la période annulé (S4). La conservation (S6) supprime, elle, des lignes du journal : le
// jeu s'en trouve allégé pour les essais suivants (regénérer au besoin).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import {
  aleatoire, DOSSIER_CHARGE, entier, horodatage, type JeuCharge, lancer, lireArguments, lireJeu, RefusCharge, refuserServeurCommun, urlAdministration, urlBase,
} from './commun.ts';
import { juger, statistiques, type StatRoute, type StatSonde, type Verdict } from './seuils.ts';
import type { BilanExactitude, Divergence } from './verifier.ts';

const args = lireArguments();
const jeu: JeuCharge = lireJeu(args.get('jeu') || undefined);
// Environnement de l'application avant tout import du serveur (lu au chargement des modules) : date figée du jeu, clé de
// session et clé Keystone tirées pour l'essai, ni démonstration ni envoi réel (la file d'envoi n'est pas démarrée).
process.env.CURSUS_TODAY = jeu.aujourdhui;
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
process.env.KEYSTONE_API_KEY = randomBytes(24).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.DATABASE_URL;
process.env.CURSUS_LOG_FORMAT ??= 'texte';

const { ouvrirPostgres } = await import('../../server/src/db-pg.ts');
const { createApp } = await import('../../server/src/app.ts');
const { empreinteSession, sign } = await import('../../server/src/auth.ts');
const { tachesEmails } = await import('../../server/src/notifications.ts');
const { appliquerConservation } = await import('../../server/src/journal.ts');
const { relancerEcheances } = await import('../../server/src/relances.ts');
const { demanderEvaluations } = await import('../../server/src/evaluations-formation.ts');
const { lecteursDe, Porte, verifierExactitude } = await import('./verifier.ts');
const moduleCache = await import('../../server/src/cache-instantane.ts') as Record<string, unknown>;

type Role = 'rh' | 'manager' | 'collaborateur';
interface Utilisateur { nom: string; role: Role; compteId: number; empId: number | null; cookie: string }
interface Mesures { durees: number[]; e4xx: number; e5xx: number; e503: number; delais: number }

const SCENARIOS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;
type Scenario = typeof SCENARIOS[number];
const LIBELLES: Record<Scenario, string> = {
  S1: 'matinée', S2: 'vendredi après-midi', S3: 'fin de mois', S4: 'paie', S5: 'exports', S6: 'tâches de fond',
};

async function executer(): Promise<void> {
  const scenarios = (args.get('scenario') ?? 'S1').split(',').map(s => s.trim().toUpperCase());
  for (const s of scenarios) if (!(SCENARIOS as readonly string[]).includes(s)) throw new RefusCharge(`scénario inconnu : ${s} (S1 à S6)`);
  const duree = entier(args, 'duree', 120) * 1000;
  const marge = Number(args.get('marge') ?? 1);
  if (!(marge >= 1)) throw new RefusCharge('--marge : nombre au moins égal à 1');
  const lotGrand = args.has('lot') ? entier(args, 'lot', 200) : null;
  const decalage = entier(args, 'decalage', 30);
  // Comparaison à la relecture complète toutes les `k` actions validées (option sans valeur : 50).
  const exactitude = args.has('verifier-exactitude') ? (args.get('verifier-exactitude') ? entier(args, 'verifier-exactitude', 50) : 50) : null;
  const r = aleatoire(jeu.graine);

  const url = urlBase(urlAdministration(), jeu.base);
  const sonde = new pg.Client({ connectionString: url, application_name: 'cursus-charge-sonde' });
  await sonde.connect();
  await refuserServeurCommun(sonde);
  const db = await ouvrirPostgres(url, { schema: jeu.schema, env: process.env });
  // Relectures complètes : toute lecture de la table des feuilles sans condition (`loadFull`, repli d'un cache
  // incrémental), hors des comparaisons de --verifier-exactitude, qui relisent tout par construction.
  const cache = { relectures: 0, enComparaison: false };
  const query = db.query.bind(db);
  db.query = (async (sql: string, params?: readonly never[]) => {
    if (!cache.enComparaison && /^\s*SELECT \* FROM feuilles\s+ORDER BY/i.test(sql)) cache.relectures++;
    return await query(sql, params);
  }) as typeof db.query;
  const app = createApp(db, { journalRequetes: false, production: false });
  const serveur = app.listen(0, '127.0.0.1');
  await new Promise<void>((ok, ko) => { serveur.once('listening', () => ok()); serveur.once('error', ko); });
  // Connexions gardées plus longtemps que les temps de réflexion : sinon le serveur ferme une connexion au repos au
  // moment même où le client la reprend (« fetch failed »), ce qui fausserait les erreurs relevées.
  serveur.keepAliveTimeout = 65_000;
  const port = (serveur.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const dossier = join(DOSSIER_CHARGE, 'rapports', `${horodatage()}-${scenarios.join('-')}`);
  console.log(`Essai de charge — jeu ${jeu.schema} (${jeu.ans} an${jeu.ans > 1 ? 's' : ''}), application sur ${base}, ${scenarios.map(s => `${s} « ${LIBELLES[s as Scenario]} »`).join(', ')}, ${duree / 1000} s chacun`);

  // — Sessions : ouvertes en base, cookie signé par la clé de l'essai —
  const ouvrir = async (nom: string, role: Role, compteId: number, empId: number | null): Promise<Utilisateur> => {
    const id = randomBytes(32).toString('base64url');
    const maintenant = new Date();
    // Table `connexions` : empreinte de l'identifiant seulement (lot 8, chantier D), comme `ouvrirSession`.
    await db.insert('connexions', {
      id: empreinteSession(id), compteId, role, methode: 'local', demoComptes: {}, creation: maintenant.toISOString(), expiration: new Date(maintenant.getTime() + 12 * 3600_000).toISOString(), activite: null,
    });
    return { nom, role, compteId, empId, cookie: `cursus_session=${id}.${await sign(db, id)}` };
  };
  const collaborateurs: Utilisateur[] = [];
  for (const c of jeu.collaborateurs.slice(0, 30)) collaborateurs.push(await ouvrir(`collaborateur ${c.empId}`, 'collaborateur', c.compteId, c.empId));
  const managers: (Utilisateur & { equipe: string })[] = [];
  for (const m of jeu.managers) managers.push({ ...await ouvrir(`manager ${m.equipe}`, 'manager', m.compteId, m.empId), equipe: m.equipe });
  const rhs: Utilisateur[] = [];
  for (const id of jeu.rh.slice(0, 2)) rhs.push(await ouvrir(`RH ${id}`, 'rh', id, null));
  const paie = jeu.paie.length ? await ouvrir('paie', 'rh', jeu.paie[0], null) : rhs[0];

  // — Mesures —
  const mesures = new Map<string, Mesures>();
  const noter = (nom: string, ms: number, statut: number | 'delai') => {
    let m = mesures.get(nom);
    if (!m) mesures.set(nom, m = { durees: [], e4xx: 0, e5xx: 0, e503: 0, delais: 0 });
    m.durees.push(ms);
    if (statut === 'delai') m.delais++;
    else if (statut >= 500) { m.e5xx++; if (statut === 503) m.e503++; } else if (statut >= 400) m.e4xx++;
  };
  const erreurs: string[] = [];
  /** Requête chronométrée sous le nom `nom` ; réponse JSON lue si c'en est une. */
  const appel = async (u: Utilisateur | null, nom: string, chemin: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; delai?: number } = {}) => {
    const t = performance.now();
    try {
      const res = await fetch(`${base}${chemin}`, {
        method: init.method ?? 'GET',
        headers: { ...(u ? { cookie: u.cookie, 'x-cursus-espace': u.role } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.delai ?? 180_000),
      });
      const texte = await res.text();
      noter(nom, performance.now() - t, res.status);
      let corps: any = null;
      if ((res.headers.get('content-type') ?? '').includes('application/json')) { try { corps = JSON.parse(texte); } catch { /* corps tronqué */ } }
      if (res.status >= 400 && erreurs.length < 200) erreurs.push(`${nom} → ${res.status}${corps?.error ? ` : ${String(corps.error).slice(0, 200)}` : ''}`);
      return { statut: res.status, corps, octets: texte.length };
    } catch (err) {
      noter(nom, performance.now() - t, 'delai');
      if (erreurs.length < 200) erreurs.push(`${nom} → sans réponse (${err instanceof Error ? err.message : err})`);
      return { statut: 0, corps: null, octets: 0 };
    }
  };
  // — Exactitude : porte des écritures de l'essai, comparaisons toutes les `exactitude` actions validées —
  const porte = new Porte();
  const bilans: BilanExactitude[] = [];
  let lecteurs: Awaited<ReturnType<typeof lecteursDe>> = [];
  if (exactitude) {
    const collab = new Set(jeu.collaborateurs.slice(0, 30).map(c => c.compteId)), mgr = new Set(jeu.managers.map(m => m.compteId));
    lecteurs = await lecteursDe(db, (c, espace) => (espace === 'collaborateur' && collab.has(c.id)) || (espace === 'manager' && mgr.has(c.id)));
  }
  let validees = 0;
  let comparaison: Promise<void> | null = null;
  /** Comparaison porte fermée : les écritures en cours finissent, les suivantes attendent la fin de la comparaison. */
  const comparer = async () => {
    await porte.fermer();
    cache.enComparaison = true;
    try {
      bilans.push(await verifierExactitude(db, lecteurs));
    } catch (err) {
      erreurs.push(`comparaison à la relecture complète → ${err instanceof Error ? err.message : err}`);
    } finally {
      cache.enComparaison = false;
      porte.ouvrir();
    }
  };
  /** Écriture de l'essai : passe la porte quand --verifier-exactitude est demandé. */
  const ecriture = async <T>(fn: () => Promise<T>): Promise<T> => (exactitude ? await porte.passer(fn) : await fn());
  const action = async (u: Utilisateur, nom: string, p: unknown, libelle = `POST ${nom}`) => {
    const res = await ecriture(async () => await appel(u, libelle, `/api/actions/${nom}`, { method: 'POST', body: p }));
    if (exactitude && res.statut === 200 && ++validees % exactitude === 0 && !comparaison) {
      comparaison = comparer().finally(() => { comparaison = null; });
    }
    return res;
  };
  const donnees = async (u: Utilisateur) => await appel(u, `GET /api/data (${u.role})`, '/api/data');
  const pause = (ms: number) => new Promise(ok => setTimeout(ok, ms));
  const reflexion = (min = 2000, max = 10_000) => pause(r.entre(min, max));
  /** Traitement en cours de ce processus (tâches de fond), chronométré comme une route. */
  const tache = async (nom: string, fn: () => Promise<unknown>) => await ecriture(async () => {
    const t = performance.now();
    try { await fn(); noter(nom, performance.now() - t, 200); } catch (err) {
      noter(nom, performance.now() - t, 500);
      erreurs.push(`${nom} → ${err instanceof Error ? err.message : err}`);
    }
  });

  // — Sonde : santé, verrou d'écriture sur le serveur, pool, mémoire —
  const sante: Mesures = { durees: [], e4xx: 0, e5xx: 0, e503: 0, delais: 0 };
  const etat = { attenteVerrouMax: 0, attentesMax: 0, tenueVerrouMax: 0, attentePoolMax: 0, poolAttenteMax: 0, lecturesAttenteMax: 0, ecrituresAttenteMax: 0, attenteFileMax: 0, rssMax: 0, tasMax: 0 };
  const tenues = new Map<number, number>();
  let poolDepuis: number | null = null;
  let sondeEnCours = false;
  const chronologie: { t: number; sante: number | null; attente: number; tenue: number; pool: number }[] = [];
  const debut = performance.now();
  // Attentes de la file des écritures comptées à partir d'ici (pas celles de la préparation du jeu).
  db.fileEcritures.attenteMax = 0;
  const relever = async () => {
    const t0 = performance.now();
    const m = process.memoryUsage();
    etat.rssMax = Math.max(etat.rssMax, m.rss); etat.tasMax = Math.max(etat.tasMax, m.heapUsed);
    const attentePool = db.pool.waitingCount;
    etat.lecturesAttenteMax = Math.max(etat.lecturesAttenteMax, db.placesLecture.enAttente);
    etat.ecrituresAttenteMax = Math.max(etat.ecrituresAttenteMax, db.fileEcritures.enAttente);
    // Attente du verrou d'écriture dans l'instance : sur une instance, une seule écriture à la fois atteint
    // pg_advisory_xact_lock ; les autres attendent leur tour en mémoire, sans connexion, et pg_stat_activity ne les voit
    // pas. L'attente jugée est la plus longue des deux (file de l'instance, attente Advisory sur le serveur).
    const attenteFile = Math.max(db.fileEcritures.attenteEnCours, db.fileEcritures.attenteMax);
    etat.attenteFileMax = Math.max(etat.attenteFileMax, attenteFile);
    etat.attenteVerrouMax = Math.max(etat.attenteVerrouMax, attenteFile);
    etat.poolAttenteMax = Math.max(etat.poolAttenteMax, attentePool);
    if (attentePool > 0) { poolDepuis ??= t0; etat.attentePoolMax = Math.max(etat.attentePoolMax, t0 - poolDepuis); } else poolDepuis = null;
    // Santé : un appel par relevé ; au-delà de 10 s sans réponse, compté comme délai dépassé. Lancé après le relevé du
    // verrou : tant que la sonde de santé prend elle-même le verrou d'écriture (enSerie, server/src/supervision.ts), un
    // relevé fait pendant son appel compterait comme tenu en continu le verrou de chaque appel de santé.
    const sante1 = async () => {
      const t = performance.now();
      try {
        const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
        await res.text();
        const d = performance.now() - t;
        sante.durees.push(d);
        if (res.status >= 500) sante.e5xx++;
        return d;
      } catch {
        sante.delais++; sante.durees.push(performance.now() - t);
        return null;
      }
    };
    if (sondeEnCours) return void await sante1();
    sondeEnCours = true;
    let sant: Promise<number | null> | null = null;
    try {
      const { rows } = await sonde.query<{ pid: number; granted: boolean; attente: number | null; tx: number | null }>(`SELECT l.pid, l.granted,
          EXTRACT(EPOCH FROM now() - a.query_start) * 1000 AS attente, EXTRACT(EPOCH FROM now() - a.xact_start) * 1000 AS tx
        FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.objsubid = 1 AND l.objid = (hashtext($1)::bigint & 4294967295)::oid`, [`${jeu.schema}.ecritures`]);
      const maintenant = performance.now();
      const attentes = rows.filter(x => !x.granted);
      etat.attentesMax = Math.max(etat.attentesMax, attentes.length);
      const attenteMax = Math.max(0, ...attentes.map(x => Number(x.attente ?? 0)));
      etat.attenteVerrouMax = Math.max(etat.attenteVerrouMax, attenteMax);
      // Tenue : depuis le premier relevé où la session détient le verrou (suite exclusive), ou depuis le début de sa
      // transaction s'il est plus ancien (verrou de transaction). Une transaction commencée après ce premier relevé est
      // une autre tenue (transactions qui se suivent sur la même connexion du pool, file des écritures de l'instance) :
      // le décompte repart de son début. Une suite exclusive dont une requête est en cours peut ainsi être sous-estimée
      // (elle ne tient le verrou qu'en dehors des transactions, pour les routes de la session : quelques millisecondes).
      const detenteurs = new Set(rows.filter(x => x.granted).map(x => x.pid));
      for (const pid of tenues.keys()) if (!detenteurs.has(pid)) tenues.delete(pid);
      let tenue = 0;
      for (const x of rows.filter(y => y.granted)) {
        const tx = x.tx === null ? null : Number(x.tx);
        if (!tenues.has(x.pid) || (tx !== null && maintenant - tenues.get(x.pid)! > tx + 500)) tenues.set(x.pid, tx === null ? maintenant : maintenant - tx);
        tenue = Math.max(tenue, maintenant - tenues.get(x.pid)!);
      }
      etat.tenueVerrouMax = Math.max(etat.tenueVerrouMax, tenue);
      chronologie.push({ t: Math.round((t0 - debut) / 100) / 10, sante: null, attente: Math.round(Math.max(attenteMax, db.fileEcritures.attenteEnCours)), tenue: Math.round(tenue), pool: attentePool });
    } finally {
      sondeEnCours = false;
      sant = sante1();
    }
    const d = await sant;
    const dernier = chronologie.at(-1);
    if (dernier) dernier.sante = d === null ? null : Math.round(d);
  };
  const minuteur = setInterval(() => { void relever().catch(err => erreurs.push(`sonde → ${err instanceof Error ? err.message : err}`)); }, 500);

  // — Utilisateurs simulés —
  const fin = { t: 0 };
  const actif = () => performance.now() < fin.t;
  /** Fond de S1 : lectures au retour sur l'onglet. */
  const lecteur = async (u: Utilisateur) => {
    await pause(r.entre(0, 3000));
    while (actif()) {
      await donnees(u);
      if (u.role === 'rh' && r.si(0.3)) await appel(u, 'GET /api/journal', '/api/journal?page=1');
      await reflexion();
    }
  };
  const fond = (nCollab = 22, autres = true) => [
    ...collaborateurs.slice(0, nCollab).map(lecteur), ...(autres ? [...managers.slice(0, 6), ...rhs].map(lecteur) : []),
  ];
  const scenariosFaits: Record<string, string> = {};
  /** Relevés du cache à la fin de chaque scénario (cumulés depuis le début de l'essai). */
  const releves: Record<string, { relectures: number; changements: number | null }> = {};
  /** Lignes de la table `changements` (journal des changements, lot 9), null tant qu'elle n'existe pas. */
  const tailleChangements = async (): Promise<number | null> => {
    const { rows: [t] } = await sonde.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [`${jeu.schema}.changements`]);
    if (!t.ok) return null;
    return Number((await sonde.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${jeu.schema}.changements`)).rows[0].n);
  };

  for (const s of scenarios as Scenario[]) {
    console.log(`  ${s} « ${LIBELLES[s]} »…`);
    const t0 = performance.now();
    fin.t = t0 + duree;
    const taches: Promise<unknown>[] = [];
    if (s === 'S1') taches.push(...fond());
    if (s === 'S2') {
      // Semaine en cours remise en brouillon, puis saisie et soumission par 30 collaborateurs.
      await db.run('UPDATE feuilles SET statut = ? WHERE week = ? AND statut = ?', ['brouillon', jeu.semaineCourante, 'soumise']);
      taches.push(Promise.all(collaborateurs.map(async u => {
        await pause(r.entre(0, 5000));
        const d = await donnees(u);
        const sh = (d.corps?.feuilles as { empId: number; week: string; lignes: unknown[] }[] | undefined)?.find(f => f.empId === u.empId && f.week === jeu.semaineCourante);
        const lignes = Math.max(1, sh?.lignes.length ?? 1);
        for (let i = 0, n = r.entre(5, 15); i < n && actif(); i++) {
          await action(u, 'temps.setCell', { empId: u.empId, week: jeu.semaineCourante, li: r.entre(0, lignes - 1), di: r.entre(0, 4), value: String(r.entre(6, 8)) });
          await reflexion(1000, 4000);
        }
        if (actif()) await action(u, 'temps.addLine', { empId: u.empId, week: jeu.semaineCourante, projet: 'INT-QUA' });
        if (actif()) await action(u, 'temps.submit', { empId: u.empId, week: jeu.semaineCourante });
        while (actif()) { await reflexion(); await donnees(u); }
      })));
    }
    if (s === 'S3') {
      // Feuilles de la fin de mois remises à valider (un essai précédent a pu les valider).
      await db.run(`UPDATE feuilles SET statut = 'soumise' WHERE statut = 'validee' AND week IN (${jeu.soumises.map(() => '?').join(', ')}) AND lot_id IS NULL`, jeu.soumises);
      taches.push(...fond(20, false));
      // Tâches du quart d'heure forcées au début, puis toutes les minutes.
      taches.push((async () => { while (actif()) { await tache('tâches du quart d’heure (tachesEmails)', async () => await tachesEmails(db, 6)); await pause(60_000); } })());
      // Keystone : un appel par minute (verdict Go / No Go d'un chantier, qui lit toute la base).
      taches.push((async () => {
        while (actif()) {
          await ecriture(async () => await appel(null, 'GET Keystone /v1/chantiers/{id}/go-no-go', `/api/integrations/keystone/v1/chantiers/${jeu.chantier}/go-no-go`, { headers: { 'x-api-key': process.env.KEYSTONE_API_KEY! } }));
          await pause(60_000);
        }
      })());
      const valideur = async (u: Utilisateur, taille: [number, number], libelle: (n: number) => string) => {
        const d = await donnees(u);
        type F = { empId: number; week: string; statut: string };
        const employes = new Map((d.corps?.employes as { id: number; typeContrat: string }[] | undefined ?? []).map(e => [e.id, e]));
        const aValider = (d.corps?.feuilles as F[] | undefined ?? []).filter(f => f.statut === 'soumise' && f.empId !== u.empId && jeu.soumises.includes(f.week))
          // Intérimaires d'abord : leur validation fait partir le relevé de l'agence.
          .sort((a, b) => Number(employes.get(b.empId)?.typeContrat === 'interim') - Number(employes.get(a.empId)?.typeContrat === 'interim'));
        const lot = aValider.slice(0, r.entre(taille[0], taille[1])).map(f => ({ empId: f.empId, week: f.week }));
        if (!lot.length) return void erreurs.push(`${u.nom} : aucune feuille soumise à valider`);
        const res = await action(u, 'temps.validerLot', { feuilles: lot }, libelle(lot.length));
        scenariosFaits[`${u.nom} : validerLot de ${lot.length}`] = res.statut === 200 ? String(res.corps?.message ?? '').slice(0, 160) : `refus ${res.statut} : ${String(res.corps?.error ?? '').slice(0, 160)}`;
      };
      taches.push(Promise.all(managers.slice(0, 6).map(async u => {
        await pause(r.entre(0, 2000));
        await valideur(u, [15, 30], () => 'POST temps.validerLot (≤ 30)');
        while (actif()) { await reflexion(); await donnees(u); }
      })));
      if (lotGrand) taches.push((async () => { await pause(1000); await valideur(rhs[0], [lotGrand, lotGrand], n => (n > 30 ? 'POST temps.validerLot (200)' : 'POST temps.validerLot (≤ 30)')); })());
    }
    if (s === 'S4') {
      taches.push(...fond());
      taches.push((async () => {
        // Lot ouvert de la période laissé par un essai précédent : annulé d'abord.
        for (const l of await db.query<{ id: number }>(`SELECT id FROM lots_paie WHERE periode = ? AND statut <> 'annule' AND statut <> 'transmis'`, [jeu.periodePaie])) {
          await action(paie, 'paie.lotAnnuler', { id: l.id }, 'POST paie.lotAnnuler (remise en place)');
        }
        await pause(2000);
        const g = await action(paie, 'paie.lotGenerer', { periode: jeu.periodePaie });
        const id = (g.corps?.result as { lot?: number } | undefined)?.lot;
        if (id) await appel(paie, 'GET /api/paie/lots/:id/fichier', `/api/paie/lots/${id}/fichier`);
        await appel(paie, 'GET /api/paie/variables/:periode', `/api/paie/variables/${jeu.periodePaie}`);
        if (id) await action(paie, 'paie.lotAnnuler', { id });
        scenariosFaits['lot de paie'] = g.statut === 200 ? String(g.corps?.message ?? '').slice(0, 160) : `refus ${g.statut} : ${String(g.corps?.error ?? '').slice(0, 160)}`;
      })());
    }
    if (s === 'S5') {
      taches.push(...fond());
      taches.push((async () => {
        await pause(2000);
        const csv = await appel(rhs[0], 'GET /api/journal/csv', '/api/journal/csv');
        scenariosFaits['CSV du journal'] = `${csv.statut}, ${Math.round(csv.octets / 1024)} Ko`;
        await appel(rhs[0], 'GET /api/salaries/:id/donnees', `/api/salaries/${collaborateurs[0].empId}/donnees`);
        await appel(collaborateurs[1], 'GET /api/mes-donnees', '/api/mes-donnees');
        await Promise.all(jeu.jetonsAgenda.map(j => appel(null, 'GET /api/agenda/:jeton.ics', `/api/agenda/${j}.ics`)));
      })());
    }
    if (s === 'S6') {
      taches.push(...fond());
      taches.push((async () => {
        await pause(2000);
        await tache('conservation du journal', async () => await appliquerConservation(db, new Date(Date.now() + decalage * 86_400_000)));
        await tache('relances des échéances', async () => await relancerEcheances(db, 8));
        await tache('évaluations des formations', async () => await demanderEvaluations(db));
        await tache('tâches du quart d’heure (tachesEmails)', async () => await tachesEmails(db, 6));
      })());
    }
    await Promise.all(taches);
    console.log(`    terminé en ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    // Comparaison de l'état final du scénario (après celle en cours, s'il y en a une).
    if (exactitude) {
      while (comparaison) await comparaison;
      await comparer();
      console.log(`    exactitude : ${bilans.length} comparaison(s) d'état, ${bilans.reduce((n, x) => n + x.divergences.length, 0)} divergence(s)`);
    }
    releves[s] = { relectures: cache.relectures, changements: await tailleChangements() };
  }

  clearInterval(minuteur);
  // Statistiques exposées par le cache incrémental (lot 9, étape 2), absentes du cache par révision ; lues base ouverte.
  const statsCache = typeof moduleCache.statistiquesCache === 'function' ? await (moduleCache.statistiquesCache as (db: unknown) => unknown)(db) : null;
  await pause(600);
  serveur.close();
  serveur.closeAllConnections();
  await db.fermer();
  await sonde.end();

  // — Rapport —
  const routes: Record<string, StatRoute> = {};
  for (const [nom, m] of [...mesures].sort((a, b) => a[0].localeCompare(b[0]))) routes[nom] = statistiques(m.durees, m);
  const stats: StatSonde = { sante: statistiques(sante.durees, sante), ...etat };
  const divergences: Divergence[] = bilans.flatMap(b => b.divergences);
  const exact = exactitude ? {
    k: exactitude, etats: bilans.length, comparaisons: bilans.reduce((n, b) => n + b.comparaisons, 0), refaites: bilans.reduce((n, b) => n + b.refaites, 0),
    divergences: divergences.length, dureeMs: Math.round(bilans.reduce((n, b) => n + b.dureeMs, 0)), detail: divergences.slice(0, 20),
  } : null;
  const verdicts: Verdict[] = juger(routes, stats, { marge, sans503: scenarios.every(s => ['S1', 'S2', 'S3'].includes(s)), exactitude: exact ?? undefined });
  const rapport = {
    date: new Date().toISOString(), jeu: { schema: jeu.schema, ans: jeu.ans, volumes: jeu.volumes }, scenarios, dureeS: duree / 1000, marge,
    routes, sonde: stats, verdicts, resultats: scenariosFaits, erreurs: erreurs.slice(0, 100), chronologie,
    exactitude: exact, cache: { releves, statistiques: statsCache },
  };
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  writeFileSync(join(dossier, 'rapport.json'), JSON.stringify(rapport, null, 2));
  const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
  const md = [
    `# Essai de charge — ${scenarios.map(s => `${s} « ${LIBELLES[s as Scenario]} »`).join(', ')}`, '',
    `${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · jeu ${jeu.schema} (${jeu.ans} an${jeu.ans > 1 ? 's' : ''} : `
      + `${jeu.volumes.feuilles?.lignes ?? '?'} feuilles, ${jeu.volumes.journal?.lignes ?? '?'} lignes de journal) · ${duree / 1000} s par scénario · marge ×${marge}`, '',
    '## Verdicts', '', '| Critère | Mesure | Seuil | |', '| --- | --- | --- | --- |',
    ...verdicts.map(v => `| ${v.critere}${v.invariant ? ' (invariant)' : ''} | ${v.mesure} | ${v.seuil} | ${v.ok ? 'tenu' : '**dépassé**'} |`), '',
    '## Routes', '', '| Route | n | p50 | p95 | p99 | max | 4xx | 5xx (dont 503) | sans réponse |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(routes).map(([n, x]) => `| ${n} | ${x.n} | ${ms(x.p50)} | ${ms(x.p95)} | ${ms(x.p99)} | ${ms(x.max)} | ${x.e4xx} | ${x.e5xx} (${x.e503}) | ${x.delais} |`), '',
    '## Sonde (toutes les 500 ms)', '',
    `- /api/health : ${stats.sante.n} relevés, p50 ${ms(stats.sante.p50)}, p95 ${ms(stats.sante.p95)}, p99 ${ms(stats.sante.p99)}, max ${ms(stats.sante.max)}, ${stats.sante.delais} sans réponse en 10 s`,
    `- verrou d’écriture : attente au plus ${ms(stats.attenteVerrouMax)} (file des écritures de l’instance : ${ms(stats.attenteFileMax)} au plus ; ${stats.attentesMax} sessions en attente sur le serveur au plus), tenue au plus ${ms(stats.tenueVerrouMax)}`,
    `- pool : ${stats.poolAttenteMax} appels en attente d’une connexion au plus, attente continue au plus ${ms(stats.attentePoolMax)} ; lectures stables en attente d’une place au plus : ${stats.lecturesAttenteMax} ; écritures de l’instance en attente de leur tour au plus : ${stats.ecrituresAttenteMax}`,
    `- mémoire : RSS au plus ${Math.round(stats.rssMax / 1048576)} Mo, tas ${Math.round(stats.tasMax / 1048576)} Mo`, '',
    '## Cache de l’instantané', '',
    ...Object.entries(releves).map(([sc, v]) => `- après ${sc} : ${v.relectures} relecture${v.relectures > 1 ? 's' : ''} complète${v.relectures > 1 ? 's' : ''} (toute la table des feuilles, hors comparaisons) depuis le début ; `
      + (v.changements === null ? 'table `changements` absente' : `${v.changements} lignes dans \`changements\``)),
    `- durée du delta, vues reportées ou recalculées, replis : ${statsCache ? JSON.stringify(statsCache) : 'non exposés par ce cache (`statistiquesCache`, cache incrémental du lot 9)'}`, '',
    ...(exact ? ['## Exactitude (--verifier-exactitude)', '',
      `- ${exact.etats} état${exact.etats > 1 ? 's' : ''} comparé${exact.etats > 1 ? 's' : ''} (toutes les ${exact.k} actions validées et à la fin de chaque scénario), ${exact.comparaisons} comparaisons `
        + `(${lecteurs.length} lecteurs : vues, entrée, jeux d'action), ${exact.refaites} refaite${exact.refaites > 1 ? 's' : ''} ; ${(exact.dureeMs / 1000).toFixed(1)} s de comparaison, écritures retenues pendant ce temps`,
      `- divergences : ${exact.divergences}`, ...exact.detail.map(d => `  - ${d.objet} ${d.cle} (révision ${d.revision}) : ${d.ecart}`), ''] : []),
    ...(Object.keys(scenariosFaits).length ? ['## Traitements', '', ...Object.entries(scenariosFaits).map(([k, v]) => `- ${k} : ${v}`), ''] : []),
    ...(erreurs.length ? ['## Erreurs (100 premières)', '', ...erreurs.slice(0, 100).map(e => `- ${e}`), ''] : []),
  ].join('\n');
  writeFileSync(join(dossier, 'rapport.md'), md);
  console.log(md.split('\n## Routes')[0]);
  console.log(`Rapport : ${join(dossier, 'rapport.md')} (et rapport.json)`);
  const echecs = verdicts.filter(v => !v.ok);
  if (echecs.length) {
    console.log(`${echecs.length} seuil${echecs.length > 1 ? 's' : ''} dépassé${echecs.length > 1 ? 's' : ''}${echecs.some(v => v.invariant) ? ', dont des invariants' : ''}.`);
    process.exitCode = echecs.some(v => v.invariant) ? 3 : 1;
  }
}

lancer('npm run charge', async () => {
  await executer();
  // Code de sortie posé par les verdicts (1 : seuil dépassé, 3 : invariant), rendu tel quel.
  if (process.exitCode) process.exit(process.exitCode);
});
