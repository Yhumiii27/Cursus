// Notes de frais du jeu de charge (lot 11, chantier C5) : critère de fusion de l'étape 1 (relecture critique du lot 11) —
// avant d'activer le module (réglage `notesFraisActives`), mesurer l'instantané avec un volume de 3 ans de frais. Une
// note par salarié et par mois, 10 à 30 dépenses chacune (20 en moyenne : l'hypothèse haute de la relecture, 100
// salariés × 20 lignes × 36 mois), payées sauf les deux derniers mois ; un véhicule par salarié, quelques avances.
// Insertions en masse (`inserer`, comme les feuilles de la fabrique). Mesure : npm run charge:frais
// (scripts/charge/mesure-frais.ts).
// lot 12 — C2 (notes de frais : activation) : justificatifs simulés (une pièce par dépense hors indemnités kilométriques
// et allocations forfaitaires, soit environ 75 % des dépenses, sans fichier : seule la description pèse sur
// l'instantané), notes de frais médicaux (2 % des notes, une à trois dépenses « medical », justificatifs de santé),
// options `justificatifs` et `medicales` (vrai par défaut).
import { addD } from '../../shared/dates.ts';
import type { Db } from '../../server/src/db.ts';
import type { Aleatoire } from './commun.ts';
import type { InsererLignes } from './fabrique.ts';

const CATEGORIES = ['repas', 'repas', 'repas', 'hotel', 'train', 'taxi', 'carburant', 'peage', 'parking', 'divers', 'ik', 'forfait'];
const COMMERCANTS = ['Brasserie du Port', 'Hôtel de la Gare', 'SNCF', 'Taxi Bleu', 'Total Énergies', 'Vinci Autoroutes', 'Parking Indigo', 'Boulangerie Paul'];

export interface OptionsFrais {
  ans: number; lignesMin: number; lignesMax: number;
  // lot 12 — C2 : justificatifs des dépenses et notes de frais médicaux (vrais par défaut).
  justificatifs?: boolean; medicales?: boolean;
}

/** Ce que la fabrique des frais a posé : notes, dépenses, véhicules, avances, justificatifs (lot 12), notes médicales (lot 12). */
export interface JeuFrais { notes: number; lignes: number; vehicules: number; avances: number; pieces: number; medicales: number }

/** Part des notes de frais médicaux (lot 12 — C2). */
export const PART_MEDICALES = 0.02;

/** Mois AAAA-MM précédant `m` de `n` mois. */
const moisAvant = (m: string, n: number) => {
  const [a, mm] = m.split('-').map(Number), t = a * 12 + (mm - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * Peuple les notes de frais de `ans` années pour les salariés `empIds` présents (identifiants consécutifs attribués à
 * partir du plus grand de chaque table) ; `today` : jour de l'essai.
 */
export async function peuplerFrais(db: Db, r: Aleatoire, empIds: readonly number[], today: string, o: OptionsFrais, inserer: InsererLignes): Promise<JeuFrais> {
  const suivant = async (table: string) => Number((await db.one<{ n: number }>(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`))?.n ?? 0) + 1;
  let noteId = await suivant('notes_frais'), ligneId = await suivant('lignes_frais'), vehId = await suivant('vehicules_perso');
  const vehicules: unknown[][] = [], avances: unknown[][] = [];
  const vehiculeDe = new Map<number, number>();
  for (const e of empIds) {
    vehiculeDe.set(e, vehId);
    vehicules.push([vehId++, e, 'voiture', r.entre(3, 8), r.si(0.15), moisAvant(today.slice(0, 7), 12 * o.ans) + '-01', null, '2023-01-01T08:00:00.000Z', 'Essai de charge']);
    if (r.si(0.2)) avances.push([e, r.entre(1, 5) * 100, 'versee', '2026-01-05T08:00:00.000Z', '2026-01-31']);
  }
  await inserer('vehicules_perso', ['id', 'emp_id', 'type', 'cv', 'electrique', 'du', 'au', 'cree_le', 'cree_par'], vehicules);
  await inserer('avances_frais', ['emp_id', 'montant', 'statut', 'demande_le', 'versee_le'], avances);
  let notes = 0, lignes = 0, pieces = 0, medicales = 0;
  const avecPieces = o.justificatifs ?? true, avecMedicales = o.medicales ?? true;
  const mois = Array.from({ length: 12 * o.ans }, (_, i) => moisAvant(today.slice(0, 7), 12 * o.ans - i));
  for (const m of mois) {
    const n: unknown[][] = [], l: unknown[][] = [], p: unknown[][] = [];
    const recent = m >= moisAvant(today.slice(0, 7), 1);
    for (const e of empIds) {
      const statut = !recent ? 'payee' : r.choix(['brouillon', 'soumise', 'validee', 'controlee']);
      // lot 12 — C2 : note de frais médicaux (vaccin, consultation avant un départ), une à trois dépenses.
      const medicale = avecMedicales && r.si(PART_MEDICALES);
      if (medicale) medicales++;
      n.push([noteId, e, m, medicale, statut, `${m}-28T17:00:00.000Z`, 'Essai de charge', statut === 'brouillon' ? null : `${m}-28T17:00:00.000Z`, statut === 'payee' ? `${moisAvant(m, -1)}-28` : null]);
      for (let k = medicale ? r.entre(1, 3) : r.entre(o.lignesMin, o.lignesMax); k > 0; k--) {
        const categorie = medicale ? 'medical' : r.choix(CATEGORIES), date = addD(`${m}-01`, r.entre(0, 27)), montant = r.entre(500, 15000) / 100;
        // Justificatif : toute dépense hors indemnités kilométriques et allocations forfaitaires (description seule).
        if (avecPieces && categorie !== 'ik' && categorie !== 'forfait') {
          p.push([e, medicale ? 'ligneFraisSante' : 'ligneFrais', ligneId, `recu-${ligneId}.jpg`, 'image/jpeg', 180_000 + (ligneId % 50_000),
            `${String(ligneId).padStart(16, '0')}${'0'.repeat(48)}`, `charge-frais-${ligneId}.bin`, `${date}T19:00:00.000Z`, 'Essai de charge']);
        }
        l.push([ligneId++, noteId, e, date, categorie, montant, 'EUR', montant, categorie === 'ik' || categorie === 'forfait' ? null : 10,
          categorie === 'ik' || categorie === 'forfait' ? null : r.choix(COMMERCANTS), categorie === 'forfait' ? 'repas_restaurant' : null,
          categorie === 'ik' ? r.entre(10, 300) : null, categorie === 'ik' ? vehiculeDe.get(e)! : null, false, false]);
      }
      noteId++;
      notes++;
    }
    await inserer('notes_frais', ['id', 'emp_id', 'periode', 'medicale', 'statut', 'cree_le', 'cree_par', 'soumise_le', 'payee_le'], n);
    await inserer('lignes_frais', ['id', 'note_id', 'emp_id', 'date', 'categorie', 'montant', 'devise', 'montant_eur', 'tva_taux', 'commercant', 'forfait', 'km', 'vehicule_id', 'sans_justificatif', 'attestation'], l);
    if (p.length) await inserer('pieces', ['emp_id', 'objet', 'objet_id', 'nom', 'type', 'taille', 'empreinte', 'fichier', 'depose_le', 'depose_par'], p);
    lignes += l.length;
    pieces += p.length;
  }
  return { notes, lignes, vehicules: vehicules.length, avances: avances.length, pieces, medicales };
}
