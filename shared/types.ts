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
/** Motif de sortie de l'entreprise (liste fermée, sans texte libre : MOTIFS_SORTIE de shared/rules/contrats.ts). */
export type MotifSortie = 'demission' | 'rupture_conventionnelle' | 'licenciement' | 'fin_cdd' | 'fin_periode_essai' | 'retraite' | 'deces' | 'fin_mission' | 'autre';
/** Titre de séjour valant autorisation de travail (liste fermée, TYPES_TITRE_SEJOUR de shared/rules/contrats.ts). */
export type TypeTitreSejour = 'salarie' | 'travailleur_temporaire' | 'pluriannuelle' | 'talent' | 'vie_privee' | 'etudiant' | 'resident' | 'resident_permanent' | 'recepisse' | 'apt' | 'autre';
/**
 * Titre de séjour valant autorisation de travail (art. L5221-2 et L5221-8), sans copie du document (elle ira dans la GED) :
 * type, numéro (exigé au registre unique du personnel ; service RH seulement, jamais au journal), expiration (null : carte
 * de résident permanent), date d'envoi de la demande d'authentification à la préfecture (art. R5221-41 : au moins 2 jours
 * ouvrables avant l'embauche ; sans réponse sous 2 jours ouvrables, l'obligation est remplie) et date de sa réponse.
 */
export interface AutorisationTravail { type: TypeTitreSejour; numero?: string | null; expire: ISODate | null; demandeLe?: ISODate | null; verifieLe: ISODate | null }
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
export type PlanStatut = 'prevu' | 'engage' | 'realise' | 'reporte';
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
// Administrés depuis l'écran Référentiels (shared/rules/referentiels.ts). `archive` : date d'archivage (null : en
// vigueur) ; un élément archivé n'est plus proposé dans les listes, mais reste reconnu (dossiers, journal, Keystone).
export interface Formation { id: string; nom: string; court: string; type: FormationType; validite: number; duree: string; organisme: string; cout: number; validation: ValidationMode; archive?: ISODate | null }
export interface HabType {
  id: string; nom: string; detail: string; prereqs: string[]; medical: boolean; validite: number; signataire: string; archive?: ISODate | null;
  /** Titre qui place son titulaire en suivi individuel renforcé (art. R4624-23 II : autorisation de conduite, habilitation électrique…). */
  sir?: boolean;
}
export interface Destination {
  code: string; pays: string; visa: VisaKind; visaSub: string; oblig: VaccinId[]; rec: VaccinId[]; passMois: number;
  /** Formalité de sécurité sociale du détachement ; null : déduite du code pays (`secuDe` de shared/constants.ts). */
  secu: SecuDetachement | null;
  archive?: ISODate | null;
}
/**
 * Formations et habilitations exigées (codes du catalogue) : d'un poste, ou communes à toute une équipe quel que soit le
 * poste (shared/rules/exigences.ts). Une exigence manquante rend le salarié « Non conforme ».
 */
export interface Exigences { formations: string[]; habilitations: string[] }
/** Poste du référentiel (écran Référentiels) : intitulé et exigences ; archivé, il n'est plus proposé sur les fiches. */
export interface Poste extends Exigences {
  id: number; nom: string; archive?: ISODate | null;
  /** Poste à risques particuliers : ses titulaires relèvent du suivi individuel renforcé (art. R4624-23). */
  sir?: boolean;
}
/** `exigences` : formations et habilitations exigées de tous ses membres (null : aucune). */
export interface Equipe { nom: string; managerId: number | null; ordre: number; exigences?: Exigences | null }
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
  /** Postes et leurs exigences (shared/rules/exigences.ts), archivés compris. */
  postes: Poste[];
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
/**
 * Type de suivi de l'état de santé (shared/rules/suivi-medical.ts) : visite d'information et de prévention (VIP), VIP
 * adaptée (travailleur de nuit ou handicapé, art. R4624-17 et R4624-20), suivi individuel renforcé (SIR, art. R4624-23).
 */
export type SuiviMedical = 'vip' | 'vip_adapte' | 'sir';
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
  /** Intitulé du poste, conservé tel quel (exports, imports, historique) : celui du poste choisi dans le référentiel. */
  poste: string;
  /** Poste du référentiel (`postes`), dont les exigences s'appliquent ; null : intitulé hors référentiel. */
  posteId?: number | null;
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
  /**
   * Dernier jour du contrat, qui sert de date de sortie pour tous les contrats, CDI compris : passé ce jour, connexion
   * refusée, plus de saisie ni de notification, salarié retiré de la conformité et des échéances (shared/rules/contrats.ts).
   */
  fin: ISODate | null;
  /**
   * Motif de la sortie enregistrée par le service RH (`employe.sortie`) ; null tant qu'aucune sortie n'est enregistrée
   * (la fin d'un CDD, d'une mission ou d'une alternance n'est alors que prévue). Service RH, paie, lecture seule et intéressé.
   */
  motifSortie?: MotifSortie | null;
  /** Fin prévue au contrat avant l'enregistrement de la sortie (CDD, mission, alternance) : rétablie si la sortie est annulée. */
  finPrevue?: ISODate | null;
  /**
   * Vues sans le motif (manager, référent HSE) : une sortie est enregistrée, et `fin` en est la date (et non la fin prévue
   * du contrat). Sans le motif ni la fin prévue, pour que les échéances du contrat soient celles du service RH.
   */
  sortieEnregistree?: boolean;
  /**
   * Période d'essai écrite au contrat (art. L1221-23) : dernier jour, et dernier jour après renouvellement. Saisies par le
   * service RH sans valeur proposée ; Cursus avertit au-delà du maximum légal (shared/rules/contrats.ts).
   */
  essaiFin?: ISODate | null;
  essaiRenouveleJusquau?: ISODate | null;
  /**
   * Titre de séjour valant autorisation de travail ; null : non requise (ressortissant français, de l'UE, de l'EEE ou de la
   * Suisse). Service RH (numéro compris), lecture seule (sans numéro) et intéressé ; enregistré par `employe.autorisationTravail`.
   */
  autorisationTravail?: AutorisationTravail | null;
  /**
   * Remplace `autorisationTravail` dans les vues du manager, du référent HSE et de la paie : verdict seul (« valide » aussi
   * quand aucune autorisation n'est requise), sans type, numéro ni date.
   */
  autorisationVerdict?: 'valide' | 'expiree';
  /**
   * Année de naissance : celle de `naissanceLe` quand la date est connue (le serveur la dérive), sinon la seule connue
   * (fiche antérieure à la date complète). Règle à l'année du supplément de congés de la CCN (shared/rules/conges.ts).
   */
  naissance: number;
  /**
   * Date de naissance complète (âge exact : shared/rules/mineurs.ts) ; null : inconnue, la règle à l'année s'applique.
   * Service RH et intéressé seulement : retirée des vues du manager et des profils restreints (server/src/dataset.ts).
   */
  naissanceLe?: ISODate | null;
  /** Remplace `naissanceLe` dans les vues du manager et des profils restreints : salarié mineur au jour de l'instantané. */
  mineur?: boolean;
  agence: string | null;
  /**
   * Matricule du dossier de paie (Sage), saisi ou repris par le service RH : 1 à 20 lettres et chiffres, unique (sauf
   * réembauche confirmée par l'administrateur RH). Null : à saisir ; le salarié est alors refusé d'une transmission réelle
   * à la paie (shared/rules/matricules.ts). Retiré des fiches des membres de son équipe envoyées au manager.
   */
  matriculePaie: string | null;
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
   * Suivi médical (shared/rules/suivi-medical.ts) — réservé au service RH et à l'intéressé, jamais transmis au manager :
   * type saisi par le service RH (null : VIP, sauf suivi renforcé déduit des habilitations ou du poste), date de la
   * prochaine visite fixée par le médecin du travail avec l'avis (elle prime sur la périodicité), date du dernier examen
   * médical d'aptitude (suivi individuel renforcé).
   */
  suivi?: SuiviMedical | null;
  prochaineVisite?: ISODate | null;
  examenAptitude?: ISODate | null;
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
  /**
   * Session sur plusieurs jours (shared/rules/plage-session.ts) : `date` reste le premier jour, `fin` le dernier (égal à
   * `date` pour une session d'une journée), `jours` les jours de la session entre les deux (ouvrés par défaut, premier et
   * dernier compris), `horaires` aucun (journées entières), un seul (tous les jours) ou un par jour, dans l'ordre de `jours`.
   */
  fin: ISODate; jours: ISODate[]; horaires: HoraireSession[];
  /** Calculé au chargement (certifications rattachées, inscriptions, résultats de clôture), jamais stocké. */
  inscrits: number;
  /** Action du plan de formation à l'origine de la session. */
  planId: number | null;
  /** Clôture (évaluation à chaud) ou annulation (motif) : date et auteur. */
  bilan: SessionBilan | null;
}
/** Horaire d'un jour de session : début et fin (« HH:MM », heure de Paris), pause non comptée en minutes. */
export interface HoraireSession { debut: string; fin: string; pause: number }
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
export interface PlanAction {
  id: number; exercice: number; f: string | null; libelle: string | null; equipe: string; periode: Trimestre; effectif: number; cout: number; statut: PlanStatut;
  /** `import` (plan importé), `demande` (demande acceptée), `report` (action reportée d'un exercice clos) ; null : ancienne base, démonstration. */
  origine: string | null;
  /** Coût et effectif réels, saisis à la clôture de l'action (« réalisé ») : le réalisé des enveloppes (shared/rules/budget.ts). */
  coutReel?: number | null;
  effectifReel?: number | null;
  /** Action reportée : action de l'exercice clos dont elle reprend la ligne (`plan.cloturerExercice`). */
  reportDe?: number | null;
}
/** Exercice du plan de formation clos (`plan.cloturerExercice`) : plan et enveloppes en lecture seule. */
export interface ExerciceClos { exercice: number; le: ISODate; par: string }

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
  /**
   * Annulation par le service RH (`voyage.annuler`, shared/rules/deplacements.ts) : jour, auteur et motif (texte libre,
   * réservé au service RH). Annulé, le déplacement reste dans l'historique mais sort de tous les calculs.
   */
  annuleLe?: ISODate | null; annulePar?: string | null; annuleMotif?: string | null;
  /**
   * Demandeur d'un déplacement importé du formulaire (`voyages.importer`) : nom du salarié reconnu, sinon le nom tel que
   * saisi (texte libre). Service RH seulement (null ailleurs : server/src/dataset.ts).
   */
  demandeur?: string | null;
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
  /** Lot de paie (`lotsPaie`) qui porte la feuille : généré ou transmis ; null une fois le lot annulé (feuille libérée). */
  lotId?: number | null;
  /**
   * Majoration des heures du dimanche (%, réglage `majorationDimanche`) figée à la validation, comme le mode des heures
   * supplémentaires : un changement du réglage ne recalcule pas une semaine validée. Null avant : le réglage s'applique.
   */
  majDimanche?: number | null;
}
/**
 * Dérogation au repos dominical d'une équipe (shared/rules/semaine.ts) : aucune (heures du dimanche signalées au RH), travail
 * en continu (art. L3132-12, R3132-5) ou équipe de suppléance (art. L3132-16), avec la référence de l'accord ou de la
 * décision ; réglée par l'administrateur RH (Paramètres → Repos hebdomadaire, `temps.derogationDominicale`).
 */
export type TypeDerogationDominicale = 'aucune' | 'feu_continu' | 'suppleance';
export interface DerogationDominicale { equipe: string; type: TypeDerogationDominicale; reference: string | null; le: ISODate; par: string }
/**
 * Mandat d'élu au CSE (shared/rules/delegation.ts) : titulaire ou suppléant, dates, crédit d'heures de délégation par mois
 * (proposé d'après l'art. R2314-1, modifiable). Saisi par le service RH sur la fiche ; vu par le RH et l'élu seulement.
 */
export type RoleMandat = 'titulaire' | 'suppleant';
export interface Mandat { id: number; empId: number; role: RoleMandat; du: ISODate; au: ISODate | null; credit: number }
/**
 * Heures supplémentaires payées avec majoration, ou remplacées par un repos compensateur (accord collectif, art. L3121-33 ;
 * à défaut de délégué syndical, sans opposition du CSE, art. L3121-37).
 */
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
  /**
   * Demi-journées (CP, RTT ou repos du forfait jours, récupération ; shared/rules/demi-journees.ts) : null, journée
   * entière. `debutDemi` : seule demi-journée prise le premier jour (après-midi pour un congé de plusieurs jours, matin
   * ou après-midi pour un congé d'un seul jour) ; `finDemi` : seule demi-journée prise le dernier jour (matin), jamais
   * sur un congé d'un seul jour.
   */
  debutDemi?: DemiJournee | null; finDemi?: DemiJournee | null;
}
/**
 * Effet d'une absence sur l'acquisition des congés payés (loi 2024-364, shared/rules/acquisition-cp.ts) : `assimile`, travail
 * effectif ; `maladie`, 2 jours ouvrables par mois (art. L3141-5-1, réglage `cpMaladie`) ; `non`, acquisition réduite au prorata.
 */
export type CpAcquisition = 'assimile' | 'maladie' | 'non';
/**
 * Jours de CP acquis chaque mois d'une période de référence (`periode` : année de prise), calculés par le serveur avec la
 * vraie nature des absences (shared/rules/acquisition-cp.ts) : transmis au seul profil paie, qui reçoit les absences
 * médicales sans leur nature, pour que ses soldes soient ceux du service RH sans qu'aucune absence soit désignée.
 */
export interface AcquisitionCpCalculee { empId: number; periode: number; mois: number[] }
/** Demi-journée d'un congé : matin ou après-midi. */
export type DemiJournee = 'matin' | 'apres_midi';
export interface CetMouvement { id: number; empId: number; type: 'CP' | 'RTT'; jours: number; date: ISODate; periode: string }
/**
 * Report de congés payés. `recu` : jours ajoutés aux droits de la période `periode` (année de prise, `anneeCp` de
 * shared/rules/conges.ts), utilisables jusqu'à `expire`. `accorde` : report décidé par le service RH en cours de période,
 * des jours de la période `periode - 1` vers `periode`, appliqué à la clôture de la période (`conges.cloturer`), qui le
 * plafonne au solde et crée le report reçu. Null : report antérieur aux périodes datées (migration lot4-reprise-soldes-dates).
 */
export interface ReportCp {
  id: number; empId: number; jours: number; motif: string; par: string; date: ISODate; sens: 'recu' | 'accorde';
  periode: number | null; expire: ISODate | null;
}
/**
 * Compteurs repris de l'ancien système (Lucca), arrêtés le `arreteLe` : `cpPris` porte sur la période de congés payés
 * de cette date (`anneeCp`), `rttPris` sur son année civile ; la récupération reste cumulée. Null : date de mise en service.
 */
export interface SoldeReprise {
  empId: number; cpPris: number; rttPris: number; recupAcquis: number; recupPris: number; arreteLe: ISODate | null;
  /**
   * Soldes d'ouverture importés à la mise en service (`reprise.importer`, shared/rules/reprise.ts), repris tels quels à la
   * date d'arrêté : CP de la période en cours (« CP N-1 »), CP acquis de la période en cours d'acquisition (« CP N »),
   * RTT de l'année, CET (jours). Null : non repris (compteur calculé depuis `cpPris`, `rttPris`).
   */
  cpSolde?: number | null; cpSoldeSuivant?: number | null; rttSolde?: number | null; cetSolde?: number | null;
}
/**
 * Clôture d'une période de congés pour un salarié (`conges.cloturer`) : photographie du solde restant et décision du
 * service RH. CP (`periode` : année de prise de la période close au 31 mai) : report (`reportes` en tout, report imposé
 * compris ; reports reçus sur la période suivante : `reportId`, celui décidé par le service RH, jusqu'au 31 mai suivant
 * — `expire` —, à défaut le report imposé) ou perte, choisis ligne par ligne ; `motif` : report imposé (absence de
 * santé, maternité ou paternité dans la période, report légal en cours), réservé au service RH. RTT (`periode` : année
 * close au 31 décembre) : non reportables, le solde est perdu. `solde_nul` : rien à décider.
 */
export interface ClotureConges {
  id: number; empId: number; type: 'CP' | 'RTT'; periode: number; solde: number;
  decision: 'reporter' | 'perdre' | 'solde_nul'; reportes: number; perdus: number; expire: ISODate | null; reportId: number | null;
  motif: 'report_legal' | 'report_en_cours' | null; le: ISODate; par: string;
}
/**
 * Information du salarié sur ses congés payés à son retour d'un arrêt de maladie ou d'accident (art. L3141-19-3,
 * `conges.informer`, shared/rules/information-retour.ts) : arrêt concerné (`absenceId`, ses dates), jour de l'information,
 * jours communiqués (solde de la période en cours, `jours`, à prendre jusqu'au `limite` ; dont acquis pendant l'arrêt,
 * `arret`) et échéance du report de 15 mois qui court à partir de cette information (`echeance`). Service RH et intéressé.
 */
export interface InformationCp {
  id: number; empId: number; absenceId: number; du: ISODate; au: ISODate; le: ISODate;
  jours: number; arret: number; limite: ISODate; echeance: ISODate; par: string;
}

// — Entretiens & demandes —
/**
 * `planifieLe` : jour où l'entretien a été planifié ou reprogrammé (`entretien.planifier`), borne de la date réelle
 * enregistrée à la clôture (`debutCloture`) ; null pour un entretien planifié avant que Cursus la conserve.
 */
export interface Entretien {
  id: number; empId: number; type: EntretienType; date: ISODate; statut: 'planifie' | 'realise'; cr: Record<string, string>; info: boolean; signSal: ISODate | null; signMgr: ISODate | null; planifieLe?: ISODate | null;
  /**
   * Remise de la copie du compte rendu au salarié (`entretien.remettre`, shared/rules/remise.ts) : jour, mode et auteur ;
   * `telechargeLe` : premier téléchargement par le salarié lui-même, depuis son espace.
   */
  remiseLe?: ISODate | null; remiseMode?: ModeRemise | null; remisePar?: string | null; telechargeLe?: ISODate | null;
  /**
   * Vues sans la date de naissance (manager, profils restreints) : sections « fin de carrière » dues ou non, calculées par
   * le serveur sur l'âge exact à la date de l'entretien (`needsFinCarriere`, shared/rules/entretiens.ts).
   */
  finCarriere?: boolean;
}
/** Remise du compte rendu : en main propre, après un refus de signer, ou mis à disposition dans le portail (lien par e-mail). */
export type ModeRemise = 'main_propre' | 'refus' | 'portail';
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
  /**
   * Identifiant des salariés échangé avec Keystone : matricule Cursus (EMP-0001, contrat de l'API v1, par défaut) ou
   * matricule de paie (bascule annoncée à Keystone à l'avance ; un salarié sans matricule de paie garde le matricule Cursus).
   */
  identifiantKeystone: 'cursus' | 'paie';
  /** Clôture des congés payés : le service RH choisit chaque ligne sans proposition, ou Cursus propose le report du solde. */
  politiqueReportCp: 'cas_par_cas' | 'proposer_report';
  /** RTT de l'année suivante posables à partir de ce jour de l'année (« MM-JJ ») ; vide : sans restriction. */
  rttAnneeSuivanteDes: string;
  /**
   * Acquisition des CP pendant un arrêt maladie (art. L3141-5-1) : minimum légal (2 jours ouvrables par mois, 24 par
   * période) ou maladie assimilée à du travail effectif (accord ou CCN plus favorable confirmé).
   */
  cpMaladie: 'legal' | 'assimile';
  // Paie (client/src/pages/parametres/ReglagesPaie.tsx, shared/rules/paie.ts) : heures supplémentaires payées ou en repos
  // (référence de l'accord qui le prévoit), rattachement d'une semaine à cheval sur deux mois, jour de clôture (0 : dernier jour).
  heuresSupMode: ModeHeuresSup;
  heuresSupAccord: string;
  periodeRattachement: RattachementPeriode;
  clotureJour: number;
  // Suivi des feuilles de temps (client/src/pages/parametres/FeuillesTemps.tsx, shared/rules/suivi-feuilles.ts) : semaines
  // affichées, feuille attendue le `feuilleLimiteJour` (1 : lundi … 5 : vendredi) de la semaine suivante à `feuilleLimiteHeure` h.
  suiviSemaines: number;
  feuilleLimiteJour: number;
  feuilleLimiteHeure: number;
  /** Campagne d'entretiens annuels (shared/rules/campagne.ts) : ouverture et clôture (« MM-JJ »), ancienneté minimale en mois,
   * contrats exclus (l'intérim l'est toujours), jours d'affichage de l'échéance avant l'ouverture (365 : toute l'année). */
  campagneDebut: string;
  campagneFin: string;
  campagneAncienneteMois: number;
  campagneExclus: TypeContrat[];
  campagnePreavisJours: number;
  /** Titres de séjour (client/src/pages/parametres/Contrats.tsx) : première alerte et relance, en jours avant l'expiration. */
  titreSejourAlerte: number;
  titreSejourRelance: number;
  /** Récapitulatif des échéances (shared/rules/relances.ts) : envoi actif, paliers en jours avant l'échéance, jour d'envoi. */
  relancesActives: boolean;
  relancesPaliers: number[];
  relancesJour: 'quotidien' | 'lundi' | 'mardi' | 'mercredi' | 'jeudi' | 'vendredi';
  /** Majoration des heures du dimanche, en % (0 par défaut, aucune majoration légale hors accord) : rubrique MAJ_DIM. */
  majorationDimanche: number;
  // Santé (client/src/pages/parametres/Sante.tsx, shared/rules/suivi-medical.ts) : périodicité des visites en mois selon le
  // type de suivi, quand le médecin du travail n'a pas fixé la date de la prochaine visite.
  santeVipMois: number;
  santeVipAdapteeMois: number;
  santeSirIntermediaireMois: number;
  santeSirAptitudeMois: number;
  /** Formations (shared/rules/formations-temps.ts) : heures des sessions proposées dans la feuille de temps des inscrits. */
  formationsTemps: boolean;
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
/**
 * Destinataires des messages sortants : Keystone, la messagerie (e-mails). Sage Paie n'y figure pas : ses variables
 * passent par le fichier d'import que la paie importe elle-même (décision du 15 octobre 2026, aucun envoi automatique).
 */
export type CibleEnvoi = 'keystone' | 'email';
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

/**
 * Transmission à Sage Paie : simulation (rien ne part) ou fichier d'import (mode de production). Pas d'envoi par API :
 * la paie importe le fichier dans Sage (décision du 15 octobre 2026).
 */
export type SageMode = 'simulation' | 'fichier';
/**
 * Variables de paie d'une transmission : une ligne par feuille et par période de paie (une semaine ventilée jour par jour
 * peut en donner deux), rubriques traduites en codes Sage (shared/rules/paie.ts). `periode_origine` : période naturelle
 * déjà close, la ligne part en rappel sur la période ouverte. `periode_paie` : ancien format (période unique du lot).
 */
export interface SagePush {
  /** Ancien format : adresse d'un envoi par API qui n'a jamais existé (contenus figés avant le lot 5). */
  endpoint?: string;
  dossier: string; mode?: SageMode; envoye_le: string; periodes?: string[]; periode_paie?: string;
  lignes: { matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number> }[];
  /** Libellé de chaque code Sage du contenu, figé à la génération du lot (colonne facultative « libellé » du fichier). */
  libelles?: Record<string, string>;
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

/**
 * Lot de paie (shared/rules/lots-paie.ts, server/src/actions/paie.ts) : feuilles validées d'une période, contenu figé à la
 * génération. Généré : fichier d'import prêt, feuilles réservées ; transmis : import dans Sage confirmé par la paie
 * (date, auteur, référence) ou simulation ; annulé : feuilles libérées, possible seulement avant la confirmation.
 */
export type StatutLotPaie = 'genere' | 'transmis' | 'annule';
export interface LotPaie {
  id: number;
  /** Clé d'idempotence (UUID) : identique à chaque téléchargement du fichier. */
  cle: string;
  mode: SageMode; statut: StatutLotPaie;
  /** Période de paie choisie (AAAA-MM) ; `periodes` : celles des lignes ; `rappels` : périodes closes reprises. */
  periode: string; periodes: string[]; rappels: string[];
  creation: string; auteur: string;
  /** Feuilles du lot (gardées après une annulation, qui les libère). */
  feuilles: { empId: number; week: ISODate }[];
  /** Totaux du contenu figé : lignes du fichier, salariés, quantité par code Sage. */
  resume: { lignes: number; salaries: number; rubriques: Record<string, number> };
  /** Salariés partis sous leur matricule Cursus, faute de matricule de paie (simulation seulement). */
  sansMatricule: number[];
  telechargeLe: string | null; telechargePar: string | null; telechargements: number;
  /** Accusé : confirmation de l'import dans Sage (date, auteur, référence d'import facultative) ; « SIM-… » en simulation. */
  confirmeLe: string | null; confirmePar: string | null; reference: string | null;
  annuleLe: string | null; annulePar: string | null;
  /** Lot repris des transmissions d'avant les lots (migration lot4-paie-lots-historiques) : contenu inconnu. */
  historique: boolean;
}
/**
 * Colonnes du fichier d'import Sage, dans l'ordre réglé par la paie : matricule, période, rubrique et quantité toujours ;
 * facultatives, absentes par défaut : code du dossier de paie (SAGE_DOSSIER), libellé de la rubrique, premier et dernier
 * jour de la période.
 */
export type ColonneFichierPaie = 'matricule' | 'periode' | 'rubrique' | 'quantite' | 'dossier' | 'libelle' | 'debut' | 'fin';
/** Format du fichier d'import (action `paie.formatFichier`, écran Temps) : ajusté par la paie à l'import de son Sage. */
export interface FormatFichierPaie {
  separateur: ';' | ',' | 'tab';
  colonnes: ColonneFichierPaie[];
  formatPeriode: 'AAAA-MM' | 'MM/AAAA' | 'AAAAMM' | 'MMAAAA';
  decimale: ',' | '.';
  entete: boolean;
  /** UTF-8 sans BOM par défaut ; Windows-1252 (« ANSI »), souvent attendu par l'import de Sage. */
  encodage: 'utf-8' | 'windows-1252';
  /** Dates des colonnes « début » et « fin » de période. */
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ' | 'JJMMAAAA';
}

/** Instantané des données visibles par l'utilisateur connecté. */
export interface Dataset {
  today: ISODate;
  /**
   * Révision de la base au moment de l'instantané (croissante, server/src/db.ts) : un instantané de révision inférieure à
   * celle de l'écran est ignoré (réponses arrivées dans le désordre : client/src/state/revision.ts). Aucune donnée personnelle.
   */
  revision: number;
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
  /** Exercices du plan de formation clos : service RH et lecture seule (vide ailleurs). */
  exercicesClos: ExerciceClos[];
  voyages: Voyage[];
  demandesKeystone: DemandeKeystone[];
  missions: Mission[];
  taches: TacheKeystone[];
  feuilles: FeuilleTemps[];
  absences: Absence[];
  cet: CetMouvement[];
  reports: ReportCp[];
  soldesReprise: SoldeReprise[];
  /** Clôtures des périodes de congés (CP au 31 mai, RTT au 31 décembre), une ligne par salarié et par période. */
  clotures: ClotureConges[];
  /** Informations des salariés sur leurs congés à leur retour d'arrêt : service RH et intéressé (vide ailleurs). */
  informationsCp?: InformationCp[];
  /** Acquisition des CP calculée par le serveur, par salarié et par période : profil paie seulement (absent ailleurs). */
  acquisitionsCp?: AcquisitionCpCalculee[];
  entretiens: Entretien[];
  demandesCollab: DemandeCollab[];
  demandesVisite: DemandeVisite[];
  /**
   * Début de la saisie des feuilles de temps dans Cursus (lundi de la première feuille enregistrée, null : aucune),
   * calculé sur toutes les feuilles avant le filtrage par périmètre : le suivi des feuilles (shared/rules/suivi-feuilles.ts)
   * d'un manager exclut ainsi les mêmes semaines que la relance du serveur. Une date, aucune donnée personnelle.
   */
  debutSaisieFeuilles: ISODate | null;
  /** Lots de paie, sans leur contenu (résumé) : service RH, paie et lecture seule (vide ailleurs). */
  lotsPaie: LotPaie[];
  /** Format du fichier d'import Sage : service RH, paie et lecture seule (null ailleurs). */
  formatFichierPaie: FormatFichierPaie | null;
  /** Correspondance des rubriques avec le plan de paie Sage : service RH, paie et lecture seule (vide ailleurs). */
  rubriquesPaie: RubriquePaie[];
  /** Adresses de la messagerie et relevés transmis aux agences d'intérim : service RH seulement (null et vide ailleurs). */
  messagerie: Messagerie | null;
  releves: ReleveInterim[];
  /** Lots importés à la mise en service (reprise depuis Lucca) : service RH seulement (vide ailleurs). */
  reprises: LotReprise[];
  /** Dérogations au repos dominical par équipe : la référence de l'accord n'est transmise qu'au service RH. */
  derogationsDominicales?: DerogationDominicale[];
  /** Mandats au CSE : service RH (tous) et l'élu (les siens) ; vide ailleurs (le manager ne voit que la ligne de la feuille). */
  mandats?: Mandat[];
  /**
   * Effectif du site retenu pour les heures de délégation (shared/rules/delegation.ts, `effectifSite` calculé par le serveur
   * sur toutes les fiches) : service RH, et l'élu avec ses mandats ; null ailleurs. Un nombre, aucune liste nominative.
   */
  effectifCse?: number | null;
}

/**
 * Lot importé depuis l'écran Mise en service (`reprise.importer`, shared/rules/reprise.ts) : type, date de reprise des
 * soldes, colonnes rapprochées et options (pour le rejouer), décompte et compte rendu ligne par ligne (numéro, issue,
 * salarié, motifs). Le contenu du fichier n'est pas conservé.
 */
export interface LotReprise {
  id: number; type: string; le: string; par: string; dateReprise: ISODate | null; fichier: string | null;
  colonnes: (string | null)[]; options: { comptes?: boolean; equipes?: Record<string, string>; entetes?: string[] } | null;
  lignes: number; crees: number; majs: number; ignorees: number; refusees: number;
  rapport: { n: number; issue: string; nom: string; motif: string }[];
}

export interface ActionResult { message: string | null; data: Dataset; result?: unknown }
