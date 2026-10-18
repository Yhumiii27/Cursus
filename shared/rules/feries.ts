// Jours fériés de l'établissement et journée de solidarité (t051), réglés par année civile par l'administrateur RH
// (Paramètres → Jours fériés, `parametres.feries`, server/src/actions/feries.ts). Le calendrier lui-même (fériés chômés,
// journée de solidarité travaillée) est calculé par shared/dates.ts, que `isFerie` lit : congés décomptés, heures
// proposées, repos du forfait jours, majorations des fériés, préavis… suivent le réglage sans changer d'appel.
// - Par défaut (aucun réglage pour l'année) : lundi de Pentecôte chômé, tous les fériés chômés (comportement d'avant).
// - Journée de solidarité (art. L3133-7 et L3133-11, modalité fixée par accord ou par l'employeur après avis du CSE) :
//   lundi de Pentecôte travaillé, autre férié travaillé (jamais le 1er mai), ou hors calendrier (fractionnée, prise sur un
//   RTT : aucun effet sur le calendrier). Travaillée, elle n'est plus fériée : ni majoration ni FERIE_TRAV, et ses 7 h ne
//   sont pas payées à un mensualisé (art. L3133-8), au prorata de la durée contractuelle pour un temps partiel.
// - Fériés non chômés : travaillés comme des jours ordinaires ; le 1er mai reste toujours chômé et payé (art. L3133-4).
// - Aucun effet rétroactif : réglable à partir de 2027 (mise en service) et jamais pour une année passée. Une année déjà
//   engagée (absences transmises à la paie, congés clôturés) ne se modifie qu'avec un motif, et la liste des absences
//   dont le décompte change est donnée avant l'enregistrement et dans le message.
import { ANNEE_FERIES_MIN, avecCalendrier, feriesLegaux, weekday } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Absence, CalendrierFeries, CodeFerie, Dataset, FeriesAnnee, ISODate, ModaliteSolidarite } from '../types.ts';

/** Libellés des fériés légaux. */
export const FERIES_LABEL: Record<CodeFerie, string> = {
  jour_an: 'Jour de l’an', paques: 'Lundi de Pâques', '1er_mai': '1er mai', '8_mai': '8 mai', ascension: 'Ascension',
  pentecote: 'Lundi de Pentecôte', '14_juillet': '14 juillet', '15_aout': 'Assomption (15 août)', toussaint: 'Toussaint',
  '11_novembre': '11 novembre', noel: 'Noël',
};
export const CODES_FERIES = Object.keys(FERIES_LABEL) as CodeFerie[];

/** Modalités de la journée de solidarité. */
export const MODALITES_SOLIDARITE: Record<ModaliteSolidarite, { label: string; aide: string }> = {
  pentecote_chomee: {
    label: 'Lundi de Pentecôte chômé (par défaut)',
    aide: 'Le lundi de Pentecôte reste férié et chômé ; la journée de solidarité est traitée par la paie (autre jour, retenue…).',
  },
  pentecote_travaillee: {
    label: 'Lundi de Pentecôte travaillé',
    aide: 'Le lundi de Pentecôte devient un jour ordinaire : décompté en congé, heures proposées, jour du forfait.',
  },
  autre_ferie: {
    label: 'Autre jour férié travaillé',
    aide: 'Le férié choisi devient un jour ordinaire (jamais le 1er mai) ; le lundi de Pentecôte reste chômé.',
  },
  hors_calendrier: {
    label: 'Fractionnée ou prise sur un jour de RTT',
    aide: 'Sept heures réparties dans l’année ou un jour de RTT : le calendrier des fériés ne change pas.',
  },
};
export const estModaliteSolidarite = (v: unknown): v is ModaliteSolidarite => typeof v === 'string' && v in MODALITES_SOLIDARITE;
export const estCodeFerie = (v: unknown): v is CodeFerie => typeof v === 'string' && v in FERIES_LABEL;

/** Rappel du traitement de la journée de solidarité travaillée, pour l'écran et l'aide. */
export const SOLIDARITE_PAIE = 'Journée de solidarité travaillée : ni majoration ni heures de férié, et ses 7 heures ne sont pas payées à un salarié mensualisé (art. L3133-8), au prorata de la durée contractuelle pour un temps partiel.';

export const MOTIF_FERIES_MAX = 500;
/** Années réglables à la date `today` : de l'année en cours (2027 au plus tôt) à deux ans après. */
export function anneesReglables(today: ISODate): number[] {
  const y = Number(today.slice(0, 4)), de = Math.max(ANNEE_FERIES_MIN, y);
  return [de, de + 1, de + 2].filter(a => a <= y + 2);
}

/** Réglage de l'année, ou celui par défaut (Pentecôte chômée, tous les fériés chômés). */
export function reglageAnnee(c: CalendrierFeries | null | undefined, annee: number): Omit<FeriesAnnee, 'le' | 'par'> & Partial<Pick<FeriesAnnee, 'le' | 'par'>> {
  return c?.[String(annee)] ?? { solidarite: 'pentecote_chomee', solidariteFerie: null, nonChomes: [] };
}

/**
 * Férié qui tombe un samedi ou un dimanche de l'année (« samedi », « dimanche ») ; null en semaine. Retenu comme journée
 * de solidarité, il ne changerait aucun jour ouvré : la journée ne serait travaillée nulle part.
 */
export function ferieDuWeekEnd(annee: number, code: CodeFerie): 'samedi' | 'dimanche' | null {
  const f = feriesLegaux(annee).find(x => x.code === code);
  const j = f ? weekday(f.jour) : -1;
  return j === 5 ? 'samedi' : j === 6 ? 'dimanche' : null;
}

export interface ErreursFeries { annee?: string; solidarite?: string; solidariteFerie?: string; nonChomes?: string }
/**
 * Contrôle d'un réglage (dialogue et action) : année réglable, modalité connue, férié de solidarité choisi pour « autre
 * férié » (ni le 1er mai, ni le lundi de Pentecôte, qui a sa modalité, ni un férié qui tombe un samedi ou un dimanche
 * cette année-là), fériés non chômés connus (le 1er mai écarté, de
 * même que le férié de solidarité, déjà travaillé). Renvoie le réglage normalisé, sans auteur.
 */
export function controlerFeries(p: { annee?: unknown; solidarite?: unknown; solidariteFerie?: unknown; nonChomes?: unknown }, today: ISODate):
  { erreurs: ErreursFeries; annee: number | null; reglage: Pick<FeriesAnnee, 'solidarite' | 'solidariteFerie' | 'nonChomes'> | null } {
  const erreurs: ErreursFeries = {};
  const annee = Number(p.annee);
  const reglables = anneesReglables(today);
  if (!Number.isInteger(annee) || !reglables.includes(annee)) {
    erreurs.annee = annee < ANNEE_FERIES_MIN && Number.isInteger(annee)
      ? `Les fériés se règlent à partir de ${ANNEE_FERIES_MIN} (mise en service) : les années précédentes gardent le calendrier légal.`
      : `Année réglable : ${reglables.join(', ')} (jamais une année passée).`;
  }
  const solidarite = p.solidarite;
  if (!estModaliteSolidarite(solidarite)) erreurs.solidarite = 'Choisissez la modalité de la journée de solidarité.';
  const ferie = solidarite === 'autre_ferie' ? p.solidariteFerie : null;
  if (solidarite === 'autre_ferie') {
    if (!estCodeFerie(ferie)) erreurs.solidariteFerie = 'Choisissez le jour férié travaillé au titre de la journée de solidarité.';
    else if (ferie === '1er_mai') erreurs.solidariteFerie = 'Le 1er mai est toujours chômé (art. L3133-4) : choisissez un autre jour férié.';
    else if (ferie === 'pentecote') erreurs.solidariteFerie = 'Lundi de Pentecôte : choisissez la modalité « Lundi de Pentecôte travaillé ».';
    else if (!erreurs.annee) {
      const we = ferieDuWeekEnd(annee, ferie);
      if (we) erreurs.solidariteFerie = `${FERIES_LABEL[ferie]} tombe un ${we} en ${annee} : choisissez un férié de semaine, sans quoi la journée de solidarité n’est travaillée nulle part.`;
    }
  }
  const liste = Array.isArray(p.nonChomes) ? p.nonChomes : p.nonChomes == null ? [] : null;
  if (!liste || liste.some(c => !estCodeFerie(c))) erreurs.nonChomes = 'Fériés non chômés : liste de fériés inconnue.';
  else if (liste.includes('1er_mai')) erreurs.nonChomes = 'Le 1er mai est toujours chômé et payé (art. L3133-4).';
  if (Object.keys(erreurs).length) return { erreurs, annee: erreurs.annee ? null : annee, reglage: null };
  // Le férié de solidarité est déjà travaillé : il n'est pas répété parmi les non chômés.
  const solidaire: CodeFerie | null = solidarite === 'pentecote_travaillee' ? 'pentecote' : solidarite === 'autre_ferie' ? ferie as CodeFerie : null;
  const nonChomes = CODES_FERIES.filter(c => (liste as unknown[]).includes(c) && c !== solidaire);
  return { erreurs, annee, reglage: { solidarite: solidarite as ModaliteSolidarite, solidariteFerie: solidarite === 'autre_ferie' ? ferie as CodeFerie : null, nonChomes } };
}

/** Même réglage (modalité, férié de solidarité, fériés non chômés), auteur et motif mis à part. */
export const memeReglage = (a: Pick<FeriesAnnee, 'solidarite' | 'solidariteFerie' | 'nonChomes'>, b: Pick<FeriesAnnee, 'solidarite' | 'solidariteFerie' | 'nonChomes'>) =>
  a.solidarite === b.solidarite && (a.solidariteFerie ?? null) === (b.solidariteFerie ?? null) && [...a.nonChomes].sort().join() === [...b.nonChomes].sort().join();

const absenceRetenue = (a: Absence) => a.statut !== 'annulee' && a.statut !== 'refusee' && !a.annuleeLe;
const touche = (a: Pick<Absence, 'du' | 'au'>, annee: number) => a.du <= `${annee}-12-31` && a.au >= `${annee}-01-01`;

/**
 * Année déjà engagée : absences de l'année transmises à la paie (ou dans un lot à confirmer), congés clôturés sur une
 * période qui la couvre (CP : périodes de prise commencées le 1er juin de l'année précédente ou de l'année ; RTT : l'année).
 */
export function anneeEngagee(ds: Pick<Dataset, 'absences' | 'clotures'>, annee: number): { absences: number; clotures: number } {
  return {
    absences: ds.absences.filter(a => absenceRetenue(a) && touche(a, annee) && (a.sage || a.lotId != null)).length,
    clotures: ds.clotures.filter(c => (c.type === 'CP' ? c.periode === annee - 1 || c.periode === annee : c.periode === annee)).length,
  };
}
export const estEngagee = (x: { absences: number; clotures: number }) => x.absences + x.clotures > 0;

export interface AbsenceRecalculee { absence: Absence; avant: number; apres: number }
/**
 * Absences de l'année dont le décompte change avec le nouveau réglage (jours ouvrés décomptés, demi-journées comprises) :
 * annoncées avant l'enregistrement et dans le message. Calcul fait avec le calendrier du réglage, puis celui en vigueur rétabli.
 */
export function absencesRecalculees(d: Domain, annee: number, nouveau: Pick<FeriesAnnee, 'solidarite' | 'solidariteFerie' | 'nonChomes'>): AbsenceRecalculee[] {
  const actuel = d.ds.calendrierFeries ?? {};
  const avec: CalendrierFeries = { ...actuel, [String(annee)]: { le: '', par: '', ...nouveau } };
  const liste = d.ds.absences.filter(a => absenceRetenue(a) && touche(a, annee));
  const compte = (a: Absence) => {
    const e = d.emp(a.empId);
    return e ? d.countDays(e, a.du, a.au, a.type, a) : 0;
  };
  const avant = liste.map(compte);
  const apres = avecCalendrier(avec, () => liste.map(compte));
  return liste.map((absence, i) => ({ absence, avant: avant[i], apres: apres[i] })).filter(x => x.avant !== x.apres);
}

/** Fériés de l'année avec leur sort selon le réglage : chômé, journée de solidarité travaillée, travaillé. */
export function feriesDeLAnnee(annee: number, r: Pick<FeriesAnnee, 'solidarite' | 'solidariteFerie' | 'nonChomes'>): { code: CodeFerie; jour: ISODate; sort: 'chome' | 'solidarite' | 'travaille' }[] {
  const solidaire = r.solidarite === 'pentecote_travaillee' ? 'pentecote' : r.solidarite === 'autre_ferie' ? r.solidariteFerie : null;
  return feriesLegaux(annee).map(f => ({
    ...f, sort: f.code === '1er_mai' ? 'chome' : f.code === solidaire ? 'solidarite' : r.nonChomes.includes(f.code) ? 'travaille' : 'chome',
  }));
}
