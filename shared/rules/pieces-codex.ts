// lot 16 — pièces justificatives stockées dans Codex (décision du propriétaire du 10 novembre 2026 : « quel que soit le
// logiciel de notre suite, tout doit être stocké dans Codex » ; demande docs/demandes/codex-lot16-documents.md, portée
// le 10/11/2026, Codex#29). Règles pures : catégorie de Codex de chaque objet de pièce, titre neutre, motif codé d'une
// destruction. Le client HTTP est server/src/integrations/codex-documents.ts, le versement server/src/pieces-codex.ts.
// Les codes ci-dessous sont ceux que Cursus a proposés (sous-types du type RHF « RH & Formation ») : ils seront alignés
// sur la réponse de Codex, et le contrôle de démarrage les cherche dans codex.pub_types_document avant tout versement.
import type { ObjetPiece } from '../types.ts';

/** Niveaux de confidentialité de Codex employés par Cursus (`docs/modele-cible.md` de Codex). */
export type ConfCodex = 'confidentiel' | 'tres_confidentiel';

export interface CategorieCodex {
  /** Type du registre de Codex (`pub_types_document.code`). */
  typeCode: string;
  /** Sous-type du registre (libellé français, `pub_types_document.subtypes[].fr`). */
  sousType: string;
  conf: ConfCodex;
  /** Début du titre neutre : jamais une donnée de santé, jamais un nom (demande, § 5). */
  titre: string;
}

const RH = (sousType: string, conf: ConfCodex, titre = sousType): CategorieCodex => ({ typeCode: 'RHF', sousType, conf, titre });

/** Catégorie de Codex de chaque objet de pièce (demande du lot 16, § 1). */
export const CATEGORIES_CODEX: Record<ObjetPiece, CategorieCodex> = {
  absence: RH('Justificatif d’absence', 'tres_confidentiel'),
  declaration: RH('Document déclaré par le salarié', 'tres_confidentiel', 'Document déclaré'),
  certification: RH('Attestation de formation', 'confidentiel'),
  habTitre: RH('Titre d’habilitation signé', 'confidentiel', 'Titre d’habilitation'),
  voyage: RH('Pièce du dossier de déplacement', 'confidentiel', 'Pièce de déplacement'),
  ligneFrais: RH('Justificatif de note de frais', 'confidentiel', 'Justificatif de frais'),
  // Même catégorie et même titre qu'un justificatif de frais : seul l'accès change (rien ne désigne la santé).
  ligneFraisSante: RH('Justificatif de note de frais', 'tres_confidentiel', 'Justificatif de frais'),
  vehiculePerso: RH('Pièce du véhicule personnel', 'confidentiel', 'Pièce du véhicule personnel'),
  dossierOpco: RH('Pièce de dossier OPCO', 'confidentiel'),
};

/** Département de Codex des pièces de Cursus (ressources humaines, `seed-org.ts` de Codex). */
export const DEPARTEMENT_CODEX = 'RHU';

/** Référence d'origine d'une pièce chez Codex (`sourceRef`, rejouable : un nouvel essai ne crée pas de second document). */
export const sourceRefPiece = (id: number) => `cursus:piece/${id}`;

/**
 * Titre neutre envoyé à Codex : catégorie, personne désignée par son matricule (jamais son nom), mois du dépôt. Une pièce
 * de dossier OPCO, sans salarié, porte le numéro de son dossier.
 */
export function titrePiece(objet: ObjetPiece, o: { matricule: string | null; objetId: number; deposeLe: string }): string {
  const sujet = o.matricule ?? `dossier ${o.objetId}`;
  return `${CATEGORIES_CODEX[objet].titre} — ${sujet} — ${o.deposeLe.slice(0, 7)}`;
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
  const out = new Set<string>();
  for (const c of Object.values(CATEGORIES_CODEX)) {
    const t = types.find(x => x.code === c.typeCode);
    if (!t) out.add(`type ${c.typeCode}`);
    else if (!(t.subtypes ?? []).some(s => s.fr && plier(s.fr) === plier(c.sousType))) out.add(`${c.typeCode} › ${c.sousType}`);
  }
  return [...out];
}
