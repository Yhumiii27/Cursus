// Modèle de données de Cursus, partagé entre le serveur (SQLite) et le client.
// Les dates sont des chaînes ISO « AAAA-MM-JJ » (heure locale, sans fuseau).

export type ISODate = string;
export type Role = 'rh' | 'manager' | 'collaborateur';

export type FormationType = 'Réglementaire' | 'Recommandée' | 'Interne';
export type VaccinId = 'fj' | 'hepA' | 'hepB' | 'typhoide' | 'dtp';
export type VisaKind = 'none' | 'evisa' | 'esta' | 'embassy';
/** Catégories de la CCN Industries chimiques. */
export type Statut = 'ouvrier' | 'technicien' | 'cadre';
export type TypeContrat = 'cdi' | 'cdd' | 'interim' | 'alternance';
/** Organisation du temps de travail (durée de référence ou convention de forfait). */
export type TempsTravail = '35h' | '39h_rtt' | 'forfait_heures_hebdo' | 'forfait_heures_annuel' | 'forfait_jours' | 'partiel' | 'dirigeant';
export type AbsenceType = 'CP' | 'RTT' | 'RECUP';
export type AbsenceStatut = 'demandee' | 'validee' | 'refusee';
export type FeuilleStatut = 'brouillon' | 'soumise' | 'validee' | 'rejetee';
export type EntretienType = 'epp' | 'reprise' | 'bilan' | 'annuel' | 'forfait';
export type PlanStatut = 'prevu' | 'engage' | 'realise';
export type Trimestre = 'T1' | 'T2' | 'T3' | 'T4';
export type VoyageOrigine = 'formulaire' | 'keystone' | 'cursus';
export type TripStatus = 'pret' | 'todo' | 'bloc';
export type DemandeType = 'formation' | 'habilitation' | 'document';
export type DemandeStatut = 'attente' | 'acceptee' | 'refusee';

// — Référentiels —
export interface Formation { id: string; nom: string; court: string; type: FormationType; validite: number; duree: string; organisme: string; cout: number }
export interface HabType { id: string; nom: string; detail: string; prereqs: string[]; medical: boolean; validite: number; signataire: string }
export interface Destination { code: string; pays: string; visa: VisaKind; visaSub: string; oblig: VaccinId[]; rec: VaccinId[]; passMois: number }
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
export interface Certification { id: number; empId: number; f: string; obtenue: ISODate; sessionId: number | null; convoc: 'now' | 'later' | null }
/** Mesure prise sur un titre après un incident ou une restriction : suspension (réversible) ou retrait (définitif). */
export type HabMesure = 'suspension' | 'retrait';
export interface HabTitre {
  id: number; empId: number; h: string; delivree: ISODate | null; par: string | null; demande: ISODate | null;
  /** Suspension ou retrait en cours (null = aucun), avec sa date, son motif (texte libre) et son auteur. */
  mesure: HabMesure | null; mesureDate: ISODate | null; mesureMotif: string | null; mesurePar: string | null;
}
export interface Visa { id: number; empId: number; dest: string; type: string; obtenu: ISODate | null; expire: ISODate }
export interface Vaccination { id: number; empId: number; v: VaccinId; date: ISODate }
export interface Passeport { numero: string; expire: ISODate }

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
  repriseMotif: string | null;
  repriseDate: ISODate | null;
  /** Date de la dernière visite d'aptitude — réservée au service RH. */
  visite: ISODate | null;
  /** Remplace `visite` dans les vues manager : seul le verdict est transmis. */
  aptitude?: { ok: boolean };
  passeport: Passeport | null;
  certs: Certification[];
  habs: HabTitre[];
  visas: Visa[];
  vaccins: Vaccination[];
}

export interface Personne { id: number; nom: string; equipe: string | null; poste: string }

// — Formations & plan —
export interface Session { id: number; formation: string; date: ISODate; lieu: string; places: number; inscrits: number; statut: 'Confirmée' | 'À confirmer' }
/** Inscription à une session d'une formation que le collaborateur n'a encore jamais suivie (formation initiale). */
export interface Inscription { id: number; empId: number; sessionId: number; convoc: 'now' | 'later'; date: ISODate }
export interface PlanAction { id: number; exercice: number; f: string | null; libelle: string | null; equipe: string; periode: Trimestre; effectif: number; cout: number; statut: PlanStatut; origine: string | null }

// — Déplacements & projets —
export interface Voyage { id: number; empId: number; dest: string; depart: ISODate; retour: ISODate; motif: string; origine: VoyageOrigine; ref: string | null; chantier: string | null; dossierStatut?: TripStatus }
/** Demande de déplacement reçue de Keystone (`ref` : référence externe unique), conservée après décision du RH. */
export interface DemandeKeystone {
  id: number; empId: number; chantier: string; dest: string; depart: ISODate; retour: ISODate; recue: ISODate;
  ref: string | null; statut: DemandeStatut; decidee: ISODate | null; decideur: string | null; voyageId: number | null;
}
/** Présence d'un salarié sur un projet ou un chantier ; `ref` : identifiant Keystone de l'affectation. */
export interface Mission { id: number; empId: number; projet: string; lieu: string; du: ISODate; au: ISODate; type: string; ref: string | null }
/** Tâche planifiée par Keystone pour un salarié : heures prévues par date, entre `debut` et `fin`. */
export interface TacheKeystone { id: number; ref: string | null; empId: number; projet: string; tache: string; debut: ISODate; fin: ISODate; heures: Record<ISODate, number> }

// — Temps & absences —
export interface LigneTemps { projet: string; tache: string; ks: boolean; h: number[] }
/** Régime de temps de travail figé sur une feuille soumise : un changement de contrat ultérieur ne la recalcule pas. */
export type ContratFige = Pick<Employe, 'statut' | 'typeContrat' | 'temps' | 'heures' | 'forfaitHeures' | 'forfaitJours' | 'jourOff'>;
export interface FeuilleTemps { id: number; empId: number; week: ISODate; statut: FeuilleStatut; comment: string | null; sage: boolean; keystone: boolean; lignes: LigneTemps[]; contrat: ContratFige | null }
export interface Absence { id: number; empId: number; type: AbsenceType; du: ISODate; au: ISODate; statut: AbsenceStatut; keystone: boolean }
export interface CetMouvement { id: number; empId: number; type: 'CP' | 'RTT'; jours: number; date: ISODate; periode: string }
export interface ReportCp { id: number; empId: number; jours: number; motif: string; par: string; date: ISODate; sens: 'recu' | 'accorde' }
/** Compteurs repris de l'ancien système pour les périodes en cours. */
export interface SoldeReprise { empId: number; cpPris: number; rttPris: number; recupAcquis: number; recupPris: number }

// — Entretiens & demandes —
export interface Entretien { id: number; empId: number; type: EntretienType; date: ISODate; statut: 'planifie' | 'realise'; cr: Record<string, string>; info: boolean; signSal: ISODate | null; signMgr: ISODate | null }
/** Demande au service RH, émise par le collaborateur ou par son manager (`parId`). */
export interface DemandeCollab { id: number; empId: number; type: DemandeType; f: string | null; h: string | null; libelle: string | null; label: string | null; sessionId: number | null; motif: string | null; date: ISODate; statut: DemandeStatut; reponse: string | null; parId: number | null; declaration: Declaration | null }
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
export interface Settings {
  horizonAlerte: number;
  uniquementReglementaire: boolean;
  seuilBudget: number;
  partageKeystone: 'minimal' | 'detaille';
  rtt39: number;
  rhNom: string;
  rhIntitule: string;
  vueInitiale: string;
}

export interface CurrentUser { role: Role; empId: number | null; nom: string; intitule: string }

// — Messages sortants (file d'envoi : server/src/envois.ts) —
/** Destinataires des messages sortants : Sage Paie n'est pas encore branché sur la file. */
export type CibleEnvoi = 'keystone' | 'sage';
/** `simule` : aucune adresse configurée, le message n'est que tracé dans le journal. */
export type StatutEnvoi = 'a_envoyer' | 'envoye' | 'echec' | 'simule';
export interface Envoi {
  id: number;
  cible: CibleEnvoi;
  type: string;
  /** Clé d'idempotence, unique, transmise à chaque tentative. */
  cle: string;
  /** Données de l'événement (matricules et codes, jamais de nom ni de donnée de santé). */
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
}
/** État d'une cible : messages par statut, dernière réception confirmée, message en tête qui attend une nouvelle tentative. */
export interface EtatEnvois {
  cible: CibleEnvoi;
  nombres: Record<StatutEnvoi, number>;
  dernierSucces: string | null;
  enReprise: { id: number; type: string; tentatives: number; prochaine: string | null; erreur: string | null } | null;
}

export interface SagePush { endpoint: string; dossier: string; periode_paie: string; envoye_le: string; lignes: { matricule: string; semaine: string; rubriques: Record<string, number> }[] }

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
  lastSagePush: SagePush | null;
}

export interface ActionResult { message: string | null; data: Dataset; result?: unknown }
