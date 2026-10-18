// Solde de sortie (t128), côté serveur : photographie de l'état des compteurs à l'enregistrement de la sortie
// (`employe.sortie`, table `soldesSortie`), refaite à chaque modification de la sortie tant que le solde n'est pas parti
// à la paie, retirée par l'annulation de la sortie ; une fois transmis, gardé tel quel pour la même date, remplacé (et
// gardé pour l'historique) par l'annulation de la sortie ou une autre date ; éléments d'un lot de paie (rubriques de
// sortie actives), libération à l'annulation du lot, réglé hors fichier à la confirmation du lot de sa période faute de
// rubrique active. Règles : shared/rules/solde-sortie.ts. Famille « sorties » du registre des éléments de lot
// (server/src/elements-lot.ts, lot 6) : même comportement, les compteurs sans rubrique active étant de plus listés « à
// saisir dans Sage » dans le résumé du lot qui les réglera hors fichier.
import type { Domain } from '../../shared/domain.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import { detailSortie, elementsSorties, etatSortie, periodeSortie, quantitesSortie, resumeEtat, soldesHorsFichier, sortiesDuContenu, transmisTexte } from '../../shared/rules/solde-sortie.ts';
import { fmtIso } from '../../shared/format.ts';
import type { ElementASaisir, ElementSortiePaie, Employe, ISODate, LotPaie, RubriquePaie, SoldeSortie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { ActionError, type Ctx } from './actions/context.ts';
import type { FamilleLot } from './elements-lot.ts';

/** Solde photographié courant d'un salarié (un au plus) : les soldes transmis puis remplacés restent pour l'historique. */
export const soldeDe = (db: Db, empId: number) => db.where<SoldeSortie>('soldesSortie', 'empId', empId).find(s => !s.remplaceLe);

/** Solde transmis dont la sortie est annulée ou déplacée : gardé pour l'historique, il n'est plus le solde courant. */
const remplacer = (db: Db, s: SoldeSortie) => db.update<SoldeSortie>('soldesSortie', s.id, { remplaceLe: new Date().toISOString() });

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
 * lui-même les absences postérieures). Un solde déjà transmis à la paie à la même date (motif modifié) est gardé tel
 * quel : l'écart se corrige dans Sage. À une autre date, il est remplacé (gardé pour l'historique, à régulariser dans
 * Sage) et un nouveau solde est photographié. Renvoie la suite du message de l'action et l'état retenu (journal :
 * quantités seulement).
 */
export function photographierSortie(ctx: Ctx, emp: Employe, date: ISODate): { texte: string; solde: SoldeSortie } {
  let deja = soldeDe(ctx.db, emp.id), avant = '';
  if (deja?.sage) {
    if (deja.date === date) return { texte: `solde de sortie déjà ${transmisTexte(deja)} : gardé tel quel, l’écart se corrige dans Sage`, solde: deja };
    remplacer(ctx.db, deja);
    avant = `solde de sortie au ${fmtIso(deja.date)} ${transmisTexte(deja)} remplacé : à régulariser dans Sage · `;
    deja = undefined;
  }
  const ligne = { empId: emp.id, date, etat: etatSortie(ctx.d, emp, date), le: new Date().toISOString(), par: ctx.user.nom, lotId: null, sage: false, horsFichier: false, remplaceLe: null };
  const solde = deja ? { ...deja, ...ligne } : ctx.db.insert<SoldeSortie>('soldesSortie', ligne);
  if (deja) ctx.db.update<SoldeSortie>('soldesSortie', deja.id, ligne);
  return { texte: `${avant}solde de sortie photographié : ${resumeEtat(solde.etat)}`, solde };
}

/**
 * Annulation de la sortie : le solde photographié est retiré, sauf s'il a été transmis à la paie : il est alors remplacé
 * (gardé pour l'historique, la correction se fait dans Sage), et une nouvelle sortie photographiera un nouveau solde.
 * Renvoie la suite du message.
 */
export function retirerSoldeSortie(db: Db, emp: Employe): string {
  const s = soldeDe(db, emp.id);
  if (!s) return '';
  if (s.sage) {
    remplacer(db, s);
    return ` · solde de sortie déjà ${transmisTexte(s)} : gardé pour l’historique, à corriger dans Sage`;
  }
  db.remove('soldesSortie', s.id);
  return ' · solde de sortie photographié retiré';
}

/** Éléments de sortie d'un lot de la période `jusqua` : rubriques de sortie actives seulement. */
export function sortiesAEmettre(db: Db, d: Domain, jusqua: string): ElementSortiePaie[] {
  return elementsSorties(d, jusqua, rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie')));
}

/**
 * Confirmation d'un lot : les soldes de sa période (ou d'avant) qu'il n'emporte pas, faute de rubrique de sortie active,
 * sont réglés hors fichier (la paie les a saisis dans Sage) ; une rubrique activée ensuite ne les rattrape pas.
 */
export function marquerHorsFichier(db: Db, d: Domain, lot: Pick<LotPaie, 'id' | 'periode'>) {
  for (const s of soldesHorsFichier(d, lot.periode, rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie')))) {
    // Instantané du début de l'action : un solde réservé depuis (lot de simulation confirmé aussitôt) n'est pas touché.
    const x = db.get<SoldeSortie>('soldesSortie', s.id);
    if (!x || x.lotId != null || x.sage) continue;
    db.update<SoldeSortie>('soldesSortie', s.id, { lotId: lot.id, sage: true, horsFichier: true });
  }
}

/** Lot annulé : ses soldes de sortie redeviennent en attente. */
export function libererSorties(db: Db, lot: Pick<LotPaie, 'id'>) {
  db.sql.prepare('UPDATE soldes_sortie SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id);
}

/**
 * Compteurs des soldes en attente d'un lot de la période `jusqua` dont la rubrique de sortie est désactivée : le lot ne
 * les emporte pas, la paie les saisit dans Sage (liste « à saisir dans Sage » du résumé du lot). Intérimaires exclus.
 */
export function sortiesASaisir(db: Db, d: Domain, jusqua: string): ElementASaisir[] {
  const table = rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie'));
  const out: ElementASaisir[] = [];
  for (const s of d.ds.soldesSortie ?? []) {
    if (s.lotId != null || s.sage || s.remplaceLe) continue;
    const e = d.emp(s.empId);
    if (!e || d.contratOf(e).interim) continue;
    const periode = periodeSortie(s.date, d.ti, d.ds.settings?.clotureJour ?? 0);
    if (periode > jusqua) continue;
    for (const q of quantitesSortie(s.etat)) {
      if (!table.find(t => t.code === q.rubrique)?.active) out.push({ famille: 'sorties', empId: s.empId, periode, rubrique: q.rubrique, quantite: q.quantite, detail: detailSortie(s) });
    }
  }
  return out;
}

/** Famille du registre des éléments de lot : soldes de sortie (t128), comportement inchangé. */
export const FAMILLE_SORTIES: FamilleLot<ElementSortiePaie> = {
  cle: 'sorties',
  libelles: ['solde de sortie', 'soldes de sortie'],
  aEmettre: sortiesAEmettre,
  aSaisir: sortiesASaisir,
  idsDuContenu: sortiesDuContenu,
  reserver: (db, lotId, elements) => sortiesDuContenu(elements).forEach(x => db.update('soldesSortie', x.id, { lotId })),
  confirmer: (db, d, lot) => {
    db.sql.prepare('UPDATE soldes_sortie SET sage = 1 WHERE lot_id = ?').run(lot.id);
    // Soldes de sortie de la période sans rubrique active : saisis dans Sage, ils ne partiront plus dans un lot.
    marquerHorsFichier(db, d, lot);
  },
  liberer: libererSorties,
};
