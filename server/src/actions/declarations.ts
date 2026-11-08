// lot 14 — pré-déclarations de présence sur site : actions du service RH (règles : shared/rules/declarations-presence.ts ;
// liens et routes publiques : server/src/declarations.ts). Service RH seulement.
// - `presence.lien.creer` (`categorie`, `entreprise`) : lien permanent d'une entreprise ou d'une agence ; le jeton n'est
//   renvoyé qu'ici, une seule fois (jamais au journal ni dans l'instantané).
// - `presence.lien.revoquer` (`id`) : le lien ne reçoit plus rien ; les déclarations déjà faites restent.
// - `presence.valider` (`id`, `empId` facultatif) : rattache la déclaration à une fiche existante (proposée par
//   `suggestions`) ; sans fiche, crée celle d'un extérieur (matricule E). Un intérimaire est toujours rattaché à sa fiche
//   d'intérim, créée par le formulaire habituel (contrat, agence, équipe) : jamais de fiche d'intérim incomplète.
// - `presence.refuser` (`id`, `motif`) : déclaration à valider refusée ; effacée après la durée de conservation.
// - `presence.annuler` (`id`, `motif`) : venue annulée (validée : reste publiée comme annulée ; à valider : sans suite).
// Jamais supprimées par une action : la purge quotidienne efface les refusées et les sans suite échues.
import { categorieDe } from '../../../shared/rules/personnes-site.ts';
import { nomComplet, refDeclaration } from '../../../shared/rules/declarations-presence.ts';
import type { DeclarationPresence, LienDeclaration } from '../../../shared/types.ts';
import { creerLien } from '../declarations.ts';
import { creerFicheExterieur } from './personnes-site.ts';
import { ActionError, type ActionHandler, type Ctx, getPersonne, requireRh, str } from './context.ts';

export const MOTIF_DECLARATION_MAX = 300;
const ENTREPRISE_MAX = 120;

function motifDe(p: Record<string, unknown>, quoi: string): string {
  const motif = str(p.motif);
  if (!motif) throw new ActionError(`Indiquez le motif ${quoi}`);
  if (motif.length > MOTIF_DECLARATION_MAX) throw new ActionError(`Motif trop long (${MOTIF_DECLARATION_MAX} caractères au plus)`);
  return motif;
}

function declarationDe(ctx: Ctx, id: unknown): DeclarationPresence {
  const d = (ctx.ds.declarationsPresence ?? []).find(x => x.id === Number(id));
  if (!d) throw new ActionError('Déclaration introuvable', 404);
  return d;
}

const creerLienAction: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const categorie = p.categorie === 'interimaire' ? 'interimaire' : p.categorie === 'exterieur' ? 'exterieur' : null;
  if (!categorie) throw new ActionError('Choisissez : entreprise extérieure ou agence d’intérim');
  const entreprise = str(p.entreprise).replace(/\s+/g, ' ');
  if (entreprise.length < 2) throw new ActionError(categorie === 'interimaire' ? 'Indiquez l’agence d’intérim' : 'Indiquez l’entreprise');
  if (entreprise.length > ENTREPRISE_MAX) throw new ActionError(`Nom trop long (${ENTREPRISE_MAX} caractères au plus)`);
  const deja = (ctx.ds.liensDeclaration ?? []).find(l => !l.revoqueLe && l.categorie === categorie && l.entreprise.toLowerCase() === entreprise.toLowerCase());
  if (deja) throw new ActionError(`${entreprise} a déjà un lien en vigueur : révoquez-le pour en créer un nouveau`);
  const { jeton, lien } = await creerLien(ctx.db, { categorie, entreprise }, ctx.user.nom);
  return { message: `Lien de déclaration créé — ${entreprise} (copiez-le maintenant : il ne sera plus affiché)`, result: { id: lien.id, jeton } };
};

const revoquerLien: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const l = (ctx.ds.liensDeclaration ?? []).find(x => x.id === Number(p.id));
  if (!l) throw new ActionError('Lien introuvable', 404);
  if (l.revoqueLe) throw new ActionError('Lien déjà révoqué');
  await ctx.db.update<LienDeclaration>('liensDeclaration', l.id, { revoqueLe: new Date().toISOString(), revoquePar: ctx.user.nom });
  return { message: `Lien de ${l.entreprise} révoqué`, result: { id: l.id } };
};

const valider: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = declarationDe(ctx, p.id);
  if (d.statut !== 'a_valider') throw new ActionError('Seule une déclaration à valider se valide');
  if (d.au < ctx.d.ti) throw new ActionError('La venue déclarée est passée : refusez ou annulez la déclaration');
  let empId: number;
  let cree: string | null = null;
  if (p.empId != null && p.empId !== '') {
    const e = getPersonne(ctx, p.empId);
    const attendue = d.categorie;
    if (categorieDe(e) !== attendue) {
      throw new ActionError(attendue === 'exterieur' ? 'Rattachez la déclaration à une fiche d’extérieur' : 'Rattachez la déclaration à une fiche d’intérimaire');
    }
    empId = e.id;
  } else {
    if (d.categorie === 'interimaire') throw new ActionError('Créez d’abord la fiche de l’intérimaire (contrat d’intérim, agence), puis rattachez-y la déclaration');
    const f = await creerFicheExterieur(ctx, { nom: nomComplet(d), entreprise: d.entreprise, email: d.email });
    empId = f.id;
    cree = f.matriculeSite;
  }
  const maintenant = new Date().toISOString();
  await ctx.db.update<DeclarationPresence>('declarationsPresence', d.id, {
    statut: 'validee', empId, decideLe: maintenant, decidePar: ctx.user.nom, valideeLe: maintenant, majLe: maintenant,
  });
  return {
    message: `Déclaration ${refDeclaration(d.id)} validée${cree ? ` · fiche d’extérieur créée (matricule ${cree})` : ''}`,
    result: { id: d.id, empId, matriculeSite: cree },
  };
};

const refuser: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = declarationDe(ctx, p.id);
  if (d.statut !== 'a_valider') throw new ActionError('Seule une déclaration à valider se refuse');
  const motif = motifDe(p, 'du refus');
  const maintenant = new Date().toISOString();
  await ctx.db.update<DeclarationPresence>('declarationsPresence', d.id, { statut: 'refusee', decideLe: maintenant, decidePar: ctx.user.nom, motif, majLe: maintenant });
  return { message: `Déclaration ${refDeclaration(d.id)} refusée`, result: { id: d.id } };
};

const annuler: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = declarationDe(ctx, p.id);
  if (d.statut !== 'a_valider' && d.statut !== 'validee') throw new ActionError('Déclaration déjà refusée ou annulée');
  const motif = motifDe(p, 'de l’annulation');
  const maintenant = new Date().toISOString();
  await ctx.db.update<DeclarationPresence>('declarationsPresence', d.id, { statut: 'annulee', decideLe: maintenant, decidePar: ctx.user.nom, motif, majLe: maintenant });
  return { message: `Déclaration ${refDeclaration(d.id)} annulée`, result: { id: d.id, empId: d.empId } };
};

export const declarationsActions = {
  'presence.lien.creer': creerLienAction,
  'presence.lien.revoquer': revoquerLien,
  'presence.valider': valider,
  'presence.refuser': refuser,
  'presence.annuler': annuler,
} satisfies Record<string, ActionHandler>;
