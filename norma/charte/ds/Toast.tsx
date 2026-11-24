'use client';
// Global toast (docs/spec/02 C-23, docs/spec/01 §9): one message at a time, a new one replaces the
// current one, auto-dismiss after 4000 ms (timer reset on each call), × closes it.
//
// Mount <ToastProvider> (or <ToastViewport/>) once, in the app shell. Trigger from client code with
// `useToast().show(message)` or the standalone `showToast(message)`. An optional link (`showToast(message, { href, label })`)
// renders after the text — e.g. the external system a placeholder needs (opens in a new tab).
// Optional action (chapter 4, S-5 "Undo"): `show(message, { action: { label, onClick } })` adds a small ghost button before
// the ×; clicking it runs `onClick` and dismisses the toast. A toast with an action stays TOAST_ACTION_MS (8 s) unless
// `durationMs` says otherwise. Calls without options behave exactly as before.
import { CheckCircle, X } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import s from './Toast.module.css';

/** Auto-dismiss delay (prototype `showToast`, logic 5116). */
export const TOAST_MS = 4000;
/** Auto-dismiss delay of a toast carrying an action (time to click "Undo"). */
export const TOAST_ACTION_MS = 8000;

export interface ToastAction {
  /** Already translated button label ("Annuler"). */
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Auto-dismiss delay; default TOAST_MS, or TOAST_ACTION_MS with an action. */
  durationMs?: number;
  /** Link shown after the message (opens in a new tab), with its `label` (translated). */
  href?: string;
  label?: string;
}

interface ToastState {
  id: number;
  message: string;
  link?: { href: string; label: string };
  action?: ToastAction;
}

let current: ToastState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Shows `message` as-is (pass it already translated). Replaces any visible toast. No-op on the server. */
export function showToast(message: string, opts?: ToastOptions) {
  if (typeof window === 'undefined' || !message) return;
  // Only web links (http(s) or same-site paths) are rendered.
  const href = opts?.href && /^(https?:\/\/|\/(?!\/))/i.test(opts.href) ? opts.href : null;
  current = { id: ++seq, message, action: opts?.action, ...(href ? { link: { href, label: opts?.label || href } } : {}) };
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      current = null;
      emit();
    },
    opts?.durationMs ?? (opts?.action ? TOAST_ACTION_MS : TOAST_MS),
  );
  emit();
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

export interface ToastApi {
  /** Show an already translated message, optionally with a link or an action button ("Undo"). */
  show: (message: string, opts?: ToastOptions) => void;
  /**
   * Show an English source message translated like the prototype: FR splits on " · " and translates
   * each segment ("R-21 · Risk registered" → "R-21 · Risque enregistré").
   */
  showEn: (englishMessage: string) => void;
  dismiss: () => void;
}

export function useToast(): ToastApi {
  const { t } = useI18n();
  return useMemo(() => ({ show: showToast, showEn: (m: string) => showToast(m.split(' · ').map(t).join(' · ')), dismiss: dismissToast }), [t]);
}

/** Renders the current toast (`card elev-lg`, fixed bottom-right, z 80). */
export function ToastViewport({ closeLabel }: { closeLabel?: string }) {
  const { t } = useI18n();
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={cx('card', 'elev-lg', s.toast)}>
          <CheckCircle className={s.icon} aria-hidden />
          <span className={s.text}>{toast.message}</span>
          {toast.link && (
            <a className={s.link} href={toast.link.href} target="_blank" rel="noopener noreferrer">
              {toast.link.label}
            </a>
          )}
          {toast.action && (
            <Button
              variant="ghost"
              size="sm"
              className={s.action}
              onClick={() => {
                const a = toast.action!;
                dismissToast();
                a.onClick();
              }}
            >
              {toast.action.label}
            </Button>
          )}
          <IconButton icon={X} muted label={closeLabel ?? t('Close')} onClick={dismissToast} className={s.close} />
        </div>
      )}
    </div>
  );
}

/** Wraps the app and renders the toast viewport after the children. */
export function ToastProvider({ children, closeLabel }: { children?: ReactNode; closeLabel?: string }) {
  return (
    <>
      {children}
      <ToastViewport closeLabel={closeLabel} />
    </>
  );
}
