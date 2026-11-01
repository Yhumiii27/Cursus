// Badgeage virtuel (lot 12, chantier C6, t191) : règles pures du pointage, communes au serveur (server/src/pointages.ts,
// server/src/actions/pointage.ts) et, à l'étape 2, à l'interface. Réponses du propriétaire du 1er novembre 2026 : pas de
// badgeuse murale, pointage sur téléphone ou ordinateur seulement ; module livré désactivé.
// - Populations : réglage `pointagePopulations` (critère, valeur, mode, date d'effet) ; la plus récente qui désigne le
//   salarié à la date dite son mode (`modeTempsAu`). Toujours exclus : forfait jours (décompte en jours) et cadres
//   dirigeants (art. L3111-2) ; intérimaires exclus sauf réglage `pointageInterim`. Module inactif : « declaratif ».
// - Heure de Paris : chaque instant est gardé en UTC ; le jour et l'heure murale se lisent à Paris (shared/dates.ts), juste
//   aux nuits de changement d'heure (la nuit d'octobre compte une heure de plus, celle de mars une de moins).
// - Appariement : pointages effectifs (une neutralisation et le pointage qu'elle vise sont écartés), triés, dédoublonnés
//   sous 60 s (même sens, ou sens inconnu), puis lus en alternance quand le sens manque. Une entrée sans sortie (au-delà de
//   24 h, ou suivie d'une autre entrée) et une sortie sans entrée sont des anomalies ; une entrée récente reste « en cours ».
// - Poste : paires séparées de moins de 5 h (pauses), rattaché au jour de Paris de sa première entrée, comme un poste de
//   nuit l'est au jour de son début (shared/rules/repos-nuit.ts). Ses pauses sont les intervalles entre une sortie et
//   l'entrée suivante.
// - Plages réelles (`plagesReelles`) : en minutes écoulées depuis le lundi 0 h de Paris de la semaine, elles remplacent
//   l'estimation `plageDuJour` dans `controlesReposNuit` pour les populations badgées (repos de 11 h, pause de 20 min) ;
//   leurs heures de nuit sont comptées sur les instants réels (`heuresDeNuitReelles`).
// - Anomalies (`anomaliesPointage`) : calculées à chaque lecture, jamais stockées ; leurs textes ne disent jamais la
//   nature d'une absence.
import { addD, debutJourParis, isoParis, isValidDate, mondayOf } from '../dates.ts';
import { fH } from '../format.ts';
import type {
  CriterePopulation, Employe, Equipe, ISODate, ModeTemps, MotifCorrectionPointage, NatureCorrectionPointage, Pointage, PopulationPointage, SensPointage,
  Settings,
} from '../types.ts';
import { entiteEquipe, rattachementSalarie } from './entites.ts';
import { ancetres } from './hierarchie.ts';
import type { PlageTravail, ReglagesNuit } from './repos-nuit.ts';
import { reglagesNuit } from './repos-nuit.ts';

// — Constantes —

/** Deux pointages de même sens (ou de sens inconnu) à moins de 60 s : le second est un doublon (double appui). */
export const DOUBLON_SECONDES = 60;
/** Écart entre une sortie et l'entrée suivante au-delà duquel un nouveau poste commence (en deçà : une pause), en minutes. */
export const ECART_POSTE_MIN = 300;
/** Entrée restée sans sortie au-delà de 24 h : sortie manquante (et non un poste de 24 h). */
export const PAIRE_MAX_MIN = 24 * 60;
/** Amplitude d'une journée au-delà de laquelle une anomalie est signalée (heures, 13 h : repos quotidien de 11 h). */
export const AMPLITUDE_MAX_H = 13;
/** Durées maximales (art. L3121-18 et L3121-20) : 10 h par jour, 48 h par semaine. */
export const JOURNEE_MAX_H = 10;
export const SEMAINE_MAX_H = 48;
/** Lecture des pointages bruts : 6 semaines au plus par requête. */
export const LECTURE_MAX_JOURS = 42;
/** Pointage différé (hors ligne) : heure de l'appareil de moins de 7 jours, et pas plus de 5 min dans le futur. */
export const DIFFERE_MAX_JOURS = 7;
export const AVANCE_APPAREIL_MAX_MIN = 5;
/** Commentaire d'une demande de correction et motif d'un refus : textes libres bornés. */
export const TEXTE_CORRECTION_MAX = 300;
/** Conservation des pointages bruts (réglage `conservationPointagesAns`) : 1 an (art. D3171-16) à 5 ans (référentiel CNIL). */
export const CONSERVATION_POINTAGES_MIN = 1;
export const CONSERVATION_POINTAGES_MAX = 5;
/** Populations : 50 au plus, valeur de 80 caractères au plus. */
export const POPULATIONS_MAX = 50;
export const VALEUR_POPULATION_MAX = 80;

export const MODES_TEMPS: Record<ModeTemps, string> = {
  declaratif: 'Déclaratif (feuille de temps seule)',
  controle: 'Contrôlé (feuille déclarative rapprochée des pointages)',
  calcule: 'Calculé (heures tirées des pointages)',
};
export const CRITERES_POPULATION: Record<CriterePopulation, string> = {
  equipe: 'Équipe (et équipes rattachées)', entite: 'Entité', site: 'Site de rattachement', regime: 'Régime de temps de travail',
};
export const MOTIFS_CORRECTION: Record<MotifCorrectionPointage, string> = {
  oubli: 'Oubli de pointage',
  appareil: 'Téléphone ou poste indisponible',
  mission: 'Mission ou déplacement à l’extérieur',
  formation: 'Formation à l’extérieur',
  autre: 'Autre motif',
};
export const NATURES_CORRECTION: Record<NatureCorrectionPointage, string> = { ajout: 'Pointage oublié à ajouter', neutralisation: 'Pointage erroné à retirer' };
export const estModeTemps = (v: unknown): v is ModeTemps => typeof v === 'string' && Object.hasOwn(MODES_TEMPS, v);
export const estCritere = (v: unknown): v is CriterePopulation => typeof v === 'string' && Object.hasOwn(CRITERES_POPULATION, v);
export const estMotifCorrection = (v: unknown): v is MotifCorrectionPointage => typeof v === 'string' && Object.hasOwn(MOTIFS_CORRECTION, v);
export const estNatureCorrection = (v: unknown): v is NatureCorrectionPointage => typeof v === 'string' && Object.hasOwn(NATURES_CORRECTION, v);
export const estSens = (v: unknown): v is SensPointage => v === 'E' || v === 'S';

// — Heure de Paris —

let paris: Intl.DateTimeFormat | null = null;
/** Heure murale de Paris d'un instant : jour et minutes depuis minuit (0 à 1439). */
export function heureParis(t: number | string): { jour: ISODate; minutes: number } {
  const d = new Date(t);
  paris ??= new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(paris.formatToParts(d).map(x => [x.type, x.value]));
  return { jour: isoParis(d), minutes: Number(p.hour) * 60 + Number(p.minute) };
}
/** « 08:05 » : heure murale de Paris d'un instant. */
export function hhmmParis(t: number | string): string {
  const m = heureParis(t).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/**
 * Instant (ms) de l'heure murale `minutes` du jour `jour` à Paris. Heure qui n'existe pas (nuit de mars, 2 h – 3 h) :
 * l'instant d'une heure plus tard ; heure vécue deux fois (nuit d'octobre) : la première.
 */
export function instantParis(jour: ISODate, minutes: number): number {
  let t = Date.parse(debutJourParis(jour)) + minutes * 60_000;
  const h = heureParis(t);
  const ecart = (h.jour === jour ? h.minutes : h.jour > jour ? h.minutes + 1440 : h.minutes - 1440) - minutes;
  if (ecart) t -= ecart * 60_000;
  // Heure inexistante : la correction tombe dans le trou, on garde l'instant après le passage à l'heure d'été.
  return heureParis(t).minutes === ((minutes % 1440) + 1440) % 1440 ? t : t + Math.abs(ecart) * 60_000;
}
/** Instant ISO (UTC) valide, ou null. */
export function instantValide(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// — Populations —

/** Raison d'une exclusion du badgeage (forfait jours, cadre dirigeant, intérim), ou null. */
export function exclusionPointage(e: Pick<Employe, 'temps' | 'typeContrat'>, interim: boolean): string | null {
  if (e.temps === 'forfait_jours') return 'forfait jours (décompte en jours)';
  if (e.temps === 'dirigeant') return 'cadre dirigeant (art. L3111-2)';
  if (e.typeContrat === 'interim' && !interim) return 'intérimaire (exclu par le réglage)';
  return null;
}

type EquipeP = Pick<Equipe, 'nom' | 'managerId'> & { parente?: string | null; entite?: string | null; siteCode?: string | null; uniteCode?: string | null };
/** Ce que lit le choix de la population : réglages, équipes et entités du référentiel. */
export interface ContextePopulation {
  settings: Pick<Settings, 'pointageActif' | 'pointagePopulations' | 'pointageInterim'>;
  equipes: readonly EquipeP[];
  entites?: readonly { code: string; siteCode: string | null }[];
}

/** Le salarié (tel qu'il était à la date) relève-t-il de la population ? */
export function dansLaPopulation(x: ContextePopulation, e: Pick<Employe, 'equipe' | 'temps'>, p: PopulationPointage): boolean {
  switch (p.critere) {
    case 'equipe': return !!e.equipe && (e.equipe === p.valeur || ancetres(x.equipes, e.equipe).some(q => q.nom === p.valeur));
    case 'entite': return !!e.equipe && entiteEquipe(x.equipes, e.equipe) === p.valeur;
    case 'site': return !!e.equipe && rattachementSalarie(x.equipes, x.entites ?? [], e.equipe).siteCode === p.valeur;
    case 'regime': return e.temps === p.valeur;
  }
}

/**
 * Population qui s'applique au salarié le `date` : parmi celles en vigueur (date d'effet atteinte) qui le désignent, la
 * plus récente ; à date d'effet égale, la dernière de la liste. Null : aucune, module inactif, ou salarié exclu. `e` :
 * le salarié tel qu'il était ce jour-là (régime de l'historique des contrats : `employeAu`).
 */
export function populationAu(x: ContextePopulation, e: Pick<Employe, 'equipe' | 'temps' | 'typeContrat'>, date: ISODate): PopulationPointage | null {
  if (!x.settings.pointageActif || exclusionPointage(e, !!x.settings.pointageInterim)) return null;
  let r: PopulationPointage | null = null;
  for (const p of x.settings.pointagePopulations ?? []) {
    if (p.effet <= date && dansLaPopulation(x, e, p) && (!r || p.effet >= r.effet)) r = p;
  }
  return r;
}
/** Mode de décompte du temps du salarié le `date` : celui de sa population, « declaratif » sans population. */
export const modeTempsAu = (x: ContextePopulation, e: Pick<Employe, 'equipe' | 'temps' | 'typeContrat'>, date: ISODate): ModeTemps =>
  populationAu(x, e, date)?.mode ?? 'declaratif';
/** Salarié qui pointe le `date` : population en mode « controle » ou « calcule ». */
export const pointeAu = (x: ContextePopulation, e: Pick<Employe, 'equipe' | 'temps' | 'typeContrat'>, date: ISODate) => modeTempsAu(x, e, date) !== 'declaratif';

/**
 * Populations saisies dans Paramètres : liste de { critere, valeur, mode, effet } ; refus (message) d'une entrée
 * incomplète, d'un critère ou d'un mode inconnus, d'une date invalide ou d'un doublon (même critère, valeur et date).
 * Régime : valeur parmi les régimes de temps de travail, jamais le forfait jours ni « dirigeant ».
 */
export function lirePopulations(v: unknown): PopulationPointage[] | string {
  if (!Array.isArray(v)) return 'Badgeage : liste des populations attendue';
  if (v.length > POPULATIONS_MAX) return `Badgeage : ${POPULATIONS_MAX} populations au plus`;
  const out: PopulationPointage[] = [];
  for (const [i, x] of v.entries()) {
    const n = `Badgeage, population ${i + 1}`;
    if (!x || typeof x !== 'object') return `${n} : incomplète`;
    const { critere, mode, effet } = x as Record<string, unknown>;
    const valeur = typeof (x as Record<string, unknown>).valeur === 'string' ? ((x as Record<string, unknown>).valeur as string).trim() : '';
    if (!estCritere(critere)) return `${n} : critère inconnu`;
    if (!valeur || valeur.length > VALEUR_POPULATION_MAX) return `${n} : valeur requise (${VALEUR_POPULATION_MAX} caractères au plus)`;
    if (critere === 'regime' && !['35h', '39h_rtt', 'forfait_heures_hebdo', 'forfait_heures_annuel', 'partiel'].includes(valeur)) {
      return `${n} : régime inconnu, ou exclu du badgeage (forfait jours, cadre dirigeant)`;
    }
    if (!estModeTemps(mode)) return `${n} : mode inconnu`;
    if (typeof effet !== 'string' || !isValidDate(effet)) return `${n} : date d’effet invalide`;
    if (out.some(p => p.critere === critere && p.valeur === valeur && p.effet === effet)) return `${n} : en double`;
    out.push({ critere, valeur, mode, effet });
  }
  return out;
}

/** Refus de l'activation du module sans la référence de l'accord ni la date de l'avis du CSE, sinon null (COHERENCE). */
export function refusActivationPointage(s: Pick<Settings, 'pointageActif' | 'pointageAccord' | 'pointageCseLe'>): string | null {
  if (!s.pointageActif) return null;
  return !s.pointageAccord || !s.pointageCseLe
    ? 'Badgeage : l’activation suppose la référence de l’accord d’entreprise et la date de l’avis du CSE sur ce moyen de contrôle (art. L2312-38 et L1222-4)'
    : null;
}

// — Appariement —

/** Ce que lisent l'appariement et les anomalies d'un pointage brut. */
export type PointageLu = Pick<Pointage, 'id' | 'horodatage' | 'sens' | 'annuleId'> & Partial<Pick<Pointage, 'horsLigne' | 'horodatageAppareil' | 'recuLe' | 'source'>>;

const instant = (p: Pick<Pointage, 'horodatage'>) => Date.parse(p.horodatage);
const parInstant = (a: PointageLu, b: PointageLu) => instant(a) - instant(b) || a.id - b.id;

/** Pointages effectifs : ni neutralisation, ni pointage neutralisé, dans l'ordre des instants. */
export function pointagesEffectifs<T extends PointageLu>(l: readonly T[]): T[] {
  const neutralises = new Set(l.flatMap(p => (p.annuleId != null ? [p.annuleId] : [])));
  return l.filter(p => p.annuleId == null && !neutralises.has(p.id)).sort(parInstant);
}

/**
 * Dédoublonnage : un pointage qui suit le précédent gardé de moins de 60 s, de même sens ou de sens inconnu, est un
 * doublon (double appui, renvoi de la file hors ligne) ; il n'entre pas dans l'appariement. `l` trié.
 */
export function dedoublonner<T extends PointageLu>(l: readonly T[]): { gardes: T[]; doublons: T[] } {
  const gardes: T[] = [], doublons: T[] = [];
  for (const p of l) {
    const prec = gardes.at(-1);
    const memeSens = !prec || p.sens == null || prec.sens == null || p.sens === prec.sens;
    if (prec && memeSens && instant(p) - instant(prec) < DOUBLON_SECONDES * 1000) doublons.push(p);
    else gardes.push(p);
  }
  return { gardes, doublons };
}

/** Paire entrée – sortie appariée : instants (ms). */
export interface Paire { entree: PointageLu; sortie: PointageLu; debut: number; fin: number }
/** Pointage resté seul : entrée sans sortie, ou sortie sans entrée. */
export interface Orphelin { p: PointageLu; manque: 'sortie' | 'entree' }
export interface Appariement {
  paires: Paire[];
  orphelins: Orphelin[];
  /** Entrée récente sans sortie (moins de 24 h avant `maintenant`) : salarié présent, poste en cours. */
  enCours: PointageLu | null;
  doublons: PointageLu[];
}

/**
 * Appariement des pointages d'un salarié (bruts, neutralisations comprises) : effectifs, dédoublonnés, puis lus dans
 * l'ordre ; sens inconnu : sortie s'il y a une entrée ouverte, entrée sinon. `maintenant` (ms) : une entrée ouverte depuis
 * moins de 24 h reste en cours ; sans lui, toute entrée sans sortie est une sortie manquante.
 */
export function apparier(l: readonly PointageLu[], maintenant?: number): Appariement {
  const { gardes, doublons } = dedoublonner(pointagesEffectifs(l));
  const paires: Paire[] = [], orphelins: Orphelin[] = [];
  let ouverte: PointageLu | null = null;
  for (const p of gardes) {
    const sens = p.sens ?? (ouverte ? 'S' : 'E');
    if (sens === 'E') {
      if (ouverte) orphelins.push({ p: ouverte, manque: 'sortie' });
      ouverte = p;
    } else if (ouverte && instant(p) - instant(ouverte) <= PAIRE_MAX_MIN * 60_000) {
      paires.push({ entree: ouverte, sortie: p, debut: instant(ouverte), fin: instant(p) });
      ouverte = null;
    } else {
      if (ouverte) orphelins.push({ p: ouverte, manque: 'sortie' });
      orphelins.push({ p, manque: 'entree' });
      ouverte = null;
    }
  }
  let enCours: PointageLu | null = null;
  if (ouverte) {
    if (maintenant != null && maintenant >= instant(ouverte) && maintenant - instant(ouverte) <= PAIRE_MAX_MIN * 60_000) enCours = ouverte;
    else orphelins.push({ p: ouverte, manque: 'sortie' });
  }
  return { paires, orphelins, enCours, doublons };
}

/** Sens à donner au prochain pointage d'un salarié : sortie si une entrée est en cours, entrée sinon. */
export function sensSuivant(l: readonly PointageLu[], maintenant: number): SensPointage {
  return apparier(l, maintenant).enCours ? 'S' : 'E';
}

/**
 * Poste de travail : paires consécutives séparées de moins de 5 h, rattaché au jour de Paris de sa première entrée.
 * Instants en ms ; `travail` et `pauses` en minutes ; `enCours` : dernière paire close à `maintenant`.
 */
export interface Poste { jour: ISODate; debut: number; fin: number; travail: number; pauses: number[]; pauseMax: number; paires: [number, number][]; enCours: boolean }

/** Postes tirés d'un appariement ; l'entrée en cours compte jusqu'à `maintenant`. */
export function postesDe(a: Appariement, maintenant?: number): Poste[] {
  const intervalles: { debut: number; fin: number; enCours: boolean }[] = a.paires.map(p => ({ debut: p.debut, fin: p.fin, enCours: false }));
  if (a.enCours && maintenant != null) intervalles.push({ debut: instant(a.enCours), fin: maintenant, enCours: true });
  intervalles.sort((x, y) => x.debut - y.debut);
  const out: Poste[] = [];
  for (const i of intervalles) {
    const dernier = out.at(-1);
    if (dernier && i.debut - dernier.fin < ECART_POSTE_MIN * 60_000) {
      const pause = Math.max(0, Math.round((i.debut - dernier.fin) / 60_000));
      dernier.pauses.push(pause);
      dernier.pauseMax = Math.max(dernier.pauseMax, pause);
      dernier.fin = i.fin;
      dernier.paires.push([i.debut, i.fin]);
      dernier.travail += Math.round((i.fin - i.debut) / 60_000);
      dernier.enCours ||= i.enCours;
    } else {
      out.push({ jour: heureParis(i.debut).jour, debut: i.debut, fin: i.fin, travail: Math.round((i.fin - i.debut) / 60_000), pauses: [], pauseMax: 0, paires: [[i.debut, i.fin]], enCours: i.enCours });
    }
  }
  return out;
}

/** Postes d'un salarié d'après ses pointages bruts (raccourci : `apparier` puis `postesDe`). */
export const postesDesPointages = (l: readonly PointageLu[], maintenant?: number) => postesDe(apparier(l, maintenant), maintenant);

/** Minutes travaillées par jour de rattachement. */
export function realiseParJour(postes: readonly Poste[]): Map<ISODate, number> {
  const m = new Map<ISODate, number>();
  for (const p of postes) m.set(p.jour, (m.get(p.jour) ?? 0) + p.travail);
  return m;
}

// — Plages réelles et travail de nuit —

/**
 * Heures de nuit d'intervalles de travail (instants en ms), sur les instants réels : la plage de nuit réglée (21 h – 6 h
 * par défaut) est placée chaque jour à l'heure de Paris, juste aux nuits de changement d'heure (au centième d'heure).
 */
export function heuresDeNuitReelles(intervalles: readonly (readonly [number, number])[], s?: Partial<ReglagesNuit>): number {
  const r = reglagesNuit(s);
  let ms = 0;
  for (const [a, b] of intervalles) {
    if (!(b > a)) continue;
    for (let jour = addD(heureParis(a).jour, -1); jour <= heureParis(b).jour; jour = addD(jour, 1)) {
      const de = instantParis(jour, r.nuitDebut * 60);
      const a2 = instantParis(r.nuitFin <= r.nuitDebut ? addD(jour, 1) : jour, r.nuitFin * 60);
      ms += Math.max(0, Math.min(b, a2) - Math.max(a, de));
    }
  }
  return Math.round(ms / 36_000) / 100;
}

/** Plages réelles d'une semaine, pour `controlesReposNuit` (shared/rules/repos-nuit.ts, option `reelles`). */
export interface PlagesReelles {
  /** Plage de chaque jour (0 = lundi), en minutes écoulées depuis le lundi 0 h de Paris ; pause : la plus longue du jour. */
  plages: (PlageTravail | null)[];
  /** Heures de nuit de chaque jour, sur les instants réels. */
  nuitParJour: number[];
  /** Plage du dimanche précédent (repos du lundi), ou null. */
  veille: PlageTravail | null;
}

/**
 * Plages réelles de la semaine `week` (lundi) d'après les postes du salarié : un jour sans poste n'en a aucune ; deux
 * postes le même jour forment une plage, de la première entrée à la dernière sortie (leur écart compte comme pause).
 */
export function plagesReelles(postes: readonly Poste[], week: ISODate, s?: Partial<ReglagesNuit>): PlagesReelles {
  const lundi = Date.parse(debutJourParis(week)), jours = Array.from({ length: 7 }, (_, i) => addD(week, i));
  const plage = (l: readonly Poste[]): PlageTravail | null => {
    if (!l.length) return null;
    const debut = Math.min(...l.map(p => p.debut)), fin = Math.max(...l.map(p => p.fin));
    const ecarts = l.slice(1).map((p, i) => Math.round((p.debut - l[i].fin) / 60_000));
    return { debut: Math.round((debut - lundi) / 60_000), fin: Math.round((fin - lundi) / 60_000), pause: Math.max(0, ...l.flatMap(p => p.pauses), ...ecarts) };
  };
  const du = (j: ISODate) => postes.filter(p => p.jour === j).sort((a, b) => a.debut - b.debut);
  return {
    plages: jours.map(j => plage(du(j))),
    nuitParJour: jours.map(j => heuresDeNuitReelles(du(j).flatMap(p => p.paires), s)),
    veille: plage(du(addD(week, -1))),
  };
}

// — Anomalies (calculées, jamais stockées) —

export type CodeAnomaliePointage =
  | 'sortie_manquante' | 'entree_manquante' | 'differe' | 'sans_pointage' | 'pendant_absence' | 'hors_contrat' | 'amplitude'
  | 'repos_quotidien' | 'pause' | 'duree_jour' | 'duree_semaine' | 'ecart_declare' | 'apres_validation';
export const ANOMALIES_POINTAGE: Record<CodeAnomaliePointage, string> = {
  sortie_manquante: 'Sortie manquante', entree_manquante: 'Entrée manquante', differe: 'Pointage différé (hors ligne)',
  sans_pointage: 'Jour prévu sans pointage', pendant_absence: 'Pointage un jour d’absence', hors_contrat: 'Pointage hors contrat',
  amplitude: `Amplitude de plus de ${AMPLITUDE_MAX_H} h`, repos_quotidien: 'Repos quotidien de 11 h non respecté', pause: 'Pause insuffisante',
  duree_jour: `Plus de ${JOURNEE_MAX_H} h dans la journée`, duree_semaine: `Plus de ${SEMAINE_MAX_H} h dans la semaine`,
  ecart_declare: 'Écart entre heures déclarées et pointées', apres_validation: 'Pointage postérieur à la validation de la feuille',
};
export interface AnomaliePointage { code: CodeAnomaliePointage; jour: ISODate; texte: string }

/** Ce que lisent les anomalies d'une période (jours de Paris `du` à `au`). */
export interface EntreeAnomalies {
  du: ISODate; au: ISODate;
  /** Pointages bruts de la période élargie (veille et lendemain compris : postes de nuit). */
  pointages: readonly PointageLu[];
  /** Instant de la lecture (ms) : une entrée récente reste en cours, et un jour qui n'est pas fini n'est pas « sans pointage ». */
  maintenant: number;
  /** Jours où un travail est prévu (théorique non nul, shared/rules/debit-credit.ts). */
  prevus?: ReadonlySet<ISODate>;
  /** Jours d'absence (validée ou signalée, toute nature) et jours hors contrat. */
  absents?: ReadonlySet<ISODate>;
  horsContrat?: ReadonlySet<ISODate>;
  /** Mode « controle » : heures déclarées de chaque jour (feuille), comparées au pointé au-delà de `ecartMin` minutes. */
  declare?: ReadonlyMap<ISODate, number>;
  ecartMin?: number;
  /** Écart toléré entre l'heure de l'appareil et la réception, en minutes (réglage `pointageEcartDiffereMin`). */
  differeMin?: number;
  /** Total pointé figé à la validation (heures par jour, `pointeFige`) des feuilles validées : un écart y est postérieur. */
  figes?: ReadonlyMap<ISODate, number>;
  /** Salarié de moins de 18 ans : seuils de repos et de pause de repos-nuit.ts (non contrôlés ici). */
}

const minutesTexte = (m: number) => fH(m / 60);

/** Anomalies de la période, par jour puis par code. */
export function anomaliesPointage(x: EntreeAnomalies): AnomaliePointage[] {
  const out: AnomaliePointage[] = [];
  const dans = (j: ISODate) => j >= x.du && j <= x.au;
  const a = apparier(x.pointages, x.maintenant);
  const postes = postesDe(a, x.maintenant);
  const aujourdhui = heureParis(x.maintenant).jour;
  for (const o of a.orphelins) {
    const j = heureParis(instant(o.p)).jour;
    if (dans(j)) out.push({ code: o.manque === 'sortie' ? 'sortie_manquante' : 'entree_manquante', jour: j, texte: `${o.manque === 'sortie' ? 'Sortie manquante après l’entrée' : 'Entrée manquante avant la sortie'} de ${hhmmParis(instant(o.p))}` });
  }
  const differe = (x.differeMin ?? 5) * 60_000;
  for (const p of pointagesEffectifs(x.pointages)) {
    const j = heureParis(instant(p)).jour;
    if (!dans(j) || !p.horsLigne) continue;
    const recu = p.recuLe ? Date.parse(p.recuLe) : instant(p);
    if (Math.abs(recu - instant(p)) > differe) out.push({ code: 'differe', jour: j, texte: `Pointage de ${hhmmParis(instant(p))} fait hors ligne, reçu ${minutesTexte(Math.round((recu - instant(p)) / 60_000))} plus tard : heure de l’appareil à vérifier` });
  }
  const realise = realiseParJour(postes);
  const pointes = new Set(pointagesEffectifs(x.pointages).map(q => heureParis(instant(q)).jour));
  for (let j = x.du; j <= x.au; j = addD(j, 1)) {
    const m = realise.get(j) ?? 0;
    if (!m && !pointes.has(j) && x.prevus?.has(j) && !x.absents?.has(j) && j < aujourdhui) out.push({ code: 'sans_pointage', jour: j, texte: 'Travail prévu ce jour-là, sans pointage ni absence' });
    if (m && x.absents?.has(j)) out.push({ code: 'pendant_absence', jour: j, texte: 'Pointage un jour d’absence enregistrée' });
    if (m && x.horsContrat?.has(j)) out.push({ code: 'hors_contrat', jour: j, texte: 'Pointage en dehors du contrat de travail' });
    if (m > JOURNEE_MAX_H * 60) out.push({ code: 'duree_jour', jour: j, texte: `${minutesTexte(m)} pointées dans la journée (${JOURNEE_MAX_H} h au plus, art. L3121-18)` });
    const declare = x.declare?.get(j);
    if (declare != null && Math.abs(declare * 60 - m) > (x.ecartMin ?? 15) && j < aujourdhui) {
      out.push({ code: 'ecart_declare', jour: j, texte: `${fH(declare)} déclarées, ${minutesTexte(m)} pointées` });
    }
    const fige = x.figes?.get(j);
    if (fige != null && Math.abs(fige * 60 - m) > 1) out.push({ code: 'apres_validation', jour: j, texte: `Pointé changé depuis la validation de la feuille (${fH(fige)} figées, ${minutesTexte(m)} pointées) : réouverture à demander` });
  }
  const parJour = new Map<ISODate, Poste[]>();
  for (const p of postes) parJour.set(p.jour, [...parJour.get(p.jour) ?? [], p]);
  let precedent: Poste | null = null;
  for (const p of [...postes].sort((u, v) => u.debut - v.debut)) {
    if (dans(p.jour)) {
      const amplitude = (p.fin - p.debut) / 3_600_000;
      if (amplitude > AMPLITUDE_MAX_H) out.push({ code: 'amplitude', jour: p.jour, texte: `Amplitude de ${fH(amplitude)} (${hhmmParis(p.debut)} – ${hhmmParis(p.fin)})` });
      if (precedent && !p.enCours) {
        const repos = (p.debut - precedent.fin) / 3_600_000;
        if (repos < 11) out.push({ code: 'repos_quotidien', jour: p.jour, texte: `${fH(repos)} de repos avant la reprise de ${hhmmParis(p.debut)} (11 h consécutives, art. L3131-1)` });
      }
      if (!p.enCours && p.travail >= 6 * 60 && p.pauseMax < 20) out.push({ code: 'pause', jour: p.jour, texte: `Pause de ${p.pauseMax} min pour ${minutesTexte(p.travail)} de travail (20 min dès 6 h, art. L3121-16)` });
    }
    precedent = p;
  }
  // Semaines de la période : 48 h au plus (lundi au dimanche, jours de rattachement).
  for (let w = mondayOf(x.du); w <= x.au; w = addD(w, 7)) {
    let m = 0;
    for (let i = 0; i < 7; i++) m += realise.get(addD(w, i)) ?? 0;
    if (m > SEMAINE_MAX_H * 60) out.push({ code: 'duree_semaine', jour: dans(w) ? w : x.du, texte: `${minutesTexte(m)} pointées dans la semaine du ${w} (${SEMAINE_MAX_H} h au plus, art. L3121-20)` });
  }
  return out.sort((u, v) => u.jour.localeCompare(v.jour) || u.code.localeCompare(v.code));
}

// — Pointage différé et corrections —

/**
 * Refus de l'heure d'un pointage différé (hors ligne), ou null : heure de l'appareil lisible, au plus 5 min dans le futur
 * de l'heure du serveur, de moins de 7 jours.
 */
export function refusHeureAppareil(horodatage: string | null, maintenant: number): string | null {
  if (!horodatage) return 'Pointage hors ligne : heure de l’appareil manquante';
  const t = Date.parse(horodatage);
  if (t - maintenant > AVANCE_APPAREIL_MAX_MIN * 60_000) return 'Pointage hors ligne : l’heure de l’appareil est en avance sur celle du serveur, pointez de nouveau';
  if (maintenant - t > DIFFERE_MAX_JOURS * 86_400_000) return `Pointage hors ligne de plus de ${DIFFERE_MAX_JOURS} jours : demandez une correction`;
  return null;
}

/**
 * Refus d'une demande de correction pour le jour `jour`, ou null : jour passé ou du jour, dans le délai réglé (7 jours par
 * défaut) sauf pour le service RH (`sansDelai`).
 */
export function refusDelaiCorrection(jour: ISODate, today: ISODate, delaiJours: number, sansDelai: boolean): string | null {
  if (jour > today) return 'Correction d’un jour à venir : impossible';
  if (!sansDelai && jour < addD(today, -delaiJours)) return `Correction demandée plus de ${delaiJours} jours après le pointage : adressez-vous au service RH`;
  return null;
}
