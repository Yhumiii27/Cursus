// Journal des actions : libellés français, familles (filtre « Action »), actions liées à la paie et durées
// de conservation, mise en forme des anciennes et nouvelles valeurs, droits de lecture. Partagé par le serveur
// (consultation, export CSV, conservation : server/src/journal.ts) et l'écran Paramètres → Journal des actions.
import { droitsRh, EMAIL_LABEL } from './constants.ts';
import type { CurrentUser } from './types.ts';

/**
 * Durées de conservation (décision de l'entreprise) : 1 an pour tout ; les actions liées à la paie passent
 * alors dans une archive, hors de l'écran, consultable sur demande par le service RH, et sont supprimées
 * au bout de 3 ans.
 */
export const CONSERVATION_JOURNAL_MOIS = 12;
export const CONSERVATION_ARCHIVE_PAIE_MOIS = 36;
/** Envois réussis ou simulés de la file d'envoi : conservés aussi longtemps que le journal (server/src/envois.ts). */
export const CONSERVATION_ENVOIS_MOIS = 12;

/**
 * Actions liées à la paie, archivées 3 ans : validations (feuilles de temps, absences validées par le
 * manager ou le RH, qualifiées ou saisies d'emblée), prolongations et annulations d'absences (sans elles,
 * l'archive présenterait comme en vigueur une absence annulée ou raccourcie), corrections d'heures par le
 * manager ou le RH et transmissions à la paie (Sage).
 */
export const ACTIONS_PAIE: readonly string[] = [
  'temps.validate', 'temps.correction', 'temps.ferie', 'temps.pushSage', 'absence.decider', 'absence.qualifier', 'absence.saisir', 'absence.prolonger', 'absence.annuler',
  // Clôture des congés (report ou perte du solde de chaque salarié, à justifier en cas de litige) et datation des
  // compteurs repris de l'ancien système (période sur laquelle ils sont décomptés).
  'conges.cloturer', 'migration.soldes',
  // Jours de fractionnement crédités, ou renonciation du salarié (t046) : droits à congés payés de la période.
  'conges.fractionnement',
  // Sortie (solde de tout compte, absences qu'elle annule) et solde de RTT gardé avant un changement de régime.
  'employe.sortie', 'employe.annulerSortie', 'employe.rtt',
  // Paie : correspondance des rubriques avec le plan de paie Sage, mode des heures supplémentaires figé sur les feuilles.
  'paie.rubrique', 'migration.heuresSup',
  // Soldes d'ouverture repris de l'ancien outil à la mise en service (point de départ des compteurs de congés).
  'reprise.soldes',
  // Lots de paie (génération, confirmation de l'import, annulation, format du fichier, reprise des transmissions d'avant
  // les lots) et validation groupée des feuilles ; le téléchargement du fichier est tracé sous `sage.fichier`.
  'paie.lotGenerer', 'paie.lotConfirmer', 'paie.lotAnnuler', 'paie.formatFichier', 'migration.lotsPaie', 'temps.validerLot',
  // Absences dans le fichier de paie : date à partir de laquelle Cursus les transmet (base reprise, lot 5) ; l'export
  // des variables de la période est tracé sous `sage.variables`.
  'migration.absencesPaie',
  // Réouverture d'une feuille validée, parfois déjà transmise (régularisation dans un lot correctif, t131), et reprise
  // des rubriques par feuille des lots d'avant le lot 5.
  'temps.rouvrir', 'migration.rubriquesFeuilles',
  // Déplacements dans le fichier de paie (t031) : qualification « grand déplacement » d'un chantier, date de départ posée
  // pour les séjours déjà traités par la paie.
  'chantier.grandDeplacement', 'migration.deplacementsPaie',
  // Jours fériés d'une année (journée de solidarité, fériés non chômés) : ils changent le décompte des congés de l'année.
  'parametres.feries',
  // Renouvellement d'un CDD (terme du contrat, indemnité de fin de contrat) ; avenant programmé appliqué à sa date.
  'employe.renouvelerCdd', 'employe.avenantApplique',
  // Forfait jours (t043) : avenant de renonciation à des jours de repos (jours rachetés, majoration, rubrique JREN).
  'forfait.avenant', 'forfait.annulerAvenant',
  // Astreintes (t049, lot 7) : périodes planifiées, modifiées ou annulées (compensation) et interventions (travail effectif).
  'astreinte.planifier', 'astreinte.modifier', 'astreinte.annuler', 'astreinte.intervention', 'astreinte.retirerIntervention',
  // lot 11 — notes de frais : circuit jusqu'au contrôle (remboursement par la paie : lots de paie ci-dessus), avances,
  // barème et forfaits (limites d'exonération), taux des devises ; exports comptables (génération, annulation, fichier
  // téléchargé, tracé comme sage.fichier : étape 2).
  'frais.note.soumettre', 'frais.note.valider', 'frais.note.renvoyer', 'frais.note.controler', 'frais.note.annuler', 'frais.ligne.refuser',
  'frais.ligne.plafonner', 'frais.avance.valider', 'frais.avance.refuser', 'frais.avance.annuler', 'frais.bareme.enregistrer', 'frais.forfait.enregistrer',
  'frais.taux.enregistrer', 'frais.export.generer', 'frais.export.annuler', 'frais.export.fichier',
];
export const estActionPaie = (action: string) => ACTIONS_PAIE.includes(action) || action.startsWith('sage.');

/** Connexions et accès : vue « Connexions » du journal (les refus d'accès en font partie). */
export const ACTIONS_CONNEXION: readonly string[] = ['connexion', 'connexion.refusee', 'deconnexion', 'motdepasse.change', 'motdepasse.refuse', 'espace.change', 'acces.refuse'];
/** Appels entrants de Keystone : vue à part, pour que leur volume ne masque pas les actions des utilisateurs. */
export const ACTION_APPEL_KEYSTONE = 'keystone.appel';

/** Libellé de chaque code inscrit au journal ; un code inconnu s'affiche tel quel. */
export const JOURNAL_LABEL: Record<string, string> = {
  // Fiches et équipes
  'employe.creer': 'Création d’une fiche',
  'employe.modifier': 'Modification d’une fiche',
  'employe.rtt': 'Changement de régime : solde de RTT gardé pour la paie',
  'employe.sortie': 'Sortie d’un salarié',
  'employe.annulerSortie': 'Sortie annulée',
  'employe.autorisationTravail': 'Titre de séjour (autorisation de travail)',
  'employe.renouvelerCdd': 'Renouvellement d’un CDD',
  'employe.annulerAvenant': 'Avenant programmé annulé',
  'employe.avenantApplique': 'Avenant appliqué à sa date d’effet',
  'migration.contratsHistorique': 'Reprise : historique des contrats amorcé depuis les fiches',
  'equipe.creer': 'Création d’une équipe',
  'equipe.renommer': 'Équipe renommée',
  'equipe.modifier': 'Équipe modifiée (nom, manager)',
  'equipe.supprimer': 'Suppression d’une équipe',
  'equipe.manager': 'Manager d’une équipe',
  'equipe.affecter': 'Affectation à une équipe',
  'equipe.parente': 'Équipe parente (hiérarchie des managers)',
  'equipe.delegation': 'Délégation des validations d’un manager à un suppléant',
  'equipe.revoquerDelegation': 'Délégation des validations révoquée',
  // Formations
  'plan.inscrire': 'Inscription à une session',
  'cert.ajouter': 'Certification enregistrée',
  'cert.modifier': 'Certification corrigée',
  'cert.annuler': 'Certification supprimée (saisie erronée)',
  'session.creer': 'Création d’une session',
  'session.confirmer': 'Session confirmée',
  'session.modifier': 'Session modifiée',
  'session.annuler': 'Session annulée',
  'session.cloturer': 'Session clôturée',
  'plan.importer': 'Import du plan de formation',
  'plan.avancer': 'Avancement du plan de formation',
  'plan.modifier': 'Ligne du plan de formation corrigée',
  'plan.supprimer': 'Ligne du plan de formation supprimée (saisie erronée)',
  'plan.cloturerExercice': 'Clôture d’un exercice du plan de formation',
  'budget.enveloppes': 'Enveloppes budgétaires',
  'formationSuivie.enregistrer': 'Formation suivie enregistrée',
  'formationSuivie.modifier': 'Formation suivie corrigée',
  'formationSuivie.annuler': 'Formation suivie supprimée (saisie erronée)',
  // Liste d'attente des sessions complètes (lot 7, t120, server/src/liste-attente.ts) : actions et effets d'une place libérée.
  'attente.confirmer': 'Inscription confirmée depuis la liste d’attente',
  'attente.retirer': 'Retrait de la liste d’attente',
  'attente.proposee': 'Place libérée proposée depuis la liste d’attente',
  'attente.inscrite': 'Inscription automatique depuis la liste d’attente',
  'attente.sautee': 'Liste d’attente : salarié non admissible passé',
  'attente.remise': 'Liste d’attente : proposition remise en attente',
  'attente.purgee': 'Liste d’attente close (session annulée ou clôturée)',
  // Passeport de prévention (lot 7, t066)
  'passeport.declarer': 'Passeport de prévention : lignes marquées déclarées',
  'passeport.retirer': 'Passeport de prévention : marque de déclaration retirée',
  'passeport.exporter': 'Passeport de prévention : lignes exportées',
  'migration.passeportPrevention': 'Reprise : formations marquées pour le Passeport de prévention',
  // Évaluation des formations (lot 7, t121, server/src/actions/evaluations-formation.ts) : saisie et retrait.
  'evaluation.enregistrer': 'Évaluation d’une formation enregistrée',
  'evaluation.retirer': 'Évaluation d’une formation retirée',
  // Habilitations
  'hab.delivrer': 'Habilitation délivrée',
  'hab.suspendre': 'Habilitation suspendue',
  'hab.lever': 'Suspension levée',
  'hab.retirer': 'Habilitation retirée',
  'hab.demander': 'Habilitation exigée demandée',
  'migration.habDelivrances': 'Reprise : historique des habilitations amorcé',
  'medical.demander': 'Visite médicale demandée',
  'medical.annuler': 'Demande de visite annulée',
  'medical.avis': 'Avis du médecin du travail',
  'medical.suivi': 'Type de suivi médical',
  // Référentiels
  'referentiel.formation.enregistrer': 'Formation du catalogue créée ou modifiée',
  'referentiel.formation.archiver': 'Formation archivée ou rétablie',
  'referentiel.habilitation.enregistrer': 'Habilitation du référentiel créée ou modifiée',
  'referentiel.habilitation.archiver': 'Habilitation archivée ou rétablie',
  'referentiel.destination.enregistrer': 'Destination créée ou modifiée',
  'referentiel.destination.archiver': 'Destination archivée ou rétablie',
  'referentiel.charger': 'Référentiel type chargé',
  'referentiel.poste.enregistrer': 'Poste créé ou modifié',
  'referentiel.poste.archiver': 'Poste archivé ou rétabli',
  'referentiel.equipe.exigences': 'Exigences communes d’une équipe',
  'referentiel.activite.enregistrer': 'Activité interne créée ou renommée',
  'referentiel.activite.archiver': 'Activité interne archivée ou rétablie',
  'referentiel.horaire.enregistrer': 'Horaire de poste créé ou modifié',
  'referentiel.horaire.archiver': 'Horaire de poste archivé ou rétabli',
  'referentiel.poste.expositions': 'Facteurs d’exposition du poste (C2P)',
  'referentiel.horaire.alternant': 'Horaire qualifié pour le C2P (équipes alternantes)',
  'migration.postes': 'Reprise : postes créés depuis les fiches',
  // Demandes des collaborateurs
  'demande.formation': 'Demande de formation',
  'demande.habilitation': 'Demande d’habilitation',
  'demande.accepter': 'Demande acceptée',
  'demande.refuser': 'Demande refusée',
  'demande.annuler': 'Demande retirée par son auteur',
  'demande.reouvrir': 'Demande rouverte',
  // Déplacements
  'voyage.creer': 'Déplacement créé',
  'voyage.detachement': 'Formalités de détachement',
  'voyage.modifier': 'Déplacement modifié',
  'voyage.annuler': 'Déplacement annulé',
  'formalite.enregistrer': 'Formalité de voyage',
  'voyages.importer': 'Import de déplacements',
  'keystone.accepter': 'Demande de Keystone acceptée',
  'keystone.refuser': 'Demande de Keystone refusée',
  'chantier.grandDeplacement': 'Grand déplacement d’un chantier qualifié',
  'migration.deplacementsPaie': 'Déplacements antérieurs laissés à la saisie dans Sage',
  'employe.contactUrgence': 'Contact d’urgence enregistré',
  // Temps et paie
  'temps.setCell': 'Saisie d’heures',
  'temps.horaire': 'Horaire du jour choisi par autrui',
  'temps.addLine': 'Ligne ajoutée à une feuille de temps',
  'temps.removeLine': 'Ligne retirée d’une feuille de temps',
  'temps.suggest': 'Heures proposées depuis Keystone',
  'temps.submit': 'Feuille de temps soumise',
  'temps.validate': 'Feuille de temps validée',
  'temps.reject': 'Feuille de temps renvoyée',
  'temps.rouvrir': 'Feuille de temps validée rouverte',
  'temps.correction': 'Correction d’heures par le manager ou le RH',
  'temps.ferie': 'Heures saisies un jour férié',
  // Forfait jours (t043)
  'forfait.avenant': 'Avenant de renonciation à des jours de repos (forfait jours)',
  'forfait.annulerAvenant': 'Avenant de renonciation annulé (forfait jours)',
  'temps.pushSage': 'Transmission à la paie',
  'paie.rubrique': 'Rubrique de paie Sage',
  'paie.lotGenerer': 'Lot de paie généré',
  'paie.lotConfirmer': 'Import du lot de paie confirmé dans Sage',
  'paie.lotAnnuler': 'Lot de paie annulé',
  'paie.formatFichier': 'Format du fichier d’import Sage',
  'sage.fichier': 'Fichier d’import Sage téléchargé',
  'sage.variables': 'Variables de paie de la période exportées',
  'migration.absencesPaie': 'Absences antérieures laissées à la saisie dans Sage',
  'temps.relancer': 'Relance des feuilles de temps',
  'temps.validerLot': 'Validation groupée des feuilles de temps',
  'temps.derogationDominicale': 'Dérogation au repos dominical d’une équipe',
  'mandat.enregistrer': 'Mandat au CSE enregistré ou modifié',
  'mandat.supprimer': 'Mandat au CSE retiré',
  // Astreintes (t049, lot 7, server/src/actions/astreintes.ts).
  'astreinte.planifier': 'Astreinte planifiée',
  'astreinte.modifier': 'Astreinte modifiée',
  'astreinte.annuler': 'Astreinte annulée',
  'astreinte.intervention': 'Intervention d’astreinte déclarée',
  'astreinte.retirerIntervention': 'Intervention d’astreinte retirée',
  // lot 11 — notes de frais (server/src/actions/frais.ts)
  'frais.note.creer': 'Note de frais créée',
  'frais.ligne.ajouter': 'Dépense ajoutée à une note de frais',
  'frais.ligne.modifier': 'Dépense d’une note de frais modifiée',
  'frais.ligne.supprimer': 'Dépense retirée d’une note de frais',
  'frais.note.soumettre': 'Note de frais soumise',
  'frais.note.valider': 'Note de frais validée',
  'frais.note.renvoyer': 'Note de frais renvoyée pour correction',
  'frais.note.controler': 'Note de frais contrôlée',
  'frais.ligne.refuser': 'Dépense refusée au contrôle',
  'frais.ligne.plafonner': 'Dépense ramenée au plafond',
  'frais.note.annuler': 'Note de frais annulée',
  'frais.vehicule.declarer': 'Véhicule personnel déclaré',
  'frais.bareme.enregistrer': 'Barème kilométrique enregistré',
  'frais.forfait.enregistrer': 'Limite d’un forfait de frais enregistrée',
  'frais.taux.enregistrer': 'Taux d’une devise enregistré',
  'frais.avance.demander': 'Avance sur frais demandée',
  'frais.avance.valider': 'Avance sur frais validée',
  'frais.avance.refuser': 'Avance sur frais refusée',
  'frais.avance.annuler': 'Avance sur frais annulée',
  'frais.export.generer': 'Export comptable des notes de frais généré',
  'frais.export.annuler': 'Export comptable des notes de frais annulé',
  'frais.export.fichier': 'Fichier d’écritures des notes de frais téléchargé',
  // Absences et congés
  'absence.demander': 'Demande d’absence',
  'absence.decider': 'Décision sur une absence',
  'absence.signaler': 'Absence signalée',
  'absence.saisir': 'Absence saisie',
  'absence.qualifier': 'Absence qualifiée',
  'absence.prolonger': 'Absence prolongée',
  'absence.annuler': 'Absence annulée',
  'cet.placer': 'Placement sur le compte épargne-temps',
  'report.accorder': 'Report de congés payés',
  'conges.cloturer': 'Clôture d’une période de congés',
  'conges.fractionnement': 'Jours de fractionnement des congés payés',
  'conges.informer': 'Information sur les congés au retour d’un arrêt',
  // Entretiens
  'entretien.planifier': 'Entretien planifié',
  'entretien.annuler': 'Entretien annulé',
  'entretien.modifier': 'Compte rendu d’entretien rédigé',
  'entretien.clore': 'Entretien clos',
  'entretien.signer': 'Entretien signé par le salarié',
  'entretien.remettre': 'Compte rendu d’entretien remis au salarié',
  'entretien.telecharger': 'Compte rendu d’entretien téléchargé par le salarié',
  // Administration
  'parametres.maj': 'Paramètres modifiés',
  'parametres.feries': 'Jours fériés et journée de solidarité d’une année',
  'demo.reinitialiser': 'Démonstration réinitialisée',
  'compte.creer': 'Compte créé',
  'compte.profil': 'Profil RH modifié',
  'compte.activer': 'Compte activé ou désactivé',
  'compte.reinitialiser': 'Accès réinitialisé',
  'compte.admin': 'Administrateur RH désigné (ligne de commande)',
  'envoi.relancer': 'Envoi relancé',
  'envoi.classer': 'Échec d’envoi classé',
  'confidentialite.regler': 'Coordonnées de la page Confidentialité modifiées',
  // Reprise depuis Lucca (écran Mise en service) : un code par import.
  'reprise.importer': 'Import de mise en service',
  'reprise.salaries': 'Mise en service : salariés importés',
  'reprise.soldes': 'Mise en service : soldes de congés repris',
  'reprise.certifications': 'Mise en service : certifications reprises',
  'reprise.habilitations': 'Mise en service : habilitations reprises',
  'reprise.visites': 'Mise en service : visites médicales reprises',
  'export': 'Export ou impression',
  'journal.export': 'Export du journal',
  'journal.archive': 'Consultation de l’archive paie',
  'journal.conservation': 'Durée de conservation appliquée',
  'salarie.export': 'Export des données d’un salarié',
  'donnees.export': 'Téléchargement de ses propres données',
  // Connexions et accès
  'connexion': 'Connexion',
  'connexion.refusee': 'Connexion refusée',
  'deconnexion': 'Déconnexion',
  'motdepasse.change': 'Mot de passe changé',
  'motdepasse.refuse': 'Changement de mot de passe refusé',
  'espace.change': 'Changement d’espace',
  'acces.refuse': 'Accès refusé',
  // Intégrations
  'keystone.appel': 'Appel de Keystone',
  'keystone.echec': 'Envoi à Keystone en échec',
  'keystone.demande.decision': 'Message à Keystone : décision sur une demande (simulation)',
  'keystone.heures.validees': 'Message à Keystone : heures validées (simulation)',
  'keystone.absence.validee': 'Message à Keystone : absence validée (simulation)',
  'keystone.absence.annulee': 'Message à Keystone : absence annulée (simulation)',
  'keystone.verdict.modifie': 'Message à Keystone : verdict Go / No Go modifié (simulation)',
  'keystone.deplacement.modifie': 'Message à Keystone : déplacement modifié (simulation)',
  'keystone.deplacement.annule': 'Message à Keystone : déplacement annulé (simulation)',
  // Mise à jour de la base
  'migration.detachement': 'Reprise des formalités de détachement',
  'migration.soldes': 'Datation des compteurs repris et des reports de CP',
  'migration.heuresSup': 'Reprise : mode des heures supplémentaires figé sur les feuilles validées',
  'migration.lotsPaie': 'Reprise : feuilles déjà transmises réunies en un lot historique',
  'migration.rubriquesFeuilles': 'Reprise : rubriques transmises de chaque feuille des lots de paie',
  'migration.coutReel': 'Reprise du coût réel des actions réalisées du plan',
  'migration.referencesDeplacements': 'Reprise : référence donnée aux déplacements importés sans référence',
  'migration.postgres': 'Reprise : base SQLite copiée sur le serveur PostgreSQL commun',
  // Passage de la démonstration à la production (npm run purge-demo, lot 8) : seule ligne laissée au journal vidé.
  'purge.demo': 'Purge des données de démonstration avant la mise en production',
  // Contrôle d'intégrité du démarrage (server/src/integrite.ts) : références orphelines, nombres seulement.
  'integrite.orphelins': 'Contrôle d’intégrité : références orphelines dans la base',
  // Pièces justificatives (server/src/pieces.ts) : identifiants, objet, type et taille ; jamais le nom du fichier.
  'piece.deposer': 'Pièce justificative envoyée',
  'piece.joindre': 'Pièce justificative jointe',
  'piece.retirer': 'Pièce justificative retirée',
  'piece.consulter': 'Pièce justificative consultée',
  'piece.chiffrer': 'Pièces justificatives chiffrées sur disque',
  // Conservation des dossiers (t016, server/src/conservation.ts) : identifiants et catégories seulement, jamais de nom.
  'employe.anonymiser': 'Dossier de salarié sorti : données échues effacées ou dossier anonymisé',
  'conservation.signalement': 'Dossiers de salariés sortis à effacer signalés au service RH',
  // Agenda personnel (t036, server/src/agenda.ts) : jeton créé, révoqué ; jamais le jeton.
  'agenda.creerJeton': 'Abonnement à l’agenda personnel créé',
  'agenda.revoquerJeton': 'Abonnement à l’agenda personnel révoqué',
  'agenda.revoquerTout': 'Tous les abonnements aux agendas révoqués',
  // lot 11 — organigramme (server/src/actions/entites.ts) : codes, type, SIREN, SIRET et IDCC (données publiques), équipe,
  // avant et après ; impression et export : entité et nombre de lignes seulement, jamais un nom.
  'entite.creer': 'Entité créée (société ou établissement)',
  'entite.modifier': 'Entité modifiée',
  'entite.fermer': 'Entité fermée',
  'entite.rouvrir': 'Entité rouverte',
  'entite.amorcer': 'Entité amorcée au démarrage (équipes racines rattachées)',
  'site.enregistrer': 'Site de rattachement créé ou modifié',
  'equipe.entite': 'Entité d’une équipe racine',
  'equipe.site': 'Site de rattachement d’une équipe',
  'equipe.unite': 'Unité Matrix d’une équipe',
  'organigramme.imprimer': 'Organigramme imprimé',
  'organigramme.exporter': 'Organigramme exporté (CSV)',
  // lot 11 — pwa : saisie du jour rejouable (application mobile) ; notifications sur le téléphone, jamais l'adresse du
  // service de push ni les clés de l'appareil.
  'temps.saisir': 'Saisie d’heures (application mobile)',
  'push.abonner': 'Notifications activées sur un appareil',
  'push.desabonner': 'Notifications désactivées sur un appareil',
  'push.preferences': 'Choix des notifications reçues sur le téléphone',
  'push.desabonnerAppareil': 'Appareil retiré des notifications',
  'push.tester': 'Notification d’essai envoyée',
  // lot 11 — indicateurs (server/src/actions/indicateurs.ts, server/src/indicateurs.ts) : année, périmètre, identifiant de
  // l'arrêté ; export : période, groupement et nombre de lignes. Jamais une valeur d'indicateur, ni le motif d'annulation.
  'indicateurs.arreter': 'Indicateurs sociaux de l’année arrêtés (BDESE)',
  'indicateurs.annulerArrete': 'Arrêté des indicateurs sociaux annulé',
  'indicateurs.marquerCse': 'Arrêté des indicateurs sociaux mis à disposition du CSE',
  'indicateurs.export': 'Indicateurs sociaux exportés (CSV)',
  // lot 11 — dossiers OPCO (server/src/actions/opco.ts) : famille « Formations, plan et budget ».
  'opco.creer': 'Dossier OPCO créé',
  'opco.modifier': 'Dossier OPCO modifié',
  'opco.deposer': 'Dossier OPCO déposé',
  'opco.accorder': 'Accord de l’OPCO enregistré',
  'opco.refuser': 'Refus de l’OPCO enregistré',
  'opco.facturer': 'Justificatifs envoyés à l’OPCO',
  'opco.versement': 'Versement de l’OPCO enregistré',
  'opco.annulerVersement': 'Versement de l’OPCO annulé (saisie erronée)',
  'opco.solder': 'Dossier OPCO soldé',
  'opco.abandonner': 'Dossier OPCO abandonné',
  'opco.rouvrir': 'Dossier OPCO rouvert (retour d’un cran)',
  'opco.supprimer': 'Dossier OPCO supprimé (saisie erronée)',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe, server/src/actions/planning.ts)
  'planning.cycle.creer': 'Cycle de roulement créé',
  'planning.cycle.modifier': 'Cycle de roulement modifié',
  'planning.cycle.archiver': 'Cycle de roulement archivé ou rétabli',
  'planning.besoin.creer': 'Besoin par poste enregistré',
  'planning.besoin.modifier': 'Besoin par poste modifié',
  'planning.besoin.archiver': 'Besoin par poste archivé',
  'planning.roulement.affecter': 'Salarié affecté à un cycle de roulement',
  'planning.roulement.terminer': 'Affectation au roulement terminée',
  'planning.generer': 'Planning d’équipe généré (brouillon)',
  'planning.creneau.ajouter': 'Créneau ajouté au planning',
  'planning.creneau.modifier': 'Créneau du planning modifié',
  'planning.creneau.annuler': 'Créneau du planning annulé ou retiré',
  'planning.publier': 'Planning d’équipe publié',
  'planning.echange.proposer': 'Échange de poste proposé',
  'planning.echange.accepter': 'Échange de poste accepté par le collègue',
  'planning.echange.valider': 'Échange de poste validé',
  'planning.echange.refuser': 'Échange de poste refusé',
  'planning.echange.annuler': 'Échange de poste retiré',
  // lot 12 — C6 (badgeage virtuel)
};

/** Libellé d'un code ; un e-mail simulé (`email.<nature>`, sans boîte d'envoi) est nommé par sa nature. */
export const libelleAction = (code: string) => JOURNAL_LABEL[code]
  ?? (code.startsWith('email.') && Object.hasOwn(EMAIL_LABEL, code.slice(6)) ? `E-mail simulé : ${EMAIL_LABEL[code.slice(6)]}` : code);

/**
 * Droits de la personne connectée : ceux de son profil RH (PROFILS_RH), dans l'espace RH seulement. Lus comme
 * des chaînes : le droit « consultation » (profil en lecture seule : direction, DPO, auditeur) vient d'un autre
 * chantier ; un profil inconnu n'en a aucun.
 */
const droitsDe = (u: Pick<CurrentUser, 'role' | 'profilRh'>): readonly string[] => (u.role === 'rh' && u.profilRh ? droitsRh(u) : []);
/**
 * Journal des actions (consultation, export CSV, archive paie, historique d'une fiche) : droit « rh »
 * (gestionnaire, administrateur) ou « consultation » (lecture seule) ; ni le référent HSE, ni la paie.
 */
export const lecteurJournal = (u: Pick<CurrentUser, 'role' | 'profilRh'>) => droitsDe(u).some(d => d === 'rh' || d === 'consultation');
/**
 * Dossier complet d'un salarié, données de santé comprises : export de toutes ses données (droit d'accès) et
 * journal sans masque ; droit « rh » seul.
 */
export const dossierComplet = (u: Pick<CurrentUser, 'role' | 'profilRh'>) => droitsDe(u).includes('rh');

/** Familles du filtre « Action » : codes commençant par l'un des préfixes (ou égaux à l'un d'eux). */
export const FAMILLES_JOURNAL: { id: string; label: string; prefixes: readonly string[] }[] = [
  // Une entrée par famille (la fusion du lot 11 avait doublé « fiches » et « formations » : clés React en double à l'écran).
  { id: 'fiches', label: 'Fiches et équipes', prefixes: ['employe.', 'equipe.', 'migration.contratsHistorique', /* lot 11 — organigramme */ 'entite.', 'site.', 'organigramme.'] },
  { id: 'formations', label: 'Formations, plan et budget', prefixes: ['plan.', 'cert.', 'session.', 'budget.', 'formationSuivie.', 'migration.coutReel', 'attente.', 'passeport.', 'evaluation.', 'migration.passeportPrevention', 'opco.'] },
  { id: 'habilitations', label: 'Habilitations', prefixes: ['hab.', 'medical.', 'migration.habDelivrances'] },
  { id: 'referentiels', label: 'Référentiels (formations, habilitations, destinations, postes, activités internes)', prefixes: ['referentiel.', 'migration.postes'] },
  { id: 'demandes', label: 'Demandes des collaborateurs', prefixes: ['demande.'] },
  { id: 'deplacements', label: 'Déplacements', prefixes: ['voyage.', 'voyages.', 'formalite.', 'keystone.accepter', 'keystone.refuser', 'migration.detachement', 'migration.referencesDeplacements', 'chantier.', 'migration.deplacementsPaie'] },
  { id: 'temps', label: 'Feuilles de temps et paie', prefixes: ['temps.', 'sage.', 'paie.', 'mandat.', 'forfait.', 'astreinte.', /* lot 12 — C5 (planning d'équipe) */ 'planning.', 'migration.heuresSup', 'migration.lotsPaie', 'migration.absencesPaie', 'migration.rubriquesFeuilles'] },
  { id: 'absences', label: 'Absences et congés', prefixes: ['absence.', 'cet.', 'report.', 'conges.', 'migration.soldes'] },
  { id: 'entretiens', label: 'Entretiens', prefixes: ['entretien.'] },
  { id: 'reprise', label: 'Mise en service (reprise depuis Lucca)', prefixes: ['reprise.'] },
  { id: 'pieces', label: 'Pièces justificatives', prefixes: ['piece.'] },
  // lot 11 — notes de frais
  { id: 'frais', label: 'Notes de frais', prefixes: ['frais.'] },
  { id: 'conservation', label: 'Conservation et agendas', prefixes: ['conservation.', 'agenda.'] },
  { id: 'administration', label: 'Administration et exports', prefixes: ['parametres.', 'demo.', 'compte.', 'envoi.', 'export', 'journal.', 'salarie.', 'donnees.', 'confidentialite.', 'integrite.', 'migration.postgres', 'purge.demo',
    /* lot 11 — indicateurs */ 'indicateurs.'] },
  { id: 'connexions', label: 'Connexions et accès', prefixes: ACTIONS_CONNEXION },
  {
    id: 'integrations', label: 'Intégrations (Keystone, e-mails)',
    prefixes: ['keystone.appel', 'keystone.echec', 'keystone.demande.', 'keystone.heures.', 'keystone.absence.', 'keystone.verdict.', 'keystone.deplacement.', 'email.'],
  },
  // lot 11 — pwa
  { id: 'mobile', label: 'Application mobile et notifications', prefixes: ['push.'] },
  // lot 12 — blocs réservés (socle) : préfixes d'une nouvelle famille (une entrée par famille, jamais une famille en double).
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
];

/** Famille d'un code : la première qui le reconnaît. */
export function familleAction(code: string) {
  return FAMILLES_JOURNAL.find(f => f.prefixes.some(p => (p.endsWith('.') ? code.startsWith(p) : code === p))) ?? null;
}

/** Libellés des champs les plus courants des anciennes et nouvelles valeurs ; un autre champ s'affiche par son nom. */
export const CHAMP_LABEL: Record<string, string> = {
  nom: 'Nom', poste: 'Poste', equipe: 'Équipe', statut: 'Statut', typeContrat: 'Nature du contrat', temps: 'Organisation du temps',
  heures: 'Heures', forfaitHeures: 'Forfait en heures', forfaitJours: 'Forfait en jours', jourOff: 'Jours non travaillés',
  tempsDepuis: 'Date d’effet', entree: 'Date d’entrée', fin: 'Fin de contrat', motifSortie: 'Motif de sortie',
  essaiFin: 'Fin de la période d’essai', essaiRenouveleJusquau: 'Essai renouvelé jusqu’au', expire: 'Expiration', demandeLe: 'Authentification demandée le', verifieLe: 'Vérifié en préfecture le',
  numero: 'Numéro', requise: 'Autorisation de travail requise', titreSejourAlerte: 'Alerte avant l’expiration d’un titre de séjour (jours)',
  titreSejourRelance: 'Relance avant l’expiration d’un titre de séjour (jours)',
  cddRenouvellementsMax: 'Renouvellements admis d’un CDD', cddDureeMaxMois: 'Durée maximale d’un CDD (mois)', cddAccordBranche: 'Accord de branche sur les CDD',
  motifRecours: 'Motif de recours', cddFinInitiale: 'Terme initial du CDD', jusquau: 'Renouvelé jusqu’au', signeLe: 'Avenant signé le', effet: 'Date d’effet', agence: 'Agence', managerId: 'Manager', profilRh: 'Profil RH',
  actif: 'Actif', date: 'Date', lieu: 'Lieu', places: 'Places', du: 'Du', au: 'Au', type: 'Type', justificatif: 'Justificatif reçu',
  signMgr: 'Signature de l’évaluateur', signSal: 'Signature du salarié', horizonAlerte: 'Seuil d’alerte', seuilBudget: 'Seuil budgétaire',
  rtt39: 'Jours de RTT (39 h)', uniquementReglementaire: 'Formations réglementaires seules', partageKeystone: 'Partage des motifs avec Keystone',
  projet: 'Projet', jour: 'Jour',
  // Référentiels
  court: 'Nom court', validite: 'Validité (mois)', duree: 'Durée', dureeHeures: 'Durée (heures)', modele: 'Modèle du titre imprimé', obligatoire: 'Formation obligatoire',
  libelle: 'Intitulé', beneficiaires: 'Bénéficiaires', organisme: 'Organisme', cout: 'Coût', validation: 'Validation', detail: 'Précision',
  prereqs: 'Prérequis', medical: 'Aptitude médicale exigée', signataire: 'Signataire', pays: 'Pays', visa: 'Entrée', visaSub: 'Précision sur l’entrée',
  oblig: 'Vaccins obligatoires', rec: 'Vaccins recommandés', passMois: 'Validité du passeport après l’entrée (mois)', secu: 'Sécurité sociale',
  archive: 'Archivée le', vigilance: 'Vigilance (France Diplomatie)', vigilanceLe: 'Vigilance vérifiée le',
  grandDeplacement: 'Grand déplacement', hebergement: 'Hébergement', contactSurPlace: 'Contact sur place', arianeLe: 'Inscription sur Ariane le',
  // Compte professionnel de prévention (lot 7)
  c2p: 'Facteurs d’exposition (C2P)', alternant: 'Équipes successives alternantes',
  // Horaires de poste et jours fériés (lot 6)
  debut: 'Début', finHoraire: 'Fin', pause: 'Pause (minutes)', horaire: 'Horaire', solidarite: 'Journée de solidarité', solidariteFerie: 'Férié de la journée de solidarité',
  nonChomes: 'Fériés non chômés',
  matriculePaie: 'Matricule de paie', identifiantKeystone: 'Identifiant envoyé à Keystone', politiqueReportCp: 'Politique de report des CP',
  rttAnneeSuivanteDes: 'RTT de l’année suivante posables à partir du',
  cpMaladie: 'Acquisition des CP pendant un arrêt maladie',
  heuresSupMode: 'Heures supplémentaires', heuresSupAccord: 'Accord sur le repos de remplacement', periodeRattachement: 'Semaine à cheval sur deux mois',
  clotureJour: 'Jour de clôture des variables de paie', codeSage: 'Code Sage', confirmeLe: 'Code Sage confirmé le',
  suiviSemaines: 'Semaines du suivi des feuilles de temps', feuilleLimiteJour: 'Feuille de temps attendue le (jour de la semaine suivante)',
  feuilleLimiteHeure: 'Feuille de temps attendue à (heure)',
  separateur: 'Séparateur du fichier d’import', colonnes: 'Ordre des colonnes du fichier d’import', decimale: 'Séparateur décimal du fichier d’import',
  entete: 'Ligne d’en-tête du fichier d’import', formatPeriode: 'Format de la période du fichier d’import',
  // Campagne d'entretiens annuels (Paramètres) ; remise du compte rendu d'entretien ; coût réel d'une action du plan.
  campagneDebut: 'Ouverture de la campagne d’entretiens', campagneFin: 'Clôture de la campagne d’entretiens',
  campagneAncienneteMois: 'Ancienneté minimale pour la campagne (mois)', campagneExclus: 'Contrats exclus de la campagne',
  campagnePreavisJours: 'Affichage de la campagne avant l’ouverture (jours)',
  remiseLe: 'Remise du compte rendu', remiseMode: 'Mode de remise', telechargeLe: 'Premier téléchargement par le salarié',
  coutReel: 'Coût réel', effectifReel: 'Effectif réel',
  // Récapitulatif des échéances (Paramètres → Messagerie) ; annulation d'un déplacement.
  relancesActives: 'Récapitulatif des échéances', relancesPaliers: 'Paliers de relance (jours)', relancesJour: 'Envoi du récapitulatif des échéances',
  // Formations : heures des sessions dans les feuilles de temps (Paramètres → Formations) ; session sur plusieurs jours.
  formationsTemps: 'Heures de formation proposées dans les feuilles de temps', jours: 'Jours de la session',
  // Liste d'attente des sessions complètes (lot 7, t120).
  formationsListeAttente: 'Liste d’attente des sessions complètes', formationsAttenteMode: 'Place libérée (liste d’attente)',
  // Passeport de prévention (lot 7, t066)
  passeportPrevention: 'Passeport de prévention', passeportColonnes: 'Colonnes de l’export du Passeport de prévention',
  annuleLe: 'Annulé le', annuleMotif: 'Motif de l’annulation',
  // Semaine à 7 jours (heures du dimanche), activités internes et mandats au CSE (heures de délégation).
  majorationDimanche: 'Majoration des heures du dimanche (%)', role: 'Mandat', credit: 'Crédit d’heures par mois',
  // Suivi médical : périodicités (Paramètres → Santé), case « suivi individuel renforcé » des habilitations et des postes.
  santeVipMois: 'Périodicité de la visite d’information et de prévention (mois)', santeVipAdapteeMois: 'Périodicité de la VIP adaptée (mois)',
  santeSirIntermediaireMois: 'Suivi renforcé : visite intermédiaire (mois)', santeSirAptitudeMois: 'Suivi renforcé : examen d’aptitude (mois)',
  santeMiCarriereAge: 'Âge de la visite de mi-carrière',
  sir: 'Suivi individuel renforcé',
  expose: 'Exposé à des risques particuliers',
  // Paramètres → Décompte des heures : fériés, heures complémentaires, moyenne sur 12 semaines, contingent.
  feriesTravaillesAutorises: 'Saisie d’heures un jour férié', tauxMajorationFerie: 'Majoration des jours fériés hors 1er mai (%)',
  plafondHeuresComplementaires: 'Plafond des heures complémentaires', heuresComplementairesAccord: 'Accord sur les heures complémentaires',
  moyenne12SemainesMax: 'Moyenne maximale sur 12 semaines (h)', moyenne12SemainesAccord: 'Accord sur la moyenne de 12 semaines',
  contingentHeuresSup: 'Contingent annuel d’heures supplémentaires (h)', contingentAlerte: 'Alerte du contingent (%)',
  contingentAccord: 'Référence du contingent', ferie: 'Jour férié', cor: 'Contrepartie obligatoire en repos (h)',
  // Absences dans le fichier d'import de la paie (Paramètres → Absences et paie).
  absencesFichierPaie: 'Absences dans le fichier d’import de la paie', absencesPaieAPartirDu: 'Absences transmises à la paie à partir du',
  // Pièces justificatives (Paramètres → Pièces justificatives).
  piecesStockage: 'Stockage des pièces justificatives',
  // Sécurité au poste (lot 6) : postes à risques particuliers et formation renforcée (art. L4154-2), couverture minimale des
  // équipes, entretien de parcours après la visite de mi-carrière.
  risquesL4154: 'Poste à risques particuliers (art. L4154-2)', formationRenforceeCode: 'Formation renforcée à la sécurité',
  couverture: 'Couverture minimale', couvertureAvant: 'Couverture minimale avant',
  entretienMiCarriereActif: 'Entretien de parcours après la visite de mi-carrière', entretienMiCarriereMois: 'Délai de l’entretien de mi-carrière (mois)',
  // Hiérarchie des managers (Paramètres → Hiérarchie, équipe parente).
  consultationN2: 'Consultation N+2 des équipes rattachées', parente: 'Équipe parente',
  delegationEntretiens: 'Délégation des entretiens au suppléant', revoqueeLe: 'Révoquée le',
  deplacementsFichierPaie: 'Déplacements dans le fichier d’import de la paie', deplacementsPaieAPartirDu: 'Déplacements transmis à la paie à partir du',
  vigilanceRappelJours: 'Rappel de vérification de la vigilance (jours)',
  // Travail de nuit (Paramètres → Décompte des heures, shared/rules/repos-nuit.ts) ; contrôles des horaires au journal.
  nuitDebut: 'Début de la plage de nuit (h)', nuitFin: 'Fin de la plage de nuit (h)', nuitSeuilQuotidien: 'Travailleur de nuit : heures de nuit dans la journée',
  nuitSeuilAnnuel: 'Travailleur de nuit : heures de nuit sur 12 mois', nuitMajoration: 'Majoration des heures de nuit (%)', nuitAccord: 'Référence de l’accord sur le travail de nuit',
  reposNuit: 'Contrôles des horaires motivés', majNuit: 'Majoration des heures de nuit (%)',
  // Forfait jours (Paramètres → Forfait jours, t043) ; avenant de renonciation.
  forfaitJoursAlerte: 'Alerte du cumul du forfait jours (%)', forfaitJoursRachat: 'Renonciation à des jours de repos (forfait jours)',
  forfaitJoursAccord: 'Accord collectif sur le forfait jours', forfaitJoursPlafond: 'Plafond des jours travaillés avec avenant',
  forfaitJoursMajorationMin: 'Majoration minimale des jours rachetés (%)', forfaitJoursJren: 'Période de paie des jours rachetés',
  annee: 'Année', taux: 'Majoration (%)',
  fractionnementRegle: 'Règle des jours de fractionnement', fractionnementAccord: 'Accord sur le fractionnement des congés',
  fractionnementDebut: 'Début de la période du congé principal', fractionnementFin: 'Fin de la période du congé principal',
  cetPlafondRtt: 'Plafond de RTT placés sur le CET par an', cetPlafondCp: 'Plafond de CP placés sur le CET par période',
  // Conservation des dossiers (Paramètres → Conservation des dossiers) et agenda personnel (Paramètres → Agenda).
  conservationActive: 'Propositions d’effacement des dossiers échus', conservationDecisionDpo: 'Décision du DPO sur les durées de conservation',
  conservationDossierAns: 'Conservation du dossier (ans après la sortie)', conservationTempsAns: 'Conservation du temps de travail (ans)',
  conservationPaieAns: 'Conservation des éléments de paie (ans)', conservationSanteAns: 'Conservation des données de santé (ans)',
  conservationPasseportAns: 'Conservation du passeport et des visas (ans)', conservationTitreSejourAns: 'Conservation du titre de séjour (ans)',
  conservationEntretiensAns: 'Conservation des entretiens (ans)', conservationFormationsAns: 'Conservation des formations (ans)',
  agendaFluxActif: 'Abonnement à l’agenda personnel', agendaContenu: 'Contenu de l’agenda personnel',
  // Astreintes (t049, lot 7) : réglages et colonnes d'une astreinte.
  astreinteDelaiPrevenance: 'Astreintes : délai de prévenance (jours)', astreinteCompensation: 'Astreintes : forme de la compensation',
  astreinteMineurs: 'Astreintes : salariés mineurs admis', astreinteAccord: 'Référence de l’accord sur les astreintes',
  communiqueLe: 'Communiquée le',
  // lot 11 — organigramme : réglage, colonnes d'une entité, d'un site et d'une équipe.
  organigrammeOuvert: 'Organigramme ouvert à', entite: 'Entité', siteCode: 'Site', uniteCode: 'Unité Matrix', siren: 'SIREN', siret: 'SIRET',
  idcc: 'IDCC', fermeLe: 'Fermée le',
  // lot 11 — indicateurs : réglages, champs de la fiche (nommés au journal, jamais leur valeur) et colonnes d'un arrêté.
  indicateursSeuil: 'Indicateurs sociaux : seuil d’anonymat', absenteismeNatures: 'Absentéisme : natures comptées',
  sexe: 'Sexe', categorie: 'Catégorie d’emploi', cseLe: 'Mis à disposition du CSE le',
  // lot 11 — dossiers OPCO : réglages et colonnes d'un dossier (montants des seuls dossiers non nominatifs).
  opcoDefaut: 'OPCO proposé', opcoSubrogation: 'Subrogation proposée', opcoDelaiDepot: 'OPCO : dépôt avant le début (jours)',
  opcoDelaiJustificatifs: 'OPCO : justificatifs après la fin (jours)', opcoDelaiRemboursement: 'OPCO : relance du remboursement (jours)',
  opco: 'OPCO', dispositif: 'Dispositif', reference: 'Numéro de dossier', montantDemande: 'Montant demandé', montantDemandeAnnexes: 'Frais annexes demandés',
  subrogation: 'Subrogation', organismeSiret: 'SIRET de l’organisme', organismeNda: 'Déclaration d’activité de l’organisme', organismeQualiopi: 'Organisme certifié Qualiopi',
  deposeLe: 'Déposé le', accordLe: 'Accordé le', montantAccorde: 'Montant accordé', accordReference: 'Référence de l’accord', plafondHoraire: 'Plafond horaire',
  refusLe: 'Refusé le', refusMotif: 'Motif du refus', factureLe: 'Justificatifs envoyés le', montantFacture: 'Montant facturé', soldeLe: 'Soldé le',
  soldeEcart: 'Écart au solde', soldeNature: 'Nature de l’écart', abandonLe: 'Abandonné le', abandonMotif: 'Motif de l’abandon', planActionId: 'Action du plan',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe) : réglages, colonnes d'un cycle, d'un besoin par poste et d'une affectation.
  planningActif: 'Planning d’équipe activé', planningDelaiPrevenance: 'Planning : délai de prévenance (jours)',
  planningReposQuotidienAccord: 'Planning : repos quotidien de l’accord (heures)', planningNuitJour: 'Planning : durée d’un poste de nuit (heures)',
  planningNuitMoyenne: 'Planning : moyenne du travailleur de nuit sur 12 semaines (heures)', planningAccord: 'Référence de l’accord sur le planning',
  planningCollegues: 'Planning des collègues visible du salarié',
  longueur: 'Longueur du cycle (jours)', sequence: 'Séquence des horaires', groupes: 'Groupes et décalages', origine: 'Jour d’origine du cycle',
  effectifMin: 'Effectif minimal', posteId: 'Poste', exigences: 'Exigences du créneau',
  // lot 12 — C6 (badgeage virtuel)
};

const valeur = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (Array.isArray(v)) return v.length ? v.map(valeur).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Anciennes et nouvelles valeurs d'une ligne : « Poste : Technicien → Technicien confirmé · Équipe : … ». */
export function changementsTexte(payload: unknown): string {
  const p = (payload ?? {}) as { avant?: Record<string, unknown>; apres?: Record<string, unknown> };
  if (!p.avant && !p.apres) return '';
  const avant = p.avant ?? {}, apres = p.apres ?? {};
  return [...new Set([...Object.keys(avant), ...Object.keys(apres)])]
    .map(k => `${CHAMP_LABEL[k] ?? k} : ${valeur(avant[k])} → ${valeur(apres[k])}`).join(' · ');
}
