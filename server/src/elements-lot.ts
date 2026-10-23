// Registre des éléments de lot de paie (lot 6, chantier 2) : les familles d'éléments qu'un lot emporte en plus des
// feuilles de temps et des absences, chacune avec sa réservation par le lot, sa transmission à la confirmation de
// l'import et sa libération à l'annulation. Une seule liste (`FAMILLES`), lue par la génération et la transmission en un
// clic (server/src/actions/paie.ts), la confirmation et l'annulation du lot, l'export des variables de la période
// (server/src/variables-paie.ts) et le journal (salariés du lot). Contenu figé du lot : `contenu[cle]` ; identifiants
// des éléments réservés : `lot[cle]` (colonne de la table `lotsPaie`).
// - Soldes de sortie (t128, server/src/soldes-sortie.ts) : repris tels quels, sans changement de comportement — seules
//   les rubriques de sortie actives partent ; les autres sont listées « à saisir dans Sage » (`contenu.aSaisir`), puis
//   réglées hors fichier à la confirmation du lot de leur période.
// - Déplacements (t031, server/src/deplacements-paie.ts) : jours et nuits de grand déplacement, jours à l'étranger,
//   trajets ; sans rubrique active ou sans le réglage `deplacementsFichierPaie`, l'élément part dans le lot sans code Sage
//   (« à saisir dans Sage »), et ne repart plus une fois le lot confirmé.
// - Jours rachetés d'un forfait jours (t043, server/src/forfait-jours.ts) : avenants de renonciation, rubrique JREN ; comme
//   les déplacements, toujours réservés par le lot, sans code Sage faute de rubrique active (« à saisir dans Sage »), puis
//   réglés hors fichier à la confirmation de ce lot-là (d'après son contenu figé).
// - Astreintes (t049, lot 7, server/src/astreintes-paie.ts) : heures et périodes des astreintes terminées (AST_H, AST_PER) ;
//   comme les jours rachetés, toujours réservées par le lot, sans code Sage faute de rubrique active (« à saisir dans Sage »).
// Ajouter une famille (heures de nuit, monétisation du CET…) : un objet `FamilleLot` dans le fichier de son chantier, une
// ligne dans `FAMILLES`, une clé dans `SagePush` et `LotPaie` (shared/types.ts) et une colonne json de `lotsPaie`
// (server/src/db.ts). Liste « à saisir dans Sage » : shared/rules/elements-lot.ts.
import type { Domain } from '../../shared/domain.ts';
import { plural } from '../../shared/format.ts';
import type { CurrentUser, ElementASaisir, LotPaie, SagePush } from '../../shared/types.ts';
import { FAMILLE_ASTREINTES } from './astreintes-paie.ts';
import type { Db } from './db.ts';
import { FAMILLE_DEPLACEMENTS } from './deplacements-paie.ts';
import { FAMILLE_RACHATS } from './forfait-jours.ts';
import { FAMILLE_SORTIES } from './soldes-sortie.ts';

/** Élément d'une famille, tel que le lit le fichier : salarié, matricule, période, rubrique interne, code Sage (null : hors fichier). */
export interface ElementLot { empId: number; matricule: string; periode: string; rubrique: string; codeSage: string | null; quantite: number }

/** Clé d'une famille : clé du contenu figé (`SagePush`) et colonne du lot (`LotPaie`). */
export type CleFamille = 'sorties' | 'deplacements' | 'rachats' | 'astreintes';

export interface FamilleLot<E extends ElementLot = ElementLot> {
  cle: CleFamille;
  /** « solde de sortie », « soldes de sortie » : messages des actions. */
  libelles: [string, string];
  /** Avant le calcul des éléments du lot (premier lot d'une base neuve…) : suite du message, ou vide. */
  avant?: (db: Db, d: Domain, user: CurrentUser) => Promise<string>;
  /** Éléments d'un lot de la période `jusqua` (et des périodes antérieures). */
  aEmettre: (db: Db, d: Domain, jusqua: string) => Promise<E[]>;
  /** Éléments calculés que le lot n'emporte pas (rubrique désactivée) : listés « à saisir dans Sage ». */
  aSaisir: (db: Db, d: Domain, jusqua: string) => Promise<ElementASaisir[]>;
  /** Identifiants réservés par le lot (une fois chacun), gardés sur le lot après son annulation. */
  idsDuContenu: (elements: readonly E[]) => { id: number; empId: number }[];
  /** Réservation à la génération. */
  reserver: (db: Db, lotId: number, elements: readonly E[]) => Promise<void>;
  /** Confirmation de l'import : éléments transmis. */
  confirmer: (db: Db, d: Domain, lot: Pick<LotPaie, 'id' | 'periode'>) => Promise<void>;
  /** Annulation du lot avant sa confirmation : éléments de nouveau en attente. */
  liberer: (db: Db, lot: Pick<LotPaie, 'id'>) => Promise<void>;
}

/** Familles du registre, dans l'ordre du contenu et des messages. */
export const FAMILLES: readonly FamilleLot<any>[] = [FAMILLE_SORTIES, FAMILLE_DEPLACEMENTS, FAMILLE_RACHATS, FAMILLE_ASTREINTES];

/** Éléments de chaque famille pour un lot de la période `jusqua`, et ceux à saisir dans Sage. */
export interface ElementsFamilles { elements: Partial<Record<CleFamille, ElementLot[]>>; aSaisir: ElementASaisir[] }

/** Éléments des familles pour un lot de la période `jusqua` ; `avec` faux (lot « annule et remplace ») : aucun. */
export async function elementsDesFamilles(db: Db, d: Domain, jusqua: string, avec = true): Promise<ElementsFamilles> {
  if (!avec) return { elements: {}, aSaisir: [] };
  const elements: ElementsFamilles['elements'] = {};
  const aSaisir: ElementASaisir[] = [];
  for (const f of FAMILLES) {
    const l = await f.aEmettre(db, d, jusqua);
    if (l.length) elements[f.cle] = l;
    aSaisir.push(...await f.aSaisir(db, d, jusqua));
  }
  return { elements, aSaisir };
}

/** Suites du message de génération (premier lot d'une base neuve…), avant le calcul des éléments. */
export async function avantFamilles(db: Db, d: Domain, user: CurrentUser): Promise<string> {
  let texte = '';
  for (const f of FAMILLES) texte += (await f.avant?.(db, d, user)) ?? '';
  return texte;
}

/** Salariés des éléments des familles. */
export const salariesDesFamilles = (e: ElementsFamilles['elements']) => Object.values(e).flatMap(l => (l ?? []).map(x => x.empId));

/** Un élément au moins part dans le fichier (code Sage) : le lot n'est pas vide. */
export const elementsDansLeFichier = (e: ElementsFamilles['elements']) => Object.values(e).some(l => (l ?? []).some(x => x.codeSage));

/** Rubriques internes émises dans le fichier (code Sage à confirmer avant un lot réel). */
export const rubriquesDesFamilles = (e: ElementsFamilles['elements']) => Object.values(e).flatMap(l => (l ?? []).filter(x => x.codeSage).map(x => x.rubrique));

/** Contenu figé des familles : une clé par famille non vide, et la liste « à saisir dans Sage ». */
export function contenuDesFamilles(e: ElementsFamilles): Partial<Pick<SagePush, CleFamille | 'aSaisir'>> {
  return { ...e.elements, ...(e.aSaisir.length ? { aSaisir: e.aSaisir } : {}) } as Partial<Pick<SagePush, CleFamille | 'aSaisir'>>;
}

/** Identifiants réservés de chaque famille, à enregistrer sur le lot. */
export function idsDesFamilles(e: ElementsFamilles['elements']): Partial<Pick<LotPaie, CleFamille>> {
  const out: Record<string, unknown> = {};
  for (const f of FAMILLES) if (e[f.cle]?.length) out[f.cle] = f.idsDuContenu(e[f.cle]!);
  return out as Partial<Pick<LotPaie, CleFamille>>;
}

/** Réservation par le lot `lotId` des éléments de chaque famille. */
export async function reserverFamilles(db: Db, lotId: number, e: ElementsFamilles['elements']): Promise<void> {
  for (const f of FAMILLES) if (e[f.cle]?.length) await f.reserver(db, lotId, e[f.cle]!);
}

/** Confirmation de l'import du lot : chaque famille marque ses éléments transmis. */
export async function confirmerFamilles(db: Db, d: Domain, lot: Pick<LotPaie, 'id' | 'periode'>): Promise<void> {
  for (const f of FAMILLES) await f.confirmer(db, d, lot);
}

/** Annulation du lot : chaque famille libère ses éléments. */
export async function libererFamilles(db: Db, lot: Pick<LotPaie, 'id'>): Promise<void> {
  for (const f of FAMILLES) await f.liberer(db, lot);
}

/** « · 1 solde de sortie · 2 séjours (déplacements) · 3 éléments à saisir dans Sage » : fin du message de génération. */
export function texteFamilles(e: ElementsFamilles, aSaisir = e.aSaisir.length): string {
  const parts = FAMILLES.flatMap(f => {
    const n = e.elements[f.cle]?.length ? f.idsDuContenu(e.elements[f.cle]!).length : 0;
    return n ? [` · ${plural(n, ...f.libelles)}`] : [];
  });
  return parts.join('') + (aSaisir ? ` · ${plural(aSaisir, 'élément', 'éléments')} à saisir dans Sage (rubrique désactivée ou réglage décoché : voir le résumé du lot)` : '');
}

/** « et 1 solde de sortie libéré » : éléments réservés d'un lot annulé, en fin de message. */
export function texteLiberes(lot: Partial<Pick<LotPaie, CleFamille>>): string {
  return FAMILLES.flatMap(f => {
    const n = (lot[f.cle] ?? []).length;
    return n ? [` et ${plural(n, ...f.libelles)} ${n > 1 ? 'libérés' : 'libéré'}`] : [];
  }).join('');
}

/** Identifiants et salariés réservés d'un lot, par famille (résultat des actions, journal). */
export function resultatFamilles(lot: Partial<Pick<LotPaie, CleFamille>>): Partial<Record<CleFamille, { id: number; empId: number }[]>> {
  const out: Partial<Record<CleFamille, { id: number; empId: number }[]>> = {};
  for (const f of FAMILLES) if (lot[f.cle]?.length) out[f.cle] = lot[f.cle]!;
  return out;
}

/** Salariés des éléments réservés d'un lot (journal du téléchargement, export). */
export const salariesDuLotFamilles = (lot: Partial<Pick<LotPaie, CleFamille>>) => FAMILLES.flatMap(f => (lot[f.cle] ?? []).map(x => x.empId));
