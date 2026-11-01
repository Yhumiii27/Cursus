// Planning d'équipe (lot 12, chantier C5) : historique des créneaux à la demande. L'instantané ne lit que la fenêtre de
// 8 semaines passées à 12 semaines à venir (server/src/planning-lecture.ts) ; les créneaux plus anciens (registre gardé pour
// l'inspection du travail, art. D3171-16) ou plus lointains se lisent par GET /api/planning/historique?du=&au=[&equipe=],
// un an au plus par appel, avec les filtres de l'instantané (server/src/vues-planning.ts) : le service RH tout ; un profil
// restreint, ce que son profil ouvre ; le manager, son périmètre (motifs et alertes des seuls salariés qu'il planifie) ; le
// collaborateur, ses créneaux publiés (et les postes de ses collègues si le réglage l'ouvre). Module désactivé : 409.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { addD, isValidDate } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import type { Creneau } from '../../shared/types-planning.ts';
import { identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import { type Db, enSerie } from './db.ts';
import { colleguesVisibles, creneauSansMotif, creneauxPourProfil, creneauxPourSalarie, planifiesPar } from './vues-planning.ts';

/** Période d'un appel : un an au plus. */
export const JOURS_HISTORIQUE_MAX = 366;

export function routesPlanningHistorique(db: Db): Router {
  const r = express.Router();
  r.get('/api/planning/historique', enSerie(db, async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const { du, au, equipe } = req.query as Record<string, unknown>;
    if (typeof du !== 'string' || typeof au !== 'string' || !isValidDate(du) || !isValidDate(au) || au < du) return res.status(400).json({ error: 'Période invalide : du et au (AAAA-MM-JJ)' });
    if (au > addD(du, JOURS_HISTORIQUE_MAX - 1)) return res.status(400).json({ error: `Un an au plus par demande (${JOURS_HISTORIQUE_MAX} jours)` });
    const user = id.user;
    const full = await loadFull(db, user);
    if (!full.settings.planningActif) return res.status(409).json({ error: 'Planning d’équipe désactivé' });
    const filtreEquipe = typeof equipe === 'string' && equipe ? equipe : null;
    const lignes = await db.allDans<Creneau>('creneaux', filtreEquipe
      ? { where: 'jour >= ? AND jour <= ? AND equipe = ?', params: [du, au, filtreEquipe] }
      : { where: 'jour >= ? AND jour <= ?', params: [du, au] });
    let creneaux: Creneau[];
    if (user.role === 'rh') {
      const droits = droitsRh(user);
      creneaux = droits.includes('rh') ? lignes : creneauxPourProfil(lignes, droits);
    } else {
      const d = new Domain(full);
      const ids = new Set(scopeIds(d, user)), collegues = new Set(colleguesVisibles(full, user));
      creneaux = creneauxPourSalarie(lignes, { user, ids, planifies: planifiesPar(d, user), collegues });
      // « À pourvoir » : le manager, pour les équipes de son périmètre ; motifs compris pour les équipes qu'il planifie, comme
      // dans l'instantané (planningVueSalarie).
      if (user.role === 'manager') {
        const equipes = new Set([...full.employes.filter(e => ids.has(e.id) && e.equipe).map(e => e.equipe!), ...d.teamsOf(user.empId)]);
        const planifies = planifiesPar(d, user);
        const planifiees = new Set(full.employes.filter(e => planifies.has(e.id) && e.equipe).map(e => e.equipe!));
        creneaux = creneaux.concat(lignes.filter(c => c.empId == null && c.equipe && equipes.has(c.equipe)).map(c => (planifiees.has(c.equipe!) ? c : creneauSansMotif(c))));
      }
    }
    res.set('Cache-Control', 'no-store').json({ du, au, creneaux });
  }));
  return r;
}
