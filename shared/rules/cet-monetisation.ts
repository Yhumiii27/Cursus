// lot 13 — CET (monétisation) : utilisation des jours épargnés sur le compte épargne-temps en complément de rémunération
// (art. L3151-3). Le salarié (ou le service RH pour lui) demande à monétiser des jours ; le service RH valide ou refuse,
// jamais pour lui-même ; validée, la demande part à la paie sous la rubrique CET_MON, dans le lot de sa période (famille
// « monetisationsCet » du registre des éléments de lot, server/src/cet-paie.ts), comme les jours rachetés d'un forfait jours.
// Règles :
// - Fermée par défaut : ouverte par le réglage `cetMonetisation`, qui exige la référence de l'accord (COHERENCE).
// - Seuls les jours venus des RTT se monétisent : les CP placés (5e semaine) ne le peuvent pas, la loi réservant la
//   monétisation des droits issus du congé annuel aux jours au-delà de 30 jours ouvrables (art. L3151-3), que Cursus
//   n'épargne jamais (shared/rules/conges.ts : seuls les CP de la 5e semaine se placent). Le solde repris de l'ancien outil,
//   d'origine inconnue, ne se monétise que si le réglage `cetReprisMonetisable` le dit.
// - Les congés pris et demandés sur le CET s'imputent d'abord sur les jours non monétisables (CP, repris non monétisable) :
//   c'est l'imputation la plus favorable au salarié, qui garde ses jours monétisables.
// - Plafond par salarié et par année civile de la demande (`cetMonetisationPlafond`, 10 jours par défaut), demandes en
//   attente comprises ; par demi-journée ; dans la limite du solde (congés et monétisations en attente déduits).
// - Refusée pour un salarié sorti ou dont la sortie est enregistrée : son solde est liquidé en entier avec le solde de
//   tout compte (rubrique CET_LIQ, shared/rules/solde-sortie.ts).
// Les jours monétisés (demandes validées) et ceux des demandes en attente sont déduits du solde par `cetInfo`
// (shared/rules/conges.ts).
import type { Domain } from '../domain.ts';
import { fJ } from '../format.ts';
import type { ElementMonetisationCetPaie, Employe, ISODate, MonetisationCet, Settings } from '../types.ts';
import { cetInfo } from './conges.ts';
import { sortieEnregistree, sorti } from './contrats.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeLabel, periodeOuverte, type RubriqueVue } from './paie.ts';

/** Rubrique interne des jours monétisés (RUBRIQUES_PAIE, shared/constants.ts). */
export const RUBRIQUE_CET_MON = 'CET_MON';
/** Motif d'un refus ou d'une annulation : 500 caractères au plus. */
export const MOTIF_MONETISATION_MAX = 500;

type ReglagesMonetisation = Pick<Settings, 'cetMonetisation' | 'cetMonetisationAccord' | 'cetMonetisationPlafond' | 'cetReprisMonetisable'>;

/** Réglages de la monétisation, valeurs par défaut comprises (fermée, 10 jours par an, repris non monétisable). */
export function reglagesMonetisation(s: Partial<ReglagesMonetisation> | undefined) {
  return {
    ouverte: !!s?.cetMonetisation && !!s?.cetMonetisationAccord,
    accord: s?.cetMonetisationAccord ?? '',
    plafond: s?.cetMonetisationPlafond ?? 10,
    reprisMonetisable: !!s?.cetReprisMonetisable,
  };
}

/** Demandes de monétisation d'un salarié. */
export const monetisationsDe = (d: Domain, empId: number) => (d.ds.monetisationsCet ?? []).filter(m => m.empId === empId);

/** Demande qui compte (en attente ou validée). */
const engagee = (m: MonetisationCet) => m.statut === 'demandee' || m.statut === 'validee';

/**
 * Jours monétisables d'un salarié aujourd'hui (`exclue` : demande en cours de décision, qui ne se compte pas contre
 * elle-même) : origine (RTT placés, repris si le réglage le permet) moins les monétisations engagées et la part des congés
 * pris et demandés qui dépasse les jours non monétisables ; plafond de l'année civile ; solde du CET.
 */
export function monetisationInfo(d: Domain, e: Employe, exclue?: Pick<MonetisationCet, 'id' | 'jours' | 'statut'> | null) {
  const r = reglagesMonetisation(d.ds.settings);
  const ct = cetInfo(d, e);
  const annee = Number(d.ti.slice(0, 4));
  const autres = monetisationsDe(d, e.id).filter(m => engagee(m) && m.id !== exclue?.id);
  const engagees = autres.reduce((n, m) => n + m.jours, 0);
  const deLAnnee = autres.filter(m => m.annee === annee).reduce((n, m) => n + m.jours, 0);
  const origine = ct.rtt + (r.reprisMonetisable ? ct.repris : 0);
  const nonMonetisable = ct.cp + (r.reprisMonetisable ? 0 : ct.repris);
  const congesSurOrigine = Math.max(0, ct.pris + ct.poses - nonMonetisable);
  const parOrigine = Math.max(0, origine - engagees - congesSurOrigine);
  const parPlafond = Math.max(0, r.plafond - deLAnnee);
  // Solde du CET sans la demande exclue (déjà déduite par `cetInfo` si elle est en attente ou validée).
  const solde = Math.max(0, ct.solde + (exclue && engagee(exclue as MonetisationCet) ? exclue.jours : 0));
  return { ...r, eligible: ct.eligible, origine, parOrigine, parPlafond, deLAnnee, solde, possible: Math.min(parOrigine, parPlafond, solde) };
}

/**
 * Refus d'une demande de `jours` (null : recevable). `exclue` : à la validation, la demande elle-même. `date` : jour de la
 * demande (aujourd'hui).
 */
export function refusMonetisation(d: Domain, e: Employe, jours: number, exclue?: Pick<MonetisationCet, 'id' | 'jours' | 'statut'> | null): string | null {
  const m = monetisationInfo(d, e, exclue);
  if (!m.ouverte) return 'La monétisation du compte épargne-temps n’est pas ouverte : elle suppose l’accord collectif qui la prévoit, à référencer dans Paramètres → Compte épargne-temps';
  if (!m.eligible) return 'Compte épargne-temps non ouvert pour ce contrat (intérim : congés gérés par l’agence)';
  if (sortieEnregistree(e) || sorti(e, d.ti)) return `Sortie de ${e.nom} enregistrée : son compte épargne-temps est liquidé en entier avec le solde de tout compte`;
  if (!(jours > 0) || (jours * 2) % 1 !== 0) return 'Nombre de jours invalide (par demi-journée)';
  if (jours > m.solde) return `Solde du compte épargne-temps insuffisant : ${fJ(m.solde)} disponibles (congés et demandes en attente déduits)`;
  if (jours > m.parOrigine) {
    return `Seuls les jours venus des RTT${m.reprisMonetisable ? ' et du solde repris' : ''} se monétisent : ${fJ(m.parOrigine)} au plus`
      + ' (les CP placés ne se monétisent pas, art. L3151-3 ; les congés pris sur le CET s’imputent d’abord sur eux)';
  }
  if (jours > m.parPlafond) return `Plafond de ${fJ(m.plafond)} monétisés par an atteint : ${fJ(m.parPlafond)} encore possibles en ${d.ti.slice(0, 4)} (demandes en attente comprises)`;
  return null;
}

/** Période de paie d'une demande validée le `valideLe` : son mois, au plus tôt la période ouverte (clôture de paie). */
export const periodeMonetisation = (valideLe: ISODate, today: ISODate, clotureJour = 0) => [moisDe(valideLe), periodeOuverte(today, clotureJour)].sort().at(-1)!;

/** Demandes validées en attente de la paie : ni dans un lot, ni transmises, dont la période vient au plus tard `jusqua`. */
function enAttente(d: Domain, jusqua: string) {
  return (d.ds.monetisationsCet ?? []).flatMap(m => {
    if (m.statut !== 'validee' || m.lotId != null || m.sage || !m.periode) return [];
    const e = d.emp(m.empId);
    return e && m.periode <= jusqua ? [{ m, e, periode: m.periode }] : [];
  });
}

/** « Monétisation du CET, demande n° 12 » : détail d'un élément CET_MON (le numéro retrouve la demande et sa décision). */
export const detailMonetisation = (x: Pick<ElementMonetisationCetPaie, 'monetisation'>) => `Monétisation du CET, demande n° ${x.monetisation}`;

/**
 * Éléments CET_MON d'un lot de la période `jusqua` : toutes les demandes validées en attente, sous le code Sage de la
 * rubrique active ; rubrique désactivée, sans code Sage (réservées par le lot, à saisir dans Sage).
 */
export function elementsMonetisationsCet(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[]): ElementMonetisationCetPaie[] {
  const r = table.find(t => t.code === RUBRIQUE_CET_MON);
  const codeSage = r?.active ? r.codeSage : null;
  return enAttente(d, jusqua).map(({ m, e, periode }) => ({
    monetisation: m.id, empId: m.empId, matricule: matriculeAffiche(e), periode, rubrique: RUBRIQUE_CET_MON, codeSage, quantite: m.jours, valideLe: (m.decideLe ?? m.demandeLe).slice(0, 10),
  })).sort((x, y) => x.periode.localeCompare(y.periode) || x.empId - y.empId || x.monetisation - y.monetisation);
}

/** Demandes d'un lot (identifiant, salarié), une fois chacune. */
export const monetisationsDuContenu = (elements: readonly Pick<ElementMonetisationCetPaie, 'monetisation' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.monetisation, { id: x.monetisation, empId: x.empId }])).values()];

/** État d'une demande : « demandée », « refusée », « dans le lot de paie n° 4 », « transmise à la paie (octobre 2026) »… */
export function etatMonetisation(m: MonetisationCet): string {
  if (m.statut === 'demandee') return 'demandée, à valider par le service RH';
  if (m.statut === 'refusee') return 'refusée';
  if (m.statut === 'annulee') return 'annulée';
  if (m.horsFichier) return 'réglée hors fichier (saisie dans Sage)';
  if (m.sage) return `transmise à la paie (lot n° ${m.lotId})`;
  if (m.lotId != null) return `dans le lot de paie n° ${m.lotId}, import à confirmer`;
  return m.periode ? `validée, paie de ${periodeLabel(m.periode)}` : 'validée';
}

/** Demande encore annulable : en attente, ou validée hors de tout lot de paie et non transmise. */
export const monetisationAnnulable = (m: MonetisationCet) => m.statut === 'demandee' || (m.statut === 'validee' && m.lotId == null && !m.sage);
