// Moteur de traduction (repris d'Arche src/i18n/translate.ts, lui-même de Keystone) : les chaînes de l'interface sont
// écrites en anglais et rendues en français par le dictionnaire exact (i18n/fr.ts), puis par les règles à paramètres
// (FR_REGLES), puis segment par segment autour de « · », « — », « → », « / ». Une chaîne sans traduction reste en anglais
// (la complétude du dictionnaire est contrôlée par tests/client-i18n.test.ts sur les fichiers migrés).
import { FR, FR_REGLES } from './fr.ts';

export type Lang = 'fr' | 'en';
export const LANGUES: readonly Lang[] = ['fr', 'en'];
export type T = (anglais: string) => string;

/** Entrée exacte du dictionnaire français, sinon undefined. */
export const frExact = (s: string): string | undefined => (s && Object.hasOwn(FR, s) ? FR[s] : undefined);

function frSegment(s: string): string {
  const exact = frExact(s);
  if (exact != null) return exact;
  for (const [re, rep] of FR_REGLES) if (re.test(s)) return s.replace(re, rep);
  return s;
}

/** Français d'une chaîne source anglaise. */
export function enFrancais(s: string): string {
  if (!s) return s;
  const exact = frExact(s);
  if (exact != null) return exact;
  if (/^[\s\d.,%€$+−–-]*$/.test(s)) return s;
  const parts = s.split(/( · | — | → | \/ )/);
  if (parts.length > 1) return parts.map((p, i) => (i % 2 ? p : frSegment(p))).join('');
  return frSegment(s);
}

/** Traducteur d'une langue : l'anglais est l'identité. */
export const makeT = (l: Lang): T => (l === 'fr' ? enFrancais : s => s);

/** Locale des formats Intl. */
export const localeIntl = (l: Lang) => (l === 'fr' ? 'fr-FR' : 'en-GB');
