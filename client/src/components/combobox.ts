// Logique du champ de choix d'un collaborateur (components/ChoixCollaborateur.tsx, t152), sans React : testée sous Node
// (tests/ergonomie-listes.test.ts). Règle : la valeur du champ ne désigne jamais une autre personne que celle que montre
// le texte. Un nom complet tapé choisit la personne ; une saisie partielle quittée sans choisir ne laisse pas partir
// l'ancien choix d'un champ obligatoire (le formulaire signale alors « Choisissez le collaborateur… »).
import { norm } from '../../../shared/format.ts';

/** Collaborateur que désigne le texte tapé : celui dont le libellé est ce texte (accents et casse ignorés), s'il est seul. */
export function designePar<T extends { id: number }>(emps: readonly T[], libelle: (e: T) => string, texte: string): T | null {
  const n = norm(texte.trim());
  if (!n) return null;
  const exacts = emps.filter(e => norm(libelle(e)) === n);
  return exacts.length === 1 ? exacts[0] : null;
}

/**
 * Option active après une frappe : la personne désignée par le nom complet (la liste reste filtrée, Entrée la confirme),
 * sinon la première suggestion ; aucune (-1) sans suggestion ou quand le champ vidé propose l'option « aucun » (`vide`).
 */
export function actifApresSaisie(options: readonly ({ id: number } | null)[], designe: number | null, texte: string, vide: boolean): number {
  if (designe != null) {
    const i = options.findIndex(e => e?.id === designe);
    if (i >= 0) return i;
  }
  if (!options.length || (vide && !texte.trim())) return -1;
  return 0;
}

/**
 * Ce que devient le champ quand on le quitte :
 * - `rien` : pas de frappe en cours ;
 * - `choisir` : la valeur devient `id` et le texte son libellé (nom complet tapé, champ vidé d'une liste qui admet « aucun ») ;
 * - `invalider` : champ obligatoire dont le texte ne désigne personne : la valeur passe à « aucun », le texte reste,
 *   et la vérification du formulaire le signale (jamais d'envoi pour la personne choisie avant) ;
 * - `restaurer` : filtre (le choix ne s'enregistre nulle part) : le texte revient au collaborateur choisi.
 */
export type Sortie = { type: 'rien' } | { type: 'choisir'; id: number | null } | { type: 'invalider' } | { type: 'restaurer' };

export function enQuittant({ saisi, texte, designe, vide, requis }: {
  saisi: boolean; texte: string; designe: number | null; vide: boolean; requis: boolean;
}): Sortie {
  if (!saisi) return { type: 'rien' };
  if (designe != null) return { type: 'choisir', id: designe };
  if (!texte.trim() && vide) return { type: 'choisir', id: null };
  return requis ? { type: 'invalider' } : { type: 'restaurer' };
}
