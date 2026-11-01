// Notes de frais (lot 11, chantier C5, étape 1 ; règles : shared/rules/frais*.ts). Module désactivé par défaut (réglage
// `notesFraisActives`) : les actions du circuit sont refusées tant qu'il ne l'est pas ; les référentiels (barème
// kilométrique, forfaits, taux des devises) se préparent avant l'activation.
//   frais.note.creer        empId, periode, medicale, voyageId, missionId, projet : le salarié pour lui-même, ou le service RH
//   frais.ligne.ajouter     noteId, date, categorie, montant, devise, taux | montantEur, tvaTaux, tvaMontant, commercant,
//                           forfait, km, vehiculeId, depart, arrivee, invites, motifDepassement, sansJustificatif,
//                           attestation, jetons : note en brouillon ou à corriger, l'intéressé ou le service RH ; sans
//                           noteId (étape 2 : dépense rapide du téléphone, admise hors ligne), empId : brouillon ordinaire
//                           du mois de la dépense, sans rattachement, créé au besoin (jamais une note médicale)
//   frais.ligne.modifier    id, mêmes champs ; frais.ligne.supprimer id (ses pièces sont retirées)
//   frais.note.soumettre    id : alertes bloquantes refusées, justificatifs scellés ; « validée » d'emblée (sans manager)
//                           pour une note médicale ou un salarié sans valideur
//   frais.note.valider      id : manager direct ou suppléant au périmètre « frais », service RH ; jamais sa propre note
//   frais.note.renvoyer     id, motif : valideur (note soumise) ou contrôleur (validée, contrôlée) ; motif jamais au journal ;
//                           refusé pour une note d'un export comptable en vigueur (l'annuler d'abord)
//   frais.note.controler    id : comptabilité ou service RH, jamais sa propre note ; alertes bloquantes refusées
//   frais.ligne.refuser     id, motif ; frais.ligne.plafonner id, montant : contrôleur, note validée
//   frais.note.annuler      id, motif : l'intéressé avant la validation, le service RH avant le paiement, hors d'un
//                           export comptable en vigueur
//   frais.vehicule.declarer empId, type, cv, electrique, du, au, jetons : l'intéressé ou le service RH
//   frais.bareme.enregistrer annee, type, tranches : administrateur RH ; frais.forfait.enregistrer annee, code, pays,
//                           montant : service RH ; frais.taux.enregistrer devise, mois, taux : comptabilité ou service RH
//   frais.avance.demander   empId, montant, voyageId, missionId ; frais.avance.valider id ; frais.avance.refuser id,
//                           motif ; frais.avance.annuler id
// Messages sans montant, commerçant, invités, motif ni nature médicale : ils sont recopiés au journal.
import { addD, isValidDate } from '../../../shared/dates.ts';
import { plural } from '../../../shared/format.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import {
  doublonsDe, enEuros, erreurCategoriePourNote, estCategorieFrais, estDevise, estPeriodeFrais, lignesDe, montantRetenu, noteModifiable, notePayee,
  r2, statutApresValidation, statutASoumission,
} from '../../../shared/rules/frais.ts';
import { cumulKm, ikDuTrajet, indemnitesIkAnnee, lignesIkDeLAnnee, TYPES_VEHICULE, vehiculeAuJour } from '../../../shared/rules/frais-km.ts';
import { ikTransmises } from '../../../shared/rules/frais-paie.ts';
import { alertesDeNote } from '../../../shared/rules/frais-alertes.ts';
import { type AlerteFrais, bloquantes, estCodeForfait, forfaitDeLaLigne, limiteForfait } from '../../../shared/rules/frais-politique.ts';
import { estTauxTva } from '../../../shared/rules/frais-tva.ts';
import type { AvanceFrais, BaremeKm, Employe, ExportFraisEnregistre, LigneFrais, NoteFrais, ObjetPiece, TauxDevise, TypeVehicule, VehiculePerso } from '../../../shared/types.ts';
import { scellerPieces } from '../sceaux.ts';
import {
  ActionError, type ActionHandler, type Ctx, getEmp, isControleurFrais, isManagerOf, isRh, isSelf, refuserSoiMeme, requireControleurFrais, requireRh,
  requireRhAdmin, str,
} from './context.ts';
import { joindrePieces, retirerPiecesDe } from './pieces.ts';
// lot 11 — notes de frais, étape 2 : e-mails et notifications du circuit.
import { notifierNoteAControler, notifierNoteRenvoyee, notifierNoteSoumise, notifierNoteValidee } from '../frais-notifications.ts';

/** Longueur au plus des textes libres d'une ligne (commerçant, lieux, invités, motifs). */
export const TEXTE_FRAIS_MAX = 300;
/** Montant au plus d'une dépense (contrôle de saisie). */
export const MONTANT_FRAIS_MAX = 100_000;

const maintenant = () => new Date().toISOString();

/** Module activé (réglage `notesFraisActives`), sinon refus. */
function requireActif(ctx: Ctx) {
  if (!ctx.ds.settings.notesFraisActives) throw new ActionError('Notes de frais désactivées : l’administrateur RH les active dans Paramètres', 409);
}

/** Texte libre facultatif, borné ; vide : null. */
function texte(v: unknown, quoi: string): string | null {
  const t = str(v);
  if (t.length > TEXTE_FRAIS_MAX) throw new ActionError(`${quoi} : ${TEXTE_FRAIS_MAX} caractères au plus`);
  return t || null;
}

/** Nombre positif facultatif (virgule admise) ; vide : null. */
function nombre(v: unknown, quoi: string, max = MONTANT_FRAIS_MAX): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new ActionError(`${quoi} invalide`);
  return n;
}

/** Salarié pour qui l'on saisit : soi-même (manager, collaborateur), ou le salarié désigné par le service RH. */
function salarieSaisi(ctx: Ctx, empId: unknown): Employe {
  if (isRh(ctx)) return getEmp(ctx, empId);
  if (ctx.user.role === 'rh' || !ctx.user.empId) throw new ActionError('Notes de frais saisies par le salarié ou le service RH', 403);
  if (empId != null && empId !== '' && Number(empId) !== ctx.user.empId) throw new ActionError('Notes de frais saisies par le salarié pour lui-même ou par le service RH', 403);
  return getEmp(ctx, ctx.user.empId);
}

/**
 * Refus d'un élément hors du périmètre : même refus (403, sans rien de l'élément) pour un identifiant inconnu et pour celui
 * d'un autre, pour qu'aucun message ne révèle les frais d'autrui (une note médicale en particulier) ; le service RH, qui
 * voit tout, reçoit un 404 pour un identifiant inconnu.
 */
function horsPerimetre(ctx: Ctx, quoi: string, existe: boolean): ActionError {
  return isRh(ctx) && !existe ? new ActionError(`${quoi} introuvable`, 404) : new ActionError(`${quoi} introuvable ou hors de votre périmètre`, 403);
}

/** Note désignée, dans le périmètre de l'acteur. */
async function noteDe(ctx: Ctx, id: unknown, voit: (n: NoteFrais) => boolean): Promise<NoteFrais> {
  const n = await ctx.db.get<NoteFrais>('notesFrais', Number(id) || 0);
  if (n && voit(n)) return n;
  throw horsPerimetre(ctx, 'Note de frais', !!n);
}
/** L'intéressé ou le service RH. */
const proprietaire = (ctx: Ctx) => (n: Pick<NoteFrais, 'empId'>) => isRh(ctx) || isSelf(ctx, n.empId);
/** Valideur de la note : manager direct ou suppléant « frais » (jamais une note médicale), ou service RH. */
const valideur = (ctx: Ctx) => (n: NoteFrais) => {
  const e = ctx.d.emp(n.empId);
  return !!e && (isRh(ctx) || (!n.medicale && isManagerOf(ctx, e, 'frais')));
};

/** Ligne désignée et sa note, dans le périmètre de `voit`. */
async function ligneDe(ctx: Ctx, id: unknown, voit: (n: NoteFrais) => boolean): Promise<{ l: LigneFrais; n: NoteFrais }> {
  const l = await ctx.db.get<LigneFrais>('lignesFrais', Number(id) || 0);
  const n = l ? await ctx.db.get<NoteFrais>('notesFrais', l.noteId) : undefined;
  if (!l || !n || !voit(n)) throw horsPerimetre(ctx, 'Dépense', !!n);
  return { l, n };
}

/** Objet de pièce des lignes d'une note : justificatif de santé pour une note médicale. */
const objetLigne = (n: Pick<NoteFrais, 'medicale'>): ObjetPiece => (n.medicale ? 'ligneFraisSante' : 'ligneFrais');

// — Notes —

const noteCreer: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const e = salarieSaisi(ctx, p.empId);
  const periode = str(p.periode) || ctx.d.ti.slice(0, 7);
  if (!estPeriodeFrais(periode)) throw new ActionError('Mois des dépenses invalide');
  const voyageId = p.voyageId ? Number(p.voyageId) : null, missionId = p.missionId ? Number(p.missionId) : null;
  if (voyageId && !ctx.ds.voyages.some(v => v.id === voyageId && v.empId === e.id)) throw new ActionError('Déplacement introuvable pour ce salarié');
  if (missionId && !ctx.ds.missions.some(m => m.id === missionId && m.empId === e.id)) throw new ActionError('Mission introuvable pour ce salarié');
  const projet = texte(p.projet, 'Projet ou chantier');
  const n = await ctx.db.insert<NoteFrais>('notesFrais', {
    empId: e.id, periode, voyageId, missionId, projet, medicale: !!p.medicale, statut: 'brouillon', creeLe: maintenant(), creePar: ctx.user.nom,
    soumiseLe: null, valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null,
    lotId: null, payeeLe: null, annuleeLe: null, annuleePar: null, annuleMotif: null,
  });
  return { message: `Note de frais n° ${n.id} créée — ${periodeLabel(periode)}`, result: { note: n.id, empId: e.id } };
};

/** Taux d'une devise pour le mois d'une date (table des taux) ; null s'il n'est pas saisi. */
const tauxDuMois = (ctx: Ctx, devise: string, date: string) =>
  (ctx.ds.referentiels.tauxDevises ?? []).find(t => t.devise === devise && t.mois === date.slice(0, 7))?.taux ?? null;

/**
 * Champs d'une ligne contrôlés et complétés : montant en euros (taux saisi, taux du mois ou montant débité saisi),
 * indemnité kilométrique calculée au barème (part marginale du cumul de l'année), allocation forfaitaire à sa limite
 * quand son montant n'est pas saisi. `avant` : ligne modifiée (ses valeurs restent pour un champ absent).
 */
function lireLigne(ctx: Ctx, n: NoteFrais, p: Record<string, any>, avant?: LigneFrais): Omit<LigneFrais, 'id' | 'noteId' | 'empId'> {
  const v = <K extends keyof LigneFrais>(k: K) => (p[k] !== undefined ? p[k] : avant?.[k]);
  const date = str(v('date'));
  if (!isValidDate(date)) throw new ActionError('Date de la dépense invalide');
  if (date > ctx.d.ti) throw new ActionError('Date de la dépense à venir : saisissez une dépense faite');
  const categorie = v('categorie');
  if (!estCategorieFrais(categorie)) throw new ActionError('Catégorie de dépense inconnue');
  const erreur = erreurCategoriePourNote(n, categorie);
  if (erreur) throw new ActionError(erreur);
  const devise = str(v('devise')) || 'EUR';
  if (!estDevise(devise)) throw new ActionError('Devise invalide : code à trois lettres (EUR, USD…)');
  const commun = {
    date, categorie, devise,
    commercant: texte(v('commercant'), 'Commerçant'), invites: texte(v('invites'), 'Invités'), motifDepassement: texte(v('motifDepassement'), 'Motif du dépassement'),
    depart: texte(v('depart'), 'Départ'), arrivee: texte(v('arrivee'), 'Arrivée'),
    sansJustificatif: !!v('sansJustificatif'), attestation: !!v('attestation'),
    montantRetenu: null, refuseeLe: null, refusMotif: null,
  };
  if (categorie === 'ik') {
    const km = nombre(v('km'), 'Distance', 5000);
    if (!km) throw new ActionError('Indemnités kilométriques : indiquez la distance (km)');
    const vid = Number(v('vehiculeId')) || 0;
    const veh = (ctx.ds.vehiculesPerso ?? []).find(x => x.id === vid && x.empId === n.empId);
    if (!veh) throw new ActionError('Indemnités kilométriques : choisissez un véhicule personnel déclaré');
    if (!vehiculeAuJour(veh, date)) throw new ActionError('Véhicule non déclaré à la date du trajet');
    const annee = Number(date.slice(0, 4));
    const autres = lignesIkDeLAnnee(ctx.ds.lignesFrais ?? [], ctx.ds.notesFrais ?? [], n.empId, annee).filter(l => l.id !== avant?.id);
    const cumul = cumulKm(autres, { id: avant?.id ?? Number.MAX_SAFE_INTEGER, date });
    const montant = ikDuTrajet(ctx.ds.referentiels.baremesKm, annee, veh, cumul, km, ctx.ds.settings.fraisIkCvReels);
    return { ...commun, montant: montant ?? 0, devise: 'EUR', taux: null, montantEur: montant ?? 0, tvaTaux: null, tvaMontant: null, forfait: null, km, vehiculeId: veh.id };
  }
  let forfait: string | null = null;
  let montant = nombre(v('montant'), 'Montant');
  if (categorie === 'forfait') {
    const f = forfaitDeLaLigne(str(v('forfait')));
    if (!f || (f.code === 'etranger' && !f.pays)) throw new ActionError('Allocation forfaitaire : choisissez le forfait (et le pays pour l’étranger)');
    forfait = f.pays ? `${f.code}:${f.pays}` : f.code;
    montant ??= limiteForfait(ctx.ds.referentiels.forfaitsFrais, Number(date.slice(0, 4)), forfait);
    if (montant == null) throw new ActionError('Allocation forfaitaire : indiquez le montant (limite de l’année non saisie)');
  }
  if (!montant || montant <= 0) throw new ActionError('Montant de la dépense invalide');
  // Montant en euros : saisi (relevé de carte), sinon taux saisi ou taux du mois.
  // Montant débité saisi : reçu, ou gardé d'une ligne modifiée sans taux dont ni la devise ni le montant ne changent.
  const garde = !!avant && avant.taux === null && p.montant === undefined && p.devise === undefined && p.taux === undefined ? avant.montantEur : null;
  const saisi = devise === 'EUR' ? null : p.montantEur !== undefined ? nombre(p.montantEur, 'Montant débité en euros') : garde;
  const taux = devise === 'EUR' || saisi !== null ? (devise === 'EUR' ? null : nombre(v('taux'), 'Taux de la devise', 1_000_000)) : nombre(v('taux'), 'Taux de la devise', 1_000_000) ?? tauxDuMois(ctx, devise, date);
  const montantEur = saisi ?? enEuros(montant, devise, taux);
  if (montantEur === null) throw new ActionError(`Taux de la devise ${devise} manquant : saisissez le taux ou le montant débité en euros`);
  const tvaTaux = v('tvaTaux');
  if (tvaTaux != null && tvaTaux !== '' && !estTauxTva(Number(tvaTaux))) throw new ActionError('Taux de TVA invalide : 20, 10, 5,5, 2,1 ou 0 %');
  const tvaMontant = nombre(v('tvaMontant'), 'Montant de TVA');
  if (tvaMontant != null && tvaMontant > montantEur) throw new ActionError('Montant de TVA supérieur au montant de la dépense');
  return {
    ...commun, montant: r2(montant), taux, montantEur: r2(montantEur), tvaTaux: tvaTaux == null || tvaTaux === '' ? null : Number(tvaTaux), tvaMontant,
    forfait, km: null, vehiculeId: null,
  };
}

/** Note dont les lignes se saisissent, par l'intéressé ou le service RH. */
async function noteEnSaisie(ctx: Ctx, id: unknown): Promise<NoteFrais> {
  const n = await noteDe(ctx, id, proprietaire(ctx));
  if (!noteModifiable(n)) throw new ActionError(`Note de frais n° ${n.id} déjà soumise : renvoyée pour correction, elle redevient modifiable`, 409);
  return n;
}

/** Doublons d'une ligne (clé ou empreinte d'un justificatif) : avertissement dans le message, sans blocage. */
function avertirDoublons(ctx: Ctx, l: LigneFrais): string {
  const lignes = [...(ctx.ds.lignesFrais ?? []).filter(x => x.id !== l.id), l];
  const n = doublonsDe(l, lignes, ctx.ds.notesFrais ?? []).length;
  return n ? ` · doublon possible avec ${plural(n, 'autre dépense', 'autres dépenses')} (même date, même montant, même commerçant)` : '';
}

/**
 * Indemnités kilométriques non transmises à la paie d'un salarié, recalculées pour les années données d'après le cumul
 * ordonné de l'année (shared/rules/frais-km.ts, `indemnitesIkAnnee`) : une ligne saisie après coup à une date antérieure,
 * une ligne modifiée, supprimée ou refusée, une note annulée ou un barème publié changent la part des trajets suivants ;
 * l'écart d'une ligne déjà payée se régularise sur les lignes encore à payer. Lu en base (écritures de l'action comprises).
 */
export async function recalculerIk(ctx: Ctx, empId: number, annees: Iterable<number>): Promise<void> {
  const lignes = await ctx.db.where<LigneFrais>('lignesFrais', 'empId', empId);
  if (!lignes.some(l => l.categorie === 'ik')) return;
  const notes = await ctx.db.where<NoteFrais>('notesFrais', 'empId', empId);
  const vehicules = await ctx.db.where<VehiculePerso>('vehiculesPerso', 'empId', empId);
  const baremes = await ctx.db.all<BaremeKm>('baremesKm');
  for (const annee of new Set(annees)) {
    const enVigueur = lignesIkDeLAnnee(lignes, notes, empId, annee);
    const transmises = ikTransmises(enVigueur, notes);
    const montants = indemnitesIkAnnee(baremes, annee, vehicules, enVigueur, transmises, { cvReels: ctx.ds.settings.fraisIkCvReels });
    for (const l of enVigueur) {
      if (transmises.has(l.id)) continue;
      const m = montants.get(l.id) ?? 0;
      if (m === l.montantEur && m === l.montant) continue;
      // Montant retenu par le contrôleur gardé s'il reste en deçà de la nouvelle indemnité.
      await ctx.db.update<LigneFrais>('lignesFrais', l.id, { montant: m, montantEur: m, ...(l.montantRetenu !== null && l.montantRetenu > m ? { montantRetenu: m } : {}) });
    }
  }
}

/** Année d'une ligne kilométrique (recalcul de ses voisines), sinon aucune. */
const anneeIk = (l: Pick<LigneFrais, 'categorie' | 'date'> | undefined): number[] => (l?.categorie === 'ik' ? [Number(l.date.slice(0, 4))] : []);

/**
 * Note d'une dépense rapide (lot 11, étape 2 : téléphone, page « Hors ligne ») : le brouillon ordinaire du mois de la
 * dépense, sans déplacement, mission ni projet, le plus ancien ; créé au besoin. Une dépense médicale n'y entre jamais
 * (`erreurCategoriePourNote` : elle forme une note séparée, créée depuis l'écran « Mes frais »).
 */
async function noteRapide(ctx: Ctx, p: Record<string, any>): Promise<{ n: NoteFrais; creee: boolean }> {
  const e = salarieSaisi(ctx, p.empId);
  const date = str(p.date);
  if (!isValidDate(date)) throw new ActionError('Date de la dépense invalide');
  const periode = date.slice(0, 7);
  const n = (ctx.ds.notesFrais ?? []).filter(x => x.empId === e.id && x.periode === periode && x.statut === 'brouillon' && !x.medicale && !x.voyageId && !x.missionId && !x.projet)
    .sort((a, b) => a.id - b.id)[0];
  if (n) return { n, creee: false };
  if (p.categorie === 'medical') throw new ActionError(erreurCategoriePourNote({ medicale: false }, 'medical')!);
  return {
    n: await ctx.db.insert<NoteFrais>('notesFrais', {
      empId: e.id, periode, voyageId: null, missionId: null, projet: null, medicale: false, statut: 'brouillon', creeLe: maintenant(), creePar: ctx.user.nom,
      soumiseLe: null, valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null,
      lotId: null, payeeLe: null, annuleeLe: null, annuleePar: null, annuleMotif: null,
    }),
    creee: true,
  };
}

const ligneAjouter: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const { n, creee } = p.noteId ? { n: await noteEnSaisie(ctx, p.noteId), creee: false } : await noteRapide(ctx, p);
  const l = await ctx.db.insert<LigneFrais>('lignesFrais', { noteId: n.id, empId: n.empId, ...lireLigne(ctx, n, p) });
  await recalculerIk(ctx, n.empId, anneeIk(l));
  const pieces = await joindrePieces(ctx, p.jetons ?? p.jeton, objetLigne(n), l.id, n.empId);
  return { message: `Dépense ajoutée à la note de frais n° ${n.id}${creee ? ` (créée — ${periodeLabel(n.periode)})` : ''}${pieces}${avertirDoublons(ctx, l)}`, result: { note: n.id, ligne: l.id, empId: n.empId } };
};

const ligneModifier: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const { l, n } = await ligneDe(ctx, p.id, proprietaire(ctx));
  await noteEnSaisie(ctx, n.id);
  const champs = lireLigne(ctx, n, p, l);
  await ctx.db.update<LigneFrais>('lignesFrais', l.id, champs);
  await recalculerIk(ctx, n.empId, [...anneeIk(l), ...anneeIk(champs)]);
  const pieces = await joindrePieces(ctx, p.jetons ?? p.jeton, objetLigne(n), l.id, n.empId);
  return { message: `Dépense de la note de frais n° ${n.id} modifiée${pieces}${avertirDoublons(ctx, { ...l, ...champs })}`, result: { note: n.id, ligne: l.id, empId: n.empId } };
};

const ligneSupprimer: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const { l, n } = await ligneDe(ctx, p.id, proprietaire(ctx));
  await noteEnSaisie(ctx, n.id);
  // Justificatif scellé à une soumission précédente (note renvoyée pour correction) : la dépense reste, elle se corrige.
  if (await ctx.db.one(`SELECT s.id FROM sceaux_pieces s JOIN pieces p ON p.id = s.piece_id WHERE p.objet IN ('ligneFrais', 'ligneFraisSante') AND p.objet_id = ?`, [l.id])) {
    throw new ActionError('Dépense dont le justificatif est scellé (note déjà soumise une fois) : corrigez-la, ou le contrôleur la refusera', 409);
  }
  // Pièces de la ligne retirées (fichiers effacés après la validation) avant la ligne, qu'elles désignent.
  const retirees = await retirerPiecesDe(ctx, objetLigne(n), l.id, 'Dépense supprimée de la note de frais');
  await ctx.db.run('UPDATE pieces SET objet_id = NULL, objet = NULL WHERE objet IN (?, ?) AND objet_id = ? AND retiree_le IS NOT NULL', ['ligneFrais', 'ligneFraisSante', l.id]);
  await ctx.db.remove('lignesFrais', l.id);
  await recalculerIk(ctx, n.empId, anneeIk(l));
  return { message: `Dépense retirée de la note de frais n° ${n.id}${retirees ? ` · ${plural(retirees, 'pièce retirée', 'pièces retirées')}` : ''}`, result: { note: n.id, ligne: l.id, empId: n.empId } };
};

/** Alertes de chaque ligne en vigueur d'une note (shared/rules/frais-alertes.ts, mêmes que celles des écrans). */
export const alertesNote = (ctx: Ctx, n: NoteFrais, lignes: readonly LigneFrais[] = lignesDe(ctx.ds.lignesFrais, n.id)): Map<number, AlerteFrais[]> => alertesDeNote(ctx.d, n, lignes);

/** Refus si une ligne porte une alerte bloquante : la première, avec la date de la dépense. */
function refuserBloquantes(ctx: Ctx, n: NoteFrais, quoi: string) {
  const lignes = lignesDe(ctx.ds.lignesFrais, n.id);
  const alertes = alertesNote(ctx, n, lignes);
  const b = lignes.flatMap(l => bloquantes(alertes.get(l.id) ?? []).map(a => ({ l, a })));
  // Barème kilométrique de l'année absent : l'indemnité ne se calcule pas, la note ne part pas.
  const ikSansBareme = lignes.filter(l => l.categorie === 'ik' && !l.refuseeLe && !l.montantEur);
  if (ikSansBareme.length) throw new ActionError(`${quoi} impossible : barème kilométrique ${ikSansBareme[0].date.slice(0, 4)} manquant (le service RH le saisit), puis modifiez la dépense du ${ikSansBareme[0].date}`, 409);
  if (b.length) throw new ActionError(`${quoi} impossible : dépense du ${b[0].l.date} — ${b[0].a.texte}${b.length > 1 ? ` (et ${plural(b.length - 1, 'autre point', 'autres points')})` : ''}`, 409);
}

const noteSoumettre: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const n = await noteEnSaisie(ctx, p.id);
  const lignes = lignesDe(ctx.ds.lignesFrais, n.id);
  if (!lignes.length) throw new ActionError('Note de frais vide : ajoutez au moins une dépense');
  refuserBloquantes(ctx, n, 'Soumission');
  const e = getEmp(ctx, n.empId);
  const statut = statutASoumission(n, ctx.d.mgrOf(e));
  // Justificatifs des lignes scellés : immuables désormais (chaîne d'empreintes, server/src/sceaux.ts).
  const ids = new Set(lignes.map(l => l.id));
  const pieces = (ctx.ds.pieces ?? []).filter(x => (x.objet === 'ligneFrais' || x.objet === 'ligneFraisSante') && ids.has(x.objetId) && !x.retireeLe).map(x => x.id);
  const scellees = await scellerPieces(ctx.db, pieces);
  await ctx.db.update<NoteFrais>('notesFrais', n.id, { statut, soumiseLe: maintenant(), renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null });
  // Au valideur, ou, sans manager (note médicale, salarié sans valideur), à la boîte du service RH : même message.
  if (statut === 'soumise') await notifierNoteSoumise(ctx, e, n);
  else await notifierNoteAControler(ctx, e, n);
  return {
    // Message identique quel que soit le circuit (il est recopié au journal) : « transmise directement au contrôle »
    // désignerait une note médicale d'un salarié qui a un manager. L'écran montre le statut.
    message: `Note de frais n° ${n.id} soumise — ${plural(lignes.length, 'dépense', 'dépenses')}${scellees ? `, ${plural(scellees, 'justificatif scellé', 'justificatifs scellés')}` : ''}`,
    result: { note: n.id, empId: n.empId, statut, lignes: lignes.length, pieces: scellees },
  };
};

const noteValider: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const n = await noteDe(ctx, p.id, valideur(ctx));
  refuserSoiMeme(ctx, getEmp(ctx, n.empId), 'Vous ne validez pas votre propre note de frais');
  if (n.statut === 'validee' || n.statut === 'controlee') return { message: `Note de frais n° ${n.id} déjà validée`, result: { note: n.id, empId: n.empId, statut: n.statut } };
  if (n.statut !== 'soumise') throw new ActionError(`Note de frais n° ${n.id} : rien à valider`, 409);
  const valide = statutApresValidation(ctx.ds.settings.fraisCircuit);
  // Circuit sans contrôle et rien à rembourser : note close aussitôt (aucun lot ne l'emporterait).
  const statut = valide === 'controlee' && rienARembourser(ctx, n) ? 'payee' : valide;
  const le = maintenant();
  await ctx.db.update<NoteFrais>('notesFrais', n.id, { statut, valideeLe: le, valideePar: ctx.user.nom, ...(valide === 'controlee' ? { controleeLe: le, controleePar: ctx.user.nom } : {}), ...(statut === 'payee' ? { payeeLe: ctx.d.ti } : {}) });
  const e = getEmp(ctx, n.empId);
  if (statut === 'validee') await notifierNoteAControler(ctx, e, n);
  else await notifierNoteValidee(ctx, e, n, statut === 'payee');
  return { message: `Note de frais n° ${n.id} validée${statut === 'payee' ? ' · rien à rembourser, note close' : statut === 'controlee' ? ' · en attente de la paie' : ' · en attente du contrôle'}`, result: { note: n.id, empId: n.empId, statut } };
};

/** Motif d'un renvoi, d'un refus ou d'une annulation : obligatoire, borné (jamais recopié au journal). */
function motif(v: unknown): string {
  const m = str(v);
  if (!m) throw new ActionError('Indiquez le motif');
  if (m.length > TEXTE_FRAIS_MAX) throw new ActionError(`Motif : ${TEXTE_FRAIS_MAX} caractères au plus`);
  return m;
}

/**
 * Refus si la note figure dans un export comptable en vigueur (relecture de l'étape 2) : ses écritures y sont figées, et
 * une note déjà exportée n'entre plus dans un export suivant. La renvoyer ou l'annuler laisserait la comptabilité créditer
 * le salarié d'un montant que la paie ne rembourse plus ; on annule d'abord l'export (Notes de frais → Exports
 * comptables), ce qui remet ses notes à exporter.
 */
async function refuserSiExportee(ctx: Ctx, n: NoteFrais, quoi: string) {
  const x = (await ctx.db.all<ExportFraisEnregistre>('exportsFrais')).find(e => !e.annuleLe && (e.notes ?? []).includes(n.id));
  if (x) throw new ActionError(`${quoi} impossible : la note de frais n° ${n.id} figure dans l’export comptable n° ${x.id} ; annulez d’abord cet export (Notes de frais → Exports comptables)`, 409);
}

const noteRenvoyer: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const n = await noteDe(ctx, p.id, x => valideur(ctx)(x) || isControleurFrais(ctx));
  refuserSoiMeme(ctx, getEmp(ctx, n.empId), 'Vous ne renvoyez pas votre propre note de frais');
  const parValideur = n.statut === 'soumise' && valideur(ctx)(n);
  const parControleur = (n.statut === 'validee' || n.statut === 'controlee') && isControleurFrais(ctx);
  if (!parValideur && !parControleur) throw new ActionError(`Note de frais n° ${n.id} : renvoi impossible à cette étape`, 409);
  if (n.statut === 'controlee') await refuserSiExportee(ctx, n, 'Renvoi');
  await ctx.db.update<NoteFrais>('notesFrais', n.id, { statut: 'a_corriger', renvoyeeLe: maintenant(), renvoyeePar: ctx.user.nom, renvoiMotif: motif(p.motif), valideeLe: null, valideePar: null, controleeLe: null, controleePar: null });
  await notifierNoteRenvoyee(ctx, getEmp(ctx, n.empId), n);
  return { message: `Note de frais n° ${n.id} renvoyée pour correction`, result: { note: n.id, empId: n.empId, statut: 'a_corriger' } };
};

/** Note validée, dans le périmètre du contrôleur (comptabilité ou service RH), jamais la sienne. */
async function noteAControler(ctx: Ctx, id: unknown): Promise<NoteFrais> {
  requireControleurFrais(ctx);
  const n = await noteDe(ctx, id, () => true);
  refuserSoiMeme(ctx, getEmp(ctx, n.empId), 'Vous ne contrôlez pas votre propre note de frais');
  return n;
}

/**
 * Note sans rien à rembourser (toutes ses dépenses refusées ou ramenées à zéro) : aucun élément de lot ne la réserverait,
 * elle resterait « contrôlée, en attente de paie » ; elle est close au contrôle (« payée » de zéro, gardée comme les autres).
 */
const rienARembourser = (ctx: Ctx, n: NoteFrais) => lignesDe(ctx.ds.lignesFrais, n.id).every(l => !montantRetenu(l));

const noteControler: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const n = await noteAControler(ctx, p.id);
  if (n.statut === 'controlee' || notePayee(n)) return { message: `Note de frais n° ${n.id} déjà contrôlée`, result: { note: n.id, empId: n.empId, statut: n.statut } };
  if (n.statut !== 'validee') throw new ActionError(`Note de frais n° ${n.id} : à valider d’abord par le manager`, 409);
  refuserBloquantes(ctx, n, 'Contrôle');
  const le = maintenant(), rien = rienARembourser(ctx, n);
  await ctx.db.update<NoteFrais>('notesFrais', n.id, { statut: 'controlee', controleeLe: le, controleePar: ctx.user.nom, ...(rien ? { statut: 'payee', payeeLe: ctx.d.ti } : {}) });
  await notifierNoteValidee(ctx, getEmp(ctx, n.empId), n, rien);
  return {
    message: `Note de frais n° ${n.id} contrôlée · ${rien ? 'rien à rembourser (dépenses refusées), note close' : 'remboursée avec la prochaine paie'}`,
    result: { note: n.id, empId: n.empId, statut: rien ? 'payee' : 'controlee' },
  };
};

/** Ligne d'une note validée, pour le contrôleur. */
async function ligneAControler(ctx: Ctx, id: unknown) {
  requireControleurFrais(ctx);
  const { l, n } = await ligneDe(ctx, id, () => true);
  refuserSoiMeme(ctx, getEmp(ctx, n.empId), 'Vous ne contrôlez pas votre propre note de frais');
  if (n.statut !== 'validee') throw new ActionError(`Note de frais n° ${n.id} : une dépense se refuse ou se plafonne au contrôle (note validée)`, 409);
  return { l, n };
}

const ligneRefuser: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const { l, n } = await ligneAControler(ctx, p.id);
  await ctx.db.update<LigneFrais>('lignesFrais', l.id, { refuseeLe: maintenant(), refusMotif: motif(p.motif) });
  await recalculerIk(ctx, n.empId, anneeIk(l));
  return { message: `Dépense refusée dans la note de frais n° ${n.id}`, result: { note: n.id, ligne: l.id, empId: n.empId } };
};

const lignePlafonner: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const { l, n } = await ligneAControler(ctx, p.id);
  const montant = nombre(p.montant, 'Montant retenu');
  if (montant !== null && montant > l.montantEur) throw new ActionError('Montant retenu supérieur au montant de la dépense');
  await ctx.db.update<LigneFrais>('lignesFrais', l.id, { montantRetenu: montant === null ? null : r2(montant) });
  return { message: `Dépense de la note de frais n° ${n.id} ${montant === null ? 'remise au montant demandé' : 'ramenée au plafond'}`, result: { note: n.id, ligne: l.id, empId: n.empId } };
};

const noteAnnuler: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const n = await noteDe(ctx, p.id, proprietaire(ctx));
  if (n.statut === 'annulee') return { message: `Note de frais n° ${n.id} déjà annulée`, result: { note: n.id, empId: n.empId } };
  if (notePayee(n)) throw new ActionError(`Note de frais n° ${n.id} en paiement ou payée : elle ne s’annule plus`, 409);
  // L'intéressé annule tant que personne n'a validé ; ensuite, le service RH (jamais pour lui-même).
  const avantValidation = n.statut === 'brouillon' || n.statut === 'soumise' || n.statut === 'a_corriger';
  if (!isRh(ctx) && !avantValidation) throw new ActionError(`Note de frais n° ${n.id} déjà validée : adressez-vous au service RH`, 409);
  if (isRh(ctx) && !avantValidation) refuserSoiMeme(ctx, getEmp(ctx, n.empId), 'Vous n’annulez pas votre propre note de frais validée');
  if (!avantValidation) await refuserSiExportee(ctx, n, 'Annulation');
  await ctx.db.update<NoteFrais>('notesFrais', n.id, { statut: 'annulee', annuleeLe: maintenant(), annuleePar: ctx.user.nom, annuleMotif: str(p.motif).slice(0, TEXTE_FRAIS_MAX) || null });
  await recalculerIk(ctx, n.empId, lignesDe(ctx.ds.lignesFrais, n.id).flatMap(anneeIk));
  return { message: `Note de frais n° ${n.id} annulée`, result: { note: n.id, empId: n.empId, statut: 'annulee' } };
};

// — Véhicules —

const vehiculeDeclarer: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const e = salarieSaisi(ctx, p.empId);
  const type = str(p.type) || 'voiture';
  if (!Object.hasOwn(TYPES_VEHICULE, type)) throw new ActionError('Type de véhicule inconnu');
  const cv = Number(p.cv);
  if (!Number.isInteger(cv) || cv < (type === 'deux_roues' ? 0 : 1) || cv > 99) throw new ActionError('Puissance fiscale (CV) invalide');
  const du = str(p.du) || ctx.d.ti, au = str(p.au) || null;
  if (!isValidDate(du) || (au && (!isValidDate(au) || au < du))) throw new ActionError('Période du véhicule invalide');
  // Le véhicule précédent en vigueur s'arrête la veille du nouveau.
  for (const v of (ctx.ds.vehiculesPerso ?? []).filter(x => x.empId === e.id && (!x.au || x.au >= du) && x.du < du)) await ctx.db.update<VehiculePerso>('vehiculesPerso', v.id, { au: addD(du, -1) });
  const v = await ctx.db.insert<VehiculePerso>('vehiculesPerso', { empId: e.id, type: type as TypeVehicule, cv, electrique: !!p.electrique, du, au, creeLe: maintenant(), creePar: ctx.user.nom });
  const pieces = await joindrePieces(ctx, p.jetons ?? p.jeton, 'vehiculePerso', v.id, e.id);
  return { message: `Véhicule personnel déclaré (${TYPES_VEHICULE[v.type].toLowerCase()}, ${v.cv} CV${v.electrique ? ', électrique' : ''})${pieces}`, result: { vehicule: v.id, empId: e.id } };
};

// — Référentiels : barème, forfaits, taux —

const baremeEnregistrer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const annee = Number(p.annee), type = str(p.type) || 'voiture';
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) throw new ActionError('Année du barème invalide');
  if (!Object.hasOwn(TYPES_VEHICULE, type)) throw new ActionError('Type de véhicule inconnu');
  const tranches = Array.isArray(p.tranches) ? p.tranches : [];
  if (!tranches.length || tranches.length > 40) throw new ActionError('Barème : une à quarante tranches');
  const lues = tranches.map((t: Record<string, unknown>) => {
    const ent = (x: unknown, nul = false) => (nul && (x === null || x === undefined || x === '') ? null : Number(x));
    const r = { cvMin: ent(t.cvMin)!, cvMax: ent(t.cvMax, true), kmMin: ent(t.kmMin)!, kmMax: ent(t.kmMax, true), a: Number(String(t.a).replace(',', '.')), b: Number(String(t.b ?? 0).replace(',', '.')) };
    if (![r.cvMin, r.kmMin, r.a, r.b].every(Number.isFinite) || r.a <= 0 || r.a > 10 || Math.abs(r.b) > 100000 || (r.cvMax !== null && !(r.cvMax >= r.cvMin)) || (r.kmMax !== null && !(r.kmMax >= r.kmMin))) {
      throw new ActionError('Barème : tranche invalide (puissance, distance, coefficient a, constante b)');
    }
    return r;
  });
  await ctx.db.run('DELETE FROM baremes_km WHERE annee = ? AND type = ?', [annee, type]);
  for (const t of lues) await ctx.db.insert<BaremeKm>('baremesKm', { annee, type: type as TypeVehicule, ...t, saisiLe: maintenant(), saisiPar: ctx.user.nom });
  // Indemnités de l'année recalculées au barème publié (lignes saisies sans barème comprises).
  for (const empId of new Set((ctx.ds.lignesFrais ?? []).filter(l => l.categorie === 'ik' && l.date.startsWith(`${annee}-`)).map(l => l.empId))) await recalculerIk(ctx, empId, [annee]);
  return { message: `Barème kilométrique ${annee} enregistré (${TYPES_VEHICULE[type as TypeVehicule].toLowerCase()}, ${plural(lues.length, 'tranche', 'tranches')})`, result: { annee, type, tranches: lues.length } };
};

const forfaitEnregistrer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const annee = Number(p.annee), code = str(p.code), pays = str(p.pays).toUpperCase() || null;
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) throw new ActionError('Année invalide');
  if (!estCodeForfait(code)) throw new ActionError('Forfait inconnu');
  if (code === 'etranger' ? !pays || !ctx.ds.referentiels.destinations.some(d => d.code === pays) : pays) throw new ActionError('Pays : seulement pour l’étranger, un pays du référentiel des destinations');
  const montant = nombre(p.montant, 'Montant', 10000);
  const existant = (ctx.ds.referentiels.forfaitsFrais ?? []).find(f => f.annee === annee && f.code === code && (f.pays ?? null) === pays);
  if (montant === null || montant === 0) {
    if (existant) await ctx.db.remove('forfaitsFrais', existant.id);
    return { message: `Limite ${annee} du forfait retirée`, result: { annee, code } };
  }
  if (existant) await ctx.db.update('forfaitsFrais', existant.id, { montant: r2(montant), saisiLe: maintenant(), saisiPar: ctx.user.nom });
  else await ctx.db.insert('forfaitsFrais', { annee, code, pays, montant: r2(montant), saisiLe: maintenant(), saisiPar: ctx.user.nom });
  return { message: `Limite ${annee} du forfait enregistrée`, result: { annee, code } };
};

const tauxEnregistrer: ActionHandler = async (ctx, p) => {
  requireControleurFrais(ctx);
  const devise = str(p.devise).toUpperCase(), mois = str(p.mois);
  if (!estDevise(devise) || devise === 'EUR') throw new ActionError('Devise invalide : code à trois lettres, autre que l’euro');
  if (!estPeriodeFrais(mois)) throw new ActionError('Mois invalide');
  const taux = nombre(p.taux, 'Taux', 1_000_000);
  if (!taux) throw new ActionError('Taux invalide : valeur en euros d’une unité de la devise');
  const existant = (ctx.ds.referentiels.tauxDevises ?? []).find(t => t.devise === devise && t.mois === mois);
  if (existant) await ctx.db.update<TauxDevise>('tauxDevises', existant.id, { taux, saisiLe: maintenant(), saisiPar: ctx.user.nom });
  else await ctx.db.insert<TauxDevise>('tauxDevises', { devise, mois, taux, saisiLe: maintenant(), saisiPar: ctx.user.nom });
  return { message: `Taux ${devise} enregistré pour ${periodeLabel(mois)}`, result: { devise, mois } };
};

// — Avances —

async function avanceDe(ctx: Ctx, id: unknown, voit: (a: AvanceFrais) => boolean): Promise<AvanceFrais> {
  const a = await ctx.db.get<AvanceFrais>('avancesFrais', Number(id) || 0);
  if (a && voit(a)) return a;
  throw horsPerimetre(ctx, 'Avance', !!a);
}
/** Valideur d'une avance : manager direct ou suppléant « frais », ou service RH. */
const valideurAvance = (ctx: Ctx) => (a: AvanceFrais) => {
  const e = ctx.d.emp(a.empId);
  return !!e && (isRh(ctx) || isManagerOf(ctx, e, 'frais'));
};

const avanceDemander: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const e = salarieSaisi(ctx, p.empId);
  const montant = nombre(p.montant, 'Montant de l’avance', 20000);
  if (!montant) throw new ActionError('Montant de l’avance invalide');
  const voyageId = p.voyageId ? Number(p.voyageId) : null, missionId = p.missionId ? Number(p.missionId) : null;
  if (voyageId && !ctx.ds.voyages.some(v => v.id === voyageId && v.empId === e.id)) throw new ActionError('Déplacement introuvable pour ce salarié');
  if (missionId && !ctx.ds.missions.some(m => m.id === missionId && m.empId === e.id)) throw new ActionError('Mission introuvable pour ce salarié');
  // Sans valideur (manager sans N+1), l'avance attend le service RH.
  const a = await ctx.db.insert<AvanceFrais>('avancesFrais', {
    empId: e.id, montant: r2(montant), voyageId, missionId, statut: 'demandee', demandeLe: maintenant(), valideeLe: null, valideePar: null, lotId: null, verseeLe: null,
    annuleeLe: null, annuleePar: null, refusMotif: null,
  });
  return { message: `Avance sur frais n° ${a.id} demandée`, result: { avance: a.id, empId: e.id } };
};

const avanceValider: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const a = await avanceDe(ctx, p.id, valideurAvance(ctx));
  refuserSoiMeme(ctx, getEmp(ctx, a.empId), 'Vous ne validez pas votre propre avance');
  if (a.statut !== 'demandee') throw new ActionError(`Avance n° ${a.id} : rien à valider`, 409);
  await ctx.db.update<AvanceFrais>('avancesFrais', a.id, { statut: 'validee', valideeLe: maintenant(), valideePar: ctx.user.nom });
  return { message: `Avance sur frais n° ${a.id} validée · versée avec la prochaine paie`, result: { avance: a.id, empId: a.empId } };
};

const avanceRefuser: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const a = await avanceDe(ctx, p.id, valideurAvance(ctx));
  refuserSoiMeme(ctx, getEmp(ctx, a.empId), 'Vous ne refusez pas votre propre avance');
  if (a.statut !== 'demandee' && a.statut !== 'validee') throw new ActionError(`Avance n° ${a.id} : refus impossible à cette étape`, 409);
  await ctx.db.update<AvanceFrais>('avancesFrais', a.id, { statut: 'refusee', refusMotif: motif(p.motif) });
  return { message: `Avance sur frais n° ${a.id} refusée`, result: { avance: a.id, empId: a.empId } };
};

const avanceAnnuler: ActionHandler = async (ctx, p) => {
  requireActif(ctx);
  const a = await avanceDe(ctx, p.id, x => isRh(ctx) || isSelf(ctx, x.empId));
  if (a.statut !== 'demandee' && !(a.statut === 'validee' && isRh(ctx))) throw new ActionError(`Avance n° ${a.id} : annulation impossible à cette étape`, 409);
  await ctx.db.update<AvanceFrais>('avancesFrais', a.id, { statut: 'annulee', annuleeLe: maintenant(), annuleePar: ctx.user.nom });
  return { message: `Avance sur frais n° ${a.id} annulée`, result: { avance: a.id, empId: a.empId } };
};

export const fraisActions = {
  'frais.note.creer': noteCreer,
  'frais.ligne.ajouter': ligneAjouter,
  'frais.ligne.modifier': ligneModifier,
  'frais.ligne.supprimer': ligneSupprimer,
  'frais.note.soumettre': noteSoumettre,
  'frais.note.valider': noteValider,
  'frais.note.renvoyer': noteRenvoyer,
  'frais.note.controler': noteControler,
  'frais.ligne.refuser': ligneRefuser,
  'frais.ligne.plafonner': lignePlafonner,
  'frais.note.annuler': noteAnnuler,
  'frais.vehicule.declarer': vehiculeDeclarer,
  'frais.bareme.enregistrer': baremeEnregistrer,
  'frais.forfait.enregistrer': forfaitEnregistrer,
  'frais.taux.enregistrer': tauxEnregistrer,
  'frais.avance.demander': avanceDemander,
  'frais.avance.valider': avanceValider,
  'frais.avance.refuser': avanceRefuser,
  'frais.avance.annuler': avanceAnnuler,
} satisfies Record<string, ActionHandler>;
