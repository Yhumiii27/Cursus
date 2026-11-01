// TVA des notes de frais (lot 11, chantier C5) : taux proposé selon la catégorie, TVA tirée du montant TTC, part
// récupérable (calculée, jamais stockée), exportée au compte de TVA déductible par l'export comptable (étape 2). Règles
// par défaut, à confirmer par la comptabilité (réponse attendue : règles de TVA du groupe) — CGI art. 271, ann. II
// art. 206 et 242 nonies A :
// - déduction seulement sur une dépense en France, en euros (la TVA étrangère se récupère par une autre procédure) ;
// - hébergement du personnel et transport de personnes (train, avion, taxi, transports en commun) : exclus ;
// - carburant d'un véhicule de tourisme : 80 % ; péage, parking et location d'un véhicule de tourisme : exclus ;
// - restaurant : déductible sur une note de 150 € HT au plus (note simplifiée) ; au-delà, la facture doit être au nom de
//   l'entreprise, que Cursus ne sait pas vérifier : non déduite, signalée ;
// - indemnités kilométriques, allocations forfaitaires et frais médicaux : sans TVA.
import type { CategorieFrais, LigneFrais } from '../types.ts';
import { r2 } from './frais.ts';

/** Taux de TVA en vigueur en France métropolitaine (%). */
export const TAUX_TVA = [20, 10, 5.5, 2.1] as const;

/** Montant HT au-delà duquel une note de restaurant doit être une facture au nom de l'entreprise (art. 242 nonies A). */
export const SEUIL_NOTE_SIMPLIFIEE_HT = 150;

/**
 * Par catégorie : taux proposé à la saisie (null : sans TVA) et part déductible (0 à 1). `restaurant` : déductible sous
 * le seuil de la note simplifiée.
 */
export const TVA_FRAIS: Record<CategorieFrais, { taux: number | null; deductible: number; restaurant?: true }> = {
  repas: { taux: 10, deductible: 1, restaurant: true },
  repas_affaires: { taux: 10, deductible: 1, restaurant: true },
  hotel: { taux: 10, deductible: 0 },
  train: { taux: 10, deductible: 0 },
  avion: { taux: 10, deductible: 0 },
  taxi: { taux: 10, deductible: 0 },
  transport: { taux: 10, deductible: 0 },
  carburant: { taux: 20, deductible: 0.8 },
  peage: { taux: 20, deductible: 0 },
  parking: { taux: 20, deductible: 0 },
  location: { taux: 20, deductible: 0 },
  divers: { taux: 20, deductible: 1 },
  ik: { taux: null, deductible: 0 },
  forfait: { taux: null, deductible: 0 },
  medical: { taux: null, deductible: 0 },
};

/** Taux proposé à la saisie d'une ligne de cette catégorie (null : aucune TVA). */
export const tauxPropose = (c: CategorieFrais) => TVA_FRAIS[c].taux;

/** TVA comprise dans un montant TTC au taux donné (%), au centime. */
export const tvaDepuisTtc = (ttc: number, taux: number) => r2(ttc - ttc / (1 + taux / 100));

/** Taux de TVA admis : un des taux en vigueur (ou 0). */
export const estTauxTva = (v: unknown): v is number => typeof v === 'number' && (v === 0 || (TAUX_TVA as readonly number[]).includes(v));

/** TVA de la ligne : montant saisi, sinon tiré du taux ; 0 hors euros ou sans taux. */
export function tvaDeLaLigne(l: Pick<LigneFrais, 'devise' | 'montantEur' | 'tvaTaux' | 'tvaMontant'>): number {
  if (l.devise !== 'EUR') return 0;
  if (l.tvaMontant != null) return r2(l.tvaMontant);
  return l.tvaTaux ? tvaDepuisTtc(l.montantEur, l.tvaTaux) : 0;
}

/**
 * TVA récupérable d'une ligne : TVA de la ligne × part déductible de sa catégorie ; restaurant au-delà de 150 € HT : 0
 * (facture au nom de l'entreprise à vérifier) ; ligne refusée, dépense hors de France ou en devise : 0.
 */
export function tvaRecuperable(l: Pick<LigneFrais, 'categorie' | 'devise' | 'montantEur' | 'tvaTaux' | 'tvaMontant' | 'refuseeLe'>): number {
  if (l.refuseeLe) return 0;
  const regle = TVA_FRAIS[l.categorie], tva = tvaDeLaLigne(l);
  if (!tva || !regle.deductible) return 0;
  if (regle.restaurant && l.montantEur - tva > SEUIL_NOTE_SIMPLIFIEE_HT) return 0;
  return r2(tva * regle.deductible);
}

/** Restaurant au-delà de la note simplifiée : la facture doit être au nom de l'entreprise (alerte au contrôle). */
export const factureEntrepriseAVerifier = (l: Pick<LigneFrais, 'categorie' | 'devise' | 'montantEur' | 'tvaTaux' | 'tvaMontant'>) =>
  !!TVA_FRAIS[l.categorie].restaurant && l.devise === 'EUR' && l.montantEur - tvaDeLaLigne(l) > SEUIL_NOTE_SIMPLIFIEE_HT;
