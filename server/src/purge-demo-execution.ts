// Exécution de npm run purge-demo (lot 8, chantier A, étape 2) : passage d'une base de démonstration à la production,
// service arrêté. Règles, constat et aperçu : server/src/purge-demo.ts ; ligne de commande : server/src/purge-demo-cli.ts.
// Ordre des opérations (`executerPurge`), testé sans lancer la commande (tests/purge-demo.test.ts), SQLite comme PostgreSQL :
// 1. aperçu et décision : purge déjà faite (rien à faire), refusée sans appel, ou points à lever (fiches ajoutées sans
//    --inclure-ajouts, compte gardé inconnu) : refus ;
// 2. service arrêté : sur le serveur PostgreSQL, aucune autre connexion `application_name = 'cursus'` sur la base
//    (`controlerConnexionsPg`), contrôlé avant la confirmation puis de nouveau dans la transaction, sous le verrou
//    d'écriture ; pour le fichier SQLite, la commande contrôle le verrou du serveur avant d'ouvrir la base ;
// 3. confirmation : --yes, ou le mot « PRODUCTION <nombre de salariés supprimés> » tapé dans un terminal ;
// 4. sauvegarde préalable (`sauvegardePrealable`) : copie « avant-purge » du fichier SQLite, pièces comprises, ou pg_dump
//    vérifié (--sauvegarde) sur le serveur ; un échec annule la purge, rien n'est écrit ;
// 5. une seule transaction (`appliquer`) : colonnes remises à NULL sur les lignes gardées, réglages retirés, tables
//    vidées (ordre des clés étrangères sur PostgreSQL), amorçages reposés (activités internes, horaires d'exemple),
//    séquence des salariés placée au-delà de tout identifiant déjà attribué (jamais RESTART IDENTITY, les autres
//    séquences gardées), journal vidé puis une seule ligne `purge.demo`, contrôle d'intégrité qui doit être vide :
//    sinon tout est annulé ;
// 6. après la validation : fichiers des pièces effacés (un échec est noté sur la ligne purge.demo, sans annuler la
//    purge), base SQLite compactée (VACUUM : les pages libérées ne gardent rien des données fictives), copies locales
//    antérieures supprimées avec --supprimer-copies-demo, sauf la copie avant-purge.
// Sur PostgreSQL, l'aperçu à blanc rejoue toute la transaction puis l'annule (`simulerPurge`, comme le motif Annulee
// de server/src/reprise-postgres.ts) : il montre les vrais décomptes et toute violation de clé, sans rien garder.
import { closeSync, existsSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { matricule, plural } from '../../shared/format.ts';
import { journaliser } from './comptes.ts';
import { type Db, snake, TABLES, type TableName } from './db.ts';
import { controlerOrphelins } from './integrite.ts';
import { ACTION_PURGE_DEMO } from './marqueurs.ts';
import { amorcerActiviteFormation } from './migrations/formations.ts';
import { amorcerHoraires } from './migrations/lot6-horaires.ts';
import { amorcerActiviteAstreinte } from './migrations/lot7-astreintes.ts';
import { amorcerActivites } from './migrations/temps.ts';
import { depotDe, dossierPiecesDe, NOM_LOCAL } from './pieces.ts';
import { dossierMiroir, elaguerPieces } from './pieces-sauvegarde.ts';
import {
  type ApercuPurge, apercuPurge, motConfirmationPurge, type OptionsPurge, planPurge, plusGrandIdEmploye, PurgeRefusee, type RegleTable,
} from './purge-demo.ts';
import { dossierSauvegardes, listerSauvegardes, sauvegarderBase } from './sauvegarde.ts';

/** Auteur de la ligne `purge.demo` du journal. */
export const ACTEUR_PURGE = 'Ligne de commande (npm run purge-demo)';
/** Nom de connexion des instances de Cursus sur le serveur PostgreSQL (pool de server/src/db-pg.ts). */
export const APPLICATION_PG = 'cursus';

/** Sauvegarde préalable impossible : la purge est annulée, rien n'a été écrit. */
export class SauvegardePurgeImpossible extends PurgeRefusee {}

// — Service arrêté (serveur PostgreSQL) —

export interface ConnexionCursus { pid: number; depuis: string | null; client: string | null }

/**
 * Autres connexions de Cursus sur la base du serveur PostgreSQL (`pg_stat_activity`, même base, nom de connexion
 * `cursus`, hors la connexion courante). Le verrou d'écriture ne suffit pas à prouver l'arrêt : une instance démarrée
 * mais au repos ne le tient pas, et réécrirait aussitôt (tâches du quart d'heure, rechargement de la démonstration).
 * La commande n'ouvre qu'une connexion (pool de taille 1) : la sienne est exclue par `pg_backend_pid()`.
 */
export async function autresConnexionsCursus(db: Db): Promise<ConnexionCursus[]> {
  if (db.moteur !== 'pg') return [];
  const lignes = await db.query<{ pid: number; depuis: string | null; client: string | null }>(`SELECT pid, backend_start AS depuis, client_addr::text AS client
    FROM pg_stat_activity WHERE datname = current_database() AND application_name = ? AND pid <> pg_backend_pid() ORDER BY pid`, [APPLICATION_PG]);
  return lignes.map(l => ({ pid: Number(l.pid), depuis: l.depuis ?? null, client: l.client ?? null }));
}

/** Refus si une autre instance de Cursus est connectée à la base (`autresConnexionsCursus`) ; --force n'y peut rien. */
export async function controlerConnexionsPg(db: Db): Promise<void> {
  const autres = await autresConnexionsCursus(db);
  if (!autres.length) return;
  const detail = autres.slice(0, 5).map(c => `processus ${c.pid}${c.client ? ` depuis ${c.client}` : ''}${c.depuis ? `, ouverte le ${c.depuis}` : ''}`).join(' ; ');
  throw new PurgeRefusee(`${plural(autres.length, 'autre connexion Cursus est ouverte', 'autres connexions Cursus sont ouvertes')} sur la base (${detail}) : `
    + 'arrêtez toutes les instances du service (application Coolify arrêtée) avant la purge ; --force ne lève pas ce contrôle.');
}

// — Sauvegarde préalable —

/** En-tête des copies de pg_dump au format personnalisé ou répertoire (-Fc, -Fd : toc.dat). */
export const ENTETE_PG_DUMP = 'PGDMP';

/**
 * Dernier signe d'activité de la base : dernière ligne du journal et dernière activité d'une session de connexion. Un
 * pg_dump antérieur ne contient pas tout ce qui a été écrit avant l'arrêt du service.
 */
export async function derniereActivite(db: Db): Promise<string | null> {
  const r = await db.one<{ j: string | null; c: string | null }>('SELECT (SELECT MAX(at) FROM journal) AS j, (SELECT MAX(activite) FROM connexions) AS c');
  const dates = [r?.j, r?.c].filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
  return dates.length ? dates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

/** Premiers octets d'un fichier (ou de toc.dat d'une copie au format répertoire). */
function entete(chemin: string): string {
  const st = statSync(chemin);
  const fichier = st.isDirectory() ? join(chemin, 'toc.dat') : chemin;
  const fd = openSync(fichier, 'r');
  try {
    const tampon = Buffer.alloc(ENTETE_PG_DUMP.length);
    const lus = readSync(fd, tampon, 0, tampon.length, 0);
    return tampon.subarray(0, lus).toString('latin1');
  } finally {
    closeSync(fd);
  }
}

/**
 * pg_dump désigné par --sauvegarde, vérifié : il existe, commence par l'en-tête PGDMP (format personnalisé ou
 * répertoire, restaurable par pg_restore) et a été écrit après le dernier signe d'activité de la base
 * (`derniereActivite`) : il a été fait après l'arrêt du service. Renvoie son chemin ; SauvegardePurgeImpossible sinon.
 */
export async function verifierPgDump(db: Db, chemin: string | null): Promise<string> {
  if (!chemin) {
    throw new SauvegardePurgeImpossible('serveur PostgreSQL : désignez le pg_dump du schéma cursus fait après l’arrêt du service (--sauvegarde <fichier>, '
      + 'pg_dump -Fc ; docs/DEPLOIEMENT.md, « Passage de la démonstration à la production »).');
  }
  if (!existsSync(chemin)) throw new SauvegardePurgeImpossible(`copie introuvable : ${chemin} (--sauvegarde).`);
  let debut: string;
  try {
    debut = entete(chemin);
  } catch (err) {
    throw new SauvegardePurgeImpossible(`copie illisible : ${chemin} (${err instanceof Error ? err.message : err}).`);
  }
  if (debut !== ENTETE_PG_DUMP) {
    throw new SauvegardePurgeImpossible(`${chemin} n’est pas une copie de pg_dump au format personnalisé (en-tête ${ENTETE_PG_DUMP} absent) : refaites-la avec pg_dump -Fc.`);
  }
  const ecrite = statSync(chemin).mtime;
  const activite = await derniereActivite(db);
  if (activite && ecrite.getTime() <= Date.parse(activite)) {
    throw new SauvegardePurgeImpossible(`${chemin} a été écrite le ${ecrite.toISOString()}, avant la dernière activité de la base (${activite}) : `
      + 'arrêtez le service, refaites le pg_dump, puis relancez la purge.');
  }
  return chemin;
}

/**
 * Sauvegarde préalable obligatoire : copie « avant-purge » du fichier SQLite (pièces comprises, server/src/sauvegarde.ts),
 * ou pg_dump vérifié sur le serveur PostgreSQL. Renvoie le chemin de la copie ; SauvegardePurgeImpossible sinon.
 */
export async function sauvegardePrealable(db: Db, options: Pick<OptionsPurge, 'sauvegarde'>): Promise<string> {
  if (db.moteur === 'pg') return await verifierPgDump(db, options.sauvegarde);
  let copie: ReturnType<typeof sauvegarderBase>;
  try {
    copie = sauvegarderBase(db, 'avant-purge');
  } catch (err) {
    throw new SauvegardePurgeImpossible(`copie avant-purge impossible (${err instanceof Error ? err.message : err}) : purge annulée, rien n’a été écrit.`);
  }
  if (!copie) throw new SauvegardePurgeImpossible('base sans fichier (en mémoire) : aucune copie possible, purge annulée.');
  return copie.fichier;
}

// — Transaction —

/** Résultat de la purge, ou de sa simulation (transaction annulée). */
export interface BilanPurge {
  statut: 'faite' | 'simulee';
  profil: OptionsPurge['garder'];
  /** Lignes supprimées par table (noms SQL), tables touchées seulement. */
  supprimees: Record<string, number>;
  /** Lignes gardées dont des colonnes ont été remises à NULL (« equipes » : nombre). */
  ajustees: Record<string, number>;
  /** Salariés supprimés, dont fiches ajoutées par des visiteurs. */
  salaries: number;
  ajoutsPurges: number;
  /** Plus grand identifiant de salarié supprimé (matricules à signaler aux autres outils). */
  plusGrandId: number;
  reglages: string[];
  comptesGardes: { id: number; identifiant: string }[];
  /** Amorçages reposés (activités internes, horaires d'exemple). */
  amorcages: string[];
  sequence: { prochain: number; matricule: string };
  /** Copie préalable (null pour une simulation). */
  copie: string | null;
  /** Fichiers de pièces effacés après la validation, et ceux qui n'ont pas pu l'être. */
  pieces: { effaces: number; echecs: string[] };
  /** Copies locales supprimées (--supprimer-copies-demo), et fichiers du miroir des pièces retirés. */
  copiesSupprimees: string[];
  miroirRetires: number;
}

/** Simulation menée à son terme : la transaction est annulée, le bilan est rendu. */
class Annulee extends Error {
  readonly bilan: BilanPurge;
  constructor(bilan: BilanPurge) {
    super('simulation');
    this.bilan = bilan;
  }
}

/**
 * Ordre de suppression des tables `tables` d'après les clés étrangères `cles` (table → table désignée, clés non
 * différables, hors références d'une table à elle-même) : une table avant celles qu'elle désigne. Un cycle est refusé.
 */
export function ordonnerSuppression(tables: readonly TableName[], cles: readonly { table: string; cible: string }[]): TableName[] {
  const parSql = new Map(tables.map(t => [snake(t), t]));
  const designe = new Map<TableName, Set<TableName>>(tables.map(t => [t, new Set()]));
  for (const k of cles) {
    const t = parSql.get(k.table), c = parSql.get(k.cible);
    if (t && c && t !== c) designe.get(t)!.add(c);
  }
  // Ordre d'insertion (une table après celles qu'elle désigne), parcouru à l'envers pour la suppression.
  const vus = new Set<TableName>(), insertion: TableName[] = [];
  const visiter = (t: TableName, chemin: TableName[]) => {
    if (vus.has(t)) return;
    if (chemin.includes(t)) throw new PurgeRefusee(`clés étrangères en cycle : ${[...chemin, t].map(snake).join(' → ')}`);
    for (const c of designe.get(t)!) visiter(c, [...chemin, t]);
    vus.add(t);
    insertion.push(t);
  };
  for (const t of tables) visiter(t, []);
  return insertion.reverse();
}

/** Tables vidées dans l'ordre des clés étrangères du schéma (PostgreSQL ; SQLite n'en déclare aucune). */
async function ordreSuppression(db: Db, tables: TableName[]): Promise<TableName[]> {
  if (db.moteur !== 'pg') return tables;
  const cles = await db.query<{ t: string; c: string }>(`SELECT tc.relname AS t, tp.relname AS c FROM pg_constraint k
    JOIN pg_class tc ON tc.oid = k.conrelid JOIN pg_namespace n ON n.oid = tc.relnamespace JOIN pg_class tp ON tp.oid = k.confrelid
    WHERE k.contype = 'f' AND NOT k.condeferrable AND n.nspname = current_schema()`);
  return ordonnerSuppression(tables, cles.map(k => ({ table: k.t, cible: k.c })));
}

/** Séquence des salariés placée de sorte que le prochain identifiant soit `prochain` (jamais en deçà de l'existant). */
async function placerSequence(db: Db, prochain: number): Promise<void> {
  if (db.moteur === 'pg') {
    const s = await db.one<{ seq: string }>(`SELECT pg_get_serial_sequence('employes', 'id') AS seq`);
    // ALTER SEQUENCE est annulé avec la transaction (contrairement à setval) ; le nextval qui suit pose la dernière valeur
    // attribuée, lue ensuite par plusGrandIdEmploye, comme sqlite_sequence.
    await db.exec(`ALTER SEQUENCE ${s!.seq} RESTART WITH ${prochain - 1}`);
    await db.query(`SELECT nextval('${s!.seq}')`);
    return;
  }
  const r = await db.run(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'employes'`, [prochain - 1]);
  if (!r.changes) await db.run(`INSERT INTO sqlite_sequence (name, seq) VALUES ('employes', ?)`, [prochain - 1]);
}

/** Amorçages d'une base neuve reposés après la purge (comme mettreAJourBase, server/src/demarrage.ts). */
async function reposerAmorcages(db: Db, tables: Record<TableName, RegleTable>): Promise<string[]> {
  const out: string[] = [];
  if (tables.projets.amorcee) {
    await amorcerActivites(db);
    await amorcerActiviteFormation(db);
    await amorcerActiviteAstreinte(db);
    out.push(...(await db.query<{ code: string }>('SELECT code FROM projets ORDER BY code')).map(p => p.code));
  }
  if (tables.horaires.amorcee) out.push(...await amorcerHoraires(db));
  return out;
}

const motifsRefus = (a: ApercuPurge): string[] => {
  const d = a.decision;
  if (d.statut === 'refusee') return d.motifs;
  if (d.statut === 'possible') return d.aLever;
  return [];
};

/**
 * Purge elle-même, dans la transaction en cours (sous le verrou d'écriture) : décision refaite sur l'état présent,
 * qui doit être celui de l'aperçu confirmé (`attendus` : salariés supprimés), puis suppressions, ajustements, séquence,
 * journal réduit à la ligne `purge.demo`, contrôle d'intégrité. Toute erreur annule la transaction.
 */
async function appliquer(db: Db, options: OptionsPurge, attendus: number | null, copie: string | null, simulation: boolean, maintenant: Date): Promise<{ bilan: BilanPurge; fichiers: string[] }> {
  if (!simulation) await controlerConnexionsPg(db);
  const a = await apercuPurge(db, options);
  if (a.decision.statut === 'deja-faite') throw new PurgeRefusee(`purge déjà faite le ${a.decision.le} (pendant la commande).`);
  const motifs = motifsRefus(a);
  if (motifs.length) throw new PurgeRefusee(motifs.join(' '));
  if (attendus !== null && a.salaries !== attendus) {
    throw new PurgeRefusee(`la base a changé depuis l’aperçu (${a.salaries} salariés à supprimer au lieu de ${attendus}) : un service écrit encore ; arrêtez-le et relancez la commande.`);
  }
  const plan = planPurge(options.garder, a.comptesGardes.length > 0);
  const preuve = a.decision.statut === 'possible' ? a.decision.preuve : null;
  // Plus grand identifiant déjà attribué (séquence comprise) : matricules vus par les autres outils, à leur signaler.
  const plusGrand = await plusGrandIdEmploye(db);
  const supprimees: Record<string, number> = {}, ajustees: Record<string, number> = {};
  const compter = (o: Record<string, number>, t: string, n: number) => { if (n) o[t] = (o[t] ?? 0) + n; };

  // 1. Lignes gardées : références vers les données fictives remises à NULL (avant les suppressions, pour les clés
  //    étrangères) ; comptes gardés rendus externes, les autres supprimés.
  const gardes = a.comptesGardes.map(c => c.id);
  for (const t of Object.keys(TABLES) as TableName[]) {
    const r = plan.tables[t];
    if (r.sort !== 'ajuster' || !r.nulles?.length) continue;
    const set = r.nulles.map(c => `${snake(c)} = NULL`).join(', ');
    if (t === 'comptes') {
      const n = (await db.run(`UPDATE comptes SET ${set}, echecs = 0 WHERE id IN (${gardes.map(() => '?').join(', ')})`, gardes)).changes;
      compter(ajustees, 'comptes', n);
      compter(supprimees, 'comptes', (await db.run(`DELETE FROM comptes WHERE id NOT IN (${gardes.map(() => '?').join(', ')})`, gardes)).changes);
      continue;
    }
    compter(ajustees, snake(t), (await db.run(`UPDATE ${snake(t)} SET ${set} WHERE ${r.nulles.map(c => `${snake(c)} IS NOT NULL`).join(' OR ')}`)).changes);
  }
  // 2. Réglages retirés (remis à leur valeur par défaut).
  const cles = plan.reglagesSupprimes === '*' ? a.reglages.supprimes : a.reglages.supprimes.filter(k => plan.reglagesSupprimes.includes(k));
  if (plan.tables.settings.sort === 'ajuster') {
    for (const k of cles) compter(supprimees, 'settings', (await db.run('DELETE FROM settings WHERE key = ?', [k])).changes);
  }
  // 3. Tables vidées ; les fichiers des pièces sont notés pour être effacés après la validation.
  const fichiers = (await db.query<{ fichier: string | null }>('SELECT fichier FROM pieces')).map(p => p.fichier).filter((f): f is string => !!f);
  const aVider = (Object.keys(TABLES) as TableName[]).filter(t => plan.tables[t].sort === 'supprimer');
  for (const t of await ordreSuppression(db, aVider)) compter(supprimees, snake(t), (await db.run(`DELETE FROM ${snake(t)}`)).changes);
  // 4. Amorçages d'une base neuve, séquence des salariés.
  const amorcages = await reposerAmorcages(db, plan.tables);
  const prochain = a.sequence.prochain;
  await placerSequence(db, prochain);
  // 5. Journal vidé (les identifiants ne repartent pas de zéro : aucune ligne journal:<id> de pub_journal ne se répète),
  //    puis la seule ligne de la purge : décomptes, identifiants et chemins, jamais de donnée de personne.
  const ajoutsPurges = a.ajouts.fiches.nombre;
  const nTables = Object.keys(supprimees).length;
  await journaliser(db, {
    actor: ACTEUR_PURGE, role: null, action: ACTION_PURGE_DEMO, at: maintenant.toISOString(),
    message: `Purge des données de démonstration (profil ${options.garder}) : ${plural(a.salaries, 'salarié', 'salariés')}, `
      + `${plural(Object.values(supprimees).reduce((x, y) => x + y, 0), 'ligne supprimée', 'lignes supprimées')} dans ${plural(nTables, 'table', 'tables')}`,
    payload: {
      profil: options.garder, preuve, salaries: a.salaries, ajoutsPurges, supprimees, ajustees, reglages: cles,
      comptesGardes: gardes, prochainId: prochain, plusGrandId: plusGrand, copie,
    },
  });
  // 6. Contrôles différés (PostgreSQL) puis intégrité : aucune référence orpheline, sinon tout est annulé.
  if (db.moteur === 'pg') await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
  const integrite = await controlerOrphelins(db);
  if (integrite.orphelins) {
    const detail = Object.entries(integrite.parReference).map(([k, n]) => `${k} : ${n}`).join(', ');
    throw new PurgeRefusee(`le contrôle d’intégrité trouverait ${plural(integrite.orphelins, 'référence orpheline', 'références orphelines')} après la purge (${detail}) : rien n’a été modifié.`);
  }
  const bilan: BilanPurge = {
    statut: simulation ? 'simulee' : 'faite', profil: options.garder, supprimees, ajustees, salaries: a.salaries, ajoutsPurges,
    plusGrandId: plusGrand, reglages: cles, comptesGardes: a.comptesGardes, amorcages,
    sequence: { prochain, matricule: matricule(prochain) }, copie, pieces: { effaces: 0, echecs: [] }, copiesSupprimees: [], miroirRetires: 0,
  };
  if (simulation) throw new Annulee(bilan);
  return { bilan, fichiers };
}

/**
 * Simulation complète de la purge, transaction annulée (aperçu à blanc sur le serveur PostgreSQL) : vrais décomptes,
 * violations de clés et contrôle d'intégrité, sans rien garder. Rend le bilan, ou l'erreur qui ferait échouer la purge.
 */
export async function simulerPurge(db: Db, options: OptionsPurge, maintenant = new Date()): Promise<BilanPurge> {
  try {
    await db.tx(async () => await appliquer(db, options, null, null, true, maintenant));
  } catch (err) {
    if (err instanceof Annulee) return err.bilan;
    throw err;
  }
  throw new Error('simulation de la purge validée au lieu d’être annulée');
}

// — Après la validation —

/**
 * Fichiers des pièces effacés : ceux que désignaient les pièces supprimées (retirées comprises) et tout fichier du dossier
 * local qu'aucune pièce ne désigne plus (toutes sont supprimées). Un fichier de la GED est retiré par son dépôt.
 */
async function effacerPieces(db: Db, fichiers: readonly string[]): Promise<BilanPurge['pieces']> {
  const dossier = dossierPiecesDe(db);
  const echecs: string[] = [];
  let effaces = 0;
  const locaux = existsSync(dossier) ? readdirSync(dossier).filter(f => NOM_LOCAL.test(f)) : [];
  for (const f of locaux) {
    try {
      rmSync(join(dossier, f), { force: true });
      effaces++;
    } catch {
      echecs.push(f);
    }
  }
  for (const f of fichiers) {
    if (NOM_LOCAL.test(f)) continue;
    try {
      await depotDe(db, f).supprimer(f);
      effaces++;
    } catch {
      echecs.push(f);
    }
  }
  return { effaces, echecs };
}

/**
 * Copies locales antérieures de la base SQLite supprimées (--supprimer-copies-demo) : elles contiennent les données
 * fictives. La copie avant-purge est gardée (jusqu'à la fin de la recette), avec les fichiers du miroir des pièces
 * qu'elle désigne ; les autres fichiers du miroir sont retirés.
 */
function supprimerCopies(db: Db, copie: string): { supprimees: string[]; miroir: number } {
  const f = db.emplacement;
  if (!f) return { supprimees: [], miroir: 0 };
  const dossier = dossierSauvegardes(f);
  const base = basename(f).replace(/\.(db|sqlite3?)$/i, '');
  const supprimees: string[] = [];
  for (const c of listerSauvegardes(dossier).filter(x => x.base === base && x.fichier !== copie)) {
    rmSync(c.fichier, { force: true });
    supprimees.push(c.nom);
  }
  return { supprimees, miroir: elaguerPieces(dossierMiroir(dossier, base), [copie]) };
}

// — Exécution —

export interface DependancesPurge {
  /** Confirmation sans --yes (mot « PRODUCTION <nombre> » tapé dans un terminal) : vrai pour purger. */
  confirmer?: (apercu: ApercuPurge) => Promise<boolean> | boolean;
  /** Sauvegarde préalable (`sauvegardePrealable` par défaut) : chemin de la copie ; une erreur annule la purge. */
  sauvegarder?: (db: Db, options: OptionsPurge) => Promise<string> | string;
  maintenant?: Date;
}

export type IssuePurge = { statut: 'deja-faite'; le: string; message: string | null } | BilanPurge;

/**
 * Purge de la base de démonstration (voir l'en-tête du fichier) : refus (PurgeRefusee) avant toute écriture, purge déjà
 * faite (rien n'est écrit), ou bilan de la purge faite.
 */
export async function executerPurge(db: Db, options: OptionsPurge, deps: DependancesPurge = {}): Promise<IssuePurge> {
  const apercu = await apercuPurge(db, options);
  if (apercu.decision.statut === 'deja-faite') return apercu.decision;
  const motifs = motifsRefus(apercu);
  if (motifs.length) throw new PurgeRefusee(motifs.join(' '));
  await controlerConnexionsPg(db);
  if (!options.oui) {
    if (!deps.confirmer || !await deps.confirmer(apercu)) {
      throw new PurgeRefusee(deps.confirmer ? 'confirmation non donnée, rien n’a été modifié.'
        : `confirmation requise : ajoutez --yes, ou tapez ${motConfirmationPurge(apercu.salaries)} dans un terminal.`);
    }
  }
  const copie = await (deps.sauvegarder ?? sauvegardePrealable)(db, options);
  const maintenant = deps.maintenant ?? new Date();
  const { bilan, fichiers } = await db.tx(async () => await appliquer(db, options, apercu.salaries, copie, false, maintenant));
  bilan.pieces = await effacerPieces(db, fichiers);
  if (bilan.pieces.echecs.length) {
    // Échec noté sur la ligne purge.demo (nombre seulement), sans annuler la purge : à effacer à la main.
    await db.tx(async () => {
      const l = await db.one<{ id: number }>('SELECT id FROM journal WHERE action = ? ORDER BY id DESC LIMIT 1', [ACTION_PURGE_DEMO]);
      const ligne = l ? await db.get<{ payload: Record<string, unknown> }>('journal', l.id) : undefined;
      if (l && ligne) await db.update('journal', l.id, { payload: { ...ligne.payload, piecesNonEffacees: bilan.pieces.echecs.length } });
    });
  }
  // Fichier SQLite compacté : les pages libérées par les suppressions ne gardent rien des données fictives.
  if (db.moteur === 'sqlite') await db.exec('VACUUM');
  if (options.supprimerCopies) {
    const c = supprimerCopies(db, copie);
    bilan.copiesSupprimees = c.supprimees;
    bilan.miroirRetires = c.miroir;
  }
  return bilan;
}

// — Comptes rendus —

/** Bilan d'une simulation (aperçu à blanc sur le serveur PostgreSQL). */
export function texteSimulation(b: BilanPurge): string[] {
  const lignes = Object.values(b.supprimees).reduce((x, y) => x + y, 0);
  return [
    `Simulation complète sur le serveur (transaction annulée, rien n’a été gardé) : ${plural(lignes, 'ligne supprimée', 'lignes supprimées')} dans `
      + `${plural(Object.keys(b.supprimees).length, 'table', 'tables')}, contrôle d’intégrité sans référence orpheline, prochain salarié ${b.sequence.matricule}.`,
  ];
}

/** Bilan de la purge faite, puis les étapes suivantes de la mise en production. */
export function texteBilan(b: BilanPurge, moteur: Db['moteur']): string[] {
  const lignes = Object.values(b.supprimees).reduce((x, y) => x + y, 0);
  const out = [
    `Purge faite (profil ${b.profil}) : ${plural(b.salaries, 'salarié supprimé', 'salariés supprimés')}${b.ajoutsPurges ? `, dont ${plural(b.ajoutsPurges, 'fiche ajoutée', 'fiches ajoutées')} par des visiteurs` : ''} ; `
      + `${plural(lignes, 'ligne supprimée', 'lignes supprimées')} dans ${plural(Object.keys(b.supprimees).length, 'table', 'tables')}.`,
    `  - par table : ${Object.entries(b.supprimees).map(([t, n]) => `${t} ${n}`).join(', ')}`,
  ];
  if (Object.keys(b.ajustees).length) out.push(`  - lignes gardées ajustées : ${Object.entries(b.ajustees).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  out.push(`  - réglages remis à défaut : ${b.reglages.join(', ') || 'aucun'}`);
  if (b.amorcages.length) out.push(`  - amorçages reposés : ${b.amorcages.join(', ')}`);
  out.push(`Copie préalable : ${b.copie}${moteur === 'sqlite' ? ' (à garder jusqu’à la fin de la recette de janvier 2027, puis à supprimer : elle contient la démonstration)' : ''}.`);
  out.push(`Journal réduit à la seule ligne ${ACTION_PURGE_DEMO}. Prochain salarié : ${b.sequence.matricule}.`);
  out.push(`Pièces : ${plural(b.pieces.effaces, 'fichier effacé', 'fichiers effacés')}${b.pieces.echecs.length
    ? ` ; ${plural(b.pieces.echecs.length, 'fichier n’a pas pu être effacé', 'fichiers n’ont pas pu être effacés')} (${b.pieces.echecs.slice(0, 5).join(', ')}), à effacer à la main (noté au journal)` : ''}.`);
  if (b.copiesSupprimees.length || b.miroirRetires) {
    out.push(`Copies antérieures supprimées : ${b.copiesSupprimees.join(', ') || 'aucune'} ; ${plural(b.miroirRetires, 'fichier retiré', 'fichiers retirés')} du miroir des pièces.`);
  }
  const etapes = [
    'retirer CURSUS_DEMO, CURSUS_DEMO_PUBLIQUE, CURSUS_TODAY et CURSUS_INSECURE_COOKIE de l’environnement du service (le serveur refuse désormais de démarrer en démonstration sur cette base) ;',
    'poser un CURSUS_SECRET neuf (les sessions de la démonstration ne valent plus rien) ;',
    b.comptesGardes.length
      ? `comptes gardés (${b.comptesGardes.map(c => c.identifiant).join(', ')}) : vérifier leur profil, ou créer le premier administrateur RH avec npm run comptes -- admin <identifiant> ;`
      : 'créer le premier administrateur RH : npm run comptes -- admin <identifiant> ;',
    `prévenir Keystone, Vigie, Crucible, Codex et Matrix (journal unifié) : vider leurs copies des matricules EMP-0001 à ${matricule(Math.max(1, b.plusGrandId))} `
      + 'et des lignes de journal de Cursus antérieures à la purge ;',
    moteur === 'sqlite'
      ? 'supprimer les copies antérieures à la purge (--supprimer-copies-demo, puis copies distantes : docs/SAUVEGARDE.md) ; reprise Lucca (docs/DEPLOIEMENT.md, « Mise en service : reprise depuis Lucca »).'
      : 'faire marquer par Matrix les pg_dump antérieurs à la purge comme non restaurables en production ; reprise Lucca (docs/DEPLOIEMENT.md, « Mise en service : reprise depuis Lucca »).',
  ];
  out.push('Étapes suivantes :', ...etapes.map((e, i) => `  ${i + 1}. ${e}`));
  return out;
}
