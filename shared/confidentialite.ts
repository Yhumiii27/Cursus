// Information des salariés sur le traitement de leurs données (art. 13 du RGPD) : texte de la page Confidentialité,
// ouverte depuis l'écran de connexion et depuis tous les espaces (client/src/pages/Confidentialite.tsx). Le descriptif
// complet du traitement, pour le registre et l'analyse d'impact de l'employeur, est dans docs/RGPD.md : les deux se
// tiennent à jour ensemble. Modèle à faire valider par le DPO : ce que l'entreprise n'a pas encore tranché (durées de
// conservation des dossiers, hébergeur et lieu de stockage) porte la mention « à compléter par le DPO ». Responsable du
// traitement et contact du DPO : réglage `confidentialite` (Paramètres → Confidentialité, administrateur RH) ; vides,
// la page renvoie au service RH.
import { CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_ENVOIS_MOIS, CONSERVATION_JOURNAL_MOIS } from './journal.ts';

/** Coordonnées réglées par l'administrateur RH, lisibles sans connexion (GET /api/confidentialite). */
export interface ContactsConfidentialite {
  /** Responsable du traitement : raison sociale et adresse de l'employeur. */
  responsable: string | null;
  /** Délégué à la protection des données (ou référent) : nom et moyen de le joindre. */
  dpo: string | null;
}
export const CONTACTS_VIDES: ContactsConfidentialite = { responsable: null, dpo: null };
/** Longueur maximale de chaque coordonnée. */
export const CONTACT_MAX = 300;
/** Mention des informations que l'entreprise n'a pas encore fixées. */
export const A_COMPLETER = 'à compléter par le DPO';

/**
 * Coordonnée saisie : texte nettoyé (espaces, retours à la ligne), vide = aucune. Renvoie la valeur, ou le message
 * d'erreur (trop longue). Partagé par la section de Paramètres et l'action `confidentialite.regler`.
 */
export function controleContact(v: unknown, libelle: string): { valeur: string | null } | { erreur: string } {
  if (v == null) return { valeur: null };
  if (typeof v !== 'string') return { erreur: `${libelle} : texte attendu` };
  // Caractères de contrôle retirés (tabulations, retours à la ligne gardés pour une adresse sur plusieurs lignes).
  const t = v.replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > CONTACT_MAX) return { erreur: `${libelle} : ${CONTACT_MAX} caractères au plus` };
  return { valeur: t || null };
}

export interface RubriqueConfidentialite { id: string; titre: string; intro?: string; points: readonly (readonly [string, string])[] }

const ans = (mois: number) => (mois % 12 === 0 ? `${mois / 12} an${mois > 12 ? 's' : ''}` : `${mois} mois`);

/** Rubriques de la page Confidentialité, dans l'ordre d'affichage (le responsable et le DPO viennent avant). */
export const INFO_CONFIDENTIALITE: readonly RubriqueConfidentialite[] = [
  {
    id: 'finalites', titre: 'Pourquoi Cursus traite vos données',
    intro: 'Cursus est l’outil RH du site. Il ne sert qu’à la gestion du personnel, jamais à une décision automatique vous concernant.',
    points: [
      ['Formations et habilitations', 'suivre les formations obligatoires et leurs recyclages, délivrer et suspendre les habilitations, organiser les sessions et vous y convoquer.'],
      ['Santé au travail', 'savoir si votre aptitude médicale est à jour et respecter les restrictions de poste décidées par le médecin du travail ; demander vos visites au service de santé au travail.'],
      ['Temps de travail', 'enregistrer vos heures par projet, les faire valider par votre manager, calculer les heures supplémentaires et transmettre les variables de paie.'],
      ['Congés et absences', 'demander et valider vos congés, suivre vos soldes, enregistrer les absences et leurs justificatifs.'],
      ['Entretiens professionnels', 'planifier vos entretiens obligatoires (parcours professionnel, état des lieux à 8 ans, forfait jours) et en conserver les comptes rendus signés.'],
      ['Déplacements et chantiers', 'préparer vos déplacements (passeport, visas, vaccinations, détachement) et vérifier, avant une affectation sur un chantier, que vous êtes disponible, apte et habilité (verdict « Go / No Go »).'],
      ['Sécurité de l’outil', 'gérer votre compte, tracer qui a fait quoi (journal des actions) et protéger l’accès.'],
    ],
  },
  {
    id: 'donnees', titre: 'Quelles données',
    points: [
      ['Identité et contrat', 'nom, poste, équipe, manager, statut, contrat et organisation du temps, dates d’entrée et de fin, date de naissance (congés supplémentaires de la convention collective, entretiens de fin de carrière, règles des salariés de moins de 18 ans ; votre manager n’en voit que l’année et, le cas échéant, l’indication « mineur »), avant 18 ans la date de la dérogation pour travaux réglementés déclarée à l’inspection du travail, adresse e-mail professionnelle, agence d’intérim.'],
      ['Compétences', 'formations suivies, certifications, habilitations et leurs mesures (suspension, retrait).'],
      ['Santé (données sensibles)', 'date de la dernière visite médicale, avis d’aptitude et restrictions de poste ; vaccins et dates d’injection pour les déplacements. Jamais de diagnostic : seule la nature des absences pour raison de santé (arrêt, accident du travail) est connue du service RH.'],
      ['Temps et absences', 'heures par jour et par projet, motifs de dépassement, congés, absences et soldes.'],
      ['Entretiens', 'comptes rendus rédigés par votre évaluateur et par vous, signatures.'],
      ['Déplacements', 'destinations et dates, numéro et validité du passeport, visas, formalités de détachement ; coordonnées sur place (hébergement, contact local) et date d’inscription sur Ariane, tenues par le service RH ; jours de grand déplacement, jours à l’étranger et trajets transmis à la paie.'],
      ['Pièces justificatives', 'si le service RH active leur dépôt : attestations de formation, titres d’habilitation signés, justificatifs d’absence (avis d’arrêt de travail…) et copies des documents que vous déclarez, jointes à votre dossier ; votre manager n’en voit que les attestations et titres d’habilitation.'],
      ['Contact d’urgence', 'nom et téléphone de la personne à prévenir, indiqués par vous depuis votre espace ou par le service RH à votre demande (facultatif) : vus du service RH seulement, jamais de votre manager ; à retirer quand vous le souhaitez.'],
      ['Connexion', 'identifiant, profil, dates de connexion et adresse IP, journal des actions effectuées ; journaux techniques du serveur (numéro de compte, adresse consultée, heure et résultat de chaque requête, jamais son contenu).'],
    ],
  },
  {
    id: 'bases', titre: 'Sur quelle base',
    points: [
      ['Contrat de travail', 'temps de travail, congés, paie, formations, entretiens et déplacements (art. 6.1.b du RGPD).'],
      ['Obligations légales', 'durée du travail, entretiens professionnels (art. L6315-1 du Code du travail), formation à la sécurité et habilitations, suivi de l’état de santé et obligation de sécurité de l’employeur (art. L4121-1), détachement (art. 6.1.c du RGPD).'],
      ['Données de santé', 'obligations de l’employeur en matière de droit du travail et de santé au travail (art. 9.2.b et 9.2.h du RGPD).'],
      ['Intérêt légitime', 'sécurité de l’outil et du journal des actions, planification des chantiers (art. 6.1.f du RGPD).'],
    ],
  },
  {
    id: 'destinataires', titre: 'Qui y a accès',
    points: [
      ['Vous', 'toutes vos données, depuis votre espace ; « Télécharger mes données » sur l’accueil en donne une copie complète.'],
      ['Service RH', 'toutes les données du personnel, santé comprise.'],
      ['Votre manager', 'son équipe seulement, sans donnée de santé : il voit l’avis d’aptitude et les restrictions en vigueur, jamais la date de la visite ni les vaccins, ni la nature d’un arrêt de travail.'],
      ['Profils restreints', 'le référent HSE (formations et habilitations ; pour les chantiers, l’état des dossiers de déplacement et les dates d’absence des personnes affectées, sans leur nature), le gestionnaire de paie (temps, absences et soldes) et la consultation (direction, DPO, auditeur), chacun sans donnée de santé détaillée.'],
      ['Outils et prestataires', 'Keystone, l’outil de planification des chantiers (matricule, verdict et motifs codés, heures validées par projet, dates d’absence sans leur nature) ; Sage Paie (variables de paie) ; Microsoft 365 (connexion et envoi des e-mails) ; les agences d’intérim (relevé des heures validées de leurs intérimaires) ; le service de santé au travail (demande de visite, sans information médicale) ; les organismes de formation (liste des inscrits) ; l’hébergeur de Cursus (' + A_COMPLETER + ').'],
    ],
  },
  {
    id: 'durees', titre: 'Combien de temps',
    points: [
      ['Journal des actions', `${ans(CONSERVATION_JOURNAL_MOIS)} ; les actions liées à la paie sont ensuite archivées, hors de l’écran, jusqu’à ${ans(CONSERVATION_ARCHIVE_PAIE_MOIS)}.`],
      ['Journaux techniques du serveur', 'un an au plus, consultés seulement par le service informatique.'],
      ['Messages envoyés par Cursus', `${ans(CONSERVATION_ENVOIS_MOIS)} dans la file d’envoi.`],
      ['Dossier du salarié', `pendant le contrat, puis pendant une durée fixée par l’entreprise avec son DPO (${A_COMPLETER} ; référence usuelle : 5 ans après le départ, 3 ans pour le temps de travail) ; à son terme, le service RH confirme l’anonymisation du dossier que Cursus lui propose : votre nom disparaît, les heures et les coûts restent sans nom.`],
      ['Données de santé et vaccinations', `durée fixée de même (${A_COMPLETER} ; référence usuelle : 5 ans après le départ), effacées sur confirmation du service RH ; tant que ces durées ne sont pas validées, rien n’est effacé.`],
      ['Passeport, visas et titre de séjour', `passeport et visas effacés après votre départ, titre de séjour 5 ans après (registre unique du personnel), sur confirmation du service RH (${A_COMPLETER}).`],
      ['Pièces justificatives', `comme le dossier qu’elles justifient ; une pièce retirée ou jointe à une déclaration refusée est effacée, ses copies quittent les sauvegardes avec leur rotation.`],
      ['Sauvegardes', `copies chiffrées, gardées selon le calendrier du service informatique (${A_COMPLETER}).`],
    ],
  },
  {
    id: 'securite', titre: 'Comment elles sont protégées',
    points: [
      ['Accès', 'un compte nominatif par personne (Microsoft 365 de l’entreprise, ou compte Cursus avec mot de passe personnel), sessions limitées à 12 heures, droits limités à ce que chaque profil doit voir.'],
      ['Transport et stockage', 'connexion chiffrée (HTTPS), base hébergée par le service informatique de l’entreprise (lieu d’hébergement : ' + A_COMPLETER + '), sauvegardes chiffrées avant de quitter la machine.'],
      ['Traçabilité', 'chaque action est tracée sans texte libre ni donnée de santé ; les exports et les consultations de l’archive aussi.'],
    ],
  },
  {
    id: 'droits', titre: 'Vos droits',
    points: [
      ['Accès et copie', 'depuis l’accueil de votre espace (« Télécharger mes données ») ; le journal des actions qui vous concernent vous est remis par le service RH.'],
      ['Rectification', 'demandez au service RH de corriger une information inexacte ; vos documents de voyage se déclarent depuis votre espace.'],
      ['Effacement, limitation, opposition', 'auprès du service RH ou du DPO, dans les limites des obligations légales de l’employeur (paie, temps de travail, santé au travail) ; après votre départ, le service RH efface aussitôt ce qu’aucune obligation n’impose de garder (passeport, entretiens…) ; votre identité et votre titre de séjour (registre unique du personnel, 5 ans après le départ) restent jusqu’à leur échéance.'],
      ['Réclamation', 'auprès de la CNIL (cnil.fr), si vous estimez que vos droits ne sont pas respectés.'],
    ],
  },
];
