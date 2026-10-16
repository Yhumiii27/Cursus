// Suivi des feuilles de temps (t130) : état de chaque semaine × collaborateur sur les dernières semaines, pour voir qui
// n'a pas saisi, soumis ou corrigé sa feuille avant l'envoi à Sage, relancer (temps.relancer) et valider en groupe
// (temps.validerLot). Une feuille est attendue le jour réglé de la semaine suivante à l'heure réglée (par défaut le
// lundi suivant à 12 h : réglages `feuilleLimiteJour`, `feuilleLimiteHeure`) ; semaines hors contrat, semaines
// couvertes par une absence et semaines antérieures à la première feuille enregistrée dans Cursus (avant sa mise en
// service, rien n'y a été saisi) exclues. Partagé par les actions (server/src/actions/suivi-feuilles.ts) et l'écran Temps
// (client/src/components/SuiviFeuilles.tsx).
import { addD, horodatageParis, isoWeek, mondayOf, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Employe, FeuilleTemps, ISODate, Settings } from '../types.ts';
import { semaineHorsContrat } from './absences.ts';
import { semaineCouverte } from './temps.ts';

/**
 * État d'une semaine : `attendue` (aucune feuille, délai pas encore échu), `absente` (aucune feuille, délai échu),
 * `brouillon`, `soumise` (à valider), `a_corriger` (renvoyée), `validee`, `transmise` (à la paie).
 */
export type EtatSemaine = 'attendue' | 'absente' | 'brouillon' | 'soumise' | 'a_corriger' | 'validee' | 'transmise';

export const ETATS_SEMAINE: Record<EtatSemaine, { label: string; court: string; cls: string }> = {
  attendue: { label: 'À saisir', court: 'À saisir', cls: 'tag-outline' },
  absente: { label: 'Non saisie', court: 'Non saisie', cls: 'tag-accent' },
  brouillon: { label: 'Brouillon', court: 'Brouillon', cls: 'tag-outline' },
  soumise: { label: 'À valider', court: 'À valider', cls: 'tag-outline' },
  a_corriger: { label: 'À corriger', court: 'À corriger', cls: 'tag-accent' },
  validee: { label: 'Validée', court: 'Validée', cls: 'tag-neutral' },
  transmise: { label: 'Transmise à la paie', court: 'Transmise', cls: 'tag-neutral' },
};

/** Moment de référence : jour (date du jour de Cursus) et heure de Paris. */
export interface Maintenant { jour: ISODate; heure: number }
/** Jour de Cursus (`d.ti`, réglable en démonstration) à l'heure réelle de Paris. */
export const maintenantParis = (jour: ISODate, d: Date = new Date()): Maintenant => ({ jour, heure: Number(horodatageParis(d).slice(11, 13)) });

type Delai = Partial<Pick<Settings, 'feuilleLimiteJour' | 'feuilleLimiteHeure'>>;

/** Échéance de la feuille de la semaine `week` (lundi) : le jour réglé de la semaine suivante, à l'heure réglée. */
export function limiteFeuille(week: ISODate, s: Delai | undefined): { jour: ISODate; heure: number } {
  return { jour: addD(week, 7 + (s?.feuilleLimiteJour ?? 1) - 1), heure: s?.feuilleLimiteHeure ?? 12 };
}

/** Échéance passée à `m` (le jour même, à partir de l'heure réglée). */
export function echue(week: ISODate, s: Delai | undefined, m: Maintenant): boolean {
  const l = limiteFeuille(week, s);
  return m.jour > l.jour || (m.jour === l.jour && m.heure >= l.heure);
}

/** « lundi 12 oct. à 12 h ». */
export function limiteTexte(week: ISODate, s: Delai | undefined): string {
  const l = limiteFeuille(week, s);
  return `${parse(l.jour).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })} à ${l.heure} h`;
}

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
/** Règle d'échéance : « le lundi de la semaine suivante à 12 h ». */
export const delaiTexte = (s: Delai | undefined) => `le ${JOURS[(s?.feuilleLimiteJour ?? 1) - 1] ?? 'lundi'} de la semaine suivante à ${s?.feuilleLimiteHeure ?? 12} h`;

/** Les `n` dernières semaines (lundis), de la plus ancienne à la semaine en cours. */
export function semainesSuivies(today: ISODate, n = 5): ISODate[] {
  const cette = mondayOf(today);
  return Array.from({ length: n }, (_, i) => addD(cette, -7 * (n - 1 - i)));
}

/** Semaine d'un collaborateur : état (null : exclue, hors contrat ou couverte par une absence), retard, feuille. */
export interface CelluleSuivi { empId: number; week: ISODate; etat: EtatSemaine | null; enRetard: boolean; feuille: FeuilleTemps | null }

/** Première semaine où une feuille de temps a été enregistrée dans Cursus (null : aucune) : début de la saisie. */
export const debutSaisie = (d: Domain): ISODate | null => d.ds.feuilles.reduce<ISODate | null>((m, f) => (!m || f.week < m ? f.week : m), null);

/** État d'une semaine pour un collaborateur, à `m` ; `debut` : début de la saisie dans Cursus (semaines antérieures exclues). */
export function etatSemaine(d: Domain, e: Employe, week: ISODate, m: Maintenant, debut: ISODate | null = debutSaisie(d)): CelluleSuivi {
  const sh = d.ds.feuilles.find(f => f.empId === e.id && f.week === week) ?? null;
  const cellule = (etat: EtatSemaine | null): CelluleSuivi => ({
    empId: e.id, week, etat, feuille: sh,
    enRetard: (etat === 'absente' || etat === 'brouillon' || etat === 'a_corriger') && echue(week, d.ds.settings, m),
  });
  if (semaineHorsContrat(e, week) || (!sh && (!debut || week < debut))) return cellule(null);
  // Semaine d'arrêt, de congés… sans heure saisie : rien n'est attendu (une feuille soumise ou validée reste suivie).
  const vide = !sh || sh.lignes.every(l => l.h.every(h => !h));
  if (vide && (!sh || sh.statut === 'brouillon') && semaineCouverte(d, e, week, sh)) return cellule(null);
  if (!sh) return cellule(echue(week, d.ds.settings, m) ? 'absente' : 'attendue');
  if (sh.statut === 'validee') return cellule(sh.sage ? 'transmise' : 'validee');
  return cellule(sh.statut === 'rejetee' ? 'a_corriger' : sh.statut === 'soumise' ? 'soumise' : 'brouillon');
}

/** Tableau semaine × collaborateur : une ligne par collaborateur de `ids` (dans cet ordre), une cellule par semaine. */
export function etatSemaines(d: Domain, ids: readonly number[], semaines: readonly ISODate[], m: Maintenant = maintenantParis(d.ti)): { emp: Employe; cellules: CelluleSuivi[] }[] {
  const debut = debutSaisie(d);
  return ids.flatMap(id => {
    const e = d.emp(id);
    return e ? [{ emp: e, cellules: semaines.map(w => etatSemaine(d, e, w, m, debut)) }] : [];
  });
}

/** Cellule à relancer : feuille manquante, en brouillon ou à corriger, une fois l'échéance passée. */
export const aRelancer = (c: CelluleSuivi) => c.enRetard;
/** Cellule à saisir avant l'envoi à Sage : feuille manquante (échéance passée), en brouillon ou à corriger. */
export const aSaisir = (c: CelluleSuivi) => c.etat === 'absente' || c.etat === 'brouillon' || c.etat === 'a_corriger';

/** Compteurs du tableau : feuilles à saisir avant l'envoi à Sage, dont en retard, et feuilles à valider. */
export function compteursSuivi(lignes: readonly { cellules: CelluleSuivi[] }[]) {
  const toutes = lignes.flatMap(l => l.cellules);
  return { aSaisir: toutes.filter(aSaisir).length, enRetard: toutes.filter(aRelancer).length, aValider: toutes.filter(c => c.etat === 'soumise').length };
}

/** « S41, S42 » : semaines d'une liste de cellules. */
export const semainesTexte = (cellules: readonly Pick<CelluleSuivi, 'week'>[]) => cellules.map(c => `S${isoWeek(c.week)}`).join(', ');
