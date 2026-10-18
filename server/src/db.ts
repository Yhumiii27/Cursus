// Accès SQLite (module node:sqlite) : schéma déclaratif et requêtes génériques.
// Les champs sont en camelCase côté code et en snake_case dans la base.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fichierBase } from './chemins.ts';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

type ColType = 'text' | 'int' | 'real' | 'bool' | 'json';
interface TableDef { pk: string; auto?: boolean; cols: Record<string, ColType>; unique?: string[][] }

export const TABLES = {
  // Référentiels administrés par le service RH (server/src/actions/referentiels.ts) : `archive`, date d'archivage (null :
  // en vigueur) ; on archive au lieu de supprimer. `sir` : habilitation ou poste qui place en suivi individuel renforcé.
  formations: { pk: 'id', cols: { id: 'text', nom: 'text', court: 'text', type: 'text', validite: 'int', duree: 'text', organisme: 'text', cout: 'real', validation: 'text', archive: 'text' } },
  habilitations: { pk: 'id', cols: { id: 'text', nom: 'text', detail: 'text', prereqs: 'json', medical: 'bool', validite: 'int', signataire: 'text', archive: 'text', sir: 'bool' } },
  // `secu` : formalité de sécurité sociale du détachement (null : déduite du code pays, shared/constants.ts).
  destinations: { pk: 'code', cols: { code: 'text', pays: 'text', visa: 'text', visaSub: 'text', oblig: 'json', rec: 'json', passMois: 'int', secu: 'text', archive: 'text' } },
  // Postes et formations ou habilitations exigées (shared/rules/exigences.ts) ; `exigences` d'une équipe : communes à ses membres.
  // `expose` : poste exposé à des risques particuliers (visite post-exposition à la sortie, shared/rules/visites-dues.ts).
  postes: { pk: 'id', auto: true, cols: { id: 'int', nom: 'text', formations: 'json', habilitations: 'json', archive: 'text', sir: 'bool', expose: 'bool' } },
  // `nuit` : travail de nuit ou en continu (salariés mineurs exclus, shared/rules/mineurs.ts) ; JSON pour garder null,
  // case pas encore renseignée, distincte de « non ».
  equipes: { pk: 'nom', cols: { nom: 'text', managerId: 'int', ordre: 'int', exigences: 'json', nuit: 'json', horaire: 'text' } },
  // Horaires de poste (shared/rules/horaires.ts, server/src/actions/horaires.ts) : code choisi une fois pour toutes,
  // début et fin « HH:MM » (fin avant le début : le lendemain), pause en minutes ; `horaire` d'une équipe : proposé par défaut.
  horaires: { pk: 'code', cols: { code: 'text', nom: 'text', debut: 'text', fin: 'text', pause: 'int', archive: 'text' } },
  projets: { pk: 'code', cols: { code: 'text', nom: 'text', statut: 'text' } },
  chantiers: { pk: 'id', cols: { id: 'text', nom: 'text', client: 'text', lieu: 'text', pays: 'text', debut: 'text', fin: 'text', chef: 'text', habs: 'json', certs: 'json', ressources: 'json', statut: 'text' } },
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
      demandeur: 'text' },
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
    },
    unique: [['empId', 'week']],
  },
  // Mandats des élus au CSE (server/src/actions/delegation.ts, shared/rules/delegation.ts) : titulaire ou suppléant, dates,
  // crédit d'heures de délégation par mois ; saisis par le service RH.
  mandats: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', role: 'text', du: 'text', au: 'text', credit: 'real' } },

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
    },
    unique: [['cle']],
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
  reports: { pk: 'id', auto: true, cols: { id: 'int', empId: 'int', jours: 'real', motif: 'text', par: 'text', date: 'text', sens: 'text', periode: 'int', expire: 'text' } },
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
    },
  },
  demandesCollab: {
    pk: 'id', auto: true,
    // `motifRefus` : motif d'un refus par le service RH, montré au collaborateur seul (server/src/dataset.ts).
    // `suite` : ce que l'acceptation a créé ; `rouverte…` : réouverture par le service RH (actions/corrections.ts).
    cols: {
      id: 'int', empId: 'int', type: 'text', f: 'text', h: 'text', libelle: 'text', label: 'text', sessionId: 'int', motif: 'text', date: 'text', statut: 'text', reponse: 'text', parId: 'int', declaration: 'json', motifRefus: 'text',
      suite: 'json', rouverteLe: 'text', rouvertePar: 'text', rouverteMotif: 'text',
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

function toDb(t: ColType, v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (t === 'bool') return v ? 1 : 0;
  if (t === 'json') return JSON.stringify(v);
  if (t === 'int' || t === 'real') return Number(v);
  return String(v);
}
function fromDb(t: ColType, v: unknown): unknown {
  if (v === null || v === undefined) return t === 'bool' ? false : null;
  if (t === 'bool') return !!v;
  if (t === 'json') return JSON.parse(String(v));
  if (t === 'int' || t === 'real') return Number(v);
  return v;
}

export class Db {
  sql: DatabaseSync;
  /** Base sans aucune table de Cursus à l'ouverture, créée à l'instant : les migrations nommées s'y appliquent sans copie. */
  readonly neuve: boolean;
  private depth = 0;
  /**
   * Révision de la base, renvoyée dans chaque instantané (`Dataset.revision`) : augmentée à chaque transaction d'écriture
   * validée (`tx`). Le client ignore un instantané de révision inférieure à celle qu'il affiche : la réponse d'une action
   * traitée avant une autre, arrivée après elle, ne réaffiche pas un état ancien (client/src/state/revision.ts). Partie de
   * l'heure (millisecondes) et jamais en deçà, elle croît aussi d'un démarrage à l'autre, restauration comprise, sans être
   * écrite dans la base.
   */
  private rev = Date.now();
  get revision(): number { return this.rev; }

  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
      // Base neuve créée vide en 600 avant que SQLite ne l'ouvre (données de santé et de paie) : ses fichiers -wal et
      // -shm prennent les mêmes droits. Base existante : droits contrôlés au démarrage (server/src/protection.ts).
      try { writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); } catch { /* déjà présente */ }
    }
    this.sql = new DatabaseSync(file);
    // Base occupée par une autre connexion (npm run comptes, sauvegarde) : attente jusqu'à 5 s plutôt qu'un échec immédiat.
    this.sql.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const tables = this.tablesSql();
    this.neuve = !Object.keys(TABLES).some(n => tables.has(snake(n)));
    this.createSchema();
  }

  private tablesSql(): Set<string> {
    return new Set((this.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
  }

  private createSchema() {
    // Base existante à laquelle il manque des tables ou des colonnes : copie de sécurité d'abord.
    if (this.schemaAMigrer()) sauvegarderAvantMigration(this);
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${snake(name)} (${colonnesSql(name)})`);
      // Base existante : ajoute les colonnes apparues depuis sa création.
      const existing = new Set((this.sql.prepare(`PRAGMA table_info(${snake(name)})`).all() as { name: string }[]).map(c => c.name));
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
      const cols = new Set(this.columns(name));
      return Object.keys(def.cols).some(c => !cols.has(snake(c)));
    });
  }

  /** Noms des colonnes physiques d'une table (y compris celles qui ne sont plus utilisées). */
  columns(table: TableName): string[] {
    return (this.sql.prepare(`PRAGMA table_info(${snake(table)})`).all() as { name: string }[]).map(c => c.name);
  }

  private def(table: TableName): TableDef { return TABLES[table] as TableDef; }

  private decode<T>(table: TableName, r: Row): T {
    const def = this.def(table), o: Row = {};
    for (const [c, t] of Object.entries(def.cols)) o[c] = fromDb(t, r[snake(c)]);
    return o as T;
  }

  all<T>(table: TableName, orderBy?: string): T[] {
    const def = this.def(table);
    const order = orderBy ?? def.pk;
    return this.sql.prepare(`SELECT * FROM ${snake(table)} ORDER BY ${snake(order)}`).all().map(r => this.decode<T>(table, r as Row));
  }

  where<T>(table: TableName, field: string, value: unknown): T[] {
    const def = this.def(table);
    return this.sql.prepare(`SELECT * FROM ${snake(table)} WHERE ${snake(field)} = ? ORDER BY ${snake(def.pk)}`)
      .all(toDb(def.cols[field], value)).map(r => this.decode<T>(table, r as Row));
  }

  get<T>(table: TableName, id: unknown): T | undefined {
    const def = this.def(table);
    const r = this.sql.prepare(`SELECT * FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`).get(toDb(def.cols[def.pk], id));
    return r ? this.decode<T>(table, r as Row) : undefined;
  }

  insert<T = Row>(table: TableName, obj: Partial<T> | Row): T {
    const def = this.def(table);
    const o = obj as Row;
    const cols = Object.keys(def.cols).filter(c => o[c] !== undefined && !(c === def.pk && def.auto && o[c] == null));
    const res = this.sql.prepare(`INSERT INTO ${snake(table)} (${cols.map(snake).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map(c => toDb(def.cols[c], o[c])));
    const id = def.auto && o[def.pk] == null ? Number(res.lastInsertRowid) : o[def.pk];
    return this.get<T>(table, id)!;
  }

  update<T = Row>(table: TableName, id: unknown, patch: Partial<T> | Row): T {
    const def = this.def(table);
    const p = patch as Row;
    const cols = Object.keys(p).filter(c => c !== def.pk && c in def.cols);
    if (cols.length) {
      this.sql.prepare(`UPDATE ${snake(table)} SET ${cols.map(c => `${snake(c)} = ?`).join(', ')} WHERE ${snake(def.pk)} = ?`)
        .run(...cols.map(c => toDb(def.cols[c], p[c])), toDb(def.cols[def.pk], id));
    }
    return this.get<T>(table, id)!;
  }

  remove(table: TableName, id: unknown) {
    const def = this.def(table);
    this.sql.prepare(`DELETE FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`).run(toDb(def.cols[def.pk], id));
  }

  count(table: TableName): number {
    return Number((this.sql.prepare(`SELECT COUNT(*) AS n FROM ${snake(table)}`).get() as Row).n);
  }

  /** Vide les données (les sessions de connexion restent ouvertes, le journal des actions est conservé). */
  clearAll() {
    for (const name of Object.keys(TABLES)) if (name !== 'connexions' && name !== 'journal') this.sql.exec(`DELETE FROM ${snake(name)}`);
    this.sql.exec(`DELETE FROM sqlite_sequence WHERE name <> 'journal'`);
  }

  /** Exécute `fn` dans une transaction (annulée en cas d'erreur). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // transaction englobante déjà ouverte
    // IMMEDIATE : verrou d'écriture pris d'emblée, en attendant au besoin (busy_timeout) qu'une autre connexion libère la
    // base ; une transaction différée qui lit puis écrit échouerait sans attendre si une autre connexion a écrit entre-temps.
    this.sql.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      this.sql.exec('COMMIT');
      this.rev = Math.max(this.rev + 1, Date.now());
      return r;
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  // — Paramètres clé / valeur —
  getSetting<T>(key: string, fallback: T): T {
    const r = this.get<{ key: string; value: T }>('settings', key);
    return r ? r.value : fallback;
  }
  setSetting(key: string, value: unknown) {
    if (this.get('settings', key)) this.update('settings', key, { value });
    else this.insert('settings', { key, value });
  }
}

/** Fichier de la base, en chemin absolu : CURSUS_DB, sinon data/cursus.db du projet (server/src/chemins.ts). */
export const dbFile = () => fichierBase();

export function openDb(file = dbFile()) {
  return new Db(file);
}
