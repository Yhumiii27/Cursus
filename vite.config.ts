import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.CURSUS_API_PORT || 3210);

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    // Nom d'hôte de la page transmis tel quel (comme le reverse proxy de production) : l'API refuse une requête qui
    // modifie si son origine n'est pas celle de Cursus (protection CSRF, server/src/securite.ts).
    proxy: { '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
});
