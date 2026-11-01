// Badgeage virtuel (lot 12, chantier C6, t191 ; règles : shared/rules/pointage.ts). Module désactivé par défaut (réglage
// `pointageActif`, activable avec la référence de l'accord et la date de l'avis du CSE) : pointer et demander une
// correction sont refusés tant qu'il ne l'est pas, et pour un salarié hors d'une population badgée.
//   pointage.pointer            empId (soi-même), sens, horodatageAppareil (hors ligne seulement) : instant du serveur ;
//                               hors ligne (rejeu de la file, réglage `pointageHorsLigne`) : heure de l'appareil, marqué
//                               « différé » ; jamais de position hors ligne. Doublon sous 60 s : rien n'est ajouté.
//                               Jamais au journal (la table des pointages en est la trace).
//   pointage.corriger           empId, nature (ajout | neutralisation), horodatage et sens (ajout) ou pointageId
//                               (neutralisation), motif (liste fermée), commentaire : le salarié pour lui-même, dans le délai
//                               réglé (7 jours) ; son valideur (manager, suppléant « feuilles », service RH) pour lui, validée
//                               d'emblée. Feuille de la semaine validée : refus, la correction passe par la réouverture.
//   pointage.validerCorrection  id : valideur au périmètre « feuilles », jamais pour lui-même ; ajoute le pointage, ou la
//                               ligne qui neutralise le pointage visé (aucune saisie n'est modifiée ni supprimée)
//   pointage.refuserCorrection  id, motif (texte, jamais au journal) : même valideur
//   pointage.annulerCorrection  id : le salarié (sa demande en attente), ou son valideur
// Messages sans commentaire ni motif de refus (ils sont recopiés au journal).
import { addD, isoParis, mondayOf } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import {
  apparier, estMotifCorrection, estNatureCorrection, estSens, hhmmParis, instantValide, MOTIFS_CORRECTION, refusDelaiCorrection, refusHeureAppareil,
  TEXTE_CORRECTION_MAX,
} from '../../../shared/rules/pointage.ts';
import type { CorrectionPointage, Employe, FeuilleTemps, ISODate, Pointage, SensPointage } from '../../../shared/types.ts';
import { instantServeur, lirePointages, modeDuSalarie } from '../pointages.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isRh, isValidatorOf, refuserSoiMeme, str } from './context.ts';

/** Instant du serveur (ISO), à la date du jour de Cursus (server/src/pointages.ts). */
const maintenant = () => new Date(instantServeur()).toISOString();

/** Module activé (réglage `pointageActif`), sinon refus. */
function requireActif(ctx: Ctx) {
  if (!ctx.ds.settings.pointageActif) throw new ActionError('Badgeage désactivé : l’administrateur RH l’active dans Paramètres, après l’avis du CSE', 409);
}

/** Salarié d'une population badgée ce jour-là (mode « controle » ou « calcule »), sinon refus. */
function requirePopulation(ctx: Ctx, e: Employe, jour: ISODate) {
  if (modeDuSalarie(ctx.ds, e, jour) === 'declaratif') {
    throw new ActionError(`${ctx.user.empId === e.id ? 'Vous ne faites' : `${ctx.d.personName(e.id)} ne fait`} pas partie d’une population qui pointe : le temps se déclare sur la feuille`, 409);
  }
}

/** Feuille de la semaine du jour validée : la correction passe par sa réouverture (shared/rules/regularisation.ts). */
async function refusFeuilleValidee(ctx: Ctx, empId: number, jour: ISODate) {
  const f = (await ctx.db.where<FeuilleTemps>('feuilles', 'empId', empId)).find(x => x.week === mondayOf(jour));
  if (f?.statut === 'validee') {
    throw new ActionError('Feuille de la semaine déjà validée : la correction passe par sa réouverture, demandée au service RH', 409);
  }
}

/** Texte libre facultatif, borné ; vide : null. */
function texte(v: unknown, quoi: string): string | null {
  const t = str(v);
  if (t.length > TEXTE_CORRECTION_MAX) throw new ActionError(`${quoi} : ${TEXTE_CORRECTION_MAX} caractères au plus`);
  return t || null;
}

/** Valideur des pointages du salarié : manager direct, suppléant au périmètre « feuilles » ou service RH, jamais soi-même. */
const valideur = (ctx: Ctx, e: Employe) => isValidatorOf(ctx, e, 'feuilles') && ctx.user.empId !== e.id;

/** Demande désignée, dans le périmètre de l'acteur (même refus pour un identifiant inconnu et pour celui d'un autre). */
async function correctionDe(ctx: Ctx, id: unknown, voit: (c: CorrectionPointage, e: Employe) => boolean): Promise<{ c: CorrectionPointage; e: Employe }> {
  const c = await ctx.db.get<CorrectionPointage>('correctionsPointage', Number(id) || 0);
  const e = c ? ctx.d.emp(c.empId) : undefined;
  if (c && e && voit(c, e)) return { c, e };
  if (isRh(ctx) && !c) throw new ActionError('Demande de correction introuvable', 404);
  throw new ActionError('Demande de correction introuvable ou hors de votre périmètre', 403);
}

/** Libellé court d'une demande (messages, sans commentaire). */
const libelle = (ctx: Ctx, c: Pick<CorrectionPointage, 'empId' | 'jour' | 'nature'>) =>
  `${c.nature === 'ajout' ? 'ajout d’un pointage' : 'retrait d’un pointage'} du ${fmtIso(c.jour)} (${ctx.d.personName(c.empId)})`;

/** Résultat d'une action sur une demande : ce que la règle du journal recopie (identifiants, jour, codes). */
const resultat = (c: Pick<CorrectionPointage, 'id' | 'empId' | 'jour' | 'nature' | 'motif' | 'statut'>) =>
  ({ id: c.id, empId: c.empId, jour: c.jour, nature: c.nature, motif: c.motif, statut: c.statut });

// — Pointer —

const pointer: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  if (!ctx.user.empId || Number(p.empId ?? ctx.user.empId) !== ctx.user.empId) throw new ActionError('Chacun pointe pour lui-même', 403);
  const e = getEmp(ctx, ctx.user.empId);
  const recu = maintenant(), t = Date.parse(recu);
  // Heure : celle du serveur ; celle de l'appareil pour le seul rejeu de la file hors ligne (pointage différé).
  let horodatage = recu;
  const horsLigne = !!ctx.horsLigne;
  if (horsLigne) {
    if (!ctx.ds.settings.pointageHorsLigne) throw new ActionError('Pointage hors ligne non admis : pointez une fois connecté', 409);
    const appareil = instantValide(p.horodatageAppareil);
    const refus = refusHeureAppareil(appareil, t);
    if (refus) throw new ActionError(refus, 422);
    horodatage = appareil!;
  } else if (p.horodatageAppareil != null) {
    throw new ActionError('L’heure d’un pointage en ligne est celle du serveur', 400);
  }
  // Jamais de position hors ligne ; la géolocalisation (étape 3) est désactivée : aucune position n'est reçue.
  if (p.position != null) throw new ActionError('Géolocalisation désactivée : aucune position n’est enregistrée', 400);
  const jour = isoParis(new Date(horodatage));
  requirePopulation(ctx, e, jour);
  if (p.sens != null && !estSens(p.sens)) throw new ActionError('Sens du pointage invalide');
  const voisins = await lirePointages(ctx.db, [e.id], addD(jour, -2), addD(jour, 1));
  const avant = voisins.filter(x => Date.parse(x.horodatage) <= Date.parse(horodatage));
  const sens: SensPointage = p.sens ?? (apparier(avant, Date.parse(horodatage)).enCours ? 'S' : 'E');
  // Double appui (ou rejeu d'un même pointage) : un pointage à moins de 60 s n'est pas ajouté, sauf un sens explicitement
  // différent de celui du précédent.
  const doublon = voisins.find(x => x.annuleId == null && (p.sens == null || x.sens == null || x.sens === sens) && Math.abs(Date.parse(x.horodatage) - Date.parse(horodatage)) < 60_000);
  const quoi = sens === 'E' ? 'Arrivée' : 'Départ';
  if (doublon) return { message: `${quoi} déjà pointée à ${hhmmParis(doublon.horodatage)}`, result: { id: doublon.id, sens, horodatage: doublon.horodatage, doublon: true } };
  const row = await ctx.db.insert<Pointage>('pointages', {
    empId: e.id, horodatage, jour, sens, source: 'virtuel', horsLigne, horodatageAppareil: horsLigne ? horodatage : null, recuLe: recu, zone: null, annuleId: null, correctionId: null,
  });
  return { message: `${quoi} pointée à ${hhmmParis(horodatage)}${horsLigne ? ' (pointage différé, fait hors ligne)' : ''}`, result: { id: row.id, sens, horodatage } };
};

// — Corrections —

/** Ajoute le pointage d'une demande validée, ou la ligne qui neutralise le pointage visé ; rend son identifiant. */
async function appliquer(ctx: Ctx, c: CorrectionPointage): Promise<number> {
  if (c.nature === 'ajout') {
    const row = await ctx.db.insert<Pointage>('pointages', {
      empId: c.empId, horodatage: c.horodatage!, jour: c.jour, sens: c.sens, source: 'correction', horsLigne: false, horodatageAppareil: null, recuLe: maintenant(),
      zone: null, annuleId: null, correctionId: c.id,
    });
    return row.id;
  }
  const vise = await ctx.db.get<Pointage>('pointages', c.pointageId);
  if (!vise || vise.empId !== c.empId) throw new ActionError('Pointage visé introuvable', 404);
  const deja = await ctx.db.where<Pointage>('pointages', 'annuleId', vise.id);
  if (deja.length) throw new ActionError('Ce pointage est déjà retiré', 409);
  const row = await ctx.db.insert<Pointage>('pointages', {
    empId: c.empId, horodatage: vise.horodatage, jour: vise.jour, sens: vise.sens, source: 'correction', horsLigne: false, horodatageAppareil: null, recuLe: maintenant(),
    zone: null, annuleId: vise.id, correctionId: c.id,
  });
  return row.id;
}

/** Décision d'une demande : statut, décideur, pointage créé. */
async function decider(ctx: Ctx, c: CorrectionPointage, statut: 'validee' | 'refusee' | 'annulee', extra: Partial<CorrectionPointage> = {}): Promise<CorrectionPointage> {
  const x = { statut, decideLe: maintenant(), decidePar: ctx.user.nom, ...extra };
  await ctx.db.update('correctionsPointage', c.id, x);
  return { ...c, ...x };
}

const corriger: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const e = getEmp(ctx, p.empId ?? ctx.user.empId);
  const soi = ctx.user.empId === e.id;
  if (!soi && !valideur(ctx, e)) throw new ActionError('Correction réservée au salarié, à son manager (ou son suppléant pour les feuilles) et au service RH', 403);
  if (!estNatureCorrection(p.nature)) throw new ActionError('Nature de la correction invalide');
  if (!estMotifCorrection(p.motif)) throw new ActionError(`Motif de la correction : ${Object.values(MOTIFS_CORRECTION).join(', ')}`);
  const commentaire = texte(p.commentaire, 'Commentaire');
  let jour: ISODate, horodatage: string | null = null, sens: SensPointage | null = null, pointageId: number | null = null;
  if (p.nature === 'ajout') {
    horodatage = instantValide(p.horodatage);
    if (!horodatage) throw new ActionError('Heure du pointage à ajouter invalide');
    if (Date.parse(horodatage) > instantServeur()) throw new ActionError('Pointage à venir : impossible');
    if (!estSens(p.sens)) throw new ActionError('Précisez s’il s’agit d’une arrivée ou d’un départ');
    sens = p.sens;
    jour = isoParis(new Date(horodatage));
  } else {
    const vise = await ctx.db.get<Pointage>('pointages', Number(p.pointageId) || 0);
    if (!vise || vise.empId !== e.id || vise.annuleId != null) throw new ActionError('Pointage à retirer introuvable', 404);
    if ((await ctx.db.where<Pointage>('pointages', 'annuleId', vise.id)).length) throw new ActionError('Ce pointage est déjà retiré', 409);
    pointageId = vise.id;
    jour = vise.jour;
  }
  const refus = refusDelaiCorrection(jour, ctx.d.ti, ctx.ds.settings.pointageDelaiCorrectionJours, isRh(ctx) && !soi);
  if (refus) throw new ActionError(refus, 409);
  requirePopulation(ctx, e, jour);
  await refusFeuilleValidee(ctx, e.id, jour);
  if (pointageId != null && (await ctx.db.where<CorrectionPointage>('correctionsPointage', 'pointageId', pointageId)).some(c => c.statut === 'demandee')) {
    throw new ActionError('Une demande est déjà en attente pour ce pointage', 409);
  }
  const c = await ctx.db.insert<CorrectionPointage>('correctionsPointage', {
    empId: e.id, jour, nature: p.nature, horodatage, sens, pointageId, motif: p.motif, commentaire, statut: 'demandee', demandeLe: maintenant(),
    demandePar: ctx.user.nom, demandeParInteresse: soi, decideLe: null, decidePar: null, motifRefus: null, pointageCreeId: null,
  });
  // Saisie par le valideur pour un salarié de son périmètre : validée d'emblée (le salarié en voit l'origine).
  if (!soi) {
    const v = await decider(ctx, c, 'validee', { pointageCreeId: await appliquer(ctx, c) });
    return { message: `Correction enregistrée : ${libelle(ctx, c)}`, result: resultat(v) };
  }
  return { message: `Correction demandée : ${libelle(ctx, c)}, en attente de validation`, result: resultat(c) };
};

const validerCorrection: ActionHandler = async (ctx, p) => {
  const { c, e } = await correctionDe(ctx, p.id, (_c, x) => valideur(ctx, x) || ctx.user.empId === x.id);
  refuserSoiMeme(ctx, e, 'Valider sa propre correction de pointage');
  if (!valideur(ctx, e)) throw new ActionError('Validation réservée au manager du salarié (ou son suppléant pour les feuilles) et au service RH', 403);
  if (c.statut !== 'demandee') throw new ActionError('Demande déjà traitée', 409);
  await refusFeuilleValidee(ctx, c.empId, c.jour);
  const v = await decider(ctx, c, 'validee', { pointageCreeId: await appliquer(ctx, c) });
  return { message: `Correction validée : ${libelle(ctx, c)}`, result: resultat(v) };
};

const refuserCorrection: ActionHandler = async (ctx, p) => {
  const { c, e } = await correctionDe(ctx, p.id, (_c, x) => valideur(ctx, x) || ctx.user.empId === x.id);
  refuserSoiMeme(ctx, e, 'Refuser sa propre correction de pointage');
  if (!valideur(ctx, e)) throw new ActionError('Refus réservé au manager du salarié (ou son suppléant pour les feuilles) et au service RH', 403);
  if (c.statut !== 'demandee') throw new ActionError('Demande déjà traitée', 409);
  const motifRefus = texte(p.motif, 'Motif du refus');
  if (!motifRefus) throw new ActionError('Motif du refus requis');
  const v = await decider(ctx, c, 'refusee', { motifRefus });
  return { message: `Correction refusée : ${libelle(ctx, c)}`, result: resultat(v) };
};

const annulerCorrection: ActionHandler = async (ctx, p) => {
  const { c } = await correctionDe(ctx, p.id, (_c, x) => valideur(ctx, x) || ctx.user.empId === x.id);
  if (c.statut !== 'demandee') throw new ActionError('Demande déjà traitée', 409);
  const v = await decider(ctx, c, 'annulee');
  return { message: `Demande de correction retirée : ${libelle(ctx, c)}`, result: resultat(v) };
};

export const pointageActions = {
  'pointage.pointer': pointer,
  'pointage.corriger': corriger,
  'pointage.validerCorrection': validerCorrection,
  'pointage.refuserCorrection': refuserCorrection,
  'pointage.annulerCorrection': annulerCorrection,
} satisfies Record<string, ActionHandler>;
