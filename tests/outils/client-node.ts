// Chargement des modules du client sous Node (node --test, sans Vite ni navigateur) : à importer avant eux.
// - `*.css?url` (feuille servie par Vite, client/src/print.ts) : remplacée par son chemin, une simple chaîne ;
// - client/src/state/store.tsx : le .tsx ne se charge pas sans compilation (Node n'enlève que les types) ; il est
//   remplacé par le magasin factice tests/outils/store-factice.ts, que le test remplit avec `poserMagasin`.
// Les hooks des modules (useMemo, useState…) se rendent avec react-dom/server (`rendreHook`) : un rendu sans DOM, où
// les effets ne s'exécutent pas ; leur logique est sortie dans des fonctions testées directement (components/media.ts,
// components/panneau.ts).
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const FACTICE = new URL('./store-factice.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/\.css\?url$/.test(specifier)) {
      const chemin = '/' + specifier.replace(/^.*\//, '').replace(/\?url$/, '');
      return { url: `data:text/javascript,export default ${encodeURIComponent(JSON.stringify(chemin))};`, shortCircuit: true };
    }
    if (/(^|\/)state\/store\.tsx$|^\.\/store\.tsx$/.test(specifier) && context.parentURL?.includes('/client/src/')) return { url: FACTICE, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/** Valeur renvoyée par le hook `hook` pendant un rendu React (sans DOM : les effets ne s'exécutent pas). */
export function rendreHook<T>(hook: () => T): T {
  let valeur: { v: T } | null = null;
  const Sonde = () => { valeur = { v: hook() }; return null; };
  renderToString(createElement(Sonde));
  if (!valeur) throw new Error('Hook non rendu');
  return (valeur as { v: T }).v;
}
