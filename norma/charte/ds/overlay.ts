'use client';
// Shared overlay behaviour (docs/spec/02 Q-9 resolved for the rebuild): Esc closes the topmost overlay
// only, modal overlays trap Tab focus and restore focus on close, popovers close on outside click.
import { useEffect, useEffectEvent, useSyncExternalStore, type RefObject } from 'react';

const noopSubscribe = () => () => {};

/** `true` after hydration on the client (portals need `document`). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// Stack of open overlays, topmost last. Esc and the focus trap only act for the top entry.
const stack: symbol[] = [];
const isTop = (id: symbol) => stack[stack.length - 1] === id;

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

export interface OverlayOptions {
  /** Overlay is open. */
  active: boolean;
  /** Called on Escape when this overlay is the topmost one. */
  onEscape?: () => void;
  /** Modal panel: trap Tab inside it, focus it on open and restore the previous focus on close. */
  trapRef?: RefObject<HTMLElement | null>;
  /** Popover anchor: a pointer-down outside this element calls `onOutside`. */
  outsideRef?: RefObject<HTMLElement | null>;
  onOutside?: () => void;
}

/**
 * Registers an overlay layer while `active`. Initial focus inside `trapRef`: `[data-autofocus]`, else the
 * first form control, else the panel itself (give it `tabIndex={-1}`).
 */
export function useOverlay({ active, onEscape, trapRef, outsideRef, onOutside }: OverlayOptions) {
  const escape = useEffectEvent(() => onEscape?.());
  const outside = useEffectEvent((e: PointerEvent) => {
    const anchor = outsideRef?.current;
    if (anchor && e.target instanceof Node && !anchor.contains(e.target)) onOutside?.();
  });

  useEffect(() => {
    if (!active) return;
    const id = Symbol('overlay');
    stack.push(id);
    const panel = trapRef?.current ?? null;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (panel) {
      const first =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ??
        panel;
      first.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        escape();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const els = focusables(panel);
        if (!els.length) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        const cur = document.activeElement;
        if (e.shiftKey && (cur === firstEl || cur === panel || !panel.contains(cur))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (cur === lastEl || !panel.contains(cur))) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (isTop(id)) outside(e);
    };

    document.addEventListener('keydown', onKey);
    if (outsideRef) document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (panel && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, trapRef, outsideRef]);
}
