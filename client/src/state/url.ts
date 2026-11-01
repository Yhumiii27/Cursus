// Sélection et filtres dans l'adresse de la page (t154) : un lien vers une fiche, une feuille de temps ou une liste
// filtrée se partage et résiste à F5. Chaque vue déclare les champs de UiState qu'elle met dans l'adresse, sous un nom
// de paramètre en français et avec des valeurs lisibles (/collaborateurs?fiche=12&statut=a-renouveler,
// /temps?salarie=12&semaine=2027-01-04). Jamais de texte libre (la recherche reste en mémoire) ni de donnée
// personnelle : un identifiant numérique, un code du référentiel, une date, une énumération.
// À la lecture, toute valeur est contrôlée : énumération connue, lundi au format ISO, identifiant présent dans le jeu
// de données reçu (déjà limité par le serveur au périmètre du rôle). Une valeur inconnue ou hors du périmètre est
// ignorée sans message : la vue s'ouvre sans sélection. Aucun dialogue ne s'ouvre depuis l'adresse.
// Historique (state/store.tsx) : l'ouverture d'une fiche ajoute une entrée (Précédent la referme), un filtre remplace
// l'entrée courante.
import { isValidDate, weekday } from '../../../shared/dates.ts';
import type { Dataset } from '../../../shared/types.ts';
import type { UiState, View } from './store.tsx';
// lot 11 — indicateurs
import { anneeIndicateursValide, GROUPES_INDICATEURS } from '../../../shared/rules/indicateurs-legaux.ts';
import { ONGLETS_INDICATEURS } from '../pages/indicateurs-onglets.ts';

/** Paramètre de l'adresse : champ de UiState, nom affiché, valeur par défaut (absente de l'adresse), lecture contrôlée. */
interface Param<K extends keyof UiState = keyof UiState> {
  cle: K;
  nom: string;
  /** Valeur de départ de l'écran (INITIAL_UI de state/store.tsx) : jamais écrite dans l'adresse. */
  defaut: UiState[K];
  /** Valeur lue, ou undefined si elle est invalide ou hors du périmètre. */
  lire: (brut: string, data: Dataset) => UiState[K] | undefined;
  ecrire: (v: UiState[K]) => string;
  /** Ouvre une fiche ou une feuille : nouvelle entrée de l'historique. */
  fiche?: boolean;
}

const param = <K extends keyof UiState>(p: Param<K>): Param => p as unknown as Param;

/** Entier strictement positif écrit en chiffres seulement (pas de « 12abc », de « 1e3 » ni de « 012 »). */
const entier = (brut: string): number | undefined => /^[1-9]\d{0,8}$/.test(brut) ? Number(brut) : undefined;

/** Identifiant numérique présent dans la liste du jeu de données. */
function identifiant<K extends keyof UiState>(cle: K, nom: string, liste: (data: Dataset) => { id: number }[]): Param {
  return param<K>({
    cle, nom, defaut: null as UiState[K], fiche: true,
    lire: (brut, data) => { const id = entier(brut); return id != null && liste(data).some(x => x.id === id) ? id as UiState[K] : undefined; },
    ecrire: v => String(v),
  });
}

/** Code d'un référentiel (formation, habilitation, chantier), présent dans le jeu de données. */
function code<K extends keyof UiState>(cle: K, nom: string, liste: (data: Dataset) => { id: string }[]): Param {
  return param<K>({
    cle, nom, defaut: null as UiState[K],
    lire: (brut, data) => liste(data).some(x => x.id === brut) ? brut as UiState[K] : undefined,
    ecrire: v => String(v),
  });
}

/** Énumération : valeur interne ↔ valeur de l'adresse en français ; la valeur par défaut n'a pas de libellé. */
function choix<K extends keyof UiState>(cle: K, nom: string, defaut: UiState[K], libelles: Partial<Record<string, string>>): Param {
  const inverse = new Map(Object.entries(libelles).map(([v, l]) => [l, v]));
  return param<K>({
    cle, nom, defaut,
    lire: brut => inverse.get(brut) as UiState[K] | undefined,
    ecrire: v => libelles[String(v)] ?? String(v),
  });
}

/** Lundi de la semaine affichée (une autre date est refusée plutôt que ramenée au lundi). */
const semaine = param<'weekStart'>({
  cle: 'weekStart', nom: 'semaine', defaut: null,
  lire: brut => isValidDate(brut) && weekday(brut) === 0 ? brut : undefined,
  ecrire: v => String(v),
});

/** Exercice du plan de formation : une année plausible. */
const exercice = param<'exercice'>({
  cle: 'exercice', nom: 'exercice', defaut: null,
  lire: brut => { const a = entier(brut); return a != null && a >= 2000 && a <= 2100 ? a : undefined; },
  ecrire: v => String(v),
});

/** Équipe du filtre de Collaborateurs : nom d'une équipe du référentiel ; vide : les salariés sans équipe. */
const equipe = param<'equipe'>({
  cle: 'equipe', nom: 'equipe', defaut: 'Toutes',
  lire: (brut, data) => brut === '' || data.referentiels.equipes.some(e => e.nom === brut) ? brut : undefined,
  ecrire: v => v,
});

/** Paramètres de chaque vue ; une vue absente n'a rien dans l'adresse. */
export const PARAMS_URL: Partial<Record<View, Param[]>> = {
  collaborateurs: [
    identifiant('selectedId', 'fiche', d => d.employes),
    equipe,
    choix('statut', 'statut', 'tous', { ok: 'a-jour', due: 'a-renouveler', exp: 'non-conforme', sortis: 'sortis', /* lot 11 — indicateurs */ acompleter: 'a-completer' }),
  ],
  temps: [identifiant('tsEmp', 'salarie', d => d.employes), semaine],
  formations: [
    code('formationFilter', 'formation', d => d.referentiels.formations),
    choix('typeForm', 'type', 'toutes', { reg: 'reglementaires', rec: 'recommandees', int: 'internes' }),
  ],
  habilitations: [
    code('habType', 'habilitation', d => d.referentiels.habilitations),
    choix('habFilter', 'filtre', 'tous', { due: 'a-renouveler', ko: 'non-valides', pending: 'en-attente' }),
  ],
  voyages: [identifiant('tripSel', 'voyage', d => d.voyages)],
  chantiers: [code('goSel', 'chantier', d => d.referentiels.chantiers)],
  echeances: [choix('echType', 'type', 'tous', {
    cert: 'certifications', hab: 'habilitations', med: 'visites-medicales', exigence: 'exigences', trip: 'voyages', contrat: 'contrats',
  })],
  referentiels: [choix('refOnglet', 'onglet', 'formations', {
    formations: 'formations', habilitations: 'habilitations', postes: 'postes', destinations: 'destinations', activites: 'activites',
  })],
  budget: [exercice, choix('planFilter', 'statut', 'tous', { prevu: 'prevu', engage: 'engage', realise: 'realise', reporte: 'reporte' })],
  // lot 11 — indicateurs : onglet, année civile et groupement (jamais de date libre : l'année seulement).
  indicateurs: [
    choix('indOnglet', 'onglet', 'effectifs', Object.fromEntries(ONGLETS_INDICATEURS.map(o => [o, o]))),
    param<'indAnnee'>({
      cle: 'indAnnee', nom: 'annee', defaut: null,
      lire: brut => { const a = entier(brut); return a != null && anneeIndicateursValide(a) ? a : undefined; },
      ecrire: v => String(v),
    }),
    choix('indGroupe', 'groupe', 'aucun', Object.fromEntries(Object.keys(GROUPES_INDICATEURS).map(g => [g, g]))),
  ],
};

/**
 * Champs de la vue lus dans l'adresse (`search` : location.search). Chaque champ de la vue est rendu : la valeur lue,
 * ou sa valeur par défaut si elle est absente, invalide ou hors du périmètre (Précédent efface ainsi une sélection).
 */
export function lireUrl(view: string, search: string, data: Dataset): Partial<UiState> {
  const q = new URLSearchParams(search);
  const out: Partial<Record<keyof UiState, unknown>> = {};
  for (const p of PARAMS_URL[view as View] ?? []) {
    const brut = q.get(p.nom);
    const v = brut == null ? undefined : p.lire(brut, data);
    out[p.cle] = v === undefined ? p.defaut : v;
  }
  return out as Partial<UiState>;
}

/** Partie « ?… » de l'adresse pour la vue et l'état de l'écran (vide si tout est à sa valeur par défaut). */
export function ecrireUrl(view: View, ui: UiState): string {
  const q = new URLSearchParams();
  for (const p of PARAMS_URL[view] ?? []) {
    const v = ui[p.cle];
    if (v !== p.defaut && v != null) q.set(p.nom, p.ecrire(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Adresse complète de la vue : chemin et paramètres. */
export const adresse = (view: View, ui: UiState) => `/${view}${ecrireUrl(view, ui)}`;

/**
 * Le passage de `avant` à `apres` ouvre une fiche (ou une autre fiche) de la vue : nouvelle entrée de l'historique.
 * Fermer une fiche ou changer un filtre remplace l'entrée courante.
 */
export function ouvreUneFiche(view: View, avant: UiState, apres: UiState): boolean {
  return (PARAMS_URL[view] ?? []).some(p => p.fiche && apres[p.cle] != null && apres[p.cle] !== avant[p.cle]);
}

/** Longueur maximale de la page de retour acceptée par le serveur (server/src/microsoft.ts, pageDeRetour). */
export const RETOUR_MAX = 200;

/**
 * Page de retour après la connexion Microsoft : chemin et paramètres de l'écran ; le seul chemin s'ils dépassent la
 * limite du serveur (le brouillon de la reconnexion garde de toute façon les filtres). Le code d'échec d'une connexion
 * précédente (`?connexion=`) n'est jamais repris.
 */
export function pageDeRetourClient(chemin: string, search: string): string {
  const q = new URLSearchParams(search);
  q.delete('connexion');
  const s = q.toString();
  const complet = s ? `${chemin}?${s}` : chemin;
  return complet.length <= RETOUR_MAX ? complet : chemin;
}
