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
  'temps.validate', 'temps.correction', 'temps.pushSage', 'absence.decider', 'absence.qualifier', 'absence.saisir', 'absence.prolonger', 'absence.annuler',
  // Clôture des congés (report ou perte du solde de chaque salarié, à justifier en cas de litige) et datation des
  // compteurs repris de l'ancien système (période sur laquelle ils sont décomptés).
  'conges.cloturer', 'migration.soldes',
  // Sortie (solde de tout compte, absences qu'elle annule) et solde de RTT gardé avant un changement de régime.
  'employe.sortie', 'employe.annulerSortie', 'employe.rtt',
  // Paie : correspondance des rubriques avec le plan de paie Sage, mode des heures supplémentaires figé sur les feuilles.
  'paie.rubrique', 'migration.heuresSup',
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
  'equipe.creer': 'Création d’une équipe',
  'equipe.renommer': 'Équipe renommée',
  'equipe.supprimer': 'Suppression d’une équipe',
  'equipe.manager': 'Manager d’une équipe',
  'equipe.affecter': 'Affectation à une équipe',
  // Formations
  'plan.inscrire': 'Inscription à une session',
  'cert.ajouter': 'Certification enregistrée',
  'session.creer': 'Création d’une session',
  'session.confirmer': 'Session confirmée',
  'session.modifier': 'Session modifiée',
  'session.annuler': 'Session annulée',
  'session.cloturer': 'Session clôturée',
  'plan.importer': 'Import du plan de formation',
  'plan.avancer': 'Avancement du plan de formation',
  'budget.enveloppes': 'Enveloppes budgétaires',
  // Habilitations
  'hab.delivrer': 'Habilitation délivrée',
  'hab.suspendre': 'Habilitation suspendue',
  'hab.lever': 'Suspension levée',
  'hab.retirer': 'Habilitation retirée',
  'medical.demander': 'Visite médicale demandée',
  'medical.annuler': 'Demande de visite annulée',
  'medical.avis': 'Avis du médecin du travail',
  // Référentiels
  'referentiel.formation.enregistrer': 'Formation du catalogue créée ou modifiée',
  'referentiel.formation.archiver': 'Formation archivée ou rétablie',
  'referentiel.habilitation.enregistrer': 'Habilitation du référentiel créée ou modifiée',
  'referentiel.habilitation.archiver': 'Habilitation archivée ou rétablie',
  'referentiel.destination.enregistrer': 'Destination créée ou modifiée',
  'referentiel.destination.archiver': 'Destination archivée ou rétablie',
  'referentiel.charger': 'Référentiel type chargé',
  // Demandes des collaborateurs
  'demande.formation': 'Demande de formation',
  'demande.habilitation': 'Demande d’habilitation',
  'demande.accepter': 'Demande acceptée',
  'demande.refuser': 'Demande refusée',
  // Déplacements
  'voyage.creer': 'Déplacement créé',
  'voyage.detachement': 'Formalités de détachement',
  'formalite.enregistrer': 'Formalité de voyage',
  'voyages.importer': 'Import de déplacements',
  'keystone.accepter': 'Demande de Keystone acceptée',
  'keystone.refuser': 'Demande de Keystone refusée',
  // Temps et paie
  'temps.setCell': 'Saisie d’heures',
  'temps.addLine': 'Ligne ajoutée à une feuille de temps',
  'temps.removeLine': 'Ligne retirée d’une feuille de temps',
  'temps.suggest': 'Heures proposées depuis Keystone',
  'temps.submit': 'Feuille de temps soumise',
  'temps.validate': 'Feuille de temps validée',
  'temps.reject': 'Feuille de temps renvoyée',
  'temps.correction': 'Correction d’heures par le manager ou le RH',
  'temps.pushSage': 'Transmission à la paie',
  'paie.rubrique': 'Rubrique de paie Sage',
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
  // Entretiens
  'entretien.planifier': 'Entretien planifié',
  'entretien.modifier': 'Compte rendu d’entretien rédigé',
  'entretien.clore': 'Entretien clos',
  'entretien.signer': 'Entretien signé par le salarié',
  // Administration
  'parametres.maj': 'Paramètres modifiés',
  'demo.reinitialiser': 'Démonstration réinitialisée',
  'compte.creer': 'Compte créé',
  'compte.profil': 'Profil RH modifié',
  'compte.activer': 'Compte activé ou désactivé',
  'compte.reinitialiser': 'Accès réinitialisé',
  'compte.admin': 'Administrateur RH désigné (ligne de commande)',
  'envoi.relancer': 'Envoi relancé',
  'envoi.classer': 'Échec d’envoi classé',
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
  'sage.echec': 'Envoi à Sage Paie en échec',
  // Mise à jour de la base
  'migration.detachement': 'Reprise des formalités de détachement',
  'migration.soldes': 'Datation des compteurs repris et des reports de CP',
  'migration.heuresSup': 'Reprise : mode des heures supplémentaires figé sur les feuilles validées',
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
  { id: 'fiches', label: 'Fiches et équipes', prefixes: ['employe.', 'equipe.'] },
  { id: 'formations', label: 'Formations, plan et budget', prefixes: ['plan.', 'cert.', 'session.', 'budget.'] },
  { id: 'habilitations', label: 'Habilitations', prefixes: ['hab.', 'medical.'] },
  { id: 'referentiels', label: 'Référentiels (formations, habilitations, destinations)', prefixes: ['referentiel.'] },
  { id: 'demandes', label: 'Demandes des collaborateurs', prefixes: ['demande.'] },
  { id: 'deplacements', label: 'Déplacements', prefixes: ['voyage.', 'voyages.', 'formalite.', 'keystone.accepter', 'keystone.refuser', 'migration.detachement'] },
  { id: 'temps', label: 'Feuilles de temps et paie', prefixes: ['temps.', 'sage.', 'paie.', 'migration.heuresSup'] },
  { id: 'absences', label: 'Absences et congés', prefixes: ['absence.', 'cet.', 'report.', 'conges.', 'migration.soldes'] },
  { id: 'entretiens', label: 'Entretiens', prefixes: ['entretien.'] },
  { id: 'administration', label: 'Administration et exports', prefixes: ['parametres.', 'demo.', 'compte.', 'envoi.', 'export', 'journal.', 'salarie.', 'donnees.'] },
  { id: 'connexions', label: 'Connexions et accès', prefixes: ACTIONS_CONNEXION },
  {
    id: 'integrations', label: 'Intégrations (Keystone, e-mails)',
    prefixes: ['keystone.appel', 'keystone.echec', 'keystone.demande.', 'keystone.heures.', 'keystone.absence.', 'keystone.verdict.', 'email.'],
  },
];

/** Famille d'un code : la première qui le reconnaît. */
export function familleAction(code: string) {
  return FAMILLES_JOURNAL.find(f => f.prefixes.some(p => (p.endsWith('.') ? code.startsWith(p) : code === p))) ?? null;
}

/** Libellés des champs les plus courants des anciennes et nouvelles valeurs ; un autre champ s'affiche par son nom. */
export const CHAMP_LABEL: Record<string, string> = {
  nom: 'Nom', poste: 'Poste', equipe: 'Équipe', statut: 'Statut', typeContrat: 'Nature du contrat', temps: 'Organisation du temps',
  heures: 'Heures', forfaitHeures: 'Forfait en heures', forfaitJours: 'Forfait en jours', jourOff: 'Jours non travaillés',
  tempsDepuis: 'Date d’effet', entree: 'Date d’entrée', fin: 'Fin de contrat', motifSortie: 'Motif de sortie', agence: 'Agence', managerId: 'Manager', profilRh: 'Profil RH',
  actif: 'Actif', date: 'Date', lieu: 'Lieu', places: 'Places', du: 'Du', au: 'Au', type: 'Type', justificatif: 'Justificatif reçu',
  signMgr: 'Signature de l’évaluateur', signSal: 'Signature du salarié', horizonAlerte: 'Seuil d’alerte', seuilBudget: 'Seuil budgétaire',
  rtt39: 'Jours de RTT (39 h)', uniquementReglementaire: 'Formations réglementaires seules', partageKeystone: 'Partage des motifs avec Keystone',
  projet: 'Projet', jour: 'Jour',
  // Référentiels
  court: 'Nom court', validite: 'Validité (mois)', duree: 'Durée', organisme: 'Organisme', cout: 'Coût', validation: 'Validation', detail: 'Précision',
  prereqs: 'Prérequis', medical: 'Aptitude médicale exigée', signataire: 'Signataire', pays: 'Pays', visa: 'Entrée', visaSub: 'Précision sur l’entrée',
  oblig: 'Vaccins obligatoires', rec: 'Vaccins recommandés', passMois: 'Validité du passeport après l’entrée (mois)', secu: 'Sécurité sociale',
  archive: 'Archivée le',
  matriculePaie: 'Matricule de paie', identifiantKeystone: 'Identifiant envoyé à Keystone', politiqueReportCp: 'Politique de report des CP',
  rttAnneeSuivanteDes: 'RTT de l’année suivante posables à partir du',
  heuresSupMode: 'Heures supplémentaires', heuresSupAccord: 'Accord sur le repos de remplacement', periodeRattachement: 'Semaine à cheval sur deux mois',
  clotureJour: 'Jour de clôture des variables de paie', codeSage: 'Code Sage', confirmeLe: 'Code Sage confirmé le',
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
