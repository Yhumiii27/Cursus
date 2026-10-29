// Lecture complète de la base pour les tâches de fond (lot 8, chantier E, étape 2). Le passage du quart d'heure
// (`tachesEmails`, server/src/notifications.ts) enchaîne le relevé des intérimaires, l'annonce des délégations, le
// récapitulatif des échéances et les évaluations des formations : chacune relisait toute la base (jusqu'à quatre
// lectures complètes dans une même transaction, sous le verrou d'écriture). Elles partagent désormais une lecture faite
// au plus une fois par passage, à la demande de la première qui en a besoin (aucune si aucune n'a rien à faire), chacune
// dans sa propre transaction. Les écritures d'une tâche (relevé, annonce, relances notées) ne changent rien à ce que lisent
// les suivantes : elles relisent en base ce qui les concerne (relevés transmis, relances déjà notées).
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { donneesAction } from './cache-instantane.ts';
import { loadFull, todayIso } from './dataset.ts';
import type { Db } from './db.ts';

/** Lecture complète de la base pour un lecteur interne du service RH (tâche de fond). */
export type Lecture = (lecteur: CurrentUser) => Promise<Dataset>;

/** Lecture directe, à chaque appel (tâche appelée seule : action, essai, test). */
export const lectureDirecte = (db: Db): Lecture => async lecteur => await loadFull(db, lecteur);

/**
 * Lecture partagée d'un passage : la base est lue au premier appel (dans la transaction de la tâche qui appelle), puis
 * rendue telle quelle aux appels suivants avec leur lecteur. Une lecture échouée n'est pas gardée. `faites` : lectures
 * faites (0 ou 1 par passage réussi). `enTransaction` (tâches du quart d'heure, lot 10, chantier B) : le premier appel
 * est toujours fait dans la transaction d'une tâche ; il reprend alors, comme une action, la lecture partagée du cache de
 * l'instantané ou la dérive par le delta des lignes changées (`donneesAction`, server/src/cache-instantane.ts : même
 * état que `loadFull`, lu sous le verrou), au lieu de relire toute la base en tenant le verrou d'écriture ; sans cache
 * (CURSUS_CACHE_INSTANTANE=0), ou sans entrée de la même époque et du même jour, lecture complète comme avant.
 */
export function lecturePartagee(db: Db, o: { enTransaction?: boolean } = {}): Lecture & { faites: () => number } {
  let ds: Promise<Dataset> | null = null, faites = 0;
  const lire = async (lecteur: CurrentUser) => {
    if (!ds) {
      faites++;
      const p = o.enTransaction ? donneesAction(db, lecteur, todayIso(), async u => await loadFull(db, u)) : loadFull(db, lecteur);
      ds = p;
      p.catch(() => { if (ds === p) ds = null; });
    }
    return { ...await ds, user: lecteur };
  };
  return Object.assign(lire, { faites: () => faites });
}
