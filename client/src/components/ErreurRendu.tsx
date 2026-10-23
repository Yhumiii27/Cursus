// Erreurs de rendu : une page, un dialogue ou l'application qui plante affiche un message avec « Réessayer »
// au lieu d'un écran blanc. Une limite par page (remise à zéro au changement de page), une autour du dialogue
// ouvert (le reste de l'écran reste utilisable), une autour de l'application (barre latérale comprise).
import { Component, useEffect, useRef, type ReactNode } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { useStore } from '../state/store.tsx';
import { useModale } from './focus.ts';

interface Props {
  children: ReactNode;
  /** Écran affiché à la place de l'arbre en erreur ; `reessayer` le redessine. */
  repli: (erreur: Error, reessayer: () => void) => ReactNode;
  /** Valeur dont le changement efface l'erreur (page affichée, dialogue ouvert). */
  cle?: unknown;
}
interface State { erreur: Error | null }

export class ErreurRendu extends Component<Props, State> {
  state: State = { erreur: null };

  static getDerivedStateFromError(erreur: unknown): State {
    return { erreur: erreur instanceof Error ? erreur : new Error(String(erreur)) };
  }

  // Changement de page ou de dialogue (`cle`) : l'erreur affichée est oubliée, une seule fois (condition sur `cle`).
  componentDidUpdate(prev: Props) {
    // oxlint-disable-next-line react/no-did-update-set-state -- remise à zéro conditionnelle, sans boucle de rendus
    if (this.state.erreur && prev.cle !== this.props.cle) this.setState({ erreur: null });
  }

  reessayer = () => this.setState({ erreur: null });

  render() {
    return this.state.erreur ? this.props.repli(this.state.erreur, this.reessayer) : this.props.children;
  }
}

/** Détail technique de l'erreur, replié : utile à l'administrateur, sans encombrer le message. */
function Detail({ erreur }: { erreur: Error }) {
  return (
    <details className="erreur-detail">
      <summary>Détail technique</summary>
      <pre className="pre">{erreur.message || String(erreur)}</pre>
    </details>
  );
}

const TEXTE = 'Une erreur inattendue s’est produite à l’affichage. Les données enregistrées ne sont pas touchées.';

/** Page en erreur : les données sont relues avant de redessiner (l'erreur peut venir d'un instantané incohérent). */
export function ErreurPage({ erreur, reessayer }: { erreur: Error; reessayer: () => void }) {
  const { refresh } = useStore();
  return (
    <div className="page">
      <section className="card elev-sm panel highlight erreur-rendu" role="alert">
        <h2><WarningIcon size={18} weight="bold" aria-hidden="true" />Cette page n’a pas pu s’afficher</h2>
        <p>{TEXTE} Réessayez ; si l’erreur revient, rechargez la page ou prévenez l’administrateur.</p>
        <Detail erreur={erreur} />
        <div className="erreur-actions">
          <button type="button" className="btn btn-primary" onClick={() => { refresh().finally(reessayer); }}>Réessayer</button>
          <button type="button" className="btn btn-secondary" onClick={() => location.reload()}>Recharger la page</button>
        </div>
      </section>
    </div>
  );
}

/** Dialogue en erreur : message à la place du formulaire ; la page derrière reste utilisable une fois fermé. */
export function ErreurDialogue({ erreur, reessayer }: { erreur: Error; reessayer: () => void }) {
  const { closeDialog, reconnexion } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useModale(ref, !reconnexion);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reconnexion) closeDialog(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [closeDialog, reconnexion]);
  return (
    <div className="dialog-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog erreur-rendu" role="alertdialog" aria-modal="true" aria-labelledby="erreur-dialogue-titre" aria-describedby="erreur-dialogue-texte">
        <div className="dialog-title" id="erreur-dialogue-titre">Ce formulaire n’a pas pu s’afficher</div>
        <div className="dialog-body">
          <p id="erreur-dialogue-texte" style={{ margin: 0 }}>{TEXTE} Réessayez, ou fermez puis rouvrez le formulaire.</p>
          <Detail erreur={erreur} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={reessayer}>Réessayer</button>
          <button type="button" className="btn btn-primary" autoFocus onClick={closeDialog}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

/** Application en erreur (barre latérale comprise) : sans le magasin, qui a pu échouer lui aussi. */
export function ErreurApplication({ erreur, reessayer }: { erreur: Error; reessayer: () => void }) {
  return (
    <div className="loading">
      <section className="card elev-md panel erreur-rendu" role="alert" style={{ maxWidth: 520 }}>
        <h2><WarningIcon size={18} weight="bold" aria-hidden="true" />Cursus n’a pas pu s’afficher</h2>
        <p>{TEXTE} Réessayez ; si l’erreur revient, rechargez la page ou prévenez l’administrateur.</p>
        <Detail erreur={erreur} />
        <div className="erreur-actions">
          <button type="button" className="btn btn-primary" onClick={reessayer}>Réessayer</button>
          <button type="button" className="btn btn-secondary" onClick={() => location.reload()}>Recharger la page</button>
        </div>
      </section>
    </div>
  );
}
