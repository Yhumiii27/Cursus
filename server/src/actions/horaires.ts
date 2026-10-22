// Horaires de poste (t048, étape 1 ; shared/rules/horaires.ts) : référentiel « Horaires » tenu par le service RH (écran
// Référentiels → Horaires ; la lecture seule consulte), horaire par défaut d'une équipe (dialogue des exigences de
// l'équipe, `referentiel.equipe.exigences`) et horaire du jour sur la feuille de temps (`temps.horaire` : le salarié,
// son manager ou le service RH, aux mêmes conditions que la saisie des heures). Création (code choisi, jamais modifié),
// modification, archivage (plus proposé ; les feuilles qui le portent le gardent) et rétablissement, tracés au journal
// avec les valeurs avant et après. L'horaire, avec ses heures, est figé sur la feuille à sa soumission et à sa validation
// (`horairesAFiger`, server/src/actions/temps.ts) : modifier un horaire ne change pas le sens des feuilles déjà soumises.
// Un horaire qui empiète sur la nuit ne se choisit pas pour un salarié de moins de 18 ans (étape 2 : shared/rules/repos-nuit.ts).
import { controlerHoraire, equipesDeLHoraire, horaireDe, horaireTexte, normaliserCodeHoraire } from '../../../shared/rules/horaires.ts';
import { refusNuitMineur } from '../../../shared/rules/repos-nuit.ts';
import { JOURS_FEUILLE } from '../../../shared/rules/semaine.ts';
import { addD } from '../../../shared/dates.ts';
import type { Equipe, FeuilleTemps, Horaire } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh } from './context.ts';
import { editable } from './temps.ts';

/** Horaire désigné par son code (`id`) : 404 s'il n'existe pas. */
function horaire(ctx: Ctx, id: unknown): Horaire {
  const h = horaireDe(ctx.ds.referentiels, normaliserCodeHoraire(id));
  if (!h) throw new ActionError('Horaire introuvable', 404);
  return h;
}

/** Création (`code`, nom, debut, fin, pause) ou modification (`id` : le code). */
const enregistrer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = p.id != null && p.id !== '' ? horaire(ctx, p.id) : null;
  const { erreurs, horaire: h } = controlerHoraire(p, ctx.ds.referentiels.horaires ?? [], avant);
  if (!h) throw new ActionError(erreurs.code ?? erreurs.nom ?? erreurs.debut ?? erreurs.fin ?? erreurs.pause ?? 'Saisie invalide');
  if (!avant) {
    await ctx.db.insert<Horaire>('horaires', h);
    return `Horaire ${horaireTexte(h)} créé : proposé dans les feuilles de temps`;
  }
  await ctx.db.update<Horaire>('horaires', h.code, { nom: h.nom, debut: h.debut, fin: h.fin, pause: h.pause });
  // Les feuilles déjà soumises ou validées gardent les heures figées avec le code (`FeuilleTemps.horairesFiges`) : les
  // contrôles d'une semaine passée ne changent pas après coup.
  const heures = avant.debut !== h.debut || avant.fin !== h.fin || avant.pause !== h.pause;
  return `Horaire ${horaireTexte(h)} enregistré${heures ? ' : les feuilles déjà soumises gardent les heures d’avant' : ''}`;
};

/** Archivage (`archive` vrai, par défaut) ou rétablissement (`archive: false`) ; refusé tant qu'une équipe le propose. */
const archiver: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const h = horaire(ctx, p.id);
  const retablir = p.archive === false;
  if (!!h.archive === !retablir) return null;
  if (!retablir) {
    const equipes = equipesDeLHoraire(ctx.ds.referentiels.equipes, h.code);
    if (equipes.length) throw new ActionError(`Horaire ${h.code} proposé par défaut à l’équipe ${equipes.join(', ')} : choisissez-lui d’abord un autre horaire (onglet Postes, exigences et organisation de l’équipe)`);
  }
  await ctx.db.update<Horaire>('horaires', h.code, { archive: retablir ? null : ctx.d.ti });
  return retablir
    ? `Horaire ${h.code} rétabli : de nouveau proposé dans les feuilles de temps`
    : `Horaire ${h.code} archivé : plus proposé dans les feuilles de temps (les feuilles qui le portent le gardent)`;
};

/**
 * Horaire par défaut d'une équipe (`horaire` du paramètre de `referentiel.equipe.exigences` : code, « » ou null pour
 * aucun ; absent : inchangé). Renvoie la fin du message.
 */
export async function enregistrerHoraireEquipe(ctx: Ctx, q: Equipe, code: unknown): Promise<string> {
  if (code === undefined) return '';
  const c = code === null ? '' : normaliserCodeHoraire(code);
  if ((q.horaire ?? '') === c) return '';
  if (c) {
    const h = horaireDe(ctx.ds.referentiels, c);
    if (!h) throw new ActionError('Horaire introuvable', 404);
    if (h.archive) throw new ActionError(`Horaire ${h.code} archivé : rétablissez-le d’abord (Référentiels → Horaires)`);
  }
  await ctx.db.update<Equipe>('equipes', q.nom, { horaire: c || null });
  return c ? ` · horaire ${c} proposé sur les feuilles de temps de ses membres` : ' · aucun horaire proposé sur les feuilles de ses membres';
}

/**
 * Horaire du jour sur la feuille : empId, week, di (0 = lundi … 6 = dimanche), code (« » : aucun horaire). Mêmes droits que
 * la saisie des heures (feuille soumise : son valideur). Un horaire archivé ne se choisit plus ; celui déjà porté reste.
 */
const choisir: ActionHandler = async (ctx, p) => {
  const { emp, sh } = await editable(ctx, p);
  const di = Number(p.di);
  if (!(Number.isInteger(di) && di >= 0 && di < JOURS_FEUILLE)) throw new ActionError('Jour invalide');
  const code = p.code == null ? '' : normaliserCodeHoraire(p.code);
  const actuel = sh.horaires?.[di] ?? null;
  if (code && code !== actuel) {
    const h = horaireDe(ctx.ds.referentiels, code);
    if (!h) throw new ActionError('Horaire introuvable', 404);
    if (h.archive) throw new ActionError(`Horaire ${h.code} archivé : il n’est plus proposé`);
    // Salarié de moins de 18 ans ce jour-là : pas d'horaire de nuit (art. L3163-2, shared/rules/repos-nuit.ts).
    const nuit = refusNuitMineur(emp, h, addD(sh.week, di));
    if (nuit) throw new ActionError(nuit);
  }
  if (actuel === code) return null;
  const horaires = Array.from({ length: JOURS_FEUILLE }, (_, i) => (i === di ? code : sh.horaires?.[i] ?? null));
  await ctx.db.update<FeuilleTemps>('feuilles', sh.id, { horaires });
  return null;
};

export const horairesActions = {
  'referentiel.horaire.enregistrer': enregistrer,
  'referentiel.horaire.archiver': archiver,
  'temps.horaire': choisir,
} satisfies Record<string, ActionHandler>;
