// Entretiens : planification, comptes rendus, signatures. Un membre du service RH n'est jamais l'évaluateur
// de son propre entretien : son manager ou un autre membre du RH le conduit.
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { horsContratLe } from '../../../shared/rules/contrats.ts';
import { debutCloture, needsFinCarriere, reprogrammation } from '../../../shared/rules/entretiens.ts';
import { remisePhysique } from '../../../shared/rules/remise.ts';
// lot 12 — C3 (entretiens suivis)
import { blocageClotureObjectifs } from '../../../shared/rules/objectifs.ts';
import { texteVersement, verserSouhaits } from './souhaits.ts';
import type { Entretien, EntretienType } from '../../../shared/types.ts';
import { convoquerEntretien, notifierEntretienClos } from '../notifications.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isValidatorOf, refuserSoiMeme, str } from './context.ts';

function entretien(ctx: Ctx, id: unknown) {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

const planifier: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas planifier votre propre entretien');
  if (!isValidatorOf(ctx, emp, 'entretiens')) throw new ActionError('Planification réservée au manager ou au service RH', 403);
  const kind = str(p.kind) as EntretienType;
  if (!ENT_TYPES[kind]) throw new ActionError('Type d’entretien inconnu');
  if (!isValidDate(p.date) || p.date < ctx.d.ti) throw new ActionError('Date à venir requise');
  const hors = horsContratLe(emp, p.date);
  if (hors) throw new ActionError(hors);
  // Un seul entretien planifié par type : déjà prévu (à venir, ou passé sans avoir été clos), il est reprogrammé. Passé avec un
  // compte rendu commencé, il a pu avoir lieu : reprogrammé seulement sur confirmation qu'il n'a pas été tenu (`nonTenu`).
  const { prevu, msg } = reprogrammation(ctx.d, emp.id, kind, p.date, p.nonTenu === true);
  if (msg?.bad) throw new ActionError(msg.text);
  // Salarié absent ce jour-là (congé validé, arrêt…) : refusé.
  const conflit = blocage(conflitsDates(ctx.d, emp.id, p.date, p.date, 'entretien', { entretienId: prevu?.id }));
  if (conflit) throw new ActionError(conflit);
  // Convocation par e-mail, avec le fichier .ics (même événement d'agenda : une reprogrammation le déplace) ; sans adresse,
  // elle est à remettre au salarié.
  const convocation = async (x: Pick<Entretien, 'id' | 'type' | 'date'>) => await convoquerEntretien(ctx, emp, x)
    ? `convocation envoyée à ${emp.nom}` : `convocation à remettre à ${emp.nom} (aucune adresse e-mail)`;
  // `planifieLe` : la date réelle saisie à la clôture n'est pas antérieure à la planification (`debutCloture`).
  if (prevu) {
    await ctx.db.update<Entretien>('entretiens', prevu.id, { date: p.date, planifieLe: ctx.d.ti });
    return `${ENT_TYPES[kind].nom} reprogrammé le ${fmt(parse(p.date))} (prévu le ${fmt(parse(prevu.date))}${prevu.date < ctx.d.ti ? ', non tenu' : ''}) — ${await convocation({ ...prevu, date: p.date })}`;
  }
  const x = await ctx.db.insert<Entretien>('entretiens', { empId: emp.id, type: kind, date: p.date, statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null, planifieLe: ctx.d.ti });
  return `${ENT_TYPES[kind].nom} planifié le ${fmt(parse(p.date))} — ${await convocation(x)}`;
};

/** Modification d'une section du compte rendu ou de la case « information remise ». */
const modifier: ActionHandler = async (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas rédiger, comme évaluateur, votre propre entretien');
  const canMgr = x.statut === 'planifie' && isValidatorOf(ctx, e, 'entretiens');
  // Le salarié rédige ses sections jusqu'à sa signature (y compris après clôture par l'évaluateur), ou jusqu'à la remise
  // d'une copie sur papier, qui fait foi (main propre, refus de signer : shared/rules/remise.ts).
  const canSal = !x.signSal && !remisePhysique(x) && ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;
  if (p.section) {
    const sections = [...ENT_TYPES[x.type].sections, ...(needsFinCarriere(ctx.d, e, x) ? [['fincarriere', '', 'sal'] as const] : [])];
    const sec = sections.find(s => s[0] === p.section);
    if (!sec) throw new ActionError('Section inconnue');
    const allowed = sec[2] === 'mgr' ? canMgr : canSal || canMgr;
    if (!allowed) throw new ActionError('Section non modifiable', 403);
    await ctx.db.update<Entretien>('entretiens', x.id, { cr: { ...x.cr, [p.section]: String(p.value ?? '') } });
  }
  if (typeof p.info === 'boolean') {
    if (!canMgr) throw new ActionError('Réservé à l’évaluateur', 403);
    await ctx.db.update<Entretien>('entretiens', x.id, { info: p.info });
  }
  return null;
};

/**
 * Clôture par l'évaluateur, une fois l'entretien tenu : `date` (facultative) est la date à laquelle il a eu lieu, aujourd'hui
 * au plus tard et pas avant sa planification (`debutCloture`) ; elle remplace la date prévue. Un entretien à venir ne se
 * clôt pas sur sa date prévue, ni un entretien sur une date ancienne : l'un et l'autre fausseraient l'échéance suivante
 * (tous les 4 ans) et l'état des lieux à 8 ans.
 */
const clore: ActionHandler = async (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas clore votre propre entretien');
  if (x.statut !== 'planifie' || !isValidatorOf(ctx, e, 'entretiens')) throw new ActionError('Clôture réservée à l’évaluateur', 403);
  const date = p.date ? p.date : x.date;
  if (!isValidDate(date)) throw new ActionError('Date de l’entretien invalide');
  if (date > ctx.d.ti) {
    throw new ActionError(p.date
      ? 'Date de l’entretien : aujourd’hui au plus tard'
      : `Entretien prévu le ${fmt(parse(x.date))} : il se clôt une fois tenu — indiquez la date à laquelle il a eu lieu (aujourd’hui au plus tard)`);
  }
  const debut = debutCloture(ctx.d, x);
  if (date < debut.min) throw new ActionError(`Date de l’entretien : le ${fmt(parse(debut.min))} au plus tôt (${debut.raison})`);
  // lot 12 — C3 (entretiens suivis) : propositions d'objectifs à valider ou retirer ; objectifs repris à évaluer, sauf en
  // mode « objectifs facultatifs » (shared/rules/objectifs.ts).
  const objectifs = blocageClotureObjectifs(ctx.ds.objectifs ?? [], ctx.ds.entretiens, x, ctx.ds.settings);
  if (objectifs) throw new ActionError(objectifs, 409);
  await ctx.db.update<Entretien>('entretiens', x.id, { statut: 'realise', date, signMgr: ctx.d.ti });
  // lot 12 — C3 : souhaits de formation à avis favorable versés au service RH (server/src/actions/souhaits.ts).
  const versement = await verserSouhaits(ctx, e, { ...x, date });
  await notifierEntretienClos(ctx, e, { ...x, date });
  return {
    message: `Compte rendu clos et signé${date !== x.date ? ` — entretien daté du ${fmt(parse(date))}` : ''} — transmis au salarié pour signature${texteVersement(versement)}`,
    result: { demandes: versement.versees, ecartes: versement.ecartes },
  };
};

const signer: ActionHandler = async (ctx, p) => {
  const { x, e } = entretien(ctx, p.id);
  if (ctx.user.role !== 'collaborateur' || ctx.user.empId !== e.id || x.statut !== 'realise' || x.signSal) throw new ActionError('Signature impossible', 403);
  await ctx.db.update<Entretien>('entretiens', x.id, { signSal: ctx.d.ti });
  return 'Compte rendu signé — votre copie est disponible dans Mes entretiens';
};

export const entretiensActions = {
  'entretien.planifier': planifier,
  'entretien.modifier': modifier,
  'entretien.clore': clore,
  'entretien.signer': signer,
} satisfies Record<string, ActionHandler>;
