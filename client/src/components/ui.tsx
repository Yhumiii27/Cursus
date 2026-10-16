// Kit d'interface Cursus, construit sur les classes du design system Nocturne.
import type { CSSProperties, ReactNode, Ref } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { ini, monthShort } from '../../../shared/format.ts';

export function Page({ kicker, title, actions, note, tight, children }: { kicker?: ReactNode; title: ReactNode; actions?: ReactNode; note?: ReactNode; tight?: boolean; children?: ReactNode }) {
  return (
    <div className={`page${tight ? ' tight' : ''}`}>
      <header className="page-head">
        <div>
          {kicker != null && <div className="kicker">{kicker}</div>}
          {/* Ciblable : reçoit le focus après un changement de page (layout/navigation.ts). */}
          <h1 tabIndex={-1}>{title}</h1>
        </div>
        {actions && <div className="head-actions">{actions}</div>}
        {note && <p className="text-muted head-note">{note}</p>}
      </header>
      {children}
    </div>
  );
}

export function Kpis({ children }: { children: ReactNode }) { return <div className="kpis">{children}</div>; }

export function Kpi({ kicker, value, sub, action }: { kicker: ReactNode; value: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card elev-sm kpi">
      <div className="card-kicker">{kicker}</div>
      <div className="kpi-value">{value}</div>
      <div className="card-meta"><span>{sub}</span>{action}</div>
    </div>
  );
}

/**
 * Carte de section : titre, complément à droite, contenu. `panneau` : panneau de détail amené dans le champ de
 * vision sur écran étroit (components/panneau.ts), ciblable et nommé par `nommePar` (id de son titre).
 */
export function Panel({ title, aside, highlight, className = '', style, children, head, panneau, nommePar }: {
  title?: ReactNode; aside?: ReactNode; highlight?: boolean; className?: string; style?: CSSProperties; children?: ReactNode; head?: ReactNode;
  panneau?: Ref<HTMLElement>; nommePar?: string;
}) {
  return (
    <section ref={panneau} tabIndex={panneau ? -1 : undefined} aria-labelledby={nommePar}
      className={`card elev-sm panel${highlight ? ' highlight' : ''}${panneau ? ' panneau-detail' : ''} ${className}`} style={style}>
      {head ?? (title != null && (aside != null
        ? <div className="panel-head"><h2>{title}</h2>{typeof aside === 'string' ? <span className="text-muted sub">{aside}</span> : aside}</div>
        : <h2>{title}</h2>))}
      {children}
    </section>
  );
}

export function Tag({ cls, children, style }: { cls: string; children: ReactNode; style?: CSSProperties }) {
  return <span className={`tag ${cls}`} style={{ whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

export function Chips({ items }: { items: { key?: string | number; label: ReactNode; cls: string }[] }) {
  return <div className="chips">{items.map((c, i) => <Tag key={c.key ?? i} cls={c.cls}>{c.label}</Tag>)}</div>;
}

/** Contrôle segmenté (boutons radio stylés). */
export function Seg<T extends string | number>({ name, value, options, onChange, label, style, disabled }: {
  name: string; value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string; style?: CSSProperties; disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} style={style}>
      {options.map(([v, l]) => (
        <label key={String(v)} className="seg-opt">
          <input type="radio" name={name} checked={value === v} disabled={disabled} onChange={() => onChange(v)} />{l}
        </label>
      ))}
    </div>
  );
}

/** Cellule à deux lignes : valeur principale et précision atténuée. */
export function Two({ main, sub, nowrap, subNowrap }: { main: ReactNode; sub?: ReactNode; nowrap?: boolean; subNowrap?: boolean }) {
  return (
    <>
      <div className={nowrap ? 'nowrap' : undefined}>{main}</div>
      {sub != null && sub !== '' && <div className={`text-muted sub${subNowrap ? ' nowrap' : ''}`}>{sub}</div>}
    </>
  );
}

export function Avatar({ nom, size = 28 }: { nom: string; size?: number }) {
  const fs = size >= 40 ? 14 : size >= 32 ? 12 : 11;
  return <span className="avatar" style={{ width: size, height: size, fontSize: fs, fontWeight: size === 32 ? 500 : undefined }}>{ini(nom)}</span>;
}

export function DateBlock({ date }: { date: Date }) {
  return <div className="date-block"><div className="d">{date.getDate()}</div><div className="m">{monthShort(date)}</div></div>;
}

/** Barre de progression simple. */
export function Bar({ pct, color = 'var(--color-accent-600)', variant, width }: { pct: number; color?: string; variant?: 'thin' | 'thick'; width?: number }) {
  return (
    <div className={`bar${variant ? ' ' + variant : ''}`} style={width ? { width, flex: 'none' } : undefined}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

/** Barre empilée (réalisé / engagé / prévu). */
export function StackBar({ parts, variant }: { parts: { pct: number; color: string }[]; variant?: 'thick' }) {
  return (
    <div className={`bar stacked${variant ? ' ' + variant : ''}`}>
      {parts.map((p, i) => <div key={i} style={{ flex: 'none', borderRadius: 0, width: `${Math.max(0, Math.min(100, p.pct))}%`, background: p.color }} />)}
    </div>
  );
}

export function Empty({ children, pad }: { children: ReactNode; pad?: 'sm' | 'md' }) {
  return <p className="text-muted empty" style={pad ? { padding: `var(--space-${pad === 'sm' ? 3 : 4}) 0` } : undefined}>{children}</p>;
}

export function Fine({ children, muted = true }: { children: ReactNode; muted?: boolean }) {
  return <p className={`fine${muted ? ' text-muted' : ''}`}>{children}</p>;
}

export function NoteAccent({ children, icon }: { children: ReactNode; icon?: boolean }) {
  if (icon) return <div className="note-accent" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckIcon size={12} weight="bold" /><span>{children}</span></div>;
  return <div className="note-accent">{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) { return <h4 className="section-label">{children}</h4>; }

export function CloseButton({ onClick, size = 32, label = 'Fermer', disabled }: { onClick: (ev: React.MouseEvent) => void; size?: number; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled} style={{ color: 'inherit', width: size, height: size }}>
      <XIcon size={size <= 28 ? 12 : 14} />
    </button>
  );
}

export function Btn({ variant = 'ghost', small, icon, children, onClick, disabled, type = 'button', style, title }: {
  variant?: 'primary' | 'secondary' | 'ghost'; small?: boolean; icon?: ReactNode; children?: ReactNode; onClick?: (ev: React.MouseEvent) => void;
  disabled?: boolean; type?: 'button' | 'submit'; style?: CSSProperties; title?: string;
}) {
  return (
    <button type={type} className={`btn btn-${variant}${small ? ' btn-sm' : ''}`} onClick={onClick} disabled={disabled} style={style} title={title}>
      {icon}{children != null && (icon ? <span>{children}</span> : children)}
    </button>
  );
}

/** Empêche le clic d'un bouton de déclencher le clic de la ligne. */
export const stop = (fn: () => void) => (ev: React.MouseEvent) => { ev.stopPropagation(); fn(); };

export function Pre({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  return <pre className="pre" style={maxHeight ? { maxHeight } : undefined}>{children}</pre>;
}
