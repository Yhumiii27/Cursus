// Sessions de formation sur plusieurs jours (t118) : `date` reste le premier jour de la session, `fin` le dernier, `jours`
// les jours où elle a lieu (ouvrés par défaut entre les deux) et `horaires` ses heures (aucune : journées entières ; une
// seule : tous les jours ; sinon une par jour). Contrôles de saisie communs au dialogue et au serveur, plage affichée,
// heures prévues d'un jour (feuilles de temps : shared/rules/formations-temps.ts). Seuls les endroits qui dépendent de la
// plage la lisent (conflits, inscription, .ics, clôture, affichage) ; ailleurs, `date` reste le jour de la session.
import { addD, days, isFerie, isValidDate, parse, weekday } from '../dates.ts';
import { fmtIso, fmtIsoShort, plural } from '../format.ts';
import type { HoraireSession, ISODate, Session } from '../types.ts';

/** Jours d'une session, au plus (une formation de 35 h en compte cinq, une formation en alternance davantage). */
export const SESSION_JOURS_MAX = 20;
/** Du premier au dernier jour, en jours calendaires, au plus (trois mois). */
export const SESSION_ETENDUE_MAX = 92;
/** Pause d'un jour de session, en minutes, au plus. */
export const SESSION_PAUSE_MAX = 240;

/** Ce qu'il faut d'une session pour en connaître la plage (une session d'une base ancienne n'a ni `fin` ni `jours`). */
export type PlageSource = Pick<Session, 'date'> & Partial<Pick<Session, 'fin' | 'jours' | 'horaires'>>;

/** Dernier jour de la session (le premier, pour une session d'une journée). */
export const finSession = (s: PlageSource): ISODate => (s.fin && s.fin > s.date ? s.fin : s.date);

/** Session de plusieurs jours. */
export const surPlusieursJours = (s: PlageSource) => finSession(s) !== s.date;

/**
 * Jours proposés par défaut entre le premier et le dernier jour : du lundi au vendredi, hors jours fériés. Le premier et
 * le dernier jour en font toujours partie, même un samedi ou un férié (la session commence et finit ces jours-là).
 */
export function joursOuvres(du: ISODate, au: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let j = du; j <= au && out.length <= SESSION_ETENDUE_MAX; j = addD(j, 1)) {
    if (j === du || j === au || (weekday(j) < 5 && !isFerie(j))) out.push(j);
  }
  return out;
}

/** Jours de la session, dans l'ordre : ceux enregistrés, à défaut les jours ouvrés du premier au dernier. */
export function joursSession(s: PlageSource): ISODate[] {
  const fin = finSession(s);
  const j = (s.jours ?? []).filter(x => x >= s.date && x <= fin);
  return j.length ? [...new Set(j)].sort() : joursOuvres(s.date, fin);
}

/** Horaire d'un jour de la session : le seul (tous les jours) ou celui du jour ; null sans horaire (journée entière). */
export function horaireDuJour(s: PlageSource, jour: ISODate): HoraireSession | null {
  const h = s.horaires ?? [];
  if (!h.length) return null;
  if (h.length === 1) return h[0];
  const i = joursSession(s).indexOf(jour);
  return i >= 0 ? h[i] ?? null : null;
}

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Heures prévues d'un horaire : de la fin moins le début, pause déduite. */
export const heuresHoraire = (h: HoraireSession) => Math.max(0, minutes(h.fin) - minutes(h.debut) - (h.pause || 0)) / 60;

/** « 8 h 30 », « 17 h ». */
export const heureTexte = (hm: string) => { const [h, m] = hm.split(':'); return `${Number(h)} h${m === '00' ? '' : ` ${m}`}`; };
/** « 8 h 30 – 17 h », avec la pause si elle est indiquée. */
export const horaireTexte = (h: HoraireSession) => `${heureTexte(h.debut)} – ${heureTexte(h.fin)}${h.pause ? ` (pause ${h.pause} min)` : ''}`;

/**
 * Plage affichée : « le 21 oct. 2026 », « du 21 oct. au 23 oct. 2026 · 3 jours » ; avec `horaires`, l'horaire commun (ou
 * « horaires par jour »). Les jours non consécutifs se lisent dans le détail de la session (`joursTexte`).
 */
export function plageTexte(s: PlageSource, opts: { horaires?: boolean } = {}): string {
  const fin = finSession(s), n = joursSession(s).length;
  const base = fin === s.date ? `le ${fmtIso(s.date)}` : `du ${fmtIsoShort(s.date)} au ${fmtIso(fin)} · ${plural(n, 'jour', 'jours')}`;
  if (!opts.horaires || !s.horaires?.length) return base;
  return `${base} · ${s.horaires.length === 1 ? horaireTexte(s.horaires[0]) : 'horaires par jour'}`;
}

/** Plage courte, sans « le » ni « du » : « 21 oct. 2026 », « 21 oct. → 23 oct. 2026 » (listes, colonnes de date). */
export function plageCourte(s: PlageSource): string {
  const fin = finSession(s);
  return fin === s.date ? fmtIso(s.date) : `${fmtIsoShort(s.date)} → ${fmtIso(fin)}`;
}

const JOURS_SEMAINE = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** Jours de la session un par un, avec leur horaire : « lun. 21 oct. · 8 h 30 – 16 h 30 ». */
export function joursTexte(s: PlageSource): string[] {
  return joursSession(s).map(j => {
    const h = horaireDuJour(s, j);
    return `${JOURS_SEMAINE[weekday(j)]} ${fmtIsoShort(j)}${h ? ` · ${horaireTexte(h)}` : ''}`;
  });
}

/** Un jour de la session chevauche la période `du`…`au` (un trou entre deux jours ne compte pas). */
export const sessionChevauche = (s: PlageSource, du: ISODate, au: ISODate) => joursSession(s).some(j => j >= du && j <= au);

/** Session complétée pour l'instantané : une session d'une base ancienne (ni `fin`, ni `jours`) tient en un jour. */
export function completerSession<S extends PlageSource>(s: S): S & Pick<Session, 'fin' | 'jours' | 'horaires'> {
  const fin = finSession(s);
  return { ...s, fin, jours: joursSession({ ...s, fin }), horaires: s.horaires ?? [] };
}

// — Saisie —

/** Champ fautif d'une plage saisie. */
export type ChampPlage = 'fin' | 'jours' | 'horaires';
export interface Plage { fin: ISODate; jours: ISODate[]; horaires: HoraireSession[] }

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Plage saisie à partir du premier jour `date` (déjà contrôlé) : `fin` absente ou vide, la session tient en un jour ;
 * `jours` absents ou vides, les jours ouvrés entre les deux ; `horaires` absents, aucun. Renvoie la plage, ou le champ
 * fautif et son message : dernier jour avant le premier ou plus de trois mois après, jours hors de la plage ou en trop,
 * premier et dernier jour absents des jours, horaire mal formé, fin avant le début, pause plus longue que la journée.
 */
export function controlePlage(date: ISODate, v: { fin?: unknown; jours?: unknown; horaires?: unknown }): { plage: Plage } | { champ: ChampPlage; message: string } {
  const fin = v.fin === undefined || v.fin === null || v.fin === '' ? date : v.fin;
  if (typeof fin !== 'string' || !isValidDate(fin)) return { champ: 'fin', message: 'Dernier jour de la session : date invalide' };
  if (fin < date) return { champ: 'fin', message: 'Le dernier jour de la session précède le premier' };
  if (days(parse(date), parse(fin)) + 1 > SESSION_ETENDUE_MAX) return { champ: 'fin', message: `Dernier jour de la session : ${SESSION_ETENDUE_MAX} jours au plus après le premier` };

  let jours: ISODate[];
  if (v.jours === undefined || v.jours === null || (Array.isArray(v.jours) && !v.jours.length)) jours = joursOuvres(date, fin);
  else {
    if (!Array.isArray(v.jours) || v.jours.some(j => typeof j !== 'string' || !isValidDate(j))) return { champ: 'jours', message: 'Jours de la session : dates invalides' };
    jours = [...new Set(v.jours as ISODate[])].sort();
    if (jours.some(j => j < date || j > fin)) return { champ: 'jours', message: 'Jours de la session : un jour est hors de la période' };
    if (jours[0] !== date || jours[jours.length - 1] !== fin) return { champ: 'jours', message: 'Jours de la session : le premier et le dernier jour en font partie' };
  }
  if (jours.length > SESSION_JOURS_MAX) return { champ: 'jours', message: `Jours de la session : ${SESSION_JOURS_MAX} au plus` };

  const brut = v.horaires === undefined || v.horaires === null ? [] : v.horaires;
  if (!Array.isArray(brut)) return { champ: 'horaires', message: 'Horaires de la session invalides' };
  if (brut.length > 1 && brut.length !== jours.length) return { champ: 'horaires', message: 'Horaires de la session : un seul pour tous les jours, ou un par jour' };
  const horaires: HoraireSession[] = [];
  for (const [i, x] of brut.entries()) {
    const quand = brut.length > 1 ? ` (${fmtIsoShort(jours[i])})` : '';
    const debut = x?.debut, hfin = x?.fin, pause = x?.pause === undefined || x?.pause === null || x?.pause === '' ? 0 : Number(x.pause);
    if (typeof debut !== 'string' || !HEURE.test(debut) || typeof hfin !== 'string' || !HEURE.test(hfin)) return { champ: 'horaires', message: `Horaires de la session${quand} : heures de début et de fin, au format 08:30` };
    if (hfin <= debut) return { champ: 'horaires', message: `Horaires de la session${quand} : la fin suit le début` };
    if (!Number.isInteger(pause) || pause < 0 || pause > SESSION_PAUSE_MAX) return { champ: 'horaires', message: `Horaires de la session${quand} : pause en minutes, de 0 à ${SESSION_PAUSE_MAX}` };
    if (pause >= minutes(hfin) - minutes(debut)) return { champ: 'horaires', message: `Horaires de la session${quand} : la pause dépasse la journée` };
    horaires.push({ debut, fin: hfin, pause });
  }
  return { plage: { fin, jours, horaires } };
}

/** Plage décalée de `n` jours (nouvelle date sans nouvelle plage : la session garde sa forme). */
export function decalerPlage(s: PlageSource, n: number): Plage {
  return { fin: addD(finSession(s), n), jours: joursSession(s).map(j => addD(j, n)), horaires: s.horaires ?? [] };
}

/** « du 14 oct. 2026 » (un jour), « du 21 oct. au 23 oct. 2026 · 3 jours » : suite de « Session … », « inscrit à la session … ». */
export const sessionDu = (s: PlageSource) => (surPlusieursJours(s) ? plageTexte(s) : `du ${fmtIso(s.date)}`);
