// Dialogue modal Nocturne (fond, carte, actions) et champs de formulaire.
import { useEffect, type ReactNode } from 'react';
import { useStore } from '../state/store.tsx';

export function Dialog({ title, width, tall, children, actions, label }: {
  title: ReactNode; width?: number; tall?: boolean; children: ReactNode; actions: ReactNode; label?: string;
}) {
  const { closeDialog } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDialog(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [closeDialog]);
  return (
    <div className="dialog-backdrop" onClick={closeDialog}>
      <div
        className={`dialog${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        onClick={e => e.stopPropagation()}
        style={width ? { width: `min(${width}px, 100%)`, maxWidth: tall ? width : undefined } : undefined}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
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

/** Bouton « Annuler » standard des dialogues. */
export function CancelButton({ label = 'Annuler' }: { label?: string }) {
  const { closeDialog } = useStore();
  return <button type="button" className="btn btn-secondary" onClick={closeDialog}>{label}</button>;
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
