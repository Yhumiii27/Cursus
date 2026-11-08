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
import { Declarer } from './pages/Declarer.tsx';
import { ErreurApplication, ErreurRendu } from './components/ErreurRendu.tsx';
import { StoreProvider } from './state/store.tsx';
import { demarrerPwa } from './pwa/enregistrement.ts';

// Application installable (lot 11) : service worker en contexte sécurisé, installation, raccourcis du manifeste ; relevé
// avant le premier rendu (l'adresse de lancement est réécrite ensuite par le magasin).
if (!location.pathname.startsWith('/declarer/')) demarrerPwa();

// lot 14 — page publique de pré-déclaration (`/declarer/<jeton>`) : entreprise extérieure ou agence d'intérim, sans compte ;
// rendue seule, sans le magasin (ni session, ni instantané, ni service worker à installer pour elle).
const declaration = /^\/declarer\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);

createRoot(document.getElementById('root')!).render(declaration ? (
  <StrictMode>
    <Declarer jeton={declaration[1]} />
  </StrictMode>
) : (
  <StrictMode>
    <StoreProvider>
      {/* Dernier recours (barre latérale, en-tête) : les pages et les dialogues ont leur propre limite. */}
      <ErreurRendu repli={(erreur, reessayer) => <ErreurApplication erreur={erreur} reessayer={reessayer} />}>
        <App />
      </ErreurRendu>
    </StoreProvider>
  </StrictMode>
));
