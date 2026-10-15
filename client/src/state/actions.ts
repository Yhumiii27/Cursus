// Actions lancées depuis l'interface : jamais deux fois la même en même temps, boutons désactivés pendant
// l'appel et second clic d'un double clic ignoré. Entre les deux clics d'un double clic, la réponse a pu
// arriver et l'écran changer sous le pointeur : « Engager » devenu « Clôturer », demande suivante remontée à
// la place de celle qui vient d'être validée, ligne suivante à la place de celle qui vient d'être supprimée.
// Le serveur reçoit en plus l'état attendu (statut d'une action du plan, ligne d'une feuille de temps) et ne
// refait pas une transition déjà faite.
import { useState } from 'react';

/** Clé d'une action : son nom et ses paramètres. */
export const cleAction = (nom: string, payload: Record<string, unknown>) => `${nom} ${JSON.stringify(payload)}`;

/**
 * Appels en cours, par clé : un appel identique à un appel en cours (double clic, double envoi) reçoit la
 * même réponse, sans nouvelle requête ni second message, s'il est aussi le dernier lancé de son `groupe`
 * (le nom de l'action). Case cochée, décochée puis recochée avant les réponses : le troisième appel a la clé
 * du premier, encore en cours, mais le deuxième est parti entre-temps ; il est envoyé, sinon le serveur
 * garderait la case décochée.
 */
export class AppelsEnCours<T> {
  private enCours = new Map<string, Promise<T>>();
  /** Dernière clé lancée de chaque groupe, tant qu'elle est en cours. */
  private derniere = new Map<string, string>();
  private n = 0;
  /** Nombre d'appels en cours (la relecture périodique des données attend qu'il n'y en ait plus). */
  get taille(): number { return this.n; }
  lancer(cle: string, appel: () => Promise<T>, groupe = cle): Promise<T> {
    const deja = this.enCours.get(cle);
    if (deja && this.derniere.get(groupe) === cle) return deja;
    this.n++;
    const p: Promise<T> = appel().finally(() => {
      this.n--;
      if (this.enCours.get(cle) !== p) return;
      this.enCours.delete(cle);
      if (this.derniere.get(groupe) === cle) this.derniere.delete(groupe);
    });
    this.enCours.set(cle, p);
    this.derniere.set(groupe, cle);
    return p;
  }
}

/** Clic de souris, de clavier (detail 0) ou tactile ; absent pour un changement de liste. */
interface Clic { detail?: number; stopPropagation?: () => void }

/**
 * Garde des boutons d'action d'un écran : `agir(f)` donne le gestionnaire de clic, qui lance `f` si aucune
 * action de l'écran n'est en cours et si ce n'est pas le second clic d'un double clic (`detail` > 1). Le clic
 * ne remonte pas à la ligne du tableau (qui ouvrirait la fiche). `occupe` suit l'action en cours.
 */
export function garde(occupe: (oui: boolean) => void) {
  let enCours = false;
  return (f: () => unknown) => (ev?: Clic) => {
    ev?.stopPropagation?.();
    if (enCours || (ev?.detail ?? 0) > 1) return;
    enCours = true;
    occupe(true);
    (async () => {
      try { await f(); } finally { enCours = false; occupe(false); }
    })();
  };
}

/** Garde des boutons d'un composant : `occupe` désactive ses boutons d'action pendant l'appel. */
export function useAgir() {
  const [occupe, setOccupe] = useState(false);
  const [agir] = useState(() => garde(setOccupe));
  return { occupe, agir };
}
