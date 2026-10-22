// Rendu des composants du client sous node --test (t159, étape 2), sans Vite ni navigateur : à importer en premier,
// avant tout module du client, par `await import('./outils/rendu.ts')`.
// - happy-dom (@happy-dom/global-registrator) pose un DOM global (window, document, événements) avant le chargement de
//   React : react-dom le détecte à son import ;
// - les .tsx du client sont compilés à la volée par le transformateur d'oxc fourni par rolldown (déjà installé avec
//   Vite, qui compile l'interface avec lui) : TypeScript retiré, JSX automatique (react/jsx-runtime) ;
// - client-node.ts fait le reste (magasin factice à la place de state/store.tsx, `*.css?url`) ; les feuilles de style
//   importées seules (`import './x.css'`) sont ignorées ;
// - @testing-library/react rend, cherche par rôle ou libellé, et clique ou saisit (fireEvent) dans le DOM de happy-dom.
// Exemple : tests/client-dialogues.test.ts.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { transformSync } from 'rolldown/utils';

if (!('happyDOM' in globalThis)) GlobalRegistrator.register({ url: 'http://localhost/', width: 1280, height: 800 });
// Rendus enveloppés dans act() par Testing Library : React le vérifie avec ce drapeau.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
    const fichier = fileURLToPath(url);
    const r = transformSync(fichier, readFileSync(fichier, 'utf8'), { lang: 'tsx', jsx: { runtime: 'automatic' }, sourcemap: true });
    if (r.errors.length) throw new Error(`${fichier} : ${r.errors.map(e => e.message).join(' ; ')}`);
    // Carte des sources jointe : la couverture du client (npm run test:client) compte les lignes du .tsx d'origine.
    const carte = r.map ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(r.map)).toString('base64')}` : '';
    return { format: 'module', source: r.code + carte, shortCircuit: true };
  },
});

await import('./client-node.ts');
