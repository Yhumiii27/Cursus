// Activités internes (codes INT-… et ECOLE, shared/rules/activites.ts) : tenues par le service RH dans l'écran
// Référentiels (onglet Activités internes), dans la table des projets ; la lecture seule consulte. Création (code choisi,
// jamais modifié), renommage, archivage (plus proposée dans les feuilles, gardée sur les feuilles déjà saisies) et
// rétablissement, tracés au journal avec les valeurs avant et après. Jamais envoyées à Keystone (ACTIVITES_INTERNES).
import { controlerActivite, estActiviteInterne, normaliserCodeActivite } from '../../../shared/rules/activites.ts';
import type { Projet } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh } from './context.ts';

/** Activité interne désignée par son code (`id`) ; un projet Keystone n'en est pas une : 404. */
function activite(ctx: Ctx, id: unknown): Projet {
  const code = normaliserCodeActivite(id);
  const a = ctx.ds.referentiels.projets.find(p => p.code === code);
  if (!a || !estActiviteInterne(a.code)) throw new ActionError('Activité interne introuvable', 404);
  return a;
}

/** Création (`code`, `nom`) ou renommage (`id` : le code, `nom`). */
const enregistrer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = p.id != null && p.id !== '' ? activite(ctx, p.id) : null;
  const { erreurs, activite: a } = controlerActivite(p, ctx.ds.referentiels.projets, avant);
  if (!a) throw new ActionError(erreurs.code ?? erreurs.nom ?? 'Saisie invalide');
  if (!avant) {
    await ctx.db.insert<Projet>('projets', a);
    return `Activité interne ${a.code} « ${a.nom} » créée : imputable dans les feuilles de temps`;
  }
  await ctx.db.update<Projet>('projets', a.code, { nom: a.nom });
  return `Activité interne ${a.code} renommée « ${a.nom} »`;
};

/** Archivage (`archive` vrai, par défaut) ou rétablissement (`archive: false`). */
const archiver: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const a = activite(ctx, p.id);
  const retablir = p.archive === false;
  if ((a.statut === 'archive') === !retablir) return null;
  await ctx.db.update<Projet>('projets', a.code, { statut: retablir ? 'actif' : 'archive' });
  return retablir
    ? `Activité interne ${a.code} rétablie : de nouveau proposée dans les feuilles de temps`
    : `Activité interne ${a.code} archivée : plus proposée dans les feuilles de temps (les heures déjà saisies restent)`;
};

export const activitesActions: Record<string, ActionHandler> = {
  'referentiel.activite.enregistrer': enregistrer,
  'referentiel.activite.archiver': archiver,
};
