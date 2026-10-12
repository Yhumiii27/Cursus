// Dialogue modal Nocturne (fond, carte, actions) et champs de formulaire.
// Ses champs se conservent pendant une reconnexion Microsoft (attribut data-brouillon, state/brouillon.ts).
// Fermeture sans enregistrer (fond, Échap, « Annuler ») : seulement sur un clic commencé et terminé sur le
// fond (une sélection de texte relâchée hors de la carte ne ferme rien), et après confirmation si la saisie
// a changé. Un dialogue qui enregistre au fil de la saisie (`enregistrer`) le fait avant de se fermer ; un
// dialogue qui montre une information une seule fois (`fermerParBouton`) ne se ferme que par son bouton.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { lireChamps, restaurerChamps, saisieModifiee, type Champs } from '../state/brouillon.ts';
import { useStore } from '../state/store.tsx';

/** Demande de fermeture du dialogue ouvert, avec confirmation si la saisie serait perdue. */
const Fermeture = createContext<(() => void) | null>(null);

export function Dialog({ title, width, tall, children, actions, label, enregistrer, fermerParBouton }: {
  title: ReactNode; width?: number; tall?: boolean; children: ReactNode; actions: ReactNode; label?: string;
  /** Enregistrement au fil de la saisie : appelé avant la fermeture ; faux (échec) : confirmation demandée. */
  enregistrer?: () => Promise<boolean>;
  /** Fond et Échap sans effet : le dialogue ne se ferme que par son bouton (mot de passe affiché une seule fois). */
  fermerParBouton?: boolean;
}) {
  const { closeDialog, reconnexion, dialog, prendreChamps } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  // Valeurs des champs à l'ouverture, et saisie de la personne depuis (un champ rempli par le dialogue lui-même ne compte pas).
  const initial = useRef<Champs | null>(null);
  const saisi = useRef(false);
  const pressionFond = useRef(false);
  // Confirmation affichée : saisie non enregistrée, ou enregistrement en échec.
  const [confirmer, setConfirmer] = useState<'saisie' | 'echec' | null>(null);
  const confirmerRef = useRef(confirmer);
  confirmerRef.current = confirmer;

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
    // Pendant la confirmation, Échap revient au formulaire.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || reconnexion) return;
      if (confirmerRef.current) setConfirmer(null);
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

  const marquer = () => { saisi.current = true; };
  return (
    <div className="dialog-backdrop"
      onPointerDown={e => { pressionFond.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressionFond.current && e.target === e.currentTarget && !fermerParBouton) demanderFermeture(); pressionFond.current = false; }}>
      <div
        ref={ref} data-brouillon=""
        className={`dialog${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        onInputCapture={marquer} onChangeCapture={marquer}
        style={width ? { width: `min(${width}px, 100%)`, maxWidth: tall ? width : undefined } : undefined}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        {confirmer ? (
          <div className="dialog-actions confirmer-fermeture">
            <p role="alert">
              {confirmer === 'echec' ? 'Des modifications n’ont pas pu être enregistrées.' : 'La saisie n’est pas enregistrée.'} Fermer quand même ?
            </p>
            <button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirmer(null)}>Reprendre la saisie</button>
            <button type="button" className="btn btn-primary" onClick={closeDialog}>Fermer sans enregistrer</button>
          </div>
        ) : (
          <div className="dialog-actions"><Fermeture.Provider value={demanderFermeture}>{actions}</Fermeture.Provider></div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}</div>;
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

/** Contrôles en direct d'un formulaire : informations atténuées, blocages en accent. */
export function Controles({ msgs }: { msgs: { text: string; bad: boolean }[] }) {
  if (!msgs.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {msgs.map(m => <p key={m.text} style={{ fontSize: 12, margin: 0, color: m.bad ? 'var(--color-accent-300)' : 'var(--color-neutral-400)' }}>{m.text}</p>)}
    </div>
  );
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
