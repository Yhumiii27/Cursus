// Solde de sortie (t128), côté serveur : photographie de l'état des compteurs à l'enregistrement de la sortie
// (`employe.sortie`, table `soldesSortie`), refaite à chaque modification de la sortie tant que le solde n'est pas parti
// à la paie, retirée par l'annulation de la sortie ; éléments d'un lot de paie (rubriques de sortie actives), libération
// à l'annulation du lot. Règles : shared/rules/solde-sortie.ts.
import type { Domain } from '../../shared/domain.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import { elementsSorties, etatSortie, resumeEtat } from '../../shared/rules/solde-sortie.ts';
import type { ElementSortiePaie, Employe, ISODate, LotPaie, RubriquePaie, SoldeSortie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { ActionError, type Ctx } from './actions/context.ts';

/** Solde photographié d'un salarié (un au plus). */
export const soldeDe = (db: Db, empId: number) => db.where<SoldeSortie>('soldesSortie', 'empId', empId)[0];

/**
 * Refus d'une modification ou d'une annulation de la sortie tant que son solde est dans un lot de paie dont l'import
 * n'est pas confirmé : le lot emporterait un solde qui ne vaut plus. Annuler le lot d'abord.
 */
export function controlerSoldeSortie(db: Db, emp: Employe) {
  const s = soldeDe(db, emp.id);
  if (s && s.lotId != null && !s.sage) {
    throw new ActionError(`Solde de sortie de ${emp.nom} compris dans le lot de paie n° ${s.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis modifiez ou annulez la sortie`, 409);
  }
}

/**
 * Photographie l'état des compteurs au `date`, calculé sur l'instantané d'avant la sortie (`etatSortie` annule de
 * lui-même les absences postérieures). Un solde déjà transmis à la paie est gardé tel quel : l'écart se corrige dans
 * Sage. Renvoie la suite du message de l'action et l'état retenu (journal : quantités seulement).
 */
export function photographierSortie(ctx: Ctx, emp: Employe, date: ISODate): { texte: string; solde: SoldeSortie } {
  const deja = soldeDe(ctx.db, emp.id);
  if (deja?.sage) {
    return { texte: `solde de sortie déjà transmis à la paie (lot n° ${deja.lotId}) : gardé tel quel, l’écart se corrige dans Sage`, solde: deja };
  }
  const ligne = { empId: emp.id, date, etat: etatSortie(ctx.d, emp, date), le: new Date().toISOString(), par: ctx.user.nom, lotId: null, sage: false };
  const solde = deja ? { ...deja, ...ligne } : ctx.db.insert<SoldeSortie>('soldesSortie', ligne);
  if (deja) ctx.db.update<SoldeSortie>('soldesSortie', deja.id, ligne);
  return { texte: `solde de sortie photographié : ${resumeEtat(solde.etat)}`, solde };
}

/**
 * Annulation de la sortie : le solde photographié est retiré, sauf s'il a été transmis à la paie (gardé pour l'historique ;
 * la correction se fait dans Sage). Renvoie la suite du message.
 */
export function retirerSoldeSortie(db: Db, emp: Employe): string {
  const s = soldeDe(db, emp.id);
  if (!s) return '';
  if (s.sage) return ` · solde de sortie déjà transmis à la paie (lot n° ${s.lotId}) : à corriger dans Sage`;
  db.remove('soldesSortie', s.id);
  return ' · solde de sortie photographié retiré';
}

/** Éléments de sortie d'un lot de la période `jusqua` : rubriques de sortie actives seulement. */
export function sortiesAEmettre(db: Db, d: Domain, jusqua: string): ElementSortiePaie[] {
  return elementsSorties(d, jusqua, rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie')));
}

/** Lot annulé : ses soldes de sortie redeviennent en attente. */
export function libererSorties(db: Db, lot: Pick<LotPaie, 'id'>) {
  db.sql.prepare('UPDATE soldes_sortie SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id);
}
