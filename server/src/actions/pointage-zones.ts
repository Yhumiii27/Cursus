// Zones de la géolocalisation au pointage (lot 12, chantier C6, étape 3 ; règles : shared/rules/geolocalisation.ts). Table
// `zones_pointage`, hors de l'instantané (lue par GET /api/pointages/zones et par l'action pointage.pointer). Réservées à
// l'administrateur RH, comme les autres réglages du badgeage. Les zones se tiennent dans Cursus : `pub_sites` de Matrix et
// les chantiers Keystone n'ont pas de coordonnées.
//   pointage.zone.enregistrer   id (modification) ou rien (création), libelle, siteCode, chantierId, lat, lng, rayonM,
//                               actif : 200 zones au plus ; journal : identifiant, site ou chantier, rayon, état, jamais les
//                               coordonnées (libellé dans le message seulement)
//   pointage.zone.supprimer     id : la zone disparaît ; les verdicts déjà gardés sur les pointages restent
// Une zone supprimée ou désactivée ne change aucun pointage passé : seul le verdict du moment a été gardé.
import { lireZone, ZONES_MAX } from '../../../shared/rules/geolocalisation.ts';
import type { ZonePointage } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requireRhAdmin } from './context.ts';

const enregistrer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const z = lireZone(p);
  if (typeof z === 'string') throw new ActionError(z);
  if (p.id != null) {
    const id = Number(p.id) || 0, avant = await ctx.db.get<ZonePointage>('zonesPointage', id);
    if (!avant) throw new ActionError('Zone de pointage introuvable', 404);
    await ctx.db.update<ZonePointage>('zonesPointage', id, z);
    return { message: `Zone « ${z.libelle} » enregistrée${z.actif ? '' : ' (désactivée)'}`, result: { id, siteCode: z.siteCode, chantierId: z.chantierId, rayonM: z.rayonM, actif: z.actif } };
  }
  if ((await ctx.db.count('zonesPointage')) >= ZONES_MAX) throw new ActionError(`${ZONES_MAX} zones de pointage au plus`, 409);
  const row = await ctx.db.insert<ZonePointage>('zonesPointage', z);
  return { message: `Zone « ${z.libelle} » ajoutée`, result: { id: row.id, siteCode: z.siteCode, chantierId: z.chantierId, rayonM: z.rayonM, actif: z.actif, creee: true } };
};

const supprimer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const id = Number(p.id) || 0, z = await ctx.db.get<ZonePointage>('zonesPointage', id);
  if (!z) throw new ActionError('Zone de pointage introuvable', 404);
  await ctx.db.remove('zonesPointage', id);
  return { message: `Zone « ${z.libelle} » supprimée ; les pointages déjà faits gardent leur verdict`, result: { id } };
};

export const zoneActions = {
  'pointage.zone.enregistrer': enregistrer,
  'pointage.zone.supprimer': supprimer,
} satisfies Record<string, ActionHandler>;
