// Journal des actions : libellés français, familles (filtre « Action »), actions liées à la paie et durées
// de conservation, mise en forme des anciennes et nouvelles valeurs. Partagé par le serveur (consultation,
// export CSV, conservation : server/src/journal.ts) et l'écran Paramètres → Journal des actions.

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
 * manager ou le RH, qualifiées ou saisies d'emblée), corrections d'heures sur une feuille soumise et
 * transmissions à la paie (Sage).
 */
export const ACTIONS_PAIE: readonly string[] = ['temps.validate', 'temps.correction', 'temps.pushSage', 'absence.decider', 'absence.qualifier', 'absence.saisir'];
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
  // Demandes des collaborateurs
  'demande.formation': 'Demande de formation',
  'demande.habilitation': 'Demande d’habilitation',
  'demande.accepter': 'Demande acceptée',
  'demande.refuser': 'Demande refusée',
  // Déplacements
  'voyage.creer': 'Déplacement créé',
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
  'temps.correction': 'Correction d’heures d’une feuille soumise',
  'temps.pushSage': 'Transmission à la paie',
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
};

export const libelleAction = (code: string) => JOURNAL_LABEL[code] ?? code;

/** Familles du filtre « Action » : codes commençant par l'un des préfixes (ou égaux à l'un d'eux). */
export const FAMILLES_JOURNAL: { id: string; label: string; prefixes: readonly string[] }[] = [
  { id: 'fiches', label: 'Fiches et équipes', prefixes: ['employe.', 'equipe.'] },
  { id: 'formations', label: 'Formations, plan et budget', prefixes: ['plan.', 'cert.', 'session.', 'budget.'] },
  { id: 'habilitations', label: 'Habilitations', prefixes: ['hab.', 'medical.'] },
  { id: 'demandes', label: 'Demandes des collaborateurs', prefixes: ['demande.'] },
  { id: 'deplacements', label: 'Déplacements', prefixes: ['voyage.', 'voyages.', 'formalite.', 'keystone.accepter', 'keystone.refuser'] },
  { id: 'temps', label: 'Feuilles de temps et paie', prefixes: ['temps.', 'sage.'] },
  { id: 'absences', label: 'Absences et congés', prefixes: ['absence.', 'cet.', 'report.'] },
  { id: 'entretiens', label: 'Entretiens', prefixes: ['entretien.'] },
  { id: 'administration', label: 'Administration et exports', prefixes: ['parametres.', 'demo.', 'compte.', 'envoi.', 'export', 'journal.', 'salarie.', 'donnees.'] },
  { id: 'connexions', label: 'Connexions et accès', prefixes: ACTIONS_CONNEXION },
  { id: 'integrations', label: 'Intégrations (Keystone)', prefixes: ['keystone.appel', 'keystone.echec', 'keystone.demande.', 'keystone.heures.', 'keystone.absence.', 'keystone.verdict.'] },
];

/** Famille d'un code : la première qui le reconnaît. */
export function familleAction(code: string) {
  return FAMILLES_JOURNAL.find(f => f.prefixes.some(p => (p.endsWith('.') ? code.startsWith(p) : code === p))) ?? null;
}

/** Libellés des champs les plus courants des anciennes et nouvelles valeurs ; un autre champ s'affiche par son nom. */
export const CHAMP_LABEL: Record<string, string> = {
  nom: 'Nom', poste: 'Poste', equipe: 'Équipe', statut: 'Statut', typeContrat: 'Nature du contrat', temps: 'Organisation du temps',
  heures: 'Heures', forfaitHeures: 'Forfait en heures', forfaitJours: 'Forfait en jours', jourOff: 'Jours non travaillés',
  tempsDepuis: 'Date d’effet', entree: 'Date d’entrée', fin: 'Fin de contrat', agence: 'Agence', managerId: 'Manager', profilRh: 'Profil RH',
  actif: 'Actif', date: 'Date', lieu: 'Lieu', places: 'Places', du: 'Du', au: 'Au', type: 'Type', justificatif: 'Justificatif reçu',
  signMgr: 'Signature de l’évaluateur', signSal: 'Signature du salarié', horizonAlerte: 'Seuil d’alerte', seuilBudget: 'Seuil budgétaire',
  rtt39: 'Jours de RTT (39 h)', uniquementReglementaire: 'Formations réglementaires seules', partageKeystone: 'Partage des motifs avec Keystone',
  projet: 'Projet', jour: 'Jour',
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
