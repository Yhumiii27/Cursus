// Libellés, classes de statut et règles fixes (droit du travail, formalités).
import type { EntretienType, Statut, TempsTravail, TypeContrat, VaccinId, VisaKind } from './types.ts';

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
export const ABS_LABEL = { CP: 'Congés payés', RTT: 'RTT / repos', RECUP: 'Récupération' } as const;
export const ABS_CLS = { demandee: 'tag-outline', validee: 'tag-neutral', refusee: 'tag-accent' } as const;
export const ABS_ST = { demandee: 'À valider', validee: 'Validée', refusee: 'Refusée' } as const;
export const TS_CLS = { vide: 'tag-outline', brouillon: 'tag-outline', soumise: 'tag-outline', validee: 'tag-neutral', rejetee: 'tag-accent' } as const;
export const TS_LABEL = { vide: 'Non saisie', brouillon: 'Brouillon', soumise: 'À valider', validee: 'Validée', rejetee: 'À corriger' } as const;
export const GNG_CLS = { go: 'tag-neutral', reserve: 'tag-outline', nogo: 'tag-accent' } as const;
export const GNG_LABEL = { go: 'Go', reserve: 'Go sous réserve', nogo: 'No Go' } as const;
export const GNG_CODE = { go: 'GO', reserve: 'GO_RESERVE', nogo: 'NO_GO' } as const;
/**
 * Codes de motif Go / No Go transmis à Keystone, contrat de l'API v1 (docs/keystone-openapi.json) :
 * un nouveau code s'ajoute ici, dans la spécification et dans docs/API-KEYSTONE.md.
 */
export const CODES_MOTIF = ['HABILITATION', 'HABILITATION_SUSPENDUE', 'HABILITATION_RETIREE', 'CERTIFICATION', 'DEPLACEMENT', 'FORMALITES_VOYAGE'] as const;
export type CodeMotif = typeof CODES_MOTIF[number];
/**
 * Activités internes (codes INT-*) et cours en CFA (ECOLE) : imputables dans les feuilles de temps,
 * jamais renvoyées à Keystone, qui ne reçoit que les heures passées sur ses projets.
 */
export const ACTIVITES_INTERNES = /^(?:INT-|ECOLE$)/;
export const PLAN_CLS = { prevu: 'tag-outline', engage: 'tag-accent', realise: 'tag-neutral' } as const;
export const PLAN_LABEL = { prevu: 'Prévu', engage: 'Engagé', realise: 'Réalisé' } as const;
export const REQ_CLS = { attente: 'tag-outline', acceptee: 'tag-neutral', refusee: 'tag-accent' } as const;
export const REQ_LABEL = { attente: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée' } as const;
/** File d'envoi des messages sortants (Paramètres → Envois). */
export const ENVOI_CLS = { a_envoyer: 'tag-outline', envoye: 'tag-neutral', echec: 'tag-accent', simule: 'tag-outline' } as const;
export const ENVOI_LABEL = { a_envoyer: 'À envoyer', envoye: 'Envoyé', echec: 'En échec', simule: 'Simulé' } as const;
/** Événements envoyés à Keystone (docs/API-KEYSTONE.md, « Événements envoyés par Cursus »). */
export const EVENEMENT_LABEL: Record<string, string> = {
  'demande.decision': 'Décision sur une demande de déplacement', 'heures.validees': 'Heures validées', 'absence.validee': 'Absence validée',
  'absence.annulee': 'Absence annulée', 'verdict.modifie': 'Verdict Go / No Go modifié',
};

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
