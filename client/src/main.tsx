import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Police Inter, sous-ensemble latin seulement (français compris : accents, œ, guillemets, espaces fines, €) : les
// sous-ensembles cyrillique, grec et vietnamien ne sont pas embarqués. Un caractère hors de ce sous-ensemble (flèche)
// s'affiche dans la police de repli du système.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './styles/nocturne.css';
import './styles/app.css';
import { App } from './App.tsx';
import { ErreurApplication, ErreurRendu } from './components/ErreurRendu.tsx';
import { StoreProvider } from './state/store.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      {/* Dernier recours (barre latérale, en-tête) : les pages et les dialogues ont leur propre limite. */}
      <ErreurRendu repli={(erreur, reessayer) => <ErreurApplication erreur={erreur} reessayer={reessayer} />}>
        <App />
      </ErreurRendu>
    </StoreProvider>
  </StrictMode>,
);
