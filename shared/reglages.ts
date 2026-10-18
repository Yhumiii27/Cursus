// Réglages de Cursus (écran Paramètres) : table « champ → contrôle », une ligne par champ de `Settings`
// (shared/types.ts) avec sa valeur par défaut et son contrôle. `parametres.maj` (server/src/actions/parametres.ts)
// n'enregistre que les champs de cette table, chacun passé par son contrôle ; DEFAULT_SETTINGS (server/src/dataset.ts)
// en est tiré. Ajouter un réglage : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import { isValidDate } from './dates.ts';
import { CONTRATS_EXCLUABLES, PREAVIS_TOUTE_ANNEE } from './rules/campagne.ts';
import { JOURS_RELANCE, paliersRelance } from './rules/relances.ts';
import type { Settings, StockagePieces } from './types.ts';

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
  // — Santé : la visite intermédiaire du suivi renforcé vient avant le renouvellement de l'examen d'aptitude —
  s => (s.santeSirIntermediaireMois > s.santeSirAptitudeMois ? 'Suivi individuel renforcé : la visite intermédiaire ne peut pas venir après l’examen d’aptitude' : null),
  // — Décompte des heures : le tiers pour les heures complémentaires (art. L3123-20) et une moyenne de 46 h sur 12 semaines
  // (art. L3121-23) supposent un accord collectif —
  s => (s.plafondHeuresComplementaires === 'tiers' && !s.heuresComplementairesAccord
    ? 'Heures complémentaires jusqu’au tiers de la durée contractuelle : indiquez la référence de l’accord collectif qui le prévoit (art. L3123-20)' : null),
  s => (s.moyenne12SemainesMax > 44 && !s.moyenne12SemainesAccord
    ? 'Moyenne au-delà de 44 h sur 12 semaines : indiquez la référence de l’accord collectif qui la porte jusqu’à 46 h (art. L3121-23)' : null),
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
