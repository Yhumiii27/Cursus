// Jours fériés de l'établissement et journée de solidarité, réglés par année civile (t051, shared/rules/feries.ts) :
// administrateur RH seul (Paramètres → Jours fériés), clé `calendrierFeries` de la table settings, transmise à tous les
// espaces sans le motif (server/src/dataset.ts). Réglable à partir de 2027, jamais pour une année passée : un réglage ne
// change que les décomptes de son année. Une année déjà engagée (absences transmises à la paie, congés clôturés) ne se
// modifie qu'avec un motif (500 caractères, gardé pour le service RH, jamais recopié au journal) ; le message nomme les
// absences dont le décompte change.
import { fmtIso, plural } from '../../../shared/format.ts';
import {
  absencesRecalculees, anneeEngagee, controlerFeries, estEngagee, FERIES_LABEL, memeReglage, MODALITES_SOLIDARITE, MOTIF_FERIES_MAX, reglageAnnee,
} from '../../../shared/rules/feries.ts';
import type { CalendrierFeries } from '../../../shared/types.ts';
import type { Db } from '../db.ts';
import { ActionError, type ActionHandler, requireRhAdmin, str } from './context.ts';

export const CLE_FERIES = 'calendrierFeries';
export const lireCalendrierFeries = async (db: Db) => await db.getSetting<CalendrierFeries>(CLE_FERIES, {});

/** annee, solidarite, solidariteFerie? (`autre_ferie`), nonChomes [codes], motif? (exigé pour une année engagée). */
const regler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const { erreurs, annee, reglage } = controlerFeries(p, ctx.d.ti);
  const erreur = erreurs.annee ?? erreurs.solidarite ?? erreurs.solidariteFerie ?? erreurs.nonChomes;
  if (erreur || annee == null || !reglage) throw new ActionError(erreur ?? 'Réglage invalide');
  const calendrier = await lireCalendrierFeries(ctx.db);
  if (memeReglage(reglageAnnee(calendrier, annee), reglage)) return null;
  const recalculees = absencesRecalculees(ctx.d, annee, reglage);
  const engagee = anneeEngagee(ctx.ds, annee);
  const motif = str(p.motif).replace(/\s+/g, ' ');
  if (estEngagee(engagee) && !motif) {
    const quoi = [
      engagee.absences ? plural(engagee.absences, 'absence transmise à la paie', 'absences transmises à la paie') : '',
      engagee.clotures ? plural(engagee.clotures, 'clôture de congés', 'clôtures de congés') : '',
    ].filter(Boolean).join(' et ');
    throw new ActionError(`Année ${annee} déjà engagée (${quoi}) : indiquez le motif de la modification`, 409);
  }
  if (motif.length > MOTIF_FERIES_MAX) throw new ActionError(`Motif : ${MOTIF_FERIES_MAX} caractères au plus`);
  await ctx.db.setSetting(CLE_FERIES, { ...calendrier, [String(annee)]: { ...reglage, le: ctx.d.ti, par: ctx.user.nom, ...(motif ? { motif } : {}) } });
  const solidarite = reglage.solidarite === 'autre_ferie' ? `${FERIES_LABEL[reglage.solidariteFerie!]} travaillé (journée de solidarité)` : MODALITES_SOLIDARITE[reglage.solidarite].label.replace(' (par défaut)', '');
  const nonChomes = reglage.nonChomes.length ? ` · non chômés : ${reglage.nonChomes.map(c => FERIES_LABEL[c]).join(', ')}` : ' · autres fériés chômés';
  const absences = recalculees.length
    ? ` · ${plural(recalculees.length, 'absence recalculée', 'absences recalculées')} : ${recalculees.slice(0, 10).map(x => `${ctx.d.personName(x.absence.empId)} du ${fmtIso(x.absence.du)} (${x.avant} → ${x.apres} j)`).join(', ')}${recalculees.length > 10 ? '…' : ''}`
    : '';
  return { message: `Jours fériés ${annee} : ${solidarite}${nonChomes}${absences}`, result: { salaries: [...new Set(recalculees.map(x => x.absence.empId))] } };
};

export const feriesActions: Record<string, ActionHandler> = {
  'parametres.feries': regler,
};
