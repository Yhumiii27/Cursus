// Focus des fenêtres modales (dialogues, erreur d'un dialogue) : focus initial dans la fenêtre, Tab et Maj+Tab
// qui bouclent sur ses éléments sans jamais atteindre la page derrière, focus rendu à la fermeture à l'élément
// qui l'a ouverte (ou au titre de la page s'il a disparu entre-temps, ligne traitée par l'action).
import { useEffect, useRef, type RefObject } from 'react';

/** Éléments susceptibles de recevoir le focus au clavier (filtrés ensuite : désactivés, masqués, tabindex négatif). */
const FOCUSABLES = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';
/** Fenêtre modale ouverte (dialogue, reconnexion) : sa présence empêche de rendre le focus à la page. */
const MODALE = '[aria-modal="true"]';

/** Nombre d'éléments `n`, rang de l'élément actif (-1 : hors de la fenêtre) : rang visé par Tab, ou null (le navigateur avance seul). */
export function rangTabulation(n: number, actuel: number, arriere: boolean): number | null {
  if (n === 0) return null;
  if (actuel < 0) return arriere ? n - 1 : 0;
  if (arriere && actuel === 0) return n - 1;
  if (!arriere && actuel === n - 1) return 0;
  return null;
}

/** Éléments atteignables par Tab dans `racine`, dans l'ordre du document ; un seul arrêt par groupe de boutons radio. */
export function tabulables(racine: HTMLElement): HTMLElement[] {
  const groupes = new Set<string>();
  return [...racine.querySelectorAll<HTMLElement>(FOCUSABLES)].filter(el => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[inert], fieldset:disabled')) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    // Élément non affiché (display: none, contenu d'un <details> fermé) ; un bouton radio stylé, de taille nulle, compte.
    if (!el.getClientRects().length) return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      // Le navigateur ne s'arrête que sur le bouton coché du groupe, ou sur le premier s'il n'y en a pas.
      const groupe = [...racine.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(r => r.name === el.name);
      const coche = groupe.find(r => r.checked);
      if (coche ? coche !== el : groupes.has(el.name)) return false;
      groupes.add(el.name);
    }
    return true;
  });
}

/** Écran tactile : le focus initial reste sur la fenêtre, pour ne pas ouvrir le clavier virtuel par-dessus le formulaire. */
const tactile = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Focus initial : un élément déjà ciblé par le dialogue (autoFocus) le garde ; sinon le premier champ de saisie ;
 * sinon (confirmation, information) la fenêtre elle-même, dont le titre est alors annoncé.
 */
export function focusInitial(fenetre: HTMLElement) {
  if (fenetre.contains(document.activeElement)) return;
  const champ = tactile() ? undefined : tabulables(fenetre).find(el => el.matches('input, select, textarea'));
  (champ ?? fenetre).focus();
}

// Dernier élément ciblé hors de toute fenêtre modale : le bouton qui ouvre le dialogue. Un toucher compte aussi
// (Safari ne donne pas le focus à un bouton touché ou cliqué).
let origine: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  const noter = (ev: Event) => {
    const el = ev.target instanceof Element ? ev.target.closest<HTMLElement>(FOCUSABLES) : null;
    if (el && !el.closest(MODALE)) origine = el;
  };
  document.addEventListener('focusin', noter, true);
  document.addEventListener('pointerdown', noter, true);
}

/**
 * Repli quand l'élément d'origine a disparu (ligne traitée, fiche fermée) : le titre de la page, rendu ciblable le
 * temps d'y être (Tab repart du haut du contenu, un lecteur d'écran annonce la page).
 */
function titreDeLaPage(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main');
  if (el && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }
  return el;
}

/** Rend le focus à la page : à l'élément d'origine s'il est toujours là, sinon au titre de la page. */
function rendreFocus(el: HTMLElement | null) {
  if (document.querySelector(MODALE)) return; // un autre dialogue s'est ouvert à la place
  const cible = el?.isConnected && !el.closest('[inert]') && !(el as HTMLButtonElement).disabled ? el : titreDeLaPage();
  cible?.focus();
}

/**
 * Fenêtre modale `ref` : focus initial, Tab bouclé dans la fenêtre, focus ramené s'il s'en échappe, rendu à la
 * fermeture. `actif` faux (reconnexion affichée par-dessus) : la fenêtre laisse le focus à celle du dessus,
 * puis le reprend.
 */
export function useModale(ref: RefObject<HTMLElement | null>, actif: boolean) {
  const actifRef = useRef(actif);
  actifRef.current = actif;
  // Dernier élément ciblé dans la fenêtre : y revenir si le focus en sort (clic sur une notification…).
  const dernier = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const depart = origine;
    const fenetre = ref.current;
    if (fenetre && actifRef.current) focusInitial(fenetre);
    const onKey = (ev: KeyboardEvent) => {
      const f = ref.current;
      if (ev.key !== 'Tab' || !f || !actifRef.current || ev.defaultPrevented) return;
      const liste = tabulables(f);
      const actuel = document.activeElement as HTMLElement | null;
      const i = actuel ? liste.indexOf(actuel) : -1;
      // Élément de la fenêtre hors de la liste (message d'erreur ciblé) : le navigateur passe au suivant.
      if (i < 0 && actuel && actuel !== f && f.contains(actuel)) return;
      const rang = rangTabulation(liste.length, i, ev.shiftKey);
      if (liste.length === 0) { ev.preventDefault(); f.focus(); return; }
      if (rang == null) return;
      ev.preventDefault();
      liste[rang].focus();
    };
    const onFocus = (ev: FocusEvent) => {
      const f = ref.current;
      const cible = ev.target instanceof HTMLElement ? ev.target : null;
      if (!f || !cible) return;
      if (f.contains(cible)) { dernier.current = cible; return; }
      // Notifications et reconnexion restent atteignables ; tout le reste de la page est derrière la fenêtre.
      if (!actifRef.current || cible.closest('.toasts, .reconnexion')) return;
      const retour = dernier.current?.isConnected && f.contains(dernier.current) ? dernier.current : null;
      if (retour) retour.focus(); else focusInitial(f);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      rendreFocus(depart);
    };
  }, [ref]);

  // Fin de la reconnexion : le focus revient dans la fenêtre restée ouverte.
  useEffect(() => {
    const f = ref.current;
    if (actif && f && !f.contains(document.activeElement)) {
      const retour = dernier.current?.isConnected && f.contains(dernier.current) ? dernier.current : null;
      if (retour) retour.focus(); else focusInitial(f);
    }
  }, [actif, ref]);
}
