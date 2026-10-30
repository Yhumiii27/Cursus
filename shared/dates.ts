// Manipulation des dates ISO « AAAA-MM-JJ » en heure locale.
import type { CalendrierFeries, CodeFerie, ISODate } from './types.ts';

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
  // Mémorisés par lundi (lot 10, chantier B : le contingent de l'année relit les jours de chaque feuille validée à chaque
  // validation) ; une copie à chaque appel, que l'appelant peut modifier. Au plus 4 096 semaines gardées.
  let jours = SEPT_JOURS.get(w);
  if (!jours) {
    if (SEPT_JOURS.size >= 4096) SEPT_JOURS.clear();
    SEPT_JOURS.set(w, jours = [0, 1, 2, 3, 4, 5, 6].map(i => addD(w, i)));
  }
  return [...jours];
}
const SEPT_JOURS = new Map<ISODate, readonly ISODate[]>();
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
/** Fériés légaux de l'année (art. L3133-1), dans l'ordre du calendrier, chacun avec son code. */
export function feriesLegaux(year: number): { code: CodeFerie; jour: ISODate }[] {
  const p = easter(year);
  const rel = (n: number) => { const d = new Date(p.getTime()); d.setDate(d.getDate() + n); return iso(d); };
  return [
    { code: 'jour_an', jour: `${year}-01-01` }, { code: 'paques', jour: rel(1) }, { code: '1er_mai', jour: `${year}-05-01` },
    { code: '8_mai', jour: `${year}-05-08` }, { code: 'ascension', jour: rel(39) }, { code: 'pentecote', jour: rel(50) },
    { code: '14_juillet', jour: `${year}-07-14` }, { code: '15_aout', jour: `${year}-08-15` }, { code: 'toussaint', jour: `${year}-11-01` },
    { code: '11_novembre', jour: `${year}-11-11` }, { code: 'noel', jour: `${year}-12-25` },
  ];
}

// — Calendrier de l'établissement (t051, shared/rules/feries.ts) —
// Réglage par année civile, à partir de 2027 (mise en service) : journée de solidarité et fériés non chômés. C'est un
// état du module, posé par `configurerFeries` au chargement de l'instantané (server/src/dataset.ts) et par le
// constructeur de Domain, des deux côtés : `isFerie` garde sa signature, et la vingtaine d'appels (congés, heures
// proposées, forfait jours, majorations, préavis…) suit le réglage sans changer. Une année antérieure n'est jamais touchée.
/** Première année réglable : la mise en service ; les années d'avant gardent le calendrier légal (aucun effet rétroactif). */
export const ANNEE_FERIES_MIN = 2027;
let calendrier: CalendrierFeries = {};
let cleCalendrier = '{}';
const feriesCache = new Map<number, Set<ISODate>>();
const solidariteCache = new Map<number, ISODate | null>();

/** Pose le calendrier de l'établissement (absent : calendrier légal) ; les caches ne sont vidés que s'il change. */
export function configurerFeries(c: CalendrierFeries | null | undefined): void {
  const cle = JSON.stringify(c ?? {});
  if (cle === cleCalendrier) return;
  calendrier = c ?? {};
  cleCalendrier = cle;
  feriesCache.clear();
  solidariteCache.clear();
}
/** `fn` calculé avec le calendrier `c` (effet d'un réglage avant de l'enregistrer), puis le calendrier en vigueur rétabli. */
export function avecCalendrier<T>(c: CalendrierFeries, fn: () => T): T {
  const avant = calendrier;
  configurerFeries(c);
  try { return fn(); } finally { configurerFeries(avant); }
}
/** Réglage retenu pour l'année : aucun avant 2027. */
const reglageDe = (year: number) => (year >= ANNEE_FERIES_MIN ? calendrier[String(year)] ?? null : null);

/**
 * Journée de solidarité travaillée de l'année : un férié légal (lundi de Pentecôte ou autre, jamais le 1er mai) qui n'est
 * plus chômé ; null quand elle est chômée, fractionnée, prise sur un RTT ou non réglée.
 */
export function journeeSolidarite(year: number): ISODate | null {
  if (!solidariteCache.has(year)) {
    const r = reglageDe(year);
    const code = r?.solidarite === 'pentecote_travaillee' ? 'pentecote' : r?.solidarite === 'autre_ferie' ? r.solidariteFerie : null;
    solidariteCache.set(year, code && code !== '1er_mai' ? feriesLegaux(year).find(f => f.code === code)?.jour ?? null : null);
  }
  return solidariteCache.get(year) ?? null;
}
export const estJourneeSolidarite = (s: ISODate) => journeeSolidarite(Number(s.slice(0, 4))) === s;

/**
 * Fériés chômés de l'année : les fériés légaux, sauf la journée de solidarité travaillée et les fériés réglés non chômés ;
 * le 1er mai l'est toujours (art. L3133-4).
 */
export function feriesOf(year: number): Set<ISODate> {
  let set = feriesCache.get(year);
  if (!set) {
    const r = reglageDe(year), solidarite = journeeSolidarite(year);
    set = new Set(feriesLegaux(year).filter(f => f.code === '1er_mai' || (f.jour !== solidarite && !r?.nonChomes?.includes(f.code))).map(f => f.jour));
    feriesCache.set(year, set);
  }
  return set;
}
/** Jour férié chômé de l'établissement : un férié travaillé comme un jour ordinaire (solidarité, non chômé) n'en est plus un. */
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
