// Indicateurs sociaux légaux (lot 11, chantier C3, t197) : calcul à la demande, hors de l'instantané, et arrêtés figés.
//   GET /api/indicateurs?annee=&periode=&groupe=        indicateurs de l'année civile (periode=annee, seule admise),
//                                                       groupés (aucun, sexe, catégorie, statut, contrat, équipe), déjà
//                                                       masqués au seuil d'anonymat : JSON (shared/rules/indicateurs-legaux.ts)
//   GET /api/indicateurs?arrete=<id>&groupe=            agrégats figés d'un arrêté annuel (table indicateurs_arretes)
//   GET /api/indicateurs/csv?…                          les mêmes, export CSV au format long, tracé (`indicateurs.export`)
// Droit « consultation » (service RH et lecture seule) ; refus tracé. Ni le manager, ni le collaborateur, ni le référent
// HSE, ni la paie : ils n'ont pas le droit, et aucun indicateur ne part dans leur instantané. Les deux routes sont gardées
// contre une navigation provoquée depuis un autre site (server/src/app.ts, exigerNavigationInterne).
// Le calcul lit toutes les données (vraies natures d'absence, sexe, naissance) sur la lecture partagée de l'instantané
// en cache (`jeuEnLecture`, comme l'API Keystone), mais n'en rend que des agrégats masqués : jamais un identifiant ni un
// nom. Il est mémorisé par révision de la base, date du jour et paramètres : changer d'onglet ou de groupement ne relit
// rien tant que la base ne change pas. Le journal ne reçoit jamais une valeur d'indicateur : période, groupement et nombre
// de lignes de l'export seulement.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { texteCsv } from '../../shared/csv.ts';
import { Domain } from '../../shared/domain.ts';
import { plural } from '../../shared/format.ts';
import {
  ENTETE_CSV_INDICATEURS, estGroupeIndicateurs, estPeriodeIndicateurs, type GroupeIndicateurs, indicateursLegaux, type IndicateursLegaux, lignesCsvIndicateurs,
  type ParametresIndicateurs, type PeriodeIndicateurs, anneeIndicateursValide,
} from '../../shared/rules/indicateurs-legaux.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { jeuEnLecture } from './cache-instantane.ts';
import { journaliser } from './comptes.ts';
import { identite } from './connexion.ts';
import { loadFull, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { fichierJoint, tracerRefus } from './journal.ts';

/** Lecteur interne du calcul : tout le jeu, comme le service RH (aucune réponse n'en sort sans masquage). */
const LECTEUR: CurrentUser = { role: 'rh', empId: null, nom: 'Indicateurs légaux', intitule: 'Calcul des indicateurs' };

/** Groupements figés par un arrêté annuel (l'équipe, qui change avec les mutations, est calculée à la demande seulement). */
export const GROUPES_ARRETE: readonly GroupeIndicateurs[] = ['aucun', 'sexe', 'categorie', 'statut', 'contrat'];
/** Agrégats figés d'un arrêté : un calcul par groupement, sur l'année entière. */
export type DonneesArrete = Partial<Record<GroupeIndicateurs, IndicateursLegaux>>;

/** Paramètres du calcul tirés des réglages de l'instantané : seuil d'anonymat et natures comptées dans l'absentéisme. */
const parametres = (ds: Dataset, p: Pick<ParametresIndicateurs, 'annee' | 'periode' | 'groupe'>): ParametresIndicateurs =>
  ({ ...p, seuil: ds.settings.indicateursSeuil, natures: ds.settings.absenteismeNatures });

/** Calcul sur l'instantané complet `ds` (route, arrêté) ; null : paramètres refusés. */
export const calculerSur = (ds: Dataset, p: Pick<ParametresIndicateurs, 'annee' | 'periode' | 'groupe'>) => indicateursLegaux(new Domain(ds), parametres(ds, p));

/** Agrégats d'un arrêté de l'année `annee` : chaque groupement figé, sur l'année entière. */
export function donneesArrete(ds: Dataset, annee: number): DonneesArrete {
  return Object.fromEntries(GROUPES_ARRETE.map(g => [g, calculerSur(ds, { annee, periode: 'annee', groupe: g })]));
}

// — Mémorisation par révision —

interface Memo { revision: number; today: string; calculs: Map<string, IndicateursLegaux> }
const MEMOS = new WeakMap<Db, Memo>();
/** Calculs au plus gardés par révision (années, périodes et groupements consultés). */
const MEMO_MAX = 48;
/** Compteurs (tests, essai de charge) : calculs faits, et réponses servies par la mémoire. */
export const STATS_INDICATEURS = { calculs: 0, memorises: 0 };

/**
 * Indicateurs de la période, sur l'état courant de la base : mémorisés par (révision, date du jour, paramètres). La
 * lecture (partagée avec l'instantané en cache) se fait dans une lecture stable ; le calcul, après, hors de la lecture.
 */
export async function indicateursDe(db: Db, p: Pick<ParametresIndicateurs, 'annee' | 'periode' | 'groupe'>): Promise<IndicateursLegaux | null> {
  const today = todayIso(), cle = `${p.annee}|${p.periode}|${p.groupe}`;
  const lu = await db.lecture(async () => {
    const revision = db.revision, m = MEMOS.get(db);
    const deja = m && m.revision === revision && m.today === today ? m.calculs.get(cle) : undefined;
    if (deja) return { revision, deja };
    return { revision, ds: await jeuEnLecture(db, LECTEUR, today, async u => await loadFull(db, u)) };
  });
  if ('deja' in lu && lu.deja) { STATS_INDICATEURS.memorises++; return lu.deja; }
  const r = calculerSur((lu as { ds: Dataset }).ds, p);
  STATS_INDICATEURS.calculs++;
  if (!r) return null;
  let m = MEMOS.get(db);
  if (!m || m.revision !== lu.revision || m.today !== today) MEMOS.set(db, m = { revision: lu.revision, today, calculs: new Map() });
  if (m.calculs.size < MEMO_MAX) m.calculs.set(cle, r);
  return r;
}

/** Arrêté lu en base avec ses agrégats, ou null. */
async function arreteDe(db: Db, id: number) {
  return await db.lecture(async () => await db.get<{ id: number; annee: number; donnees: DonneesArrete | null; arreteLe: string; cseLe: string | null; annuleLe: string | null }>('indicateursArretes', id));
}

/** Réponse d'une requête : calcul de la période, ou arrêté figé ; erreur 400 / 404 en clair. */
async function lire(db: Db, q: Record<string, unknown>): Promise<{ r: IndicateursLegaux; arrete: { id: number; annee: number; arreteLe: string; cseLe: string | null; annule: boolean } | null } | { erreur: string; statut: number }> {
  const groupe = q.groupe === undefined || q.groupe === '' ? 'aucun' : q.groupe;
  if (!estGroupeIndicateurs(groupe)) return { erreur: 'Groupement inconnu', statut: 400 };
  if (q.arrete !== undefined) {
    const id = Number(q.arrete);
    const a = Number.isInteger(id) && id > 0 ? await arreteDe(db, id) : undefined;
    if (!a) return { erreur: 'Arrêté introuvable', statut: 404 };
    const r = a.donnees?.[groupe];
    if (!r) return { erreur: 'Ce groupement n’est pas figé par l’arrêté (équipe : calcul à la demande seulement)', statut: 400 };
    return { r, arrete: { id: a.id, annee: a.annee, arreteLe: a.arreteLe, cseLe: a.cseLe, annule: !!a.annuleLe } };
  }
  const annee = q.annee === undefined || q.annee === '' ? Number(todayIso().slice(0, 4)) : Number(q.annee);
  const periode = q.periode === undefined || q.periode === '' ? 'annee' : q.periode;
  if (!anneeIndicateursValide(annee)) return { erreur: 'Année invalide', statut: 400 };
  // L'année civile seulement : ni date libre, ni trimestre, ni mois. Masquées chacune à part, des périodes emboîtées se
  // recouperaient (l'année moins les onze autres mois redonnerait un mois masqué).
  if (!estPeriodeIndicateurs(periode)) return { erreur: 'Période invalide : l’année civile seulement (les trimestres et les mois se recouperaient avec elle)', statut: 400 };
  const r = await indicateursDe(db, { annee, periode: periode as PeriodeIndicateurs, groupe });
  return r ? { r, arrete: null } : { erreur: 'Paramètres invalides', statut: 400 };
}

export function routesIndicateurs(db: Db): Router {
  const r = express.Router();
  /** Identité et droit « consultation » ; refus tracé dans sa propre courte transaction. */
  const autorise = async (req: Request, res: Response, quoi: string) => {
    const id = await identite(db, req);
    if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
    if (!droitsRh(id.user).includes('consultation')) {
      await db.tx(async () => await tracerRefus(db, id, quoi, 'réservé au service RH et à la lecture seule'));
      res.status(403).json({ error: 'Indicateurs sociaux réservés au service RH et à la lecture seule' });
      return null;
    }
    return id;
  };

  r.get('/api/indicateurs', async (req: Request, res: Response) => {
    if (!await autorise(req, res, 'Indicateurs sociaux')) return;
    const x = await lire(db, req.query as Record<string, unknown>);
    if ('erreur' in x) return res.status(x.statut).json({ error: x.erreur });
    res.set('Cache-Control', 'no-store');
    res.json({ ...x.r, arrete: x.arrete });
  });

  // Export CSV : lecture, puis la trace dans sa propre courte transaction, écrite avant la réponse (lot 8, chantier E).
  r.get('/api/indicateurs/csv', async (req: Request, res: Response) => {
    const id = await autorise(req, res, 'Export des indicateurs sociaux');
    if (!id) return;
    const x = await lire(db, req.query as Record<string, unknown>);
    if ('erreur' in x) return res.status(x.statut).json({ error: x.erreur });
    const lignes = lignesCsvIndicateurs(x.r);
    const periode = `${x.r.annee}-${x.r.periode}`;
    await db.tx(async () => await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'indicateurs.export', compte: id.compte, salaries: [],
      message: `Indicateurs sociaux exportés — ${x.r.libelle}${x.arrete ? ` (arrêté n° ${x.arrete.id})` : ''} — ${plural(lignes.length, 'ligne', 'lignes')}`,
      payload: { periode, groupe: x.r.groupe, lignes: lignes.length, ...(x.arrete ? { arrete: x.arrete.id } : {}) },
    }));
    fichierJoint(res, 'text/csv; charset=utf-8', `indicateurs-${periode}-${x.r.groupe}${x.arrete ? `-arrete-${x.arrete.id}` : ''}.csv`, texteCsv(ENTETE_CSV_INDICATEURS, lignes));
  });

  return r;
}
