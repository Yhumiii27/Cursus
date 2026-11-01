// Justificatifs des notes de frais (lot 11, chantier C5), appelés par les actions des pièces (server/src/actions/pieces.ts) :
// - joindre une pièce à une ligne de frais (`ligneFrais`, ou `ligneFraisSante` pour une note médicale : objet de santé,
//   jamais vu du manager) : l'intéressé ou le service RH, tant que la note se saisit (brouillon, à corriger) ; à un
//   véhicule personnel (`vehiculePerso` : carte grise, assurance) : l'intéressé ou le service RH ;
// - retirer : jamais une pièce scellée à la soumission de sa note (server/src/sceaux.ts), ni une pièce d'une note soumise ;
//   avant, le service RH seulement, comme les autres pièces (le salarié supprime la ligne, ce qui retire ses pièces).
// lot 12 — C2 : ni jointe ni retirée sur une dépense d'une note archivée (payée depuis plus de 13 mois), refus 409.
import { noteModifiable } from '../../shared/rules/frais.ts';
import { noteArchivee, refusNoteArchivee } from '../../shared/rules/frais-fenetre.ts';
import { OBJETS_PIECE } from '../../shared/rules/pieces.ts';
import type { LigneFrais, NoteFrais, ObjetPiece, VehiculePerso } from '../../shared/types.ts';
import { ActionError, type Ctx, isRh, isSelf } from './actions/context.ts';
import type { PieceEnregistree } from './pieces.ts';
import { pieceScellee } from './sceaux.ts';

/** Objet de frais visé par `piece.joindre`, après contrôle du droit d'y joindre une pièce : son salarié. */
export async function objetFraisVise(ctx: Ctx, objet: Extract<ObjetPiece, 'ligneFrais' | 'ligneFraisSante' | 'vehiculePerso'>, id: number): Promise<number> {
  // Même refus pour un objet inconnu et pour celui d'un autre : rien n'est révélé des frais d'autrui.
  const introuvable = () => new ActionError(`${OBJETS_PIECE[objet].label} : objet introuvable ou hors de votre périmètre`, 403);
  if (objet === 'vehiculePerso') {
    const v = await ctx.db.get<VehiculePerso>('vehiculesPerso', id);
    if (!v || !(isRh(ctx) || isSelf(ctx, v.empId))) throw introuvable();
    return v.empId;
  }
  const l = await ctx.db.get<LigneFrais>('lignesFrais', id);
  const n = l ? await ctx.db.get<NoteFrais>('notesFrais', l.noteId) : undefined;
  if (!l || !n || !(isRh(ctx) || isSelf(ctx, l.empId))) throw introuvable();
  // L'objet suit la note : justificatif de santé pour une note médicale, ordinaire sinon.
  if ((objet === 'ligneFraisSante') !== n.medicale) throw introuvable();
  if (noteArchivee(n, ctx.d.ti)) throw new ActionError(refusNoteArchivee(n.id), 409);
  if (!noteModifiable(n)) throw new ActionError('Note de frais soumise : ses justificatifs sont scellés, aucune pièce ne s’y ajoute', 409);
  return l.empId;
}

/** Refus du retrait d'une pièce de frais : scellée, ou jointe à une note déjà soumise. Rien pour une autre pièce. */
export async function refusRetraitFrais(ctx: Ctx, piece: PieceEnregistree): Promise<void> {
  if (piece.objet !== 'ligneFrais' && piece.objet !== 'ligneFraisSante') {
    if (piece.objet === 'vehiculePerso' && await pieceScellee(ctx.db, piece.id)) throw new ActionError('Pièce scellée : elle ne se retire plus', 409);
    return;
  }
  if (await pieceScellee(ctx.db, piece.id)) throw new ActionError('Justificatif scellé à la soumission de la note de frais : il ne se retire plus', 409);
  const l = piece.objetId ? await ctx.db.get<LigneFrais>('lignesFrais', piece.objetId) : undefined;
  const n = l ? await ctx.db.get<NoteFrais>('notesFrais', l.noteId) : undefined;
  if (n && noteArchivee(n, ctx.d.ti)) throw new ActionError(refusNoteArchivee(n.id), 409);
  if (n && !noteModifiable(n)) throw new ActionError('Note de frais soumise : ses justificatifs ne se retirent plus', 409);
}
