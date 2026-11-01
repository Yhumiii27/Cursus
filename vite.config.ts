import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.CURSUS_API_PORT || 3210);

/**
 * Service worker (lot 11, chantier C2 : client/public/sw.js, écrit à la main) : au build, la version et la liste des
 * fichiers /assets à précharger y sont injectées, sans dépendance (ni Workbox ni vite-plugin-pwa). La version est
 * l'empreinte des noms de fichiers hachés : elle change avec tout fichier de l'interface, ce qui déclenche la mise à jour
 * (bandeau « Nouvelle version »). Les polices au format WOFF (repli des navigateurs sans WOFF2, qui n'ont pas non plus de
 * service worker) ne sont pas préchargées. Le fichier produit remplace la copie de client/public/ dans dist/.
 */
export function swCursus(source = new URL('./client/public/sw.js', import.meta.url)): Plugin {
  return {
    name: 'cursus-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const fichiers = Object.keys(bundle).filter(f => f.startsWith('assets/') && !f.endsWith('.woff')).sort().map(f => `/${f}`);
      const version = createHash('sha256').update(fichiers.join('\n')).digest('hex').slice(0, 12);
      const texte = readFileSync(source, 'utf8');
      const marques = [/const VERSION = 'dev'; \/\/ __CURSUS_VERSION__/, /const PRECHARGE = \[\]; \/\/ __CURSUS_PRECHARGE__/];
      if (!marques.every(m => m.test(texte))) this.error('client/public/sw.js : marques __CURSUS_VERSION__ et __CURSUS_PRECHARGE__ introuvables');
      const sw = texte.replace(marques[0], `const VERSION = '${version}';`).replace(marques[1], `const PRECHARGE = ${JSON.stringify(fichiers)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), swCursus()],
  server: {
    port: 5173,
    // Nom d'hôte de la page transmis tel quel (comme le reverse proxy de production) : l'API refuse une requête qui
    // modifie si son origine n'est pas celle de Cursus (protection CSRF, server/src/securite.ts).
    proxy: { '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Seuil d'avertissement par défaut (500 Ko) : pages chargées à la demande (client/src/App.tsx), React et les icônes
    // dans leurs propres fichiers, qui changent rarement et restent en cache d'une version à l'autre.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/node_modules[\\/]@phosphor-icons[\\/]/.test(id)) return 'icones';
        },
      },
    },
  },
});
