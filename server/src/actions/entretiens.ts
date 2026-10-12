// Entretiens : planification, comptes rendus, signatures.
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { needsFinCarriere } from '../../../shared/rules/entretiens.ts';
import type { Entretien, EntretienType } from '../../../shared/types.ts';
import { ActionError, getEmp, isValidatorOf, str, type ActionHandler, type Ctx } from './context.ts';

function entretien(ctx: Ctx, id: unknown) {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

const planifier: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Planification réservée au manager ou au service RH', 403);
  const kind = str(p.kind) as EntretienType;
  if (!ENT_TYPES[kind]) throw new ActionError('Type d’entretien inconnu');
  if (!isValidDate(p.date) || p.date < ctx.d.ti) throw new ActionError('Date à venir requise');
  // Un seul entretien planifié par type : à venir, il est déjà prévu ; passé sans avoir été tenu, il est reprogrammé.
  const prevu = ctx.ds.entretiens.find(x => x.empId === emp.id && x.type === kind && x.statut === 'planifie');
  if (prevu && prevu.date >= ctx.d.ti) throw new ActionError(`${ENT_TYPES[kind].nom} déjà planifié le ${fmt(parse(prevu.date))} pour ${emp.nom} : clôturez-le une fois tenu`);
  // Salarié absent ce jour-là (congé validé, arrêt…) : refusé.
  const conflit = blocage(conflitsDates(ctx.d, emp.id, p.date, p.date, 'entretien', { entretienId: prevu?.id }));
  if (conflit) throw new ActionError(conflit);
  if (prevu) {
    ctx.db.update<Entretien>('entretiens', prevu.id, { date: p.date });
    return `${ENT_TYPES[kind].nom} reprogrammé le ${fmt(parse(p.date))} (prévu le ${fmt(parse(prevu.date))}, non tenu) — convocation envoyée à ${emp.nom}`;
  }
  ctx.db.insert<Entretien>('entretiens', { empId: emp.id, type: kind, date: p.date, statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null });
  return `${ENT_TYPES[kind].nom} planifié le ${fmt(parse(p.date))} — convocation envoyée à ${emp.nom}`;
};

/** Modification d'une section du compte rendu ou de la case « information remise ». */
const modifier: ActionHandler = (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  const canMgr = x.statut === 'planifie' && isValidatorOf(ctx, e);
  // Le salarié rédige ses sections jusqu'à sa signature (y compris après clôture par l'évaluateur).
  const canSal = !x.signSal && ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;
  if (p.section) {
    const sections = [...ENT_TYPES[x.type].sections, ...(needsFinCarriere(ctx.d, e, x.type) ? [['fincarriere', '', 'sal'] as const] : [])];
    const sec = sections.find(s => s[0] === p.section);
    if (!sec) throw new ActionError('Section inconnue');
    const allowed = sec[2] === 'mgr' ? canMgr : canSal || canMgr;
    if (!allowed) throw new ActionError('Section non modifiable', 403);
    ctx.db.update<Entretien>('entretiens', x.id, { cr: { ...x.cr, [p.section]: String(p.value ?? '') } });
  }
  if (typeof p.info === 'boolean') {
    if (!canMgr) throw new ActionError('Réservé à l’évaluateur', 403);
    ctx.db.update<Entretien>('entretiens', x.id, { info: p.info });
  }
  return null;
};

/**
 * Clôture par l'évaluateur, une fois l'entretien tenu : `date` (facultative) est la date à laquelle il a eu lieu, aujourd'hui
 * au plus tard ; elle remplace la date prévue. Un entretien à venir ne se clôt pas sur sa date prévue : il fausserait
 * l'échéance suivante (tous les 4 ans) et l'état des lieux à 8 ans.
 */
const clore: ActionHandler = (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  if (x.statut !== 'planifie' || !isValidatorOf(ctx, e)) throw new ActionError('Clôture réservée à l’évaluateur', 403);
  const date = p.date ? p.date : x.date;
  if (!isValidDate(date)) throw new ActionError('Date de l’entretien invalide');
  if (date > ctx.d.ti) {
    throw new ActionError(p.date
      ? 'Date de l’entretien : aujourd’hui au plus tard'
      : `Entretien prévu le ${fmt(parse(x.date))} : il se clôt une fois tenu — indiquez la date à laquelle il a eu lieu (aujourd’hui au plus tard)`);
  }
  if (date < e.entree) throw new ActionError(`Date antérieure à l’entrée de ${e.nom} (${fmt(parse(e.entree))})`);
  ctx.db.update<Entretien>('entretiens', x.id, { statut: 'realise', date, signMgr: ctx.d.ti });
  return `Compte rendu clos et signé${date !== x.date ? ` — entretien daté du ${fmt(parse(date))}` : ''} — transmis au salarié pour signature`;
};

const signer: ActionHandler = (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  if (ctx.user.role !== 'collaborateur' || ctx.user.empId !== e.id || x.statut !== 'realise' || x.signSal) throw new ActionError('Signature impossible', 403);
  ctx.db.update<Entretien>('entretiens', x.id, { signSal: ctx.d.ti });
  return 'Compte rendu signé — votre copie est disponible dans Mes entretiens';
};

export const entretiensActions: Record<string, ActionHandler> = {
  'entretien.planifier': planifier,
  'entretien.modifier': modifier,
  'entretien.clore': clore,
  'entretien.signer': signer,
};
