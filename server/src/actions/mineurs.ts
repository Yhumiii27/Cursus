// Salariés de moins de 18 ans (lot 5, chantier E, étape 2) : case « travail de nuit ou en continu » des équipes,
// enregistrée avec leurs exigences communes (`referentiel.equipe.exigences`, ./referentiels.ts). Faute d'horaires dans
// Cursus, elle tient lieu de contrôle de l'interdiction du travail de nuit (art. L3163-2) : une équipe cochée ne reçoit
// aucun salarié mineur (fiche, affectation, import : `refusEquipeNuit` de shared/rules/mineurs.ts), et une équipe qui en
// compte un ne se coche pas. Règles : shared/rules/mineurs.ts.
import { mineursDeLEquipe } from '../../../shared/rules/mineurs.ts';
import type { Equipe } from '../../../shared/types.ts';
import { ActionError, type Ctx } from './context.ts';

/**
 * Case « travail de nuit ou en continu » de l'équipe `q` : `nuit` reçu (booléen ; absent : inchangée). Renvoie la suite du
 * message de l'action (vide si rien ne change) ; refus si l'équipe compte un salarié mineur, présent ou à venir.
 */
export function enregistrerNuitEquipe(ctx: Ctx, q: Equipe, nuit: unknown): string {
  if (nuit === undefined) return '';
  if (typeof nuit !== 'boolean') throw new ActionError('Travail de nuit ou en continu : oui ou non');
  // Case renseignée (même décochée) : le rappel de la fiche des salariés mineurs de l'équipe disparaît.
  if (q.nuit === nuit) return '';
  if (nuit) {
    const mineurs = mineursDeLEquipe(ctx.ds.employes, q.nom, ctx.d.ti);
    if (mineurs.length) {
      throw new ActionError(`L’équipe ${q.nom} compte un salarié de moins de 18 ans (${mineurs.map(e => e.nom).join(', ')}) : il ne peut pas travailler de nuit (art. L3163-2) — affectez-le d’abord à une autre équipe`);
    }
  }
  ctx.db.update<Equipe>('equipes', q.nom, { nuit });
  return nuit ? ' · équipe de nuit ou en continu : aucun salarié de moins de 18 ans n’y sera affecté' : ' · équipe sans travail de nuit ni en continu';
}
