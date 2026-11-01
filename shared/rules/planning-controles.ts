// Contrôles légaux du planning d'équipe avant publication (lot 12, chantier C5, t192). Le planning n'est qu'une prévision :
// les contrôles des feuilles de temps (shared/rules/temps.ts, repos-nuit.ts) restent la vérité sur le réalisé. Ici, sur les
// créneaux planifiés d'un salarié, sur une fenêtre glissante qui déborde la période (le repos se calcule par-dessus les
// semaines ; la moyenne sur 12 semaines lit les 11 semaines qui précèdent), mémoïsée par salarié et par semaine. Tout est
// calculé, jamais stocké ; seuls les codes des alertes acceptées sont gardés sur le créneau à sa publication.
// - Heure de Paris : les plages sont comptées en temps réel (`instantParis`), changement d'heure compris. Un poste de nuit
//   de 21 h à 5 h dure 7 h la nuit du passage à l'heure d'été (dernier dimanche de mars) et 9 h la nuit du retour à l'heure
//   d'hiver (dernier dimanche d'octobre) ; les repos de 11 h et de 35 h se comptent de même. Les heures de nuit restent
//   comptées à l'horloge (plage 21 h – 6 h réglée), comme sur la feuille de temps.
// - Refus, sans motif possible : créneau hors du contrat (avant l'entrée, après la sortie), travail de nuit d'un salarié
//   mineur (`refusNuitMineur`, art. L3163-2) ; habilitation exigée absente, en attente, retirée, suspendue (prérequis
//   de formation échu compris) ou expirée avant la partie à venir de la période (réponse de l'entreprise du 1er novembre
//   2026 : publication bloquée).
// - Alertes qui exigent un motif à la publication : repos quotidien de 11 h (art. L3131-1 ; 12 h et 14 h pour un mineur,
//   art. L3164-1), ou la valeur réduite de l'accord en travail posté (`planningReposQuotidienAccord`, 9 h au moins, art.
//   D3131-1 et suivants, jamais pour un mineur) ; repos hebdomadaire de 35 h consécutives (art. L3132-2) ; 6 jours au plus
//   par semaine (art. L3132-1) ; dimanche sans dérogation de l'équipe (art. L3132-3) ; 10 h par jour (art. L3121-18) et 48 h
//   par semaine (art. L3121-20) ; travailleur de nuit, 8 h par poste de nuit (art. L3122-6, `planningNuitJour`) ; pause de
//   20 min dès 6 h (art. L3121-16, `controlesReposNuit`) ; habilitation expirant pendant la période, formation exigée non
//   valide à la date du créneau ; aptitude médicale à vérifier (réserve neutre, non datée, du jour : jamais projetée sur la
//   date du créneau, jamais journalisée, vue du planificateur seul).
// - Informations : repos réduit par l'accord (repos compensateur dû), moyenne de 44 h sur 12 semaines (art. L3121-22),
//   moyenne du travailleur de nuit sur 12 semaines (40 h, art. L3122-7, `planningNuitMoyenne`).
import { addD, joursSemaine, mondayOf, parse } from '../dates.ts';
import { certEnVigueur, type CertInfo, type HabInfo, type MedInfo, type PrereqCheck } from '../domain.ts';
import { fH, fmtIso } from '../format.ts';
import type { Employe, Exigences, HoraireFige, ISODate, Settings } from '../types.ts';
import { dureeHoraire, finitLeLendemain } from './horaires.ts';
import { jourHorsContrat } from './absences.ts';
import { mineurAu, moins16Au, type Naissance } from './mineurs.ts';
import { controlesReposNuit, heuresDeNuit, plageDuJour, reglagesNuit, refusNuitMineur, REPOS_QUOTIDIEN, REPOS_QUOTIDIEN_MINEUR, REPOS_QUOTIDIEN_MOINS_16 } from './repos-nuit.ts';
import { restrictionEnVigueur } from './sante.ts';

// — Réglages (valeurs supplétives de la loi, réglables avec la référence de l'accord) —

/** Délai de prévenance supplétif d'un changement d'horaire (art. L3121-47), et le plus court admis par accord (jours). */
export const DELAI_PREVENANCE_PLANNING = 7;
export const DELAI_PREVENANCE_PLANNING_MIN = 3;
/** Repos quotidien réduit par accord en travail posté : 9 h au moins (art. D3131-1 et suivants). */
export const REPOS_QUOTIDIEN_ACCORD_MIN = 9;
/** Travailleur de nuit : 8 h par poste (art. L3122-6, 12 h par accord), 40 h en moyenne sur 12 semaines (art. L3122-7, 44 h par accord). */
export const NUIT_JOUR_LEGAL = 8;
export const NUIT_JOUR_ACCORD_MAX = 12;
export const NUIT_MOYENNE_LEGALE = 40;
export const NUIT_MOYENNE_ACCORD_MAX = 44;
/** Repos hebdomadaire : 24 h plus les 11 h du repos quotidien (art. L3132-2). */
export const REPOS_HEBDOMADAIRE = 35;
/** Jours travaillés au plus par semaine (art. L3132-1). */
export const JOURS_SEMAINE_MAX = 6;
/** Durées maximales (art. L3121-18, L3121-20) et moyenne sur 12 semaines (art. L3121-22). */
export const DUREE_JOUR_MAX = 10;
export const DUREE_SEMAINE_MAX = 48;
export const MOYENNE_12_MAX = 44;
export const SEMAINES_MOYENNE = 12;
/** Fenêtre lue autour de la période : la semaine qui précède (repos) et les 11 d'avant (moyennes) ; la semaine qui suit. */
export const SEMAINES_AVANT = SEMAINES_MOYENNE - 1;
export const JOURS_APRES = 7;

export type ReglagesPlanning = Pick<Settings, 'planningDelaiPrevenance' | 'planningReposQuotidienAccord' | 'planningNuitJour' | 'planningNuitMoyenne' | 'planningAccord'>;

/** Réglages du planning, valeurs de la loi pour un instantané qui ne les aurait pas encore. */
export function reglagesPlanning(s: Partial<ReglagesPlanning> | undefined): ReglagesPlanning {
  const n = (v: unknown, d: number, min: number, max: number) => (Number.isFinite(v) && (v as number) >= min && (v as number) <= max ? v as number : d);
  return {
    planningDelaiPrevenance: n(s?.planningDelaiPrevenance, DELAI_PREVENANCE_PLANNING, DELAI_PREVENANCE_PLANNING_MIN, 60),
    planningReposQuotidienAccord: n(s?.planningReposQuotidienAccord, REPOS_QUOTIDIEN, REPOS_QUOTIDIEN_ACCORD_MIN, REPOS_QUOTIDIEN),
    planningNuitJour: n(s?.planningNuitJour, NUIT_JOUR_LEGAL, NUIT_JOUR_LEGAL, NUIT_JOUR_ACCORD_MAX),
    planningNuitMoyenne: n(s?.planningNuitMoyenne, NUIT_MOYENNE_LEGALE, NUIT_MOYENNE_LEGALE, NUIT_MOYENNE_ACCORD_MAX),
    planningAccord: s?.planningAccord ?? '',
  };
}

/** Valeur autre que celle de la loi : la référence de l'accord est exigée (COHERENCE de shared/reglages.ts). */
export const planningHorsLoi = (s: Partial<ReglagesPlanning>) => {
  const r = reglagesPlanning(s);
  return r.planningDelaiPrevenance < DELAI_PREVENANCE_PLANNING || r.planningReposQuotidienAccord < REPOS_QUOTIDIEN
    || r.planningNuitJour > NUIT_JOUR_LEGAL || r.planningNuitMoyenne > NUIT_MOYENNE_LEGALE;
};

// — Heure de Paris —

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Dernier dimanche du mois (0 = janvier) de l'année, en jours depuis l'époque Unix. */
function dernierDimanche(annee: number, mois: number): number {
  const fin = Date.UTC(annee, mois + 1, 0);
  return (fin - new Date(fin).getUTCDay() * 864e5) / 864e5;
}
/** Heure d'été à Paris, en minutes depuis l'époque (UTC) : du dernier dimanche de mars à 1 h UTC au dernier d'octobre à 1 h UTC. */
const ETE = new Map<number, [number, number]>();
function ete(annee: number): [number, number] {
  let x = ETE.get(annee);
  if (!x) ETE.set(annee, x = [dernierDimanche(annee, 2) * 1440 + 60, dernierDimanche(annee, 9) * 1440 + 60]);
  return x;
}

/**
 * Instant réel (minutes depuis l'époque, UTC) du jour `jour` à l'heure `hhmm` de Paris. Heure qui n'existe pas (entre 2 h et
 * 3 h la nuit du passage à l'heure d'été) : l'heure d'après le changement ; heure vécue deux fois (entre 2 h et 3 h la nuit
 * du retour à l'heure d'hiver) : la première.
 */
export function instantParis(jour: ISODate, hhmm: string): number {
  const y = Number(jour.slice(0, 4)), local = Date.UTC(y, Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10))) / 60_000 + minutes(hhmm);
  const [debut, fin] = ete(y), etePossible = local - 120;
  return etePossible >= debut && etePossible < fin ? etePossible : local - 60;
}

/** Plage réelle d'un poste : début et fin en minutes depuis l'époque (heure de Paris, changement d'heure compris). */
export interface PlageReelle { debut: number; fin: number; pause: number }
export function plageReelle(jour: ISODate, h: Pick<HoraireFige, 'debut' | 'fin' | 'pause'>): PlageReelle {
  return { debut: instantParis(jour, h.debut), fin: instantParis(finitLeLendemain(h) ? addD(jour, 1) : jour, h.fin), pause: h.pause };
}
/** Heures de travail réelles d'un poste (amplitude réelle moins la pause), au centième. */
export const heuresReelles = (p: PlageReelle) => Math.round(Math.max(0, p.fin - p.debut - p.pause) / 60 * 100) / 100;

// — Alertes —

/** Contrôle en cause, codé : seul ce code est gardé sur le créneau publié (le journal n'en note que le nombre). */
export type CodePlanning =
  | 'sortie' | 'nuit_mineur' | 'repos_quotidien' | 'repos_reduit' | 'repos_hebdo' | 'jours_semaine' | 'dimanche' | 'duree_jour' | 'duree_semaine'
  | 'nuit_jour' | 'pause' | 'moyenne_12' | 'nuit_moyenne' | 'habilitation' | 'habilitation_expire' | 'formation' | 'aptitude';
export type GravitePlanning = 'refus' | 'alerte' | 'info';
export const GRAVITE: Record<CodePlanning, GravitePlanning> = {
  sortie: 'refus', nuit_mineur: 'refus', habilitation: 'refus',
  repos_quotidien: 'alerte', repos_hebdo: 'alerte', jours_semaine: 'alerte', dimanche: 'alerte', duree_jour: 'alerte', duree_semaine: 'alerte',
  nuit_jour: 'alerte', pause: 'alerte', habilitation_expire: 'alerte', formation: 'alerte', aptitude: 'alerte',
  repos_reduit: 'info', moyenne_12: 'info', nuit_moyenne: 'info',
};
export const estCodePlanning = (v: unknown): v is CodePlanning => typeof v === 'string' && Object.hasOwn(GRAVITE, v);
/** Codes qui ne sortent jamais vers le journal ni hors du planificateur (aptitude : donnée de santé, même neutre). */
export const CODES_RESERVES: readonly CodePlanning[] = ['aptitude'];

/**
 * Alerte sur le planning d'un salarié : jour du créneau en cause, ou lundi de la semaine (`portee` « semaine » : elle vaut
 * pour tous ses créneaux de la semaine), ou toute la période (« periode » : réserve d'aptitude du jour).
 */
export interface AlertePlanning { empId: number; jour: ISODate; portee: 'jour' | 'semaine' | 'periode'; code: CodePlanning; gravite: GravitePlanning; texte: string }

const alerte = (empId: number, jour: ISODate, code: CodePlanning, texte: string, portee: AlertePlanning['portee'] = 'jour'): AlertePlanning =>
  ({ empId, jour, portee, code, gravite: GRAVITE[code], texte });

/** Alertes qui concernent le créneau du jour `jour` (les siennes, celles de sa semaine, celles de la période). */
export const alertesDuJour = (alertes: readonly AlertePlanning[], empId: number, jour: ISODate) =>
  alertes.filter(a => a.empId === empId && (a.portee === 'periode' || (a.portee === 'semaine' ? a.jour === mondayOf(jour) : a.jour === jour)));

// — Contrôles de la durée et du repos —

/** Jour planifié d'un salarié : son horaire (null : repos). Un jour absent de la liste n'est pas planifié. */
export interface JourPlanifie { jour: ISODate; horaire: HoraireFige | null }

export interface EntreeControles {
  employe: Pick<Employe, 'id' | 'nom' | 'entree' | 'fin' | 'typeContrat'> & Naissance;
  /** Jours planifiés connus (fenêtre de lecture : `SEMAINES_AVANT` semaines avant la période, `JOURS_APRES` jours après). */
  jours: readonly JourPlanifie[];
  /** Période contrôlée (bornes comprises). */
  du: ISODate; au: ISODate;
  reglages: Partial<Settings> | undefined;
  /** Dérogation au repos dominical de l'équipe (travail en continu, suppléance : shared/rules/semaine.ts). */
  derogationDominicale: boolean;
  /** Jours d'absence en vigueur (validée ou signalée) : ni travail, ni contrôle (la nature n'est jamais lue). */
  absents?: ReadonlySet<ISODate>;
  /** Travailleur de nuit d'après les feuilles validées (`statutNuit`) ; le planning lui-même peut aussi le faire. */
  travailleurNuit?: boolean;
  /** Durées maximales et moyennes non contrôlées (cadre dirigeant, forfait jours : art. L3111-2, L3121-62). */
  dureesExclues?: boolean;
}

/** Postes de travail d'un salarié, triés, avec leur plage réelle (absences retirées). */
interface Poste { jour: ISODate; h: HoraireFige; p: PlageReelle; heures: number }

/** Mémo des contrôles d'une semaine, par liste de jours planifiés (identité) : le même salarié contrôlé deux fois. */
const MEMO = new WeakMap<readonly JourPlanifie[], Map<string, AlertePlanning[]>>();

/**
 * Contrôles de la durée et du repos d'un salarié sur la période `du`–`au` (semaines civiles entières pour les alertes de
 * semaine). Les jours lus hors de la période servent au repos qui la traverse et aux moyennes ; seules les alertes de la
 * période sont rendues.
 */
export function controlesPlanning(x: EntreeControles): AlertePlanning[] {
  const s = reglagesPlanning(x.reglages), nuit = reglagesNuit(x.reglages);
  const cle = JSON.stringify([x.employe.id, x.employe.entree, x.employe.fin, x.employe.naissance, x.employe.naissanceLe ?? null, x.employe.mineur ?? null, x.employe.moins16 ?? null,
    s, nuit, x.derogationDominicale, [...(x.absents ?? [])].sort(), !!x.travailleurNuit, !!x.dureesExclues]);
  let memo = MEMO.get(x.jours);
  if (!memo) MEMO.set(x.jours, memo = new Map());
  const out: AlertePlanning[] = [];
  const e = x.employe;
  const postes: Poste[] = x.jours.filter(j => j.horaire && !x.absents?.has(j.jour))
    .map(j => { const p = plageReelle(j.jour, j.horaire!); return { jour: j.jour, h: j.horaire!, p, heures: heuresReelles(p) }; })
    .sort((a, b) => a.p.debut - b.p.debut);
  const dans = (jour: ISODate) => jour >= x.du && jour <= x.au;

  // Refus du jour : hors contrat, nuit d'un mineur.
  for (const q of postes.filter(q => dans(q.jour))) {
    const hors = jourHorsContrat(e, q.jour);
    if (hors) out.push(alerte(e.id, q.jour, 'sortie', `${fmtIso(q.jour)} : hors du contrat (${hors}) — aucun poste ce jour-là`));
    const mineur = refusNuitMineur(e, q.h, q.jour);
    if (mineur) out.push(alerte(e.id, q.jour, 'nuit_mineur', `${fmtIso(q.jour)} : ${mineur}`));
  }

  // Repos quotidien : de la fin du poste précédent (le plus tard fini) au début du suivant, en temps réel. Contrôlé avant
  // chaque poste de la période, et avant le premier poste qui la suit (déjà planifié ou publié) quand le poste qui le
  // précède est de la période : l'alerte est alors rattachée au jour de ce dernier, seul créneau que la publication ou
  // l'échange touche.
  let finMax: number | null = null, jourFinMax: ISODate | null = null;
  for (const q of postes) {
    const rattache = dans(q.jour) ? q.jour : jourFinMax && dans(jourFinMax) ? jourFinMax : null;
    if (finMax != null && rattache) {
      const repos = Math.round((q.p.debut - finMax) / 60 * 100) / 100;
      const mineur = mineurAu(e, q.jour), seuilMineur = moins16Au(e, q.jour) ? REPOS_QUOTIDIEN_MOINS_16 : REPOS_QUOTIDIEN_MINEUR;
      const seuil = mineur ? seuilMineur : s.planningReposQuotidienAccord;
      if (repos < seuil) {
        out.push(alerte(e.id, rattache, 'repos_quotidien', `${fmtIso(q.jour)} : ${repos > 0 ? fH(repos) : 'aucun repos'} avant la prise de poste, moins que le repos quotidien de ${mineur
          ? `${seuilMineur} h (salarié de moins de ${seuilMineur === REPOS_QUOTIDIEN_MOINS_16 ? 16 : 18} ans, art. L3164-1)`
          : seuil < REPOS_QUOTIDIEN ? `${seuil} h fixé par l’accord (art. D3131-1)` : `${REPOS_QUOTIDIEN} h (art. L3131-1)`}`));
      } else if (!mineur && repos < REPOS_QUOTIDIEN) {
        out.push(alerte(e.id, rattache, 'repos_reduit', `${fmtIso(q.jour)} : repos quotidien réduit à ${fH(repos)} par l’accord : un repos équivalent est dû en compensation (art. D3131-1 et suivants)`));
      }
    }
    if (finMax == null || q.p.fin > finMax) { finMax = q.p.fin; jourFinMax = q.jour; }
  }

  // Travailleur de nuit : d'après les feuilles, ou deux postes au moins avec le seuil quotidien de nuit dans une semaine de
  // la fenêtre (horaire habituel, art. L3122-5).
  const travailleurNuit = !!x.travailleurNuit || nuitHabituelle(postes, nuit);
  // Semaines civiles de la période, chacune contrôlée sur la fenêtre (mémo par salarié et par semaine).
  for (let w = mondayOf(x.du); w <= x.au; w = addD(w, 7)) {
    const cleSemaine = `${cle}|${w}|${x.du}|${x.au}`;
    let semaine = memo.get(cleSemaine);
    if (!semaine) memo.set(cleSemaine, semaine = controlesSemaine(x, postes, w, s, travailleurNuit));
    out.push(...semaine);
  }
  return out;
}

/** Alertes d'une semaine civile (lundi `w`) : repos hebdomadaire, jours, dimanche, durées, pause, nuit, moyennes. */
function controlesSemaine(x: EntreeControles, postes: readonly Poste[], w: ISODate, s: ReglagesPlanning, travailleurNuit: boolean): AlertePlanning[] {
  const out: AlertePlanning[] = [], e = x.employe;
  const jours = joursSemaine(w), dans = (jour: ISODate) => jour >= x.du && jour <= x.au;
  const siens = postes.filter(q => q.jour >= w && q.jour <= jours[6]);
  const debutSemaine = instantParis(w, '00:00'), finSemaine = instantParis(addD(w, 7), '00:00');

  // Repos hebdomadaire (art. L3132-2) : une interruption d'au moins 35 h consécutives, d'une fin de poste (la plus tardive
  // des postes qui précèdent) au début du suivant, dont 24 h au moins dans la semaine civile (le repos quotidien de 11 h
  // peut la déborder). Avant le premier poste connu ou après le dernier, l'interruption n'a pas de borne connue : seule sa
  // part dans la semaine compte.
  if (siens.length) {
    let meilleur = 0, finMax = -Infinity;
    for (const q of [...postes, null]) {
      const debutSuivant = q ? q.p.debut : Infinity;
      const dans = Math.min(debutSuivant, finSemaine) - Math.max(finMax, debutSemaine);
      if (debutSuivant > finMax && dans >= 24 * 60) meilleur = Math.max(meilleur, (debutSuivant - finMax) / 60);
      if (q && q.p.fin > finMax) finMax = q.p.fin;
    }
    if (meilleur < REPOS_HEBDOMADAIRE) {
      out.push(alerte(e.id, w, 'repos_hebdo', `Semaine du ${fmtIso(w)} : aucun repos de ${REPOS_HEBDOMADAIRE} h consécutives dont 24 h dans la semaine${meilleur > 0 ? ` (le plus long : ${fH(Math.round(meilleur * 100) / 100)})` : ''} ; art. L3132-2`, 'semaine'));
    }
  }

  // 6 jours au plus ; dimanche sans dérogation (poste qui commence le dimanche, ou qui y déborde).
  const travailles = new Set(siens.map(q => q.jour));
  if (travailles.size > JOURS_SEMAINE_MAX) out.push(alerte(e.id, w, 'jours_semaine', `Semaine du ${fmtIso(w)} : ${travailles.size} jours travaillés, ${JOURS_SEMAINE_MAX} au plus (art. L3132-1)`, 'semaine'));
  if (!x.derogationDominicale) {
    const dimanche = jours[6], debutDim = instantParis(dimanche, '00:00');
    for (const q of postes) {
      if (!dans(q.jour) || q.jour < addD(w, 5) || q.jour > dimanche) continue;
      if (q.p.fin > debutDim && q.p.debut < finSemaine) out.push(alerte(e.id, q.jour, 'dimanche', `${fmtIso(q.jour)} : travail le dimanche sans dérogation réglée pour l’équipe (repos dominical, art. L3132-3)`));
    }
  }

  // Pause et heures de nuit de chaque jour : contrôles de la feuille de temps (shared/rules/repos-nuit.ts), sur l'horaire
  // planifié et sa durée (sans le repos, compté ici en temps réel).
  const horairesSemaine = jours.map(j => siens.find(q => q.jour === j)?.h ?? null);
  const rn = controlesReposNuit(horairesSemaine, horairesSemaine.map(h => (h ? dureeHoraire(h) : 0)), w, { s: x.reglages, naissance: e, exclu: false });
  if (rn.codes.includes('pause')) {
    const premier = siens.find(q => dans(q.jour));
    if (premier) out.push(alerte(e.id, w, 'pause', `Semaine du ${fmtIso(w)} : ${rn.pauses.join(' ; ')}`, 'semaine'));
  }

  const nuitDe = (q: Poste) => { const i = jours.indexOf(q.jour); return i >= 0 ? rn.nuitParJour[i] : 0; };

  if (!x.dureesExclues) {
    for (const q of siens.filter(q => dans(q.jour))) {
      if (q.heures > DUREE_JOUR_MAX) out.push(alerte(e.id, q.jour, 'duree_jour', `${fmtIso(q.jour)} : ${fH(q.heures)} de travail, plus de ${DUREE_JOUR_MAX} h (art. L3121-18)`));
      if (travailleurNuit && nuitDe(q) > 0 && q.heures > s.planningNuitJour) {
        out.push(alerte(e.id, q.jour, 'nuit_jour', `${fmtIso(q.jour)} : poste de nuit de ${fH(q.heures)}, plus de ${s.planningNuitJour} h pour un travailleur de nuit (art. L3122-6${s.planningNuitJour > NUIT_JOUR_LEGAL ? ', valeur de l’accord' : ''})`));
      }
    }
    const total = Math.round(siens.reduce((n, q) => n + q.heures, 0) * 100) / 100;
    if (total > DUREE_SEMAINE_MAX) out.push(alerte(e.id, w, 'duree_semaine', `Semaine du ${fmtIso(w)} : ${fH(total)} planifiées, plus de ${DUREE_SEMAINE_MAX} h (art. L3121-20)`, 'semaine'));
    // Moyennes sur les 12 semaines qui finissent avec celle-ci, sur les semaines planifiées (un jour au moins, repos compris).
    const connues = new Set(x.jours.filter(j => !x.absents?.has(j.jour)).map(j => mondayOf(j.jour)));
    const semaines = Array.from({ length: SEMAINES_MOYENNE }, (_, i) => addD(w, -7 * i)).filter(v => connues.has(v));
    if (semaines.length) {
      const heures = (v: ISODate) => postes.filter(q => mondayOf(q.jour) === v).reduce((n, q) => n + q.heures, 0);
      const moyenne = Math.round(semaines.reduce((n, v) => n + heures(v), 0) / semaines.length * 100) / 100;
      if (moyenne > MOYENNE_12_MAX) out.push(alerte(e.id, w, 'moyenne_12', `Semaine du ${fmtIso(w)} : ${fH(moyenne)} en moyenne sur ${semaines.length} semaine${semaines.length > 1 ? 's' : ''} planifiée${semaines.length > 1 ? 's' : ''}, plus de ${MOYENNE_12_MAX} h sur 12 semaines (art. L3121-22)`, 'semaine'));
      if (travailleurNuit && moyenne > s.planningNuitMoyenne) {
        out.push(alerte(e.id, w, 'nuit_moyenne', `Semaine du ${fmtIso(w)} : ${fH(moyenne)} en moyenne sur 12 semaines, plus de ${s.planningNuitMoyenne} h pour un travailleur de nuit (art. L3122-7)`, 'semaine'));
      }
    }
  }
  return out;
}

/** Deux postes au moins, dans une même semaine civile, qui comptent le seuil quotidien d'heures de nuit (art. L3122-5). */
function nuitHabituelle(postes: readonly Poste[], nuit: ReturnType<typeof reglagesNuit>): boolean {
  const parSemaine = new Map<ISODate, number>();
  for (const q of postes) {
    if (heuresDeNuit(plageDuJour(q.h, dureeHoraire(q.h), 0), nuit) < nuit.nuitSeuilQuotidien) continue;
    const w = mondayOf(q.jour);
    parSemaine.set(w, (parSemaine.get(w) ?? 0) + 1);
  }
  return [...parSemaine.values()].some(n => n >= 2);
}

// — Habilitations, formations et aptitude à la date du créneau —

/** Ce que lit l'alerte d'habilitation d'un salarié (fiche enrichie : `Domain.enrich`). */
export interface HabilitationsSalarie {
  id: number;
  /** `checks` : prérequis du titre (seules les formations, `type` « cert », sont lues : jamais l'échéance de l'aptitude). */
  habs: readonly (Pick<HabInfo, 'h' | 'key' | 'mesure' | 'exp'> & { checks?: readonly Pick<PrereqCheck, 'type' | 'label' | 'ok' | 'exp'>[] })[];
  rawCerts: readonly Pick<CertInfo, 'id' | 'f' | 'obtenue' | 'exp'>[];
  med: Pick<MedInfo, 'ok' | 'restrictions'>;
}

/** Texte neutre de la réserve d'aptitude (règle de `resourceStatus`, shared/domain.ts) : ni date, ni restriction. */
export const APTITUDE_PLANNING = 'Aptitude médicale à vérifier avec le service RH';

/**
 * Alertes d'habilitation des créneaux d'un salarié sur la période `du`–`au` (`jours` : jours travaillés du salarié dans la
 * période, `exigences` : celles du poste et de l'équipe, et du besoin de poste du jour). Habilitation absente, en attente,
 * retirée, suspendue (mesure, ou prérequis échu) ou expirée avant la partie à venir de la période (à partir de max(`du`,
 * `today`) : reculer `du` ne fait pas d'une habilitation déjà expirée une simple alerte) : refus ; expirée pendant la
 * période, avant le créneau : alerte. Prérequis (formation) qui expire avant le créneau : l'habilitation est suspendue à
 * cette date, avec la même règle que son échéance. Formation exigée sans certification valide à la date du créneau : alerte.
 * Aptitude non valide ou restrictions en vigueur aujourd'hui : une seule réserve neutre pour la période, jamais datée ni
 * projetée sur un créneau (le prérequis médical d'une habilitation n'est donc jamais lu à la date du créneau).
 */
export function alertesHabilitations(e: HabilitationsSalarie, jours: readonly { jour: ISODate; exigences: Exigences }[], du: ISODate, today: ISODate,
  noms: { habilitation: (id: string) => string; formation: (id: string) => string }): AlertePlanning[] {
  const out: AlertePlanning[] = [];
  const debut = parse(du > today ? du : today);
  for (const { jour, exigences } of jours) {
    const date = parse(jour);
    for (const h of exigences.habilitations) {
      const hi = e.habs.find(x => x.h === h), nom = noms.habilitation(h);
      const refus = !hi ? 'non détenue' : hi.mesure === 'retrait' ? 'retirée' : hi.mesure === 'suspension' || hi.key === 'susp' ? 'suspendue'
        : hi.key === 'pending' || !hi.exp ? 'en attente de délivrance' : hi.exp < debut ? `expirée le ${fmtIso(isoDe(hi.exp))}` : null;
      if (refus) { out.push(alerte(e.id, jour, 'habilitation', `${fmtIso(jour)} : habilitation exigée ${nom} ${refus}`)); continue; }
      // Prérequis de formation valide aujourd'hui qui échoit le plus tôt : l'habilitation est suspendue dès cette échéance.
      const prereq = (hi!.checks ?? []).filter(c => c.type === 'cert' && c.ok && c.exp).sort((x, y) => x.exp!.getTime() - y.exp!.getTime())[0];
      if (prereq && prereq.exp! < debut) {
        out.push(alerte(e.id, jour, 'habilitation', `${fmtIso(jour)} : habilitation exigée ${nom} suspendue (prérequis ${prereq.label} échu le ${fmtIso(isoDe(prereq.exp!))})`));
      } else if (hi!.exp! < date) {
        out.push(alerte(e.id, jour, 'habilitation_expire', `${fmtIso(jour)} : habilitation ${nom} expirée le ${fmtIso(isoDe(hi!.exp!))}, pendant la période`));
      } else if (prereq && prereq.exp! < date) {
        out.push(alerte(e.id, jour, 'habilitation_expire', `${fmtIso(jour)} : habilitation ${nom} suspendue dès l’échéance de son prérequis ${prereq.label} le ${fmtIso(isoDe(prereq.exp!))}, pendant la période`));
      }
    }
    for (const f of exigences.formations) {
      const c = certEnVigueur(e.rawCerts, f);
      if (!c || c.exp < date) out.push(alerte(e.id, jour, 'formation', `${fmtIso(jour)} : formation exigée ${noms.formation(f)} ${c ? `expirée le ${fmtIso(isoDe(c.exp))}` : 'non suivie'}`));
    }
  }
  if (jours.length && (!e.med.ok || e.med.restrictions.some(r => restrictionEnVigueur(r, today)))) out.push(alerte(e.id, jours[0].jour, 'aptitude', APTITUDE_PLANNING, 'periode'));
  return out;
}

const isoDe = (d: Date): ISODate => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// — Synthèse —

/** Refus, alertes à motiver et informations d'une liste d'alertes. */
export function trierAlertes(alertes: readonly AlertePlanning[]) {
  return {
    refus: alertes.filter(a => a.gravite === 'refus'),
    alertes: alertes.filter(a => a.gravite === 'alerte'),
    infos: alertes.filter(a => a.gravite === 'info'),
  };
}
/** Codes distincts (alertes à motiver) qui concernent le créneau d'un salarié un jour donné : gardés sur le créneau publié. */
export const codesAcceptes = (alertes: readonly AlertePlanning[], empId: number, jour: ISODate): CodePlanning[] =>
  [...new Set(alertesDuJour(alertes, empId, jour).filter(a => a.gravite === 'alerte').map(a => a.code))];
