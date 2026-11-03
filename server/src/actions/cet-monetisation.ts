// lot 13 — CET (monétisation) : demandes de monétisation de jours du compte épargne-temps (art. L3151-3), ouvertes par le
// réglage `cetMonetisation` avec la référence de l'accord (Paramètres → Compte épargne-temps). Règles :
// shared/rules/cet-monetisation.ts ; paie : server/src/cet-paie.ts (famille « monetisationsCet », rubrique CET_MON).
// - `cet.monetiser` (`empId`, `jours`) : le salarié pour lui-même, ou le service RH pour lui ; la demande attend la
//   décision du service RH.
// - `cet.monetisation.valider` (`id`) : service RH, jamais pour soi-même ; contrôles refaits sur l'instantané du jour ;
//   la demande prend sa période de paie (mois de la validation, au plus tôt la période ouverte).
// - `cet.monetisation.refuser` (`id`, `motif` obligatoire) : service RH, jamais pour soi-même.
// - `cet.monetisation.annuler` (`id`, `motif`) : l'intéressé tant que sa demande attend ; le service RH (motif obligatoire,
//   jamais pour soi-même) pour une demande en attente ou validée hors de tout lot de paie. Dans un lot dont l'import n'est
//   pas confirmé : annuler d'abord le lot ; transmise : la correction se fait dans Sage.
// Jamais supprimée : refusée ou annulée, la demande reste pour l'historique (motif gardé, jamais au journal).
import { fJ } from '../../../shared/format.ts';
import {
  etatMonetisation, MOTIF_MONETISATION_MAX, periodeMonetisation, refusMonetisation,
} from '../../../shared/rules/cet-monetisation.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { MonetisationCet } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isRh, isSelf, refuserSoiMeme, requireRh, str } from './context.ts';

async function charger(ctx: Ctx, id: unknown): Promise<MonetisationCet> {
  const m = await ctx.db.get<MonetisationCet>('monetisationsCet', Number(id));
  if (!m) throw new ActionError('Demande de monétisation introuvable', 404);
  return m;
}

/** Motif d'un refus ou d'une annulation : exigé (`requis`), 500 caractères au plus. */
function motifDe(p: Record<string, any>, requis: boolean, quoi: string): string | null {
  const motif = str(p.motif);
  if (!motif && requis) throw new ActionError(`Indiquez le motif ${quoi}`);
  if (motif.length > MOTIF_MONETISATION_MAX) throw new ActionError(`Motif trop long (${MOTIF_MONETISATION_MAX} caractères au plus)`);
  return motif || null;
}

const resultat = (m: Pick<MonetisationCet, 'id' | 'empId'>) => ({ id: m.id, empId: m.empId });

const demander: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const interesse = isSelf(ctx, emp.id);
  if (!(isRh(ctx) || interesse)) throw new ActionError('Vous ne pouvez demander à monétiser que votre propre compte épargne-temps', 403);
  const jours = Number(p.jours);
  const refus = refusMonetisation(ctx.d, emp, jours);
  if (refus) throw new ActionError(refus);
  const m = await ctx.db.insert<MonetisationCet>('monetisationsCet', {
    empId: emp.id, jours, statut: 'demandee', annee: Number(ctx.d.ti.slice(0, 4)), demandeLe: new Date().toISOString(), demandePar: ctx.user.nom,
    demandeParInteresse: interesse, decideLe: null, decidePar: null, motif: null, periode: null, lotId: null, sage: false, horsFichier: false,
  });
  return {
    message: `Demande de monétisation de ${fJ(jours)} du compte épargne-temps de ${emp.nom} enregistrée : à valider par le service RH`,
    result: resultat(m),
  };
};

const valider: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const m = await charger(ctx, p.id);
  const emp = getEmp(ctx, m.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas valider la monétisation de votre propre compte épargne-temps');
  if (m.statut !== 'demandee') throw new ActionError(`Demande de monétisation ${etatMonetisation(m)} : rien à valider`, 409);
  // Contrôles refaits sur l'instantané du jour (solde, origine des jours, plafond), sans compter la demande elle-même.
  const refus = refusMonetisation(ctx.d, emp, m.jours, m);
  if (refus) throw new ActionError(refus);
  const periode = periodeMonetisation(ctx.d.ti, ctx.d.ti, ctx.ds.settings?.clotureJour ?? 0);
  await ctx.db.update<MonetisationCet>('monetisationsCet', m.id, { statut: 'validee', decideLe: new Date().toISOString(), decidePar: ctx.user.nom, periode });
  return {
    message: `Monétisation de ${fJ(m.jours)} du compte épargne-temps de ${emp.nom} validée · paie : rubrique CET_MON, ${periodeLabel(periode)}`,
    result: resultat(m),
  };
};

const refuser: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const m = await charger(ctx, p.id);
  const emp = getEmp(ctx, m.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas décider de la monétisation de votre propre compte épargne-temps');
  if (m.statut !== 'demandee') throw new ActionError(`Demande de monétisation ${etatMonetisation(m)} : rien à refuser`, 409);
  const motif = motifDe(p, true, 'du refus');
  await ctx.db.update<MonetisationCet>('monetisationsCet', m.id, { statut: 'refusee', decideLe: new Date().toISOString(), decidePar: ctx.user.nom, motif });
  return { message: `Demande de monétisation de ${fJ(m.jours)} du compte épargne-temps de ${emp.nom} refusée`, result: resultat(m) };
};

const annuler: ActionHandler = async (ctx, p) => {
  const m = await charger(ctx, p.id);
  const emp = getEmp(ctx, m.empId);
  const interesse = isSelf(ctx, emp.id);
  if (!(isRh(ctx) || interesse)) throw new ActionError('Vous ne pouvez annuler que vos propres demandes de monétisation', 403);
  if (m.statut === 'annulee') return { message: `Demande de monétisation de ${emp.nom} déjà annulée`, result: resultat(m) };
  if (m.statut === 'refusee') throw new ActionError('Demande de monétisation refusée : rien à annuler', 409);
  if (m.statut === 'validee') {
    if (interesse || !isRh(ctx)) throw new ActionError('Monétisation déjà validée : seul le service RH peut l’annuler, tant qu’elle n’est pas partie à la paie', 403);
    if (m.sage) throw new ActionError(`Monétisation de ${emp.nom} ${etatMonetisation(m)} : la correction se fait dans Sage`, 409);
    if (m.lotId != null) throw new ActionError(`Jours monétisés de ${emp.nom} compris dans le lot de paie n° ${m.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis la monétisation`, 409);
  }
  // Le service RH annule pour le salarié (motif exigé, jamais pour soi-même) ; l'intéressé retire sa propre demande.
  if (!interesse) refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas annuler la monétisation de votre propre compte épargne-temps');
  const motif = motifDe(p, !interesse, 'de l’annulation');
  await ctx.db.update<MonetisationCet>('monetisationsCet', m.id, { statut: 'annulee', decideLe: new Date().toISOString(), decidePar: ctx.user.nom, motif, periode: null });
  return { message: `Demande de monétisation de ${fJ(m.jours)} du compte épargne-temps de ${emp.nom} annulée`, result: resultat(m) };
};

export const cetMonetisationActions = {
  'cet.monetiser': demander,
  'cet.monetisation.valider': valider,
  'cet.monetisation.refuser': refuser,
  'cet.monetisation.annuler': annuler,
} satisfies Record<string, ActionHandler>;
