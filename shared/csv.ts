// Exports CSV (séparateur « ; », ouverts dans Excel) : texte du fichier, cellules échappées et neutralisées.

/**
 * Début de cellule qu'un tableur interprète comme une formule (=, +, -, @) ou qui y mène (tabulation, retour
 * chariot) : un texte saisi ailleurs (type de visa déclaré par un collaborateur, lieu, nom…) pourrait s'exécuter
 * à l'ouverture du fichier par le service RH.
 */
const FORMULE = /^[=+\-@\t\r]/;

/**
 * Cellule CSV : un texte commençant comme une formule est préfixé d'une apostrophe (affiché comme du texte, jamais
 * évalué) ; un nombre reste un nombre. Guillemets autour d'une cellule qui contient « ; », « " » ou un saut de ligne.
 */
export function celluleCsv(v: string | number | null | undefined): string {
  let s = String(v ?? '');
  if (typeof v === 'string' && FORMULE.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Contenu d'un fichier CSV : BOM UTF-8 (accents lus par Excel), lignes séparées par CRLF. */
export function texteCsv(head: string[], rows: (string | number)[][]): string {
  return '﻿' + [head, ...rows].map(r => r.map(celluleCsv).join(';')).join('\r\n');
}
