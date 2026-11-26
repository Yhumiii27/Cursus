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
import { t } from '../../i18n/langue.ts';

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
  const txt = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  if (!l) {
    return {
      date: today, categorie, montant: '', devise: 'EUR', taux: '', montantEur: '', tvaTaux: txt(tauxPropose(categorie)), tvaMontant: '', commercant: '', invites: '',
      forfait: '', pays: '', km: '', vehiculeId: '', depart: '', arrivee: '', motifDepassement: '', sansJustificatif: false,
    };
  }
  const [forfait, pays] = (l.forfait ?? '').split(':');
  return {
    date: l.date, categorie: l.categorie, montant: txt(l.montant), devise: l.devise, taux: txt(l.taux), montantEur: l.devise === 'EUR' || l.taux ? '' : txt(l.montantEur),
    tvaTaux: txt(l.tvaTaux), tvaMontant: txt(l.tvaMontant), commercant: l.commercant ?? '', invites: l.invites ?? '', forfait: forfait ?? '', pays: pays ?? '',
    km: txt(l.km), vehiculeId: l.vehiculeId ? String(l.vehiculeId) : '', depart: l.depart ?? '', arrivee: l.arrivee ?? '', motifDepassement: l.motifDepassement ?? '',
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
  e.date = !c.date ? t('Enter the date of the expense.') : !isValidDate(c.date) ? t('Invalid date.') : c.date > today ? t('The date cannot be in the future.') : null;
  if (c.categorie === 'ik') {
    const km = nombreSaisi(c.km);
    e.km = km === null ? t('Enter the distance travelled.') : km <= 0 || km > 5000 ? t('Distance in km, more than 0 and 5,000 at most.') : null;
    e.vehiculeId = c.vehiculeId ? null : t('Choose the vehicle (declare it first in My expenses).');
    return e;
  }
  const m = nombreSaisi(c.montant);
  if (c.categorie === 'forfait') {
    e.forfait = !c.forfait ? t('Choose the flat rate.') : c.forfait === 'etranger' && !c.pays ? t('Choose the country.') : null;
    e.montant = c.montant.trim() && (m === null || m <= 0) ? t('Amount in euros, more than 0.') : null;
    return e;
  }
  e.montant = !c.montant.trim() ? t('Enter the amount paid.') : m === null || m <= 0 || m > 100000 ? t('Amount more than 0 and 100,000 at most.') : null;
  const devise = c.devise.trim().toUpperCase() || 'EUR';
  e.devise = estDevise(devise) ? null : t('Three-letter currency code (EUR, USD…).');
  if (devise !== 'EUR' && !e.devise) {
    const taux = nombreSaisi(c.taux), deb = nombreSaisi(c.montantEur);
    e.taux = (c.taux.trim() && (taux === null || taux <= 0)) || (c.montantEur.trim() && (deb === null || deb <= 0)) ? t('Rate or amount debited: positive number.') : null;
  }
  e.invites = c.categorie === 'repas_affaires' && !c.invites.trim() ? t('Enter the guests of the business meal.') : null;
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

/** Champs proposés d'après un reçu collé : seulement ceux reconnus (montant, date, devise, TVA, commerçant), nommés dans la langue affichée. */
export function propositionsRecu(r: LectureRecu, c: ChampsDepense): { champs: ChampsDepense; reconnus: string[] } {
  const out = { ...c }, reconnus: string[] = [];
  const txt = (n: number) => String(n).replace('.', ',');
  if (r.montant !== undefined) { out.montant = txt(r.montant); reconnus.push(t('amount#lower')); }
  if (r.date) { out.date = r.date; reconnus.push(t('date')); }
  if (r.devise) { out.devise = r.devise; reconnus.push(t('currency#lower')); }
  if (r.tva?.length) {
    out.tvaTaux = txt(r.tva[0].taux);
    out.tvaMontant = r.tva.length === 1 && r.tva[0].montant != null ? txt(r.tva[0].montant) : '';
    reconnus.push(t('VAT'));
  }
  if (r.commercant) { out.commercant = r.commercant; reconnus.push(t('merchant#lower')); }
  return { champs: out, reconnus };
}

/** La catégorie demande-t-elle un reçu (frais réel) ? */
export const demandeRecu = (c: CategorieFrais) => CATEGORIES_FRAIS[c].justificatif;
