// Règles pures de la coque (Norma 2.0), sans import : testées par test/coque.test.mjs (Node retire les types).

/** Buttons shown in the page header before the « Actions » menu takes over (COQUE.md § 3.3). */
export const MAX_HEADER_BUTTONS = 3;

/** Which actions stay buttons and which go in the menu. The primary is always a button, the rightmost one. */
export function splitActions<T>(actions: T[], primary: T | null, max = MAX_HEADER_BUTTONS): { menu: T[]; buttons: T[] } {
  const all = primary == null ? actions : [...actions, primary];
  if (all.length <= max) return { menu: [], buttons: all };
  return primary == null ? { menu: actions.slice(0, -1), buttons: actions.slice(-1) } : { menu: actions, buttons: [primary] };
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Pages whose label or section contains every word of the query (accents and case ignored) — the ⌘K page search. */
export function matchPages<P extends { label: string; section?: string }>(pages: P[], query: string): P[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return pages.filter((p) => {
    const hay = fold(`${p.label} ${p.section ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}
