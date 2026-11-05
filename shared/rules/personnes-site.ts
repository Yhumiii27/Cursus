// lot 14 — personnes sur site (demande de Vigie du 4 novembre 2026, décision CV-10) : intérimaires et salariés
// d'entreprises extérieures tenus par Cursus avec un matricule de site permanent, préfixé `I` (intérimaire) ou `E`
// (extérieur), retrouvé quand la personne revient sur site.
// - Intérimaire : fiche ordinaire (contrat `interim`, agence) ; son matricule `I` s'ajoute au matricule Cursus `EMP-…`,
//   qui reste l'identifiant échangé avec Keystone (choix du propriétaire du 5 novembre 2026).
// - Extérieur : fiche marquée `exterieur`, sans contrat avec l'entreprise : rangée à part dans l'instantané
//   (`Dataset.exterieurs`, server/src/lecture-brute.ts), donc hors de tout ce qui parcourt `employes` (paie, congés, temps,
//   entretiens, effectifs, organigramme, Keystone…) ; ses titres et habilitations se tiennent comme ceux d'un salarié
//   (`Domain.emp` la retrouve par son identifiant).
// Un matricule de site n'est jamais réattribué ni modifié : posé à la création (ou au passage à l'intérim), il suit la fiche.
import type { Employe } from '../types.ts';
import { controleAdresse, normaliserAdresse } from './messagerie.ts';

/** Catégorie publiée aux autres outils (contrat D01 v2 de `pub_salaries`, demande de Vigie à Matrix du 4 novembre 2026). */
export type CategoriePersonne = 'salarie' | 'interimaire' | 'exterieur';

/** Préfixe du matricule de site de chaque catégorie qui en porte un. */
export const PREFIXES_SITE = { interimaire: 'I', exterieur: 'E' } as const;
/** Matricule de site : préfixe et cinq chiffres (I00001, E00042). */
export const MATRICULE_SITE_RE = /^[IE]\d{5}$/;
/** Longueur maximale d'un nom ou d'une raison sociale saisis. */
export const TEXTE_MAX = 120;

/** Catégorie d'une fiche : extérieur, sinon intérimaire selon le contrat, sinon salarié. */
export function categorieDe(e: Pick<Employe, 'typeContrat'> & { exterieur?: boolean | null }): CategoriePersonne {
  if (e.exterieur) return 'exterieur';
  return e.typeContrat === 'interim' ? 'interimaire' : 'salarie';
}

/** Entreprise d'une personne : raison sociale d'un extérieur, agence d'un intérimaire, rien pour un salarié. */
export function entrepriseDe(e: Pick<Employe, 'typeContrat' | 'agence'> & { exterieur?: boolean | null; entreprise?: string | null }): string | null {
  const c = categorieDe(e);
  if (c === 'exterieur') return e.entreprise?.trim() || null;
  if (c === 'interimaire') return e.agence?.trim() || null;
  return null;
}

/**
 * Matricule de site suivant d'un préfixe : un de plus que le plus grand déjà attribué (fiches retirées comprises : un
 * matricule n'est jamais réattribué), sur cinq chiffres.
 */
export function prochainMatriculeSite(prefixe: 'I' | 'E', existants: readonly (string | null | undefined)[]): string {
  const max = existants.reduce((n, m) => (m && m[0] === prefixe && MATRICULE_SITE_RE.test(m) ? Math.max(n, Number(m.slice(1))) : n), 0);
  if (max >= 99999) throw new Error(`Plus de matricule ${prefixe} disponible`);
  return `${prefixe}${String(max + 1).padStart(5, '0')}`;
}

/** Saisie d'une fiche d'extérieur par le service RH (ou reprise d'une pré-déclaration validée). */
export interface SaisieExterieur { nom: string; entreprise: string; email: string | null }

/** Saisie normalisée : espaces retirés, adresse en minuscules (null si vide). */
export function normaliserExterieur(p: Record<string, unknown>): SaisieExterieur {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
  return { nom: t(p.nom), entreprise: t(p.entreprise), email: normaliserAdresse(p.email) };
}

/** Erreurs d'une saisie d'extérieur (vide : recevable). `adressesPrises` : adresses déjà attribuées, avec le nom. */
export function erreursExterieur(s: SaisieExterieur, adressesPrises: Readonly<Record<string, string>> = {}): string[] {
  const out: string[] = [];
  if (s.nom.length < 2) out.push('Indiquez le nom et le prénom.');
  else if (s.nom.length > TEXTE_MAX) out.push(`Nom trop long (${TEXTE_MAX} caractères au plus).`);
  if (s.entreprise.length < 2) out.push('Indiquez l’entreprise de la personne.');
  else if (s.entreprise.length > TEXTE_MAX) out.push(`Entreprise trop longue (${TEXTE_MAX} caractères au plus).`);
  const adresse = controleAdresse(s.email, 'Adresse e-mail');
  if (adresse) out.push(adresse);
  else if (s.email && adressesPrises[s.email]) out.push(`Adresse e-mail déjà attribuée à ${adressesPrises[s.email]}.`);
  return out;
}
