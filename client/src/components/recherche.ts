// Recherche de collaborateurs au fil de la frappe (t152) : suggestions de la recherche de l'en-tête (layout/RechercheGlobale.tsx)
// et des listes de salariés des dialogues (components/ChoixCollaborateur.tsx). Filtrage côté client, dans le jeu de
// données déjà limité par le serveur au périmètre du rôle (server/src/dataset.ts) : aucune API. Même texte cherché que le
// filtre de Collaborateurs (`texteRecherche` de shared/format.ts : nom, poste, équipe, matricules), si bien que « Voir tous
// les résultats » montre dans l'annuaire exactement les personnes comptées.
// Logique sans React, testée sous Node (tests/ergonomie-listes.test.ts) : filtre, ordre, déplacement au clavier, raccourci.
import { norm, texteRecherche } from '../../../shared/format.ts';
import { sorti } from '../../../shared/rules/contrats.ts';
import type { Employe, ISODate, Role } from '../../../shared/types.ts';
import { comparerTexte } from './tri.ts';

/** Suggestions affichées au plus : au-delà, la personne précise sa recherche. */
export const MAX_SUGGESTIONS = 8;

type Cherchable = Parameters<typeof texteRecherche>[0];

/** Le collaborateur correspond-il à la recherche `q` (vide : tous) ? Le même contrôle que le filtre de Collaborateurs. */
export function correspond(e: Cherchable, q: string): boolean {
  const n = norm(q.trim());
  return !n || texteRecherche(e).includes(n);
}

/**
 * Suggestions pour la recherche `q` : d'abord les noms qui commencent par la recherche, puis ceux dont un mot commence
 * par elle (le nom de famille), puis les autres (poste, équipe, matricule) ; par ordre alphabétique dans chaque groupe.
 * `total` : nombre de collaborateurs qui correspondent, suggestions comprises.
 */
export function chercherCollaborateurs<T extends Cherchable>(emps: readonly T[], q: string, max = MAX_SUGGESTIONS): { suggestions: T[]; total: number } {
  const n = norm(q.trim());
  const rang = (e: T) => {
    if (!n) return 0;
    const nom = norm(e.nom);
    return nom.startsWith(n) ? 0 : nom.split(/[\s-]+/).some(m => m.startsWith(n)) ? 1 : 2;
  };
  const trouves = emps.filter(e => correspond(e, q)).map(e => ({ e, r: rang(e) }))
    .sort((a, b) => a.r - b.r || comparerTexte(a.e.nom, b.e.nom))
    .map(x => x.e);
  return { suggestions: trouves.slice(0, max), total: trouves.length };
}

/**
 * Option active après une flèche (`pas` : +1 vers le bas, -1 vers le haut) parmi `n` options : la première (ou la
 * dernière) depuis aucune, puis en boucle. -1 : aucune option.
 */
export function deplacer(actif: number, n: number, pas: 1 | -1): number {
  if (n <= 0) return -1;
  if (actif < 0 || actif >= n) return pas > 0 ? 0 : n - 1;
  return (actif + pas + n) % n;
}

/**
 * Raccourci qui place le curseur dans la recherche de l'en-tête : « / » hors d'un champ de saisie (comme sur la plupart
 * des sites), Ctrl+K ou Cmd+K partout. Jamais pendant un dialogue (l'appelant le vérifie).
 */
export function estRaccourciRecherche(ev: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, dansUnChamp: boolean): boolean {
  if (ev.altKey) return false;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') return true;
  return ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !dansUnChamp;
}

/**
 * Collaborateurs proposés par la recherche de l'en-tête : ceux de l'annuaire (salariés présents ; les sortis se
 * retrouvent par le filtre « Sortis »). Le manager ne s'y trouve pas lui-même : son équipe, consultation N+2 comprise,
 * est ce que le serveur lui envoie (`scopeIds`).
 */
export function perimetreRecherche(employes: readonly Employe[], role: Role, me: number | null, today: ISODate): Employe[] {
  return employes.filter(e => !sorti(e, today) && !(role === 'manager' && e.id === me));
}
