// Modèle de données de Cursus, partagé entre le serveur (SQLite) et le client.
// Les dates sont des chaînes ISO « AAAA-MM-JJ » (heure locale, sans fuseau).

export type ISODate = string;
export type Role = 'rh' | 'manager' | 'collaborateur';

export type FormationType = 'Réglementaire' | 'Recommandée' | 'Interne';
export type VaccinId = 'fj' | 'hepA' | 'hepB' | 'typhoide' | 'dtp';
export type VisaKind = 'none' | 'evisa' | 'esta' | 'embassy';
/**
 * Sécurité sociale du salarié envoyé dans le pays : certificat A1 (Union européenne, EEE, Suisse, Royaume-Uni),
 * certificat de détachement d'une convention bilatérale, ou maintien au régime français (pays sans convention).
 */
export type SecuDetachement = 'a1' | 'convention' | 'hors_convention';
/** Catégories de la CCN Industries chimiques. */
export type Statut = 'ouvrier' | 'technicien' | 'cadre';
export type TypeContrat = 'cdi' | 'cdd' | 'interim' | 'alternance';
/** Organisation du temps de travail (durée de référence ou convention de forfait). */
export type TempsTravail = '35h' | '39h_rtt' | 'forfait_heures_hebdo' | 'forfait_heures_annuel' | 'forfait_jours' | 'partiel' | 'dirigeant';
/** Congés décomptés sur un solde : congés payés, RTT / jours de repos, récupération. */
export type CongeType = 'CP' | 'RTT' | 'RECUP';
/** Absences hors congés : natures du référentiel `NATURES_ABSENCE` (shared/constants.ts). */
export type NatureAbsence =
  | 'MALADIE' | 'ALD' | 'AT' | 'TRAJET' | 'MP'
  | 'MATERNITE' | 'PATERNITE' | 'ADOPTION' | 'PARENTAL'
  | 'MARIAGE' | 'MARIAGE_ENFANT' | 'NAISSANCE' | 'DECES_ENFANT' | 'DECES_ENFANT_JEUNE' | 'DEUIL_ENFANT' | 'DECES_PROCHE' | 'HANDICAP_ENFANT' | 'ENFANT_MALADE'
  | 'SANS_SOLDE' | 'INJUSTIFIEE';
/** `ABSENCE` : absence signalée dont le service RH n'a pas encore précisé la nature (et nature médicale vue par le manager). */
export type AbsenceType = CongeType | NatureAbsence | 'ABSENCE';
/** `signalee` : absence imprévue signalée, à qualifier par le service RH ; `annulee` : demande retirée ou absence annulée. */
export type AbsenceStatut = 'demandee' | 'validee' | 'refusee' | 'signalee' | 'annulee';
export type FeuilleStatut = 'brouillon' | 'soumise' | 'validee' | 'rejetee';
export type EntretienType = 'epp' | 'reprise' | 'bilan' | 'annuel' | 'forfait';
export type PlanStatut = 'prevu' | 'engage' | 'realise';
export type Trimestre = 'T1' | 'T2' | 'T3' | 'T4';
export type VoyageOrigine = 'formulaire' | 'keystone' | 'cursus';
export type TripStatus = 'pret' | 'todo' | 'bloc';
export type DemandeType = 'formation' | 'habilitation' | 'document';
export type DemandeStatut = 'attente' | 'acceptee' | 'refusee';
/** Mode de validation d'une formation (catalogue) : la présence suffit, ou une évaluation réussie est requise. */
export type ValidationMode = 'presence' | 'evaluation';
/** Cycle de vie d'une session : à confirmer → confirmée → clôturée (présence, résultats) ; ou annulée. */
export type SessionStatut = 'À confirmer' | 'Confirmée' | 'Clôturée' | 'Annulée';

// — Référentiels —
export interface Formation { id: string; nom: string; court: string; type: FormationType; validite: number; duree: string; organisme: string; cout: number; validation: ValidationMode }
export interface HabType { id: string; nom: string; detail: string; prereqs: string[]; medical: boolean; validite: number; signataire: string }
export interface Destination {
  code: string; pays: string; visa: VisaKind; visaSub: string; oblig: VaccinId[]; rec: VaccinId[]; passMois: number;
  /** Formalité de sécurité sociale du détachement ; null : déduite du code pays (`secuDe` de shared/constants.ts). */
  secu: SecuDetachement | null;
}
export interface Equipe { nom: string; managerId: number | null; ordre: number }
/** Projet ou chantier tenu dans Keystone : archivé, il reste en base (historique) sans plus être proposé ni évalué. */
export type StatutKeystone = 'actif' | 'archive';
export interface Projet { code: string; nom: string; statut: StatutKeystone }
/**
 * Chantier transmis par Keystone (identifiant Keystone). `ressources` : salariés dont une affectation
 * chevauche les dates du chantier, recalculés par le serveur (server/src/integrations/keystone-entrant.ts).
 */
export interface Chantier { id: string; nom: string; client: string; lieu: string; pays: string; debut: ISODate; fin: ISODate; chef: string; habs: string[]; certs: string[]; ressources: number[]; statut: StatutKeystone }

export interface Referentiels {
  formations: Formation[];
  habilitations: HabType[];
  destinations: Destination[];
  equipes: Equipe[];
  projets: Projet[];
  chantiers: Chantier[];
}

// — Collaborateurs —
/** `convocLe` : date d'envoi de la dernière convocation à la session (e-mail avec fichier .ics). */
export interface Certification { id: number; empId: number; f: string; obtenue: ISODate; sessionId: number | null; convoc: 'now' | 'later' | null; convocLe: ISODate | null }
/** Mesure prise sur un titre après un incident ou une restriction : suspension (réversible) ou retrait (définitif). */
export type HabMesure = 'suspension' | 'retrait';
export interface HabTitre {
  id: number; empId: number; h: string; delivree: ISODate | null; par: string | null; demande: ISODate | null;
  /** Suspension ou retrait en cours (null = aucun), avec sa date, son motif (texte libre) et son auteur. */
  mesure: HabMesure | null; mesureDate: ISODate | null; mesureMotif: string | null; mesurePar: string | null;
}
/** Avis du médecin du travail à l'issue d'une visite : apte, apte avec restrictions ou aménagements de poste, inapte. */
export type AvisMedical = 'apte' | 'restrictions' | 'inapte';
/**
 * Restriction ou aménagement de poste, recopié tel qu'écrit sur l'avis (« pas de port de charges de plus de 15 kg »),
 * jusqu'à une date (incluse) ou sans terme.
 */
export interface Restriction { texte: string; jusquau: ISODate | null }
/** Motif d'une demande de visite au service de prévention et de santé au travail. */
export type MotifVisite = 'periodique' | 'embauche' | 'reprise' | 'employeur';
/**
 * Demande de visite médicale du service RH : en cours (`demandee`) jusqu'à la saisie de la visite (`realisee`,
 * datée du jour de la visite) ou son annulation. Réservée au service RH et à l'intéressé.
 */
export interface DemandeVisite {
  id: number; empId: number; motif: MotifVisite; le: ISODate; par: string;
  statut: 'demandee' | 'realisee' | 'annulee';
  closeLe: ISODate | null; closePar: string | null;
}
export interface Visa { id: number; empId: number; dest: string; type: string; obtenu: ISODate | null; expire: ISODate }
export interface Vaccination { id: number; empId: number; v: VaccinId; date: ISODate }
/** `numero` : absent des données envoyées au manager, qui ne reçoit que la date d'expiration (server/src/dataset.ts). */
export interface Passeport { numero?: string; expire: ISODate }

export interface Employe {
  id: number;
  nom: string;
  /** Équipe d'affectation ; null = à affecter par le service RH. */
  equipe: string | null;
  poste: string;
  statut: Statut;
  typeContrat: TypeContrat;
  temps: TempsTravail;
  /** Durée hebdomadaire : temps partiel ou forfait hebdomadaire en heures. */
  heures: number | null;
  /** Forfait annuel en heures (par exemple 1 607 h). */
  forfaitHeures: number | null;
  /** Forfait annuel en jours (218 au plus, art. L3121-64). */
  forfaitJours: number | null;
  /** Jours non travaillés du temps partiel (0 = lundi … 4 = vendredi). */
  jourOff: number[];
  /** Date d'effet de l'organisation du temps actuelle (null = depuis l'entrée). */
  tempsDepuis: ISODate | null;
  entree: ISODate;
  fin: ISODate | null;
  naissance: number;
  agence: string | null;
  /** Adresse e-mail professionnelle (notifications, convocations), saisie par le service RH ; unique, en minuscules. */
  email: string | null;
  /** Notifications d'étapes par e-mail : aussitôt, ou regroupées dans un récapitulatif quotidien (réglage de la personne). */
  notifications: ModeNotification;
  repriseMotif: string | null;
  repriseDate: ISODate | null;
  /** Date de la dernière visite d'aptitude — réservée au service RH. */
  visite: ISODate | null;
  /**
   * Avis rendu à cette visite (null : apte, visite saisie avant l'enregistrement des avis) et ses restrictions,
   * enregistrés par `medical.avis` — réservés au service RH et à l'intéressé.
   */
  avis: AvisMedical | null;
  restrictions: Restriction[];
  /**
   * Remplace `visite` et `avis` dans les vues manager et des profils restreints de l'espace RH : seul le verdict est
   * transmis (aptitude valide ou non, avis), avec les restrictions en vigueur recopiées telles qu'écrites, sans date de visite.
   */
  aptitude?: { ok: boolean; avis?: AvisMedical | null; restrictions?: Restriction[] };
  passeport: Passeport | null;
  certs: Certification[];
  habs: HabTitre[];
  visas: Visa[];
  vaccins: Vaccination[];
}

export interface Personne { id: number; nom: string; equipe: string | null; poste: string }

// — Formations & plan —
export interface Session {
  id: number; formation: string; date: ISODate; lieu: string; places: number; statut: SessionStatut;
  /** Calculé au chargement (certifications rattachées, inscriptions, résultats de clôture), jamais stocké. */
  inscrits: number;
  /** Action du plan de formation à l'origine de la session. */
  planId: number | null;
  /** Clôture (évaluation à chaud) ou annulation (motif) : date et auteur. */
  bilan: SessionBilan | null;
}
export interface SessionBilan { le: ISODate; par: string; note: number | null; commentaire: string | null; motif: string | null }
/**
 * Inscription à une session d'une formation que le collaborateur n'a encore jamais suivie (formation initiale).
 * Rattachée à une session annulée, ou clôturée sans certification (absent, évaluation échouée) : à replanifier.
 */
export interface Inscription { id: number; empId: number; sessionId: number; convoc: 'now' | 'later'; date: ISODate; convocLe: ISODate | null }
/** Résultat d'un inscrit, enregistré à la clôture de la session. */
export interface Participation {
  id: number; sessionId: number; empId: number; parcours: 'recyclage' | 'initiale'; present: boolean;
  /** Évaluation : null si la formation ne l'exige pas, ou pour un absent. */
  reussi: boolean | null;
  /** Certification enregistrée (présent, et reçu si l'évaluation est exigée). */
  certId: number | null;
}
export interface PlanAction { id: number; exercice: number; f: string | null; libelle: string | null; equipe: string; periode: Trimestre; effectif: number; cout: number; statut: PlanStatut; origine: string | null }

// — Déplacements & projets —
/** Formalité obligatoire manquante d'un déplacement (« formalité sanitaire » pour un vaccin), hors délai ou non. */
export interface FormaliteManquante { label: string; late: boolean; detachement: boolean }

export interface Voyage {
  id: number; empId: number; dest: string; depart: ISODate; retour: ISODate; motif: string; origine: VoyageOrigine; ref: string | null; chantier: string | null; dossierStatut?: TripStatus;
  /**
   * Formalités de détachement tenues par le service RH : obtention du certificat de sécurité sociale (A1, convention
   * bilatérale ou maintien au régime français) et remise de l'information écrite d'une mission de plus de 4 semaines.
   */
  detachementLe: ISODate | null; informationLe: ISODate | null;
  /** Formalités obligatoires manquantes, précalculées avec `dossierStatut` quand les pièces ne sont pas transmises. */
  dossierManque?: FormaliteManquante[];
}
/** Demande de déplacement reçue de Keystone (`ref` : référence externe unique), conservée après décision du RH. */
export interface DemandeKeystone {
  id: number; empId: number; chantier: string; dest: string; depart: ISODate; retour: ISODate; recue: ISODate;
  ref: string | null; statut: DemandeStatut; decidee: ISODate | null; decideur: string | null; voyageId: number | null;
  /** Motif d'un refus par le service RH : conservé dans Cursus, jamais transmis à Keystone. */
  motifRefus?: string | null;
}
/** Présence d'un salarié sur un projet ou un chantier ; `ref` : identifiant Keystone de l'affectation. */
export interface Mission { id: number; empId: number; projet: string; lieu: string; du: ISODate; au: ISODate; type: string; ref: string | null }
/** Tâche planifiée par Keystone pour un salarié : heures prévues par date, entre `debut` et `fin`. */
export interface TacheKeystone { id: number; ref: string | null; empId: number; projet: string; tache: string; debut: ISODate; fin: ISODate; heures: Record<ISODate, number> }

// — Temps & absences —
export interface LigneTemps { projet: string; tache: string; ks: boolean; h: number[] }
/** Régime de temps de travail figé sur une feuille soumise : un changement de contrat ultérieur ne la recalcule pas. */
export type ContratFige = Pick<Employe, 'statut' | 'typeContrat' | 'temps' | 'heures' | 'forfaitHeures' | 'forfaitJours' | 'jourOff'>;
export interface FeuilleTemps {
  id: number; empId: number; week: ISODate; statut: FeuilleStatut; comment: string | null; sage: boolean; keystone: boolean; lignes: LigneTemps[]; contrat: ContratFige | null;
  /** Motif d'un dépassement des durées maximales (10 h par jour, 48 h par semaine), exigé à la soumission ou à la validation. */
  motifDepassement?: string | null;
  /**
   * Mode des heures supplémentaires figé à la validation (réglage `heuresSupMode` du jour) : payées ou remplacées par un
   * repos ; « historique » pour une feuille transmise avant ce choix (payées et repos crédité, calcul d'origine). Null
   * avant la validation : le réglage en vigueur s'applique (`calcSheet` de shared/rules/temps.ts).
   */
  heuresSup?: ModeHeuresSupFige | null;
}
/** Heures supplémentaires payées avec majoration, ou remplacées par un repos compensateur (accord collectif, art. L3121-37). */
export type ModeHeuresSup = 'paiement' | 'repos';
/** Mode figé sur une feuille validée ; `historique` : feuille transmise à la paie avant le choix du mode (lot 4). */
export type ModeHeuresSupFige = ModeHeuresSup | 'historique';
export interface Absence {
  id: number; empId: number; type: AbsenceType; du: ISODate; au: ISODate; statut: AbsenceStatut;
  /** Indisponibilité transmise à Keystone (une annulation l'en retire). */
  keystone: boolean;
  /** Absence signalée : date et auteur du signalement. */
  signaleLe: ISODate | null; signalePar: string | null;
  /** Signalée par l'intéressé lui-même (et non par son manager ou le RH) : lui seul peut alors la retirer. */
  signaleParInteresse: boolean;
  /** Justificatif reçu par le service RH (avis d'arrêt, acte…) et date de réception. */
  justificatif: boolean; justificatifLe: ISODate | null;
  /** Fin prévue avant la première prolongation (null = jamais prolongée). */
  finInitiale: ISODate | null;
  /** Demande retirée ou absence annulée : date et auteur. */
  annuleeLe: ISODate | null; annuleePar: string | null;
  /** Demande refusée : motif donné par le valideur, montré au salarié. */
  motifRefus?: string | null;
}
export interface CetMouvement { id: number; empId: number; type: 'CP' | 'RTT'; jours: number; date: ISODate; periode: string }
export interface ReportCp { id: number; empId: number; jours: number; motif: string; par: string; date: ISODate; sens: 'recu' | 'accorde' }
/** Compteurs repris de l'ancien système pour les périodes en cours. */
export interface SoldeReprise { empId: number; cpPris: number; rttPris: number; recupAcquis: number; recupPris: number }

// — Entretiens & demandes —
/**
 * `planifieLe` : jour où l'entretien a été planifié ou reprogrammé (`entretien.planifier`), borne de la date réelle
 * enregistrée à la clôture (`debutCloture`) ; null pour un entretien planifié avant que Cursus la conserve.
 */
export interface Entretien { id: number; empId: number; type: EntretienType; date: ISODate; statut: 'planifie' | 'realise'; cr: Record<string, string>; info: boolean; signSal: ISODate | null; signMgr: ISODate | null; planifieLe?: ISODate | null }
/** Demande au service RH, émise par le collaborateur ou par son manager (`parId`). */
export interface DemandeCollab { id: number; empId: number; type: DemandeType; f: string | null; h: string | null; libelle: string | null; label: string | null; sessionId: number | null; motif: string | null; date: ISODate; statut: DemandeStatut; reponse: string | null; parId: number | null; declaration: Declaration | null;
  /** Demande refusée : motif donné par le service RH, montré au collaborateur. */
  motifRefus?: string | null;
}
/**
 * Formalité déclarée par le collaborateur (demande « document ») : conservée dans la demande
 * et écrite dans le dossier seulement quand le service RH la valide. Réservée au RH et à l'intéressé.
 * `dejaAuDossier` : déclaration antérieure à la validation RH, déjà enregistrée (reprise d'une ancienne base).
 */
export type Declaration = (
  | { kind: 'passeport'; numero: string; expire: ISODate }
  | { kind: 'visa'; dest: string; type: string; obtenu: ISODate | null; expire: ISODate }
  | { kind: 'vaccin'; v: VaccinId; date: ISODate }
) & { dejaAuDossier?: boolean };

// — Paramètres & session —
/** Réglages de l'écran Paramètres : chaque champ a sa ligne (défaut, contrôle) dans REGLAGES de shared/reglages.ts. */
export interface Settings {
  horizonAlerte: number;
  uniquementReglementaire: boolean;
  seuilBudget: number;
  partageKeystone: 'minimal' | 'detaille';
  rtt39: number;
  vueInitiale: string;
  // Paie (client/src/pages/parametres/ReglagesPaie.tsx, shared/rules/paie.ts) : heures supplémentaires payées ou en repos
  // (référence de l'accord qui le prévoit), rattachement d'une semaine à cheval sur deux mois, jour de clôture (0 : dernier jour).
  heuresSupMode: ModeHeuresSup;
  heuresSupAccord: string;
  periodeRattachement: RattachementPeriode;
  clotureJour: number;
}

/**
 * Personne connectée, dans l'espace actif. Dans l'espace RH, `empId` reste null : la personne agit
 * au nom du service RH, mais son nom signe le journal et les mesures.
 */
export interface CurrentUser {
  role: Role; empId: number | null; nom: string; intitule: string;
  /** Compte connecté (absent des lectures internes : appels Keystone, jeu de démonstration). */
  compteId?: number;
  /** Profil RH du compte : les actions réservées à l'administrateur RH exigent `rh_admin`. */
  profilRh?: ProfilRh;
  /**
   * Salarié rattaché au compte, dans tous les espaces (dans l'espace RH, `empId` reste null) : un membre du
   * service RH ne décide pas de ses propres absences, feuilles de temps ou entretiens.
   */
  salarieId?: number | null;
}

// — Comptes de connexion —
/**
 * Profil d'un compte dans l'espace RH (droits : PROFILS_RH dans shared/constants.ts) : deux niveaux au sein du
 * service RH, et trois profils restreints — référent HSE / formation, gestionnaire de paie, lecture seule.
 */
export type ProfilRh = 'aucun' | 'rh_admin' | 'rh_gestionnaire' | 'referent_hse' | 'paie' | 'lecture_seule';
/** Compte Microsoft 365 de l'entreprise, ou compte propre à Cursus (mot de passe) pour le personnel sans compte d'entreprise. */
export type CompteType = 'microsoft' | 'local';

/** Compte tel que le voit l'administrateur RH (Paramètres → Comptes et accès). */
export interface CompteVue {
  id: number;
  /** Salarié rattaché ; null pour un compte externe (nom et adresse propres). */
  empId: number | null;
  nom: string;
  adresse: string | null;
  identifiant: string;
  type: CompteType;
  profilRh: ProfilRh;
  /** Espaces ouverts par le compte (aucun : connexion impossible). */
  espaces: Role[];
  actif: boolean;
  /** Date de sortie du salarié passée : connexion refusée. */
  sorti: boolean;
  /** Compte local : mot de passe provisoire à remplacer à la prochaine connexion. */
  changerMotDePasse: boolean;
  /** Compte Microsoft 365 : rattaché à son identité Microsoft (oid), c'est-à-dire déjà connecté une fois. */
  rattache: boolean;
  /** Fin du blocage temporaire après des échecs de connexion (ISO), si elle n'est pas passée. */
  bloqueJusqua: string | null;
  creation: string;
  creePar: string | null;
  derniereConnexion: string | null;
}

/** Compte de la session, transmis au client (`/api/session`). */
export interface CompteSession {
  id: number; identifiant: string; nom: string; type: CompteType; profilRh: ProfilRh; espaces: Role[];
  /** Mot de passe provisoire à remplacer avant tout accès aux données. */
  changerMotDePasse: boolean;
}

// — Messages sortants (file d'envoi : server/src/envois.ts) —
/** Destinataires des messages sortants : Keystone, la messagerie (e-mails) ; Sage Paie n'est pas encore branché sur la file. */
export type CibleEnvoi = 'keystone' | 'sage' | 'email';
/** `simule` : aucune adresse configurée, le message n'est que tracé dans le journal. */
export type StatutEnvoi = 'a_envoyer' | 'envoye' | 'echec' | 'simule';
export interface Envoi {
  id: number;
  cible: CibleEnvoi;
  type: string;
  /** Clé d'idempotence, unique, transmise à chaque tentative. */
  cle: string;
  /**
   * Keystone : données de l'événement (matricules et codes, jamais de nom ni de donnée de santé).
   * E-mail : le message (`Courriel` : destinataires, objet, texte, pièces jointes), jamais de donnée de santé.
   */
  contenu: Record<string, unknown>;
  statut: StatutEnvoi;
  /** Tentatives faites ; `prochaine` : date de la prochaine (message à envoyer). */
  tentatives: number;
  prochaine: string | null;
  /** Dernière erreur, conservée après une réussite ; `accuse` : accusé de réception du destinataire. */
  erreur: string | null;
  accuse: string | null;
  /** Dates ISO (UTC) : mise en file, dernière tentative, réception confirmée. */
  creation: string;
  tentative: string | null;
  envoi: string | null;
  /** Échec classé par le RH (date ISO) : reste visible, mais ne compte plus parmi les échecs en cours. */
  classe: string | null;
}
/** État d'une cible : messages par statut, dernière réception confirmée, message en tête qui attend une nouvelle tentative. */
export interface EtatEnvois {
  cible: CibleEnvoi;
  nombres: Record<StatutEnvoi, number>;
  /** Envois en échec que le RH n'a pas classés. */
  echecsEnCours: number;
  dernierSucces: string | null;
  enReprise: { id: number; type: string; tentatives: number; prochaine: string | null; erreur: string | null } | null;
}

// — E-mails (server/src/integrations/email.ts, server/src/notifications.ts) —
/** Notifications d'étapes : envoyées aussitôt, ou regroupées dans un récapitulatif quotidien. */
export type ModeNotification = 'immediat' | 'quotidien';
export interface PieceJointe { nom: string; type: string; /** Contenu encodé en base64. */ base64: string }
/** E-mail mis en file (contenu d'un envoi de la cible `email`) : texte brut, sans donnée de santé. */
export interface Courriel { a: string[]; objet: string; texte: string; repondreA?: string | null; pj?: PieceJointe[] }
/** Adresses de la messagerie, réglées par l'administrateur RH (Paramètres → Messagerie). */
export interface Messagerie {
  /** Boîte du service RH : valideur des salariés sans manager, adresse de réponse des convocations. */
  rh: string | null;
  /** Réglage des notifications adressées au service RH. */
  rhMode: ModeNotification;
  /** Service de prévention et de santé au travail. */
  santeTravail: string | null;
  /**
   * Adresse des relevés d'heures de chaque agence d'intérim (nom tel que saisi sur la fiche) ; `depuis` : date où
   * elle a été renseignée (l'envoi automatique ne rattrape pas les semaines antérieures).
   */
  agences: { nom: string; adresse: string; depuis?: ISODate | null }[];
}
/** Relevé hebdomadaire des heures des intérimaires transmis à une agence (un par envoi, renvois compris). */
export interface ReleveInterim {
  id: number; agence: string; semaine: ISODate; adresse: string;
  /** Mise en file (ISO), auteur (« Cursus » pour l'envoi automatique), e-mail correspondant et son statut. */
  creation: string; par: string; envoiId: number | null; envoi: StatutEnvoi | null;
  interimaires: number; heures: number;
  /** Feuilles encore en attente de validation à l'envoi (relevé incomplet : complété automatiquement ensuite). */
  enAttente: number;
}

/** Transmission à Sage Paie : simulation (rien ne part), fichier d'import (mode de production), API (pas encore de contrat). */
export type SageMode = 'simulation' | 'fichier' | 'api';
/**
 * Variables de paie d'une transmission : une ligne par feuille et par période de paie (une semaine ventilée jour par jour
 * peut en donner deux), rubriques traduites en codes Sage (shared/rules/paie.ts). `periode_origine` : période naturelle
 * déjà close, la ligne part en rappel sur la période ouverte. `periode_paie` : ancien format (période unique du lot).
 */
export interface SagePush {
  endpoint: string; dossier: string; mode?: SageMode; envoye_le: string; periodes?: string[]; periode_paie?: string;
  lignes: { matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number> }[];
}
/** Rattachement d'une semaine à cheval sur deux mois : mois de son dimanche, de son vendredi, ou ventilation jour par jour. */
export type RattachementPeriode = 'dimanche' | 'vendredi' | 'jour';
/**
 * Correspondance d'une rubrique interne (RUBRIQUES_PAIE de shared/constants.ts) avec le plan de paie Sage, modifiée par
 * l'administrateur RH ou la paie (`paie.rubrique`). Sans ligne : code Sage égal au code interne, à confirmer.
 */
export interface RubriquePaie {
  code: string; codeSage: string;
  /** Rubrique exportée ; désactivée, elle ne part plus (heures normales des mensualisés, par exemple). */
  active: boolean;
  /** Code vérifié dans le plan de paie Sage : date et auteur ; effacés quand le code change sans être confirmé. */
  confirmeLe: ISODate | null; confirmePar: string | null;
}

/** Instantané des données visibles par l'utilisateur connecté. */
export interface Dataset {
  today: ISODate;
  user: CurrentUser;
  settings: Settings;
  referentiels: Referentiels;
  annuaire: Personne[];
  employes: Employe[];
  sessions: Session[];
  inscriptions: Inscription[];
  participations: Participation[];
  plan: PlanAction[];
  budgets: Record<string, Record<string, number>>;
  voyages: Voyage[];
  demandesKeystone: DemandeKeystone[];
  missions: Mission[];
  taches: TacheKeystone[];
  feuilles: FeuilleTemps[];
  absences: Absence[];
  cet: CetMouvement[];
  reports: ReportCp[];
  soldesReprise: SoldeReprise[];
  entretiens: Entretien[];
  demandesCollab: DemandeCollab[];
  demandesVisite: DemandeVisite[];
  lastSagePush: SagePush | null;
  /** Correspondance des rubriques avec le plan de paie Sage : service RH, paie et lecture seule (vide ailleurs). */
  rubriquesPaie: RubriquePaie[];
  /** Adresses de la messagerie et relevés transmis aux agences d'intérim : service RH seulement (null et vide ailleurs). */
  messagerie: Messagerie | null;
  releves: ReleveInterim[];
}

export interface ActionResult { message: string | null; data: Dataset; result?: unknown }
