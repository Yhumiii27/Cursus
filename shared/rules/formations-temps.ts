// Heures de formation proposées dans la feuille de temps (t118) : pour chaque session où le salarié est inscrit (ou
// présent, une fois la session clôturée), une ligne interne « INT-FORM / <formation> » avec les heures prévues de chacun
// de ses jours de la semaine. Ligne interne (ks: false, code INT-*) : jamais envoyée à Keystone, qui ne reçoit que les
// heures de ses projets ; toujours modifiable par le salarié et le valideur, comme toute ligne proposée. Réglage
// `formationsTemps` (Paramètres → Formations), actif par défaut. Appelée par une ligne de `suggestLines` (temps.ts).
import { ACTIVITE_FORMATION } from '../constants.ts';
import { isFerie, wDays } from '../dates.ts';
import { sessionActive, type Domain } from '../domain.ts';
import { num } from '../format.ts';
import type { Employe, ISODate, LigneTemps, Session } from '../types.ts';
import { jourHorsContrat } from './absences.ts';
import { sessionsInscrit } from './conflits.ts';
import { finSession, heuresHoraire, horaireDuJour, joursSession } from './plage-session.ts';
// Import circulaire (temps.ts appelle lignesFormation) : HEURES_JOUR_MAX n'est lu qu'à l'appel.
import { HEURES_JOUR_MAX } from './temps.ts';

/** Durée en heures écrite au catalogue (« 21 h », « 7 h (MAC) », « 3,5 h ») ; null si elle ne se lit pas. */
export function dureeHeures(duree: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*h/i.exec(duree ?? '');
  const h = m ? Number(m[1].replace(',', '.')) : NaN;
  return h > 0 ? h : null;
}

/**
 * Heures prévues d'un jour de la session : celles de son horaire (fin moins début, pause déduite) ; sans horaire, la
 * durée du catalogue répartie également sur les jours de la session ; 0 si elle ne se lit pas. Plafonnées à HEURES_JOUR_MAX.
 */
export function heuresSessionLe(d: Domain, s: Session, jour: ISODate): number {
  const jours = joursSession(s);
  if (!jours.includes(jour)) return 0;
  const h = horaireDuJour(s, jour);
  const heures = h ? heuresHoraire(h) : (dureeHeures(d.fm(s.formation)?.duree) ?? 0) / jours.length;
  return Math.min(HEURES_JOUR_MAX, Math.round(heures * 100) / 100);
}

/**
 * Sessions du salarié qui portent des heures la semaine `w` : ouvertes où il est inscrit, ou clôturées où il était
 * présent (après la clôture, la certification ou l'inscription ne désigne plus la session). Une session annulée, ou
 * clôturée avec le salarié absent, ne propose rien.
 */
export function sessionsDeLaSemaine(d: Domain, empId: number, w: ISODate): Session[] {
  const wd = wDays(w), du = wd[0], au = wd[wd.length - 1];
  const presentes = new Set(d.ds.participations.filter(p => p.empId === empId && p.present).map(p => p.sessionId));
  const ouvertes = sessionsInscrit(d, empId);
  return d.ds.sessions
    .filter(s => (sessionActive(s) ? ouvertes.includes(s) : s.statut === 'Clôturée' && presentes.has(s.id)))
    .filter(s => s.date <= au && finSession(s) >= du)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/**
 * Lignes de formation proposées la semaine `w` : une par session, heures prévues de chaque jour, à zéro les jours
 * fériés, d'absence, non travaillés (temps partiel) et hors contrat. Une session sans heure prévue cette semaine-là
 * (durée illisible, jours hors de la semaine) ne propose rien. Réglage désactivé : rien.
 */
export function lignesFormation(d: Domain, e: Employe, w: ISODate, abs: unknown[], off: number[]): LigneTemps[] {
  if (d.ds.settings.formationsTemps === false) return [];
  const wd = wDays(w);
  return sessionsDeLaSemaine(d, e.id, w).map(s => ({
    projet: ACTIVITE_FORMATION.code, tache: d.fm(s.formation)?.court ?? s.formation, ks: false,
    h: wd.map((day, i) => (isFerie(day) || abs[i] || off.includes(i) || jourHorsContrat(e, day) ? 0 : heuresSessionLe(d, s, day))),
  })).filter(l => l.h.some(h => num(h) > 0));
}

/** Une session de formation porte des heures à proposer la semaine `w` (bouton « Proposer » de l'écran Temps). */
export const formationsAProposer = (d: Domain, empId: number, w: ISODate) =>
  d.ds.settings.formationsTemps !== false && sessionsDeLaSemaine(d, empId, w).length > 0;
