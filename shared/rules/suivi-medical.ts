// Suivi médical (t059) : type de suivi de chaque salarié et échéance de sa prochaine visite. L'aptitude durait 24 mois
// pour tous, d'où de fausses alertes, et la périodicité fixée par le médecin du travail ne pouvait pas se saisir.
// - Type de suivi : suivi individuel renforcé (SIR) déduit d'une habilitation ou du poste marqués « SIR » au référentiel
//   (cases décochées par défaut, art. R4624-23) ; sinon le type saisi par le service RH sur la fiche ; sinon VIP.
// - Échéance : la date de la prochaine visite fixée par le médecin du travail, saisie avec l'avis, prime toujours ; sinon
//   la périodicité du type de suivi (Paramètres → Santé, 24 mois pour tous par défaut). Suivi renforcé : visite
//   intermédiaire après la dernière visite, renouvellement de l'examen d'aptitude après le dernier examen (art. R4624-28),
//   la plus proche des deux.
// - Suivi renforcé sans examen médical d'aptitude enregistré : alerte « examen d'aptitude requis » (art. R4624-24), qui
//   n'invalide pas une aptitude en cours mais la fait passer « à renouveler ».
// Données de santé : type, prochaine visite et examen ne sont transmis qu'au service RH et à l'intéressé (dataset.ts).
import { addMonths, isValidDate, parse } from '../dates.ts';
import { fmt } from '../format.ts';
import type { Dataset, Employe, HabTitre, HabType, ISODate, Settings, SuiviMedical } from '../types.ts';
import { posteDe } from './exigences.ts';
import { actif } from './referentiels.ts';

export const SUIVIS_MEDICAUX: Record<SuiviMedical, { label: string; court: string; article: string }> = {
  vip: { label: 'Visite d’information et de prévention (VIP)', court: 'VIP', article: 'Art. R4624-10 et R4624-16' },
  vip_adapte: { label: 'VIP adaptée (travailleur de nuit, travailleur handicapé ou titulaire d’une pension d’invalidité)', court: 'VIP adaptée', article: 'Art. R4624-17 et R4624-20' },
  sir: { label: 'Suivi individuel renforcé (postes à risques particuliers)', court: 'suivi renforcé', article: 'Art. R4624-22 à R4624-28' },
};
export const estSuiviMedical = (v: unknown): v is SuiviMedical => typeof v === 'string' && Object.hasOwn(SUIVIS_MEDICAUX, v);

/** Écart maximal entre la visite et la prochaine visite fixée par le médecin : 5 ans, la plus longue périodicité (VIP). */
export const PROCHAINE_VISITE_MAX_MOIS = 60;

/** Suivi médical d'un salarié : type retenu, et s'il est déduit du référentiel (prime sur le type saisi). */
export interface SuiviInfo {
  type: SuiviMedical;
  /** Suivi renforcé déduit d'une habilitation détenue ou demandée, ou du poste, marqués « SIR » au référentiel. */
  deduit: boolean;
  /** Ce qui place le salarié en suivi renforcé : intitulés des habilitations, « poste … ». */
  origines: string[];
  /** Type saisi par le service RH sur la fiche (null : aucun, VIP par défaut). */
  saisi: SuiviMedical | null;
}

/** Habilitations « SIR » en vigueur au référentiel que le salarié détient ou a demandées (titre ni retiré). */
function habilitationsSir(ref: readonly HabType[], habs: readonly Pick<HabTitre, 'h' | 'delivree' | 'demande' | 'mesure'>[]): HabType[] {
  return habs.filter(t => (t.delivree || t.demande) && t.mesure !== 'retrait')
    .map(t => ref.find(h => h.id === t.h)).filter((h): h is HabType => !!h && !!h.sir && actif(h));
}

/** Type de suivi d'un salarié : suivi renforcé déduit du référentiel ; sinon le type saisi ; sinon VIP. */
export function suiviDe(ds: Pick<Dataset, 'referentiels'>, e: Pick<Employe, 'habs' | 'posteId' | 'poste' | 'suivi'>): SuiviInfo {
  const poste = posteDe(ds, e);
  const origines = [...new Set(habilitationsSir(ds.referentiels.habilitations, e.habs).map(h => h.nom)), ...(poste?.sir ? [`poste ${poste.nom}`] : [])];
  const saisi = estSuiviMedical(e.suivi) ? e.suivi : null;
  return origines.length ? { type: 'sir', deduit: true, origines, saisi } : { type: saisi ?? 'vip', deduit: false, origines: [], saisi };
}

/** Visite attendue à l'échéance : date fixée par le médecin, visite périodique, visite intermédiaire ou examen d'aptitude (SIR). */
export type ProchaineVisite = 'medecin' | 'periodique' | 'intermediaire' | 'aptitude';
export interface EcheanceVisite { exp: Date; prochaine: ProchaineVisite }

type Periodicites = Pick<Settings, 'santeVipMois' | 'santeVipAdapteeMois' | 'santeSirIntermediaireMois' | 'santeSirAptitudeMois'>;
/** Périodicités par défaut, pour un instantané qui n'aurait pas encore ces réglages. */
const PERIODICITES: Periodicites = { santeVipMois: 24, santeVipAdapteeMois: 24, santeSirIntermediaireMois: 24, santeSirAptitudeMois: 48 };
const mois = (s: Partial<Periodicites>, k: keyof Periodicites) => (Number.isFinite(s[k]) ? s[k]! : PERIODICITES[k]);

/** Périodicité en mois d'un type de suivi (SIR : celle de la visite intermédiaire). */
export function periodicite(type: SuiviMedical, s: Partial<Periodicites>): number {
  return mois(s, type === 'vip' ? 'santeVipMois' : type === 'vip_adapte' ? 'santeVipAdapteeMois' : 'santeSirIntermediaireMois');
}

/**
 * Échéance de la prochaine visite après la dernière (`visite`) : date fixée par le médecin du travail si elle est saisie,
 * sinon la périodicité du type de suivi. Suivi renforcé : la plus proche de la visite intermédiaire (dernière visite +
 * périodicité intermédiaire) et du renouvellement de l'examen d'aptitude (dernier examen + périodicité de l'examen).
 */
export function echeanceVisite(e: Pick<Employe, 'prochaineVisite' | 'examenAptitude'>, visite: Date, type: SuiviMedical, s: Partial<Periodicites>): EcheanceVisite {
  if (e.prochaineVisite && isValidDate(e.prochaineVisite)) return { exp: parse(e.prochaineVisite), prochaine: 'medecin' };
  if (type !== 'sir') return { exp: addMonths(visite, periodicite(type, s)), prochaine: 'periodique' };
  const intermediaire = addMonths(visite, mois(s, 'santeSirIntermediaireMois'));
  if (!e.examenAptitude || !isValidDate(e.examenAptitude)) return { exp: intermediaire, prochaine: 'aptitude' };
  const aptitude = addMonths(parse(e.examenAptitude), mois(s, 'santeSirAptitudeMois'));
  return aptitude <= intermediaire ? { exp: aptitude, prochaine: 'aptitude' } : { exp: intermediaire, prochaine: 'intermediaire' };
}

/** Suivi renforcé sans examen médical d'aptitude enregistré (embauche ou affectation au poste à risques, art. R4624-24). */
export const examenRequis = (suivi: SuiviInfo, e: Pick<Employe, 'examenAptitude'>) => suivi.type === 'sir' && !e.examenAptitude;

/** Précision de l'échéance : « date fixée par le médecin du travail », « périodicité VIP de 24 mois »… */
export function prochaineTexte(x: EcheanceVisite, type: SuiviMedical, s: Partial<Periodicites>): string {
  if (x.prochaine === 'medecin') return 'date fixée par le médecin du travail';
  if (x.prochaine === 'intermediaire') return 'visite intermédiaire du suivi renforcé';
  if (x.prochaine === 'aptitude') return 'examen d’aptitude du suivi renforcé';
  return `périodicité ${SUIVIS_MEDICAUX[type].court} de ${periodicite(type, s)} mois`;
}

/** Type de suivi lisible : « VIP », « suivi renforcé (habilitation électrique) », « VIP adaptée (saisi) »… */
export function suiviTexte(x: SuiviInfo): string {
  const nom = SUIVIS_MEDICAUX[x.type].court;
  const cap = nom.charAt(0).toUpperCase() + nom.slice(1);
  if (x.deduit) return `${cap} — ${x.origines.join(', ')}`;
  return x.saisi ? cap : `${cap} (par défaut)`;
}

/**
 * Prochaine visite saisie avec l'avis (facultative) : postérieure à la visite, au plus 5 ans après. Erreur (texte) ou
 * null ; une valeur vide vaut « non fixée ».
 */
export function erreurProchaineVisite(prochaine: ISODate | null, visite: string): string | null {
  if (!prochaine) return null;
  if (!isValidDate(prochaine)) return 'Date de la prochaine visite invalide.';
  if (!isValidDate(visite)) return null;
  if (prochaine <= visite) return 'La prochaine visite fixée par le médecin doit suivre la visite.';
  if (parse(prochaine) > addMonths(parse(visite), PROCHAINE_VISITE_MAX_MOIS)) {
    return `La prochaine visite ne peut pas être fixée plus de 5 ans après la visite (au plus tard le ${fmt(addMonths(parse(visite), PROCHAINE_VISITE_MAX_MOIS))}).`;
  }
  return null;
}
