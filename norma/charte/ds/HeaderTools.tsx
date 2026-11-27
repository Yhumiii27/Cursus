'use client';
// Outils communs de l'en-tête (Norma 2.0, charte/COQUE.md § 4) : date de situation, aide, cloche (emplacements), puis la
// paire langue / affichage — deux sélecteurs empilés de même taille (FR | EN au-dessus, sombre | clair dessous), toujours
// le dernier élément à droite de l'en-tête de page (> 1024 px) et de la barre supérieure (≤ 1024 px).
// Demande du propriétaire (24 novembre 2026) : « les boutons de changement de langue et thème clair/sombre alignés l'un
// au-dessus de l'autre et de même taille ».
import { CalendarBlank, Moon, Sun } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { themeCookie, type Theme } from './theme';

export type Lang = 'fr' | 'en';

/** Event sent on `document` when the display changes, so that every copy of the switch (header, top bar) follows. */
export const THEME_EVENT = 'atrium-theme';

interface PrefOption<V extends string> {
  value: V;
  /** Visible text ('' for an icon-only option). */
  text: string;
  icon?: Icon;
  /** Accessible name and tooltip (translated). */
  name: string;
  lang?: string;
  disabled?: boolean;
}

/** Two-option switch of the pair: fixed option width and height (`--pref-opt-w`, `--pref-h`), `aria-pressed`. */
function PrefSwitch<V extends string>({ label, value, options, onPick }: { label: string; value: V; options: PrefOption<V>[]; onPick: (v: V) => void }) {
  return (
    <div role="group" aria-label={label} className="coque-pref">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="coque-pref-opt"
          aria-pressed={o.value === value}
          aria-label={o.text ? undefined : o.name}
          title={o.name}
          lang={o.lang}
          disabled={o.disabled}
          onClick={() => o.value !== value && onPick(o.value)}
        >
          {o.icon ? <o.icon aria-hidden /> : o.text}
        </button>
      ))}
    </div>
  );
}

export interface LangSwitchProps {
  lang: Lang;
  /** Saves the choice (a Server Action setting the tool's language cookie, or a client handler). */
  onSelect: (lang: Lang) => unknown;
  /** Re-render the page after the choice (default true: `router.refresh()`). */
  refresh?: boolean;
  /** Languages the tool's interface has; the others are shown disabled (a French-only tool keeps the same block). */
  available?: readonly Lang[];
}

export function LangSwitch({ lang, onSelect, refresh = true, available = ['fr', 'en'] }: LangSwitchProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <PrefSwitch<Lang>
      label={t('Language')}
      value={lang}
      onPick={(v) =>
        start(async () => {
          await onSelect(v);
          if (refresh) router.refresh();
        })
      }
      options={[
        { value: 'fr', text: 'FR', name: 'Français', lang: 'fr', disabled: !available.includes('fr') },
        { value: 'en', text: 'EN', name: 'English', lang: 'en', disabled: !available.includes('en') },
      ]}
    />
  );
}

/** Dark / light display: sets `data-theme` on <html> and the suite's `atrium-theme` cookie, without a server round trip. */
export function ThemeSwitch({ theme: initial }: { theme: Theme }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const follow = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    document.addEventListener(THEME_EVENT, follow);
    return () => document.removeEventListener(THEME_EVENT, follow);
  }, []);
  return (
    <PrefSwitch<Theme>
      label={t('Dark / light display')}
      value={theme}
      onPick={(v) => {
        document.documentElement.dataset.theme = v;
        document.cookie = themeCookie(v);
        document.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: v }));
      }}
      options={[
        { value: 'dark', text: '', icon: Moon, name: t('Dark display') },
        { value: 'light', text: '', icon: Sun, name: t('Light display') },
      ]}
    />
  );
}

export interface PrefsStackProps extends Omit<LangSwitchProps, 'lang'> {
  lang: Lang;
  theme: Theme;
}

/** The pair, stacked: language on top, display below, same width and height, left edges aligned. */
export function PrefsStack({ lang, theme, ...langProps }: PrefsStackProps) {
  return (
    <div className="coque-prefs" data-print-hide>
      <LangSwitch lang={lang} {...langProps} />
      <ThemeSwitch theme={theme} />
    </div>
  );
}

/** « Date de situation · 25 sept. 2026 » (business date of the tool, already formatted). */
export function StatusDate({ children }: { children: ReactNode }) {
  return (
    <span className="coque-status-date">
      <CalendarBlank aria-hidden />
      {children}
    </span>
  );
}

export interface HeaderToolsProps {
  /** `<StatusDate>` when the tool has a business date. */
  date?: ReactNode;
  /** Assistant or help button (icon button, named). */
  help?: ReactNode;
  /** Notifications bell (`IconButton` with `.coque-bell`, its panel), always right before the pair. */
  bell?: ReactNode;
  /** `<PrefsStack>` — the last element. */
  prefs: ReactNode;
}

/** Fixed order of the common tools: date · help · bell · language / display pair. */
export function HeaderTools({ date, help, bell, prefs }: HeaderToolsProps) {
  return (
    <>
      {(date || help || bell) && (
        <div className="coque-header-tools" data-print-hide>
          {date}
          {help}
          {bell}
        </div>
      )}
      {prefs}
    </>
  );
}
