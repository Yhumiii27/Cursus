// Notes de frais archivées du jeu d'essai (lot 12, chantier C2) : ajoutées au jeu de démonstration (10 octobre 2026, borne
// de la fenêtre au 10 septembre 2025), des notes payées de part et d'autre de la borne, avec dépenses et justificatifs,
// pour les tests de la fenêtre (lecture brute, delta, banc d'oracle), des lectures ciblées en base et de la route
// d'historique.
import type { Db } from '../../server/src/db.ts';
import { trancheDemo } from '../../server/src/frais-demo.ts';

/** Borne de la fenêtre au 10 octobre 2026 : une note payée avant cette date est archivée. */
export const BORNE_ESSAI = '2025-09-10';

export interface NotesArchivees {
  /** Mehdi Benali (2) : payée le 28 juillet 2025 (archivée) ; repas avec justificatif, trajet de 4 990 km. */
  archivee: number; repas: number; trajet: number; pieceRepas: number;
  /** Mehdi Benali : payée le jour de la borne, encore dans la fenêtre ; une dépense et un justificatif. */
  bord: number; ligneBord: number; pieceBord: number;
  /** Mehdi Benali : frais médicaux payés en juin 2025 (archivée), justificatif de santé. */
  medicale: number; ligneMedicale: number; pieceMedicale: number;
  /** Thomas Garnier (6) : payée en mai 2025 (archivée). */
  thomas: number;
  /** Nadia Kaci (9) : payée en avril 2025 (archivée), jamais exportée. */
  nadia: number;
  /** Véhicule de Mehdi Benali en 2025 (5 CV). */
  vehicule2025: number;
}

/** Ajoute les notes archivées au jeu de démonstration (et le barème kilométrique 2025). */
export async function notesArchivees(db: Db): Promise<NotesArchivees> {
  return await db.tx(async () => {
    for (const t of trancheDemo(2025)) await db.insert('baremesKm', { ...t, saisiLe: '2025-01-05T08:00:00.000Z', saisiPar: 'Essai' });
    const v = await db.insert<{ id: number }>('vehiculesPerso', { empId: 2, type: 'voiture', cv: 5, electrique: false, du: '2025-01-01', au: '2026-01-04', creeLe: '2025-01-02T08:00:00.000Z', creePar: 'Essai' });
    const note = async (empId: number, periode: string, payeeLe: string, o: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('notesFrais', {
      empId, periode, voyageId: null, missionId: null, projet: null, medicale: false, statut: 'payee', creeLe: `${periode}-28T17:00:00.000Z`, creePar: 'Essai',
      soumiseLe: `${periode}-28T17:00:00.000Z`, valideeLe: `${periode}-29T08:00:00.000Z`, valideePar: 'Karim Haddad', controleeLe: `${periode}-30T08:00:00.000Z`, controleePar: 'Manon Faure',
      renvoyeeLe: null, renvoyeePar: null, renvoiMotif: 'Motif ancien', lotId: null, payeeLe, annuleeLe: null, annuleePar: null, annuleMotif: null, ...o,
    })).id;
    const ligne = async (noteId: number, empId: number, date: string, categorie: string, montant: number, o: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('lignesFrais', {
      noteId, empId, date, categorie, montant, devise: 'EUR', taux: null, montantEur: montant, tvaTaux: null, tvaMontant: null, commercant: null, forfait: null,
      km: null, vehiculeId: null, depart: null, arrivee: null, invites: null, motifDepassement: null, sansJustificatif: false, attestation: false, montantRetenu: null,
      refuseeLe: null, refusMotif: null, ...o,
    })).id;
    let n = 0;
    const piece = async (empId: number, objet: string, objetId: number, empreinte: string) => (await db.insert<{ id: number }>('pieces', {
      jeton: null, empId, objet, objetId, nom: 'recu.pdf', type: 'application/pdf', taille: 3, empreinte, fichier: `archive-${objetId}-${++n}.bin`,
      deposeLe: '2025-06-20T08:00:00.000Z', deposePar: 'Essai', deposeCompteId: null,
    })).id;
    const archivee = await note(2, '2025-06', '2025-07-28');
    const repas = await ligne(archivee, 2, '2025-06-12', 'repas', 18.9, { commercant: 'Brasserie du Port', tvaTaux: 10 });
    const trajet = await ligne(archivee, 2, '2025-06-15', 'ik', 3173.64, { km: 4990, vehiculeId: v.id });
    const pieceRepas = await piece(2, 'ligneFrais', repas, 'empreinte-repas-2025');
    const bord = await note(2, '2025-08', BORNE_ESSAI);
    const ligneBord = await ligne(bord, 2, '2025-08-20', 'train', 42, { commercant: 'SNCF' });
    const pieceBord = await piece(2, 'ligneFrais', ligneBord, 'empreinte-train-2025');
    const medicale = await note(2, '2025-05', '2025-06-28', { medicale: true, valideeLe: null, valideePar: null });
    const ligneMedicale = await ligne(medicale, 2, '2025-05-10', 'medical', 35);
    const pieceMedicale = await piece(2, 'ligneFraisSante', ligneMedicale, 'empreinte-vaccin-2025');
    const thomas = await note(6, '2025-04', '2025-05-28');
    await ligne(thomas, 6, '2025-04-10', 'hotel', 96, { commercant: 'Hôtel de la Gare' });
    const nadia = await note(9, '2025-03', '2025-04-28');
    await ligne(nadia, 9, '2025-03-18', 'train', 64.5, { commercant: 'SNCF' });
    return { archivee, repas, trajet, pieceRepas, bord, ligneBord, pieceBord, medicale, ligneMedicale, pieceMedicale, thomas, nadia, vehicule2025: v.id };
  });
}
