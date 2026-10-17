// Libellés, classes de statut et règles fixes (droit du travail, formalités).
import type {
  AbsenceStatut, AbsenceType, CompteType, CurrentUser, Destination, EntretienType, NatureAbsence, ProfilRh, Role, SecuDetachement, Statut, TempsTravail,
  TypeContrat, VaccinId, ValidationMode, VisaKind,
} from './types.ts';
import type { AvisMedical, MotifVisite } from './types.ts';

export type StatusKey = 'ok' | 'due' | 'exp';
/** `susp` : suspendue (prérequis non satisfait ou suspension manuelle) ; `retiree` : retirée, définitivement. */
export type HabKey = StatusKey | 'susp' | 'pending' | 'retiree';

export const CLS: Record<StatusKey, string> = { ok: 'tag-neutral', due: 'tag-outline', exp: 'tag-accent' };
export const CERT_LABEL: Record<StatusKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Expirée' };
export const EMP_LABEL: Record<StatusKey, string> = { ok: 'À jour', due: 'À renouveler', exp: 'Non conforme' };
export const DOC_LABEL: Record<StatusKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Expiré' };
export const RANK: Record<StatusKey, number> = { ok: 0, due: 1, exp: 2 };
/** Session dont la date est passée et qui attend sa clôture (présence, résultats) : plus rien n'y est « planifié ». */
export const SESSION_PASSEE = 'Session passée — à clôturer';
export const SESS_CLS: Record<string, string> = {
  'Confirmée': 'tag-neutral', 'À confirmer': 'tag-outline', 'Complète': 'tag-accent', [SESSION_PASSEE]: 'tag-accent', 'Clôturée': 'tag-neutral', 'Annulée': 'tag-outline',
};
export const VALIDATION_LABEL: Record<ValidationMode, string> = { presence: 'Présence suffit', evaluation: 'Évaluation réussie requise' };
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
 * Motifs de la reprise inscrite sur la fiche (`repriseMotif`), qui appelle l'entretien de parcours professionnel de
 * reprise (art. L6315-1) : liste fermée, enregistrée telle quelle, sans aucune information médicale. « absence longue »
 * couvre l'arrêt longue maladie (art. L324-1 du Code de la sécurité sociale) : sa reprise est masquée au manager
 * (`repriseMedicale`), qui ne reçoit d'ailleurs que cette mention pour toute autre reprise (server/src/dataset.ts).
 */
export const MOTIFS_REPRISE = [
  'congé de maternité', 'congé d’adoption', 'congé parental d’éducation', 'temps partiel parental', 'congé de proche aidant',
  'congé sabbatique', 'mobilité volontaire sécurisée', 'mandat syndical', 'absence longue',
] as const;
export type MotifReprise = typeof MOTIFS_REPRISE[number];
export const estMotifReprise = (v: unknown): v is MotifReprise => MOTIFS_REPRISE.includes(v as MotifReprise);

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
  duree?: number; parAn?: boolean; dureeNote?: string; article?: string; reprise?: MotifReprise; cp: string;
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
    reprise: 'absence longue', cp: CP_MALADIE,
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
  // 7 jours ouvrés (art. L3142-4), auxquels s'ajoute le congé de deuil (DEUIL_ENFANT, art. L3142-1-1).
  DECES_ENFANT_JEUNE: {
    label: 'Décès d’un enfant de moins de 25 ans, ou lui-même parent', abrege: 'Décès', court: 'congé pour décès d’un enfant', categorie: 'famille', paie: 'maintenue', decompte: 'ouvres',
    duree: 7, dureeNote: 'aussi pour une personne de moins de 25 ans à charge effective et permanente ; s’y ajoute le congé de deuil',
    justificatif: 'Acte de décès', article: 'Art. L3142-4', cp: CP_EVENEMENT,
  },
  // Congé de deuil, en plus du congé pour décès : à prendre dans l'année qui suit le décès, en une ou deux fois.
  DEUIL_ENFANT: {
    label: 'Congé de deuil (enfant de moins de 25 ans)', abrege: 'Deuil', court: 'congé de deuil', categorie: 'famille', paie: 'indemnisee', decompte: 'ouvres',
    duree: 8, dureeNote: 'dans l’année qui suit le décès, fractionnable en deux périodes ; indemnisé par la Sécurité sociale, complément employeur — modalités à vérifier par le service RH',
    justificatif: 'Acte de décès', article: 'Art. L3142-1-1', cp: 'Assimilé à du travail effectif (art. L3142-1-1)',
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
/**
 * Codes de motif Go / No Go transmis à Keystone, contrat de l'API v1 (docs/keystone-openapi.json) :
 * un nouveau code s'ajoute ici, dans la spécification et dans docs/API-KEYSTONE.md.
 */
export const CODES_MOTIF = [
  'HABILITATION', 'HABILITATION_SUSPENDUE', 'HABILITATION_RETIREE', 'CERTIFICATION', 'DEPLACEMENT', 'FORMALITES_VOYAGE',
  // Disponibilité sur la présence prévue (fin du contrat, absence, jamais sa nature), déplacement qui ne la couvre
  // pas en entier, formalités de détachement (sécurité sociale, information écrite d'une mission longue).
  'CONTRAT', 'ABSENCE', 'DEPLACEMENT_PARTIEL', 'DETACHEMENT',
  // Aptitude médicale : verdict seulement (inapte, visite en retard, restrictions en vigueur), jamais l'avis ni une date.
  'APTITUDE',
] as const;
export type CodeMotif = typeof CODES_MOTIF[number];
/**
 * Activités internes (codes INT-*) et cours en CFA (ECOLE) : imputables dans les feuilles de temps,
 * jamais renvoyées à Keystone, qui ne reçoit que les heures passées sur ses projets.
 */
export const ACTIVITES_INTERNES = /^(?:INT-|ECOLE$)/;
/**
 * Activité interne des heures de formation (shared/rules/formations-temps.ts) : ligne proposée dans la feuille de temps
 * des inscrits à une session, jamais envoyée à Keystone (code INT-*). Amorcée dans les projets par une migration nommée.
 */
export const ACTIVITE_FORMATION = { code: 'INT-FORM', nom: 'Formation' } as const;
// « Reporté » : action d'un exercice clos reprise sur l'exercice suivant (`plan.cloturerExercice`), hors des sommes.
export const PLAN_CLS = { prevu: 'tag-outline', engage: 'tag-accent', realise: 'tag-neutral', reporte: 'tag-outline' } as const;
export const PLAN_LABEL = { prevu: 'Prévu', engage: 'Engagé', realise: 'Réalisé', reporte: 'Reporté' } as const;
export const REQ_CLS = { attente: 'tag-outline', acceptee: 'tag-neutral', refusee: 'tag-accent', retiree: 'tag-outline' } as const;
export const REQ_LABEL = { attente: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée', retiree: 'Retirée' } as const;
/** File d'envoi des messages sortants (Paramètres → Envois). */
export const ENVOI_CLS = { a_envoyer: 'tag-outline', envoye: 'tag-neutral', echec: 'tag-accent', simule: 'tag-outline' } as const;
export const ENVOI_LABEL = { a_envoyer: 'À envoyer', envoye: 'Envoyé', echec: 'En échec', simule: 'Simulé' } as const;
/** Événements envoyés à Keystone (docs/API-KEYSTONE.md, « Événements envoyés par Cursus »). */
export const EVENEMENT_LABEL: Record<string, string> = {
  'demande.decision': 'Décision sur une demande de déplacement', 'heures.validees': 'Heures validées', 'absence.validee': 'Absence validée',
  'absence.annulee': 'Absence annulée', 'verdict.modifie': 'Verdict Go / No Go modifié',
  'deplacement.modifie': 'Déplacement modifié', 'deplacement.annule': 'Déplacement annulé',
};

/** E-mails (cible `email` de la file d'envoi) : nature de chaque message, affichée dans Paramètres → Envois. */
export const EMAIL_LABEL: Record<string, string> = {
  'absence.demande': 'Demande de congés à valider', 'absence.decision': 'Décision sur une demande de congés', 'temps.soumise': 'Feuille de temps à valider',
  'temps.renvoyee': 'Feuille de temps renvoyée', 'entretien.convocation': 'Convocation à un entretien', 'entretien.clos': 'Compte rendu d’entretien à signer',
  'demande.reponse': 'Réponse à une demande au service RH', 'convocation': 'Convocation à une formation', 'convocation.annulee': 'Convocation annulée',
  'releve.interim': 'Relevé d’heures des intérimaires', 'visite.demande': 'Demande de visite médicale', 'recapitulatif': 'Récapitulatif quotidien',
  'essai': 'E-mail d’essai', 'entretien.remise': 'Compte rendu d’entretien mis à disposition',
  'temps.relance': 'Relance des feuilles de temps en retard',
  'echeances.recapitulatif': 'Récapitulatif des échéances',
};
export const CIBLE_LABEL = { keystone: 'Keystone', sage: 'Sage Paie', email: 'E-mail' } as const;
export const MODE_NOTIFICATION_LABEL = { immediat: 'Aussitôt', quotidien: 'Récapitulatif quotidien' } as const;
/** Heure locale à partir de laquelle part le récapitulatif quotidien des notifications. */
export const HEURE_RECAPITULATIF = 7;

/** Périodicité par défaut des visites médicales, en mois (aperçu de la reprise des visites ; échéance réelle : shared/rules/suivi-medical.ts). */
export const MED_VALIDITE = 24;

// — Santé au travail : avis du médecin du travail et demandes de visite (shared/rules/sante.ts) —
export const AVIS_MEDICAL: Record<AvisMedical, { label: string; court: string }> = {
  apte: { label: 'Apte', court: 'Apte' },
  restrictions: { label: 'Apte avec restrictions ou aménagements de poste', court: 'Apte avec restrictions' },
  inapte: { label: 'Inapte', court: 'Inapte' },
};
/** Statut de l'échéance d'aptitude (Échéances, tableau de bord). */
export const MED_LABEL: Record<StatusKey, string> = { ok: 'Valide', due: 'À renouveler', exp: 'Échue' };
/** Échéance du suivi individuel renforcé sans examen médical d'aptitude enregistré (shared/rules/suivi-medical.ts). */
export const EXAMEN_REQUIS = 'Examen d’aptitude requis';
export const MOTIFS_VISITE: Record<MotifVisite, { label: string; court: string; article: string }> = {
  periodique: { label: 'Visite périodique — renouvellement de l’aptitude', court: 'renouvellement', article: 'Art. R4624-16 et R4624-28' },
  embauche: { label: 'Visite d’embauche — information et prévention, ou examen d’aptitude', court: 'embauche', article: 'Art. R4624-10 et R4624-24' },
  reprise: { label: 'Visite de reprise — après un arrêt de travail ou un congé de maternité', court: 'reprise', article: 'Art. R4624-31' },
  employeur: { label: 'À la demande de l’employeur', court: 'à la demande de l’employeur', article: 'Art. R4624-34' },
};
/**
 * Motif inscrit sur une habilitation suspendue à la suite d'un avis du médecin du travail : visible du manager
 * et du collaborateur, il ne dit rien de la restriction (`medical.avis` lève ces suspensions à l'avis suivant).
 */
export const MOTIF_RESTRICTION = 'Restriction d’aptitude';

export const VACCINS: Record<VaccinId, { nom: string; court: string; validite: number | null; delai: number }> = {
  fj: { nom: 'Fièvre jaune', court: 'Fièvre jaune', validite: null, delai: 10 },
  hepA: { nom: 'Hépatite A', court: 'Hép. A', validite: 240, delai: 14 },
  hepB: { nom: 'Hépatite B', court: 'Hép. B', validite: null, delai: 21 },
  typhoide: { nom: 'Typhoïde', court: 'Typhoïde', validite: 36, delai: 14 },
  dtp: { nom: 'DTP (diphtérie-tétanos-polio)', court: 'DTP', validite: 240, delai: 14 },
};

/**
 * Information de la personne (art. 13 du RGPD), affichée avant toute saisie d'une vaccination, par le salarié
 * (déclaration) comme par le service RH (à porter à la connaissance du salarié). Décision de l'entreprise : tous les
 * vaccins sont enregistrés avec leur date d'injection, et seul le service RH y a accès. Données de santé (art. 9) :
 * texte à faire valider par le DPO de l'entreprise. La conservation énonce ce que Cursus fait réellement : aucune
 * purge, même au départ du salarié ; les déclarations et le journal gardent les injections antérieures. La durée est
 * à fixer par le DPO avant la mise en service (docs/DEPLOIEMENT.md).
 */
export const INFO_VACCINATIONS = {
  titre: 'Vaccinations : des données de santé',
  points: [
    ['Responsable', 'votre employeur, pour l’organisation des déplacements professionnels.'],
    ['Finalité', 'vérifier avant un départ les vaccinations exigées ou recommandées par le pays de destination (préparation du voyage, verdict Go / No Go du chantier).'],
    ['Base légale', 'obligation de sécurité de l’employeur envers le salarié en déplacement (art. L4121-1 du Code du travail ; art. 6.1.c et 9.2.b du RGPD).'],
    ['Données', 'le vaccin et la date d’injection, rien d’autre : ni certificat, ni contre-indication, ni autre information médicale.'],
    ['Destinataires', 'le service RH seulement. Votre manager, les autres profils et Keystone ne voient que l’état du dossier de voyage, jamais le vaccin.'],
    ['Conservation', 'durée fixée par l’entreprise avec son délégué à la protection des données (à préciser avant la mise en service) ; rien n’est encore effacé automatiquement, même après votre départ. Votre dossier ne garde que la dernière injection de chaque vaccin, mais vos déclarations successives et le journal des actions gardent les précédentes.'],
    ['Vos droits', 'accès, rectification, effacement, limitation et opposition auprès du service RH ou du délégué à la protection des données ; réclamation auprès de la CNIL (cnil.fr).'],
    ['Si vous ne la déclarez pas', 'un déplacement vers un pays qui exige ce vaccin reste « à compléter ».'],
  ] as [string, string][],
};

export const VISA_RULES: Record<VisaKind, { label: string; sub: string; delai: number }> = {
  none: { label: 'Sans visa', sub: '', delai: 0 },
  evisa: { label: 'e-Visa d’affaires', sub: 'en ligne · 7 à 10 jours', delai: 10 },
  esta: { label: 'ESTA', sub: 'autorisation électronique · 72 h · valable 2 ans', delai: 3 },
  embassy: { label: 'Visa d’affaires', sub: 'ambassade · 3 à 4 semaines', delai: 28 },
};

/**
 * Sécurité sociale du salarié envoyé à l'étranger, formalité du service RH avant le départ : certificat A1
 * (règlement (CE) n° 883/2004 ; Royaume-Uni : accord de commerce et de coopération), certificat de détachement
 * de la convention bilatérale, ou, sans convention, maintien au régime français. `delai` : jours à prévoir
 * avant le départ. Données indicatives, à vérifier sur cleiss.fr.
 */
export const SECU_RULES: Record<SecuDetachement, { label: string; court: string; portee: string; demarche: string; delai: number }> = {
  a1: { label: 'Certificat A1', court: 'Certificat A1', portee: 'Union européenne, EEE, Suisse, Royaume-Uni', demarche: 'demande en ligne sur net-entreprises.fr', delai: 7 },
  convention: {
    label: 'Certificat de détachement', court: 'Détachement', portee: 'Convention bilatérale de sécurité sociale',
    demarche: 'formulaire de la convention, visé par la caisse d’assurance maladie', delai: 21,
  },
  hors_convention: {
    label: 'Maintien au régime français', court: 'Sécurité sociale', portee: 'Pays sans convention de sécurité sociale',
    demarche: 'demande à la caisse d’assurance maladie (art. L761-2 du Code de la sécurité sociale)', delai: 21,
  },
};
/** Union européenne, EEE, Suisse et Royaume-Uni : certificat A1. */
const PAYS_A1 = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'IS', 'LI', 'NO', 'CH', 'GB',
]);
/** Pays liés à la France par une convention bilatérale de sécurité sociale (liste indicative du Cleiss). */
const PAYS_CONVENTION = new Set([
  'AD', 'AR', 'AU', 'BA', 'BJ', 'BR', 'CA', 'CG', 'CI', 'CL', 'CM', 'CN', 'CV', 'DZ', 'GA', 'IL', 'IN', 'JP', 'KR', 'MA', 'MC', 'ME', 'MG', 'MK', 'ML',
  'MR', 'NE', 'PH', 'RS', 'SM', 'SN', 'TG', 'TN', 'TR', 'US', 'UY', 'XK',
]);
/** Formalité de sécurité sociale d'une destination : celle du référentiel, sinon celle que donne son code pays. */
export const secuDe = (dest: Pick<Destination, 'code' | 'secu'>): SecuDetachement =>
  dest.secu && Object.hasOwn(SECU_RULES, dest.secu) ? dest.secu
    : PAYS_A1.has(dest.code) ? 'a1' : PAYS_CONVENTION.has(dest.code) ? 'convention' : 'hors_convention';
/** Mission à l'étranger au-delà de laquelle (4 semaines consécutives) le salarié reçoit une information écrite avant le départ. */
export const MISSION_LONGUE_JOURS = 28;

/** Catégories de la CCN Industries chimiques ; « non-cadre » regroupe les deux premières. */
export const STATUTS: Record<Statut, { label: string; court: string; cadre: boolean }> = {
  ouvrier: { label: 'Ouvrier / employé', court: 'Ouvrier · employé', cadre: false },
  technicien: { label: 'Technicien / agent de maîtrise', court: 'Technicien · AM', cadre: false },
  cadre: { label: 'Ingénieur / cadre', court: 'Cadre', cadre: true },
};

/**
 * Période d'essai d'un CDI : durées maximales légales selon le statut, en mois, avant et après un renouvellement
 * (art. L1221-19 et L1221-21 ; le renouvellement n'est possible que si un accord de branche étendu le prévoit et que le
 * contrat le stipule). Cursus ne propose aucune durée : il avertit quand la date saisie les dépasse. Les durées de la CCN
 * Industries chimiques, qui peuvent être plus courtes, s'ajouteront ici une fois vérifiées.
 */
export const ESSAI_MAX_CDI: Record<Statut, { mois: number; renouvele: number }> = {
  ouvrier: { mois: 2, renouvele: 4 },
  technicien: { mois: 3, renouvele: 6 },
  cadre: { mois: 4, renouvele: 8 },
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

// — Rubriques de paie (shared/rules/paie.ts) —
/** Unité d'une rubrique de paie : heures, jours ou nombre. */
export type UniteRubrique = 'h' | 'j' | 'nombre';
/**
 * Rubriques de paie émises par Cursus, liste unique (code interne → libellé, unité), dans l'ordre d'affichage : chaque
 * code se fait correspondre un code du plan de paie Sage, confirmé par l'administrateur RH ou la paie (table
 * `rubriquesPaie`). Y ajouter les futurs codes : absences, déplacements, contrepartie en repos, régularisations.
 */
export const RUBRIQUES_PAIE: Record<string, { label: string; unite: UniteRubrique }> = {
  HN: { label: 'Heures normales', unite: 'h' },
  HSF25: { label: 'Heures supplémentaires incluses au forfait hebdomadaire, majorées à 25 %', unite: 'h' },
  HSF50: { label: 'Heures supplémentaires incluses au forfait hebdomadaire, majorées à 50 %', unite: 'h' },
  HS25: { label: 'Heures supplémentaires payées, majorées à 25 %', unite: 'h' },
  HS50: { label: 'Heures supplémentaires payées, majorées à 50 %', unite: 'h' },
  HC10: { label: 'Heures complémentaires de temps partiel, majorées à 10 %', unite: 'h' },
  HC25: { label: 'Heures complémentaires de temps partiel, majorées à 25 %', unite: 'h' },
  RCR_ACQUIS: { label: 'Repos compensateur de remplacement acquis, majoration incluse', unite: 'h' },
  JTRAV: { label: 'Jours travaillés, forfait jours', unite: 'j' },
  // Semaine à 7 jours (shared/rules/semaine.ts) : heures du dimanche, déjà comprises dans les heures ci-dessus (information
  // pour la paie), et leur majoration si le réglage `majorationDimanche` en prévoit une (heures équivalentes).
  HDIM: { label: 'Heures travaillées le dimanche (comprises dans les heures ci-dessus)', unite: 'h' },
  MAJ_DIM: { label: 'Majoration des heures du dimanche (heures équivalentes)', unite: 'h' },
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
  // `miseEnService` : reprise depuis Lucca, ouverte depuis Paramètres (hors du menu ; imports réservés à l'administrateur RH).
  rh: ['dashboard', 'collaborateurs', 'equipes', 'formations', 'habilitations', 'voyages', 'chantiers', 'echeances', 'budget', 'temps', 'absences', 'entretiens', 'missions', 'parametres', 'referentiels', 'miseEnService'],
  manager: ['collaborateurs', 'formations', 'temps', 'absences', 'entretiens', 'missions'],
  collaborateur: ['portail', 'temps', 'absences', 'entretiens'],
} as const;
/** Vues ouvertes dans tous les espaces et sans connexion : information sur les données personnelles (shared/confidentialite.ts). */
export const VUES_COMMUNES = ['confidentialite'] as const;

// — Comptes et droits —
/**
 * Droits accordés par un profil, dans l'espace RH :
 * - `rh` : gestion courante du service RH (fiches, équipes, formations, absences, temps, entretiens, déplacements…),
 *   toutes les données, santé comprise ;
 * - `formations` : catalogue, sessions et présences, certifications et habilitations, suivi des verdicts Go / No Go ;
 * - `paie` : contrôle des temps, absences et soldes, transmission des variables de paie à Sage ;
 * - `consultation` : lecture de tout l'espace (tableaux de bord, alertes, journal des actions), sans modification ;
 * - `admin` : paramètres, suppressions, comptes et accès.
 * Sans le droit `rh`, l'instantané envoyé au navigateur ne porte que ce que les autres droits ouvrent, jamais de
 * donnée de santé détaillée (server/src/dataset.ts), et chaque action contrôle son droit (server/src/actions/context.ts).
 */
export type DroitRh = 'rh' | 'formations' | 'paie' | 'consultation' | 'admin';
/**
 * Profils d'un compte : deux niveaux au sein du service RH, puis trois profils restreints, décidés par l'entreprise.
 * `vues` : écrans ouverts par un profil restreint (sinon ceux de l'espace RH) ; `espace` : nom court de son espace.
 */
export const PROFILS_RH: Record<ProfilRh, { label: string; aide: string; droits: readonly DroitRh[]; espace?: string; vues?: readonly string[] }> = {
  aucun: { label: 'Aucun', aide: 'Pas d’accès à l’espace RH', droits: [] },
  rh_gestionnaire: { label: 'Gestionnaire RH', aide: 'Fiches, équipes, formations, habilitations, absences, temps, déplacements', droits: ['rh', 'formations', 'consultation'] },
  rh_admin: {
    label: 'Administrateur RH', aide: 'Tout l’espace RH, plus les paramètres, la transmission à la paie, les suppressions et les comptes',
    droits: ['rh', 'formations', 'paie', 'consultation', 'admin'],
  },
  referent_hse: {
    label: 'Référent HSE / formation', espace: 'HSE', droits: ['formations'],
    aide: 'Catalogue, sessions et présences, certifications et habilitations, verdicts Go / No Go ; aptitude médicale réduite au verdict et aux restrictions en vigueur, comme pour un manager ; ni temps, ni paie, ni entretiens',
    vues: ['dashboard', 'collaborateurs', 'formations', 'habilitations', 'echeances', 'chantiers', 'referentiels'],
  },
  paie: {
    label: 'Gestionnaire de paie', espace: 'Paie', droits: ['paie'],
    aide: 'Temps, absences et soldes en lecture, transmission des variables de paie à Sage ; ni entretiens, ni formations, ni données de santé',
    vues: ['temps', 'absences'],
  },
  lecture_seule: {
    label: 'Lecture seule', espace: 'Lecture', droits: ['consultation'],
    aide: 'Direction, DPO, auditeur : tableaux de bord, alertes et journal des actions, sans rien modifier ; ni données de santé détaillées, ni dossiers de voyage',
    vues: ['dashboard', 'collaborateurs', 'equipes', 'formations', 'habilitations', 'echeances', 'budget', 'chantiers', 'temps', 'absences', 'entretiens', 'missions', 'parametres', 'referentiels'],
  },
};
export const aDroitRh = (p: ProfilRh | undefined, droit: DroitRh) => !!p && !!PROFILS_RH[p]?.droits.includes(droit);
/** Le profil ouvre-t-il l'espace RH (au moins un droit) ? */
export const ouvreEspaceRh = (p: ProfilRh | undefined) => !!p && (PROFILS_RH[p]?.droits.length ?? 0) > 0;
/**
 * Droits de la personne connectée : ceux de son profil dans l'espace RH, aucun ailleurs. Une lecture interne sans
 * compte (jeu de démonstration, appels Keystone, tests) a ceux du gestionnaire RH.
 */
export function droitsRh(u: Pick<CurrentUser, 'role' | 'profilRh'>): readonly DroitRh[] {
  if (u.role !== 'rh') return [];
  return PROFILS_RH[u.profilRh ?? 'rh_gestionnaire']?.droits ?? [];
}
/** Écrans ouverts dans un espace, selon le profil pour l'espace RH (le premier est la page d'accueil). */
export function vuesDe(role: Role, profilRh?: ProfilRh): readonly string[] {
  return (role === 'rh' && profilRh && PROFILS_RH[profilRh]?.vues) || ALLOWED_VIEWS[role];
}

export const COMPTE_TYPE_LABEL: Record<CompteType, string> = { microsoft: 'Microsoft 365', local: 'Compte Cursus' };
export const ESPACE_LABEL: Record<Role, string> = { rh: 'RH', manager: 'Manager', collaborateur: 'Collaborateur' };
/** Longueur minimale du mot de passe d'un compte local. */
export const MOT_DE_PASSE_MIN = 12;
/** Échecs de connexion successifs avant le blocage temporaire d'un compte local, et durée du blocage. */
export const ECHECS_MAX = 5;
export const BLOCAGE_MINUTES = 15;
/**
 * Échecs de la connexion Microsoft 365 : le serveur renvoie vers l'écran de connexion avec `?connexion=<code>`
 * (jamais de texte libre dans l'adresse), l'écran affiche « titre : texte ». Le détail est écrit dans le journal.
 */
export const ERREURS_MICROSOFT = {
  acces: { titre: 'Accès non autorisé', texte: 'demandez l’ouverture d’un compte au service RH.' },
  ferme: { titre: 'Accès non autorisé', texte: 'votre compte Cursus est désactivé ou votre date de sortie est passée. Adressez-vous au service RH.' },
  etat: { titre: 'Connexion interrompue', texte: 'la connexion Microsoft a expiré ou a déjà servi. Recommencez.' },
  refus: { titre: 'Connexion refusée par Microsoft', texte: 'Cursus n’est pas autorisé pour ce compte. Si le problème persiste, prévenez le service informatique.' },
  jeton: { titre: 'Connexion impossible', texte: 'la réponse de Microsoft n’a pas pu être vérifiée. Recommencez ; si le problème persiste, prévenez le service informatique.' },
  indisponible: { titre: 'Connexion Microsoft indisponible', texte: 'réessayez dans quelques minutes, ou utilisez un compte Cursus.' },
} as const;
export type ErreurMicrosoft = keyof typeof ERREURS_MICROSOFT;
