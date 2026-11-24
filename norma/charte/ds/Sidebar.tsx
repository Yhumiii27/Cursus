'use client';
// Barre latérale commune (Norma 2.0, charte/COQUE.md § 2), reprise de Keystone (src/components/app/shell/sidebar.tsx) :
// marque, recherche de pages ⌘K, entrées fixes, sections par thème repliables, pied (compte ou « Voir en tant que »).
// Le modèle de navigation (quelles pages, quels droits, quels compteurs) reste propre à chaque outil : ces composants ne
// font que le rendu. Classes de charte/coque.css.
import { CaretDown, CaretRight, MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { SIDEBAR_ID, useCoque } from './AppShell';
import { cx } from './cx';
import { matchPages } from './coque-rules';

export { matchPages };

export interface SidebarProps {
  /** Tool name (a proper noun, shown as is). */
  name: string;
  /** Logo glyph in the 26 px accent square. */
  icon: Icon;
  /** `<PageSearch>` (wraps the navigation: hits replace it while a query is typed). */
  children: ReactNode;
  /** Bottom block: the signed-in account menu or the demo "View as" switcher (`.coque-user`). */
  footer?: ReactNode;
}

export function Sidebar({ name, icon: I, children, footer }: SidebarProps) {
  const { t } = useI18n();
  const { navOpen, closeNav } = useCoque();
  return (
    <>
      <div className={cx('coque-backdrop', navOpen && 'is-on')} onClick={() => closeNav(true)} aria-hidden="true" />
      <aside id={SIDEBAR_ID} className={cx('coque-side', navOpen && 'is-open')} aria-label={t('Main menu')}>
        <div className="coque-brand">
          <div className="coque-logo">
            <I size={15} aria-hidden />
          </div>
          <div className="coque-wordmark">{name}</div>
          <button type="button" className="btn btn-ghost btn-icon coque-side-close" onClick={() => closeNav(true)} aria-label={t('Close menu')}>
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
        {footer && <div className="coque-side-foot">{footer}</div>}
      </aside>
    </>
  );
}

export interface PageHit {
  href: string;
  /** Translated label. */
  label: string;
  /** Translated section name shown under the label. */
  section?: string;
  icon?: Icon;
  badge?: ReactNode;
}

export interface PageSearchProps {
  /** Every page the viewer may open (already filtered by rights). */
  pages: PageHit[];
  /** The navigation (entries and sections), shown while the field is empty. */
  children: ReactNode;
}

/** « Aller à une page… » with ⌘K / Ctrl+K; Enter opens the first hit, Escape clears. */
export function PageSearch({ pages, children }: PageSearchProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { closeNav } = useCoque();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => matchPages(pages, q), [pages, q]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setQ('');
    else if (e.key === 'Enter' && hits.length) {
      router.push(hits[0].href);
      setQ('');
      closeNav();
    }
  };

  return (
    <>
      <div className="coque-pagesearch">
        <MagnifyingGlass size={13} className="coque-pagesearch-icon" aria-hidden />
        <input
          ref={ref}
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('Go to a page…')}
          aria-label={t('Go to a page…')}
        />
        <span className="coque-kbd" aria-hidden>
          ⌘K
        </span>
      </div>
      {q.trim() ? (
        <div className="coque-nav">
          {hits.map((h) => {
            const HI = h.icon;
            return (
              <Link key={h.href} href={h.href} className="coque-entry" onClick={() => { setQ(''); closeNav(); }}>
                {HI && <HI size={16} className="coque-entry-icon" aria-hidden />}
                <span className="coque-entry-hit">
                  <span className="coque-entry-label">{h.label}</span>
                  {h.section && <span className="coque-entry-section">{h.section}</span>}
                </span>
                {h.badge != null && <span className="coque-badge">{h.badge}</span>}
              </Link>
            );
          })}
          {!hits.length && <span className="coque-nav-empty">{t('No page matches')}</span>}
        </div>
      ) : (
        children
      )}
    </>
  );
}

export interface NavEntryProps {
  href: string;
  /** Translated label. */
  label: string;
  icon?: Icon;
  active?: boolean;
  /** Count or short text (accent pill). */
  badge?: ReactNode;
  /** Entry inside a section (indented). */
  item?: boolean;
}

/** One page of the menu; `aria-current="page"` when active. Closes the drawer when followed. */
export function NavEntry({ href, label, icon: I, active, badge, item }: NavEntryProps) {
  const { closeNav } = useCoque();
  return (
    <Link href={href} className={cx('coque-entry', item && 'is-item')} aria-current={active ? 'page' : undefined} onClick={() => closeNav()}>
      {I && <I size={16} className="coque-entry-icon" aria-hidden />}
      <span className="coque-entry-label">{label}</span>
      {badge != null && badge !== '' && <span className="coque-badge">{badge}</span>}
    </Link>
  );
}

/** Fixed entries (Home, My work…) above the sections. */
export function NavList({ children }: { children: ReactNode }) {
  return <div className="coque-nav">{children}</div>;
}

/** Container of the sections. */
export function NavSections({ children }: { children: ReactNode }) {
  return <div className="coque-nav-sections">{children}</div>;
}

export interface NavSectionProps {
  /** Translated label (shown in capitals). */
  label: string;
  open: boolean;
  /** Toggle handler; omitted = a fixed (non collapsible) section. */
  onToggle?: () => void;
  /** Section holding the current page (brighter heading). */
  bright?: boolean;
  count?: ReactNode;
  badge?: ReactNode;
  /** Context line under the heading (current project, CAPEX, zone…), typed text shown as is. */
  sub?: ReactNode;
  children: ReactNode;
}

/** A theme of the menu: capital heading with caret, count and badge, then its entries (`<NavEntry item>`). */
export function NavSection({ label, open, onToggle, bright, count, badge, sub, children }: NavSectionProps) {
  const Chev = open ? CaretDown : CaretRight;
  return (
    <div className="coque-sec">
      <button type="button" className={cx('coque-sec-head', bright && 'is-bright')} onClick={onToggle} aria-expanded={onToggle ? open : undefined}>
        <Chev size={11} className="coque-entry-icon" aria-hidden />
        <span className="coque-entry-label">{label}</span>
        {badge != null && <span className="coque-sec-badge">{badge}</span>}
        {count != null && <span className="coque-sec-count">{count}</span>}
      </button>
      {sub != null && <div className="coque-sec-sub">{sub}</div>}
      {open && children}
    </div>
  );
}

/** Sub-group inside a section (capital label, gradient rule, count). */
export function NavGroup({ label, open, onToggle, count }: { label: string; open: boolean; onToggle?: () => void; count?: ReactNode }) {
  const Chev = open ? CaretDown : CaretRight;
  return (
    <button type="button" className="coque-group" onClick={onToggle} aria-expanded={onToggle ? open : undefined}>
      <Chev size={10} className="coque-entry-icon" aria-hidden />
      <span>{label}</span>
      <span className="coque-group-rule" />
      {count != null && <span className="coque-group-count">{count}</span>}
    </button>
  );
}
