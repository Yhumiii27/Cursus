// Paie : correspondance des rubriques internes avec le plan de paie Sage (écran Temps, « Rubriques de paie »), saisie et
// confirmée par l'administrateur RH ou le gestionnaire de paie, qui n'a pas accès aux Paramètres. Chaque modification
// est tracée (action liée à la paie, archivée 3 ans) ; un code non confirmé bloque toute transmission réelle.
import { RUBRIQUES_PAIE } from '../../../shared/constants.ts';
import { erreurCodeSage, rubriquesPaie } from '../../../shared/rules/paie.ts';
import type { RubriquePaie } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requirePaie, str } from './context.ts';

/**
 * `code` : rubrique interne ; `codeSage` : code du plan de paie (inchangé s'il est absent) ; `active` : exportée ou non ;
 * `confirmer` : code vérifié dans le plan de paie Sage (date et auteur), `false` pour retirer la confirmation. Un code
 * changé sans `confirmer` repasse « à confirmer ». Deux rubriques d'unités différentes (heures, jours) ne partagent
 * jamais un code Sage.
 */
const rubrique: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const code = str(p.code);
  if (!Object.hasOwn(RUBRIQUES_PAIE, code)) throw new ActionError('Rubrique de paie inconnue', 404);
  const table = rubriquesPaie(ctx.ds.rubriquesPaie), r = table.find(x => x.code === code)!;
  const codeSage = p.codeSage === undefined ? r.codeSage : str(p.codeSage);
  const erreur = erreurCodeSage(codeSage);
  if (erreur) throw new ActionError(erreur);
  const autre = table.find(x => x.code !== code && x.codeSage === codeSage && x.unite !== r.unite);
  if (autre) throw new ActionError(`Code Sage ${codeSage} déjà porté par ${autre.code} (${autre.unite === 'j' ? 'jours' : 'heures'}) : une rubrique ne mélange pas les unités`);
  const active = p.active === undefined ? r.active : !!p.active;
  // `confirmer` : true confirme (date du jour, auteur) ; false retire la confirmation ; absent : gardée si le code ne change pas.
  const confirmer = p.confirmer === true, retirer = p.confirmer === false || codeSage !== r.codeSage;
  const ligne: RubriquePaie & { modifieLe: string; modifiePar: string } = {
    code, codeSage, active,
    confirmeLe: confirmer ? ctx.d.ti : retirer ? null : r.confirmeLe,
    confirmePar: confirmer ? ctx.user.nom : retirer ? null : r.confirmePar,
    modifieLe: new Date().toISOString(), modifiePar: ctx.user.nom,
  };
  if (codeSage === r.codeSage && active === r.active && ligne.confirmeLe === r.confirmeLe && ligne.confirmePar === r.confirmePar) return `Rubrique ${code} inchangée`;
  if (ctx.db.get('rubriquesPaie', code)) ctx.db.update('rubriquesPaie', code, ligne);
  else ctx.db.insert('rubriquesPaie', ligne);
  const etat = !active ? 'désactivée, non exportée' : ligne.confirmeLe ? 'confirmé' : 'à confirmer';
  return `Rubrique ${code} : code Sage ${codeSage} (${etat})`;
};

export const paieActions: Record<string, ActionHandler> = {
  'paie.rubrique': rubrique,
};
