// Modèle de données de Cursus, partagé entre le serveur (SQLite) et le client.
// Les dates sont des chaînes ISO « AAAA-MM-JJ » (heure locale, sans fuseau).
// lot 11 — notes de frais, étape 2 : gabarit du fichier d'écritures (réglage `fraisGabarit`) et ses lignes (exports).
import type { GabaritExportComptable, LigneEcriture } from './rules/export-comptable.ts';

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
/** lot 11 — indicateurs : sexe de la DSN (F : féminin, M : masculin) ; aucune autre valeur juridique à ce jour. */
export type Sexe = 'F' | 'M';
/**
 * lot 11 — indicateurs : catégorie d'emploi de la BDESE et de l'index d'égalité (ouvriers, employés, techniciens et
 * agents de maîtrise, cadres), distincte du statut à 3 valeurs, qui ne sépare pas ouvriers et employés.
 */
export type CategorieEmploi = 'ouvrier' | 'employe' | 'tam' | 'cadre';
/** Motif de sortie de l'entreprise (liste fermée, sans texte libre : MOTIFS_SORTIE de shared/rules/contrats.ts). */
export type MotifSortie = 'demission' | 'rupture_conventionnelle' | 'licenciement' | 'fin_cdd' | 'fin_periode_essai' | 'retraite' | 'deces' | 'fin_mission' | 'autre';
/** Motif de recours au CDD ou à l'intérim (art. L1242-2, L1242-3, L1251-6), liste fermée MOTIFS_RECOURS de shared/rules/cdd.ts. */
export type MotifRecours =
  | 'remplacement' | 'remplacement_suppression' | 'attente_cdi' | 'accroissement' | 'travaux_urgents' | 'saisonnier_usage' | 'export'
  | 'senior' | 'politique_emploi';
/** Nature d'une ligne de l'historique des contrats : embauche, avenant (changement de régime), renouvellement d'un CDD. */
export type NatureLigneContrat = 'embauche' | 'avenant' | 'renouvellement';
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
/**
 * Congés décomptés sur un solde : congés payés, RTT / jours de repos, récupération, congé pris sur le compte
 * épargne-temps (`CET`, jours ouvrés débités du CET, shared/rules/conges.ts).
 */
export type CongeType = 'CP' | 'RTT' | 'RECUP' | 'CET';
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
export interface Formation {
  id: string; nom: string; court: string; type: FormationType; validite: number; duree: string; organisme: string; cout: number; validation: ValidationMode; archive?: ISODate | null;
  /**
   * Durée en heures (t122, shared/rules/heures-formation.ts), facultative : extraite du texte `duree` à la reprise quand
   * c'est possible, sinon à compléter. Sans elle ni horaires de session, une formation suivie compte « durée inconnue ».
   */
  dureeHeures?: number | null;
  /**
   * Formation santé-sécurité à déclarer au Passeport de prévention (lot 7, t066, shared/rules/passeport-prevention.ts) :
   * cochée par la migration sur les formations santé-sécurité (SST, CACES, ATEX, électrique, AIPR, EPI, hauteur, PRAP),
   * modifiable dans Référentiels → Formations ; absente ou fausse : non déclarée.
   */
  passeportPrevention?: boolean;
}
export interface HabType {
  id: string; nom: string; detail: string; prereqs: string[]; medical: boolean; validite: number; signataire: string; archive?: ISODate | null;
  /** Titre qui place son titulaire en suivi individuel renforcé (art. R4624-23 II : autorisation de conduite, habilitation électrique…). */
  sir?: boolean;
  /**
   * Modèle du titre imprimé à la délivrance (t115, client/src/titre-habilitation.ts) : habilitation électrique (NF C18-510),
   * autorisation de conduite (art. R4323-56, R489, R486) ou générique ; absent : générique.
   */
  modele?: ModeleTitre | null;
}
/** Modèle de titre d'habilitation imprimé : électrique (NF C18-510), autorisation de conduite (R4323-56) ou générique. */
export type ModeleTitre = 'electrique' | 'conduite' | 'generique';
export interface Destination {
  code: string; pays: string; visa: VisaKind; visaSub: string; oblig: VaccinId[]; rec: VaccinId[]; passMois: number;
  /** Formalité de sécurité sociale du détachement ; null : déduite du code pays (`secuDe` de shared/constants.ts). */
  secu: SecuDetachement | null;
  archive?: ISODate | null;
  /**
   * Vigilance de France Diplomatie pour le pays (t068, shared/rules/vigilance.ts), saisie par le service RH : vert,
   * jaune, orange ou rouge ; null : non renseignée. `vigilanceLe` : jour de la dernière vérification sur le site.
   */
  vigilance?: Vigilance | null;
  vigilanceLe?: ISODate | null;
}
/** Couleurs de la carte des conseils aux voyageurs de France Diplomatie (vert : vigilance normale … rouge : formellement déconseillé). */
export type Vigilance = 'vert' | 'jaune' | 'orange' | 'rouge';
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
  /**
   * Poste exposé à des risques particuliers (agents chimiques dangereux, CMR, ATEX…) : visite post-exposition ou de fin de
   * carrière de ses titulaires à leur sortie (art. L4624-2-1, shared/rules/visites-dues.ts).
   */
  expose?: boolean;
  /**
   * Poste de la liste des postes à risques particuliers pour la santé ou la sécurité (art. L4154-2), distincte du suivi
   * renforcé (`sir`) et de l'exposition (`expose`) : un CDD, un intérimaire ou un alternant qui l'occupe doit avoir suivi
   * la formation renforcée à la sécurité depuis son entrée (shared/rules/formation-renforcee.ts). Décoché par défaut.
   */
  risquesL4154?: boolean;
  /**
   * Compte professionnel de prévention (t052, shared/rules/c2p.ts) : facteurs d'exposition que Cursus ne mesure pas, cochés
   * par le service RH ou le référent HSE quand ses titulaires y sont exposés au-delà du seuil de l'art. D4163-2 après les
   * protections collectives et individuelles. null ou vide : aucun (décochés par défaut). Hors des vues du manager et du
   * collaborateur.
   */
  c2p?: FacteurPoste[] | null;
}
/**
 * Couverture minimale d'une équipe (t067, shared/rules/couverture.ts) : au moins `min` membres présents, non absents et
 * titulaires d'une certification valide de `formation` (SST, EPI incendie…), chaque jour.
 */
export interface LigneCouverture { formation: string; min: number }
/** Membre qui manque à la couverture le jour où elle tombe sous le minimum, et pourquoi ; `insuffisant` : trop peu de titulaires. */
export interface CauseCouverture { type: 'expiration' | 'sortie' | 'absence' | 'insuffisant'; empId: number | null; nom: string | null; le: ISODate | null }
/**
 * Couverture d'une ligne d'équipe, calculée par le serveur sur l'instantané complet (`Dataset.couverture`) : titulaires
 * comptés aujourd'hui et, s'il y en a un sous l'horizon d'alerte, le premier jour où le minimum n'est plus atteint.
 */
export interface EtatCouverture {
  equipe: string; formation: string; min: number;
  /** Membres comptés aujourd'hui (présents, non absents, certification valide). */
  compte: number;
  /**
   * Premier jour sous le minimum (aujourd'hui compris), titulaires comptés ce jour-là, dernier jour du manque dans
   * l'horizon (null : au-delà) et causes ; null : minimum tenu sur tout l'horizon.
   */
  manque: { le: ISODate; compte: number; jusquau: ISODate | null; causes: CauseCouverture[] } | null;
  /**
   * Calculée sans les absences hors chantiers (vue du référent HSE, qui ne les reçoit pas) : un manque dû à une absence
   * n'y figure pas, la couverture est à vérifier avec le service RH.
   */
  sansAbsences?: boolean;
}
/** `exigences` : formations et habilitations exigées de tous ses membres (null : aucune). */
export interface Equipe {
  nom: string; managerId: number | null; ordre: number; exigences?: Exigences | null;
  /**
   * Travail de nuit ou en continu (Référentiels → Postes, exigences communes de l'équipe) : aucun salarié de moins de
   * 18 ans n'y est affecté (art. L3163-2, shared/rules/mineurs.ts). null : case pas encore renseignée (décochée).
   */
  nuit?: boolean | null;
  /** Couverture minimale (SST, EPI incendie…) ; null ou vide : aucun seuil, la règle est inactive (shared/rules/couverture.ts). */
  couverture?: LigneCouverture[] | null;
  /**
   * Équipe parente (t136, shared/rules/hierarchie.ts) : son manager est le responsable (N+1) du manager de cette équipe,
   * qui lui soumet ses absences, ses feuilles et ses entretiens. null : aucune (validations du manager par le service RH).
   */
  parente?: string | null;
  /**
   * Horaire de poste proposé par défaut sur les feuilles de temps de ses membres (code du référentiel `horaires`,
   * shared/rules/horaires.ts) ; null ou absent : aucun, la feuille se tient sans horaire.
   */
  horaire?: string | null;
  // lot 11 — organigramme
  /**
   * Entité (société ou établissement, `Entite.code`) portée par une équipe racine (sans équipe parente) ; ses équipes
   * rattachées en héritent (shared/rules/entites.ts, `entiteEquipe`). null : équipe racine sans entité (anomalie).
   */
  entite?: string | null;
  /** Site de rattachement (D14, code de matrix.pub_sites, cache `sites`) ; null : celui d'une équipe au-dessus ou de l'entité. */
  siteCode?: string | null;
  /** Unité de l'organigramme de Matrix (D15, code saisi à la main, unique) ; null : celle d'une équipe au-dessus. */
  uniteCode?: string | null;
}
/**
 * Horaire de poste du référentiel (écran Référentiels → Horaires, shared/rules/horaires.ts), distinct des postes et de
 * leurs exigences : code (choisi une fois pour toutes), libellé, début et fin (« HH:MM » ; une fin antérieure au début
 * finit le lendemain : poste de nuit), pause en minutes. Archivé, il n'est plus proposé ; les feuilles qui le portent le gardent.
 */
export interface Horaire {
  code: string; nom: string; debut: string; fin: string; pause: number; archive?: ISODate | null;
  /**
   * Compte professionnel de prévention (t052, shared/rules/c2p.ts) : horaire d'un roulement en équipes successives
   * alternantes (2x8, 3x8…), dont les nuits comptent au seuil de 50 et non à celui de 120 (art. D4163-2). null ou absent :
   * pas encore qualifié (ses nuits comptent comme travail de nuit, signalées « à qualifier ») ; faux : non alternant.
   */
  alternant?: boolean | null;
}
/** Horaire figé sur une feuille de temps : code, début, fin et pause au moment de la soumission ou de la validation. */
export type HoraireFige = Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'>;
/** Projet ou chantier tenu dans Keystone : archivé, il reste en base (historique) sans plus être proposé ni évalué. */
export type StatutKeystone = 'actif' | 'archive';
export interface Projet { code: string; nom: string; statut: StatutKeystone }
/**
 * Chantier transmis par Keystone (identifiant Keystone). `ressources` : salariés dont une affectation
 * chevauche les dates du chantier, recalculés par le serveur (server/src/integrations/keystone-entrant.ts).
 */
export interface Chantier {
  id: string; nom: string; client: string; lieu: string; pays: string; debut: ISODate; fin: ISODate; chef: string; habs: string[]; certs: string[]; ressources: number[]; statut: StatutKeystone;
  /**
   * Grand déplacement (t031, shared/rules/deplacements-paie.ts) : qualification saisie par le service RH dans Cursus
   * (jamais transmise par Keystone) ; null : pas encore qualifié (proposé pour un chantier en France). Seul un chantier
   * qualifié donne des jours et nuits de grand déplacement à la paie.
   */
  grandDeplacement?: boolean | null;
}

export interface Referentiels {
  formations: Formation[];
  habilitations: HabType[];
  destinations: Destination[];
  /** Postes et leurs exigences (shared/rules/exigences.ts), archivés compris. */
  postes: Poste[];
  equipes: Equipe[];
  /** Horaires de poste (shared/rules/horaires.ts), archivés compris ; absent : aucun (jeu de données d'avant le lot 6). */
  horaires?: Horaire[];
  projets: Projet[];
  chantiers: Chantier[];
  // lot 11 — organigramme
  /** Entités juridiques (société, établissement), fermées comprises : données publiques, transmises à tous. */
  entites?: Entite[];
  /** Sites de rattachement (cache de matrix.pub_sites), inactifs compris. */
  sites?: Site[];
  // lot 11 — notes de frais
  /** Barème kilométrique par année (shared/rules/frais-km.ts), saisi par l'administrateur RH ; absent : aucun. */
  baremesKm?: BaremeKm[];
  /** Forfaits et limites d'exonération par année (repas, grand déplacement, étranger par pays) ; absent : aucun. */
  forfaitsFrais?: ForfaitFrais[];
  /** Taux des devises par mois, saisis par la comptabilité ou le service RH ; absent : aucun. */
  tauxDevises?: TauxDevise[];
}

// — Collaborateurs —
/** `convocLe` : date d'envoi de la dernière convocation à la session (e-mail avec fichier .ics). */
export interface Certification { id: number; empId: number; f: string; obtenue: ISODate; sessionId: number | null; convoc: 'now' | 'later' | null; convocLe: ISODate | null;
  /**
   * Correction d'une saisie erronée (shared/rules/corrections.ts) : dernière modification (`cert.modifier`) et annulation
   * (`cert.annuler`), datées, signées et motivées. Une certification annulée reste en base mais hors de tous les calculs :
   * elle n'est transmise qu'au service RH, dans `Employe.certsAnnulees`. Les motifs (texte libre) restent au service RH.
   */
  corrigeLe?: ISODate | null; corrigePar?: string | null; corrigeMotif?: string | null;
  annuleLe?: ISODate | null; annulePar?: string | null; annuleMotif?: string | null;
  /**
   * Inscriptions en formation initiale closes par la certification (`cert.ajouter`), telles qu'elles étaient : rendues si
   * elle est annulée ou change de formation (server/src/actions/inscriptions-closes.ts). Service RH seulement.
   */
  inscriptionsCloses?: Inscription[] | null;
}
/** Mesure prise sur un titre après un incident ou une restriction : suspension (réversible) ou retrait (définitif). */
export type HabMesure = 'suspension' | 'retrait';
export interface HabTitre {
  id: number; empId: number; h: string; delivree: ISODate | null; par: string | null; demande: ISODate | null;
  /** Suspension ou retrait en cours (null = aucun), avec sa date, son motif (texte libre) et son auteur. */
  mesure: HabMesure | null; mesureDate: ISODate | null; mesureMotif: string | null; mesurePar: string | null;
}
/**
 * Délivrance d'un titre d'habilitation (t115, server/src/delivrances.ts) : une ligne par délivrance et par renouvellement,
 * le titre en vigueur restant dans `habTitres`. `expire` : échéance calculée à la délivrance (validité d'alors) ;
 * `remplaceeLe` : date de la délivrance suivante (null : délivrance en vigueur), avec la mesure (suspension, retrait) et sa
 * date figées à ce moment, sans motif. `auteur`, `auteurId` : qui l'a enregistrée (nom, fiche ; null : Cursus, reprise).
 */
export interface HabDelivrance {
  id: number; empId: number; h: string; titreId: number | null; delivree: ISODate; par: string | null; expire: ISODate | null;
  remplaceeLe: ISODate | null; mesure: HabMesure | null; mesureDate: ISODate | null;
  le: ISODate; auteur: string | null; auteurId: number | null;
}
/** Origine d'une formation suivie : demande hors catalogue acceptée, action du plan réalisée, session, saisie directe. */
export type OrigineFormationSuivie = 'demande' | 'plan' | 'session' | 'saisie';
/**
 * Formation suivie par un salarié (t116, shared/rules/formations-suivies.ts), du catalogue (`f`) ou hors catalogue
 * (`libelle`) : dates, durée en heures (null : celle du catalogue, sinon inconnue), organisme, formation obligatoire ou non
 * (compte pour l'état des lieux à 8 ans quand elle ne l'est pas), origine et ce qui l'a produite (ligne du plan, demande).
 * Correction et annulation motivées comme les certifications ; annulée, hors de tous les calculs (service RH seulement).
 */
export interface FormationSuivie {
  id: number; empId: number; f: string | null; libelle: string | null; du: ISODate; au: ISODate; duree: number | null;
  organisme: string | null; obligatoire: boolean; origine: OrigineFormationSuivie; planActionId: number | null; demandeId: number | null;
  le: ISODate; auteur: string | null; auteurId: number | null;
  corrigeLe?: ISODate | null; corrigePar?: string | null; corrigeMotif?: string | null;
  annuleLe?: ISODate | null; annulePar?: string | null; annuleMotif?: string | null;
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
/**
 * Motif d'une demande de visite au service de prévention et de santé au travail ; mi-carrière (art. L4624-2-2) et fin de
 * carrière ou post-exposition (art. L4624-2-1) : visites dues à un événement (shared/rules/visites-dues.ts).
 */
export type MotifVisite = 'periodique' | 'embauche' | 'reprise' | 'employeur' | 'mi_carriere' | 'fin_carriere';
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
   * CDD et intérim (t053, shared/rules/cdd.ts) : motif de recours (facultatif pour l'intérim et sur une fiche antérieure,
   * rappelé tant qu'il manque) et terme initial du CDD, avant ses renouvellements (lignes `renouvellement` de l'historique
   * des contrats). Service RH, paie, lecture seule et intéressé (server/src/dataset.ts).
   */
  motifRecours?: MotifRecours | null;
  cddFinInitiale?: ISODate | null;
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
  /**
   * Salarié de moins de 18 ans affecté à des travaux réglementés : date de la déclaration de dérogation à l'inspection du
   * travail (art. R4153-40 et suivants), valable 3 ans (shared/rules/mineurs.ts) ; null : aucune. Saisie par le service RH ;
   * retirée de la vue du manager et de celle de la paie (server/src/dataset.ts).
   */
  derogationTravauxLe?: ISODate | null;
  /**
   * Vues qui reçoivent la dérogation sans la date de naissance (référent HSE, lecture seule) : sa validité court au-delà
   * des 18 ans, calculé par le serveur (pas d'échéance de renouvellement, comme pour le service RH) ; sans la date.
   */
  derogationApresMajorite?: boolean;
  /**
   * Vue du référent HSE, qui ne reçoit pas les feuilles de temps : travailleur de nuit (art. L3122-5), calculé par le
   * serveur sur les feuilles validées (shared/rules/repos-nuit.ts). Jamais enregistré.
   */
  travailleurNuit?: boolean;
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
  /**
   * Personne à prévenir en cas d'urgence (t068) : nom (lien compris, texte libre) et téléphone, saisis par le salarié
   * depuis son portail (`employe.contactUrgence`) ou par le service RH. Service RH et intéressé seulement : retirés des
   * vues du manager et des profils restreints (server/src/dataset.ts).
   */
  urgenceNom?: string | null;
  urgenceTel?: string | null;
  /**
   * Dossier anonymisé (`employe.anonymiser`, durées de conservation : shared/rules/conservation.ts) : identité remplacée
   * par « Salarié anonymisé n° X », date du jour de l'anonymisation ; null tant que le dossier est nominatif.
   */
  anonymiseLe?: ISODate | null;
  // lot 11 — organigramme
  /**
   * Site (D14) et unité (D15) de rattachement, tirés de l'équipe (shared/rules/entites.ts, `rattachementSalarie`) et
   * publiés à Matrix par pub_salaries ; null : non renseignés.
   */
  siteCode?: string | null;
  uniteCode?: string | null;
  /**
   * lot 11 — indicateurs (shared/rules/indicateurs-legaux.ts) : sexe aligné sur la DSN et catégorie d'emploi à 4 valeurs
   * (BDESE, index d'égalité), saisis par le service RH ou repris de Lucca ou de Sage ; null : à compléter. Service RH et
   * intéressé seulement : retirés des vues du manager et des profils restreints (server/src/dataset.ts), qui n'en ont
   * que les agrégats masqués (GET /api/indicateurs). Au journal, le nom du champ seulement, jamais sa valeur.
   */
  sexe?: Sexe | null;
  categorie?: CategorieEmploi | null;
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
   * Salarié exposé à des risques particuliers, coché par le service RH avec le type de suivi (`medical.suivi`) : visite
   * post-exposition ou de fin de carrière à sa sortie (shared/rules/visites-dues.ts). Service RH et intéressé seulement.
   */
  expose?: boolean | null;
  /**
   * Vues sans les visites médicales (manager, lecture seule) : échéance de l'entretien de parcours qui suit la visite de
   * mi-carrière, calculée par le serveur (shared/rules/entretien-mi-carriere.ts), sans la date de la visite ; null : aucun.
   * Absent : calculé sur l'instantané (service RH, intéressé). Jamais enregistré.
   */
  entretienMiCarriere?: ISODate | null;
  /**
   * Remplace `visite` et `avis` dans les vues manager et des profils restreints de l'espace RH : seul le verdict est
   * transmis (aptitude valide ou non, avis), avec les restrictions en vigueur recopiées telles qu'écrites, sans date de visite.
   */
  aptitude?: {
    ok: boolean; avis?: AvisMedical | null; restrictions?: Restriction[];
    /** Visite due à un événement, échue ou sous l'horizon d'alerte (shared/rules/visites-dues.ts) : ni motif, ni date. */
    aProgrammer?: boolean;
  };
  passeport: Passeport | null;
  certs: Certification[];
  /** Certifications annulées (saisie erronée, `cert.annuler`) : service RH seulement (vide ailleurs, server/src/dataset.ts). */
  certsAnnulees?: Certification[];
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
  /**
   * Places libres proposées à la liste d'attente (lot 7, t120 : statut `proposee`), calculées au chargement sur toute la
   * file, avant la restriction au périmètre : un manager qui ne voit pas la file sait qu'elles ne sont pas à prendre.
   */
  proposees?: number;
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
/**
 * Liste d'attente d'une session complète (lot 7, chantier C, t120 : shared/rules/liste-attente.ts, server/src/liste-attente.ts).
 * `attente` : en file, par ordre d'arrivée (`rang`, croissant par session) ; `proposee` : place libérée, proposée au service
 * RH qui confirme l'inscription ; `inscrit` : inscrit depuis la liste ; `retire` : sorti de la liste (`issue`). Une ligne par
 * session et par salarié (réutilisée s'il y revient). `demandeId` : demande acceptée qui l'y a placé ; `certId` : recyclage
 * de cette certification, sinon formation initiale (`inscriptionId` : inscription à replanifier, s'il y en avait une).
 * `position` : place dans la file, calculée au chargement sur toutes les données (jamais stockée), null hors de la file.
 */
export interface AttenteSession {
  id: number; sessionId: number; empId: number;
  demandeId: number | null; certId: number | null; inscriptionId: number | null;
  rang: number; le: ISODate; par: string | null;
  statut: StatutAttente;
  proposeeLe: ISODate | null;
  issueLe: ISODate | null; issuePar: string | null; issue: IssueAttente | null;
  position?: number | null;
}
export type StatutAttente = 'attente' | 'proposee' | 'inscrit' | 'retire';
/** Mode de la liste d'attente quand une place se libère : proposition au service RH, ou inscription aussitôt. */
export type ModeAttente = 'confirmer' | 'automatique';
/**
 * Fin d'une attente : inscrit (`inscription`), retrait par le salarié, son manager ou le service RH, session annulée,
 * clôturée ou commencée, salarié hors contrat à la date, déjà inscrit à la session, recyclage ou certification enregistrés
 * depuis, certification remplacée ou supprimée, demande rouverte.
 */
export type IssueAttente =
  | 'inscription' | 'salarie' | 'manager' | 'rh' | 'session_annulee' | 'session_cloturee' | 'session_commencee' | 'hors_contrat'
  | 'deja_inscrit' | 'deja_certifie' | 'certification_remplacee' | 'demande_rouverte';
/** Résultat d'un inscrit, enregistré à la clôture de la session. */
export interface Participation {
  id: number; sessionId: number; empId: number; parcours: 'recyclage' | 'initiale'; present: boolean;
  /** Évaluation : null si la formation ne l'exige pas, ou pour un absent. */
  reussi: boolean | null;
  /** Certification enregistrée (présent, et reçu si l'évaluation est exigée). */
  certId: number | null;
}
/**
 * Évaluation d'une formation par un participant (lot 7, chantier C, t121 : shared/rules/evaluation-formation.ts,
 * server/src/actions/evaluations-formation.ts). Rattachée à une participation présente d'une session clôturée
 * (`participationId`) ou à une formation suivie hors session (`formationSuivieId`). À chaud (`chaud`) : note de 1 à 5 donnée
 * par le salarié dans son espace, ou recueillie par le service RH à la clôture. À froid (`froid`) : efficacité (efficace,
 * partiellement, non), demandée au salarié et à son manager N jours après la formation (réglage). `repondant` : de qui est
 * l'avis (le salarié, ou son manager) ; `auteur` et `auteurId` : qui l'a enregistré (lui-même, ou le service RH). Une seule
 * évaluation par formation, type et répondant : une nouvelle saisie remplace la précédente. Le commentaire (texte libre,
 * nominatif) reste au service RH ; le référent HSE et la lecture seule ne reçoivent que les indicateurs agrégés.
 */
export interface EvaluationFormation {
  id: number; empId: number; participationId: number | null; formationSuivieId: number | null;
  type: TypeEvaluation; repondant: RepondantEvaluation;
  /** À chaud : note entière de 1 à 5 ; null à froid. */
  note: number | null;
  /** À froid : efficacité ; null à chaud. */
  efficacite: EfficaciteFormation | null;
  commentaire: string | null;
  le: ISODate; auteur: string | null; auteurId: number | null;
}
export type TypeEvaluation = 'chaud' | 'froid';
export type RepondantEvaluation = 'salarie' | 'manager';
export type EfficaciteFormation = 'efficace' | 'partielle' | 'non';
/** Qui remplit l'évaluation à froid (réglage `evaluationFroidPar`). */
export type RepondantsFroid = 'les_deux' | 'salarie' | 'manager';
/**
 * Indicateurs des évaluations d'un regroupement (organisme, formation, total) sur un exercice (shared/rules/
 * evaluation-formation.ts) : participants évaluables, avis à chaud (nombre, moyenne sur 5), avis à froid attendus et
 * reçus, efficacité (nombres, taux d'« efficace » parmi les réponses), taux de réponse, appréciation de session du service
 * RH d'avant le lot 7 (`Session.bilan.note`, reprise telle quelle, jamais répartie par personne). `masque` : moins de
 * 3 réponses, moyenne et taux retirés (vue agrégée du référent HSE et de la lecture seule).
 */
export interface LigneEvaluation {
  cle: string; participants: number;
  chaud: number; moyenneChaud: number | null; tauxChaud: number | null;
  froidAttendus: number; froid: number; efficaces: number; partielles: number; non: number; tauxEfficacite: number | null; tauxFroid: number | null;
  sessionsNotees: number; moyenneSessions: number | null;
  masque?: boolean;
}
export interface IndicateursEvaluation { exercice: number; total: LigneEvaluation; parOrganisme: LigneEvaluation[]; parFormation: LigneEvaluation[] }
export interface PlanAction {
  id: number; exercice: number; f: string | null; libelle: string | null; equipe: string; periode: Trimestre; effectif: number; cout: number; statut: PlanStatut;
  /** `import` (plan importé), `demande` (demande acceptée), `report` (action reportée d'un exercice clos) ; null : ancienne base, démonstration. */
  origine: string | null;
  /** Coût et effectif réels, saisis à la clôture de l'action (« réalisé ») : le réalisé des enveloppes (shared/rules/budget.ts). */
  coutReel?: number | null;
  effectifReel?: number | null;
  /** Action reportée : action de l'exercice clos dont elle reprend la ligne (`plan.cloturerExercice`). */
  reportDe?: number | null;
  /**
   * Correction (`plan.modifier`) et suppression (`plan.supprimer`, demande rouverte) d'une ligne saisie par erreur : datées,
   * signées et motivées. Une ligne supprimée reste en base, hors de l'instantané et de tous les calculs (server/src/dataset.ts).
   */
  corrigeLe?: ISODate | null; corrigePar?: string | null; corrigeMotif?: string | null;
  annuleLe?: ISODate | null; annulePar?: string | null; annuleMotif?: string | null;
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
  /**
   * Coordonnées sur place (t068) : hébergement et contact local (textes libres du service RH, retirés hors du service RH),
   * date d'inscription du voyageur sur Ariane (France Diplomatie). Modifiables par `voyage.modifier`, Keystone compris.
   */
  hebergement?: string | null; contactSurPlace?: string | null; arianeLe?: ISODate | null;
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
/**
 * Ligne de l'historique des contrats (t074, shared/rules/historique-contrat.ts) : régime en vigueur à compter de `effet`,
 * jusqu'à la ligne suivante. `regime` null : régime antérieur inconnu (historique amorcé depuis une fiche qui ne le disait
 * pas, migration lot6-contrats-historique) ; les calculs gardent alors leur comportement d'avant l'historique.
 * `jusquau` : terme du contrat fixé par la ligne (CDD : terme initial à l'embauche, nouveau terme au renouvellement).
 * `applique` faux : avenant programmé à une date future, appliqué à la fiche à sa date (server/src/avenants.ts) ;
 * `annuleLe` : avenant programmé annulé, ou devenu sans objet par une sortie. `fin` : dernier jour du contrat enregistré
 * par la sortie. `reference` : référence de l'avenant (texte court du service RH, jamais recopié au journal).
 */
export interface ContratHistorique {
  id: number; empId: number; effet: ISODate; nature: NatureLigneContrat; regime: ContratFige | null;
  jusquau: ISODate | null; signeLe: ISODate | null; reference: string | null;
  /** Enregistrement : jour, nom de l'auteur et sa fiche (null : Cursus, ou compte sans fiche). */
  le: ISODate; par: string | null; parId: number | null;
  applique: boolean; annuleLe: ISODate | null; fin: ISODate | null;
}
export interface FeuilleTemps {
  id: number; empId: number; week: ISODate; statut: FeuilleStatut; comment: string | null; sage: boolean; keystone: boolean; lignes: LigneTemps[]; contrat: ContratFige | null;
  /** Motif d'un dépassement des durées maximales (10 h par jour, 48 h par semaine), exigé à la soumission ou à la validation. */
  motifDepassement?: string | null;
  /**
   * Forfait jours (t043, shared/rules/forfait-jours.ts) : motif donné à la validation quand le cumul de l'année dépasse le
   * plafond (forfait, plus les jours rachetés par avenant) ; texte libre du valideur, jamais recopié au journal.
   */
  motifForfait?: string | null;
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
  /**
   * Vues sans la date de naissance (manager, profils restreints) : salarié mineur un jour au moins de la semaine, calculé
   * par le serveur (shared/rules/mineurs.ts), pour que la feuille d'une semaine passée garde ses contrôles après les 18 ans.
   * Jamais enregistré.
   */
  mineur?: boolean;
  /**
   * Mêmes vues : salarié de moins de 16 ans un jour au moins de la semaine (repos quotidien de 14 h, nuit de 20 h à 6 h :
   * shared/rules/repos-nuit.ts), présent seulement quand c'est le cas. Jamais enregistré.
   */
  moins16?: boolean;
  /**
   * Majoration des heures d'un jour férié autre que le 1er mai (%, réglage `tauxMajorationFerie`) figée à la validation,
   * comme celle du dimanche. Null avant : le réglage s'applique. Le 1er mai est toujours majoré de 100 % (art. L3133-6).
   */
  majFerie?: number | null;
  /**
   * Contrepartie obligatoire en repos (heures, par année civile : « 2026 » → heures) figée à la validation
   * (shared/rules/durees.ts, `corAValider`) : COR de l'année recalculée sur toutes les feuilles validées, moins celle déjà
   * figée sur les autres. Négative pour corriger une COR déjà créditée. Null : aucune.
   */
  cor?: Record<string, number> | null;
  /**
   * Dernière réouverture de la feuille validée par l'administrateur RH (t131, shared/rules/regularisation.ts) ; null ou
   * absente : jamais rouverte. Vues du manager et du collaborateur : sans le motif, les rubriques ni les heures Keystone.
   */
  reouverture?: ReouvertureFeuille | null;
  /**
   * Horaire de poste de chaque jour, du lundi au dimanche (code du référentiel `horaires`, shared/rules/horaires.ts) :
   * choisi par le salarié, son manager ou le service RH, au niveau de la feuille (les heures restent saisies par projet).
   * null : pas encore choisi, l'horaire par défaut de l'équipe est proposé un jour qui porte des heures ; « » : aucun
   * horaire. Seuls les choix explicites y sont inscrits : l'horaire proposé ne l'est jamais (voir `horairesFiges`).
   */
  horaires?: (string | null)[] | null;
  /**
   * Horaires retenus, figés à la soumission puis à la validation (`horairesAFiger`, shared/rules/horaires.ts) : pour
   * chaque jour, code, début, fin et pause tels qu'ils étaient alors (une modification ultérieure de l'horaire au
   * référentiel ne change pas le sens d'une feuille passée), null pour un jour sans horaire. Absent : feuille soumise
   * d'avant les horaires (aucun contrôle rétroactif). Une feuille renvoyée l'ignore pour l'affichage et le refige à la
   * soumission suivante, en gardant les heures d'un code inchangé.
   */
  horairesFiges?: (HoraireFige | null)[] | null;
  /**
   * Majoration des heures de nuit (%, réglage `nuitMajoration`, shared/rules/repos-nuit.ts) figée à la validation, comme
   * celles du dimanche et des fériés. Null avant : le réglage s'applique.
   */
  majNuit?: number | null;
}
/**
 * Réouverture d'une feuille validée (action `temps.rouvrir`, administrateur RH seul, motif obligatoire) : ce qui était
 * déjà parti, gardé pour n'envoyer à la revalidation que la différence.
 */
export interface ReouvertureFeuille {
  /** Instant (ISO), auteur et motif (500 caractères au plus) de la réouverture. */
  le: string; par: string; motif: string;
  /**
   * Renvoyée au salarié pour correction (« à corriger », le motif en commentaire), sinon corrigée par son valideur
   * (« soumise ») ; repasse à faux à la nouvelle soumission (un retour suivant vient du valideur).
   */
  renvoyee: boolean;
  /** Feuille déjà transmise à la paie à sa réouverture (une fois au moins) ; `lot` : dernier lot transmis qui la portait. */
  transmise: boolean; lot: number | null;
  /**
   * Rubriques déjà transmises à la paie, en codes Sage, par période d'origine (AAAA-MM → code → quantité) : l'écart
   * avec celles de la feuille revalidée part dans le lot suivant (lot « correctif »). Null : rien de transmis.
   */
  rubriques: Record<string, Record<string, number>> | null;
  /** D'où viennent `rubriques` : contenu figé du lot, lignes du lot rapprochées par matricule, ou recalcul de la feuille. */
  source?: 'lot' | 'lignes' | 'recalcul' | null;
  /**
   * Heures de nuit déjà listées « à saisir dans Sage » (rubriques désactivées, codes internes, par période d'origine :
   * `RubriquesFeuille.aSaisir` du dernier lot transmis) : la régularisation en liste l'écart. Absent ou null : aucune.
   */
  aSaisir?: Record<string, Record<string, number>> | null;
  /** Heures par projet déjà renvoyées à Keystone ; un projet retiré y est renvoyé à 0. Null : aucun événement parti. */
  keystone: Record<string, number> | null;
  /** Réouvertures précédentes (instant, auteur, motif), de la plus ancienne à la plus récente. */
  precedentes?: { le: string; par: string; motif: string }[];
}
/**
 * Dérogation au repos dominical d'une équipe (shared/rules/semaine.ts) : aucune (heures du dimanche signalées au RH), travail
 * en continu (art. L3132-12, R3132-5) ou équipe de suppléance (art. L3132-16), avec la référence de l'accord ou de la
 * décision ; réglée par l'administrateur RH (Paramètres → Repos hebdomadaire, `temps.derogationDominicale`).
 */
export type TypeDerogationDominicale = 'aucune' | 'feu_continu' | 'suppleance';
export interface DerogationDominicale { equipe: string; type: TypeDerogationDominicale; reference: string | null; le: ISODate; par: string }
/**
 * Jours fériés de l'établissement, réglés par année civile (shared/rules/feries.ts, Paramètres → Jours fériés,
 * `parametres.feries`) : modalité de la journée de solidarité (art. L3133-7 et L3133-11) et fériés non chômés. Sans
 * réglage pour une année : lundi de Pentecôte et tous les fériés chômés.
 */
export type ModaliteSolidarite = 'pentecote_chomee' | 'pentecote_travaillee' | 'autre_ferie' | 'hors_calendrier';
/** Fériés légaux (art. L3133-1), désignés par un code stable d'une année à l'autre. */
export type CodeFerie = 'jour_an' | 'paques' | '1er_mai' | '8_mai' | 'ascension' | 'pentecote' | '14_juillet' | '15_aout' | 'toussaint' | '11_novembre' | 'noel';
export interface FeriesAnnee {
  solidarite: ModaliteSolidarite;
  /** `autre_ferie` : le férié travaillé au titre de la journée de solidarité (jamais le 1er mai) ; null sinon. */
  solidariteFerie: CodeFerie | null;
  /** Fériés travaillés comme des jours ordinaires (non chômés) ; jamais le 1er mai, toujours chômé (art. L3133-4). */
  nonChomes: CodeFerie[];
  /** Instant et auteur du réglage ; `motif` (texte libre) : modification d'une année déjà engagée, service RH seulement. */
  le: string; par: string; motif?: string | null;
}
/** Réglage des fériés par année civile (« 2027 » → réglage) ; une année sans ligne garde le calendrier légal complet. */
export type CalendrierFeries = Record<string, FeriesAnnee>;
/**
 * Mandat d'élu au CSE (shared/rules/delegation.ts) : titulaire ou suppléant, dates, crédit d'heures de délégation par mois
 * (proposé d'après l'art. R2314-1, modifiable). Saisi par le service RH sur la fiche ; vu par le RH et l'élu seulement.
 */
export type RoleMandat = 'titulaire' | 'suppleant';
export interface Mandat { id: number; empId: number; role: RoleMandat; du: ISODate; au: ISODate | null; credit: number }
/** Forme de la compensation des astreintes (art. L3121-9) : financière (montant sur le bulletin de paie) ou en repos. */
export type CompensationAstreinte = 'financiere' | 'repos';
/**
 * Période d'astreinte d'un salarié (t049, lot 7, shared/rules/astreintes.ts) : du jour `du` à l'heure `debut` au jour `au`
 * à l'heure `fin` (« HH:MM », heure de Paris), équipe au moment de la planification (figée), date à laquelle la
 * programmation a été communiquée au salarié (`communiqueLe`, refaite à chaque changement des dates), motif des
 * « circonstances exceptionnelles » quand le délai de prévenance n'est pas tenu (texte libre). Jamais supprimée : annulée
 * avec un motif (`annuleLe`, horodatage). Planifiée par le manager direct ou le service RH.
 */
export interface Astreinte {
  id: number; empId: number; equipe: string | null;
  du: ISODate; debut: string; au: ISODate; fin: string;
  communiqueLe: ISODate; motif: string | null;
  creeLe: string; creePar: string; modifieLe: string | null; modifiePar: string | null;
  annuleLe: string | null; annulePar: string | null; annuleMotif: string | null;
  /**
   * Paie (étape 2, shared/rules/astreintes-paie.ts) : lot qui emporte les heures et la période de l'astreinte terminée
   * (`lotId`), import confirmé (`sage`). Absents (instantané du manager et du salarié) : non transmis.
   */
  lotId?: number | null; sage?: boolean | null;
}
/**
 * Heures (AST_H) ou période (AST_PER) d'une astreinte terminée dans un lot de paie (t049, shared/rules/astreintes-paie.ts) :
 * mois où elles tombent (`mois`), période de paie (un mois clos part sur la période ouverte), code Sage (null : rubrique
 * désactivée, à saisir dans Sage) ; bornes de l'astreinte pour le détail.
 */
export interface ElementAstreintePaie {
  astreinte: number; empId: number; matricule: string; mois: string; periode: string; rubrique: string; codeSage: string | null; quantite: number;
  du: ISODate; debut: string; au: ISODate; fin: string;
}
/**
 * Intervention pendant une astreinte : du travail effectif (art. L3121-9), déclaré sur la feuille de temps avec ses heures
 * de début et de fin (« HH:MM » ; une fin avant le début : le lendemain), rattaché au jour où il commence (`jour`) ; ses
 * heures (`heures`) s'ajoutent à la ligne INT-AST de ce jour.
 */
export interface InterventionAstreinte {
  id: number; astreinteId: number; empId: number; jour: ISODate; debut: string; fin: string; heures: number;
  declareLe: string; declarePar: string;
}
/** Délégation des validations d'un manager absent (t135, shared/rules/delegations-manager.ts) : ce que le suppléant valide. */
export type PerimetreDelegation = 'absences' | 'feuilles' | 'entretiens'
  // lot 11 — notes de frais : validation des notes de l'équipe (stocké en JSON, sans contrainte CHECK)
  | 'frais';
/**
 * Délégation datée des validations d'un manager à un suppléant (t135), bornes comprises. Saisie par le manager pour
 * lui-même ou par le service RH ; `creePar`, `revoqueePar` : nom de l'auteur ; `revoqueeLe` : horodatage de la révocation,
 * qui y met fin aussitôt ; `annonceeLe` : horodatage du message envoyé au suppléant à son début (éléments en attente).
 */
export interface DelegationValidation {
  id: number; managerId: number; suppleantId: number; du: ISODate; au: ISODate; perimetre: PerimetreDelegation[];
  creeLe: string; creePar: string; revoqueeLe: string | null; revoqueePar: string | null; annonceeLe: string | null;
}
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
  /**
   * Fichier d'import de la paie (shared/rules/absences-paie.ts) : `lotId`, lot de paie qui la porte (généré, en attente de
   * confirmation, ou dernier lot transmis) ; `sage`, jours transmis à la paie au moins une fois (import confirmé). Transmis
   * au service RH, à la paie et à la lecture seule ; ni au manager, ni au collaborateur, ni au référent HSE
   * (server/src/dataset.ts).
   */
  lotId?: number | null; sage?: boolean;
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
  /** Report reçu qui porte des jours de fractionnement (`conges.fractionnement`, shared/rules/fractionnement.ts) ; null sinon. */
  origine?: 'fractionnement' | null;
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
  /**
   * Heures supplémentaires déjà faites dans l'année civile de la date d'arrêté, avant elle (contingent annuel,
   * shared/rules/durees.ts) : 0 pour une reprise au 1er janvier. Null : non reprises.
   */
  heuresSupAnnee?: number | null;
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
 * Jours de fractionnement d'une période de congés payés (`periode` : année de prise, t046, shared/rules/fractionnement.ts),
 * décidés par le service RH (`conges.fractionnement`), une ligne par salarié et période : crédités (`jours`, report reçu
 * `reportId` sur la période) ou renonciation individuelle du salarié (art. L3141-19, aucun jour). Service RH, paie, lecture
 * seule et intéressé.
 */
export interface Fractionnement {
  id: number; empId: number; periode: number; decision: 'credite' | 'renonce'; jours: number; reportId: number | null; le: ISODate; par: string;
}
/** Règle des jours de fractionnement : légale (supplétive), fixée par un accord d'entreprise, ou aucun jour (accord collectif). */
export type RegleFractionnement = 'legal' | 'accord' | 'aucun';
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

/**
 * État des compteurs d'un salarié à sa date de sortie (t128, shared/rules/solde-sortie.ts), en jours (récupération en
 * heures), à transmettre à la paie pour le solde de tout compte ; le montant de l'indemnité reste calculé par Sage.
 * - `cp` : période acquise `periode` (année de prise : droit, reports non échus compris, jours pris et posés, solde) et
 *   période en cours d'acquisition `periode` + 1 (jours acquis jusqu'au mois de la sortie, jours déjà pris par
 *   anticipation, solde) ; `total` : jours à indemniser (indemnité compensatrice, rubrique ICCP_J) ;
 * - `rtt` : droit de l'année au prorata, pris et posés, solde ; `tropPris` : jours pris au-delà du droit, signalés, sans
 *   retenue automatique ;
 * - `recup` : repos compensateur, en heures ; `cet` : jours du compte épargne-temps (placements et solde repris), liquidés
 *   en entier par défaut (aucun accord sur le CET connu).
 * Null : compteur qui ne concerne pas le contrat (intérim, 35 h sans RTT, heures supplémentaires payées…).
 */
export interface EtatSortie {
  date: ISODate;
  cp: {
    periode: number; droit: number; pris: number; poses: number; solde: number;
    acquis: number; anticipes: number; soldeEnCours: number; total: number;
  } | null;
  rtt: { annee: number; label: string; droit: number; pris: number; poses: number; solde: number; tropPris: number } | null;
  recup: { acquis: number; pris: number; poses: number; solde: number } | null;
  cet: { cp: number; rtt: number; repris: number; total: number } | null;
  /** Points à voir avant de transmettre (période précédente non clôturée, demandes en attente…). */
  avertissements: string[];
}
/**
 * Solde de sortie photographié à l'enregistrement de la sortie (`employe.sortie`, table `soldesSortie`) : une correction
 * ultérieure d'une feuille ou d'une absence ne change pas ce qui a été transmis. Refait à chaque modification de la sortie
 * tant qu'il n'est pas parti à la paie ; `lotId` : lot de paie qui l'emporte (rubriques de sortie actives), `sage` :
 * import de ce lot confirmé. Service RH, paie et lecture seule (vide ailleurs).
 */
export interface SoldeSortie {
  id: number; empId: number; date: ISODate; etat: EtatSortie; le: string; par: string; lotId: number | null; sage: boolean;
  /**
   * Réglé hors fichier : aucune rubrique de sortie active à la confirmation du lot de sa période (`lotId`, `sage` vrai),
   * la paie l'a saisi dans Sage ; une rubrique activée ensuite ne le rattrape pas.
   */
  horsFichier?: boolean;
  /**
   * Remplacé : sortie annulée, ou modifiée à une autre date, après la transmission du solde ; gardé pour l'historique
   * (l'écart se corrige dans Sage), il n'est plus le solde courant du salarié (un par salarié au plus).
   */
  remplaceLe?: string | null;
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
export interface DemandeCollab { id: number; empId: number; type: DemandeType; f: string | null; h: string | null; libelle: string | null; label: string | null; sessionId: number | null; motif: string | null; date: ISODate;
  /** `retiree` : retirée par son auteur tant qu'elle était en attente (`demande.annuler`). */
  statut: DemandeStatut | 'retiree';
  reponse: string | null; parId: number | null; declaration: Declaration | null;
  /** Demande refusée : motif donné par le service RH, montré au collaborateur. */
  motifRefus?: string | null;
  /** Ce que l'acceptation a créé (`demande.accepter`), défait par la réouverture : identifiants seulement. */
  suite?: SuiteDemande | null;
  /** Dernière réouverture par le service RH (`demande.reouvrir`) : le motif (texte libre) reste au service RH. */
  rouverteLe?: ISODate | null; rouvertePar?: string | null; rouverteMotif?: string | null;
}
/**
 * Suite donnée à une demande acceptée : inscription à la session souhaitée (recyclage `certId` ou formation initiale
 * `inscriptionId`, `depuis` : session quittée pour elle ; `cree` : inscription créée), ligne ajoutée au plan de formation
 * (`planId`), ou titre d'habilitation en attente de délivrance (`habTitreId`, `cree` : titre créé par l'acceptation,
 * sinon demande inscrite sur un titre retiré ou expiré). Vide : l'acceptation n'a rien créé (déjà inscrit, titre déjà en attente).
 */
export interface SuiteDemande {
  sessionId?: number; certId?: number; inscriptionId?: number; depuis?: number | null; planId?: number; habTitreId?: number; cree?: boolean;
  /** Session demandée complète : attente en liste d'attente (lot 7, t120), gardée après l'inscription ou le retour au plan. */
  attenteId?: number;
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
  /**
   * CDD (client/src/pages/parametres/Contrats.tsx, shared/rules/cdd.ts) : nombre de renouvellements admis (2, art.
   * L1243-13), durée maximale renouvellements compris en mois (0 : durées légales selon le motif, art. L1242-8-1), et
   * référence de l'accord de branche qui y déroge (exigée dès qu'une valeur diffère de la loi).
   */
  cddRenouvellementsMax: number;
  cddDureeMaxMois: number;
  cddAccordBranche: string;
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
  /** Âge de la visite de mi-carrière (art. L4624-2-2 : 45 ans à défaut d'accord de branche ; shared/rules/visites-dues.ts). */
  santeMiCarriereAge: number;
  /** Formations (shared/rules/formations-temps.ts) : heures des sessions proposées dans la feuille de temps des inscrits. */
  formationsTemps: boolean;
  // Décompte des heures (client/src/pages/parametres/DecompteHeures.tsx, shared/rules/majorations.ts et durees.ts) : saisie un
  // jour férié et majoration des fériés autres que le 1er mai (%), plafond des heures complémentaires du temps partiel
  // (le tiers avec la référence de l'accord), moyenne maximale sur 12 semaines (46 h avec la référence de l'accord),
  // contingent annuel d'heures supplémentaires, seuil d'alerte (%) et référence de l'accord ou de la convention.
  feriesTravaillesAutorises: boolean;
  tauxMajorationFerie: number;
  plafondHeuresComplementaires: PlafondComplementaires;
  heuresComplementairesAccord: string;
  moyenne12SemainesMax: number;
  moyenne12SemainesAccord: string;
  contingentHeuresSup: number;
  contingentAlerte: number;
  contingentAccord: string;
  /** Paie (shared/rules/absences-paie.ts) : absences validées dans le fichier d'import, avec les heures (activé par défaut). */
  absencesFichierPaie: boolean;
  /**
   * Paie : date de mise en service, premier jour d'absence transmis dans le fichier, pour toutes les absences (les jours
   * d'avant ont été traités par Lucca et Sage) ; null : seule vaut la date de départ posée par Cursus.
   */
  absencesPaieAPartirDu: ISODate | null;
  /**
   * Pièces justificatives (shared/rules/pieces.ts, server/src/pieces.ts) : désactivé par défaut (réponse de l'entreprise du
   * 18 octobre 2026) ; « local » : fichiers dans le dossier des données, sauvegardés avec la base ; « ged » : espace
   * documentaire de l'entreprise, par un adaptateur à écrire quand son interface sera connue.
   */
  piecesStockage: StockagePieces;
  /**
   * Formation renforcée à la sécurité des CDD, intérimaires et alternants affectés à un poste à risques particuliers
   * (art. L4154-2) : code du catalogue ; vide par défaut (aucune exigence, avertissement dans Paramètres).
   */
  formationRenforceeCode: string;
  /**
   * Entretien de parcours après la visite de mi-carrière (shared/rules/entretien-mi-carriere.ts) : suivi actif, et délai
   * en mois après la visite (2 par défaut, à confirmer juridiquement).
   */
  entretienMiCarriereActif: boolean;
  entretienMiCarriereMois: number;
  /** Hiérarchie (t136) : membres des équipes descendantes consultables par le manager, en lecture seule (désactivé par défaut). */
  consultationN2: boolean;
  /** Délégation des validations (t135) : le manager peut aussi déléguer ses entretiens (désactivé par défaut). */
  delegationEntretiens: boolean;
  /**
   * Paie (t031, shared/rules/deplacements-paie.ts) : jours et nuits de grand déplacement, jours à l'étranger et trajets dans
   * le fichier d'import (désactivé tant que la paie n'a pas confirmé ses codes : quantités calculées, à saisir dans Sage),
   * et premier jour transmis (date de mise en service ; null : seule vaut la date de départ posée par Cursus).
   */
  deplacementsFichierPaie: boolean;
  deplacementsPaieAPartirDu: ISODate | null;
  /** Rappel de vérifier la vigilance d'un pays (France Diplomatie) avant un départ : vérification de plus de N jours (t068). */
  vigilanceRappelJours: number;
  /**
   * Travail de nuit (t048, Paramètres → Décompte des heures, shared/rules/repos-nuit.ts) : plage de nuit en heures entières
   * (21 h – 6 h par défaut, art. L3122-20), seuils du travailleur de nuit (3 h dans la journée deux fois par semaine, 270 h
   * sur 12 mois : art. L3122-5 et L3122-23), majoration des heures de nuit en % (0 : quantité seule, rubrique HNUIT) et
   * référence de l'accord, exigée pour s'écarter des valeurs de la loi.
   */
  nuitDebut: number;
  nuitFin: number;
  nuitSeuilQuotidien: number;
  nuitSeuilAnnuel: number;
  nuitMajoration: number;
  nuitAccord: string;
  /**
   * Forfait jours (t043, shared/rules/forfait-jours.ts) : seuil d'alerte du cumul annuel (% du plafond) ; avenant de
   * renonciation à des jours de repos ouvert (seulement avec la référence de l'accord collectif, COHERENCE), plafond des
   * jours travaillés avec avenant (235 à défaut d'accord, art. L3121-66), majoration minimale des jours rachetés (10 %,
   * art. L3121-59) et période de paie des jours rachetés (JREN : mois de la signature, ou décembre de l'année).
   */
  forfaitJoursAlerte: number;
  forfaitJoursRachat: boolean;
  forfaitJoursAccord: string;
  forfaitJoursPlafond: number;
  forfaitJoursMajorationMin: number;
  forfaitJoursJren: EmissionJren;
  /**
   * Fractionnement des congés payés (t046, shared/rules/fractionnement.ts) : règle légale supplétive par défaut, fixée par un
   * accord d'entreprise ou aucun jour (art. L3141-21 ; la référence de l'accord est alors exigée), et période du congé
   * principal (« MM-JJ », du 1er mai au 31 octobre par défaut, art. L3141-13).
   */
  fractionnementRegle: RegleFractionnement;
  fractionnementAccord: string;
  fractionnementDebut: string;
  fractionnementFin: string;
  /** Compte épargne-temps (shared/rules/conges.ts) : plafonds de placement, RTT par an et CP de 5e semaine par période (5 et 5). */
  cetPlafondRtt: number;
  cetPlafondCp: number;
  /**
   * Conservation des dossiers des salariés sortis (t016, shared/rules/conservation.ts) : propositions d'effacement actives
   * (désactivé par défaut, exige la référence de la décision du DPO), et durée de chaque catégorie en années après la
   * sortie (0 : dès le lendemain du dernier jour). Rien n'est effacé sans la confirmation de l'administrateur RH.
   */
  conservationActive: boolean;
  conservationDecisionDpo: string;
  conservationDossierAns: number;
  conservationTempsAns: number;
  conservationPaieAns: number;
  conservationSanteAns: number;
  conservationPasseportAns: number;
  conservationTitreSejourAns: number;
  conservationEntretiensAns: number;
  conservationFormationsAns: number;
  /**
   * Agenda personnel (t036, server/src/agenda.ts) : flux .ics par abonnement à jeton révocable, désactivé par défaut, et ce
   * qu'il publie (absences toujours sous le libellé neutre « Absent »).
   */
  agendaFluxActif: boolean;
  agendaContenu: ContenuAgenda[];
  /**
   * Astreintes (t049, lot 7, shared/rules/astreintes.ts) : délai de prévenance en jours (15 à défaut d'accord, art.
   * R3121-3 ; en dessous, motif « circonstances exceptionnelles » et un jour franc au moins), forme de la compensation
   * (financière par défaut, réponse de l'entreprise du 23 octobre 2026), astreinte d'un salarié mineur refusée par défaut,
   * référence de l'accord (texte libre, vide tant qu'il n'est pas connu).
   */
  astreinteDelaiPrevenance: number;
  astreinteCompensation: CompensationAstreinte;
  astreinteMineurs: boolean;
  astreinteAccord: string;
  /**
   * Liste d'attente des sessions complètes (lot 7, chantier C, t120 : shared/rules/liste-attente.ts) : activée par défaut ;
   * désactivée, une demande acceptée sur une session complète va au plan de formation. Place libérée : premier admissible
   * proposé au service RH, qui confirme (par défaut), ou inscrit et convoqué aussitôt (`automatique`).
   */
  formationsListeAttente: boolean;
  formationsAttenteMode: ModeAttente;
  /**
   * Passeport de prévention (lot 7, chantier B, t066 : shared/rules/passeport-prevention.ts) : colonnes de l'export, dans
   * l'ordre du gabarit (format de la plateforme à confirmer) ; au moins une.
   */
  passeportColonnes: ColonnePasseport[];
  /**
   * Évaluation des formations (lot 7, chantier C, t121 : shared/rules/evaluation-formation.ts) : activée par défaut ; à chaud
   * après chaque formation, à froid `evaluationFroidDelai` jours après (90 par défaut), remplie par le salarié et son
   * manager (réponse de l'entreprise du 23 octobre 2026), pour les catégories cochées (Réglementaires et Recommandées).
   */
  evaluationsActives: boolean;
  evaluationFroidDelai: number;
  evaluationFroidPar: RepondantsFroid;
  evaluationFroidCategories: CategorieEvaluee[];
  // lot 11 — organigramme
  /**
   * Organigramme (lot 11, t195, shared/rules/organigramme.ts) : ouvert à tous les salariés par défaut, limité à l'annuaire
   * (nom, poste, équipe, manager) ; l'administrateur RH peut le réserver aux managers et au service RH, ou au seul
   * service RH (tous les profils de l'espace RH).
   */
  organigrammeOuvert: OrganigrammeOuvert;
  /**
   * lot 11 — indicateurs (shared/rules/indicateurs-legaux.ts) : seuil d'anonymat des agrégats (3 à 10, 5 par défaut) et
   * natures d'absence comptées dans l'absentéisme (santé, enfant malade, sans solde, injustifiée par défaut).
   */
  indicateursSeuil: number;
  absenteismeNatures: NatureAbsence[];
  // lot 11 — dossiers OPCO
  /**
   * Dossiers OPCO (lot 11, chantier C4, shared/rules/opco.ts) : OPCO proposé à la création (OPCO 2i), subrogation proposée,
   * délais des échéances en jours — dépôt avant le début de la formation, justificatifs après la fin, relance d'un
   * remboursement attendu après l'envoi des justificatifs (30, 90 et 60 par défaut, à confirmer avec le service RH).
   */
  opcoDefaut: CodeOpco;
  opcoSubrogation: boolean;
  opcoDelaiDepot: number;
  opcoDelaiJustificatifs: number;
  opcoDelaiRemboursement: number;
  // lot 11 — notes de frais (shared/rules/frais*.ts)
  /**
   * Notes de frais : module désactivé par défaut (activation après l'essai de charge et le paramétrage) ; circuit
   * (validation du manager puis contrôle par la comptabilité ou le service RH, ou validation seule) ; délai de soumission
   * en mois après celui de la dépense ; plafonds internes par catégorie (vides par défaut : aucune politique connue) ;
   * justificatif exigé au-delà d'un montant (0 : toujours) ; indemnités kilométriques à la puissance réelle au-delà de 7 CV
   * (part au-delà du barème plafonné réintégrable).
   */
  notesFraisActives: boolean;
  fraisCircuit: CircuitFrais;
  fraisDelaiSoumissionMois: number;
  fraisPlafonds: Partial<Record<CategorieFrais, number>>;
  fraisSeuilJustificatif: number;
  fraisIkCvReels: boolean;
  /** Conservation des notes de frais payées et de leurs justificatifs (10 ans, terme comptable), au-delà du dossier. */
  conservationFraisAns: number;
  // lot 11 — notes de frais, étape 2 : fichier d'écritures pour la comptabilité (shared/rules/frais-export.ts), valeurs
  // proposées à confirmer par la comptabilité.
  /** Comptes de charge réglés par catégorie (vide : compte proposé) ; jamais pour les frais médicaux (compte générique). */
  fraisComptes: Partial<Record<CategorieFrais, string>>;
  fraisCompteGenerique: string;
  fraisCompteTva: string;
  fraisCompteSalarie: string;
  fraisJournal: string;
  fraisGabarit: GabaritExportComptable;
}
/** Catégorie d'une formation pour l'évaluation à froid : type du catalogue, ou formation hors catalogue. */
export type CategorieEvaluee = FormationType | 'Hors catalogue';
/** Période de paie des jours rachetés d'un forfait jours : mois de la signature de l'avenant, ou clôture de l'année (décembre). */
export type EmissionJren = 'signature' | 'cloture';
/**
 * Avenant de renonciation à des jours de repos d'un forfait jours (t043, art. L3121-59) : année, jours rachetés, taux de
 * majoration (10 % au moins), signature et référence (texte libre du service RH). Il porte le plafond de l'année au
 * forfait plus les jours rachetés, dans la limite du réglage `forfaitJoursPlafond`. Jours rachetés transmis à la paie
 * (rubrique JREN, famille « rachats » du registre des éléments de lot) : lot qui les emporte (`lotId`), import confirmé
 * (`sage`), ou réglés hors fichier faute de rubrique active (`horsFichier`). Annulé avec un motif : gardé pour l'historique.
 */
export interface AvenantForfait {
  id: number; empId: number; annee: number; jours: number; taux: number; signeLe: ISODate; reference: string | null;
  creeLe: string; creePar: string;
  annuleLe: string | null; annulePar: string | null; annuleMotif: string | null;
  lotId: number | null; sage: boolean; horsFichier: boolean;
}
/**
 * Jours rachetés d'un avenant de renonciation dans un lot de paie (rubrique JREN, quantité en jours ; taux de majoration
 * en détail, le montant reste calculé par Sage), partis sur la période `periode`. `codeSage` null : rubrique désactivée,
 * l'avenant est réservé par le lot mais absent du fichier, à saisir dans Sage (réglé hors fichier à la confirmation).
 */
export interface ElementRachatPaie {
  avenant: number; empId: number; matricule: string; periode: string; rubrique: string; codeSage: string | null; quantite: number; taux: number; annee: number; signeLe: ISODate;
}
/** Ce que publie le flux d'agenda personnel (t036). */
export type ContenuAgenda = 'sessions' | 'entretiens' | 'absences' | 'deplacements';
/** Plafond des heures complémentaires du temps partiel : le dixième (art. L3123-28) ou le tiers avec un accord (art. L3123-20). */
export type PlafondComplementaires = 'dixieme' | 'tiers';

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
export type ProfilRh = 'aucun' | 'rh_admin' | 'rh_gestionnaire' | 'referent_hse' | 'paie' | 'lecture_seule'
  // lot 11 — notes de frais : profil restreint, contrôle des notes de frais seulement (droit « compta »)
  | 'comptabilite';
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
  lignes: {
    matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number>;
    /**
     * Régularisation d'une feuille rouverte (t131) : écart avec ce qui est déjà parti ; `remplace` : rubriques complètes
     * du salarié pour la période d'origine (« annule et remplace », quantités négatives refusées par l'import), une
     * quantité nulle y est gardée.
     */
    correctif?: boolean; remplace?: boolean;
  }[];
  /**
   * Rubriques de chaque feuille du lot (codes Sage, par période d'origine), figées à la génération : ce qui est parti pour
   * elle, que la réouverture garde (`ReouvertureFeuille.rubriques`). Absent avant le lot 5 (repris par la migration
   * lot5-paie-rubriques-par-feuille quand les lignes le permettent).
   */
  rubriquesFeuilles?: RubriquesFeuille[];
  /** Lot correctif : régularisation par écart (quantités négatives acceptées) ou en « annule et remplace ». */
  regularisation?: ModeRegularisation;
  /** Libellé de chaque code Sage du contenu, figé à la génération du lot (colonne facultative « libellé » du fichier). */
  libelles?: Record<string, string>;
  /** Absences du lot, absence par absence, mois et rubrique (shared/rules/absences-paie.ts) ; absent avant le lot 5. */
  absences?: ElementAbsencePaie[];
  /** Soldes de sortie du lot, salarié par salarié et rubrique (shared/rules/solde-sortie.ts) ; absent avant t128. */
  sorties?: ElementSortiePaie[];
  /** Déplacements du lot (t031, shared/rules/deplacements-paie.ts), `codeSage` null : à saisir dans Sage ; absent avant le lot 6. */
  deplacements?: ElementDeplacementPaie[];
  /** Jours rachetés d'un forfait jours (t043, rubrique JREN active) ; absent avant le lot 6 (étape 2). */
  rachats?: ElementRachatPaie[];
  /** Heures et périodes d'astreinte (t049, lot 7 ; AST_H, AST_PER), `codeSage` null : à saisir dans Sage. */
  astreintes?: ElementAstreintePaie[];
  // lot 11 — notes de frais
  /** Remboursements de notes de frais et avances (montants en euros), `codeSage` null : à saisir dans Sage. */
  frais?: ElementFraisPaie[];
  /**
   * Éléments calculés que le lot n'emporte pas, faute de rubrique active (soldes de sortie) : listés « à saisir dans Sage »
   * dans le résumé du lot et l'export des variables (server/src/elements-lot.ts). Les absences et déplacements sans code
   * Sage y sont ajoutés par le résumé (shared/rules/elements-lot.ts).
   */
  aSaisir?: ElementASaisir[];
}
/**
 * Quantité d'un déplacement dans un lot de paie (t031) : jours ou nuits de grand déplacement en France (GD_JOUR, GD_NUIT),
 * jours à l'étranger (ETR_JOUR, pays en détail), trajets aller ou retour (TRAJET), d'un séjour (`source` : mission sur un
 * chantier qualifié, ou déplacement à l'étranger) et d'un mois `mois`, partie sur la période `periode` (rappel quand
 * elle diffère). `codeSage` null : rubrique désactivée ou réglage « déplacements dans le fichier » décoché, à saisir
 * dans Sage. Négative : régularisation d'un séjour annulé ou raccourci après sa transmission.
 */
export interface ElementDeplacementPaie {
  source: 'voyage' | 'mission'; sourceId: number; empId: number; matricule: string; mois: string; periode: string;
  rubrique: string; codeSage: string | null; quantite: number; pays: string; du: ISODate; au: ISODate;
}
/**
 * Élément calculé que la paie saisit à la main dans Sage (rubrique désactivée ou à confirmer, réglage décoché) : famille,
 * salarié, période, rubrique interne (vide hors droit « paie » pour une absence : le code révèle la catégorie), quantité
 * et détail (jamais la nature d'une absence).
 */
export interface ElementASaisir { famille: 'absences' | 'sorties' | 'deplacements' | (string & {}); empId: number; periode: string; rubrique: string; quantite: number; detail: string }
/**
 * Déplacements en attente du fichier de paie (calculés par le serveur, qui voit missions et déplacements) : un élément
 * par salarié, période, rubrique et pays, `aSaisir` faute de rubrique active ou de réglage ; chantiers en France pas encore
 * qualifiés qui ont des missions. Service RH, paie et lecture seule.
 */
export interface DeplacementsPaieAttente {
  elements: { empId: number; periode: string; rubrique: string; pays: string; quantite: number; aSaisir: boolean; rappel: boolean }[];
  aQualifier: { chantier: string; nom: string; missions: number }[];
}
/**
 * Quantité d'un solde de sortie dans un lot de paie : rubrique interne de sortie (ICCP_J, RTT_SOLDE, RECUP_H, CET_LIQ) et
 * son code Sage figé, partie sur la période `periode` (mois de la sortie, ou période ouverte s'il est clos).
 */
export interface ElementSortiePaie {
  sortie: number; empId: number; matricule: string; periode: string; rubrique: string; codeSage: string; quantite: number; date: ISODate;
}
/**
 * Quantité d'une absence dans un lot de paie : jours (heures pour la récupération) d'un mois `mois`, partis sur la période
 * `periode` (rappel quand elle diffère, période close), sous la rubrique interne `rubrique` et son code Sage figé
 * (`codeSage` null : rubrique désactivée, laissée à la saisie dans Sage). Négative : régularisation d'une absence annulée,
 * raccourcie ou requalifiée après sa transmission. `du`, `au` : jours de l'absence dans ce mois.
 */
export interface ElementAbsencePaie {
  absence: number; empId: number; matricule: string; mois: string; periode: string;
  rubrique: string; codeSage: string | null; quantite: number; du: ISODate; au: ISODate;
}
/**
 * Absences en attente du fichier de paie, par période de destination (calculées par le serveur, qui lit les lots) :
 * nombre d'absences, salariés concernés, nombre de régularisations, mois clos repris en rappel, rubriques internes émises (vides hors
 * droit « paie » et service RH : le code révèle la catégorie). `ids`, `idsRegularisations` : identifiants des absences,
 * pour compter une fois une absence ventilée sur deux périodes de destination.
 */
export interface AbsencesPaieAttente {
  periode: string; absences: number; ids: number[]; empIds: number[]; regularisations: number; idsRegularisations: number[]; rappels: string[]; rubriques: string[];
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
/** Lot ordinaire, ou correctif : il porte la régularisation d'au moins une feuille rouverte après sa transmission. */
export type TypeLotPaie = 'normal' | 'correctif';
/** Régularisation d'une feuille transmise : écart sur la période ouverte, ou rubriques complètes de la période d'origine. */
export type ModeRegularisation = 'ecart' | 'remplace';
/** Rubriques d'une feuille (codes Sage), par période d'origine (AAAA-MM). */
export interface RubriquesFeuille {
  empId: number; week: ISODate; periodes: Record<string, Record<string, number>>;
  /**
   * Heures de nuit listées « à saisir dans Sage » pour la feuille (rubriques désactivées : codes internes HNUIT, MAJ_NUIT,
   * par période d'origine ; shared/rules/temps.ts, `nuitASaisirDeLaFeuille`). Absent : aucune, ou lot d'avant le lot 6.
   */
  aSaisir?: Record<string, Record<string, number>>;
}
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
  /** Absences du lot (identifiant, salarié), gardées après une annulation ; absent avant le lot 5. */
  absences?: { id: number; empId: number }[];
  /** Soldes de sortie du lot (identifiant du solde, salarié), gardés après une annulation ; absent avant t128. */
  sorties?: { id: number; empId: number }[];
  /** Séjours du lot (source, identifiant, salarié), gardés après une annulation ; absent avant le lot 6 (t031). */
  deplacements?: { source: 'voyage' | 'mission'; id: number; empId: number }[];
  /** Avenants de renonciation dont le lot emporte les jours rachetés (identifiant, salarié ; t043). */
  rachats?: { id: number; empId: number }[];
  /** Astreintes terminées dont le lot emporte les heures et la période (identifiant, salarié ; t049, lot 7). */
  astreintes?: { id: number; empId: number }[];
  // lot 11 — notes de frais
  /** Notes de frais remboursées et avances versées par le lot (identifiant, salarié ; `avance` : avance sur frais). */
  frais?: { id: number; empId: number; avance?: true }[];
  /**
   * Totaux du contenu figé : lignes du fichier, salariés, quantité par code Sage des heures ; `absences` : éléments
   * d'absence, salariés et quantité par code Sage (codes retirés hors droit « paie » : server/src/dataset.ts).
   */
  resume: {
    lignes: number; salaries: number; rubriques: Record<string, number>; absences?: { elements: number; salaries: number; rubriques: Record<string, number> }; sorties?: { elements: number; salaries: number };
    /** Déplacements (t031) : éléments et salariés. */
    deplacements?: { elements: number; salaries: number };
    /** Jours rachetés d'un forfait jours (t043) : éléments et salariés. */
    rachats?: { elements: number; salaries: number };
    /** Heures et périodes d'astreinte (t049) : éléments et salariés. */
    astreintes?: { elements: number; salaries: number };
    // lot 11 — notes de frais
    /** Remboursements de frais et avances : éléments, salariés et montant total (euros). */
    frais?: { elements: number; salaries: number; montant: number };
    /** Éléments à saisir à la main dans Sage, nominatifs (shared/rules/elements-lot.ts) ; absent : aucun. */
    aSaisir?: ElementASaisir[];
  };
  /** Salariés partis sous leur matricule Cursus, faute de matricule de paie (simulation seulement). */
  sansMatricule: number[];
  telechargeLe: string | null; telechargePar: string | null; telechargements: number;
  /** Accusé : confirmation de l'import dans Sage (date, auteur, référence d'import facultative) ; « SIM-… » en simulation. */
  confirmeLe: string | null; confirmePar: string | null; reference: string | null;
  annuleLe: string | null; annulePar: string | null;
  /** Lot repris des transmissions d'avant les lots (migration lot4-paie-lots-historiques) : contenu inconnu. */
  historique: boolean;
  /** « correctif » : régularisation de feuilles rouvertes (`correctifs`) ; absent avant le lot 5 : lot ordinaire. */
  type?: TypeLotPaie;
  correctifs?: { empId: number; week: ISODate }[];
}
/**
 * Colonnes du fichier d'import Sage, dans l'ordre réglé par la paie : matricule, période, rubrique et quantité toujours ;
 * facultatives, absentes par défaut : code du dossier de paie (SAGE_DOSSIER), libellé de la rubrique, premier et dernier
 * jour de la période.
 */
export type ColonneFichierPaie = 'matricule' | 'periode' | 'rubrique' | 'quantite' | 'dossier' | 'libelle' | 'debut' | 'fin'
  // lot 11 — notes de frais : montant en euros (remboursements de frais), vide pour les autres éléments
  | 'montant';
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
  /**
   * Quantités négatives acceptées par l'import (oui par défaut) : la correction d'une feuille déjà transmise part en
   * écart, positif ou négatif ; sinon en « annule et remplace » (rubriques complètes de la période d'origine). Lu à la
   * génération du lot.
   */
  negatifs?: boolean;
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
  /** Jours de fractionnement décidés (t046) : service RH, paie et lecture seule (tous), intéressé (les siens) ; absent ailleurs. */
  fractionnements?: Fractionnement[];
  /** Acquisition des CP calculée par le serveur, par salarié et par période : profil paie seulement (absent ailleurs). */
  acquisitionsCp?: AcquisitionCpCalculee[];
  /** Soldes de sortie photographiés (t128) : service RH, paie et lecture seule (absent ou vide ailleurs). */
  soldesSortie?: SoldeSortie[];
  /**
   * Historique des contrats (t074) : service RH, paie et lecture seule (tous) ; manager (son équipe) et intéressé sans la
   * référence ni l'auteur ; absent ailleurs (server/src/dataset.ts). Absent ou vide : régime de la fiche seul.
   */
  contratsHistorique?: ContratHistorique[];
  /**
   * Avenants de renonciation d'un forfait jours (t043) : service RH (tous), paie et lecture seule (sans le motif d'une
   * annulation) ; manager (son équipe : année et jours seulement) et intéressé ; absent ailleurs (server/src/dataset.ts).
   */
  avenantsForfait?: AvenantForfait[];
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
  /** Absences en attente du fichier de paie par période : service RH, paie et lecture seule (sans rubriques) ; vide ailleurs. */
  absencesPaie?: AbsencesPaieAttente[];
  /** Déplacements en attente du fichier de paie (t031) : service RH, paie et lecture seule ; absent ailleurs. */
  deplacementsPaie?: DeplacementsPaieAttente | null;
  /** Adresses de la messagerie et relevés transmis aux agences d'intérim : service RH seulement (null et vide ailleurs). */
  messagerie: Messagerie | null;
  releves: ReleveInterim[];
  /** Lots importés à la mise en service (reprise depuis Lucca) : service RH seulement (vide ailleurs). */
  reprises: LotReprise[];
  /** Dérogations au repos dominical par équipe : la référence de l'accord n'est transmise qu'au service RH. */
  derogationsDominicales?: DerogationDominicale[];
  /**
   * Jours fériés réglés par année (shared/rules/feries.ts) : transmis à tous les espaces, qui en ont besoin pour décompter
   * les congés et les heures ; le motif d'une modification n'est transmis qu'au service RH. Absent : calendrier légal.
   */
  calendrierFeries?: CalendrierFeries;
  /** Mandats au CSE : service RH (tous) et l'élu (les siens) ; vide ailleurs (le manager ne voit que la ligne de la feuille). */
  mandats?: Mandat[];
  /**
   * Effectif du site retenu pour les heures de délégation (shared/rules/delegation.ts, `effectifSite` calculé par le serveur
   * sur toutes les fiches) : service RH, et l'élu avec ses mandats ; null ailleurs. Un nombre, aucune liste nominative.
   */
  effectifCse?: number | null;
  /**
   * Pièces justificatives jointes (description, jamais le contenu, lu par GET /api/pieces/:id) : service RH (toutes),
   * référent HSE (certifications et habilitations), manager (certifications et habilitations de son équipe), salarié (les
   * siennes) ; aucune pour la paie et la lecture seule (server/src/pieces.ts, `piecesVisibles`).
   */
  pieces?: Piece[];
  /**
   * Couverture minimale des équipes (t067), calculée par le serveur sur l'instantané complet (server/src/dataset.ts) :
   * toutes les équipes pour le service RH, le référent HSE et la lecture seule (le référent HSE sans le nom d'un membre
   * absent), les équipes encadrées pour le manager ; rien ailleurs. Absente : calcul sur l'instantané (tests, outils).
   */
  couverture?: EtatCouverture[];
  /**
   * Consultation N+2 (t136, réglage `consultationN2`) : salariés des équipes descendantes transmis au manager en lecture
   * seule, avec les filtres de sa vue et sans aptitude détaillée ; ni entretiens, ni demandes. Absent ou vide ailleurs.
   */
  lectureSeule?: number[];
  /**
   * Formations suivies (t116) : service RH (toutes, annulées comprises) ; référent HSE et lecture seule (en vigueur, sans
   * motif ni auteur) ; manager (son équipe) et intéressé de même ; rien pour la paie (server/src/dataset.ts).
   */
  formationsSuivies?: FormationSuivie[];
  /** Délivrances des titres d'habilitation (t115) : mêmes vues que les habilitations, sans l'auteur hors du service RH. */
  habDelivrances?: HabDelivrance[];
  /**
   * Délégations des validations (t135) : toutes pour le service RH et la lecture seule ; pour le manager et le collaborateur,
   * celles qu'il a données ou reçues, celles des managers dont il est le N+1 et celle de son propre valideur. Absent ailleurs.
   */
  delegations?: DelegationValidation[];
  /**
   * Salariés dont la personne connectée (espace manager) décide aujourd'hui par délégation, avec le manager remplacé et
   * les périmètres reçus (`deleguesA`, calculé par le serveur). Absent ou vide ailleurs.
   */
  delegues?: { empId: number; managerId: number; perimetre: PerimetreDelegation[] }[];
  /**
   * Suppléants possibles du manager connecté hors de l'espace RH (t135, dialogue de délégation de Mon espace) : salariés
   * présents, hors intérim et hors lui-même, réduits à l'annuaire (nom, équipe, poste) ; sa présence sur la période est
   * contrôlée par le serveur. Absent ailleurs (service RH : `employes`).
   */
  suppleantsPossibles?: Personne[];
  /**
   * Dossiers des salariés sortis dont une durée de conservation est échue (t016, server/src/conservation.ts) : calculés par
   * le serveur pour l'administrateur RH seulement, réglage `conservationActive` et décision du DPO renseignés ; absent ailleurs.
   */
  conservation?: DossierEchu[];
  /** Abonnement à l'agenda personnel (t036) : jeton en vigueur de la personne connectée (date de création), sinon null. */
  agendaJeton?: { creeLe: string } | null;
  /**
   * Astreintes (t049, lot 7) et interventions déclarées : toutes pour le service RH, la paie et la lecture seule (sans les
   * motifs) ; celles du périmètre pour le manager (motifs de son équipe directe seulement) et les siennes pour le salarié ;
   * rien pour le référent HSE (server/src/dataset.ts). Absent : aucune.
   */
  astreintes?: Astreinte[];
  interventionsAstreinte?: InterventionAstreinte[];
  /**
   * Compte professionnel de prévention (t052, shared/rules/c2p.ts) : synthèse de l'année en cours et de la précédente,
   * calculée par le serveur sur toutes les feuilles validées (server/src/dataset.ts) ; service RH, référent HSE et lecture
   * seule. Absente ailleurs (manager, collaborateur, paie).
   */
  c2p?: SyntheseC2p[];
  /**
   * Listes d'attente des sessions complètes (lot 7, t120) : toutes pour le service RH et le référent HSE, celles de son
   * périmètre pour le manager, les siennes pour le collaborateur ; auteurs retirés hors du service RH (server/src/dataset.ts).
   */
  attentesSession?: AttenteSession[];
  /**
   * Passeport de prévention (lot 7, t066) : lignes déjà déclarées sur la plateforme, avec leur date ; toutes pour le service
   * RH, sans l'auteur pour le référent HSE et la lecture seule ; rien pour le manager, le collaborateur et la paie.
   */
  declarationsPasseport?: DeclarationPasseport[];
  /**
   * Évaluations des formations (lot 7, t121) : toutes pour le service RH ; pour le manager, celles qu'il donne comme manager
   * sur son équipe directe ; pour le salarié, les siennes (commentaire compris) ; rien pour les profils restreints, qui
   * reçoivent les indicateurs agrégés (`indicateursEvaluation`) ; server/src/dataset.ts.
   */
  evaluationsFormation?: EvaluationFormation[];
  /**
   * Indicateurs des évaluations par exercice, calculés par le serveur sur toutes les données (shared/rules/
   * evaluation-formation.ts) : référent HSE et lecture seule, qui n'ont pas les évaluations nominatives ; un regroupement de
   * moins de 3 réponses n'a ni moyenne ni taux (`masque`). Absent ailleurs : calcul sur l'instantané (service RH).
   */
  indicateursEvaluation?: IndicateursEvaluation[];
  // lot 11 — organigramme
  /**
   * Salariés de l'annuaire présents aujourd'hui (entrée passée, fin à venir) et non anonymisés, calculés sur toutes les
   * fiches (shared/rules/organigramme.ts, `presentsDe`) : l'organigramme ne montre qu'eux, sans transmettre les dates
   * d'entrée et de sortie. Vide pour un espace auquel le réglage `organigrammeOuvert` ferme l'organigramme.
   */
  presentsOrganigramme?: number[];
  /**
   * lot 11 — indicateurs : arrêtés annuels des indicateurs sociaux (BDESE), sans leurs agrégats (lus par
   * GET /api/indicateurs?arrete=) ; service RH (tous) et lecture seule (sans auteurs ni motif d'annulation) ; vide ailleurs.
   */
  indicateursArretes?: ArreteIndicateurs[];
  // lot 11 — dossiers OPCO
  /**
   * Dossiers de prise en charge OPCO (lot 11, chantier C4, shared/rules/opco.ts) et leurs versements : complets pour le
   * service RH ; sans motif (refus, correction, suppression, annulation d'un versement) pour la lecture seule ; rien ailleurs
   * (server/src/dataset.ts). Absent : aucun.
   */
  dossiersOpco?: DossierOpco[];
  versementsOpco?: VersementOpco[];
  // lot 11 — notes de frais (server/src/dataset.ts, filtre propre aux frais)
  /**
   * Notes de frais et leurs lignes : toutes pour le service RH et la comptabilité ; pour le manager, celles de son équipe
   * directe et des salariés dont il valide les frais par délégation (jamais une note médicale d'un autre) ; les siennes pour
   * le salarié ; pour la paie, les notes contrôlées et payées sans les lignes ; rien pour le référent HSE et la lecture seule.
   */
  notesFrais?: NoteFrais[];
  lignesFrais?: LigneFrais[];
  /** Véhicules personnels déclarés (indemnités kilométriques) : mêmes vues que les notes. */
  vehiculesPerso?: VehiculePerso[];
  /** Avances sur frais : mêmes vues que les notes (la paie : celles validées ou versées). */
  avancesFrais?: AvanceFrais[];
}

/**
 * lot 11 — indicateurs : arrêté annuel des indicateurs sociaux (table `indicateurs_arretes`, jamais supprimée) : année,
 * périmètre (`global` tant qu'un seul employeur), période, version des règles, seuil d'anonymat appliqué, date et auteur
 * de l'arrêté, mise à disposition du CSE, annulation (motif : texte du service RH, jamais au journal ni hors du service
 * RH). Les agrégats figés (`donnees`, déjà masqués) ne font pas partie de l'instantané.
 */
export interface ArreteIndicateurs {
  id: number; annee: number; perimetre: string; du: ISODate; au: ISODate; reglesVersion: string; seuil: number;
  arreteLe: string; arretePar: string | null;
  cseLe: ISODate | null; csePar: string | null;
  annuleLe: string | null; annulePar: string | null; annuleMotif: string | null;
}

/** Catégorie de données d'un dossier, avec sa durée de conservation après la sortie (shared/rules/conservation.ts). */
export type CategorieConservation = 'dossier' | 'temps' | 'paie' | 'sante' | 'passeport' | 'titreSejour' | 'entretiens' | 'formations'
  // lot 11 — notes de frais : notes payées et justificatifs, gardés jusqu'au terme comptable
  | 'frais';
/**
 * Dossier proposé à l'effacement : catégories échues qui ont encore des données (`categories`), et `dossier` vrai quand la
 * durée du dossier est échue (anonymisation complète). Aucun nom : l'écran le lit dans la fiche.
 */
export interface DossierEchu { empId: number; fin: ISODate; categories: CategorieConservation[]; dossier: boolean; elements: number }

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

// — Pièces justificatives (t133, shared/rules/pieces.ts) —
/** Stockage des pièces justificatives (réglage `piecesStockage`). */
export type StockagePieces = 'desactive' | 'local' | 'ged';
/** Objet auquel une pièce est jointe : absence, certification, titre d'habilitation, document déclaré, déplacement. */
export type ObjetPiece = 'absence' | 'certification' | 'habTitre' | 'declaration' | 'voyage'
  // lot 11 — dossiers OPCO : pièce d'un dossier de prise en charge, sans salarié (`empId` null).
  | 'dossierOpco'
  // lot 11 — notes de frais : justificatif d'une ligne, d'une dépense médicale (santé), carte grise et assurance du véhicule
  | 'ligneFrais' | 'ligneFraisSante' | 'vehiculePerso';
/** Type de fichier accepté (contrôlé sur le contenu, pas seulement sur l'extension). */
export type TypePiece = 'application/pdf' | 'image/jpeg' | 'image/png';
/**
 * Pièce justificative jointe à un objet du dossier d'un salarié. Le fichier est stocké sous un nom aléatoire (`fichier`,
 * jamais transmis au navigateur) avec son empreinte SHA-256 ; `nom` est celui du fichier envoyé (il peut nommer une
 * donnée de santé : jamais recopié au journal). Une pièce retirée garde sa description, son fichier est effacé.
 */
export interface Piece {
  id: number;
  /** Salarié du dossier ; null pour la pièce d'un dossier OPCO (lot 11), qui n'est pas nominative. */
  empId: number | null;
  objet: ObjetPiece;
  objetId: number;
  nom: string;
  type: TypePiece;
  taille: number;
  /** Empreinte SHA-256 du contenu (hexadécimal) : service RH seulement. */
  empreinte?: string | null;
  deposeLe: string;
  deposePar: string;
  /** Fin de conservation ; null : celle de l'objet qu'elle justifie (durées de conservation, chantier 7 étape 2). */
  conserverJusquau: ISODate | null;
  retireeLe: string | null;
  retireePar: string | null;
  /** Nature de la pièce d'un dossier OPCO (lot 11 : facture, accord, convention…) ; absente pour les autres objets. */
  nature?: NaturePiece | null;
}

// — Compte professionnel de prévention (t052, shared/rules/c2p.ts) —
/**
 * Facteurs d'exposition du C2P que Cursus ne mesure pas, cochés sur le poste (Référentiels → Postes) : travail répétitif,
 * activités en milieu hyperbare, températures extrêmes, bruit (art. L4163-1 et D4163-2).
 */
export type FacteurPoste = 'repetitif' | 'hyperbare' | 'temperatures' | 'bruit';
/** Les six facteurs : nuits comptées d'après les horaires de poste (travail de nuit, équipes alternantes) et facteurs du poste. */
export type FacteurC2p = 'nuit' | 'alternant' | FacteurPoste;
/**
 * Exposition d'un salarié sur une année civile : période du contrat dans l'année, nuits comptées (au moins 1 h de travail
 * entre 0 h et 5 h, d'après les horaires figés des feuilles validées), seuils au prorata, facteurs du poste occupé et
 * facteurs exposés. Aucune donnée de santé ; identifiants, dates et nombres seulement.
 */
export interface LigneC2p {
  empId: number;
  /** Période du contrat dans l'année (bornée par l'entrée et la fin du contrat). */
  du: ISODate; au: ISODate;
  /** Part de l'année couverte par cette période (1 : année complète), appliquée aux seuils. */
  prorata: number;
  /**
   * Qui déclare : l'employeur, l'entreprise de travail temporaire (intérimaire : informations à lui transmettre), ou
   * personne (contrat de moins d'un mois, non déclaré).
   */
  declarant: 'employeur' | 'ett' | null;
  /** Nuits comptées hors équipes alternantes (horaires à qualifier compris) et nuits en équipes successives alternantes. */
  nuits: number; nuitsAlternantes: number;
  /** Parmi `nuits`, celles faites sous un horaire pas encore qualifié (alternant ou non). */
  nuitsAQualifier: number;
  /** Seuils au prorata de la période (120 et 50 nuits pour une année complète). */
  seuilNuit: number; seuilAlternant: number;
  /** Facteurs cochés sur le poste occupé. */
  facteursPoste: FacteurPoste[];
  /** Facteurs exposés au-delà du seuil (nuits) ou cochés sur le poste. */
  expositions: FacteurC2p[];
  /** Semaines validées avec des heures un jour sans horaire figé (aucune nuit n'y est comptée). */
  semainesSansHoraire: number;
  /** Feuilles de l'année pas encore validées : leurs nuits ne comptent qu'à la validation. */
  feuillesNonValidees: number;
}
/** Synthèse annuelle du C2P (écran Prévention) : lignes par salarié, horaires de nuit à qualifier, date du calcul. */
export interface SyntheseC2p { annee: number; arrete: ISODate; lignes: LigneC2p[]; horairesAQualifier: string[] }

// — Passeport de prévention (lot 7, t066, shared/rules/passeport-prevention.ts) —
/**
 * Ligne déclarée sur la plateforme du Passeport de prévention : certification (`certId`) ou formation suivie (`suivieId`),
 * l'une ou l'autre, jour de la déclaration et auteur de la marque. Une ligne déclarée n'est plus proposée à l'export.
 */
export interface DeclarationPasseport {
  id: number; empId: number; certId: number | null; suivieId: number | null; declareLe: ISODate;
  le: string; auteur: string | null; auteurId: number | null;
}
/** Colonnes de l'export du Passeport de prévention (gabarit réglable dans Paramètres). */
export type ColonnePasseport = 'nom' | 'prenom' | 'naissance' | 'matricule' | 'nir' | 'code' | 'intitule' | 'organisme' | 'du' | 'au' | 'duree' | 'resultat';
/**
 * Ligne à déclarer : formation santé-sécurité (marquée au catalogue) acquise par un salarié, certification obtenue ou
 * formation suivie (non annulée). Identité lue sur la fiche au moment du calcul ; `declareLe` : déjà déclarée ce jour-là.
 */
export interface LignePasseport {
  cle: string; origine: 'certification' | 'suivie'; certId: number | null; suivieId: number | null; empId: number;
  formation: string; intitule: string; organisme: string; du: ISODate; au: ISODate;
  /** Heures ; null : durée inconnue (ni horaires de session, ni durée saisie ou du catalogue). */
  duree: number | null;
  resultat: string;
  /** Intérimaire : la déclaration revient en principe à l'entreprise de travail temporaire (à vérifier avec elle). */
  interim: boolean;
  declareLe: ISODate | null;
}

// lot 11 — organigramme
/** Entité juridique (shared/rules/entites.ts) : société (SIREN), ou établissement (SIRET) d'une société. */
export type TypeEntite = 'societe' | 'etablissement';
/** Tenue de l'entité : `local` (service RH, en attendant Matrix), `matrix` (copie du contrat pub_entites demandé). */
export type SourceEntite = 'local' | 'matrix';
/**
 * Entité au-dessus des équipes : code stable (jamais modifié), nom (raison sociale ou libellé de l'établissement), type,
 * société parente d'un établissement, SIREN (société), SIRET, IDCC (convention collective), site de rattachement, ordre
 * d'affichage, ouverture (`actif`, `fermeLe` : jamais supprimée) et source. Aucune donnée personnelle.
 */
export interface Entite {
  code: string; nom: string; type: TypeEntite; parente: string | null; siren: string | null; siret: string | null; idcc: string | null;
  siteCode: string | null; ordre: number; actif: boolean; fermeLe: ISODate | null; source: SourceEntite;
}
/** Site de rattachement (D14) : cache de matrix.pub_sites, tenu à la main tant que Matrix ne le fournit pas. */
export interface Site { code: string; libelle: string; actif: boolean; ordre: number }
/** Réglage `organigrammeOuvert` : espaces auxquels l'organigramme est ouvert (l'espace RH l'a toujours). */
export type OrganigrammeOuvert = 'rh' | 'managers' | 'tous';
// lot 11 — dossiers OPCO (chantier C4, shared/rules/opco.ts)
/** Opérateurs de compétences agréés (onze depuis 2019) ; OPCO 2i pour les industries chimiques (IDCC 0044). */
export type CodeOpco = 'opco2i' | 'atlas' | 'akto' | 'afdas' | 'constructys' | 'ocapiat' | 'opcoep' | 'mobilites' | 'sante' | 'uniformation' | 'commerce';
/** Dispositif de prise en charge. */
export type DispositifOpco = 'plan' | 'pro_a' | 'contrat_pro' | 'apprentissage' | 'tutorat' | 'versement_volontaire' | 'autre';
/** État d'un dossier : à déposer → déposé → accordé ou refusé → facturé → remboursé → soldé ; abandonné à tout moment avant. */
export type StatutOpco = 'a_deposer' | 'depose' | 'accorde' | 'refuse' | 'facture' | 'rembourse' | 'solde' | 'abandonne';
/** Motif codé d'un refus de l'OPCO (jamais de texte libre). */
export type MotifRefusOpco = 'hors_criteres' | 'delai_depasse' | 'budget_epuise' | 'organisme_non_certifie' | 'autre';
/** Motif codé d'un abandon du dossier. */
export type MotifAbandonOpco = 'formation_annulee' | 'non_eligible' | 'hors_delai' | 'renonciation' | 'autre';
/** Écart accordé − reçu figé au solde : aucun, perte (accord perdu), prise en charge partielle. */
export type EcartSoldeOpco = 'aucun' | 'perte' | 'partiel';
/** Destinataire d'un versement : l'entreprise (remboursement), ou l'organisme de formation (subrogation). */
export type DestinataireVersementOpco = 'entreprise' | 'organisme';
/** Nature d'une pièce d'un dossier OPCO (colonne `pieces.nature`). */
export type NaturePiece = 'demande' | 'accord' | 'convention' | 'programme' | 'convocation' | 'emargement' | 'certificat_realisation' | 'facture' | 'avis_paiement' | 'autre';
/**
 * Dossier de prise en charge par l'OPCO, rattaché à une action du plan de formation (`planActionId`) ; `empId` est réservé
 * aux dossiers d'alternance et Pro-A (plus tard) : null aujourd'hui, dossier non nominatif. Montants en euros, dates
 * « AAAA-MM-JJ ». Les motifs (`refusMotif` codé, `corrigeMotif`, `annuleMotif` : textes du service RH) ne sont transmis
 * qu'au service RH. Supprimé (`annuleLe`, saisie erronée) : gardé en base, hors de l'instantané.
 */
export interface DossierOpco {
  id: number; planActionId: number | null; empId: number | null; exercice: number;
  opco: CodeOpco; dispositif: DispositifOpco; statut: StatutOpco;
  /** Numéro du dossier chez l'OPCO (identifiant administratif). */
  reference: string | null;
  /** Dates prévues de la formation et heures. */
  du: ISODate | null; au: ISODate | null; heures: number | null; effectif: number | null;
  /** Montant demandé : coûts pédagogiques et, si le dispositif le prévoit, frais annexes ou rémunération. */
  montantDemande: number | null; montantDemandeAnnexes: number | null;
  /** Paiement direct de l'organisme par l'OPCO (subrogation) : rien n'est à récupérer par l'entreprise. */
  subrogation: boolean;
  /** Organisme de formation, saisi sur le dossier en attendant un référentiel : SIRET, déclaration d'activité, Qualiopi. */
  organismeSiret: string | null; organismeNda: string | null; organismeQualiopi: boolean;
  deposeLe: ISODate | null;
  accordLe: ISODate | null; montantAccorde: number | null; accordReference: string | null; plafondHoraire: number | null;
  refusLe: ISODate | null; refusMotif: MotifRefusOpco | null;
  /** Justificatifs envoyés (demande de remboursement) : date et montant facturé. */
  factureLe: ISODate | null; montantFacture: number | null;
  /** Solde : écart accordé − reçu figé et qualifié. */
  soldeLe: ISODate | null; soldeEcart: number | null; soldeNature: EcartSoldeOpco | null;
  abandonLe: ISODate | null; abandonMotif: MotifAbandonOpco | null;
  creeLe: string; creePar: string;
  corrigeLe?: ISODate | null; corrigePar?: string | null; corrigeMotif?: string | null;
  annuleLe?: ISODate | null; annulePar?: string | null; annuleMotif?: string | null;
}
/** Versement de l'OPCO (acompte, solde) ; annulé avec un motif quand il a été saisi par erreur (hors des sommes). */
export interface VersementOpco {
  id: number; dossierId: number; le: ISODate; montant: number; destinataire: DestinataireVersementOpco; reference: string | null;
  saisiLe: string; saisiPar: string;
  annuleLe?: string | null; annulePar?: string | null; annuleMotif?: string | null;
}
// lot 11 — notes de frais (shared/rules/frais*.ts, server/src/actions/frais.ts)
/**
 * Catégorie d'une dépense. `ik` : indemnités kilométriques (barème) ; `forfait` : allocation forfaitaire (repas, grand
 * déplacement, étranger), limite d'exonération par année ; `medical` : frais médicaux en mission (vaccin, pharmacie,
 * consultation), donnée de santé, dans une note séparée qui ne passe jamais par le manager.
 */
export type CategorieFrais = 'repas' | 'repas_affaires' | 'hotel' | 'train' | 'avion' | 'taxi' | 'transport' | 'carburant' | 'peage' | 'parking' | 'location'
  | 'ik' | 'forfait' | 'divers' | 'medical';
/**
 * Statut d'une note : brouillon → soumise → validée (manager) → contrôlée (comptabilité ou service RH) → en paiement (lot de
 * paie) → payée (import confirmé) ; à corriger (renvoyée) et annulée. Une note médicale va de soumise à validée sans manager.
 */
export type StatutNoteFrais = 'brouillon' | 'soumise' | 'a_corriger' | 'validee' | 'controlee' | 'en_paiement' | 'payee' | 'annulee';
/** Circuit : validation du manager puis contrôle (défaut), ou validation du manager seule (contrôle fait d'office). */
export type CircuitFrais = 'manager_controle' | 'manager';
/**
 * Note de frais d'un salarié : mois des dépenses, rattachement facultatif (déplacement, mission Keystone, code de projet ou
 * de chantier), circuit daté. Ses totaux et ses alertes sont calculés, jamais stockés (shared/rules/frais.ts).
 */
export interface NoteFrais {
  id: number; empId: number;
  /** Mois des dépenses (AAAA-MM). */
  periode: string;
  voyageId: number | null; missionId: number | null; projet: string | null;
  /** Note de frais médicaux : séparée, contrôlée directement par la comptabilité ou le service RH, jamais par le manager. */
  medicale: boolean;
  statut: StatutNoteFrais;
  creeLe: string; creePar: string;
  soumiseLe: string | null;
  valideeLe: string | null; valideePar: string | null;
  controleeLe: string | null; controleePar: string | null;
  /** Renvoi pour correction : date, auteur, motif (texte libre, jamais recopié au journal). */
  renvoyeeLe: string | null; renvoyeePar: string | null; renvoiMotif: string | null;
  /** Lot de paie qui rembourse la note ; jour de la confirmation de son import (payée). */
  lotId: number | null; payeeLe: ISODate | null;
  annuleeLe: string | null; annuleePar: string | null; annuleMotif: string | null;
}
/**
 * Ligne de dépense : date, catégorie, montant TTC dans la devise de la dépense et en euros (taux saisi, ou montant débité
 * saisi), TVA, commerçant ; indemnité kilométrique (km, véhicule, trajet) ou allocation forfaitaire (code du forfait) ;
 * invités d'un repas d'affaires et motif d'un dépassement (textes libres, jamais au journal) ; ligne sans justificatif,
 * avec attestation sur l'honneur. `montantRetenu` : montant ramené au plafond de la politique interne (null : demandé).
 * Refusée au contrôle : hors des totaux, avec son motif.
 */
export interface LigneFrais {
  id: number; noteId: number; empId: number; date: ISODate; categorie: CategorieFrais;
  montant: number; devise: string; taux: number | null; montantEur: number;
  tvaTaux: number | null; tvaMontant: number | null;
  commercant: string | null;
  forfait: string | null;
  km: number | null; vehiculeId: number | null; depart: string | null; arrivee: string | null;
  invites: string | null; motifDepassement: string | null;
  sansJustificatif: boolean; attestation: boolean;
  montantRetenu: number | null;
  refuseeLe: string | null; refusMotif: string | null;
}
export type TypeVehicule = 'voiture' | 'deux_roues' | 'moto';
/** Véhicule personnel déclaré par le salarié pour ses indemnités kilométriques : type, puissance fiscale, électrique, période. */
export interface VehiculePerso {
  id: number; empId: number; type: TypeVehicule; cv: number; electrique: boolean; du: ISODate; au: ISODate | null;
  creeLe: string; creePar: string;
}
/**
 * Tranche du barème kilométrique d'une année (BOFiP BOI-BAREME-000001) : type de véhicule, puissance fiscale (bornes
 * comprises ; null : sans borne), distance annuelle (bornes comprises ; `kmMax` null : au-delà), formule d × a + b.
 */
export interface BaremeKm {
  id: number; annee: number; type: TypeVehicule; cvMin: number; cvMax: number | null; kmMin: number; kmMax: number | null; a: number; b: number;
  saisiLe: string; saisiPar: string;
}
/** Code d'un forfait : repas, panier, grand déplacement en métropole, étranger (pays : référentiel des destinations). */
export type CodeForfaitFrais = 'repas_restaurant' | 'repas_hors_locaux' | 'panier' | 'gd_repas' | 'gd_logement_idf' | 'gd_logement_autres' | 'etranger';
/** Limite d'exonération d'une allocation forfaitaire pour une année (montants URSSAF saisis par le service RH). */
export interface ForfaitFrais { id: number; annee: number; code: CodeForfaitFrais; pays: string | null; montant: number; saisiLe: string; saisiPar: string }
/** Taux d'une devise pour un mois : 1 unité de la devise vaut `taux` euros. */
export interface TauxDevise { id: number; devise: string; mois: string; taux: number; saisiLe: string; saisiPar: string }
export type StatutAvanceFrais = 'demandee' | 'validee' | 'en_paiement' | 'versee' | 'refusee' | 'annulee';
/**
 * Avance sur frais : montant, déplacement ou mission qu'elle couvre, circuit (validée par le manager ou le service RH,
 * versée par la paie). Son solde est imputé sur les notes du même séjour (calculé, jamais stocké).
 */
export interface AvanceFrais {
  id: number; empId: number; montant: number; voyageId: number | null; missionId: number | null; statut: StatutAvanceFrais;
  demandeLe: string; valideeLe: string | null; valideePar: string | null; lotId: number | null; verseeLe: ISODate | null;
  annuleeLe: string | null; annuleePar: string | null; refusMotif: string | null;
}
/**
 * Remboursement dans un lot de paie (montant en euros, quantité 1) : note de frais (`note`) ou avance versée (`avance`),
 * rubrique (FRAIS_REMB, FRAIS_IK, FRAIS_FORFAIT, FRAIS_REINT, FRAIS_AVANCE, FRAIS_AVANCE_DED), période ; `codeSage` null :
 * rubrique désactivée, à saisir dans Sage. Le détail ne nomme jamais la nature d'une dépense médicale.
 */
/**
 * Export comptable des notes de frais (table exportsFrais, hors de l'instantané : lu par sa route, server/src/frais-exports.ts) :
 * notes emportées, écritures figées (shared/rules/frais-export.ts), téléchargements ; annulé, ses notes redeviennent à exporter.
 */
export interface ExportFraisEnregistre {
  id: number; type: 'compta' | 'sepa'; cle: string; creation: string; auteur: string; notes: number[] | null;
  contenu: { lignes: LigneEcriture[]; ecritures: number; debit: number; credit: number } | null;
  telechargements: number; telechargeLe: string | null; telechargePar: string | null; annuleLe: string | null;
}
/** Export comptable tel que la route le montre à l'écran (sans les écritures). */
export type ExportFraisVue = Omit<ExportFraisEnregistre, 'contenu' | 'cle'> & { ecritures: number; montant: number };
export interface ElementFraisPaie {
  note: number | null; avance: number | null; empId: number; matricule: string; periode: string; rubrique: string; codeSage: string | null;
  quantite: number; montant: number;
}
