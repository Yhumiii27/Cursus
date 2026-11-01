// Dossiers de prise en charge OPCO (lot 11, chantier C4, t189 ; règles : shared/rules/opco.ts). Service RH (gestionnaire et
// administrateur) ; l'administrateur RH seul revient d'un cran, annule un versement ou supprime un dossier saisi par erreur ;
// la lecture seule consulte, sans action.
//   opco.creer             planActionId, champs du dossier : dossier « à déposer » rattaché à une action du plan (OPCO et
//                          subrogation proposés par les réglages)
//   opco.modifier          id, champs modifiés, motif (exigé une fois le dossier déposé : correction)
//   opco.deposer           id, de, deposeLe, reference
//   opco.accorder          id, de, accordLe, montantAccorde, accordReference, plafondHoraire
//   opco.refuser           id, de, refusLe, motif (code de MOTIFS_REFUS_OPCO)
//   opco.facturer          id, de, factureLe, montantFacture : justificatifs envoyés (facture et certificat de réalisation
//                          joints au dossier quand les pièces justificatives sont activées) ; après un acompte, le dossier
//                          reste « remboursé »
//   opco.versement         id, le, montant, destinataire, reference, versements (nombre affiché : double clic) → remboursé
//   opco.annulerVersement  id (versement), motif : administrateur RH ; dernier versement annulé → état d'avant
//   opco.solder            id, de, soldeLe, nature (perte ou partiel quand il reste un écart) ; justificatifs envoyés exigés
//   opco.abandonner        id, de, motif (code de MOTIFS_ABANDON_OPCO)
//   opco.rouvrir           id, de, motif : administrateur RH, retour d'un cran (champs de l'état quitté effacés)
//   opco.supprimer         id, motif : administrateur RH, dossier saisi par erreur (sans versement ni pièce en vigueur)
// Aucun refus pour un exercice clos (les remboursements arrivent après la clôture). Une ligne du plan qui porte un dossier
// actif ne se supprime pas (`refusLigneAvecDossier`, plan.supprimer, réouverture d'une demande, import « remplacer ») ; son
// report sur l'exercice suivant emporte ses dossiers actifs (`transfererDossiers`, plan.cloturerExercice).
import { isValidDate } from '../../../shared/dates.ts';
import { decap, fmtEur, fmtIso, plural } from '../../../shared/format.ts';
import { erreurMotifCorrection } from '../../../shared/rules/corrections.ts';
import {
  CHAMPS_ETAT, conservationPieceOpco, controleFacturation, controlerSaisieOpco, controleSolde, controleTransition, type Issue, DISPOSITIFS_OPCO, dossierActif, ecartAuSolde, type EtapeOpco, estEcartSoldeOpco,
  estMotifAbandonOpco, estMotifRefusOpco, estStatutOpco, montantOpco, NATURES_PIECE_OPCO, OPCOS,
  piecesPourFacturer, type SaisieOpco, statutPrecedent, STATUTS_OPCO, STATUTS_VERSEMENT, referenceValide, versementsDe,
} from '../../../shared/rules/opco.ts';
import { depotOuvert } from '../../../shared/rules/pieces.ts';
import type { DestinataireVersementOpco, DossierOpco, ISODate, NaturePiece, PlanAction, VersementOpco } from '../../../shared/types.ts';
import type { PieceEnregistree } from '../pieces.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh, requireRhAdmin, str } from './context.ts';

// — Lecture et noms —

/** Action du plan nommée dans un message ou une relance : formation (nom court) ou intitulé, équipe, exercice. */
export const nomActionPlan = (ctx: Pick<Ctx, 'd'>, l: Pick<PlanAction, 'f' | 'libelle' | 'equipe' | 'exercice'>) =>
  `${l.f ? ctx.d.fm(l.f)?.court ?? l.f : l.libelle} — ${l.equipe} (${l.exercice})`;

/** Dossier en vigueur (ni supprimé, ni inconnu), lu en base. */
async function dossierOf(ctx: Ctx, id: unknown): Promise<DossierOpco> {
  const d = await ctx.db.get<DossierOpco>('dossiersOpco', Number(id));
  if (!d || d.annuleLe) throw new ActionError('Dossier OPCO introuvable ou supprimé', 404);
  return d;
}

/** Nom du dossier dans un message : son action du plan (ou son numéro, ligne introuvable), son dispositif. */
function nomDossier(ctx: Ctx, d: DossierOpco): string {
  const l = ctx.ds.plan.find(x => x.id === d.planActionId);
  return `Dossier OPCO ${l ? nomActionPlan(ctx, l) : `n° ${d.id}`}`;
}

const versementsActifs = async (ctx: Ctx, d: DossierOpco) => versementsDe(await ctx.db.where<VersementOpco>('versementsOpco', 'dossierId', d.id), d.id);

/** Date d'un fait (dépôt, accord, versement…) : par défaut aujourd'hui ; jamais dans le futur, ni avant `apres`. */
function dateFait(v: unknown, ctx: Ctx, libelle: string, apres?: ISODate | null): ISODate {
  const t = v === undefined || v === null || v === '' ? ctx.d.ti : str(v);
  if (!isValidDate(t)) throw new ActionError(`${libelle} : date invalide`);
  if (t > ctx.d.ti) throw new ActionError(`${libelle} : la date ne peut pas être dans le futur`);
  if (apres && t < apres) throw new ActionError(`${libelle} : la date précède celle de l’étape précédente (${fmtIso(apres)})`);
  return t;
}

/** Référence administrative facultative (numéro de dossier, d'accord, de virement) : un code, jamais un texte libre. */
function referenceDe(v: unknown, libelle: string): string | null {
  const t = str(v);
  if (!t) return null;
  if (!referenceValide(t)) throw new ActionError(`${libelle} : lettres, chiffres, « . », « / », « _ » ou « - », sans espace, 40 caractères au plus`);
  return t;
}

/** Montant exigé (strictement positif si `positif`). */
function montantDe(v: unknown, libelle: string, positif = false): number {
  const m = montantOpco(v);
  if (m === null || (positif && m === 0)) throw new ActionError(`${libelle} : montant en euros, ${positif ? 'plus de 0' : '0 ou plus'}`);
  return m;
}

function motifDe(p: Record<string, any>): string {
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  return str(p.motif);
}

/**
 * Transition contrôlée : rien à faire (déjà faite, double clic) → message ; refus → erreur ; sinon null. `issue` : contrôle
 * propre à l'étape (facturation, solde), sinon celui de TRANSITIONS_OPCO.
 */
function transition(ctx: Ctx, d: DossierOpco, etape: EtapeOpco, de: unknown, issue?: Issue): string | null {
  const t = issue ?? controleTransition(etape, d.statut, de);
  if ('deja' in t) return `${nomDossier(ctx, d)} · ${t.deja}`;
  if ('refus' in t) throw new ActionError(`${nomDossier(ctx, d)} : ${t.refus}`);
  return null;
}

/** Montant affiché dans un message : seulement pour un dossier non nominatif (tous aujourd'hui). */
const montantTexte = (d: Pick<DossierOpco, 'empId'>, m: number) => (d.empId == null ? ` (${fmtEur(m)})` : '');

// — Création et modification —

const CHAMPS_SAISIE: (keyof SaisieOpco)[] = [
  'opco', 'dispositif', 'reference', 'du', 'au', 'heures', 'effectif', 'montantDemande', 'montantDemandeAnnexes', 'subrogation', 'organismeSiret', 'organismeNda',
  'organismeQualiopi',
];

/** Saisie contrôlée ; la première erreur refuse l'action. */
function saisie(v: SaisieOpco) {
  const { erreurs, champs } = controlerSaisieOpco(v);
  const e = Object.values(erreurs)[0];
  if (e) throw new ActionError(e);
  return champs;
}

const creer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const l = ctx.ds.plan.find(x => x.id === Number(p.planActionId));
  if (!l) throw new ActionError('Action du plan introuvable ou supprimée', 404);
  if (l.statut === 'reporte') throw new ActionError(`${nomActionPlan(ctx, l)} : action reportée sur l’exercice ${l.exercice + 1}, créez le dossier sur sa nouvelle ligne`);
  const s = ctx.ds.settings;
  const champs = saisie({
    ...Object.fromEntries(CHAMPS_SAISIE.map(k => [k, p[k]])) as unknown as SaisieOpco,
    // Proposés : OPCO et subrogation des réglages, dispositif « plan de développement des compétences ».
    opco: p.opco ?? s.opcoDefaut, subrogation: p.subrogation ?? s.opcoSubrogation, dispositif: p.dispositif ?? 'plan',
  });
  const d = await ctx.db.insert<DossierOpco>('dossiersOpco', {
    ...champs, planActionId: l.id, empId: null, exercice: l.exercice, statut: 'a_deposer', creeLe: new Date().toISOString(), creePar: ctx.user.nom,
  });
  return {
    message: `Dossier OPCO créé — ${nomActionPlan(ctx, l)} : ${DISPOSITIFS_OPCO[champs.dispositif].label}, ${OPCOS[champs.opco]}${champs.montantDemande != null ? `, ${fmtEur(champs.montantDemande)} demandés` : ''}`,
    result: { id: d.id },
  };
};

/**
 * Modification des champs saisis (OPCO, dispositif, numéro, dates, heures, effectif, montants demandés, subrogation,
 * organisme) : seuls les champs envoyés changent. Une fois le dossier déposé, c'est une correction, motivée et signée.
 * Un dossier soldé, refusé ou abandonné se rouvre d'abord.
 */
const modifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  if (!STATUTS_OPCO[d.statut].enCours) throw new ActionError(`${nomDossier(ctx, d)} : dossier ${STATUTS_OPCO[d.statut].label.toLowerCase()}, rouvrez-le d’abord`);
  const v = Object.fromEntries(CHAMPS_SAISIE.map(k => [k, p[k] === undefined ? d[k] : p[k]])) as unknown as SaisieOpco;
  const champs = saisie(v);
  const changes = CHAMPS_SAISIE.filter(k => JSON.stringify(champs[k] ?? null) !== JSON.stringify(d[k] ?? null));
  if (!changes.length) return 'Aucune modification';
  const correction = d.statut !== 'a_deposer' ? { corrigeLe: ctx.d.ti, corrigePar: ctx.user.nom, corrigeMotif: motifDe(p) } : {};
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { ...champs, ...correction });
  return `${nomDossier(ctx, d)} ${d.statut === 'a_deposer' ? 'modifié' : 'corrigé'} (${plural(changes.length, 'champ', 'champs')})`;
};

// — Transitions —

const deposer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'deposer', p.de);
  if (deja) return deja;
  const deposeLe = dateFait(p.deposeLe, ctx, 'Dépôt');
  const reference = p.reference === undefined ? d.reference : referenceDe(p.reference, 'Numéro de dossier');
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: 'depose', deposeLe, reference });
  return `${nomDossier(ctx, d)} · déposé le ${fmtIso(deposeLe)}${reference ? ` (dossier ${reference})` : ''}`;
};

const accorder: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'accorder', p.de);
  if (deja) return deja;
  const montantAccorde = montantDe(p.montantAccorde, 'Montant accordé');
  const accordLe = dateFait(p.accordLe, ctx, 'Accord', d.deposeLe);
  const plafond = p.plafondHoraire === undefined || p.plafondHoraire === null || p.plafondHoraire === '' ? null : montantOpco(p.plafondHoraire);
  if (p.plafondHoraire != null && p.plafondHoraire !== '' && plafond === null) throw new ActionError('Plafond horaire : montant en euros par heure, 0 ou plus');
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, {
    statut: 'accorde', accordLe, montantAccorde, accordReference: referenceDe(p.accordReference, 'Référence de l’accord'), plafondHoraire: plafond,
  });
  return `${nomDossier(ctx, d)} · accordé le ${fmtIso(accordLe)}${montantTexte(d, montantAccorde)}`;
};

const refuser: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'refuser', p.de);
  if (deja) return deja;
  if (!estMotifRefusOpco(p.motif)) throw new ActionError('Motif du refus à choisir dans la liste');
  const refusLe = dateFait(p.refusLe, ctx, 'Refus', d.deposeLe);
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: 'refuse', refusLe, refusMotif: p.motif });
  // Le motif reste sur le dossier : jamais dans le message, recopié au journal.
  return `${nomDossier(ctx, d)} · refusé le ${fmtIso(refusLe)}`;
};

/**
 * Justificatifs envoyés (demande de remboursement) : montant facturé exigé ; quand les pièces justificatives sont
 * activées, la facture et le certificat de réalisation (ou les feuilles d'émargement) doivent être joints au dossier.
 * Un dossier déjà remboursé par un acompte reste « remboursé » : seuls l'envoi et le montant facturé s'enregistrent.
 */
const facturer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'facturer', p.de, controleFacturation(d, p.de));
  if (deja) return deja;
  const montantFacture = montantDe(p.montantFacture, 'Montant facturé');
  const factureLe = dateFait(p.factureLe, ctx, 'Envoi des justificatifs', d.accordLe);
  if (depotOuvert(ctx.ds.settings.piecesStockage)) {
    const natures = (await ctx.db.query('SELECT nature FROM pieces WHERE objet = ? AND objet_id = ? AND retiree_le IS NULL', ['dossierOpco', d.id]) as { nature: NaturePiece | null }[]).map(r => r.nature);
    const manquent = piecesPourFacturer(natures);
    if (manquent.length) throw new ActionError(`${nomDossier(ctx, d)} : pièces à joindre avant la demande de remboursement — ${manquent.map(n => decap(NATURES_PIECE_OPCO[n])).join(', ')}`);
  }
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: d.statut === 'rembourse' ? 'rembourse' : 'facture', factureLe, montantFacture });
  return `${nomDossier(ctx, d)} · justificatifs envoyés le ${fmtIso(factureLe)}${montantTexte(d, montantFacture)}`;
};

/**
 * Versement de l'OPCO (acompte ou solde) : au dossier accordé, aux justificatifs envoyés ou déjà remboursé ; destinataire
 * proposé d'après la subrogation. `versements` : nombre de versements affichés — s'il y en a déjà davantage, celui-ci est
 * un double clic ou vient d'un autre onglet, rien n'est enregistré.
 */
const versement: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  if (!STATUTS_VERSEMENT.includes(d.statut)) throw new ActionError(`${nomDossier(ctx, d)} : aucun versement attendu à l’état « ${STATUTS_OPCO[d.statut].label} »`);
  const actifs = await versementsActifs(ctx, d);
  if (p.versements !== undefined && p.versements !== null && actifs.length > Number(p.versements)) return `${nomDossier(ctx, d)} · versement déjà enregistré`;
  const montant = montantDe(p.montant, 'Montant versé', true);
  const le = dateFait(p.le, ctx, 'Versement', d.accordLe);
  const destinataire: DestinataireVersementOpco = p.destinataire === undefined || p.destinataire === null || p.destinataire === ''
    ? (d.subrogation ? 'organisme' : 'entreprise') : p.destinataire;
  if (destinataire !== 'entreprise' && destinataire !== 'organisme') throw new ActionError('Destinataire du versement : l’entreprise ou l’organisme de formation');
  const v = await ctx.db.insert<VersementOpco>('versementsOpco', {
    dossierId: d.id, le, montant, destinataire, reference: referenceDe(p.reference, 'Référence du virement'), saisiLe: new Date().toISOString(), saisiPar: ctx.user.nom,
  });
  if (d.statut !== 'rembourse') await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: 'rembourse' });
  return {
    message: `${nomDossier(ctx, d)} · versement du ${fmtIso(le)}${montantTexte(d, montant)} ${destinataire === 'organisme' ? 'payé à l’organisme' : 'reçu par l’entreprise'}`,
    result: { id: v.id, dossierId: d.id },
  };
};

/**
 * Annulation d'un versement saisi par erreur (administrateur RH), motif obligatoire : gardé, hors des sommes. Sans autre
 * versement, le dossier revient à l'état d'avant (justificatifs envoyés, ou accordé). Un dossier soldé se rouvre d'abord.
 */
const annulerVersement: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const v = await ctx.db.get<VersementOpco>('versementsOpco', Number(p.id));
  if (!v || v.annuleLe) throw new ActionError('Versement introuvable ou déjà annulé', 404);
  const d = await dossierOf(ctx, v.dossierId);
  if (d.statut === 'solde') throw new ActionError(`${nomDossier(ctx, d)} : dossier soldé, rouvrez-le d’abord`);
  const motif = motifDe(p);
  await ctx.db.update<VersementOpco>('versementsOpco', v.id, { annuleLe: new Date().toISOString(), annulePar: ctx.user.nom, annuleMotif: motif });
  const restants = (await versementsActifs(ctx, d)).length;
  const retour = !restants && d.statut === 'rembourse' ? (d.factureLe ? 'facture' : 'accorde') : null;
  if (retour) await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: retour });
  return {
    message: `${nomDossier(ctx, d)} · versement du ${fmtIso(v.le)} annulé${retour ? ` — dossier de nouveau « ${STATUTS_OPCO[retour].label} »` : ''}`,
    result: { dossierId: d.id },
  };
};

/**
 * Solde : l'écart accordé − reçu est figé ; s'il en reste un, il est qualifié (perte, prise en charge partielle ; proposé
 * d'après les sommes reçues) ; sinon « aucun écart ». Les justificatifs doivent avoir été envoyés (`controleSolde`) : un
 * acompte ne dispense pas de la facture ni du certificat de réalisation.
 */
const solder: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'solder', p.de, controleSolde(d, p.de));
  if (deja) return deja;
  const soldeLe = dateFait(p.soldeLe, ctx, 'Solde', d.factureLe);
  const { ecart, nature: proposee } = ecartAuSolde(d, await versementsActifs(ctx, d));
  let nature = proposee;
  if (ecart > 0 && p.nature !== undefined && p.nature !== null && p.nature !== '') {
    if (!estEcartSoldeOpco(p.nature) || p.nature === 'aucun') throw new ActionError('Écart au solde : perte ou prise en charge partielle');
    nature = p.nature;
  }
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: 'solde', soldeLe, soldeEcart: ecart, soldeNature: nature });
  return `${nomDossier(ctx, d)} · soldé le ${fmtIso(soldeLe)}${ecart > 0 ? ` — écart${montantTexte(d, ecart)} : ${nature === 'perte' ? 'perte' : 'prise en charge partielle'}` : ', sans écart'}`;
};

const abandonner: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const d = await dossierOf(ctx, p.id);
  const deja = transition(ctx, d, 'abandonner', p.de);
  if (deja) return deja;
  if (!estMotifAbandonOpco(p.motif)) throw new ActionError('Motif de l’abandon à choisir dans la liste');
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { statut: 'abandonne', abandonLe: ctx.d.ti, abandonMotif: p.motif });
  return `${nomDossier(ctx, d)} · abandonné`;
};

/**
 * Retour d'un cran (administrateur RH), motif obligatoire, gardé comme une correction : les champs de l'état quitté sont
 * effacés (le journal garde leurs anciennes valeurs, montants des seuls dossiers non nominatifs). `de` : état affiché ;
 * déjà rouvert depuis (double clic) : rien n'est refait.
 */
const rouvrir: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const d = await dossierOf(ctx, p.id);
  const n = (await versementsActifs(ctx, d)).length;
  if (p.de !== undefined && p.de !== null && p.de !== '' && p.de !== d.statut) {
    const affiche = estStatutOpco(p.de) ? statutPrecedent({ ...d, statut: p.de }, n) : null;
    if (affiche && 'vers' in affiche && affiche.vers === d.statut) return `${nomDossier(ctx, d)} · déjà rouvert`;
    throw new ActionError(`${nomDossier(ctx, d)} : le dossier est maintenant « ${STATUTS_OPCO[d.statut].label} » — vérifiez-le, puis réessayez`);
  }
  const r = statutPrecedent(d, n);
  if ('refus' in r) throw new ActionError(`${nomDossier(ctx, d)} : ${r.refus}`);
  const motif = motifDe(p);
  const effaces = Object.fromEntries((CHAMPS_ETAT[d.statut] ?? []).map(k => [k, null]));
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { ...effaces, statut: r.vers, corrigeLe: ctx.d.ti, corrigePar: ctx.user.nom, corrigeMotif: motif });
  return `${nomDossier(ctx, d)} · de nouveau « ${STATUTS_OPCO[r.vers].label} »`;
};

/**
 * Suppression d'un dossier saisi par erreur (administrateur RH), motif obligatoire : gardé en base, hors de l'instantané.
 * Refusée tant qu'un versement ou une pièce en vigueur y est rattaché (les annuler ou les retirer d'abord).
 */
const supprimer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const d = await dossierOf(ctx, p.id);
  if ((await versementsActifs(ctx, d)).length) throw new ActionError(`${nomDossier(ctx, d)} : annulez d’abord ses versements`);
  const pieces = Number(((await ctx.db.one('SELECT COUNT(*) AS n FROM pieces WHERE objet = ? AND objet_id = ? AND retiree_le IS NULL', ['dossierOpco', d.id])) as { n: number }).n);
  if (pieces) throw new ActionError(`${nomDossier(ctx, d)} : retirez d’abord ses pièces (${plural(pieces, 'pièce jointe', 'pièces jointes')})`);
  const motif = motifDe(p);
  await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { annuleLe: ctx.d.ti, annulePar: ctx.user.nom, annuleMotif: motif });
  return `${nomDossier(ctx, d)} supprimé`;
};

// — Ligne du plan —

/**
 * Refus de supprimer (ou de retirer par la réouverture d'une demande) une ligne du plan qui porte un dossier actif ; null
 * sinon. Un dossier refusé, abandonné ou supprimé ne retient pas la ligne.
 */
export async function refusLigneAvecDossier(ctx: Ctx, planActionId: number): Promise<string | null> {
  const actifs = (await ctx.db.where<DossierOpco>('dossiersOpco', 'planActionId', planActionId)).filter(dossierActif);
  return actifs.length ? `${plural(actifs.length, 'dossier OPCO en cours', 'dossiers OPCO en cours')} sur cette ligne : abandonnez-le ou supprimez-le d’abord` : null;
}

/**
 * La ligne porte-t-elle un dossier, quel qu'il soit (refusé, abandonné, supprimé compris) ? Elle ne se supprime alors pas
 * physiquement (clé étrangère `restrict` en PostgreSQL, dossier orphelin en SQLite) : l'import « remplacer » la garde.
 */
export async function ligneAvecDossier(ctx: Ctx, planActionId: number): Promise<boolean> {
  return (await ctx.db.where<DossierOpco>('dossiersOpco', 'planActionId', planActionId)).length > 0;
}

/**
 * Report d'une action sur l'exercice suivant (plan.cloturerExercice) : ses dossiers actifs suivent la nouvelle ligne et son
 * exercice (et la conservation de leurs pièces comptables, `conservationPieceOpco`) ; refusés et abandonnés restent sur
 * l'ancienne. Renvoie leur nombre.
 */
export async function transfererDossiers(ctx: Ctx, de: number, vers: number, exercice: number): Promise<number> {
  const actifs = (await ctx.db.where<DossierOpco>('dossiersOpco', 'planActionId', de)).filter(dossierActif);
  for (const d of actifs) {
    await ctx.db.update<DossierOpco>('dossiersOpco', d.id, { planActionId: vers, exercice });
    // Pièces comptables (facture, accord) : leur conservation suit le nouvel exercice du dossier, jamais raccourcie.
    for (const x of (await ctx.db.where<PieceEnregistree>('pieces', 'objetId', d.id)).filter(x => x.objet === 'dossierOpco' && x.conserverJusquau)) {
      const fin = conservationPieceOpco(x.nature, exercice, ctx.d.ti);
      if (fin && fin > x.conserverJusquau!) await ctx.db.update<PieceEnregistree>('pieces', x.id, { conserverJusquau: fin });
    }
  }
  return actifs.length;
}

export const opcoActions = {
  'opco.creer': creer,
  'opco.modifier': modifier,
  'opco.deposer': deposer,
  'opco.accorder': accorder,
  'opco.refuser': refuser,
  'opco.facturer': facturer,
  'opco.versement': versement,
  'opco.annulerVersement': annulerVersement,
  'opco.solder': solder,
  'opco.abandonner': abandonner,
  'opco.rouvrir': rouvrir,
  'opco.supprimer': supprimer,
} satisfies Record<string, ActionHandler>;
