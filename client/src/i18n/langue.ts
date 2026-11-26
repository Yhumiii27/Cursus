// Langue de l'interface (Norma § 2 et § 7, CU-N01) : chaînes sources en anglais, traduites en français par
// i18n/traduire.ts ; le français est la langue par défaut. Préférence par personne dans le cookie `cursus-lang` (`fr` |
// `en`, un an, tout le site), choisie par le sélecteur FR / EN de l'en-tête, juste avant le bouton sombre / clair.
// Le changement vaut aussitôt, sans aller-retour au serveur : l'attribut `lang` de <html> change et les composants abonnés
// (`useLangue`) sont rendus de nouveau. Le texte saisi par les personnes s'affiche tel quel, jamais passé par `t()`.
import { useSyncExternalStore } from 'react';
import { enFrancais, makeT, sansContexte, type Lang, type T } from './traduire.ts';

export { type Lang, type T };
export const LANGUE_COOKIE = 'cursus-lang';
export const LANGUE_PAR_DEFAUT: Lang = 'fr';

/** Langue d'une valeur de cookie : `en` seulement, toute autre valeur ou son absence donne le français. */
export const langueDe = (v: string | null | undefined): Lang => (v === 'en' ? 'en' : LANGUE_PAR_DEFAUT);

/** Cookie posé par le sélecteur : un an, tout le site. */
export const langueCookie = (l: Lang) => `${LANGUE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;

/** Langue lue dans un en-tête Cookie ou `document.cookie` (« a=1; cursus-lang=en ») ; absente ou inconnue : français. */
export function langueDuCookie(cookies: string | null | undefined): Lang {
  for (const part of (cookies ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === LANGUE_COOKIE) return langueDe(part.slice(i + 1).trim());
  }
  return LANGUE_PAR_DEFAUT;
}

const docu = (): Document | null => (typeof document === 'undefined' ? null : document);
let courante: Lang = langueDuCookie(docu()?.cookie);
let traduire: T = makeT(courante);
const abonnes = new Set<() => void>();
docu()?.documentElement.setAttribute('lang', courante);

/** Langue affichée. */
export const langueCourante = (): Lang => courante;

/** Traduit une chaîne source anglaise dans la langue affichée (identité en anglais). */
export const t: T = s => traduire(s);

/**
 * Nombre suivi de son nom, traduit : `tn(3, 'entry', 'entries')` donne « 3 entries » en anglais (pluriel dès 0 et au-delà de
 * 1) et, en français, le singulier ou le pluriel du dictionnaire selon la règle de `plural` (shared/format.ts : pluriel
 * au-delà de 1), « 3 saisies », « 0 saisie ». Les deux formes anglaises ont leur entrée française.
 */
export const tn = (n: number, un: string, plusieurs: string): string =>
  courante === 'fr' ? `${n} ${n > 1 ? enFrancais(plusieurs) : enFrancais(un)}` : `${n} ${sansContexte(n === 1 ? un : plusieurs)}`;

/**
 * Table de libellés lue dans la langue affichée : les sources anglaises restent dans `sources` et chaque clé, lue au
 * rendu, rend sa traduction (`LIBELLES.historique` donne « Historique » en français, « History » en anglais). Pour une
 * table exportée qu'un module sans React ou un test lit déjà par sa valeur.
 */
export function traduites<K extends string>(sources: Record<K, string>): Readonly<Record<K, string>> {
  const o = {} as Record<K, string>;
  for (const k of Object.keys(sources) as K[]) Object.defineProperty(o, k, { enumerable: true, get: () => t(sources[k]) });
  return o;
}

/** Change la langue : cookie, attribut `lang` de <html>, composants abonnés rendus de nouveau. */
export function choisirLangue(l: Lang, doc: Document | null = docu()): void {
  if (doc) {
    doc.cookie = langueCookie(l);
    doc.documentElement.setAttribute('lang', l);
  }
  if (l === courante) return;
  courante = l;
  traduire = makeT(l);
  for (const f of abonnes) f();
}

const abonner = (f: () => void) => { abonnes.add(f); return () => { abonnes.delete(f); }; };

/** Langue affichée, et rendu de nouveau du composant quand elle change (racine de l'application, coque). */
export function useLangue(): { lang: Lang; t: T } {
  const lang = useSyncExternalStore(abonner, langueCourante, langueCourante);
  return { lang, t };
}
