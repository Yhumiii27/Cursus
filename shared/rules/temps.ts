// Feuilles de temps : décompte des heures, majorations, variables de paie.
import { horodatageParis, isFerie, isoWeek, isoWeekYear, joursSemaine, parse } from '../dates.ts';
import { fH, num, r1 } from '../format.ts';
import type { Domain, MemoTable } from '../domain.ts';
import type { Absence, AbsenceType, ContratFige, DemiJournee, ElementASaisir, Employe, FeuilleTemps, ISODate, LigneTemps, ModeHeuresSupFige, SageMode, SagePush, TacheKeystone } from '../types.ts';
import { absenceBloque, jourHorsContrat, natureDef, natureMedicale } from './absences.ts';
import { DEMI_LABEL, heuresDemiJournee, moities } from './demi-journees.ts';
import { lignesFormation } from './formations-temps.ts';
import { matriculeAffiche } from './matricules.ts';
import { modeHeuresSup, periodeLabel, periodeOuverte, periodesSemaine, rubriquesPaie, traduireRubriques } from './paie.ts';
import { RUBRIQUES_PAIE } from '../constants.ts';
import { alertesRepos, DIMANCHE, derogationDe, estWeekEnd, JOURS_FEUILLE } from './semaine.ts';
import { controlesMineur, naissanceDeLaFeuille } from './mineurs.ts';
import { aRegulariser, ecartRubriques, lignesRegularisation, rubriquesDeLaFeuille, type OptionsRegularisation } from './regularisation.ts';
import { heuresFeriees, MAJORATION_1ER_MAI, plafondComplementaires } from './majorations.ts';
import { employeAu, memeRegime, regimeFiche, segmentsContrat } from './historique-contrat.ts';
import { horairesDeLaFeuille } from './horaires.ts';
import { controlesReposNuit, veilleDe } from './repos-nuit.ts';
import { plagesInterventions } from './astreintes.ts';

/** Régime de temps de travail en vigueur d'une fiche, à figer sur une feuille soumise. */
export function contratFige(e: Employe): ContratFige {
  return regimeFiche(e);
}
/**
 * Le collaborateur tel qu'il était la semaine de la feuille : régime figé s'il existe ; sinon, avec l'historique des
 * contrats (`d`), celui en vigueur le lundi de la semaine (shared/rules/historique-contrat.ts) ; à défaut, la fiche.
 */
export function employeDeLaFeuille(e: Employe, sh: { contrat?: ContratFige | null; week?: ISODate } | null, d?: Pick<Domain, 'ds'>): Employe {
  if (sh?.contrat) return { ...e, ...sh.contrat };
  return d && sh?.week ? employeAu(d, e, sh.week) : e;
}

export interface SheetCalc {
  /** Heures par jour, du lundi (0) au dimanche (6), toutes lignes cumulées. */
  perDay: number[]; total: number; warn: string[];
  /**
   * Durées maximales dépassées (plus de 10 h sur une journée ou de 48 h dans la semaine ; plus de 13 h pour un forfait
   * jours ; plus de 8 h ou de 35 h pour un salarié mineur) ou heures complémentaires au-delà du plafond (le dixième, le
   * tiers avec un accord : shared/rules/majorations.ts) : sous-ensemble de `warn`. La soumission, et la validation,
   * exigent alors un motif (`motifDepassement`).
   */
  depassements: string[];
  /**
   * Repos hebdomadaire (shared/rules/semaine.ts) : 7 jours travaillés, heures le dimanche sans dérogation de l'équipe.
   * Sous-ensemble de `warn`, en alerte seulement : ni la soumission ni la validation n'en dépendent.
   */
  repos: string[];
  /**
   * Salarié de moins de 18 ans (shared/rules/mineurs.ts) : dépassements de 8 h par jour ou de 35 h par semaine, déjà
   * comptés dans `depassements` (motif ou référence de la dérogation de l'inspection du travail).
   */
  depassementsMineur: string[];
  /** Heures du dimanche (rubrique HDIM) et majoration en % (figée à la validation, sinon le réglage) : rubrique MAJ_DIM. */
  dimanche: number; majDimanche: number;
  /**
   * Heures travaillées le 1er mai (majorées de 100 % : rubrique MAJ_1MAI) et un autre jour férié (FERIE_TRAV, majorées de
   * `majFerie` % : MAJ_FERIE), déjà comprises dans les précédentes (shared/rules/majorations.ts). Fériés repérés d'après la
   * semaine de la feuille (`week`) : sans elle, aucun.
   */
  mai1: number; ferie: number; majFerie: number;
  /**
   * Horaires de poste (shared/rules/repos-nuit.ts) : heures de nuit de la semaine (rubrique HNUIT) et leur majoration en %
   * (figée à la validation, sinon le réglage : MAJ_NUIT) ; repos quotidien et pause insuffisants (alertes à motiver, déjà
   * dans `depassements`) ; travail de nuit d'un salarié mineur (refus à la soumission et à la validation, dans `warn`).
   * Rien un jour sans horaire.
   */
  nuit: number; nuitParJour: number[]; majNuit: number; reposQuotidien: string[]; nuitMineur: string[];
  /** Heures payées au taux normal (dans la limite de 35 h). */
  normal: number;
  /** Heures supplémentaires structurelles incluses dans un forfait hebdomadaire (total, dont +25 % et +50 %). */
  incluses: number; incluses25: number; incluses50: number;
  sup25: number; sup50: number; hc10: number; hc25: number;
  /** Repos compensateur acquis (heures supplémentaires majorées) : en mode « repos » (ou « historique ») seulement, hors intérim. */
  recup: number; jours: number;
  /** Mode des heures supplémentaires : figé sur la feuille à sa validation, sinon le réglage en vigueur. */
  modeHS: ModeHeuresSupFige;
  c: ReturnType<Domain['contratOf']>;
}

/**
 * Décompte hebdomadaire, sur la semaine civile du lundi au dimanche (art. L3121-35 : les heures du samedi et du dimanche
 * prennent leur rang avec les autres), selon l'organisation du temps de travail en vigueur la semaine de la feuille
 * (régime figé à la soumission, sinon celui de la fiche) :
 * - 35 h, 39 h + RTT, forfait hebdomadaire : heures supplémentaires au-delà du seuil
 *   (+25 % de la 36e à la 43e heure, +50 % au-delà), payées ou remplacées par un repos compensateur équivalent selon
 *   le mode figé à la validation (`modeHS` ; « historique » : les deux, calcul d'avant le choix du mode) ;
 * - temps partiel : heures complémentaires (+10 % jusqu'au dixième de la durée, +25 % au-delà), au plus le dixième de la
 *   durée (le tiers avec un accord) sans motif ;
 * - forfait jours et cadre dirigeant : décompte en jours, pas d'heures supplémentaires ;
 * - forfait annuel en heures : pas de décompte hebdomadaire (cumul annuel, voir `cumulAnnuel`).
 * Heures d'un jour férié (1er mai compris) : du travail effectif, comptées dans la semaine, repérées à part pour leur
 * majoration (`mai1`, `ferie`).
 */
export function calcSheet(d: Domain, e: Employe, sh: FeuilleCalcul | null): SheetCalc {
  // Mémorisé par salarié (lot 10, chantier B : validation groupée, `Domain.memoSalarie`), sous la feuille et la fiche :
  // le décompte ne lit, de l'instantané, que des données communes (réglages, référentiels, dérogations de l'équipe) et
  // celles du salarié `e` (historique de ses contrats, ses interventions d'astreinte, sa feuille de la semaine précédente
  // par `veilleDe`), jamais les feuilles d'un autre.
  return sh ? d.memoSalarie(e.id, DECOMPTE, sh, e, () => decompter(d, e, sh)) : decompter(d, e, null);
}
/** Mémo du décompte d'une feuille (`calcSheet`). */
const DECOMPTE: MemoTable = Symbol('décompte d’une feuille');
/** Mémo des feuilles d'un salarié (`feuillesCherchees`). */
const FEUILLES_DU_SALARIE: MemoTable = Symbol('feuilles d’un salarié');

/**
 * Feuilles où chercher celle de la semaine précédente (`veilleDe`) : avec des mémos par salarié, les seules du salarié,
 * extraites une fois par liste de feuilles (une feuille validée remplacée fait une liste neuve : l'index de toutes les
 * feuilles serait refait à chaque feuille d'une validation groupée) ; sinon toutes, comme avant.
 */
const feuillesCherchees = (d: Domain, empId: number): readonly FeuilleTemps[] => (d.memoParSalarie
  ? d.memoSalarie(empId, FEUILLES_DU_SALARIE, d.ds.feuilles, d.ds.feuilles, () => d.ds.feuilles.filter(f => f.empId === empId))
  : d.ds.feuilles);

function decompter(d: Domain, e: Employe, sh: FeuilleCalcul | null): SheetCalc {
  const c = d.contratOf(employeDeLaFeuille(e, sh, d));
  // Une ligne de 5 valeurs (enregistrée avant la semaine à 7 jours) se lit avec un samedi et un dimanche vides.
  const perDay = Array.from({ length: JOURS_FEUILLE }, (_, i) => (sh ? sh.lignes : []).reduce((n, l) => n + num(l.h[i]), 0));
  const total = perDay.reduce((a, b) => a + b, 0);
  const depassements: string[] = [];
  if (c.forfait) {
    // Forfait jours : durées maximales exclues (art. L3121-62) ; seuls les repos quotidien et hebdomadaire s'appliquent.
    if (perDay.some(h => h > 13)) depassements.push('Plus de 13 h sur une journée : repos quotidien de 11 h non respecté (art. L3131-1)');
  } else if (!c.dirigeant) {
    if (perDay.some(h => h > 10)) depassements.push('Plus de 10 h sur une journée (art. L3121-18)');
    if (total > 48) depassements.push('Plus de 48 h dans la semaine (art. L3121-20)');
  }
  // Salarié de moins de 18 ans, les jours où il l'est : 8 h par jour, 35 h par semaine, deux jours de repos consécutifs.
  const jeune = controlesMineur(naissanceDeLaFeuille(e, sh), sh?.week, perDay);
  depassements.push(...jeune.depassements);
  // Horaires de poste du jour (shared/rules/repos-nuit.ts) : repos quotidien et pause, à motiver ; nuit d'un mineur, refusée.
  const rn = controlesReposNuit(horairesDeLaFeuille(d.ds.referentiels, e.equipe, sh ? { statut: sh.statut ?? (sh.horairesFiges ? 'validee' : 'brouillon'), horaires: sh.horaires, horairesFiges: sh.horairesFiges } : null, perDay).map(j => j.horaire),
    perDay, sh?.week, {
      s: d.ds.settings, naissance: naissanceDeLaFeuille(e, sh), veille: sh?.week ? veilleDe(d.ds, e, sh.week, feuillesCherchees(d, e.id)) : null, exclu: c.dirigeant,
      // Interventions d'astreinte (t049) : plages exactes, repos dû en entier après leur fin (shared/rules/astreintes.ts).
      interventions: plagesInterventions(d.ds.interventionsAstreinte, e.id, sh?.week),
    });
  const reposQuotidien = [...rn.repos, ...rn.pauses];
  depassements.push(...reposQuotidien);
  // Heures complémentaires au-delà du plafond (le dixième, le tiers avec un accord) : dépassement, motif exigé.
  const plafond = plafondComplementaires(d.ds.settings);
  if (c.partiel && total - c.base > c.base / plafond.diviseur + 1e-9) {
    depassements.push(`Heures complémentaires au-delà du ${plafond.label} de la durée contractuelle (${fH(c.base / plafond.diviseur)} au plus, ${plafond.article})`);
  }
  // Repos hebdomadaire et dominical : alertes, sauf pour un cadre dirigeant (art. L3111-2).
  const repos = [...(c.dirigeant ? [] : alertesRepos(perDay, derogationDe(d.ds, e))), ...jeune.repos];
  const warn = [...rn.nuitMineur, ...depassements, ...repos];
  const modeHS = modeHeuresSup(sh, d.ds.settings);
  const majDimanche = sh?.majDimanche ?? d.ds.settings?.majorationDimanche ?? 0;
  const { mai1, ferie } = heuresFeriees(sh?.week, perDay);
  const majFerie = sh?.majFerie ?? d.ds.settings?.tauxMajorationFerie ?? 0;
  const majNuit = sh?.majNuit ?? d.ds.settings?.nuitMajoration ?? 0;
  const r: SheetCalc = { perDay, total, c, warn, depassements, repos, depassementsMineur: jeune.depassements, dimanche: perDay[DIMANCHE], majDimanche, mai1, ferie, majFerie,
    nuit: rn.nuit, nuitParJour: rn.nuitParJour, majNuit, reposQuotidien, nuitMineur: rn.nuitMineur, normal: total, incluses: 0, incluses25: 0, incluses50: 0, sup25: 0, sup50: 0, hc10: 0, hc25: 0, recup: 0, jours: 0, modeHS };
  const jours = perDay.reduce((n, h) => n + (h === 0 ? 0 : h <= 4 ? 0.5 : 1), 0);
  if (c.forfait || c.dirigeant || c.annuel) r.jours = jours;
  else if (c.partiel) {
    const hc = Math.max(0, total - c.base);
    r.hc10 = Math.min(hc, c.base / 10);
    r.hc25 = hc - r.hc10;
    r.normal = total - hc;
    if (total >= 35) warn.push('Temps partiel porté à 35 h ou plus');
  } else {
    const seuil = c.seuil ?? 35;
    const sup = Math.max(0, total - seuil);
    // Les taux dépendent du rang de l'heure dans la semaine : +25 % jusqu'à 43 h, +50 % au-delà.
    r.sup25 = Math.max(0, Math.min(total, 43) - Math.max(seuil, 35));
    r.sup25 = Math.min(sup, r.sup25);
    r.sup50 = sup - r.sup25;
    if (c.hebdo) {
      r.normal = Math.min(total, 35);
      r.incluses25 = Math.max(0, Math.min(total, seuil, 43) - 35);
      r.incluses50 = Math.max(0, Math.min(total, seuil) - 43);
      r.incluses = r.incluses25 + r.incluses50;
    } else r.normal = total - sup;
    // Repos de remplacement : heures et majoration (art. L3121-33) ; payées, les heures supplémentaires n'en donnent pas.
    r.recup = c.interim || modeHS === 'paiement' ? 0 : r.sup25 * 1.25 + r.sup50 * 1.5;
  }
  return r;
}

/**
 * Feuille telle que la décompte `calcSheet` : lignes, et ce qui est figé à la soumission (régime) ou à la validation (mode
 * des heures supplémentaires, majorations, contrepartie en repos) ; `week` repère les jours fériés.
 */
export type FeuilleCalcul = Pick<FeuilleTemps, 'lignes'> & Partial<Pick<FeuilleTemps, 'week' | 'contrat' | 'heuresSup' | 'majDimanche' | 'majFerie' | 'cor' | 'mineur'
  | 'statut' | 'horaires' | 'horairesFiges' | 'majNuit' | 'moins16'>>;

/** Contrepartie obligatoire en repos figée sur une feuille, toutes années confondues (heures). */
export const corDeLaFeuille = (sh: Pick<FeuilleTemps, 'cor'> | null | undefined): number =>
  Object.values(sh?.cor ?? {}).reduce((n, h) => n + num(h), 0);

/** Durée maximale d'une journée, toutes lignes de la feuille cumulées : au-delà, la saisie est refusée. */
export const HEURES_JOUR_MAX = 24;

/** Jours (0 = lundi … 6 = dimanche) dont le total, toutes lignes cumulées, dépasse 24 h. */
export const joursAuDela24 = (lignes: Pick<LigneTemps, 'h'>[]): number[] =>
  Array.from({ length: JOURS_FEUILLE }, (_, i) => i).filter(i => lignes.reduce((n, l) => n + num(l.h[i]), 0) > HEURES_JOUR_MAX);

/**
 * Forfait annuel en heures : cumul des feuilles validées de l'année, cible proratisée selon la présence
 * (entrée, fin de contrat) et part de la cible correspondant à la période déjà écoulée. Une semaine à cheval
 * sur deux années est ventilée jour par jour : le lundi 29 décembre compte pour l'année qui s'achève.
 */
export function cumulAnnuel(d: Domain, e: Employe, year = d.year) {
  const c = d.contratOf(e);
  const annee = String(year);
  const done = d.ds.feuilles
    .filter(sh => sh.empId === e.id && sh.statut === 'validee' && joursSemaine(sh.week).some(day => day.startsWith(annee)))
    .reduce((n, sh) => {
      const perDay = calcSheet(d, e, sh).perDay;
      return n + joursSemaine(sh.week).reduce((m, day, i) => m + (day.startsWith(annee) ? perDay[i] : 0), 0);
    }, 0);
  const start = new Date(year, 0, 1).getTime(), end = new Date(year + 1, 0, 1).getTime();
  const debut = Math.max(start, parse(e.entree).getTime());
  const fin = e.fin ? Math.min(end, parse(e.fin).getTime() + 864e5) : end;
  const presence = Math.max(0, fin - debut) / (end - start);
  // Historique des contrats (t074) : cible au prorata des périodes de l'année sous un forfait annuel, chacune avec sa durée
  // (une période de régime inconnu, antérieure à l'historique, compte avec celui de la fiche, comme avant). Un seul
  // régime connu sur l'année : la cible de la fiche, inchangée.
  const fiche = regimeFiche(e);
  const segs = segmentsContrat(d, e).filter((s, i, l) => s.du <= `${year}-12-31` && (l[i + 1]?.du ?? '9999-12-31') > `${year}-01-01`);
  const cible = segs.every(s => !s.regime || memeRegime(s.regime, fiche))
    ? Math.round(c.heuresAnnuelles * presence)
    : Math.round(segs.reduce((n, s, i) => {
      const du = Math.max(debut, parse(s.du).getTime()), au = Math.min(fin, segs[i + 1] ? parse(segs[i + 1].du).getTime() : end);
      const k = d.contratOf(s.regime ? { ...e, ...s.regime } : e);
      return n + (k.annuel && au > du ? k.heuresAnnuelles * (au - du) / (end - start) : 0);
    }, 0));
  const ecoule = fin > debut ? Math.min(1, Math.max(0, (d.today.getTime() - debut) / (fin - debut))) : 1;
  return { done, cible, prorata: cible * ecoule, depasse: done > cible, annee: year };
}

/** Absence vue par la feuille de temps : une absence validée ou signalée, ou sur le point de l'être. */
export type AbsenceJour = Pick<Absence, 'empId' | 'type' | 'du' | 'au'> & Partial<Pick<Absence, 'statut' | 'debutDemi' | 'finDemi'>>;

/**
 * Absence en vigueur couvrant chaque jour de la semaine `w`, du lundi au dimanche ; null les autres jours :
 * congé validé (CP, RTT / repos, récupération), absence hors congés qualifiée (arrêt, maternité, événement familial…)
 * ou signalée en attendant sa qualification. Aucune heure ne peut être saisie ces jours-là (double paiement sinon).
 * Source unique pour la saisie, la proposition Keystone, la soumission, la validation et la grille.
 * `absences` remplace les absences en vigueur pour contrôler une absence avant de la poser ou de la valider,
 * ou pour repérer les demandes en attente (`demandesAbsence`).
 * Demi-journée de congé (shared/rules/demi-journees.ts) : le jour n'est couvert que si ses deux moitiés le sont (CP le
 * matin, RTT l'après-midi) ; sinon il est rendu par `demiJoursAbsence`, et une demi-journée de travail y reste saisissable.
 */
export function joursAbsence(d: Domain, empId: number, w: ISODate, absences: AbsenceJour[] = absencesBloquantes(d, empId)): (AbsenceJour | null)[] {
  return joursSemaine(w).map(day => {
    const ce = absences.filter(a => a.empId === empId && a.du <= day && a.au >= day);
    const m = ce.map(a => moities(a, day));
    return m.some(x => x.matin) && m.some(x => x.apres_midi) ? ce.find((_, i) => m[i].matin && m[i].apres_midi) ?? ce[0] : null;
  });
}

/** Mémo des absences en vigueur d'un salarié (`absencesBloquantes`). */
const ABSENCES_DU_SALARIE: MemoTable = Symbol('absences en vigueur d’un salarié');

/**
 * Absences en vigueur où chercher celles du salarié `empId` (`joursAbsence`, `demiJoursAbsence`, qui ne retiennent que les
 * siennes, dans le même ordre) : avec des mémos par salarié (lot 10, chantier B), les seules siennes, extraites une fois par
 * liste d'absences ; sinon toutes, comme avant.
 */
const absencesBloquantes = (d: Domain, empId: number): AbsenceJour[] => (d.memoParSalarie
  ? d.memoSalarie(empId, ABSENCES_DU_SALARIE, d.ds.absences, d.ds.absences, () => d.ds.absences.filter(a => a.empId === empId && absenceBloque(a)))
  : d.ds.absences.filter(absenceBloque));

/** Demi-journée d'absence d'un jour : l'absence, la moitié qu'elle occupe et la durée de travail admise ce jour-là. */
export interface DemiJourAbsence { absence: AbsenceJour; demi: DemiJournee; max: number }

/**
 * Jours de la semaine `w` couverts par une seule demi-journée d'absence (même source que `joursAbsence`) ; null les
 * autres jours. Ce jour-là, au plus une demi-journée de travail (`heuresDemiJournee`).
 */
export function demiJoursAbsence(d: Domain, empId: number, w: ISODate, absences: AbsenceJour[] = absencesBloquantes(d, empId)): (DemiJourAbsence | null)[] {
  const pleins = joursAbsence(d, empId, w, absences), e = d.emp(empId);
  const max = heuresDemiJournee(e ? d.dayH(e) : 7);
  return joursSemaine(w).map((day, i) => {
    if (pleins[i]) return null;
    const a = absences.find(x => x.empId === empId && x.du <= day && x.au >= day);
    if (!a) return null;
    const m = moities(a, day);
    return { absence: a, demi: m.matin ? 'matin' : 'apres_midi', max };
  });
}

/** Demandes d'absence en attente de décision : elles ne bloquent pas la saisie, mais la validation de la feuille. */
export const demandesAbsence = (d: Domain): AbsenceJour[] => d.ds.absences.filter(a => a.statut === 'demandee');

/**
 * Heures de la feuille qu'une demande en attente rendrait refusées si elle était acceptée : la demande est réunie aux
 * absences en vigueur (comme à la décision, `heuresAvantAbsence`), car une demi-journée demandée à côté d'une demi-journée
 * déjà validée fait un jour entier. Seuls les jours touchés par une demande sont retenus, portés par celle-ci.
 */
export function heuresSurDemandes(d: Domain, sh: Pick<FeuilleTemps, 'empId' | 'week' | 'lignes'>): HeuresSurAbsence[] {
  const demandes = demandesAbsence(d).filter(a => a.empId === sh.empId);
  if (!demandes.length) return [];
  return heuresSurAbsence(d, sh, [...demandes, ...d.ds.absences.filter(absenceBloque)]).flatMap(h => {
    const dem = demandes.find(a => a.du <= h.day && a.au >= h.day);
    return dem ? [{ ...h, absence: dem }] : [];
  });
}

/** `demi` et `max` : demi-journée d'absence, dont les heures dépassent la demi-journée de travail admise. */
export interface HeuresSurAbsence { di: number; day: ISODate; absence: AbsenceJour; demi?: DemiJournee; max?: number }

/**
 * Jours d'absence de la feuille qui portent encore des heures, à retirer avant soumission et validation ; jours d'une
 * demi-journée d'absence qui portent plus d'une demi-journée de travail, à ramener à `max`.
 */
export function heuresSurAbsence(d: Domain, sh: Pick<FeuilleTemps, 'empId' | 'week' | 'lignes'>, absences?: AbsenceJour[]): HeuresSurAbsence[] {
  const wd = joursSemaine(sh.week), demis = demiJoursAbsence(d, sh.empId, sh.week, absences);
  const jour = (di: number) => sh.lignes.reduce((n, l) => n + num(l.h[di]), 0);
  return joursAbsence(d, sh.empId, sh.week, absences).flatMap((absence, di): HeuresSurAbsence[] => {
    if (absence) return jour(di) > 0 ? [{ di, day: wd[di], absence }] : [];
    const x = demis[di];
    return x && jour(di) > x.max + 1e-9 ? [{ di, day: wd[di], absence: x.absence, demi: x.demi, max: x.max }] : [];
  });
}

/**
 * Nature d'une absence dans un message : « CP », « RTT », « CET », « récupération », « congé de maternité »…
 * Vide pour une absence à qualifier ou une nature médicale : un message ne la révèle jamais, quel que soit son lecteur.
 */
export const natureAbsence = (t: AbsenceType): string =>
  t === 'CP' || t === 'RTT' || t === 'CET' ? t : t === 'RECUP' ? 'récupération' : natureMedicale(t) ? '' : natureDef(t)?.court ?? '';
const entreParentheses = (a: AbsenceJour) => { const n = natureAbsence(a.type); return n ? ` (${n})` : ''; };
const jourCourt = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const liste = (items: string[]) => items.length > 1 ? `les ${items.slice(0, -1).join(', ')} et ${items.at(-1)}` : `le ${items[0]}`;

/** « Absence validée ce jour-là (CP) », « Absence signalée ce jour-là ». */
export const absenceCeJour = (a: AbsenceJour) => `Absence ${a.statut === 'signalee' ? 'signalée' : 'validée'} ce jour-là${entreParentheses(a)}`;

/** « le lun. 12 oct. », « les lun. 12 oct. et mar. 13 oct. ». */
export const joursTexte = (days: ISODate[]) => liste(days.map(jourCourt));

/** « le lun. 12 oct. (CP) », « les lun. 12 oct. et mar. 13 oct. (CP) », « les lun. 12 oct. (CP) et ven. 16 oct. (RTT) ». */
export function joursAbsenceTexte(list: { day: ISODate; absence: AbsenceJour }[]): string {
  const natures = [...new Set(list.map(x => entreParentheses(x.absence)))];
  return natures.length === 1
    ? `${joursTexte(list.map(x => x.day))}${natures[0]}`
    : liste(list.map(x => `${jourCourt(x.day)}${entreParentheses(x.absence)}`));
}

/**
 * Refus de soumission ou de validation : jours concernés et marche à suivre (`suite` : « avant de soumettre la feuille »…).
 * Demi-journée d'absence : heures à ramener à une demi-journée de travail.
 */
export function heuresSurAbsenceMessage(list: HeuresSurAbsence[], suite: string): string {
  const pleins = list.filter(x => !x.demi), demis = list.filter(x => x.demi);
  const etats = new Set(pleins.map(x => x.absence.statut === 'signalee' ? 'signalée' : 'validée'));
  const textes = [
    pleins.length ? `Absence ${etats.size > 1 ? 'validée ou signalée' : [...etats][0]} ${joursAbsenceTexte(pleins)} : retirez les heures saisies ${pleins.length > 1 ? 'ces jours-là' : 'ce jour-là'}` : '',
    demis.length ? `${demiJourneeTexte(demis)} : ${fH(demis[0].max!)} de travail au plus ${demis.length > 1 ? 'ces jours-là' : 'ce jour-là'}, toutes lignes cumulées` : '',
  ].filter(Boolean);
  return `${textes.join(' ; ')} ${suite}`;
}

/**
 * Saisie d'un jour de demi-journée d'absence (`di` : 0 = lundi) portée à `total` heures, toutes lignes cumulées : refus
 * au-delà d'une demi-journée de travail, sinon null.
 */
export function demiJourneeRefus(d: Domain, sh: Pick<FeuilleTemps, 'empId' | 'week'>, di: number, total: number): string | null {
  const x = demiJoursAbsence(d, sh.empId, sh.week)[di];
  if (!x || total <= x.max + 1e-9) return null;
  return `${demiJourneeTexte([{ day: joursSemaine(sh.week)[di], ...x }])} : ${fH(x.max)} de travail au plus ce jour-là, toutes lignes cumulées (${fH(total)} saisies)`;
}

/** « Demi-journée d’absence le lun. 12 oct. (CP, matin) ». */
export function demiJourneeTexte(list: { day: ISODate; absence: AbsenceJour; demi?: DemiJournee }[]): string {
  const precision = (x: { absence: AbsenceJour; demi?: DemiJournee }) => {
    const n = natureAbsence(x.absence.type);
    return ` (${n ? `${n}, ` : ''}${x.demi ? DEMI_LABEL[x.demi] : ''})`;
  };
  return `${list.length > 1 ? 'Demi-journées' : 'Demi-journée'} d’absence ${liste(list.map(x => `${jourCourt(x.day)}${precision(x)}`))}`;
}

/**
 * Semaine sans heure attendue : chaque jour est férié, non travaillé (temps partiel, samedi et dimanche), hors contrat ou
 * couvert par une absence en vigueur, et au moins un jour du lundi au vendredi par une absence (semaine d'arrêt, de
 * congés…). La feuille se soumet alors sans heure.
 */
export function semaineCouverte(d: Domain, e: Employe, w: ISODate, sh: { contrat?: ContratFige | null } | null = null): boolean {
  const off = d.contratOf(employeDeLaFeuille(e, { contrat: sh?.contrat, week: w }, d)).jourOff, abs = joursAbsence(d, e.id, w);
  return abs.some((a, i) => !!a && !estWeekEnd(i))
    && joursSemaine(w).every((day, i) => estWeekEnd(i) || !!abs[i] || isFerie(day) || off.includes(i) || !!jourHorsContrat(e, day));
}

/**
 * Demande d'absence en attente sur des jours qui portent des heures : à décider avant de valider la feuille,
 * car une feuille validée n'est plus modifiable et l'absence ne pourrait alors plus être validée.
 * `valideur` : refus de validation et marche à suivre ; sinon, simple signalement dans la grille.
 */
export function demandesEnAttenteMessage(list: HeuresSurAbsence[], valideur = true): string {
  const plus = new Set(list.map(x => x.absence)).size > 1, jours = list.length > 1 ? 'ces jours-là' : 'ce jour-là';
  const debut = `${plus ? 'Demandes' : 'Demande'} d’absence en attente ${joursAbsenceTexte(list)}`;
  // Demi-journée seule : des heures restent admises, seul le dépassement d'une demi-journée de travail est en cause.
  const demi = list.every(x => x.demi), max = fH(list[0]?.max ?? 0);
  if (demi) return valideur
    ? `${debut} : ${plus ? 'décidez-les' : 'décidez-la'} avant de valider la feuille — pour ${plus ? 'les ' : 'l’'}accepter, ramenez d’abord les heures saisies ${jours} à ${max}`
    : `${debut} : plus de ${max} saisies ${jours}, à ramener à ${max} si ${plus ? 'elles sont acceptées' : 'elle est acceptée'}`;
  const mixte = list.some(x => x.demi);
  return valideur
    ? `${debut} : ${plus ? 'décidez-les' : 'décidez-la'} avant de valider la feuille — pour ${plus ? 'les ' : 'l’'}accepter, retirez d’abord les heures saisies ${jours}${mixte ? ` (ramenez-les à ${max} les jours de demi-journée)` : ''}`
    : `${debut} : des heures sont saisies ${jours}, à retirer${mixte ? ` (à ramener à ${max} les jours de demi-journée)` : ''} si ${plus ? 'elles sont acceptées' : 'elle est acceptée'}`;
}

/**
 * Tâches Keystone du salarié planifiées la semaine `w` : dates de la tâche et heures prévues du lundi au dimanche
 * (un chantier du week-end est proposé comme les autres jours). Un projet archivé dans Keystone ne reçoit plus
 * d'heures (temps.addLine) : ses tâches ne sont plus proposées.
 */
export function tachesDeLaSemaine(d: Domain, empId: number, w: ISODate): TacheKeystone[] {
  const wd = joursSemaine(w);
  const clos = new Set(d.ds.referentiels.projets.filter(p => p.statut === 'archive').map(p => p.code));
  return d.ds.taches.filter(t => t.empId === empId && !clos.has(t.projet) && t.debut <= wd[DIMANCHE] && t.fin >= w && wd.some(day => num(t.heures?.[day]) > 0));
}

/**
 * Lignes proposées à partir des tâches Keystone de la semaine : heures planifiées jour par jour
 * (fériés, absences, jours non travaillés et hors contrat à zéro), puis les heures des sessions de formation.
 */
export function suggestLines(d: Domain, e: Employe, w: ISODate): LigneTemps[] {
  const wd = joursSemaine(w), off = d.contratOf(e).jourOff, abs = joursAbsence(d, e.id, w);
  const lignes = [...tachesDeLaSemaine(d, e.id, w).map(t => ({
    projet: t.projet, tache: t.tache, ks: true,
    h: wd.map((day, i) => isFerie(day) || abs[i] || off.includes(i) || jourHorsContrat(e, day) ? 0 : num(t.heures[day])),
  })),
  // Heures des sessions de formation (ligne interne INT-FORM, jamais envoyée à Keystone) : shared/rules/formations-temps.ts.
  ...lignesFormation(d, e, w, abs, off)];
  return plafonnerDemiJournees(d, e, w, lignes);
}

/** Heures proposées un jour de demi-journée d'absence : ramenées à une demi-journée de travail, lignes dans l'ordre. */
function plafonnerDemiJournees(d: Domain, e: Employe, w: ISODate, lignes: LigneTemps[]): LigneTemps[] {
  demiJoursAbsence(d, e.id, w).forEach((x, i) => {
    if (!x) return;
    let reste = x.max;
    for (const l of lignes) { const h = Math.min(num(l.h[i]), reste); reste -= h; l.h[i] = Math.round(h * 100) / 100; }
  });
  return lignes;
}

/**
 * Rubriques de paie d'une feuille (codes internes, RUBRIQUES_PAIE de shared/constants.ts). Heures supplémentaires selon
 * le mode : payées (HS25, HS50), remplacées par un repos (RCR_ACQUIS seul) ou, feuille d'avant le choix du mode, les deux.
 * Les heures incluses à un forfait hebdomadaire (HSF25, HSF50) restent payées. Heures du dimanche, déjà comprises dans
 * les précédentes, en quantité (HDIM) pour la paie, et leur majoration si le réglage en prévoit une (MAJ_DIM, heures
 * équivalentes : 4 h à 50 % donnent 2 h) ; un forfait jours n'en a pas (décompte en jours). Jours fériés de même
 * (shared/rules/majorations.ts) : 1er mai majoré de 100 % (MAJ_1MAI, heures équivalentes), autres fériés en quantité
 * (FERIE_TRAV) et leur majoration réglée (MAJ_FERIE). Contrepartie obligatoire en repos figée à la validation (COR_ACQUIS).
 * Heures de nuit d'après les horaires de poste (shared/rules/repos-nuit.ts) : quantité (HNUIT) et majoration réglée
 * (MAJ_NUIT, heures équivalentes), figée à la validation ; rubriques inactives par défaut, « à saisir dans Sage ».
 */
export function sageRubriques(d: Domain, e: Employe, sh: FeuilleCalcul): Record<string, number> {
  const c = calcSheet(d, e, sh);
  if (c.c.forfait) return { JTRAV: c.jours };
  const cor = corDeLaFeuille(sh);
  // Quantités et majorations portées en plus des heures (dimanche, fériés) et contrepartie en repos.
  const annexes = {
    ...(c.dimanche ? { HDIM: r1(c.dimanche) } : {}),
    ...(c.dimanche && c.majDimanche ? { MAJ_DIM: r1(c.dimanche * c.majDimanche / 100) } : {}),
    ...(c.mai1 ? { MAJ_1MAI: r1(c.mai1 * MAJORATION_1ER_MAI / 100) } : {}),
    ...(c.ferie ? { FERIE_TRAV: r1(c.ferie) } : {}),
    ...(c.ferie && c.majFerie ? { MAJ_FERIE: r1(c.ferie * c.majFerie / 100) } : {}),
    ...(cor ? { COR_ACQUIS: r1(cor) } : {}),
    ...(c.nuit ? { HNUIT: r1(c.nuit) } : {}),
    ...(c.nuit && c.majNuit ? { MAJ_NUIT: r1(c.nuit * c.majNuit / 100) } : {}),
  };
  if (c.c.annuel) return { HN: r1(c.total), ...annexes };
  const payees = c.modeHS !== 'repos' || c.c.interim;
  return {
    HN: r1(c.normal),
    ...(c.incluses25 ? { HSF25: r1(c.incluses25) } : {}),
    ...(c.incluses50 ? { HSF50: r1(c.incluses50) } : {}),
    ...(payees && c.sup25 ? { HS25: r1(c.sup25) } : {}),
    ...(payees && c.sup50 ? { HS50: r1(c.sup50) } : {}),
    ...(c.hc10 ? { HC10: r1(c.hc10) } : {}),
    ...(c.hc25 ? { HC25: r1(c.hc25) } : {}),
    ...(c.recup ? { RCR_ACQUIS: r1(c.recup) } : {}),
    ...annexes,
  };
}


/** Variables d'une feuille dans une période de paie (codes internes) ; `origine` : période close, d'où le rappel. */
export interface RubriquesPeriode { periode: string; origine: string | null; rubriques: Record<string, number> }

/**
 * Rubriques d'une feuille par période de paie (shared/rules/paie.ts) : une seule part, sauf une semaine à cheval sur deux
 * mois ventilée jour par jour. Chaque part reçoit le décompte cumulé jusqu'à son dernier jour, moins celui des parts
 * précédentes : les heures gardent leur rang dans la semaine (les heures supplémentaires sont les dernières) et les
 * parts s'additionnent exactement au décompte de la semaine. La contrepartie obligatoire en repos, figée sur la feuille
 * entière, va sur la dernière part, avec les heures supplémentaires qui la font naître.
 */
export function rubriquesParPeriode(d: Domain, e: Employe, sh: FeuilleTemps): RubriquesPeriode[] {
  const parts = periodesSemaine(sh.week, d.ds.settings, d.ti);
  if (parts.length === 1) return [{ periode: parts[0].periode, origine: parts[0].origine, rubriques: sageRubriques(d, e, sh) }];
  let avant: Record<string, number> = {};
  return parts.map((p, n) => {
    const dernier = Math.max(...p.jours), derniere = n === parts.length - 1;
    const cumul = sageRubriques(d, e, { ...sh, cor: derniere ? sh.cor : null, lignes: sh.lignes.map(l => ({ ...l, h: l.h.map((v, i) => (i <= dernier ? v : 0)) })) });
    const rubriques = Object.fromEntries(Object.entries(cumul).map(([k, v]) => [k, r1(v - (avant[k] ?? 0))]));
    avant = cumul;
    return { periode: p.periode, origine: p.origine, rubriques };
  });
}

/**
 * Feuilles validées, ni transmises ni réservées par un lot de paie actif (un lot annulé les libère : `lotId` vidé), hors
 * intérimaires (relevé envoyé à l'agence) et cadres dirigeants. Une feuille rouverte après sa transmission puis
 * revalidée y revient, « à régulariser » (shared/rules/regularisation.ts) : seul son écart partira.
 */
export function sagePending(d: Domain): FeuilleTemps[] {
  return d.ds.feuilles.filter(sh => {
    const e = d.emp(sh.empId);
    if (!e || sh.statut !== 'validee' || sh.sage || sh.lotId) return false;
    const c = d.contratOf(employeDeLaFeuille(e, sh, d));
    return !c.interim && !c.dirigeant;
  });
}

/**
 * Variables de paie transmises à Sage : une ligne par feuille et par période de paie (rappel d'une période close avec
 * `periode_origine`), rubriques traduites en codes Sage (désactivées retirées, quantités nulles omises ; une ligne sans
 * quantité n'est pas émise). Semaine ISO : son année est celle du jeudi (la semaine du 29 décembre 2025 est
 * « 2026-S01 ») ; `envoye_le` : heure réelle de l'envoi, à l'heure de Paris (décalage d'hiver ou d'été). Contenu du
 * fichier d'import, sans adresse d'envoi : pas d'envoi à Sage par API.
 */
export function buildSagePayload(
  d: Domain, sheets: FeuilleTemps[], dossier: string, maintenant = new Date(), mode: SageMode = 'simulation',
  regularisation: Omit<OptionsRegularisation, 'semaine'> = { mode: 'ecart' },
): SagePush {
  const table = rubriquesPaie(d.ds.rubriquesPaie);
  const semaine = (week: ISODate) => `${isoWeekYear(week)}-S${String(isoWeek(week)).padStart(2, '0')}`;
  // Feuille rouverte après sa transmission (t131, shared/rules/regularisation.ts) : seul l'écart part (lot correctif).
  const correctifs = sheets.filter(aRegulariser);
  const parts = sheets.filter(sh => !aRegulariser(sh)).map(sh => ({ sh, parts: rubriquesParPeriode(d, d.emp(sh.empId)!, sh) }));
  // Matricule du dossier de paie ; à défaut (simulation seulement : une transmission réelle le refuse), le matricule Cursus.
  const lignes = [...parts.flatMap(({ sh, parts }) => parts.map(p => ({
    matricule: matriculeAffiche(d.emp(sh.empId) ?? { id: sh.empId, matriculePaie: null }),
    semaine: semaine(sh.week),
    periode: p.periode,
    ...(p.origine ? { periode_origine: p.origine } : {}),
    rubriques: traduireRubriques(p.rubriques, table),
  }))), ...lignesRegularisation(d, correctifs, { ...regularisation, semaine })].filter(l => Object.keys(l.rubriques).length > 0);
  // Heures de nuit sous une rubrique désactivée : absentes du fichier, listées « à saisir dans Sage » (règle commune du lot 6,
  // shared/rules/elements-lot.ts).
  const aSaisir: ElementASaisir[] = parts.flatMap(({ sh, parts }) => parts.flatMap(p => RUBRIQUES_NUIT.flatMap(k => {
    const q = p.rubriques[k], r = table.find(x => x.code === k);
    return q && r && !r.active
      ? [{ famille: 'nuit', empId: sh.empId, periode: p.periode, rubrique: k, quantite: q, detail: `Semaine ${semaine(sh.week)} · ${RUBRIQUES_PAIE[k].label.toLowerCase()}${p.origine ? ` · rappel de ${periodeLabel(p.origine)}` : ''}` }]
      : [];
  })));
  // Feuille régularisée : l'écart de ses heures de nuit avec celles déjà listées à sa transmission (`ReouvertureFeuille.aSaisir`),
  // positif ou négatif, sur la période d'origine si elle est ouverte, sinon sur la période ouverte (rappel). Rubrique activée
  // depuis : la quantité saisie à la main est à retirer, le fichier emporte la nouvelle.
  const ouverte = periodeOuverte(d.ti, d.ds.settings?.clotureJour ?? 0);
  aSaisir.push(...correctifs.flatMap(sh => Object.entries(ecartRubriques(nuitASaisirDeLaFeuille(d, sh), sh.reouverture?.aSaisir ?? {}))
    .sort(([a], [b]) => a.localeCompare(b)).flatMap(([origine, codes]) => RUBRIQUES_NUIT.filter(k => codes[k]).map((k): ElementASaisir => {
      const periode = origine >= ouverte ? origine : ouverte;
      return { famille: 'nuit', empId: sh.empId, periode, rubrique: k, quantite: codes[k],
        detail: `Semaine ${semaine(sh.week)} · ${RUBRIQUES_PAIE[k].label.toLowerCase()} · régularisation${periode !== origine ? ` · rappel de ${periodeLabel(origine)}` : ''}` };
    }))));
  return {
    dossier,
    mode,
    envoye_le: horodatageParis(maintenant),
    periodes: [...new Set(lignes.flatMap(l => (l.periode ? [l.periode] : [])))].sort(),
    lignes,
    // Rubriques de chaque feuille, telles qu'elles partent (régularisée : telle que revalidée), gardées pour une réouverture.
    // Heures de nuit listées à saisir dans Sage (cumul, telles que revalidées pour une feuille régularisée) : à part.
    rubriquesFeuilles: sheets.map(sh => {
      const nuit = nuitASaisirDeLaFeuille(d, sh);
      return { empId: sh.empId, week: sh.week, periodes: rubriquesDeLaFeuille(d, sh), ...(Object.keys(nuit).length ? { aSaisir: nuit } : {}) };
    }),
    ...(correctifs.length ? { regularisation: regularisation.mode } : {}),
    ...(aSaisir.length ? { aSaisir } : {}),
  };
}

/** Rubriques des heures de nuit (shared/rules/repos-nuit.ts) : « à saisir dans Sage » tant qu'elles sont désactivées. */
export const RUBRIQUES_NUIT = ['HNUIT', 'MAJ_NUIT'] as const;

/**
 * Heures de nuit d'une feuille sous une rubrique désactivée, en codes internes et par période d'origine : ce que la paie
 * saisit à la main dans Sage. Gardées par feuille dans le contenu du lot (`RubriquesFeuille.aSaisir`), puis à la
 * réouverture (`ReouvertureFeuille.aSaisir`), pour que la régularisation en liste l'écart.
 */
export function nuitASaisirDeLaFeuille(d: Domain, sh: FeuilleTemps): Record<string, Record<string, number>> {
  const e = d.emp(sh.empId);
  if (!e) return {};
  const table = rubriquesPaie(d.ds.rubriquesPaie), out: Record<string, Record<string, number>> = {};
  for (const p of rubriquesParPeriode(d, e, sh)) {
    for (const k of RUBRIQUES_NUIT) {
      const q = p.rubriques[k], r = table.find(x => x.code === k);
      if (!q || !r || r.active) continue;
      const x = (out[p.origine ?? p.periode] ??= {});
      x[k] = Math.round(((x[k] ?? 0) + q) * 100) / 100;
    }
  }
  return out;
}

/** Codes internes émis (quantité non nulle) par des feuilles : ceux dont la correspondance doit être confirmée. */
export function rubriquesEmises(d: Domain, sheets: FeuilleTemps[]): Set<string> {
  return new Set(sheets.flatMap(sh => rubriquesParPeriode(d, d.emp(sh.empId)!, sh).flatMap(p => Object.keys(p.rubriques).filter(k => p.rubriques[k]))));
}
