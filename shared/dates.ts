// Manipulation des dates ISO « AAAA-MM-JJ » en heure locale.
import type { ISODate } from './types.ts';

export function parse(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function iso(d: Date): ISODate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Date « AAAA-MM-JJ » qui existe au calendrier : « 2026-02-31 » ou « 2026-13-45 » sont refusées, jamais décalées au mois suivant. */
export function isValidDate(s: string | null | undefined): s is ISODate {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
}
/**
 * `n` mois plus tard (ou plus tôt), au même jour du mois ; ramené au dernier jour du mois cible quand ce jour n'y
 * existe pas : un titre obtenu le 29/02/2024 et valable 36 mois expire le 28/02/2027, celui du 31/03 valable 6 mois
 * le 30/09 (jamais le 1er du mois suivant, qui le rendrait valide un jour de trop). Toutes les échéances en dépendent.
 */
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const jour = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  // Dernier jour du mois cible : le jour 0 du mois suivant.
  const dernier = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(jour, dernier));
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
/**
 * Les sept jours d'une semaine civile commençant le lundi `w`, samedi et dimanche compris : jours de la feuille de temps
 * (0 = lundi … 5 = samedi, 6 = dimanche ; shared/rules/semaine.ts). `wDays` garde les cinq jours ouvrés (congés, contrats).
 */
export function joursSemaine(w: ISODate): ISODate[] {
  return [0, 1, 2, 3, 4, 5, 6].map(i => addD(w, i));
}
/** Année de la semaine ISO de `s` : celle de son jeudi (la semaine du lundi 29 décembre 2025 est la semaine 1 de 2026). */
export function isoWeekYear(s: ISODate): number {
  return Number(addD(mondayOf(s), 3).slice(0, 4));
}
export function isoWeek(s: ISODate): number {
  const d = parse(s);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
/** « 12/10/2026 », « 12.10.2026 » ou « 2026-10-12 » → ISO ; null si la date n'existe pas (« 31/02/2026 »). */
export function toIso(s: string | null | undefined): ISODate | null {
  const v = (s || '').trim();
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  const date = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v;
  return isValidDate(date) ? date : null;
}

// — Heure de Paris —
// Le serveur peut tourner en UTC (hébergeur) : la date du jour et les horodatages sont calculés dans le fuseau
// de l'entreprise, Europe/Paris, quel que soit celui de la machine.
let paris: Intl.DateTimeFormat | null = null;
function partiesParis(d: Date): Record<string, string> {
  paris ??= new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(paris.formatToParts(d).map(x => [x.type, x.value]));
}
/** Date du jour à Paris : entre minuit et 2 h, un serveur en UTC est encore la veille. */
export function isoParis(d: Date = new Date()): ISODate {
  const p = partiesParis(d);
  return `${p.year}-${p.month}-${p.day}`;
}
/**
 * Instant (ISO 8601, UTC) de minuit à Paris le jour `jour` : borne des filtres par date, juste quel que soit le fuseau de
 * la machine (un serveur en UTC filtrait sinon de 1 h ou 2 h de travers).
 */
export function debutJourParis(jour: ISODate): string {
  const [y, m, j] = jour.split('-').map(Number), cible = Date.UTC(y, m - 1, j);
  let t = cible;
  // Deux passes : l'écart avec Paris pris à l'instant trouvé, juste aussi les jours de changement d'heure.
  for (let i = 0; i < 2; i++) {
    const p = partiesParis(new Date(t));
    t -= Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - cible;
  }
  return new Date(t).toISOString();
}
/** Horodatage ISO 8601 à l'heure de Paris, avec son décalage réel : « 2026-01-15T09:05:09+01:00 » l'hiver, « +02:00 » l'été. */
export function horodatageParis(d: Date = new Date()): string {
  const p = partiesParis(d);
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const ecart = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const h = String(Math.floor(Math.abs(ecart) / 60)).padStart(2, '0'), mn = String(Math.abs(ecart) % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${ecart < 0 ? '-' : '+'}${h}:${mn}`;
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
