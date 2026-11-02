// lot 12 — C2 (notes de frais : activation) : historique des notes de frais à l'écran, sans React (components/frais/
// Historique.tsx ; tests/client-frais-historique.test.ts). L'instantané porte les notes payées depuis moins de 13 mois ; les
// plus anciennes se lisent à la demande (GET /api/frais/historique, 24 mois de dépenses au plus par recherche) :
// - « Notes plus anciennes » (Mes frais, onglet Notes du manager) : les 24 mois de dépenses qui précèdent la fenêtre, puis
//   les 24 d'avant à chaque « Mois précédents » ;
// - recherche du service RH et de la comptabilité (onglet « Historique », ?onglet=historique) : salarié, mois de début et
//   de fin, statut, ou numéro de note, contrôlés avant l'appel (la route refuse de toute façon).
import { addM } from '../../../../shared/dates.ts';
import { borneFrais, HISTORIQUE_FRAIS_MAX_MOIS, moisDe, moisEntre } from '../../../../shared/rules/frais-fenetre.ts';
import { STATUTS_NOTE_FRAIS } from '../../../../shared/rules/frais.ts';
import { periodeLabel } from '../../../../shared/rules/paie.ts';

/** Mois AAAA-MM décalé de `n` mois. */
const decaler = (mois: string, n: number) => addM(`${mois}-01`, n).slice(0, 7);

/**
 * Période des « notes plus anciennes » au jour `today` : `rang` 0, les 24 mois de dépenses jusqu'au mois de la borne de la
 * fenêtre (les notes payées avant elle sont des mois précédents) ; chaque rang recule de 24 mois.
 */
export function periodeAnciennes(today: string, rang = 0): { du: string; au: string } {
  const au = decaler(borneFrais(today).slice(0, 7), -HISTORIQUE_FRAIS_MAX_MOIS * rang);
  return { du: decaler(au, -(HISTORIQUE_FRAIS_MAX_MOIS - 1)), au };
}

/** Libellé d'une période : « juillet 2023 à juin 2025 ». */
export const libellePeriode = (p: { du: string; au: string }) => `${periodeLabel(p.du)} à ${periodeLabel(p.au)}`;

/** Saisie de la recherche (onglet Historique) : champs du formulaire, tels que tapés. */
export interface SaisieRecherche { empId: string; du: string; au: string; statut: string; note: string }
export const RECHERCHE_VIDE: SaisieRecherche = { empId: '', du: '', au: '', statut: '', note: '' };

/** Recherche prête pour la route, ou erreurs par champ (affichées sous chacun). */
export type Recherche =
  | { ok: true; note: number }
  | { ok: true; note: null; filtres: { empId: number | null; du: string; au: string; statut: string | null } }
  | { ok: false; erreurs: Partial<Record<keyof SaisieRecherche, string>> };

/**
 * Contrôle de la recherche au jour `today` : un numéro de note ouvre cette note seule ; sinon salarié facultatif, mois de
 * début et de fin (par défaut les 24 derniers mois), 24 mois au plus, statut facultatif.
 */
export function lireRecherche(s: SaisieRecherche, today: string): Recherche {
  const erreurs: Partial<Record<keyof SaisieRecherche, string>> = {};
  if (s.note.trim()) {
    const n = Number(s.note.trim());
    if (Number.isInteger(n) && n > 0) return { ok: true, note: n };
    return { ok: false, erreurs: { note: 'Numéro de note invalide.' } };
  }
  const au = s.au ? moisDe(s.au) : today.slice(0, 7);
  if (!au) erreurs.au = 'Mois invalide.';
  const du = s.du ? moisDe(s.du) : au && decaler(au, -(HISTORIQUE_FRAIS_MAX_MOIS - 1));
  if (!du) erreurs.du = 'Mois invalide.';
  if (du && au && du > au) erreurs.du = 'Le début suit la fin.';
  else if (du && au && moisEntre(du, au) > HISTORIQUE_FRAIS_MAX_MOIS) erreurs.du = `${HISTORIQUE_FRAIS_MAX_MOIS} mois au plus par recherche.`;
  if (s.statut && !Object.hasOwn(STATUTS_NOTE_FRAIS, s.statut)) erreurs.statut = 'Statut inconnu.';
  const empId = s.empId ? Number(s.empId) : null;
  if (empId !== null && !(Number.isInteger(empId) && empId > 0)) erreurs.empId = 'Salarié inconnu.';
  if (Object.keys(erreurs).length) return { ok: false, erreurs };
  return { ok: true, note: null, filtres: { empId, du: du!, au: au!, statut: s.statut || null } };
}
