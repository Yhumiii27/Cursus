// Solde de sortie (t128), côté serveur : photographie de l'état des compteurs à l'enregistrement de la sortie
// (`employe.sortie`, table `soldesSortie`), refaite à chaque modification de la sortie tant que le solde n'est pas parti
// à la paie, retirée par l'annulation de la sortie ; une fois transmis, gardé tel quel pour la même date, remplacé (et
// gardé pour l'historique) par l'annulation de la sortie ou une autre date ; éléments d'un lot de paie (rubriques de
// sortie actives), libération à l'annulation du lot, réglé hors fichier à la confirmation du lot de sa période faute de
// rubrique active. Règles : shared/rules/solde-sortie.ts.
import type { Domain } from '../../shared/domain.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import { elementsSorties, etatSortie, resumeEtat, soldesHorsFichier, transmisTexte } from '../../shared/rules/solde-sortie.ts';
import { fmtIso } from '../../shared/format.ts';
import type { ElementSortiePaie, Employe, ISODate, LotPaie, RubriquePaie, SoldeSortie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { ActionError, type Ctx } from './actions/context.ts';

/** Solde photographié courant d'un salarié (un au plus) : les soldes transmis puis remplacés restent pour l'historique. */
export const soldeDe = async (db: Db, empId: number) => (await db.where<SoldeSortie>('soldesSortie', 'empId', empId)).find(s => !s.remplaceLe);

/** Solde transmis dont la sortie est annulée ou déplacée : gardé pour l'historique, il n'est plus le solde courant. */
const remplacer = async (db: Db, s: SoldeSortie) => await db.update<SoldeSortie>('soldesSortie', s.id, { remplaceLe: new Date().toISOString() });

/**
 * Refus d'une modification ou d'une annulation de la sortie tant que son solde est dans un lot de paie dont l'import
 * n'est pas confirmé : le lot emporterait un solde qui ne vaut plus. Annuler le lot d'abord.
 */
export async function controlerSoldeSortie(db: Db, emp: Employe) {
  const s = await soldeDe(db, emp.id);
  if (s && s.lotId != null && !s.sage) {
    throw new ActionError(`Solde de sortie de ${emp.nom} compris dans le lot de paie n° ${s.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis modifiez ou annulez la sortie`, 409);
  }
}

/**
 * Photographie l'état des compteurs au `date`, calculé sur l'instantané d'avant la sortie (`etatSortie` annule de
 * lui-même les absences postérieures). Un solde déjà transmis à la paie à la même date (motif modifié) est gardé tel
 * quel : l'écart se corrige dans Sage. À une autre date, il est remplacé (gardé pour l'historique, à régulariser dans
 * Sage) et un nouveau solde est photographié. Renvoie la suite du message de l'action et l'état retenu (journal :
 * quantités seulement).
 */
export async function photographierSortie(ctx: Ctx, emp: Employe, date: ISODate): Promise<{ texte: string; solde: SoldeSortie }> {
  let deja = await soldeDe(ctx.db, emp.id), avant = '';
  if (deja?.sage) {
    if (deja.date === date) return { texte: `solde de sortie déjà ${transmisTexte(deja)} : gardé tel quel, l’écart se corrige dans Sage`, solde: deja };
    await remplacer(ctx.db, deja);
    avant = `solde de sortie au ${fmtIso(deja.date)} ${transmisTexte(deja)} remplacé : à régulariser dans Sage · `;
    deja = undefined;
  }
  const ligne = { empId: emp.id, date, etat: etatSortie(ctx.d, emp, date), le: new Date().toISOString(), par: ctx.user.nom, lotId: null, sage: false, horsFichier: false, remplaceLe: null };
  const solde = deja ? { ...deja, ...ligne } : await ctx.db.insert<SoldeSortie>('soldesSortie', ligne);
  if (deja) await ctx.db.update<SoldeSortie>('soldesSortie', deja.id, ligne);
  return { texte: `${avant}solde de sortie photographié : ${resumeEtat(solde.etat)}`, solde };
}

/**
 * Annulation de la sortie : le solde photographié est retiré, sauf s'il a été transmis à la paie : il est alors remplacé
 * (gardé pour l'historique, la correction se fait dans Sage), et une nouvelle sortie photographiera un nouveau solde.
 * Renvoie la suite du message.
 */
export async function retirerSoldeSortie(db: Db, emp: Employe): Promise<string> {
  const s = await soldeDe(db, emp.id);
  if (!s) return '';
  if (s.sage) {
    await remplacer(db, s);
    return ` · solde de sortie déjà ${transmisTexte(s)} : gardé pour l’historique, à corriger dans Sage`;
  }
  await db.remove('soldesSortie', s.id);
  return ' · solde de sortie photographié retiré';
}

/** Éléments de sortie d'un lot de la période `jusqua` : rubriques de sortie actives seulement. */
export async function sortiesAEmettre(db: Db, d: Domain, jusqua: string): Promise<ElementSortiePaie[]> {
  return elementsSorties(d, jusqua, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie')));
}

/**
 * Confirmation d'un lot : les soldes de sa période (ou d'avant) qu'il n'emporte pas, faute de rubrique de sortie active,
 * sont réglés hors fichier (la paie les a saisis dans Sage) ; une rubrique activée ensuite ne les rattrape pas.
 */
export async function marquerHorsFichier(db: Db, d: Domain, lot: Pick<LotPaie, 'id' | 'periode'>) {
  for (const s of soldesHorsFichier(d, lot.periode, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie')))) {
    // Instantané du début de l'action : un solde réservé depuis (lot de simulation confirmé aussitôt) n'est pas touché.
    const x = await db.get<SoldeSortie>('soldesSortie', s.id);
    if (!x || x.lotId != null || x.sage) continue;
    await db.update<SoldeSortie>('soldesSortie', s.id, { lotId: lot.id, sage: true, horsFichier: true });
  }
}

/** Lot annulé : ses soldes de sortie redeviennent en attente. */
export async function libererSorties(db: Db, lot: Pick<LotPaie, 'id'>) {
  await db.run('UPDATE soldes_sortie SET lot_id = NULL WHERE lot_id = ? AND sage = FALSE', [lot.id]);
}
