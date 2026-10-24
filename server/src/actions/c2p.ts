// Compte professionnel de prévention (t052, shared/rules/c2p.ts) : ce que le service RH et le référent HSE qualifient
// eux-mêmes, Cursus comptant le reste d'après les feuilles validées (synthèse calculée par server/src/dataset.ts).
// - Facteurs d'exposition d'un poste (`referentiel.poste.expositions`) : travail répétitif, milieu hyperbare, températures
//   extrêmes, bruit, cochés quand ses titulaires y sont exposés au-delà du seuil de l'art. D4163-2 après protections ;
//   décochés par défaut, un poste archivé compris (il nomme encore l'exposition de l'année de ses anciens titulaires).
// - Qualification d'un horaire (`referentiel.horaire.alternant`) : roulement en équipes successives alternantes (oui),
//   non, ou de nouveau à qualifier. Elle vaut pour toutes les nuits comptées sous cet horaire, feuilles passées comprises :
//   le roulement est une propriété de l'organisation, pas des heures figées.
// Seuils et plage 0 h – 5 h ne se règlent pas (réglementaires). Tracés au journal : identifiant ou code, valeurs avant et
// après (codes et booléens, aucune donnée personnelle). Ni le manager, ni le collaborateur, ni la lecture seule n'agissent.
import { plural } from '../../../shared/format.ts';
import { FACTEURS_C2P } from '../../../shared/constants.ts';
import { alternantTexte, controlerFacteursPoste, facteursDuPoste, qualificationAlternant } from '../../../shared/rules/c2p.ts';
import { horaireDe, normaliserCodeHoraire } from '../../../shared/rules/horaires.ts';
import type { Horaire, Poste } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requireFormations } from './context.ts';

/** Facteurs cochés sur un poste : id, facteurs (codes ; [] : aucun). */
const facteursPoste: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const x = ctx.ds.referentiels.postes.find(y => y.id === Number(p.id));
  if (!x) throw new ActionError('Poste introuvable', 404);
  const { facteurs, erreur } = controlerFacteursPoste(p.facteurs);
  if (erreur) throw new ActionError(erreur);
  const avant = facteursDuPoste(x);
  if (avant.join() === facteurs.join()) return `Poste « ${x.nom} » : facteurs d’exposition inchangés`;
  await ctx.db.update<Poste>('postes', x.id, { c2p: facteurs.length ? facteurs : null });
  return facteurs.length
    ? `Poste « ${x.nom} » : ${plural(facteurs.length, 'facteur d’exposition coché', 'facteurs d’exposition cochés')} (${facteurs.map(f => FACTEURS_C2P[f].label.toLowerCase()).join(', ')}) — exposition de ses titulaires sur leur période`
    : `Poste « ${x.nom} » : aucun facteur d’exposition coché`;
};

/** Qualification d'un horaire : id (code), alternant (vrai, faux, ou null : à qualifier). */
const alternant: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const h = horaireDe(ctx.ds.referentiels, normaliserCodeHoraire(p.id));
  if (!h) throw new ActionError('Horaire introuvable', 404);
  const v = qualificationAlternant(p.alternant);
  if (v === undefined) throw new ActionError('Qualification invalide : oui, non ou à qualifier');
  if ((h.alternant ?? null) === v) return null;
  await ctx.db.update<Horaire>('horaires', h.code, { alternant: v });
  return `Horaire ${h.code} : ${alternantTexte(v).toLowerCase()} — nuits recomptées sur les feuilles validées`;
};

export const c2pActions = {
  'referentiel.poste.expositions': facteursPoste,
  'referentiel.horaire.alternant': alternant,
} satisfies Record<string, ActionHandler>;
