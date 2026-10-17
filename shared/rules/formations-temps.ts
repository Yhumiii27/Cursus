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

/** Durée en heures écrite au catalogue (« 21 h », « 7 h (MAC) », « 3,5 h », « 3 h 30 », « 1h30 ») ; null si elle ne se lit pas. */
export function dureeHeures(duree: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*h(?:\s*(\d{2})(?!\d))?/i.exec(duree ?? '');
  const h = m ? Number(m[1].replace(',', '.')) + (m[2] ? Number(m[2]) / 60 : 0) : NaN;
  return h > 0 ? Math.round(h * 100) / 100 : null;
}

/**
 * Heures prévues d'un jour de la session : celles de son horaire (fin moins début, pause déduite), plafonnées à
 * HEURES_JOUR_MAX ; sans horaire, la durée du catalogue répartie également sur les jours de la session, plafonnée à
 * `journee` (la journée de travail du salarié) : une session reprise sur un jour pour une formation de 21 h ne propose
 * pas 21 h ce jour-là. 0 si la durée ne se lit pas.
 */
export function heuresSessionLe(d: Domain, s: Session, jour: ISODate, journee = HEURES_JOUR_MAX): number {
  const jours = joursSession(s);
  if (!jours.includes(jour)) return 0;
  const h = horaireDuJour(s, jour);
  const heures = h ? heuresHoraire(h) : Math.min(journee, (dureeHeures(d.fm(s.formation)?.duree) ?? 0) / jours.length);
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
  const wd = wDays(w), journee = d.dayH(e);
  return sessionsDeLaSemaine(d, e.id, w).map(s => ({
    projet: ACTIVITE_FORMATION.code, tache: d.fm(s.formation)?.court ?? s.formation, ks: false,
    h: wd.map((day, i) => (isFerie(day) || abs[i] || off.includes(i) || jourHorsContrat(e, day) ? 0 : heuresSessionLe(d, s, day, journee))),
  })).filter(l => l.h.some(h => num(h) > 0));
}

/**
 * Feuille après « Proposer » : les lignes proposées s'ajoutent aux lignes déjà saisies, qui sont gardées. Seules sont
 * remplacées les lignes Keystone d'une proposition précédente (`ks`, quand la semaine a des tâches Keystone) et la ligne
 * INT-FORM de la même formation. Un jour où le tout dépasserait HEURES_JOUR_MAX, les heures de formation proposées sont
 * réduites d'autant : la ligne de formation ne bloque jamais la proposition des tâches Keystone. `conservees` : lignes
 * déjà saisies gardées ; `reduites` : une ligne de formation a été réduite.
 */
export function fusionProposition(existantes: LigneTemps[], proposees: LigneTemps[]): { lignes: LigneTemps[]; conservees: number; reduites: boolean } {
  const ks = proposees.filter(l => l.ks), form = proposees.filter(l => !l.ks);
  const remplacee = (l: LigneTemps) => (l.ks && ks.length > 0) || (l.projet === ACTIVITE_FORMATION.code && form.some(f => f.projet === l.projet && f.tache === l.tache));
  const gardees = existantes.filter(l => !remplacee(l));
  // Heures déjà prises chaque jour (Keystone et lignes gardées), puis chaque ligne de formation dans la place restante.
  const pris = [...ks, ...gardees].reduce((t, l) => t.map((n, i) => n + num(l.h[i])), proposees[0]?.h.map(() => 0) ?? []);
  let reduites = false;
  const formations = form.map(f => ({
    ...f,
    h: f.h.map((v, i) => {
      const h = Math.round(Math.min(num(v), Math.max(0, HEURES_JOUR_MAX - num(pris[i]))) * 100) / 100;
      if (h < num(v)) reduites = true;
      pris[i] = num(pris[i]) + h;
      return h;
    }),
  })).filter(l => l.h.some(h => h > 0));
  return { lignes: [...ks, ...gardees, ...formations], conservees: gardees.length, reduites };
}

/** Une session de formation porte des heures à proposer la semaine `w` (bouton « Proposer » de l'écran Temps). */
export const formationsAProposer = (d: Domain, empId: number, w: ISODate) =>
  d.ds.settings.formationsTemps !== false && sessionsDeLaSemaine(d, empId, w).length > 0;
