// Doublons et conflits de dates d'un salarié : contrôle commun aux inscriptions en formation, absences, déplacements
// et entretiens. Calculé dans les dialogues (avertissements et blocages affichés en direct) et repris par le serveur,
// qui refuse les blocages.
import { ENT_TYPES } from '../constants.ts';
import { sessionActive, type Domain } from '../domain.ts';
import { fmtIso } from '../format.ts';
import type { ISODate, Session } from '../types.ts';
import { absenceActive, absenceBloque, periodeTexte } from './absences.ts';
import { voyageActif } from './deplacements.ts';
import { joursSession, plageTexte, sessionChevauche, surPlusieursJours } from './plage-session.ts';
import { natureAbsence } from './temps.ts';

/** Ce que l'on s'apprête à enregistrer pour le salarié. */
export type Engagement = 'formation' | 'absence' | 'voyage' | 'entretien';
/** `bad` : blocage (refusé par le serveur) ; sinon avertissement. */
export interface Conflit { text: string; bad: boolean }
/** L'engagement lui-même, à ne pas compter : session quittée par une réinscription, absence prolongée… */
export interface Exclure { sessionId?: number | null; voyageId?: number; entretienId?: number; absenceId?: number }

/** Sessions ouvertes (ni annulées ni clôturées) où le salarié est inscrit : recyclage rattaché ou formation initiale. */
export function sessionsInscrit(d: Domain, empId: number): Session[] {
  const ids = new Set<number | null>([
    ...(d.emp(empId)?.certs ?? []).map(c => c.sessionId),
    ...d.ds.inscriptions.filter(i => i.empId === empId).map(i => i.sessionId),
  ]);
  return d.ds.sessions.filter(s => ids.has(s.id) && sessionActive(s));
}

/**
 * Engagements du salarié qui chevauchent `du`…`au` (un entretien tient en un jour, une session en un ou plusieurs) :
 * - absence en vigueur (validée ou signalée) : blocage d'une inscription, d'un déplacement ou d'un entretien, le salarié
 *   étant absent (une absence sur une autre est refusée par `checkAbsence` / `checkNature`) ;
 * - déplacement : blocage d'un autre déplacement qui le chevauche ; session de formation : blocage d'une autre session
 *   le même jour ;
 * - sinon (demande d'absence en attente, déplacement, session ou entretien planifié) : avertissement, à reprogrammer.
 * La nature d'une absence n'est jamais citée quand elle est médicale (`natureAbsence`).
 */
export function conflitsDates(d: Domain, empId: number, du: ISODate, au: ISODate, objet: Engagement, exclure: Exclure = {}): Conflit[] {
  const out: Conflit[] = [];
  const chevauche = (debut: ISODate, fin: ISODate) => debut <= au && fin >= du;
  if (objet !== 'absence') {
    d.ds.absences.filter(a => a.empId === empId && a.id !== exclure.absenceId && absenceActive(a) && chevauche(a.du, a.au)).forEach(a => {
      const n = natureAbsence(a.type), nature = n ? ` (${n})` : '';
      out.push(absenceBloque(a)
        ? { text: `Absence ${a.statut === 'signalee' ? 'signalée' : 'validée'}${nature} ${periodeTexte(a.du, a.au)} : le salarié est absent`, bad: true }
        : { text: `Demande d’absence en attente${nature} ${periodeTexte(a.du, a.au)}`, bad: false });
    });
  }
  d.ds.voyages.filter(v => v.empId === empId && v.id !== exclure.voyageId && voyageActif(v) && chevauche(v.depart, v.retour)).forEach(v => {
    out.push({ text: `Déplacement ${objet === 'voyage' ? 'déjà prévu' : 'prévu'} — ${d.destOf(v.dest)?.pays ?? v.dest} ${periodeTexte(v.depart, v.retour)}`, bad: objet === 'voyage' });
  });
  // Session sur plusieurs jours : chacun de ses jours compte, pas le trou d'un week-end entre deux jours.
  sessionsInscrit(d, empId).filter(s => s.id !== exclure.sessionId && sessionChevauche(s, du, au)).forEach(s => {
    out.push({ text: `Inscrit à la session ${d.fm(s.formation)?.court ?? s.formation} ${surPlusieursJours(s) ? plageTexte(s) : `du ${fmtIso(s.date)}`}`, bad: objet === 'formation' });
  });
  d.ds.entretiens.filter(x => x.empId === empId && x.id !== exclure.entretienId && x.statut === 'planifie' && chevauche(x.date, x.date)).forEach(x => {
    out.push({ text: `${ENT_TYPES[x.type].nom} planifié le ${fmtIso(x.date)}`, bad: false });
  });
  return out;
}

/**
 * Conflits d'une inscription à la session `s` : ceux de chacun de ses jours (`conflitsDates`), une fois chacun. Une
 * absence posée le samedi entre deux jours d'une session qui reprend le lundi ne bloque pas l'inscription.
 */
export function conflitsSession(d: Domain, empId: number, s: Pick<Session, 'date'> & Partial<Pick<Session, 'fin' | 'jours'>>, exclure: Exclure = {}): Conflit[] {
  const vus = new Map<string, Conflit>();
  for (const j of joursSession(s)) {
    for (const c of conflitsDates(d, empId, j, j, 'formation', exclure)) {
      const prev = vus.get(c.text);
      if (!prev || (c.bad && !prev.bad)) vus.set(c.text, c);
    }
  }
  return [...vus.values()];
}

/** Premier blocage, pour le refus du serveur ; null s'il n'y a que des avertissements. */
export const blocage = (list: Conflit[]): string | null => list.find(c => c.bad)?.text ?? null;
