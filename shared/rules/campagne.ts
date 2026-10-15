// Campagne d'entretiens annuels : dates, population concernée et affichage de l'échéance, réglés par l'administrateur RH
// (Paramètres → Campagne d’entretiens annuels ; réglages `campagne*` de shared/reglages.ts). Par défaut, le fonctionnement
// d'origine : du 1er octobre au 15 décembre, sans ancienneté minimale, seul l'intérim exclu, échéance affichée toute
// l'année. L'intérim est toujours exclu : l'intérimaire est évalué par son agence, dont il est le salarié.
import { addD, addM, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Employe, ISODate, Settings, TypeContrat } from '../types.ts';

/** Contrats que l'administrateur RH peut exclure de la campagne (cases à cocher de l'écran Paramètres). */
export const CONTRATS_EXCLUABLES = ['cdd', 'alternance'] as const satisfies readonly TypeContrat[];
/** Préavis « toute l'année » : l'échéance de la campagne s'affiche dès le 1er janvier (fonctionnement d'origine). */
export const PREAVIS_TOUTE_ANNEE = 365;
/** Choix d'ancienneté minimale (mois) et de préavis (jours) proposés à l'écran ; le serveur borne toute autre valeur. */
export const ANCIENNETES = [0, 3, 6, 12] as const;
export const PREAVIS = [PREAVIS_TOUTE_ANNEE, 90, 60, 30, 0] as const;

export interface Campagne {
  annee: number;
  debut: ISODate;
  fin: ISODate;
  /** Premier jour où l'échéance « Entretien annuel » s'affiche (préavis avant l'ouverture). */
  visibleDes: ISODate;
  /** « Campagne 2026 — du 1er octobre au 15 décembre » */
  libelle: string;
}

/** « 1er octobre », « 15 décembre » : jour et mois d'un réglage « MM-JJ ». */
export function jourEtMois(mmjj: string): string {
  const t = parse(`2027-${mmjj}`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return t.replace(/^1 /, '1er ');
}

/** Campagne de l'année `annee`, selon les réglages en vigueur. */
export function campagne(s: Settings, annee: number): Campagne {
  const debut = `${annee}-${s.campagneDebut}`, fin = `${annee}-${s.campagneFin}`;
  const visibleDes = s.campagnePreavisJours >= PREAVIS_TOUTE_ANNEE ? `${annee}-01-01` : addD(debut, -s.campagnePreavisJours);
  return { annee, debut, fin, visibleDes, libelle: `Campagne ${annee} — du ${jourEtMois(s.campagneDebut)} au ${jourEtMois(s.campagneFin)}` };
}

/**
 * Salarié concerné par la campagne : ni intérimaire, ni d'un contrat exclu par le réglage, et entré depuis au moins
 * l'ancienneté minimale à l'ouverture de la campagne (0 : aucune condition, même pour une entrée pendant la campagne).
 */
export function concerneParCampagne(d: Domain, e: Employe, c: Campagne): boolean {
  const s = d.ds.settings;
  if (d.contratOf(e).interim || s.campagneExclus.includes(e.typeContrat)) return false;
  return s.campagneAncienneteMois <= 0 || e.entree <= addM(c.debut, -s.campagneAncienneteMois);
}

/** Population de la campagne de l'année parmi `ids` (indicateur « Campagne annuelle » de l'écran Entretiens). */
export function populationCampagne(d: Domain, ids: number[]): number[] {
  const c = campagne(d.ds.settings, d.year);
  return ids.filter(id => { const e = d.emp(id); return !!e && concerneParCampagne(d, e, c); });
}
