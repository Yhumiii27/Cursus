// Magasin factice qui remplace client/src/state/store.tsx sous Node (tests/outils/client-node.ts) : `useStore` et
// `useData` renvoient ce que le test a posé avec `poserMagasin` (données d'un instantané, état de l'interface, `run`
// espionné). Aucun hook React ici : seuls les modules testés en appellent.
import type { Store } from '../../client/src/state/store.tsx';

let courant: Partial<Store> | null = null;

/** Pose le magasin que verront les modules du client (null : aucun, comme hors de <StoreProvider>). */
export function poserMagasin(s: Partial<Store> | null) { courant = s; }

export function useStore(): Store {
  if (!courant) throw new Error('useStore hors de <StoreProvider>');
  return courant as Store;
}

export function useData(): NonNullable<Store['data']> {
  const { data } = useStore();
  if (!data) throw new Error('Données non chargées');
  return data;
}
