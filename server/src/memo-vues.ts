// Mémos des calculs de vue (lot 10, chantier A). Le profilage des vues sur le jeu de 5 ans (28 000 feuilles) montrait :
// - vue d'un manager : 0,3 à 0,4 s, dont 90 % pour l'indication « mineur » et « moins de 16 ans » de chaque feuille de
//   son équipe (`feuilleSansNaissance` de server/src/dataset.ts : sept jours, âge à chaque jour) ; vues des profils paie et
//   lecture seule : 2,2 à 3 s, pour la même indication sur toutes les feuilles ; recalculée à chaque révision, pour chaque
//   vue, alors que la feuille et la naissance du salarié n'ont pas changé ;
// - synthèse du C2P (`syntheseC2p`, toutes les feuilles validées) : 0,2 s, refaite pour chaque profil RH qui la reçoit
//   (service RH, référent HSE, lecture seule) sur le même instantané.
// Ces calculs sont purs : même entrée, même résultat. Les mémos ci-dessous gardent le résultat par identité des données
// partagées (jamais modifiées : gel en profondeur sous node --test) et par une clé de ce que le calcul lit d'autre ; le
// résultat rendu est le même objet pour toutes les vues, qui ne le modifient jamais. Aucune règle de shared/ ne change,
// seule la façon de ne pas refaire un calcul déjà fait. CURSUS_MEMO_VUES=0 les coupe (chaque vue recalcule tout, comme au
// lot 9) ; tests/memo-vues.test.ts compare les vues avec et sans mémo.

/** Calculs en cours sans mémo (`sansMemo`) : la référence de l'oracle. */
let sansMemos = 0;

/** Mémos actifs : CURSUS_MEMO_VUES vaut autre chose que « 0 », hors d'un calcul `sansMemo`. */
export const memoVuesActif = (env: Record<string, string | undefined> = process.env) => sansMemos === 0 && env.CURSUS_MEMO_VUES?.trim() !== '0';

/**
 * Calcul synchrone `f` sans aucun mémo (ni lu, ni rempli) : la lecture directe de l'oracle d'exactitude
 * (`buildSnapshot(…, { cache: false })`, scripts/charge/verifier.ts) calcule ainsi sa vue entièrement, pour que la
 * comparaison avec la vue servie par le cache juge aussi les mémos.
 */
export function sansMemo<T>(f: () => T): T {
  sansMemos++;
  try {
    return f();
  } finally {
    sansMemos--;
  }
}

/**
 * Résultats retenus par objet : une liste courte de couples (famille et clé, résultat), presque toujours d'un seul
 * élément (une feuille, une naissance), plus légère qu'une Map par objet.
 */
const parObjet = new WeakMap<object, [string, unknown][]>();

/** Calculs servis par un mémo (tests, mesures). */
export const MEMO = { servis: 0, calcules: 0 };

/**
 * Résultat de `calcul` pour l'objet partagé `o` et la clé `cle` (tout ce que le calcul lit en plus de `o`, sérialisé sans
 * ambiguïté) : calculé une fois, puis rendu tel quel tant que `o` vit. `famille` sépare les calculs différents sur un
 * même objet. Une clé nouvelle pour un objet (naissance corrigée) remplace la plus ancienne au-delà de quatre.
 */
export function memoParObjet<R>(famille: string, o: object, cle: string, calcul: () => R): R {
  if (!memoVuesActif()) return calcul();
  const k = `${famille}\u0000${cle}`;
  let l = parObjet.get(o);
  if (!l) parObjet.set(o, l = []);
  for (const [x, r] of l) if (x === k) { MEMO.servis++; return r as R; }
  MEMO.calcules++;
  const r = calcul();
  l.push([k, r]);
  if (l.length > 4) l.shift();
  return r;
}

/** Derniers résultats gardés par un mémo par identité des entrées (`memoParEntrees`). */
const GARDES = 4;

/**
 * Fonction mémoïsée par identité de ses entrées (`Object.is` sur chacune) : les `GARDES` derniers résultats sont gardés
 * (entrée en cours du cache et précédentes, profils qui calculent sur le même instantané).
 */
export function memoParEntrees<A extends readonly unknown[], R>(f: (...a: A) => R): (...a: A) => R {
  const gardes: { a: A; r: R }[] = [];
  return (...a: A) => {
    if (!memoVuesActif()) return f(...a);
    const trouve = gardes.find(g => g.a.length === a.length && g.a.every((x, i) => Object.is(x, a[i])));
    if (trouve) { MEMO.servis++; return trouve.r; }
    MEMO.calcules++;
    const r = f(...a);
    gardes.unshift({ a, r });
    if (gardes.length > GARDES) gardes.pop();
    return r;
  };
}
