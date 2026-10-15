// Dialogue modal Nocturne (fond, carte, actions) et champs de formulaire.
// Ses champs se conservent pendant une reconnexion Microsoft (attribut data-brouillon, state/brouillon.ts).
// Fermeture sans enregistrer (fond, Échap, « Annuler ») : seulement sur un clic commencé et terminé sur le
// fond (une sélection de texte relâchée hors de la carte ne ferme rien), et après confirmation si la saisie
// a changé. Un dialogue qui enregistre au fil de la saisie (`enregistrer`) le fait avant de se fermer, et
// « Fermer sans enregistrer » après un échec l'arrête (`abandonner`) ; un dialogue qui montre une information une
// seule fois (`fermerParBouton`) ne se ferme que par son bouton.
// Focus (components/focus.ts) : focus initial dans le dialogue, Tab bouclé sur ses éléments, focus rendu au
// bouton d'origine à la fermeture ; le titre nomme le dialogue (aria-labelledby).
// Formulaire : le dialogue est un <form> ; Entrée dans un champ active le bouton `type="submit"` (SubmitButton).
// Le bouton reste actif : un envoi incomplet affiche l'erreur sous chaque champ (useVerification, Field `erreur`)
// et place le focus sur le premier champ en erreur ; les champs obligatoires sont marqués (Field `requis`).
import {
  Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type FormEvent, type ReactElement, type ReactNode,
} from 'react';
import { lireChamps, restaurerChamps, saisieModifiee, type Champs } from '../state/brouillon.ts';
import { useStore } from '../state/store.tsx';
import { useModale } from './focus.ts';

/** Demande de fermeture du dialogue ouvert, avec confirmation si la saisie serait perdue. */
const Fermeture = createContext<(() => void) | null>(null);

/** Confirmation d'une action irréversible lancée depuis le dialogue : elle remplace ses boutons jusqu'à la réponse. */
export interface ConfirmationEnLigne {
  texte: ReactNode;
  /** Libellé du bouton qui exécute l'action. */
  bouton: string;
  occupe?: boolean;
  confirmer: () => void;
  /** Retour au dialogue (« Revenir », Échap). */
  annuler: () => void;
}

export function Dialog({ title, width, tall, children, actions, enregistrer, abandonner, fermerParBouton, onSubmit, confirmation, decrit }: {
  title: ReactNode; width?: number; tall?: boolean; children: ReactNode; actions: ReactNode;
  /** Enregistrement au fil de la saisie : appelé avant la fermeture ; faux (échec) : confirmation demandée. */
  enregistrer?: () => Promise<boolean>;
  /** « Fermer sans enregistrer » choisi : appelé avant la fermeture (le dialogue n'enregistre plus rien en se démontant). */
  abandonner?: () => void;
  /** Fond et Échap sans effet : le dialogue ne se ferme que par son bouton (mot de passe affiché une seule fois). */
  fermerParBouton?: boolean;
  /** Envoi du formulaire : bouton `type="submit"` ou Entrée dans un champ. */
  onSubmit?: () => void;
  /** Confirmation affichée à la place des boutons (clôture d'un entretien…). */
  confirmation?: ConfirmationEnLigne | null;
  /** Identifiant du texte qui décrit le dialogue (aria-describedby) : question d'une confirmation. */
  decrit?: string;
}) {
  const { closeDialog, reconnexion, dialog, prendreChamps } = useStore();
  const ref = useRef<HTMLFormElement>(null);
  const titreId = useId();
  // Valeurs des champs à l'ouverture, et saisie de la personne depuis (un champ rempli par le dialogue lui-même ne compte pas).
  const initial = useRef<Champs | null>(null);
  const saisi = useRef(false);
  const pressionFond = useRef(false);
  // Confirmation affichée : saisie non enregistrée, ou enregistrement en échec.
  const [confirmer, setConfirmer] = useState<'saisie' | 'echec' | null>(null);
  const confirmerRef = useRef(confirmer);
  confirmerRef.current = confirmer;
  const enLigneRef = useRef(confirmation);
  enLigneRef.current = confirmation;
  // Le dialogue porte des champs obligatoires : la légende de l'astérisque s'affiche.
  const [avecRequis, setAvecRequis] = useState(false);
  useLayoutEffect(() => { setAvecRequis(!!ref.current?.querySelector('.field .requis')); });

  useModale(ref, !reconnexion);

  const enregistrement = useRef(false);
  const demanderFermeture = async () => {
    if (confirmerRef.current || enregistrement.current) return;
    if (enregistrer) {
      enregistrement.current = true;
      const ok = await enregistrer().finally(() => { enregistrement.current = false; });
      if (ok) closeDialog();
      else setConfirmer('echec');
      return;
    }
    const champs = ref.current ? lireChamps(ref.current) : null;
    if (saisi.current && saisieModifiee(initial.current, champs)) setConfirmer('saisie');
    else closeDialog();
  };
  const fermerRef = useRef(demanderFermeture);
  fermerRef.current = demanderFermeture;

  useEffect(() => {
    // Pendant une reconnexion (session expirée), Échap ne ferme pas le dialogue resté derrière.
    // Pendant une confirmation, Échap revient au formulaire.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || reconnexion) return;
      if (confirmerRef.current) setConfirmer(null);
      else if (enLigneRef.current) { if (!enLigneRef.current.occupe) enLigneRef.current.annuler(); }
      else if (!fermerParBouton) fermerRef.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [reconnexion, fermerParBouton]);
  // Valeurs de départ relevées une fois le dialogue rempli (ses propres effets ont pu poser des valeurs par défaut).
  useEffect(() => {
    const t = setTimeout(() => { if (ref.current) initial.current = lireChamps(ref.current); }, 0);
    return () => clearTimeout(t);
  }, []);
  // Retour de Microsoft après une session expirée : la saisie conservée est remise dans les champs.
  useEffect(() => {
    const champs = prendreChamps(dialog);
    if (champs && ref.current) restaurerChamps(ref.current, champs);
  }, [prendreChamps, dialog]);

  const envoyer = (ev: FormEvent) => {
    ev.preventDefault();
    // Entrée pendant une confirmation : rien n'est envoyé, la confirmation attend sa réponse.
    if (!onSubmit || confirmerRef.current || enLigneRef.current) return;
    onSubmit();
  };

  const marquer = () => { saisi.current = true; };
  return (
    <div className="dialog-backdrop"
      onPointerDown={e => { pressionFond.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressionFond.current && e.target === e.currentTarget && e.detail <= 1 && !fermerParBouton) demanderFermeture(); pressionFond.current = false; }}>
      <form
        ref={ref} data-brouillon="" noValidate onSubmit={envoyer} tabIndex={-1}
        className={`dialog${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titreId} aria-describedby={decrit}
        onInputCapture={marquer} onChangeCapture={marquer}
        style={width ? { width: `min(${width}px, 100%)`, maxWidth: tall ? width : undefined } : undefined}
      >
        <div className="dialog-title" id={titreId}>{title}</div>
        <div className="dialog-body">
          {children}
          {avecRequis && <p className="legende-requis"><span aria-hidden="true">*</span> champ obligatoire</p>}
        </div>
        {confirmer ? (
          <div className="dialog-actions confirmer-fermeture">
            <p role="alert">
              {confirmer === 'echec' ? 'Des modifications n’ont pas pu être enregistrées.' : 'La saisie n’est pas enregistrée.'} Fermer quand même ?
            </p>
            <button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirmer(null)}>Reprendre la saisie</button>
            <button type="button" className="btn btn-primary" onClick={() => { abandonner?.(); closeDialog(); }}>Fermer sans enregistrer</button>
          </div>
        ) : confirmation ? (
          <div className="dialog-actions confirmer-fermeture">
            <p role="alert">{confirmation.texte}</p>
            <button type="button" className="btn btn-secondary" autoFocus disabled={confirmation.occupe} onClick={confirmation.annuler}>Revenir</button>
            <button type="button" className="btn btn-primary" disabled={confirmation.occupe} onClick={e => { if (e.detail <= 1) confirmation.confirmer(); }}>{confirmation.bouton}</button>
          </div>
        ) : (
          <div className="dialog-actions"><Fermeture.Provider value={demanderFermeture}>{actions}</Fermeture.Provider></div>
        )}
      </form>
    </div>
  );
}

/** Contrôles auxquels un champ transmet son état (obligatoire, en erreur, message) : le premier enfant direct. */
const CONTROLES = new Set(['input', 'select', 'textarea']);

/**
 * Champ de formulaire : libellé, contrôle, message d'erreur dessous. `requis` marque le libellé d'un astérisque
 * (aria-required sur le contrôle) ; `erreur` s'affiche sous le champ et le contrôle passe aria-invalid, décrit par
 * le message. Le contrôle concerné est le premier <input>, <select> ou <textarea> enfant direct du champ.
 */
export function Field({ label, htmlFor, children, requis, erreur }: {
  label: ReactNode; htmlFor?: string; children: ReactNode; requis?: boolean; erreur?: string | null | false;
}) {
  const auto = useId();
  const msg = erreur || null;
  const idErreur = `${htmlFor ?? auto}-erreur`;
  let marque = false;
  const enfants = requis || msg ? Children.map(children, c => {
    if (marque || !isValidElement(c) || typeof c.type !== 'string' || !CONTROLES.has(c.type)) return c;
    marque = true;
    const el = c as ReactElement<Record<string, unknown>>;
    const decrit = [el.props['aria-describedby'], msg ? idErreur : null].filter(Boolean).join(' ');
    return cloneElement(el, {
      'aria-required': requis || undefined,
      'aria-invalid': msg ? true : undefined,
      'aria-describedby': decrit || undefined,
    });
  }) : children;
  return (
    <div className={`field${msg ? ' en-erreur' : ''}`}>
      <label htmlFor={htmlFor}>{label}{requis && <span className="requis" aria-hidden="true"> *</span>}</label>
      {enfants}
      {/* Sans contrôle à marquer (cases à cocher, choix segmenté) : le message lui-même est ciblé à l'envoi. */}
      {msg && <p className={`field-erreur${marque ? '' : ' bloquant'}`} tabIndex={marque ? undefined : -1} id={idErreur}>{msg}</p>}
    </div>
  );
}

export function Static({ children, pad }: { children: ReactNode; pad?: boolean }) {
  return <div className={`static${pad ? ' pad' : ''}`}>{children}</div>;
}

/** Bouton « Annuler » standard des dialogues : confirmation si la saisie serait perdue. */
export function CancelButton({ label = 'Annuler' }: { label?: string }) {
  const { closeDialog } = useStore();
  const fermer = useContext(Fermeture);
  return <button type="button" className="btn btn-secondary" onClick={() => (fermer ?? closeDialog)()}>{label}</button>;
}

/**
 * Bouton principal d'un formulaire de dialogue : Entrée l'active depuis un champ ; désactivé seulement pendant l'envoi.
 * Le second clic d'un double clic est ignoré : le premier a pu ouvrir le dialogue sous le pointeur (state/actions.ts).
 */
export function SubmitButton({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return <button type="submit" className="btn btn-primary" disabled={busy} onClick={e => { if (e.detail > 1) e.preventDefault(); }}>{children}</button>;
}

/**
 * Premier champ en erreur (ou premier contrôle bloquant) du dialogue ouvert, ou de la page sans dialogue : il prend
 * le focus et un lecteur d'écran lit son message (aria-describedby).
 */
export function focusPremiereErreur() {
  requestAnimationFrame(() => {
    const racine = document.querySelector('[aria-modal="true"]') ?? document;
    racine.querySelector<HTMLElement>('[aria-invalid="true"], .bloquant')?.focus();
  });
}

/**
 * Validation explicite à l'envoi : le bouton principal reste actif. Un envoi bloqué affiche les erreurs sous les
 * champs (`erreur(msg)` : rien avant la première tentative, pour ne pas signaler un champ que la personne n'a pas
 * encore rempli) et place le focus sur le premier champ en erreur.
 */
export function useVerification() {
  const [tente, setTente] = useState(false);
  return {
    tente,
    /** Message d'erreur d'un champ, affiché après la première tentative d'envoi. */
    erreur: (msg: string | null | false | undefined) => (tente && msg) || null,
    /** Vrai si rien ne bloque l'envoi ; sinon les erreurs s'affichent et la première prend le focus. */
    verifier: (...blocages: unknown[]) => {
      if (!blocages.some(Boolean)) return true;
      setTente(true);
      focusPremiereErreur();
      return false;
    },
  };
}

/** Contrôles en direct d'un formulaire : informations atténuées, blocages en accent (ciblés quand ils bloquent l'envoi). */
export function Controles({ msgs }: { msgs: { text: string; bad: boolean }[] }) {
  if (!msgs.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {msgs.map(m => (
        <p key={m.text} className={m.bad ? 'bloquant' : undefined} tabIndex={m.bad ? -1 : undefined}
          style={{ fontSize: 12, margin: 0, color: m.bad ? 'var(--color-accent-300)' : 'var(--color-neutral-400)' }}>{m.text}</p>
      ))}
    </div>
  );
}

/** Message qui bloque l'envoi, sans champ à qui le rattacher (choix dans une liste, prérequis) : ciblé à l'envoi. */
export function Bloquant({ children }: { children: ReactNode }) {
  return <p className="form-error bloquant" tabIndex={-1}>{children}</p>;
}

/** Liste de contrôles de prérequis (habilitations). */
export function CheckList({ checks }: { checks: { key: string; label: string; text: string; cls: string; statut: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {checks.map(c => (
        <div key={c.key} className="boxed" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 14 }}>{c.label}</div><div className="text-muted sub">{c.text}</div></div>
          <span className={`tag ${c.cls}`} style={{ flex: 'none', whiteSpace: 'nowrap' }}>{c.statut}</span>
        </div>
      ))}
    </div>
  );
}
