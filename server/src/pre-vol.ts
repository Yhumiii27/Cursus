// Pré-vol de la mise en production (lot 8, chantier B) : règles de `npm run verifier-production`
// (server/src/verifier-production.ts), testables sans lancer la commande (tests/pre-vol.test.ts). Chaque contrôle rend
// une ligne OK / ATTENTION / BLOQUANT, avec son remède ; aucun ne modifie quoi que ce soit.
// - Configuration : l'environnement de l'instance jugé comme en production (NODE_ENV=production forcé), règles de
//   démarrage de server/src/config.ts comprises, puis les exigences propres à la mise en service (variables de
//   démonstration absentes, rôle et base du serveur commun, TLS, connexion Microsoft, e-mails, supervision, fuseau,
//   secrets distincts).
// - Base : données (marqueur et indices de démonstration, administrateur RH, confidentialité, intégrité, dossier des
//   pièces) sur les deux moteurs ; rôle, schéma, droits, migrations, schéma conforme, vues pub_ et horloge sur le
//   serveur PostgreSQL commun, d'après les faits relevés en lecture seule par server/src/db-pg-lecture.ts.
// Codes de sortie de la commande : 0 conforme, 1 au moins un bloquant, 2 seulement des avertissements (1 avec --strict).
// Procédure de bascule : docs/BASCULE-PRODUCTION.md.
import { accessSync, constants, existsSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminsActifs } from './comptes.ts';
import {
  avertissementsConfig, BASE_COMMUNE, cibleBase, configMail, configOidc, type Env, originePublique, problemesConfig, ROLE_CURSUS, trustProxy,
} from './config.ts';
import { lireConfidentialite } from './confidentialite.ts';
import type { Db } from './db.ts';
import { controlerOrphelins } from './integrite.ts';
import { echeanceSecret, ALERTE_SECRET_JOURS } from './secret-microsoft.ts';
import { DOMAINE_DEMO } from './seed.ts';

export type Niveau = 'ok' | 'attention' | 'bloquant';
export type Domaine = 'configuration' | 'base';

export interface Controle {
  /** Code stable du contrôle (config.secrets, base.demo…), repris dans la sortie --json. */
  code: string;
  domaine: Domaine;
  niveau: Niveau;
  /** Constat, sans jamais de valeur secrète (mot de passe, clé, jeton). */
  message: string;
  /** Ce qu'il faut faire, quand le contrôle n'est pas OK. */
  remede?: string;
}

const PROCEDURE = 'docs/BASCULE-PRODUCTION.md';
/** Variables de démonstration et de test, absentes d'une instance de production. */
export const VARIABLES_DEMO = ['CURSUS_DEMO', 'CURSUS_DEMO_PUBLIQUE', 'CURSUS_DEMO_LIAISONS', 'CURSUS_TODAY', 'CURSUS_INSECURE_COOKIE', 'CURSUS_OIDC_AUTORITE'] as const;
/** Secrets qui doivent tous différer (jamais affichés : seuls leurs noms le sont). */
export const SECRETS = ['CURSUS_SECRET', 'KEYSTONE_API_KEY', 'KEYSTONE_TOKEN', 'CURSUS_SUPERVISION_TOKEN', 'MATRIX_TOKEN', 'CURSUS_OIDC_CLIENT_SECRET', 'CURSUS_MAIL_CLIENT_SECRET'] as const;
/** Paires admises à l'égalité : l'envoi des e-mails peut passer par l'application Entra de la connexion (même secret). */
const PAIRES_ADMISES = new Set(['CURSUS_OIDC_CLIENT_SECRET|CURSUS_MAIL_CLIENT_SECRET']);
/** Espace libre minimal du dossier des pièces justificatives. */
export const ESPACE_PIECES_MIN = 1024 ** 3;
/** Écart d'horloge admis entre Cursus et le serveur PostgreSQL. */
export const ECART_HORLOGE_MAX_MS = 60_000;
/** Délai de connexion au serveur PostgreSQL au-delà duquel la commande renonce. */
export const DELAI_CONNEXION_MS = 5_000;

const ok = (domaine: Domaine, code: string, message: string): Controle => ({ code, domaine, niveau: 'ok', message });
const ko = (domaine: Domaine, code: string, niveau: Exclude<Niveau, 'ok'>, message: string, remede?: string): Controle =>
  ({ code, domaine, niveau, message, ...(remede ? { remede } : {}) });

/**
 * Hôte du serveur PostgreSQL joint sans quitter la machine ou le réseau Docker : nom de service sans point
 * (epc2i-postgres), boucle locale, adresse privée. Ailleurs, la connexion doit être chiffrée (sslmode).
 */
export function hoteInterne(hote: string): boolean {
  const h = hote.toLowerCase();
  if (!h.includes('.') && !h.includes(':')) return true;
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return /^f[cd][0-9a-f]{2}:/.test(h);
}

/** Paires de secrets égaux (noms seulement), hors paires admises. */
export function secretsEgaux(env: Env): string[][] {
  const poses = SECRETS.filter(k => (env[k] ?? '').trim());
  const out: string[][] = [];
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      if (env[poses[i]]!.trim() === env[poses[j]]!.trim() && !PAIRES_ADMISES.has(`${poses[i]}|${poses[j]}`)) out.push([poses[i], poses[j]]);
    }
  }
  return out;
}

/**
 * Contrôles de configuration, jugés comme en production (NODE_ENV=production forcé) quel que soit l'endroit où la
 * commande est lancée. `aujourdhui` : date du jour (AAAA-MM-JJ, heure de Paris) pour l'échéance du secret Microsoft.
 */
export function controlesConfig(envBrut: Env, aujourdhui: string): Controle[] {
  const env: Env = { ...envBrut, NODE_ENV: 'production' };
  const C = 'configuration' as const;
  const out: Controle[] = [];
  const pbs = problemesConfig(env);
  if (pbs.length) for (const p of pbs) out.push(ko(C, 'config.demarrage', 'bloquant', p, 'Corrigez la variable : en production, le serveur refuse de démarrer (voir .env.example).'));
  else out.push(ok(C, 'config.demarrage', 'Règles de démarrage en production : aucune configuration refusée.'));
  for (const a of avertissementsConfig(env)) out.push(ko(C, 'config.avertissement', 'attention', a));

  const demo = VARIABLES_DEMO.filter(k => (env[k] ?? '').trim());
  out.push(demo.length
    ? ko(C, 'config.demo', 'bloquant', `Variables de démonstration ou de test présentes : ${demo.join(', ')}.`, `Retirez-les de l’application avant la mise en service (${PROCEDURE}).`)
    : ok(C, 'config.demo', 'Aucune variable de démonstration ni de test.'));

  // Serveur commun : rôle cursus_app, base epc2i, connexion chiffrée hors du réseau Docker.
  const cible = cibleBase(env);
  if (!(env.DATABASE_URL ?? '').trim()) {
    out.push(ko(C, 'config.base', 'attention', 'DATABASE_URL absente : base SQLite locale (fichier), que les autres outils du groupe ne voient pas.',
      'La production cible le serveur PostgreSQL commun : DATABASE_URL=postgres://cursus_app:<mot de passe>@epc2i-postgres:5432/epc2i.'));
  } else if (cible) {
    out.push(cible.role === ROLE_CURSUS
      ? ok(C, 'config.base.role', `DATABASE_URL : rôle ${ROLE_CURSUS}.`)
      : ko(C, 'config.base.role', 'bloquant', `DATABASE_URL se connecte avec le rôle « ${cible.role || '(aucun)'} » au lieu de ${ROLE_CURSUS}.`, `Utilisez le rôle ${ROLE_CURSUS} créé par le socle du serveur commun.`));
    out.push(cible.base === BASE_COMMUNE
      ? ok(C, 'config.base.nom', `DATABASE_URL : base ${BASE_COMMUNE}.`)
      : ko(C, 'config.base.nom', 'bloquant', `DATABASE_URL désigne la base « ${cible.base || '(aucune)'} » au lieu de ${BASE_COMMUNE}.`, `Désignez la base ${BASE_COMMUNE} du serveur commun (schéma cursus).`));
    // Chiffrement lu comme node-postgres : sslmode, ssl=true ou PGSSLMODE (cibleBase).
    out.push(hoteInterne(cible.hote) || cible.tls
      ? ok(C, 'config.base.tls', cible.tls ? `Connexion au serveur chiffrée (${cible.tls}).` : `Serveur joint sur le réseau interne (${cible.hote}).`)
      : ko(C, 'config.base.tls', 'bloquant', `Le serveur PostgreSQL ${cible.hote} est joint hors du réseau Docker sans connexion chiffrée : le mot de passe et les données passeraient en clair.`,
        'Ajoutez ?sslmode=require (ou verify-full) à DATABASE_URL, ou joignez le serveur par le réseau interne (epc2i-postgres).'));
  }

  // Adresse publique, quelle que soit l'adresse d'écoute : une instance de production derrière Caddy écoute sur la boucle
  // locale (exemptée au démarrage pour l'application de bureau), mais ses e-mails et son contrôle d'origine en ont besoin.
  const publique = (env.CURSUS_PUBLIC_URL ?? '').trim();
  const origine = publique ? originePublique(publique) : null;
  out.push(origine?.startsWith('https://')
    ? ok(C, 'config.public-url', `Adresse publique : ${origine}.`)
    : ko(C, 'config.public-url', 'bloquant', publique ? 'CURSUS_PUBLIC_URL n’est pas une adresse https sans chemin.' : 'CURSUS_PUBLIC_URL est absente : liens des e-mails impossibles, et le contrôle d’origine des requêtes retombe sur l’en-tête Host relayé par le proxy.',
      'Posez l’adresse publique de Cursus, en https et sans chemin (https://cursus.entreprise.fr), même quand Cursus écoute sur la boucle locale derrière un proxy.'));

  out.push(configOidc(env)
    ? ok(C, 'config.oidc', 'Connexion Microsoft 365 configurée.')
    : ko(C, 'config.oidc', 'attention', 'Connexion Microsoft 365 non configurée : seuls les comptes Cursus (identifiant et mot de passe) se connectent.', 'Inscription Entra et variables : docs/CONNEXION-MICROSOFT.md.'));
  out.push(configMail(env)
    ? ok(C, 'config.mail', 'Envoi des e-mails par Microsoft Graph configuré.')
    : ko(C, 'config.mail', 'attention', 'E-mails en simulation : CURSUS_MAIL_FROM absente (ou application Entra incomplète), rien ne part.', 'Boîte d’envoi et autorisation Mail.Send : docs/EMAILS.md.'));
  if (configOidc(env)) {
    const e = echeanceSecret(aujourdhui, env);
    if (!e) out.push(ko(C, 'config.secret-oidc', 'attention', 'CURSUS_OIDC_SECRET_EXPIRE absente : Cursus ne préviendra pas avant l’expiration du secret client Entra.', 'Relevez la date dans Entra (Certificats & secrets) et posez-la (AAAA-MM-JJ).'));
    else if (e.jours < 0) out.push(ko(C, 'config.secret-oidc', 'bloquant', `Le secret client Entra a expiré le ${e.expireLe} : plus aucune connexion Microsoft ne passe.`, 'Créez un nouveau secret dans Entra, puis remplacez CURSUS_OIDC_CLIENT_SECRET et CURSUS_OIDC_SECRET_EXPIRE.'));
    else if (e.jours <= ALERTE_SECRET_JOURS) out.push(ko(C, 'config.secret-oidc', 'attention', `Le secret client Entra expire le ${e.expireLe} (dans ${e.jours} jour${e.jours > 1 ? 's' : ''}).`, 'Renouvelez-le avant la mise en service.'));
    else out.push(ok(C, 'config.secret-oidc', `Secret client Entra valable jusqu’au ${e.expireLe} (${e.jours} jours).`));
  }
  out.push((env.CURSUS_SUPERVISION_TOKEN ?? '').trim()
    ? ok(C, 'config.supervision', 'Jeton de supervision posé (détail de /api/health).')
    : ko(C, 'config.supervision', 'attention', 'CURSUS_SUPERVISION_TOKEN absente : à travers le proxy, /api/health ne donne que l’état, sans le détail.', 'Posez un jeton aléatoire (openssl rand -hex 32), partagé avec l’outil de supervision.'));
  out.push(env.TZ === 'Europe/Paris'
    ? ok(C, 'config.fuseau', 'Fuseau Europe/Paris.')
    : ko(C, 'config.fuseau', 'attention', `Fuseau ${env.TZ ? `« ${env.TZ} »` : 'non posé'} : les dates du jour restent calculées à l’heure de Paris, mais les heures des journaux du système suivraient ce fuseau.`, 'Posez TZ=Europe/Paris (déjà dans l’image Docker).'));
  const egaux = secretsEgaux(env);
  out.push(egaux.length
    ? ko(C, 'config.secrets', 'bloquant', `Secrets identiques : ${egaux.map(p => p.join(' = ')).join(' ; ')}.`, 'Générez une valeur distincte pour chacun (openssl rand -hex 32) : une fuite de l’un ne doit pas ouvrir les autres.')
    : ok(C, 'config.secrets', 'Secrets tous différents entre eux.'));
  const proxy = String(trustProxy(env));
  out.push(/uniquelocal/.test(proxy)
    ? ko(C, 'config.proxy', 'attention', `CURSUS_TRUST_PROXY=${proxy} : les en-têtes X-Forwarded-* de tout conteneur du réseau privé sont crus (adresse du client falsifiable).`,
      'Indiquez l’adresse ou le sous-réseau du proxy Traefik de Coolify, relevé au déploiement.')
    : ok(C, 'config.proxy', `Proxys crus : ${proxy}.`));
  if ((env.MATRIX_URL ?? '').trim() && !(env.MATRIX_TOKEN ?? '').trim()) {
    out.push(ko(C, 'config.matrix', 'attention', 'MATRIX_URL est définie sans MATRIX_TOKEN : la déclaration à Matrix partirait sans jeton.', 'Posez le jeton partagé avec Matrix (MATRIX_TOKEN).'));
  }
  return out;
}

// — Base —

/**
 * Indices d'une base remplie par le jeu de démonstration (server/src/seed.ts) : réglage `demo` (contrat commun avec le
 * chantier A du lot 8, écrit par seedDemo), comptes créés par le jeu, adresses du domaine de démonstration, lot de paie
 * historique « Démonstration ». Faisceau repris des règles de la purge (server/src/purge-demo.ts, chantier A) : à y
 * rattacher à la fusion. Rend la liste des indices trouvés (nombres seulement), vide pour une base propre.
 */
export async function indicesDemo(db: Db): Promise<string[]> {
  const out: string[] = [];
  const marqueur = await db.getSetting<{ chargeeLe?: string } | null>('demo', null);
  if (marqueur) out.push(`réglage demo (jeu chargé${marqueur.chargeeLe ? ` le ${marqueur.chargeeLe.slice(0, 10)}` : ''})`);
  const nombre = async (sql: string, params: string[] = []) => Number((await db.one<{ n: number }>(sql, params))?.n ?? 0);
  const comptes = await nombre(`SELECT COUNT(*) AS n FROM comptes WHERE cree_par = 'Jeu de démonstration'`);
  if (comptes) out.push(`${comptes} compte${comptes > 1 ? 's' : ''} du jeu de démonstration`);
  const domaine = `%@${DOMAINE_DEMO}`;
  const fiches = await nombre('SELECT COUNT(*) AS n FROM employes WHERE email LIKE ?', [domaine]);
  if (fiches) out.push(`${fiches} fiche${fiches > 1 ? 's' : ''} à une adresse @${DOMAINE_DEMO}`);
  const identifiants = await nombre('SELECT COUNT(*) AS n FROM comptes WHERE identifiant LIKE ? OR adresse LIKE ?', [domaine, domaine]);
  if (identifiants && !comptes) out.push(`${identifiants} compte${identifiants > 1 ? 's' : ''} à une adresse @${DOMAINE_DEMO}`);
  const lots = await nombre(`SELECT COUNT(*) AS n FROM lots_paie WHERE auteur = 'Démonstration'`);
  if (lots) out.push(`lot de paie historique « Démonstration »`);
  return out;
}

/** Faits relevés sur le serveur PostgreSQL, en lecture seule (server/src/db-pg-lecture.ts). */
export interface FaitsServeur {
  utilisateur: string;
  superutilisateur: boolean;
  schemaCourant: string | null;
  /** Droit CREATE sur la base (schémas) : jamais pour cursus_app (le socle crée le schéma). */
  creerDansBase: boolean;
  /** Membre de pg_read_all_data ou pg_write_all_data : lirait ou écrirait les autres outils. */
  droitsGlobaux: string[];
  /** Migrations notées dans schema_migrations ; null si le journal n'existe pas encore (schéma jamais migré). */
  migrations: string[] | null;
  /** Écart au code de TABLES (message du contrôle du schéma), null si le schéma est conforme. */
  schemaIncomplet: string | null;
  /** Colonnes des vues pub_ du schéma, dans leur ordre. */
  vues: Record<string, string[]>;
  /** Heure du serveur moins heure de Cursus, en millisecondes. */
  ecartHorlogeMs: number;
  dureeConnexionMs: number;
}

export interface OptionsBase {
  /** Faits du serveur PostgreSQL ; null pour un fichier SQLite (contrôles du serveur commun sans objet). */
  serveur: FaitsServeur | null;
  /** Migrations PostgreSQL du code (nom et texte, migrationsPg de server/src/db-pg.ts). */
  migrations: { nom: string; sql: string }[];
  /** Dossier des pièces justificatives de l'installation. */
  dossierPieces: string;
  /** Rôle et schéma attendus (cursus_app, cursus) ; remplacés par les tests. */
  role?: string;
  schema?: string;
  /** Espace libre du dossier, en octets (statfs ; remplacé par les tests). */
  espaceLibre?: (dossier: string) => number;
}

/**
 * Colonnes attendues des vues pub_, lues dans la dernière définition de chaque vue parmi les migrations (dans leur
 * ordre) : le contrat suit ainsi les avenants (CREATE OR REPLACE VIEW, DROP VIEW puis CREATE VIEW) sans liste à tenir à
 * jour. Colonne : alias après le dernier AS de premier niveau, sinon dernier identifiant (e.matricule → matricule).
 */
export function vuesAttendues(migrations: readonly { nom: string; sql: string }[]): Record<string, string[]> {
  const vues: Record<string, string[]> = {};
  for (const m of migrations) {
    const sql = m.sql.replace(/--[^\n]*/g, '');
    const re = /\b(CREATE(?:\s+OR\s+REPLACE)?\s+VIEW|DROP\s+VIEW(?:\s+IF\s+EXISTS)?)\s+(?:"?\w+"?\.)?"?(pub_\w+)"?/gi;
    for (let r = re.exec(sql); r; r = re.exec(sql)) {
      if (/^DROP/i.test(r[1])) { delete vues[r[2]]; continue; }
      const fin = sql.indexOf(';', r.index);
      vues[r[2]] = colonnesSelect(sql.slice(r.index, fin < 0 ? undefined : fin));
    }
  }
  return vues;
}

/** Positions des caractères d'un texte SQL hors chaînes et parenthèses, avec leur profondeur d'imbrication. */
function premierNiveau(sql: string): { i: number; profondeur: number }[] {
  const out: { i: number; profondeur: number }[] = [];
  let p = 0, chaine = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") chaine = !chaine;
    if (chaine) continue;
    if (c === '(') p++;
    else if (c === ')') p--;
    else out.push({ i, profondeur: p });
  }
  return out;
}

/** Noms des colonnes de la liste SELECT principale (hors WITH) d'une définition de vue. */
export function colonnesSelect(definition: string): string[] {
  const niveaux = premierNiveau(definition);
  const auNiveau0 = (motif: RegExp, depuis: number) => {
    for (const n of niveaux) if (n.i >= depuis && n.profondeur === 0 && motif.test(definition.slice(n.i, n.i + 8)) && !/\w/.test(definition[n.i - 1] ?? '')) return n.i;
    return -1;
  };
  const select = auNiveau0(/^SELECT\b/i, 0);
  const from = auNiveau0(/^FROM\b/i, select + 6);
  if (select < 0) return [];
  const liste = definition.slice(select + 6, from < 0 ? undefined : from);
  const virgules = premierNiveau(liste).filter(n => n.profondeur === 0 && liste[n.i] === ',').map(n => n.i);
  const morceaux: string[] = [];
  let debut = 0;
  for (const v of [...virgules, liste.length]) { morceaux.push(liste.slice(debut, v).trim()); debut = v + 1; }
  return morceaux.filter(Boolean).map(m => {
    const alias = /\bAS\s+"?(\w+)"?\s*$/i.exec(m);
    if (alias) return alias[1];
    return /"?(\w+)"?\s*$/.exec(m)?.[1] ?? m;
  });
}

/** Dossier existant le plus proche (le dossier des pièces est créé au premier dépôt). */
function existant(dossier: string): string {
  let d = dossier;
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  return d;
}

const espaceStatfs = (dossier: string) => { const s = statfsSync(dossier); return Number(s.bavail) * Number(s.bsize); };
const go = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;

/** Contrôles de la base ouverte en lecture seule (aucune écriture : ni migration, ni journal). */
export async function controlerBase(db: Db, opts: OptionsBase): Promise<Controle[]> {
  const B = 'base' as const;
  const out: Controle[] = [];
  const role = opts.role ?? ROLE_CURSUS, schema = opts.schema ?? 'cursus';
  const s = opts.serveur;
  if (s) {
    out.push(ok(B, 'base.connexion', `Serveur PostgreSQL joint en ${s.dureeConnexionMs} ms.`));
    out.push(s.utilisateur === role && !s.superutilisateur
      ? ok(B, 'base.role', `Connecté en ${role}.`)
      : ko(B, 'base.role', 'bloquant', `Connecté en « ${s.utilisateur} »${s.superutilisateur ? ' (superutilisateur)' : ''} au lieu de ${role}.`, `DATABASE_URL doit utiliser le rôle ${role} du socle.`));
    out.push(s.schemaCourant === schema
      ? ok(B, 'base.schema', `Schéma courant : ${schema}.`)
      : ko(B, 'base.schema', 'bloquant', `Schéma courant : ${s.schemaCourant ?? 'aucun'} au lieu de ${schema} (search_path, ou schéma absent).`, 'Le schéma est créé par le socle de Matrix (02-schemas.sql), jamais par Cursus.'));
    const droits = [...(s.creerDansBase ? ['CREATE sur la base'] : []), ...s.droitsGlobaux, ...(s.superutilisateur ? ['superutilisateur'] : [])];
    out.push(droits.length
      ? ko(B, 'base.droits', 'bloquant', `Droits en trop pour ${s.utilisateur} : ${droits.join(', ')}.`, 'Rejouez les droits du socle (90-droits.sql de Matrix) : cursus_app n’écrit que dans son schéma.')
      : ok(B, 'base.droits', `Aucun droit en dehors du schéma ${schema} (ni CREATE sur la base, ni lecture globale).`));
    const code = opts.migrations.map(m => m.nom);
    const faites = s.migrations ?? [];
    const attente = code.filter(n => !faites.includes(n)), inconnues = faites.filter(n => !code.includes(n));
    if (inconnues.length) out.push(ko(B, 'base.migrations', 'bloquant', `Migrations inconnues de cette version : ${inconnues.join(', ')} (base mise à jour par une version plus récente).`, 'Déployez la version qui les a appliquées, ou restaurez la sauvegarde du schéma.'));
    else if (attente.length) out.push(ko(B, 'base.migrations', 'attention', `${attente.length} migration${attente.length > 1 ? 's' : ''} en attente (${attente.join(', ')}) : appliquée${attente.length > 1 ? 's' : ''} au prochain démarrage.`, 'Faites le pg_dump --schema=cursus avant de démarrer cette version.'));
    else out.push(ok(B, 'base.migrations', `Migrations à jour (${code.length}).`));
    if (!attente.length && !inconnues.length) {
      out.push(s.schemaIncomplet
        ? ko(B, 'base.schema-conforme', 'bloquant', `Schéma non conforme au code : ${s.schemaIncomplet}`)
        : ok(B, 'base.schema-conforme', 'Tables et colonnes conformes au code.'));
      const attendues = vuesAttendues(opts.migrations);
      const ecarts: string[] = [];
      for (const [vue, cols] of Object.entries(attendues).sort(([a], [b]) => a.localeCompare(b))) {
        const reelles = s.vues[vue];
        if (!reelles) { ecarts.push(`${vue} absente`); continue; }
        const manquantes = cols.filter(c => !reelles.includes(c));
        if (manquantes.length) ecarts.push(`${vue} sans ${manquantes.join(', ')}`);
        else if (cols.some((c, i) => reelles[i] !== c)) ecarts.push(`${vue} : colonnes dans un autre ordre`);
      }
      out.push(ecarts.length
        ? ko(B, 'base.vues', 'bloquant', `Vues publiées non conformes au contrat : ${ecarts.join(' ; ')}.`, 'Rejouez la migration, puis le partage (20-cursus.sql et 90-droits.sql de Matrix).')
        : ok(B, 'base.vues', `Vues publiées conformes (${Object.keys(attendues).length}).`));
    }
    out.push(Math.abs(s.ecartHorlogeMs) <= ECART_HORLOGE_MAX_MS
      ? ok(B, 'base.horloge', 'Horloge alignée avec le serveur PostgreSQL.')
      : ko(B, 'base.horloge', 'attention', `Horloge décalée de ${Math.round(Math.abs(s.ecartHorlogeMs) / 1000)} s avec le serveur PostgreSQL.`, 'Synchronisez l’heure des machines (NTP).'));
    // Schéma jamais migré (application créée, pas encore démarrée) : rien à lire, les données se contrôlent après le
    // premier démarrage.
    if (s.migrations === null) {
      out.push(ko(B, 'base.donnees', 'attention', 'Schéma sans tables : Cursus n’y a jamais démarré. Données à contrôler après le premier démarrage.', 'Relancez la commande une fois l’instance démarrée.'));
      return out;
    }
  } else {
    out.push(ko(B, 'base.moteur', 'attention', 'Base SQLite (fichier) : contrôles du serveur commun (rôle, droits, migrations, vues pub_) sans objet.'));
  }
  try {
    out.push(...await controlesDonnees(db, opts));
  } catch (err) {
    // Migrations en attente : colonnes absentes, lecture impossible avant le démarrage de cette version.
    const attente = !!s && opts.migrations.some(m => !(s.migrations ?? []).includes(m.nom));
    out.push(ko(B, 'base.donnees', attente ? 'attention' : 'bloquant', `Données illisibles (${err instanceof Error ? err.message : String(err)}).`,
      attente ? 'Relancez la commande après le démarrage de cette version (migrations appliquées).' : 'Vérifiez le schéma (npm run verifier-production après le démarrage).'));
  }
  return out;
}

/** Contrôles des données : démonstration, administrateur RH, confidentialité, intégrité, dossier des pièces. */
async function controlesDonnees(db: Db, opts: OptionsBase): Promise<Controle[]> {
  const B = 'base' as const;
  const out: Controle[] = [];
  const indices = await indicesDemo(db);
  out.push(indices.length
    ? ko(B, 'base.demo', 'bloquant', `Données de démonstration présentes : ${indices.join(', ')}.`, `Videz la base (npm run purge-demo), ou repartez d’un schéma neuf (${PROCEDURE}).`)
    : ok(B, 'base.demo', 'Aucune donnée de démonstration (réglage demo absent, aucun indice du jeu fictif).'));
  const admins = await adminsActifs(db);
  out.push(admins
    ? ok(B, 'base.admin', `${admins} administrateur${admins > 1 ? 's' : ''} RH actif${admins > 1 ? 's' : ''}.`)
    : ko(B, 'base.admin', 'bloquant', 'Aucun administrateur RH actif : personne ne peut ouvrir l’espace RH.', 'npm run comptes -- admin <identifiant> (docs/DEPLOIEMENT.md).'));
  const conf = await lireConfidentialite(db);
  const manque = [...(conf.responsable ? [] : ['responsable du traitement']), ...(conf.dpo ? [] : ['DPO'])];
  out.push(manque.length
    ? ko(B, 'base.confidentialite', 'attention', `Page Confidentialité incomplète : ${manque.join(' et ')} non renseigné${manque.length > 1 ? 's' : ''}.`, 'Paramètres → Confidentialité (administrateur RH), avant l’ouverture aux salariés.')
    : ok(B, 'base.confidentialite', 'Responsable du traitement et DPO renseignés.'));
  const integrite = await controlerOrphelins(db);
  out.push(integrite.orphelins
    ? ko(B, 'base.integrite', 'bloquant', `${integrite.orphelins} référence${integrite.orphelins > 1 ? 's' : ''} orpheline${integrite.orphelins > 1 ? 's' : ''} : ${Object.entries(integrite.parReference).map(([k, n]) => `${k} : ${n}`).join(', ')}.`,
      'Examinez-les avant la mise en service (docs/DEPLOIEMENT.md, « Exploitation courante »).')
    : ok(B, 'base.integrite', 'Aucune référence orpheline.'));

  // Dossier des pièces : accessible en écriture au compte du service, assez d'espace libre.
  const dossier = existant(opts.dossierPieces);
  let ecriture = true;
  try { accessSync(dossier, constants.W_OK); } catch { ecriture = false; }
  if (!ecriture) {
    out.push(ko(B, 'base.pieces', 'bloquant', `Dossier des pièces ${opts.dossierPieces} non accessible en écriture (${dossier}).`, 'Rendez-le au compte du service (volume /data dans l’image).'));
  } else {
    const libre = (opts.espaceLibre ?? espaceStatfs)(dossier);
    out.push(libre < ESPACE_PIECES_MIN
      ? ko(B, 'base.pieces', 'attention', `Dossier des pièces ${opts.dossierPieces} : ${go(libre)} libres, moins de 1 Go.`, 'Agrandissez le volume avant d’activer les pièces justificatives.')
      : ok(B, 'base.pieces', `Dossier des pièces ${opts.dossierPieces} accessible en écriture, ${go(libre)} libres.`));
  }
  return out;
}

// — Bilan —

/** Code de sortie : 0 conforme, 1 au moins un bloquant (ou un avertissement avec --strict), 2 avertissements seulement. */
export function codeSortie(controles: readonly Controle[], strict = false): 0 | 1 | 2 {
  if (controles.some(c => c.niveau === 'bloquant')) return 1;
  if (controles.some(c => c.niveau === 'attention')) return strict ? 1 : 2;
  return 0;
}

const ETIQUETTE: Record<Niveau, string> = { ok: 'OK', attention: 'ATTENTION', bloquant: 'BLOQUANT' };
const TITRE: Record<Domaine, string> = { configuration: 'Configuration', base: 'Base' };

/** Rapport en texte, une ligne par contrôle (puis son remède), regroupé par domaine, et bilan. */
export function rapportTexte(controles: readonly Controle[], entete: string, strict = false): string {
  const lignes = [entete];
  for (const d of ['configuration', 'base'] as Domaine[]) {
    const liste = controles.filter(c => c.domaine === d);
    if (!liste.length) continue;
    lignes.push('', TITRE[d]);
    for (const c of liste) {
      lignes.push(`  ${ETIQUETTE[c.niveau].padEnd(9)}  ${c.message}`);
      if (c.remede) lignes.push(`             → ${c.remede}`);
    }
  }
  const n = (v: Niveau) => controles.filter(c => c.niveau === v).length;
  const code = codeSortie(controles, strict);
  lignes.push('', `Bilan : ${n('bloquant')} bloquant${n('bloquant') > 1 ? 's' : ''}, ${n('attention')} avertissement${n('attention') > 1 ? 's' : ''}, ${n('ok')} OK`
    + ` — ${code === 0 ? 'prête pour la production' : code === 1 ? 'pas prête pour la production' : 'à revoir avant la production'} (code ${code}). Procédure : ${PROCEDURE}.`);
  return lignes.join('\n');
}
