// Repos hebdomadaire et dominical à vérifier par le service RH (semaine à 7 jours, ./semaine.ts) : feuilles soumises ou
// validées des dernières semaines qui portent une alerte de repos (`calcSheet().repos` : 7 jours travaillés, heures le
// dimanche sans dérogation de l'équipe). Rien n'est bloqué : le valideur lit l'alerte sur la feuille et dans la file de
// validation, et la feuille validée (une à une ou en groupe, temps.validerLot) reste signalée ici au service RH, jusqu'à
// la sortie de la fenêtre. Écran Temps, espace RH (client/src/components/ReposAVerifier.tsx).
import { addD, mondayOf } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Employe, FeuilleTemps, ISODate } from '../types.ts';
import { calcSheet } from './temps.ts';

/** Semaines suivies (en cours comprise) : un trimestre, de quoi couvrir la période de paie et sa régularisation. */
export const SEMAINES_REPOS = 12;

export interface ReposAVerifier { sh: FeuilleTemps; e: Employe; alertes: string[] }

/** Alertes de repos d'une feuille soumise ou validée (vide sinon, ou pour une fiche absente de l'instantané). */
export function alertesReposFeuille(d: Domain, sh: FeuilleTemps): { e: Employe; alertes: string[] } | null {
  if (sh.statut !== 'soumise' && sh.statut !== 'validee') return null;
  const e = d.emp(sh.empId);
  if (!e) return null;
  const alertes = calcSheet(d, e, sh).repos;
  return alertes.length ? { e, alertes } : null;
}

/** Feuilles des `semaines` dernières semaines (jusqu'à celle de `today`) qui portent une alerte de repos, les plus récentes d'abord. */
export function reposAVerifier(d: Domain, today: ISODate = d.ti, semaines = SEMAINES_REPOS): ReposAVerifier[] {
  const depuis = addD(mondayOf(today), -7 * (semaines - 1)), jusque = mondayOf(today);
  return d.ds.feuilles
    .filter(sh => sh.week >= depuis && sh.week <= jusque)
    .flatMap(sh => { const r = alertesReposFeuille(d, sh); return r ? [{ sh, ...r }] : []; })
    .sort((a, b) => b.sh.week.localeCompare(a.sh.week) || a.e.nom.localeCompare(b.e.nom));
}

/** Nombre de feuilles d'une sélection (validation groupée) qui portent une alerte de repos. */
export const nombreAvecRepos = (d: Domain, feuilles: readonly { empId: number; week: ISODate }[]) =>
  feuilles.filter(f => { const sh = d.ds.feuilles.find(x => x.empId === f.empId && x.week === f.week); return !!sh && !!alertesReposFeuille(d, sh); }).length;
