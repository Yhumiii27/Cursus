// Barre d'onglets de l'application installée (lot 11, chantier C2, t196) : en mode standalone sur écran étroit, les
// premières entrées du menu de l'espace (collaborateur : Accueil, Mes entretiens, Mes heures, Mes absences) restent sous
// le pouce, avec leurs pastilles, et « Menu » ouvre le tiroir pour le reste. Montrée par app.css seulement sous
// html.standalone (pwa/enregistrement.ts) et à 1024 px et moins ; marges de sécurité de l'écran (env(safe-area-inset-bottom)).
import { ListIcon } from '@phosphor-icons/react';
import { t } from '../i18n/langue.ts';
import { useStore } from '../state/store.tsx';
import type { Onglet } from './onglets.ts';
import type { Tiroir } from './Tiroir.tsx';

export function BarreOnglets({ onglets, tiroir }: { onglets: Onglet[]; tiroir: Tiroir }) {
  const { view, go } = useStore();
  if (!onglets.length) return null;
  return (
    <nav className="barre-onglets" aria-label={t('Quick access')}>
      {onglets.map(o => (
        <a key={o.view} href={`/${o.view}`} className="onglet" aria-current={view === o.view ? 'page' : undefined}
          onClick={e => { e.preventDefault(); tiroir.fermer(); go(o.view); }}>
          <span className="onglet-icone"><o.icon size={22} />{!!o.badge && <span className="onglet-pastille" aria-hidden="true">{o.badge}</span>}</span>
          <span>{t(o.label)}</span>
          {!!o.badge && <span className="sr-only">, {t(`${o.badge} to handle`)}</span>}
        </a>
      ))}
      <button type="button" className="onglet" aria-label={t('Menu')} aria-expanded={tiroir.ouvert} onClick={tiroir.ouvert ? tiroir.fermer : tiroir.ouvrir}>
        <span className="onglet-icone"><ListIcon size={22} /></span>
        <span>{t('Menu')}</span>
      </button>
    </nav>
  );
}
