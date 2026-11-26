// lot 16 — pièces justificatives stockées dans Codex (décision du propriétaire du 10 novembre 2026 : « quel que soit le
// logiciel de notre suite, tout doit être stocké dans Codex » ; demande docs/demandes/codex-lot16-documents.md, livrée par
// Codex le 26/11/2026, Codex#38 ; contrat : docs/api.md de Codex, « Enregistrements du dossier du personnel (Cursus) »).
// Règles pures : catégorie de Codex de chaque objet de pièce, titre neutre, motif codé d'une destruction. Le client HTTP
// est server/src/integrations/codex/codex-documents.ts, le versement server/src/integrations/codex/pieces-codex.ts (CU-037).
// Codex fixe lui-même, d'après la catégorie, le type `DPE`, le département `RHU`, le sous-type, la confidentialité, la
// conservation et le propriétaire (compte de service `cursus`) : Cursus n'envoie que la catégorie.
import type { ObjetPiece } from '../types.ts';

/** Type d'enregistrement de Codex : « Dossier du personnel — enregistrement » (`src/lib/records.ts` de Codex). */
export const TYPE_CODEX = 'DPE';

/** Catégories du dossier du personnel de Codex (`category`, sous-types du type `DPE`). */
export type CategorieDossier = 'absence' | 'identity' | 'vaccination' | 'training_certificate' | 'authorisation' | 'travel'
  | 'expense' | 'expense_health' | 'personal_vehicle' | 'opco' | 'interview_report';

export interface CategorieCodex {
  /** Sous-type publié par Codex (libellé français, `pub_types_document.subtypes[].fr`), contrôlé avant tout versement. */
  sousType: string;
  /** Début du titre neutre : jamais une donnée de santé, jamais un nom (demande, § 5). */
  titre: string;
}

/** Catégories de Codex employées par Cursus (libellés de `RECORD_CATEGORIES` de Codex). */
export const CATEGORIES_CODEX: Record<Exclude<CategorieDossier, 'interview_report'>, CategorieCodex> = {
  absence: { sousType: 'Justificatif d’absence', titre: 'Justificatif d’absence' },
  // Passeport, visa et carnet de vaccination portent le même titre : rien ne dit qu'une pièce est une vaccination.
  identity: { sousType: 'Passeport ou visa', titre: 'Document déclaré' },
  vaccination: { sousType: 'Carnet de vaccination', titre: 'Document déclaré' },
  training_certificate: { sousType: 'Attestation de formation', titre: 'Attestation de formation' },
  authorisation: { sousType: 'Titre d’habilitation signé', titre: 'Titre d’habilitation' },
  travel: { sousType: 'Pièce de dossier de déplacement', titre: 'Pièce de déplacement' },
  expense: { sousType: 'Justificatif de note de frais', titre: 'Justificatif de frais' },
  // Même titre qu'un justificatif de frais : seul l'accès change chez Codex (rien ne désigne la santé).
  expense_health: { sousType: 'Justificatif de note de frais (accès restreint)', titre: 'Justificatif de frais' },
  personal_vehicle: { sousType: 'Carte grise ou assurance du véhicule personnel', titre: 'Pièce du véhicule personnel' },
  opco: { sousType: 'Pièce de dossier OPCO', titre: 'Pièce de dossier OPCO' },
};

/** Catégorie de chaque objet de pièce ; une déclaration dépend du document déclaré (`declaration.kind`). */
const PAR_OBJET: Record<Exclude<ObjetPiece, 'declaration'>, keyof typeof CATEGORIES_CODEX> = {
  absence: 'absence', certification: 'training_certificate', habTitre: 'authorisation', voyage: 'travel',
  ligneFrais: 'expense', ligneFraisSante: 'expense_health', vehiculePerso: 'personal_vehicle', dossierOpco: 'opco',
};

/**
 * Objets dont les pièces ne sont pas versées : Codex exige le matricule de la personne concernée (`subjectMatricule`),
 * qu'un dossier OPCO collectif n'a pas. Ses pièces restent dans le dossier local (question CU-037-Q1, choix par défaut).
 */
export const OBJETS_NON_VERSES: ReadonlySet<ObjetPiece> = new Set(['dossierOpco']);

/**
 * Catégorie de Codex d'une pièce, ou null si elle ne se verse pas : dossier OPCO sans personne, déclaration d'un document
 * inconnu (`kind` : `passeport`, `visa` ou `vaccin`, `server/src/conservation.ts`).
 */
export function categorieDePiece(objet: ObjetPiece, o: { kind?: string | null } = {}): keyof typeof CATEGORIES_CODEX | null {
  if (OBJETS_NON_VERSES.has(objet)) return null;
  if (objet !== 'declaration') return PAR_OBJET[objet];
  return o.kind === 'passeport' || o.kind === 'visa' ? 'identity' : o.kind === 'vaccin' ? 'vaccination' : null;
}

/** Matricule admis par Codex pour la personne concernée (`SUBJECT_MATRICULE_RE` de Codex). */
export const estMatriculeCodex = (m: string | null | undefined) => !!m && /^(EMP-[0-9]{4,}|[IE][0-9]+)$/.test(m);

/** Référence d'origine d'une pièce chez Codex (`sourceRef`, rejouable : un nouvel essai ne crée pas de second document). */
export const sourceRefPiece = (id: number) => `cursus:piece/${id}`;

/** Titre neutre envoyé à Codex : catégorie, personne désignée par son matricule (jamais son nom), mois du dépôt. */
export function titrePiece(categorie: keyof typeof CATEGORIES_CODEX, o: { matricule: string; deposeLe: string }): string {
  return `${CATEGORIES_CODEX[categorie].titre} — ${o.matricule} — ${o.deposeLe.slice(0, 7)}`;
}

/** Motifs codés d'une destruction demandée à Codex (demande, § 4). */
export type MotifDestruction = 'retrait' | 'conservation' | 'effacement';

/** Motif posé sur une pièce retirée au terme de sa conservation (server/src/conservation.ts). */
export const MOTIF_CONSERVATION = 'Durée de conservation échue';
/** Motif posé sur une pièce retirée avant son terme, à l'effacement demandé d'un dossier (droit à l'effacement). */
export const MOTIF_EFFACEMENT = 'Effacement des données demandé';

/** Motif codé d'après le motif du retrait : tout retrait saisi par une personne est un `retrait`. */
export const motifDestruction = (motif: string | null | undefined): MotifDestruction =>
  motif === MOTIF_CONSERVATION ? 'conservation' : motif === MOTIF_EFFACEMENT ? 'effacement' : 'retrait';

/** Catégorie lue dans `codex.pub_types_document` : code et sous-types. */
export interface TypeCodexLu { code: string; subtypes: readonly { fr?: string | null }[] | null }

const plier = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Catégories de Cursus absentes du registre de Codex (sous-type comparé comme Codex le fait : casse, accents et espaces
 * ignorés). Liste vide : le versement peut commencer.
 */
export function categoriesManquantes(types: readonly TypeCodexLu[]): string[] {
  const t = types.find(x => x.code === TYPE_CODEX);
  if (!t) return [`type ${TYPE_CODEX}`];
  return Object.values(CATEGORIES_CODEX).filter(c => !(t.subtypes ?? []).some(s => s.fr && plier(s.fr) === plier(c.sousType)))
    .map(c => `${TYPE_CODEX} › ${c.sousType}`);
}

/** Registre tel que Codex le publie pour Cursus (simulation de Codex, server/src/integrations/codex/codex-simule.ts). */
export const REGISTRE_CODEX_ATTENDU: readonly TypeCodexLu[] = [{ code: TYPE_CODEX, subtypes: Object.values(CATEGORIES_CODEX).map(c => ({ fr: c.sousType })) }];
