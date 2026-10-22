// Page Aide (lot 5, t155) : guide court par rôle, pour le groupe pilote puis pour tout le site. Une partie par public
// (collaborateur, manager, service RH, gestionnaire de paie), la mise en service progressive (groupe pilote) et ce qui reste
// à faire par l'entreprise avant le 1er janvier 2027. Version longue, avec la procédure mensuelle de paie détaillée :
// docs/GUIDE-UTILISATEUR.md, qui reprend les mêmes parties (tests/aide.test.ts le vérifie, ainsi que l'existence à l'écran
// de chaque libellé cité entre « »). Le calendrier de paie n'est pas encore connu : ses dates restent « à compléter par le
// gestionnaire de paie » (réglages par défaut : clôture des variables le dernier jour du mois, Paramètres → Paie).
// Aucune donnée d'un salarié : la page s'ouvre dans tous les espaces et depuis l'écran de connexion.
import type { ProfilRh, Role } from './types.ts';

/** Mention mise en valeur à l'écran : ce que le gestionnaire de paie doit encore préciser. */
export const A_COMPLETER_PAIE = 'à compléter par le gestionnaire de paie';

export type PartieAideId = 'collaborateur' | 'manager' | 'rh' | 'paie' | 'pilote' | 'entreprise';

/** Rubrique : une procédure (étapes numérotées) ou une liste de points. */
export interface RubriqueAide { titre: string; intro?: string; etapes?: readonly string[]; points?: readonly string[] }
export interface PartieAide { id: PartieAideId; titre: string; court: string; pour: string; rubriques: readonly RubriqueAide[] }

export const GUIDE_AIDE: readonly PartieAide[] = [
  {
    id: 'collaborateur', titre: 'Collaborateur', court: 'Collaborateur',
    pour: 'Chaque salarié : ses heures, ses absences, ses formations et ses entretiens.',
    rubriques: [
      {
        titre: 'Se connecter',
        points: [
          'Avec un compte Microsoft 365 de l’entreprise : « Se connecter avec Microsoft ». Sinon (ouvriers, intérimaires, alternants), l’identifiant et le mot de passe provisoire remis par le service RH, à remplacer à la première connexion (12 caractères au moins).',
          'Une session dure 12 heures au plus : reconnectez-vous chaque jour. Si elle expire pendant une saisie, la reconnexion s’affiche par-dessus l’écran, sans perdre ce qui était tapé.',
          'Mot de passe oublié ou compte bloqué : le service RH vous attribue un nouveau mot de passe provisoire. « Changer mon mot de passe » et « Se déconnecter » sont en bas du menu.',
        ],
      },
      {
        titre: 'Saisir sa semaine',
        etapes: [
          'Menu « Mes heures ». La semaine affichée est la semaine en cours (« Cette semaine » y revient, les flèches changent de semaine).',
          'Ajoutez une ligne par projet (« + Ajouter un projet… ») ou reprenez les tâches prévues (« Proposer depuis Keystone »). Inscrit à une session de formation cette semaine-là, le bouton devient « Proposer les heures prévues » (tâches et heures de formation), ou « Proposer les heures de formation » sans tâche Keystone.',
          'Tapez les heures de chaque jour, en heures décimales (7,5 pour 7 h 30) : chaque cellule s’enregistre seule quand vous la quittez. Sur téléphone, la saisie se fait jour par jour.',
          'Ligne « Horaire du jour » : l’horaire de poste de chaque jour (journée, matin, après-midi, nuit…), proposé en italique d’après votre équipe dès que des heures sont saisies ; changez-le si besoin, ou choisissez « — » pour aucun. Il est facultatif et se fige à la soumission. Avec un horaire, la feuille compte vos heures de nuit et signale un repos de moins de 11 h entre deux jours ou une pause trop courte (motif demandé) ; un salarié de moins de 18 ans ne peut pas recevoir un horaire de nuit.',
          'Samedi et dimanche sont grisés et repliés (« Sam. · Dim. ») : dépliez-les pour un chantier, un déplacement ou un impératif. Ces heures comptent dans les heures supplémentaires de la semaine.',
          'En fin de semaine, « Soumettre au manager ». Au-delà de 10 h dans une journée ou de 48 h dans la semaine, indiquez le motif demandé avant de soumettre.',
          'La feuille est attendue le lundi suivant à 12 h. Une feuille renvoyée par votre manager revient « à corriger » avec son commentaire : corrigez-la puis soumettez-la de nouveau.',
        ],
      },
      {
        titre: 'Demander une absence',
        etapes: [
          'Menu « Mes absences » : vos soldes (congés payés, RTT ou repos, récupération, compte épargne-temps) sont en tête.',
          '« Poser une absence » : type, premier et dernier jour, et demi-journée si besoin (après-midi du premier jour, matin du dernier). Le décompte s’affiche avant « Envoyer la demande ».',
          'Votre manager valide ou refuse ; un refus vous parvient avec son motif. Une absence imprévue (maladie, enfant malade…) se déclare par « Signaler une absence » : le service RH en précise la nature, qui n’est jamais communiquée à votre manager pour un arrêt de travail.',
          'Aucune heure ne se saisit un jour d’absence validée : une demi-journée de congé laisse une demi-journée de travail au plus.',
        ],
      },
      {
        titre: 'Formations, habilitations, déplacements',
        points: [
          'Accueil : vos certifications et habilitations, avec leur échéance. « Demander une formation » ou « Demander le recyclage » envoie la demande au service RH ; « Demander une habilitation » de même.',
          'Les convocations aux sessions arrivent par e-mail, avec un fichier pour l’agenda.',
          '« Mes documents de voyage » : passeport, visa, vaccinations. Ils n’entrent dans votre dossier qu’après validation par le service RH ; les vaccinations ne sont vues que par lui.',
          '« Imprimer mon passeport formation » : certifications, habilitations (antérieures comprises) et formations suivies, à garder ou à présenter.',
          '« Mon contact d’urgence » : la personne à prévenir et son téléphone, facultatifs (« Renseigner »). Seul le service RH les voit, jamais votre manager.',
        ],
      },
      {
        titre: 'Entretiens et portail',
        points: [
          'L’encart « À faire » de l’accueil et les pastilles du menu signalent ce qui vous attend : feuille renvoyée ou semaine passée à soumettre, compte rendu d’entretien à relire.',
          '« Mes entretiens » : préparez vos sections du compte rendu ; une fois l’entretien clos par votre évaluateur, relisez-le puis « Signer le compte rendu ». « Télécharger le compte rendu » en garde une copie.',
          '« Mes notifications par e-mail » : chaque notification aussitôt, ou un récapitulatif chaque matin. « Télécharger mes données » donne la copie de tout ce que Cursus conserve sur vous ; la page « Confidentialité » explique leur traitement.',
        ],
      },
    ],
  },
  {
    id: 'manager', titre: 'Manager', court: 'Manager',
    pour: 'Celui qui encadre une équipe : il valide les heures et les absences de ses membres et mène leurs entretiens.',
    rubriques: [
      {
        titre: 'Valider les heures',
        etapes: [
          'Espace Manager, « Feuilles de temps ». « Feuilles à valider » liste les feuilles soumises par votre équipe ; « Ouvrir » affiche la semaine et son « Récapitulatif paie ».',
          'Corrigez au besoin (la feuille reste soumise), puis « Valider la semaine ». Pour la faire reprendre par le salarié, écrivez un commentaire et « Renvoyer ».',
          '« Suivi des feuilles de temps » montre, semaine par semaine, qui n’a pas saisi, soumis ou corrigé sa feuille : « Relancer » (ou « Relancer les retards ») envoie un e-mail ; « Valider les feuilles soumises » valide en une fois, chaque feuille gardant ses contrôles.',
          'Une feuille refusée par un contrôle (heures sur un jour d’absence, demande d’absence en attente, motif d’un dépassement manquant) reste à valider : le message dit quoi faire.',
          'Le travail du samedi ou du dimanche ne se saisit qu’en cas de besoin réel (chantier, déplacement, impératif) : un repos hebdomadaire manquant est signalé au service RH, sans bloquer la validation.',
        ],
      },
      {
        titre: 'Valider les absences',
        points: [
          '« Congés & absences » : les demandes de votre équipe attendent « Valider » ou « Refuser » (motif obligatoire, lu par le salarié).',
          '« Poser une absence » pour un membre de l’équipe l’enregistre validée (« Poser et valider ») ; « Signaler une absence » déclare une absence imprévue, que le service RH qualifie.',
          'Vous ne voyez jamais la nature d’un arrêt de travail : seulement « Absence », ses dates et son état.',
        ],
      },
      {
        titre: 'Entretiens',
        points: [
          '« Entretiens » liste les échéances de votre équipe (parcours professionnel dans la première année puis tous les 4 ans, état des lieux des 8 ans, entretien annuel) : « Planifier » fixe la date et envoie la convocation.',
          'Après l’entretien, rédigez vos sections, indiquez la date à laquelle il a eu lieu puis « Clore et signer » : le salarié relit et signe à son tour. « Remettre la copie » trace la remise (main propre, refus de signer, mise à disposition).',
          'Vos propres entretiens, menés par votre responsable, se préparent dans votre espace collaborateur.',
        ],
      },
      {
        titre: 'Planning et équipe',
        points: [
          '« Missions » : qui est en mission aujourd’hui et le « Planning des 4 prochaines semaines » (missions, absences, fériés).',
          '« Équipe » : conformité de chacun (formations, habilitations, aptitude réduite au verdict et aux restrictions). « Ajouter un membre » reprend un salarié « à affecter » ; une mutation directe passe par le service RH.',
          '« Formations » : renouvellements à prévoir. « Planifier » inscrit le collaborateur à une session ouverte ; sans session, « Demander au RH ».',
          '« Couverture minimale des équipes » (écran Équipe) : jour où votre équipe n’aura plus assez de secouristes ou d’équipiers incendie présents et formés, et pourquoi.',
        ],
      },
    ],
  },
  {
    id: 'rh', titre: 'Service RH', court: 'Service RH',
    pour: 'Gestionnaires et administrateur RH, et pour leur part le référent HSE et la lecture seule.',
    rubriques: [
      {
        titre: 'Fiches, contrats et sorties',
        points: [
          '« Annuaire » : « Nouveau collaborateur », puis « Modifier la fiche » (statut, contrat, organisation du temps, matricule de paie, adresse e-mail). Deux modifications simultanées de la même fiche ne s’écrasent pas : la seconde est refusée en nommant les champs changés.',
          '« Équipes & managers » : créer une équipe, désigner son manager, affecter les salariés.',
          'Départ : « Enregistrer une sortie » sur la fiche (dernier jour, motif). Le solde de congés, RTT, récupération et CET s’affiche avant la confirmation ; « Imprimer l’état » et « Exporter (CSV) » le donnent à la paie.',
          'Un membre du service RH ne décide jamais de ses propres absences, feuilles ou entretiens : un collègue ou son manager le fait.',
        ],
      },
      {
        titre: 'Formations et habilitations',
        points: [
          '« Nouvelle session » (service RH et référent HSE) : formation, dates, lieu, places ; inscriptions, convocations, puis « Clôturer » (présences, résultats, certifications datées du dernier jour).',
          '« Plan & budget » : enveloppes par équipe, « Importer un plan », coût réel à la clôture d’une action.',
          'Référentiels : formations, habilitations, destinations, postes et leurs exigences, horaires de poste (« Horaires » : J, M, AM, N d’exemple, horaire par défaut de chaque équipe dans son dialogue d’exigences) ; un élément inutile s’archive.',
          'Postes à risques particuliers : case « Liste des postes à risques particuliers (art. L4154-2) » du poste, formation renforcée désignée dans Paramètres ; un CDD, un intérimaire ou un alternant qui ne l’a pas suivie depuis son entrée est « Non conforme » et en No Go. « Imprimer la liste des postes à risques » la tient à disposition de l’inspection et du CSE.',
          'Couverture minimale des équipes (SST, EPI incendie) : seuils saisis avec les exigences de l’équipe, aucun par défaut ; alerte datée au tableau de bord, dans « Équipes & managers » et « Échéances ».',
          'Entretien de mi-carrière : après la visite de mi-carrière enregistrée, l’entretien de parcours est dû dans le délai de Paramètres → Entretien de mi-carrière (2 mois par défaut, à confirmer juridiquement).',
          'Formations suivies (fiche) : « Enregistrer une formation suivie », du catalogue ou hors catalogue (non obligatoire par défaut : elle compte pour le bilan à 8 ans) ; une demande hors catalogue acceptée se clôt une fois faite ; à la clôture d’une action du plan, cocher ses bénéficiaires.',
          'Titre d’habilitation en vigueur : « Imprimer le titre » (fiche, ou aussitôt après la délivrance ; jamais un titre retiré, suspendu ou expiré) selon le modèle choisi au référentiel (électrique NF C18-510, autorisation de conduite, générique), à signer par l’employeur et le titulaire ; modèles à faire valider par le référent HSE. Un renouvellement garde la délivrance précédente (« Habilitations antérieures »).',
          '« Plan & budget » : « Indicateurs de formation » de l’exercice (stagiaires, heures par catégorie, équipe et statut, taux de réalisation), avec la durée en heures du catalogue ; une formation sans durée connue est signalée.',
        ],
      },
      {
        titre: 'Congés et absences',
        points: [
          '« Absences à qualifier » : chaque absence signalée attend sa nature et son justificatif (« Qualifier »). « Saisir une absence » enregistre directement un arrêt reçu.',
          'Clôtures proposées par un bandeau : RTT à partir du 1er janvier, congés payés à partir du 1er juin. Pour les CP, vous décidez salarié par salarié du report ou de la perte, jamais d’office ; les reports légaux (santé, maternité…) sont automatiques.',
          '« Reporter » et « Épargner » (compte épargne-temps) se font depuis le tableau des soldes.',
          '« Congé principal à prévoir » : avant le 31 octobre, les salariés sans 12 jours ouvrables continus dans la période. « Jours de fractionnement à décider » : à partir du 1er novembre, « Décider » pour créditer les jours proposés ou noter la renonciation du salarié, jamais d’office.',
        ],
      },
      {
        titre: 'Temps de travail',
        points: [
          'Le service RH valide les feuilles d’un salarié sans manager et suit tout le site dans « Suivi des feuilles de temps ».',
          'Seul l’administrateur RH rouvre une feuille validée (« Rouvrir la feuille », motif obligatoire) : déjà transmise, seul l’écart part à la paie dans un lot « Correctif ».',
        ],
      },
      {
        titre: 'Déplacements et vigilance',
        points: [
          'Écran « Missions », « Grand déplacement des chantiers en France » : qualifiez chaque chantier (« Grand déplacement » ou « Pas de grand déplacement ») ; seuls les chantiers retenus donnent à la paie jours, nuits et trajets de leurs missions. Les déplacements à l’étranger donnent leurs jours par pays sans qualification.',
          'Référentiels, destinations : « Vigilance (France Diplomatie) » et le jour de la vérification, à tenir à jour à la main. Passer un pays à l’orange ou au rouge prévient les managers des voyageurs et la boîte du service RH ; une zone rouge met une réserve au Go / No Go.',
          '« Modifier le déplacement » : « Hébergement », « Contact sur place » et « Inscrit sur Ariane le ». Le dossier voyage rappelle de vérifier la vigilance avant le départ quand elle date de plus de 30 jours (réglable).',
        ],
      },
    ],
  },
  {
    id: 'paie', titre: 'Gestionnaire de paie', court: 'Paie',
    pour: 'Le gestionnaire de paie, interne ou cabinet, et l’administrateur RH : transmission mensuelle des variables à Sage Paie.',
    rubriques: [
      {
        titre: 'Procédure mensuelle',
        intro: 'Écran « Feuilles de temps », panneau « Transmission à Sage Paie ». Rien ne part seul vers Sage : vous importez le fichier de chaque lot. Le profil paie n’a pas accès aux Paramètres : les réglages cités ici sont faits par l’administrateur RH, à qui vous les demandez.',
        etapes: [
          'Avant la clôture : « Suivi des feuilles de temps » montre les feuilles manquantes ou à valider ; demandez aux managers ou au service RH de relancer (« Relancer ») et de valider.',
          '« Générer le fichier » sur la période de paie : le lot réunit les feuilles validées (rappels des périodes closes compris), les absences validées et les soldes de sortie dont les rubriques sont actives. Son contenu est figé.',
          '« Fichier » télécharge le fichier d’import (CSV). Son format se règle une fois par « Modifier le format », sur le modèle d’import de votre Sage.',
          'Importez le fichier dans Sage Paie et contrôlez les totaux.',
          '« Confirmer l’import » : seule cette confirmation marque les feuilles transmises. Si l’import échoue, « Annuler » le lot avant de confirmer, puis générez-en un autre.',
        ],
      },
      {
        titre: 'Calendrier du mois',
        points: [
          'Feuille de la semaine attendue le lundi suivant à 12 h (Paramètres → Suivi des feuilles de temps, administrateur RH).',
          'Clôture des variables : le dernier jour du mois par défaut (Paramètres → Paie), réglée par l’administrateur RH ; une semaine à cheval sur deux mois va sur le mois de son dimanche. Une semaine d’une période close part en rappel sur la période suivante.',
          `Date de génération du lot, date de l’import dans Sage et date de la paie : ${A_COMPLETER_PAIE}.`,
        ],
      },
      {
        titre: 'Correction après l’envoi',
        points: [
          'L’administrateur RH rouvre la feuille (« Rouvrir la feuille », motif obligatoire) ; revalidée, elle part « à régulariser » et le lot suivant, marqué « Correctif », n’emporte que l’écart.',
          'Une absence annulée ou raccourcie après sa transmission part en régularisation négative dans le lot suivant.',
          `Correction arrivée après l’import du mois : correction dans Sage en attendant le lot correctif du mois suivant, ou lot correctif aussitôt — ${A_COMPLETER_PAIE}.`,
        ],
      },
      {
        titre: 'Avant le premier lot réel',
        points: [
          'Chaque rubrique utilisée a son code Sage saisi et confirmé dans « Rubriques de paie » (ou est désactivée) : tant qu’il en manque, la génération d’un lot réel est refusée en les nommant.',
          'Chaque salarié a son matricule de paie, saisi par le service RH sur la fiche (Paramètres → « Matricules de paie », administrateur RH) ; le refus du lot nomme les salariés sans matricule.',
          '« Variables de la période » exporte en CSV ce qui est parti et ce qui attend, pour le contrôle. Heures de nuit restent saisies dans Sage ; les déplacements (jours et nuits de grand déplacement, jours à l’étranger, trajets) sont calculés et listés « À saisir dans Sage » dans le résumé du lot et l’export tant que l’administrateur RH n’a pas coché « Transmettre les déplacements dans le fichier d’import de la paie », après confirmation de vos codes. Journée de solidarité et fériés chômés : Paramètres, « Jours fériés et journée de solidarité », année par année (lundi de Pentecôte chômé par défaut) ; un jour ainsi travaillé n’est plus férié, et la journée de solidarité n’est pas payée à un mensualisé (art. L3133-8).',
        ],
      },
    ],
  },
  {
    id: 'pilote', titre: 'Groupe pilote', court: 'Groupe pilote',
    pour: 'Ouverture progressive de Cursus : le service RH d’abord, puis une équipe en horaires de journée, puis tout le site.',
    rubriques: [
      {
        titre: 'Trois étapes',
        etapes: [
          'Service RH : comptes du service RH et de la paie, référentiels, reprise depuis Lucca (Paramètres → Mise en service), premiers essais de saisie sur des fiches réelles.',
          'Équipe pilote en horaires de journée : comptes de l’équipe et de son manager seulement. L’import s’applique à toutes les lignes du fichier : rejouez l’import des salariés avec un fichier réduit à l’équipe pilote et à son manager, case « Créer les comptes Microsoft 365 à partir des adresses e-mail » cochée. Elle ne crée que des comptes Microsoft 365 (salariés avec une adresse) : les comptes Cursus des ouvriers et intérimaires se créent un par un (Paramètres → Comptes et accès). Une fiche corrigée dans Cursus depuis la reprise serait réécrite par le fichier : relisez les lignes « mise à jour » de l’aperçu avant d’importer. Puis un mois complet : saisie des semaines, absences, validation, lot de paie et import dans Sage.',
          'Tout le site, une fois le premier mois de l’équipe pilote importé dans Sage sans écart et les remarques corrigées : même import, fichier réduit à un groupe d’équipes à la fois.',
        ],
      },
      {
        titre: 'Ce que vérifie le groupe pilote',
        points: [
          'Connexion et déconnexion, sur PC et sur téléphone ; saisie d’une semaine complète, week-end compris si l’équipe y a travaillé.',
          'Demande, validation et refus d’une absence ; signature d’un compte rendu d’entretien depuis un téléphone.',
          'Le fichier du lot du mois, importé dans Sage : totaux identiques à ceux de la paie tenue en parallèle.',
          'Chaque remarque est notée avec la date, l’écran et ce qui était attendu, et transmise au service RH.',
        ],
      },
    ],
  },
  {
    id: 'entreprise', titre: 'Avant le 1er janvier 2027', court: 'À faire',
    pour: 'Ce que l’entreprise doit encore fournir ou décider avant la mise en service.',
    rubriques: [
      {
        titre: 'Paie',
        points: [
          'Codes Sage de chaque rubrique (heures, absences, fériés, dimanche, contrepartie en repos, soldes de sortie, déplacements : une rubrique par pays ou par zone pour l’étranger, à décider), à saisir et confirmer par le gestionnaire de paie.',
          `Calendrier de paie et traitement d’une correction arrivée après l’import : ${A_COMPLETER_PAIE}.`,
          'Matricules de paie de tous les salariés ; format du fichier ajusté au modèle d’import de Sage.',
        ],
      },
      {
        titre: 'Organisation et reprise',
        points: [
          'Postes et formations ou habilitations exigées par poste et par équipe ; référentiels et leurs codes, convenus avec l’équipe Keystone.',
          'Liste des postes à risques particuliers (avis du médecin du travail et du CSE) et formation renforcée à désigner ; seuils de secouristes et d’équipiers incendie par équipe (une équipe par quart en 2x8, 3x8 ou continu) ; délai de l’entretien de mi-carrière à confirmer juridiquement.',
          'Export Lucca des salariés et des soldes arrêtés au 1er janvier 2027 ; même date dans Paramètres → Absences et paie (« Absences transmises à partir du »).',
          'Prévenir l’équipe Keystone du changement des heures validées (semaine rouverte et corrigée).',
        ],
      },
      {
        titre: 'Comptes et messagerie',
        points: [
          'Inscription de Cursus dans Entra ID pour la connexion Microsoft 365, et boîte d’envoi des e-mails (service informatique).',
          'Responsable du traitement et contact du DPO (Paramètres → Confidentialité) : ils figurent aussi en tête des documents imprimés.',
        ],
      },
    ],
  },
];

/** Partie affichée d'abord : celle de l'espace ouvert (gestionnaire de paie : la sienne ; sans connexion : collaborateur). */
export function partieParDefaut(role: Role | null, profilRh?: ProfilRh): PartieAideId {
  if (role === 'manager') return 'manager';
  if (role === 'rh') return profilRh === 'paie' ? 'paie' : 'rh';
  return 'collaborateur';
}

/** Libellés cités entre « » dans un texte, blancs ramenés à une espace (vérifiés à l'écran par tests/aide.test.ts). */
export function libellesCites(texte: string): string[] {
  return [...texte.matchAll(/«([^»]*)»/g)].map(m => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);
}
