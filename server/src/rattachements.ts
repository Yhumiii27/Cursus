// Site (D14) et unité (D15) de rattachement des fiches (lot 11, chantier C1, étape 2 ; shared/rules/entites.ts,
// `rattachementSalarie`) : employes.site_code et employes.unite_code, publiés à Matrix par pub_salaries
// (0002_partage.sql), sont tirés de l'équipe du salarié (son site ou celui d'une équipe au-dessus, à défaut celui de son
// entité ; son unité ou celle d'une équipe au-dessus). Ils ne se saisissent pas : ils sont recalculés à chaque affectation
// et à chaque changement qui les déplace (site, unité ou entité d'une équipe, équipe parente, site d'une entité,
// suppression d'une équipe, reprise de Lucca), dans la transaction de l'action, puis au démarrage (base existante).
// Seules les fiches dont la valeur change sont écrites : une action sans effet ne touche à rien. Aucun journal propre :
// la cause (affectation, rattachement) y figure déjà ; ce sont des données d'organisation, pas des données personnelles
// au-delà de l'équipe, déjà transmise à tous.
import { rattachementSalarie } from '../../shared/rules/entites.ts';
import type { Entite, Equipe } from '../../shared/types.ts';
import type { Db } from './db.ts';

interface LigneRattachement { id: number; equipe: string | null; siteCode: string | null; uniteCode: string | null }

/**
 * Recalcule le site et l'unité de toutes les fiches d'après les équipes et les entités enregistrées (lues dans la base,
 * donc après les écritures de l'action en cours). Rend le nombre de fiches mises à jour.
 */
export async function recalerRattachements(db: Db): Promise<number> {
  const equipes = await db.all<Equipe>('equipes');
  const entites = await db.all<Entite>('entites');
  // Quatre colonnes seulement : la fiche entière (santé, contrat) n'a rien à faire ici.
  const lignes = await db.query<LigneRattachement>('SELECT id, equipe, site_code AS "siteCode", unite_code AS "uniteCode" FROM employes ORDER BY id');
  let n = 0;
  for (const e of lignes) {
    const r = rattachementSalarie(equipes, entites, e.equipe ?? null);
    if ((e.siteCode ?? null) === r.siteCode && (e.uniteCode ?? null) === r.uniteCode) continue;
    await db.update('employes', Number(e.id), r);
    n++;
  }
  return n;
}
