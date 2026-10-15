// Aiguillage des écrans selon la vue courante et l'espace (RH, manager, collaborateur).
// Une erreur de rendu de la page n'emporte ni la barre latérale ni le dialogue ouvert (ErreurRendu).
import type { ReactElement } from 'react';
import { ErreurPage, ErreurRendu } from './components/ErreurRendu.tsx';
import { DialogHost } from './dialogs/DialogHost.tsx';
import { Shell } from './layout/Shell.tsx';
import { Absences } from './pages/Absences.tsx';
import { Budget } from './pages/Budget.tsx';
import { Chantiers } from './pages/Chantiers.tsx';
import { Collaborateurs } from './pages/Collaborateurs.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Echeances } from './pages/Echeances.tsx';
import { Entretiens } from './pages/Entretiens.tsx';
import { Equipes } from './pages/Equipes.tsx';
import { Formations } from './pages/Formations.tsx';
import { Habilitations } from './pages/Habilitations.tsx';
import { Login } from './pages/Login.tsx';
import { Missions } from './pages/Missions.tsx';
import { MotDePasse } from './pages/MotDePasse.tsx';
import { Parametres } from './pages/Parametres.tsx';
import { Portail } from './pages/Portail.tsx';
import { Referentiels } from './pages/Referentiels.tsx';
import { Temps } from './pages/Temps.tsx';
import { Voyages } from './pages/Voyages.tsx';
import { useStore, type View } from './state/store.tsx';

const PAGES: Record<View, () => ReactElement> = {
  dashboard: Dashboard, collaborateurs: Collaborateurs, equipes: Equipes, formations: Formations, habilitations: Habilitations, voyages: Voyages,
  chantiers: Chantiers, echeances: Echeances, budget: Budget, temps: Temps, absences: Absences, entretiens: Entretiens,
  missions: Missions, parametres: Parametres, portail: Portail, referentiels: Referentiels,
};

export function App() {
  const { session, data, loading, view, erreurChargement, recharger } = useStore();
  const role = session?.role;
  if (loading) return <Shell><div className="loading">Chargement…</div></Shell>;
  if (erreurChargement) {
    return (
      <Shell>
        <div className="loading">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
            <p role="alert" style={{ margin: 0 }}>{erreurChargement}</p>
            <button type="button" className="btn btn-secondary" onClick={recharger}>Réessayer</button>
          </div>
        </div>
      </Shell>
    );
  }
  // Mot de passe provisoire : à remplacer avant tout accès aux données.
  if (session?.compte?.changerMotDePasse && !session.user) return <Shell><MotDePasse /></Shell>;
  if (!session?.user) return <Shell><Login /></Shell>;
  if (!data) return <Shell><div className="loading">Chargement des données…</div></Shell>;
  const PageComponent = PAGES[view];
  // Session expirée : la reconnexion se pose par-dessus (Shell), la page et le dialogue restent montés.
  return (
    <Shell>
      <ErreurRendu cle={`${role}/${view}`} repli={(erreur, reessayer) => <ErreurPage erreur={erreur} reessayer={reessayer} />}>
        <PageComponent key={view} />
      </ErreurRendu>
      <DialogHost />
    </Shell>
  );
}
