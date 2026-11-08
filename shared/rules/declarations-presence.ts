// lot 14 — pré-déclarations de présence sur site (demande de Vigie du 4 novembre 2026, décision CV-10). Une entreprise
// extérieure ou une agence d'intérim reçoit du service RH un lien permanent (un par entreprise ou agence, révocable) ; elle
// y déclare les personnes qu'elle enverra sur site, avec les dates et l'objet de la venue. Le service RH valide chaque
// déclaration (rattachée à une fiche existante, ou à une fiche créée : extérieur E, intérimaire I), la refuse ou l'annule.
// Seules les déclarations validées, puis éventuellement annulées, sont publiées à Vigie (contrat de
// `cursus.pub_presences_prevues`, défini par Matrix) ; une déclaration refusée ou restée sans suite est effacée
// `declarationsConservationMois` mois après (3 par défaut, durée à confirmer par le DPO).
import { addD, isValidDate } from '../dates.ts';
import type { ISODate } from '../types.ts';
import { controleAdresse, normaliserAdresse } from './messagerie.ts';
import { TEXTE_MAX } from './personnes-site.ts';

export type StatutDeclaration = 'a_valider' | 'validee' | 'refusee' | 'annulee';
export const STATUT_DECLARATION_LABEL: Record<StatutDeclaration, string> = {
  a_valider: 'À valider', validee: 'Validée', refusee: 'Refusée', annulee: 'Annulée',
};
/** Catégorie d'un lien : entreprise extérieure ou agence d'intérim. */
export type CategorieLien = 'exterieur' | 'interimaire';

/** Durée maximale d'une venue déclarée, et délai maximal avant son début. */
export const VENUE_MAX_JOURS = 92;
export const HORIZON_JOURS = 366;
/** Longueur maximale de l'objet d'une venue. */
export const OBJET_MAX = 300;
/** Conservation par défaut d'une déclaration refusée ou sans suite (mois), à confirmer par le DPO. */
export const CONSERVATION_DEFAUT_MOIS = 3;

/** Saisie d'une déclaration sur la page publique. */
export interface SaisieDeclaration { nom: string; prenom: string; email: string | null; siteCode: string; du: string; au: string; objet: string }

const texte = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** Saisie normalisée : espaces retirés, adresse en minuscules (null si vide), code de site en minuscules (comme les codes de Matrix). */
export function normaliserDeclaration(p: Record<string, unknown>): SaisieDeclaration {
  return {
    nom: texte(p.nom), prenom: texte(p.prenom), email: normaliserAdresse(p.email), siteCode: texte(p.siteCode).toLowerCase(),
    du: texte(p.du), au: texte(p.au), objet: texte(p.objet),
  };
}

/** Erreurs d'une saisie (vide : recevable) ; `sites` : codes des sites ouverts. */
export function erreursDeclaration(s: SaisieDeclaration, o: { today: ISODate; sites: readonly string[] }): string[] {
  const out: string[] = [];
  if (s.nom.length < 1 || s.prenom.length < 1) out.push('Indiquez le nom et le prénom de la personne.');
  else if (s.nom.length + s.prenom.length > TEXTE_MAX) out.push(`Nom et prénom trop longs (${TEXTE_MAX} caractères au plus).`);
  const adresse = controleAdresse(s.email, 'Adresse e-mail');
  if (adresse) out.push(adresse);
  if (!o.sites.includes(s.siteCode)) out.push('Choisissez le site de la venue.');
  if (!isValidDate(s.du) || !isValidDate(s.au)) out.push('Indiquez les dates de début et de fin de la venue.');
  else if (s.au < s.du) out.push('La fin de la venue précède son début.');
  else if (s.du < o.today) out.push('La venue ne peut pas commencer avant aujourd’hui.');
  else if (s.du > addD(o.today, HORIZON_JOURS)) out.push('La venue commence dans plus d’un an : déclarez-la plus tard.');
  else if (s.au > addD(s.du, VENUE_MAX_JOURS - 1)) out.push(`Une venue dure ${VENUE_MAX_JOURS} jours au plus : déclarez-en plusieurs.`);
  if (s.objet.length < 3) out.push('Indiquez l’objet de la venue.');
  else if (s.objet.length > OBJET_MAX) out.push(`Objet trop long (${OBJET_MAX} caractères au plus).`);
  return out;
}

/** Référence d'une déclaration : DP- et six chiffres. */
export const refDeclaration = (id: number) => `DP-${String(id).padStart(6, '0')}`;

/** Publiable à Vigie : validée, ou annulée après validation ; jamais en attente ni refusée. */
export function publiable(d: { statut: StatutDeclaration; valideeLe: string | null }): boolean {
  return d.statut === 'validee' || (d.statut === 'annulee' && !!d.valideeLe);
}

/**
 * Jour à partir duquel une déclaration est effacée : refusée, `mois` après la décision ; à valider, `mois` après la fin
 * de la venue déclarée (sans suite) ; annulée sans avoir été validée, `mois` après l'annulation. Une déclaration validée
 * (ou annulée après validation) suit la fiche de la personne : null.
 */
export function effaceeLe(d: { statut: StatutDeclaration; valideeLe: string | null; decideLe: string | null; au: ISODate }, mois: number): ISODate | null {
  if (publiable(d)) return null;
  const depart = d.statut === 'a_valider' ? d.au : (d.decideLe ?? '').slice(0, 10);
  if (!isValidDate(depart)) return null;
  return ajouterMois(depart, mois);
}

/** `date` plus `mois` mois, au dernier jour du mois quand le jour n'existe pas (31 mars + 1 mois → 30 avril). */
export function ajouterMois(date: ISODate, mois: number): ISODate {
  const [a, m, j] = date.split('-').map(Number);
  const total = a * 12 + (m - 1) + mois;
  const an = Math.floor(total / 12), mo = total % 12;
  const dernier = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
  return `${an}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

/** Nom complet d'une fiche créée à partir d'une déclaration : « Prénom Nom », comme les fiches saisies. */
export const nomComplet = (s: Pick<SaisieDeclaration, 'nom' | 'prenom'>) => `${s.prenom} ${s.nom}`.trim();

const cle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').sort().join(' ');

/**
 * Fiches proposées au rapprochement d'une déclaration : même adresse e-mail, ou mêmes nom et prénom (sans accents ni
 * ordre). Le service RH choisit ; rien n'est rattaché d'office.
 */
export function suggestions<P extends { id: number; nom: string; email?: string | null }>(s: Pick<SaisieDeclaration, 'nom' | 'prenom' | 'email'>, personnes: readonly P[]): P[] {
  const nom = cle(nomComplet(s));
  return personnes.filter(p => (s.email && p.email === s.email) || cle(p.nom) === nom);
}
