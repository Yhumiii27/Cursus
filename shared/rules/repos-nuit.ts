// Repos quotidien, pause et travail de nuit (t048, étape 2), d'après l'horaire de poste de chaque jour de la feuille
// (shared/rules/horaires.ts : l'horaire figé à la soumission et à la validation, sinon celui choisi ou proposé par l'équipe).
// Keystone ne transmet que des heures par jour : la plage de travail d'un jour est estimée à partir de l'horaire, du début
// de l'horaire jusqu'à ce début plus les heures saisies ce jour-là (toutes lignes cumulées) et la pause. Des heures en plus
// de l'horaire le prolongent ; des heures en moins l'écourtent. Un jour sans horaire n'est pas contrôlé : la feuille se
// tient comme avant (horaire facultatif, aucun contrôle rétroactif sur une feuille d'avant les horaires).
// - Repos quotidien (art. L3131-1) : 11 h consécutives entre la fin d'un jour et le début du suivant, le dimanche de la
//   semaine précédente compris (sa feuille, quand elle porte un horaire) ; 12 h pour un salarié de moins de 18 ans, 14 h
//   avant 16 ans (art. L3164-1). Alerte qui exige un motif, sans blocage, tant que l'accord n'est pas connu.
// - Pause (art. L3121-16) : 20 minutes consécutives dès 6 h de travail dans la journée ; 30 minutes au-delà de 4 h 30 pour
//   un salarié de moins de 18 ans (art. L3162-3). Pause de l'horaire. Alerte avec motif, comme le repos.
// - Heures de nuit : heures de la plage de travail comprises dans la plage de nuit réglée (Paramètres → Décompte des
//   heures : 21 h – 6 h par défaut, art. L3122-20 ; de 21 h – 22 h à 6 h – 7 h, 9 h au moins, art. L3122-2), la pause
//   retirée au prorata. Rattachées au jour de la feuille où commence le poste (un poste de nuit est saisi le jour de son
//   début). Rubriques HNUIT (quantité) et MAJ_NUIT (heures équivalentes, au taux figé à la validation), inactives et « à
//   confirmer » : listées « à saisir dans Sage » tant que la paie ne les a pas activées.
// - Salarié de moins de 18 ans : aucun travail entre 22 h et 6 h, entre 20 h et 6 h avant 16 ans (art. L3163-2). Refus,
//   à la soumission et à la validation comme au choix de l'horaire (`refusNuitMineur`), sans motif possible.
// - Travailleur de nuit (art. L3122-5) : au moins deux fois par semaine, selon son horaire habituel, 3 h de nuit au moins
//   dans la journée — lu par Cursus comme deux semaines au moins, parmi les quatre dernières feuilles validées (avec ou sans
//   horaire : une semaine sans horaire compte sans nuit), qui en comptent deux jours —, ou 270 h de nuit sur 12 mois glissants (art. L3122-23, supplétif). Seuils réglables avec la
//   référence de l'accord. Repéré sur la fiche ; en suivi VIP, alerte « suivi médical adapté à prévoir » dans les visites
//   dues (VIP adaptée, art. R4624-17), sans changer d'office le type de suivi.
// - Interventions d'astreinte (t049, lot 7, shared/rules/astreintes.ts) : plages exactes (début et fin déclarés), en plus de la
//   plage estimée de l'horaire, dont leurs heures sont retirées. Leurs heures de nuit comptent ; le temps d'astreinte sans
//   intervention compte comme repos (art. L3121-10) : seul le repos qui suit la fin d'une intervention est contrôlé, dû en
//   entier jusqu'à la reprise suivante (le repos interrompu par l'intervention ne l'est pas).
// Tout est calculé sur les feuilles et les horaires déjà transmis : aucune donnée nouvelle ne part vers le navigateur, sauf
// l'indication `travailleurNuit` du référent HSE, qui n'a pas les feuilles (server/src/dataset.ts).
import { addD, joursSemaine, parse } from '../dates.ts';
import { fH, num } from '../format.ts';
import type { Dataset, Employe, FeuilleTemps, HoraireFige, ISODate, Settings } from '../types.ts';
import { horairesDeLaFeuille } from './horaires.ts';
import { ageAu, dateNaissance, mineurAu, moins16Au, type Naissance } from './mineurs.ts';
import { DIMANCHE, JOURS_FEUILLE } from './semaine.ts';

// — Réglages (Paramètres → Décompte des heures, valeurs légales supplétives par défaut) —

/** Plage de nuit supplétive (art. L3122-20) : de 21 h à 6 h. */
export const NUIT_DEBUT_LEGAL = 21;
export const NUIT_FIN_LEGAL = 6;
/** Travailleur de nuit (art. L3122-5 et L3122-23) : 3 h de nuit dans la journée deux fois par semaine, ou 270 h sur 12 mois. */
export const NUIT_SEUIL_QUOTIDIEN_LEGAL = 3;
export const NUIT_SEUIL_ANNUEL_LEGAL = 270;
/** Repos quotidien (art. L3131-1), et celui d'un salarié de moins de 18 ans, de moins de 16 ans (art. L3164-1), en heures. */
export const REPOS_QUOTIDIEN = 11;
export const REPOS_QUOTIDIEN_MINEUR = 12;
export const REPOS_QUOTIDIEN_MOINS_16 = 14;
/** Pause (art. L3121-16) : 20 min dès 6 h de travail ; salarié mineur (art. L3162-3) : 30 min au-delà de 4 h 30. */
export const PAUSE_MIN = 20;
export const PAUSE_DES = 6;
export const PAUSE_MIN_MINEUR = 30;
export const PAUSE_DES_MINEUR = 4.5;
/** Nuit interdite à un salarié mineur (art. L3163-2) : de 22 h à 6 h, de 20 h à 6 h avant 16 ans. */
export const NUIT_MINEUR = { debut: 22, fin: 6 } as const;
export const NUIT_MOINS_16 = { debut: 20, fin: 6 } as const;
/** Travailleur de nuit au sens hebdomadaire : semaines regardées (dernières feuilles validées) et semaines exigées. */
export const NUIT_SEMAINES_REGARDEES = 4;
export const NUIT_SEMAINES_EXIGEES = 2;
/** Jours d'au moins le seuil quotidien de nuit dans une semaine (« au moins deux fois par semaine »). */
export const NUIT_JOURS_SEMAINE = 2;

/** Réglages lus : ceux du travail de nuit (Paramètres → Décompte des heures). */
export type ReglagesNuit = Pick<Settings, 'nuitDebut' | 'nuitFin' | 'nuitSeuilQuotidien' | 'nuitSeuilAnnuel' | 'nuitMajoration' | 'nuitAccord'>;

/** Réglages du travail de nuit, valeurs légales pour un instantané qui ne les aurait pas encore. */
export function reglagesNuit(s: Partial<ReglagesNuit> | undefined): ReglagesNuit {
  const n = (v: unknown, d: number) => (Number.isFinite(v) ? v as number : d);
  return {
    nuitDebut: n(s?.nuitDebut, NUIT_DEBUT_LEGAL), nuitFin: n(s?.nuitFin, NUIT_FIN_LEGAL),
    nuitSeuilQuotidien: n(s?.nuitSeuilQuotidien, NUIT_SEUIL_QUOTIDIEN_LEGAL), nuitSeuilAnnuel: n(s?.nuitSeuilAnnuel, NUIT_SEUIL_ANNUEL_LEGAL),
    nuitMajoration: n(s?.nuitMajoration, 0), nuitAccord: s?.nuitAccord ?? '',
  };
}

/** Plage de nuit autre que la plage supplétive, ou seuils autres que ceux de la loi : la référence de l'accord est exigée. */
export const nuitHorsLoi = (s: ReglagesNuit) =>
  s.nuitDebut !== NUIT_DEBUT_LEGAL || s.nuitFin !== NUIT_FIN_LEGAL || s.nuitSeuilQuotidien !== NUIT_SEUIL_QUOTIDIEN_LEGAL || s.nuitSeuilAnnuel !== NUIT_SEUIL_ANNUEL_LEGAL;

/** Refus d'une plage de nuit qui ne couvre pas 9 h consécutives (art. L3122-2), sinon null. */
export const refusPlageNuit = (s: Pick<ReglagesNuit, 'nuitDebut' | 'nuitFin'>): string | null =>
  (24 - s.nuitDebut + s.nuitFin < 9 ? 'Travail de nuit : la plage de nuit compte au moins 9 heures consécutives, entre 21 h et 7 h, minuit à 5 h compris (art. L3122-2)' : null);

/** « 21 h – 6 h ». */
export const plageNuitTexte = (s: Pick<ReglagesNuit, 'nuitDebut' | 'nuitFin'>) => `${s.nuitDebut} h – ${s.nuitFin} h`;

// — Plage de travail d'un jour —

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** « 23 h », « 5 h 30 » : heure d'un instant compté en minutes (depuis un minuit quelconque). */
const heureTexte = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440, mn = x % 60; return `${Math.floor(x / 60)} h${mn ? ` ${String(mn).padStart(2, '0')}` : ''}`; };

/** Plage de travail estimée d'un jour, en minutes depuis le lundi 0 h de la semaine (négatif : semaine précédente). */
export interface PlageTravail { debut: number; fin: number; pause: number }

/**
 * Plage de travail du jour `di` (0 = lundi) : du début de l'horaire à ce début plus les heures saisies et la pause ; null
 * sans horaire ou sans heure.
 */
export function plageDuJour(h: HoraireFige | null | undefined, heures: number, di: number): PlageTravail | null {
  if (!h || !(heures > 0)) return null;
  const debut = di * 1440 + minutes(h.debut);
  return { debut, fin: debut + Math.round(heures * 60) + h.pause, pause: h.pause };
}

/** Minutes de [a, b] comprises dans une plage horaire quotidienne [de h, à h le lendemain si elle passe minuit]. */
function minutesDans(a: number, b: number, plage: { debut: number; fin: number }): number {
  let n = 0;
  const jour0 = Math.floor(a / 1440) - 1, jour1 = Math.floor(b / 1440) + 1;
  for (let k = jour0; k <= jour1; k++) {
    const de = k * 1440 + plage.debut * 60, a2 = (plage.fin <= plage.debut ? k + 1 : k) * 1440 + plage.fin * 60;
    n += Math.max(0, Math.min(b, a2) - Math.max(a, de));
  }
  return n;
}

/** Heures de nuit d'une plage de travail, la pause retirée au prorata (au centième d'heure). */
export function heuresDeNuit(p: PlageTravail | null, plage: Pick<ReglagesNuit, 'nuitDebut' | 'nuitFin'>): number {
  if (!p || p.fin <= p.debut) return 0;
  const nuit = minutesDans(p.debut, p.fin, { debut: plage.nuitDebut, fin: plage.nuitFin });
  const total = p.fin - p.debut, travail = Math.max(0, total - p.pause);
  return Math.round((nuit * travail / total / 60) * 100) / 100;
}

// — Contrôles d'une semaine —

/** Contrôle en cause, codé pour le journal (jamais le texte du motif). */
export type CodeReposNuit = 'repos_quotidien' | 'pause' | 'nuit_mineur';

export interface ControlesReposNuit {
  /** Heures de nuit de chaque jour (0 = lundi … 6 = dimanche) et de la semaine. */
  nuitParJour: number[]; nuit: number;
  /** Repos quotidien insuffisant : alertes à motiver (rejoignent les dépassements de la feuille). */
  repos: string[];
  /** Pause insuffisante : alertes à motiver. */
  pauses: string[];
  /** Salarié mineur au travail la nuit : refus, sans motif possible. */
  nuitMineur: string[];
  codes: CodeReposNuit[];
}

const jourCourt = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/** Ce que les contrôles lisent de la semaine précédente : horaire et heures de son dimanche. */
export interface Veille { horaire: HoraireFige | null; heures: number }

/**
 * Intervention d'astreinte d'une semaine (shared/rules/astreintes.ts, `plagesInterventions`) : début et fin en minutes
 * depuis le lundi 0 h, jour de la feuille où elle commence (0 = lundi … 6 = dimanche ; -1 : dimanche précédent, lu pour le
 * repos du lundi seulement).
 */
export interface PlageIntervention { di: number; debut: number; fin: number }

/**
 * Contrôles d'une semaine (lundi `week`) : `jours` horaire de chaque jour, `perDay` heures de chaque jour, `veille` le
 * dimanche précédent, `interventions` les interventions d'astreinte de la semaine (et du dimanche précédent), dont les
 * heures sont dans `perDay`. `exclu` : cadre dirigeant (art. L3111-2), ni repos ni pause contrôlés ; les heures de nuit
 * restent comptées. Sans semaine connue : rien.
 */
export function controlesReposNuit(jours: readonly (HoraireFige | null)[], perDay: readonly number[], week: ISODate | null | undefined,
  o: { s?: Partial<ReglagesNuit>; naissance?: Naissance | null; veille?: Veille | null; exclu?: boolean; interventions?: readonly PlageIntervention[] }): ControlesReposNuit {
  const out: ControlesReposNuit = { nuitParJour: Array(JOURS_FEUILLE).fill(0), nuit: 0, repos: [], pauses: [], nuitMineur: [], codes: [] };
  if (!week) return out;
  const s = reglagesNuit(o.s), wd = joursSemaine(week);
  // Interventions d'astreinte : plages exactes ; leurs heures, comprises dans celles du jour, ne prolongent pas l'horaire.
  const ints = (o.interventions ?? []).filter(x => x.fin > x.debut && x.di >= -1 && x.di < JOURS_FEUILLE);
  const hInt = (di: number) => ints.filter(x => x.di === di).reduce((n, x) => n + (x.fin - x.debut) / 60, 0);
  const travail = (i: number) => Math.max(0, num(perDay[i]) - hInt(i));
  const plages = Array.from({ length: JOURS_FEUILLE }, (_, i) => plageDuJour(jours[i], travail(i), i));
  const plagesInt = ints.filter(x => x.di >= 0).map(x => ({ di: x.di, p: { debut: x.debut, fin: x.fin, pause: 0 } }));
  out.nuitParJour = plages.map((p, i) => Math.round((heuresDeNuit(p, s) + plagesInt.filter(x => x.di === i).reduce((n, x) => n + heuresDeNuit(x.p, s), 0)) * 100) / 100);
  out.nuit = Math.round(out.nuitParJour.reduce((a, b) => a + b, 0) * 100) / 100;
  // Salarié mineur ce jour-là (moins de 16 ans quand la date de naissance le dit) : vue sans la date, les indications
  // de la semaine (`mineur`, `moins16` : naissanceDeLaFeuille).
  const age = (day: ISODate) => (o.naissance && mineurAu(o.naissance, day) ? (moins16Au(o.naissance, day) ? 'moins16' : 'mineur') : null);
  /** Seuil et texte des alertes d'après l'âge le plus bas de la semaine. */
  const plusJeune = wd.some(day => age(day) === 'moins16') ? 'moins16' : wd.some(day => age(day)) ? 'mineur' : null;

  const nuitInterdite: string[] = [];
  [...plages.map((p, i) => ({ di: i, p })), ...plagesInt].forEach(({ p, di: i }) => {
    const a = p && age(wd[i]);
    if (!p || !a) return;
    const plage = a === 'moins16' ? NUIT_MOINS_16 : NUIT_MINEUR;
    if (minutesDans(p.debut, p.fin, plage) > 0) nuitInterdite.push(`${jourCourt(wd[i])} (${heureTexte(p.debut)} – ${heureTexte(p.fin)})`);
  });
  if (nuitInterdite.length) {
    out.nuitMineur.push(`Travail de nuit interdit à un salarié de moins de 18 ans, de 22 h à 6 h (de 20 h à 6 h avant 16 ans, art. L3163-2) : ${nuitInterdite.join(', ')} — changez l’horaire du jour`);
    out.codes.push('nuit_mineur');
  }
  if (o.exclu) return out;

  // Repos quotidien : de la fin d'un jour au début du suivant (dimanche précédent compris). Interventions d'astreinte : le
  // repos qui suit leur fin est contrôlé (dû en entier), jamais celui qu'elles interrompent.
  const veille = o.veille ? plageDuJour(o.veille.horaire, Math.max(0, o.veille.heures - hInt(-1)), -1) : null;
  const suite = [
    ...(veille ? [{ di: -1, p: veille, intervention: false }] : []),
    ...ints.filter(x => x.di === -1).map(x => ({ di: -1, p: { debut: x.debut, fin: x.fin, pause: 0 }, intervention: true })),
    ...plages.flatMap((p, i) => (p ? [{ di: i, p, intervention: false }] : [])),
    ...plagesInt.map(x => ({ ...x, intervention: true })),
  ].sort((a, b) => a.p.debut - b.p.debut);
  const courts: string[] = [];
  let finMax: number | null = null, finIntervention = false;
  for (const x of suite) {
    if (finMax != null && !x.intervention && x.di >= 0) {
      const day = wd[x.di], a = age(day), min = a === 'moins16' ? REPOS_QUOTIDIEN_MOINS_16 : a ? REPOS_QUOTIDIEN_MINEUR : REPOS_QUOTIDIEN;
      const repos = (x.p.debut - finMax) / 60;
      if (repos < min) {
        courts.push(`${repos > 0 ? fH(repos) : 'aucun repos'} avant le ${jourCourt(day)} (fin ${finIntervention ? 'de l’intervention d’astreinte ' : ''}à ${heureTexte(finMax)}, reprise à ${heureTexte(x.p.debut)}${finIntervention ? ' ; repos dû en entier après une intervention, art. L3121-10' : ''})`);
      }
    }
    if (finMax == null || x.p.fin > finMax) { finMax = x.p.fin; finIntervention = x.intervention; }
    else if (x.p.fin === finMax && x.intervention) finIntervention = true;
  }
  if (courts.length) {
    const seuil = plusJeune === 'moins16' ? `${REPOS_QUOTIDIEN_MOINS_16} h (salarié de moins de 16 ans, art. L3164-1)`
      : plusJeune ? `${REPOS_QUOTIDIEN_MINEUR} h (salarié de moins de 18 ans, art. L3164-1)` : `${REPOS_QUOTIDIEN} h consécutives (art. L3131-1)`;
    out.repos.push(`Repos quotidien de ${seuil} non respecté : ${courts.join(' ; ')}`);
    out.codes.push('repos_quotidien');
  }

  // Pause : celle de l'horaire du jour.
  const sansPause: string[] = [];
  plages.forEach((p, i) => {
    if (!p) return;
    const a = age(wd[i]), h = travail(i);
    const [des, min] = a ? [PAUSE_DES_MINEUR, PAUSE_MIN_MINEUR] : [PAUSE_DES, PAUSE_MIN];
    if ((a ? h > des : h >= des) && p.pause < min) sansPause.push(`${jourCourt(wd[i])} (${fH(h)}, pause de ${p.pause} min)`);
  });
  if (sansPause.length) {
    out.pauses.push(plusJeune
      ? `Pause de ${PAUSE_MIN_MINEUR} min au moins au-delà de 4 h 30 de travail, salarié de moins de 18 ans (art. L3162-3) : ${sansPause.join(', ')}`
      : `Pause de ${PAUSE_MIN} min au moins dès ${PAUSE_DES} h de travail (art. L3121-16) : ${sansPause.join(', ')}`);
    out.codes.push('pause');
  }
  return out;
}

// — Feuilles de temps : horaires et dimanche précédent —

/** Feuilles par salarié et semaine, calculées une fois par liste de feuilles (le dimanche précédent de chaque feuille). */
// Une liste allongée depuis (feuille créée dans le même instantané) refait l'index.
const index = new WeakMap<readonly FeuilleTemps[], { n: number; m: Map<string, FeuilleTemps> }>();
function feuilleDe(feuilles: readonly FeuilleTemps[], empId: number, week: ISODate): FeuilleTemps | undefined {
  let x = index.get(feuilles);
  if (!x || x.n !== feuilles.length) { x = { n: feuilles.length, m: new Map(feuilles.map(f => [`${f.empId}|${f.week}`, f])) }; index.set(feuilles, x); }
  return x.m.get(`${empId}|${week}`);
}

/** Heures de chaque jour d'une feuille, toutes lignes cumulées. */
const heuresParJour = (sh: Pick<FeuilleTemps, 'lignes'>) => Array.from({ length: JOURS_FEUILLE }, (_, i) => sh.lignes.reduce((n, l) => n + num(l.h[i]), 0));

/** Horaire et heures du dimanche qui précède la semaine `week` (feuille de la semaine précédente), null sans feuille. */
export function veilleDe(ds: Pick<Dataset, 'feuilles' | 'referentiels'>, e: Pick<Employe, 'id' | 'equipe'>, week: ISODate): Veille | null {
  const sh = feuilleDe(ds.feuilles, e.id, addD(week, -7));
  if (!sh) return null;
  const perDay = heuresParJour(sh);
  return { horaire: horairesDeLaFeuille(ds.referentiels, e.equipe, sh, perDay)[DIMANCHE].horaire, heures: perDay[DIMANCHE] };
}

/** Heures de nuit de chaque jour d'une feuille validée, d'après ses horaires figés ; aucune sans horaires figés. */
export function nuitDeLaFeuille(sh: Pick<FeuilleTemps, 'lignes' | 'horairesFiges'>, s: Partial<ReglagesNuit> | undefined): number[] {
  const perDay = heuresParJour(sh), r = reglagesNuit(s);
  return perDay.map((h, i) => heuresDeNuit(plageDuJour(sh.horairesFiges?.[i], h, i), r));
}

// — Travailleur de nuit —

export interface StatutNuit {
  /** Travailleur de nuit au sens de l'art. L3122-5. */
  travailleur: boolean;
  /** Critère rempli : deux fois par semaine (habituel), ou heures sur 12 mois ; null : aucun. */
  critere: 'hebdomadaire' | 'annuel' | null;
  /** Heures de nuit des 12 derniers mois (feuilles validées) et semaines qui comptent deux jours de nuit, parmi les dernières. */
  heures12Mois: number;
  semaines: number;
}

/** Statuts calculés, par liste de feuilles (refaits quand elle s'allonge). */
const cache = new WeakMap<readonly FeuilleTemps[], { n: number; m: Map<string, StatutNuit> }>();

/**
 * Statut de travailleur de nuit à la date `ti`, sur les feuilles validées : deux semaines au moins, parmi les quatre
 * dernières feuilles validées des 12 derniers mois, qui comptent chacune deux jours d'au moins le seuil quotidien de nuit ;
 * ou le seuil annuel atteint sur les 12 mois glissants (jours du 12e mois avant `ti` exclus, jours postérieurs à `ti`
 * aussi). Une feuille sans horaire (équipe sans horaire par défaut, feuille d'avant les horaires) compte comme une semaine
 * sans nuit : des nuits ponctuelles dans une équipe de journée, séparées par des semaines sans horaire, ne font pas un
 * horaire habituel de nuit.
 */
export function statutNuit(ds: Pick<Dataset, 'feuilles' | 'settings'>, empId: number, ti: ISODate): StatutNuit {
  const s = reglagesNuit(ds.settings);
  const cle = `${empId}|${ti}|${s.nuitDebut}|${s.nuitFin}|${s.nuitSeuilQuotidien}|${s.nuitSeuilAnnuel}`;
  let x = cache.get(ds.feuilles);
  if (!x || x.n !== ds.feuilles.length) { x = { n: ds.feuilles.length, m: new Map() }; cache.set(ds.feuilles, x); }
  const m = x.m, deja = m.get(cle);
  if (deja) return deja;
  const debut = addD(ti, -365);
  const feuilles = ds.feuilles.filter(sh => sh.empId === empId && sh.statut === 'validee' && sh.week <= ti && addD(sh.week, 6) > debut)
    .sort((a, b) => b.week.localeCompare(a.week));
  let heures = 0;
  const semaines = feuilles.map(sh => {
    const nuit = nuitDeLaFeuille(sh, s);
    joursSemaine(sh.week).forEach((day, i) => { if (day > debut && day <= ti) heures += nuit[i]; });
    return nuit.filter(h => h >= s.nuitSeuilQuotidien).length >= NUIT_JOURS_SEMAINE;
  });
  const n = semaines.slice(0, NUIT_SEMAINES_REGARDEES).filter(Boolean).length;
  heures = Math.round(heures * 100) / 100;
  const critere = n >= NUIT_SEMAINES_EXIGEES ? 'hebdomadaire' : heures >= s.nuitSeuilAnnuel ? 'annuel' : null;
  const r: StatutNuit = { travailleur: !!critere, critere, heures12Mois: heures, semaines: n };
  m.set(cle, r);
  return r;
}

/**
 * Travailleur de nuit vu par l'écran : l'indication transmise par le serveur aux vues sans les feuilles (référent HSE),
 * sinon le calcul sur les feuilles de l'instantané.
 */
export function estTravailleurNuit(ds: Pick<Dataset, 'feuilles' | 'settings'>, e: Pick<Employe, 'id'> & Partial<Pick<Employe, 'travailleurNuit'>>, ti: ISODate): boolean {
  return typeof e.travailleurNuit === 'boolean' ? e.travailleurNuit : statutNuit(ds, e.id, ti).travailleur;
}

/** Alerte des visites dues d'un travailleur de nuit en VIP (Domain.echeances, fiche). */
export const SUIVI_NUIT = 'Suivi médical adapté à prévoir';

/** « 2 semaines sur les 4 dernières avec deux nuits d'au moins 3 h » ou « 312 h de nuit sur 12 mois (seuil 270 h) ». */
export function statutNuitTexte(x: StatutNuit, s: Partial<ReglagesNuit> | undefined): string {
  const r = reglagesNuit(s);
  return x.critere === 'hebdomadaire'
    ? `${x.semaines} semaines sur les ${NUIT_SEMAINES_REGARDEES} dernières validées avec au moins deux nuits de ${r.nuitSeuilQuotidien} h (art. L3122-5)`
    : `${fH(x.heures12Mois)} de nuit sur 12 mois glissants, seuil de ${r.nuitSeuilAnnuel} h (art. L3122-5 et L3122-23)`;
}

/**
 * Refus de choisir l'horaire `h` le jour `day` pour un salarié mineur ce jour-là (art. L3163-2) : l'horaire, tel quel,
 * empiète sur la nuit interdite. null : permis.
 */
export function refusNuitMineur(e: Naissance & { nom?: string }, h: HoraireFige, day: ISODate): string | null {
  if (!mineurAu(e, day)) return null;
  const moins16 = !!dateNaissance(e) && ageAu(e, day) < 16, plage = moins16 ? NUIT_MOINS_16 : NUIT_MINEUR;
  const debut = minutes(h.debut), fin = debut + ((minutes(h.fin) - debut + 1440) % 1440 || 1440);
  if (!(minutesDans(debut, fin, plage) > 0)) return null;
  return `Horaire ${h.code} (${heureTexte(debut)} – ${heureTexte(fin)}) : ${e.nom || 'ce salarié'} a moins de 18 ans et ne peut pas travailler de ${plage.debut} h à ${plage.fin} h (art. L3163-2)`;
}
