// Adresses e-mail : adresse professionnelle des salariés (fiche), boîtes du service RH et du service de
// santé au travail, adresses des agences d'intérim (Paramètres → Messagerie). Partagé par les formulaires
// et le serveur (server/src/notifications.ts).
import { TYPES_CONTRAT } from '../constants.ts';
import { key } from '../format.ts';
import type { Employe, Messagerie } from '../types.ts';
import { adresseValide } from './comptes.ts';

/** Adresse telle qu'elle est enregistrée et comparée : sans espaces autour, en minuscules ; null si vide. */
export const normaliserAdresse = (s: unknown): string | null => {
  const v = typeof s === 'string' ? s.normalize('NFC').trim().toLowerCase() : '';
  return v || null;
};

/** Contrôle d'une adresse déjà normalisée (null : aucune) ; renvoie le message d'erreur, ou null. */
export function controleAdresse(a: string | null, libelle = 'Adresse e-mail'): string | null {
  if (a == null) return null;
  return adresseValide(a) ? null : `${libelle} invalide : ${a}`;
}

export const MESSAGERIE_VIDE: Messagerie = { rh: null, rhMode: 'immediat', santeTravail: null, agences: [] };

/** Agences d'intérim citées par les fiches des intérimaires, sans doublon (casse et accents ignorés), par ordre alphabétique. */
export function agencesInterim(employes: Pick<Employe, 'typeContrat' | 'agence'>[]): string[] {
  const out = new Map<string, string>();
  for (const e of employes) {
    if (TYPES_CONTRAT[e.typeContrat]?.interim && e.agence?.trim() && !out.has(key(e.agence))) out.set(key(e.agence), e.agence.trim());
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Adresse des relevés d'une agence (nom comparé sans casse ni accents), ou null. */
export function adresseAgence(m: Messagerie | null | undefined, agence: string | null | undefined): string | null {
  if (!agence) return null;
  return m?.agences.find(a => key(a.nom) === key(agence))?.adresse ?? null;
}

/** Adresses déjà attribuées à d'autres salariés, avec leur nom (contrôle d'unicité de la fiche). */
export function adressesPrises(employes: Pick<Employe, 'id' | 'nom' | 'email'>[], sauf?: number | null): Record<string, string> {
  return Object.fromEntries(employes.filter(e => e.email && e.id !== sauf).map(e => [e.email!, e.nom]));
}
