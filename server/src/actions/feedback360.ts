// Feedback 360° d'un entretien annuel ou de mi-année (lot 12, chantier C3, t194, étape 3 ; règles :
// shared/rules/feedback360.ts ; tampon, versement par lot, synthèse et purge : server/src/feedback360.ts). Module livré
// désactivé (réglage `feedback360Actif`, activé seulement avec les références de l'avis du CSE et de l'AIPD).
// - `feedback360.solliciter` : le salarié propose des répondants internes (statut « proposé ») ; l'évaluateur (manager
//   valideur, service RH hors soi-même, suppléant d'une délégation « entretiens ») les valide ou en sollicite d'autres :
//   la sollicitation part au répondant (e-mail et notification à texte générique), la fenêtre de réponse s'ouvre (21 jours) ;
//   relation (collègue, N+2, collaborateur encadré) déduite de l'organisation, jamais déclarée ; 3 à 8 répondants ;
// - `feedback360.retirer` : une proposition pas encore envoyée (une sollicitation partie ne se retire pas : son retrait
//   dirait si la personne avait répondu) ;
// - `feedback360.relancer` : l'évaluateur relance d'un coup ceux qui n'ont rien fait, sans savoir qui ;
// - `feedback360.repondre`, `feedback360.decliner` : le répondant seul, tant que la fenêtre est ouverte ; la réponse
//   attend la clôture, chiffrée ; ni l'une ni l'autre n'est tracée au journal (la sollicitation en tient lieu) ;
// - `feedback360.clore` : l'évaluateur clôt la collecte (sinon la tâche horaire à l'échéance) : versement par lot ;
// - `feedback360.moderer` : le service RH relit chaque commentaire avant sa restitution (retenu ou non restitué).
// Jamais dans la file hors ligne (shared/hors-ligne.ts) ; journal sans nom de répondant (server/src/journal.ts).
import { fmtIso, plural } from '../../../shared/format.ts';
import { present } from '../../../shared/rules/contrats.ts';
import {
  collecte360, echeance360, jour360, lireReponse360, lireSynthese360, relation360, RELATIONS_360, SOLLICITATIONS_MAX, TYPES_360,
} from '../../../shared/rules/feedback360.ts';
import type { Employe, Entretien, Reponse360, Sollicitation360 } from '../../../shared/types.ts';
import { clore360, instant360, majSynthese360, notifierRepondant, purgerEntretien360, refusSansCle360, sceller360 } from '../feedback360.ts';
import { ActionError, type ActionHandler, type Ctx, estSoiMeme, getEmp, isValidatorOf, refuserSoiMeme, requireRh, str } from './context.ts';


function exigerActif(ctx: Ctx) {
  if (!ctx.ds.settings.feedback360Actif) throw new ActionError('Feedback 360° non activé (Paramètres → Objectifs et points de suivi, après l’avis du CSE)', 409);
}

function entretienDe(ctx: Ctx, id: unknown): { x: Entretien; e: Employe } {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

/** Évaluateur du salarié (manager valideur, service RH, suppléant « entretiens »), jamais pour soi-même. */
function exigerEvaluateur(ctx: Ctx, e: Employe, refus: string) {
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas conduire le feedback 360° qui vous concerne');
  if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError(refus, 403);
}

const sollicitations = (ctx: Ctx, entretienId: number) => (ctx.ds.feedbackSollicitations ?? []).filter(s => s.entretienId === entretienId);

/** Sollicitation adressée à la personne connectée (répondant), quel que soit son espace. */
function sienne(ctx: Ctx, id: unknown): Sollicitation360 {
  const s = (ctx.ds.feedbackSollicitations ?? []).find(y => y.id === Number(id));
  if (!s) throw new ActionError('Sollicitation introuvable', 404);
  if (ctx.user.empId == null || s.repondantEmpId !== ctx.user.empId) throw new ActionError('Avis donné par la personne sollicitée seulement', 403);
  return s;
}

/** Sollicitation encore ouverte au répondant : envoyée, fenêtre ni close ni échue. */
function exigerOuverte(ctx: Ctx, s: Sollicitation360) {
  if (s.closeLe || !['envoyee', 'repondue', 'declinee'].includes(s.statut)) throw new ActionError('Collecte close : les avis ne se donnent plus', 409);
  if (s.echeance && s.echeance < ctx.d.ti) throw new ActionError(`Fenêtre de réponse close le ${fmtIso(s.echeance)}`, 409);
}

/** Identifiants reçus (liste ou un seul), entiers distincts. */
function idsRecus(p: Record<string, unknown>): number[] {
  const brut = Array.isArray(p.repondantIds) ? p.repondantIds : p.repondantId != null ? [p.repondantId] : [];
  return [...new Set(brut.map(Number).filter(Number.isInteger))];
}

const solliciter: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const { x, e } = entretienDe(ctx, p.entretienId);
  const salarie = ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;
  if (!salarie) exigerEvaluateur(ctx, e, 'Répondants proposés par le salarié et sollicités par son évaluateur (manager ou service RH)');
  if (!TYPES_360.includes(x.type)) throw new ActionError('Feedback 360° seulement pour l’entretien annuel ou le point de mi-année (jamais pour un entretien de parcours professionnel, art. L6315-1)');
  if (x.statut !== 'planifie') throw new ActionError('Entretien clos : le feedback 360° se prépare avant l’entretien', 409);
  const c = collecte360(ctx.ds.feedbackSollicitations ?? [], x.id);
  // Une synthèse jointe vaut collecte close, même après la purge de ses sollicitations (6 mois au plus après l'envoi, entretien
  // reporté) : une nouvelle collecte l'écraserait à sa clôture.
  if (c.close || lireSynthese360(x.syntheseFeedback)) throw new ActionError('Collecte déjà close pour cet entretien : un seul feedback 360° par entretien', 409);
  if (c.ouverte && c.echeance && c.echeance < ctx.d.ti) throw new ActionError('Fenêtre de réponse échue : la collecte va être close', 409);
  const ids = idsRecus(p);
  if (!ids.length) throw new ActionError('Choisissez au moins un répondant');
  const evaluateur = ctx.d.mgrOf(e);
  const existantes = sollicitations(ctx, x.id).filter(s => s.statut !== 'annulee');
  const parRepondant = new Map(existantes.map(s => [s.repondantEmpId, s] as const));
  for (const id of ids) {
    const r = getEmp(ctx, id);
    if (r.id === e.id) throw new ActionError('Le salarié ne se sollicite pas lui-même');
    if (r.id === evaluateur || (!salarie && estSoiMeme(ctx, r.id))) throw new ActionError(`${r.nom} conduit l’entretien : son avis s’y donne, pas dans le feedback 360°`);
    if (!present(r, ctx.d.ti)) throw new ActionError(`${r.nom} a quitté l’entreprise`);
  }
  const nouveaux = ids.filter(id => !parRepondant.has(id));
  const aEnvoyer = salarie ? [] : ids.filter(id => parRepondant.get(id)?.statut === 'proposee' || !parRepondant.has(id));
  if (existantes.length + nouveaux.length > SOLLICITATIONS_MAX) throw new ActionError(`${SOLLICITATIONS_MAX} répondants au plus par entretien`);
  const seuil = ctx.ds.settings.feedback360Seuil;
  if (!salarie && c.envoyees + aEnvoyer.length < seuil) {
    throw new ActionError(`Sollicitez au moins ${seuil} répondants : en dessous, rien ne pourrait être restitué (confidentialité des réponses)`);
  }
  const relation = (id: number) => relation360(empId => { const y = ctx.d.emp(empId); return y ? ctx.d.mgrOf(y) || null : null; }, e.id, id);
  const parRelation: Record<string, number> = Object.fromEntries(RELATIONS_360.map(r => [r, 0]));
  if (salarie) {
    for (const id of nouveaux) {
      await ctx.db.insert('feedbackSollicitations', {
        empId: e.id, entretienId: x.id, repondantEmpId: id, relation: relation(id), statut: 'proposee', proposeeLe: instant360(), proposeePar: ctx.user.nom,
        envoyeeLe: null, echeance: null, relanceeLe: null, closeLe: null,
      });
      parRelation[relation(id)]++;
    }
    return {
      message: nouveaux.length ? `${plural(nouveaux.length, 'répondant proposé', 'répondants proposés')} : votre évaluateur les sollicitera` : 'Répondants déjà proposés',
      result: { entretienId: x.id, empId: e.id, proposees: nouveaux.length, envoyees: 0, parRelation },
    };
  }
  const echeance = c.echeance ?? echeance360(ctx.d.ti, ctx.ds.settings.feedback360FenetreJours);
  const envoyeeLe = instant360();
  for (const id of aEnvoyer) {
    const deja = parRepondant.get(id);
    const champs = { statut: 'envoyee' as const, envoyeeLe, echeance };
    if (deja) await ctx.db.update<Sollicitation360>('feedbackSollicitations', deja.id, champs);
    else {
      await ctx.db.insert('feedbackSollicitations', {
        empId: e.id, entretienId: x.id, repondantEmpId: id, relation: relation(id), proposeeLe: null, proposeePar: ctx.user.nom, relanceeLe: null, closeLe: null, ...champs,
      });
    }
    parRelation[relation(id)]++;
    await notifierRepondant(ctx, id, echeance);
  }
  return {
    message: aEnvoyer.length ? `${plural(aEnvoyer.length, 'répondant sollicité', 'répondants sollicités')} — réponses attendues jusqu’au ${fmtIso(echeance)} (${e.nom})` : 'Répondants déjà sollicités',
    result: { entretienId: x.id, empId: e.id, proposees: 0, envoyees: aEnvoyer.length, parRelation },
  };
};

/** Proposition retirée avant son envoi : par le salarié (les siennes) ou par l'évaluateur. */
const retirer: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const s = (ctx.ds.feedbackSollicitations ?? []).find(y => y.id === Number(p.id));
  if (!s) throw new ActionError('Proposition introuvable', 404);
  const e = getEmp(ctx, s.empId);
  const salarie = ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;
  if (!salarie) exigerEvaluateur(ctx, e, 'Proposition retirée par le salarié ou par son évaluateur');
  if (s.statut !== 'proposee') throw new ActionError('Sollicitation déjà envoyée : elle ne se retire plus (la collecte se clôt d’un bloc)', 409);
  await ctx.db.remove('feedbackSollicitations', s.id);
  return { message: 'Proposition de répondant retirée', result: { entretienId: s.entretienId, empId: e.id } };
};

/** Relance de tous les répondants qui n'ont encore rien fait, sans savoir lesquels (une fois par jour au plus). */
const relancer: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const { x, e } = entretienDe(ctx, p.entretienId);
  exigerEvaluateur(ctx, e, 'Relance par l’évaluateur (manager ou service RH)');
  const c = collecte360(ctx.ds.feedbackSollicitations ?? [], x.id);
  if (!c.ouverte) throw new ActionError('Aucune collecte en cours pour cet entretien', 409);
  const l = sollicitations(ctx, x.id);
  if (l.some(s => s.relanceeLe && jour360(s.relanceeLe) === ctx.d.ti)) throw new ActionError('Répondants déjà relancés aujourd’hui', 409);
  const attente = l.filter(s => s.statut === 'envoyee' && !s.closeLe);
  const relanceeLe = instant360();
  for (const s of attente) {
    await ctx.db.update<Sollicitation360>('feedbackSollicitations', s.id, { relanceeLe });
    await notifierRepondant(ctx, s.repondantEmpId, s.echeance, true);
  }
  return {
    message: attente.length ? `${plural(attente.length, 'répondant relancé', 'répondants relancés')} (${e.nom})` : 'Aucun répondant à relancer : tous ont répondu ou décliné',
    result: { entretienId: x.id, empId: e.id, relances: attente.length },
  };
};

/** Avis du répondant (ou sa modification tant que la collecte est ouverte), gardé chiffré jusqu'à la clôture. */
const repondre: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const s = sienne(ctx, p.id);
  exigerOuverte(ctx, s);
  const refus = refusSansCle360();
  if (refus) throw new ActionError(refus, 409);
  const c = lireReponse360(p);
  if (typeof c === 'string') throw new ActionError(c);
  const contenu = sceller360(c, s.id);
  const t = await ctx.db.one<{ id: number }>('SELECT id FROM feedback_tampon WHERE sollicitation_id = ?', [s.id]);
  if (t) await ctx.db.update('feedbackTampon', t.id, { contenu, version: c.version });
  else await ctx.db.insert('feedbackTampon', { sollicitationId: s.id, contenu, version: c.version });
  if (s.statut !== 'repondue') await ctx.db.update<Sollicitation360>('feedbackSollicitations', s.id, { statut: 'repondue' });
  return { message: `Avis enregistré, confidentiel — modifiable jusqu’au ${fmtIso(s.echeance ?? ctx.d.ti)}`, result: {} };
};

/** Le répondant décline (participation facultative) ; une réponse déjà donnée est alors effacée. */
const decliner: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const s = sienne(ctx, p.id);
  exigerOuverte(ctx, s);
  await ctx.db.run('DELETE FROM feedback_tampon WHERE sollicitation_id = ?', [s.id]);
  if (s.statut !== 'declinee') await ctx.db.update<Sollicitation360>('feedbackSollicitations', s.id, { statut: 'declinee' });
  return { message: 'Sollicitation déclinée', result: {} };
};

/** Clôture de la collecte par l'évaluateur, avant l'échéance s'il le veut : versement par lot et synthèse. */
const clore: ActionHandler = async (ctx, p) => {
  exigerActif(ctx);
  const { x, e } = entretienDe(ctx, p.entretienId);
  exigerEvaluateur(ctx, e, 'Collecte close par l’évaluateur (manager ou service RH)');
  if (!collecte360(ctx.ds.feedbackSollicitations ?? [], x.id).ouverte) throw new ActionError('Aucune collecte en cours pour cet entretien', 409);
  const r = await clore360(ctx, x);
  const seuil = ctx.ds.settings.feedback360Seuil;
  return {
    message: r.versees
      ? `Collecte close : ${plural(r.reponses, 'réponse', 'réponses')} sur ${r.envoyees} — synthèse jointe à l’entretien (${e.nom})`
      : `Collecte close : ${plural(r.reponses, 'réponse', 'réponses')} sur ${r.envoyees}, moins de ${seuil} — rien n’est restitué, les réponses sont supprimées (${e.nom})`,
    result: { entretienId: x.id, empId: e.id, envoyees: r.envoyees, reponses: r.reponses, versees: r.versees },
  };
};

/** Relecture d'un commentaire par le service RH (jamais sur soi-même) : restitué (« retenu ») ou non ; synthèse recalculée. */
const moderer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  exigerActif(ctx);
  const r = await ctx.db.get<Reponse360>('feedbackReponses', str(p.id));
  if (!r || !r.verbatim) throw new ActionError('Commentaire introuvable (déjà supprimé à la clôture de l’entretien ?)', 404);
  const e = getEmp(ctx, r.empId);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas relire les commentaires qui vous concernent', 'un autre membre du service RH les relit');
  const decision = p.decision === 'retenu' || p.decision === 'retire' ? p.decision : null;
  if (!decision) throw new ActionError('Décision attendue : restituer ou ne pas restituer');
  await ctx.db.update<Reponse360>('feedbackReponses', r.id, { verbatimStatut: decision, modereLe: ctx.d.ti, moderePar: ctx.user.nom });
  await majSynthese360(ctx.db, r.entretienId, { seuil: ctx.ds.settings.feedback360Seuil });
  return { message: decision === 'retenu' ? `Commentaire restitué — ${e.nom}` : `Commentaire non restitué — ${e.nom}`, result: { entretienId: r.entretienId, empId: e.id, decision } };
};

/**
 * Refus de clore l'entretien `x` tant que sa collecte 360° est ouverte (409), ou null. Module désactivé entre-temps : la
 * clôture de l'entretien n'attend pas (la collecte ne pourrait plus être close) ; ses réponses en attente sont supprimées.
 */
export function refusClotureFeedback(ctx: Ctx, x: Pick<Entretien, 'id'>): string | null {
  return ctx.ds.settings.feedback360Actif && collecte360(ctx.ds.feedbackSollicitations ?? [], x.id).ouverte
    ? 'Feedback 360° en cours : clore d’abord la collecte (bloc « Feedback 360° » du compte rendu), la synthèse se joint alors à l’entretien' : null;
}

/**
 * Entretien clos (`entretien.clore`) : réponses brutes, tampon et sollicitations supprimés ; la synthèse reste jointe,
 * sans les commentaires que le service RH n'a pas relus (comptés, jamais restitués). Renvoie ce nombre.
 */
export async function finirFeedback360(ctx: Ctx, x: Pick<Entretien, 'id'>): Promise<number> {
  if (!sollicitations(ctx, x.id).length) return 0;
  const avant = await ctx.db.get<Entretien>('entretiens', x.id);
  const s = lireSynthese360(avant?.syntheseFeedback);
  await purgerEntretien360(ctx.db, x.id);
  if (s?.aModerer) await ctx.db.update<Entretien>('entretiens', x.id, { syntheseFeedback: { ...s, aModerer: 0, nonRelus: s.aModerer } });
  return s?.aModerer ?? 0;
}

export const feedback360Actions = {
  'feedback360.solliciter': solliciter,
  'feedback360.retirer': retirer,
  'feedback360.relancer': relancer,
  'feedback360.repondre': repondre,
  'feedback360.decliner': decliner,
  'feedback360.clore': clore,
  'feedback360.moderer': moderer,
} satisfies Record<string, ActionHandler>;
