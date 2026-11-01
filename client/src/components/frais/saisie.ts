// Saisie d'une dépense (lot 11, chantier C5, étape 2) : champs du formulaire, contrôles affichés sous chaque champ et
// paramètres envoyés à `frais.ligne.ajouter` / `frais.ligne.modifier`, sans React (dialogs/FraisDepenseDialog.tsx, page
// « Hors ligne » ; tests/client-frais.test.ts). Le serveur refait tous les contrôles (server/src/actions/frais.ts).
// Lecture du reçu : texte collé depuis l'outil du téléphone (Live Text, Google Lens), propositions de
// shared/rules/frais-lecture.ts que la personne vérifie ; le texte n'est ni gardé ni envoyé.
import { isValidDate } from '../../../../shared/dates.ts';
import { CATEGORIES_FRAIS, estDevise, LISTE_CATEGORIES_FRAIS } from '../../../../shared/rules/frais.ts';
import type { LectureRecu } from '../../../../shared/rules/frais-lecture.ts';
import { tauxPropose } from '../../../../shared/rules/frais-tva.ts';
import type { CategorieFrais, ISODate, LigneFrais } from '../../../../shared/types.ts';

/** Champs du formulaire, en texte (tels que saisis). */
export interface ChampsDepense {
  date: string; categorie: CategorieFrais; montant: string; devise: string; taux: string; montantEur: string;
  tvaTaux: string; tvaMontant: string; commercant: string; invites: string; forfait: string; pays: string;
  km: string; vehiculeId: string; depart: string; arrivee: string; motifDepassement: string; sansJustificatif: boolean;
}

/** Catégories proposées : une note de frais médicaux ne porte que des frais médicaux, une autre jamais. */
export const categoriesProposees = (medicale: boolean): CategorieFrais[] => (medicale ? ['medical'] : LISTE_CATEGORIES_FRAIS.filter(c => c !== 'medical'));

/** Catégories de la dépense rapide (photo, montant, date) : frais réels sur reçu, ni indemnité, ni forfait, ni médical. */
export const CATEGORIES_RAPIDES: CategorieFrais[] = LISTE_CATEGORIES_FRAIS.filter(c => c !== 'medical' && c !== 'ik' && c !== 'forfait');

/** Champs vides (nouvelle dépense) ou repris d'une dépense à modifier. */
export function champsDepense(today: ISODate, categorie: CategorieFrais, l?: LigneFrais | null): ChampsDepense {
  const t = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  if (!l) {
    return {
      date: today, categorie, montant: '', devise: 'EUR', taux: '', montantEur: '', tvaTaux: t(tauxPropose(categorie)), tvaMontant: '', commercant: '', invites: '',
      forfait: '', pays: '', km: '', vehiculeId: '', depart: '', arrivee: '', motifDepassement: '', sansJustificatif: false,
    };
  }
  const [forfait, pays] = (l.forfait ?? '').split(':');
  return {
    date: l.date, categorie: l.categorie, montant: t(l.montant), devise: l.devise, taux: t(l.taux), montantEur: l.devise === 'EUR' || l.taux ? '' : t(l.montantEur),
    tvaTaux: t(l.tvaTaux), tvaMontant: t(l.tvaMontant), commercant: l.commercant ?? '', invites: l.invites ?? '', forfait: forfait ?? '', pays: pays ?? '',
    km: t(l.km), vehiculeId: l.vehiculeId ? String(l.vehiculeId) : '', depart: l.depart ?? '', arrivee: l.arrivee ?? '', motifDepassement: l.motifDepassement ?? '',
    sansJustificatif: l.sansJustificatif,
  };
}

/** Nombre saisi (virgule admise, espaces retirés) ; null : vide ou illisible. */
export const nombreSaisi = (v: string): number | null => {
  const s = v.replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export type ErreursDepense = Partial<Record<'date' | 'montant' | 'devise' | 'km' | 'vehiculeId' | 'forfait' | 'invites' | 'taux', string | null>>;

/** Contrôles de la saisie, sous chaque champ ; `aJustificatif` : un fichier choisi ou déjà joint. */
export function erreursDepense(c: ChampsDepense, today: ISODate): ErreursDepense {
  const e: ErreursDepense = {};
  e.date = !c.date ? 'Indiquez la date de la dépense.' : !isValidDate(c.date) ? 'Date invalide.' : c.date > today ? 'La date ne peut pas être dans le futur.' : null;
  if (c.categorie === 'ik') {
    const km = nombreSaisi(c.km);
    e.km = km === null ? 'Indiquez la distance parcourue.' : km <= 0 || km > 5000 ? 'Distance en km, plus de 0 et 5 000 au plus.' : null;
    e.vehiculeId = c.vehiculeId ? null : 'Choisissez le véhicule (déclarez-le d’abord dans Mes frais).';
    return e;
  }
  const m = nombreSaisi(c.montant);
  if (c.categorie === 'forfait') {
    e.forfait = !c.forfait ? 'Choisissez le forfait.' : c.forfait === 'etranger' && !c.pays ? 'Choisissez le pays.' : null;
    e.montant = c.montant.trim() && (m === null || m <= 0) ? 'Montant en euros, plus de 0.' : null;
    return e;
  }
  e.montant = !c.montant.trim() ? 'Indiquez le montant payé.' : m === null || m <= 0 || m > 100000 ? 'Montant plus de 0 et 100 000 au plus.' : null;
  const devise = c.devise.trim().toUpperCase() || 'EUR';
  e.devise = estDevise(devise) ? null : 'Code de devise à trois lettres (EUR, USD…).';
  if (devise !== 'EUR' && !e.devise) {
    const taux = nombreSaisi(c.taux), deb = nombreSaisi(c.montantEur);
    e.taux = (c.taux.trim() && (taux === null || taux <= 0)) || (c.montantEur.trim() && (deb === null || deb <= 0)) ? 'Taux ou montant débité : nombre positif.' : null;
  }
  e.invites = c.categorie === 'repas_affaires' && !c.invites.trim() ? 'Indiquez les invités du repas d’affaires.' : null;
  return e;
}

/** Paramètres de l'action (sans `noteId` ni `id`, ajoutés par l'écran) : seulement les champs de la catégorie. */
export function payloadDepense(c: ChampsDepense): Record<string, unknown> {
  const nb = (v: string) => { const n = nombreSaisi(v); return n === null ? '' : n; };
  const p: Record<string, unknown> = { date: c.date, categorie: c.categorie, commercant: c.commercant.trim(), sansJustificatif: c.sansJustificatif, attestation: c.sansJustificatif };
  if (c.categorie === 'ik') return { ...p, commercant: '', km: nb(c.km), vehiculeId: Number(c.vehiculeId) || null, depart: c.depart.trim(), arrivee: c.arrivee.trim() };
  if (c.categorie === 'forfait') return { ...p, commercant: '', forfait: c.forfait === 'etranger' ? `etranger:${c.pays}` : c.forfait, montant: nb(c.montant) };
  const devise = c.devise.trim().toUpperCase() || 'EUR';
  return {
    ...p, montant: nb(c.montant), devise,
    ...(devise !== 'EUR' ? { taux: nb(c.taux), ...(c.montantEur.trim() ? { montantEur: nb(c.montantEur) } : {}) } : {}),
    tvaTaux: c.tvaTaux === '' ? '' : nb(c.tvaTaux), tvaMontant: nb(c.tvaMontant),
    invites: c.categorie === 'repas_affaires' ? c.invites.trim() : '', motifDepassement: c.motifDepassement.trim(),
  };
}

/** Champs proposés d'après un reçu collé : seulement ceux reconnus (montant, date, devise, TVA, commerçant). */
export function propositionsRecu(r: LectureRecu, c: ChampsDepense): { champs: ChampsDepense; reconnus: string[] } {
  const out = { ...c }, reconnus: string[] = [];
  const t = (n: number) => String(n).replace('.', ',');
  if (r.montant !== undefined) { out.montant = t(r.montant); reconnus.push('montant'); }
  if (r.date) { out.date = r.date; reconnus.push('date'); }
  if (r.devise) { out.devise = r.devise; reconnus.push('devise'); }
  if (r.tva?.length) {
    out.tvaTaux = t(r.tva[0].taux);
    out.tvaMontant = r.tva.length === 1 && r.tva[0].montant != null ? t(r.tva[0].montant) : '';
    reconnus.push('TVA');
  }
  if (r.commercant) { out.commercant = r.commercant; reconnus.push('commerçant'); }
  return { champs: out, reconnus };
}

/** La catégorie demande-t-elle un reçu (frais réel) ? */
export const demandeRecu = (c: CategorieFrais) => CATEGORIES_FRAIS[c].justificatif;
