// Modification et annulation d'un déplacement par le service RH (règles : shared/rules/deplacements.ts). Un déplacement
// annulé reste en base (date, auteur, motif) et sort de tous les calculs ; le verdict Go / No Go est recalculé après
// chaque action `voyage.*` (server/src/actions/index.ts). Un déplacement venu de Keystone : Keystone est prévenu par la
// file d'envoi (`deplacement.modifie`, `deplacement.annule` ; simulation tant que KEYSTONE_URL n'est pas défini), sans le
// motif de l'annulation, qui reste dans Cursus.
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, fmtShort, plural } from '../../../shared/format.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { formalitesCaduques, refusAnnulation, refusChangement, refusModification } from '../../../shared/rules/deplacements.ts';
import { identifiantKeystone } from '../../../shared/rules/matricules.ts';
import { refusArchive } from '../../../shared/rules/referentiels.ts';
import { texteCoordonnees } from '../../../shared/rules/vigilance.ts';
import type { Voyage } from '../../../shared/types.ts';
import { sendToKeystone } from '../integrations/keystone.ts';
import { ActionError, getEmp, requireRh, str, type ActionHandler, type Ctx } from './context.ts';

/** Déplacement visé, encore modifiable (ni annulé, ni terminé). */
function deplacement(ctx: Ctx, id: unknown): Voyage {
  const t = ctx.ds.voyages.find(v => v.id === Number(id));
  if (!t) throw new ActionError('Déplacement introuvable', 404);
  const refus = refusChangement(t, ctx.d.ti);
  if (refus) throw new ActionError(refus, 409);
  return t;
}

/** Événement Keystone d'un déplacement venu de Keystone (référence et chantier de la demande acceptée). */
async function prevenirKeystone(ctx: Ctx, type: 'deplacement.modifie' | 'deplacement.annule', t: Voyage): Promise<boolean> {
  if (t.origine !== 'keystone' || !t.chantier) return false;
  const demande = ctx.ds.demandesKeystone.find(x => x.voyageId === t.id)?.id ?? null;
  await sendToKeystone(ctx.db, {
    type, deplacement: t.id, demande, reference: t.ref, matricule: identifiantKeystone(ctx.ds.settings.identifiantKeystone, ctx.d.emp(t.empId) ?? { id: t.empId }),
    chantier: t.chantier, destination: t.dest, depart: t.depart, retour: t.retour, date: ctx.d.ti,
  });
  return true;
}

/**
 * Coordonnées sur place reçues (t068) : hébergement, contact local (textes d'une ligne, 200 caractères) et inscription
 * sur Ariane (date, pas à venir). Non transmises : inchangées. Renvoie les champs à enregistrer.
 */
function coordonnees(ctx: Ctx, t: Voyage, p: Record<string, unknown>): Partial<Pick<Voyage, 'hebergement' | 'contactSurPlace' | 'arianeLe'>> {
  const out: Partial<Pick<Voyage, 'hebergement' | 'contactSurPlace' | 'arianeLe'>> = {};
  for (const [k, label] of [['hebergement', 'Hébergement'], ['contactSurPlace', 'Contact sur place']] as const) {
    if (!(k in p)) continue;
    const r = texteCoordonnees(p[k], label);
    if ('erreur' in r) throw new ActionError(r.erreur);
    if (r.valeur !== (t[k] ?? null)) out[k] = r.valeur;
  }
  if ('arianeLe' in p) {
    const v = str(p.arianeLe) || null;
    if (v && !isValidDate(v)) throw new ActionError('Inscription sur Ariane : date invalide');
    if (v && v > ctx.d.ti) throw new ActionError('Inscription sur Ariane : la date ne peut pas être à venir');
    if (v !== (t.arianeLe ?? null)) out.arianeLe = v;
  }
  return out;
}

/**
 * Dates, destination et motif d'un déplacement : mêmes contrôles qu'à la création (destination du référentiel en vigueur,
 * sauf celle qu'il a déjà, chevauchement d'un autre déplacement ou d'une absence en vigueur quand les dates changent), le
 * déplacement lui-même exclu.
 */
const modifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const t = deplacement(ctx, p.id);
  const emp = getEmp(ctx, t.empId);
  // Non transmis : inchangés (un déplacement venu de Keystone garde ceux de son chantier).
  // Coordonnées sur place seules (ni départ ni retour transmis) : dates du déplacement inchangées.
  const seules = !('depart' in p) && !('retour' in p) && ['hebergement', 'contactSurPlace', 'arianeLe'].some(k => k in p);
  const champs = { dest: str(p.dest) || t.dest, depart: seules ? t.depart : str(p.depart), retour: seules ? t.retour : str(p.retour), motif: 'motif' in p ? str(p.motif) : t.motif };
  const refus = refusModification(t, champs);
  if (refus) throw new ActionError(refus);
  const dest = ctx.d.destOf(champs.dest);
  if (!dest) throw new ActionError('Destination hors référentiel');
  if (dest.archive && dest.code !== t.dest) throw new ActionError(refusArchive(dest, 'Destination')!);
  const { depart, retour } = champs;
  // Chevauchements contrôlés seulement si les dates changent : les coordonnées sur place s'enregistrent même quand une
  // absence est signalée pendant le déplacement (arrêt à l'étranger), là où elles servent le plus.
  if (depart !== t.depart || retour !== t.retour) {
    const conflit = blocage(conflitsDates(ctx.d, emp.id, depart, retour, 'voyage', { voyageId: t.id }));
    if (conflit) throw new ActionError(conflit);
  }
  const surPlace = coordonnees(ctx, t, p);
  const memeDeplacement = dest.code === t.dest && depart === t.depart && retour === t.retour && champs.motif === t.motif;
  if (memeDeplacement && !Object.keys(surPlace).length) throw new ActionError('Aucune modification à enregistrer');
  // Formalités de détachement devenues caduques (formalitesCaduques) : à refaire, le dossier redevient incomplet.
  const caduques = formalitesCaduques(t, { dest: dest.code, depart, retour });
  const apres = { ...t, dest: dest.code, depart, retour, motif: champs.motif, ...caduques, ...surPlace };
  await ctx.db.update<Voyage>('voyages', t.id, { dest: dest.code, depart, retour, motif: champs.motif, ...caduques, ...surPlace });
  // Coordonnées sur place seules : Keystone n'en sait rien (champs propres à Cursus).
  const ks = !memeDeplacement && await prevenirKeystone(ctx, 'deplacement.modifie', apres);
  const coord = Object.keys(surPlace).length ? ' · coordonnées sur place enregistrées' : '';
  const r = ctx.d.readiness(emp, apres);
  const refaire = Object.keys(caduques).length ? ' · formalités de détachement à refaire' : '';
  return `Déplacement modifié — ${emp.nom}, ${dest.pays} du ${fmtShort(parse(depart))} au ${fmt(parse(retour))}${refaire}${coord} · ${r.todo ? plural(r.todo, 'formalité à prévoir', 'formalités à prévoir') : 'dossier complet'}${ks ? ' · Keystone prévenu' : ''}`;
};

/**
 * Annulation, avec motif (obligatoire pour un déplacement venu de Keystone, conservé dans Cursus, jamais transmis) : le
 * déplacement reste dans l'historique, hors de la préparation des dossiers, du Go / No Go, des conflits et des échéances.
 */
const annuler: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const t = deplacement(ctx, p.id);
  const emp = getEmp(ctx, t.empId);
  const motif = str(p.motif);
  const refus = refusAnnulation(t, motif);
  if (refus) throw new ActionError(refus);
  await ctx.db.update<Voyage>('voyages', t.id, { annuleLe: ctx.d.ti, annulePar: ctx.user.nom, annuleMotif: motif || null });
  const ks = await prevenirKeystone(ctx, 'deplacement.annule', t);
  return `Déplacement annulé — ${emp.nom}, ${ctx.d.destOf(t.dest)?.pays ?? t.dest} du ${fmtShort(parse(t.depart))} au ${fmt(parse(t.retour))}${ks ? ' · Keystone prévenu' : ''}`;
};

export const deplacementsActions: Record<string, ActionHandler> = {
  'voyage.modifier': modifier,
  'voyage.annuler': annuler,
};
