// Entretiens : planification, comptes rendus, signatures. Un membre du service RH n'est jamais l'évaluateur
// de son propre entretien : son manager ou un autre membre du RH le conduit.
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { needsFinCarriere } from '../../../shared/rules/entretiens.ts';
import type { Entretien, EntretienType } from '../../../shared/types.ts';
import { ActionError, getEmp, isValidatorOf, refuserSoiMeme, str, type ActionHandler, type Ctx } from './context.ts';

function entretien(ctx: Ctx, id: unknown) {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

const planifier: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas planifier votre propre entretien');
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Planification réservée au manager ou au service RH', 403);
  const kind = str(p.kind) as EntretienType;
  if (!ENT_TYPES[kind]) throw new ActionError('Type d’entretien inconnu');
  if (!isValidDate(p.date) || p.date < ctx.d.ti) throw new ActionError('Date à venir requise');
  ctx.db.insert<Entretien>('entretiens', { empId: emp.id, type: kind, date: p.date, statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null });
  return `${ENT_TYPES[kind].nom} planifié le ${fmt(parse(p.date))} — convocation envoyée à ${emp.nom}`;
};

/** Modification d'une section du compte rendu ou de la case « information remise ». */
const modifier: ActionHandler = (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas rédiger, comme évaluateur, votre propre entretien');
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

const clore: ActionHandler = (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas clore votre propre entretien');
  if (x.statut !== 'planifie' || !isValidatorOf(ctx, e)) throw new ActionError('Clôture réservée à l’évaluateur', 403);
  ctx.db.update<Entretien>('entretiens', x.id, { statut: 'realise', signMgr: ctx.d.ti });
  return 'Compte rendu clos et signé — transmis au salarié pour signature';
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
