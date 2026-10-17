// Encodage d'un fichier texte produit par Cursus (fichier d'import Sage : shared/rules/lots-paie.ts) : UTF-8 sans BOM,
// ou Windows-1252 (« ANSI »), que beaucoup d'outils d'import Windows attendent encore. Le navigateur et Node ne savent
// encoder qu'en UTF-8 (TextEncoder) : la table de Windows-1252 est donc ici, sans dépendance.

export type Encodage = 'utf-8' | 'windows-1252';

/**
 * Caractères de la plage 0x80–0x9F de Windows-1252 (guillemets typographiques, tirets, points de suspension, euro…) ;
 * les autres octets valent leur point de code (ASCII et Latin-1, 0xA0–0xFF). 0x81, 0x8D, 0x8F, 0x90 et 0x9D n'ont pas
 * de caractère.
 */
const PLAGE_80: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Octet Windows-1252 d'un point de code, ou null s'il n'y figure pas. */
function octet1252(cp: number): number | null {
  if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return PLAGE_80[cp] ?? null;
}

/**
 * Remplacements des caractères absents de Windows-1252 avant tout « ? » : espaces insécables fines (que produit
 * toLocaleString), autres espaces et tirets.
 */
const EQUIVALENTS: Record<string, string> = { ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '−': '-' };

/** Caractères du texte absents de Windows-1252, sans doublon (remplacés par « ? » à l'encodage). */
export function horsWindows1252(texte: string): string[] {
  const out = new Set<string>();
  for (const c of texte) if (!EQUIVALENTS[c] && octet1252(c.codePointAt(0)!) === null) out.add(c);
  return [...out];
}

/** Texte encodé : UTF-8 sans BOM, ou Windows-1252 (caractère absent remplacé par son équivalent, sinon par « ? »). */
export function encoderTexte(texte: string, encodage: Encodage = 'utf-8'): Uint8Array {
  if (encodage === 'utf-8') return new TextEncoder().encode(texte);
  const out: number[] = [];
  for (const c of texte) {
    const e = EQUIVALENTS[c] ?? c;
    out.push(octet1252(e.codePointAt(0)!) ?? 0x3f);
  }
  return Uint8Array.from(out);
}
