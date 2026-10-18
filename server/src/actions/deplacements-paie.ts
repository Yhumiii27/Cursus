// Déplacements dans la paie (t031) : qualification « grand déplacement » d'un chantier en France par le service RH
// (écran Missions). Le critère URSSAF (distance, temps de trajet) ne se calcule pas sans adresses : la qualification est
// saisie, proposée pour un chantier en France (shared/rules/deplacements-paie.ts). Elle vaut pour toutes les missions du
// chantier ; Keystone ne la transmet ni ne l'écrase. Un changement après la transmission part en régularisation au
// prochain lot de paie (écart avec ce qui est parti).
import { plural } from '../../../shared/format.ts';
import { deplacementsDansLeFichier, grandDeplacementPropose } from '../../../shared/rules/deplacements-paie.ts';
import type { Chantier } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requireRh, str } from './context.ts';

/** `id` : chantier Keystone ; `grandDeplacement` : vrai, faux, ou null (qualification retirée, de nouveau à qualifier). */
const qualifier: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const c = ctx.d.chantier(str(p.id));
  if (!c) throw new ActionError('Chantier introuvable', 404);
  if (!grandDeplacementPropose(c)) throw new ActionError(`Chantier ${c.id} à l’étranger : ses jours partent à la paie avec le déplacement vers ${c.pays}, sans qualification`);
  if (p.grandDeplacement !== true && p.grandDeplacement !== false && p.grandDeplacement !== null) throw new ActionError('Qualification attendue : grand déplacement ou non');
  const valeur = p.grandDeplacement as boolean | null;
  const missions = ctx.ds.missions.filter(m => m.projet === c.id);
  const salaries = [...new Set(missions.map(m => m.empId))];
  if ((c.grandDeplacement ?? null) === valeur) return { message: `Chantier ${c.id} : qualification inchangée`, result: { salaries } };
  ctx.db.update<Chantier>('chantiers', c.id, { grandDeplacement: valeur });
  const etat = valeur === true ? 'grand déplacement' : valeur === false ? 'pas de grand déplacement' : 'à qualifier';
  const paie = valeur === true
    ? (deplacementsDansLeFichier(ctx.ds.settings) ? 'jours, nuits et trajets dans les prochains lots de paie' : 'jours, nuits et trajets calculés, à saisir dans Sage (réglage « déplacements dans le fichier de paie » décoché)')
    : 'rien ne part à la paie ; ce qui est déjà parti se régularise au prochain lot';
  return {
    message: `Chantier ${c.id} (${c.nom}, ${c.lieu}) : ${etat} — ${plural(missions.length, 'mission', 'missions')}${missions.length ? ` · ${paie}` : ''}`,
    result: { salaries },
  };
};

export const deplacementsPaieActions: Record<string, ActionHandler> = {
  'chantier.grandDeplacement': qualifier,
};
