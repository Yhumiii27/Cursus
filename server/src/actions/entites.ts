// Entités et organigramme (lot 11, chantier C1, t195 ; shared/rules/entites.ts, shared/rules/organigramme.ts) : entités
// juridiques (société, établissement) au-dessus des équipes, sites de rattachement (cache de matrix.pub_sites) et
// rattachements d'une équipe ; impression et export de l'organigramme, signalés au journal.
// - Service RH : création et modification d'une entité (code choisi, jamais modifié ; type fixé à la création), d'un site,
//   rattachement d'une équipe racine à une entité, site et unité Matrix d'une équipe. Une entité tenue par Matrix
//   (`source = 'matrix'`) ne se modifie pas ici.
// - Administrateur RH : fermeture (refusée tant qu'elle porte des équipes ou des établissements ouverts) et réouverture.
// - Aucun valideur ne change : l'entité n'est qu'un regroupement au-dessus des équipes racines ; la hiérarchie des
//   managers reste celle des équipes parentes (actions/hierarchie.ts).
// - Étape 2 : le site et l'unité des salariés suivent ceux de leur équipe (server/src/rattachements.ts), recalculés après
//   chaque rattachement d'une équipe et chaque changement du site d'une entité.
// - Organigramme : impression et export par qui le voit (réglage `organigrammeOuvert`) ; le journal n'en garde que
//   l'entité et le nombre de lignes, jamais un nom.
import { plural } from '../../../shared/format.ts';
import {
  controleEntiteEquipe, controlerEntite, controlerSite, controleSite, controleUnite, entiteDe, entiteOuverte, normaliserCodeEntite, normaliserCodeUnite,
  refusFermeture, refusReouverture, TYPES_ENTITE,
} from '../../../shared/rules/entites.ts';
import { organigrammeOuvertA } from '../../../shared/rules/organigramme.ts';
import type { Entite, Equipe, Site } from '../../../shared/types.ts';
import { recalerRattachements } from '../rattachements.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh, requireRhAdmin } from './context.ts';

const entitesDe = (ctx: Ctx) => ctx.ds.referentiels.entites ?? [];
const sitesDe = (ctx: Ctx) => ctx.ds.referentiels.sites ?? [];

/** Entité désignée par son code (`code`) : 404 si elle n'existe pas. */
function entite(ctx: Ctx, code: unknown): Entite {
  const x = entiteDe(entitesDe(ctx), normaliserCodeEntite(code));
  if (!x) throw new ActionError('Entité introuvable', 404);
  return x;
}

function equipe(ctx: Ctx, nom: unknown): Equipe {
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  return q;
}

/** « Société X créée », « Établissement Y créé » : participe accordé au type de l'entité. */
const accord = (x: Pick<Entite, 'type' | 'nom'>, participe: string) => `${TYPES_ENTITE[x.type]} ${x.nom} ${participe}${x.type === 'societe' ? 'e' : ''}`;
const proposee = (x: Pick<Entite, 'type'>) => `proposé${x.type === 'societe' ? 'e' : ''} au rattachement des équipes`;

/** Première erreur d'une saisie contrôlée, dans l'ordre des champs du dialogue. */
const premiere = (erreurs: Record<string, string | undefined>) => Object.values(erreurs).find(Boolean) ?? 'Saisie invalide';

/** `code`, `nom`, `type` (societe, etablissement), `parente` (société d'un établissement), `siren`, `siret`, `idcc`, `siteCode`. */
const creer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const { erreurs, entite: x } = controlerEntite(p, entitesDe(ctx), sitesDe(ctx), null);
  if (!x) throw new ActionError(premiere({ ...erreurs }));
  await ctx.db.insert<Entite>('entites', x);
  return `${accord(x, 'créé')}${x.type === 'etablissement' ? ` (société ${entiteDe(entitesDe(ctx), x.parente)?.nom ?? x.parente})` : ''} : ${proposee(x)}`;
};

/**
 * `code` et les mêmes champs que la création, sauf le code et le type (fixés une fois pour toutes). Un champ absent de la
 * requête garde sa valeur ; null ou une chaîne vide l'efface.
 */
const modifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = entite(ctx, p.code);
  if (avant.source === 'matrix') throw new ActionError(`L’entité ${avant.nom} est tenue par Matrix : elle se modifie dans le référentiel commun`);
  if (p.type !== undefined && p.type !== avant.type) throw new ActionError('Le type d’une entité ne change pas : créez une nouvelle entité, puis rattachez-y les équipes');
  const saisie = { ...p };
  for (const k of ['nom', 'parente', 'siren', 'siret', 'idcc', 'siteCode'] as const) if (saisie[k] === undefined) saisie[k] = avant[k];
  const { erreurs, entite: x } = controlerEntite(saisie, entitesDe(ctx), sitesDe(ctx), avant);
  if (!x) throw new ActionError(premiere({ ...erreurs }));
  const champs = { nom: x.nom, parente: x.parente, siren: x.siren, siret: x.siret, idcc: x.idcc, siteCode: x.siteCode };
  if ((Object.keys(champs) as (keyof typeof champs)[]).every(k => (avant[k] ?? null) === champs[k])) return null;
  await ctx.db.update<Entite>('entites', avant.code, champs);
  // Site de l'entité : celui des salariés dont l'équipe n'en porte pas (étape 2, server/src/rattachements.ts).
  if ((avant.siteCode ?? null) !== x.siteCode) await recalerRattachements(ctx.db);
  return accord(x, 'enregistré');
};

/** Fermeture (`code`) : plus proposée ; refusée tant qu'elle porte des équipes ou, pour une société, des établissements ouverts. */
const fermer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const x = entite(ctx, p.code);
  if (!entiteOuverte(x)) return null;
  if (x.source === 'matrix') throw new ActionError(`L’entité ${x.nom} est tenue par Matrix : sa fermeture se fait dans le référentiel commun`);
  const refus = refusFermeture(x, entitesDe(ctx), ctx.ds.referentiels.equipes);
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Entite>('entites', x.code, { actif: false, fermeLe: ctx.d.ti });
  return `${accord(x, 'fermé')} : plus ${proposee(x)}`;
};

/** Réouverture (`code`) ; un établissement dont la société est fermée attend sa réouverture. */
const rouvrir: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const x = entite(ctx, p.code);
  if (entiteOuverte(x)) return null;
  if (x.source === 'matrix') throw new ActionError(`L’entité ${x.nom} est tenue par Matrix : sa réouverture se fait dans le référentiel commun`);
  const refus = refusReouverture(x, entitesDe(ctx));
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Entite>('entites', x.code, { actif: true, fermeLe: null });
  return accord(x, 'rouvert');
};

/** Site de rattachement : création (`code`, `libelle`) ou modification (`id` : le code ; `libelle`, `actif`). */
const enregistrerSite: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = p.id != null && p.id !== '' ? sitesDe(ctx).find(s => s.code === normaliserCodeEntite(p.id)) : null;
  if (p.id != null && p.id !== '' && !avant) throw new ActionError('Site introuvable', 404);
  const { erreurs, site } = controlerSite(p, sitesDe(ctx), avant ?? null);
  if (!site) throw new ActionError(premiere({ ...erreurs }));
  if (!avant) {
    await ctx.db.insert<Site>('sites', site);
    return `Site ${site.libelle} créé`;
  }
  if (avant.libelle === site.libelle && avant.actif === site.actif) return null;
  await ctx.db.update<Site>('sites', avant.code, { libelle: site.libelle, actif: site.actif });
  return `Site ${site.libelle} enregistré${avant.actif && !site.actif ? ' : plus proposé (les équipes qui le portent le gardent)' : ''}`;
};

/** Entité d'une équipe racine (`nom`, `entite` : code, ou vide pour aucune). Aucun valideur ne change. */
const entiteEquipe: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = equipe(ctx, p.nom);
  const code = normaliserCodeEntite(p.entite) || null;
  if ((q.entite ?? null) === code) return null;
  const refus = controleEntiteEquipe(ctx.ds.referentiels.equipes, entitesDe(ctx), q.nom, code);
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Equipe>('equipes', q.nom, { entite: code });
  await recalerRattachements(ctx.db);
  const x = entiteDe(entitesDe(ctx), code);
  return x ? `L’équipe ${q.nom} relève de ${x.nom}, avec ses équipes rattachées` : `L’équipe ${q.nom} ne relève plus d’aucune entité`;
};

/** Site de rattachement d'une équipe (`nom`, `siteCode` : code, ou vide pour celui de l'équipe au-dessus ou de l'entité). */
const siteEquipe: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = equipe(ctx, p.nom);
  const code = normaliserCodeEntite(p.siteCode) || null;
  if ((q.siteCode ?? null) === code) return null;
  const refus = controleSite(sitesDe(ctx), code, q.siteCode);
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Equipe>('equipes', q.nom, { siteCode: code });
  await recalerRattachements(ctx.db);
  const s = sitesDe(ctx).find(x => x.code === code);
  return s ? `L’équipe ${q.nom} est rattachée au site ${s.libelle}` : `L’équipe ${q.nom} n’a plus de site propre`;
};

/** Unité de l'organigramme de Matrix d'une équipe (`nom`, `uniteCode` : code saisi à la main, ou vide). */
const uniteEquipe: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = equipe(ctx, p.nom);
  const code = normaliserCodeUnite(p.uniteCode) || null;
  if ((q.uniteCode ?? null) === code) return null;
  const refus = controleUnite(ctx.ds.referentiels.equipes, q.nom, code);
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Equipe>('equipes', q.nom, { uniteCode: code });
  await recalerRattachements(ctx.db);
  return code ? `L’équipe ${q.nom} correspond à l’unité ${code} de l’organigramme de Matrix` : `L’équipe ${q.nom} n’a plus d’unité Matrix`;
};

/**
 * Impression ou export de l'organigramme (`entite` : code de l'entité filtrée, ou vide ; `lignes` : nombre de lignes ;
 * lot 12 — C7 : `service`, nom de l'équipe choisie, facultatif),
 * signalés au journal par qui le voit (réglage `organigrammeOuvert`) ; rien n'est écrit en base.
 */
const signaler = (nature: 'imprimé' | 'exporté'): ActionHandler => (ctx, p) => {
  if (!organigrammeOuvertA(ctx.ds.settings.organigrammeOuvert, ctx.user.role)) throw new ActionError('Organigramme réservé au service RH', 403);
  const code = normaliserCodeEntite(p.entite) || null;
  if (code && !entiteDe(entitesDe(ctx), code)) throw new ActionError('Entité introuvable', 404);
  // Un nombre entier, tel que le journal le recopie (jamais une chaîne convertie).
  const n = p.lignes as number;
  if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new ActionError('Nombre de lignes invalide');
  // lot 12 — C7 (organigramme) : service choisi, nom d'une équipe du référentiel (jamais un texte libre au journal).
  if (p.service !== undefined && p.service !== null && p.service !== '' && (typeof p.service !== 'string' || !ctx.ds.referentiels.equipes.some(q => q.nom === p.service))) {
    throw new ActionError('Service introuvable', 404);
  }
  const service = typeof p.service === 'string' && p.service ? `, service ${p.service}` : '';
  return `Organigramme ${nature}${code ? ` (${entiteDe(entitesDe(ctx), code)!.nom})` : ''}${service} : ${plural(n, 'ligne', 'lignes')}`;
};

export const entitesActions = {
  'entite.creer': creer,
  'entite.modifier': modifier,
  'entite.fermer': fermer,
  'entite.rouvrir': rouvrir,
  'site.enregistrer': enregistrerSite,
  'equipe.entite': entiteEquipe,
  'equipe.site': siteEquipe,
  'equipe.unite': uniteEquipe,
  'organigramme.imprimer': signaler('imprimé'),
  'organigramme.exporter': signaler('exporté'),
} satisfies Record<string, ActionHandler>;
