// Remboursement des notes de frais par la paie (lot 11, chantier C5) : éléments de la famille « frais » d'un lot de paie
// (server/src/frais-paie.ts, registre server/src/elements-lot.ts). Réponse du propriétaire du 31 octobre 2026 :
// remboursement avec la paie du mois suivant, montant dans une colonne « montant » du fichier Sage, rubriques inactives
// « à saisir dans Sage » tant que la paie n'a pas confirmé ses codes.
// Pour chaque note contrôlée et pas encore dans un lot, en euros, à la période du lot :
// - FRAIS_REMB : frais réels retenus (frais médicaux compris, sous la même rubrique : rien ne les distingue) ;
// - FRAIS_IK : indemnités kilométriques dans la limite du barème plafonné ; FRAIS_FORFAIT : allocations forfaitaires dans
//   la limite d'exonération de l'année (limite non saisie : tout en FRAIS_FORFAIT, l'alerte est au contrôle) ;
// - FRAIS_REINT : part des allocations au-delà de ces limites, soumise à cotisations (jamais un frais réel) ;
// - FRAIS_AVANCE_DED : avance versée imputée sur la note (montant négatif), jusqu'à épuisement de son solde ;
// et pour chaque avance validée pas encore dans un lot : FRAIS_AVANCE (versement). Imputation calculée, jamais stockée :
// avances du même séjour (déplacement, mission, ou aucun) versées, en paiement ou versées par ce lot, moins les déductions
// déjà transmises par les lots non annulés (lues dans leur contenu figé), imputées sur les notes de ce lot seulement, dans
// l'ordre de leurs identifiants. Une note payée sans déduction n'en reçoit jamais après coup (relecture du lot 11).
import type { Domain } from '../domain.ts';
import type { AvanceFrais, ElementFraisPaie, LigneFrais, NoteFrais } from '../types.ts';
import { lignesDe, montantRetenu, notePayee, r2 } from './frais.ts';
import { indemnitesIkAnnee, lignesIkDeLAnnee } from './frais-km.ts';
import { limiteForfait } from './frais-politique.ts';
import { matriculeAffiche } from './matricules.ts';
import type { RubriqueVue } from './paie.ts';

/** Rubriques internes des frais (RUBRIQUES_PAIE), dans l'ordre du lot. */
export const RUBRIQUES_FRAIS = ['FRAIS_REMB', 'FRAIS_IK', 'FRAIS_FORFAIT', 'FRAIS_REINT', 'FRAIS_AVANCE', 'FRAIS_AVANCE_DED'] as const;

/** Séjour d'une note ou d'une avance : déplacement, mission, ou aucun. */
export const cleSejourFrais = (x: Pick<NoteFrais, 'empId' | 'voyageId' | 'missionId'>) => `${x.empId}|${x.voyageId ? `v${x.voyageId}` : x.missionId ? `m${x.missionId}` : '-'}`;

/** Parts d'une note, en euros : réels, indemnités et forfaits exonérés, part réintégrable, total remboursé. */
export interface PartsNote { reels: number; ik: number; forfaits: number; reintegrable: number; total: number }

/**
 * Parts d'une note (lignes en vigueur, montants retenus). `limiteIk` : indemnité au barème plafonné d'une ligne (null :
 * barème absent, la ligne compte en entier) ; limites des forfaits lues dans `ds.referentiels.forfaitsFrais`.
 */
export function partsNote(d: Pick<Domain, 'ds'>, n: NoteFrais, limiteIk: (l: LigneFrais) => number | null): PartsNote {
  let reels = 0, ik = 0, forfaits = 0, reintegrable = 0;
  for (const l of lignesDe(d.ds.lignesFrais, n.id)) {
    const m = montantRetenu(l);
    if (!m) continue;
    if (l.categorie === 'ik' || l.categorie === 'forfait') {
      const limite = l.categorie === 'ik' ? limiteIk(l) : limiteForfait(d.ds.referentiels.forfaitsFrais, Number(l.date.slice(0, 4)), l.forfait);
      const exonere = limite === null ? m : Math.min(m, limite);
      if (l.categorie === 'ik') ik += exonere; else forfaits += exonere;
      reintegrable += m - exonere;
    } else reels += m;
  }
  return { reels: r2(reels), ik: r2(ik), forfaits: r2(forfaits), reintegrable: r2(reintegrable), total: r2(reels + ik + forfaits + reintegrable) };
}

/** Lignes kilométriques transmises à la paie (note en paiement ou payée) et leur montant remboursé, en euros. */
export function ikTransmises(lignesAnnee: readonly LigneFrais[], notes: readonly Pick<NoteFrais, 'id' | 'statut'>[]): Map<number, number> {
  const payees = new Set(notes.filter(notePayee).map(n => n.id));
  return new Map(lignesAnnee.filter(l => payees.has(l.noteId)).map(l => [l.id, montantRetenu(l)]));
}

/**
 * Limite d'exonération des lignes kilométriques (barème à la puissance plafonnée, cumul ordonné de l'année recalculé :
 * `indemnitesIkAnnee`), mémorisée par salarié et par année ; null : barème absent ou véhicule inconnu.
 */
export function limitesIk(d: Pick<Domain, 'ds'>): (l: LigneFrais) => number | null {
  const memo = new Map<string, Map<number, number | null>>();
  return l => {
    const annee = Number(l.date.slice(0, 4)), cle = `${l.empId}|${annee}`;
    let m = memo.get(cle);
    if (!m) {
      const lignes = lignesIkDeLAnnee(d.ds.lignesFrais ?? [], d.ds.notesFrais ?? [], l.empId, annee);
      m = indemnitesIkAnnee(d.ds.referentiels.baremesKm, annee, (d.ds.vehiculesPerso ?? []).filter(v => v.empId === l.empId), lignes, ikTransmises(lignes, d.ds.notesFrais ?? []), { limite: true });
      memo.set(cle, m);
    }
    return m.get(l.id) ?? null;
  };
}

/** Indemnité au barème plafonné à 7 CV d'une ligne kilométrique (limite d'exonération), d'après le cumul ordonné de l'année. */
export const limiteIkDe = (d: Pick<Domain, 'ds'>, l: LigneFrais): number | null => limitesIk(d)(l);

/**
 * Avances imputées sur chaque note de ce lot (montant positif, à déduire) : pour chaque séjour, solde des avances versées,
 * en cours de versement ou versées par ce lot (validées, pas encore dans un lot), moins les déductions déjà transmises
 * (`transmises` : note → montant déduit par un lot non annulé), imputé sur les notes contrôlées pas encore dans un lot du
 * même séjour, dans l'ordre des identifiants. Une note déjà payée ne consomme jamais le solde a posteriori.
 */
export function imputationsAvances(notes: readonly NoteFrais[], avances: readonly AvanceFrais[], total: (n: NoteFrais) => number,
  transmises: ReadonlyMap<number, number> = new Map()): Map<number, number> {
  const solde = new Map<string, number>();
  const crediter = (k: string, m: number) => solde.set(k, r2((solde.get(k) ?? 0) + m));
  for (const a of avances) if (a.statut === 'versee' || a.statut === 'en_paiement' || (a.statut === 'validee' && !a.lotId)) crediter(cleSejourFrais(a), a.montant);
  const parId = new Map(notes.map(n => [n.id, n]));
  for (const [id, m] of transmises) { const n = parId.get(id); if (n) crediter(cleSejourFrais(n), -m); }
  const out = new Map<number, number>();
  for (const n of [...notes].sort((a, b) => a.id - b.id)) {
    if (n.statut !== 'controlee' || n.lotId) continue;
    const k = cleSejourFrais(n), s = solde.get(k) ?? 0;
    if (s <= 0) continue;
    const imp = r2(Math.min(s, total(n)));
    if (imp > 0) { out.set(n.id, imp); solde.set(k, r2(s - imp)); }
  }
  return out;
}

/** Déductions d'avance transmises par des lots (contenu figé) : note → montant déduit, positif. */
export function deductionsDuContenu(elements: readonly Pick<ElementFraisPaie, 'note' | 'rubrique' | 'montant'>[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const x of elements) if (x.note && x.rubrique === 'FRAIS_AVANCE_DED') out.set(x.note, r2((out.get(x.note) ?? 0) - x.montant));
  return out;
}

/**
 * Éléments de la famille « frais » d'un lot de la période `jusqua` : notes contrôlées et avances validées pas encore dans
 * un lot (le prochain lot généré les emporte : paie du mois suivant le contrôle), à la période du lot, avec le code Sage
 * de leur rubrique active (null : à saisir dans Sage). `transmises` : déductions d'avance des lots non annulés
 * (`deductionsDuContenu`).
 */
export function elementsFrais(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[],
  transmises: ReadonlyMap<number, number> = new Map()): ElementFraisPaie[] {
  const code = (rubrique: string) => { const r = table.find(t => t.code === rubrique); return r?.active ? r.codeSage : null; };
  const notes = d.ds.notesFrais ?? [], avances = d.ds.avancesFrais ?? [];
  const limites = limitesIk(d);
  const parts = new Map(notes.filter(n => n.statut === 'controlee' && !n.lotId).map(n => [n.id, partsNote(d, n, limites)]));
  const imputees = imputationsAvances(notes, avances, n => parts.get(n.id)?.total ?? 0, transmises);
  const out: ElementFraisPaie[] = [];
  const ajouter = (x: Omit<ElementFraisPaie, 'matricule' | 'periode' | 'codeSage' | 'quantite'>) => {
    const e = d.emp(x.empId);
    if (!e || !x.montant) return;
    out.push({ ...x, matricule: matriculeAffiche(e), periode: jusqua, codeSage: code(x.rubrique), quantite: 1, montant: r2(x.montant) });
  };
  for (const n of notes) {
    if (n.statut !== 'controlee' || n.lotId) continue;
    const p = parts.get(n.id)!;
    const base = { note: n.id, avance: null, empId: n.empId };
    ajouter({ ...base, rubrique: 'FRAIS_REMB', montant: p.reels });
    ajouter({ ...base, rubrique: 'FRAIS_IK', montant: p.ik });
    ajouter({ ...base, rubrique: 'FRAIS_FORFAIT', montant: p.forfaits });
    ajouter({ ...base, rubrique: 'FRAIS_REINT', montant: p.reintegrable });
    ajouter({ ...base, rubrique: 'FRAIS_AVANCE_DED', montant: -(imputees.get(n.id) ?? 0) });
  }
  for (const a of avances) {
    if (a.statut !== 'validee' || a.lotId) continue;
    ajouter({ note: null, avance: a.id, empId: a.empId, rubrique: 'FRAIS_AVANCE', montant: a.montant });
  }
  return out;
}

/** Notes et avances réservées par un lot (une fois chacune). */
export function fraisDuContenu(elements: readonly ElementFraisPaie[]): { id: number; empId: number; avance?: true }[] {
  const vus = new Set<string>(), out: { id: number; empId: number; avance?: true }[] = [];
  for (const x of elements) {
    const k = x.note ? `n${x.note}` : `a${x.avance}`;
    if (vus.has(k)) continue;
    vus.add(k);
    out.push(x.note ? { id: x.note, empId: x.empId } : { id: x.avance!, empId: x.empId, avance: true });
  }
  return out;
}
