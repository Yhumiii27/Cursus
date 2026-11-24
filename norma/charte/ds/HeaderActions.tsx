'use client';
// Actions de la page dans l'en-tête (Norma 2.0, charte/COQUE.md § 3.3), reprise d'Arche (header-actions.tsx, retour du
// propriétaire du 25 octobre 2026) : jusqu'à trois boutons ; au-delà, l'action principale reste un bouton (la plus à
// droite) et les autres vont dans le menu « Actions ». Le menu reste monté fermé : un panneau latéral ouvert par une action
// (portail) garde son état.
import { CaretDown, DotsThreeVertical } from '@phosphor-icons/react/dist/ssr';
import { Children, Fragment, createContext, isValidElement, useContext, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from './Button';
import { useOverlay } from './overlay';
import { cx } from './cx';
import { splitActions } from './coque-rules';

export { MAX_HEADER_BUTTONS, splitActions } from './coque-rules';

/** Inside the « Actions » menu: an action renders as a menu row (`MenuItem`) and calls `close()` when chosen. */
export const HeaderMenuContext = createContext<{ close: () => void } | null>(null);
export const useHeaderMenu = () => useContext(HeaderMenuContext);

/** The actions as a flat list (fragments opened, empty ones dropped). */
function flat(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((c) => (isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment ? flat(c.props.children) : [c]));
}

export interface HeaderActionsProps {
  /** Main action of the page (accent button), the rightmost one. */
  primary?: ReactNode;
  /** Other actions, in order; client elements only so that they can be counted. */
  actions?: ReactNode;
}

export function HeaderActions({ primary, actions }: HeaderActionsProps) {
  const items = flat(actions);
  const main = primary ?? null;
  if (!items.length && main == null) return null;
  const { menu, buttons } = splitActions(items, main);
  return (
    <div className="coque-header-actions" data-print-hide>
      {menu.length > 0 && <ActionsMenu>{menu}</ActionsMenu>}
      {buttons}
    </div>
  );
}

function ActionsMenu({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  useOverlay({ active: open, onEscape: () => setOpen(false), outsideRef: anchorRef, onOutside: () => setOpen(false) });
  return (
    <div ref={anchorRef} className="coque-actions-anchor">
      <Button variant="secondary" size="sm" icon={DotsThreeVertical} iconRight={CaretDown} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {t('Actions')}
      </Button>
      <div role="menu" hidden={!open} className={cx('elev-md', 'coque-actions-menu')}>
        <HeaderMenuContext.Provider value={{ close: () => setOpen(false) }}>{children}</HeaderMenuContext.Provider>
      </div>
    </div>
  );
}
