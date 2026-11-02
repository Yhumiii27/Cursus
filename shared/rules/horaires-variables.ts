// Horaires variables (lot 12, chantier C6, étape 2 ; horaires individualisés, art. L3121-48 à L3121-52) : un horaire du
// référentiel (Référentiels → Horaires) peut devenir variable. Il reçoit alors :
// - des plages fixes (présence obligatoire) et des plages mobiles (arrivée et départ au choix du salarié) : les plages
//   sont comprises dans l'amplitude de l'horaire, sans chevauchement, au moins une plage fixe, et des plages mobiles les
//   entourent (la première et la dernière sont mobiles) ; pas d'horaire variable de nuit (fin le lendemain) ;
// - une durée de référence (minutes par jour travaillé), qui remplace la durée de l'horaire dans le théorique du
//   débit-crédit (shared/rules/debit-credit.ts, server/src/pointages.ts) ;
// - les plafonds du report d'une semaine à l'autre et du cumul : supplétifs 3 h et 10 h (`REPORT_MAX_SEMAINE_MIN`,
//   `CUMUL_MAX_MIN`) ; d'autres valeurs exigent la référence de l'accord collectif (texte court, jamais recopié au journal).
// Un report dans les plafonds n'est pas une heure supplémentaire (art. L3121-51) ; au-delà, l'excédent est signalé.
// Le passage en horaire variable suppose que le CSE n'y soit pas opposé (art. L3121-48) : rappelé dans le dialogue.
// Contrôles partagés par le dialogue (client/src/dialogs/HoraireVariableDialog.tsx) et l'action
// (server/src/actions/horaires-variables.ts, `referentiel.horaire.variable`). Anomalie « hors plage fixe » des pointages :
// `horsPlagesFixes`.
import { fH } from '../format.ts';
import type { Horaire, ISODate, PlageHoraire } from '../types.ts';
import { CUMUL_MAX_MIN, REPORT_MAX_SEMAINE_MIN } from './debit-credit.ts';
import { dureeHoraire, finitLeLendemain, normaliserHeure } from './horaires.ts';
import { hhmmParis, instantParis } from './pointage.ts';

/** Six plages au plus ; durée de référence de 1 h à 12 h ; report de 0 à 12 h par semaine ; cumul de 0 à 50 h. */
export const PLAGES_MAX = 6;
export const DUREE_REFERENCE_MIN = 60;
export const DUREE_REFERENCE_MAX = 720;
export const REPORT_MAX = 720;
export const CUMUL_MAX = 3000;
export const ACCORD_VARIABLE_MAX = 120;
export const TYPES_PLAGE: Record<PlageHoraire['type'], string> = { fixe: 'Fixe (présence obligatoire)', mobile: 'Mobile (au choix du salarié)' };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Champs « horaire variable » d'un horaire (null : horaire fixe, ou champs pas encore saisis). */
export type ChampsVariables = Pick<Horaire, 'variable' | 'plages' | 'dureeReference' | 'reportMaxSemaine' | 'cumulMax' | 'accordVariable'>;
/** Horaire fixe : tous les champs vides. */
export const SANS_VARIABLE: ChampsVariables = { variable: false, plages: null, dureeReference: null, reportMaxSemaine: null, cumulMax: null, accordVariable: null };

export interface ErreursVariable { plages?: string; dureeReference?: string; reportMaxSemaine?: string; cumulMax?: string; accordVariable?: string }

/** Nombre entier de minutes saisi en heures (« 3 », « 7,5 », « 7:30 ») ; null si illisible. */
export function minutesSaisies(v: unknown): number | null {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  const hm = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})$/i.exec(t);
  if (hm) return Number(hm[2]) < 60 ? Number(hm[1]) * 60 + Number(hm[2]) : null;
  return /^\d{1,2}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 60) : null;
}

/**
 * Champs saisis pour l'horaire `h` : `variable` faux efface tout ; sinon plages (type, début, fin), durée de référence et
 * plafonds en minutes (vides : durée de l'horaire et plafonds supplétifs), référence de l'accord exigée pour des plafonds
 * différents des supplétifs.
 */
export function controlerHoraireVariable(h: Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'>, p: {
  variable?: unknown; plages?: unknown; dureeReference?: unknown; reportMaxSemaine?: unknown; cumulMax?: unknown; accordVariable?: unknown;
}): { erreurs: ErreursVariable; champs: ChampsVariables | null } {
  if (p.variable !== true) return { erreurs: {}, champs: SANS_VARIABLE };
  const erreurs: ErreursVariable = {};
  const plages: PlageHoraire[] = [];
  if (finitLeLendemain(h)) erreurs.plages = `L’horaire ${h.code} finit le lendemain : un horaire de nuit ne devient pas variable.`;
  else if (!Array.isArray(p.plages) || !p.plages.length) erreurs.plages = 'Indiquez au moins une plage fixe, entourée de plages mobiles.';
  else if (p.plages.length > PLAGES_MAX) erreurs.plages = `${PLAGES_MAX} plages au plus.`;
  else {
    for (const [i, x] of (p.plages as unknown[]).entries()) {
      const o = (x ?? {}) as Record<string, unknown>;
      const debut = normaliserHeure(o.debut), fin = normaliserHeure(o.fin);
      if (o.type !== 'fixe' && o.type !== 'mobile') { erreurs.plages = `Plage ${i + 1} : choisissez fixe ou mobile.`; break; }
      if (!debut || !fin) { erreurs.plages = `Plage ${i + 1} : heures de début et de fin attendues (9:00, 11 h 30…).`; break; }
      if (minutes(fin) <= minutes(debut)) { erreurs.plages = `Plage ${i + 1} : la fin doit suivre le début, le même jour.`; break; }
      plages.push({ type: o.type, debut, fin });
    }
    if (!erreurs.plages) {
      plages.sort((a, b) => minutes(a.debut) - minutes(b.debut));
      const a0 = minutes(h.debut), a1 = minutes(h.fin);
      if (plages.some(x => minutes(x.debut) < a0 || minutes(x.fin) > a1)) erreurs.plages = `Les plages restent dans l’amplitude de l’horaire (${h.debut} – ${h.fin}).`;
      else if (plages.some((x, i) => i > 0 && minutes(x.debut) < minutes(plages[i - 1].fin))) erreurs.plages = 'Les plages ne se chevauchent pas.';
      else if (!plages.some(x => x.type === 'fixe')) erreurs.plages = 'Au moins une plage fixe (présence obligatoire).';
      else if (plages[0].type !== 'mobile' || plages.at(-1)!.type !== 'mobile') erreurs.plages = 'La première et la dernière plage sont mobiles : elles entourent les plages fixes (arrivée et départ au choix).';
    }
  }
  const lire = (v: unknown, defaut: number) => (String(v ?? '').trim() === '' ? defaut : typeof v === 'number' ? v : minutesSaisies(v));
  const duree = lire(p.dureeReference, Math.round(dureeHoraire(h) * 60));
  const report = lire(p.reportMaxSemaine, REPORT_MAX_SEMAINE_MIN), cumul = lire(p.cumulMax, CUMUL_MAX_MIN);
  if (duree == null || !Number.isInteger(duree) || duree < DUREE_REFERENCE_MIN || duree > DUREE_REFERENCE_MAX) erreurs.dureeReference = `Durée de référence : de ${fH(DUREE_REFERENCE_MIN / 60)} à ${fH(DUREE_REFERENCE_MAX / 60)} par jour.`;
  if (report == null || !Number.isInteger(report) || report < 0 || report > REPORT_MAX) erreurs.reportMaxSemaine = `Report d’une semaine : de 0 à ${fH(REPORT_MAX / 60)}.`;
  if (cumul == null || !Number.isInteger(cumul) || cumul < 0 || cumul > CUMUL_MAX) erreurs.cumulMax = `Cumul : de 0 à ${fH(CUMUL_MAX / 60)}.`;
  else if (report != null && cumul < report) erreurs.cumulMax = 'Le cumul autorisé ne peut pas être inférieur au report d’une semaine.';
  const accord = String(p.accordVariable ?? '').replace(/\s+/g, ' ').trim();
  const suppletifs = report === REPORT_MAX_SEMAINE_MIN && cumul === CUMUL_MAX_MIN;
  if (accord.length > ACCORD_VARIABLE_MAX) erreurs.accordVariable = `Référence de l’accord : ${ACCORD_VARIABLE_MAX} caractères au plus.`;
  else if (!suppletifs && !accord) erreurs.accordVariable = `Des plafonds autres que ${fH(REPORT_MAX_SEMAINE_MIN / 60)} par semaine et ${fH(CUMUL_MAX_MIN / 60)} de cumul exigent la référence de l’accord collectif.`;
  if (Object.keys(erreurs).length) return { erreurs, champs: null };
  return { erreurs, champs: { variable: true, plages, dureeReference: duree, reportMaxSemaine: report, cumulMax: cumul, accordVariable: accord || null } };
}

/**
 * Modification du début, de la fin ou de la pause d'un horaire déjà variable (`referentiel.horaire.enregistrer`) : refus
 * quand ses plages enregistrées ne tiennent plus dans la nouvelle amplitude, ou quand il devient un horaire de nuit (mêmes
 * contrôles que `controlerHoraireVariable`). Il faut alors le repasser d'abord en horaire fixe, puis le rendre variable
 * de nouveau avec des plages adaptées. Horaire fixe, ou plages toujours valides : null.
 */
export function refusModificationVariable(avant: Horaire, apres: Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'>): string | null {
  if (!estVariable(avant)) return null;
  const { erreurs } = controlerHoraireVariable(apres, {
    variable: true, plages: avant.plages, dureeReference: avant.dureeReference ?? '', reportMaxSemaine: avant.reportMaxSemaine ?? '',
    cumulMax: avant.cumulMax ?? '', accordVariable: avant.accordVariable ?? '',
  });
  if (!erreurs.plages) return null;
  return `Horaire ${avant.code} variable (${plagesTexte(avant.plages ?? [])}) : ${erreurs.plages.replace(/\.$/, '')}. Repassez-le d’abord en horaire fixe (« Horaire variable »), puis rendez-le variable avec des plages adaptées.`;
}

/** Horaire variable en vigueur (plages enregistrées) : sinon null. */
export const estVariable = (h: Pick<Horaire, 'variable' | 'plages'> | null | undefined): boolean => !!h?.variable && (h.plages?.length ?? 0) > 0;

/** « mobile 7 h – 9 h · fixe 9 h – 11 h 30 · … » */
export const plagesTexte = (plages: readonly PlageHoraire[]) => plages.map(p => `${p.type} ${p.debut} – ${p.fin}`).join(' · ');

/** Plage fixe d'un jour non couverte par les intervalles travaillés : début du premier manque. */
export interface ManquePlageFixe { plage: PlageHoraire; manque: string }

/**
 * Plages fixes du jour `jour` (heure de Paris) que les intervalles travaillés `paires` (instants en ms) ne couvrent pas
 * entièrement : arrivée après le début, départ avant la fin, ou sortie pendant la plage. Rendues avec l'heure du premier
 * manque. Un jour sans aucun pointage n'en rend aucune (« jour prévu sans pointage » le dit déjà). `jusqua` (ms, jour en
 * cours) : seules les plages fixes finies à cet instant sont jugées, une plage à venir ou en cours n'est pas encore manquée.
 */
export function horsPlagesFixes(plages: readonly PlageHoraire[], jour: ISODate, paires: readonly (readonly [number, number])[], jusqua?: number): ManquePlageFixe[] {
  if (!paires.length) return [];
  const tri = [...paires].sort((a, b) => a[0] - b[0]);
  const out: ManquePlageFixe[] = [];
  for (const p of plages) {
    if (p.type !== 'fixe') continue;
    const de = instantParis(jour, minutes(p.debut)), a = instantParis(jour, minutes(p.fin));
    if (jusqua != null && a > jusqua) continue;
    let t = de;
    for (const [x, y] of tri) {
      if (y <= t) continue;
      if (x > t) break;
      t = Math.max(t, y);
      if (t >= a) break;
    }
    if (t < a) out.push({ plage: p, manque: hhmmParis(t) });
  }
  return out;
}
