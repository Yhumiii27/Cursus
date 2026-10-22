// Accès aux données : schéma déclaratif, requêtes génériques asynchrones, adaptateur SQLite (module node:sqlite).
// Les champs sont en camelCase côté code et en snake_case dans la base.
import { AsyncLocalStorage } from 'node:async_hooks';
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
  // `dureeHeures` : durée en heures (t122, shared/rules/heures-formation.ts), facultative ; `modele` d'une habilitation : modèle
  // du titre imprimé (t115, client/src/titre-habilitation.ts).
  formations: { pk: 'id', cols: { id: 'text', nom: 'text', court: 'text', type: 'text', validite: 'int', duree: 'text', organisme: 'text', cout: 'real', validation: 'text', archive: 'text', dureeHeures: 'real' } },
  habilitations: { pk: 'id', cols: { id: 'text', nom: 'text', detail: 'text', prereqs: 'json', medical: 'bool', validite: 'int', signataire: 'text', archive: 'text', sir: 'bool', modele: 'text' } },
  // `secu` : formalité de sécurité sociale du détachement (null : déduite du code pays, shared/constants.ts).
  destinations: { pk: 'code', cols: { code: 'text', pays: 'text', visa: 'text', visaSub: 'text', oblig: 'json', rec: 'json', passMois: 'int', secu: 'text', archive: 'text',
    // Vigilance France Diplomatie et jour de sa vérification (t068, shared/rules/vigilance.ts) : saisies par le service RH.
    vigilance: 'text', vigilanceLe: 'text' } },
  // Postes et formations ou habilitations exigées (shared/rules/exigences.ts) ; `exigences` d'une équipe : communes à ses membres.
  // `expose` : poste exposé à des risques particuliers (visite post-exposition à la sortie, shared/rules/visites-dues.ts).
  // `risquesL4154` : poste de la liste des postes à risques particuliers (formation renforcée, shared/rules/formation-renforcee.ts).
  postes: { pk: 'id', auto: true, cols: { id: 'int', nom: 'text', formations: 'json', habilitations: 'json', archive: 'text', sir: 'bool', expose: 'bool', risquesL4154: 'bool' } },
  // `nuit` : travail de nuit ou en continu (salariés mineurs exclus, shared/rules/mineurs.ts) ; JSON pour garder null,
  // case pas encore renseignée, distincte de « non ».
  // `couverture` : minimum de membres formés (SST, EPI incendie…), shared/rules/couverture.ts ; null : aucun seuil.
  // `parente` : équipe parente (hiérarchie des managers, shared/rules/hierarchie.ts).
  equipes: { pk: 'nom', cols: { nom: 'text', managerId: 'int', ordre: 'int', exigences: 'json', nuit: 'json', couverture: 'json', parente: 'text', horaire: 'text' } },
  // Horaires de poste (shared/rules/horaires.ts, server/src/actions/horaires.ts) : code choisi une fois pour toutes,
  // début et fin « HH:MM » (fin avant le début : le lendemain), pause en minutes ; `horaire` d'une équipe : proposé par défaut.
  horaires: { pk: 'code', cols: { code: 'text', nom: 'text', debut: 'text', fin: 'text', pause: 'int', archive: 'text' } },
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
  // Pièces justificatives (t133, server/src/pieces.ts) : fichier stocké sous un nom aléatoire (`fichier`) avec son empreinte
  // SHA-256 ; `jeton` : preuve de l'envoi, exigée pour joindre une pièce encore en attente (objet null) à un objet ;
  // `deposeCompteId` : compte qui l'a envoyée. Retirée : description gardée, fichier effacé.
  pieces: {
    pk: 'id', auto: true,
    cols: {
      id: 'int', jeton: 'text', empId: 'int', objet: 'text', objetId: 'int', nom: 'text', type: 'text', taille: 'int', empreinte: 'text', fichier: 'text',
      deposeLe: 'text', deposePar: 'text', deposeCompteId: 'int', conserverJusquau: 'text', retireeLe: 'text', retireePar: 'text', retireeMotif: 'text',
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

function toDb(t: ColType, v: unknown): SqlValeur {
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

/** Valeur passée en paramètre d'une requête SQL brute (`query`, `one`, `run`). */
export type SqlValeur = string | number | bigint | null | Uint8Array;
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
   * ses lectures (instantané renvoyé au navigateur, export).
   */
  abstract lecture<T>(fn: () => Promise<T> | T): Promise<T>;
  /**
   * Exécute `fn` seule sur la base, sans transaction : aucune autre requête ne lit ni n'écrit entre ses étapes (lecture
   * puis écriture d'un compteur, d'un réglage, d'une session). C'est ce que garantissait d'office l'accès synchrone
   * d'avant pour toute suite d'appels sans attente : les routes et tâches de fond qui enchaînent plusieurs accès sans
   * attendre autre chose que la base s'exécutent ainsi (`enSerie`). Une transaction ouverte dans `fn` reste possible.
   */
  abstract exclusif<T>(fn: () => Promise<T> | T): Promise<T>;
  /** Ferme la base (arrêt du serveur, fin d'un outil en ligne de commande). */
  abstract fermer(): Promise<void>;

  /** Première ligne brute d'une requête SQL, ou undefined. */
  async one<T = Row>(sql: string, params: readonly SqlValeur[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  protected def(table: TableName): TableDef { return TABLES[table] as TableDef; }

  protected decode<T>(table: TableName, r: Row): T {
    const def = this.def(table), o: Row = {};
    for (const [c, t] of Object.entries(def.cols)) o[c] = fromDb(t, r[snake(c)]);
    return o as T;
  }

  async all<T>(table: TableName, orderBy?: string): Promise<T[]> {
    const def = this.def(table);
    const order = orderBy ?? def.pk;
    return (await this.query(`SELECT * FROM ${snake(table)} ORDER BY ${snake(order)}`)).map(r => this.decode<T>(table, r));
  }

  async where<T>(table: TableName, field: string, value: unknown): Promise<T[]> {
    const def = this.def(table);
    return (await this.query(`SELECT * FROM ${snake(table)} WHERE ${snake(field)} = ? ORDER BY ${snake(def.pk)}`, [toDb(def.cols[field], value)]))
      .map(r => this.decode<T>(table, r));
  }

  async get<T>(table: TableName, id: unknown): Promise<T | undefined> {
    const def = this.def(table);
    const r = await this.one(`SELECT * FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`, [toDb(def.cols[def.pk], id)]);
    return r ? this.decode<T>(table, r) : undefined;
  }

  async insert<T = Row>(table: TableName, obj: Partial<T> | Row): Promise<T> {
    const def = this.def(table);
    const o = obj as Row;
    const cols = Object.keys(def.cols).filter(c => o[c] !== undefined && !(c === def.pk && def.auto && o[c] == null));
    const res = await this.run(`INSERT INTO ${snake(table)} (${cols.map(snake).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => toDb(def.cols[c], o[c])));
    const id = def.auto && o[def.pk] == null ? res.lastInsertRowid : o[def.pk];
    return (await this.get<T>(table, id))!;
  }

  async update<T = Row>(table: TableName, id: unknown, patch: Partial<T> | Row): Promise<T> {
    const def = this.def(table);
    const p = patch as Row;
    const cols = Object.keys(p).filter(c => c !== def.pk && c in def.cols);
    if (cols.length) {
      await this.run(`UPDATE ${snake(table)} SET ${cols.map(c => `${snake(c)} = ?`).join(', ')} WHERE ${snake(def.pk)} = ?`,
        [...cols.map(c => toDb(def.cols[c], p[c])), toDb(def.cols[def.pk], id)]);
    }
    return (await this.get<T>(table, id))!;
  }

  async remove(table: TableName, id: unknown): Promise<void> {
    const def = this.def(table);
    await this.run(`DELETE FROM ${snake(table)} WHERE ${snake(def.pk)} = ?`, [toDb(def.cols[def.pk], id)]);
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
  return (...a: A) => db.exclusif(() => fn(...a));
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

/** Portée d'exclusivité en cours (transaction ou lecture) : valable tant que `active`, transaction ouverte si `tx`. */
interface Portee { active: boolean; tx: boolean }

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
    const tables = this.tablesSql();
    this.neuve = !Object.keys(TABLES).some(n => tables.has(snake(n)));
    // Schéma créé à l'ouverture, avant toute requête : rien d'autre ne peut encore utiliser la connexion.
    this.createSchema();
  }

  get emplacement(): string | null { return this.sql.location(); }

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
    return this.aSonTour(() => this.sql.prepare(sql).all(...params) as T[]);
  }

  run(sql: string, params: readonly SqlValeur[] = []): Promise<Ecriture> {
    return this.aSonTour(() => {
      const r = this.sql.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    });
  }

  exec(sql: string): Promise<void> {
    return this.aSonTour(() => { this.sql.exec(sql); });
  }

  columns(table: TableName): Promise<string[]> {
    return this.aSonTour(() => this.colonnesSync(table));
  }

  clearAll(): Promise<void> {
    return this.aSonTour(() => {
      for (const name of Object.keys(TABLES)) if (name !== 'connexions' && name !== 'journal') this.sql.exec(`DELETE FROM ${snake(name)}`);
      this.sql.exec(`DELETE FROM sqlite_sequence WHERE name <> 'journal'`);
    });
  }

  tx<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.aSonTour(async p => {
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

  lecture<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.aSonTour(() => fn());
  }

  exclusif<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.aSonTour(() => fn());
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

/** Fichier de la base, en chemin absolu : CURSUS_DB, sinon data/cursus.db du projet (server/src/chemins.ts). */
export const dbFile = () => fichierBase();

/** Ouvre la base (SQLite : schéma créé ou complété à l'ouverture). */
export async function openDb(file = dbFile()): Promise<SqliteDb> {
  return new SqliteDb(file);
}
