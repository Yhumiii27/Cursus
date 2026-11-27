'use client';
// Tronc commun des menus (Norma 2.4, charte/COQUE.md § 2 bis) : le premier bloc de la barre latérale de chaque outil,
// juste sous la recherche de pages — Accueil, Mes tâches, Mes approbations, puis une ou deux entrées propres au métier —,
// avant les sections par thème. Même place, même ordre, mêmes icônes, mêmes libellés partout ; les pastilles comptent les
// tâches et approbations ouvertes de la personne dans toute la suite. Le modèle est ./base-nav.ts.
import {
  Books, CalendarDots, CalendarX, CheckSquare, Clock, Cube, Database, FileText, Flask, FlowArrow, FolderUser, Gauge, Gear, Handshake,
  House, Key, ListChecks, PaperPlaneTilt, Siren, SquaresFour, Stamp, TreeStructure, Truck,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { NavEntry } from './Sidebar';
import { activeEntry, baseNav, type BaseIcon, type BaseNavOptions } from './base-nav';
import type { ToolCode } from './ToolLogo';

export const BASE_ICONS: Record<BaseIcon, Icon> = {
  House, CheckSquare, Stamp, FolderUser, Gauge, Books, FileText, Siren, ListChecks, Clock, CalendarX, SquaresFour, CalendarDots,
  Flask, TreeStructure, Key, Database, FlowArrow, Handshake, Cube, Truck, PaperPlaneTilt, Gear,
};

export interface BaseNavProps extends BaseNavOptions {
  tool: ToolCode;
  /** Current path (default: `usePathname()`); the tool may pass its own when an entry covers several routes. */
  pathname?: string;
  /** Active entry forced by the tool (e.g. a task sheet `/my/tasks/[id]` already matches « Mes tâches »). */
  active?: string | null;
}

/** First block of the sidebar: `<BaseNav tool="arche" counts={{ tasks: 4, approvals: 2 }} />` inside `<PageSearch>`. */
export function BaseNav({ tool, pathname, active, ...opts }: BaseNavProps) {
  const { t } = useI18n();
  const current = usePathname();
  const items = baseNav(tool, opts);
  const on = active !== undefined ? active : activeEntry(items, pathname ?? current ?? '/');
  return (
    <nav className="coque-nav coque-base-nav" aria-label={t('Common menu')}>
      {items.map((it) => (
        <NavEntry key={it.id} href={it.href} label={t(it.label)} icon={BASE_ICONS[it.icon]} active={on === it.id} badge={it.badge} />
      ))}
    </nav>
  );
}
