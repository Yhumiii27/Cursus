// Souhaits de formation exprimés à l'entretien (lot 12, chantier C3, t194) : règles pures, partagées par les actions
// (server/src/actions/souhaits.ts), le versement à la clôture (server/src/actions/entretiens.ts) et les écrans.
// Réponse du propriétaire du 1er novembre 2026 : un souhait devient automatiquement une demande au service RH, à la
// clôture de l'entretien, seulement si le manager a donné un avis favorable ; les autres restent dans le compte rendu,
// visibles du service RH. Une demande versée suit le circuit existant (`demande.accepter` : session, liste d'attente ou
// ligne du plan, d'origine « entretien »).
import { fmtIso } from '../format.ts';
import type { AvisSouhait, Entretien, EntretienType, ISODate, PrioriteSouhait, SouhaitFormation } from '../types.ts';

/** Types d'entretien qui recueillent des souhaits : parcours professionnel, reprise, annuel, point de mi-année. */
export const TYPES_SOUHAITS: readonly EntretienType[] = ['epp', 'reprise', 'annuel', 'mi_annee'];
export const AVIS_SOUHAIT = ['favorable', 'defavorable', 'a_discuter'] as const satisfies readonly AvisSouhait[];
export const AVIS_SOUHAIT_LABEL: Record<AvisSouhait, string> = { favorable: 'Favorable', defavorable: 'Défavorable', a_discuter: 'À discuter' };
export const PRIORITES_SOUHAIT = ['haute', 'normale', 'basse'] as const satisfies readonly PrioriteSouhait[];
export const PRIORITE_SOUHAIT_LABEL: Record<PrioriteSouhait, string> = { haute: 'Haute', normale: 'Normale', basse: 'Basse' };
/** Raison codée d'un souhait favorable non versé à la clôture. */
export const NON_VERSE_LABEL: Record<NonNullable<SouhaitFormation['nonVerse']>, string> = {
  deja_demande: 'Demande déjà en cours', deja_inscrit: 'Déjà inscrit à une session à venir', archivee: 'Formation retirée du catalogue',
};
export const SOUHAITS_MAX = 10;
export const LIBELLE_SOUHAIT_MAX = 200;

export const estAvisSouhait = (v: unknown): v is AvisSouhait => (AVIS_SOUHAIT as readonly unknown[]).includes(v);
export const estPrioriteSouhait = (v: unknown): v is PrioriteSouhait => (PRIORITES_SOUHAIT as readonly unknown[]).includes(v);

/** Refus de souhaits dans un entretien de ce type (forfait jours, état des lieux, point de suivi), ou null. */
export const refusTypeSouhaits = (type: EntretienType): string | null => (TYPES_SOUHAITS.includes(type) ? null
  : 'Les souhaits de formation se recueillent aux entretiens de parcours professionnel, de reprise, annuel et de mi-année');

/** Souhaits d'un entretien (colonne absente ou vide : aucun). */
export const souhaitsDe = (x: Pick<Entretien, 'souhaits'>): SouhaitFormation[] => (Array.isArray(x.souhaits) ? x.souhaits : []);

/** Clé d'un nouveau souhait : « s » suivi du plus grand numéro de l'entretien plus un (jamais réutilisée après un retrait). */
export function nouvelleCle(souhaits: readonly SouhaitFormation[]): string {
  const n = Math.max(0, ...souhaits.map(s => Number(/^s(\d+)$/.exec(s.cle)?.[1] ?? 0)));
  return `s${n + 1}`;
}

/** Champs saisis d'un souhait, contrôlés : formation du catalogue ou intitulé libre, priorité, objectif lié. */
export type SaisieSouhait = Pick<SouhaitFormation, 'f' | 'libelle' | 'priorite' | 'objectifId'>;

/**
 * Saisie d'un souhait lue et contrôlée ; `formation(f)` : la formation du catalogue (archivée comprise), ou rien ;
 * `actuel` : valeurs en vigueur (modification). Message d'erreur en texte si la saisie est invalide.
 */
export function lireSouhait(p: Record<string, unknown>, formation: (f: string) => { archive?: unknown } | undefined, actuel?: SaisieSouhait): SaisieSouhait | string {
  const a = actuel ?? { f: null, libelle: null, priorite: 'normale' as PrioriteSouhait, objectifId: null };
  let f = a.f, libelle = a.libelle;
  if (p.f !== undefined || p.libelle !== undefined) {
    const code = typeof p.f === 'string' && p.f && p.f !== 'autre' ? p.f : null;
    if (code) {
      const fm = formation(code);
      if (!fm) return 'Formation inconnue';
      if (fm.archive) return 'Formation retirée du catalogue : choisissez-en une autre, ou un intitulé libre';
      f = code; libelle = null;
    } else {
      const t = typeof p.libelle === 'string' ? p.libelle.trim().replace(/\s+/g, ' ') : '';
      if (!t) return 'Formation du catalogue ou intitulé requis';
      if (t.length > LIBELLE_SOUHAIT_MAX) return `Intitulé trop long (${LIBELLE_SOUHAIT_MAX} caractères au plus)`;
      f = null; libelle = t;
    }
  }
  if (!f && !libelle) return 'Formation du catalogue ou intitulé requis';
  const priorite = p.priorite !== undefined ? p.priorite : a.priorite;
  if (!estPrioriteSouhait(priorite)) return 'Priorité inconnue';
  let objectifId = a.objectifId;
  if (p.objectifId !== undefined) objectifId = p.objectifId === null || p.objectifId === '' ? null : Number(p.objectifId);
  if (objectifId !== null && !Number.isInteger(objectifId)) return 'Objectif lié invalide';
  return { f, libelle, priorite, objectifId };
}

/** Souhait versé, ou écarté au versement : il ne change plus (ni intitulé, ni avis), et n'est jamais versé deux fois. */
export const souhaitTraite = (s: SouhaitFormation) => !!s.demandeId || !!s.nonVerse || !!s.verseLe;

/** Souhaits à verser à la clôture : avis favorable du manager, ni versés ni écartés (jamais deux fois). */
export const souhaitsAVerser = (x: Pick<Entretien, 'souhaits'>) => souhaitsDe(x).filter(s => s.avis === 'favorable' && !souhaitTraite(s));

/** Souhaits encore sans avis du manager (rappel avant la clôture, étape 2). */
export const souhaitsSansAvis = (x: Pick<Entretien, 'souhaits'>) => souhaitsDe(x).filter(s => !s.avis && !souhaitTraite(s));

/** Motif de la demande versée : texte fixe, jamais le texte libre du souhait. */
export const motifVersement = (date: ISODate) => `Souhait exprimé à l’entretien du ${fmtIso(date)}`;
