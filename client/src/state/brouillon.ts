// Brouillon conservé pendant une reconnexion Microsoft (session expirée) : la redirection vers Microsoft
// quitte la page, et avec elle l'état des écrans. Avant de partir, Cursus garde dans l'onglet
// (sessionStorage, effacé à sa fermeture) l'espace, la page, les filtres, le dialogue ouvert et les
// valeurs de ses champs ; au retour, pour le même compte et dans les 30 minutes, il les restaure puis
// efface le brouillon. Les champs sont lus et réécrits dans le DOM du dialogue (attribut data-brouillon,
// posé par <Dialog>) : les dialogues n'ont rien à déclarer. Jamais de mot de passe : champs « password »
// ignorés, dialogues de mot de passe non conservés.
import type { Role } from '../../../shared/types.ts';
import type { DialogState, UiState } from './store.tsx';

/** Valeur de chaque champ du dialogue, par clé (voir `champs`). */
export type Champs = Record<string, string | boolean>;

export interface Brouillon {
  compteId: number;
  role: Role;
  view: string;
  ui: UiState;
  dialog: DialogState | null;
  champs: Champs | null;
  /** Enregistrement (ms) : le brouillon vaut 30 minutes. */
  at: number;
}

const CLE = 'cursus.brouillon';
const VALIDITE_MS = 30 * 60_000;
/** Dialogues qui portent ou demandent un mot de passe : jamais conservés. */
const SANS_BROUILLON = new Set<DialogState['type']>(['motDePasse', 'motDePasseProvisoire']);
/** Champs jamais lus : mots de passe, fichiers, boutons. */
const IGNORES = new Set(['password', 'file', 'hidden', 'submit', 'button', 'reset', 'image']);

type Champ = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Enregistre le brouillon (espace, page, filtres, dialogue ouvert et ses champs). */
export function sauverBrouillon(b: Omit<Brouillon, 'at' | 'champs'>) {
  const dialog = b.dialog && !SANS_BROUILLON.has(b.dialog.type) ? b.dialog : null;
  const x: Brouillon = { ...b, dialog, champs: dialog ? capturerChamps() : null, at: Date.now() };
  try { sessionStorage.setItem(CLE, JSON.stringify(x)); } catch { /* stockage refusé (navigation privée) : rien n'est conservé */ }
}

/** Brouillon de moins de 30 minutes, ou null (un brouillon périmé est effacé). */
export function lireBrouillon(): Brouillon | null {
  try {
    const raw = sessionStorage.getItem(CLE);
    if (!raw) return null;
    const b = JSON.parse(raw) as Brouillon;
    if (typeof b.compteId === 'number' && Date.now() - b.at < VALIDITE_MS) return b;
  } catch { /* brouillon illisible : effacé */ }
  effacerBrouillon();
  return null;
}

export function effacerBrouillon() {
  try { sessionStorage.removeItem(CLE); } catch { /* rien à effacer */ }
}

const coche = (el: Champ): el is HTMLInputElement => el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');

/**
 * Champs saisissables d'un dialogue, avec une clé stable d'un affichage à l'autre : l'id du champ ;
 * sinon, pour un bouton radio, son groupe et son rang dans le groupe ; sinon le rang parmi les champs sans id.
 */
function champs(racine: HTMLElement): [string, Champ][] {
  const out: [string, Champ][] = [];
  const rangs = new Map<string, number>();
  const rang = (k: string) => { const n = rangs.get(k) ?? 0; rangs.set(k, n + 1); return n; };
  racine.querySelectorAll<Champ>('input, select, textarea').forEach(el => {
    if (el instanceof HTMLInputElement && IGNORES.has(el.type)) return;
    if (el.id) out.push([`#${el.id}`, el]);
    else if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) out.push([`radio:${el.name}:${rang(`radio:${el.name}`)}`, el]);
    else {
      const type = `${el.tagName.toLowerCase()}:${el instanceof HTMLInputElement ? el.type : ''}`;
      out.push([`${type}:${rang(type)}`, el]);
    }
  });
  return out;
}

function capturerChamps(): Champs | null {
  const racine = document.querySelector<HTMLElement>('[data-brouillon]');
  return racine ? lireChamps(racine) : null;
}

/** Valeur de chaque champ saisissable d'un dialogue (mots de passe exclus). */
export function lireChamps(racine: HTMLElement): Champs {
  const out: Champs = {};
  for (const [k, el] of champs(racine)) out[k] = coche(el) ? el.checked : el.value;
  return out;
}

/**
 * Saisie modifiée depuis l'ouverture du dialogue (components/Dialog.tsx : confirmation avant de la perdre).
 * Un champ apparu depuis compte s'il n'est pas vide ; sans relevé de départ, toute valeur compte.
 */
export function saisieModifiee(initial: Champs | null, actuel: Champs | null): boolean {
  if (!actuel) return false;
  const vide = (v: string | boolean | undefined) => v === undefined || v === '' || v === false;
  return Object.entries(actuel).some(([k, v]) => initial && k in initial ? initial[k] !== v : !vide(v));
}

/**
 * Écrit une valeur comme le ferait la personne : le setter natif puis l'événement que React écoute
 * (input, change ou clic), pour que l'état du dialogue suive.
 */
function ecrire(el: Champ, v: string | boolean): boolean {
  if (coche(el)) {
    // Un bouton radio ne se décoche pas : un autre du groupe sera coché à sa place.
    if (typeof v !== 'boolean' || el.checked === v || (el.type === 'radio' && !v) || el.disabled) return false;
    el.click();
    return true;
  }
  if (typeof v !== 'string' || el.value === v || el.disabled) return false;
  // Liste dont l'option n'existe pas encore (elle dépend d'un autre champ) : passe suivante.
  if (el instanceof HTMLSelectElement && ![...el.options].some(o => o.value === v)) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
}

/** Réécrit les champs du dialogue en quelques passes : un champ peut n'apparaître qu'après un autre. */
export function restaurerChamps(racine: HTMLElement, valeurs: Champs) {
  let passes = 6;
  const passe = () => {
    if (!racine.isConnected) return;
    let ecrits = 0;
    for (const [k, el] of champs(racine)) if (k in valeurs && ecrire(el, valeurs[k])) ecrits++;
    if (ecrits && --passes > 0) setTimeout(passe, 40);
  };
  setTimeout(passe, 0);
}
