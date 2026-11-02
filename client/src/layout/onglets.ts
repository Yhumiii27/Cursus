// Barre d'onglets de l'application installée (lot 11, chantier C2, t196 ; layout/BarreOnglets.tsx) : entrées retenues,
// sans React (tests/client-pwa.test.ts).
import type { Icon } from '@phosphor-icons/react';
import type { View } from '../state/store.tsx';

export interface Onglet { view: View; label: string; icon: Icon; badge?: number }

/**
 * Vues gardées dans la barre quoi que le menu ajoute avant elles (lot 12 : objectifs, avis, frais… s'insèrent dans « Mon
 * espace ») : l'accueil, les heures et les absences, usages quotidiens de l'application installée.
 */
const PRIORITAIRES: readonly View[] = ['portail', 'dashboard', 'temps', 'absences'];

/**
 * Entrées de la barre : les vues prioritaires présentes dans le menu, puis les premières autres entrées, jusqu'à quatre ;
 * toujours dans l'ordre du menu (avec leurs pastilles).
 */
export function ongletsDe(groupes: [string, Onglet[]][], n = 4): Onglet[] {
  const tous = groupes.flatMap(([, items]) => items);
  const prioritaires = tous.filter(o => PRIORITAIRES.includes(o.view)).slice(0, n);
  const retenus = new Set([...prioritaires, ...tous.filter(o => !prioritaires.includes(o)).slice(0, n - prioritaires.length)]);
  return tous.filter(o => retenus.has(o));
}
