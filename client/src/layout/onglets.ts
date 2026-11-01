// Barre d'onglets de l'application installée (lot 11, chantier C2, t196 ; layout/BarreOnglets.tsx) : entrées retenues,
// sans React (tests/client-pwa.test.ts).
import type { Icon } from '@phosphor-icons/react';
import type { View } from '../state/store.tsx';

export interface Onglet { view: View; label: string; icon: Icon; badge?: number }

/** Entrées de la barre : les quatre premières du menu de l'espace, dans l'ordre du menu (avec leurs pastilles). */
export const ongletsDe = (groupes: [string, Onglet[]][], n = 4): Onglet[] => groupes.flatMap(([, items]) => items).slice(0, n);
