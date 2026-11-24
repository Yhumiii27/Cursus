// Form controls on native elements (docs/spec/02 DS-CLASSES › Forms). Server-compatible; pass event
// handlers only from Client Components (or use uncontrolled `name`/`defaultValue` inside a <form>).
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, CSSProperties } from 'react';
import { cx } from './cx';
import s from './Field.module.css';

export interface FieldProps {
  /** Label text (translated). */
  label: ReactNode;
  /** Shows the accent `*` after the label. */
  required?: boolean;
  /** id of the control, for `<label htmlFor>`. */
  htmlFor?: string;
  /** `full` = `grid-column:1 / -1` inside a 2-column form grid. */
  span?: 'full' | 'auto';
  /** Optional helper line under the control (11.5px neutral-400). */
  hint?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** `.field` wrapper: 12px label (text 70%, margin-bottom 5px) above the control. */
export function Field({ label, required, htmlFor, span, hint, className, style, children }: FieldProps) {
  return (
    <div className={cx('field', span === 'full' && s.full, className)} style={style}>
      <label htmlFor={htmlFor} className={s.label}>
        {label}
        {required && <span className={s.req}>*</span>}
      </label>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

/** `md` DS (36px, 14px) · `sm` 32px/12.5px (search) · `inline` 28px/12.5px (inline editors) · `cell` 26px/12px (grid cells) · `pill` auto-width 32px/12.5px (toolbar selects). */
export type InputSize = 'md' | 'sm' | 'inline' | 'cell' | 'pill';

interface ControlLook {
  size?: InputSize;
  /** tabular-nums */
  numeric?: boolean;
  /** text-align:right */
  alignRight?: boolean;
}

const look = ({ size, numeric, alignRight }: ControlLook, className?: string, extra?: string | false) =>
  cx('input', size && size !== 'md' && s[size], numeric && s.numeric, alignRight && s.right, extra, className);

export type InputProps = ControlLook & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

/** `<input class="input">`. `type="number"` gets tabular figures automatically. */
export function Input({ size, numeric, alignRight, className, type, ...rest }: InputProps) {
  return <input type={type} className={look({ size, numeric: numeric ?? type === 'number', alignRight }, className)} {...rest} />;
}

export type SelectOption = string | { value: string; label: string; disabled?: boolean };
export type SelectProps = ControlLook & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  /** Options; plain strings use the same value and label. Alternatively pass `<option>` children. */
  options?: SelectOption[];
};

/** `<select class="input">` with the native arrow (as in the prototype). */
export function Select({ size, numeric, alignRight, className, options, children, ...rest }: SelectProps) {
  return (
    <select className={look({ size, numeric, alignRight }, className)} {...rest}>
      {options?.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ),
      )}
      {children}
    </select>
  );
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & {
  /** Add-form variant: `rows=3`, `min-height:72px`, `resize:vertical` (DS default is 90px). */
  short?: boolean;
};

/** `<textarea class="input">` (DS: min-height 90px, resize vertical). */
export function Textarea({ short, className, rows, ...rest }: TextareaProps) {
  return <textarea rows={rows ?? (short ? 3 : undefined)} className={cx('input', short && s.short, className)} {...rest} />;
}

export interface PseudoInputProps {
  /** Leading icon in neutral-500 (e.g. `CalendarBlank`, `Clock`, `FlagBanner`). */
  icon?: Icon;
  /** Shows the trailing `CaretDown` (static pickers). Default true. */
  caret?: boolean;
  /** Renders a `<button>` (clickable picker) instead of a `<div>`; pass onClick from a Client Component. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Read-only "input-looking" picker: `.input` + `display:flex;align-items:center;gap:8px`. */
export function PseudoInput({ icon: I, caret = true, onClick, className, style, children }: PseudoInputProps) {
  const inner = (
    <>
      {I && <I className={s.pseudoIcon} aria-hidden />}
      {children}
      {caret && <CaretDown className={s.pseudoCaret} aria-hidden />}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cx('input', s.pseudo, s.pseudoButton, className)} style={style}>
      {inner}
    </button>
  ) : (
    <div className={cx('input', s.pseudo, caret && s.pseudoButton, className)} style={style}>
      {inner}
    </div>
  );
}
