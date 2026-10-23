// Réglages de Cursus (écran Paramètres) : table « champ → contrôle », une ligne par champ de `Settings`
// (shared/types.ts) avec sa valeur par défaut et son contrôle. `parametres.maj` (server/src/actions/parametres.ts)
// n'enregistre que les champs de cette table, chacun passé par son contrôle ; DEFAULT_SETTINGS (server/src/dataset.ts)
// en est tiré. Ajouter un réglage : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import { isValidDate } from './dates.ts';
import { CONTRATS_EXCLUABLES, PREAVIS_TOUTE_ANNEE } from './rules/campagne.ts';
import { JOURS_RELANCE, paliersRelance } from './rules/relances.ts';
import { nuitHorsLoi, refusPlageNuit } from './rules/repos-nuit.ts';
import { CATEGORIES, CATEGORIES_CONSERVATION, categoriesTexte, DOSSIER_MIN_ANS, DUREE_MAX_ANS } from './rules/conservation.ts';
import { DELAI_JOUR_FRANC, DELAI_PREVENANCE_LEGAL } from './rules/astreintes.ts';
import type { CompensationAstreinte, ContenuAgenda, Settings, StockagePieces } from './types.ts';

/** Jours de l'année (« MM-JJ ») à partir desquels les RTT de l'année suivante peuvent être posés ; vide : sans restriction. */
export const RTT_ANNEE_SUIVANTE_DES = ['', '09-01', '10-01', '11-01', '12-01'] as const;

/** Saisie refusée par un contrôle : `parametres.maj` répond 400 avec ce message et n'enregistre rien. */
export class ReglageInvalide extends Error {}

export interface Reglage<T> {
  /** Valeur tant que l'administrateur RH ne l'a pas modifiée (base neuve, ou réglage apparu depuis). */
  defaut: T;
  /**
   * Valeur reçue → valeur enregistrée (bornée, arrondie, ramenée à la liste…) ; `actuelle` : valeur en vigueur, gardée
   * pour une saisie inexploitable. Lever ReglageInvalide refuse toute la modification. Absent : réglage que
   * `parametres.maj` ne modifie pas (ignoré s'il est envoyé).
   */
  controle?: (v: unknown, actuelle: T) => T;
}

// — Contrôles courants —

/** Nombre entier borné, arrondi au pas ; une valeur non numérique garde la valeur en vigueur. */
export const entier = (min: number, max: number, pas = 1) => (v: unknown, actuelle: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n / pas) * pas)) : actuelle;
};

/** Case à cocher. */
export const booleen = (v: unknown): boolean => !!v;

/** Valeur d'une liste fermée ; hors de la liste, `sinon`, à défaut la valeur en vigueur. */
export const choix = <T extends string>(valeurs: readonly T[], sinon?: T) => (v: unknown, actuelle: T): T =>
  (valeurs as readonly unknown[]).includes(v) ? v as T : sinon ?? actuelle;

/** Valeurs cochées d'une liste fermée : inconnues écartées, sans doublon, dans l'ordre de la liste ; autre chose qu'une liste : refus. */
export const parmi = <T extends string>(valeurs: readonly T[]) => (v: unknown): T[] => {
  if (!Array.isArray(v)) throw new ReglageInvalide('Liste de valeurs attendue');
  return valeurs.filter(x => v.includes(x));
};

/** Jour de l'année « MM-JJ » qui existe chaque année (le 29 février est refusé). */
export const jourDeLAnnee = (v: unknown): string => {
  if (typeof v === 'string' && /^\d{2}-\d{2}$/.test(v) && isValidDate(`2027-${v}`)) return v;
  throw new ReglageInvalide('Date invalide : un jour et un mois qui existent chaque année');
};

/** Date « AAAA-MM-JJ », ou vide (null). */
export const dateOuVide = (libelle: string) => (v: unknown): string | null => {
  if (v === null || v === '') return null;
  if (typeof v === 'string' && isValidDate(v)) return v;
  throw new ReglageInvalide(`${libelle} : date invalide`);
};

/**
 * Texte court sur une ligne (référence d'un accord…), espaces réduits ; au-delà de `max` caractères, refus. Transmis à
 * toute personne connectée : jamais de donnée personnelle. Le journal n'en garde que le fait qu'il soit renseigné
 * (`masques` de la règle de parametres.maj, server/src/journal.ts).
 */
export const texte = (max: number, libelle: string) => (v: unknown): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length > max) throw new ReglageInvalide(`${libelle} : ${max} caractères au plus`);
  return t;
};

/** Stockage des pièces justificatives : désactivé ou dossier local ; la GED n'est pas encore raccordée. */
const stockagePieces = (v: unknown, actuelle: StockagePieces): StockagePieces => {
  if (v === 'ged') throw new ReglageInvalide('Espace documentaire (GED) pas encore raccordé à Cursus : son interface n’est pas connue. Choisissez le dossier des données de Cursus.');
  return choix<StockagePieces>(['desactive', 'local'])(v, actuelle);
};

/**
 * Code d'une formation du catalogue (minuscules, chiffres, « - », « _ »), ou vide. Le réglage ne lit pas le catalogue :
 * un code inconnu ou archivé ne vaut rien et l'écran l'annonce (shared/rules/formation-renforcee.ts).
 */
export const codeFormation = (libelle: string) => (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (t && !/^[a-z0-9_-]{1,40}$/.test(t)) throw new ReglageInvalide(`${libelle} : code de formation invalide`);
  return t;
};

/**
 * Table des réglages, groupée par section de Paramètres (client/src/pages/parametres/) : un champ de Settings sans sa
 * ligne ici est une erreur de compilation. Chaque valeur enregistrée est tracée dans le journal (anciennes et nouvelles
 * valeurs) : codes, nombres, dates et cases à cocher seulement, jamais de texte libre.
 */
export const REGLAGES: { [K in keyof Settings]-?: Reglage<Settings[K]> } = {
  // — Règles de suivi (parametres/Suivi.tsx) —
  horizonAlerte: { defaut: 90, controle: entier(30, 180, 30) },
  uniquementReglementaire: { defaut: false, controle: booleen },
  seuilBudget: { defaut: 85, controle: entier(60, 100, 5) },
  // — Intégration Keystone (parametres/Keystone.tsx) : tout autre choix que le partage détaillé vaut minimal —
  partageKeystone: { defaut: 'minimal', controle: choix(['minimal', 'detaille'], 'minimal') },
  // — Congés : RTT des contrats 39 h, réglé depuis l'écran Absences (pages/Absences.tsx) —
  rtt39: { defaut: 23, controle: entier(0, 40) },
  // — Écran d'accueil de l'espace RH : pas de contrôle, non modifiable depuis l'écran —
  vueInitiale: { defaut: 'dashboard' },
  // — Matricules de paie (parametres/MatriculesPaie.tsx) : Keystone garde le matricule Cursus (contrat de l'API v1) —
  identifiantKeystone: { defaut: 'cursus', controle: choix(['cursus', 'paie']) },
  // — Congés et clôtures (parametres/Conges.tsx) : aucune perte d'office, le RH décide ligne par ligne —
  politiqueReportCp: { defaut: 'cas_par_cas', controle: choix(['cas_par_cas', 'proposer_report']) },
  rttAnneeSuivanteDes: { defaut: '', controle: choix<string>(RTT_ANNEE_SUIVANTE_DES) },
  // Acquisition pendant un arrêt maladie : minimum légal de la loi 2024-364 tant qu'un accord ou la CCN plus favorable
  // n'est pas confirmé (shared/rules/acquisition-cp.ts).
  cpMaladie: { defaut: 'legal', controle: choix(['legal', 'assimile']) },
  // — Paie (parametres/ReglagesPaie.tsx, shared/rules/paie.ts) : heures supplémentaires payées par défaut ; repos seulement
  // avec la référence de l'accord (COHERENCE) ; semaine à cheval sur le mois de son dimanche ; clôture le dernier jour (0) —
  heuresSupMode: { defaut: 'paiement', controle: choix(['paiement', 'repos']) },
  heuresSupAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  periodeRattachement: { defaut: 'dimanche', controle: choix(['dimanche', 'vendredi', 'jour']) },
  clotureJour: { defaut: 0, controle: entier(0, 28) },
  // Heures du dimanche : aucune majoration légale (hors accord ou dérogation qui la prévoit) ; quantité HDIM toujours émise.
  majorationDimanche: { defaut: 0, controle: entier(0, 100, 5) },
  // — Suivi des feuilles de temps (parametres/FeuillesTemps.tsx, shared/rules/suivi-feuilles.ts) : 5 semaines affichées ;
  //   feuille attendue le lundi suivant à 12 h —
  suiviSemaines: { defaut: 5, controle: entier(2, 12) },
  feuilleLimiteJour: { defaut: 1, controle: entier(1, 5) },
  feuilleLimiteHeure: { defaut: 12, controle: entier(0, 23) },
  // — Campagne d'entretiens annuels (parametres/Entretiens.tsx, shared/rules/campagne.ts) : par défaut du 1er octobre au
  //   15 décembre, sans ancienneté minimale, seul l'intérim exclu, échéance affichée toute l'année —
  campagneDebut: { defaut: '10-01', controle: jourDeLAnnee },
  campagneFin: { defaut: '12-15', controle: jourDeLAnnee },
  campagneAncienneteMois: { defaut: 0, controle: entier(0, 24) },
  campagneExclus: { defaut: [], controle: parmi(CONTRATS_EXCLUABLES) },
  campagnePreavisJours: { defaut: PREAVIS_TOUTE_ANNEE, controle: entier(0, PREAVIS_TOUTE_ANNEE) },
  // — Contrats (parametres/Contrats.tsx, shared/rules/contrats.ts) : titres de séjour, alerte à 4 mois (fenêtre de demande
  //   de renouvellement en préfecture) puis relance à 2 mois —
  titreSejourAlerte: { defaut: 120, controle: entier(30, 180, 15) },
  titreSejourRelance: { defaut: 60, controle: entier(15, 120, 15) },
  //   CDD (shared/rules/cdd.ts) : règles supplétives de la loi par défaut, 2 renouvellements (art. L1243-13-1) et durée
  //   maximale selon le motif (0, art. L1242-8-1) ; un accord de branche peut y déroger (sa référence est alors exigée) —
  cddRenouvellementsMax: { defaut: 2, controle: entier(0, 6) },
  cddDureeMaxMois: { defaut: 0, controle: entier(0, 60) },
  cddAccordBranche: { defaut: '', controle: texte(120, 'Référence de l’accord de branche') },
  // — Récapitulatif des échéances (parametres/RelancesEcheances.tsx, shared/rules/relances.ts) : actif, à 90, 30 et 7 jours
  //   puis échu, chaque jour à 7 h —
  relancesActives: { defaut: true, controle: booleen },
  relancesPaliers: { defaut: [90, 30, 7], controle: paliersRelance },
  relancesJour: { defaut: 'quotidien', controle: choix(JOURS_RELANCE) },
  // — Santé (parametres/Sante.tsx, shared/rules/suivi-medical.ts) : 24 mois pour tous par défaut, le plus prudent, dans les
  //   maximums légaux : VIP 5 ans (art. R4624-16), VIP adaptée 3 ans (art. R4624-17), SIR visite intermédiaire 2 ans et
  //   examen d'aptitude 4 ans (art. R4624-28) —
  santeVipMois: { defaut: 24, controle: entier(12, 60) },
  santeVipAdapteeMois: { defaut: 24, controle: entier(12, 36) },
  santeSirIntermediaireMois: { defaut: 24, controle: entier(12, 24) },
  santeSirAptitudeMois: { defaut: 48, controle: entier(12, 48) },
  // Visite de mi-carrière (shared/rules/visites-dues.ts) : l'année des 45 ans à défaut d'accord de branche (art. L4624-2-2).
  santeMiCarriereAge: { defaut: 45, controle: entier(40, 55) },
  // — Formations (parametres/Formations.tsx, shared/rules/formations-temps.ts) : heures des sessions proposées dans la
  //   feuille de temps des inscrits (ligne interne INT-FORM), par défaut —
  formationsTemps: { defaut: true, controle: booleen },
  // — Décompte des heures (parametres/DecompteHeures.tsx, shared/rules/majorations.ts et durees.ts) : saisie un jour férié
  //   permise et tracée, fériés autres que le 1er mai sans majoration (le 1er mai : 100 %, fixé par la loi) ; heures
  //   complémentaires au dixième (le tiers avec un accord) ; moyenne de 44 h sur 12 semaines (46 h avec un accord) ;
  //   contingent de 220 h (supplétif, art. D3121-24), alerte à 90 % —
  feriesTravaillesAutorises: { defaut: true, controle: booleen },
  tauxMajorationFerie: { defaut: 0, controle: entier(0, 100, 5) },
  plafondHeuresComplementaires: { defaut: 'dixieme', controle: choix(['dixieme', 'tiers']) },
  heuresComplementairesAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  moyenne12SemainesMax: { defaut: 44, controle: entier(44, 46) },
  moyenne12SemainesAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  contingentHeuresSup: { defaut: 220, controle: entier(0, 1000) },
  contingentAlerte: { defaut: 90, controle: entier(50, 100, 5) },
  contingentAccord: { defaut: '', controle: texte(120, 'Référence de l’accord ou de la convention') },
  // — Absences dans le fichier de paie (parametres/AbsencesPaie.tsx, shared/rules/absences-paie.ts) : activé par défaut
  //   (réponse de l'entreprise du 17 octobre 2026) ; les rubriques d'absence restent à confirmer avant tout lot réel —
  absencesFichierPaie: { defaut: true, controle: booleen },
  //   Date de mise en service : jours d'absence d'avant jamais transmis (traités par Lucca et Sage), vide par défaut —
  absencesPaieAPartirDu: { defaut: null, controle: dateOuVide('Absences transmises à partir du') },
  // — Pièces justificatives (parametres/Pieces.tsx, shared/rules/pieces.ts) : désactivées par défaut (réponse de l'entreprise
  //   du 18 octobre 2026), activées par l'administrateur RH après avis du DPO ; la GED attend son adaptateur
  //   (server/src/integrations/ged.ts), son choix est refusé d'ici là —
  piecesStockage: { defaut: 'desactive', controle: stockagePieces },
  // — Postes à risques particuliers (parametres/PostesRisques.tsx, shared/rules/formation-renforcee.ts) : formation
  //   renforcée à la sécurité non désignée par défaut (aucune exigence, avertissement à l'écran) —
  formationRenforceeCode: { defaut: '', controle: codeFormation('Formation renforcée à la sécurité') },
  // — Entretien de mi-carrière (parametres/EntretienMiCarriere.tsx, shared/rules/entretien-mi-carriere.ts) : actif, 2 mois
  //   après la visite par défaut, lecture la plus prudente du texte, à confirmer juridiquement —
  entretienMiCarriereActif: { defaut: true, controle: booleen },
  entretienMiCarriereMois: { defaut: 2, controle: entier(1, 12) },
  // — Hiérarchie des managers (parametres/Hierarchie.tsx, t136) : consultation N+2 en lecture seule, désactivée par défaut
  //   (réponse de l'entreprise du 18 octobre 2026) —
  consultationN2: { defaut: false, controle: booleen },
  //   Délégation des validations (t135) : congés et feuilles de temps ; les entretiens seulement si ce réglage les ouvre —
  delegationEntretiens: { defaut: false, controle: booleen },
  // — Déplacements dans le fichier de paie (parametres/DeplacementsPaie.tsx, shared/rules/deplacements-paie.ts, t031) :
  //   désactivé par défaut (réponse de l'entreprise du 18 octobre 2026) tant que la paie n'a pas confirmé ses codes ; les
  //   quantités restent calculées, à saisir dans Sage. Date de mise en service : jours d'avant jamais transmis —
  deplacementsFichierPaie: { defaut: false, controle: booleen },
  deplacementsPaieAPartirDu: { defaut: null, controle: dateOuVide('Déplacements transmis à partir du') },
  //   Vigilance des pays (shared/rules/vigilance.ts, t068) : rappel avant un départ si la vérification a plus de N jours —
  vigilanceRappelJours: { defaut: 30, controle: entier(7, 180) },
  // — Travail de nuit (components/ReglagesNuit.tsx, dans Paramètres → Décompte des heures ; shared/rules/repos-nuit.ts,
  //   t048) : valeurs légales supplétives tant que l'accord n'est pas connu — nuit de 21 h à 6 h (art. L3122-20),
  //   travailleur de nuit à 3 h deux fois par semaine ou 270 h sur 12 mois (art. L3122-5 et L3122-23), majoration à 0 %
  //   (quantité HNUIT seule) —
  nuitDebut: { defaut: 21, controle: entier(21, 22) },
  nuitFin: { defaut: 6, controle: entier(6, 7) },
  nuitSeuilQuotidien: { defaut: 3, controle: entier(1, 9) },
  nuitSeuilAnnuel: { defaut: 270, controle: entier(50, 1000, 10) },
  nuitMajoration: { defaut: 0, controle: entier(0, 100, 5) },
  nuitAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  // — Forfait jours (parametres/ForfaitJours.tsx, shared/rules/forfait-jours.ts, t043) : suivi du cumul toujours actif,
  //   alerte à 90 % du plafond ; avenant de renonciation fermé par défaut, ouvert seulement avec la référence de l'accord
  //   collectif (COHERENCE, art. L3121-63 et L3121-64) ; valeurs supplétives : 235 jours au plus (art. L3121-66),
  //   majoration de 10 % au moins (art. L3121-59) ; jours rachetés (JREN) dans la paie du mois de la signature —
  forfaitJoursAlerte: { defaut: 90, controle: entier(50, 100, 5) },
  forfaitJoursRachat: { defaut: false, controle: booleen },
  forfaitJoursAccord: { defaut: '', controle: texte(120, 'Référence de l’accord sur le forfait jours') },
  forfaitJoursPlafond: { defaut: 235, controle: entier(218, 282) },
  forfaitJoursMajorationMin: { defaut: 10, controle: entier(10, 100) },
  forfaitJoursJren: { defaut: 'signature', controle: choix(['signature', 'cloture']) },
  // — Fractionnement des congés payés (parametres/Fractionnement.tsx, shared/rules/fractionnement.ts, t046) : règle légale
  //   supplétive tant que les accords d'entreprise ne sont pas connus ; congé principal du 1er mai au 31 octobre —
  fractionnementRegle: { defaut: 'legal', controle: choix(['legal', 'accord', 'aucun']) },
  fractionnementAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  fractionnementDebut: { defaut: '05-01', controle: jourDeLAnnee },
  fractionnementFin: { defaut: '10-31', controle: jourDeLAnnee },
  // — Compte épargne-temps (parametres/CompteEpargneTemps.tsx, shared/rules/conges.ts) : plafonds de placement, 5 RTT par
  //   an et 5 CP de la 5e semaine par période, tant que l'accord sur le CET n'est pas connu —
  cetPlafondRtt: { defaut: 5, controle: entier(0, 25) },
  cetPlafondCp: { defaut: 5, controle: entier(0, 5) },
  // — Conservation des dossiers (parametres/Conservation.tsx, shared/rules/conservation.ts, t016) : durées préremplies mais
  //   inactives (réponse de l'entreprise du 18 octobre 2026) tant que la décision du DPO n'est pas référencée (COHERENCE) ;
  //   années après la sortie, 0 : dès le lendemain du dernier jour —
  conservationActive: { defaut: false, controle: booleen },
  conservationDecisionDpo: { defaut: '', controle: texte(120, 'Référence de la décision du DPO') },
  conservationDossierAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  conservationTempsAns: { defaut: 3, controle: entier(0, DUREE_MAX_ANS) },
  conservationPaieAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  conservationSanteAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  conservationPasseportAns: { defaut: 0, controle: entier(0, DUREE_MAX_ANS) },
  conservationTitreSejourAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  conservationEntretiensAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  conservationFormationsAns: { defaut: 5, controle: entier(0, DUREE_MAX_ANS) },
  // — Agenda personnel (parametres/Agenda.tsx, server/src/agenda.ts, t036) : flux par abonnement désactivé par défaut ;
  //   absences toujours publiées sous le libellé neutre « Absent » —
  agendaFluxActif: { defaut: false, controle: booleen },
  agendaContenu: { defaut: ['sessions', 'entretiens', 'absences', 'deplacements'], controle: parmi<ContenuAgenda>(['sessions', 'entretiens', 'absences', 'deplacements']) },
  // — Astreintes (t049, lot 7, shared/rules/astreintes.ts ; section de Paramètres à l'étape 2) : accord inconnu (réponse de
  //   l'entreprise du 23 octobre 2026) — délai de prévenance légal de 15 jours (art. L3121-12), compensation financière,
  //   aucune astreinte pour un salarié mineur, référence de l'accord vide —
  astreinteDelaiPrevenance: { defaut: DELAI_PREVENANCE_LEGAL, controle: entier(DELAI_JOUR_FRANC, 60) },
  astreinteCompensation: { defaut: 'financiere', controle: choix<CompensationAstreinte>(['financiere', 'repos']) },
  astreinteMineurs: { defaut: false, controle: booleen },
  astreinteAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
};

/**
 * Contrôles qui portent sur plusieurs champs, appliqués aux réglages complets après ceux de chaque champ : un message
 * refuse toute la modification (ReglageInvalide, 400). Une ligne par règle, avec le groupe de sa section.
 */
export const COHERENCE: readonly ((s: Settings) => string | null)[] = [
  // — Paie : le repos de remplacement des heures supplémentaires suppose un accord collectif (art. L3121-33) ou, sans
  // délégué syndical, l'absence d'opposition du CSE (art. L3121-37) —
  s => (s.heuresSupMode === 'repos' && !s.heuresSupAccord
    ? 'Heures supplémentaires remplacées par un repos : indiquez la référence de l’accord collectif qui le prévoit (art. L3121-33) ou, sans délégué syndical, de la décision non contestée par le CSE (art. L3121-37)' : null),
  // — Campagne d'entretiens : dans l'année civile, l'ouverture au plus tard le jour de la clôture —
  s => (s.campagneDebut > s.campagneFin ? 'Campagne d’entretiens : l’ouverture doit précéder la clôture, dans la même année' : null),
  // — Contrats : la relance d'un titre de séjour vient après la première alerte —
  s => (s.titreSejourRelance >= s.titreSejourAlerte ? 'Titres de séjour : la relance doit être plus proche de l’expiration que la première alerte' : null),
  // — Contrats : une durée ou un nombre de renouvellements des CDD autres que ceux de la loi suppose un accord de branche
  // étendu (art. L1242-8 et L1243-13) —
  s => ((s.cddRenouvellementsMax !== 2 || s.cddDureeMaxMois > 0) && !s.cddAccordBranche
    ? 'CDD : une durée maximale ou un nombre de renouvellements autres que ceux de la loi supposent un accord de branche étendu (art. L1242-8 et L1243-13) : indiquez sa référence' : null),
  // — Santé : la visite intermédiaire du suivi renforcé vient avant le renouvellement de l'examen d'aptitude —
  s => (s.santeSirIntermediaireMois > s.santeSirAptitudeMois ? 'Suivi individuel renforcé : la visite intermédiaire ne peut pas venir après l’examen d’aptitude' : null),
  // — Décompte des heures : le tiers pour les heures complémentaires (art. L3123-20) et une moyenne de 46 h sur 12 semaines
  // (art. L3121-23) supposent un accord collectif —
  s => (s.plafondHeuresComplementaires === 'tiers' && !s.heuresComplementairesAccord
    ? 'Heures complémentaires jusqu’au tiers de la durée contractuelle : indiquez la référence de l’accord collectif qui le prévoit (art. L3123-20)' : null),
  s => (s.moyenne12SemainesMax > 44 && !s.moyenne12SemainesAccord
    ? 'Moyenne au-delà de 44 h sur 12 semaines : indiquez la référence de l’accord collectif qui la porte jusqu’à 46 h (art. L3121-23)' : null),
  // — Travail de nuit : 9 h consécutives au moins (art. L3122-2) ; une autre plage ou d'autres seuils que ceux de la loi
  // supposent un accord collectif (art. L3122-15 et L3122-16) —
  s => refusPlageNuit(s),
  s => (nuitHorsLoi(s) && !s.nuitAccord
    ? 'Travail de nuit : une plage ou des seuils autres que ceux de la loi supposent un accord collectif (art. L3122-15 et L3122-16) : indiquez sa référence' : null),
  // — Forfait jours : la renonciation à des jours de repos suppose l'accord collectif qui autorise le forfait (art. L3121-63
  // et L3121-64) ; sans lui, le suivi du cumul et ses alertes seulement —
  s => (s.forfaitJoursRachat && !s.forfaitJoursAccord
    ? 'Forfait jours : la renonciation à des jours de repos suppose l’accord collectif qui autorise le forfait (art. L3121-63 et L3121-64) : indiquez sa référence' : null),
  // — Fractionnement : une autre règle que la loi, ou aucun jour, suppose un accord collectif d'entreprise (art. L3141-21) ;
  // la période du congé principal tient dans l'année civile —
  s => (s.fractionnementRegle !== 'legal' && !s.fractionnementAccord
    ? 'Fractionnement des congés : une règle fixée par accord, ou la renonciation aux jours de fractionnement, suppose un accord collectif d’entreprise (art. L3141-21) : indiquez sa référence' : null),
  s => (s.fractionnementDebut >= s.fractionnementFin ? 'Période du congé principal : le début doit précéder la fin, dans la même année' : null),
  // — Conservation des dossiers : aucune proposition sans la décision du DPO (réponse de l'entreprise du 18 octobre 2026) ;
  // le dossier au moins 5 ans (registre unique du personnel, art. R1221-26) et jamais avant une autre catégorie,
  // car son anonymisation efface tout —
  s => (s.conservationActive && !s.conservationDecisionDpo
    ? 'Conservation des dossiers : indiquez la référence de la décision du DPO qui fixe ces durées avant d’activer les propositions' : null),
  s => (s.conservationDossierAns < DOSSIER_MIN_ANS
    ? `Conservation des dossiers : ${DOSSIER_MIN_ANS} ans au moins pour le dossier : l’identité et le titre de séjour figurent au registre unique du personnel, gardé 5 ans après le départ (art. R1221-26)` : null),
  s => {
    const plus = CATEGORIES.filter(c => c !== 'dossier' && s[CATEGORIES_CONSERVATION[c].reglage] > s.conservationDossierAns);
    return plus.length ? `Conservation des dossiers : ${categoriesTexte(plus)} au-delà de la durée du dossier, dont l’anonymisation efface tout` : null;
  },
  // — Astreintes : un délai de prévenance plus court que 15 jours suppose un accord collectif (art. L3121-11) —
  s => (s.astreinteDelaiPrevenance < DELAI_PREVENANCE_LEGAL && !s.astreinteAccord
    ? `Astreintes : un délai de prévenance de moins de ${DELAI_PREVENANCE_LEGAL} jours suppose un accord collectif (art. L3121-11) : indiquez sa référence` : null),
];

/** Vue non typée de la table, pour la parcourir (les contrôles reçoivent la valeur en vigueur du même champ). */
type Table = Record<string, { defaut: unknown; controle?: (v: unknown, actuelle: never) => unknown }>;

/** Réglages par défaut : la valeur `defaut` de chaque ligne. */
export function reglagesParDefaut(table: Table = REGLAGES): Settings {
  return Object.fromEntries(Object.entries(table).map(([k, r]) => [k, r.defaut])) as unknown as Settings;
}

/**
 * Réglages après une modification : chaque champ présent dans `p` et doté d'un contrôle y passe, avec sa valeur en
 * vigueur ; les autres clés (`silent`, champ inconnu ou sans contrôle) sont ignorées. ReglageInvalide si un contrôle refuse,
 * ou si le résultat ne respecte pas une règle de COHERENCE.
 */
export function appliquerReglages(actuels: Settings, p: Record<string, unknown>, table: Table = REGLAGES, coherence = COHERENCE): Settings {
  const cur = actuels as unknown as Record<string, unknown>, next = { ...cur };
  for (const [k, r] of Object.entries(table)) {
    if (p[k] !== undefined && r.controle) next[k] = r.controle(p[k], cur[k] as never);
  }
  for (const c of coherence) {
    const refus = c(next as unknown as Settings);
    if (refus) throw new ReglageInvalide(refus);
  }
  return next as unknown as Settings;
}
