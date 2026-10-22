// Historique des contrats (t074, t053) : renouvellement d'un CDD et annulation d'un avenant programmé. Le renouvellement
// prolonge la fin du contrat et s'inscrit dans l'historique (ligne `renouvellement` : nouveau terme, date de signature,
// référence de l'avenant) ; la fiche garde le terme initial. Durée maximale et nombre de renouvellements sont signalés,
// jamais bloqués (shared/rules/cdd.ts) ; un contrat dont le terme est passé ne se renouvelle plus. Un avenant programmé à une date future (changement
// d'organisation du temps saisi dans la fiche) s'annule tant qu'il n'est pas appliqué (server/src/avenants.ts).
import { addD, isValidDate } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { controleCdd } from '../../../shared/rules/cdd.ts';
import { sortieEnregistree, sorti } from '../../../shared/rules/contrats.ts';
import { renouvellementsDe } from '../../../shared/rules/historique-contrat.ts';
import { contratFige } from '../../../shared/rules/temps.ts';
import type { ContratHistorique, Employe } from '../../../shared/types.ts';
import { amorcer, inscrireLigne, refigerBrouillons } from '../avenants.ts';
import { ActionError, getEmp, refuserSoiMeme, requireRh, str, type ActionHandler } from './context.ts';

/** Référence d'un avenant : texte court du service RH (numéro, date de l'avenant), jamais recopié au journal. */
export const REFERENCE_MAX = 60;

/**
 * `id`, `jusquau` (nouveau terme, après la fin actuelle), `signeLe` (signature de l'avenant, aujourd'hui par défaut,
 * jamais future), `reference?`. CDD en cours seulement, sans sortie enregistrée.
 */
const renouveler: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas renouveler votre propre contrat');
  if (emp.typeContrat !== 'cdd') throw new ActionError('Seul un CDD se renouvelle : la fin d’une mission d’intérim ou d’une alternance se modifie dans la fiche');
  if (sortieEnregistree(emp)) throw new ActionError(`Sortie enregistrée le ${fmtIso(emp.fin!)} : annulez-la d’abord pour renouveler le contrat`);
  if (!emp.fin) throw new ActionError('CDD sans date de fin : saisissez-la dans la fiche');
  // Terme passé : le renouvellement devait être signé avant lui ; une relation de travail poursuivie après le terme fait du
  // contrat un CDI (art. L1243-11), qui se saisit dans la fiche, et un nouveau contrat est une nouvelle fiche.
  if (sorti(emp, ctx.d.ti)) throw new ActionError(`Contrat terminé le ${fmtIso(emp.fin)} : un renouvellement se signe avant le terme. Si le salarié a continué de travailler, le contrat est devenu un CDI (art. L1243-11) : passez la fiche en CDI ; sinon, un nouveau contrat se crée par une nouvelle fiche (délai de carence)`);
  const jusquau = str(p.jusquau);
  if (!isValidDate(jusquau)) throw new ActionError('Nouveau terme du contrat invalide');
  if (jusquau <= emp.fin) throw new ActionError(`Le nouveau terme doit suivre la fin actuelle du contrat (${fmtIso(emp.fin)})`);
  const signeLe = p.signeLe == null || p.signeLe === '' ? ctx.d.ti : str(p.signeLe);
  if (!isValidDate(signeLe)) throw new ActionError('Date de signature de l’avenant invalide');
  if (signeLe > ctx.d.ti) throw new ActionError('Date de signature future : enregistrez le renouvellement une fois l’avenant signé');
  if (signeLe < emp.entree) throw new ActionError('Date de signature antérieure à l’entrée');
  const reference = str(p.reference) || null;
  if (reference && reference.length > REFERENCE_MAX) throw new ActionError(`Référence de l’avenant : ${REFERENCE_MAX} caractères au plus`);

  amorcer(ctx.db, emp.id, ctx.d.ti);
  const ligne = inscrireLigne(ctx.db, {
    empId: emp.id, effet: addD(emp.fin, 1), nature: 'renouvellement', regime: contratFige(emp), jusquau, signeLe, reference,
  }, { nom: ctx.user.nom, empId: ctx.user.salarieId ?? null }, ctx.d.ti);
  const cddFinInitiale = emp.cddFinInitiale ?? emp.fin;
  ctx.db.update<Employe>('employes', emp.id, { fin: jusquau, cddFinInitiale });
  const n = renouvellementsDe(ctx.ds, emp.id).length + 1;
  const { warnings } = controleCdd({ ...emp, fin: jusquau, cddFinInitiale }, { renouvellements: n, reglages: ctx.ds.settings });
  return {
    message: `CDD de ${emp.nom} renouvelé jusqu’au ${fmtIso(jusquau)} (${n === 1 ? '1er renouvellement' : `${plural(n, 'renouvellement', 'renouvellements')}`})${warnings.map(w => ` · ${w.replace(/\.$/, '')}`).join('')}`,
    result: { ligne: ligne.id, renouvellements: n },
  };
};

/** `id` : ligne de l'historique d'un avenant programmé, pas encore appliqué. */
const annulerAvenant: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const l = ctx.db.get<ContratHistorique>('contratsHistorique', Number(p.id));
  if (!l || l.nature !== 'avenant') throw new ActionError('Avenant introuvable', 404);
  const emp = getEmp(ctx, l.empId);
  if (l.annuleLe) return { message: null, result: { empId: emp.id, effet: l.effet } };
  if (l.applique) throw new ActionError(`Avenant déjà appliqué le ${fmtIso(l.effet)} : un nouveau changement se saisit dans la fiche`, 409);
  ctx.db.update('contratsHistorique', l.id, { annuleLe: ctx.d.ti });
  const n = refigerBrouillons(ctx.db, emp.id);
  return {
    message: `Avenant du ${fmtIso(l.effet)} annulé pour ${emp.nom} : son organisation du temps reste ${ctx.d.contratOf(emp).label}${n ? ` · ${plural(n, 'feuille brouillon remise', 'feuilles brouillon remises')} sur ce régime` : ''}`,
    result: { empId: emp.id, effet: l.effet },
  };
};

export const avenantsActions = {
  'employe.renouvelerCdd': renouveler,
  'employe.annulerAvenant': annulerAvenant,
} satisfies Record<string, ActionHandler>;
