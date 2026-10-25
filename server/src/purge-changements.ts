// Journal des changements en base (lot 9, chantier 1, étape 2) : purge planifiée et changement d'époque, sur les deux
// moteurs. La table `changements` (migration PostgreSQL 0014_changements, déclencheurs `revision2_*` de
// SqliteDb.poserRevision) reçoit une ligne par ligne écrite : sans purge, elle grossirait sans fin.
// - `purgerChangements` (tâches du quart d'heure, `tachesEmails` de server/src/notifications.ts) efface les changements
//   des révisions anciennes et pose `revision.purge` à la plus haute révision effacée : un écart qui part d'en deçà est
//   inconnu, et `Db.lireChangements` rend null (l'appelant relit tout). Elle garde toujours au moins une heure et
//   `GARDE_REVISIONS` révisions de changements sur PostgreSQL ; sur SQLite (une seule instance), `GARDE_REVISIONS`
//   révisions seulement, sans attendre un relevé d'une heure.
// - `changerEpoque` (commande `npm run revision:epoque`, server/src/revision-epoque-cli.ts) change l'époque de la base :
//   tout écart qui la traverse est inconnu, dans toutes les instances. À lancer après un rechargement des données seules
//   (pg_restore --data-only), qui garde l'OID de la table `revision` et remet l'ancienne époque (docs/SAUVEGARDE.md).
//   Elle ne fait relire que les instances dont le cache compare l'époque (cache incrémental, chantier 2 du lot 9) :
//   le cache de l'instantané tel qu'il est avant ce chantier n'a pour clé que la révision et le jour, et seul le
//   redémarrage des instances le vide.
import type { Db } from './db.ts';

/** Durée minimale de changements gardés au journal : une heure. */
export const GARDE_MS = 60 * 60_000;
/** Nombre minimal de révisions de changements gardées au journal. */
export const GARDE_REVISIONS = 20_000;

/**
 * Révisions relevées par cette instance à chaque passage (heure, révision de la base), par base : la révision courante il
 * y a au moins `GARDE_MS` donne la borne de la purge. La table `changements` ne porte pas d'heure (aucune colonne
 * de plus que 0014) : sans relevé assez ancien (instance démarrée depuis moins d'une heure), rien n'est purgé. Chaque
 * instance tient ses propres relevés ; la purge ne recule jamais (`purge` ne fait que croître), quelle que soit
 * l'instance qui la fait.
 */
const releves = new WeakMap<Db, { t: number; n: number }[]>();

/** Issue d'un passage de la purge : révision jusqu'à laquelle le journal est purgé (null : rien à purger), lignes effacées. */
export interface Purge { jusqua: number | null; lignes: number }

/**
 * Purge du journal des changements, dans une transaction (verrou d'écriture : la révision lue est celle de la base, et
 * la purge passe entre deux écritures). Borne : la plus petite de la révision relevée il y a au moins `GARDE_MS` et de
 * la révision courante moins `GARDE_REVISIONS`. N'écrit que dans `revision` et `changements`, sans déclencheur de
 * révision : le cache de l'instantané n'est pas périmé, seuls les écarts partis d'en deçà de la borne le sont.
 * `uneInstance` (par défaut sur SQLite : un seul processus sert la base, et son cache en mémoire se perd au
 * redémarrage) : borne à la révision courante moins `GARDE_REVISIONS`, sans relevé d'une heure. Les relevés repartent
 * à zéro à chaque démarrage : sans cela, une base dont le service ne reste jamais une heure en marche (app de bureau,
 * sessions courtes) ne serait jamais purgée. Sur PostgreSQL, l'heure protège les caches des autres instances.
 */
export async function purgerChangements(db: Db, maintenant = Date.now(), uneInstance = db.moteur === 'sqlite'): Promise<Purge> {
  return await db.tx(async () => {
    const etat = await db.etatRevision();
    let borne = etat.n - GARDE_REVISIONS;
    if (!uneInstance) {
      const liste = releves.get(db) ?? [];
      releves.set(db, liste);
      liste.push({ t: maintenant, n: etat.n });
      // Relevé le plus récent qui a au moins `GARDE_MS` ; les plus anciens ne serviront plus.
      let i = -1;
      for (let k = 0; k < liste.length; k++) if (liste[k].t <= maintenant - GARDE_MS) i = k;
      if (i < 0) return { jusqua: null, lignes: 0 };
      liste.splice(0, i);
      borne = Math.min(liste[0].n, borne);
    }
    if (borne <= etat.purge) return { jusqua: null, lignes: 0 };
    await db.run('UPDATE revision SET purge = ? WHERE purge < ?', [borne, borne]);
    const { changes } = await db.run('DELETE FROM changements WHERE n <= ?', [borne]);
    return { jusqua: borne, lignes: changes };
  });
}

/**
 * Nouvelle époque de la base (`revision.epoque`) : l'heure en millisecondes, toujours au-delà de l'ancienne valeur. Rend
 * l'époque lue avant et après (`Db.etatRevision` : OID de la table `revision` compris sur PostgreSQL). N'augmente pas la
 * révision : le changement d'époque suffit à faire relire tout aux instances dont le cache compare l'époque (cache
 * incrémental du chantier 2) ; sans lui, seul le redémarrage des instances fait relire tout.
 */
export async function changerEpoque(db: Db, maintenant = Date.now()): Promise<{ avant: number; apres: number }> {
  return await db.tx(async () => {
    const avant = await db.etatRevision();
    const colonne = Number((await db.one<{ epoque: number }>('SELECT epoque FROM revision'))?.epoque ?? 0);
    await db.run('UPDATE revision SET epoque = ?', [Math.max(maintenant, colonne + 1)]);
    return { avant: avant.epoque, apres: (await db.etatRevision()).epoque };
  });
}
