// Arrêtés annuels des indicateurs sociaux (lot 11, chantier C3, t197 ; calcul : shared/rules/indicateurs-legaux.ts et
// server/src/indicateurs.ts). Les purges de conservation (temps 3 ans, dossiers 5 ans) et les corrections après coup
// changeraient les chiffres de N-2 présentés au CSE : l'arrêté fige les agrégats de l'année, déjà masqués, avec la version
// des règles et le seuil appliqués. Jamais supprimé : annulé avec un motif, un nouvel arrêté peut alors être pris.
//   indicateurs.arreter       { annee }        administrateur RH : année terminée, aucun arrêté en vigueur pour elle
//   indicateurs.annulerArrete { id, motif }    administrateur RH : motif obligatoire (gardé avec l'arrêté, jamais au journal)
//   indicateurs.marquerCse    { id, le }       service RH : date de mise à disposition du CSE (pas dans le futur)
// Le journal ne reçoit que l'année, le périmètre et l'identifiant (server/src/journal.ts), jamais un chiffre.
import { isValidDate } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { anneeIndicateursValide, REGLES_INDICATEURS } from '../../../shared/rules/indicateurs-legaux.ts';
import type { ArreteIndicateurs } from '../../../shared/types.ts';
import { donneesArrete } from '../indicateurs.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh, requireRhAdmin, str } from './context.ts';

/** Périmètre des arrêtés : un seul employeur tant que l'organigramme (t195) ne découpe pas les entités. */
export const PERIMETRE_GLOBAL = 'global';
/** Longueur maximale du motif d'annulation. */
export const MOTIF_ARRETE_MAX = 500;

function getArrete(ctx: Ctx, id: unknown): ArreteIndicateurs {
  const a = (ctx.ds.indicateursArretes ?? []).find(x => x.id === Number(id));
  if (!a) throw new ActionError('Arrêté introuvable', 404);
  return a;
}

const arreter: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const annee = Number(p.annee);
  if (!anneeIndicateursValide(annee)) throw new ActionError('Année invalide');
  // L'arrêté porte sur une année terminée : celle en cours changerait encore.
  if (annee >= Number(ctx.d.ti.slice(0, 4))) throw new ActionError(`L’année ${annee} n’est pas terminée : l’arrêté porte sur une année close`);
  const deja = (ctx.ds.indicateursArretes ?? []).find(a => a.annee === annee && a.perimetre === PERIMETRE_GLOBAL && !a.annuleLe);
  if (deja) throw new ActionError(`Indicateurs ${annee} déjà arrêtés (arrêté n° ${deja.id}) : annulez-le d’abord pour en prendre un nouveau`);
  const row = await ctx.db.insert<ArreteIndicateurs>('indicateursArretes', {
    annee, perimetre: PERIMETRE_GLOBAL, du: `${annee}-01-01`, au: `${annee}-12-31`, reglesVersion: REGLES_INDICATEURS, seuil: ctx.ds.settings.indicateursSeuil,
    donnees: donneesArrete(ctx.ds, annee), arreteLe: new Date().toISOString(), arretePar: ctx.user.nom, cseLe: null, csePar: null,
    annuleLe: null, annulePar: null, annuleMotif: null,
  });
  return { message: `Indicateurs sociaux ${annee} arrêtés (arrêté n° ${row.id}) : chiffres figés pour la BDESE`, result: { id: row.id } };
};

const annulerArrete: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const a = getArrete(ctx, p.id);
  if (a.annuleLe) throw new ActionError('Arrêté déjà annulé');
  const motif = str(p.motif);
  if (!motif) throw new ActionError('Motif requis : il reste avec l’arrêté annulé');
  if (motif.length > MOTIF_ARRETE_MAX) throw new ActionError(`Motif trop long (${MOTIF_ARRETE_MAX} caractères au plus)`);
  await ctx.db.update('indicateursArretes', a.id, { annuleLe: new Date().toISOString(), annulePar: ctx.user.nom, annuleMotif: motif });
  return { message: `Arrêté n° ${a.id} des indicateurs ${a.annee} annulé : un nouvel arrêté peut être pris`, result: { id: a.id } };
};

const marquerCse: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const a = getArrete(ctx, p.id);
  if (a.annuleLe) throw new ActionError('Arrêté annulé : il n’est pas mis à disposition du CSE');
  const le = String(p.le ?? '');
  if (!isValidDate(le)) throw new ActionError('Date de mise à disposition invalide');
  if (le > ctx.d.ti) throw new ActionError('La mise à disposition du CSE ne peut pas être datée du futur');
  if (le < a.arreteLe.slice(0, 10)) throw new ActionError('La mise à disposition du CSE ne peut pas précéder l’arrêté');
  await ctx.db.update('indicateursArretes', a.id, { cseLe: le, csePar: ctx.user.nom });
  return { message: `Arrêté n° ${a.id} des indicateurs ${a.annee} mis à disposition du CSE le ${fmtIso(le)}`, result: { id: a.id } };
};

export const indicateursActions = {
  'indicateurs.arreter': arreter,
  'indicateurs.annulerArrete': annulerArrete,
  'indicateurs.marquerCse': marquerCse,
} satisfies Record<string, ActionHandler>;
