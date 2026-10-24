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
| Fiches et équipes | Gérer le dossier administratif utile au suivi : poste, équipe, manager, statut, contrat, organisation du temps, période d'essai | Exécution du contrat de travail (art. 6.1.b) ; obligations légales (art. 6.1.c) |
| Titres de séjour | Vérifier qu'un salarié étranger est autorisé à travailler, à l'embauche et pendant le contrat, et anticiper le renouvellement du titre | Obligation légale (art. L5221-8 et R5221-41 du Code du travail ; registre unique du personnel, art. L1221-13 et D1221-23) ; art. 6.1.c |
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
| Titre de séjour | Type de titre, numéro, date d'expiration, dates de la demande d'authentification à la préfecture et de sa réponse ; ni copie du document (GED Codex à venir), ni nationalité | `employes` (`autorisationTravail`) |
| Identité et contrat | Nom, poste, équipe, statut, nature du contrat, organisation du temps, heures et forfaits, jours non travaillés, dates d'entrée et de fin, fin de la période d'essai et de son renouvellement, date de naissance (`naissance_le` ; année seule pour une fiche antérieure : 5 jours de congés de la CCN à 59 ans, sections de fin de carrière à 58 ans, règles des salariés mineurs ; manager et profils restreints n'en reçoivent que l'année et l'indication « mineur »), dérogation pour travaux réglementés d'un salarié mineur (`derogation_travaux_le` : date de la déclaration ; ni le manager ni la paie), case « travail de nuit ou en continu » des équipes, agence d'intérim, adresse e-mail professionnelle, réglage des notifications, motif et date de reprise (liste fermée de l'art. L6315-1, sans information médicale) | `employes`, `equipes` |
| Compétences | Certifications (date d'obtention), inscriptions et résultats des sessions, habilitations et leurs mesures (suspension, retrait : date, motif saisi, auteur) | `certifications`, `inscriptions`, `participations`, `habTitres` |
| Formations suivies et habilitations délivrées (lots 6 et 7) | Formations suivies, du catalogue ou hors catalogue (intitulé, dates, durée, organisme, obligatoire ou non, origine, auteur ; corrections et annulations avec leur motif, texte libre du service RH) ; historique des délivrances et renouvellements d'habilitation (dates, échéance, signataire, mesure en vigueur, auteur) ; liste d'attente des sessions complètes (rang, demande d'origine, recyclage ou formation initiale, statut, proposition, issue codée) ; lignes déclarées au Passeport de prévention (jour de la déclaration, auteur) | `formationsSuivies`, `habDelivrances`, `attentesSession`, `declarationsPasseport` |
| Évaluations des formations (lot 7) | Évaluation à chaud (note de 1 à 5) ou à froid (efficacité), par le salarié ou son manager, date, auteur, et **commentaire libre nominatif** (avis du salarié ou du manager), lu par le service RH seulement | `evaluationsFormation` |
| Astreintes (lot 7) | Périodes d'astreinte (jours et heures), équipe, date de communication au salarié, motif des circonstances exceptionnelles (texte libre), auteurs, annulation et son motif (texte libre) ; interventions pendant l'astreinte (jour, heures de début et de fin, durée, déclarant) ; lot de paie qui les emporte | `astreintes`, `astreinteInterventions` |
| **Santé (art. 9)** | Date de la dernière visite médicale, avis d'aptitude (apte, restrictions, inapte), type de suivi médical (VIP, VIP adaptée, suivi individuel renforcé), exposition à des risques particuliers (visite post-exposition), date de la prochaine visite fixée par le médecin et date du dernier examen d'aptitude, restrictions de poste recopiées telles qu'écrites par le médecin du travail et leur échéance ; demandes de visite (motif administratif) ; **vaccins et dates d'injection** (déplacements) ; nature des absences pour raison de santé (arrêt, accident du travail ou de trajet, maladie professionnelle, enfant malade) et justificatif reçu ; informations sur les congés au retour d'un arrêt (leur seule présence désigne un arrêt de maladie ou d'accident : service RH et intéressé seulement) | `employes` (`visite`, `avis`, `restrictions`, `suivi`, `prochaineVisite`, `examenAptitude`, `expose`), `demandesVisite`, `vaccinations`, `absences`, `informationsCp` |
| Temps de travail | Heures par jour et par projet, statut des feuilles, commentaire du valideur, motif d'un dépassement des durées maximales, régime figé à la soumission | `feuilles` |
| Congés et absences | Demandes, absences et leurs dates, compteurs repris, reports (motif), compte épargne-temps, motif d'un refus ; information au retour d'un arrêt (art. L3141-19-3 : dates de l'arrêt, jour de l'information, jours communiqués, date limite, échéance du report, auteur) ; jours de fractionnement (crédit ou renonciation du salarié, jour, auteur) | `absences`, `soldesReprise`, `reports`, `cet`, `informationsCp`, `fractionnements` |
| Entretiens | Date, type, comptes rendus rédigés par l'évaluateur et le salarié, signatures | `entretiens` |
| Forfait jours et paie (lots 5 à 7) | Avenants de renonciation à des jours de repos (année, jours rachetés, taux de majoration, date de signature, référence (texte libre), annulation et son motif, lot de paie) ; jours de fractionnement (ligne Congés et absences) ; lots de paie (contenu transmis, résumé) | `avenantsForfait`, `fractionnements`, `lotsPaie` |
| Déplacements | Destination, dates, motif, numéro et date d'expiration du passeport, visas, dates des formalités de détachement, demandes reçues de Keystone ; coordonnées sur place (hébergement, contact local : textes du service RH, retirés de toute autre vue) et date d'inscription sur Ariane (lot 6, t068) ; jours et nuits de grand déplacement, jours à l'étranger par pays et trajets transmis à la paie (t031) | `employes` (passeport), `visas`, `voyages`, `demandesKeystone`, `missions`, `taches`, `deplacementsPaie` |
| Contact d'urgence | Nom (et lien) de la personne à prévenir et son téléphone, facultatifs, saisis par le salarié depuis son portail ou par le service RH (lot 6, t068) : service RH et intéressé seulement, jamais le manager ni un profil restreint ; journal : seul le fait qu'il soit renseigné | `employes` (`urgenceNom`, `urgenceTel`) |
| Demandes au service RH | Formation, habilitation, documents déclarés par le salarié avant validation | `demandesCollab` |
| Pièces justificatives (lot 6, désactivées par défaut ; activées par l'administrateur RH après avis du DPO) | Fichiers PDF, JPEG ou PNG joints au dossier : attestations de formation et cartes (CACES…), titres d'habilitation signés, justificatifs d'absence (avis d'arrêt de travail : **donnée de santé**), copies des documents déclarés (passeport, visa, carnet de vaccination : **donnée de santé**) ; nom du fichier envoyé, type, taille, empreinte SHA-256, date et auteur de l'envoi, retrait (date, auteur, motif), fichier chiffré ou non | `pieces` (description) ; fichiers dans `pieces/` à côté de la base (`/data/pieces` dans le conteneur), sous un nom aléatoire, **chiffrés au repos** (AES-256-GCM, clé `CURSUS_PIECES_KEY` hors de la base, obligatoire en production depuis le lot 8 ; pièces déposées avant : `npm run pieces:chiffrer`) |
| Organisation et traces de conservation (lot 6) | Délégations des validations d'un manager absent (manager, suppléant, période, périmètre, auteur, révocation) ; abonnements à l'agenda personnel (empreinte du jeton, création, révocation, dernier accès) ; effacements confirmés à la fin des durées de conservation (salarié anonymisé, catégories effacées, date, auteur, nombre d'éléments, **motif libre du service RH**, qui peut nommer le salarié : jamais au journal) | `delegations`, `jetonsAgenda`, `effacements` |
| Connexion et traçabilité | Identifiant, type de compte, profil, empreinte du mot de passe (scrypt), dernières connexions, sessions (12 h ; seule l'empreinte SHA-256 de l'identifiant de session est en base, lot 8), adresse IP des connexions et refus, journal des actions (liste blanche : identifiants, codes, dates, statuts — jamais de texte libre ni de donnée de santé) ; journaux techniques du serveur (numéro de compte, méthode, chemin sans paramètres, statut, heure et durée de chaque requête, jamais leur contenu) | `comptes`, `connexions`, `journal` ; journaux du serveur hors de la base (`server/src/logs.ts`) |
| Messages sortants | E-mails (destinataire, objet, texte sans donnée de santé ni texte libre saisi), événements envoyés à Keystone, relevés d'heures des intérimaires | `envois`, `notifications`, `releves` |

Ne sont **jamais** enregistrés : diagnostic, numéro de sécurité sociale, adresse personnelle, coordonnées bancaires.
Pièces scannées : seulement si le dépôt des pièces justificatives est activé (ligne ci-dessus) ; sinon, seule la
réception d'un justificatif est notée. Un avis d'arrêt de travail joint ne doit être que le volet employeur, sans
motif médical.

## 4. Destinataires

### Dans l'entreprise (profils, `PROFILS_RH` de `shared/constants.ts`)

| Destinataire | Ce qu'il voit |
| --- | --- |
| Le salarié | Toutes ses données, depuis son espace ; copie complète par « Télécharger mes données » (art. 15 et 20) |
| Service RH (gestionnaire, administrateur) | Toutes les données du personnel, santé comprise |
| Manager | Son équipe seulement, sans donnée de santé : avis d'aptitude et restrictions en vigueur (jamais la date de la visite ni les vaccins), « visite à programmer » sans son motif (embauche, mi-carrière, fin de carrière ; jamais la visite de reprise, qui trahirait la nature d'un arrêt), absence sans sa nature médicale, du passeport la seule date d'expiration, du titre de séjour le seul verdict (valide ou à régulariser) |
| Référent HSE / formation | Formations, sessions, certifications, habilitations, demandes de formation et d'habilitation ; aptitude réduite comme pour le manager ; chantiers et demandes Keystone, déplacements avec l'état précalculé du dossier (sans passeport ni visas) et absences des ressources des chantiers, dates seules sans leur nature, pour le Go / No Go ; synthèse du compte professionnel de prévention (C2P, lot 7) : nuits comptées, nuits en équipes alternantes, semaines sans horaire et feuilles non validées par salarié et par année, facteurs d'exposition cochés sur les postes, sans les feuilles de temps ; Passeport de prévention (lot 7) : lignes déclarées (dates, sans l'auteur) et export des lignes à déclarer (nom, prénom, date de naissance, matricule de paie, formation, dates, durée, résultat), produit par le serveur et tracé, la date de naissance n'étant jamais dans son instantané ; aucun NIR ; ni temps, ni soldes, ni entretiens |
| Gestionnaire de paie (interne ou cabinet) | Temps, absences et soldes, transmission à la paie ; catégorie de chaque absence (santé, parentalité, famille, non payée) par salarié et par mois, avec ses dates, dans le fichier d’import et l’export des variables de la période (donnée de santé au sens de l’art. 9 pour la catégorie « santé »), jamais la nature médicale ; jours de CP acquis chaque mois, calculés par le serveur avec la vraie nature des absences (aucun effet absence par absence) ; ni formations, ni entretiens, ni dossiers de déplacement (seulement les jours, nuits et trajets en attente de la paie, par salarié, pays et période, t031), ni informations au retour d'un arrêt |
| Pièces justificatives (lot 6) | Service RH : toutes ; référent HSE / formation : attestations et titres d'habilitation ; salarié : les siennes ; manager : attestations et titres de son équipe, jamais un justificatif d'absence ni un document déclaré ; paie et consultation : aucune. Chaque envoi, consultation (une ligne par compte et par pièce et par quart d'heure) et retrait est tracé, sans le nom du fichier (`server/src/pieces-routes.ts`) |
| Consultation (direction, DPO, auditeur) | Tout l'espace RH en lecture, sans donnée de santé détaillée, sans dossier de voyage ni contenu des comptes rendus d'entretien ; titre de séjour sans son numéro ; journal des actions avec les messages touchant à la santé masqués ; envois sortants sans l'objet ni le texte des e-mails qui désignent une donnée de santé (information au retour d'un arrêt, demande de visite, récapitulatif qui en contient) ; synthèse C2P comme le référent HSE |

### Hors de Cursus (sous-traitants et destinataires externes)

| Destinataire | Données transmises | Contrat à prévoir |
| --- | --- | --- |
| Keystone (planification des chantiers de l'entreprise) | Matricule, verdict Go / No Go et codes de motif (libellé neutre en partage détaillé), heures validées par projet, période des absences validées (jamais leur nature), décisions sur les demandes de déplacement (`docs/API-KEYSTONE.md`) | Outil interne ou sous-traitant : à compléter par le DPO |
| Sage Paie | Variables de paie par matricule et par semaine (heures normales, supplémentaires, jours travaillés) ; absences validées par mois (lot 5, réglage activé par défaut), sous une rubrique qui en révèle la catégorie (santé, parentalité, famille, non payée), jamais la nature : fichier d'import et export des variables réservés au droit « paie » | Éditeur ou cabinet de paie : à compléter par le DPO |
| Microsoft 365 (Entra ID, Graph) | Connexion des comptes Microsoft (identité) ; e-mails de Cursus (adresse, objet, texte sans donnée de santé), copie dans la boîte d'envoi (`docs/EMAILS.md`) | Contrat Microsoft de l'entreprise (art. 28), localisation UE à vérifier |
| Agences d'intérim | Relevé hebdomadaire des heures validées de leurs intérimaires, jours d'absence sans leur nature | Contrat de mise à disposition |
| Service de prévention et de santé au travail | Demande de visite : identité, poste, motif, habilitations qui exigent l'aptitude ; aucune information médicale | Convention d'adhésion |
| Organismes de formation | Liste nominative des inscrits d'une session (nom, poste, parcours), remise par le service RH | Convention de formation |
| Hébergeur (Docker, Coolify) et agrégateur de journaux du service informatique | Journaux techniques du serveur : numéro de compte, méthode, chemin sans paramètres, statut, heure et durée des requêtes ; aucun contenu de requête (`docs/DEPLOIEMENT.md`, « Exploitation courante ») | Service informatique interne ; à compléter par le DPO si l'hébergeur ou l'agrégateur est un prestataire |
| Hébergeur de Cursus et des sauvegardes | Toute la base (données de santé comprises) ; copies chiffrées avant l'envoi (`docs/SAUVEGARDE.md`) | à compléter par le DPO : prestataire, pays, contrat de sous-traitance (art. 28), question d'un hébergement certifié HDS (`docs/DEPLOIEMENT.md`) |

Aucun transfert hors de l'Union européenne n'est prévu par Cursus ; à vérifier pour l'hébergeur et Microsoft 365.

### Serveur PostgreSQL commun EPC2I (`DATABASE_URL`, lot 8)

En production, la base de Cursus est le schéma `cursus` du serveur PostgreSQL commun du groupe (base `epc2i`), partagé
avec Keystone, Codex, Vigie, Crucible et Matrix ; chaque outil a son schéma et son rôle (`cursus_app` pour Cursus).
Le serveur, ses rôles et ses droits relèvent de Matrix (`infra/postgres/` du dépôt Matrix ; copie d'essai dans
`infra/postgres-socle/`). Les autres outils ne lisent de Cursus que ses **vues `pub_`** (convention de partage : `USAGE`
sur le schéma et `SELECT` sur la vue, rien d'autre) ; une vue ne lit jamais une colonne de la liste
`droits.colonnes_sensibles` (santé, passeport, naissance, motifs de reprise, vaccinations, visas, comptes rendus
d'entretien, contenu du journal), ce que `droits.verifier()` contrôle. Définitions : `server/migrations-pg/0002_partage.sql`,
`0004_pub_absences.sql`, `0011_pub_titres_valides.sql` ; copie de Matrix : `infra/postgres-partage/20-cursus.sql`.

| Vue (contrat) | Colonnes publiées | Lecteurs (droits de `partage/90-droits.sql` de Matrix) |
| --- | --- | --- |
| `pub_salaries` (D01) | matricule, nom, poste, unité (`unite_code`), site (`site_code`), dates d'entrée et de sortie, actif ; une ligne par salarié, **sortis compris** | Keystone, Codex, Vigie, Matrix |
| `pub_titres` (D08) | catalogue des formations et habilitations : code, libellés, durée de validité ; aucune donnée personnelle | Keystone, Vigie, Matrix |
| `pub_titres_detenus` (D09, avenant du lot 8) | par salarié (matricule) : formation ou habilitation détenue, dates d'obtention ou de délivrance, d'échéance et d'utilisation, prérequis manquant, organisme, signataire, prochaine session prévue, mesure (suspension ou retrait) et sa date ; ni l'aptitude médicale, ni le motif de la mesure ; certifications annulées non publiées | Keystone, Vigie, Matrix |
| `pub_parametres` (D19) | horizon d'alerte des échéances (un nombre de jours) ; aucun autre réglage | Vigie, Matrix |
| `pub_journal` (D18) | référence de la ligne, nature, instant, auteur (nom, matricule, profil), code de l'action, objet, projet ; **jamais** le message ni le détail | Matrix (`matrix.journal_unifie` : journal réuni des quatre outils pour l'écran « Journal » de l'administration de Matrix, réservé à l'administrateur des données) |
| `pub_absences` (CU-1, demande de Crucible) | matricule, dates de début et de fin, statut (demandée ou validée), annulée, dernière modification ; **jamais** la nature, le motif d'un refus ni le justificatif ; absences refusées non publiées ; **sans fenêtre de temps** (passé et futur, salariés sortis compris) | Crucible, Matrix (droit prévu par la demande CU-1, à poser par `90-droits.sql` de Matrix : absent de la version recopiée, `403ff37`) |

Les vues de contrôle `*_v1` de Matrix (heures validées, contrats D06 et D07) ne sont pas encore créées par Cursus : elles
seront décrites ici avec la migration qui les crée.

Autres accès au schéma `cursus` :

| Rôle | Ce qu'il lit | Encadrement |
| --- | --- | --- |
| `matrix_lecture` (Matrix, et un administrateur du serveur qui prend ce rôle) | Toutes les tables de Cursus en lecture, **sauf** les colonnes et tables de `droits.colonnes_sensibles` (droit retiré par le déclencheur `droits_ddl` du socle). La liste actuelle de Matrix ne couvre pas encore les empreintes de mots de passe, les sessions, la nature des absences, les demandes de visite ni les textes libres : la demande D1 du lot 8 les y ajoute (`docs/DEMANDES-LOT8-DONNEES.md`, à valider avant envoi), et Cursus marque chacune « Sensible » dans ses migrations ; la CI de Cursus signale toute colonne marquée encore lisible. **À appliquer par Matrix avant la reprise de Lucca** | Contrôles d'administration de Matrix ; à décrire dans le registre de Matrix |
| `epc2i_sauvegarde` (sauvegarde du serveur, membre de `pg_read_all_data`) | Tout le schéma, données de santé comprises, copié chaque nuit par `pg_dump` (`cursus.dump`, 14 jours sur le volume des sauvegardes du serveur) | Fichiers en lecture pour le seul propriétaire ; copie hors du serveur chiffrée (question P-08 de Matrix) ; `docs/SAUVEGARDE.md`, section 10 |
| Administrateurs du serveur (`matrix_admin`, `postgres`) | Tout | Administrateurs nommés ; requêtes des administrateurs journalisées par le serveur (journaux aussi sensibles que la base, purge à fixer : question P-08 de Matrix) |

Les pièces justificatives ne sont pas dans la base : leurs fichiers restent dans le volume de Cursus, chiffrés, et sont
sauvegardés à part (copie restic chiffrée prise juste après le `pg_dump`, `docs/SAUVEGARDE.md`, section 10).

## 5. Durées de conservation

| Données | Durée | État dans Cursus |
| --- | --- | --- |
| Journal des actions | 1 an ; les actions liées à la paie (validations, corrections d'heures, transmissions) passent dans une archive consultée sur demande et sont supprimées au bout de 3 ans | Décidé et appliqué (`CONSERVATION_JOURNAL_MOIS`, `CONSERVATION_ARCHIVE_PAIE_MOIS` de `shared/journal.ts`) |
| File d'envoi (e-mails, messages à Keystone) | 1 an ; un échec non traité reste | Appliqué (`CONSERVATION_ENVOIS_MOIS`) |
| Sessions de connexion | 12 heures, purgées ensuite | Appliqué |
| Notifications du récapitulatif quotidien (`notifications` : objet et texte des étapes en attente) | Purge après l'envoi du récapitulatif : durée fixée par le chantier C du lot 8 (sécurité des traitements), à reporter ici à sa livraison | Supprimées avec le dossier à l'anonymisation ; d'ici la purge, gardées |
| Astreintes et leurs interventions | Avec le temps de travail (durée préremplie de 3 ans pour les textes libres) ; motif et motif d'annulation vidés à l'échéance, périodes et heures gardées sans nom | Même dispositif que le dossier (Paramètres → Conservation des dossiers) |
| Formations suivies, liste d'attente, évaluations des formations | Avec les formations (5 ans préremplis) : motifs de correction et d'annulation, demande d'origine de l'attente et commentaire des évaluations vidés à l'échéance ; dates, notes et efficacité gardées sans nom | Même dispositif |
| Délivrances d'habilitation, déclarations au Passeport de prévention, fractionnements, délégations | Gardées comme historique, sans nom une fois le dossier anonymisé | Même dispositif |
| Avenants de forfait jours | Avec les éléments de paie (5 ans préremplis) : référence et motif d'annulation vidés à l'échéance | Même dispositif |
| Traces d'effacement (`effacements`) | Gardées après l'anonymisation (preuve de l'effacement), sans donnée d'identité ; le motif saisi par le service RH est écrit avant le balayage des textes : un motif qui nomme le salarié ne garde pas son nom | Appliqué |
| Journaux du serveur (requêtes et messages techniques) | 1 an au plus, accès réservé au service informatique | Hors de Cursus : rotation par Docker ou journald (`docs/DEPLOIEMENT.md`), durée à valider par le DPO |
| Dossier du salarié (fiche, compétences, temps, absences, entretiens) | Pendant le contrat, puis durée préremplie, à valider par le DPO : 5 ans après le départ pour le dossier (5 ans au moins : registre unique du personnel, art. R1221-26), 3 ans pour les textes libres et justificatifs du temps de travail, 5 ans pour les entretiens et les formations, 5 ans pour les éléments de paie | Paramètres → Conservation des dossiers : **inactif** tant que la référence de la décision du DPO n'est pas saisie ; ensuite, Cursus propose chaque jour les dossiers échus et l'administrateur RH confirme (un par un ou par lot, motif) : catégorie effacée, puis fiche anonymisée (« Salarié anonymisé n° … »), nom retiré de toute la base, journal compris ; heures, absences, coûts et lots de paie gardés sans nom. Aucune purge automatique |
| Données de santé (visites, avis, restrictions, vaccinations) | Préremplie à 5 ans après le départ, à valider par le DPO | Effacées sur confirmation, déclarations comprises (même dispositif) |
| Passeport, visas | Effacés à la sortie (préremplie), à valider par le DPO | Effacés sur confirmation, déclarations et copies comprises |
| Titre de séjour (type, numéro, expiration, demande d'authentification et réponse) | Registre unique du personnel : 5 ans après le départ ; à confirmer par le DPO | Effacé sur confirmation (même dispositif) |
| Abonnement à l'agenda personnel (jeton haché, dates) | Jusqu'à sa révocation ; supprimé avec le dossier | Désactivé par défaut (Paramètres → Agenda) |
| Pièces justificatives | Celle de l'objet qu'elles justifient ; une pièce retirée par le service RH ou jointe à une déclaration refusée est effacée aussitôt (sa description reste), une pièce envoyée mais jamais jointe au bout de 24 h | Retrait et refus appliqués ; pièces effacées avec leur catégorie (justificatifs d'absence avec le temps, attestations avec les formations, copies de documents avec le passeport ou la santé) et toutes à l'anonymisation |
| Sauvegardes | 14 copies locales ; copies distantes selon le calendrier de `docs/SAUVEGARDE.md` (à valider avec le DPO) | Une donnée effacée subsiste dans les copies jusqu'à leur expiration |
| Sauvegardes du serveur commun (`cursus.dump` de Matrix) et copie des pièces | 14 jours sur le serveur (`EPC2I_SAUVEGARDE_JOURS`) ; copies hors du serveur : durée à fixer (question P-08 de Matrix), la même pour la copie restic des pièces | Une donnée effacée subsiste dans les dumps et les copies jusqu'à leur expiration |
| Vue `pub_absences` (lue par Crucible et Matrix) | **Aucune fenêtre de temps** : toutes les absences publiées, passées et futures, salariés sortis compris, jusqu'à l'anonymisation du dossier | À trancher avec le DPO : borner la vue (par exemple 12 mois passés), ou noter la durée dans le registre de Crucible ; les copies que les lecteurs gardent suivent leur propre registre |
| Journaux de Coolify (sortie du conteneur, onglet « Logs ») et journaux du serveur PostgreSQL commun | Coolify : rotation de Docker (`max-size`, `max-file`, `docs/DEPLOIEMENT.md`) ; durée **à fixer** par le service informatique et le DPO. Serveur PostgreSQL : requêtes des administrateurs, avec les valeurs saisies ; purge non automatique (question P-08 de Matrix) | Hors de Cursus |
| Copies de la démonstration (`…-avant-reinitialisation.db`, copies faites avant le vidage des données fictives, base de démonstration en ligne) | Données fictives ; à supprimer à la mise en service (procédure du vidage, chantier A du lot 8, `docs/DEPLOIEMENT.md`) : une copie de démonstration restaurée en production ferait revenir les salariés fictifs, et des fiches saisies par des visiteurs | Suppression par le service informatique, notée dans le registre d'exploitation |

Tant que la décision du DPO n'est pas saisie dans Paramètres → Conservation des dossiers, rien n'est proposé ni
effacé ; l'information des salariés le dit. Une donnée effacée subsiste dans les sauvegardes jusqu'à leur rotation
(`docs/SAUVEGARDE.md`). Le journal des actions ne garde, de l'effacement, que les identifiants et les catégories.

## 6. Mesures de sécurité

- **Accès** : comptes nominatifs (Microsoft 365, ou compte Cursus avec mot de passe de 12 caractères au moins,
  empreinte scrypt, blocage après 5 échecs) ; sessions de 12 h, révocables ; profils limités à ce que chacun doit
  voir, contrôlés par le serveur (`docs/ARCHITECTURE.md`, « Sécurité »), données filtrées avant l'envoi au navigateur.
- **Santé** : données de santé réservées au service RH et à l'intéressé ; jamais dans les e-mails, le journal, les
  messages à Keystone ; information spécifique avant la saisie d'une vaccination (`INFO_VACCINATIONS`).
- **Transport** : HTTPS (HSTS), en-têtes de sécurité, politique de contenu stricte, protection contre les requêtes
  d'un autre site, limitation du débit.
- **Stockage** : un fichier SQLite dans un dossier réservé au compte de service (`docs/DEPLOIEMENT.md`), ou le schéma
  `cursus` du serveur PostgreSQL commun (§ 4) ; chiffrement du disque à décider avec l'hébergeur (à vérifier pour l'hôte
  Coolify) ; pièces justificatives chiffrées au repos par Cursus (AES-256-GCM, clé hors de la base, obligatoire en
  production) ; sauvegardes vérifiées, chiffrées avant de quitter la machine, restauration testée avec le contrôle des
  empreintes des pièces (`docs/SAUVEGARDE.md`).
- **Traçabilité** : journal des actions (qui, quand, quoi, anciennes et nouvelles valeurs), des connexions, des refus
  d'accès et des exports ; conservation ci-dessus.

## 7. Droits des personnes

| Droit | Comment |
| --- | --- |
| Information | Page Confidentialité (connexion et tous les espaces) ; information spécifique avant une vaccination |
| Accès et portabilité | « Télécharger mes données » (espace collaborateur) : fichier JSON de toutes ses données ; le service RH exporte le dossier complet, journal compris (fiche du collaborateur) |
| Rectification | Demande au service RH ; documents de voyage déclarés par le salarié, validés par le RH |
| Effacement, limitation, opposition | Auprès du service RH ou du DPO, dans les limites des obligations légales ; après le départ, l'administrateur RH efface avant l'échéance ce qui ne relève d'aucune obligation légale (passeport et visas, entretiens, motifs et demandes des formations ; Paramètres → Conservation des dossiers, « Droit à l’effacement avant l’échéance », motif obligatoire) ; l'identité et le titre de séjour (registre unique du personnel, 5 ans après le départ, art. R1221-26), la santé au travail et le temps de travail restent jusqu'à leur échéance (art. 17-3-b du RGPD) ; un salarié en poste n'est pas effacé |
| Réclamation | CNIL (cnil.fr) |

Contact : le DPO (Paramètres → Confidentialité), sinon le service RH.

## 8. Points ouverts pour l'AIPD

- Hébergeur, localisation des données et contrat de sous-traitance ; besoin d'un hébergement HDS.
- Validation des durées de conservation préremplies (dossier, santé, documents de voyage, titre de séjour) et saisie de la
  référence de la décision dans Paramètres → Conservation des dossiers ; aucune purge automatique, chaque effacement est
  confirmé par l'administrateur RH.
- Agenda personnel par abonnement (Paramètres → Agenda, désactivé par défaut) : l'adresse donne accès, sans connexion, aux
  dates des absences (« Absent »), formations, entretiens et déplacements du salarié ; jeton secret et révocable.
- Statut de Keystone (outil interne ou sous-traitant) et contrat avec l'éditeur de Sage Paie.
- Serveur PostgreSQL commun (§ 4) : application par Matrix de la demande D1 (colonnes sensibles fermées à
  `matrix_lecture`) avant la reprise de Lucca ; fenêtre de temps de `pub_absences` ; durées des copies hors du serveur
  et des journaux de Coolify et du serveur ; chiffrement du disque de l'hôte Coolify à vérifier.
- Accès depuis Internet, smartphone compris (décision de l'entreprise) : téléphones fournis, verrouillage imposé par
  la gestion de flotte (`docs/DEPLOIEMENT.md`, « Postes et téléphones »).
- Validation par le DPO du texte de la page Confidentialité, de l'information sur les vaccinations et de celle sur les
  titres de séjour (`INFO_TITRE_SEJOUR` de `shared/rules/contrats.ts`), et de l'inscription des titres au registre.
  Le numéro du titre n'est jamais au journal ; Keystone ne reçoit qu'une « situation contractuelle à régulariser ».
