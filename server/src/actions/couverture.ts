// Couverture minimale des équipes (t067, lot 6, chantier 4) : minimum de membres formés (SST, EPI incendie…), enregistré
// avec les exigences communes de l'équipe (`referentiel.equipe.exigences`, ./referentiels.ts), comme la case « travail de
// nuit » (./mineurs.ts). Aucun seuil par défaut ; contrôles partagés avec le dialogue : shared/rules/couverture.ts.
import { present } from '../../../shared/rules/contrats.ts';
import { controlerCouverture, couvertureEquipe } from '../../../shared/rules/couverture.ts';
import { plural } from '../../../shared/format.ts';
import type { Equipe } from '../../../shared/types.ts';
import { ActionError, type Ctx } from './context.ts';

/**
 * Couverture minimale de l'équipe `q` : `couverture` reçue (liste de { formation, min } ; vide : aucun seuil ; absente :
 * inchangée). Renvoie la suite du message de l'action (vide si rien ne change) ; refus sur une ligne invalide.
 */
export function enregistrerCouvertureEquipe(ctx: Ctx, q: Equipe, couverture: unknown): string {
  if (couverture === undefined) return '';
  const avant = couvertureEquipe(q);
  const effectif = ctx.ds.employes.filter(e => e.equipe === q.nom && present(e, ctx.d.ti)).length;
  const { erreur, lignes } = controlerCouverture(couverture, ctx.ds.referentiels, effectif, avant);
  if (erreur) throw new ActionError(erreur);
  if (JSON.stringify(lignes) === JSON.stringify(avant)) return '';
  ctx.db.update<Equipe>('equipes', q.nom, { couverture: lignes.length ? lignes : null });
  if (!lignes.length) return ' · couverture minimale retirée';
  return ` · couverture minimale : ${lignes.map(l => `${plural(l.min, 'titulaire', 'titulaires')} ${ctx.d.fm(l.formation)?.court ?? l.formation}`).join(', ')}`;
}
