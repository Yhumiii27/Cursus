// Pointages bruts du badgeage virtuel (lot 12, chantier C6, t191) : lecture à la demande, état du jour, débit-crédit,
// conservation. Les pointages ne sont jamais dans l'instantané (HORS_INSTANTANE de server/src/lecture-brute.ts) : l'état du
// jour dépend de l'heure, et le cache est indexé par révision et par jour ; tout est recalculé à chaque appel, filtré par
// les droits (règles pures : shared/rules/pointage.ts, shared/rules/debit-credit.ts).
//   GET /api/pointages?empId&du&au   pointages bruts d'un salarié, 6 semaines au plus, avec postes et anomalies
//   GET /api/pointages/etat?empId    état du jour (présent depuis, pointages du jour), débit-crédit du jour et de la
//                                    semaine, anomalies de la semaine ; sans empId : le salarié connecté ; `equipe=1` :
//                                    présence du jour de chaque salarié du périmètre (sans la nature d'une absence)
// Droits : le salarié pour lui-même ; le manager pour son équipe directe et les salariés dont il valide les feuilles par
// délégation (périmètre « feuilles »), jamais en consultation N+2 ; le service RH (droit « rh ») pour tous. La paie, le
// référent HSE, la lecture seule et la comptabilité ne lisent rien : ils lisent la feuille de temps. Lecture non tracée
// (aucune donnée de santé) ; un refus l'est, comme ailleurs.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { addD, isFerie, isValidDate, mondayOf } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import { cumulPeriode, soldeSemaine, theoriqueDuJour } from '../../shared/rules/debit-credit.ts';
import { delegationPour } from '../../shared/rules/delegations-manager.ts';
import { estDemi } from '../../shared/rules/demi-journees.ts';
import { employeAu } from '../../shared/rules/historique-contrat.ts';
import { horaireDe, horaireEquipe } from '../../shared/rules/horaires.ts';
import {
  type AnomaliePointage, anomaliesPointage, apparier, type ContextePopulation, heureParis, hhmmParis, instantParis, LECTURE_MAX_JOURS, modeTempsAu, postesDe,
  realiseParJour,
} from '../../shared/rules/pointage.ts';
import type { CurrentUser, Dataset, Employe, ISODate, ModeTemps, Pointage } from '../../shared/types.ts';
import { jeuEnLecture } from './cache-instantane.ts';
import { identite, type Identite } from './connexion.ts';
import { loadFull, loadSettings, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { tracerRefus } from './journal.ts';

/**
 * Instant du serveur pour le badgeage (ms) : l'heure réelle ; avec une date du jour imposée (CURSUS_TODAY : démonstration,
 * tests), l'heure murale de Paris du moment, ce jour-là, pour que pointages, état du jour et délais suivent la même date.
 */
export function instantServeur(t = Date.now()): number {
  // Une seule lecture de l'horloge : un passage de minuit entre deux lectures daterait le pointage du lendemain.
  const today = todayIso(new Date(t)), h = heureParis(t);
  return h.jour === today ? t : instantParis(today, h.minutes) + (t % 60_000);
}

/** Contexte des populations badgées, tiré de l'instantané. */
export const contextePopulation = (ds: Pick<Dataset, 'settings' | 'referentiels'>): ContextePopulation =>
  ({ settings: ds.settings, equipes: ds.referentiels.equipes, entites: ds.referentiels.entites ?? [] });

/** Mode de décompte du salarié le `date` (régime de l'historique des contrats à cette date). */
export const modeDuSalarie = (ds: Dataset, e: Employe, date: ISODate): ModeTemps => modeTempsAu(contextePopulation(ds), employeAu(ds, e, date), date);

/**
 * Mode à figer sur une feuille créée pour la semaine `week` (lundi) : celui de la population badgée ce jour-là ; rien pour
 * une feuille déclarative (la colonne reste vide, comme avant le module). Commun à toutes les créations de feuille
 * (saisie : actions/temps.ts ; semaines figées par un avenant : actions/equipes.ts).
 */
export function modeAFiger(ds: Dataset, e: Employe, week: ISODate): { modeTemps?: ModeTemps } {
  const mode = modeDuSalarie(ds, e, week);
  return mode !== 'declaratif' ? { modeTemps: mode } : {};
}

/** Pointages bruts des salariés `empIds`, jours de Paris `du` à `au` (neutralisations comprises), dans l'ordre des clés. */
export async function lirePointages(db: Db, empIds: readonly number[], du: ISODate, au: ISODate): Promise<Pointage[]> {
  if (!empIds.length) return [];
  return await db.allDans<Pointage>('pointages', { where: `emp_id IN (${empIds.map(() => '?').join(', ')}) AND jour >= ? AND jour <= ?`, params: [...empIds, du, au] });
}

/** Le lecteur voit-il les pointages de ce salarié ? (droits décrits en tête). */
export function voitPointages(user: CurrentUser, ds: Dataset, d: Domain, empId: number): boolean {
  if (user.empId === empId) return true;
  if (droitsRh(user).includes('rh')) return true;
  if (user.role !== 'manager' || !user.empId) return false;
  const e = d.emp(empId);
  return !!e && (d.mgrOf(e) === user.empId || !!delegationPour(ds, e, user.empId, ds.today, 'feuilles'));
}

/** Absences du salarié par jour : journée entière ou demi-journée, toute nature confondue (validées ou signalées). */
function absencesParJour(ds: Dataset, empId: number, du: ISODate, au: ISODate): Map<ISODate, 'journee' | 'demi'> {
  const m = new Map<ISODate, 'journee' | 'demi'>();
  for (const a of ds.absences) {
    if (a.empId !== empId || (a.statut !== 'validee' && a.statut !== 'signalee') || a.au < du || a.du > au) continue;
    for (let j = a.du < du ? du : a.du; j <= (a.au > au ? au : a.au); j = addD(j, 1)) {
      const demi = (j === a.du && estDemi(a.debutDemi)) || (j === a.au && estDemi(a.finDemi));
      if (m.get(j) !== 'journee') m.set(j, demi ? 'demi' : 'journee');
    }
  }
  return m;
}

/**
 * Théorique d'un jour : minutes, absence (journée entière ou demi-journée, sans sa nature), hors contrat, et salarié qui
 * pointe ce jour-là (population badgée en vigueur : `pointe`). Un jour où il ne pointe pas encore (avant la date d'effet de
 * sa population, avant son entrée dans une équipe badgée) n'est ni « prévu » pour les anomalies, ni compté au débit-crédit.
 */
export interface TheoriqueJour { minutes: number; absence: 'journee' | 'demi' | null; horsContrat: boolean; pointe: boolean }

/** Théorique de chaque jour d'une période (minutes), d'après le contrat, l'horaire, les absences et les fériés. */
export function theoriques(ds: Dataset, e: Employe, du: ISODate, au: ISODate): Map<ISODate, TheoriqueJour> {
  const absences = absencesParJour(ds, e.id, du, au), out = new Map<ISODate, TheoriqueJour>();
  const d = new Domain(ds);
  for (let j = du; j <= au; j = addD(j, 1)) {
    const x = employeAu(ds, e, j), c = d.contratOf(x);
    const sh = ds.feuilles.find(f => f.empId === e.id && f.week === mondayOf(j));
    const i = (new Date(`${j}T12:00:00Z`).getUTCDay() + 6) % 7;
    const choisi = sh?.horairesFiges?.[i] ?? (sh?.horaires?.[i] != null ? horaireDe(ds.referentiels, sh.horaires[i] || null) : horaireEquipe(ds.referentiels, x.equipe));
    const horsContrat = x.entree > j || (!!x.fin && x.fin < j);
    const t = theoriqueDuJour({
      jour: j, horaire: choisi ? { code: choisi.code, debut: choisi.debut, fin: choisi.fin, pause: choisi.pause } : null, absence: absences.get(j) ?? null,
      ferie: isFerie(j), horsContrat, jourOff: c.jourOff, heuresSemaine: c.base,
    });
    out.set(j, { minutes: t.minutes, absence: absences.get(j) ?? null, horsContrat, pointe: modeDuSalarie(ds, e, j) !== 'declaratif' });
  }
  return out;
}

/** Heures déclarées de chaque jour sur les feuilles (mode « controle ») et total pointé figé à la validation. */
function feuillesParJour(ds: Dataset, empId: number, du: ISODate, au: ISODate) {
  const declare = new Map<ISODate, number>(), figes = new Map<ISODate, number>();
  for (const f of ds.feuilles) {
    if (f.empId !== empId || f.week > au || addD(f.week, 6) < du) continue;
    for (let i = 0; i < 7; i++) {
      const j = addD(f.week, i);
      if (f.modeTemps === 'controle') declare.set(j, f.lignes.reduce((n, l) => n + (Number(l.h[i]) || 0), 0));
      if (f.statut === 'validee' && f.pointeFige?.[i] != null) figes.set(j, f.pointeFige[i]);
    }
  }
  return { declare, figes };
}

/** Pointages et anomalies d'un salarié sur une période (jours de Paris), à l'instant `maintenant`. */
export function bilanPeriode(ds: Dataset, e: Employe, pointages: readonly Pointage[], du: ISODate, au: ISODate, maintenant: number) {
  const t = theoriques(ds, e, du, au);
  // Jours où le salarié pointe seulement : avant l'activation de sa population, rien n'est attendu.
  const prevus = new Set([...t].filter(([, x]) => x.pointe && x.minutes > 0).map(([j]) => j));
  const absents = new Set([...t].filter(([, x]) => x.absence === 'journee').map(([j]) => j));
  const demiAbsents = new Map([...t].filter(([, x]) => x.absence === 'demi').map(([j, x]) => [j, x.minutes]));
  const horsContrat = new Set([...t].filter(([, x]) => x.horsContrat).map(([j]) => j));
  const f = feuillesParJour(ds, e.id, du, au), figes = f.figes;
  const declare = new Map([...f.declare].filter(([j]) => t.get(j)?.pointe));
  const a = apparier(pointages, maintenant);
  const postes = postesDe(a, maintenant);
  const anomalies: AnomaliePointage[] = anomaliesPointage({
    du, au, pointages, maintenant, prevus, absents, demiAbsents, horsContrat, declare, figes,
    ecartMin: ds.settings.pointageEcartAnomalieMin, differeMin: ds.settings.pointageEcartDiffereMin,
  });
  return { theoriques: t, postes, appariement: a, anomalies };
}

/** État du jour et débit-crédit d'un salarié à l'instant `maintenant` (pointages du lundi précédent au lendemain). */
export function etatDuSalarie(ds: Dataset, e: Employe, pointages: readonly Pointage[], maintenant: number) {
  const today = heureParis(maintenant).jour, week = mondayOf(today);
  const b = bilanPeriode(ds, e, pointages, week, today, maintenant);
  const realise = realiseParJour(b.postes);
  // Théorique nul les jours où le salarié ne pointe pas (avant l'activation de sa population) : aucun débit fictif.
  const theorique = (j: ISODate) => {
    const x = b.theoriques.get(j);
    return j <= today && x?.pointe ? x.minutes : 0;
  };
  const semaine = soldeSemaine(week, realise, theorique);
  const duJour = b.postes.filter(p => p.jour === today).sort((u, v) => u.debut - v.debut);
  const effectifs = pointages.filter(p => heureParis(p.horodatage).jour === today && p.annuleId == null);
  return {
    empId: e.id, jour: today, mode: modeDuSalarie(ds, e, today),
    present: !!b.appariement.enCours, depuis: b.appariement.enCours ? hhmmParis(b.appariement.enCours.horodatage) : null,
    pointages: effectifs.map(p => ({ id: p.id, heure: hhmmParis(p.horodatage), sens: p.sens, source: p.source, differe: p.horsLigne })),
    postes: duJour.map(p => ({ debut: hhmmParis(p.debut), fin: p.enCours ? null : hhmmParis(p.fin), travail: p.travail, pauses: p.pauses })),
    debitCredit: {
      jour: { realise: realise.get(today) ?? 0, theorique: theorique(today), solde: (realise.get(today) ?? 0) - theorique(today) },
      semaine: { realise: semaine.realise, theorique: semaine.theorique, solde: semaine.solde },
      // Report plafonné (supplétif : 3 h par semaine, 10 h de cumul), sur la seule semaine en cours.
      periode: cumulPeriode([semaine]),
    },
    anomalies: b.anomalies,
  };
}

/** Présence du jour d'un salarié du périmètre : présent, parti, non pointé, absent (sans la nature de l'absence). */
export function presenceDuJour(ds: Dataset, e: Employe, pointages: readonly Pointage[], maintenant: number) {
  const today = heureParis(maintenant).jour;
  const b = bilanPeriode(ds, e, pointages, today, today, maintenant);
  const etat = b.appariement.enCours ? 'present' : b.postes.some(p => p.jour === today) ? 'parti' : b.theoriques.get(today)?.absence === 'journee' ? 'absent' : 'non_pointe';
  return { empId: e.id, etat, depuis: b.appariement.enCours ? hhmmParis(b.appariement.enCours.horodatage) : null, anomalies: b.anomalies.length };
}

/** Jeu de la lecture en cours (partagé avec l'instantané en cache), pour les droits et les calculs. */
async function jeu(db: Db, user: CurrentUser): Promise<Dataset> {
  return await jeuEnLecture(db, user, todayIso(), async u => await loadFull(db, u));
}

/** Refus tracé (403) dans sa propre courte transaction. */
async function refuser(db: Db, res: Response, id: Identite, quoi: string) {
  await db.tx(async () => await tracerRefus(db, id, quoi, 'hors du périmètre de lecture des pointages'));
  res.status(403).json({ error: 'Pointages hors de votre périmètre : le salarié, son manager (ou son suppléant pour les feuilles) et le service RH seulement' });
}

export function routesPointages(db: Db): Router {
  const r = express.Router();

  r.get('/api/pointages', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const q = req.query as Record<string, unknown>;
    const empId = Number(q.empId ?? id.user.empId);
    const today = todayIso();
    const au = typeof q.au === 'string' && q.au ? q.au : today, du = typeof q.du === 'string' && q.du ? q.du : addD(au, -6);
    if (!isValidDate(du) || !isValidDate(au) || du > au) return res.status(400).json({ error: 'Période invalide' });
    if (addD(du, LECTURE_MAX_JOURS - 1) < au) return res.status(400).json({ error: `Période de ${LECTURE_MAX_JOURS / 7} semaines au plus` });
    const lu = await db.lecture(async () => {
      const ds = await jeu(db, id.user), d = new Domain(ds), e = Number.isInteger(empId) ? d.emp(empId) : undefined;
      if (!e || !voitPointages(id.user, ds, d, e.id)) return { refus: true as const };
      // Veille et lendemain : postes de nuit commencés avant la période, ou finis après.
      return { ds, e, pointages: await lirePointages(db, [e.id], addD(du, -1), addD(au, 1)) };
    });
    if ('refus' in lu) return await refuser(db, res, id, 'Pointages');
    const b = bilanPeriode(lu.ds, lu.e, lu.pointages, du, au, instantServeur());
    res.set('Cache-Control', 'no-store');
    res.json({
      empId: lu.e.id, du, au,
      pointages: lu.pointages.filter(p => p.jour >= du && p.jour <= au),
      postes: b.postes.filter(p => p.jour >= du && p.jour <= au).map(p => ({ jour: p.jour, debut: new Date(p.debut).toISOString(), fin: new Date(p.fin).toISOString(), travail: p.travail, pauses: p.pauses, enCours: p.enCours })),
      anomalies: b.anomalies,
    });
  });

  r.get('/api/pointages/etat', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const q = req.query as Record<string, unknown>, maintenant = instantServeur();
    const today = todayIso(), lundi = mondayOf(today);
    const lu = await db.lecture(async () => {
      const ds = await jeu(db, id.user), d = new Domain(ds);
      if (q.equipe === '1') {
        // Présences du jour du périmètre : salariés présents aujourd'hui, en population badgée.
        const ids = ds.employes.filter(e => e.id !== id.user.empId && (!e.fin || e.fin >= today) && voitPointages(id.user, ds, d, e.id) && modeDuSalarie(ds, e, today) !== 'declaratif').map(e => e.id);
        if (!ids.length && !droitsRh(id.user).includes('rh') && id.user.role !== 'manager') return { refus: true as const };
        return { ds, equipe: ids, pointages: await lirePointages(db, ids, addD(today, -1), addD(today, 1)) };
      }
      const empId = Number(q.empId ?? id.user.empId), e = Number.isInteger(empId) ? d.emp(empId) : undefined;
      if (!e || !voitPointages(id.user, ds, d, e.id)) return { refus: true as const };
      return { ds, e, pointages: await lirePointages(db, [e.id], addD(lundi, -1), addD(today, 1)) };
    });
    if ('refus' in lu) return await refuser(db, res, id, 'État des pointages');
    res.set('Cache-Control', 'no-store');
    if ('equipe' in lu && lu.equipe) {
      const d = new Domain(lu.ds);
      return res.json({ jour: today, presences: lu.equipe.map(empId => presenceDuJour(lu.ds, d.emp(empId)!, lu.pointages.filter(p => p.empId === empId), maintenant)) });
    }
    res.json(etatDuSalarie(lu.ds, lu.e, lu.pointages, maintenant));
  });

  return r;
}

// — Conservation —

/**
 * Pointages bruts et demandes de correction de plus de `conservationPointagesAns` ans (jour de Paris), supprimés par la
 * tâche quotidienne de la conservation (server/src/conservation.ts) ; demandes d'abord (le pointage qu'elles désignent part
 * avec elles), puis pointages. Renvoie le nombre de lignes supprimées.
 */
export async function purgerPointages(db: Db, today: ISODate = todayIso()): Promise<number> {
  const s = await loadSettings(db);
  const limite = `${Number(today.slice(0, 4)) - s.conservationPointagesAns}${today.slice(4)}`;
  return await db.tx(async () => {
    const vieux = 'SELECT id FROM pointages WHERE jour < ?';
    const c = await db.run(`DELETE FROM corrections_pointage WHERE jour < ? OR pointage_id IN (${vieux}) OR pointage_cree_id IN (${vieux})`, [limite, limite, limite]);
    const p = await db.run('DELETE FROM pointages WHERE jour < ? OR annule_id IN (SELECT id FROM pointages WHERE jour < ?)', [limite, limite]);
    return c.changes + p.changes;
  });
}
