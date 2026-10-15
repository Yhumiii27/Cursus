# Cursus et le RGPD : descriptif du traitement

Document destiné au délégué à la protection des données (DPO) et au service RH de l'employeur, pour inscrire
Cursus au **registre des traitements** (art. 30 du RGPD) et conduire l'**analyse d'impact** (AIPD, art. 35) : le
traitement porte sur des données de santé de salariés, à grande échelle à l'échelle du site. Il décrit ce que fait
le code de cette version ; ce que l'entreprise n'a pas encore tranché est marqué **« à compléter par le DPO »**.

L'information des salariés (art. 13) est la page **Confidentialité** de Cursus, ouverte depuis l'écran de
connexion et depuis tous les espaces. Son texte est dans `shared/confidentialite.ts` (`INFO_CONFIDENTIALITE`) :
le tenir à jour avec ce document. Le responsable du traitement et le contact du DPO s'y règlent dans
**Paramètres → Confidentialité** (administrateur RH) ; tant qu'ils sont vides, la page renvoie au service RH.

## 1. Identification

| Rubrique | Contenu |
| --- | --- |
| Responsable du traitement | L'employeur : raison sociale, adresse, représentant légal — à compléter par le DPO (et dans Paramètres → Confidentialité) |
| DPO ou référent | à compléter par le DPO (et dans Paramètres → Confidentialité) |
| Nom du traitement | Cursus — gestion du personnel du site : formations, habilitations, santé au travail, temps de travail, congés et absences, entretiens professionnels, déplacements |
| Personnes concernées | Salariés du site (CDI, CDD, alternants), intérimaires, membres du service RH et personnes externes qui ont un compte (gestionnaire de paie d'un cabinet, auditeur) |
| Volume | Environ 100 salariés ; mise en service au 1er janvier 2027, par reprise des données de Lucca |
| Exploitation | Service informatique de l'entreprise (`docs/DEPLOIEMENT.md`) ; hébergement cloud : à compléter par le DPO (prestataire, pays) |

## 2. Finalités, par module

| Module | Finalité | Base légale |
| --- | --- | --- |
| Fiches et équipes | Gérer le dossier administratif utile au suivi : poste, équipe, manager, statut, contrat, organisation du temps | Exécution du contrat de travail (art. 6.1.b) ; obligations légales (art. 6.1.c) |
| Formations, sessions, plan et budget | Suivre les formations obligatoires et leurs recyclages, organiser les sessions et les convocations, tenir le plan de formation | Obligation légale de formation à la sécurité (art. L4141-2 du Code du travail) et d'adaptation au poste (art. L6321-1) ; contrat |
| Habilitations | Délivrer, suspendre, retirer les habilitations (électrique, conduite d'engins, travail en hauteur…) ; vérifier leurs prérequis | Obligations légales (R4544-9, R4323-55…) ; obligation de sécurité (art. L4121-1) |
| Santé au travail | Savoir si l'aptitude médicale est à jour, appliquer les restrictions de poste, demander les visites au service de prévention et de santé au travail | Obligation légale (art. L4624-1 et suivants) ; art. 9.2.b et 9.2.h du RGPD |
| Feuilles de temps | Décompter la durée du travail, faire valider les heures, calculer les heures supplémentaires, transmettre les variables de paie | Obligation légale de décompte (art. L3171-2, D3171-8) ; contrat |
| Congés et absences | Demander et valider les congés, tenir les soldes, enregistrer les absences et leurs justificatifs | Contrat ; obligations légales (congés payés, maintien de salaire) |
| Entretiens | Planifier les entretiens obligatoires et conserver les comptes rendus signés | Obligation légale (art. L6315-1 ; art. L3121-64 pour le forfait jours) ; intérêt légitime pour l'entretien annuel d'évaluation |
| Déplacements et chantiers | Préparer les déplacements (passeport, visas, vaccinations, détachement) ; vérifier avant une affectation que la personne est disponible, apte et habilitée (verdict Go / No Go transmis à Keystone) | Obligation de sécurité (art. L4121-1) ; formalités de sécurité sociale du détachement (règlement (CE) n° 883/2004, certificat A1) ; contrat |
| Comptes, journal des actions | Authentifier, limiter l'accès à ce que chaque profil doit voir, tracer qui a fait quoi | Intérêt légitime (sécurité du système, preuve) ; art. 32 du RGPD |

Aucune décision automatisée au sens de l'art. 22 : le verdict Go / No Go est une aide à la planification ; une
réserve ou un refus est vérifié par le service RH.

## 3. Catégories de données

| Catégorie | Données | Où (tables) |
| --- | --- | --- |
| Identité et contrat | Nom, poste, équipe, statut, nature du contrat, organisation du temps, heures et forfaits, jours non travaillés, dates d'entrée et de fin, **année** de naissance (5 jours de congés de la CCN à 59 ans), agence d'intérim, adresse e-mail professionnelle, réglage des notifications, motif et date de reprise (liste fermée de l'art. L6315-1, sans information médicale) | `employes`, `equipes` |
| Compétences | Certifications (date d'obtention), inscriptions et résultats des sessions, habilitations et leurs mesures (suspension, retrait : date, motif saisi, auteur) | `certifications`, `inscriptions`, `participations`, `habTitres` |
| **Santé (art. 9)** | Date de la dernière visite médicale, avis d'aptitude (apte, restrictions, inapte), restrictions de poste recopiées telles qu'écrites par le médecin du travail et leur échéance ; demandes de visite (motif administratif) ; **vaccins et dates d'injection** (déplacements) ; nature des absences pour raison de santé (arrêt, accident du travail ou de trajet, maladie professionnelle, enfant malade) et justificatif reçu | `employes` (`visite`, `avis`, `restrictions`), `demandesVisite`, `vaccinations`, `absences` |
| Temps de travail | Heures par jour et par projet, statut des feuilles, commentaire du valideur, motif d'un dépassement des durées maximales, régime figé à la soumission | `feuilles` |
| Congés et absences | Demandes, absences et leurs dates, compteurs repris, reports (motif), compte épargne-temps, motif d'un refus | `absences`, `soldesReprise`, `reports`, `cet` |
| Entretiens | Date, type, comptes rendus rédigés par l'évaluateur et le salarié, signatures | `entretiens` |
| Déplacements | Destination, dates, motif, numéro et date d'expiration du passeport, visas, dates des formalités de détachement, demandes reçues de Keystone | `employes` (passeport), `visas`, `voyages`, `demandesKeystone`, `missions`, `taches` |
| Demandes au service RH | Formation, habilitation, documents déclarés par le salarié avant validation | `demandesCollab` |
| Connexion et traçabilité | Identifiant, type de compte, profil, empreinte du mot de passe (scrypt), dernières connexions, sessions (12 h), adresse IP des connexions et refus, journal des actions (liste blanche : identifiants, codes, dates, statuts — jamais de texte libre ni de donnée de santé) | `comptes`, `connexions`, `journal` |
| Messages sortants | E-mails (destinataire, objet, texte sans donnée de santé ni texte libre saisi), événements envoyés à Keystone, relevés d'heures des intérimaires | `envois`, `notifications`, `releves` |

Ne sont **jamais** enregistrés : diagnostic, numéro de sécurité sociale, adresse personnelle, coordonnées bancaires,
certificat ou pièce scannée (seule la réception d'un justificatif est notée).

## 4. Destinataires

### Dans l'entreprise (profils, `PROFILS_RH` de `shared/constants.ts`)

| Destinataire | Ce qu'il voit |
| --- | --- |
| Le salarié | Toutes ses données, depuis son espace ; copie complète par « Télécharger mes données » (art. 15 et 20) |
| Service RH (gestionnaire, administrateur) | Toutes les données du personnel, santé comprise |
| Manager | Son équipe seulement, sans donnée de santé : avis d'aptitude et restrictions en vigueur (jamais la date de la visite ni les vaccins), absence sans sa nature médicale, du passeport la seule date d'expiration |
| Référent HSE / formation | Formations, sessions, certifications, habilitations ; aptitude réduite comme pour le manager ; ni temps, ni absences, ni entretiens |
| Gestionnaire de paie (interne ou cabinet) | Temps, absences (sans nature médicale) et soldes, transmission à la paie ; ni formations, ni entretiens, ni déplacements |
| Consultation (direction, DPO, auditeur) | Tout l'espace RH en lecture, sans donnée de santé détaillée, sans dossier de voyage ni contenu des comptes rendus d'entretien ; journal des actions avec les messages touchant à la santé masqués |

### Hors de Cursus (sous-traitants et destinataires externes)

| Destinataire | Données transmises | Contrat à prévoir |
| --- | --- | --- |
| Keystone (planification des chantiers de l'entreprise) | Matricule, verdict Go / No Go et codes de motif (libellé neutre en partage détaillé), heures validées par projet, période des absences validées (jamais leur nature), décisions sur les demandes de déplacement (`docs/API-KEYSTONE.md`) | Outil interne ou sous-traitant : à compléter par le DPO |
| Sage Paie | Variables de paie par matricule et par semaine (heures normales, supplémentaires, jours travaillés) | Éditeur ou cabinet de paie : à compléter par le DPO |
| Microsoft 365 (Entra ID, Graph) | Connexion des comptes Microsoft (identité) ; e-mails de Cursus (adresse, objet, texte sans donnée de santé), copie dans la boîte d'envoi (`docs/EMAILS.md`) | Contrat Microsoft de l'entreprise (art. 28), localisation UE à vérifier |
| Agences d'intérim | Relevé hebdomadaire des heures validées de leurs intérimaires, jours d'absence sans leur nature | Contrat de mise à disposition |
| Service de prévention et de santé au travail | Demande de visite : identité, poste, motif, habilitations qui exigent l'aptitude ; aucune information médicale | Convention d'adhésion |
| Organismes de formation | Liste nominative des inscrits d'une session (nom, poste, parcours), remise par le service RH | Convention de formation |
| Hébergeur de Cursus et des sauvegardes | Toute la base (données de santé comprises) ; copies chiffrées avant l'envoi (`docs/SAUVEGARDE.md`) | à compléter par le DPO : prestataire, pays, contrat de sous-traitance (art. 28), question d'un hébergement certifié HDS (`docs/DEPLOIEMENT.md`) |

Aucun transfert hors de l'Union européenne n'est prévu par Cursus ; à vérifier pour l'hébergeur et Microsoft 365.

## 5. Durées de conservation

| Données | Durée | État dans Cursus |
| --- | --- | --- |
| Journal des actions | 1 an ; les actions liées à la paie (validations, corrections d'heures, transmissions) passent dans une archive consultée sur demande et sont supprimées au bout de 3 ans | Décidé et appliqué (`CONSERVATION_JOURNAL_MOIS`, `CONSERVATION_ARCHIVE_PAIE_MOIS` de `shared/journal.ts`) |
| File d'envoi (e-mails, messages à Keystone) | 1 an ; un échec non traité reste | Appliqué (`CONSERVATION_ENVOIS_MOIS`) |
| Sessions de connexion | 12 heures, purgées ensuite | Appliqué |
| Dossier du salarié (fiche, compétences, temps, absences, entretiens) | Pendant le contrat, puis à compléter par le DPO (référence usuelle : 5 ans après le départ pour le dossier, 3 ans pour le décompte du temps de travail, le temps de la prescription pour les éléments de paie) | **Aucune purge** : rien n'est effacé, même au départ |
| Données de santé (visites, avis, restrictions, vaccinations) | à compléter par le DPO | **Aucune purge** ; les déclarations successives gardent les injections antérieures |
| Passeport, visas | Validité du document, puis à compléter par le DPO | Aucune purge |
| Sauvegardes | 14 copies locales ; copies distantes selon le calendrier de `docs/SAUVEGARDE.md` (à valider avec le DPO) | Une donnée effacée subsiste dans les copies jusqu'à leur expiration |

Tant que les durées « à compléter » ne sont pas fixées et appliquées, l'information des salariés indique que rien
n'est encore effacé automatiquement.

## 6. Mesures de sécurité

- **Accès** : comptes nominatifs (Microsoft 365, ou compte Cursus avec mot de passe de 12 caractères au moins,
  empreinte scrypt, blocage après 5 échecs) ; sessions de 12 h, révocables ; profils limités à ce que chacun doit
  voir, contrôlés par le serveur (`docs/ARCHITECTURE.md`, « Sécurité »), données filtrées avant l'envoi au navigateur.
- **Santé** : données de santé réservées au service RH et à l'intéressé ; jamais dans les e-mails, le journal, les
  messages à Keystone ; information spécifique avant la saisie d'une vaccination (`INFO_VACCINATIONS`).
- **Transport** : HTTPS (HSTS), en-têtes de sécurité, politique de contenu stricte, protection contre les requêtes
  d'un autre site, limitation du débit.
- **Stockage** : un fichier SQLite dans un dossier réservé au compte de service (`docs/DEPLOIEMENT.md`), chiffrement du
  disque à décider avec l'hébergeur ; sauvegardes vérifiées, chiffrées avant de quitter la machine, restauration testée
  (`docs/SAUVEGARDE.md`).
- **Traçabilité** : journal des actions (qui, quand, quoi, anciennes et nouvelles valeurs), des connexions, des refus
  d'accès et des exports ; conservation ci-dessus.

## 7. Droits des personnes

| Droit | Comment |
| --- | --- |
| Information | Page Confidentialité (connexion et tous les espaces) ; information spécifique avant une vaccination |
| Accès et portabilité | « Télécharger mes données » (espace collaborateur) : fichier JSON de toutes ses données ; le service RH exporte le dossier complet, journal compris (fiche du collaborateur) |
| Rectification | Demande au service RH ; documents de voyage déclarés par le salarié, validés par le RH |
| Effacement, limitation, opposition | Auprès du service RH ou du DPO, dans les limites des obligations légales ; effacement à faire en base par le service informatique (aucun écran dédié) |
| Réclamation | CNIL (cnil.fr) |

Contact : le DPO (Paramètres → Confidentialité), sinon le service RH.

## 8. Points ouverts pour l'AIPD

- Hébergeur, localisation des données et contrat de sous-traitance ; besoin d'un hébergement HDS.
- Durées de conservation du dossier, des données de santé et des documents de voyage, puis leur purge automatique
  (non développée).
- Statut de Keystone (outil interne ou sous-traitant) et contrat avec l'éditeur de Sage Paie.
- Accès depuis Internet, smartphone compris (décision de l'entreprise) : téléphones fournis, verrouillage imposé par
  la gestion de flotte (`docs/DEPLOIEMENT.md`, « Postes et téléphones »).
- Validation par le DPO du texte de la page Confidentialité et de l'information sur les vaccinations.
