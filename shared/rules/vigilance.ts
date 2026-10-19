// Vigilance des pays de destination (t068, lot 6, chantier 2) : couleur de la carte des conseils aux voyageurs de France
// Diplomatie, saisie par le service RH sur la destination (écran Référentiels) avec le jour de sa vérification. France
// Diplomatie n'a pas d'API officielle : la mise à jour reste manuelle. Non renseignée par défaut, sans blocage.
// - Passer une destination à l'orange ou au rouge (depuis une couleur plus claire ou rien) alerte : déplacements à venir
//   ou en cours vers ce pays listés dans le message de l'action (le service RH, qui seul modifie une destination, n'est
//   pas notifié de sa propre action), salariés au journal, notification aux managers concernés (server/src/vigilance.ts).
// - Zone rouge : réserve du Go / No Go sous le code DEPLACEMENT existant (l'API Keystone ne change pas), sur les chantiers
//   dont le déplacement retenu va dans ce pays (`Domain.resourceStatus`).
// - Rappel « vérifier la vigilance sur France Diplomatie » sur le dossier voyage de chaque déplacement à venir ou en
//   cours tant que la vérification manque ou date de plus de `vigilanceRappelJours` jours (30 par défaut, réglable).
// Coordonnées sur place (hébergement, contact local, inscription sur Ariane) : champs du déplacement, service RH. Contact
// d'urgence : champ de la fiche salarié (`employe.contactUrgence`), saisi depuis le portail, contrôlé ici.
import { addD, isValidDate } from '../dates.ts';
import type { Destination, ISODate, Vigilance, Voyage } from '../types.ts';
import { voyageActif } from './deplacements.ts';

export const VIGILANCES: Record<Vigilance, { label: string; cls: string; rang: number }> = {
  vert: { label: 'Vigilance normale', cls: 'tag-neutral', rang: 1 },
  jaune: { label: 'Vigilance renforcée', cls: 'tag-outline', rang: 2 },
  orange: { label: 'Déconseillé sauf raison impérative', cls: 'tag-accent', rang: 3 },
  rouge: { label: 'Formellement déconseillé', cls: 'tag-accent', rang: 4 },
};
export const estVigilance = (v: unknown): v is Vigilance => typeof v === 'string' && Object.hasOwn(VIGILANCES, v);

/** « Vigilance renforcée (jaune) », « Vigilance non renseignée ». */
export const vigilanceTexte = (v: Vigilance | null | undefined) => (v ? `${VIGILANCES[v].label} (${v})` : 'Vigilance non renseignée');

/**
 * Vigilance saisie, contrôlée : couleur de la liste ou vide, et jour de la vérification (pas à venir), exigé avec une
 * couleur. Renvoie les erreurs par champ et les valeurs retenues.
 */
export function controlerVigilance(v: unknown, le: unknown, today: ISODate): { erreurs: { vigilance?: string; vigilanceLe?: string }; vigilance: Vigilance | null; vigilanceLe: ISODate | null } {
  const erreurs: { vigilance?: string; vigilanceLe?: string } = {};
  const couleur = v == null || v === '' ? null : estVigilance(v) ? v : null;
  if (v != null && v !== '' && !couleur) erreurs.vigilance = 'Vigilance inconnue : vert, jaune, orange ou rouge.';
  const jour = le == null || le === '' ? null : String(le);
  if (jour && !isValidDate(jour)) erreurs.vigilanceLe = 'Date de vérification invalide.';
  else if (jour && jour > today) erreurs.vigilanceLe = 'La vérification ne peut pas être à venir.';
  else if (couleur && !jour) erreurs.vigilanceLe = 'Indiquez le jour de la vérification sur France Diplomatie.';
  return { erreurs, vigilance: couleur, vigilanceLe: jour && !erreurs.vigilanceLe ? jour : null };
}

/** Passage à l'orange ou au rouge depuis une couleur plus claire (ou aucune) : déplacements prévus à signaler. */
export function devientDeconseillee(avant: Vigilance | null | undefined, apres: Vigilance | null | undefined): boolean {
  if (apres !== 'orange' && apres !== 'rouge') return false;
  return !avant || VIGILANCES[apres].rang > VIGILANCES[avant].rang;
}

/** Déplacements en vigueur, à venir ou en cours le `today`, vers la destination `code`. */
export const voyagesVers = <T extends Pick<Voyage, 'dest' | 'retour' | 'annuleLe'>>(voyages: readonly T[], code: string, today: ISODate): T[] =>
  voyages.filter(v => v.dest === code && voyageActif(v) && v.retour >= today);

/**
 * Rappel de vérification de la vigilance avant un départ (dossier voyage) : vérification jamais faite, ou faite plus de
 * `jours` jours avant aujourd'hui. Null : à jour, ou déplacement terminé.
 */
export function rappelVigilance(dest: Pick<Destination, 'vigilance' | 'vigilanceLe'> | undefined, v: Pick<Voyage, 'retour'>, today: ISODate, jours = 30): string | null {
  if (!dest || v.retour < today) return null;
  if (!dest.vigilanceLe) return 'Vigilance du pays jamais vérifiée : vérifiez-la sur France Diplomatie avant le départ (écran Référentiels).';
  if (dest.vigilanceLe < addD(today, -jours)) return `Vigilance vérifiée il y a plus de ${jours} jours : vérifiez-la de nouveau sur France Diplomatie avant le départ (écran Référentiels).`;
  return null;
}

/** Zone rouge : le Go / No Go prend une réserve (code DEPLACEMENT). */
export const zoneRouge = (dest: Pick<Destination, 'vigilance'> | undefined) => dest?.vigilance === 'rouge';

// — Coordonnées et contact d'urgence (textes libres, une ligne) —

/** Longueur maximale d'un texte de coordonnées (hébergement, contact sur place, contact d'urgence). */
export const COORDONNEES_MAX = 200;
/** Téléphone : chiffres, espaces, points, tirets, parenthèses, « + » en tête ; 30 caractères au plus. */
export const TELEPHONE = /^\+?[0-9 .()-]{6,30}$/;

/** Texte d'une ligne, espaces réduits ; vide : null. Renvoie la valeur, ou le message d'erreur. */
export function texteCoordonnees(v: unknown, libelle: string, max = COORDONNEES_MAX): { valeur: string | null } | { erreur: string } {
  if (v == null) return { valeur: null };
  if (typeof v !== 'string') return { erreur: `${libelle} : texte attendu` };
  const t = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) return { erreur: `${libelle} : ${max} caractères au plus` };
  return { valeur: t || null };
}

/** Contact d'urgence saisi : nom et téléphone, ensemble ou tous deux vides (contact retiré). */
export function controlerContactUrgence(nom: unknown, tel: unknown): { erreurs: { nom?: string; tel?: string }; nom: string | null; tel: string | null } {
  const erreurs: { nom?: string; tel?: string } = {};
  const n = texteCoordonnees(nom, 'Personne à prévenir', 120), t = texteCoordonnees(tel, 'Téléphone', 30);
  const vn = 'valeur' in n ? n.valeur : null, vt = 'valeur' in t ? t.valeur : null;
  if ('erreur' in n) erreurs.nom = n.erreur;
  if ('erreur' in t) erreurs.tel = t.erreur;
  else if (vt && !TELEPHONE.test(vt)) erreurs.tel = 'Téléphone : chiffres, espaces, points ou tirets, « + » pour l’indicatif.';
  if (vn && !vt && !erreurs.tel) erreurs.tel = 'Indiquez le téléphone de la personne à prévenir.';
  if (vt && !vn && !erreurs.nom) erreurs.nom = 'Indiquez la personne à prévenir.';
  return { erreurs, nom: vn, tel: vt };
}
