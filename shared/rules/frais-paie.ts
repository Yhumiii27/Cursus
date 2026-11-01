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
// avances versées et notes du même séjour (déplacement, mission, ou aucun), dans l'ordre de leurs identifiants.
import type { Domain } from '../domain.ts';
import type { AvanceFrais, ElementFraisPaie, LigneFrais, NoteFrais } from '../types.ts';
import { lignesDe, montantRetenu, r2 } from './frais.ts';
import { cumulKm, ikDuTrajet, lignesIkDeLAnnee } from './frais-km.ts';
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

/** Indemnité au barème plafonné à 7 CV d'une ligne kilométrique (limite d'exonération), d'après le cumul de l'année. */
export function limiteIkDe(d: Pick<Domain, 'ds'>, l: LigneFrais): number | null {
  const veh = (d.ds.vehiculesPerso ?? []).find(v => v.id === l.vehiculeId);
  if (!veh) return null;
  const annee = Number(l.date.slice(0, 4));
  const autres = lignesIkDeLAnnee(d.ds.lignesFrais ?? [], d.ds.notesFrais ?? [], l.empId, annee);
  return ikDuTrajet(d.ds.referentiels.baremesKm, annee, veh, cumulKm(autres, l), l.km ?? 0);
}

/**
 * Avances imputées sur chaque note (montant positif, à déduire) : pour chaque séjour, solde des avances versées ou en
 * cours de versement, imputé sur les notes contrôlées, en paiement ou payées du même séjour, dans l'ordre des identifiants.
 */
export function imputationsAvances(notes: readonly NoteFrais[], avances: readonly AvanceFrais[], total: (n: NoteFrais) => number): Map<number, number> {
  const solde = new Map<string, number>();
  for (const a of avances) if (a.statut === 'versee' || a.statut === 'en_paiement') solde.set(cleSejourFrais(a), r2((solde.get(cleSejourFrais(a)) ?? 0) + a.montant));
  const out = new Map<number, number>();
  for (const n of [...notes].sort((a, b) => a.id - b.id)) {
    if (n.statut !== 'controlee' && n.statut !== 'en_paiement' && n.statut !== 'payee') continue;
    const k = cleSejourFrais(n), s = solde.get(k) ?? 0;
    if (s <= 0) continue;
    const imp = r2(Math.min(s, total(n)));
    if (imp > 0) { out.set(n.id, imp); solde.set(k, r2(s - imp)); }
  }
  return out;
}

/**
 * Éléments de la famille « frais » d'un lot de la période `jusqua` : notes contrôlées et avances validées pas encore dans
 * un lot (le prochain lot généré les emporte : paie du mois suivant le contrôle), à la période du lot, avec le code Sage
 * de leur rubrique active (null : à saisir dans Sage).
 */
export function elementsFrais(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[]): ElementFraisPaie[] {
  const code = (rubrique: string) => { const r = table.find(t => t.code === rubrique); return r?.active ? r.codeSage : null; };
  const notes = d.ds.notesFrais ?? [], avances = d.ds.avancesFrais ?? [];
  const parts = new Map(notes.filter(n => n.statut !== 'annulee').map(n => [n.id, partsNote(d, n, l => limiteIkDe(d, l))]));
  const imputees = imputationsAvances(notes, avances, n => parts.get(n.id)?.total ?? 0);
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
