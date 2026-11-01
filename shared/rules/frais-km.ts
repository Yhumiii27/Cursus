// Indemnités kilométriques (lot 11, chantier C5) : barème fiscal de l'année (BOFiP BOI-BAREME-000001, retenu par
// l'URSSAF pour le véhicule personnel), saisi chaque année par l'administrateur RH (table `baremesKm`) ; aucune valeur
// n'est figée dans le code. Règles :
// - montant annuel = d × a + b, d la distance professionnelle de l'année, dans la tranche de puissance et de distance du
//   véhicule ; puissance plafonnée à 7 CV pour la voiture ; majoration de 20 % pour un véhicule électrique ;
// - une ligne reçoit la part marginale du montant annuel (montant au cumul après la ligne moins montant au cumul avant) :
//   les lignes de l'année s'additionnent exactement au montant annuel, quel que soit le changement de tranche ;
// - cumul annuel des kilomètres calculé sur les lignes (jamais stocké) ; régularisation = montant annuel dû moins ce qui
//   a été remboursé (barème publié en cours d'année, ligne refusée ou corrigée) ;
// - indemnité au-delà du barème plafonné (puissance réelle au-delà de 7 CV quand l'entreprise la rembourse, réglage
//   `fraisIkCvReels`, ou montant saisi au-dessus du barème) : allocation au-delà de la limite d'exonération, réintégrable ;
// - année sans barème : alerte « barème de l'année manquant » (le montant reste à calculer, rien n'est inventé).
// Le trajet domicile-travail est exclu (rappel à la saisie, étape 2) ; la distance est saisie, sans service cartographique.
import type { BaremeKm, LigneFrais, NoteFrais, TypeVehicule, VehiculePerso } from '../types.ts';
import { r2 } from './frais.ts';

/** Puissance fiscale plafonnée du barème (voiture : 7 CV au plus). */
export const CV_PLAFOND = 7;
/** Majoration pour un véhicule électrique (barème depuis 2021). */
export const MAJORATION_ELECTRIQUE = 1.2;

export const TYPES_VEHICULE: Record<TypeVehicule, string> = { voiture: 'Voiture', deux_roues: 'Deux-roues de 50 cm³ au plus', moto: 'Moto' };

/** Puissance retenue par le barème : plafonnée à 7 CV pour une voiture, sauf `reelle`. */
export const cvRetenus = (type: TypeVehicule, cv: number, reelle = false) => (type === 'voiture' && !reelle ? Math.min(cv, CV_PLAFOND) : cv);

/** Tranche du barème de l'année pour ce véhicule et cette distance annuelle ; null si le barème n'en a pas. */
export function trancheBareme(baremes: readonly BaremeKm[] | undefined, annee: number, type: TypeVehicule, cv: number, km: number): BaremeKm | null {
  return (baremes ?? [])
    .filter(b => b.annee === annee && b.type === type && cv >= b.cvMin && (b.cvMax == null || cv <= b.cvMax) && (b.kmMax == null || km <= b.kmMax))
    .sort((a, b) => a.kmMin - b.kmMin)[0] ?? null;
}

/** Barème de l'année saisi pour ce type de véhicule ? (Sinon : alerte « barème de l'année manquant ».) */
export const baremeSaisi = (baremes: readonly BaremeKm[] | undefined, annee: number, type: TypeVehicule = 'voiture') =>
  (baremes ?? []).some(b => b.annee === annee && b.type === type);

/**
 * Montant annuel de l'indemnité pour `km` kilomètres professionnels de l'année (d × a + b), majoré pour un véhicule
 * électrique ; `cvReels` : puissance réelle au lieu de la puissance plafonnée. null : barème de l'année absent.
 */
export function montantAnnuelIk(baremes: readonly BaremeKm[] | undefined, annee: number, v: Pick<VehiculePerso, 'type' | 'cv' | 'electrique'>, km: number, cvReels = false): number | null {
  if (km <= 0) return 0;
  const t = trancheBareme(baremes, annee, v.type, cvRetenus(v.type, v.cv, cvReels), km);
  if (!t) return null;
  return r2((km * t.a + t.b) * (v.electrique ? MAJORATION_ELECTRIQUE : 1));
}

/**
 * Indemnité d'un trajet de `km` kilomètres, `cumulAvant` kilomètres de l'année déjà parcourus : part marginale du montant
 * annuel. null : barème de l'année absent.
 */
export function ikDuTrajet(baremes: readonly BaremeKm[] | undefined, annee: number, v: Pick<VehiculePerso, 'type' | 'cv' | 'electrique'>, cumulAvant: number, km: number, cvReels = false): number | null {
  const apres = montantAnnuelIk(baremes, annee, v, cumulAvant + km, cvReels), avant = montantAnnuelIk(baremes, annee, v, cumulAvant, cvReels);
  return apres === null || avant === null ? null : r2(apres - avant);
}

/** Lignes d'indemnités kilométriques d'un salarié pour une année, en vigueur, dans des notes non annulées, par date puis identifiant. */
export function lignesIkDeLAnnee(lignes: readonly LigneFrais[], notes: readonly Pick<NoteFrais, 'id' | 'statut'>[], empId: number, annee: number): LigneFrais[] {
  const annulees = new Set(notes.filter(n => n.statut === 'annulee').map(n => n.id));
  return lignes.filter(l => l.empId === empId && l.categorie === 'ik' && !l.refuseeLe && !annulees.has(l.noteId) && l.date.startsWith(`${annee}-`) && (l.km ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** Kilomètres professionnels de l'année avant la ligne `avantId` (ou en tout), calculés sur les lignes (jamais stockés). */
export function cumulKm(lignesAnnee: readonly Pick<LigneFrais, 'id' | 'km' | 'date'>[], avant?: Pick<LigneFrais, 'id' | 'date'>): number {
  let n = 0;
  for (const l of lignesAnnee) {
    if (avant && (l.date > avant.date || (l.date === avant.date && l.id >= avant.id))) continue;
    n += l.km ?? 0;
  }
  return Math.round(n * 10) / 10;
}

/**
 * Régularisation de l'année : montant annuel dû au barème sur le cumul des kilomètres de l'année (`lignesAnnee`), moins
 * ce qui a déjà été remboursé (`rembourse`, euros). Positive : complément dû ; négative : trop-perçu. null : barème absent,
 * ou plusieurs véhicules dans l'année (calcul par véhicule, à faire par le service RH).
 */
export function regularisationIk(baremes: readonly BaremeKm[] | undefined, annee: number, v: Pick<VehiculePerso, 'type' | 'cv' | 'electrique'>,
  lignesAnnee: readonly Pick<LigneFrais, 'km' | 'vehiculeId'>[], rembourse: number): number | null {
  if (new Set(lignesAnnee.map(l => l.vehiculeId)).size > 1) return null;
  const du = montantAnnuelIk(baremes, annee, v, lignesAnnee.reduce((n, l) => n + (l.km ?? 0), 0));
  return du === null ? null : r2(du - rembourse);
}

/**
 * Part réintégrable d'une indemnité kilométrique (allocation au-delà de la limite d'exonération) : montant remboursé moins
 * le barème à la puissance plafonnée (`limite`). Jamais négative. null : barème absent.
 */
export function ikReintegrable(rembourse: number, limite: number | null): number | null {
  if (limite === null) return null;
  return r2(Math.max(0, rembourse - limite));
}

/** Véhicule en vigueur à une date (déclaré, période couvrant la date). */
export const vehiculeAuJour = (v: Pick<VehiculePerso, 'du' | 'au'>, jour: string) => v.du <= jour && (!v.au || jour <= v.au);
