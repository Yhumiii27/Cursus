// Information du salarié sur ses congés payés à son retour d'un arrêt de maladie ou d'accident (`conges.informer`, service
// RH ; art. L3141-19-3). Règles : shared/rules/information-retour.ts. L'information est envoyée au salarié (e-mail aussitôt
// ou récapitulatif, jamais la nature de l'arrêt), enregistrée une fois par arrêt et par fin d'arrêt (table `informationsCp` :
// un arrêt prolongé après l'information est à informer de nouveau à son terme) avec les jours communiqués et l'échéance du
// report, et fait courir le report de 15 mois à partir de ce jour : les reports légaux du salarié qui couraient pendant la
// suite d'arrêts (depuis son premier jour) sont prolongés jusqu'à 15 mois après l'information au moins (art. L3141-19-1).
// Un membre du RH ne se l'adresse pas à lui-même (`refuserSoiMeme`).
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { echeanceInformation, estReportLegal } from '../../../shared/rules/clotures.ts';
import { contenuInformation, estArretSante, informationDonnee, retoursAInformer, texteInformation } from '../../../shared/rules/information-retour.ts';
import type { InformationCp, ReportCp } from '../../../shared/types.ts';
import { notifierInformationRetour } from '../notifications.ts';
import { ActionError, type ActionHandler, getEmp, refuserSoiMeme, requireRh } from './context.ts';

const informer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const a = ctx.ds.absences.find(x => x.id === Number(p.id));
  if (!a || !estArretSante(a.type)) throw new ActionError('Arrêt introuvable : l’information au retour porte sur un arrêt de maladie ou d’accident', 404);
  const emp = getEmp(ctx, a.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas vous adresser l’information sur vos propres congés : un autre membre du service RH le fait');
  const deja = informationDonnee(ctx.d, a);
  if (deja) return `Information de ${emp.nom} sur ses congés déjà donnée le ${fmtIso(deja.le)} pour cette absence`;
  const r = retoursAInformer(ctx.d).find(x => x.a.id === a.id);
  if (!r) {
    throw new ActionError(a.au >= ctx.d.ti ? 'Absence en cours : l’information se donne au retour du salarié' : 'Aucune information à donner pour cette absence (suivie d’un autre arrêt, salarié sorti ou retour antérieur à la mise en service)');
  }
  // Suite d'arrêts (accident puis maladie, prolongation saisie à part) : l'information porte sur toute la suite.
  const le = ctx.d.ti, c = contenuInformation(ctx.d, emp, r.suite, le), periode = { du: r.du, au: a.au };
  ctx.db.insert<InformationCp>('informationsCp', {
    empId: emp.id, absenceId: a.id, du: r.du, au: a.au, le, jours: c.jours, arret: c.arret, limite: c.limite, echeance: c.echeance, par: ctx.user.nom,
  });
  // Reports légaux qui couraient pendant la suite d'arrêts : 15 mois à compter de l'information au moins.
  const fin = echeanceInformation(le);
  const prolonges = ctx.ds.reports.filter(x => x.empId === emp.id && estReportLegal(x) && x.expire && x.expire >= r.du && x.expire < fin);
  prolonges.forEach(x => ctx.db.update<ReportCp>('reports', x.id, { expire: fin }));
  const envoi = notifierInformationRetour(ctx, emp, texteInformation(c, periode));
  const remise = envoi ? (envoi === 'immediat' ? 'envoyée par e-mail' : 'ajoutée à son récapitulatif quotidien') : 'enregistrée, sans e-mail (aucune adresse) : à lui remettre';
  return `Information de ${emp.nom} sur ses congés (absence ${periodeTexte(r.du, a.au)}) ${remise} — ${fJ(c.jours)} à prendre jusqu’au ${fmtIso(c.limite)}, report jusqu’au ${fmtIso(c.echeance)}`
    + (prolonges.length ? ` · ${plural(prolonges.length, 'report légal prolongé', 'reports légaux prolongés')} jusqu’au ${fmtIso(fin)}` : '');
};

export const informationRetourActions: Record<string, ActionHandler> = {
  'conges.informer': informer,
};
