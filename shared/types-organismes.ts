// Organismes de formation et e-learning (lot 12, chantier C4, t190) : modèle partagé entre le serveur et le client.
// Référentiel des organismes (Qualiopi, déclaration d'activité, contacts, tarifs) à la place de l'organisme en texte libre,
// et suivi de modules d'e-learning sans plateforme embarquée (lien d'accès, inscriptions, fin validée par le service RH).
// Règles : shared/rules/organismes.ts, shared/rules/elearning.ts ; actions : server/src/actions/organismes.ts, elearning.ts.
import type { ISODate } from './types.ts';

/** Type d'organisme : prestataire externe, service interne (« Interne · HSE »), formateur indépendant (entreprise individuelle). */
export type TypeOrganisme = 'externe' | 'interne' | 'independant';
/** Origine d'une fiche : reprise des textes libres (à vérifier), saisie du service RH, import (plus tard). */
export type SourceOrganisme = 'reprise' | 'saisie' | 'import';
/** Catégories d'actions certifiées Qualiopi (art. L6313-1) : formation, bilan de compétences, VAE, apprentissage. */
export type CategorieQualiopi = 'formation' | 'bilan' | 'vae' | 'apprentissage';

/**
 * Fiche d'un organisme de formation (table `organismes`). `code` : stable, jamais modifié. `nomUsuel` : nom affiché, recopié
 * dans `formations.organisme` (contrat pub_titres_detenus). `alias` : graphies reprises des textes libres et des fiches
 * fusionnées, conservées. Qualiopi : certification déclarée, catégories, certificateur, numéro, date de fin de validité et
 * date de la dernière vérification. Conditions commerciales (`subrogationAcceptee`, `delaiAnnulationJours`, `conditions`) :
 * service RH. Fusion d'un doublon (`organisme.fusionner`) : la fiche absorbée est archivée et désigne celle qui la remplace
 * (`fusionneDans`), avec la date, l'auteur et le motif (texte du service RH, jamais au journal ni hors du service RH).
 */
export interface Organisme {
  id: number; code: string; raisonSociale: string | null; nomUsuel: string; type: TypeOrganisme;
  siret: string | null; nda: string | null; ndaRegion: string | null;
  qualiopi: boolean; qualiopiCategories: CategorieQualiopi[]; qualiopiCertificateur: string | null; qualiopiNumero: string | null;
  qualiopiValideJusquau: ISODate | null; qualiopiVerifieLe: ISODate | null;
  adresse: string | null; siteWeb: string | null;
  subrogationAcceptee: boolean; delaiAnnulationJours: number | null; conditions: string | null;
  alias: string[]; aVerifier: boolean; source: SourceOrganisme;
  archive: ISODate | null; creeLe: string | null; creePar: string | null;
  fusionneDans: number | null; fusionneLe: ISODate | null; fusionnePar: string | null; fusionneMotif: string | null;
}

/** Fiche réduite transmise à tous les espaces (`referentiels.organismes`) : de quoi nommer un organisme, rien d'autre. */
export type OrganismeResume = Pick<Organisme, 'id' | 'code' | 'nomUsuel' | 'type' | 'archive'>;

/** Rôle d'un contact chez l'organisme. */
export type RoleContactOrganisme = 'commercial' | 'administratif' | 'facturation' | 'formateur';

/**
 * Contact d'un organisme (table `organisme_contacts`) : donnée personnelle d'un tiers, service RH et référent HSE / formation
 * seulement (ni le manager, ni le collaborateur, ni la paie, ni la lecture seule), jamais au journal. Retiré, il est archivé.
 */
export interface OrganismeContact {
  id: number; organismeId: number; nom: string; fonction: string | null; email: string | null; telephone: string | null;
  role: RoleContactOrganisme; principal: boolean; archive: ISODate | null; creeLe: string | null; creePar: string | null;
}

export type ModaliteTarif = 'inter' | 'intra' | 'distanciel' | 'elearning';
export type UniteTarif = 'stagiaire' | 'session' | 'jour' | 'heure' | 'licence';

/**
 * Tarif d'un organisme (table `organisme_tarifs`) : formation du catalogue (ou libellé), modalité, unité, montant hors taxes,
 * période de validité. Saisi par le service RH ; proposé, jamais imposé.
 */
export interface OrganismeTarif {
  id: number; organismeId: number; formation: string | null; libelle: string | null; modalite: ModaliteTarif; unite: UniteTarif;
  montantHt: number; valableDu: ISODate; valableAu: ISODate | null; archive: ISODate | null; creeLe: string | null; creePar: string | null;
}

/**
 * Module d'e-learning (table `modules_elearning`) : code stable, intitulé, organisme (fiche), formation du catalogue facultative
 * (son achèvement produit la certification), lien d'accès en https seulement (ouvert dans un nouvel onglet, jamais dans un
 * cadre), durée en heures, langue, coût d'une licence (service RH et référent), validité de l'accès en mois, attestation
 * exigée ou non. Pas de SCORM ni de xAPI.
 */
export interface ModuleElearning {
  id: number; code: string; intitule: string; organismeId: number | null; formation: string | null; url: string; dureeHeures: number | null;
  langue: string; coutLicence: number | null; accesMois: number | null; attestationRequise: boolean; archive: ISODate | null;
  creeLe: string | null; creePar: string | null;
}

/** Statut enregistré d'une inscription ; « expiré » est calculé (accès échu sans fin), jamais stocké. */
export type StatutInscriptionElearning = 'inscrit' | 'en_cours' | 'termine' | 'abandonne';
/** Source du dernier avancement connu : import du fichier de la plateforme, service RH. */
export type SourceAvancement = 'import' | 'rh';

/**
 * Inscription d'un salarié à un module (table `inscriptions_elearning`, une en vigueur par salarié et module) : statut,
 * avancement de 0 à 100 avec sa source et sa date (jamais de temps de connexion ni de score détaillé), fin déclarée par le
 * salarié (`declareLe`, « J'ai terminé »), fin validée par le service RH (`termineLe`, heures retenues, réussite) qui produit
 * la formation suivie (`suivieId`, origine « elearning ») et, pour un module rattaché au catalogue, la certification
 * (`certId`). Correction et annulation datées, signées et motivées (motifs : service RH seulement).
 */
export interface InscriptionElearning {
  id: number; empId: number; moduleId: number; planActionId: number | null;
  inscritLe: ISODate; inscritPar: string | null; echeance: ISODate | null; statut: StatutInscriptionElearning;
  avancement: number | null; avancementSource: SourceAvancement | null; avancementLe: ISODate | null;
  declareLe: ISODate | null; termineLe: ISODate | null; heures: number | null; reussi: boolean | null;
  certId: number | null; suivieId: number | null; abandonLe: ISODate | null;
  corrigeLe: ISODate | null; corrigePar: string | null; corrigeMotif: string | null;
  annuleLe: ISODate | null; annulePar: string | null; annuleMotif: string | null;
}
