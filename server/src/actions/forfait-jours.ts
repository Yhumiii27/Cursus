// Forfait jours (t043) : avenant de renonciation à des jours de repos (art. L3121-59), enregistré et annulé par le service
// RH depuis la fiche du salarié. Ouvert seulement si l'accord collectif qui autorise le forfait est référencé dans
// Paramètres → Forfait jours (`forfaitJoursRachat`, contrôle COHERENCE) : sans lui, suivi du cumul et alertes seulement.
// L'avenant porte le plafond de l'année au forfait plus les jours rachetés (235 jours au plus à défaut d'accord,
// art. L3121-66) ; ses jours partent à la paie sous la rubrique JREN (server/src/forfait-jours.ts, registre des éléments
// de lot). Règles : shared/rules/forfait-jours.ts.
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { avenantsDe, erreursAvenant, etatRachat, periodeRachat, rachatOuvert, REFERENCE_AVENANT_MAX } from '../../../shared/rules/forfait-jours.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { AvenantForfait } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, getEmp, refuserSoiMeme, requireRh, str } from './context.ts';

/** Motif d'une annulation : 500 caractères au plus. */
const MOTIF_MAX = 500;

/** `empId`, `annee`, `jours` (demi-journées), `taux` (%), `signeLe`, `reference` (facultative). */
const creer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  // Un avenant qui touche sa propre rémunération se décide par un autre membre du service RH.
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer votre propre avenant de renonciation');
  const saisie = { annee: Number(p.annee), jours: Number(p.jours), taux: Number(p.taux), signeLe: str(p.signeLe), reference: str(p.reference) };
  const erreurs = erreursAvenant(ctx.d, emp, saisie);
  if (erreurs.length) throw new ActionError(erreurs.join(' ; '));
  const a = ctx.db.insert<AvenantForfait>('avenantsForfait', {
    empId: emp.id, annee: saisie.annee, jours: saisie.jours, taux: saisie.taux, signeLe: saisie.signeLe, reference: saisie.reference.slice(0, REFERENCE_AVENANT_MAX) || null,
    creeLe: new Date().toISOString(), creePar: ctx.user.nom, annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false,
  });
  const periode = periodeRachat(a, ctx.ds.settings, ctx.d.ti);
  // Plafond de l'année : forfait de la fiche, jours déjà rachetés (instantané d'avant l'action) et ceux de cet avenant.
  const plafond = ctx.d.contratOf(emp).joursForfait + avenantsDe(ctx.ds.avenantsForfait, emp.id, a.annee).reduce((n, x) => n + x.jours, 0) + a.jours;
  return {
    message: `Avenant de renonciation ${a.annee} de ${emp.nom} enregistré — ${plural(a.jours, 'jour racheté', 'jours rachetés')}, majoration de ${a.taux} %, signé le ${fmtIso(a.signeLe)}`
      + ` · plafond ${a.annee} porté à ${fJ(plafond)}`
      + ` · paie : rubrique JREN, ${periodeLabel(periode)}`,
    result: { id: a.id, empId: emp.id },
  };
};

/**
 * Annulation avec motif (texte libre du service RH, gardé sur l'avenant). Refusée tant que l'avenant est dans un lot de paie
 * dont l'import n'est pas confirmé (annuler d'abord le lot) ; déjà transmis, l'avenant est annulé et la correction se fait
 * dans Sage. Déjà annulé : rien n'est refait.
 */
const annuler: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const a = ctx.db.get<AvenantForfait>('avenantsForfait', Number(p.id));
  if (!a) throw new ActionError('Avenant introuvable', 404);
  const emp = getEmp(ctx, a.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas annuler votre propre avenant de renonciation');
  if (a.annuleLe) return { message: `Avenant de renonciation ${a.annee} de ${emp.nom} déjà annulé`, result: { id: a.id, empId: a.empId } };
  const motif = str(p.motif);
  if (!motif) throw new ActionError('Indiquez le motif de l’annulation');
  if (motif.length > MOTIF_MAX) throw new ActionError(`Motif trop long (${MOTIF_MAX} caractères au plus)`);
  if (a.lotId != null && !a.sage) {
    throw new ActionError(`Jours rachetés de ${emp.nom} compris dans le lot de paie n° ${a.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis l’avenant`, 409);
  }
  ctx.db.update<AvenantForfait>('avenantsForfait', a.id, { annuleLe: new Date().toISOString(), annulePar: ctx.user.nom, annuleMotif: motif });
  return {
    message: `Avenant de renonciation ${a.annee} de ${emp.nom} annulé${a.sage ? ` — ${etatRachat({ ...a, annuleLe: 'x' })}` : ''}`
      + `${rachatOuvert(ctx.ds.settings) ? '' : ' · renonciation fermée dans Paramètres : aucun nouvel avenant possible'}`,
    result: { id: a.id, empId: a.empId },
  };
};

export const forfaitJoursActions = {
  'forfait.avenant': creer,
  'forfait.annulerAvenant': annuler,
} satisfies Record<string, ActionHandler>;
