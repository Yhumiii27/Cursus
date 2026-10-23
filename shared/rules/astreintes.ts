// Astreintes (t049, lot 7, étape 1) : période pendant laquelle le salarié, sans être sur son lieu de travail ni à la
// disposition permanente de l'employeur, doit pouvoir intervenir (art. L3121-9). Organisation du site confirmée par
// l'entreprise : « des salariés d'astreinte », en maintenance surtout. L'accord sur le temps de travail n'est pas connu :
// valeurs supplétives de la loi et choix par défaut du chantier, réglables (Paramètres, réglages `astreinte…`).
// - Planning : planifié par le manager direct ou le service RH, communiqué au salarié (e-mail et événement d'agenda) au
//   moins 15 jours à l'avance (art. L3121-12, réglage `astreinteDelaiPrevenance`). En dessous, motif des « circonstances
//   exceptionnelles » obligatoire, et jamais moins d'un jour franc : une astreinte communiquée le lundi commence au plus
//   tôt le mercredi.
// - Pas de chevauchement avec une autre astreinte du salarié, ni avec une absence en vigueur (validée ou signalée) ; une
//   demande d'absence en attente est signalée sans blocage. Dans le contrat seulement.
// - Salarié de moins de 18 ans : refus par défaut (réglage `astreinteMineurs`), le travail de nuit lui étant interdit
//   (art. L3163-2) et une intervention ne se programmant pas.
// - Intervention : du travail effectif, déclaré sur la feuille de temps avec ses heures de début et de fin (une fin avant
//   le début : le lendemain), à l'intérieur de l'astreinte, rattaché au jour où il commence ; ses heures s'ajoutent à la
//   ligne INT-AST de ce jour et passent par les heures normales, supplémentaires et de nuit comme les autres.
// - Repos quotidien (art. L3121-10) : le temps d'astreinte sans intervention compte comme repos ; après une intervention, le
//   repos de 11 h est dû en entier à partir de sa fin (shared/rules/repos-nuit.ts, `interventions`).
// - Heures et périodes d'astreinte d'un mois (récapitulatif remis au salarié, art. R3121-2 ; rubriques AST_H et AST_PER de
//   l'étape 2) : heures d'horloge de la période comprises dans le mois, période comptée le mois où elle commence.
// Contrôles partagés par l'action (server/src/actions/astreintes.ts) et, à l'étape 2, les dialogues.
import { addD, days, isValidDate, joursSemaine, mondayOf, parse } from '../dates.ts';
import { fH, fmtIso, plural } from '../format.ts';
import type { Absence, Astreinte, CompensationAstreinte, Employe, ISODate, InterventionAstreinte, Settings } from '../types.ts';
import { absenceActive, absenceBloque, borneContrat, periodeTexte } from './absences.ts';
import { normaliserHeure } from './horaires.ts';
import { mineurAu, type Naissance } from './mineurs.ts';
import type { PlageIntervention } from './repos-nuit.ts';

// — Réglages (valeurs supplétives de la loi et choix par défaut du chantier) —

/** Délai de prévenance à défaut d'accord (art. L3121-12), en jours. */
export const DELAI_PREVENANCE_LEGAL = 15;
/**
 * Délai minimal, même en circonstances exceptionnelles : un jour franc entre le jour de la communication et le premier jour
 * de l'astreinte (art. L3121-12), soit deux jours de date à date.
 */
export const DELAI_JOUR_FRANC = 2;
/** Durée maximale d'une astreinte saisie d'un seul tenant (jours) : au-delà, plusieurs périodes (garde-fou de saisie). */
export const DUREE_MAX_JOURS = 31;
/** Motif des circonstances exceptionnelles, de l'annulation : texte libre, 500 caractères au plus. */
export const MOTIF_ASTREINTE_MAX = 500;
/** Durée maximale d'une intervention (heures). */
export const INTERVENTION_MAX_HEURES = 24;

export type ReglagesAstreinte = Pick<Settings, 'astreinteDelaiPrevenance' | 'astreinteCompensation' | 'astreinteMineurs' | 'astreinteAccord'>;

/** Réglages des astreintes, valeurs par défaut pour un instantané qui ne les aurait pas encore. */
export function reglagesAstreinte(s: Partial<ReglagesAstreinte> | undefined): ReglagesAstreinte {
  const delai = Number(s?.astreinteDelaiPrevenance);
  return {
    astreinteDelaiPrevenance: Number.isInteger(delai) && delai >= DELAI_JOUR_FRANC ? delai : DELAI_PREVENANCE_LEGAL,
    astreinteCompensation: s?.astreinteCompensation === 'repos' ? 'repos' : 'financiere',
    astreinteMineurs: s?.astreinteMineurs === true,
    astreinteAccord: s?.astreinteAccord ?? '',
  };
}

/** Libellé de la forme de la compensation (récapitulatif mensuel, art. R3121-2). */
export const COMPENSATION_LABEL: Record<CompensationAstreinte, string> = {
  financiere: 'Financière : montant sur le bulletin de paie',
  repos: 'En repos',
};

// — Instants et durées —

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/**
 * Instant d'un jour et d'une heure « HH:MM », en minutes d'horloge (sans changement d'heure : une astreinte de la nuit du
 * passage à l'heure d'été compte les heures affichées par la pendule, comme les feuilles de temps).
 */
export const instant = (jour: ISODate, hhmm: string) => Math.round(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10))) / 60_000) + minutes(hhmm);
export const debutAstreinte = (a: Pick<Astreinte, 'du' | 'debut'>) => instant(a.du, a.debut);
export const finAstreinte = (a: Pick<Astreinte, 'au' | 'fin'>) => instant(a.au, a.fin);
const arrondi = (h: number) => Math.round(h * 100) / 100;
/** Heures d'astreinte d'une période (au centième). */
export const heuresAstreinte = (a: Pick<Astreinte, 'du' | 'debut' | 'au' | 'fin'>) => arrondi((finAstreinte(a) - debutAstreinte(a)) / 60);

/** Astreinte en vigueur (non annulée). */
export const astreinteActive = (a: Pick<Astreinte, 'annuleLe'>) => !a.annuleLe;
/** Astreinte commencée à la date `ti` (son premier jour est arrivé) : ses dates ne changent plus, sa fin seulement. */
export const astreinteCommencee = (a: Pick<Astreinte, 'du'>, ti: ISODate) => a.du <= ti;
/** Astreinte terminée avant la date `ti`. */
export const astreinteTerminee = (a: Pick<Astreinte, 'au'>, ti: ISODate) => a.au < ti;

/** « 18 h », « 7 h 30 ». */
export const heureTexte = (hhmm: string) => `${Number(hhmm.slice(0, 2))} h${hhmm.slice(3) === '00' ? '' : ` ${hhmm.slice(3)}`}`;
/** « du 16 oct. 2026 à 18 h au 23 oct. 2026 à 8 h », « le 16 oct. 2026 de 8 h à 18 h ». */
export function periodeAstreinteTexte(a: Pick<Astreinte, 'du' | 'debut' | 'au' | 'fin'>): string {
  return a.du === a.au
    ? `le ${fmtIso(a.du)} de ${heureTexte(a.debut)} à ${heureTexte(a.fin)}`
    : `du ${fmtIso(a.du)} à ${heureTexte(a.debut)} au ${fmtIso(a.au)} à ${heureTexte(a.fin)}`;
}

// — Délai de prévenance —

export interface Prevenance {
  /** Jours entre la communication (aujourd'hui) et le premier jour de l'astreinte. */
  jours: number;
  /** Délai réglé non tenu : motif des circonstances exceptionnelles exigé. */
  court: boolean;
  /** Moins d'un jour franc : refus, sans motif possible. */
  refus: string | null;
}

/** Délai de prévenance d'une astreinte qui commence le `du`, communiquée le `ti`. */
export function prevenance(du: ISODate, ti: ISODate, s: Partial<ReglagesAstreinte> | undefined): Prevenance {
  const r = reglagesAstreinte(s), jours = days(parse(ti), parse(du));
  const refus = jours < DELAI_JOUR_FRANC
    ? `Astreinte communiquée trop tard : un jour franc au moins entre l’information du salarié et le début de l’astreinte (art. L3121-12), soit le ${fmtIso(addD(ti, DELAI_JOUR_FRANC))} au plus tôt`
    : null;
  return { jours, court: jours < r.astreinteDelaiPrevenance, refus };
}

/** Texte de l'alerte d'un délai court, qui demande le motif. */
export const delaiCourtTexte = (p: Prevenance, s: Partial<ReglagesAstreinte> | undefined) =>
  `Astreinte communiquée ${plural(p.jours, 'jour', 'jours')} avant son début, moins que le délai de prévenance de ${reglagesAstreinte(s).astreinteDelaiPrevenance} jours (art. L3121-12) : indiquez les circonstances exceptionnelles qui le justifient`;

// — Contrôle d'une astreinte —

/** Données lues par les contrôles : astreintes et absences du salarié (toutes : le contrôle filtre). */
export interface DsAstreinte { astreintes?: readonly Astreinte[]; absences: readonly Pick<Absence, 'id' | 'empId' | 'du' | 'au' | 'statut'>[] }
/** Salarié vu par les contrôles. */
export type EmployeAstreinte = Pick<Employe, 'id' | 'nom' | 'entree' | 'fin' | 'typeContrat'> & Naissance;

export interface SaisieAstreinte { du?: unknown; debut?: unknown; au?: unknown; fin?: unknown; motif?: unknown }
export interface ErreursAstreinte { du?: string; debut?: string; au?: string; fin?: string; motif?: string; general?: string }
export interface AstreinteControlee {
  erreurs: ErreursAstreinte;
  /** Valeurs normalisées, sans erreur seulement. */
  valeurs: { du: ISODate; debut: string; au: ISODate; fin: string; motif: string | null } | null;
  /** Avertissements sans blocage (demande d'absence en attente). */
  avertissements: string[];
  prevenance: Prevenance | null;
}

/** Première erreur d'un contrôle, dans l'ordre des champs (message de l'action). */
export const premiereErreur = (e: ErreursAstreinte): string | null => e.general ?? e.du ?? e.debut ?? e.au ?? e.fin ?? e.motif ?? null;

const motifDe = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Astreinte planifiée (`existante` null) ou modifiée, à la date `ti`. Une astreinte commencée ne change plus que de fin, et
 * seulement pour être raccourcie (une prolongation est une nouvelle astreinte, avec son délai de prévenance) : sa fin au
 * plus tôt aujourd'hui et après la dernière intervention déclarée (`finInterventions`, en minutes d'horloge).
 */
export function controlerAstreinte(ds: DsAstreinte, e: EmployeAstreinte, p: SaisieAstreinte, ti: ISODate,
  s: Partial<ReglagesAstreinte> | undefined, existante: Astreinte | null = null, finInterventions: number | null = null): AstreinteControlee {
  const erreurs: ErreursAstreinte = {}, avertissements: string[] = [];
  const out = (prevenance: Prevenance | null = null): AstreinteControlee => ({ erreurs, valeurs: null, avertissements, prevenance });
  const val = <T>(v: unknown, actuel: T | undefined): unknown => (v === undefined || v === null || v === '' ? actuel : v);
  const du = String(val(p.du, existante?.du) ?? '').trim(), au = String(val(p.au, existante?.au) ?? '').trim();
  const debut = normaliserHeure(val(p.debut, existante?.debut)), fin = normaliserHeure(val(p.fin, existante?.fin));
  if (!isValidDate(du)) erreurs.du = 'Indiquez le premier jour de l’astreinte.';
  if (!debut) erreurs.debut = 'Indiquez l’heure de début (18:00, 8 h…).';
  if (!isValidDate(au)) erreurs.au = 'Indiquez le dernier jour de l’astreinte.';
  if (!fin) erreurs.fin = 'Indiquez l’heure de fin (8:00, 18 h…).';
  if (Object.keys(erreurs).length) return out();
  const v = { du, debut: debut!, au, fin: fin! };
  if (finAstreinte(v) <= debutAstreinte(v)) { erreurs.fin = 'La fin de l’astreinte doit suivre son début.'; return out(); }
  if (days(parse(du), parse(au)) + 1 > DUREE_MAX_JOURS) { erreurs.au = `Une astreinte dure ${DUREE_MAX_JOURS} jours au plus : planifiez plusieurs périodes.`; return out(); }

  const motif = motifDe(val(p.motif, existante?.motif));
  if (motif.length > MOTIF_ASTREINTE_MAX) { erreurs.motif = `Motif : ${MOTIF_ASTREINTE_MAX} caractères au plus.`; return out(); }

  // Astreinte commencée : sa fin seulement, raccourcie.
  if (existante && astreinteCommencee(existante, ti)) {
    if (du !== existante.du || v.debut !== existante.debut) { erreurs.du = 'Astreinte commencée : seule sa fin peut être avancée.'; return out(); }
    if (finAstreinte(v) > finAstreinte(existante)) { erreurs.au = 'Astreinte commencée : sa fin peut être avancée, pas reculée (planifiez une nouvelle astreinte à la suite).'; return out(); }
    if (au < ti) { erreurs.au = `Fin de l’astreinte : aujourd’hui (${fmtIso(ti)}) au plus tôt.`; return out(); }
    if (finInterventions != null && finAstreinte(v) < finInterventions) { erreurs.au = 'Fin de l’astreinte : après la dernière intervention déclarée.'; return out(); }
    return { erreurs, valeurs: { ...v, motif: existante.motif }, avertissements, prevenance: null };
  }

  // Délai de prévenance : un jour franc au moins, motif des circonstances exceptionnelles en dessous du délai réglé.
  const pr = prevenance(du, ti, s);
  if (pr.refus) { erreurs.du = pr.refus; return out(pr); }
  if (pr.court && !motif) { erreurs.motif = delaiCourtTexte(pr, s); return out(pr); }

  const contrat = borneContrat(e, du, au);
  if (contrat) { erreurs.general = `Astreinte hors du contrat (${contrat})`; return out(pr); }
  if (mineurAu(e, du) && !reglagesAstreinte(s).astreinteMineurs) {
    erreurs.general = `${e.nom || 'Ce salarié'} a moins de 18 ans : pas d’astreinte pour un salarié mineur (travail de nuit interdit, art. L3163-2 ; réglage des astreintes)`;
    return out(pr);
  }
  // Autre astreinte du salarié qui la chevauche (bornes exclues : une astreinte peut suivre l'autre sans interruption).
  const autre = (ds.astreintes ?? []).find(a => a.empId === e.id && a.id !== existante?.id && astreinteActive(a)
    && debutAstreinte(a) < finAstreinte(v) && finAstreinte(a) > debutAstreinte(v));
  if (autre) { erreurs.general = `Astreinte déjà planifiée ${periodeAstreinteTexte(autre)}`; return out(pr); }
  // Absence en vigueur sur l'un des jours : le salarié n'est pas joignable ; demande en attente : avertissement.
  for (const a of ds.absences) {
    if (a.empId !== e.id || !absenceActive(a) || a.du > au || a.au < du) continue;
    if (absenceBloque(a)) { erreurs.general = `Absence ${a.statut === 'signalee' ? 'signalée' : 'validée'} ${periodeTexte(a.du, a.au)} : le salarié est absent`; return out(pr); }
    avertissements.push(`Demande d’absence en attente ${periodeTexte(a.du, a.au)}`);
  }
  return { erreurs, valeurs: { ...v, motif: pr.court ? motif : (motif || null) }, avertissements, prevenance: pr };
}

// — Interventions —

export interface SaisieIntervention { jour?: unknown; debut?: unknown; fin?: unknown }
export interface ErreursIntervention { jour?: string; debut?: string; fin?: string; general?: string }

/** Durée d'une intervention en heures : de son début à sa fin, le lendemain quand la fin précède le début. */
export const dureeIntervention = (debut: string, fin: string) => arrondi((((minutes(fin) - minutes(debut)) % 1440 + 1440) % 1440) / 60);
/** Début et fin d'une intervention en minutes d'horloge. */
export function bornesIntervention(x: Pick<InterventionAstreinte, 'jour' | 'debut' | 'fin'>): { debut: number; fin: number } {
  const debut = instant(x.jour, x.debut);
  return { debut, fin: debut + Math.round(dureeIntervention(x.debut, x.fin) * 60) };
}

/**
 * Intervention déclarée pendant l'astreinte `a`, à la date `ti` : jour pas à venir, heures valides, durée de 24 h au plus,
 * entièrement dans l'astreinte, sans chevaucher une autre intervention du salarié. Renvoie les valeurs normalisées.
 */
export function controlerIntervention(a: Astreinte, p: SaisieIntervention, autres: readonly InterventionAstreinte[], ti: ISODate):
  { erreurs: ErreursIntervention; valeurs: Pick<InterventionAstreinte, 'jour' | 'debut' | 'fin' | 'heures'> | null } {
  const erreurs: ErreursIntervention = {};
  const jour = String(p.jour ?? '').trim(), debut = normaliserHeure(p.debut), fin = normaliserHeure(p.fin);
  if (!isValidDate(jour)) erreurs.jour = 'Indiquez le jour de l’intervention.';
  else if (jour > ti) erreurs.jour = 'Une intervention se déclare une fois faite : jour à venir refusé.';
  if (!debut) erreurs.debut = 'Indiquez l’heure de début de l’intervention.';
  if (!fin) erreurs.fin = 'Indiquez l’heure de fin de l’intervention.';
  else if (debut && debut === fin) erreurs.fin = 'La fin de l’intervention doit différer de son début.';
  if (!astreinteActive(a)) erreurs.general = 'Astreinte annulée : aucune intervention ne peut y être déclarée';
  if (Object.keys(erreurs).length) return { erreurs, valeurs: null };
  const x = { jour, debut: debut!, fin: fin! }, b = bornesIntervention(x);
  if (b.debut < debutAstreinte(a) || b.fin > finAstreinte(a)) {
    erreurs.general = `Intervention en dehors de l’astreinte (${periodeAstreinteTexte(a)})`;
    return { erreurs, valeurs: null };
  }
  const chevauche = autres.find(o => o.empId === a.empId && (() => { const c = bornesIntervention(o); return c.debut < b.fin && c.fin > b.debut; })());
  if (chevauche) {
    erreurs.general = `Intervention déjà déclarée le ${fmtIso(chevauche.jour)} de ${heureTexte(chevauche.debut)} à ${heureTexte(chevauche.fin)}`;
    return { erreurs, valeurs: null };
  }
  return { erreurs, valeurs: { ...x, heures: dureeIntervention(x.debut, x.fin) } };
}

/** Jour de la feuille (0 = lundi … 6 = dimanche) d'une date dans la semaine du lundi `week` ; -1 : dimanche précédent. */
const jourDansSemaine = (week: ISODate, jour: ISODate) => days(parse(week), parse(jour));

/**
 * Plages des interventions d'un salarié pour les contrôles de la semaine du lundi `week` (shared/rules/repos-nuit.ts) : en
 * minutes depuis le lundi 0 h, avec le jour où chacune commence (0 à 6 ; -1 : dimanche de la semaine précédente, pour le
 * repos du lundi).
 */
export function plagesInterventions(list: readonly InterventionAstreinte[] | undefined, empId: number, week: ISODate | null | undefined): PlageIntervention[] {
  if (!week || !list?.length) return [];
  const lundi = instant(week, '00:00');
  return list.filter(x => x.empId === empId).map(x => ({ x, di: jourDansSemaine(week, x.jour) })).filter(({ di }) => di >= -1 && di <= 6)
    .map(({ x, di }) => { const b = bornesIntervention(x); return { di, debut: b.debut - lundi, fin: b.fin - lundi }; })
    .sort((a, b) => a.debut - b.debut);
}

/** Heures d'intervention de chaque jour de la semaine du lundi `week` (0 = lundi … 6 = dimanche), jour de leur début. */
export function heuresInterventionsParJour(list: readonly InterventionAstreinte[] | undefined, empId: number, week: ISODate): number[] {
  const out = Array<number>(7).fill(0);
  for (const x of list ?? []) {
    const di = jourDansSemaine(week, x.jour);
    if (x.empId === empId && di >= 0 && di <= 6) out[di] = arrondi(out[di] + x.heures);
  }
  return out;
}

/** Semaine de la feuille qui porte l'intervention : celle de son jour de début. */
export const semaineIntervention = (x: Pick<InterventionAstreinte, 'jour'>) => mondayOf(x.jour);
/** Jour de la feuille (0 = lundi … 6 = dimanche) de l'intervention. */
export const jourIntervention = (x: Pick<InterventionAstreinte, 'jour'>) => jourDansSemaine(semaineIntervention(x), x.jour);
/** Les jours de la semaine de l'intervention (en-têtes, messages). */
export const joursDeLIntervention = (x: Pick<InterventionAstreinte, 'jour'>) => joursSemaine(semaineIntervention(x));

// — Heures et périodes d'un mois —

/** Premier jour du mois « AAAA-MM » et premier jour du mois suivant. */
function bornesMois(mois: string): { debut: number; fin: number } {
  const y = Number(mois.slice(0, 4)), m = Number(mois.slice(5, 7));
  return { debut: Math.round(Date.UTC(y, m - 1, 1) / 60_000), fin: Math.round(Date.UTC(y, m, 1) / 60_000) };
}

export interface BilanAstreintes {
  /** Périodes d'astreinte qui commencent dans le mois (rubrique AST_PER de l'étape 2). */
  periodes: number;
  /** Heures d'astreinte comprises dans le mois, interventions comprises (rubrique AST_H de l'étape 2). */
  heures: number;
  /** Interventions qui commencent dans le mois et leurs heures (travail effectif, déjà dans la feuille de temps). */
  interventions: number;
  heuresInterventions: number;
}

/** Heures, périodes et interventions d'astreinte d'un salarié pour le mois « AAAA-MM » (astreintes annulées exclues). */
export function bilanMensuel(astreintes: readonly Astreinte[] | undefined, interventions: readonly InterventionAstreinte[] | undefined, empId: number, mois: string): BilanAstreintes {
  const m = bornesMois(mois);
  const siennes = (astreintes ?? []).filter(a => a.empId === empId && astreinteActive(a));
  const heures = siennes.reduce((n, a) => n + Math.max(0, Math.min(finAstreinte(a), m.fin) - Math.max(debutAstreinte(a), m.debut)), 0) / 60;
  const ints = (interventions ?? []).filter(x => x.empId === empId && x.jour.slice(0, 7) === mois);
  return {
    periodes: siennes.filter(a => a.du.slice(0, 7) === mois).length,
    heures: arrondi(heures),
    interventions: ints.length,
    heuresInterventions: arrondi(ints.reduce((n, x) => n + x.heures, 0)),
  };
}

/** « 2 périodes, 128 h d'astreinte, 1 intervention (3 h) ». */
export function bilanTexte(b: BilanAstreintes): string {
  return `${plural(b.periodes, 'période', 'périodes')}, ${fH(b.heures)} d’astreinte, ${plural(b.interventions, 'intervention', 'interventions')}${b.interventions ? ` (${fH(b.heuresInterventions)})` : ''}`;
}
