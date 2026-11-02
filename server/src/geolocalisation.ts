// Géolocalisation au pointage (lot 12, chantier C6, étape 3, t191 ; règles pures : shared/rules/geolocalisation.ts). Option
// désactivée par défaut (réglage `geolocActive`), activable avec le badgeage, une finalité écrite, la date de l'AIPD et au
// moins une population (COHERENCE de shared/reglages.ts).
// - Position demandée : salarié d'une population de la géolocalisation, qui pointe ce jour-là, et au moins une zone active
//   (`positionDemandee`) ; jamais hors ligne. Le verdict est calculé dans l'action (server/src/actions/pointage.ts) et
//   seul gardé sur le pointage : les coordonnées ne sont écrites nulle part (ni table, ni journal, ni log).
// - Zones (`zones_pointage`, hors de l'instantané) : lues ici, tenues par l'administrateur RH (pointage.zone.*), servies au
//   service RH par GET /api/pointages/zones.
// - Permissions-Policy : `geolocation=()` tant que l'option est inactive ; `geolocation=(self)` pour toute page dès qu'elle
//   l'est (`politiqueGeoloc`). La page de l'application est servie avant toute session et gardée par le service worker
//   (client/public/sw.js) : l'en-tête ne peut pas dépendre de la population du salarié, et un changement de l'option ne
//   vaut qu'au rechargement de la coque. C'est le code qui limite la demande de position aux populations désignées.
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { employeAu } from '../../shared/rules/historique-contrat.ts';
import { geolocAu } from '../../shared/rules/geolocalisation.ts';
import type { Dataset, Employe, ISODate, ZonePointage } from '../../shared/types.ts';
import { identite } from './connexion.ts';
import { loadSettings } from './dataset.ts';
import type { Db } from './db.ts';
import { permissionsPolicy } from './securite.ts';

/** Zones de pointage, actives seulement (`actives`) ou toutes, par libellé. */
export async function lireZones(db: Db, actives = false): Promise<ZonePointage[]> {
  const l = await db.all<ZonePointage>('zonesPointage');
  return l.filter(z => !actives || z.actif).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr') || a.id - b.id);
}

/** Le salarié relève-t-il de la géolocalisation le `jour` (option active, population désignée, qui pointe) ? */
export const geolocDuSalarie = (ds: Dataset, e: Employe, jour: ISODate): boolean =>
  geolocAu({ settings: ds.settings, equipes: ds.referentiels.equipes, entites: ds.referentiels.entites ?? [] }, employeAu(ds, e, jour), jour);

/** Position à demander au salarié au clic sur « Pointer » : population désignée et au moins une zone active. */
export async function positionDemandee(db: Db, ds: Dataset, e: Employe, jour: ISODate): Promise<boolean> {
  return geolocDuSalarie(ds, e, jour) && (await lireZones(db, true)).length > 0;
}

/** Délai au-delà duquel l'état de l'option est relu, même sans écriture sur cette instance (autres instances). */
const RELECTURE_POLITIQUE_MS = 30_000;

/**
 * Permissions-Policy dynamique : remplace l'en-tête posé par `securityHeaders` (géolocalisation refusée) par celui qui
 * l'admet pour Cursus seul, quand l'option est active (badgeage compris). Réglage relu après chaque écriture de cette
 * instance (révision) et au plus tard toutes les 30 s ; les réponses de l'API, qui ne sont pas des pages, gardent l'en-tête
 * fermé sans relire. Une lecture impossible garde le dernier état connu.
 */
export function politiqueGeoloc(db: Db) {
  let etat = { actif: false, revision: Number.NaN, lu: 0 };
  let enCours: Promise<void> | null = null;
  const relire = async () => {
    const revision = db.revision;
    try {
      const s = await loadSettings(db);
      etat = { actif: !!(s.geolocActive && s.pointageActif), revision, lu: Date.now() };
    } catch {
      etat = { ...etat, revision, lu: Date.now() };
    }
  };
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (etat.revision !== db.revision || Date.now() - etat.lu > RELECTURE_POLITIQUE_MS) {
      enCours ??= relire().finally(() => { enCours = null; });
      await enCours;
    }
    if (etat.actif) res.setHeader('Permissions-Policy', permissionsPolicy(true));
    next();
  };
}

/**
 * GET /api/pointages/zones : zones de pointage (toutes), pour Paramètres → Badgeage ; service RH seulement (droit « rh »).
 * Aucune donnée personnelle : centre et rayon d'un site ou d'un chantier.
 */
export function routesZones(db: Db): Router {
  const r = express.Router();
  r.get('/api/pointages/zones', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (!droitsRh(id.user).includes('rh')) return res.status(403).json({ error: 'Zones de pointage réservées au service RH' });
    const zones = await db.lecture(async () => await lireZones(db));
    res.set('Cache-Control', 'no-store');
    res.json({ zones });
  });
  return r;
}
