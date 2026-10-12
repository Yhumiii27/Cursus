// Libellés, classes de statut et règles fixes (droit du travail, formalités).
import type { AbsenceStatut, AbsenceType, EntretienType, NatureAbsence, Statut, TempsTravail, TypeContrat, VaccinId, VisaKind } from './types.ts';

export type StatusKey = 'ok' | 'due' | 'exp';
/** `susp` : suspendue (prérequis non satisfait ou suspension manuelle) ; `retiree` : retirée, définitivement. */
export type HabKey = StatusKey | 'susp' | 'pending' | 'retiree';

export const CLS: Record<StatusKey, string> = { ok: 'tag-neutral', due: 'tag-outline', exp: 'tag-accent' };
export const CERT_LABEL: Record<StatusKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Expirée' };
export const EMP_LABEL: Record<StatusKey, string> = { ok: 'À jour', due: 'À renouveler', exp: 'Non conforme' };
export const DOC_LABEL: Record<StatusKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Expiré' };
export const RANK: Record<StatusKey, number> = { ok: 0, due: 1, exp: 2 };
export const SESS_CLS: Record<string, string> = { 'Confirmée': 'tag-neutral', 'À confirmer': 'tag-outline', 'Complète': 'tag-accent' };
export const HAB_CLS: Record<HabKey, string> = { ok: 'tag-neutral', due: 'tag-outline', exp: 'tag-accent', susp: 'tag-accent', pending: 'tag-outline', retiree: 'tag-accent' };
export const HAB_LABEL: Record<HabKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Expirée', susp: 'Suspendue', pending: 'En attente', retiree: 'Retirée' };
/** Mesures manuelles sur un titre délivré : suspendre (RH, manager direct), lever la suspension et retirer (RH). */
export type HabMesureAction = 'suspendre' | 'lever' | 'retirer';
export const HAB_MESURE_LABEL: Record<HabMesureAction, string> = { suspendre: 'Suspendre', lever: 'Lever la suspension', retirer: 'Retirer' };
export const TRIP_CLS = { pret: 'tag-neutral', todo: 'tag-outline', bloc: 'tag-accent' } as const;
export const TRIP_LABEL = { pret: 'Prêt', todo: 'À compléter', bloc: 'Bloquant' } as const;

// — Absences hors congés —
// Circuit : le manager (ou le salarié) signale l'absence, le service RH précise sa nature (shared/rules/absences.ts).
export type CategorieAbsence = 'sante' | 'parentalite' | 'famille' | 'non_payee';
export const CATEGORIES_ABSENCE: Record<CategorieAbsence, string> = {
  sante: 'Santé (confidentiel)', parentalite: 'Parentalité', famille: 'Événements familiaux', non_payee: 'Absences non payées',
};
/** Rémunération : salaire maintenu, indemnités journalières (complément employeur selon la loi ou la CCN), ou rien. */
export type PaieAbsence = 'maintenue' | 'indemnisee' | 'non_payee';
export const PAIE_ABSENCE: Record<PaieAbsence, string> = {
  maintenue: 'Payée : salaire maintenu',
  indemnisee: 'Indemnisée : indemnités journalières de la Sécurité sociale, complément employeur selon la loi ou la CCN',
  non_payee: 'Non payée',
};

/**
 * Nature d'une absence hors congés.
 * - `medicale` : donnée de santé, y compris celle d'un enfant (annonce d'un handicap, enfant malade) : jamais transmise
 *   au manager ni à Keystone (« Absence », dates et état seulement).
 * - `decompte` : jours ouvrés (week-ends, fériés et jours non travaillés exclus) ou calendaires.
 * - `duree` : durée légale en jours selon `decompte` (par an si `parAn`), contrôlée par un simple avertissement.
 *   Minimum du Code du travail : la CCN Industries chimiques peut être plus favorable, à reporter ici.
 * - `reprise` : motif de l'entretien de parcours professionnel de reprise (art. L6315-1), inscrit sur la fiche à la fin de l'absence.
 * - `cp` : effet attendu sur l'acquisition des congés payés, pour mémoire — `cpDroit` (rules/conges.ts) ne l'applique pas.
 */
export interface NatureDef {
  label: string; abrege: string; court: string; categorie: CategorieAbsence; medicale?: boolean;
  paie: PaieAbsence; decompte: 'ouvres' | 'calendaires'; justificatif: string | null;
  duree?: number; parAn?: boolean; dureeNote?: string; article?: string; reprise?: string; cp: string;
}
const CP_ASSIMILE = 'Assimilé à du travail effectif (art. L3141-5)';
const CP_EVENEMENT = 'Assimilé à du travail effectif (art. L3142-2)';
const CP_NON = 'Non assimilé : pas d’acquisition de CP';
const CP_MALADIE = 'Acquisition limitée : 2 jours ouvrables par mois, 24 jours par période au plus (art. L3141-5-1)';
const CP_AT = 'Assimilé à du travail effectif, sans limite de durée (art. L3141-5)';
export const NATURES_ABSENCE: Record<NatureAbsence, NatureDef> = {
  // Santé : arrêts de travail.
  MALADIE: {
    label: 'Arrêt maladie', abrege: 'Maladie', court: 'arrêt maladie', categorie: 'sante', medicale: true, paie: 'indemnisee', decompte: 'calendaires',
    justificatif: 'Avis d’arrêt de travail (volet employeur), sous 48 h', article: 'Art. L1226-1 : maintien de salaire', cp: CP_MALADIE,
  },
  ALD: {
    label: 'Arrêt longue maladie (ALD)', abrege: 'Longue maladie', court: 'arrêt longue maladie', categorie: 'sante', medicale: true, paie: 'indemnisee', decompte: 'calendaires',
    justificatif: 'Avis d’arrêt de travail au titre d’une affection de longue durée', article: 'Art. L324-1 du Code de la sécurité sociale',
    reprise: 'arrêt longue maladie', cp: CP_MALADIE,
  },
  AT: {
    label: 'Accident du travail', abrege: 'Accident', court: 'accident du travail', categorie: 'sante', medicale: true, paie: 'indemnisee', decompte: 'calendaires',
    justificatif: 'Certificat médical initial ; déclaration à la CPAM par l’employeur sous 48 h', article: 'Art. L411-1 du Code de la sécurité sociale', cp: CP_AT,
  },
  TRAJET: {
    label: 'Accident de trajet', abrege: 'Accident', court: 'accident de trajet', categorie: 'sante', medicale: true, paie: 'indemnisee', decompte: 'calendaires',
    justificatif: 'Certificat médical initial ; déclaration à la CPAM par l’employeur sous 48 h', article: 'Art. L411-2 du Code de la sécurité sociale',
    cp: 'Assimilé à l’accident du travail par la jurisprudence (art. L3141-5) — à confirmer',
  },
  MP: {
    label: 'Maladie professionnelle', abrege: 'Maladie pro.', court: 'maladie professionnelle', categorie: 'sante', medicale: true, paie: 'indemnisee', decompte: 'calendaires',
    justificatif: 'Certificat médical ; déclaration à la CPAM', article: 'Art. L461-1 du Code de la sécurité sociale', cp: CP_AT,
  },
  // Parentalité.
  MATERNITE: {
    label: 'Congé de maternité', abrege: 'Maternité', court: 'congé de maternité', categorie: 'parentalite', paie: 'indemnisee', decompte: 'calendaires',
    duree: 112, dureeNote: '16 semaines (6 avant, 10 après la naissance) ; davantage à partir du 3e enfant ou pour des naissances multiples',
    justificatif: 'Certificat médical de grossesse (date présumée de l’accouchement)', article: 'Art. L1225-17', reprise: 'congé de maternité', cp: CP_ASSIMILE,
  },
  PATERNITE: {
    label: 'Congé de paternité et d’accueil de l’enfant', abrege: 'Paternité', court: 'congé de paternité', categorie: 'parentalite', paie: 'indemnisee', decompte: 'calendaires',
    duree: 25, dureeNote: '25 jours (32 en cas de naissances multiples), à la suite des 3 jours de naissance',
    justificatif: 'Acte de naissance ; dates communiquées un mois avant', article: 'Art. L1225-35', cp: CP_ASSIMILE,
  },
  ADOPTION: {
    label: 'Congé d’adoption', abrege: 'Adoption', court: 'congé d’adoption', categorie: 'parentalite', paie: 'indemnisee', decompte: 'calendaires',
    duree: 112, dureeNote: '16 semaines ; davantage selon le nombre d’enfants', justificatif: 'Attestation de placement en vue d’adoption',
    article: 'Art. L1225-37', reprise: 'congé d’adoption', cp: CP_ASSIMILE,
  },
  PARENTAL: {
    label: 'Congé parental d’éducation', abrege: 'Congé parental', court: 'congé parental', categorie: 'parentalite', paie: 'non_payee', decompte: 'calendaires',
    dureeNote: '1 an au plus, renouvelable deux fois, jusqu’aux 3 ans de l’enfant', justificatif: 'Demande écrite du salarié (lettre recommandée ou remise en main propre)',
    article: 'Art. L1225-47 et L1225-50', reprise: 'congé parental d’éducation',
    cp: 'Pas d’acquisition pendant le congé ; les droits acquis avant sont conservés (art. L1225-54)',
  },
  // Événements familiaux (art. L3142-4) : durées minimales du Code du travail, décomptées en jours ouvrés.
  MARIAGE: {
    label: 'Mariage ou Pacs', abrege: 'Mariage', court: 'congé pour mariage ou Pacs', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 4, justificatif: 'Acte de mariage ou attestation de Pacs', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  MARIAGE_ENFANT: {
    label: 'Mariage d’un enfant', abrege: 'Mariage enfant', court: 'congé pour le mariage d’un enfant', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 1, justificatif: 'Acte de mariage', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  NAISSANCE: {
    label: 'Naissance ou arrivée d’un enfant adopté', abrege: 'Naissance', court: 'congé de naissance', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 3, justificatif: 'Acte de naissance ou attestation de placement', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  DECES_ENFANT: {
    label: 'Décès d’un enfant', abrege: 'Décès', court: 'congé pour décès d’un enfant', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 5, justificatif: 'Acte de décès', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  // Durée retenue par l'entreprise. Le Code prévoit 7 jours ouvrés (art. L3142-4), plus un congé de deuil
  // de 8 jours (art. L3142-1-1) : à confirmer par le service RH.
  DECES_ENFANT_JEUNE: {
    label: 'Décès d’un enfant de moins de 25 ans, ou lui-même parent', abrege: 'Décès', court: 'congé pour décès d’un enfant', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 12, dureeNote: 'aussi pour une personne de moins de 25 ans à charge effective et permanente',
    justificatif: 'Acte de décès', article: 'Art. L3142-4 et L3142-1-1', cp: CP_EVENEMENT,
  },
  DECES_PROCHE: {
    label: 'Décès du conjoint, d’un parent, beau-parent, frère ou sœur', abrege: 'Décès', court: 'congé pour décès d’un proche', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 3, dureeNote: 'conjoint, partenaire de Pacs ou concubin, père, mère, beau-père, belle-mère, frère, sœur',
    justificatif: 'Acte de décès', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  // Santé d'un enfant : donnée de santé, nature confidentielle comme un arrêt (`medicale`).
  HANDICAP_ENFANT: {
    label: 'Annonce du handicap, d’une pathologie chronique ou d’un cancer d’un enfant', abrege: 'Annonce handicap', court: 'congé pour l’annonce du handicap d’un enfant',
    categorie: 'famille', medicale: true, paie: 'maintenue', decompte: 'ouvres', duree: 5, justificatif: 'Justificatif médical de l’annonce', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  ENFANT_MALADE: {
    label: 'Enfant malade', abrege: 'Enfant malade', court: 'congé pour enfant malade', categorie: 'famille', medicale: true, paie: 'non_payee', decompte: 'ouvres',
    duree: 3, parAn: true, dureeNote: '5 jours si l’enfant a moins d’un an ou si le salarié assume la charge d’au moins trois enfants de moins de 16 ans',
    justificatif: 'Certificat médical concernant l’enfant', article: 'Art. L1225-61', cp: 'Non assimilé à du travail effectif, sauf disposition de la CCN',
  },
  // Absences non payées.
  SANS_SOLDE: {
    label: 'Congé sans solde', abrege: 'Sans solde', court: 'congé sans solde', categorie: 'non_payee', paie: 'non_payee', decompte: 'calendaires',
    justificatif: 'Demande écrite du salarié et accord de l’employeur', cp: CP_NON,
  },
  INJUSTIFIEE: {
    label: 'Absence injustifiée', abrege: 'Injustifiée', court: 'absence injustifiée', categorie: 'non_payee', paie: 'non_payee', decompte: 'ouvres',
    justificatif: null, cp: CP_NON,
  },
};

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, NatureDef][];
export const ABS_LABEL = {
  CP: 'Congés payés', RTT: 'RTT / repos', RECUP: 'Récupération', ABSENCE: 'Absence', ...Object.fromEntries(NATURES.map(([k, n]) => [k, n.label])),
} as Record<AbsenceType, string>;
/** Libellé court : en-tête de la grille des heures. */
export const ABS_ABREGE = {
  CP: 'Congés payés', RTT: 'RTT / repos', RECUP: 'Récupération', ABSENCE: 'Absence', ...Object.fromEntries(NATURES.map(([k, n]) => [k, n.abrege])),
} as Record<AbsenceType, string>;
export const ABS_CLS: Record<AbsenceStatut, string> = { demandee: 'tag-outline', validee: 'tag-neutral', refusee: 'tag-accent', signalee: 'tag-outline', annulee: 'tag-outline' };
export const ABS_ST: Record<AbsenceStatut, string> = { demandee: 'À valider', validee: 'Validée', refusee: 'Refusée', signalee: 'Signalée', annulee: 'Annulée' };
export const TS_CLS = { vide: 'tag-outline', brouillon: 'tag-outline', soumise: 'tag-outline', validee: 'tag-neutral', rejetee: 'tag-accent' } as const;
export const TS_LABEL = { vide: 'Non saisie', brouillon: 'Brouillon', soumise: 'À valider', validee: 'Validée', rejetee: 'À corriger' } as const;
export const GNG_CLS = { go: 'tag-neutral', reserve: 'tag-outline', nogo: 'tag-accent' } as const;
export const GNG_LABEL = { go: 'Go', reserve: 'Go sous réserve', nogo: 'No Go' } as const;
export const GNG_CODE = { go: 'GO', reserve: 'GO_RESERVE', nogo: 'NO_GO' } as const;
export const PLAN_CLS = { prevu: 'tag-outline', engage: 'tag-accent', realise: 'tag-neutral' } as const;
export const PLAN_LABEL = { prevu: 'Prévu', engage: 'Engagé', realise: 'Réalisé' } as const;
export const REQ_CLS = { attente: 'tag-outline', acceptee: 'tag-neutral', refusee: 'tag-accent' } as const;
export const REQ_LABEL = { attente: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée' } as const;

/** Validité de l'aptitude médicale, en mois. */
export const MED_VALIDITE = 24;

export const VACCINS: Record<VaccinId, { nom: string; court: string; validite: number | null; delai: number }> = {
  fj: { nom: 'Fièvre jaune', court: 'Fièvre jaune', validite: null, delai: 10 },
  hepA: { nom: 'Hépatite A', court: 'Hép. A', validite: 240, delai: 14 },
  hepB: { nom: 'Hépatite B', court: 'Hép. B', validite: null, delai: 21 },
  typhoide: { nom: 'Typhoïde', court: 'Typhoïde', validite: 36, delai: 14 },
  dtp: { nom: 'DTP (diphtérie-tétanos-polio)', court: 'DTP', validite: 240, delai: 14 },
};

export const VISA_RULES: Record<VisaKind, { label: string; sub: string; delai: number }> = {
  none: { label: 'Sans visa', sub: '', delai: 0 },
  evisa: { label: 'e-Visa d’affaires', sub: 'en ligne · 7 à 10 jours', delai: 10 },
  esta: { label: 'ESTA', sub: 'autorisation électronique · 72 h · valable 2 ans', delai: 3 },
  embassy: { label: 'Visa d’affaires', sub: 'ambassade · 3 à 4 semaines', delai: 28 },
};

/** Catégories de la CCN Industries chimiques ; « non-cadre » regroupe les deux premières. */
export const STATUTS: Record<Statut, { label: string; court: string; cadre: boolean }> = {
  ouvrier: { label: 'Ouvrier / employé', court: 'Ouvrier · employé', cadre: false },
  technicien: { label: 'Technicien / agent de maîtrise', court: 'Technicien · AM', cadre: false },
  cadre: { label: 'Ingénieur / cadre', court: 'Cadre', cadre: true },
};

/** `fin` : date de fin obligatoire ; `finFacultative` : date de fin possible mais non requise. */
export const TYPES_CONTRAT: Record<TypeContrat, { label: string; fin?: boolean; finFacultative?: boolean; interim?: boolean }> = {
  cdi: { label: 'CDI' },
  cdd: { label: 'CDD', fin: true },
  interim: { label: 'Intérim', interim: true },
  // Apprentissage et professionnalisation peuvent être conclus en CDI (art. L6222-7, L6325-5) : fin facultative.
  alternance: { label: 'Alternance', finFacultative: true },
};

/**
 * Organisation du temps de travail.
 * - `seuil` : durée hebdomadaire au-delà de laquelle naissent les heures supplémentaires
 *   (absent pour les forfaits annuels et les cadres dirigeants : pas de décompte hebdomadaire).
 * - `base` : durée hebdomadaire de référence quand elle est fixe.
 */
export interface TempsDef { label: string; court: string; base?: number; seuil?: number; aide: string; article?: string }
export const TEMPS_TRAVAIL: Record<TempsTravail, TempsDef> = {
  '35h': { label: 'Horaire collectif 35 h', court: '35 h', base: 35, seuil: 35, aide: 'Heures supplémentaires au-delà de 35 h par semaine (+25 % jusqu’à 43 h, +50 % au-delà).' },
  '39h_rtt': { label: '39 h avec RTT', court: '39 h + RTT', base: 39, seuil: 39, aide: 'Les heures entre 35 et 39 h sont compensées par des jours de RTT ; heures supplémentaires au-delà de 39 h.' },
  forfait_heures_hebdo: { label: 'Forfait hebdomadaire en heures', court: 'Forfait heures (semaine)', aide: 'Durée convenue au-delà de 35 h : les heures supplémentaires incluses sont majorées dans la rémunération ; heures supplémentaires au-delà du forfait.', article: 'Art. L3121-56' },
  forfait_heures_annuel: { label: 'Forfait annuel en heures', court: 'Forfait heures (année)', aide: 'Durée annuelle convenue (1 607 h pour un temps plein) : pas de décompte hebdomadaire, les heures au-delà du forfait sont régularisées en fin d’année.', article: 'Art. L3121-56' },
  forfait_jours: { label: 'Forfait annuel en jours', court: 'Forfait jours', aide: 'Décompte en jours travaillés (218 au plus), jours de repos calculés chaque année, entretien annuel obligatoire sur la charge de travail.', article: 'Art. L3121-58 et L3121-64' },
  partiel: { label: 'Temps partiel', court: 'Temps partiel', aide: 'Durée hebdomadaire inférieure à 35 h ; heures complémentaires majorées de 10 % puis 25 %, dans la limite du tiers de la durée prévue.', article: 'Art. L3123-1' },
  dirigeant: { label: 'Cadre dirigeant', court: 'Cadre dirigeant', aide: 'Non soumis à la réglementation de la durée du travail : ni heures supplémentaires, ni RTT, ni décompte en jours.', article: 'Art. L3111-2' },
};

/** Sections d'un compte rendu : [clé, libellé, rédacteur] — 'mgr' évaluateur, 'sal' salarié. */
export type EntSection = [string, string, 'mgr' | 'sal'];
export const ENT_TYPES: Record<EntretienType, { nom: string; court: string; base: string; sections: EntSection[] }> = {
  epp: {
    nom: 'Entretien de parcours professionnel', court: 'Parcours pro',
    base: 'Art. L6315-1 — dans l’année suivant l’embauche, puis tous les 4 ans. Ne porte pas sur l’évaluation du travail ; copie remise au salarié.',
    sections: [['competences', 'Compétences et qualifications mobilisées', 'mgr'], ['parcours', 'Parcours et souhaits d’évolution', 'sal'], ['formation', 'Besoins de formation, activation du CPF', 'sal'], ['actions', 'Actions convenues', 'mgr']],
  },
  reprise: {
    nom: 'Entretien de parcours pro — reprise', court: 'Reprise',
    base: 'Art. L6315-1 — proposé systématiquement au retour de congé maternité, d’adoption, parental, de proche aidant, sabbatique, longue maladie…',
    sections: [['parcours', 'Parcours et souhaits d’évolution', 'sal'], ['formation', 'Besoins de formation, activation du CPF', 'sal'], ['amenagements', 'Aménagements de reprise', 'mgr'], ['actions', 'Actions convenues', 'mgr']],
  },
  bilan: {
    nom: 'État des lieux récapitulatif (8 ans)', court: 'État des lieux 8 ans',
    base: 'Art. L6315-1 — tous les 8 ans : vérifie les entretiens de parcours et le suivi d’au moins une formation non obligatoire.',
    sections: [['synthese', 'Synthèse du parcours sur 8 ans', 'mgr'], ['avis', 'Observations du salarié', 'sal']],
  },
  annuel: {
    nom: 'Entretien annuel d’évaluation', court: 'Annuel',
    base: 'Non obligatoire — méthodes et critères portés à la connaissance du salarié (art. L1222-3), compte rendu distinct de l’entretien de parcours.',
    sections: [['bilan', 'Bilan de l’année et des objectifs', 'mgr'], ['objectifs', 'Objectifs de l’année à venir', 'mgr'], ['avis', 'Commentaire du salarié', 'sal']],
  },
  forfait: {
    nom: 'Entretien annuel forfait jours', court: 'Forfait jours',
    base: 'Art. L3121-64 — chaque année : charge de travail, organisation, articulation vie pro / perso, rémunération, droit à la déconnexion.',
    sections: [['charge', 'Charge de travail', 'sal'], ['organisation', 'Organisation du travail dans l’entreprise', 'sal'], ['equilibre', 'Articulation vie professionnelle / personnelle', 'sal'], ['remuneration', 'Rémunération', 'mgr'], ['deconnexion', 'Droit à la déconnexion', 'mgr']],
  },
};

export const TRIMESTRES = ['T1', 'T2', 'T3', 'T4'] as const;

/** Vues accessibles par rôle (la première est la page d'accueil). */
export const ALLOWED_VIEWS = {
  rh: ['dashboard', 'collaborateurs', 'equipes', 'formations', 'habilitations', 'voyages', 'chantiers', 'echeances', 'budget', 'temps', 'absences', 'entretiens', 'missions', 'parametres'],
  manager: ['collaborateurs', 'formations', 'temps', 'absences', 'entretiens', 'missions'],
  collaborateur: ['portail', 'temps', 'absences', 'entretiens'],
} as const;
