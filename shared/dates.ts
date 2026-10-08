// Manipulation des dates ISO « AAAA-MM-JJ » en heure locale.
import type { ISODate } from './types.ts';

export function parse(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function iso(d: Date): ISODate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isValidDate(s: string | null | undefined): s is ISODate {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + n);
  return r;
}
export function addD(s: ISODate, n: number): ISODate {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function addM(s: ISODate, n: number): ISODate {
  return iso(addMonths(parse(s), n));
}
export function days(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}
/** Lundi de la semaine contenant `s`. */
export function mondayOf(s: ISODate): ISODate {
  const d = parse(s);
  return addD(s, -((d.getDay() + 6) % 7));
}
/** Les cinq jours ouvrés d'une semaine commençant le lundi `w`. */
export function wDays(w: ISODate): ISODate[] {
  return [0, 1, 2, 3, 4].map(i => addD(w, i));
}
export function isoWeek(s: ISODate): number {
  const d = parse(s);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
/** « 12/10/2026 », « 12.10.2026 » ou « 2026-10-12 » → ISO, sinon null. */
export function toIso(s: string | null | undefined): ISODate | null {
  const v = (s || '').trim();
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidDate(v) ? v : null;
}

// — Jours fériés français (métropole) —
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const feriesCache = new Map<number, Set<ISODate>>();
export function feriesOf(year: number): Set<ISODate> {
  let set = feriesCache.get(year);
  if (!set) {
    const p = easter(year);
    const rel = (n: number) => { const d = new Date(p.getTime()); d.setDate(d.getDate() + n); return iso(d); };
    set = new Set([
      `${year}-01-01`, rel(1), `${year}-05-01`, `${year}-05-08`, rel(39), rel(50),
      `${year}-07-14`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
    ]);
    feriesCache.set(year, set);
  }
  return set;
}
export function isFerie(s: ISODate): boolean {
  return feriesOf(Number(s.slice(0, 4))).has(s);
}
/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function weekday(s: ISODate): number {
  return (parse(s).getDay() + 6) % 7;
}

// — Périodes de référence —
/**
 * Congés payés : acquisition du 1er juin au 31 mai. `label` désigne la période
 * dont les congés sont à prendre (acquise l'an dernier), `labelN` celle en
 * cours d'acquisition.
 */
export function cpPeriods(today: ISODate) {
  const y = Number(today.slice(0, 4));
  const start = today.slice(5) >= '06-01' ? y : y - 1; // début de la période en cours
  return {
    acqStart: `${start - 1}-06-01`,
    prisStart: `${start}-06-01`,
    deadline: `${start + 1}-05-31`,
    reportDeadline: `${start + 2}-05-31`,
    label: `${start - 1}-${start}`,
    labelN: `${start}-${start + 1}`,
    monthsElapsed: (y - start) * 12 + Number(today.slice(5, 7)) - 6,
  };
}
