// Objectifs suivis (lot 12, chantier C3, t194 ; règles : shared/rules/objectifs.ts). Choix par défaut du chantier :
// - fixés (`objectif.ajouter`, `modifier`, `retirer`) par l'évaluateur à l'entretien annuel, tant qu'il est planifié ;
// - proposés par le salarié (`objectif.proposer`, statut « proposé »), que l'évaluateur valide en les modifiant, ou retire ;
// - suivis en cours d'année : avancement par le salarié ou l'évaluateur (`objectif.avancer`), ajustement daté et motivé
//   par l'évaluateur (`objectif.ajuster`), le libellé d'origine conservé ;
// - évalués à l'entretien annuel suivant (`objectif.evaluer`) : atteint, partiellement, non atteint, sans objet (motif),
//   ou reconduit (nouvelle ligne fixée à cet entretien).
// Évaluateur : manager direct, service RH (jamais pour soi-même), suppléant d'une délégation « entretiens » (t135),
// comme les entretiens (`isValidatorOf(ctx, e, 'entretiens')`). Jamais d'objectif dans un entretien de parcours
// professionnel (art. L6315-1), contrôlé ici et pas seulement à l'écran. Journal : identifiants, codes, dates, statuts ;
// jamais le libellé, la mesure, l'évaluation ni un commentaire (server/src/journal.ts).
import { fmtIso, plural } from '../../../shared/format.ts';
import {
  COMMENTAIRE_SAL_MAX, EVALUATION_MAX, estStatutEvaluation, lireAvancement, lireObjectif, MOTIF_AJUSTEMENT_MAX, objectifsFixesA, refusPoids,
  refusTypeObjectifs, STATUT_OBJECTIF_LABEL,
} from '../../../shared/rules/objectifs.ts';
import { souhaitsDe } from '../../../shared/rules/souhaits.ts';
import type { Employe, Entretien, Objectif } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isValidatorOf, refuserSoiMeme, str } from './context.ts';

const maintenant = () => new Date().toISOString();

function entretienDe(ctx: Ctx, id: unknown): { x: Entretien; e: Employe } {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

function objectifDe(ctx: Ctx, id: unknown): { o: Objectif; e: Employe } {
  const o = (ctx.ds.objectifs ?? []).find(y => y.id === Number(id));
  if (!o) throw new ActionError('Objectif introuvable', 404);
  return { o, e: getEmp(ctx, o.empId) };
}

/** Le salarié lui-même, dans son espace collaborateur. */
const estSalarie = (ctx: Ctx, e: Employe) => ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;

/** Évaluateur du salarié (manager direct, service RH, suppléant « entretiens »), jamais pour soi-même : sinon refus 403. */
function exigerEvaluateur(ctx: Ctx, e: Employe, refus: string) {
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas fixer ni évaluer vos propres objectifs');
  if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError(refus, 403);
}

function exigerActifs(ctx: Ctx) {
  if (!ctx.ds.settings.objectifsActifs) throw new ActionError('Objectifs non suivis dans Cursus (Paramètres → Entretiens)', 409);
}

/** Entretien encore planifié : les objectifs s'y fixent ; clos, ils sont figés (ajustement en cours d'année). */
function exigerPlanifie(x: Entretien) {
  if (x.statut !== 'planifie') throw new ActionError('Entretien clos : ses objectifs sont figés ; en cours d’année, ajustez-les avec un motif', 409);
}

function exigerType(x: Entretien) {
  const refus = refusTypeObjectifs(x.type, true);
  if (refus) throw new ActionError(refus);
}

/** Nombre d'objectifs fixés (ou proposés) à l'entretien : au plus le réglage `objectifsMax`. */
function exigerPlace(ctx: Ctx, x: Entretien) {
  const max = ctx.ds.settings.objectifsMax;
  if (objectifsFixesA(ctx.ds.objectifs ?? [], x.id).length >= max) throw new ActionError(`${plural(max, 'objectif', 'objectifs')} au plus par entretien (Paramètres → Entretiens)`);
}

function saisie(p: Record<string, unknown>, actuel?: Objectif) {
  const s = lireObjectif(p, actuel);
  if (typeof s === 'string') throw new ActionError(s);
  return s;
}

function exigerPoids(ctx: Ctx, entretienId: number, poids: number | null, sauf?: number) {
  const refus = refusPoids(ctx.ds.objectifs ?? [], entretienId, poids, sauf);
  if (refus) throw new ActionError(refus);
}

/** Commentaire libre borné, ou null. */
function commentaire(v: unknown, max: number, nom: string): string | null {
  const t = str(v);
  if (t.length > max) throw new ActionError(`${nom} trop long (${max} caractères au plus)`);
  return t || null;
}

const ajouter: ActionHandler = async (ctx, p) => {
  const { x, e } = entretienDe(ctx, p.entretienId);
  exigerEvaluateur(ctx, e, 'Objectifs fixés par l’évaluateur (manager ou service RH)');
  exigerActifs(ctx);
  exigerPlanifie(x);
  exigerType(x);
  exigerPlace(ctx, x);
  const s = saisie(p);
  exigerPoids(ctx, x.id, s.poids);
  const o = await ctx.db.insert<Objectif>('objectifs', {
    empId: e.id, entretienId: x.id, evalueEntretienId: null, reconduitDe: null, ...s, avancement: 0, statut: 'ouvert', evaluation: null, commentaireSal: null,
    creeLe: maintenant(), creePar: ctx.user.nom, modifieLe: null, modifiePar: null, ajusteLe: null, ajusteMotif: null, libelleInitial: null,
  });
  return { message: `Objectif fixé — ${e.nom}`, result: { id: o.id } };
};

/** Le salarié propose un objectif à l'entretien annuel planifié ; l'évaluateur le valide (en le modifiant) ou le retire. */
const proposer: ActionHandler = async (ctx, p) => {
  const { x, e } = entretienDe(ctx, p.entretienId);
  if (!estSalarie(ctx, e)) throw new ActionError('Proposition réservée au salarié, depuis son espace', 403);
  exigerActifs(ctx);
  exigerPlanifie(x);
  exigerType(x);
  exigerPlace(ctx, x);
  const s = saisie(p);
  exigerPoids(ctx, x.id, s.poids);
  const o = await ctx.db.insert<Objectif>('objectifs', {
    empId: e.id, entretienId: x.id, evalueEntretienId: null, reconduitDe: null, ...s, avancement: 0, statut: 'propose', evaluation: null, commentaireSal: null,
    creeLe: maintenant(), creePar: ctx.user.nom, modifieLe: null, modifiePar: null, ajusteLe: null, ajusteMotif: null, libelleInitial: null,
  });
  return { message: 'Objectif proposé — votre évaluateur le validera avant la clôture de l’entretien', result: { id: o.id } };
};

/** Modification par l'évaluateur, tant que l'entretien qui fixe l'objectif est planifié ; une proposition est ainsi validée. */
const modifier: ActionHandler = async (ctx, p) => {
  const { o, e } = objectifDe(ctx, p.id);
  const { x } = entretienDe(ctx, o.entretienId);
  exigerEvaluateur(ctx, e, 'Objectifs modifiés par l’évaluateur (manager ou service RH)');
  exigerActifs(ctx);
  exigerPlanifie(x);
  if (o.statut !== 'ouvert' && o.statut !== 'propose') throw new ActionError(`Objectif ${STATUT_OBJECTIF_LABEL[o.statut].toLowerCase()} : il ne se modifie plus`, 409);
  const s = saisie(p, o);
  exigerPoids(ctx, x.id, s.poids, o.id);
  await ctx.db.update<Objectif>('objectifs', o.id, { ...s, statut: 'ouvert', modifieLe: maintenant(), modifiePar: ctx.user.nom });
  return o.statut === 'propose' ? `Objectif proposé par ${e.nom} validé` : `Objectif modifié — ${e.nom}`;
};

/** Souhaits de formation de l'entretien `x` liés à l'objectif `id`, qui va être supprimé : ils n'y sont plus liés. */
async function delierSouhaits(ctx: Ctx, x: Entretien, id: number) {
  const souhaits = souhaitsDe(x);
  if (souhaits.some(s => s.objectifId === id)) {
    await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: souhaits.map(s => (s.objectifId === id ? { ...s, objectifId: null } : s)) });
  }
}

/**
 * Retrait tant que l'entretien qui le fixe est planifié : par l'évaluateur, ou par le salarié pour sa propre proposition.
 * Une ligne reconduite se défait en changeant l'évaluation de l'objectif d'origine. Un souhait de formation qui le citait
 * n'y est plus lié.
 */
const retirer: ActionHandler = async (ctx, p) => {
  const { o, e } = objectifDe(ctx, p.id);
  const { x } = entretienDe(ctx, o.entretienId);
  if (!(estSalarie(ctx, e) && o.statut === 'propose')) exigerEvaluateur(ctx, e, 'Objectifs retirés par l’évaluateur (manager ou service RH), ou par le salarié pour sa proposition');
  exigerPlanifie(x);
  if (o.reconduitDe) throw new ActionError('Objectif reconduit : changez l’évaluation de l’objectif d’origine pour défaire la reconduction', 409);
  if (o.statut !== 'ouvert' && o.statut !== 'propose') throw new ActionError(`Objectif ${STATUT_OBJECTIF_LABEL[o.statut].toLowerCase()} : il ne se retire plus`, 409);
  await delierSouhaits(ctx, x, o.id);
  await ctx.db.remove('objectifs', o.id);
  return o.statut === 'propose' && estSalarie(ctx, e) ? 'Proposition d’objectif retirée' : `Objectif retiré — ${e.nom}`;
};

/** Avancement (0 à 100 %) d'un objectif en cours : le salarié (avec un court commentaire) ou l'évaluateur. */
const avancer: ActionHandler = async (ctx, p) => {
  const { o, e } = objectifDe(ctx, p.id);
  const salarie = estSalarie(ctx, e);
  if (!salarie) exigerEvaluateur(ctx, e, 'Avancement mis à jour par le salarié ou son évaluateur');
  exigerActifs(ctx);
  if (o.statut !== 'ouvert') throw new ActionError(`Objectif ${STATUT_OBJECTIF_LABEL[o.statut].toLowerCase()} : son avancement ne se met plus à jour`, 409);
  const avancement = lireAvancement(p.avancement);
  if (typeof avancement === 'string') throw new ActionError(avancement);
  if (p.commentaire !== undefined && !salarie) throw new ActionError('Le commentaire est celui du salarié ; l’évaluateur s’exprime à l’évaluation');
  const c = p.commentaire !== undefined ? commentaire(p.commentaire, COMMENTAIRE_SAL_MAX, 'Commentaire') : undefined;
  await ctx.db.update<Objectif>('objectifs', o.id, { avancement, ...(c !== undefined ? { commentaireSal: c } : {}), modifieLe: maintenant(), modifiePar: ctx.user.nom });
  return `Avancement : ${avancement} %${salarie ? '' : ` — ${e.nom}`}`;
};

/**
 * Ajustement en cours d'année par l'évaluateur (objectif d'un entretien clos, encore en cours) : libellé, mesure, échéance
 * ou poids, avec un motif ; daté, et le libellé d'origine conservé au premier changement.
 */
const ajuster: ActionHandler = async (ctx, p) => {
  const { o, e } = objectifDe(ctx, p.id);
  const { x } = entretienDe(ctx, o.entretienId);
  exigerEvaluateur(ctx, e, 'Objectifs ajustés par l’évaluateur (manager ou service RH)');
  exigerActifs(ctx);
  if (o.statut !== 'ouvert') throw new ActionError(`Objectif ${STATUT_OBJECTIF_LABEL[o.statut].toLowerCase()} : il ne s’ajuste plus`, 409);
  if (x.statut === 'planifie') throw new ActionError('Entretien encore planifié : modifiez l’objectif directement, sans ajustement', 409);
  const motif = commentaire(p.motif, MOTIF_AJUSTEMENT_MAX, 'Motif');
  if (!motif) throw new ActionError('Motif de l’ajustement requis');
  const s = saisie(p, o);
  if (s.libelle === o.libelle && s.mesure === o.mesure && s.categorie === o.categorie && s.poids === o.poids && s.echeance === o.echeance) throw new ActionError('Aucun changement à ajuster');
  exigerPoids(ctx, x.id, s.poids, o.id);
  await ctx.db.update<Objectif>('objectifs', o.id, {
    ...s, ajusteLe: ctx.d.ti, ajusteMotif: motif, libelleInitial: o.libelleInitial ?? (s.libelle !== o.libelle ? o.libelle : null),
    modifieLe: maintenant(), modifiePar: ctx.user.nom,
  });
  return `Objectif ajusté le ${fmtIso(ctx.d.ti)} — ${e.nom}`;
};

/**
 * Évaluation à l'entretien annuel suivant (planifié) d'un objectif fixé à un entretien clos : résultat, commentaire de
 * l'évaluateur (motif exigé pour « sans objet ») ; « reconduit » crée une nouvelle ligne fixée à cet entretien. Modifiable
 * tant que l'entretien n'est pas clos : une reconduction défaite retire sa ligne.
 */
const evaluer: ActionHandler = async (ctx, p) => {
  const { o, e } = objectifDe(ctx, p.id);
  const { x } = entretienDe(ctx, p.entretienId);
  exigerEvaluateur(ctx, e, 'Objectifs évalués par l’évaluateur (manager ou service RH)');
  if (x.empId !== o.empId) throw new ActionError('Entretien d’un autre salarié');
  exigerActifs(ctx);
  exigerPlanifie(x);
  exigerType(x);
  if (o.entretienId === x.id) throw new ActionError('Objectif fixé à cet entretien : il s’évalue à l’entretien annuel suivant');
  const fixe = ctx.ds.entretiens.find(y => y.id === o.entretienId);
  if (fixe?.statut !== 'realise') throw new ActionError('Objectif d’un entretien encore planifié : il s’évalue une fois cet entretien clos', 409);
  if (o.statut !== 'ouvert' && o.evalueEntretienId !== x.id) throw new ActionError('Objectif déjà évalué à un autre entretien', 409);
  if (!estStatutEvaluation(p.statut)) throw new ActionError('Résultat inconnu : atteint, partiellement, non atteint, sans objet ou reconduit');
  const evaluation = commentaire(p.evaluation, EVALUATION_MAX, 'Évaluation');
  if (p.statut === 'sans_objet' && !evaluation) throw new ActionError('Objectif devenu sans objet : indiquez pourquoi');
  // Nouvelle évaluation d'une reconduction : la ligne reconduite à cet entretien est retirée, puis recréée si besoin.
  const reconduite = (ctx.ds.objectifs ?? []).find(y => y.reconduitDe === o.id && y.entretienId === x.id);
  if (reconduite && p.statut !== 'reconduit') {
    await delierSouhaits(ctx, x, reconduite.id);
    await ctx.db.remove('objectifs', reconduite.id);
  }
  let nouvel: number | null = reconduite && p.statut === 'reconduit' ? reconduite.id : null;
  if (p.statut === 'reconduit' && !reconduite) {
    exigerPlace(ctx, x);
    const s = saisie({ echeance: p.echeance ?? null }, o);
    exigerPoids(ctx, x.id, s.poids);
    nouvel = (await ctx.db.insert<Objectif>('objectifs', {
      empId: e.id, entretienId: x.id, evalueEntretienId: null, reconduitDe: o.id, ...s, avancement: 0, statut: 'ouvert', evaluation: null, commentaireSal: null,
      creeLe: maintenant(), creePar: ctx.user.nom, modifieLe: null, modifiePar: null, ajusteLe: null, ajusteMotif: null, libelleInitial: null,
    })).id;
  }
  await ctx.db.update<Objectif>('objectifs', o.id, { statut: p.statut, evaluation, evalueEntretienId: x.id, modifieLe: maintenant(), modifiePar: ctx.user.nom });
  return { message: `Objectif évalué : ${STATUT_OBJECTIF_LABEL[p.statut].toLowerCase()} — ${e.nom}`, result: { id: o.id, reconduit: nouvel } };
};

export const objectifsActions = {
  'objectif.ajouter': ajouter,
  'objectif.proposer': proposer,
  'objectif.modifier': modifier,
  'objectif.retirer': retirer,
  'objectif.avancer': avancer,
  'objectif.ajuster': ajuster,
  'objectif.evaluer': evaluer,
} satisfies Record<string, ActionHandler>;
