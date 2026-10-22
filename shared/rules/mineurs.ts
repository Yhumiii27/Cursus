// Âge des salariés et salariés mineurs. La date de naissance complète (`naissanceLe`) donne l'âge exact à une date ;
// une fiche qui n'en a que l'année (fiche antérieure, reprise d'un fichier qui ne portait qu'elle) garde la règle à
// l'année. Les vues du manager et des profils restreints de l'espace RH ne reçoivent pas la date : l'indication
// `mineur`, calculée par le serveur, la remplace (server/src/dataset.ts).
import { addM, days, isValidDate, joursSemaine, parse } from '../dates.ts';
import { fH, fmtIso, num } from '../format.ts';
import type { Domain, EchItem, EmpX } from '../domain.ts';
import type { Employe, Equipe, ISODate } from '../types.ts';
import { DIMANCHE } from './semaine.ts';

/** Âge de la majorité (art. 414 du Code civil) : en deçà, les règles des jeunes travailleurs s'appliquent (art. L3161-1). */
export const MAJORITE = 18;

/**
 * Ce que les règles d'âge lisent d'une fiche : année, date complète si elle est connue, indications des vues sans la date
 * (`mineur` de la fiche ou de la feuille, `moins16` de la feuille : `naissanceDeLaFeuille`).
 */
export type Naissance = Pick<Employe, 'naissance'> & Partial<Pick<Employe, 'naissanceLe' | 'mineur'>> & { moins16?: boolean };

/** Date de naissance complète et valide de la fiche, null si seule l'année est connue. */
export const dateNaissance = (e: Naissance): ISODate | null => (isValidDate(e.naissanceLe) ? e.naissanceLe : null);

/**
 * Jour où la personne atteint `ans` ans, null sans date de naissance complète. Né un 29 février : le 28 février d'une
 * année non bissextile, comme toute échéance de Cursus (`addMonths`, dernier jour du mois quand le quantième manque).
 */
export function dateDesAns(e: Naissance, ans: number): ISODate | null {
  const le = dateNaissance(e);
  return le ? addM(le, 12 * ans) : null;
}

/**
 * Âge à la date `date`. Date de naissance connue : âge révolu, atteint le jour anniversaire (`dateDesAns`). Année seule :
 * âge atteint dans l'année civile de `date` (règle d'avant la date complète, conservée pour ces fiches).
 */
export function ageAu(e: Naissance, date: ISODate): number {
  const annees = Number(date.slice(0, 4)) - e.naissance;
  const le = dateNaissance(e);
  if (!le) return annees;
  const a = Number(date.slice(0, 4)) - Number(le.slice(0, 4));
  return date >= addM(le, 12 * a) ? a : a - 1;
}

/**
 * Salarié mineur à la date `date` : moins de 18 ans selon `ageAu`, seule règle d'âge (les règles des mineurs ne lisent
 * que cette fonction, jamais `ageAu(e, date) < 18` à part). Vue sans la date de naissance (manager, profils restreints) :
 * l'indication du jour transmise par le serveur. Année seule : règle à l'année, comme `ageAu` (majeur dès le 1er janvier
 * de l'année de ses 18 ans) ; la date complète, saisie sur la fiche, donne le bon jour.
 */
export function mineurAu(e: Naissance, date: ISODate): boolean {
  if (!dateNaissance(e) && typeof e.mineur === 'boolean') return e.mineur;
  return Number.isFinite(e.naissance) && ageAu(e, date) < MAJORITE;
}

/**
 * Naissance d'une fiche vue par le manager (membres de son équipe) et les profils restreints de l'espace RH : ni la date
 * complète, ni rien qui la laisse deviner ; l'année (règle à l'année des congés de la CCN, transmise comme avant) et
 * l'indication « mineur » du jour, qui suffit aux règles des jeunes travailleurs. Un âge exact à côté de l'année
 * trahirait le jour anniversaire, le jour où il change : il n'est pas transmis.
 */
export const naissanceVueManager = (e: Naissance, today: ISODate): Pick<Employe, 'naissanceLe' | 'mineur'> =>
  ({ naissanceLe: null, mineur: mineurAu(e, today) });

// — Règles des jeunes travailleurs (étape 2) —
// Durées maximales (art. L3162-1), deux jours de repos consécutifs dont le dimanche (art. L3164-2 et L3164-5), pas de
// travail de nuit (art. L3163-2), contrôlé par la case « travail de nuit ou en continu » des équipes et, depuis le lot 6,
// par l'horaire du jour de la feuille (shared/rules/repos-nuit.ts : refus ; repos de 12 h et pause de 30 min à motiver),
// dérogation pour travaux réglementés (art. R4153-40 et suivants) déclarée sur la fiche. Toutes lisent `mineurAu` : elles
// cessent d'elles-mêmes aux 18 ans.

/** Durées maximales du travail d'un salarié de moins de 18 ans, par jour et par semaine (art. L3162-1). */
export const MINEUR_JOUR_MAX = 8;
export const MINEUR_SEMAINE_MAX = 35;
/** Validité de la déclaration de dérogation pour travaux réglementés, en mois (art. R4153-41 : renouvelée tous les 3 ans). */
export const DEROGATION_TRAVAUX_MOIS = 36;

/** Contrôle en cause, codé pour le journal (jamais le texte du motif). */
export type CodeMineur = 'jour_8h' | 'semaine_35h' | 'dimanche' | 'repos_consecutif';

/** Contrôles d'une semaine : dépassements à motiver, alertes de repos, et leurs codes. */
export interface ControlesMineur { depassements: string[]; repos: string[]; codes: CodeMineur[] }

/**
 * Contrôles d'une semaine (lundi `week`, heures par jour du lundi au dimanche) d'un salarié de moins de 18 ans, appelés
 * par `calcSheet` (shared/rules/temps.ts) :
 * - `depassements` : plus de 8 h un jour où il est mineur, plus de 35 h sur les jours de la semaine où il l'est (la
 *   semaine de ses 18 ans, les heures faites majeur n'y comptent pas).
 *   Ils rejoignent les durées maximales de la feuille : soumission et validation exigent un motif, ou la référence de la
 *   dérogation accordée par l'inspection du travail (5 h de plus par semaine au plus, art. L3162-1) ;
 * - `repos` (alertes, comme le repos hebdomadaire des majeurs) : heures le dimanche (art. L3164-5, sans dérogation pour
 *   l'industrie chimique), ou aucun couple de jours consécutifs sans heure dans la semaine (art. L3164-2) ; le samedi
 *   travaillé, le repos peut encore tenir au dimanche et au lundi suivant, ce que l'alerte invite à vérifier.
 * Semaine inconnue (feuille pas encore créée) ou sans jour de minorité : aucun contrôle.
 */
export function controlesMineur(e: Naissance, week: ISODate | null | undefined, perDay: readonly number[]): ControlesMineur {
  const out: ControlesMineur = { depassements: [], repos: [], codes: [] };
  if (!isValidDate(week)) return out;
  const mineur = joursSemaine(week).map(day => mineurAu(e, day));
  if (!mineur.some(Boolean)) return out;
  const h = (i: number) => num(perDay[i]);
  if (mineur.some((m, i) => m && h(i) > MINEUR_JOUR_MAX)) {
    out.depassements.push(`Plus de ${MINEUR_JOUR_MAX} h sur une journée : salarié de moins de 18 ans (art. L3162-1)`);
    out.codes.push('jour_8h');
  }
  if (mineur.reduce((n, m, i) => n + (m ? h(i) : 0), 0) > MINEUR_SEMAINE_MAX) {
    out.depassements.push(`Plus de ${MINEUR_SEMAINE_MAX} h dans la semaine : salarié de moins de 18 ans (art. L3162-1)`);
    out.codes.push('semaine_35h');
  }
  if (mineur[DIMANCHE] && h(DIMANCHE) > 0) {
    out.repos.push(`${fH(h(DIMANCHE))} le dimanche : repos dominical d’un salarié de moins de 18 ans (art. L3164-5)`);
    out.codes.push('dimanche');
  } else if (!mineur.some((_, i) => i < DIMANCHE && !(h(i) > 0) && !(h(i + 1) > 0))) {
    out.repos.push('Pas deux jours de repos consécutifs dans la semaine, dus à un salarié de moins de 18 ans (art. L3164-2) : à vérifier si le lundi suivant n’est pas travaillé');
    out.codes.push('repos_consecutif');
  }
  return out;
}

/**
 * Indication `mineur` d'une feuille dans une vue sans la date de naissance (server/src/dataset.ts) : mineur un jour au
 * moins de la semaine. Sans elle, le manager ne connaîtrait que l'indication du jour : la semaine passée d'un salarié
 * devenu majeur depuis n'aurait plus de contrôle chez lui, alors que le serveur exige le motif (soumission impossible).
 * Une seule indication par semaine, pas le jour des 18 ans : la semaine où il les atteint, la vue applique les règles aux
 * sept jours (motif demandé un peu plus tôt que par le serveur, jamais plus tard).
 */
export const mineurDeLaSemaine = (e: Naissance, week: ISODate): boolean =>
  isValidDate(week) && joursSemaine(week).some(day => mineurAu(e, day));

/** Naissance qui s'applique aux contrôles d'une feuille : l'indication de la semaine quand la vue n'a pas la date. */
export const naissanceDeLaFeuille = (e: Naissance, sh: { mineur?: boolean; moins16?: boolean } | null | undefined): Naissance =>
  (!dateNaissance(e) && typeof sh?.mineur === 'boolean' ? { ...e, mineur: sh.mineur, ...(sh.moins16 ? { moins16: true } : {}) } : e);

/**
 * Salarié de moins de 16 ans à la date `date` (repos quotidien de 14 h, nuit de 20 h à 6 h : shared/rules/repos-nuit.ts) :
 * d'après la date de naissance complète ; vue sans la date, l'indication `moins16` de la feuille. L'année seule ne le dit
 * pas : les règles de 16 à 18 ans s'appliquent alors.
 */
export const moins16Au = (e: Naissance, date: ISODate): boolean =>
  (dateNaissance(e) ? mineurAu(e, date) && ageAu(e, date) < 16 : !!e.moins16 && mineurAu(e, date));

/**
 * Indication `moins16` d'une feuille dans une vue sans la date de naissance (server/src/dataset.ts), comme `mineur` : moins
 * de 16 ans un jour au moins de la semaine, d'après la date complète. Le valideur applique ainsi le seuil du serveur.
 */
export const moins16DeLaSemaine = (e: Naissance, week: ISODate): boolean =>
  isValidDate(week) && !!dateNaissance(e) && joursSemaine(week).some(day => moins16Au(e, day));

/** Équipe cochée « travail de nuit ou en continu » ; null ou absente : case pas encore renseignée par le service RH. */
export const equipeDeNuit = (q: Pick<Equipe, 'nuit'> | null | undefined): boolean => q?.nuit === true;

/** Jour où se juge une affectation : aujourd'hui, ou la date d'entrée si elle est à venir. */
const jourAffectation = (e: { entree?: string | null }, today: ISODate): ISODate =>
  (isValidDate(e.entree) && e.entree > today ? e.entree : today);

/**
 * Refus d'affecter un salarié mineur à une équipe cochée « travail de nuit ou en continu » (art. L3163-2 : aucun travail
 * entre 22 h et 6 h, entre 20 h et 6 h avant 16 ans) ; null si l'affectation est permise. Cursus ne connaissant pas les
 * horaires, la case de l'équipe tient lieu de contrôle (fiche, affectation, import).
 */
export function refusEquipeNuit(e: Naissance & { nom?: string; entree?: string | null }, q: Pick<Equipe, 'nom' | 'nuit'> | null | undefined, today: ISODate): string | null {
  if (!q || !equipeDeNuit(q) || !mineurAu(e, jourAffectation(e, today))) return null;
  return `Équipe ${q.nom} (travail de nuit ou en continu) : ${e.nom || 'ce salarié'} a moins de 18 ans et ne peut pas y être affecté (art. L3163-2).`;
}

/** Membres mineurs d'une équipe, présents ou à venir : elle ne peut pas être cochée « travail de nuit ou en continu ». */
export function mineursDeLEquipe<T extends Naissance & Pick<Employe, 'equipe' | 'entree' | 'fin'>>(employes: readonly T[], nom: string, today: ISODate): T[] {
  return employes.filter(e => e.equipe === nom && !(e.fin && e.fin < today) && mineurAu(e, jourAffectation(e, today)));
}

/** Fin de validité de la déclaration de dérogation pour travaux réglementés (3 ans) ; null sans dérogation. */
export function finDerogationTravaux(e: Partial<Pick<Employe, 'derogationTravauxLe'>>): ISODate | null {
  return isValidDate(e.derogationTravauxLe) ? addM(e.derogationTravauxLe, DEROGATION_TRAVAUX_MOIS) : null;
}

/** Ce que la fiche d'un salarié mineur affiche et dont partent ses échéances. */
export interface EtatMineur {
  /** 18 ans : fin des règles des jeunes travailleurs ; null : jour inconnu (vue sans la date de naissance). */
  majeurLe: ISODate | null;
  /** Le jour des 18 ans n'est connu qu'à l'année (fiche sans date complète) : 1er janvier de l'année des 18 ans. */
  aLAnnee: boolean;
  /** Déclaration de dérogation pour travaux réglementés : date, fin de validité, expirée (null : aucune). */
  derogation: { le: ISODate; fin: ISODate; expiree: boolean } | null;
  /** La dérogation reste valable jusqu'aux 18 ans : pas d'échéance de renouvellement. */
  derogationApresMajorite: boolean;
}

/** État d'un salarié de moins de 18 ans à la date `today` ; null s'il est majeur ou si sa naissance est inconnue. */
export function etatMineur(e: Naissance & Partial<Pick<Employe, 'derogationTravauxLe' | 'derogationApresMajorite'>>, today: ISODate): EtatMineur | null {
  if (!mineurAu(e, today)) return null;
  // Vue sans la date (manager, profils restreints) : l'indication seule, aucun jour à en déduire.
  const vueSansDate = !dateNaissance(e) && typeof e.mineur === 'boolean';
  const exact = dateDesAns(e, MAJORITE);
  const majeurLe = exact ?? (vueSansDate ? null : `${e.naissance + MAJORITE}-01-01`);
  const fin = finDerogationTravaux(e);
  return {
    majeurLe, aLAnnee: !exact && !!majeurLe, derogation: fin ? { le: e.derogationTravauxLe!, fin, expiree: fin <= today } : null,
    // Vue sans la date : l'indication du serveur ; sinon, comparaison au jour des 18 ans.
    derogationApresMajorite: !!fin && (vueSansDate ? e.derogationApresMajorite === true : !!majeurLe && fin >= majeurLe),
  };
}

const CLS_MINEUR = { ok: 'tag-neutral', due: 'tag-outline', exp: 'tag-accent' } as const;

/**
 * Intitulés (`kindLabel`) des deux échéances d'un salarié mineur. Les relances par e-mail (shared/rules/relances.ts) les
 * reconnaissent par eux et les réservent au service RH : le jour des 18 ans donnerait la date de naissance complète, et la
 * dérogation n'est pas transmise au manager.
 */
export const ECHEANCE_18_ANS = 'Salarié de moins de 18 ans';
export const ECHEANCE_DEROGATION = 'Dérogation · travaux réglementés';

/**
 * Échéances d'un salarié mineur (type `contrat` de Domain.echeances, après celles du contrat) :
 * - 18 ans, qui lèvent les règles des jeunes travailleurs (durées, repos, nuit, dérogation) : jour anniversaire, ou
 *   1er janvier de l'année des 18 ans pour une fiche qui n'a que l'année ; aucune dans une vue sans la date ;
 * - fin de validité de la dérogation pour travaux réglementés (3 ans), si elle précède les 18 ans : à renouveler sous
 *   l'horizon d'alerte, expirée ensuite (plus de travaux réglementés sans dérogation en vigueur).
 */
export function echeancesMineur(d: Domain, e: EmpX, horizon: number): EchItem[] {
  const m = etatMineur(e, d.ti);
  if (!m) return [];
  const item = (o: Pick<EchItem, 'kindLabel' | 'label' | 'key' | 'statut' | 'action'> & { le: ISODate }): EchItem => {
    const { le, ...x } = o, exp = parse(le);
    return { ...x, kind: 'contrat', emp: e, exp, d: days(d.today, exp), cls: CLS_MINEUR[o.key], planned: false, plannedLabel: '' };
  };
  const out: EchItem[] = [];
  if (m.majeurLe) {
    const key = days(d.today, parse(m.majeurLe)) <= horizon ? 'due' : 'ok';
    out.push(item({
      kindLabel: ECHEANCE_18_ANS, label: `18 ans${m.aLAnnee ? ' (année de naissance seule)' : ''}`, le: m.majeurLe, key,
      statut: 'Fin des règles des mineurs',
      action: m.aLAnnee ? { label: 'Saisir la date de naissance', intent: { type: 'openContrat', empId: e.id, quoi: 'fiche' } } : null,
    }));
  }
  const g = m.derogation;
  if (g && !m.derogationApresMajorite) {
    const n = days(d.today, parse(g.fin)), key = n <= 0 ? 'exp' : n <= horizon ? 'due' : 'ok';
    out.push(item({
      kindLabel: ECHEANCE_DEROGATION, label: `Déclarée le ${fmtIso(g.le)}`, le: g.fin, key,
      statut: key === 'exp' ? 'Expirée — travaux réglementés interdits' : key === 'due' ? 'À renouveler' : 'En vigueur',
      action: { label: 'Mettre à jour', intent: { type: 'openContrat', empId: e.id, quoi: 'fiche' } },
    }));
  }
  return out;
}
