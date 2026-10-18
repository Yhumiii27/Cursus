# Guide d'utilisation de Cursus

Guide destiné aux utilisateurs : collaborateurs, managers, service RH et gestionnaire de paie, d'abord ceux du groupe
pilote (service RH, puis une équipe en horaires de journée), puis tout le site. Il décrit les gestes de chaque rôle et la
procédure mensuelle de transmission des variables à Sage Paie. L'installation et l'exploitation sont dans
`docs/DEPLOIEMENT.md` (service informatique) ; l'information des salariés sur leurs données, dans la page Confidentialité.

Le même guide, en plus court, est dans l'application : lien **Aide** sous le menu de chaque espace, et sur l'écran de
connexion (`shared/aide.ts`, page `client/src/pages/Aide.tsx`). Les deux sont tenus ensemble : les parties ci-dessous ont
le même titre que celles de la page, et chaque libellé cité entre « » existe à l'écran (`tests/aide.test.ts`).

Ce qui dépend encore d'une décision de l'entreprise est marqué *à compléter par le gestionnaire de paie* : le calendrier
de paie (dates de génération du lot, d'import et de paie) et le traitement d'une correction arrivée après l'import. En
attendant, Cursus applique ses réglages par défaut, rappelés à chaque étape.

Sommaire : [Collaborateur](#collaborateur) · [Manager](#manager) · [Service RH](#service-rh) ·
[Gestionnaire de paie](#gestionnaire-de-paie) · [Groupe pilote](#groupe-pilote) ·
[Avant le 1er janvier 2027](#avant-le-1er-janvier-2027)

## Collaborateur

### Se connecter

- **Compte Microsoft 365 de l'entreprise** : « Se connecter avec Microsoft », avec l'adresse professionnelle.
- **Compte Cursus** (ouvriers, intérimaires, alternants sans compte Microsoft) : identifiant et mot de passe provisoire
  remis en main propre par le service RH, à remplacer à la première connexion (12 caractères au moins). Après 5 échecs,
  le compte est bloqué 15 minutes.
- Une session dure **12 heures au plus** : on se reconnecte chaque jour de travail. Si elle expire pendant une saisie, la
  reconnexion s'affiche par-dessus l'écran et la saisie n'est pas perdue.
- Mot de passe oublié ou compte bloqué : le service RH attribue un nouveau mot de passe provisoire. « Changer mon mot de
  passe » et « Se déconnecter » sont en bas du menu.
- Sur téléphone, le menu se replie derrière le bouton « Menu ».

### Saisir sa semaine

1. Menu « Mes heures ». La semaine en cours s'affiche ; les flèches changent de semaine, « Cette semaine » y revient.
2. Une ligne par projet : « + Ajouter un projet… », ou « Proposer depuis Keystone » pour reprendre les tâches planifiées.
   Si l'on est inscrit à une session de formation cette semaine-là, le bouton devient « Proposer les heures prévues »
   (tâches Keystone et heures de formation, sur la ligne INT-FORM), ou « Proposer les heures de formation » sans tâche
   Keystone.
3. Les heures de chaque jour, en heures décimales (7,5 pour 7 h 30) : chaque cellule s'enregistre quand on la quitte. Sur
   téléphone et tablette, la feuille se saisit jour par jour ; la grille de la semaine reste sur PC.
4. **Samedi et dimanche** sont grisés et repliés (« Sam. · Dim. ») : on les déplie pour y porter des heures en cas de
   chantier, de déplacement ou d'impératif. Ces heures prennent leur rang dans les heures supplémentaires de la semaine
   (semaine du lundi au dimanche), et celles du dimanche sont transmises à part à la paie. Un repos hebdomadaire manquant
   est signalé, sans blocage.
5. Jours fériés : saisissables, repérés « Férié travaillé » (le 1er mai est majoré de 100 %). La journée de solidarité,
   quand elle est travaillée, est un jour ordinaire repéré « Journée de solidarité ».
   **Horaire du jour** (ligne « Horaire du jour », au-dessus des projets ; sous le titre du jour sur téléphone) : l'horaire
   de poste de chaque jour (journée, matin, après-midi, nuit…), proposé en italique d'après l'équipe dès que des heures sont
   saisies ; le salarié, son manager ou le service RH le changent jour par jour, « — » pour aucun. Facultatif ; figé à la
   soumission avec ses heures (une feuille renvoyée le propose de nouveau d'après les jours travaillés).
6. « Soumettre au manager » (ou « Soumettre au service RH » sans manager). Au-delà de 10 h dans une journée ou de 48 h dans
   la semaine, un motif est demandé avant la soumission ; il est lu par le valideur.
7. La feuille est attendue **le lundi suivant à 12 h** ; passé ce délai, le manager ou le service RH relance
   par e-mail. Une feuille renvoyée revient « à corriger » avec le commentaire du manager : on la corrige et on la soumet de nouveau.

Aucune heure ne se saisit un jour d'absence validée ; une demi-journée de congé laisse une demi-journée de travail au
plus. Une semaine entière d'absence se soumet sans heure. Les heures de nuit et les frais de déplacement ne se saisissent
pas dans Cursus : la paie les traite dans Sage.

### Demander une absence

1. Menu « Mes absences » : soldes de congés payés (période en cours et période d'acquisition), RTT ou jours de repos,
   récupération, compte épargne-temps.
2. « Poser une absence » : type, premier et dernier jour, et demi-journée si besoin (après-midi du premier jour, matin du
   dernier, ou matin ou après-midi pour un seul jour). Le décompte et les contrôles s'affichent avant « Envoyer la
   demande ».
3. Le manager valide ou refuse ; un refus arrive avec son motif.
4. Une absence imprévue (maladie, enfant malade, accident) se déclare par « Signaler une absence ». Le service RH en
   précise la nature ; celle d'un arrêt de travail ou de la santé d'un enfant n'est jamais communiquée au manager.

### Formations, habilitations, déplacements

- **Accueil** : certifications et habilitations avec leur échéance, formations planifiées. « Demander une formation »,
  « Demander le recyclage » d'une certification qui expire et « Demander une habilitation » envoient la demande au service
  RH ; « Retirer la demande » l'annule tant qu'il ne l'a pas traitée.
- Les convocations aux sessions et aux entretiens arrivent par e-mail, avec un fichier pour l'agenda.
- « Mes documents de voyage » : passeport, visa, vaccination. Ils n'entrent dans le dossier qu'après validation par le
  service RH ; les vaccinations sont des données de santé que lui seul voit.

### Entretiens et portail

- L'encart « À faire » de l'accueil et les pastilles du menu signalent ce qui attend : feuille renvoyée, semaine passée à
  soumettre, compte rendu d'entretien à signer.
- « Mes entretiens » : on prépare ses sections du compte rendu ; une fois l'entretien clos par l'évaluateur, on le relit
  puis « Signer le compte rendu ». « Télécharger le compte rendu » en garde une copie.
- « Mes notifications par e-mail » : chaque notification aussitôt ou un récapitulatif chaque matin.
- « Télécharger mes données » : copie de tout ce que Cursus conserve sur soi. La page « Confidentialité » explique leur
  traitement et à qui s'adresser.

## Manager

Le manager a deux espaces : **Manager** pour son équipe, **Collaborateur** pour ses propres heures, absences et entretiens
(sélecteur « Espace » en haut du menu).

### Valider les heures

1. « Feuilles de temps » : « Feuilles à valider » liste les feuilles soumises par l'équipe ; « Ouvrir » affiche la semaine
   et son « Récapitulatif paie » (heures normales, supplémentaires à 25 et 50 %, dimanche, fériés).
2. Corriger au besoin (la feuille reste soumise), puis « Valider la semaine ». Pour la faire reprendre par le salarié :
   commentaire puis « Renvoyer ».
3. « Suivi des feuilles de temps » : qui n'a pas saisi, soumis ou corrigé sa feuille, semaine par semaine. « Relancer »
   ou « Relancer les retards » envoie un e-mail ; « Valider les feuilles soumises » valide en une fois, chaque feuille
   gardant ses contrôles (une feuille refusée reste à valider, le message la nomme et dit pourquoi).
4. Une feuille ne se valide pas tant qu'elle porte des heures sur un jour d'absence, qu'une demande d'absence sur ces
   jours attend sa décision, ou qu'un dépassement des durées maximales n'a pas de motif.
5. Le travail du samedi ou du dimanche reste exceptionnel (chantier, déplacement, impératif) : un repos hebdomadaire
   manquant est repris pour le service RH après la validation.

Les feuilles validées partent à la paie avec le lot du mois : le manager n'a rien à transmettre.

### Valider les absences

- « Congés & absences » : les demandes de l'équipe attendent « Valider » ou « Refuser » (motif obligatoire, lu par le
  salarié).
- « Poser une absence » pour un membre de l'équipe l'enregistre validée (« Poser et valider ») ; « Signaler une absence »
  déclare une absence imprévue, qualifiée ensuite par le service RH.
- La nature d'un arrêt de travail n'est jamais affichée au manager : seulement « Absence », ses dates et son état.

### Entretiens

- « Entretiens » : échéances de l'équipe (entretien de parcours professionnel dans la première année puis tous les 4 ans,
  état des lieux des 8 ans, entretien annuel). « Planifier » fixe la date et envoie la convocation ; « Reprogrammer » la
  change.
- Après l'entretien : rédiger ses sections, indiquer la date à laquelle il a eu lieu, puis « Clore et signer ». Le salarié
  relit et signe à son tour ; « Remettre la copie » trace la remise (main propre, refus de signer, mise à disposition).
- Ses propres entretiens, menés par son responsable, se préparent dans l'espace collaborateur.

### Planning et équipe

- « Missions » : qui est en mission aujourd'hui, et le « Planning des 4 prochaines semaines » (missions, absences, fériés).
- « Équipe » : conformité de chacun (formations, habilitations, aptitude réduite au verdict et aux restrictions en
  vigueur, sans date de visite). « Ajouter un membre » reprend un salarié « à affecter » ; une mutation directe passe par
  le service RH.
- « Formations » : renouvellements à prévoir. « Planifier » inscrit le collaborateur à une session ouverte ; sans session,
  « Demander au RH ».

## Service RH

Profils de l'espace RH : gestionnaire RH, administrateur RH (paramètres, comptes, suppressions, transmission à la paie),
et trois profils restreints : référent HSE (formations et habilitations), gestionnaire de paie (partie suivante) et
lecture seule (direction, DPO, auditeur). Un membre du service RH ne décide jamais de ses propres absences, feuilles ou
entretiens : un collègue ou son manager le fait.

### Fiches, contrats et sorties

- « Annuaire » : « Nouveau collaborateur », puis « Modifier la fiche » : statut, nature du contrat, organisation du temps
  (avec sa date d'effet), poste, équipe, matricule de paie, adresse e-mail. Si deux personnes modifient la même fiche en
  même temps, la seconde est refusée en nommant les champs changés, sans perdre sa saisie.
- « Équipes & managers » : créer, renommer ou supprimer une équipe, désigner son manager, affecter les salariés.
- Comptes : Paramètres → Comptes et accès (administrateur RH), « Créer un compte », profil, « Mot de passe » pour un
  nouveau mot de passe provisoire.
- Départ : « Enregistrer une sortie » sur la fiche (dernier jour, motif en liste fermée). Le solde de congés, RTT,
  récupération et CET à la date s'affiche avant la confirmation ; « Imprimer l'état » et « Exporter (CSV) » le donnent à la
  paie. Ce qui était prévu après le départ est annulé ; la fiche reste consultable (filtre « Sortis »).

### Formations et habilitations

- « Nouvelle session » (service RH et référent HSE) : formation, premier et dernier jour, lieu, places ; inscriptions,
  convocations, puis « Clôturer » : présences, résultats, certifications datées du dernier jour, absents à replanifier.
- « Plan & budget » : enveloppes par équipe, « Importer un plan », coût réel saisi à la clôture d'une action.
- « Référentiels » : formations, habilitations, destinations, postes et leurs exigences, horaires de poste (onglet
  « Horaires » : J, M, AM, N d'exemple, modifiables ; horaire par défaut d'une équipe dans le dialogue de ses exigences) ;
  un élément inutile s'archive.
- Fiche du collaborateur : « Avis du médecin du travail », « Demander une visite » ; les visites dues (embauche, reprise,
  mi-carrière) sont signalées dans « Échéances ».

### Congés et absences

- « Absences à qualifier » : chaque absence signalée attend sa nature et son justificatif (« Qualifier »). « Saisir une
  absence » enregistre directement un arrêt reçu ; « Prolonger » le prolonge.
- **Clôtures**, proposées par un bandeau de « Congés & absences » : RTT à partir du 1er janvier (non reportables), congés
  payés à partir du 1er juin. Pour les CP, le service RH décide salarié par salarié du report ou de la perte du solde,
  jamais d'office ; les reports légaux (jours acquis pendant une absence de santé, une maternité, une paternité ou une
  adoption) sont automatiques. Première clôture des CP après la reprise : le 1er juin 2027.
- Retour d'arrêt : la tâche d'information du salarié sur ses congés apparaît dans « Congés & absences ».
- « Reporter » et « Épargner » (compte épargne-temps) depuis le tableau des soldes.

### Temps de travail

- Le service RH valide les feuilles des salariés sans manager et suit tout le site dans « Suivi des feuilles de temps »
  (filtre par équipe). Les semaines signalées pour le repos hebdomadaire, la moyenne sur 12 semaines ou le contingent
  annuel d'heures supplémentaires sont reprises dans des encarts de l'écran.
- Seul l'administrateur RH rouvre une feuille validée : « Rouvrir la feuille », motif obligatoire (voir Correction après l'envoi,
  ci-dessous).

## Gestionnaire de paie

Profil « Gestionnaire de paie » (interne ou cabinet extérieur, compte externe) ou administrateur RH : écrans Feuilles de
temps et Congés & absences, en lecture, et transmission à Sage Paie. Il ne voit ni les formations, ni les entretiens, ni
les données de santé : seulement la catégorie d'une absence (santé, parentalité…), utile à la paie. Il n'a pas accès aux
Paramètres et ne relance ni ne valide les feuilles : les réglages cités ci-dessous (matricules, date de reprise des
absences, clôture, échéance des feuilles) sont faits par l'**administrateur RH**, à qui il les demande ; la relance et la
validation reviennent aux managers et au service RH.

Rien ne part automatiquement vers Sage : Cursus prépare un **lot** par période de paie et son **fichier d'import** (CSV),
que la paie importe elle-même dans Sage. La procédure ci-dessous reprend celle de `docs/DEPLOIEMENT.md`, « Sage Paie »,
qui donne le détail technique (format, rubriques, migrations).

### Procédure mensuelle

Écran Feuilles de temps (espace RH, profil Paie), panneau « Transmission à Sage Paie » :

1. **Avant la clôture** : « Suivi des feuilles de temps » montre qui n'a pas saisi, soumis ou corrigé sa feuille (feuille
   attendue le lundi suivant à 12 h). Le gestionnaire de paie le consulte ; il demande aux managers ou au service RH de
   relancer (« Relancer » envoie un e-mail au salarié et à son valideur) et de valider les feuilles soumises.
2. **« Générer le fichier »** sur la période de paie : le lot réunit les feuilles validées de la période (rappels des
   périodes closes compris), les absences validées, ventilées mois par mois (demi-journées comprises), et les soldes de
   sortie dont les rubriques sont actives. Son contenu est figé, ses feuilles et absences réservées : elles ne sont pas
   encore transmises.
3. **« Fichier »** télécharge le fichier d'import : une ligne par salarié, période et rubrique. Son format (séparateur,
   colonnes, période, décimale, en-tête, encodage) se règle une fois par « Modifier le format », sur le modèle d'import de
   votre Sage ; encodage UTF-8 sans BOM par défaut, Windows-1252 si Sage affiche mal les accents. Chaque téléchargement est
   tracé.
4. **Importer** le fichier dans Sage Paie et contrôler les totaux (rappelés dans la confirmation).
5. **« Confirmer l'import »** : confirmation datée et signée, avec la référence de l'import si Sage en donne une. Elle seule
   marque les feuilles transmises. Si l'import échoue ou si le lot est faux, « Annuler » le lot **avant** de confirmer : ses
   feuilles et ses absences repartiront dans un nouveau lot (si le fichier a déjà été importé, supprimer cet import dans
   Sage).
6. **Contrôle** : « Variables de la période » exporte en CSV, pour une période, ce qui est parti et ce qui attend encore un
   lot (matricule de paie, code Sage, quantité, détail ; jamais la nature d'une absence).

En démonstration ou en recette sans Sage, le mode simulation remplace ces boutons par « Générer le lot (essai) » et
« Marquer transmis » : rien ne part, et l'écran le dit.

### Calendrier du mois

Les réglages de ce tableau se changent dans Paramètres, par l'administrateur RH.

| Étape | Réglage par défaut | Où le changer |
| --- | --- | --- |
| Feuille de la semaine attendue | le lundi suivant à 12 h | Paramètres → Suivi des feuilles de temps |
| Semaine à cheval sur deux mois | sur le mois de son dimanche | Paramètres → Paie |
| Clôture des variables | le dernier jour du mois | Paramètres → Paie |
| Génération du lot et téléchargement du fichier | *à compléter par le gestionnaire de paie* | — |
| Import dans Sage et confirmation dans Cursus | *à compléter par le gestionnaire de paie* | — |
| Date de paie | *à compléter par le gestionnaire de paie* | — |

Une semaine qui revient à une période close part en **rappel** sur la période ouverte, signalé dans le lot. Une absence
d'un mois clos enregistrée en retard part entière, en rappel.

### Ce que le fichier contient

- Heures des feuilles validées (semaine du lundi au dimanche) : normales, supplémentaires à 25 et 50 % (payées avec
  majoration), complémentaires du temps partiel, heures du dimanche (HDIM, et MAJ_DIM si une majoration est réglée),
  jours fériés travaillés (1er mai en MAJ_1MAI, autres en FERIE_TRAV), contrepartie obligatoire en repos (COR_ACQUIS).
- Absences validées : CP en jours ouvrés, RTT ou jours de repos en jours, récupération en heures, absences hors congés
  par rémunération et catégorie (Paramètres → Absences et paie, activé par défaut).
- Soldes de sortie (CP, RTT, récupération, CET) quand leurs rubriques sont activées ; sinon ils se saisissent dans Sage à
  partir de l'état imprimé.
- **Hors fichier, à saisir dans Sage** : heures de nuit, frais de déplacement ; intérimaires (relevé envoyé à leur agence)
  et cadres dirigeants exclus. La journée de solidarité et les fériés chômés se règlent année par année
  (Paramètres, « Jours fériés et journée de solidarité ») : un jour ainsi travaillé n'est plus férié (art. L3133-8).

### Correction après l'envoi

- **Feuille déjà transmise** : l'administrateur RH la rouvre (« Rouvrir la feuille », motif obligatoire, inscrit au
  journal sans son texte). Elle repasse au valideur ou au salarié ; revalidée, elle part « à régulariser » et le lot
  suivant, marqué « Correctif », n'emporte que l'écart, positif ou négatif. Si votre Sage refuse les quantités négatives,
  décochez « Quantités négatives acceptées » dans « Modifier le format » : la correction part alors en « annule et
  remplace », à importer en mode remplacement.
- **Absence** annulée, raccourcie ou requalifiée après sa transmission : régularisation négative dans le lot suivant ;
  absence prolongée : ses nouveaux jours.
- **Correction arrivée après l'import du mois** : correction dans Sage en attendant le lot correctif du mois suivant, ou
  lot correctif généré aussitôt — *à compléter par le gestionnaire de paie*.

### Avant le premier lot réel

- Chaque rubrique utilisée a son code Sage saisi et confirmé dans « Rubriques de paie » (ou est désactivée) : tant qu'il en
  manque, seule la simulation transmet et le refus liste les rubriques en cause.
- Chaque salarié du lot a son matricule de paie, saisi par le service RH sur la fiche (Paramètres → « Matricules de paie »,
  administrateur RH, liste ceux qui manquent) ; le refus d'un lot nomme les salariés sans matricule.
- « Absences transmises à partir du » (Paramètres → Absences et paie, administrateur RH) porte la date de reprise : les
  absences antérieures, déjà traitées par Lucca et Sage, ne partent jamais.

## Groupe pilote

Décision de l'entreprise : Cursus s'ouvre **progressivement**, le service RH d'abord, puis une équipe pilote en horaires
de journée, puis tout le site. Chaque mise en production est précédée d'une recette par un RH, un manager et un
collaborateur (`docs/DEPLOIEMENT.md`, section Recette).

### Trois étapes

1. **Service RH** : comptes du service RH et du gestionnaire de paie (Paramètres → Comptes et accès), référentiels, postes
   et exigences, reprise depuis Lucca (Paramètres → Mise en service), premiers essais sur des fiches réelles.
2. **Équipe pilote en horaires de journée** : comptes de l'équipe et de son manager seulement.
   - L'import s'applique à **toutes les lignes du fichier** : rejouer l'import des salariés (Paramètres → Mise en
     service) avec un fichier **réduit aux lignes de l'équipe pilote et de son manager**, extrait du même export Lucca,
     et la case « Créer les comptes Microsoft 365 à partir des adresses e-mail » cochée. L'export complet ouvrirait un
     compte à tous les salariés du site qui ont une adresse.
   - La case ne crée que des comptes Microsoft 365, pour les salariés qui ont une adresse e-mail sur leur fiche. Les
     ouvriers et intérimaires sans compte Microsoft reçoivent un compte Cursus, créé un par un dans Paramètres → Comptes
     et accès (« Créer un compte »).
   - Une fiche déjà à jour n'est pas modifiée. Une fiche corrigée dans Cursus depuis la reprise est en revanche
     **réécrite** par la ligne du fichier, alors que Cursus fait foi : relire l'aperçu avant d'importer, où ces lignes
     figurent en « mise à jour », et retirer du fichier (ou corriger) celles qui reprendraient d'anciennes valeurs.
   Un mois complet dans Cursus : saisie des semaines (week-end compris si l'équipe y travaille), absences, validations,
   lot de paie et import dans Sage, comparé à la paie tenue comme d'habitude.
3. **Tout le site**, une fois le premier mois de l'équipe pilote importé dans Sage sans écart et ses remarques traitées :
   même import rejoué, case cochée, avec un fichier réduit à un groupe d'équipes à la fois, aperçu relu de la même façon ;
   comptes Cursus créés un par un pour ceux qui n'ont pas d'adresse Microsoft.

### Ce que vérifie le groupe pilote

- Connexion et déconnexion, sur PC et sur un téléphone de l'entreprise ; saisie d'une semaine complète.
- Demande, validation et refus d'une absence, demi-journée comprise ; absence imprévue signalée puis qualifiée.
- Validation d'une feuille, renvoi pour correction, relance ; signature d'un compte rendu d'entretien depuis un téléphone.
- Le lot du mois : fichier importé dans Sage, totaux identiques à la paie calculée en parallèle ; une correction après
  l'envoi (réouverture, lot correctif).
- Impression d'un document (passeport formation, état de sortie) : en-tête de l'employeur.
- Chaque remarque est notée (date, écran, ce qui était attendu, ce qui s'est passé) et transmise au service RH.

## Avant le 1er janvier 2027

Ce que l'entreprise doit encore fournir ou décider avant la mise en service (réponses des 15 et 17 octobre 2026 et
questions encore ouvertes).

### Paie

- **Codes Sage** de chaque rubrique (heures normales et supplémentaires, dimanche, fériés, contrepartie en repos,
  absences, soldes de sortie), et l'unité attendue par le plan de paie : saisis et confirmés par le gestionnaire de paie
  dans « Rubriques de paie ».
- **Calendrier de paie** (dates de génération du lot, d'import et de paie) et traitement d'une correction arrivée après
  l'import : *à compléter par le gestionnaire de paie*, dans ce guide et dans la page Aide (`shared/aide.ts`).
- **Matricules de paie** de tous les salariés ; format du fichier ajusté au modèle d'import de Sage (« Modifier le
  format »).
- Majoration des fériés (0 % par défaut, hors 1er mai), acquisition des congés pendant un arrêt maladie (minimum légal
  par défaut) : à confirmer avec la convention et les accords.
- **Journée de solidarité et fériés chômés** de chaque année à partir de 2027 (Paramètres, « Jours fériés et journée de
  solidarité ») : lundi de Pentecôte chômé et tous les fériés chômés par défaut ; la modalité retenue après avis du CSE
  (Pentecôte ou autre férié de semaine travaillé, fractionnée ou sur un RTT) se règle année par année, sans effet sur les années
  passées. Une année déjà engagée (absences transmises à la paie, congés clôturés) ne se modifie qu'avec un motif.

### Organisation et reprise

- **Postes et exigences** : formations et habilitations exigées par poste et par équipe (« Référentiels »), case « travail
  de nuit ou en continu » des équipes (Référentiels → Postes) et horaire de poste par défaut de chaque équipe (facultatif ;
  horaires d'exemple à adapter dans Référentiels → Horaires).
- **Référentiels** et leurs codes, convenus avec l'équipe Keystone ; prévenir Keystone du changement des heures validées
  (une semaine rouverte et corrigée renvoie ses heures, un projet retiré à 0).
- **Reprise Lucca** : export des salariés (sorties comprises) et des soldes arrêtés au 1er janvier 2027, certifications,
  habilitations, visites ; même date dans « Absences transmises à partir du ». Procédure : `docs/DEPLOIEMENT.md`,
  section Procédure de reprise.

### Comptes et messagerie

- **Entra ID** : inscription de Cursus pour la connexion Microsoft 365 (`docs/CONNEXION-MICROSOFT.md`), par le service
  informatique.
- **Messagerie** : boîte d'envoi des e-mails et autorisation d'envoi (`docs/EMAILS.md`) ; adresses du service RH, du
  service de santé au travail et des agences d'intérim dans Paramètres → Messagerie.
- **Confidentialité** : responsable du traitement et contact du DPO (Paramètres → Confidentialité), repris en tête des
  documents imprimés ; validation du texte par le DPO (`docs/RGPD.md`).
