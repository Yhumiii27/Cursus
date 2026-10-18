// Heures de délégation des élus au CSE : mandats saisis par le service RH sur la fiche (titulaire ou suppléant, dates,
// crédit d'heures par mois proposé d'après la table de l'art. R2314-1 selon l'effectif, modifiable), heures imputées au
// code de délégation (CODE_DELEGATION, activité interne jamais envoyée à Keystone) dans les feuilles validées, et
// compteur mensuel comparé au crédit : report des heures non utilisées sur 12 mois et, dans le mois, une fois et demie
// le crédit au plus (art. R2315-5), mutualisation entre élus dans la même limite (art. R2315-6). Alerte seulement, jamais
// de blocage : le crédit peut être dépassé en cas de circonstances exceptionnelles (art. L2315-7).
// Visibilité (server/src/dataset.ts) : le service RH et l'élu ; le manager ne voit que la ligne de la feuille de temps.
// Sans mandat saisi, rien ne s'affiche.
import { TYPES_CONTRAT } from '../constants.ts';
import { addD, addM, isValidDate, joursSemaine } from '../dates.ts';
import { fH, num } from '../format.ts';
import type { Dataset, Employe, ISODate, Mandat, RoleMandat } from '../types.ts';
import { CODE_DELEGATION } from './activites.ts';
import { present } from './contrats.ts';

export const ROLES_MANDAT: Record<RoleMandat, string> = { titulaire: 'Élu titulaire', suppleant: 'Élu suppléant' };
export const estRoleMandat = (v: unknown): v is RoleMandat => typeof v === 'string' && Object.hasOwn(ROLES_MANDAT, v);

/**
 * Crédit mensuel d'heures de délégation d'un titulaire (art. R2314-1), par tranche d'effectif : [effectif minimal, heures].
 * Au-delà de 1 499 salariés, la table de l'article est à consulter (aucune valeur proposée).
 */
export const CREDIT_R2314_1: readonly (readonly [number, number])[] = [[11, 10], [50, 18], [75, 19], [100, 21], [200, 22], [500, 24]];
export const EFFECTIF_TABLE_MAX = 1499;
/** Crédit proposé pour un titulaire selon l'effectif ; null sous 11 salariés (pas de CSE) ou au-delà de la table reprise. */
export function creditLegal(effectif: number): number | null {
  if (effectif > EFFECTIF_TABLE_MAX) return null;
  return [...CREDIT_R2314_1].reverse().find(([min]) => effectif >= min)?.[1] ?? null;
}
/** Effectif retenu pour proposer le crédit : salariés présents à la date, hors intérimaires (à vérifier par le service RH). */
export const effectifSite = (ds: Pick<Dataset, 'employes'>, date: ISODate) =>
  ds.employes.filter(e => present(e, date) && !TYPES_CONTRAT[e.typeContrat]?.interim).length;
/**
 * Effectif de référence d'un instantané : celui que le serveur a calculé sur toutes les fiches (`effectifCse`), à défaut
 * celui des fiches transmises (données complètes : serveur, tests). Jamais recompté dans l'instantané filtré de l'élu.
 */
export const effectifReference = (ds: Pick<Dataset, 'employes' | 'effectifCse'>, date: ISODate) => ds.effectifCse ?? effectifSite(ds, date);
/** Crédit proposé à la saisie d'un mandat : celui du titulaire (art. R2314-1) ; un suppléant n'a pas de crédit propre. */
export const creditPropose = (role: RoleMandat, effectif: number) => (role === 'titulaire' ? creditLegal(effectif) ?? 0 : 0);

export const CREDIT_MAX = 200;
export interface ErreursMandat { role?: string; du?: string; au?: string; credit?: string }

/**
 * Contrôle d'un mandat saisi : rôle, début, fin facultative (après le début), crédit de 0 à 200 heures par mois au quart
 * d'heure ; deux mandats du même salarié ne se chevauchent pas (`autres` : ses autres mandats).
 */
export function controlerMandat(p: { role?: unknown; du?: unknown; au?: unknown; credit?: unknown }, autres: readonly Mandat[]):
  { erreurs: ErreursMandat; mandat: Pick<Mandat, 'role' | 'du' | 'au' | 'credit'> | null } {
  const erreurs: ErreursMandat = {};
  const valide = (s: unknown): s is ISODate => typeof s === 'string' && isValidDate(s);
  const du = p.du, au = p.au === '' || p.au == null ? null : p.au;
  const credit = Math.round(num(p.credit) * 4) / 4;
  if (!estRoleMandat(p.role)) erreurs.role = 'Choisissez titulaire ou suppléant.';
  if (!valide(du)) erreurs.du = 'Indiquez le début du mandat.';
  if (au !== null && !valide(au)) erreurs.au = 'Date de fin invalide.';
  else if (au !== null && valide(du) && au < du) erreurs.au = 'La fin du mandat suit son début.';
  if (String(p.credit ?? '').trim() === '' || !(credit >= 0 && credit <= CREDIT_MAX)) erreurs.credit = `Crédit : de 0 à ${CREDIT_MAX} heures par mois.`;
  if (!erreurs.du && !erreurs.au && valide(du)) {
    const chevauche = autres.find(m => m.du <= (au ?? '9999-12-31') && (m.au ?? '9999-12-31') >= du);
    if (chevauche) erreurs.du = 'Un autre mandat de ce salarié couvre déjà ces dates : modifiez-le plutôt.';
  }
  return Object.keys(erreurs).length ? { erreurs, mandat: null } : { erreurs, mandat: { role: p.role as RoleMandat, du: du as ISODate, au: au as ISODate | null, credit } };
}

// — Compteur mensuel —

/** Mois (AAAA-MM) d'une date ; `moisAvant(m, n)` : n mois plus tôt. */
const moisDe = (s: ISODate) => s.slice(0, 7);
const moisAvant = (m: string, n: number) => moisDe(addM(`${m}-01`, -n));
const finDuMois = (m: string) => addD(addM(`${m}-01`, 1), -1);

/** Mandats d'un salarié (instantané filtré : service RH, ou l'élu lui-même). */
export const mandatsDe = (ds: Pick<Dataset, 'mandats'>, empId: number) => (ds.mandats ?? []).filter(m => m.empId === empId).sort((a, b) => a.du.localeCompare(b.du));
/** Mandat en vigueur dans le mois (le dernier commencé si deux s'y succèdent) ; null : aucun. */
export function mandatDuMois(mandats: readonly Mandat[], mois: string): Mandat | null {
  return [...mandats].reverse().find(m => m.du <= finDuMois(mois) && (!m.au || m.au >= `${mois}-01`)) ?? null;
}

/** Heures imputées au code de délégation par mois (AAAA-MM), jour par jour, dans les feuilles validées du salarié. */
export function heuresDelegation(ds: Pick<Dataset, 'feuilles'>, empId: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const sh of ds.feuilles) {
    if (sh.empId !== empId || sh.statut !== 'validee') continue;
    const jours = joursSemaine(sh.week);
    for (const l of sh.lignes) {
      if (l.projet !== CODE_DELEGATION) continue;
      jours.forEach((day, i) => { const h = num(l.h[i]); if (h) out.set(moisDe(day), (out.get(moisDe(day)) ?? 0) + h); });
    }
  }
  return out;
}

export interface MoisDelegation {
  mois: string; role: RoleMandat;
  /** Crédit du mois (celui du mandat) et limite du mois : une fois et demie le crédit de référence. */
  credit: number; limite: number;
  /** Heures imputées au code de délégation dans les feuilles validées. */
  utilisees: number;
  /** Crédits moins heures utilisées sur les 12 mois finissant ce mois-ci : report encore disponible (négatif : dépassé). */
  report: number;
  alertes: string[];
}

/**
 * Compteur des 12 derniers mois d'un élu, jusqu'au mois de `today` compris (mois sans mandat omis) ; null sans mandat.
 * Limite du mois : une fois et demie le crédit du mandat, ou, pour un suppléant sans crédit propre, celui d'un titulaire
 * (art. R2314-1 selon `effectif`) qu'il reçoit par mutualisation.
 */
export function compteurDelegation(ds: Pick<Dataset, 'feuilles' | 'mandats'>, empId: number, today: ISODate, effectif: number): MoisDelegation[] | null {
  const mandats = mandatsDe(ds, empId);
  if (!mandats.length) return null;
  const heures = heuresDelegation(ds, empId), courant = moisDe(today);
  const credit = (m: string) => mandatDuMois(mandats, m)?.credit ?? 0;
  const rows: MoisDelegation[] = [];
  for (let n = 11; n >= 0; n--) {
    const mois = moisAvant(courant, n), mandat = mandatDuMois(mandats, mois);
    if (!mandat) continue;
    const reference = mandat.credit > 0 ? mandat.credit : creditLegal(effectif) ?? 0;
    const limite = reference * 1.5, utilisees = heures.get(mois) ?? 0;
    // Report sur 12 mois : crédits et heures des 12 mois glissants qui finissent ce mois-ci.
    const fenetre = Array.from({ length: 12 }, (_, i) => moisAvant(mois, i));
    const report = fenetre.reduce((s, m) => s + credit(m) - (heures.get(m) ?? 0), 0);
    const alertes: string[] = [];
    if (utilisees > limite) alertes.push(`${fH(utilisees)} dans le mois : au-delà d’une fois et demie le crédit (${fH(limite)}, art. R2315-5 et R2315-6)`);
    if (report < 0) alertes.push(`Crédit des 12 derniers mois dépassé de ${fH(-report)} : mutualisation entre élus (art. R2315-6) ou circonstances exceptionnelles (art. L2315-7) à justifier`);
    rows.push({ mois, role: mandat.role, credit: mandat.credit, limite, utilisees, report, alertes });
  }
  return rows;
}

/** Élu dont le compteur est affiché : un mandat au moins (le service RH et l'élu seuls le reçoivent). */
export const estElu = (ds: Pick<Dataset, 'mandats'>, e: Pick<Employe, 'id'>) => mandatsDe(ds, e.id).length > 0;
