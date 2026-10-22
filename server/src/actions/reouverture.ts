// Réouverture d'une feuille de temps validée (t131) : administrateur RH seul, motif obligatoire (réponse de l'entreprise
// du 17 octobre 2026), gardé sur la feuille ; le journal trace la réouverture comme une action de paie (salarié, semaine,
// lot d'origine), sans recopier le motif. Règles : shared/rules/regularisation.ts.
//   temps.rouvrir   { empId, week, motif, renvoyer? }   feuille validée → « soumise » (corrigée par son valideur), ou
//                                                       « à corriger » avec `renvoyer` (renvoyée au salarié, motif en
//                                                       commentaire, notification).
// Refus : feuille d'un lot de paie généré mais pas confirmé (annuler d'abord le lot, qui la libère) ; feuille d'un
// intérimaire dont le relevé est parti à l'agence (la correction se règle avec l'agence). Feuille transmise : elle
// garde les rubriques déjà parties ; revalidée, l'écart part dans le lot suivant (lot correctif). Les heures déjà
// renvoyées à Keystone sont gardées pour y renvoyer à 0 un projet retiré.
import { isoWeek } from '../../../shared/dates.ts';
import { erreurMotifReouverture } from '../../../shared/rules/regularisation.ts';
import { employeDeLaFeuille } from '../../../shared/rules/temps.ts';
import type { FeuilleTemps, LotPaie, ReouvertureFeuille } from '../../../shared/types.ts';
import { heuresKeystone } from '../integrations/keystone.ts';
import { notifierFeuilleRenvoyee } from '../notifications.ts';
import { releveParti, transmisDeLaFeuille } from '../regularisation-paie.ts';
import { ActionError, type ActionHandler, estSoiMeme, getEmp, requireRhAdmin } from './context.ts';

const rouvrir: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const emp = getEmp(ctx, p.empId);
  // Pas refuserSoiMeme : son renvoi vers le manager ou un autre membre du service RH ne vaut pas ici, la réouverture est
  // réservée à l'administrateur RH.
  if (estSoiMeme(ctx, emp.id)) throw new ActionError('Vous ne pouvez pas rouvrir votre propre feuille de temps : la réouverture revient à un autre administrateur RH', 403);
  const week = String(p.week ?? '');
  const sh = ctx.ds.feuilles.find(f => f.empId === emp.id && f.week === week);
  if (!sh || sh.statut !== 'validee') throw new ActionError('Seule une feuille validée se rouvre');
  const motif = typeof p.motif === 'string' ? p.motif.trim() : '';
  const erreur = erreurMotifReouverture(motif);
  if (erreur) throw new ActionError(erreur);
  if (sh.lotId && !sh.sage) {
    const lot = ctx.db.get<LotPaie>('lotsPaie', sh.lotId);
    if (lot?.statut === 'genere') {
      throw new ActionError(`Feuille comprise dans le lot de paie n° ${lot.id}, import à confirmer : annulez d’abord ce lot (écran Temps, « Transmission à Sage Paie »), qui la libère, puis rouvrez-la`, 409);
    }
  }
  const c = ctx.d.contratOf(employeDeLaFeuille(emp, sh));
  if (c.interim && releveParti(ctx.db, emp.agence, sh.week)) {
    throw new ActionError(`Relevé d’heures de la semaine ${isoWeek(sh.week)} déjà envoyé à l’agence ${emp.agence} : la feuille ne se rouvre pas, la correction se règle avec l’agence`, 409);
  }
  const avant = sh.reouverture ?? null;
  // Transmise : ce qui est parti (dernier lot transmis). Rouverte de nouveau avant d'être transmise : l'état d'avant reste
  // celui que la paie a reçu.
  const paie = sh.sage ? transmisDeLaFeuille(ctx.db, ctx.d, sh)
    : { rubriques: avant?.rubriques ?? null, lot: avant?.lot ?? null, source: avant?.source ?? null, aSaisir: avant?.aSaisir ?? null };
  const renvoyer = p.renvoyer === true;
  const reouverture: ReouvertureFeuille = {
    le: new Date().toISOString(), par: ctx.user.nom, motif, renvoyee: renvoyer,
    transmise: !!paie.rubriques, lot: paie.lot, rubriques: paie.rubriques, source: paie.source,
    // Heures de nuit déjà listées à saisir dans Sage (rubriques désactivées) : la régularisation en liste l'écart.
    ...(paie.aSaisir ? { aSaisir: paie.aSaisir } : {}),
    // Lignes inchangées depuis la validation : les heures de ses projets sont celles renvoyées à Keystone.
    keystone: sh.keystone ? heuresKeystone(sh.lignes) : avant?.keystone ?? null,
    precedentes: avant ? [...(avant.precedentes ?? []), { le: avant.le, par: avant.par, motif: avant.motif }] : [],
  };
  // La contrepartie en repos sera refigée à la revalidation (corAValider) ; régime, mode des heures supplémentaires et
  // majorations restent figés.
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, {
    statut: renvoyer ? 'rejetee' : 'soumise', comment: renvoyer ? motif : null, sage: false, lotId: null, keystone: false, cor: null, reouverture,
  });
  if (renvoyer) notifierFeuilleRenvoyee(ctx, emp, sh.week);
  const suite = reouverture.transmise
    ? ' · déjà transmise à la paie : à la revalidation, seul l’écart partira dans le prochain lot (lot correctif)'
    : sh.lotId ? '' : ' · pas encore transmise à la paie';
  return {
    message: `Feuille de la semaine ${isoWeek(sh.week)} de ${emp.nom} rouverte — ${renvoyer ? 'renvoyée au salarié pour correction' : 'à corriger puis revalider'}${suite}${reouverture.keystone ? ' · Keystone recevra les heures corrigées à la revalidation' : ''}`,
    result: { lot: reouverture.lot, transmise: reouverture.transmise },
  };
};

export const reouvertureActions = {
  'temps.rouvrir': rouvrir,
} satisfies Record<string, ActionHandler>;
