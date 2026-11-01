// Accès aux données : schéma déclaratif, requêtes génériques asynchrones, adaptateur SQLite (module node:sqlite) et choix
// du moteur (openDb) ; l'adaptateur PostgreSQL est dans server/src/db-pg.ts. Les champs sont en camelCase côté code et
// en snake_case dans la base.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fichierBase } from './chemins.ts';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

export type ColType = 'text' | 'int' | 'real' | 'bool' | 'json';
export interface TableDef { pk: string; auto?: boolean; cols: Record<string, ColType>; unique?: string[][] }

export const TABLES = {
  // Référentiels administrés par le service RH (server/src/actions/referentiels.ts) : `archive`, date d'archivage (null :
  // en vigueur) ; on archive au lieu de supprimer. `sir` : habilitation ou poste qui place en suivi individuel renforcé.
  // `dureeHeures` : durée en heures (t122, shared/rules/heures-formation.ts), facultative ; `modele` d'une habilitation : modèle
  // du titre imprimé (t115, client/src/titre-habilitation.ts).
  // `passeportPrevention` : formation santé-sécurité à déclarer au Passeport de prévention (lot 7, t066), amorcée par la
  // migration lot7-prevention-passeport.
  formations: { pk: 'id', cols: { id: 'text', nom: 'text', court: 'text', type: 'text', validite: 'int', duree: 'text', organisme: 'text', cout: 'real', validation: 'text', archive: 'text', dureeHeures: 'real', passeportPrevention: 'bool' } },
  habilitations: { pk: 'id', cols: { id: 'text', nom: 'text', detail: 'text', prereqs: 'json', medical: 'bool', validite: 'int', signataire: 'text', archive: 'text', sir: 'bool', modele: 'text' } },
  // `secu` : formalité de sécurité sociale du détachement (null : déduite du code pays, shared/constants.ts).
  destinations: { pk: 'code', cols: { code: 'text', pays: 'text', visa: 'text', visaSub: 'text', oblig: 'json', rec: 'json', passMois: 'int', secu: 'text', archive: 'text',
    // Vigilance France Diplomatie et jour de sa vérification (t068, shared/rules/vigilance.ts) : saisies par le service RH.
    vigilance: 'text', vigilanceLe: 'text' } },
  // Postes et formations ou habilitations exigées (shared/rules/exigences.ts) ; `exigences` d'une équipe : communes à ses membres.
  // `expose` : poste exposé à des risques particuliers (visite post-exposition à la sortie, shared/rules/visites-dues.ts).
  // `risquesL4154` : poste de la liste des postes à risques particuliers (formation renforcée, shared/rules/formation-renforcee.ts).
  // `c2p` : facteurs d'exposition du compte professionnel de prévention cochés sur le poste (shared/rules/c2p.ts, lot 7).
  postes: { pk: 'id', auto: true, cols: { id: 'int', nom: 'text', formations: 'json', habilitations: 'json', archive: 'text', sir: 'bool', expose: 'bool', risquesL4154: 'bool', c2p: 'json' } },
  // `nuit` : travail de nuit ou en continu (salariés mineurs exclus, shared/rules/mineurs.ts) ; JSON pour garder null,
  // case pas encore renseignée, distincte de « non ».
  // `couverture` : minimum de membres formés (SST, EPI incendie…), shared/rules/couverture.ts ; null : aucun seuil.
  // `parente` : équipe parente (hiérarchie des managers, shared/rules/hierarchie.ts).
  equipes: { pk: 'nom', cols: { nom: 'text', managerId: 'int', ordre: 'int', exigences: 'json', nuit: 'json', couverture: 'json', parente: 'text', horaire: 'text',
    // lot 11 — organigramme (shared/rules/entites.ts) : entité de l'équipe racine (héritée par les équipes rattachées), site
    // de rattachement (D14) et unité de l'organigramme de Matrix (D15, unique quand elle est renseignée).
    entite: 'text', siteCode: 'text', uniteCode: 'text' } },
  // Horaires de poste (shared/rules/horaires.ts, server/src/actions/horaires.ts) : code choisi une fois pour toutes,
  // début et fin « HH:MM » (fin avant le début : le lendemain), pause en minutes ; `horaire` d'une équipe : proposé par défaut.
  // `alternant` : horaire d'un roulement en équipes successives alternantes (C2P, shared/rules/c2p.ts, lot 7) ; JSON pour
  // garder null, horaire pas encore qualifié, distinct de « non ».
  horaires: { pk: 'code', cols: { code: 'text', nom: 'text', debut: 'text', fin: 'text', pause: 'int', archive: 'text', alternant: 'json' } },
  projets: { pk: 'code', cols: { code: 'text', nom: 'text', statut: 'text' } },
  chantiers: { pk: 'id', cols: { id: 'text', nom: 'text', client: 'text', lieu: 'text', pays: 'text', debut: 'text', fin: 'text', chef: 'text', habs: 'json', certs: 'json', ressources: 'json', statut: 'text',
    // Grand déplacement (t031) : qualification du service RH, jamais écrite par Keystone ; JSON pour garder null (à qualifier).
    grandDeplacement: 'json' } },
  employes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', nom: 'text', equipe: 'text', poste: 'text', posteId: 'int', statut: 'text', typeContrat: 'text', temps: 'text', heures: 'real',
      forfaitHeures: 'real', forfaitJours: 'real', jourOff: 'json', tempsDepuis: 'text', entree: 'text', fin: 'text',
      naissance: 'int', agence: 'text', repriseMotif: 'text', repriseDate: 'text', visite: 'text', passeportNumero: 'text', passeportExpire: 'text',
      email: 'text', notifications: 'text', // adresse professionnelle et réglage des notifications (server/src/notifications.ts)
      // Avis du médecin du travail à la dernière visite et restrictions datées (`medical.avis`) : données de santé.
      avis: 'text', restrictions: 'json',
      // Suivi médical (shared/rules/suivi-medical.ts) : type saisi, prochaine visite fixée par le médecin, dernier examen d'aptitude.
      suivi: 'text', prochaineVisite: 'text', examenAptitude: 'text',
      // Salarié exposé à des risques particuliers (`medical.suivi`) : visite post-exposition à la sortie (visites-dues.ts).
      expose: 'bool',
      // Matricule du dossier de paie (Sage) : unique, contrôlé par le serveur (une réembauche confirmée le réutilise).
      matriculePaie: 'text',
      // Sortie enregistrée par le service RH (`employe.sortie`) : motif, et fin prévue au contrat rétablie si elle est annulée.
      motifSortie: 'text', finPrevue: 'text',
      // Période d'essai écrite au contrat (fin, fin après renouvellement) et titre de séjour valant autorisation de travail
      // ({ type, numero, expire, demandeLe, verifieLe } ; null : non requise), le numéro réservé au service RH (server/src/dataset.ts).
      essaiFin: 'text', essaiRenouveleJusquau: 'text', autorisationTravail: 'json',
      // Date de naissance complète (âge exact, salariés mineurs : shared/rules/mineurs.ts) ; `naissance` en garde l'année,
      // seule connue des fiches antérieures. Service RH et intéressé seulement (server/src/dataset.ts).
      naissanceLe: 'text',
      // Dérogation pour travaux réglementés d'un salarié mineur : date de la déclaration (shared/rules/mineurs.ts).
      derogationTravauxLe: 'text',
      // Personne à prévenir en cas d'urgence (t068) : saisie par le salarié ou le service RH, réservée au service RH et à lui.
      urgenceNom: 'text', urgenceTel: 'text',
      // CDD et intérim (t053, shared/rules/cdd.ts) : motif de recours et terme initial du CDD ; ses renouvellements sont
      // des lignes de l'historique des contrats.
      motifRecours: 'text', cddFinInitiale: 'text',
      // Dossier anonymisé à la fin de sa durée de conservation (t016, server/src/conservation.ts) : date ; null : nominatif.
      anonymiseLe: 'text',
      // lot 11 — organigramme : site (D14) et unité (D15) de rattachement, tirés de l'équipe (`rattachementSalarie`) ; colonnes
      // posées en PostgreSQL par 0002_partage.sql (publiées par pub_salaries), créées en SQLite par cette déclaration.
      siteCode: 'text', uniteCode: 'text',
      // lot 11 — indicateurs (shared/rules/indicateurs-legaux.ts, migration PostgreSQL 0018_indicateurs.sql) : sexe (F, M) et
      // catégorie d'emploi ; null : à compléter. Service RH et intéressé seulement (server/src/dataset.ts).
      sexe: 'text', categorie: 'text',
    },
  },
  // Historique des contrats (t074, shared/rules/historique-contrat.ts) : régime en vigueur à compter de chaque date d'effet
  // (embauche, avenant, renouvellement d'un CDD) ; `applique` faux : avenant programmé, appliqué à la fiche à sa date
  // (server/src/avenants.ts) ; `parId` : fiche de l'auteur (server/src/integrite.ts) ; amorcé depuis les fiches par la
  // migration lot6-contrats-historique.
  contratsHistorique: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', effet: 'text', nature: 'text', regime: 'json', jusquau: 'text', signeLe: 'text', reference: 'text',
      le: 'text', par: 'text', parId: 'int', applique: 'bool', annuleLe: 'text', fin: 'text',
    },
  },
  // Demandes de visite médicale du service RH, closes par la saisie de la visite (server/src/actions/sante.ts).
  demandesVisite: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', motif: 'text', le: 'text', par: 'text', statut: 'text', closeLe: 'text', closePar: 'text' } },
  // `corrige…`, `annule…` : correction et annulation d'une saisie erronée (actions/corrections.ts) ; annulée, hors des calculs.
  certifications: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', f: 'text', obtenue: 'text', sessionId: 'int', convoc: 'text', convocLe: 'text',
      corrigeLe: 'text', corrigePar: 'text', corrigeMotif: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
      // Inscriptions en formation initiale closes par la certification, rendues à son annulation (actions/inscriptions-closes.ts).
      inscriptionsCloses: 'json',
    },
  },
  habTitres: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', h: 'text', delivree: 'text', par: 'text', demande: 'text', mesure: 'text', mesureDate: 'text', mesureMotif: 'text', mesurePar: 'text' } },
  // Délivrances des titres d'habilitation (t115, server/src/delivrances.ts) : une ligne par délivrance et renouvellement,
  // `remplaceeLe` et la mesure figés au renouvellement ; amorcée par la migration lot6-securite-hab-delivrances.
  habDelivrances: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', h: 'text', titreId: 'int', delivree: 'text', par: 'text', expire: 'text', remplaceeLe: 'text', mesure: 'text', mesureDate: 'text', le: 'text', auteur: 'text', auteurId: 'int' },
  },
  // Formations suivies par salarié, du catalogue ou hors catalogue (t116, shared/rules/formations-suivies.ts).
  formationsSuivies: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', f: 'text', libelle: 'text', du: 'text', au: 'text', duree: 'real', organisme: 'text', obligatoire: 'bool', origine: 'text',
      planActionId: 'int', demandeId: 'int', le: 'text', auteur: 'text', auteurId: 'int',
      corrigeLe: 'text', corrigePar: 'text', corrigeMotif: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
    },
  },
  visas: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', dest: 'text', type: 'text', obtenu: 'text', expire: 'text' } },
  vaccinations: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', v: 'text', date: 'text' } },
  // Le nombre d'inscrits n'est pas stocké : il est calculé au chargement (server/src/dataset.ts).
  // `fin`, `jours`, `horaires` : session sur plusieurs jours (shared/rules/plage-session.ts ; migrations/formations.ts).
  sessions: { pk: 'id', auto: true, cols: { id: 'int', formation: 'text', date: 'text', lieu: 'text', places: 'int', statut: 'text', planId: 'int', bilan: 'json', fin: 'text', jours: 'json', horaires: 'json' } },
  inscriptions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', sessionId: 'int', convoc: 'text', date: 'text', convocLe: 'text' }, unique: [['empId', 'sessionId']] },
  // `reussi` peut rester indéterminé (null) : stocké en JSON pour garder true / false / null.
  participations: { pk: 'id', auto: true, cols: { id: 'int', sessionId: 'int', empId: 'int', parcours: 'text', present: 'bool', reussi: 'json', certId: 'int' }, unique: [['sessionId', 'empId']] },
  // `coutReel`, `effectifReel` : saisis à la clôture de l'action ; `reportDe` : action d'un exercice clos qu'elle reporte.
  planActions: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', exercice: 'int', f: 'text', libelle: 'text', equipe: 'text', periode: 'text', effectif: 'int', cout: 'real', statut: 'text', origine: 'text',
      coutReel: 'real', effectifReel: 'int', reportDe: 'int',
      // Correction et suppression d'une ligne saisie par erreur (actions/corrections.ts) ; supprimée, hors des calculs.
      corrigeLe: 'text', corrigePar: 'text', corrigeMotif: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
    },
  },
  budgets: { pk: 'id', auto: true, cols: { id: 'int', exercice: 'int', equipe: 'text', montant: 'real' }, unique: [['exercice', 'equipe']] },
  // Exercices du plan de formation clos (`plan.cloturerExercice`) : plan et enveloppes en lecture seule.
  exercicesClos: { pk: 'exercice', cols: { exercice: 'int', le: 'text', par: 'text' } },
  // Formalités de détachement tenues par le RH (`voyage.detachement`) : certificat de sécurité sociale, information écrite.
  voyages: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', dest: 'text', depart: 'text', retour: 'text', motif: 'text', origine: 'text', ref: 'text', chantier: 'text', detachementLe: 'text', informationLe: 'text',
      // Annulation (`voyage.annuler`) : le déplacement reste dans l'historique, hors de tous les calculs.
      annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
      // Demandeur d'un déplacement importé du formulaire (nom du salarié reconnu, ou tel que saisi).
      demandeur: 'text',
      // Coordonnées sur place (t068) : hébergement, contact local (textes du service RH), inscription sur Ariane.
      hebergement: 'text', contactSurPlace: 'text', arianeLe: 'text' },
  },
  // Références Keystone (`ref`) uniques : index créés au démarrage (server/src/integrations/keystone-entrant.ts).
  demandesKeystone: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', chantier: 'text', dest: 'text', depart: 'text', retour: 'text', recue: 'text', ref: 'text', statut: 'text', decidee: 'text', decideur: 'text', voyageId: 'int',
      // Motif d'un refus par le service RH : conservé dans Cursus, jamais transmis à Keystone.
      motifRefus: 'text' },
  },
  missions: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', projet: 'text', lieu: 'text', du: 'text', au: 'text', type: 'text', ref: 'text' } },
  taches: { pk: 'id', auto: true, cols: { id: 'int', ref: 'text', empId: 'int', projet: 'text', tache: 'text', debut: 'text', fin: 'text', heures: 'json' } },
  // `motifDepassement` : motif d'un dépassement des durées maximales de travail (server/src/actions/temps.ts).
  // `heuresSup` : mode des heures supplémentaires figé à la validation (payées, en repos ; historique : migrations/paie.ts).
  // `lignes` : heures du lundi au dimanche, 7 valeurs par ligne (5 avant la semaine à 7 jours : migrations/temps.ts) ;
  // `majDimanche` : majoration des heures du dimanche (%) figée à la validation ; `majFerie` : celle des fériés autres que
  // le 1er mai ; `cor` : contrepartie obligatoire en repos figée à la validation, par année (shared/rules/durees.ts).
  // `reouverture` : dernière réouverture d'une feuille validée, rubriques déjà transmises comprises (t131,
  // shared/rules/regularisation.ts).
  feuilles: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', week: 'text', statut: 'text', comment: 'text', sage: 'bool', keystone: 'bool', lignes: 'json', contrat: 'json', motifDepassement: 'text', heuresSup: 'text', lotId: 'int',
      majDimanche: 'int', majFerie: 'int', cor: 'json', reouverture: 'json',
      // Horaire de poste de chaque jour (codes du référentiel `horaires`, 7 valeurs ; figé à la soumission, lot 6).
      horaires: 'json',
      // Horaires retenus (code, début, fin, pause), figés à la soumission et à la validation (lot 6).
      horairesFiges: 'json',
      // Majoration des heures de nuit (%) figée à la validation (lot 6, shared/rules/repos-nuit.ts).
      majNuit: 'int',
      // Motif du dépassement du plafond d'un forfait jours, donné à la validation (t043, shared/rules/forfait-jours.ts).
      motifForfait: 'text',
    },
    unique: [['empId', 'week']],
  },
  // Mandats des élus au CSE (server/src/actions/delegation.ts, shared/rules/delegation.ts) : titulaire ou suppléant, dates,
  // crédit d'heures de délégation par mois ; saisis par le service RH.
  mandats: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', role: 'text', du: 'text', au: 'text', credit: 'real' } },
  // Délégations des validations d'un manager absent à un suppléant (t135, server/src/actions/delegations-manager.ts,
  // shared/rules/delegations-manager.ts) : période (bornes comprises), périmètre, auteur, révocation, message de début.
  delegations: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', managerId: 'int', suppleantId: 'int', du: 'text', au: 'text', perimetre: 'json',
      creeLe: 'text', creePar: 'text', revoqueeLe: 'text', revoqueePar: 'text', annonceeLe: 'text',
    },
  },

  // Lots de paie (server/src/actions/paie.ts, shared/rules/lots-paie.ts) : contenu figé à la génération (`contenu`, lignes
  // de SagePush), feuilles du lot, téléchargements du fichier d'import, confirmation de l'import (accusé) ou annulation.
  lotsPaie: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', cle: 'text', mode: 'text', statut: 'text', periode: 'text', periodes: 'json', rappels: 'json', creation: 'text', auteur: 'text',
      feuilles: 'json', resume: 'json', sansMatricule: 'json', contenu: 'json', telechargeLe: 'text', telechargePar: 'text', telechargements: 'int',
      confirmeLe: 'text', confirmePar: 'text', reference: 'text', annuleLe: 'text', annulePar: 'text', historique: 'bool',
      // Absences du lot (identifiant, salarié ; lot 5, shared/rules/absences-paie.ts) : leurs quantités sont dans `contenu`.
      absences: 'json',
      // Lot correctif (t131) : feuilles rouvertes régularisées ; `type` null : lot ordinaire.
      type: 'text', correctifs: 'json',
      // Soldes de sortie du lot (identifiant, salarié ; t128, shared/rules/solde-sortie.ts) : quantités dans `contenu`.
      sorties: 'json',
      // Séjours du lot (source, identifiant, salarié ; t031, shared/rules/deplacements-paie.ts) : quantités dans `contenu`.
      deplacements: 'json',
      // Avenants de renonciation dont le lot emporte les jours rachetés (identifiant, salarié ; t043) : quantités dans `contenu`.
      rachats: 'json',
      // Astreintes terminées dont le lot emporte les heures et la période (identifiant, salarié ; t049, lot 7) : quantités
      // dans `contenu`.
      astreintes: 'json',
      // lot 11 — notes de frais : notes remboursées et avances versées (identifiant, salarié) ; montants dans `contenu`.
      frais: 'json',
    },
    unique: [['cle']],
  },
  // Avenants de renonciation à des jours de repos d'un forfait jours (t043, server/src/actions/forfait-jours.ts) : année,
  // jours rachetés, taux de majoration, signature et référence (texte libre) ; annulation avec motif (gardé pour
  // l'historique) ; lot de paie qui emporte les jours rachetés (`lotId`), import confirmé (`sage`) ou réglé hors fichier
  // faute de rubrique JREN active (`horsFichier`).
  avenantsForfait: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', annee: 'int', jours: 'real', taux: 'int', signeLe: 'text', reference: 'text', creeLe: 'text', creePar: 'text',
      annuleLe: 'text', annulePar: 'text', annuleMotif: 'text', lotId: 'int', sage: 'bool', horsFichier: 'bool',
    },
  },
  // Éléments de déplacement émis par les lots de paie (t031, server/src/deplacements-paie.ts) : une ligne par séjour
  // (`source` : voyage ou mission, `sourceId`), mois, rubrique et pays, avec le lot qui l'emporte (`lotId`) et l'import
  // confirmé (`sage`) ; `codeSage` null : à saisir dans Sage. Supprimées à l'annulation du lot ; l'écart du lot suivant
  // se calcule sur elles.
  deplacementsPaie: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', source: 'text', sourceId: 'int', mois: 'text', periode: 'text', rubrique: 'text', pays: 'text', quantite: 'real',
      du: 'text', au: 'text', codeSage: 'text', lotId: 'int', sage: 'bool',
    },
  },
  // Soldes de sortie photographiés à l'enregistrement de la sortie (t128, server/src/soldes-sortie.ts) : état des compteurs
  // à la date de sortie ; lot de paie qui l'emporte (`lotId`) et import confirmé (`sage`), ou réglé hors fichier faute de
  // rubrique active (`horsFichier`). Un solde courant par salarié ; un solde transmis dont la sortie est annulée ou
  // déplacée reste pour l'historique (`remplaceLe`), d'où l'absence de contrainte d'unicité sur le salarié.
  soldesSortie: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', date: 'text', etat: 'json', le: 'text', par: 'text', lotId: 'int', sage: 'bool', horsFichier: 'bool', remplaceLe: 'text' },
  },
  // Correspondance des rubriques de paie avec le plan de paie Sage (server/src/actions/paie.ts) : une ligne par rubrique
  // modifiée ; sans ligne, code Sage égal au code interne, à confirmer (shared/rules/paie.ts).
  rubriquesPaie: { pk: 'code', cols: { code: 'text', codeSage: 'text', active: 'bool', confirmeLe: 'text', confirmePar: 'text', modifieLe: 'text', modifiePar: 'text' } },
  absences: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', type: 'text', du: 'text', au: 'text', statut: 'text', keystone: 'bool',
      // Absences hors congés : signalement, justificatif, prolongation ; annulation (toutes absences).
      signaleLe: 'text', signalePar: 'text', justificatif: 'bool', justificatifLe: 'text', finInitiale: 'text', annuleeLe: 'text', annuleePar: 'text',
      signaleParInteresse: 'bool',
      // Motif d'une demande refusée, montré au salarié et à son manager.
      motifRefus: 'text',
      // Demi-journées du premier et du dernier jour (null : journée entière), shared/rules/demi-journees.ts.
      debutDemi: 'text', finDemi: 'text',
      // Fichier d'import de la paie (shared/rules/absences-paie.ts) : lot qui la porte, jours transmis au moins une fois.
      lotId: 'int', sage: 'bool',
    },
  },
  cet: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', jours: 'real', date: 'text', periode: 'text' } },
  // `periode` : année de prise de la période dont les droits reçoivent les jours ; `expire` : échéance (shared/rules/conges.ts).
  // `origine` : « fractionnement » pour les jours de fractionnement crédités (`conges.fractionnement`) ; null sinon.
  reports: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', jours: 'real', motif: 'text', par: 'text', date: 'text', sens: 'text', periode: 'int', expire: 'text', origine: 'text' } },
  // `arreteLe` : date d'arrêté des compteurs repris, qui fixe la période CP et l'année RTT sur lesquelles ils comptent.
  // `cpSolde`, `cpSoldeSuivant`, `rttSolde`, `cetSolde` : soldes d'ouverture importés à la mise en service (actions/reprise.ts) ;
  // `heuresSupAnnee` : heures supplémentaires déjà faites dans l'année de l'arrêté (contingent annuel).
  soldesReprise: {
    pk: 'empId',
    cols: {
      empId: 'int', cpPris: 'real', rttPris: 'real', recupAcquis: 'real', recupPris: 'real', arreteLe: 'text',
      cpSolde: 'real', cpSoldeSuivant: 'real', rttSolde: 'real', cetSolde: 'real', heuresSupAnnee: 'real',
    },
  },
  // Lots importés depuis l'écran Mise en service (`reprise.importer`) : type, date de reprise, colonnes rapprochées,
  // options, compte rendu ligne par ligne. Le fichier lui-même n'est pas conservé (données personnelles, avis médicaux).
  reprises: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', type: 'text', le: 'text', par: 'text', dateReprise: 'text', fichier: 'text', colonnes: 'json', options: 'json',
      lignes: 'int', crees: 'int', majs: 'int', ignorees: 'int', refusees: 'int', rapport: 'json',
    },
  },
  // Clôtures des périodes de congés (`conges.cloturer`) : solde photographié et décision, une ligne par salarié et période.
  clotures: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', type: 'text', periode: 'int', solde: 'real', decision: 'text', reportes: 'real', perdus: 'real', expire: 'text',
      reportId: 'int', motif: 'text', le: 'text', par: 'text',
    },
    unique: [['empId', 'type', 'periode']],
  },
  // Jours de fractionnement d'une période de CP (`conges.fractionnement`, t046) : crédités (report reçu `reportId`) ou
  // renonciation du salarié ; une décision par salarié et par période.
  fractionnements: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', periode: 'int', decision: 'text', jours: 'real', reportId: 'int', le: 'text', par: 'text' },
    unique: [['empId', 'periode']],
  },
  // Informations des salariés sur leurs congés à leur retour d'arrêt (`conges.informer`, art. L3141-19-3) : une par arrêt
  // et par fin d'arrêt (`au` : un arrêt prolongé après l'information en reçoit une autre à son nouveau terme).
  informationsCp: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', absenceId: 'int', du: 'text', au: 'text', le: 'text', jours: 'real', arret: 'real', limite: 'text', echeance: 'text', par: 'text',
    },
    unique: [['absenceId', 'au']],
  },
  // `planifieLe` : jour de la planification (ou de la reprogrammation), borne de la date réelle saisie à la clôture.
  // `remise*` : remise du compte rendu au salarié (jour, mode, auteur) ; `telechargeLe` : son premier téléchargement.
  entretiens: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', type: 'text', date: 'text', statut: 'text', cr: 'json', info: 'bool', signSal: 'text', signMgr: 'text', planifieLe: 'text',
      remiseLe: 'text', remiseMode: 'text', remisePar: 'text', telechargeLe: 'text',
      // lot 12 — C3 (entretiens suivis) : souhaits de formation (sensibles comme `cr`) ; synthèse du feedback 360° (étape 3).
      souhaits: 'json', syntheseFeedback: 'json',
    },
  },
  demandesCollab: {
    pk: 'id', auto: true,
    // `motifRefus` : motif d'un refus par le service RH, montré au collaborateur seul (server/src/dataset.ts).
    // `suite` : ce que l'acceptation a créé ; `rouverte…` : réouverture par le service RH (actions/corrections.ts).
    cols: {
      id: 'int', empId: 'int', type: 'text', f: 'text', h: 'text', libelle: 'text', label: 'text', sessionId: 'int', motif: 'text', date: 'text', statut: 'text', reponse: 'text', parId: 'int', declaration: 'json', motifRefus: 'text',
      suite: 'json', rouverteLe: 'text', rouvertePar: 'text', rouverteMotif: 'text',
      // lot 12 — C3 (entretiens suivis) : entretien dont le souhait a été versé (origine de la demande, anti-doublon).
      entretienId: 'int',
    },
  },
  settings: { pk: 'key', cols: { key: 'text', value: 'json' } },
  // `actor` : nom de la personne connectée ; `compteId` et `identifiant` : son compte (server/src/comptes.ts).
  // `payload` : champs retenus par la liste blanche de l'action ; `salaries` : salariés concernés ; `paie` : action
  // liée à la paie, archivée (`archivee`) au bout d'un an au lieu d'être supprimée (server/src/journal.ts).
  journal: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', at: 'text', actor: 'text', role: 'text', action: 'text', message: 'text', payload: 'json', compteId: 'int', identifiant: 'text',
      salaries: 'json', paie: 'bool', archivee: 'text',
    },
  },
  // Comptes de connexion (server/src/comptes.ts) : un par personne, salarié (`empId`) ou externe (`nom`, `adresse`).
  // `identifiant` en minuscules (adresse Microsoft 365 pour un compte Microsoft) ; `oid` : identifiant Microsoft,
  // renseigné à la première connexion ; `motDePasse` : empreinte scrypt d'un compte local.
  comptes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', nom: 'text', adresse: 'text', identifiant: 'text', type: 'text', oid: 'text', profilRh: 'text', actif: 'bool',
      motDePasse: 'text', changerMotDePasse: 'bool', echecs: 'int', blocageFin: 'text', creation: 'text', creePar: 'text', derniereConnexion: 'text',
    },
    unique: [['identifiant'], ['oid']],
  },
  // Sessions de connexion (server/src/auth.ts) ; `sessions` désigne les sessions de formation.
  // Une session porte un compte et l'espace actif ; `demoComptes` : comptes choisis par espace (démonstration).
  connexions: {
    pk: 'id',
    cols: {
      id: 'text', compteId: 'int', role: 'text', methode: 'text', demoComptes: 'json', creation: 'text', expiration: 'text', revocation: 'text', activite: 'text',
    },
  },
  // File d'envoi des messages sortants (server/src/envois.ts) : une clé d'idempotence par message.
  envois: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', cible: 'text', type: 'text', cle: 'text', contenu: 'json', statut: 'text', tentatives: 'int', prochaine: 'text',
      erreur: 'text', accuse: 'text', creation: 'text', tentative: 'text', envoi: 'text',
      classe: 'text', // échec examiné et classé par le RH : ne compte plus dans l'état de l'intégration
    },
    unique: [['cle']],
  },
  // Notifications d'étapes en attente du récapitulatif quotidien (server/src/notifications.ts) : `empId` null pour
  // le service RH ; `adresse` : trace (le récapitulatif part à l'adresse en vigueur) ; `envoiId` : e-mail du
  // récapitulatif qui les a portées (0 : close sans envoi, destinataire sans adresse ou sorti).
  notifications: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', adresse: 'text', type: 'text', objet: 'text', texte: 'text', creation: 'text', envoiId: 'int' } },
  // Relevés d'heures des intérimaires transmis aux agences, un par envoi (server/src/releves.ts) ; `enAttente` :
  // feuilles non validées au moment de l'envoi (relevé incomplet, complété automatiquement ensuite).
  releves: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', agence: 'text', semaine: 'text', adresse: 'text', creation: 'text', par: 'text', envoiId: 'int', interimaires: 'int', heures: 'real',
      enAttente: 'int',
    },
  },
  // Dernier verdict Go / No Go transmis à Keystone, par chantier et ressource (server/src/integrations/keystone-verdicts.ts).
  verdictsKeystone: { pk: 'id', auto: true, cols: { id: 'int', chantier: 'text', empId: 'int', statut: 'text', motifs: 'json', date: 'text' }, unique: [['chantier', 'empId']] },
  // Relances des échéances (server/src/relances.ts) : palier franchi par objet (titre, visite, entretien, fin de contrat…),
  // noté une fois envoyé pour qu'il ne reparte pas ; `cle` porte la date d'échéance (un renouvellement repart de zéro).
  relances: { pk: 'id', auto: true, cols: { id: 'int', cle: 'text', palier: 'text', le: 'text' }, unique: [['cle', 'palier']] },
  // Pièces justificatives (t133, server/src/pieces.ts) : fichier stocké sous un nom aléatoire (`fichier`) avec son empreinte
  // SHA-256 ; `jeton` : preuve de l'envoi, exigée pour joindre une pièce encore en attente (objet null) à un objet ;
  // `deposeCompteId` : compte qui l'a envoyée. Retirée : description gardée, fichier effacé.
  pieces: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', jeton: 'text', empId: 'int', objet: 'text', objetId: 'int', nom: 'text', type: 'text', taille: 'int', empreinte: 'text', fichier: 'text',
      deposeLe: 'text', deposePar: 'text', deposeCompteId: 'int', conserverJusquau: 'text', retireeLe: 'text', retireePar: 'text', retireeMotif: 'text',
      // Fichier chiffré au repos (lot 8, chantier D, server/src/pieces-chiffrement.ts) : 0012_pieces_chiffrees.sql.
      chiffree: 'bool',
      // lot 11 — dossiers OPCO : nature d'une pièce de dossier (facture, accord…), shared/rules/opco.ts ; 0019_dossiers_opco.sql.
      nature: 'text',
    },
    unique: [['jeton'], ['fichier']],
  },
  // Effacements confirmés par l'administrateur RH à la fin des durées de conservation (t016, server/src/conservation.ts) :
  // catégories effacées, date, auteur, motif (texte du service RH, jamais au journal) ; `avantEcheance` : droit à
  // l'effacement exercé avant l'échéance. Trace gardée après l'anonymisation, sans donnée d'identité.
  effacements: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', categories: 'json', le: 'text', par: 'text', motif: 'text', avantEcheance: 'bool', elements: 'int' } },
  // Abonnements à l'agenda personnel (t036, server/src/agenda.ts) : empreinte SHA-256 du jeton (le jeton lui-même n'est
  // montré qu'une fois), création, révocation, dernier accès du client d'agenda.
  jetonsAgenda: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', empreinte: 'text', creeLe: 'text', revoqueLe: 'text', revoquePar: 'text', dernierAcces: 'text' },
    unique: [['empreinte']],
  },
  // Astreintes (t049, lot 7, server/src/actions/astreintes.ts, shared/rules/astreintes.ts) : période (jours et heures),
  // équipe au moment de la planification, communication au salarié, motif des circonstances exceptionnelles (texte libre),
  // auteurs, annulation avec motif (jamais supprimée).
  astreintes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', equipe: 'text', du: 'text', debut: 'text', au: 'text', fin: 'text', communiqueLe: 'text', motif: 'text',
      creeLe: 'text', creePar: 'text', modifieLe: 'text', modifiePar: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
      // Paie (étape 2, server/src/astreintes-paie.ts) : lot qui emporte l'astreinte terminée, import confirmé.
      lotId: 'int', sage: 'bool',
    },
  },
  // Interventions pendant une astreinte : travail effectif déclaré sur la feuille de temps (ligne INT-AST), jour de début,
  // heures de début et de fin, durée ; retirées (ligne supprimée, heures retirées de la feuille) tant que la feuille se saisit.
  astreinteInterventions: {
    pk: 'id', auto: true,
    cols: { id: 'int', astreinteId: 'int', empId: 'int', jour: 'text', debut: 'text', fin: 'text', heures: 'real', declareLe: 'text', declarePar: 'text' },
  },
  // Liste d'attente des sessions complètes (lot 7, chantier C, t120 : server/src/liste-attente.ts) : une ligne par session et
  // par salarié, rang d'arrivée, demande qui l'y a placé, recyclage (`certId`) ou formation initiale, statut, proposition au
  // service RH (`proposeeLe`) et fin de l'attente (`issue` codée, jour, auteur). Migration PostgreSQL 0007_formations.sql.
  attentesSession: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', sessionId: 'int', empId: 'int', demandeId: 'int', certId: 'int', inscriptionId: 'int', rang: 'int', le: 'text', par: 'text',
      statut: 'text', proposeeLe: 'text', issueLe: 'text', issuePar: 'text', issue: 'text',
    },
    unique: [['sessionId', 'empId']],
  },
  // Passeport de prévention (lot 7, chantier B, t066 : shared/rules/passeport-prevention.ts) : lignes déjà déclarées sur la
  // plateforme, certification ou formation suivie (l'une ou l'autre, une seule fois chacune), jour de la déclaration,
  // instant et auteur de la marque. Migration PostgreSQL 0009_passeport_prevention.sql.
  declarationsPasseport: {
    pk: 'id', auto: true,
    cols: { id: 'int', empId: 'int', certId: 'int', suivieId: 'int', declareLe: 'text', le: 'text', auteur: 'text', auteurId: 'int' },
    unique: [['certId'], ['suivieId']],
  },
  // Évaluations des formations (lot 7, chantier C, t121 : server/src/actions/evaluations-formation.ts) : participation
  // présente d'une session clôturée ou formation suivie, à chaud (note de 1 à 5) ou à froid (efficacité), avis du salarié ou
  // de son manager (`repondant`), commentaire (texte libre, service RH seulement), saisi par (`auteur`, `auteurId`). Une par
  // formation, type et répondant. Migration PostgreSQL 0010_evaluations_formation.sql.
  evaluationsFormation: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', participationId: 'int', formationSuivieId: 'int', type: 'text', repondant: 'text', note: 'int', efficacite: 'text',
      commentaire: 'text', le: 'text', auteur: 'text', auteurId: 'int',
    },
    unique: [['participationId', 'type', 'repondant'], ['formationSuivieId', 'type', 'repondant']],
  },
  // lot 11 — organigramme (t195, shared/rules/entites.ts, server/src/actions/entites.ts ; migration PostgreSQL 0016_entites.sql).
  // Entités juridiques au-dessus des équipes : code stable, nom, type (société, établissement), société parente d'un
  // établissement, SIREN, SIRET, IDCC, site, ordre, ouverture (jamais supprimée : fermée) et source (`local`, `matrix` :
  // cache du contrat pub_entites demandé à Matrix). Aucune donnée personnelle.
  entites: {
    pk: 'code',
    cols: {
      code: 'text', nom: 'text', type: 'text', parente: 'text', siren: 'text', siret: 'text', idcc: 'text', siteCode: 'text', ordre: 'int', actif: 'bool',
      fermeLe: 'text', source: 'text',
    },
  },
  // Sites de rattachement (D14) : cache de matrix.pub_sites, tenu à la main tant que Matrix ne le fournit pas.
  sites: { pk: 'code', cols: { code: 'text', libelle: 'text', actif: 'bool', ordre: 'int' } },
  // lot 11 — pwa (chantier C2, t196 ; migration PostgreSQL 0017_pwa.sql). Trois tables techniques, dans
  // TABLES_SANS_REVISION : jamais lues par l'instantané (lireTout), lues par des routes et des tâches dédiées.
  // Réponses des actions rejouées (server/src/idempotence.ts) : `cle`, empreinte SHA-256 du compte et de la clé
  // Idempotency-Key ; empreinte du corps reçu ; statut et résultat réduit (identifiants et compteurs) rendus à un nouvel
  // envoi de la même requête ; `message` toujours vide (jamais le message de l'action). Purgées à 30 jours.
  idempotence: {
    pk: 'cle',
    cols: { cle: 'text', compteId: 'int', action: 'text', empreinteCorps: 'text', statut: 'int', message: 'text', resultat: 'json', creation: 'text' },
  },
  // Abonnements aux notifications sur le téléphone (server/src/push.ts), un par compte et par appareil (le salarié est
  // celui du compte : aucune colonne de salarié, un compte désactivé perd ses abonnements à la purge) : empreinte de
  // l'adresse du service de push (`cleEndpoint`, unique) ; adresse et clés du navigateur chiffrées avec la clé des pièces
  // (Sensible) ; libellé d'appareil déduit du navigateur ; types de notification acceptés (coupés par défaut) ; suivi
  // des envois.
  abonnementsPush: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', compteId: 'int', cleEndpoint: 'text', endpoint: 'text', p256dh: 'text', auth: 'text', appareil: 'text', types: 'json',
      creation: 'text', dernierSucces: 'text', dernierEchec: 'text', echecs: 'int',
    },
    unique: [['cleEndpoint']],
  },
  // File d'envoi des notifications push (server/src/envois-push.ts), à part de `envois` : chaque message est indépendant
  // (pas de blocage en tête), sans texte (titre et corps recalculés à l'envoi depuis `type`, shared/notifications-push.ts) ;
  // `prochaine` : prochaine tentative (plage de silence, nouvelle tentative) ; `expire` : fin de validité (TTL de 24 h).
  envoisPush: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', abonnementId: 'int', type: 'text', statut: 'text', tentatives: 'int', prochaine: 'text', expire: 'text', erreur: 'text',
      creation: 'text', envoi: 'text',
    },
  },
  // lot 11 — indicateurs (t197, server/src/actions/indicateurs.ts ; migration PostgreSQL 0018_indicateurs.sql). Arrêtés
  // annuels des indicateurs sociaux (BDESE) : année, périmètre (`global`), période, version des règles et seuil appliqués,
  // agrégats déjà masqués (`donnees`, JSON par groupement, jamais lus par l'instantané : COLONNES_OMISES), arrêté (instant,
  // auteur), mise à disposition du CSE (jour, auteur), annulation (instant, auteur, motif : texte du service RH, jamais au
  // journal). Jamais supprimés : un arrêté annulé reste, un nouveau peut être arrêté pour la même année.
  indicateursArretes: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', annee: 'int', perimetre: 'text', du: 'text', au: 'text', reglesVersion: 'text', seuil: 'int', donnees: 'json',
      arreteLe: 'text', arretePar: 'text', cseLe: 'text', csePar: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
    },
  },
  // lot 11 — dossiers OPCO (chantier C4, server/src/actions/opco.ts, shared/rules/opco.ts ; migration PostgreSQL
  // 0019_dossiers_opco.sql) : dossier de prise en charge rattaché à une action du plan (`planActionId`), `empId` réservé aux
  // dossiers d'alternance (plus tard, jamais rempli aujourd'hui) ; états datés, montants, organisme (SIRET, déclaration
  // d'activité, Qualiopi) ; motif de refus codé ; correction et suppression (saisie erronée) datées, signées et motivées
  // (textes du service RH, jamais au journal). Versements de l'OPCO (`dossierId`), annulés avec un motif, jamais supprimés.
  dossiersOpco: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', planActionId: 'int', empId: 'int', exercice: 'int', opco: 'text', dispositif: 'text', statut: 'text', reference: 'text',
      du: 'text', au: 'text', heures: 'real', effectif: 'int', montantDemande: 'real', montantDemandeAnnexes: 'real', subrogation: 'bool',
      organismeSiret: 'text', organismeNda: 'text', organismeQualiopi: 'bool',
      deposeLe: 'text', accordLe: 'text', montantAccorde: 'real', accordReference: 'text', plafondHoraire: 'real', refusLe: 'text', refusMotif: 'text',
      factureLe: 'text', montantFacture: 'real', soldeLe: 'text', soldeEcart: 'real', soldeNature: 'text', abandonLe: 'text', abandonMotif: 'text',
      creeLe: 'text', creePar: 'text', corrigeLe: 'text', corrigePar: 'text', corrigeMotif: 'text', annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
    },
  },
  versementsOpco: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', dossierId: 'int', le: 'text', montant: 'real', destinataire: 'text', reference: 'text', saisiLe: 'text', saisiPar: 'text',
      annuleLe: 'text', annulePar: 'text', annuleMotif: 'text',
    },
  },
  // lot 11 — notes de frais (shared/rules/frais*.ts, server/src/actions/frais.ts ; migration PostgreSQL 0020_notes_frais).
  // Totaux, alertes et cumuls kilométriques calculés, jamais stockés. Notes, lignes, véhicules, barèmes, forfaits, avances
  // et taux lus par l'instantané ; exports figés hors de l'instantané (HORS_INSTANTANE) ; sceaux des justificatifs sans
  // révision (TABLES_SANS_REVISION), jamais lus par l'instantané.
  notesFrais: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', periode: 'text', voyageId: 'int', missionId: 'int', projet: 'text', medicale: 'bool', statut: 'text', creeLe: 'text', creePar: 'text',
      soumiseLe: 'text', valideeLe: 'text', valideePar: 'text', controleeLe: 'text', controleePar: 'text', renvoyeeLe: 'text', renvoyeePar: 'text', renvoiMotif: 'text',
      lotId: 'int', payeeLe: 'text', annuleeLe: 'text', annuleePar: 'text', annuleMotif: 'text',
    },
  },
  lignesFrais: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', noteId: 'int', empId: 'int', date: 'text', categorie: 'text', montant: 'real', devise: 'text', taux: 'real', montantEur: 'real',
      tvaTaux: 'real', tvaMontant: 'real', commercant: 'text', forfait: 'text', km: 'real', vehiculeId: 'int', depart: 'text', arrivee: 'text',
      invites: 'text', motifDepassement: 'text', sansJustificatif: 'bool', attestation: 'bool', montantRetenu: 'real', refuseeLe: 'text', refusMotif: 'text',
    },
  },
  vehiculesPerso: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', type: 'text', cv: 'int', electrique: 'bool', du: 'text', au: 'text', creeLe: 'text', creePar: 'text' } },
  baremesKm: {
    pk: 'id', auto: true,
    cols: { id: 'int', annee: 'int', type: 'text', cvMin: 'int', cvMax: 'int', kmMin: 'int', kmMax: 'int', a: 'real', b: 'real', saisiLe: 'text', saisiPar: 'text' },
  },
  forfaitsFrais: { pk: 'id', auto: true, cols: { id: 'int', annee: 'int', code: 'text', pays: 'text', montant: 'real', saisiLe: 'text', saisiPar: 'text' } },
  avancesFrais: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', montant: 'real', voyageId: 'int', missionId: 'int', statut: 'text', demandeLe: 'text', valideeLe: 'text', valideePar: 'text',
      lotId: 'int', verseeLe: 'text', annuleeLe: 'text', annuleePar: 'text', refusMotif: 'text',
    },
  },
  tauxDevises: { pk: 'id', auto: true, cols: { id: 'int', devise: 'text', mois: 'text', taux: 'real', saisiLe: 'text', saisiPar: 'text' }, unique: [['devise', 'mois']] },
  // Exports comptables figés (étape 2) : type, clé d'idempotence, notes, contenu, téléchargements ; lus par leur route.
  exportsFrais: {
    pk: 'id', auto: true,
    cols: { id: 'int', type: 'text', cle: 'text', creation: 'text', auteur: 'text', notes: 'json', contenu: 'json', telechargements: 'int', telechargeLe: 'text', telechargePar: 'text', annuleLe: 'text' },
    unique: [['cle']],
  },
  // Sceaux des justificatifs (server/src/sceaux.ts) : chaîne d'empreintes, chaque pièce scellée avec le sceau précédent, à
  // la soumission de sa note ; identifiants, empreintes et heure seulement.
  sceauxPieces: { pk: 'id', auto: true, cols: { id: 'int', pieceId: 'int', empreinte: 'text', precedent: 'text', sceau: 'text', le: 'text' }, unique: [['pieceId']] },
  // lot 12 — blocs réservés (socle) : chaque chantier déclare ses tables dans le sien (migrations PostgreSQL et SQLite :
  // docs/ARCHITECTURE.md, « Lot 12 : socle commun »).
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°) : objectifs fixés à un entretien annuel, évalués au suivant (migration
  // PostgreSQL 0024_entretiens_suivis, SQLite d'après TABLES et `lot12-entretiens-index`) ; tables du feedback 360°
  // (étape 3, module désactivé) : sollicitations, tampon des réponses en attente (chiffré, jamais lu par l'instantané) et
  // réponses versées par lot, sans répondant ni date de réception, sous un identifiant non séquentiel.
  objectifs: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', entretienId: 'int', evalueEntretienId: 'int', reconduitDe: 'int', libelle: 'text', mesure: 'text', categorie: 'text', poids: 'int',
      echeance: 'text', avancement: 'int', statut: 'text', evaluation: 'text', commentaireSal: 'text', creeLe: 'text', creePar: 'text', modifieLe: 'text', modifiePar: 'text',
      ajusteLe: 'text', ajusteMotif: 'text', libelleInitial: 'text',
    },
  },
  feedbackSollicitations: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', empId: 'int', entretienId: 'int', repondantEmpId: 'int', relation: 'text', statut: 'text', proposeeLe: 'text', proposeePar: 'text', envoyeeLe: 'text',
      echeance: 'text', relanceeLe: 'text', closeLe: 'text',
    },
  },
  feedbackTampon: { pk: 'id', auto: true, cols: { id: 'int', sollicitationId: 'int', contenu: 'text', version: 'text' }, unique: [['sollicitationId']] },
  feedbackReponses: {
    pk: 'id',
    cols: {
      id: 'text', empId: 'int', entretienId: 'int', relation: 'text', versionQuestionnaire: 'text', notes: 'json', verbatim: 'text', verbatimStatut: 'text',
      modereLe: 'text', moderePar: 'text',
    },
  },
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

export const snake = (s: string) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const SQL_TYPE: Record<ColType, string> = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER', json: 'TEXT' };

/** Colonnes et contraintes d'une table du schéma, telles que CREATE TABLE les attend (reprises par reconstruireTable). */
export function colonnesSql(name: TableName): string {
  const def = TABLES[name] as TableDef;
  const cols = Object.entries(def.cols).map(([c, t]) => {
    const pk = c === def.pk ? (def.auto ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY') : '';
    return `${snake(c)} ${SQL_TYPE[t]}${pk}`;
  });
  for (const u of def.unique ?? []) cols.push(`UNIQUE (${u.map(snake).join(', ')})`);
  return cols.join(', ');
}

/** Valeur écrite dans une colonne de type `t` (SQLite : booléen en 0 / 1, JSON en texte). */
export function toDb(t: ColType, v: unknown): SqlValeur {
  if (v === undefined || v === null) return null;
  if (t === 'bool') return v ? 1 : 0;
  if (t === 'json') return JSON.stringify(v);
  if (t === 'int' || t === 'real') return Number(v);
  return String(v);
}
function fromDb(t: ColType, v: unknown, jsonDecode: boolean): unknown {
  if (v === null || v === undefined) return t === 'bool' ? false : null;
  if (t === 'bool') return !!v;
  if (t === 'json') return jsonDecode ? JSON.parse(String(v)) : v;
  if (t === 'int' || t === 'real') return Number(v);
  return v;
}

/** Colonne d'une table telle que la décode `Db.decode` : nom dans le code, nom dans la base, type. */
type ColonneDecodee = readonly [colonne: string, nomSql: string, type: ColType];
const DECODEURS = new WeakMap<TableDef, readonly ColonneDecodee[]>();
/**
 * Décodeur préparé d'une table (lot 9, chantier 1) : la liste [colonne, nom snake_case, type] est calculée une fois par
 * définition de table, au lieu d'Object.entries et de la conversion en snake_case de chaque colonne à chaque ligne lue
 * (28 000 feuilles de vingt colonnes à chaque lecture complète). Rangée par objet de définition : une table de TABLES
 * redéfinie (essais) reçoit son propre décodeur.
 */
function decodeur(def: TableDef): readonly ColonneDecodee[] {
  let cols = DECODEURS.get(def);
  if (!cols) DECODEURS.set(def, cols = Object.entries(def.cols).map(([c, t]) => [c, snake(c), t] as const));
  return cols;
}

/** Nom de code d'une table d'après son nom dans la base (`feuilles`, `contrats_historique` → `contratsHistorique`). */
const TABLE_DE_SQL: ReadonlyMap<string, TableName> = new Map((Object.keys(TABLES) as TableName[]).map(t => [snake(t), t]));

/**
 * Au-delà de ce nombre de lignes d'une même table entre deux révisions (ou dans une seule instruction sur PostgreSQL,
 * marqueur écrit par le déclencheur : migration 0014_changements), la table est à relire en entier (`'tout'`) : une
 * relecture par paquets de clés coûterait plus qu'une lecture complète.
 */
export const SEUIL_CHANGEMENTS = 1000;
/** Clés par requête de `Db.lireLignes` (paramètres d'une clause IN). */
export const PAQUET_LIGNES = 500;

/**
 * État de la révision de la base (lot 9, chantier 1) : `n`, la révision (`Db.revisionBase`) ; `epoque`, changée quand
 * la base est remplacée (un écart entre deux époques est inconnu) ; `purge`, plus haute révision dont les changements ont
 * été effacés du journal (`changements`) : un écart qui part d'en deçà est inconnu.
 */
export interface EtatRevision { n: number; epoque: number; purge: number }
/**
 * Lignes changées entre deux révisions, par table : clés primaires (en texte, comme dans le journal `changements`), ou
 * `'tout'` quand la table entière est à relire (TRUNCATE, remise à zéro, plus de `SEUIL_CHANGEMENTS` lignes). Une table
 * absente n'a pas changé.
 */
export type Changements = Map<TableName, Set<string> | 'tout'>;

/**
 * Valeur d'une colonne JSON lue par une requête brute : texte à décoder en SQLite, valeur déjà décodée par le pilote de
 * PostgreSQL (colonnes `json`). Les deux moteurs rendent ainsi la même valeur, sauf pour une colonne dont la valeur
 * JSON est une chaîne (réglages) : la lire par les méthodes génériques (`get`, `getSetting`), qui connaissent le moteur.
 */
export function jsonLu(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

/**
 * Tables sans déclencheur de révision (lot 8, chantier E) : écrites à chaque consultation ou connexion (trace au journal,
 * activité d'une session, dernière connexion d'un compte, dernier accès d'un flux d'agenda), jamais lues par
 * l'instantané en cache (`lireTout` de server/src/dataset.ts) : les comptes et l'abonnement à l'agenda sont relus à
 * chaque requête (identité, `buildSnapshot`). Toute autre table de TABLES augmente la révision de la base à chaque
 * écriture (table `revision` : `SqliteDb.poserRevision`, migration PostgreSQL 0013_index_journal), clé du cache de
 * l'instantané (server/src/cache-instantane.ts), et inscrit les clés de ses lignes changées au journal des changements
 * (table `changements`, lot 9, chantier 1 : migration PostgreSQL 0014_changements). Une table ajoutée ici ne doit jamais
 * être lue par `lireTout`.
 */
export const TABLES_SANS_REVISION: ReadonlySet<TableName> = new Set<TableName>(['journal', 'connexions', 'comptes', 'jetonsAgenda',
  // lot 11 — pwa : idempotence des actions rejouées, abonnements et file des notifications push (routes et tâches dédiées).
  'idempotence', 'abonnementsPush', 'envoisPush',
  // lot 11 — notes de frais : sceaux des justificatifs (chaîne d'empreintes), jamais lus par l'instantané.
  'sceauxPieces',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
]);

/**
 * Tables dont le journal des changements n'inscrit jamais les clés, seulement le marqueur « toute la table » (lot 9,
 * chantier 1, migration PostgreSQL 0014_changements, même liste) : celles que Matrix ne lit pas du tout (colonne `*` de
 * droits.colonnes_sensibles : `vaccinations`, `visas` dans le socle ; `demandes_visite`, `informations_cp`, `reprises`
 * dans la demande du lot 8), parce que l'existence même d'une de leurs lignes est sensible. Leurs clés, rapprochées dans
 * l'ordre des écritures des lignes lisibles du même salarié, la désigneraient. Petites tables : le cache les relit en
 * entier dès qu'elles changent.
 */
export const TABLES_CHANGEMENTS_SANS_CLE: ReadonlySet<TableName> = new Set<TableName>(['vaccinations', 'visas', 'demandesVisite', 'informationsCp', 'reprises',
  // lot 11 — notes de frais : dépenses (frais médicaux en mission), fermées en entier à Matrix (migration 0020).
  'lignesFrais',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°) : tables du feedback 360°, fermées en entier à Matrix ; l'ordre et la clé des
  // écritures ne doivent rattacher aucune réponse à un répondant (migration 0024).
  'feedbackSollicitations', 'feedbackTampon', 'feedbackReponses',
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
]);

/** Valeur passée en paramètre d'une requête SQL brute (`query`, `one`, `run`). */
export type SqlValeur = string | number | bigint | boolean | null | Uint8Array;
/**
 * Fenêtre de lecture d'une table (lot 12, socle) : condition SQL commune aux deux moteurs (noms de colonnes de la base,
 * paramètres `?`) et ses paramètres. Seules les lignes qui la vérifient entrent dans la lecture brute de l'instantané
 * (`FENETRES` de server/src/lecture-brute.ts), relue en entier ou par clé (server/src/delta.ts).
 */
export interface Fenetre { where: string; params: readonly SqlValeur[] }
/** Issue d'une écriture SQL brute (`run`) : lignes touchées, identifiant de la dernière insertion. */
export interface Ecriture { changes: number; lastInsertRowid: number }

/**
 * Accès aux données, asynchrone (sous-étape 8.a de la bascule vers le serveur PostgreSQL commun,
 * Matrix docs/architecture-postgres.md § 8) : même API qu'auparavant (`all`, `where`, `get`, `insert`, `update`,
 * `remove`, `count`, `tx`, `getSetting`, `setSetting`), chaque méthode renvoyant une promesse, plus le SQL brut
 * (`query`, `one`, `run`, `exec`), `lecture` et `exclusif`. Un adaptateur par moteur : `SqliteDb` (node:sqlite)
 * aujourd'hui ; l'adaptateur PostgreSQL (8.b) n'aura qu'à fournir les primitives abstraites.
 *
 * Le SQL brut reste écrit pour SQLite, paramètres `?` compris ; le code applicatif n'utilise jamais la connexion
 * `SqliteDb.sql` directement (contrôlé par scripts/verifier-await.mjs) : seuls ce fichier (schéma), le cadre et les
 * outils des migrations nommées (server/src/migrations/cadre.ts, outils.ts) et la déclaration à Matrix (index.ts) y
 * touchent.
 */
export abstract class Db {
  /** Moteur de la base : SQLite (fichier local, repli) ou PostgreSQL (serveur commun, DATABASE_URL). */
  abstract readonly moteur: 'sqlite' | 'pg';
  /** Base sans aucune table de Cursus à l'ouverture, créée à l'instant : les migrations nommées s'y appliquent sans copie. */
  abstract readonly neuve: boolean;
  /**
   * Révision de la base, renvoyée dans chaque instantané (`Dataset.revision`) : augmentée à chaque transaction d'écriture
   * validée (`tx`). Le client ignore un instantané de révision inférieure à celle qu'il affiche : la réponse d'une action
   * traitée avant une autre, arrivée après elle, ne réaffiche pas un état ancien (client/src/state/revision.ts). Partie de
   * l'heure (millisecondes) et jamais en deçà, elle croît aussi d'un démarrage à l'autre, restauration comprise, sans être
   * écrite dans la base.
   */
  protected rev = Date.now();
  get revision(): number { return this.rev; }
  /** Fichier de la base (null : base en mémoire, ou serveur de base de données). */
  abstract get emplacement(): string | null;
  /**
   * Vrai dans une lecture stable ouverte pour elle-même (`lecture` hors de toute transaction ou suite exclusive) : seul
   * endroit où le cache de l'instantané se lit et se remplit (server/src/cache-instantane.ts). Dans une transaction, la
   * révision lue compterait des écritures que l'annulation peut défaire.
   */
  abstract get lectureStable(): boolean;

  /**
   * Révision de la base tenue en base (lot 8, chantier E) : augmentée, dans la transaction de l'écriture, par un
   * déclencheur de chaque table hors `TABLES_SANS_REVISION`, quelle que soit l'instance ou l'outil qui écrit. Clé du
   * cache de l'instantané ; à lire au début d'une lecture stable, avant les données. Distincte de `revision`, propre à
   * l'instance et renvoyée au navigateur.
   */
  async revisionBase(): Promise<number> {
    return Number((await this.one<{ n: number }>('SELECT n FROM revision'))?.n ?? 0);
  }

  /** Lignes brutes d'une requête SQL (noms de colonnes de la base, sans décodage). */
  abstract query<T = Row>(sql: string, params?: readonly SqlValeur[]): Promise<T[]>;
  /** Écriture SQL brute : lignes touchées. */
  abstract run(sql: string, params?: readonly SqlValeur[]): Promise<Ecriture>;
  /** Instructions SQL sans paramètre, éventuellement plusieurs. */
  abstract exec(sql: string): Promise<void>;
  /** Noms des colonnes physiques d'une table (y compris celles qui ne sont plus utilisées). */
  abstract columns(table: TableName): Promise<string[]>;
  /** Vide les données (les sessions de connexion restent ouvertes, le journal des actions est conservé). */
  abstract clearAll(): Promise<void>;
  /**
   * Exécute `fn` dans une transaction (annulée en cas d'erreur), seule à écrire pendant ce temps. Imbriquée (appel
   * depuis une transaction en cours) : `fn` s'exécute dans la transaction englobante.
   */
  abstract tx<T>(fn: () => Promise<T> | T): Promise<T>;
  /**
   * Exécute `fn` sur un état stable de la base, en lecture : aucune écriture d'une autre requête ne s'intercale entre
   * ses lectures (instantané renvoyé au navigateur, export). Hors d'une transaction, aucune écriture n'y est admise
   * (READ ONLY sur PostgreSQL, query_only sur SQLite) et elle ne prend pas le verrou d'écriture sur PostgreSQL : la
   * trace d'une consultation s'écrit après, dans sa propre transaction (lot 8, chantier E). `courte` : lecture de
   * quelques lignes (identité de la requête), qui n'attend pas son tour derrière les instantanés (places de lecture de
   * PostgreSQL, server/src/db-pg.ts).
   */
  abstract lecture<T>(fn: () => Promise<T> | T, options?: { courte?: boolean }): Promise<T>;
  /**
   * Exécute `fn` seule sur la base, sans transaction : aucune autre requête ne lit ni n'écrit entre ses étapes (lecture
   * puis écriture d'un compteur, d'un réglage, d'une session). C'est ce que garantissait d'office l'accès synchrone
   * d'avant pour toute suite d'appels sans attente : les routes et tâches de fond qui enchaînent plusieurs accès sans
   * attendre autre chose que la base s'exécutent ainsi (`enSerie`). Une transaction ouverte dans `fn` reste possible.
   */
  abstract exclusif<T>(fn: () => Promise<T> | T): Promise<T>;
  /** Ferme la base (arrêt du serveur, fin d'un outil en ligne de commande). */
  abstract fermer(): Promise<void>;

  /**
   * Sonde du point de santé (lot 8, chantier B : server/src/supervision.ts) : la base répond-elle, sans attendre la fin
   * d'une transaction ou d'une suite exclusive en cours ? PostgreSQL : requête isolée sur une connexion du pool, qui ne
   * prend pas le verrou d'écriture (le schéma de Cursus est lisible). SQLite : redéfinie par `SqliteDb`, qui lit l'en-tête
   * du fichier sur la connexion sans passer par la file.
   */
  async sonde(): Promise<void> {
    await this.one('SELECT 1 FROM schema_migrations LIMIT 1');
  }

  /** Recale les compteurs d'identifiants après des insertions à identifiant fixé (PostgreSQL ; rien à faire en SQLite). */
  async resyncIds(): Promise<void> {}

  // — Fragments SQL propres au moteur (le reste du SQL brut est commun aux deux : paramètres `?`, TRUE / FALSE,
  //   IS DISTINCT FROM, COALESCE, CAST) —
  /** Condition « la colonne JSON `colonne` (tableau d'entiers) contient l'entier passé en paramètre » (un `?`). */
  contientEntier(colonne: string): string {
    return this.moteur === 'pg' ? `(${colonne})::jsonb @> jsonb_build_array(CAST(? AS integer))` : `EXISTS (SELECT 1 FROM json_each(${colonne}) WHERE value = ?)`;
  }
  /** Comparaison de texte insensible à la casse, comme le LIKE de SQLite : ILIKE en PostgreSQL. */
  get like(): string { return this.moteur === 'pg' ? 'ILIKE' : 'LIKE'; }
  /** Texte d'une colonne JSON, pour une recherche par LIKE (en PostgreSQL, `json` garde le texte écrit). */
  jsonTexte(colonne: string): string { return this.moteur === 'pg' ? `(${colonne})::text` : colonne; }
  /** Condition « la clé `cle` de l'objet JSON `colonne` vaut le paramètre » (un `?`, nombre ou texte), comparée en texte en PostgreSQL. */
  jsonCleEgale(colonne: string, cle: string): string {
    return this.moteur === 'pg' ? `(${colonne})->>'${cle}' = CAST(? AS text)` : `json_extract(${colonne}, '$.${cle}') = ?`;
  }
  /** Texte de la clé `cle` de l'objet JSON `colonne` (comparaison à des littéraux texte : `IN ('a', 'b')`). */
  jsonCle(colonne: string, cle: string): string {
    return this.moteur === 'pg' ? `(${colonne})->>'${cle}'` : `json_extract(${colonne}, '$.${cle}')`;
  }

  /** Première ligne brute d'une requête SQL, ou undefined. */
  async one<T = Row>(sql: string, params: readonly SqlValeur[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  protected def(table: TableName): TableDef { return TABLES[table] as TableDef; }

  /** Valeur écrite dans une colonne (paramètres des méthodes génériques) ; l'adaptateur PostgreSQL la redéfinit. */
  protected versBase(t: ColType, v: unknown): SqlValeur { return toDb(t, v); }

  protected decode<T>(table: TableName, r: Row): T {
    const o: Row = {}, texte = this.moteur === 'sqlite';
    for (const [c, s, t] of decodeur(this.def(table))) o[c] = fromDb(t, r[s], texte);
    return o as T;
  }

  // — Journal des changements (lot 9, chantier 1 : table `changements`, déclencheurs de la migration PostgreSQL
  //   0014_changements et de `SqliteDb.poserRevision`) : contrat de la relecture partielle du cache de l'instantané.
  //   À lire dans une même lecture stable (ou sous le verrou d'écriture) que les données qu'on y rapporte. —

  /**
   * Révision, époque et purge de la base, lues ensemble (`EtatRevision`). PostgreSQL (`PgDb.etatRevision`) ajoute à
   * l'époque l'OID de la table `revision` : un pg_restore qui recrée les tables change d'époque.
   */
  async etatRevision(): Promise<EtatRevision> {
    const r = await this.one<{ n: number; epoque: number; purge: number }>('SELECT n, epoque, purge FROM revision');
    return { n: Number(r?.n ?? 0), epoque: Number(r?.epoque ?? 0), purge: Number(r?.purge ?? 0) };
  }

  /**
   * Lignes changées par les révisions `de` (exclue) à `a` (comprise), par table (`Changements`), ou null quand l'écart
   * est inconnu : `de` en deçà de la purge, époque différente de `epoque` (si elle est donnée), écart à rebours ou au-delà
   * de la révision de la base. L'appelant relit alors tout. Une révision sans ligne changée (instruction qui ne touche
   * aucune ligne) n'apporte rien.
   */
  async lireChangements(de: number, a: number, epoque?: number): Promise<Changements | null> {
    const etat = await this.etatRevision();
    if (de < etat.purge || de > a || a > etat.n || (epoque !== undefined && epoque !== etat.epoque)) return null;
    const out: Changements = new Map();
    if (de === a) return out;
    for (const { tbl, pk } of await this.query<{ tbl: string; pk: string | null }>('SELECT tbl, pk FROM changements WHERE n > ? AND n <= ?', [de, a])) {
      // Table que le code ne connaît pas (ajoutée par une version plus récente) : jamais lue par celle-ci.
      const table = TABLE_DE_SQL.get(tbl);
      if (!table) continue;
      const deja = out.get(table);
      if (deja === 'tout') continue;
      if (pk === null) { out.set(table, 'tout'); continue; }
      const cles = deja ?? new Set<string>();
      cles.add(String(pk));
      out.set(table, cles.size > SEUIL_CHANGEMENTS ? 'tout' : cles);
    }
    return out;
  }

  /**
   * Lignes de `table` dont la clé primaire est dans `pks` (clés en texte, comme les rend `lireChangements`), décodées
   * comme par `all`, par paquets de `PAQUET_LIGNES` clés ; triées par clé (ordre global pour une clé entière, dans chaque
   * paquet pour une clé texte). Une clé disparue (ligne supprimée) ne rend rien.
   */
  async lireLignes<T>(table: TableName, pks: Iterable<string>, fenetre?: Fenetre): Promise<T[]> {
    const def = this.def(table), type = def.cols[def.pk], entiere = type === 'int' || type === 'real';
    const cles = [...new Set(pks)];
    if (entiere) cles.sort((x, y) => Number(x) - Number(y)); else cles.sort();
    const out: T[] = [];
    // lot 12 — socle : fenêtre de lecture (`FENETRES`) ; une clé changée hors de la fenêtre ne rend rien, comme une ligne supprimée.
    const dans = fenetre ? ` AND (${fenetre.where})` : '';
    for (let i = 0; i < cles.length; i += PAQUET_LIGNES) {
      const paquet = cles.slice(i, i + PAQUET_LIGNES);
      const lignes = await this.query(`SELECT * FROM ${snake(table)} WHERE ${snake(def.pk)} IN (${paquet.map(() => '?').join(', ')})${dans} ORDER BY ${snake(def.pk)}`,
        [...paquet.map(k => this.versBase(type, k)), ...(fenetre?.params ?? [])]);
      for (const r of lignes) out.push(this.decode<T>(table, r));
    }
    return out;
  }

  async all<T>(table: TableName, orderBy?: string): Promise<T[]> {
    const def = this.def(table);
    const order = orderBy ?? def.pk;
    return (await this.query(`SELECT * FROM ${snake(table)} ORDER BY ${snake(order)}`)).map(r => this.decode<T>(table, r));
  }

  /**
   * Lignes de `table`, dans l'ordre de sa clé, sans les colonnes `sans` (lot 8, chantier E : lots de paie lus sans leur
   * contenu figé, un JSON de 50 à 300 Ko par lot que seul le fichier d'import lit). Les colonnes omises sont absentes des
   * objets rendus.
   */
  async allSans<T>(table: TableName, sans: readonly string[]): Promise<T[]> {
    const def = this.def(table);
    const cols = Object.keys(def.cols).filter(c => !sans.includes(c));
    return (await this.query(`SELECT ${cols.map(snake).join(', ')} FROM ${snake(table)} ORDER BY ${snake(def.pk)}`)).map(r => {
      const o = this.decode<Row>(table, r);
      for (const c of sans) delete o[c];
      return o as T;
    });
  }

  /**
   * Lignes de `table` dans la fenêtre `fenetre` (lot 12, socle : `FENETRES` de server/src/lecture-brute.ts), dans l'ordre
   * de sa clé, sans les colonnes `sans` (absentes des objets rendus, comme `allSans`). Une table à fenêtre n'a pas
   * d'autre ordre de lecture (`ORDRE_LECTURE`) : contrôlé par tests/lot12-socle.test.ts.
   */
  async allDans<T>(table: TableName, fenetre: Fenetre, sans: readonly string[] = []): Promise<T[]> {
    const def = this.def(table);
    const cols = Object.keys(def.cols).filter(c => !sans.includes(c));
    return (await this.query(`SELECT ${cols.map(snake).join(', ')} FROM ${snake(table)} WHERE ${fenetre.where} ORDER BY ${snake(def.pk)}`, fenetre.params)).map(r => {
      const o = this.decode<Row>(table, r);
      for (const c of sans) delete o[c];
      return o as T;
    });
  }

  async where<T>(table: TableName, field: string, value: unknown): Promise<T[]> {
    const def = this.def(table);
    return (await this.query(`SELECT * FROM ${snake(table)} WHERE ${snake(field)} = ? ORDER BY ${snake(def.pk)}`, [this.versBase(def.cols[field], value)]))
      .map(r => this.decode<T>(table, r));
  }

  async get<T>(table: TableName, id: unknown): Promise<T | undefined> {
    const def = this.def(table);
    const r = await this.one(`SELECT * FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`, [this.versBase(def.cols[def.pk], id)]);
    return r ? this.decode<T>(table, r) : undefined;
  }

  async insert<T = Row>(table: TableName, obj: Partial<T> | Row): Promise<T> {
    const def = this.def(table);
    const o = obj as Row;
    const cols = Object.keys(def.cols).filter(c => o[c] !== undefined && !(c === def.pk && def.auto && o[c] == null));
    const res = await this.run(`INSERT INTO ${snake(table)} (${cols.map(snake).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => this.versBase(def.cols[c], o[c])));
    const id = def.auto && o[def.pk] == null ? res.lastInsertRowid : o[def.pk];
    return (await this.get<T>(table, id))!;
  }

  async update<T = Row>(table: TableName, id: unknown, patch: Partial<T> | Row): Promise<T> {
    const def = this.def(table);
    const p = patch as Row;
    const cols = Object.keys(p).filter(c => c !== def.pk && c in def.cols);
    if (cols.length) {
      await this.run(`UPDATE ${snake(table)} SET ${cols.map(c => `${snake(c)} = ?`).join(', ')} WHERE ${snake(def.pk)} = ?`,
        [...cols.map(c => this.versBase(def.cols[c], p[c])), this.versBase(def.cols[def.pk], id)]);
    }
    return (await this.get<T>(table, id))!;
  }

  async remove(table: TableName, id: unknown): Promise<void> {
    const def = this.def(table);
    await this.run(`DELETE FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`, [this.versBase(def.cols[def.pk], id)]);
  }

  async count(table: TableName): Promise<number> {
    return Number((await this.one(`SELECT COUNT(*) AS n FROM ${snake(table)}`))!.n);
  }

  // — Paramètres clé / valeur —
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const r = await this.get<{ key: string; value: T }>('settings', key);
    return r ? r.value : fallback;
  }
  /** Réglage écrit d'un seul tenant : deux écritures simultanées d'une clé nouvelle ne se heurtent pas à l'unicité. */
  setSetting(key: string, value: unknown): Promise<void> {
    return this.exclusif(async () => {
      if (await this.get('settings', key)) await this.update('settings', key, { value });
      else await this.insert('settings', { key, value });
    });
  }
}

/**
 * Fonction (route Express, tâche de fond) exécutée seule sur la base (`Db.exclusif`) : comme avec l'accès synchrone
 * d'avant, ses accès successifs ne s'entremêlent avec ceux d'aucune autre requête. Pour une suite qui attend autre
 * chose que la base (réseau, calcul d'un mot de passe), seules les étapes sans attente extérieure passent par
 * `db.exclusif`, pour ne pas bloquer les autres requêtes pendant l'attente.
 */
export function enSerie<A extends unknown[], R>(db: Db, fn: (...a: A) => Promise<R> | R): (...a: A) => Promise<R> {
  return async (...a: A) => await db.exclusif(() => fn(...a));
}

/**
 * File d'attente en mémoire (verrou exclusif) : chaque tâche attend la fin de la précédente. Les erreurs d'une tâche
 * sont rendues à son appelant et ne bloquent pas les suivantes.
 */
class FileExclusive {
  private fin: Promise<void> = Promise.resolve();
  /** Tâches en cours ou en attente. */
  private taches = 0;
  get libre(): boolean { return this.taches === 0; }
  executer<T>(fn: () => Promise<T>): Promise<T> {
    const avant = this.fin;
    let liberer!: () => void;
    this.fin = new Promise<void>(ok => { liberer = ok; });
    this.taches++;
    return avant.then(fn).finally(() => { this.taches--; liberer(); });
  }
}

/**
 * Portée d'exclusivité en cours (transaction ou lecture) : valable tant que `active`, transaction ouverte si `tx`,
 * lecture stable (`Db.lecture`) si `lecture` : aucune écriture, comme la transaction READ ONLY de PostgreSQL.
 */
interface Portee { active: boolean; tx: boolean; lecture?: boolean }

/**
 * Adaptateur SQLite (node:sqlite, synchrone). Une seule connexion par processus, partagée par toutes les requêtes HTTP :
 * avec une API asynchrone, deux requêtes peuvent désormais s'entremêler à chaque `await`. Pour garder le comportement
 * de l'accès synchrone d'avant :
 * - une file en mémoire (`FileExclusive`) sérialise les transactions et les lectures groupées (`tx`, `lecture`) : un
 *   second BEGIN n'est jamais lancé pendant qu'une transaction attend (« cannot start a transaction within a
 *   transaction »), et une écriture d'une autre requête n'entre jamais dans la transaction d'une autre, ce qui la
 *   ferait annuler avec elle ;
 * - chaque requête isolée (hors `tx` et `lecture`) passe aussi par la file : elle s'exécute entre deux transactions ;
 * - la portée en cours suit la chaîne asynchrone de l'appelant (AsyncLocalStorage) : dans `tx` et `lecture`, les
 *   requêtes s'exécutent aussitôt, sans attendre la file qu'elles détiennent ; une transaction imbriquée rejoint la
 *   transaction englobante. Une tâche lancée depuis une transaction et poursuivie après sa fin (portée close) repasse
 *   par la file.
 * Les transactions des autres processus (npm run comptes, sauvegarde) restent arbitrées par SQLite (BEGIN IMMEDIATE,
 * busy_timeout). PostgreSQL (8.b) remplacera la file par un verrou consultatif pris en tête de chaque transaction.
 */
export class SqliteDb extends Db {
  readonly moteur = 'sqlite' as const;
  /** Connexion node:sqlite : réservée au schéma, aux reprises et migrations nommées et à l'exploitation du fichier. */
  readonly sql: DatabaseSync;
  readonly neuve: boolean;
  private readonly file = new FileExclusive();
  private readonly portee = new AsyncLocalStorage<Portee>();

  constructor(file: string) {
    super();
    if (file !== ':memory:') {
      mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
      // Base neuve créée vide en 600 avant que SQLite ne l'ouvre (données de santé et de paie) : ses fichiers -wal et
      // -shm prennent les mêmes droits. Base existante : droits contrôlés au démarrage (server/src/protection.ts).
      try { writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); } catch { /* déjà présente */ }
    }
    this.sql = new DatabaseSync(file);
    // Base occupée par une autre connexion (npm run comptes, sauvegarde) : attente jusqu'à 5 s plutôt qu'un échec immédiat.
    this.sql.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    // Journal des changements (lot 9, chantier 1) : une ligne remplacée par INSERT OR REPLACE (SQL direct) passe par les
    // déclencheurs de suppression, comme une suppression ordinaire. Réglage propre à la connexion : une autre (client
    // sqlite3, outil hors de Cursus) qui ne le pose pas n'inscrit pas la ligne remplacée (voir `poserRevision`).
    this.sql.exec('PRAGMA recursive_triggers = ON');
    const tables = this.tablesSql();
    this.neuve = !Object.keys(TABLES).some(n => tables.has(snake(n)));
    // Schéma créé à l'ouverture, avant toute requête : rien d'autre ne peut encore utiliser la connexion.
    this.createSchema();
    this.poserRevision();
  }

  /**
   * Révision de la base (lot 8, chantier E) : table `revision` (une ligne) et déclencheurs qui l'augmentent à chaque
   * ligne écrite des tables lues par l'instantané (`TABLES_SANS_REVISION` exclues), y compris par un autre processus
   * (npm run comptes) ou une écriture SQL directe. Posés à l'ouverture, puis de nouveau après les migrations nommées
   * (server/src/demarrage.ts), qui peuvent reconstruire une table et ses déclencheurs avec elle ; une table ajoutée à
   * TABLES reçoit ainsi les siens sans migration. Hors de TABLES, comme la table des migrations nommées.
   * Limite du SQL direct hors de Cursus (SQLite seulement) : une ligne supprimée par INSERT OR REPLACE parce qu'elle
   * entre en conflit avec la nouvelle sur une unicité ne passe par les déclencheurs de suppression qu'avec
   * `PRAGMA recursive_triggers = ON`, réglage de la connexion que Cursus pose sur les siennes. Une écriture à la main
   * (client sqlite3) se fait donc sans INSERT OR REPLACE, ou après ce PRAGMA ; sinon seule la nouvelle clé est inscrite
   * et le cache garderait l'ancienne ligne jusqu'à sa prochaine relecture complète (redémarrage).
   */
  poserRevision(): void {
    // Journal des changements (lot 9, chantier 1, comme la migration PostgreSQL 0014_changements) : purge et époque de la
    // révision (`EtatRevision`), ajoutées à la table d'une base du lot 8, et table `changements` (révision, table, clé ;
    // clé NULL : toute la table). L'époque part de l'heure de création de la table, ou de son passage à cette version.
    const colonnes = new Set((this.sql.prepare('PRAGMA table_info(revision)').all() as { name: string }[]).map(c => c.name));
    const existants = new Map((this.sql.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`).all() as { name: string; sql: string }[]).map(d => [d.name, d.sql]));
    const sql = ['SAVEPOINT poser_revision',
      'CREATE TABLE IF NOT EXISTS revision (cle INTEGER PRIMARY KEY CHECK (cle = 1), n INTEGER NOT NULL, purge INTEGER NOT NULL DEFAULT 0, epoque INTEGER NOT NULL DEFAULT 0)'];
    for (const c of ['purge', 'epoque']) if (colonnes.size && !colonnes.has(c)) sql.push(`ALTER TABLE revision ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`);
    sql.push('INSERT OR IGNORE INTO revision (cle, n) VALUES (1, 0)', `UPDATE revision SET epoque = ${Date.now()} WHERE epoque = 0`,
      'CREATE TABLE IF NOT EXISTS changements (n INTEGER NOT NULL, tbl TEXT NOT NULL, pk TEXT)', 'CREATE INDEX IF NOT EXISTS changements_n ON changements (n)');
    for (const name of Object.keys(TABLES) as TableName[]) {
      const t = snake(name), pk = snake(this.def(name).pk);
      // Déclencheurs de l'étape précédente (lot 8 : révision seule) retirés, remplacés par `revision2_*`.
      for (const suffixe of ['i', 'u', 'd']) sql.push(`DROP TRIGGER IF EXISTS revision_${t}_${suffixe}`);
      // Table exclue : déclencheurs retirés s'ils avaient été posés (base d'essai d'une version antérieure de l'étape).
      if (TABLES_SANS_REVISION.has(name)) {
        for (const suffixe of ['i', 'u', 'd']) sql.push(`DROP TRIGGER IF EXISTS revision2_${t}_${suffixe}`);
        continue;
      }
      // Par ligne (SQLite n'a pas de déclencheur par instruction) : révision augmentée, puis la clé de la ligne inscrite
      // à cette révision, dans le même corps ; une modification inscrit aussi l'ancienne clé si elle a changé.
      const inscrire = (cle: string) => `INSERT INTO changements (n, tbl, pk) SELECT n, '${t}', ${cle} FROM revision`;
      // Table fermée à Matrix (`TABLES_CHANGEMENTS_SANS_CLE`) : marqueur « toute la table » seul, comme sur PostgreSQL.
      const corps = TABLES_CHANGEMENTS_SANS_CLE.has(name) ? { i: [inscrire('NULL')], u: [inscrire('NULL')], d: [inscrire('NULL')] } : {
        i: [inscrire(`NEW.${pk}`)],
        u: [inscrire(`NEW.${pk}`), `${inscrire(`OLD.${pk}`)} WHERE OLD.${pk} IS NOT NEW.${pk}`],
        d: [inscrire(`OLD.${pk}`)],
      };
      for (const [suffixe, evenement] of [['i', 'INSERT'], ['u', 'UPDATE'], ['d', 'DELETE']] as const) {
        // Recréé quand son texte diffère du code (liste des tables sans clé comprise), jamais sinon : une ouverture sur une
        // base à jour n'écrit rien dans le fichier (commandes à blanc).
        const nom = `revision2_${t}_${suffixe}`;
        const voulu = `CREATE TRIGGER ${nom} AFTER ${evenement} ON ${t} BEGIN UPDATE revision SET n = n + 1; ${corps[suffixe].join('; ')}; END`;
        if (existants.get(nom) !== voulu) sql.push(`DROP TRIGGER IF EXISTS ${nom}`, voulu);
      }
    }
    sql.push('RELEASE poser_revision');
    this.sql.exec(sql.join(';\n'));
  }

  get emplacement(): string | null { return this.sql.location(); }

  get lectureStable(): boolean { return !!this.enCours()?.lecture; }

  private tablesSql(): Set<string> {
    return new Set((this.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
  }

  private colonnesSync(table: TableName): string[] {
    return (this.sql.prepare(`PRAGMA table_info(${snake(table)})`).all() as { name: string }[]).map(c => c.name);
  }

  private createSchema() {
    // Base existante à laquelle il manque des tables ou des colonnes : copie de sécurité d'abord.
    if (this.schemaAMigrer()) sauvegarderAvantMigration(this);
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${snake(name)} (${colonnesSql(name)})`);
      // Base existante : ajoute les colonnes apparues depuis sa création.
      const existing = new Set(this.colonnesSync(name));
      for (const [c, t] of Object.entries(def.cols)) {
        if (!existing.has(snake(c))) this.sql.exec(`ALTER TABLE ${snake(name)} ADD COLUMN ${snake(c)} ${SQL_TYPE[t]}`);
      }
    }
  }

  /** Vrai si la base contient déjà des tables de Cursus mais pas toutes les tables ou colonnes du schéma. */
  private schemaAMigrer(): boolean {
    if (this.neuve) return false;
    const tables = this.tablesSql();
    return (Object.entries(TABLES) as [TableName, TableDef][]).some(([name, def]) => {
      if (!tables.has(snake(name))) return true;
      const cols = new Set(this.colonnesSync(name));
      return Object.keys(def.cols).some(c => !cols.has(snake(c)));
    });
  }

  /** Portée exclusive en cours dans la chaîne asynchrone de l'appelant, ou null. */
  private enCours(): Portee | null {
    const p = this.portee.getStore();
    return p?.active ? p : null;
  }

  /** Exécute `fn` avec la connexion à soi : aussitôt dans une portée en cours, sinon à son tour dans la file. */
  private aSonTour<T>(fn: (p: Portee) => Promise<T> | T): Promise<T> {
    const p = this.enCours();
    if (p) return Promise.resolve().then(() => fn(p));
    return this.file.executer(() => {
      const nouvelle: Portee = { active: true, tx: false };
      return this.portee.run(nouvelle, async () => {
        try { return await fn(nouvelle); } finally { nouvelle.active = false; }
      });
    });
  }

  query<T = Row>(sql: string, params: readonly SqlValeur[] = []): Promise<T[]> {
    return this.aSonTour(() => this.sql.prepare(sql).all(...sqliteParams(params)) as T[]);
  }

  run(sql: string, params: readonly SqlValeur[] = []): Promise<Ecriture> {
    return this.aSonTour(() => {
      const r = this.sql.prepare(sql).run(...sqliteParams(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    });
  }

  exec(sql: string): Promise<void> {
    return this.aSonTour(() => { this.sql.exec(sql); });
  }

  columns(table: TableName): Promise<string[]> {
    return this.aSonTour(() => this.colonnesSync(table));
  }

  /**
   * Remise à zéro. Journal des changements (lot 9, chantier 1) : comme le TRUNCATE de PostgreSQL, un marqueur « toute la
   * table » (clé NULL) par table vidée, à une révision de plus ; les lignes inscrites une à une par les suppressions sont
   * retirées (le marqueur les couvre). D'un seul tenant (SAVEPOINT) : une remise à zéro interrompue ne laisse rien.
   */
  clearAll(): Promise<void> {
    return this.aSonTour(() => {
      const noms = (Object.keys(TABLES) as TableName[]).filter(name => name !== 'connexions' && name !== 'journal');
      this.sql.exec('SAVEPOINT remise_a_zero');
      try {
        const avant = Number((this.sql.prepare('SELECT n FROM revision').get() as { n: number }).n);
        for (const name of noms) this.sql.exec(`DELETE FROM ${snake(name)}`);
        this.sql.exec(`DELETE FROM sqlite_sequence WHERE name <> 'journal'`);
        this.sql.prepare('DELETE FROM changements WHERE n > ?').run(avant);
        this.sql.exec('UPDATE revision SET n = n + 1');
        const marquer = this.sql.prepare('INSERT INTO changements (n, tbl, pk) SELECT n, ?, NULL FROM revision');
        for (const name of noms) if (!TABLES_SANS_REVISION.has(name)) marquer.run(snake(name));
        this.sql.exec('RELEASE remise_a_zero');
      } catch (err) {
        this.sql.exec('ROLLBACK TO remise_a_zero; RELEASE remise_a_zero');
        throw err;
      }
    });
  }

  tx<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.aSonTour(async p => {
      if (p.lecture) throw new Error('Transaction d’écriture demandée dans une lecture (Db.lecture) : ouvrir la transaction avant la lecture.');
      if (p.tx) return fn(); // transaction englobante déjà ouverte
      // IMMEDIATE : verrou d'écriture pris d'emblée, en attendant au besoin (busy_timeout) qu'une autre connexion libère la
      // base ; une transaction différée qui lit puis écrit échouerait sans attendre si une autre connexion a écrit entre-temps.
      this.sql.exec('BEGIN IMMEDIATE');
      p.tx = true;
      try {
        const r = await fn();
        this.sql.exec('COMMIT');
        this.rev = Math.max(this.rev + 1, Date.now());
        return r;
      } catch (err) {
        this.sql.exec('ROLLBACK');
        throw err;
      } finally {
        p.tx = false;
      }
    });
  }

  /**
   * Lecture stable : à son tour dans la file, en lecture seule (`PRAGMA query_only`, lot 8, chantier E) comme la
   * transaction READ ONLY de PostgreSQL, pour qu'une écriture glissée dans une lecture échoue aussi sur SQLite (tests).
   * Dans une transaction ou une suite exclusive, elle en reprend la portée (et ses écritures).
   */
  lecture<T>(fn: () => Promise<T> | T, _options?: { courte?: boolean }): Promise<T> {
    if (this.enCours()) return this.aSonTour(() => fn());
    return this.aSonTour(async p => {
      p.lecture = true;
      this.sql.exec('PRAGMA query_only = ON');
      try {
        return await fn();
      } finally {
        p.lecture = false;
        if (this.sql.isOpen) this.sql.exec('PRAGMA query_only = OFF');
      }
    });
  }

  exclusif<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.aSonTour(() => fn());
  }

  /**
   * Sonde du point de santé hors de la file : en-tête du fichier lu directement sur la connexion (synchrone, sans
   * effet), même pendant une transaction en attente. Base fermée ou fichier perdu : la promesse est rejetée.
   */
  sonde(): Promise<void> {
    return Promise.resolve().then(() => { this.sql.prepare('PRAGMA user_version').get(); });
  }

  /**
   * Ferme la connexion : aussitôt si rien n'est en cours (arrêt sur une erreur de démarrage, juste avant la sortie du
   * processus), sinon à son tour, une fois finies la transaction en cours et les requêtes déjà en attente.
   */
  fermer(): Promise<void> {
    const fermer = () => { if (this.sql.isOpen) this.sql.close(); };
    if (this.file.libre && !this.enCours()) { fermer(); return Promise.resolve(); }
    return this.aSonTour(fermer);
  }
}

/** Paramètres pour node:sqlite, qui n'accepte pas les booléens : 1 / 0, comme les colonnes `bool`. */
const sqliteParams = (params: readonly SqlValeur[]) => params.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v)) as (string | number | bigint | null | Uint8Array)[];

/** Fichier de la base, en chemin absolu : CURSUS_DB, sinon data/cursus.db du projet (server/src/chemins.ts). */
export const dbFile = () => fichierBase();

/**
 * Adresse du serveur PostgreSQL commun (DATABASE_URL), ou null : Cursus travaille alors sur le fichier SQLite de repli.
 * Une valeur vide (ou faite d'espaces) vaut absence, comme pour Keystone, Codex et Vigie : l'application de bureau la
 * force à vide pour neutraliser une variable exportée dans la session du poste.
 */
export function urlPostgres(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.DATABASE_URL?.trim();
  return url ? url : null;
}

/**
 * Ouvre la base. Avec DATABASE_URL : serveur PostgreSQL commun (server/src/db-pg.ts : pool `pg`, schéma cursus,
 * migrations de server/migrations-pg/ appliquées, schéma contrôlé). Sinon : fichier SQLite `file` (schéma créé ou
 * complété à l'ouverture).
 */
export async function openDb(file = dbFile(), env: Record<string, string | undefined> = process.env): Promise<Db> {
  const url = urlPostgres(env);
  if (url) {
    const { ouvrirPostgres } = await import('./db-pg.ts');
    return await ouvrirPostgres(url, { env });
  }
  return new SqliteDb(file);
}

/** Ouvre le fichier SQLite `file`, quel que soit DATABASE_URL (outils propres au fichier : sauvegarde, reprise). */
export const openSqlite = async (file = dbFile()): Promise<SqliteDb> => new SqliteDb(file);
