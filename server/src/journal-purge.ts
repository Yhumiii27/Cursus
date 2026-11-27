// Purge du journal des actions (conservation RGPD), seule voie qui en supprime des lignes (Norma § 4 : journal en ajout
// seul ; décision du propriétaire du 25 novembre 2026 : « ok pour la purge par rôle dédié sur Cursus »).
// - PostgreSQL : connexion propre, rôle dédié `cursus_purge` (CURSUS_PURGE_DATABASE_URL), qui appelle `purger_journal()`
//   (migration 0035_journal_ajout_seul) : la fonction supprime les seules lignes échues et inscrit le passage dans le
//   registre `journal_purges` ; le déclencheur du journal refuse toute autre modification, au rôle de l'application
//   compris. Sans la variable : purge désactivée (avertissement au démarrage), les lignes échues restent en base, masquées
//   à l'écran (server/src/journal.ts). Rôle, droits ou fonction absents : échec motivé, rien n'est supprimé.
// - SQLite (pas de rôles) : même règle, dans une transaction qui pose la garde `journal_purge_en_cours` ; le déclencheur
//   refuse toute suppression hors de cette garde et toute ligne non échue (server/src/db.ts, `poserJournalAjoutSeul`).
// Durées inchangées (shared/journal.ts) : 12 mois, 36 mois pour les actions liées à la paie, comptés depuis le début du jour.
import pg from 'pg';
import { ACTIONS_PAIE, CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_JOURNAL_MOIS } from '../../shared/journal.ts';
import type { Env } from './config.ts';
import type { Db } from './db.ts';

/** Rôle dédié à la purge du journal sur le serveur commun (créé par le socle de Matrix). */
export const ROLE_PURGE = 'cursus_purge';
/** Règle inscrite au registre (la même que celle de la fonction PostgreSQL). */
export const REGLE_PURGE = `${CONSERVATION_JOURNAL_MOIS} mois ; ${CONSERVATION_ARCHIVE_PAIE_MOIS} mois pour les actions liées à la paie (comptés depuis le début du jour)`;

export interface ResultatPurge {
  /** `faite` : passage inscrit au registre ; `desactivee` : serveur PostgreSQL sans CURSUS_PURGE_DATABASE_URL ; `echec` : rien supprimé. */
  statut: 'faite' | 'desactivee' | 'echec';
  /** Lignes hors paie de plus de 12 mois. */
  supprimees: number;
  /** Lignes de plus de 36 mois (archive de la paie comprise). */
  supprimeesArchive: number;
  /** Ligne du registre `journal_purges`. */
  registre: number | null;
  message?: string;
}

/**
 * Limites de conservation au début du jour UTC de `maintenant` : `journal` (12 mois) et `paie` (36 mois), en ISO. Les
 * mêmes que la purge et ses déclencheurs (SQLite : `'start of day', '-N months'` ; PostgreSQL : date_trunc('day') sur la
 * base en UTC), à un jour près le 29 février.
 */
export function limitesConservation(maintenant = new Date()): { journal: string; paie: string } {
  const a = maintenant.getUTCFullYear(), m = maintenant.getUTCMonth(), j = maintenant.getUTCDate();
  return {
    journal: new Date(Date.UTC(a, m - CONSERVATION_JOURNAL_MOIS, j)).toISOString(),
    paie: new Date(Date.UTC(a, m - CONSERVATION_ARCHIVE_PAIE_MOIS, j)).toISOString(),
  };
}

/** Ligne liée à la paie (archive de 3 ans), condition SQL commune aux deux moteurs sur la table `journal` (alias `t`). */
export const paieSql = (t = 'journal') =>
  `(${t}.paie = TRUE OR ${t}.action LIKE 'sage.%' OR ${t}.action IN (SELECT a.action FROM journal_actions_paie a))`;

/**
 * Codes des actions liées à la paie inscrits (jamais retirés) : une action ajoutée à ACTIONS_PAIE vaut aussi pour les
 * lignes déjà écrites, sans les modifier (remplace l'ancien `marquerPaie`). Renvoie le nombre de codes ajoutés.
 */
export async function inscrireActionsPaie(db: Db): Promise<number> {
  const deja = new Set((await db.query<{ action: string }>('SELECT action FROM journal_actions_paie')).map(r => r.action));
  const nouvelles = ACTIONS_PAIE.filter(a => !deja.has(a));
  if (!nouvelles.length) return 0;
  const depuis = new Date().toISOString();
  await db.tx(async () => {
    for (const a of nouvelles) {
      await db.run(db.moteur === 'pg'
        ? 'INSERT INTO journal_actions_paie (action, depuis) VALUES (?, ?) ON CONFLICT (action) DO NOTHING'
        : 'INSERT OR IGNORE INTO journal_actions_paie (action, depuis) VALUES (?, ?)', [a, depuis]);
    }
  });
  return nouvelles.length;
}

/**
 * Droits du rôle de purge sur le schéma de Cursus, ni plus ni moins : ceux que le socle de Matrix accorde sur le serveur
 * commun (demande docs/demandes/matrix-lot16-purge-journal.sql, `schema` = cursus, `base` = epc2i), et que les essais sur
 * PostgreSQL accordent à leur schéma (tests/base.ts). Lecture des seules colonnes que la règle examine, jamais le contenu.
 */
export function droitsPurgeSql(schema: string, base: string): string {
  const s = `"${schema}"`;
  return [
    `GRANT CONNECT ON DATABASE "${base}" TO ${ROLE_PURGE}`,
    `GRANT USAGE ON SCHEMA ${s} TO ${ROLE_PURGE}`,
    `GRANT SELECT (id, at, action, paie), DELETE ON ${s}.journal TO ${ROLE_PURGE}`,
    `GRANT SELECT ON ${s}.journal_actions_paie TO ${ROLE_PURGE}`,
    `GRANT INSERT, SELECT (id) ON ${s}.journal_purges TO ${ROLE_PURGE}`,
    `GRANT EXECUTE ON FUNCTION ${s}.purger_journal() TO ${ROLE_PURGE}`,
  ].join(';\n') + ';';
}

/** Adresse de connexion de la purge (rôle cursus_purge), ou null : purge désactivée sur le serveur PostgreSQL. */
export const urlPurge = (env: Env = process.env): string | null => (env.CURSUS_PURGE_DATABASE_URL ?? '').trim() || null;

/** Problèmes de configuration de la purge (contrôlés au démarrage, server/src/config.ts). */
export function problemesPurge(env: Env = process.env): string[] {
  const url = urlPurge(env);
  if (!url) return [];
  if (!/^postgres(ql)?:\/\/[^\s]+$/i.test(url) || !URL.canParse(url)) {
    return ['CURSUS_PURGE_DATABASE_URL n’est pas une adresse PostgreSQL valide : postgres://cursus_purge:<mot de passe>@<hôte>:5432/atrium.'];
  }
  if (!(env.DATABASE_URL ?? '').trim()) {
    return ['CURSUS_PURGE_DATABASE_URL est définie sans DATABASE_URL : sur une base SQLite, la purge du journal se fait dans Cursus, sans rôle dédié. Retirez-la.'];
  }
  const u = new URL(url);
  const role = u.searchParams.get('user') || decodeURIComponent(u.username);
  if (role !== ROLE_PURGE) {
    return [`CURSUS_PURGE_DATABASE_URL se connecte avec le rôle « ${role || 'aucun'} » : la purge du journal n’est admise que par le rôle ${ROLE_PURGE} (socle de Matrix), jamais par celui de l’application.`];
  }
  return [];
}

/**
 * Avertissement du démarrage : purge désactivée sur le serveur PostgreSQL, hors démonstration (données fictives, que la
 * purge de la démonstration masque ensuite derrière sa ligne `purge.demo`).
 */
export function avertissementsPurge(env: Env = process.env): string[] {
  return (env.DATABASE_URL ?? '').trim() && !urlPurge(env) && env.CURSUS_DEMO !== '1'
    ? [`CURSUS_PURGE_DATABASE_URL est absente : la purge du journal des actions (conservation de 12 mois, 36 mois pour la paie) est désactivée. Les lignes échues restent en base, masquées à l’écran, jusqu’à ce que le service informatique la définisse (rôle ${ROLE_PURGE}, docs/DEPLOIEMENT.md).`]
    : [];
}

/** Message clair d'un échec de la purge sur le serveur PostgreSQL (jamais l'adresse ni le mot de passe). */
export function messageEchecPg(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? '';
  if (code === '28P01' || code === '28000') return `connexion refusée au rôle ${ROLE_PURGE} (mot de passe ou rôle absent du socle de Matrix : init/01-base-et-roles.sql, CURSUS_PURGE_PASSWORD).`;
  if (code === '42883' || code === '3F000') return 'fonction purger_journal() absente : Cursus n’a pas appliqué sa migration 0035_journal_ajout_seul sur ce schéma.';
  if (code === '42501') return `droits du rôle ${ROLE_PURGE} incomplets (socle de Matrix, init/03-droits.sql, rejoué après la migration 0035 de Cursus) : ${e.message ?? ''}`;
  if (code === 'P0C02') return e.message ?? `connexion qui n’est pas celle du rôle ${ROLE_PURGE}.`;
  return e?.message ?? String(err);
}

/** Purge sur le serveur PostgreSQL, par la connexion du rôle dédié, dans le schéma de Cursus. */
async function purgerPg(url: string, schema: string): Promise<ResultatPurge> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`nom de schéma invalide : ${schema}`);
  const client = new pg.Client({ connectionString: url, application_name: 'cursus-purge-journal', options: `-c search_path=${schema}` });
  try {
    await client.connect();
    const { rows: [r] } = await client.query(`SELECT registre, supprimees_un_an, supprimees_trois_ans FROM "${schema}".purger_journal()`);
    return { statut: 'faite', supprimees: Number(r.supprimees_un_an), supprimeesArchive: Number(r.supprimees_trois_ans), registre: Number(r.registre) };
  } catch (err) {
    return { statut: 'echec', supprimees: 0, supprimeesArchive: 0, registre: null, message: messageEchecPg(err) };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Purge en SQLite : garde posée, lignes échues supprimées (le déclencheur refait le contrôle), passage inscrit. */
async function purgerSqlite(db: Db): Promise<ResultatPurge> {
  return await db.tx(async () => {
    const l = await db.one<{ un: string; trois: string; le: string }>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', 'start of day', '-${CONSERVATION_JOURNAL_MOIS} months') AS un,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now', 'start of day', '-${CONSERVATION_ARCHIVE_PAIE_MOIS} months') AS trois, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS le`);
    await db.run('INSERT INTO journal_purge_en_cours (cle) VALUES (1)');
    const parties = await db.query<{ at: string }>(`DELETE FROM journal WHERE at < ? OR (at < ? AND NOT ${paieSql()}) RETURNING at`, [l!.trois, l!.un]);
    await db.run('DELETE FROM journal_purge_en_cours');
    const dates = parties.map(p => p.at).sort();
    const trois = dates.filter(d => d < l!.trois).length;
    await db.run(`INSERT INTO journal_purges (le, par, regle, limite_journal, limite_paie, supprimees_un_an, supprimees_trois_ans, plus_ancienne, plus_recente)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [l!.le, 'cursus (SQLite)', REGLE_PURGE, l!.un, l!.trois, dates.length - trois, trois, dates[0] ?? null, dates.at(-1) ?? null]);
    const registre = (await db.one<{ id: number }>('SELECT MAX(id) AS id FROM journal_purges'))!.id;
    return { statut: 'faite' as const, supprimees: dates.length - trois, supprimeesArchive: trois, registre: Number(registre) };
  });
}

/**
 * Purge du journal des actions : SQLite dans Cursus ; PostgreSQL par le rôle dédié (désactivée sans
 * CURSUS_PURGE_DATABASE_URL). Jamais d'exception : un échec est rendu avec son message, rien n'est alors supprimé.
 */
export async function purgerJournal(db: Db, env: Env = process.env): Promise<ResultatPurge> {
  if (db.moteur === 'sqlite') {
    try {
      return await purgerSqlite(db);
    } catch (err) {
      return { statut: 'echec', supprimees: 0, supprimeesArchive: 0, registre: null, message: err instanceof Error ? err.message : String(err) };
    }
  }
  const url = urlPurge(env);
  if (!url) return { statut: 'desactivee', supprimees: 0, supprimeesArchive: 0, registre: null, message: avertissementsPurge({ DATABASE_URL: 'postgres' })[0] };
  return await purgerPg(url, (db as unknown as { schema: string }).schema);
}
