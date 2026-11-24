// Tuiles KPI (Norma 2.0, charte/COQUE.md § 6), reprise de Keystone (src/components/app/Kpi.tsx). Server-compatible.
// Une valeur en alerte porte toujours l'icône d'avertissement (jamais la couleur seule, WCAG 1.4.1).
import { Warning } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

/** `repeat(auto-fit, minmax(min, 1fr))`, gap 10 px. `min`: 150 (default), 160, 170 (accueil). */
export function KpiGrid({ min = 150, children }: { min?: number; children: ReactNode }) {
  return (
    <div className="coque-kpis" style={{ '--kpi-min': `${min}px` } as CSSProperties}>
      {children}
    </div>
  );
}

export interface KpiTileProps {
  /** Capital label (translated). */
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: Icon;
  /** `alert`: value in accent-300 with the warning icon; `alertLabel` is read by screen readers. */
  alert?: boolean;
  alertLabel?: string;
  /** `lg`: 24 px value (accueil). */
  size?: 'md' | 'lg';
}

export function KpiTile({ label, value, sub, icon: I, alert, alertLabel, size = 'md' }: KpiTileProps) {
  return (
    <div className={cx('card', 'elev-sm', 'coque-kpi', alert && 'is-alert', size === 'lg' && 'is-lg')}>
      <div className="coque-kpi-label">{label}</div>
      <div className="coque-kpi-value">
        {value}
        {alert && <Warning size={14} weight="bold" aria-label={alertLabel} role={alertLabel ? 'img' : undefined} aria-hidden={alertLabel ? undefined : true} />}
      </div>
      {(sub != null || I) && (
        <div className="coque-kpi-sub">
          {I && <I aria-hidden />}
          {sub}
        </div>
      )}
    </div>
  );
}
