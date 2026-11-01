// Aiguillage des écrans selon la vue courante et l'espace (RH, manager, collaborateur).
// Une erreur de rendu de la page n'emporte ni la barre latérale ni le dialogue ouvert (ErreurRendu).
// Chaque page, et l'ensemble des dialogues, est un fichier à part chargé à la demande (React.lazy) : le premier
// affichage ne télécharge que la coque, la connexion et la page ouverte ; les dialogues sont préchargés dès que les
// données arrivent, pour qu'un premier dialogue s'ouvre sans attente. Un fichier introuvable (version remplacée
// pendant que l'onglet était ouvert) tombe dans ErreurRendu, qui propose de recharger la page.
import { type ComponentType, lazy, Suspense, useEffect } from 'react';
import { ErreurDialogue, ErreurPage, ErreurRendu } from './components/ErreurRendu.tsx';
import { Shell } from './layout/Shell.tsx';
import { Login } from './pages/Login.tsx';
import { MotDePasse } from './pages/MotDePasse.tsx';
// lot 11 — pwa : ouverture sans réseau (application installée), file d'attente seule.
import { HorsLigne } from './pages/HorsLigne.tsx';
import { MSG_RESEAU } from './api.ts';
import { useStore, type View } from './state/store.tsx';

/** Composant exporté par son nom (`export function Temps`), chargé à la première utilisation. */
function aLaDemande<M>(charger: () => Promise<M>, nom: keyof M): ComponentType {
  return lazy(() => charger().then(m => ({ default: m[nom] as ComponentType })));
}

const PAGES: Record<View, ComponentType> = {
  dashboard: aLaDemande(() => import('./pages/Dashboard.tsx'), 'Dashboard'),
  collaborateurs: aLaDemande(() => import('./pages/Collaborateurs.tsx'), 'Collaborateurs'),
  equipes: aLaDemande(() => import('./pages/Equipes.tsx'), 'Equipes'),
  formations: aLaDemande(() => import('./pages/Formations.tsx'), 'Formations'),
  habilitations: aLaDemande(() => import('./pages/Habilitations.tsx'), 'Habilitations'),
  voyages: aLaDemande(() => import('./pages/Voyages.tsx'), 'Voyages'),
  chantiers: aLaDemande(() => import('./pages/Chantiers.tsx'), 'Chantiers'),
  echeances: aLaDemande(() => import('./pages/Echeances.tsx'), 'Echeances'),
  budget: aLaDemande(() => import('./pages/Budget.tsx'), 'Budget'),
  temps: aLaDemande(() => import('./pages/Temps.tsx'), 'Temps'),
  absences: aLaDemande(() => import('./pages/Absences.tsx'), 'Absences'),
  entretiens: aLaDemande(() => import('./pages/Entretiens.tsx'), 'Entretiens'),
  missions: aLaDemande(() => import('./pages/Missions.tsx'), 'Missions'),
  parametres: aLaDemande(() => import('./pages/Parametres.tsx'), 'Parametres'),
  portail: aLaDemande(() => import('./pages/Portail.tsx'), 'Portail'),
  referentiels: aLaDemande(() => import('./pages/Referentiels.tsx'), 'Referentiels'),
  miseEnService: aLaDemande(() => import('./pages/MiseEnService.tsx'), 'MiseEnService'),
  // Compte professionnel de prévention (lot 7) : synthèse annuelle des expositions et export pour la DSN.
  prevention: aLaDemande(() => import('./pages/Prevention.tsx'), 'Prevention'),
  // lot 11 — indicateurs : indicateurs sociaux légaux (BDESE, préparation de l'index d'égalité), calculés par le serveur.
  indicateurs: aLaDemande(() => import('./pages/Indicateurs.tsx'), 'Indicateurs'),
  // Vue commune à tous les espaces, ouverte aussi sans connexion (depuis l'écran de connexion).
  confidentialite: aLaDemande(() => import('./pages/Confidentialite.tsx'), 'Confidentialite'),
  aide: aLaDemande(() => import('./pages/Aide.tsx'), 'Aide'),
  // lot 11 — organigramme : tous les espaces, selon le réglage organigrammeOuvert (state/store.tsx).
  organigramme: aLaDemande(() => import('./pages/Organigramme.tsx'), 'Organigramme'),
  // lot 11 — notes de frais : Mes frais (collaborateur, téléphone d'abord), validation (manager), contrôle (service RH,
  // comptabilité).
  frais: aLaDemande(() => import('./pages/Frais.tsx'), 'Frais'),
  // lot 12 — blocs réservés (socle) : page de chaque vue nouvelle (shared/constants.ts, ALLOWED_VIEWS), chargée à la demande.
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
};

/** Tous les dialogues (dialogs/DialogHost.tsx et ce qu'il importe) : un seul fichier, préchargé avec les données. */
const chargerDialogues = () => import('./dialogs/DialogHost.tsx');
const DialogHost = aLaDemande(chargerDialogues, 'DialogHost');

const CHARGEMENT = <div className="loading">Chargement…</div>;

export function App() {
  const { session, data, loading, view, erreurChargement, recharger, dialog } = useStore();
  const role = session?.role;
  const avecDonnees = !!data;
  useEffect(() => { if (avecDonnees) void chargerDialogues().catch(() => { /* réessayé à l'ouverture d'un dialogue */ }); }, [avecDonnees]);
  if (loading) return <Shell>{CHARGEMENT}</Shell>;
  if (erreurChargement) {
    if (!navigator.onLine || erreurChargement === MSG_RESEAU) return <Shell><HorsLigne erreur={erreurChargement} recharger={recharger} /></Shell>;
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
  if (!session?.user) {
    // Vues communes (Confidentialité, Aide) : lisibles avant la connexion.
    const Commune = view === 'confidentialite' || view === 'aide' ? PAGES[view] : null;
    return <Shell>{Commune ? <Suspense fallback={CHARGEMENT}><Commune /></Suspense> : <Login />}</Shell>;
  }
  if (!data) return <Shell><div className="loading">Chargement des données…</div></Shell>;
  const PageComponent = PAGES[view];
  // Session expirée : la reconnexion se pose par-dessus (Shell), la page et le dialogue restent montés.
  return (
    <Shell>
      <ErreurRendu cle={`${role}/${view}`} repli={(erreur, reessayer) => <ErreurPage erreur={erreur} reessayer={reessayer} />}>
        <Suspense fallback={CHARGEMENT}>
          <PageComponent key={view} />
        </Suspense>
      </ErreurRendu>
      {/* Monté avec un dialogue ouvert seulement. Fichier des dialogues pas encore arrivé : rien à la place (il l'est
          d'ordinaire avant le premier clic) ; introuvable : message à la place du dialogue, effacé à sa fermeture. */}
      {dialog && (
        <ErreurRendu cle={dialog} repli={(erreur, reessayer) => <ErreurDialogue erreur={erreur} reessayer={reessayer} />}>
          <Suspense fallback={null}>
            <DialogHost />
          </Suspense>
        </ErreurRendu>
      )}
    </Shell>
  );
}
