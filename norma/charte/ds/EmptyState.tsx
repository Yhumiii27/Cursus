// État vide (Norma 2.0, charte/COQUE.md § 6), repris de Keystone (src/components/app/EmptyState.tsx). Server-compatible.
// `inline` : sous une liste ou un tableau ; `boxed` : à la place d'un bloc entier. Texte traduit, jamais une erreur.
import type { ReactNode } from 'react';
import { cx } from './cx';

export function EmptyState({ variant = 'inline', children }: { variant?: 'inline' | 'boxed'; children: ReactNode }) {
  return variant === 'boxed' ? <div className={cx('coque-empty', 'is-boxed')}>{children}</div> : <span className="coque-empty">{children}</span>;
}
