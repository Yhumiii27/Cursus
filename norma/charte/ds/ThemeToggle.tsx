'use client';
// Bascule sombre / clair de l'en-tête, à côté du sélecteur de langue (Norma 1.0). Change l'attribut data-theme de <html>
// et le cookie epc2i-theme sans aller-retour au serveur ; le serveur relit le cookie aux pages suivantes.
import { Moon, Sun } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { Segmented } from './Segmented';
import { themeCookie, type Theme } from './theme';

export function ThemeToggle({ theme: initial }: { theme: Theme }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(initial);
  return (
    <Segmented
      label={t('Dark / light display')}
      value={theme}
      onChange={(v) => {
        setTheme(v);
        document.documentElement.dataset.theme = v;
        document.cookie = themeCookie(v);
      }}
      options={[
        { value: 'dark' as Theme, label: '', icon: Moon, title: t('Dark display') },
        { value: 'light' as Theme, label: '', icon: Sun, title: t('Light display') },
      ]}
    />
  );
}
