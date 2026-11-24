// Coque commune de la suite (Norma 2.0, norma/charte/COQUE.md) : en-tête de page, actions, barre d'outils et paire
// langue / affichage. Le client de Cursus est en Vite + React, sans Next.js : les composants de norma/charte/ds qui
// dépendent de next/link ou de next/navigation n'y servent pas ; ceux-ci écrivent le même HTML avec les mêmes classes
// (norma/charte/coque.css) et reprennent les règles pures de la charte (norma/charte/ds/coque-rules.ts).
//
// En-tête de chaque page (`EnTetePage`, COQUE.md § 3), ordre fixe de gauche à droite : fil d'Ariane et titre (le seul
// <h1> de la page, 26 px) · recherche des collaborateurs · actions de la page (l'action principale la plus à droite ;
// au-delà de trois boutons, les autres dans le menu « Actions ») · paire langue / affichage, toujours le dernier élément.
// Sous l'en-tête, la barre d'outils de la page (`.coque-toolbar`) : onglets, filtres et navigation par période passés
// dans `actions` y sont rangés d'office (seuls les boutons restent dans l'en-tête).
import {
  Children, createContext, Fragment, isValidElement, useContext, useEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import { CaretDownIcon, DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { splitActions } from '../../../norma/charte/ds/coque-rules.ts';
import { BoutonLangue } from '../i18n/BoutonLangue.tsx';
import { t } from '../i18n/langue.ts';
import { BoutonTheme } from '../theme/BoutonTheme.tsx';

/** Ce que la coque donne à l'en-tête de chaque page : fil d'Ariane, recherche globale, « Nouvelle session ». */
export interface Coque {
  /** Fil d'Ariane (section › page), déjà traduit ; le nom de l'outil n'y est pas (il est dans la marque). */
  fil: string[];
  /** Recherche des collaborateurs (layout/RechercheGlobale.tsx), quand l'espace ouvre l'annuaire. */
  recherche?: ReactNode;
  /** « Nouvelle session » (service RH, référent HSE) : action principale, ou secondaire si la page a la sienne. */
  nouvelleSession?: (principale: boolean) => ReactNode;
}

export const CoqueContexte = createContext<Coque>({ fil: [] });

/** Paire langue / affichage empilée (COQUE.md § 4) : FR | EN au-dessus de ☾ | ☀, de même taille, bords gauches alignés. */
export function Preferences() {
  return (
    <div className="coque-prefs" data-print-hide="">
      <BoutonLangue />
      <BoutonTheme />
    </div>
  );
}

type Props = { className?: string; variant?: string; children?: ReactNode };

/** Les éléments passés en actions, à plat (fragments ouverts, vides retirés). */
function aPlat(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(c => (isValidElement<Props>(c) && c.type === Fragment ? aPlat(c.props.children) : [c]));
}

/** Un bouton, un lien bouton ou un composant marqué `bouton` (Btn de components/ui.tsx) : action de l'en-tête ; le reste (onglets, listes, période) va dans la barre d'outils. */
export function estBouton(n: ReactNode): boolean {
  if (!isValidElement<Props>(n)) return false;
  if (n.type === 'button' || n.type === 'a') return true;
  return typeof n.type === 'function' && (n.type as { bouton?: boolean }).bouton === true;
}

/** Action principale (contour d'accent) : `variant="primary"` ou la classe `btn-primary`. */
export const estPrincipale = (n: ReactNode) => isValidElement<Props>(n) && (n.props.variant === 'primary' || /\bbtn-primary\b/.test(n.props.className ?? ''));

/**
 * Répartition des actions passées par une page : boutons de l'en-tête (le dernier bouton principal = l'action principale,
 * la plus à droite), autres éléments pour la barre d'outils. « Nouvelle session » s'ajoute : principale si la page n'en
 * a pas, sinon avant elle parmi les secondaires.
 */
export function repartir(actions: ReactNode, nouvelleSession?: (principale: boolean) => ReactNode) {
  const items = aPlat(actions);
  const boutons = items.filter(estBouton);
  const barre = items.filter(n => !estBouton(n));
  let i = -1;
  boutons.forEach((b, k) => { if (estPrincipale(b)) i = k; });
  const principale: ReactNode = i >= 0 ? boutons[i] : nouvelleSession ? nouvelleSession(true) : null;
  const autres = boutons.filter((_, k) => k !== i);
  if (i >= 0 && nouvelleSession) autres.push(nouvelleSession(false));
  return { principale, autres, barre };
}

/** Actions de l'en-tête : jusqu'à trois boutons ; au-delà, l'action principale reste et les autres vont dans le menu. */
function ActionsEnTete({ principale, autres }: { principale: ReactNode; autres: ReactNode[] }) {
  if (!autres.length && principale == null) return null;
  const { menu, buttons } = splitActions(autres, principale);
  return (
    <div className="coque-header-actions" data-print-hide="">
      {menu.length > 0 && <MenuActions>{menu}</MenuActions>}
      {buttons.map((b, k) => <Fragment key={k}>{b}</Fragment>)}
    </div>
  );
}

/** Menu « Actions » : bouton secondaire ⋮ ▾, liste sous lui ; fermé par Échap, par un clic dehors ou au choix d'une action. */
function MenuActions({ children }: { children: ReactNode[] }) {
  const [ouvert, setOuvert] = useState(false);
  const ancre = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: PointerEvent) => { if (!ancre.current?.contains(e.target as Node)) setOuvert(false); };
    const touche = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOuvert(false);
      bouton.current?.focus();
    };
    // Une action choisie dans le menu le referme (le dialogue qu'elle ouvre reste ouvert).
    const choix = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('#actions-page button, #actions-page a')) setOuvert(false); };
    document.addEventListener('pointerdown', clic);
    document.addEventListener('keydown', touche);
    document.addEventListener('click', choix);
    return () => {
      document.removeEventListener('pointerdown', clic);
      document.removeEventListener('keydown', touche);
      document.removeEventListener('click', choix);
    };
  }, [ouvert]);
  return (
    <div ref={ancre} className="coque-actions-anchor">
      <button ref={bouton} type="button" className="btn btn-secondary btn-sm" aria-expanded={ouvert} aria-controls="actions-page" onClick={() => setOuvert(o => !o)}>
        <DotsThreeVerticalIcon size={14} aria-hidden="true" /><span>{t('Actions')}</span><CaretDownIcon size={12} aria-hidden="true" />
      </button>
      <div id="actions-page" hidden={!ouvert} className="elev-md coque-actions-menu">
        {children.map((c, k) => <Fragment key={k}>{c}</Fragment>)}
      </div>
    </div>
  );
}

/** Barre d'outils de la page (COQUE.md § 5), juste sous l'en-tête : onglets, filtres, période. */
export function BarreOutils({ children }: { children: ReactNode }) {
  return <div className="coque-toolbar" data-print-hide="">{children}</div>;
}

export interface EnTeteProps {
  titre: ReactNode;
  /** Étiquettes après le titre (statut). */
  titreAside?: ReactNode;
  /** Une ligne sous le titre (12,5 px). */
  sousTitre?: ReactNode;
  /** Boutons de la page, puis onglets, listes et navigation par période (rangés dans la barre d'outils). */
  actions?: ReactNode;
  /** Fil d'Ariane propre à la page ; sinon celui de la coque (section › page du menu). */
  fil?: string[];
}

/** En-tête commun d'une page (COQUE.md § 3), suivi de sa barre d'outils quand la page en a une. */
export function EnTetePage({ titre, titreAside, sousTitre, actions, fil }: EnTeteProps) {
  const coque = useContext(CoqueContexte);
  const { principale, autres, barre } = repartir(actions, coque.nouvelleSession);
  const parties = fil ?? coque.fil;
  return (
    <>
      <header className="coque-header">
        <div className="coque-header-left">
          {parties.length > 0 && (
            <div className="coque-crumb">
              {parties.map((c, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span className="coque-crumb-sep" aria-hidden="true">/</span>}
                  <span>{c}</span>
                </span>
              ))}
            </div>
          )}
          <div className="coque-title-row">
            {/* Ciblable : reçoit le focus après un changement de page (layout/navigation.ts). */}
            <h1 className="coque-title" tabIndex={-1}>{titre}</h1>
            {titreAside}
          </div>
          {sousTitre != null && <div className="coque-subtitle">{sousTitre}</div>}
        </div>
        {coque.recherche && <div className="coque-header-search">{coque.recherche}</div>}
        <ActionsEnTete principale={principale} autres={autres} />
        <Preferences />
      </header>
      {barre.length > 0 && <BarreOutils>{barre.map((b, k) => <Fragment key={k}>{b as ReactElement}</Fragment>)}</BarreOutils>}
    </>
  );
}
