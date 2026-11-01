// Notes de frais du jeu de démonstration (lot 11, chantier C5), chargées par seedDemo (server/src/seed.ts) : module
// activé en démonstration seulement, barème kilométrique et limites d'exonération (montants de 2025 cités de mémoire par
// l'éclaireur, à vérifier sur urssaf.fr et au BOFiP : valeurs de démonstration, jamais des valeurs par défaut), un véhicule,
// des notes à chaque étape du circuit, dont une note de frais médicaux en attente du contrôle, et une avance demandée.
import type { Db } from './db.ts';

/** Barème kilométrique « voiture » de démonstration (d × a + b, par puissance et tranche de distance). */
const BAREME_VOITURE: readonly [number, number | null, [number, number, number, number, number]][] = [
  // cvMin, cvMax, [a jusqu'à 5 000 km, a et b de 5 001 à 20 000 km, a au-delà de 20 000 km, réservé]
  [0, 3, [0.529, 0.316, 1065, 0.37, 0]],
  [4, 4, [0.606, 0.34, 1330, 0.407, 0]],
  [5, 5, [0.636, 0.357, 1395, 0.427, 0]],
  [6, 6, [0.665, 0.374, 1457, 0.447, 0]],
  [7, null, [0.697, 0.394, 1515, 0.47, 0]],
];

/** Tranches du barème de démonstration pour une année. */
export function trancheDemo(annee: number) {
  return BAREME_VOITURE.flatMap(([cvMin, cvMax, [a1, a2, b2, a3]]) => [
    { annee, type: 'voiture', cvMin, cvMax, kmMin: 0, kmMax: 5000, a: a1, b: 0 },
    { annee, type: 'voiture', cvMin, cvMax, kmMin: 5001, kmMax: 20000, a: a2, b: b2 },
    { annee, type: 'voiture', cvMin, cvMax, kmMin: 20001, kmMax: null, a: a3, b: 0 },
  ]);
}

/** Limites d'exonération de démonstration (montants 2025, à vérifier) : repas, panier, grand déplacement. */
const FORFAITS: readonly [string, number][] = [
  ['repas_restaurant', 21.1], ['repas_hors_locaux', 10.3], ['panier', 7.3], ['gd_repas', 21.1], ['gd_logement_idf', 74.3], ['gd_logement_autres', 55.1],
];

export async function fraisDemo(db: Db): Promise<void> {
  const saisi = { saisiLe: '2026-09-01T08:00:00.000Z', saisiPar: 'Sandrine Vidal' };
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), notesFraisActives: true });
  for (const t of trancheDemo(2026)) await db.insert('baremesKm', { ...t, ...saisi });
  for (const [code, montant] of FORFAITS) await db.insert('forfaitsFrais', { annee: 2026, code, pays: null, montant, ...saisi });
  await db.insert('tauxDevises', { devise: 'MAD', mois: '2026-09', taux: 0.092, saisiLe: '2026-10-01T08:00:00.000Z', saisiPar: 'Sandrine Vidal' });
  // Véhicule de Mehdi Benali (5 CV, thermique), déclaré en janvier.
  const v = await db.insert<{ id: number }>('vehiculesPerso', { empId: 2, type: 'voiture', cv: 5, electrique: false, du: '2026-01-05', au: null, creeLe: '2026-01-05T09:00:00.000Z', creePar: 'Mehdi Benali' });
  const note = async (empId: number, periode: string, statut: string, o: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('notesFrais', {
    empId, periode, voyageId: null, missionId: null, projet: null, medicale: false, statut, creeLe: `${periode}-28T17:00:00.000Z`, creePar: 'Jeu de démonstration',
    soumiseLe: statut === 'brouillon' ? null : '2026-10-02T08:00:00.000Z', valideeLe: null, valideePar: null, controleeLe: null, controleePar: null,
    renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null, lotId: null, payeeLe: null, annuleeLe: null, annuleePar: null, annuleMotif: null, ...o,
  })).id;
  const ligne = async (noteId: number, empId: number, date: string, categorie: string, montant: number, o: Record<string, unknown> = {}) => await db.insert('lignesFrais', {
    noteId, empId, date, categorie, montant, devise: 'EUR', taux: null, montantEur: montant, tvaTaux: null, tvaMontant: null, commercant: null, forfait: null,
    km: null, vehiculeId: null, depart: null, arrivee: null, invites: null, motifDepassement: null, sansJustificatif: false, attestation: false, montantRetenu: null,
    refuseeLe: null, refusMotif: null, ...o,
  });
  // Mehdi Benali : note d'octobre en brouillon (repas, trajet en indemnités kilométriques), avance demandée.
  const n1 = await note(2, '2026-10', 'brouillon');
  await ligne(n1, 2, '2026-10-06', 'repas', 18.9, { commercant: 'Brasserie du Port', tvaTaux: 10, tvaMontant: 1.72 });
  await ligne(n1, 2, '2026-10-06', 'ik', 76.32, { km: 120, vehiculeId: v.id, depart: 'Site', arrivee: 'Chantier Marseille' });
  await db.insert('avancesFrais', { empId: 2, montant: 300, voyageId: null, missionId: null, statut: 'demandee', demandeLe: '2026-10-07T08:00:00.000Z', valideeLe: null, valideePar: null, lotId: null, verseeLe: null, annuleeLe: null, annuleePar: null, refusMotif: null });
  // Thomas Garnier : note de septembre soumise, à valider par Karim Haddad (hôtel et train).
  const n2 = await note(6, '2026-09', 'soumise');
  await ligne(n2, 6, '2026-09-22', 'hotel', 96, { commercant: 'Hôtel de la Gare', tvaTaux: 10, tvaMontant: 8.73, sansJustificatif: true, attestation: true });
  await ligne(n2, 6, '2026-09-22', 'train', 64.5, { commercant: 'SNCF', tvaTaux: 10, sansJustificatif: true, attestation: true });
  // Nadia Kaci : note de septembre validée par son manager, à contrôler ; repas d'affaires avec invités.
  const n3 = await note(9, '2026-09', 'validee', { valideeLe: '2026-10-05T10:00:00.000Z', valideePar: 'Jeu de démonstration' });
  await ligne(n3, 9, '2026-09-15', 'repas_affaires', 84, { commercant: 'Le Comptoir', invites: 'Deux acheteurs du client', tvaTaux: 10, sansJustificatif: true, attestation: true });
  // Clara Roussel : frais médicaux en mission (vaccin avant un départ), note séparée, en attente du contrôle sans manager.
  const n4 = await note(19, '2026-09', 'validee', { medicale: true });
  await ligne(n4, 19, '2026-09-10', 'medical', 35, { sansJustificatif: true, attestation: true });
}
