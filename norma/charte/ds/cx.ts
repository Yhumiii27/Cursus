/** Joins class names, skipping falsy values: `cx('btn', primary && 'btn-primary')`. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  let out = '';
  for (const p of parts) if (p) out = out ? `${out} ${p}` : p;
  return out;
}
