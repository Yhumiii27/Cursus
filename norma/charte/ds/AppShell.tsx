'use client';
// Coque commune (Norma 2.0, charte/COQUE.md § 1 et § 8) : grille barre latérale | contenu, lien d'évitement, état du tiroir
// (≤ 1024 px) et barre supérieure. Classes de charte/coque.css. Reprise de Keystone (app/(app)/layout.tsx, nav-toggle.tsx,
// sidebar.tsx : tiroir, inertie de la page, Échap, retour du focus).
import { List } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { cx } from './cx';

/** Media query of the compact layout (sidebar as a drawer, top bar). Same value as coque.css. */
export const COMPACT_MEDIA = '(max-width: 1024px)';
export const SIDEBAR_ID = 'coque-sidebar';
export const NAV_TOGGLE_ID = 'coque-nav-toggle';
export const MAIN_ID = 'main-content';

interface CoqueState {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  /** Closes the drawer; `focusToggle` gives the focus back to the menu button (Escape, backdrop, close button). */
  closeNav: (focusToggle?: boolean) => void;
}

const CoqueCtx = createContext<CoqueState>({ navOpen: false, setNavOpen: () => {}, closeNav: () => {} });

/** Drawer state of the shell (read by Sidebar and MobileTopBar). */
export const useCoque = () => useContext(CoqueCtx);

export interface AppShellProps {
  /** `<Sidebar>` of the tool. */
  sidebar: ReactNode;
  /** `<MobileTopBar>` (shown ≤ 1024 px only, first element of <main>). */
  topbar: ReactNode;
  /** Toast viewport or other live regions, rendered after the grid. */
  after?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function AppShell({ sidebar, topbar, after, className, children }: AppShellProps) {
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);
  const returnFocus = useRef(false);
  const state = useMemo<CoqueState>(
    () => ({
      navOpen,
      setNavOpen,
      closeNav: (focusToggle = false) => {
        returnFocus.current = focusToggle;
        setNavOpen(false);
      },
    }),
    [navOpen],
  );

  // Drawer open in the compact layout: the page behind is inert, Escape closes it, widening the window closes it.
  useEffect(() => {
    if (!navOpen) return;
    const media = window.matchMedia(COMPACT_MEDIA);
    if (!media.matches) return;
    const main = document.getElementById(MAIN_ID);
    if (main) main.inert = true;
    document.getElementById(SIDEBAR_ID)?.querySelector<HTMLElement>('.coque-side-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      returnFocus.current = true;
      setNavOpen(false);
    };
    const onMedia = () => {
      if (!media.matches) setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onMedia);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onMedia);
      if (main) main.inert = false;
      if (returnFocus.current) document.getElementById(NAV_TOGGLE_ID)?.focus();
      returnFocus.current = false;
    };
  }, [navOpen]);

  return (
    <CoqueCtx.Provider value={state}>
      <a href={`#${MAIN_ID}`} className="coque-skip">
        {t('Skip to main content')}
      </a>
      <div className={cx('coque', className)}>
        {sidebar}
        <main id={MAIN_ID} tabIndex={-1} className="coque-main">
          {topbar}
          {children}
        </main>
      </div>
      {after}
    </CoqueCtx.Provider>
  );
}

export interface MobileTopBarProps {
  /** Tool name (a proper noun, not translated). */
  name: string;
  icon: Icon;
  /** Optional tools before the language / display pair (e.g. the bell). */
  tools?: ReactNode;
  /** `<PrefsStack>` — always the last element, at the right end of the top bar. */
  prefs: ReactNode;
}

/** Top bar of the compact layout (≤ 1024 px): menu button · tool name · … · tools · language / display pair. */
export function MobileTopBar({ name, icon: I, tools, prefs }: MobileTopBarProps) {
  const { t } = useI18n();
  const { navOpen, setNavOpen } = useCoque();
  return (
    <div className="coque-topbar" data-print-hide>
      <button
        id={NAV_TOGGLE_ID}
        type="button"
        className="btn btn-secondary coque-menu-btn"
        aria-controls={SIDEBAR_ID}
        aria-expanded={navOpen}
        onClick={() => setNavOpen(!navOpen)}
      >
        <List size={18} aria-hidden />
        <span>{t('Menu')}</span>
      </button>
      <span className="coque-topbar-brand">
        <I size={15} className="coque-topbar-logo" aria-hidden />
        {name}
      </span>
      <div className="coque-topbar-tools">
        {tools}
        {prefs}
      </div>
    </div>
  );
}
