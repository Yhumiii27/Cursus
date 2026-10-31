// Pièces justificatives (t133, server/src/pieces.ts) : rattachement d'une pièce envoyée à un objet du dossier, et retrait.
//   piece.joindre  jetons (ou jeton), objet, objetId : pièces en attente envoyées par la personne connectée, jointes à une
//                  absence (l'intéressé ou le service RH), une certification ou un titre d'habilitation (service RH,
//                  référent HSE / formation), un document déclaré (l'intéressé tant qu'il attend, ou le service RH), un
//                  déplacement (service RH) ; lot 11 : un dossier OPCO (service RH), pièce sans salarié, avec sa
//                  `nature` (facture, accord…), gardée 10 ans pour la facture et l'accord (shared/rules/opco.ts)
//   piece.retirer  id, motif : description gardée, fichier effacé après la validation ; service RH, référent HSE pour
//                  les certifications et habilitations, jamais sur son propre dossier
// Au plus 10 pièces en vigueur par objet (MAX_PIECES_PAR_OBJET).
// Les actions qui créent ou décident un objet (absence.saisir, absence.qualifier, absence.signaler, cert.ajouter,
// hab.delivrer, formalite.enregistrer) joignent leurs pièces par `joindrePieces`, dans leur transaction.
import { estConge } from '../../../shared/rules/absences.ts';
import { depotOuvert, estObjetPiece, MAX_PIECES_PAR_OBJET, OBJETS_PIECE, OBJETS_SANS_SALARIE } from '../../../shared/rules/pieces.ts';
import { conservationPieceOpco, estNaturePiece, NATURES_PIECE_OPCO } from '../../../shared/rules/opco.ts';
import { plural } from '../../../shared/format.ts';
import type { Absence, Certification, DemandeCollab, DossierOpco, HabTitre, NaturePiece, ObjetPiece, Voyage } from '../../../shared/types.ts';
import { nettoyerBientot, type PieceEnregistree } from '../pieces.ts';
import { ActionError, aDroit, type ActionHandler, type Ctx, estSoiMeme, getEmp, isRh, isSelf, refuserSoiMeme, requireFormations, requireRh, str } from './context.ts';

/** Jetons reçus : une chaîne ou une liste de chaînes (au plus 10 pièces par objet et par envoi). */
function jetonsDe(v: unknown): string[] {
  const l = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  if (l.length > 10) throw new ActionError('10 pièces au plus à la fois');
  return [...new Set(l)];
}

/**
 * Joint à l'objet les pièces en attente désignées par leur jeton (envoyées par le même compte). L'appelant a vérifié le
 * droit d'agir sur l'objet. Renvoie le complément du message (« · 1 pièce jointe »), vide sans pièce.
 */
export async function joindrePieces(
  ctx: Ctx, jetons: unknown, objet: ObjetPiece, objetId: number, empId: number | null,
  // lot 11 — dossiers OPCO : nature des pièces et fin de leur conservation propre (null : celle de l'objet).
  dossier: { nature: NaturePiece; conserverJusquau: string | null } | null = null,
): Promise<string> {
  // Pièce sans salarié : seulement pour un objet qui n'en a pas (dossier OPCO) ; toute autre désigne son salarié.
  if ((empId == null) !== OBJETS_SANS_SALARIE.has(objet)) throw new ActionError(`${OBJETS_PIECE[objet].label} : salarié du dossier introuvable`);
  const liste = jetonsDe(jetons);
  if (!liste.length) return '';
  if (!depotOuvert(ctx.ds.settings.piecesStockage)) throw new ActionError('Pièces justificatives désactivées : l’administrateur RH les active dans Paramètres', 409);
  // Pièces en vigueur bornées par objet : le dépôt (volume des données, avec la base et les sauvegardes) ne se remplit
  // pas de pièces jointes en boucle au même objet.
  const deja = Number(((await ctx.db.one('SELECT COUNT(*) AS n FROM pieces WHERE objet = ? AND objet_id = ? AND retiree_le IS NULL', [objet, objetId])) as { n: number }).n);
  if (deja + liste.length > MAX_PIECES_PAR_OBJET) {
    throw new ActionError(`${MAX_PIECES_PAR_OBJET} pièces au plus par objet (${plural(deja, 'déjà jointe', 'déjà jointes')}) : retirez d’abord celles qui ne servent plus`);
  }
  for (const j of liste) {
    const p = (await ctx.db.one('SELECT id FROM pieces WHERE jeton = ?', [j])) as { id: number } | undefined;
    const piece = p ? await ctx.db.get<PieceEnregistree>('pieces', p.id) : undefined;
    // Jeton inconnu, pièce d'un autre compte ou déjà jointe : même refus, qui ne dit rien des pièces des autres.
    if (!piece || piece.objet || piece.retireeLe || !piece.fichier || (ctx.user.compteId != null && piece.deposeCompteId !== ctx.user.compteId)) {
      throw new ActionError('Pièce introuvable ou déjà jointe : envoyez de nouveau le fichier');
    }
    await ctx.db.update<PieceEnregistree>('pieces', piece.id, { objet, objetId, empId, jeton: null, ...(dossier ? { nature: dossier.nature, conserverJusquau: dossier.conserverJusquau } : {}) });
  }
  return ` · ${plural(liste.length, 'pièce jointe', 'pièces jointes')}`;
}

/**
 * Retire les pièces en vigueur d'un objet (document refusé) : description gardée, fichiers effacés après la validation.
 * Renvoie leur nombre.
 */
export async function retirerPiecesDe(ctx: Ctx, objet: ObjetPiece, objetId: number, motif: string): Promise<number> {
  const ids = ((await ctx.db.query('SELECT id FROM pieces WHERE objet = ? AND objet_id = ? AND retiree_le IS NULL', [objet, objetId])) as { id: number }[]).map(r => r.id);
  for (const id of ids) await ctx.db.update<PieceEnregistree>('pieces', id, { retireeLe: new Date().toISOString(), retireePar: ctx.user.nom, retireeMotif: motif });
  if (ids.length) nettoyerBientot(ctx.db);
  return ids.length;
}

/** Pièces d'un objet remplacé (déclaration du même document à nouveau faite) rattachées au nouvel objet. */
export async function deplacerPieces(ctx: Ctx, objet: ObjetPiece, de: number, vers: number) {
  (await ctx.db.run('UPDATE pieces SET objet_id = ? WHERE objet = ? AND objet_id = ?', [vers, objet, de]));
}

/** Objet visé, après contrôle du droit d'y joindre une pièce : son salarié (null : objet sans salarié, dossier OPCO). */
async function objetVise(ctx: Ctx, objet: ObjetPiece, id: number): Promise<number | null> {
  const ligne = async <T>(table: Parameters<Ctx['db']['get']>[0]) => {
    const x = await ctx.db.get<T & { empId: number }>(table, id);
    if (!x) throw new ActionError(`${OBJETS_PIECE[objet].label} : objet introuvable`, 404);
    return x;
  };
  switch (objet) {
    case 'absence': {
      const a = await ligne<Absence>('absences');
      // Un justificatif d'absence (souvent médical) : l'intéressé ou le service RH, jamais le manager.
      if (!(isRh(ctx) || isSelf(ctx, a.empId) || ctx.user.salarieId === a.empId)) throw new ActionError('Justificatif réservé à l’intéressé et au service RH', 403);
      if (estConge(a.type)) throw new ActionError('Un congé ne demande pas de justificatif');
      if (a.statut === 'annulee' || a.statut === 'refusee') throw new ActionError('Absence annulée ou refusée : aucun justificatif à joindre');
      return a.empId;
    }
    case 'certification': requireFormations(ctx); return (await ligne<Certification>('certifications')).empId;
    case 'habTitre': requireFormations(ctx); return (await ligne<HabTitre>('habTitres')).empId;
    case 'declaration': {
      const r = await ligne<DemandeCollab>('demandesCollab');
      if (r.type !== 'document') throw new ActionError('Seul un document déclaré reçoit une pièce');
      if (!(isRh(ctx) || (isSelf(ctx, r.empId) && r.statut === 'attente'))) throw new ActionError('Pièce réservée à l’intéressé, tant que la déclaration attend, et au service RH', 403);
      return r.empId;
    }
    case 'voyage': requireRh(ctx); return (await ligne<Voyage>('voyages')).empId;
    // lot 11 — dossiers OPCO : service RH ; dossier en vigueur (pas supprimé), non nominatif.
    case 'dossierOpco': {
      requireRh(ctx);
      const d = await ctx.db.get<DossierOpco>('dossiersOpco', id);
      if (!d || d.annuleLe) throw new ActionError(`${OBJETS_PIECE[objet].label} : objet introuvable`, 404);
      if (d.empId != null) throw new ActionError('Dossier OPCO nominatif : pièces pas encore prises en charge');
      return null;
    }
  }
}

const joindre: ActionHandler = async (ctx, p) => {
  const objet = p.objet;
  if (!estObjetPiece(objet)) throw new ActionError('Objet inconnu');
  const id = Number(p.objetId);
  if (!Number.isInteger(id) || id <= 0) throw new ActionError('Objet introuvable', 404);
  const empId = await objetVise(ctx, objet, id);
  // lot 11 — pièce d'un dossier OPCO : nature exigée (liste fermée), conservation de 10 ans pour la facture et l'accord.
  let dossier: { nature: NaturePiece; conserverJusquau: string | null } | null = null;
  if (objet === 'dossierOpco') {
    if (!estNaturePiece(p.nature)) throw new ActionError('Nature de la pièce à choisir dans la liste (convention, accord, facture…)');
    const d = (await ctx.db.get<DossierOpco>('dossiersOpco', id))!;
    dossier = { nature: p.nature, conserverJusquau: conservationPieceOpco(p.nature, d.exercice, ctx.d.ti) };
  }
  const suite = await joindrePieces(ctx, p.jetons ?? p.jeton, objet, id, empId, dossier);
  if (!suite) throw new ActionError('Aucune pièce à joindre');
  // Justificatif envoyé par l'intéressé : la réception reste une décision du service RH, qui voit la pièce « à vérifier »
  // dans la liste des absences (shared/rules/pieces.ts, `justificatifAVerifier`).
  const aVerifier = objet === 'absence' && !isRh(ctx) && !(await ctx.db.get<Absence>('absences', id))?.justificatif;
  const nature = dossier ? ` (${NATURES_PIECE_OPCO[dossier.nature].toLowerCase()})` : '';
  return { message: `${OBJETS_PIECE[objet].label}${nature}${suite.replace(' · ', ' — ')}${aVerifier ? ', à vérifier par le service RH' : ''}`, result: { empId } };
};

/** Longueur au plus du motif d'un retrait (gardé avec la pièce, jamais recopié au journal). */
export const MOTIF_RETRAIT_MAX = 500;

const retirer: ActionHandler = async (ctx, p) => {
  const piece = await ctx.db.get<PieceEnregistree>('pieces', Number(p.id));
  if (!piece || !piece.objet) throw new ActionError('Pièce introuvable', 404);
  const titre = piece.objet === 'certification' || piece.objet === 'habTitre';
  if (!(isRh(ctx) || (titre && aDroit(ctx, 'formations')))) {
    throw new ActionError(titre ? 'Retrait réservé au service RH et au référent HSE / formation' : 'Retrait réservé au service RH', 403);
  }
  // Retirer une pièce de son propre dossier (justificatif de son absence, attestation de sa certification) : jamais,
  // comme la qualification de sa propre absence ou la suppression de sa propre certification.
  if (piece.empId != null && estSoiMeme(ctx, piece.empId)) refuserSoiMeme(ctx, getEmp(ctx, piece.empId), 'Vous ne pouvez pas retirer une pièce de votre propre dossier');
  if (piece.retireeLe) return 'Pièce déjà retirée';
  const motif = str(p.motif);
  if (!motif) throw new ActionError('Indiquez le motif du retrait');
  if (motif.length > MOTIF_RETRAIT_MAX) throw new ActionError(`Motif trop long (${MOTIF_RETRAIT_MAX} caractères au plus)`);
  await ctx.db.update<PieceEnregistree>('pieces', piece.id, { retireeLe: new Date().toISOString(), retireePar: ctx.user.nom, retireeMotif: motif });
  // Fichier effacé une fois l'action validée (une transaction annulée garderait sinon une pièce sans fichier).
  nettoyerBientot(ctx.db);
  return `Pièce retirée du dossier (${OBJETS_PIECE[piece.objet].label.toLowerCase()}) · fichier effacé, les sauvegardes en gardent la copie jusqu’à leur rotation`;
};

export const piecesActions = {
  'piece.joindre': joindre,
  'piece.retirer': retirer,
} satisfies Record<string, ActionHandler>;
