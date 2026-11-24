// En-tête de page commun (Norma 2.0, charte/COQUE.md § 3), repris de Keystone (src/components/app/shell/page-header.tsx).
// Server-compatible. Ordre fixe, de gauche à droite :
//   [fil d'Ariane / titre (+ étiquettes) / sous-titre]  [recherche globale]  [actions de la page]  [date · aide · cloche]
//   [langue / affichage empilés]
// puis, sous l'en-tête : le bandeau « hors de mon espace » et la barre d'outils de la page (onglets, filtres, période).
import { Eye } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { HeaderActions } from './HeaderActions';
import { HeaderTools } from './HeaderTools';

export interface PageHeaderProps {
  /** Page title, translated (or typed text shown as is). Rendered as the page's only <h1>. */
  title: ReactNode;
  /** Breadcrumb parts, already translated; the tool's name is not repeated (it is in the sidebar). */
  crumbs?: ReactNode[];
  /** Tags after the title (health, status, « Lecture seule »). */
  titleAside?: ReactNode;
  /** One line under the title (12.5 px, neutral-400). */
  subtitle?: ReactNode;
  /** Global search field of the tool (`.coque-header-search`), when it has one. */
  search?: ReactNode;
  /** Main action (accent), the rightmost action. Hidden by the page when the viewer may not act. */
  primary?: ReactNode;
  /** Other actions; beyond three buttons in all they go in the « Actions » menu. */
  actions?: ReactNode;
  /** Common tools (see HeaderTools). */
  date?: ReactNode;
  help?: ReactNode;
  bell?: ReactNode;
  /** `<PrefsStack>`: language over display, always the last element. */
  prefs: ReactNode;
  /** Read-only banner text (translated) when the page is outside the viewer's workspace. */
  outside?: ReactNode;
  /** Tabs, segmented views, filters and period navigation of the page (`<FilterBar>`), right under the header. */
  toolbar?: ReactNode;
}

export function PageHeader({ title, crumbs, titleAside, subtitle, search, primary, actions, date, help, bell, prefs, outside, toolbar }: PageHeaderProps) {
  return (
    <>
      <header className="coque-header">
        <div className="coque-header-left">
          {crumbs && crumbs.length > 0 && (
            <div className="coque-crumb">
              {crumbs.map((c, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span className="coque-crumb-sep">/</span>}
                  <span>{c}</span>
                </span>
              ))}
            </div>
          )}
          <div className="coque-title-row">
            <h1 className="coque-title">{title}</h1>
            {titleAside}
          </div>
          {subtitle != null && <div className="coque-subtitle">{subtitle}</div>}
        </div>
        {search && <div className="coque-header-search">{search}</div>}
        <HeaderActions primary={outside ? undefined : primary} actions={outside ? undefined : actions} />
        <HeaderTools date={date} help={help} bell={bell} prefs={prefs} />
      </header>
      {outside && (
        <div className="coque-outside" role="note">
          <Eye size={16} aria-hidden />
          <span>{outside}</span>
        </div>
      )}
      {toolbar}
    </>
  );
}
