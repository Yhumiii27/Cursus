// Matricule de paie (dossier Sage) et identifiant des salariés échangé avec Keystone.
// - Matricule de paie : saisi ou repris par le service RH, 1 à 20 lettres et chiffres, unique ; le réutiliser à une
//   réembauche (fiche d'un salarié sorti) demande la confirmation de l'administrateur RH. Tant qu'il manque, le salarié
//   est signalé (Paramètres, transmission à la paie) : transmis sous son matricule Cursus en simulation, refusé d'une
//   transmission réelle à Sage.
// - Keystone : le réglage « identifiant envoyé à Keystone » garde par défaut le matricule Cursus (EMP-0001), contrat de
//   l'API v1 ; il peut basculer sur le matricule de paie, dans les deux sens (envois et appels reçus).
import { fmtIso, matricule } from '../format.ts';
import type { Employe, ISODate, Settings } from '../types.ts';

/** Matricule de paie : 1 à 20 lettres (sans accent) et chiffres, enregistré en majuscules. */
export const MATRICULE_PAIE = /^[A-Z0-9]{1,20}$/;

/** Saisie du matricule de paie : espaces retirés, majuscules ; vide : null. */
export function normaliserMatricule(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, '').toUpperCase();
  return s || null;
}

/** Message d'erreur d'un matricule de paie mal formé (déjà normalisé), ou null. */
export function controleMatriculePaie(m: string | null): string | null {
  if (!m || MATRICULE_PAIE.test(m)) return null;
  return 'Matricule de paie invalide : 1 à 20 lettres (sans accent) et chiffres, sans espace ni tiret';
}

/** Matricule transmis à la paie (Sage) : celui du dossier de paie, ou null s'il n'est pas encore saisi. */
export const matriculeDe = (e: Pick<Employe, 'matriculePaie'>): string | null => e.matriculePaie || null;

/** Matricule affiché : celui de la paie, à défaut le matricule Cursus (EMP-0001). */
export const matriculeAffiche = (e: Pick<Employe, 'id' | 'matriculePaie'>): string => matriculeDe(e) ?? matricule(e.id);

/**
 * Identifiant d'un salarié auprès de Keystone, selon le réglage : matricule Cursus (défaut, contrat de l'API v1) ou
 * matricule de paie ; un salarié sans matricule de paie garde son matricule Cursus (aucun matricule de paie n'a de tiret :
 * les deux formes ne se confondent jamais). Même fonction pour les envois et la lecture des appels reçus.
 */
export function identifiantKeystone(mode: Settings['identifiantKeystone'] | undefined, e: Pick<Employe, 'id'> & { matriculePaie?: string | null }): string {
  return mode === 'paie' && e.matriculePaie ? e.matriculePaie : matricule(e.id);
}

/** Salarié sorti des effectifs : date de fin (contrat, mission) passée. */
export const sortiLe = (e: Pick<Employe, 'fin'>, today: ISODate): ISODate | null => (e.fin && e.fin < today ? e.fin : null);

/** Titulaire d'un matricule de paie : nom, et date de sortie s'il a quitté l'entreprise (réembauche possible). */
export interface TitulaireMatricule { id: number; nom: string; sortiLe: ISODate | null }

/**
 * Matricules de paie déjà attribués, hors fiche `sauf` : un salarié présent l'emporte sur une ancienne fiche (réembauche
 * confirmée, deux fiches portent alors le même matricule).
 */
export function matriculesPris(employes: Pick<Employe, 'id' | 'nom' | 'fin' | 'matriculePaie'>[], today: ISODate, sauf?: number | null): Record<string, TitulaireMatricule> {
  const out: Record<string, TitulaireMatricule> = {};
  for (const e of employes) {
    if (e.id === sauf || !e.matriculePaie) continue;
    const t = { id: e.id, nom: e.nom, sortiLe: sortiLe(e, today) };
    const deja = out[e.matriculePaie];
    if (!deja || (deja.sortiLe && (!t.sortiLe || t.sortiLe > deja.sortiLe))) out[e.matriculePaie] = t;
  }
  return out;
}

/**
 * Contrôle d'unicité d'un matricule de paie saisi. `actuel` : matricule enregistré sur la fiche (inchangé : rien à
 * contrôler, une réembauche déjà confirmée n'est pas redemandée) ; `reutiliser` : réutilisation confirmée par
 * l'administrateur RH. Renvoie l'erreur bloquante, l'avertissement, et le titulaire sorti dont la réutilisation est à
 * confirmer (`aConfirmer`).
 */
export function unicite(m: string | null, pris: Record<string, TitulaireMatricule>, o: { actuel?: string | null; reutiliser?: boolean } = {}) {
  const t = m && m !== (o.actuel ?? null) ? pris[m] : undefined;
  if (!t) return { erreur: null, avertissement: null, aConfirmer: null };
  if (!t.sortiLe) return { erreur: `Matricule de paie déjà attribué à ${t.nom}.`, avertissement: null, aConfirmer: null };
  if (!o.reutiliser) {
    return { erreur: `Matricule de paie de ${t.nom}, sorti le ${fmtIso(t.sortiLe)} : sa réutilisation (réembauche) est à confirmer par l’administrateur RH.`, avertissement: null, aConfirmer: t };
  }
  return { erreur: null, avertissement: `Matricule de paie réutilisé : celui de ${t.nom}, sorti le ${fmtIso(t.sortiLe)} (réembauche confirmée par l’administrateur RH).`, aConfirmer: t };
}

/**
 * Salariés à payer sans matricule de paie : présents (ni sortis, ni intérimaires, payés par leur agence), dans l'ordre
 * alphabétique. `ids` : restreint aux salariés d'un lot (feuilles à transmettre).
 */
export function sansMatriculePaie<E extends Pick<Employe, 'id' | 'nom' | 'fin' | 'typeContrat' | 'matriculePaie'>>(employes: E[], today: ISODate, ids?: Iterable<number>): E[] {
  const dans = ids ? new Set(ids) : null;
  return employes
    .filter(e => !matriculeDe(e) && e.typeContrat !== 'interim' && (dans ? dans.has(e.id) : !sortiLe(e, today)))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}
