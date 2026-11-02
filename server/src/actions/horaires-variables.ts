// Horaires variables (lot 12, chantier C6, étape 2 ; shared/rules/horaires-variables.ts) : un horaire du référentiel
// devient variable (plages fixes et mobiles, durée de référence, plafonds du report) ou redevient fixe. Service RH (comme
// l'enregistrement d'un horaire) ; la lecture seule consulte. Les plafonds autres que les supplétifs (3 h par semaine,
// 10 h de cumul) exigent la référence de l'accord collectif, jamais recopiée au journal (codes, booléens et minutes
// seulement : server/src/journal.ts).
//   referentiel.horaire.variable  id (code de l'horaire), variable (booléen), plages [{ type, debut, fin }],
//                                 dureeReference, reportMaxSemaine, cumulMax (minutes ; vides : durée de l'horaire et
//                                 plafonds supplétifs), accordVariable
import { controlerHoraireVariable, plagesTexte } from '../../../shared/rules/horaires-variables.ts';
import { horaireDe, normaliserCodeHoraire } from '../../../shared/rules/horaires.ts';
import { fH } from '../../../shared/format.ts';
import type { Horaire } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requireRh } from './context.ts';

const variable: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const h = horaireDe(ctx.ds.referentiels, normaliserCodeHoraire(p.id));
  if (!h) throw new ActionError('Horaire introuvable', 404);
  const { erreurs, champs } = controlerHoraireVariable(h, p);
  if (!champs) throw new ActionError(erreurs.plages ?? erreurs.dureeReference ?? erreurs.reportMaxSemaine ?? erreurs.cumulMax ?? erreurs.accordVariable ?? 'Saisie invalide');
  if (!h.variable && !champs.variable) return null;
  await ctx.db.update<Horaire>('horaires', h.code, champs);
  return champs.variable
    ? `Horaire ${h.code} variable : ${plagesTexte(champs.plages ?? [])}, ${fH((champs.dureeReference ?? 0) / 60)} par jour, report de ${fH((champs.reportMaxSemaine ?? 0) / 60)} par semaine et ${fH((champs.cumulMax ?? 0) / 60)} de cumul`
    : `Horaire ${h.code} redevenu fixe : plages et plafonds retirés`;
};

export const horairesVariablesActions = {
  'referentiel.horaire.variable': variable,
} satisfies Record<string, ActionHandler>;
