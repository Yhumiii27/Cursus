import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
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
