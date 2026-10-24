# Architecture de Cursus

Cursus est une application web full-stack légère : un serveur Node/Express qui
stocke les données dans SQLite (module natif `node:sqlite`) et une interface
React + TypeScript compilée par Vite. Les règles métier sont écrites une seule
fois dans `shared/` et utilisées des deux côtés.

```
shared/            Domaine partagé (aucune dépendance)
  types.ts         Modèle de données (Dataset = instantané visible par l'utilisateur)
  constants.ts     Libellés, classes de statut, règles fixes (contrats, visas, vaccins, entretiens)
  dates.ts         Dates ISO (dates impossibles refusées), semaines ISO, jours fériés calculés, périodes de référence CP,
                   date du jour et horodatage à l'heure de Paris
  format.ts        Mise en forme française (dates, heures, jours, euros, pluriels)
  domain.ts        Classe Domain : conformité, habilitations, voyages, échéances, Go / No Go
  csv.ts           Exports CSV : cellules échappées, formules neutralisées (apostrophe devant = + - @)
  encodage.ts      Encodage d'un fichier texte : UTF-8 sans BOM ou Windows-1252 (fichier d'import Sage)
  journal.ts       Journal des actions : libellés, familles, actions liées à la paie, durées de conservation, droits de lecture
  reglages.ts      Réglages de Paramètres : table « champ → contrôle » (valeur par défaut, contrôle de chaque champ de Settings)
  confidentialite.ts Page Confidentialité : texte de l'information des salariés (art. 13), contrôle des coordonnées du
                   responsable et du DPO (descriptif complet du traitement : docs/RGPD.md)
  aide.ts          Page Aide : guide court par rôle (GUIDE_AIDE), partie affichée d'abord selon l'espace ; version longue
                   docs/GUIDE-UTILISATEUR.md, mêmes parties et libellés cités vérifiés à l'écran (tests/aide.test.ts)
  rules/           temps.ts, conges.ts, entretiens.ts, budget.ts, imports.ts, sante.ts (avis et visites médicales) ;
                   suivi-medical.ts : type de suivi (VIP, VIP adaptée, SIR) et échéance de la prochaine visite ;
                   visites-dues.ts : visites dues à un événement (embauche, reprise, mi-carrière, fin de carrière ou post-exposition) ;
                   conflits.ts : doublons et conflits de dates ; referentiels.ts : formations, habilitations et destinations
                   (contrôles de saisie, archivage, effet d'une validité modifiée) ; matricules.ts : matricule de paie,
                   identifiant Keystone ; clotures.ts : clôture des périodes de congés (CP au 31 mai, RTT au 31 décembre) ;
                   contrats.ts : sortie des salariés (présence, contrôles et effets d'une sortie), garde-fou d'un
                   changement de régime de temps, période d'essai, titre de séjour, échéances du contrat ; paie.ts : période de paie, rubriques Sage, modes (Paie) ;
                   lots-paie.ts : lots de paie et fichier d'import Sage ; suivi-feuilles.ts : suivi des feuilles de temps ;
                   campagne.ts (campagne d'entretiens annuels réglable), remise.ts (remise du compte rendu d'entretien),
                   exercices.ts (exercices du plan, clôture, coût réel) ; a-faire.ts : ce qui attend le collaborateur ;
                   reprise.ts : reprise depuis Lucca (imports de mise en service, colonnes reconnues, analyse ligne par ligne) ;
                   fiche-concurrente.ts : champs envoyés et modifications concurrentes d'une fiche (refus 412)
                   deplacements.ts (déplacement modifié ou annulé), relances.ts (récapitulatif des échéances par paliers) ;
                   semaine.ts (semaine à 7 jours : repos hebdomadaire et dominical, dérogations), activites.ts (activités
                   internes INT-… et ECOLE), delegation.ts (mandats au CSE, crédit R2314-1, compteur des heures de délégation),
                   repos-a-verifier.ts (feuilles soumises ou validées portant une alerte de repos, pour le service RH) ;
                   hierarchie.ts (équipe parente, valideur N+1 du manager, équipes descendantes de la consultation N+2) ;
                   delegations-manager.ts (délégation datée des validations d'un manager absent à un suppléant, t135) ;
                   demi-journees.ts : congés à la demi-journée (règle, poids, chevauchement, textes) ;
                   acquisition-cp.ts : acquisition des CP mois par mois, absences comprises (loi 2024-364, mémorisée) ;
                   information-retour.ts : information du salarié sur ses congés à son retour d'arrêt (art. L3141-19-3)
                   majorations.ts (jours fériés travaillés, plafond des heures complémentaires), durees.ts (moyenne sur
                   12 semaines, requalification du temps partiel, contingent et contrepartie obligatoire en repos)
                   absences-paie.ts : absences dans le fichier d'import de la paie (rubriques, ventilation, écart, régularisation)
                   solde-sortie.ts : état des compteurs à la date de sortie (CP, RTT, récupération, CET) et rubriques de sortie
                   pieces.ts : pièces justificatives (types reconnus sur le contenu, 10 Mo, nom gardé, droits de consultation)
                   formation-renforcee.ts (postes à risques particuliers, art. L4154-2), couverture.ts (couverture minimale des
                   équipes en SST et équipiers incendie), entretien-mi-carriere.ts (entretien de parcours après la visite) : lot 6
                   deplacements-paie.ts (lot 6) : jours et nuits de grand déplacement, jours à l'étranger, trajets (séjours, écart)
                   elements-lot.ts (lot 6) : éléments d'un lot « à saisir dans Sage » (rubrique désactivée, réglage décoché)
                   vigilance.ts (lot 6) : vigilance France Diplomatie, rappel avant un départ, coordonnées, contact d'urgence
                   feries.ts (lot 6) : jours fériés et journée de solidarité réglés par année (calendrier : dates.ts) ;
                   horaires.ts (lot 6) : horaires de poste, horaire par défaut d'une équipe, horaire du jour d'une feuille
                   repos-nuit.ts (lot 6) : repos quotidien, pause, heures de nuit, nuit des mineurs, travailleur de nuit
                   c2p.ts (lot 7) : compte professionnel de prévention, nuits de 0 h à 5 h, facteurs du poste, export DSN
                   passeport-prevention.ts (lot 7) : Passeport de prévention, formations marquées, lignes à déclarer, export
                   evaluation-formation.ts (lot 7, t121) : évaluation des formations à chaud et à froid, fenêtres, à faire,
                   demandes et relances, indicateurs par organisme et par formation
                   conservation.ts (lot 6, t016) : durées de conservation par catégorie après la sortie, dossiers échus
                   historique-contrat.ts : historique des contrats (régime en vigueur à une date, `regimeAu`, avenants
                   programmés) ; cdd.ts : motif de recours, durée maximale et renouvellements d'un CDD, délai de carence
                   formations-suivies.ts (lot 6) : formations suivies par salarié, hors catalogue comprises, bilan à 8 ans ;
                   heures-formation.ts (lot 6) : durée en heures, heures d'une session, indicateurs du plan par exercice
server/src/
  db.ts            Schéma déclaratif (TABLES) + accès asynchrone (all/get/insert/update/remove/tx/lecture/exclusif,
                   SQL brut query/one/run/exec) ; adaptateur SQLite `SqliteDb` (voir « Accès à la base »)
  migrate.ts       Reprises des bases antérieures, rejouées à chaque démarrage (idempotentes)
  migrations/      Migrations nommées, exécutées une seule fois par base : cadre.ts (contrôle et exécution), liste.ts (ordre),
                   outils.ts (reconstruction d'une table, index), un fichier par chantier (voir « Cadre commun du lot 4 ») :
                   exploitation.ts (index), entretiens.ts (coût réel des actions déjà réalisées), referentiels.ts (postes
                   créés depuis les intitulés des fiches), paie.ts (mode des heures supplémentaires, lot de paie historique,
                   rubriques par feuille des lots d'avant le lot 5),
                   voyages.ts (référence DD-<n°> des déplacements importés sans référence, lot 5)
                   temps.ts (lignes des feuilles complétées à 7 jours, activités internes de base amorcées)
                   conges.ts (lot 5 : demi-journées hors de la règle ramenées à la journée entière)
                   formations.ts (lot 5 : sessions existantes sur un jour, activité interne INT-FORM)
                   paie.ts, lot 5 : absences des périodes passées laissées à Sage (premier jour transmis par le fichier)
                   lot6-pieces.ts (lot 6 : index des pièces justificatives par salarié et par objet ; étape 2 : index des
                   abonnements à l'agenda et des effacements, `lot6-pieces-index-conservation-agenda`)
                   lot6-paie.ts (lot 6) : déplacements des périodes passées laissés à Sage (date de départ)
                   lot6-horaires.ts (lot 6 : horaires de poste d'exemple amorcés)
                   lot6-contrats.ts (lot 6 : historique des contrats amorcé depuis les fiches et les feuilles figées)
                   lot6-securite.ts (lot 6 : délivrances d'habilitation en vigueur, durée en heures du catalogue)
                   lot7-prevention.ts (lot 7, chantier B : colonnes du C2P, rien à reprendre ; étape 2 : formations
                   santé-sécurité marquées pour le Passeport de prévention, index des déclarations)
                   lot7-prevention.ts (lot 7, chantier B : colonnes du C2P, rien à reprendre)
                   lot7-formations.ts (lot 7, chantier C : index de la liste d'attente, puis des évaluations des formations)
  seed.ts          Données de démonstration
  avenants.ts      Historique des contrats : lignes écrites par la fiche, le renouvellement d'un CDD et la sortie, brouillons
                   refigés, avenants programmés appliqués à leur date (au démarrage puis toutes les heures)
  sauvegarde.ts    Copie à chaud (VACUUM INTO), rotation, restauration, verrou du serveur ;
                   scripts backup.ts et restore.ts (npm run backup / restore, voir docs/SAUVEGARDE.md)
  dataset.ts       Assemblage de l'instantané + restriction par rôle (RH / profil restreint / manager / collaborateur)
  auth.ts          Sessions en base (cookie signé, 12 h, révocation) : un compte et l'espace actif
  comptes.ts       Comptes nominatifs (Microsoft 365 ou compte local), espaces, mots de passe (scrypt), journal
  connexion.ts     Routes de session : /api/session, /api/mode, /api/login, /api/motdepasse, /api/logout, /api/comptes
  microsoft.ts     Connexion Microsoft 365 (OpenID Connect, PKCE) : /api/auth/microsoft et /api/auth/microsoft/retour
  comptes-cli.ts   npm run comptes -- admin <identifiant> : premier administrateur RH (docs/DEPLOIEMENT.md)
  config.ts        Variables d'environnement, contrôlées au démarrage (refus en production si dangereuses)
  pre-vol.ts       Pré-vol de la mise en production (lot 8) : contrôles de configuration et de base, bilan ;
                   verifier-production.ts (npm run verifier-production), db-pg-lecture.ts (serveur commun en lecture seule)
  chemins.ts       Racine du projet, interface (dist/) et base par défaut calculées depuis le code, version
  service.ts       Écoute du port (refus clair si pris, code 1) et arrêt ordonné sur SIGTERM / SIGINT
  protection.ts    Droits de la base sur le disque (600, dossier en 700, refus en production), clé de session retirée
  supervision.ts   Point de santé GET /api/health (état public ; détail en local ou avec le jeton de supervision)
  securite.ts      En-têtes de sécurité HTTP (CSP, HSTS, anti-iframe…), protection CSRF des requêtes qui modifient
  debit.ts         Limitation du débit de l'API par adresse IP et par compte (429, Retry-After)
  actions/         Actions métier (POST /api/actions/:nom), contrôles d'accès et validations
  envois.ts        File d'envoi persistante des messages sortants (table envois), traitée en tâche de fond
  journal.ts       Journal des actions : liste blanche par action, conservation et archive paie, consultation, export CSV
  lots-paie.ts     Lots de paie (lecture sans contenu, format du fichier d'import) ; fichier-paie.ts : téléchargement du fichier
                   d'import d'un lot (GET /api/paie/lots/:id/fichier, tracé) ; passeport-prevention.ts : export CSV des
                   lignes du Passeport de prévention (GET /api/formations/passeport-prevention, tracé, lot 7) ; absences-paie.ts : absences d'un lot (éléments
                   déjà émis, réservation, libération, résumé de l'instantané) ; variables-paie.ts : export CSV des variables
                   d'une période (GET /api/paie/variables/:periode, tracé)
  delivrances.ts   Historique des délivrances d'habilitation (lot 6) : délivrance précédente close au renouvellement
  elements-lot.ts  Registre des éléments de lot (lot 6) : familles réservées, transmises et libérées par le lot (soldes de
                   sortie : soldes-sortie.ts ; déplacements : deplacements-paie.ts) ; vigilance.ts : alerte d'une destination
                   passée à l'orange ou au rouge
  donnees.ts       Données personnelles d'un salarié (droit d'accès) : export RH et téléchargement par l'intéressé
  conservation.ts  Conservation des dossiers (t016) : dossiers échus, effacement par catégorie et anonymisation en cascade
                   (REFERENCES), signalement quotidien au service RH ; agenda.ts : .ics des congés et flux d'agenda par jeton (t036)
  pieces.ts        Pièces justificatives : dépôt (local ou GED), description transmise, nettoyage, contrôle d'intégrité ;
                   pieces-routes.ts (envoi et consultation) ; pieces-sauvegarde.ts (fichiers emportés par les sauvegardes)
  confidentialite.ts Coordonnées de la page Confidentialité : GET /api/confidentialite, lisible sans connexion
  messagerie.ts    Adresses (fiche, service RH, santé au travail, agences), forme commune des e-mails
  notifications.ts Notifications d'étapes (aussitôt ou récapitulatif quotidien), convocations .ics, tâches planifiées
  releves.ts       Relevés d'heures hebdomadaires des intérimaires envoyés à leur agence
  relances.ts      Récapitulatif des échéances par paliers (RH, managers, référent HSE), relances notées (table relances)
  evaluations-formation.ts Demandes et relances des évaluations de formation par e-mail (lot 7, t121), une fois par jour
  integrations/    Adaptateurs Keystone, Sage Paie et e-mails (email.ts : Microsoft Graph, .ics ; simulation par défaut) ;
                   ged.ts : espace documentaire de l'entreprise (squelette, refusé tant que son interface est inconnue) ; API Keystone entrante :
                   keystone-entrant.ts (contrôles, écritures, instantané) et keystone-routes.ts (routes /v1) ;
                   keystone-verdicts.ts (verdicts Go / No Go transmis, changements signalés)
  index.ts         Démarrage (dans l'ordre : configuration, droits, verrou, migrations, tâches) et routes HTTP
client/src/
  state/store.tsx  Session, données, navigation, filtres d'écran (ui), dialogue ouvert, notifications, reconnexion
  state/run.ts     Exécution des actions (réponse, message, relecture) et file des actions interrompues par l'expiration
                   de la session, rejouées après la reconnexion (sans React : tests/client-run.test.ts)
  state/brouillon.ts Brouillon gardé dans l'onglet pendant une reconnexion Microsoft (page, filtres, dialogue, champs)
  state/url.ts     Sélection et filtres de chaque vue dans l'adresse de la page (paramètres en français, valeurs contrôlées)
  state/actions.ts Actions identiques jamais envoyées deux fois à la fois, garde des boutons (useAgir : double clic)
  state/revision.ts Instantané plus ancien que celui affiché ignoré (révision de la base : réponses dans le désordre)
  state/enregistrement.ts Enregistrement au fil de la saisie (sections du compte rendu d'entretien), arrêté par l'abandon
  state/confirmations.ts Confirmations des refus (motif) et des actions irréversibles, affichées par dialogs/ConfirmerDialog.tsx
  state/derived.ts Hooks mémorisés : useDomain, useEnriched, useTrips, useRole
  components/      ui.tsx (Page, Kpi, Panel, Tag, Seg, Two, Bar…), Dialog.tsx (Dialog, Field…) et
                   ErreurRendu.tsx (erreur de rendu d'une page, d'un dialogue ou de l'application)
                   focus.ts (focus des fenêtres modales), controles.ts (messages d'erreur des champs),
                   panneau.ts (panneau de détail amené dans le champ de vision sur écran étroit),
                   LotsPaie.tsx, RubriquesPaie.tsx et VariablesPaie.tsx (lots de paie, absences comprises, fichier d'import,
                   rubriques de paie et export des variables de la période, écran Temps) ;
                   SuiviFeuilles.tsx (suivi des feuilles semaine par semaine, relance, validation groupée, écran Temps) ;
                   media.ts (requête média suivie), heures.ts (cellule d'heures, vue « un jour ») ;
                   Cliquable.tsx (bouton « Ouvrir » d'une ligne cliquable, carte sélectionnable CartePick) ;
                   tri.ts et TriListe.tsx (tri par colonne, pagination de 50 lignes, en-tête ThTri, pied SuiteListe) ;
                   recherche.ts, combobox.ts et ChoixCollaborateur.tsx (suggestions de collaborateurs, combobox des dialogues)
  listes-csv.ts    Exports CSV des listes (annuaire, registre des habilitations, soldes, absences, plan de formation)
  formations-csv.ts Exports CSV des indicateurs de formation et des formations suivies (lot 6)
  passeport.ts     Passeport formation imprimé (fiche et portail) ; titre-habilitation.ts : titre d'habilitation à signer
  layout/Shell.tsx Barre latérale, en-tête, notification ; layout/Reconnexion.tsx : session expirée, par-dessus l'écran ;
  layout/Shell.tsx Barre latérale, en-tête, notification ; layout/RechercheGlobale.tsx : recherche de l'en-tête (suggestions) ; layout/Reconnexion.tsx : session expirée, par-dessus l'écran ;
                   layout/Tiroir.tsx : menu en tiroir sur écran étroit ; layout/navigation.ts : titre de l'onglet, focus
                   sur le titre après un changement de page
  pages/           Un fichier par écran ; pages/parametres/ : une section de l'écran Paramètres par fichier (sections.tsx)
  dialogs/         Un fichier par dialogue, rendus par DialogHost
  styles/          nocturne.css (design system, ne pas modifier) et app.css (mise en page)
design/            Prototype Claude Design de référence, guide du design system Nocturne et archive complète de la
                   maquette (maquette-handoff.zip, seule archive suivie : *.zip est ignoré ailleurs)
deploy/            Fichiers d'installation prêts à copier (unités systemd, Caddyfile, copie externe), identiques à la doc
Dockerfile         Image facultative (hébergeur à conteneurs) ; .dockerignore
scripts/           dev.mjs (npm run dev), start.mjs (npm start : production, Windows compris), e2e-serveur.mjs (serveur
                   des tests de bout en bout : base jetable, date figée)
e2e/               Tests de bout en bout Playwright par rôle (playwright.config.ts : Chromium, Edge, téléphone simulé)
.oxlintrc.json     Contrôle du code (npm run lint, oxlint)
.github/workflows/ ci.yml : npm ci puis npm run check, Node de .nvmrc ; tâche e2e séparée, non bloquante
```

## Flux de données

1. `GET /api/data` renvoie l'instantané `Dataset` **déjà restreint au périmètre**
   de l'utilisateur : un manager ne reçoit que son équipe (et, consultation N+2 activée, les équipes rattachées en
   lecture seule : « Hiérarchie des managers »), sans données de santé
   (`visite`, `avis` et `restrictions` remplacés par `aptitude` : verdict et restrictions en
   vigueur, sans date ; ni demandes de visite ni vaccinations ; état des dossiers
   voyage précalculé dans `voyage.dossierStatut`), et du passeport de ses membres la seule date
   d'expiration (les visas restent transmis), sans leur matricule de paie, et de leur titre de séjour le seul verdict
   (`autorisationVerdict`, « valide » aussi sans titre requis) ; un collaborateur ne reçoit que
   ses propres données ; un profil restreint de l'espace RH (référent HSE, paie, lecture
   seule) ne reçoit que ce que ses droits ouvrent (« Profils », section Sécurité), avec la même
   aptitude que le manager.
2. Le client calcule l'affichage avec `shared/` (statuts, soldes, échéances…).
3. Toute modification passe par `run('nom.action', payload)` → `POST /api/actions/:nom`.
   Le serveur vérifie les droits, valide, écrit dans une transaction, trace l'action
   dans le journal et renvoie `{ message, data }` : le client remplace son instantané
   et affiche le message. Chaque instantané porte la **révision** de la base (`Dataset.revision`, `Db.revision` de
   `server/src/db.ts`, augmentée à chaque transaction d'écriture validée, partie de l'heure à l'ouverture : elle croît
   aussi d'un démarrage à l'autre, restauration comprise). Le client ignore un instantané de révision inférieure à celle
   qu'il affiche (`state/revision.ts`) : deux saisies d'heures parties ensemble peuvent être traitées dans un ordre et
   revenir dans l'autre, la réponse la plus ancienne ne vide plus la cellule enregistrée par la seconde. Une révision
   égale (même état de la base) est appliquée. L'instantané renvoyé est celui de la session relue après l'action (un compte
   qui perd l'espace actif reçoit celui de son nouvel espace).
4. La session et l'instantané de son espace changent ensemble (`store.tsx`) : un changement d'espace
   n'affiche le nouvel espace qu'avec ses données ; en cas d'échec (réseau), l'espace, la page, les
   filtres et le dialogue restent tels quels, avec un message. Une erreur réseau donne un message en
   français (`MSG_RESEAU` de `client/src/api.ts`). Les onglets partagent la session : chaque lecture
   (`/api/data`) et chaque action porte l'espace affiché (en-tête `X-Cursus-Espace`) ; si un autre
   onglet a changé d'espace, le serveur répond 409 sans rien faire et l'onglet suit la session, sans
   rejouer l'action.
5. Une réponse 401 (session expirée ou révoquée) ne démonte rien : `layout/Reconnexion.tsx` s'affiche
   par-dessus la page et le dialogue (le reste devient inerte). Compte Cursus ou démonstration : mot de
   passe, retour dans l'espace où la personne travaillait, puis les actions interrompues sont rejouées
   dans l'ordre et rendent leur réponse au dialogue qui les attend. Compte Microsoft : la reconnexion
   passe par Microsoft (redirection) ; `state/brouillon.ts` garde dans `sessionStorage` l'espace, la page,
   les filtres, le dialogue ouvert et la valeur de ses champs (lus dans le DOM du dialogue, jamais les
   mots de passe) et les restaure au retour, pour le même compte et dans les 30 minutes.
6. **Données à jour** : l'instantané est relu au retour sur l'onglet (30 s au moins après le précédent),
   toutes les 2 minutes sur l'onglet affiché (jamais sur un onglet masqué) et après une action refusée.
   Une lecture partie avant un autre instantané (réponse d'une action, changement d'espace) ou pendant une
   action est écartée ; un instantané identique ne redessine rien. Échecs silencieux : la lecture suivante
   réessaie, une session expirée affiche la reconnexion.
7. **Robustesse de l'interface** :
   - *Actions* : une action identique (nom et paramètres) à la dernière action de même nom, encore en cours, n'est
     pas renvoyée, elle reçoit la même réponse (`AppelsEnCours` de `state/actions.ts`) ; après un appel différent
     de la même action (case cochée, décochée puis recochée), elle part, pour que la dernière intention arrive.
     Les boutons d'action d'un écran passent par `useAgir()` : désactivés pendant l'appel, second clic d'un double
     clic ignoré (`detail` > 1), car l'écran a pu changer sous le pointeur entre les deux clics. Les transitions
     reçoivent l'état affiché et ne se refont pas : `plan.avancer` (`de`), `absence.decider` (même décision),
     `temps.removeLine` (ligne visée).
   - *Appels sans réponse* : abandonnés après 20 s (lecture) ou 60 s (action), avec un message en français
     (`MSG_DELAI`, `MSG_DELAI_ACTION`) ; une erreur HTTP sans message de Cursus aussi (`messageHttp`).
     Premier chargement impossible : écran d'erreur avec « Réessayer », jamais l'écran de connexion.
   - *Notifications* (`layout/Shell.tsx`) : deux régions live permanentes, `status` pour un succès (effacé
     après 5 s au moins), `alert` pour une erreur (icône d'avertissement, reste affichée jusqu'à sa fermeture
     ou au message suivant) ; chacune se ferme à la main.
   - *Dialogues* (`components/Dialog.tsx`) : le fond ne ferme que sur un clic commencé et terminé sur lui (une
     sélection de texte relâchée hors de la carte ne ferme rien) ; fond, Échap ou « Annuler » demandent
     confirmation si la personne a modifié un champ depuis l'ouverture. Un dialogue qui enregistre au fil de la
     saisie (`enregistrer`, compte rendu d'entretien : `state/enregistrement.ts`) enregistre avant de se fermer,
     confirmation en cas d'échec (« Fermer sans enregistrer » n'envoie plus rien, ni en quittant le champ pour la
     confirmation, ni au démontage : `abandonner`) ;
     celui qui montre une information une seule fois (`fermerParBouton`, mot de passe provisoire) ne se ferme que
     par son bouton.
   - *Modifications concurrentes d'une fiche* (`shared/rules/fiche-concurrente.ts`) : la fiche collaborateur n'envoie que
     les champs modifiés (avec ceux qui leur sont liés : poste et poste du référentiel ; organisation du temps et ses
     paramètres ; nature du contrat, fin et agence ; période d'essai ; visite et reprise) et leur valeur à l'ouverture
     (`avant`). Un champ changé entre-temps par quelqu'un d'autre fait tout refuser (412, distinct du 409 du changement
     d'espace), avec les champs et, pour le service RH seulement, l'auteur : la dernière action du journal qui a pu écrire
     l'un de ces champs sur cette fiche (`server/src/actions/fiche-auteur.ts`) ; personne n'est nommé si c'est une action
     qui touche des fiches sans les nommer (renommage d'un poste ou d'une équipe) ou si le journal ne dit rien. Seuls les
     champs envoyés, donc permis au rôle, sont comparés : une valeur d'origine pour un champ non envoyé est refusée (400),
     sans quoi un manager vérifierait une donnée qui lui est masquée. Le dialogue reste ouvert, le
     bloc du conflit en tête et ciblé, et « Reprendre la fiche à jour » reprend les valeurs enregistrées de ces champs en
     gardant les autres saisies. Sans `avant` (import, appel ancien), aucun contrôle.
   - *Impression* (`client/src/print.ts`) : les documents (passeport formation, compte rendu d'entretien, demande de
     visite) s'écrivent dans un cadre caché de la page (`iframe` sans fenêtre surgissante), le nouvel onglet restant le
     secours d'un navigateur sans cadre ; page A4, marges de 15 mm, titres jamais seuls en bas de page (`print.css`).
     En-tête : la coordonnée « responsable du traitement » (Paramètres → Confidentialité, lue par
     `GET /api/confidentialite`), sinon « Cursus » ; matricule de paie et matricule Cursus sous le titre des documents
     individuels (`matriculesImprimes`). Ctrl+P sur un écran : `@media print` de `app.css` redéfinit les jetons du thème
     en clair (texte sombre sur blanc, rampes inversées) et masque menus, boutons et filtres.
   - *Listes vides* : un panneau sans ligne affiche un message (`Empty`) plutôt qu'un cadre vide (tableau de bord :
     échéances prioritaires, conformité par équipe, prochaines sessions, déplacements à préparer ; missions : planning
     et missions en cours).
   - *Erreurs de rendu* (`components/ErreurRendu.tsx`) : limites autour de la page (remise à zéro au
     changement de page), du dialogue ouvert et de l'application ; message, détail technique replié, « Réessayer ».
   - *Focus des dialogues* (`components/focus.ts`, `useModale`) : à l'ouverture, le focus va au champ marqué
     `autoFocus`, sinon au premier champ, sinon (confirmation, information) à la fenêtre elle-même ; sur écran tactile,
     à la fenêtre (pas de clavier virtuel par-dessus le formulaire). Tab et Maj+Tab bouclent sur les éléments du
     dialogue, un focus qui s'en échappe y est ramené (sauf vers les notifications) ; à la fermeture, il revient à
     l'élément qui a ouvert le dialogue, ou au titre de la page s'il a disparu. Le titre nomme le
     dialogue (`aria-labelledby`) ; même traitement pour l'erreur d'un dialogue et la reconnexion.
   - *Formulaires* (`components/Dialog.tsx`) : le dialogue est un `<form>` (`onSubmit`) ; Entrée dans un champ
     active le bouton principal (`SubmitButton`), qui n'est désactivé que pendant l'envoi. Champs obligatoires
     marqués d'un astérisque (`Field requis`, `aria-required`, légende en bas du dialogue). Un envoi bloqué
     (`useVerification().verifier`) affiche l'erreur sous chaque champ (`Field erreur` : `aria-invalid`,
     `aria-describedby`) et place le focus sur le premier champ en erreur, ou sur le premier message bloquant sans
     champ (`Bloquant`, contrôles en accent de `Controles`). Les champs vides ne sont signalés qu'après une première
     tentative ; une saisie incorrecte (date passée, doublon, adresse invalide) l'est dès la saisie.
   - *Confirmations* (`state/confirmations.ts`, `dialogs/ConfirmerDialog.tsx`, dialogue `confirmer`) : refus d'une
     demande au service RH, d'une demande d'absence ou d'une demande Keystone (motif obligatoire), suppression d'une
     ligne de feuille de temps qui porte des heures, transmission à Sage Paie (simulation, périodes et rappels), changement de manager, retrait d'un
     membre, suppression d'une équipe, comptes (désactiver, délier, nouveau mot de passe), réinitialisation de la
     démonstration ; plus aucun `window.confirm`. Une confirmation n'est faite que de données (brouillon d'une
     reconnexion Microsoft) ; le dialogue reste ouvert si le serveur refuse. Depuis un dialogue, la confirmation
     remplace ses boutons (`Dialog confirmation`) : clôture et signature d'un entretien, import qui remplace les
     lignes prévues du plan. Le second clic d'un double clic n'active ni le bouton de confirmation ni le fond.
   - *Petits écrans* (`styles/app.css`) : le fond d'un dialogue défile (un dialogue plus haut que l'écran se lit
     jusqu'à ses boutons) ; sous 600 px, formulaires en une colonne et boutons pleine largeur. Sous 900 px, choisir
     une ligne amène son panneau de détail (fiche, dossier voyage, équipe, chantier), affiché sous la liste, dans le
     champ de vision et lui donne le focus ; le fermer ramène à la position de la liste (`components/panneau.ts`).
   - *Téléphone et tablette* (décision de l'entreprise : accès depuis Internet, smartphone compris) :
     - menu en tiroir sous 900 px, pour tous les espaces (`layout/Tiroir.tsx`) : la barre latérale (espaces, menu,
       pastilles, utilisateur) sort de l'écran et s'ouvre par le bouton « Menu » de l'en-tête (`aria-expanded`,
       `aria-controls`, total des pastilles). Ouverte, elle est modale (`useModale`, page derrière inerte) ; Échap, le
       fond, « Fermer le menu » ou le choix d'une page la referment. Le menu (`navGroups`) ne change pas ;
     - feuilles de temps jour par jour sous 600 px ou sur écran tactile (`pages/SaisieJour.tsx`, `VUE_JOUR`) : sept
       jours avec leur total (samedi et dimanche grisés), une ligne par projet avec un champ de 44 px en 16 px, total du jour et de la semaine,
       même action `temps.setCell` ; « Ajouter un projet » et la soumission restent dessous. Ouverte sur aujourd'hui
       (un week-end : le vendredi, ou le samedi ou le dimanche s'il porte des heures ; le lundi d'une autre semaine),
       jour choisi gardé dans `ui.tsJour`. Le PC garde la grille de la semaine, samedi et dimanche repliés en une
       colonne tant qu'ils sont vides ;
     - sur écran tactile (`pointer: coarse`), champs en 16 px (pas de zoom automatique d'iOS) et cibles de 44 px
       (boutons, icônes, options, entrées du menu, fermetures) ; sous 600 px, les contrôles segmentés passent à la
       ligne, une bordure par option. Tout est surchargé dans `styles/app.css`, `nocturne.css` restant la copie du
       design system ; de même les contrastes : bordure des champs, de `.seg` et des boutons radio à 45 % du texte
       (3:1 au moins), métadonnées des cartes à 60 %, `--color-divider` gardé pour les filets décoratifs.
   - *Navigation* (`layout/navigation.ts`) : lien « Aller au contenu », premier arrêt de Tab, vers `main id="contenu"` ;
     titre de l'onglet « <page> — Cursus » ; après chaque changement de page (menu, retour arrière, espace, connexion ;
     pas au premier affichage), focus sur le titre de la page (`h1` de `Page`, `tabIndex={-1}`), sauf sous un dialogue.
   - *Lignes et cartes cliquables* (`components/Cliquable.tsx`) : une ligne qui ouvre une fiche, un dialogue ou un détail
     porte un vrai bouton sur son nom (`Ouvrir`, première cellule ; `aria-pressed` pour une ligne qui sélectionne,
     `aria-expanded` pour une ligne qui se déplie), la ligne entière restant cliquable à la souris ; le bouton arrête son
     clic, comme les boutons secondaires de la ligne (`stop`, `garde`). Une carte sélectionnable (catalogue des formations
     et des habilitations, chantiers, équipes) est un `CartePick` : rôle de bouton, `aria-pressed`, Entrée et Espace.
     Focus visible (`.ouvrir`, `.card.pick`) ; `tests/cliquable.test.ts` refuse tout élément cliquable sans élément focalisable.
   - *Exports des listes* (`listes-csv.ts`, bouton « Exporter (CSV) ») : annuaire (Collaborateurs), registre des
     habilitations, soldes et absences (Congés & absences, hors espace collaborateur), plan de formation (Plan & budget).
     Exactement les lignes affichées, avec les filtres de l'écran ; le jeu de données est déjà restreint au profil, donc qui
     voit l'écran peut l'exporter. Jamais de donnée de santé ni de texte libre : une absence hors congés reste « Absence »
     (sans sa nature, quel que soit le profil), une suspension sans son motif, aucun motif de refus. Les soldes portent la
     mention « Soldes calculés par Cursus » et leur date d'arrêté. Nombres à la française (« 12,5 », un négatif reste un
     nombre), dates JJ/MM/AAAA, fichiers datés ; chaque export est tracé avec son nombre de lignes (`downloadCsv`).
   - *Ce qui attend le collaborateur* (`aFaireCollaborateur` de `shared/rules/a-faire.ts`) : comptes rendus d'entretien
     réalisés non signés, feuilles renvoyées et feuille de la semaine passée non soumise (hors contrat exclu ; à partir
     de la première feuille du salarié dans Cursus seulement, rien avant la mise en service) ; en pastille sur « Mes entretiens » et « Mes heures » (lue « N à traiter », comme toutes les pastilles du menu) et
     dans l'encart « À faire » de l'accueil, qui mène au compte rendu ou à la semaine.

## Sécurité

- **Configuration** (`server/src/config.ts`) : lue au démarrage. En production, le serveur s'arrête
  (code 1) en listant les problèmes : `CURSUS_SECRET` absente ou courte, `KEYSTONE_API_KEY` absente
  ou égale à la clé de démonstration (hors démonstration), `KEYSTONE_URL` sans `KEYSTONE_TOKEN`, qui
  n'est pas une adresse http(s) ou qui porte des identifiants, `CURSUS_TODAY` définie, démonstration sans
  `CURSUS_HOST` (ou `HOST`) explicite sur la boucle locale, `CURSUS_INSECURE_COOKIE=1` hors de ce cas,
  connexion Microsoft 365 configurée en partie, locataire autre qu'un GUID, `CURSUS_PUBLIC_URL` hors
  https, `CURSUS_OIDC_AUTORITE` définie (réservée aux tests), envoi des e-mails mal configuré (`CURSUS_MAIL_FROM`
  qui n'est pas une adresse, application Entra incomplète ou locataire autre qu'un GUID, variables `CURSUS_MAIL_*`
  sans `CURSUS_MAIL_FROM`), `CURSUS_SUPERVISION_TOKEN` de moins de 32 caractères, Sage Paie (`SAGE_MODE` inconnu, `api` compris,
  `SAGE_URL` définie, `SAGE_MODE=simulation` hors application de bureau : des feuilles seraient marquées transmises sans
  que rien ne parte) ; lot 8 : image Docker sans `DATABASE_URL` ni `CURSUS_BASE=sqlite`, `CURSUS_PUBLIC_URL` absente
  (hors démonstration et hors boucle locale explicite, `boucleLocaleExplicite`), rôle `postgres` dans `DATABASE_URL`
  (lu comme node-postgres par `cibleBase` : adresse, `?user=`, `PGUSER` ; hors démonstration, où il n'est qu'un
  avertissement), rôle absent, `CURSUS_TRUST_PROXY=true` ou un réseau en `/0`, et en démonstration publique les
  variables `CURSUS_MAIL_*`, `CURSUS_OIDC_*`, `SAGE_MODE` (hors simulation) et `SAGE_DOSSIER` ; puis, base accessible à d'autres comptes (« Exploitation »).
  Avertissements jamais bloquants (`avertissementsConfig`) : `MATRIX_URL` avec identifiants, démonstration connectée
  en rôle `postgres`, démonstration sur la base `epc2i` (`demoSurBaseCommune`), liaisons d'une démonstration publique coupées sans `CURSUS_DEMO_LIAISONS=1`
  (`liaisonsCoupees` : `keystoneSortant` et `declarerBase` inactifs). Les e-mails sont toujours simulés en démonstration
  (`configMail` renvoie null). `npm run comptes` et `npm run reprise-postgres` appellent aussi `verifierConfig` ; une
  commande qui prépare une démonstration à la production passe `{ reglesDemo: false }`.
  Le mode démonstration ne s'active qu'avec `CURSUS_DEMO=1` ; en production (application de bureau),
  `demoPosteLocal` (`server/src/securite.ts`) refuse en plus (403) toute requête relayée par un proxy
  ou adressée à un autre nom que la boucle locale, sauf instance de démonstration publiée explicitement
  (`CURSUS_DEMO_PUBLIQUE=1`, `demoPublique` de `server/src/config.ts` : données fictives, accès restreint en amont,
  avertissement à chaque démarrage).
- **Comptes** (`server/src/comptes.ts`, table `comptes`) : un compte par personne — un salarié (`empId`)
  ou une personne externe (nom et adresse, espace RH seulement). Identifiant unique en minuscules
  (l'adresse de connexion Microsoft 365 pour un compte Microsoft ; `oid` renseigné à la première connexion
  Microsoft). Compte local à Cursus pour le personnel sans compte d'entreprise : empreinte scrypt
  salée (`scrypt$N$r$p$sel$empreinte`), comparaison en temps constant, mot de passe provisoire à changer
  à la première connexion (12 caractères au moins), blocage 15 min après 5 échecs, limite d'échecs par
  adresse IP ; chaque tentative est comptée avant le calcul scrypt (`compterTentative`, `LimiteParIp`),
  de sorte qu'une rafale de requêtes simultanées ne dépasse pas ces seuils. Espaces du compte : RH selon le profil RH, manager si le salarié encadre une équipe,
  collaborateur s'il est salarié. Un compte désactivé, ou dont le salarié est sorti, ne se connecte plus
  et ses sessions sont révoquées. Premier administrateur : `npm run comptes -- admin <identifiant>`.
- **Microsoft 365** (`server/src/microsoft.ts`, guide `docs/CONNEXION-MICROSOFT.md`) : flux OpenID Connect
  « code d'autorisation » avec PKCE (S256), state et nonce, sans dépendance. Découverte du locataire et clés
  JWKS en cache (relues si un jeton cite une clé inconnue), échange du code par `fetch` avec le secret
  client, vérification complète du jeton d'identité (RS256 par `crypto.verify`, `iss`, `aud`, `exp` / `nbf`
  à 5 min près, `nonce`, `tid` = locataire configuré). L'état de l'aller-retour (state, nonce,
  code_verifier, page de retour) voyage dans le cookie signé `cursus_oidc` (10 min, HttpOnly,
  SameSite=Lax, Path=/api/auth/microsoft), à usage unique. Rattachement : le compte Microsoft dont l'`oid`
  correspond ; sinon, à la première connexion, celui dont l'identifiant est `preferred_username` et qui n'a
  pas encore d'`oid` (enregistré alors). Compte inconnu, désactivé ou salarié sorti : retour à l'écran de
  connexion avec `?connexion=<code>` (messages `ERREURS_MICROSOFT` de `shared/constants.ts`), refus
  journalisé — 30 par adresse IP et par quart d'heure au plus, car n'importe qui peut obtenir un état
  et revenir avec une erreur ; le motif renvoyé par Microsoft n'est recopié que s'il est un code OAuth
  connu (`motifRefus`). Espace initial : RH, sinon manager, sinon collaborateur. Déconnexion : session révoquée,
  puis déconnexion Microsoft avec retour sur l'URI de redirection (qui renvoie à l'écran de connexion).
  Configuration : `configOidc` de `server/src/config.ts` ; tests : `tests/microsoft.test.ts` (faux
  fournisseur OpenID local).
- **Profils** (`PROFILS_RH` de `shared/constants.ts`, droits `DroitRh`) : deux niveaux au sein du service RH —
  `rh_gestionnaire` (droits `rh`, `formations`, `consultation` : espace RH et actions courantes) et `rh_admin`
  (en plus `paie` et `admin` : paramètres, transmission à la paie, suppressions, comptes et accès,
  réinitialisation de la démonstration) — et trois profils restreints décidés par l'entreprise, qui ouvrent
  l'espace RH sans le droit `rh` :
  - `referent_hse` (droit `formations`) : catalogue, sessions et présences, certifications et habilitations,
    demandes de formation et d'habilitation, verdicts Go / No Go ; aptitude médicale réduite à « à jour » ou
    « à renouveler » ;
  - `paie` (droit `paie`) : temps, absences et soldes en lecture, transmission des variables de paie à Sage ;
  - `lecture_seule` (droit `consultation`) : direction, DPO, auditeur — tout l'espace en lecture (tableaux de
    bord, alertes, journal des actions et envois), sans modification.

  Contrôles serveur (`server/src/actions/context.ts`) : `requireRh`, `requireRhAdmin`, `requireFormations`,
  `requirePaie` ; `droitsRh(user)` (`shared/constants.ts`) donne les droits de la personne connectée (aucun hors
  de l'espace RH ; une lecture interne sans compte a ceux du gestionnaire RH). Données (`vueProfil` de
  `server/src/dataset.ts`) : jamais de visite ni de vaccination ; ni passeport ni visa pour le référent HSE et la
  paie (la lecture seule reçoit, comme le manager, la date d'expiration du passeport et les visas : ses échéances et
  alertes sont celles du service RH, vaccinations exceptées) ; nature médicale des absences masquée et reprise
  d'un arrêt longue maladie retirée (comme pour le manager), motif des reports de CP retiré, comme celui d'un report imposé à la
  clôture des congés (`ClotureConges.motif` : il laisse deviner une absence de santé), et échéance des reports et des
  clôtures ramenée au 31 mai (`reportNeutre`, `clotureNeutre` : le 31 août d'un report légal la trahirait aussi, pour le
  manager comme pour ces profils) ; le référent HSE ne reçoit ni temps (seulement la synthèse des nuits du C2P, `Dataset.c2p`, sans les feuilles), ni absences, ni entretiens, ni plan ; la paie ni formations, ni
  entretiens, ni déplacements ; la lecture seule tout le reste, sans le contenu des comptes rendus d'entretien ni
  les documents déclarés (plan, enveloppes et exercices clos : service RH et lecture seule seulement). L'état des déplacements (`dossierStatut`, `dossierManque`) est calculé par le serveur
  pour que le verdict Go / No Go reste exact sans les pièces. `GET /api/journal` et `GET /api/envois` : droit
  `consultation` ; pour la lecture seule, les messages des actions qui peuvent nommer une donnée de santé sont
  masqués (`journalPourProfil`). Écrans : `vues` du profil (`vuesDe`), navigation et boutons masqués selon
  `useRole()`. En démonstration : Sarah Cohen (référente HSE), Aïcha Diallo (paie), Élodie Bernard (lecture seule).
  Cursus garde toujours un administrateur RH actif.
- **Décision sur soi-même** : un membre du RH qui est aussi salarié (`user.salarieId`, rattaché au compte) ne
  décide pas de ses propres absences (`absence.decider`, `absence.saisir`, `absence.qualifier`, `report.accorder` ;
  il prolonge et annule comme intéressé), feuilles de temps (`temps.validate`, `temps.reject`, correction après
  soumission) ou entretiens (`entretien.planifier`, `entretien.modifier`, `entretien.clore`, `entretien.remettre`) : refus 403 qui
  renvoie à son manager ou à un autre membre du service RH (`refuserSoiMeme`). Le contrôle porte sur la fiche
  rattachée au compte : un compte externe (le premier administrateur, créé avant les fiches) se rattache à la fiche
  de la personne par `compte.rattacher` ou `npm run comptes -- admin <identifiant> --salarie <n°>`.
- **Identité** : dans l'espace RH, `user.empId` reste null (la personne agit pour le service RH), mais
  `user.nom` est celui de la personne connectée : il signe le journal (avec `compteId` et `identifiant`)
  et les mesures (`mesurePar`, reports de CP). `rhNom` et `rhIntitule` ne sont plus des paramètres : le
  valideur d'un salarié sans manager est « le service RH ».
- **Sessions** (`server/src/auth.ts`, table `connexions`) : le cookie `cursus_session` ne porte que
  l'identifiant de session signé ; la session porte le compte, l'espace actif et le mode de connexion
  (`local`, `demo`, `microsoft`). Durée absolue de 12 h ;
  `/api/logout` révoque, `/api/mode` ne bascule que vers un espace du compte (403 sinon), une connexion
  en ouvre une nouvelle. Connexions (démonstration comprise), déconnexions, changements d'espace et refus
  d'accès sont tracés dans le journal (voir « Journal des actions »). `revokeSessionsOf(db, empId)` révoque toutes les sessions d'un salarié,
  `revokeSessionsDuCompte(db, compteId)` celles d'un compte. Les sessions expirées sont purgées au
  démarrage puis toutes les heures. En démonstration, la connexion reste libre (sélecteur de vue, choix
  d'un compte, mot de passe quelconque) mais passe par les mêmes comptes : le jeu de démonstration crée
  un compte par salarié et celui de la RH de démonstration, administratrice RH.
- **En-têtes** (`server/src/securite.ts`) : CSP stricte (`script-src 'self'`, `style-src 'self'`).
  Ne jamais produire de `<script>`, de `<style>` ni d'attribut `style="…"` en HTML brut : la prop
  `style` de React reste permise. Les documents imprimables utilisent `client/src/styles/print.css`
  et lancent l'impression avec le script servi `client/public/imprimer.js`.
- **CSRF** (`protectionCsrf` de `server/src/securite.ts`) : une requête qui modifie (POST…) est refusée (403, rien
  n'est exécuté) si `Sec-Fetch-Site` désigne un autre site (sous-domaine voisin compris), si `Origin` n'est pas Cursus
  (nom et port de la requête, `req.host`, qui suit `X-Forwarded-Host` du reverse proxy de confiance, ou
  `CURSUS_PUBLIC_URL` ; « null » refusé) ou si son corps n'est pas du JSON (un formulaire ou un `fetch` d'une autre
  origine ne peut envoyer que du texte sans autorisation CORS, que Cursus n'accorde jamais). Seule exception :
  `POST /api/pieces` reçoit un PDF, un JPEG ou un PNG brut, types qui exigent eux aussi une autorisation CORS. Une requête sans corps
  (déconnexion) passe ; un client sans navigateur n'envoie ni `Origin` ni `Sec-Fetch-Site`. L'API Keystone (clé, sans
  cookie) est montée avant ; la connexion Microsoft ne fait que des GET. En développement, le proxy de Vite garde le nom
  d'hôte de la page (`changeOrigin: false`), comme le reverse proxy de production.
- **Débit** (`server/src/debit.ts`, seau de jetons en mémoire, au plus 10 000 clés suivies par limiteur) : toute requête
  `/api` (hors Keystone) compte pour son adresse IP (1 200 d'avance, puis 20 par seconde : un atelier entier peut sortir
  par une adresse) et, si elle porte une session ouverte, pour son compte (240 d'avance, puis 2 par seconde), quelle que
  soit l'adresse ; l'aller et le retour de la connexion Microsoft (échange du code chez Microsoft) ont leur propre limite
  par adresse (300 d'avance, puis 2 par seconde). Au-delà : 429, en-tête `Retry-After` (secondes) et message en français
  (texte pour une page ouverte par le navigateur). S'y ajoutent les échecs de mot de passe (`LimiteParIp`, Retry-After
  jusqu'à la fin de la fenêtre) et les clés Keystone invalides (60 en 5 minutes par adresse, puis 429
  `TROP_DE_CLES_INVALIDES` sans lire la clé). `req.ip` est l'adresse du client derrière le reverse proxy de confiance
  (`CURSUS_TRUST_PROXY`, boucle locale par défaut).
- **Keystone** : clé comparée en temps constant ; sans `KEYSTONE_API_KEY` (hors démonstration), 503.
  Le corps n'est lu qu'après la clé ; chaque appel authentifié est tracé dans le journal
  (`keystone.appel` : méthode, chemin, statut, référence, champs refusés), jamais le contenu reçu (clés
  de `heures`, identifiants et segments de chemin mal formés remplacés par un générique). Les appels
  sans clé valide, que n'importe qui peut émettre, sont comptés et résumés en une ligne par minute au
  plus. `GET /api/journal` les sépare des actions (`?vue=keystone`) ; le proxy restreint l'adresse
  appelante (`docs/DEPLOIEMENT.md`).
- **Journal des actions** et **données personnelles** : voir la section « Journal des actions ».
- Mise en production : `docs/DEPLOIEMENT.md`.

## Exploitation : démarrage, arrêt, santé

- **Chemins** (`server/src/chemins.ts`) : racine du projet tirée de `import.meta.dirname` ; interface `dist/` et base
  `data/cursus.db` par défaut en dépendent, quel que soit le dossier de lancement (`CURSUS_DIST` remplace l'interface,
  pour les tests ; un `CURSUS_DB` relatif reste compté depuis le dossier de lancement). `dbFile()` renvoie un chemin
  absolu, affiché au démarrage avec le dossier des sauvegardes ; `dist/` absent : avertissement, API seule.
- **Écoute** (`Arret.ecouter`, `server/src/service.ts`) : Express 5 passe l'erreur d'écoute au rappel de `listen` ; port
  pris, réservé ou adresse inconnue : message en français (`messageEcoute`), base fermée, verrou retiré, code 1, et
  aucune annonce « API sur ». Les tâches de fond qui envoient (file d'envoi, verdicts Go / No Go, e-mails planifiés)
  ne démarrent qu'une fois le port obtenu.
- **Arrêt** (`Arret`) : installé juste après le verrou, il remplace le retrait du verrou sur signal que faisait
  `poserVerrou` (qui ne garde que celui de la sortie du processus). SIGTERM ou SIGINT : plus de nouvelle connexion,
  requêtes en cours terminées (10 s au plus, puis connexions coupées ; un second signal les coupe aussitôt), minuteurs
  arrêtés, envoi en cours attendu (`envoiEnCours` de `envois.ts`) dans le même délai, base fermée (journal WAL reporté),
  verrou retiré, code 0. Une étape qui a besoin d'être arrêtée s'inscrit : `arret.tache(fonctionDArret)`,
  `arret.attendre(() => enCours)`.
- **Base occupée** : `PRAGMA busy_timeout = 5000` sur la connexion du serveur et des outils ; `db.tx` ouvre ses
  transactions en `BEGIN IMMEDIATE` (verrou d'écriture pris d'emblée, en attendant au besoin), sans quoi une
  transaction qui lit puis écrit échouerait aussitôt si `npm run comptes` a écrit entre-temps.
- **Accès à la base : couche asynchrone** (sous-étape 8.a de la bascule vers le serveur PostgreSQL commun, plan dans
  Matrix, `docs/architecture-postgres.md` § 8). La classe abstraite `Db` (`server/src/db.ts`) garde l'API d'avant
  (`all`, `where`, `get`, `insert`, `update`, `remove`, `count`, `tx`, `getSetting`, `setSetting`, `clearAll`,
  `columns`), chaque méthode renvoyant une promesse, plus le SQL brut (`query`, `one`, `run`, `exec`, paramètres `?`),
  `lecture`, `exclusif`, `emplacement` et `fermer`. Seul adaptateur pour l'instant : `SqliteDb` (`node:sqlite`, même
  comportement qu'avant) ; `openDb()` est asynchrone. Le code applicatif ne touche jamais la connexion `SqliteDb.sql` :
  seuls le schéma (`db.ts`), le cadre et les outils des migrations nommées (`migrations/cadre.ts`, `outils.ts`) et la
  déclaration à Matrix (`index.ts`) le font, ainsi que les tests pour préparer leurs bases.
  - *Sérialisation.* Une seule connexion SQLite sert toutes les requêtes ; avec des appels asynchrones, deux requêtes
    s'entremêleraient à chaque `await` (second `BEGIN` refusé : « cannot start a transaction within a transaction »,
    écriture d'une requête entrée dans la transaction d'une autre et annulée avec elle). Une file en mémoire
    (`FileExclusive`) fait passer l'une après l'autre les transactions (`tx`), les lectures groupées (`lecture`) et les
    suites exclusives (`exclusif`) ; une requête isolée passe aussi par la file, entre deux d'entre elles. La portée en
    cours suit la chaîne asynchrone de l'appelant (`AsyncLocalStorage`) : dans `tx`, `lecture` ou `exclusif`, les
    requêtes s'exécutent sans attendre la file qu'elles détiennent, une transaction imbriquée rejoint l'englobante
    (comme avant), une tâche lancée depuis une transaction et poursuivie après sa fin repasse par la file.
  - *Même atomicité qu'avant.* Avec l'accès synchrone, toute suite d'appels sans attente s'exécutait d'un seul tenant :
    les routes HTTP qui ne font qu'accéder à la base s'exécutent donc entières en `exclusif` (`enSerie(db, route)` :
    `/api/data`, `/api/actions/:nom`, journal, exports, fichier de paie, API Keystone…), de même `identite`,
    `compterTentative`, la clé de session, `setSetting` et l'issue d'un envoi. Une route qui attend autre chose que la
    base (calcul du mot de passe à la connexion, échanges avec Microsoft) ne prend la file que pour les étapes d'avant et
    d'après l'attente. `loadFull` lit toutes les tables en `lecture` (même état de la base) ; l'instantané renvoyé après
    une action est lu avec la session relue, sur le même état. Un signal d'arrêt reçu pendant le démarrage (désormais
    asynchrone) attend sa fin (`Arret.demarrer`) ; `fermer` attend la transaction en cours.
  - *Garde-fou.* `npm run typecheck` lance aussi `scripts/verifier-await.mjs` (`npm run check:await`) : appel
    asynchrone du dépôt ou méthode de la base ni attendu, ni lâché par `void`, ni rassemblé par `Promise.all` ; rappel
    asynchrone passé à `forEach`, `filter`, `some`… ou à `assert.throws` ; `.sql` dans le code applicatif. TypeScript 7
    n'a pas d'API JavaScript (pas de règle `no-floating-promises` de typescript-eslint) : le script lit l'arbre
    syntaxique avec l'analyseur d'oxc fourni par rolldown (installé avec Vite). Exception justifiée : commentaire
    `// await-ok: <raison>` sur la ligne.
  - *Lot 6 complet.* Les vagues 2 et 3 du lot 6 sont converties de même : délégations des validations (`delegations.ts`,
    annonce dans la transaction de `tachesEmails`), délivrances d'habilitation, formations suivies (les bénéficiaires
    d'une action du plan sont écrits par un rappel asynchrone rendu par `controlerBeneficiaires`), forfait jours
    (famille `rachats` du registre des éléments de lot), fractionnement, conservation des dossiers et agenda, migrations
    nommées du lot 6, tests et banc de rendu du client (`tests/outils/banc-client.ts`). Les règles de `shared/` restent
    synchrones : quand l'une demande une donnée de la base par une fonction (`aDesDonnees` de `categoriesEchues` et
    `categoriesDroitEffacement`), la valeur est lue d'avance (`quantitesAEffacer` ; pour `dossiersEchus`, seulement pour
    les catégories échues sans regarder les données, comme le faisait l'appel à la demande). Le flux de l'agenda
    (`GET /api/agenda/<jeton>.ics`) s'exécute en `enSerie` (jeton, fiche, compte, flux et date du dernier accès d'un seul
    tenant) ; le passage quotidien de la conservation lit le jour du dernier passage dans la transaction qui le note
    (deux passages simultanés n'en font qu'un). Le SQL brut de ces modules est commun aux deux moteurs (voir « Accès à la
    base : PostgreSQL ») : effacement des dossiers d'après le type déclaré de chaque colonne (valeur « renseignée »,
    case décochée à FALSE), balayage de l'identité ligne par ligne par la clé de la table (pas de `rowid`), clé d'une
    déclaration par `Db.jsonCle` ; leurs tests tournent sur les deux moteurs (`nouvelleBase()`), sauf les migrations
    nommées et le banc de rendu du client (SQLite).
- **Accès à la base : PostgreSQL** (sous-étape 8.b, Matrix `docs/architecture-postgres.md` § 4 et § 8). Avec
  `DATABASE_URL`, `openDb()` ouvre le serveur PostgreSQL commun EPC2I (base `epc2i`, rôle `cursus_app`, schéma
  `cursus`) par l'adaptateur `PgDb` (`server/src/db-pg.ts`, pilote `pg`) ; sans elle, SQLite comme avant. Même API `Db` :
  le code applicatif ne sait pas sur quel moteur il tourne.
  - *Connexion.* Pool `pg` (`CURSUS_PG_POOL`, 10 par défaut), `application_name=cursus`, `search_path=cursus` posé par
    le pool (et sur le rôle par le socle) et contrôlé à l'ouverture : jamais de nom de schéma dans le SQL. Parseurs :
    `date` rendu en chaîne `AAAA-MM-JJ`, `timestamptz` en ISO (`toISOString`), `numeric` et `bigint` en nombre, `json`
    décodé (`jsonLu` pour une colonne JSON lue en SQL brut, texte en SQLite, objet en PostgreSQL). Paramètres `?`
    réécrits en `$n` hors chaînes et commentaires ; `insert` par `RETURNING *`.
  - *Concurrence.* Plusieurs instances peuvent partager la base. Écritures : `tx` ouvre `BEGIN` et prend
    `pg_advisory_xact_lock(hashtext('cursus.ecritures'))` (écritures sérialisées, comme la file de SQLite) ; `exclusif`
    prend le même verrou au niveau de la session pour toute la suite, requêtes validées une à une (une réponse HTTP ne
    part jamais avant la validation de ce qu'elle annonce) ; `lecture` : `REPEATABLE READ READ ONLY` (un seul état de
    la base pour `loadFull`). Les requêtes d'une même portée passent l'une après l'autre sur sa connexion.
  - *Schéma.* `server/migrations-pg/` : `0001_init.sql` (50 tables, état final de `TABLES` avant l'étape 2 du lot 6),
    `0002_partage.sql` (vues `pub_` lues par Matrix et les autres outils, sans colonne sensible ni GRANT : les droits
    viennent du socle) et `0003_lot6_etape2.sql` (étape 2 du lot 6 : 7 tables, 57 en tout, colonnes ajoutées, nature
    d'absence `CET` ; sur une base déjà remplie, majoration de nuit figée et délivrances en vigueur reprises en SQL) et `0004_pub_absences.sql` (vue `pub_absences`, demande CU-1 de Crucible : matricule, dates, statut validée ou
    demandée, annulation, `maj_le` posée par un déclencheur ; jamais le type ni le motif ; lecteurs accordés par Matrix) ;
    `0005_astreintes.sql` (lot 7, chantier A : tables `astreintes` et `astreinte_interventions`, 59 tables, activité interne
    `INT-AST` sur une base déjà remplie ; aucune vue `pub_`) ;
    `0006_prevention.sql` (lot 7, chantier B : colonnes `postes.c2p` et `horaires.alternant` du compte professionnel de
    prévention, JSON contrôlés par CHECK ; aucune vue `pub_`) ;
    `0007_formations.sql` (lot 7, chantier C : liste d'attente des sessions, table `attentes_session`, aucune vue `pub_`) ;
    `0008_astreintes_paie.sql` (lot 7, chantier A, étape 2 : `astreintes.lot_id` et `astreintes.sage`, `lots_paie.astreintes`
    de la famille « astreintes » ; aucune vue `pub_`) ;
    `0009_passeport_prevention.sql` (lot 7, chantier B, étape 2 : colonne `formations.passeport_prevention`, cochée en SQL
    sur les formations santé-sécurité d'une base déjà remplie, table `declarations_passeport` avec ses clés étrangères et
    son CHECK « certification ou formation suivie » ; aucune vue `pub_`, aucun NIR) ;
    `0010_evaluations_formation.sql` (lot 7, chantier C, étape 2 : évaluations des formations, table `evaluations_formation`,
    CHECK du type, du répondant, de la note et de l'efficacité, une seule formation évaluée ; aucune vue `pub_`). 62 tables
    en tout.
    Appliquées au démarrage sous `pg_advisory_lock(hashtext('cursus.migrations'))`, pris avant de lire le journal
    `cursus.schema_migrations`, une transaction par fichier ; une migration du journal inconnue de ce code (base mise à
    jour par une version plus récente) ou un schéma `cursus` absent : refus de démarrer. Puis `TABLES` est comparé au
    schéma (table ou colonne manquante : refus). Un fichier publié ne se modifie plus : tout changement passe par un
    nouveau `NNNN_<objet>.sql`, avec la même modification de `TABLES`. Types : dates `AAAA-MM-JJ` en `date`,
    horodatages en `timestamptz`, `real` en `numeric`, `bool` en `boolean NOT NULL DEFAULT false`, `json` en `json`
    (ordre des clés gardé, que `jsonb` perdrait), clés auto en `GENERATED BY DEFAULT AS IDENTITY` (identifiants repris
    tels quels, séquence recalée par `resyncIds`), colonne `rang` pour les référentiels que SQLite ordonnait par
    `rowid`. Clés étrangères des références de `integrite.ts`, CHECK des domaines fermés de `shared/types.ts`.
  - *SQL portable.* Le SQL brut est commun aux deux moteurs : `TRUE` / `FALSE`, `IS DISTINCT FROM`, `CAST(? AS …)` pour
    un paramètre qui peut être nul, alias camelCase entre guillemets (`emp_id AS "empId"`), `ON CONFLICT … DO UPDATE`.
    Fragments propres au moteur fournis par `Db` : `contientEntier` (tableau JSON d'entiers), `like` (ILIKE),
    `jsonTexte` (texte d'une colonne JSON), `jsonCleEgale` (clé d'un objet JSON comparée à un paramètre), `jsonCle`
    (texte d'une clé d'un objet JSON).
  - *Démarrage* (`server/src/demarrage.ts`). SQLite : reprises historiques et migrations nommées. PostgreSQL : le schéma
    part de l'état final ; une base neuve reçoit les amorçages des migrations nommées (activités internes, activité
    formation, horaires de poste d'exemple), puis le rattachement des fiches aux postes, rejoué à chaque démarrage. Le
    jeu de démonstration n'est chargé que si `CURSUS_DEMO=1` sur une base vide, dans la transaction qui la contrôle.
    `npm run backup`, `restore` et `reset-demo` refusent PostgreSQL (sauvegardes du serveur commun : rôle
    `epc2i_sauvegarde`) ; l'application de bureau force SQLite (`DATABASE_URL` vide).
  - *Reprise d'une base SQLite* (sous-étape 8.c, `server/src/reprise-postgres.ts`, `npm run reprise-postgres`) : copie
    cohérente de la base (`VACUUM INTO`, l'original n'est jamais modifié), reprises et migrations nommées appliquées à
    la copie, contrôle de toutes les valeurs d'après les types du schéma cible et des références d'après ses clés
    étrangères (anomalies réunies dans un seul refus), puis copie des tables de `TABLES` dans l'ordre des clés
    étrangères (référence d'une table à elle-même posée ensuite), par lots, en une transaction sous le verrou
    d'écriture : `rang` = `rowid`, colonnes prérequises du partage laissées vides, séquences recalées (`resyncIds`,
    `rang` compris), comptes comparés table par table avant la validation, ligne `migration.postgres` au journal, qui
    rend la commande sans effet ensuite. Cible acceptée : vide, hors amorçages d'une base neuve (`TABLES_AMORCEES`,
    remplacés par ceux de la source).
  - *Tests.* `npm test` sur SQLite ; `npm run test:pg` (`CURSUS_TEST_DATABASE_URL` : base d'administration d'un serveur
    PostgreSQL 16 de test) rejoue la même suite, une base par fichier, un schéma par `nouvelleBase()` (`tests/base.ts`) ;
    les tests des migrations nommées (SQL propre à SQLite) y sont ignorés. Job CI `postgres` : socle de Matrix copié
    dans `infra/postgres-socle/`, couverture de `db-pg.ts`, démarrage en `cursus_app`, rejeu de
    `infra/postgres-partage/20-cursus.sql` et contrôle des colonnes sensibles.
- **Santé** (`server/src/supervision.ts`) : `GET /api/health`, monté avant le limiteur de débit et les autres routes
  `/api`, sans connexion. `SELECT 1` et `PRAGMA user_version` ; 200 `{statut: 'ok', base: 'ok'}`, 503
  `{statut: 'indisponible', base: 'erreur'}`. Appel local non relayé (boucle locale, aucun en-tête `X-Forwarded-*`) ou
  `Authorization: Bearer` égal à `CURSUS_SUPERVISION_TOKEN` : en plus `version`, `mode` (`production`, `demo`,
  `developpement`), `envoisEnEchec` (non classés, toutes cibles), `depuis`, `orphelins` et `references`. Base qui répond
  mais contient des références orphelines : 200 `{statut: 'degrade', base: 'ok'}`, sans nombre en public. Jamais de
  donnée personnelle. Secret client Entra qui expire dans 30 jours ou moins (`CURSUS_OIDC_SECRET_EXPIRE`, date seule,
  `server/src/secret-microsoft.ts`, t184) : `degrade` aussi, et `secretMicrosoft: { expireLe, jours }` dans le détail ;
  le récapitulatif des échéances (`server/src/relances.ts`) en donne une ligne « Exploitation » à la seule boîte du
  service RH, une fois par palier (30 jours, 7 jours, expiré ; clé `exploitation:secret-oidc:<date>` de la table
  `relances`). Elle ne cite l'envoi des e-mails que s'il passe par ce secret (`envoiParSecretOidc`) ; dans ce cas, la
  ligne « expiré » échoue avec l'envoi, et seuls le point de santé et Paramètres → Envois signalent l'expiration.
  Seule, elle renvoie au guide au lieu des écrans de Cursus.
- **Intégrité** (`server/src/integrite.ts`, t179 étape 1) : `REFERENCES` liste les colonnes qui désignent une autre
  table (tous les `emp_id`, `session_id`, formation, habilitation, destination, poste, équipe, manager, lot de paie,
  déplacement Keystone, certification d'une participation) ; `controlerOrphelins` compte, par référence, les valeurs
  renseignées (ni `NULL`, ni `0`, ni vide) absentes de la table visée. `controlerIntegrite` au démarrage
  (`index.ts`, après les migrations et le jeu de démonstration) : avertissement dans les journaux du serveur et ligne
  `integrite.orphelins` au journal des actions (nombres par référence, aucun salarié) s'il y en a ; `etatIntegrite`
  pour la santé, refait au plus une fois par heure (`VALIDITE_CONTROLE`). Aucune clé étrangère ni suppression : les
  contraintes strictes (`REFERENCES` dans `colonnesSql`, migration qui reconstruit les tables) viendront quand la base
  de reprise du 1er janvier 2027 aura été vérifiée sans orphelin. Toute colonne `emp_id` ajoutée au schéma doit y
  figurer (`tests/integrite.test.ts` le vérifie). Une référence polymorphe porte sa condition (`si` : l'objet d'une
  pièce justificative désigne la table de son type) ; les fichiers des pièces absents du dossier ou d'une autre taille
  que celle de l'envoi s'ajoutent au compte (`controlerPieces` de `server/src/pieces.ts`).
- **Performances** (t171, version courte) : `npm run mesure` (`scripts/mesure-instantane.ts`) construit une base
  temporaire de 100 salariés sur 3 ans (15 000 feuilles validées, 4 300 absences, journal) et mesure l'instantané et
  les actions. Mesure du 17 octobre 2026 : instantané RH 7,1 Mo en JSON (100 à 170 Ko compressés sur ce jeu très
  répétitif ; davantage sur des données réelles), manager 0,9 Mo, collaborateur 0,1 Mo ; lecture complète de la base
  (`loadFull`) 0,23 s, `/api/data` 0,25 s, saisie d'une cellule d'heures 0,43 à 0,48 s (lecture complète avant
  l'action, instantané complet après). Livré : index sur `emp_id` des tables qui grossissent (migration
  `lot5-exploitation-index-salaries`, `migrations/exploitation.ts` ; les feuilles l'ont par leur contrainte unique, le
  journal porte ses salariés en JSON), compression, un seul `Domain` par instantané côté client (`domaineDe` de
  `client/src/state/derived.ts`, partagé par `useDomain` et la coque `layout/Shell.tsx`). Pas encore : chargement par
  périmètre en SQL dans `loadFull` et renvoi partiel de l'instantané (entité modifiée seule, action par action), à
  reprendre si la mesure dépasse la seconde.
- **Réinitialisation de la démonstration** (`server/src/reset.ts`, garde-fous dans `server/src/reinitialisation.ts`) :
  refusée hors `CURSUS_DEMO=1`, avec `NODE_ENV=production` sauf l'application de bureau (`demoSurBoucleLocale`) et l'instance publiée (`demoPublique`), sur
  une base qu'un serveur en service n'a pas encore mise à jour (`controlerPourOutil`), sur une base qu'un serveur
  utilise (verrou, `serveurActif`) sauf `--force` ; confirmation par `--yes` ou par le mot `EFFACER` tapé dans un
  terminal (sans terminal ni `--yes` : refus). Base existante copiée (« avant-reinitialisation ») avant l'effacement.
- **Base sur le disque** (`server/src/protection.ts`) : `protegerBase` ramène la base et ses fichiers `-wal`, `-shm`
  en `600` et son dossier en `700` (créé ainsi ; un dossier partagé — bit sticky, racine du système ou du projet,
  dossier de lancement, autre propriétaire — n'est jamais modifié, avertissement ; le dossier personnel du compte de
  service, `/var/lib/cursus`, est bien restreint) ; en production, `ProtectionError`
  (démarrage refusé, code 1) si un fichier reste accessible à d'autres comptes. Une base neuve est créée vide en `600`
  par le constructeur `Db`, avant que SQLite ne l'ouvre. `retirerSecretStocke` supprime le réglage `secret` (clé de
  session générée sans `CURSUS_SECRET`) dès que la variable est définie, avec `secure_delete` puis
  `wal_checkpoint(TRUNCATE)` : la clé ne reste ni dans une page libérée ni dans le `-wal`. Pas de chiffrement applicatif des colonnes :
  disque chiffré chez l'hébergeur (prérequis de `docs/DEPLOIEMENT.md`), avis du DPO attendu.
- **Application et démarrage** : `createApp(db, options)` (`server/src/app.ts`) construit l'application Express sur une
  base déjà ouverte et migrée : journal des requêtes, compression, en-têtes de sécurité, santé, Keystone, débit, CSRF,
  routes, interface compilée, puis 404 JSON de `/api` et gestionnaire d'erreurs final, montés en dernier (rien après).
  `server/src/index.ts` ne garde que le démarrage : console redirigée, contrôle de la configuration, protection de la
  base, verrou, migrations, `createApp`, écoute et tâches de fond. Les tests montent `createApp` dans leur processus
  (`tests/http.test.ts`, options `dist`, `production`, `compression`, `journalRequetes`) ; les scénarios de démarrage
  et d'arrêt gardent de vrais serveurs (`tests/exploitation.test.ts`).
- **Erreurs** (`server/src/erreurs.ts`) : toujours `{ error }` en JSON, sans pile : `/api` inconnue 404, JSON illisible
  (`entity.parse.failed`) 400, corps au-delà de `LIMITE_CORPS` (2 Mo, `entity.too.large`) 413, autre refus 4xx d'un
  module (encodage, adresse mal formée) son statut, sinon 500 `Erreur interne` ; `signalerErreur` écrit la pile dans
  les journaux (aussi pour une action qui jette autre chose qu'une `ActionError`). L'API Keystone garde son propre
  gestionnaire (codes d'erreur du contrat).
- **Journaux du serveur** (`server/src/logs.ts`) : `log.info / avertissement / erreur`, une ligne JSON (`heure`, `niveau`,
  `message`, champs) si `CURSUS_LOG_FORMAT=json` (défaut en production, `formatJournaux` de `config.ts`), le message
  seul sinon. `redirigerConsole()` (au démarrage, en JSON seulement) fait passer par là les `console.*` du reste du
  serveur. `journalRequetes()` écrit une ligne par requête à la fermeture de la réponse : méthode, `cheminJournal`
  (sans paramètres, caractères imprimables, 200 au plus), statut, durée, compte (noté par `readSession` via
  `noterCompte`), `interrompue` ; jamais le corps ni les paramètres ; sonde de santé réussie omise. Un nouveau message
  d'exploitation passe par `log`, jamais par `console.log` direct dans `index.ts` ou `service.ts`.
- **Compression et cache** (`server/src/compression.ts`, `app.ts`) : middleware sans dépendance (node:zlib) qui
  intercepte `res.write` / `res.end` et décide au premier envoi : brotli (qualité 5) sinon gzip, texte / JSON /
  JavaScript / SVG de 1 Ko et plus, ni HEAD, ni 204 / 206 / 304, ni `no-transform` ; `Vary: Accept-Encoding`, ETag
  rendu faible, contre-pression respectée. `CURSUS_COMPRESSION=0` (`compressionActive`) la retire. `/assets` : un an,
  `immutable`, fichier absent 404 en texte (jamais `index.html`) ; `index.html` : `no-cache` ; `/api` : `no-store`
  (`securite.ts`).
- **Interface découpée** (t176) : `client/src/App.tsx` charge chaque page de `PAGES` à la demande (`React.lazy`,
  `aLaDemande(import(...), 'NomExporte')`, dans un `Suspense` sous l'`ErreurRendu` de la page) ; l'écran de connexion
  et celui du mot de passe restent dans le fichier principal. `DialogHost` et tous les dialogues forment un fichier à
  part, préchargé dès que les données arrivent et monté seulement quand un dialogue est ouvert (fichier introuvable :
  `ErreurDialogue`). `vite.config.ts` met React et les icônes Phosphor dans leurs propres fichiers (`manualChunks`) ;
  seuil d'avertissement par défaut (500 Ko). Police Inter en sous-ensemble latin (`client/src/main.tsx`). Une nouvelle
  page s'ajoute dans `PAGES` avec `aLaDemande`, jamais par un import statique.
- **Installation** : `deploy/` reprend à l'identique les blocs de `docs/DEPLOIEMENT.md` et `docs/SAUVEGARDE.md`
  (`tests/exploitation.test.ts` les compare : modifier les deux ensemble) ; `Dockerfile` facultatif.

## Vérification du code

`npm run check` = `lint`, `typecheck`, `test:coverage`, `test:client`, `build` : ce que la CI exécute
(`.github/workflows/ci.yml`, après `npm ci`, Node de `.nvmrc`, essai non bloquant sur Node 24, `dist/` publié en
artefact). `test:coverage` mesure la couverture des lignes, branches et fonctions du serveur et de `shared/` (`client/`,
`tests/` et `scripts/` exclus : le client est mesuré à part) et échoue sous les seuils écrits dans le script
(`--test-coverage-lines`…), fixés juste sous la mesure du jour : les relever quand des tests s'ajoutent, jamais les
baisser pour faire passer un ajout non testé. Les serveurs lancés par les tests avec l'environnement du test sont
mesurés aussi. `typecheck` comprend le contrôle des promesses non attendues (`scripts/verifier-await.mjs`, voir « Accès
à la base »). `@types/node` suit Node 22.

Contrôle du code (t163) : `npm run lint` lance oxlint (`.oxlintrc.json`), et non ESLint : TypeScript 7 (version native)
n'expose pas l'API JavaScript dont typescript-eslint a besoin, alors qu'oxlint analyse seul le TypeScript et le JSX.
Catégorie « correctness » bloquante (plugins typescript, react, import, unicorn, oxc) ; `react/rules-of-hooks` bloquant ;
`react/exhaustive-deps` en avertissement (signalé, non bloquant) : un cas voulu se justifie dans le code par
`// oxlint-disable-next-line <règle> -- <raison>`, comme les quelques exceptions existantes (expressions régulières qui
retirent les caractères de contrôle, remise à zéro de `ErreurRendu`, légende des champs obligatoires de `Dialog`). Les
règles du React Compiler (`react/refs`, `react/set-state-in-effect`…) sont coupées : Cursus ne l'utilise pas, et elles
visent des idiomes voulus (refs « dernière valeur » des fenêtres modales).

Contrat des actions (t164, étape 1) : chaque famille de `server/src/actions/` est déclarée
`{ … } satisfies Record<string, ActionHandler>`, ce qui garde ses noms ; `NomAction` (`server/src/actions/index.ts`)
les réunit et type `run` (`state/store.tsx`), `api.action` (`api.ts`) et `Confirmation.action`
(`state/confirmations.ts`), par un import de type seulement (rien du serveur n'entre dans l'interface compilée) : une
faute dans un nom d'action est une erreur de `tsc`. `tests/actions-contrat.test.ts` relève en plus les noms écrits dans
les sources du client et les gabarits (`hab.${action}`) et vérifie qu'ils existent dans `ACTIONS`. Les contenus
(`ActionPayloads`) ne sont pas encore typés : le serveur les contrôle à l'exécution.

Modules du client sous `node --test` (t159, étape 1) : les modules sans JSX s'importent directement depuis `tests/`
(Node n'enlève que les types). `tests/outils/client-node.ts`, importé en premier, fait le reste sans dépendance :
`state/store.tsx` remplacé par le magasin factice `tests/outils/store-factice.ts` (`poserMagasin` : instantané, `ui`,
`run` espionné), `*.css?url` remplacé par son chemin, et `rendreHook` rend un hook par `react-dom/server` (sans DOM :
les effets ne s'exécutent pas, leur logique sort dans une fonction testée directement, comme `suivreMedia` de
`components/media.ts` et `placerPanneau` de `components/panneau.ts`). Exemple : `tests/client-modules.test.ts`.

Exécution des actions et rendu (t159, étape 2) : la logique de `run` (réponse, message, attente de la reconnexion après
un 401 puis rejeu dans l'ordre, abandon « action non enregistrée », 409 qui fait suivre la session, relecture après un
refus, double envoi) est sortie de `state/store.tsx` dans `state/run.ts`, testée sans React par
`tests/client-run.test.ts`. Les dialogues et écrans se rendent sous `node --test` sans Vite (un seul lanceur) :
`tests/outils/rendu.ts`, importé en premier, pose le DOM de happy-dom (`@happy-dom/global-registrator`) avant React,
compile les `.tsx` à la volée (transformateur oxc fourni par rolldown, que Vite installe), avec carte des sources pour la
couverture ; `@testing-library/react` rend, cherche par rôle et libellé, clique et saisit. `tests/outils/banc-client.ts`
monte l'écran sur une base de démonstration en mémoire : `run` exécute la vraie action du serveur avec les droits de la
personne, et l'écran se redessine avec l'instantané renvoyé. `tests/client-dialogues.test.ts` : refus avec motif
(dialogue « confirmer »), demande et validation de congé, feuille de temps saisie et soumise, réouverture d'une feuille
(motif obligatoire, administrateur RH seul), sortie, inscription. `npm run test:client` lance `tests/client-*.test.ts`
avec la couverture de `client/**` seule et ses propres seuils, modestes au départ (lignes 58, branches 62,
fonctions 48) : la mesure ne compte que les fichiers chargés par ces tests, à relever avec eux.

Tests de bout en bout (t165) : `npm run e2e` (Playwright, `playwright.config.ts`, `e2e/*.spec.ts`), après
`npm run build`. `scripts/e2e-serveur.mjs` lance le serveur avec `NODE_ENV=test`, `CURSUS_DEMO=1`, une base jetable
dans un dossier temporaire (effacée à l'arrêt), `CURSUS_TODAY=2026-10-10` et le port `CURSUS_E2E_PORT` (4310) ; chaque
test repart du jeu de démonstration (`demo.reinitialiser`, d'où un seul test à la fois) et échoue sur toute erreur de la
console (violation de la CSP comprise). Projets : `chromium`, `msedge` (canal Edge ; `CURSUS_E2E_SANS_EDGE=1` sur un poste
sans Edge) et `telephone` (Pixel 7 : menu en tiroir, feuille de temps jour par jour). Parcours : compte local (mot de
passe provisoire puis changement), collaborateur (feuille de temps, congé à la demi-journée), manager (validation de la
feuille et du congé, refus avec motif, inscription à une session), RH (refus d'une demande avec motif, réouverture avec
motif, sortie, export CSV téléchargé). La connexion Microsoft n'y figure pas : elle se teste avec le faux fournisseur
(`tests/microsoft.test.ts`) en attendant l'inscription réelle. CI : tâche `e2e` séparée, non bloquante au début, qui
publie `playwright-report/`. `CURSUS_E2E_CHROMIUM` désigne un Chromium déjà installé (poste sans téléchargement des
navigateurs de Playwright) ; `CURSUS_DIST` sert une interface compilée ailleurs que dans `dist/`.

Dépendances (t161) : `npm run audit` (`npm audit --omit=dev --audit-level=high`) est une étape de la CI, bloquante,
après `check` ; l'audit de toutes les dépendances y est seulement informatif (`continue-on-error`). Il reste hors de
`check`, qui ne demande pas le réseau. `.github/dependabot.yml` : npm, actions GitHub et image Docker, chaque semaine,
mineures et correctifs regroupés ; `@types/node` et l'image `node` restent en version 22.

Cas de paie (t160) : `tests/cas-paie.test.ts` rejoue chaque `tests/cas-paie/<nom>.json` sur une base en mémoire neuve
(migrations nommées appliquées, réglages du cas, fiche, compteurs repris, absences, feuilles validées avec régime et
mode des heures supplémentaires figés), à la date du cas, et compare valeur par valeur les compteurs (`cpInfo`,
`rttInfo`, `recupInfo`), le décompte de chaque semaine (`calcSheet`) et les lignes du fichier d'import
(`lignesFichier(buildSagePayload(...))`). `controlerCas` refuse tout champ inconnu à chaque niveau, une valeur hors
des listes de shared/constants.ts (statut, nature de contrat, temps de travail, type d'absence) ou que Paramètres
corrigerait, et, dans le dépôt, un cas `source: "paie"` avec une nature d'absence médicale ; ces cas se rejouent depuis
un dossier hors du dépôt (`CURSUS_CAS_PAIE`, chemin absolu). Format et règles d'ajout : `tests/cas-paie/LISEZMOI.md`.

## Conventions d'écran

- Reprendre fidèlement le prototype `design/prototype-suivi-formations.dc.html`
  (structure, libellés, ordre des colonnes, textes d'aide). Ses valeurs calculées sont
  dans `renderVals()` ; les règles correspondantes existent déjà dans `shared/`.
- Utiliser les composants de `components/ui.tsx` et `components/Dialog.tsx` et les
  classes de `styles/app.css` ; les couleurs, espacements et rayons viennent toujours
  des variables Nocturne (`var(--color-*)`, `var(--space-*)`…), jamais de valeurs en dur.
- Les filtres et sélections persistants entre écrans vivent dans `ui` (`useStore().ui`,
  `setUi`) ; l'état local d'un formulaire vit dans le composant.
- Adresse de la page (t154, `state/url.ts`) : chaque vue déclare dans `PARAMS_URL` les champs de `ui` qu'elle y met, sous
  un nom français (`/collaborateurs?fiche=12&statut=a-renouveler`, `/temps?salarie=12&semaine=2027-01-04`,
  `/formations?formation=sst`, `/habilitations?filtre=en-attente`, `/voyages?voyage=4`, `/echeances?type=contrats`,
  `/referentiels?onglet=postes`, `/budget?exercice=2027&statut=engage`, `/chantiers?chantier=…`). Jamais de texte libre
  (la recherche reste en mémoire) ni d'autre donnée personnelle qu'un identifiant numérique. L'adresse est lue au
  chargement (F5, lien partagé), à la connexion et sur Précédent ; une valeur invalide, ou un identifiant absent du jeu de
  données du rôle, est ignorée sans message. Aucun dialogue ne s'ouvre depuis l'adresse. L'ouverture d'une fiche ajoute une
  entrée à l'historique (Précédent la referme) ; un filtre remplace l'entrée courante. La reconnexion et la connexion
  Microsoft reviennent à la page avec ses paramètres (200 caractères au plus, `pageDeRetour`). La déconnexion (Microsoft
  comprise) et « Changer de compte » remettent l'adresse à « / » : la personne suivante ne reprend pas l'écran de la
  précédente. Les valeurs par défaut de `PARAMS_URL` sont celles de `INITIAL_UI` (contrôlé par le test). « Copier le lien »
  (`components/CopierLien.tsx`) sur la fiche et la feuille de temps. Un nouveau filtre partageable s'ajoute à `PARAMS_URL`.
- Tri et pagination des grandes listes (t145, `components/tri.ts`, `components/TriListe.tsx`) : une table des colonnes
  triables (`parTexte` : ordre alphabétique français ; `parNombre`, `parDate` : date ISO ou Date ; `parRang` : rang d'un
  statut), `useTri('<écran>.<liste>')` et `<ThTri t={t} col="…">` dans l'en-tête (bouton, `aria-sort` sur la seule colonne
  triée). Sans clic, l'ordre par défaut de l'écran est gardé ; un clic trie, un deuxième inverse, un troisième revient à
  l'ordre par défaut ; valeurs vides en dernier, égalités dans l'ordre par défaut. Le tri se garde par liste dans
  `ui.tris` (pas dans l'adresse). `usePagination(lignes, filtres)` affiche 50 lignes (`TAILLE_PAGE`, sans réglage) au-delà
  de 50, puis « Afficher 50 de plus » ou « Tout afficher » (`<SuiteListe>`), et revient aux 50 premières quand le résumé
  des filtres change. Un export CSV prend toutes les lignes filtrées et triées, jamais la seule page affichée. Écrans :
  Congés & absences (soldes : recherche nom, poste ou matricule, équipe ; absences : état, type, période ;
  `pages/absences-filtres.ts`), Collaborateurs, Habilitations, renouvellements de l'équipe (Formations), Échéances (dans
  chaque mois), suivi des feuilles (Temps, tri seulement), comptes (Paramètres).
- Recherche de collaborateurs (t152, `components/recherche.ts`) : même texte cherché que l'annuaire (`texteRecherche` de
  `shared/format.ts` : nom, poste, équipe, matricule de paie, EMP-xxxx ; accents et casse ignorés), dans le jeu de
  données du rôle, sans API. L'en-tête (`layout/RechercheGlobale.tsx`) propose 8 suggestions au plus : Entrée ou un clic
  ouvre la fiche (`go('collaborateurs', { selectedId, search: '' })`), « Voir tous les résultats » ouvre l'annuaire
  filtré ; dans les deux cas, les filtres d'équipe et d'état de l'annuaire reviennent à « tous » (`ANNUAIRE_SANS_FILTRE`),
  pour que la fiche s'y trouve et que le compte soit celui des lignes ; ouverte au service RH, aux profils de l'espace RH qui ont l'annuaire et au manager (son équipe, sans
  lui-même) ; raccourci « / » hors d'un champ, Ctrl+K ou Cmd+K (jamais pendant un dialogue). Une liste de salariés dans
  un dialogue ou un filtre est un `<ChoixCollaborateur id=… emps=… valeur=… onChange=…>` (combobox ARIA 1.2 : flèches,
  Entrée, Échap qui referme d'abord la liste ; `vide` : option « aucun » ; `requis`, `erreur` du Field) et non un
  `<select>`. Sa valeur ne désigne jamais une autre personne que le texte (`components/combobox.ts`) : un nom complet tapé
  choisit la personne ; un champ `requis` quitté sur une saisie partielle passe à « aucun » et la vérification du
  formulaire le signale ; un filtre revient au choix affiché. Champs concernés : Signaler et Saisir une absence, « Pour » des demandes du manager, salarié de la feuille de temps, salarié
  du journal.
- Dialogue ouvert depuis un autre : `<Dialog fermer={…}>` y revient au lieu de se fermer (Annuler, Échap, fond). « Créer
  une session » depuis « Planifier » (t107) passe le dialogue d'origine (`retour`) ; la session créée y est présélectionnée
  (`dialogs/retour-session.ts`).
- Grille lisible sans la couleur (t148, `pages/PlanningMissions.tsx`) : vrai tableau (`caption`, en-têtes `scope`), date
  complète en texte masqué, lettre dans chaque case, résumé par ligne ; cases en boutons à focus itinérant (flèches,
  Début, Fin), détail du jour affiché sous la grille au focus ou au toucher, annoncé (zone `aria-live`) au toucher ou au
  clic seulement : au clavier, le libellé de la case suffit.
- Ouvrir un dialogue : `openDialog({ type: 'plan', … })` (types dans `state/store.tsx`).
  Un dialogue garde ses champs en `useState`, appelle `run(...)` et se ferme si `r.ok`.
  Dialogue de saisie : `onSubmit` sur `<Dialog>`, `<SubmitButton busy={busy}>`, `Field` avec `requis` et
  `erreur={v.erreur(…)}`, et `if (!v.verifier(…erreurs)) return;` en tête de l'envoi (`useVerification`) ; jamais de
  bouton principal grisé pour une saisie incomplète (`tests/dialogues.test.ts`).
- Refus ou action irréversible : `openDialog({ type: 'confirmer', c: refusAbsence(…) })` (`state/confirmations.ts`),
  jamais `window.confirm` ; un refus porte un motif obligatoire, et l'aide du motif nomme ceux qui le liront.
- Un bouton d'action hors dialogue (valider, refuser, engager, supprimer une ligne) passe par `useAgir()` de
  `state/actions.ts` : `disabled={occupe}` et `onClick={agir(() => run(...))}` ; une transition envoie l'état
  affiché quand le serveur l'accepte (statut attendu, ligne visée).
- Les propositions d'action calculées par le domaine (`Proposal.intent`) s'exécutent
  avec `runIntent(intent)`.
- Masquer les actions que le rôle n'a pas le droit d'effectuer (le serveur refuse de
  toute façon) : `useRole()` donne `espaceRh` (vues d'ensemble), `rh`, `admin` (administrateur RH), `formations`,
  `paie`, `consultation`, `manager`, `collab`, `me` et `soi` (salarié du compte, y compris dans l'espace RH) ;
  `useIntentPermis()` filtre les propositions d'action du domaine.
- Icônes : Phosphor (`@phosphor-icons/react`, noms suffixés `Icon`).

## Cadre commun du lot 4 : migrations nommées, réglages, sections de Paramètres

Les chantiers menés en parallèle écrivent leurs migrations, leurs réglages et leurs sections de Paramètres dans leurs
propres fichiers ; les fichiers communs ne reçoivent qu'une ligne par ajout (`liste.ts`, `REGLAGES`, `Settings`,
`sections.tsx`), à garder toutes lors des fusions.

### Démarrage de la base

`server/src/index.ts`, dans l'ordre : contrôle de la configuration ; droits du fichier (`protegerBase`, voir
« Exploitation ») ; verrou (`<base>.pid`) ; `controlerMigrations` : une base qui porte une migration
inconnue de ce code (mise à jour par une version plus récente) est refusée avant toute écriture, code 1, message
« restaurer la copie avant-migration » ; ouverture (`openDb` : tables et colonnes de `TABLES` ajoutées) ; reprises
historiques de `server/src/migrate.ts`, rejouées à chaque démarrage et laissées telles quelles ; migrations nommées
(`appliquerMigrations`). Une seule copie `…-avant-migration.db` par démarrage, faite par la première étape qui modifie
une base existante, et au plus tard avant d'enregistrer le premier nouveau nom de migration, même seulement noté fait :
ce nom suffit à faire refuser la base par la version précédente. Le chemin de cette copie est enregistré avec chaque
nom ; c'est elle que le refus d'une version plus ancienne nomme (celle de la première migration qu'elle ne connaît pas).

`npm run comptes` et `npm run reset-demo -- --yes` (`controlerPourOutil`) font le même contrôle, puis, service arrêté, mettent la
base à jour comme le serveur (reprises, migrations nommées) avant d'y écrire ; service en marche sur une base qu'il n'a
pas encore mise à jour pour ce code (nouvelle version installée, service pas redémarré) : refus, « redémarrer d'abord
le service ». Un outil n'écrit ainsi jamais dans le nouveau schéma des lignes qu'une migration reprendrait ensuite.

### Ajouter une migration nommée

Pour une reprise de données à ne faire qu'une fois (lots historiques, mode des heures supplémentaires, date d'arrêté des
soldes, postes, coût réel, rubriques…), un renommage ou une suppression de colonne, une contrainte, un index. Une table
ou une colonne nouvelle n'en demande pas : la déclarer dans `TABLES` (`server/src/db.ts`) suffit.

1. L'écrire dans le fichier du chantier, `server/src/migrations/<chantier>.ts` (modèle : `exploitation.ts`) :

   ```ts
   export const LOTS_HISTORIQUES: Migration = {
     nom: 'lot4-paie-lots-historiques',
     necessaire: async db => …,                                // facultatif ; faux : notée faite, sans être exécutée
     executer: async db => { …; return `${n} lots repris`; },  // compte rendu facultatif, affiché au démarrage
   };
   ```

2. Ajouter une ligne à la fin de `MIGRATIONS` (`server/src/migrations/liste.ts`), après celles dont elle dépend.
3. La tester (modèle : `tests/migrations.test.ts`) sur une base préparée dans l'ancien état, où elle n'est pas encore
   enregistrée : `appliquerMigrations(db)` (liste complète, qui la contient) renvoie son nom et fait la reprise ; sans
   effet sur une base neuve ; `[]` au démarrage suivant. Une liste réduite
   (`appliquerMigrations(db, [LOTS_HISTORIQUES])`) n'est possible que sur une base sans aucune migration enregistrée :
   un nom enregistré absent de la liste fait refuser la base (« version plus récente »). Une migration d'essai propre au
   test s'ajoute à la liste complète : `appliquerMigrations(db, [...MIGRATIONS, essai])`.

Règles :

- **Nom** : `lot<n>-<chantier>-<objet>` (minuscules, chiffres, tirets), unique et définitif. Il est enregistré dans la
  table `migrations` de la base (nom, date `appliquee`, `executee` : 0 si seulement notée faite, `copie` : copie
  avant-migration faite juste avant) ; aucun numéro de version global (`PRAGMA user_version` reste à 0), d'où aucune
  collision entre chantiers. Une migration n'est jamais renommée ni retirée de la liste, même devenue inutile
  (`executer: () => {}`) : une base qui porte un nom absent de la liste est refusée au démarrage.
- **Une seule fois, tout ou rien** : chaque migration s'exécute dans une transaction, avec l'enregistrement de son nom,
  après la copie « avant-migration » d'une base existante. Une erreur annule tout ce qu'elle a fait (les précédentes
  restent faites) ; le serveur refuse alors de démarrer (`Démarrage impossible : migration … interrompue`) et la
  retente au démarrage suivant.
- **Base neuve** : la migration s'y exécute aussi (schéma déjà à jour, aucune donnée, avant le jeu de démonstration,
  que `npm run reset-demo` ne recharge lui aussi qu'une fois la base à jour) et doit y être sans effet. Une base
  existante déjà dans l'état visé ne doit pas être modifiée : `necessaire` renvoie faux (`colonneExiste`, `indexExiste`
  de `outils.ts`, ou une requête qui compte les lignes à reprendre).
- **Contenu** : préférer des requêtes SQL au code métier, qui évoluera ; la migration doit produire le même résultat
  quand une base restée ancienne la recevra plus tard. Une reprise qui change des données métier se trace dans le
  journal (`journaliser`, action `migration.<objet>`), comme `reprendreDetachements` de `migrate.ts`, et déclare son
  action dans `shared/journal.ts` : libellé dans `JOURNAL_LABEL`, famille du filtre « Action » dans `FAMILLES_JOURNAL`
  (comme `migration.detachement` dans « Déplacements »), et, si elle touche la paie, `ACTIONS_PAIE` (ou un code
  `sage.…`) : `estActionPaie` décide de l'archive de 3 ans, sans quoi la ligne est supprimée au bout d'un an. Jamais de
  texte libre ni de donnée de santé dans ce qui est tracé.
- **Colonne renommée ou supprimée, type changé, contrainte ajoutée** (`unique` de `TABLES`) : modifier `TABLES`, puis
  dans la migration `reconstruireTable(db, 'table', { depuis: { nouveauNom: 'COALESCE(nouveau_nom, ancien_nom)' } })`
  (`outils.ts` : nouvelle table, lignes recopiées, index recréés, compteur des identifiants conservé ; `ligne` pour une
  transformation en JavaScript, le chiffrement d'une colonne par exemple), avec
  `necessaire: db => colonneExiste(db, 'table', 'ancienNom')`. À l'ouverture, le schéma déclaratif ajoute la nouvelle
  colonne avant la migration : les lignes existantes l'ont vide, mais celles écrites entre-temps par cette version (une
  reprise de `migrate.ts`) l'ont remplie et l'ancienne vide, d'où `COALESCE` plutôt que l'ancien nom seul, qui les
  effacerait. Les colonnes absentes de `TABLES` sont abandonnées (un index qui en porte une est à supprimer avant,
  `DROP INDEX` dans la migration) ; une ligne qui viole la nouvelle contrainte fait échouer la migration.
  **Avant de renommer ou de supprimer une colonne**, relire les reprises de `server/src/migrate.ts` (et les fonctions
  qu'elles appellent, `migrerKeystone`…) qui la lisent : elles passent à chaque démarrage *avant* les migrations
  nommées, sur la nouvelle colonne encore vide. Une reprise qui teste `nouvelle_colonne IS NULL` agirait sur toutes les
  lignes (`migrerKeystone` supprime les tâches sans `debut`) : la faire attendre la migration
  (`if (colonneExiste(db, 'table', 'ancienNom')) return;`) ou lui faire lire l'ancienne colonne.
- **Index** : `CREATE INDEX IF NOT EXISTS …` dans une migration, `necessaire` avec `indexExiste` (modèle : `index()` de
  `exploitation.ts`), plus jamais dans une fonction appelée à chaque démarrage.

Retour à une version précédente : `docs/DEPLOIEMENT.md`, « Mise à jour ».

### Ajouter un réglage

Réglages de l'écran Paramètres, modifiés par l'administrateur RH (`parametres.maj`) et lus dans `data.settings`
(client, domaine) ou `loadSettings(db)` (serveur) :

1. `shared/types.ts`, interface `Settings` : le champ.
2. `shared/reglages.ts`, table `REGLAGES` : sa ligne, dans le groupe de sa section, `champ: { defaut, controle }`.
   Contrôles prêts : `entier(min, max, pas)` (borné, arrondi au pas), `booleen`, `choix(valeurs, sinon?)`,
   `texte(max, libellé)` (une ligne, espaces réduits, refus au-delà de `max`), `parmi(valeurs)` (cases à cocher d'une
   liste fermée), `jourDeLAnnee` (« MM-JJ ») ; sinon une
   fonction `(v, actuelle) => valeur` qui borne ou ramène la saisie, ou lève `ReglageInvalide('message')` : refus 400,
   rien n'est enregistré. Un champ de `Settings` sans ligne ne compile pas ; sans `controle`, l'écran ne le modifie pas.
   Un contrôle qui porte sur plusieurs champs (ouverture avant la clôture d'une campagne) s'ajoute à `COHERENCES`, après
   ceux de chaque champ.
3. `shared/journal.ts`, `CHAMP_LABEL` : son libellé, sous lequel le journal affiche l'ancienne et la nouvelle valeur
   (« Seuil d’alerte : 60 → 90 ») ; sans lui, le nom brut du champ.
4. Une règle qui lie plusieurs champs (repos de remplacement des heures supplémentaires : la référence de l'accord est
   exigée) : une ligne dans `COHERENCE` (`shared/reglages.ts`), appliquée aux réglages complets après les contrôles.

Rien d'autre côté serveur : `DEFAULT_SETTINGS` est tiré de la table, `parametres.maj` contrôle et enregistre, le journal
trace l'ancienne et la nouvelle valeur ; un réglage en texte libre (`heuresSupAccord`) est déclaré dans `masques` de la
règle de `parametres.maj` (`server/src/journal.ts`) : le journal n'en garde que « [texte renseigné] ». Une base existante a la valeur par défaut tant que l'administrateur ne l'a pas
changée ; une migration nommée ne sert que pour donner aux bases existantes une autre valeur que celle des bases neuves.
Les réglages sont transmis à toute personne connectée (managers et collaborateurs compris) et recopiés dans le journal :
codes, nombres, dates, cases à cocher seulement, jamais de texte libre ni de donnée personnelle. Un réglage plus riche
(adresses de la messagerie) ou modifiable par un autre profil a sa propre action et sa propre clé de la table
`settings`, comme `messagerie.regler`. Tests : `appliquerReglages` (`tests/reglages.test.ts`).

### Ajouter une section de Paramètres

1. Un fichier `client/src/pages/parametres/<Nom>.tsx` qui exporte `function <Nom>({ s, envois }: SectionProps)`
   (`commun.ts`) et rend un `<Panel>` : réglages lus dans `s`, enregistrés par `useEnregistrerReglages()(patch)` ;
   contrôles désactivés sans `useRole().admin` (le gestionnaire RH et la lecture seule consultent) ; la section se
   masque en renvoyant `null` (profil, démonstration…). Chaque modification s'enregistre aussitôt (sélecteur, case) ou
   au bouton « Enregistrer » d'un groupe de champs (Messagerie).
2. Une ligne dans `SECTIONS` (`client/src/pages/parametres/sections.tsx`) : `{ id, place, Section }`, `place` valant
   `gauche` ou `droite` (deux colonnes du haut) ou `large` (pleine largeur, dessous) ; l'ordre de la liste est celui
   de l'écran.

`pages/Parametres.tsx` ne contient que le cadre de la page et le chargement des envois (`useSuiviEnvois`), qu'il passe
aux sections ; `tests/reglages.test.ts` vérifie que chaque fichier de section est inscrit dans `SECTIONS`.

## Actions disponibles

« RH » : administrateur et gestionnaires RH ; « administrateur RH » : profil `rh_admin` seulement ; « référent HSE »,
« paie » : profils restreints `referent_hse` et `paie` (la lecture seule n'exécute aucune action). Un membre du RH ne
décide jamais pour lui-même (« Décision sur soi-même »). `tests/droits.test.ts` vérifie chaque action pour neuf
profils et échoue si une action n'y a pas sa ligne.
Une nouvelle action déclare aussi ce que le journal en retient (`REGLES` de `server/src/journal.ts`) : sans règle,
aucun champ du paramètre n'est recopié.

| Action | Paramètres | Droits |
| --- | --- | --- |
| `employe.creer` | fiche complète (`ProfilInput` de `shared/rules/profil.ts`, matricule de paie compris : unique), reutiliserMatricule? (réembauche : matricule d'un salarié sorti) | RH ; réutiliser un matricule : administrateur RH |
| `employe.modifier` | id + champs de la fiche (l'écran n'envoie que ceux modifiés), avant? (valeur à l'ouverture de chaque champ envoyé, et d'eux seuls, sinon 400 : un champ changé entre-temps fait tout refuser, 412, rien n'est enregistré ; auteur nommé au service RH seul ; jamais recopié au journal), reutiliserMatricule?, `confirmerRtt` (changement de régime qui ne laisse aucun RTT acquis dans l'année ou rend le solde négatif), tempsDepuis futur (avenant programmé, organisation du temps seulement, un seul à la fois : historique des contrats), motifRecours, cddFinInitiale (CDD) ; ni le motif ni la date d'une sortie enregistrée | RH : tous ; manager : `poste` (intitulé précisé ; le poste du référentiel, `posteId`, reste au RH), `jourOff` (temps partiel) des membres de son équipe ; changer ou retirer un matricule de paie déjà enregistré, réutiliser celui d'un salarié sorti : administrateur RH |
| `employe.sortie` | id, date (dernier jour du contrat), motif (`MOTIFS_SORTIE`) ; refusée tant que le salarié encadre une équipe, qu'une feuille porte des heures après la date, qu'une absence est à cheval sur elle, au-delà de la fin prévue du contrat ou quand aucun autre administrateur RH ne reste en place après la date ; une sortie enregistrée se modifie par la même action ; solde des compteurs à la date photographié (`soldesSortie`), refait à la modification sauf s'il est déjà transmis (même date ; à une autre date, l'ancien est remplacé et un nouveau photographié) ; 409 tant que ce solde est dans un lot de paie à confirmer | RH (jamais pour lui-même) ; administrateur RH seul pour un salarié dont le compte ouvre l'espace RH |
| `employe.autorisationTravail` | id, requise (faux : ressortissant français, de l'UE, de l'EEE ou de la Suisse, titre effacé), type (`TYPES_TITRE_SEJOUR`), numero, expire (sauf résident permanent), demandeLe (envoi de la demande d'authentification) et verifieLe (réponse de la préfecture), jamais futures ; avertissements sans blocage (titre expiré, demande d'authentification non tracée ou tardive) ; journal : codes et dates validés seulement ; refusée pour un salarié sorti | RH (jamais pour lui-même) |
| `employe.renouvelerCdd` | id, jusquau (nouveau terme, après la fin actuelle), signeLe? (signature de l'avenant, aujourd'hui par défaut, jamais future), reference? (60 caractères ; gardée dans l'historique, jamais au journal) : ligne `renouvellement` de l'historique des contrats, fin du contrat repoussée, terme initial gardé (`cddFinInitiale`) ; durée maximale et renouvellements admis signalés sans blocage ; CDD en cours seulement, sans sortie enregistrée | RH (jamais pour lui-même) |
| `employe.annulerAvenant` | id (ligne de l'historique) : avenant programmé, pas encore appliqué, marqué annulé ; brouillons des feuilles refigés ; déjà annulé : rien n'est refait ; appliqué : 409 | RH |
| `employe.annulerSortie` | id : fin prévue au contrat rétablie (aucune pour un CDI, même devenu CDI depuis la sortie) ; ce que la sortie a annulé ne l'est pas ; solde de sortie photographié retiré, ou, s'il est transmis à la paie, gardé pour l'historique et marqué remplacé ; 409 tant qu'il est dans un lot à confirmer | RH (jamais pour lui-même) ; administrateur RH seul pour un salarié dont le compte ouvre l'espace RH |
| `equipe.creer` / `equipe.renommer` | nom, managerId? / nom, nouveau | RH |
| `equipe.supprimer` | nom | administrateur RH |
| `equipe.manager` | nom, managerId (null = aucun) | RH |
| `equipe.modifier` | nom, nouveau? (absent : inchangé), managerId? (null = aucun ; absent : inchangé) : renommage puis manager dans une seule transaction, avec les contrôles de `equipe.renommer` et `equipe.manager` ; un refus n'enregistre rien (dialogue de l'équipe) | RH |
| `equipe.delegation` | managerId (service RH ; le manager : lui-même, espace manager ou collaborateur), suppleantId (défaut : son N+1), du, au (bornes comprises), perimetre (`absences`, `feuilles` ; `entretiens` si le réglage `delegationEntretiens` l'ouvre) : contrôles de `controleDelegation` (shared/rules/delegations-manager.ts : manager d'une équipe, suppléant présent sur toute la période et autre que lui, 92 jours au plus, fin à partir d'aujourd'hui, aucun chevauchement avec une autre délégation du manager, ni délégation transmise, ni validation croisée nouvelle), suppléant avec un compte actif ; suppléant prévenu (e-mail `delegation.debut` avec les demandes déjà en attente si elle commence aujourd'hui, sinon `delegation.prevue` puis `delegation.debut` le premier jour) ; manager prévenu si le service RH l'enregistre ; journal : identifiants, dates, codes du périmètre | RH, manager (pour lui-même) |
| `equipe.revoquerDelegation` | id : délégation en cours ou à venir, révoquée aussitôt (`revoqueeLe`, horodatage) ; suppléant prévenu (`delegation.fin`) ; une délégation terminée est refusée | RH, manager qui a délégué |
| `equipe.parente` | nom, parente (nom d'une autre équipe ; null ou vide : aucune) : contrôles de `shared/rules/hierarchie.ts` (équipe existante, ni elle-même ni une équipe qui lui est rattachée, 4 niveaux au plus), refus si deux salariés devenaient chacun le valideur de l'autre ; demandes de congés, feuilles soumises et entretiens planifiés dont le valideur change listés dans le message, nouveau valideur prévenu (e-mail `hierarchie.redirection`), journal : identifiants, ancien et nouveau valideur ; renommer l'équipe parente met à jour ses équipes rattachées, la supprimer est refusé tant qu'une équipe y est rattachée | RH |
| `equipe.affecter` | empId, equipe (null = à affecter) | RH ; manager : ajout à une équipe qu'il encadre d'un salarié « à affecter » (libéré par son manager) ou d'un membre d'une autre de ses équipes, retrait d'un membre — jamais le membre d'une autre équipe : sa mutation relève du RH ; jamais un salarié mineur dans une équipe de nuit ou en continu |
| `plan.inscrire` | empId, certId (recyclage) ou inscriptionId (formation initiale à replanifier), sessionId, conv (`now`/`later`) ; refusé depuis une session passée non clôturée, et si le salarié est absent ou inscrit à une autre session ce jour-là ; convocation reçue pour l'ancienne session à venir annulée par e-mail | RH, référent HSE, manager direct |
| `convocation.envoyer` | sessionId, empIds? (sans liste : toutes les convocations « à envoyer » ; avec : envoi ou renvoi) ; session à venir ; e-mail avec `.ics`, date d'envoi `convocLe` | RH, référent HSE ; manager direct pour les membres de son équipe |
| `plan.desinscrire` | empId, sessionId (session à venir) : place libérée, recyclage de nouveau à planifier ou inscription initiale retirée, convocation reçue (même remise « à renvoyer ») annulée par e-mail | RH, référent HSE, manager direct |
| `cert.ajouter` | empId, f, date | RH, référent HSE |
| `cert.modifier` | id, f?, date? (pas future), motif (obligatoire, 500 caractères ; `corrigeMotif`, service RH seul) ; refusée si une habilitation délivrée s'appuie sur elle sans autre certification valide (la suspendre d'abord) ; nouvelle formation : session ouverte quittée (convocation annulée par e-mail), résultat de clôture détaché, inscription initiale à la nouvelle close (gardée sur la certification), celles closes à l'ancienne rendues ; une certification devenue remplacée libère sa place | RH, référent HSE (jamais la sienne) |
| `cert.annuler` | id, motif (obligatoire) : `annuleLe`, `annulePar`, `annuleMotif` ; gardée en base, hors de tous les calculs (la précédente redevient en vigueur), place de session libérée, résultat de clôture détaché, inscription en formation initiale qu'elle avait close rendue si sa session l'accueille encore (sinon : à réinscrire) ; même refus que `cert.modifier` | administrateur RH (jamais la sienne) |
| `session.creer` | f, date (premier jour, postérieur à aujourd’hui), fin? (dernier jour, la date par défaut ; 92 jours au plus après), jours? (dates entre les deux, premier et dernier compris, 20 au plus ; ouvrés par défaut), horaires? ([] : journées entières ; un seul {debut, fin, pause} pour tous les jours, ou un par jour), lieu, places (entier ≥ 1), planId? (action « prévue » de la même formation) | RH, référent HSE |
| `session.confirmer` | id | RH, référent HSE |
| `session.modifier` | id, date? (postérieure à aujourd’hui ; session passée, à clôturer : aussi une date passée ; seule, la plage est décalée d’autant), fin?, jours?, horaires? (comme `session.creer` ; nouveau dernier jour sans jours : jours ouvrés), lieu?, places? (≥ inscrits) | RH, référent HSE |
| `session.annuler` | id, motif? | RH, référent HSE |
| `session.cloturer` | id (à partir du dernier jour de la session), participants [{empId, present, reussi?, note? (avis à chaud du présent, 1 à 5, recueilli par le service RH seulement : évaluation au nom du salarié, lot 7 t121)}], note? (appréciation de la session, 1 à 5), commentaire?, coutReel? (de l'action du plan qu'elle réalise, service RH seulement ; coût prévu par défaut et pour le référent HSE) | RH, référent HSE |
| `attente.confirmer` | id : personne de la liste d'attente d'une session (lot 7, t120), proposée par Cursus après une place libérée, ou en file s'il reste une place libre proposée à personne ; mêmes contrôles qu'une inscription ; inscrite et convoquée, demande mise à jour, place quittée ailleurs proposée à son tour | RH, référent HSE |
| `evaluation.enregistrer` | participationId (présente, session clôturée) ou formationSuivieId, type (`chaud` : note 1 à 5 ; `froid` : efficacite `efficace`, `partielle` ou `non`), commentaire? (1 000 caractères), repondant? (`salarie` par défaut ou `manager`, service RH seulement) ; fenêtres et formations concernées : `refusEvaluation` (lot 7, t121) ; remplace l'avis précédent du même répondant ; journal sans note, efficacité ni commentaire | le salarié pour lui-même (son avis), son manager direct (à froid, avis de manager), RH (avis recueilli, à chaud sans limite de temps) |
| `evaluation.retirer` | id : avis supprimé (tracé : formation, type, répondant) | l'auteur de l'avis (le salarié pour le sien, le manager pour le sien), RH |
| `attente.retirer` | id : retrait de la liste d'attente (`issue` : `salarie`, `manager` ou `rh`) ; demande mise à jour, salarié prévenu s'il ne s'est pas retiré lui-même ; place qui lui était proposée proposée au suivant | le salarié pour lui-même, son manager direct, RH, référent HSE |
| `hab.delivrer` | empId, h, date, par, mode ; renouvellement : délivrance précédente close à l'historique (`habDelivrances`, mesure figée, jamais le motif) | RH, référent HSE |
| `formationSuivie.enregistrer` | empId, f (code du catalogue) ou libelle (hors catalogue, 120 caractères), du, au? (du par défaut ; ni l'un ni l'autre à venir), duree? (heures, 0,25 à 2 000), organisme?, obligatoire? (défaut : formation « Réglementaire » du catalogue ; hors catalogue : non), demandeId? (demande hors catalogue acceptée du même salarié, une fois : origine `demande`) ; même formation ou même intitulé le même premier jour : refus ; journal : codes, dates, durée, case, jamais l'intitulé ni l'organisme | RH, référent HSE |
| `formationSuivie.modifier` | id, champs d'`enregistrer` (absents : inchangés), motif (obligatoire, 500 caractères, jamais au journal) | RH, référent HSE (jamais la sienne) |
| `formationSuivie.annuler` | id, motif (obligatoire) : gardée en base, hors des calculs ; une demande qu'elle clôt redevient à clore | administrateur RH (jamais la sienne) |
| `hab.suspendre` | empId, h, motif, date? (aujourd’hui par défaut) | RH, référent HSE ; manager pour un membre de son équipe (jamais lui-même) |
| `hab.lever` | empId, h | RH, référent HSE |
| `hab.retirer` | empId, h, motif, date? | RH, référent HSE |
| `referentiel.formation.enregistrer` | code (création) ou id (modification : le code ne change pas), nom, court, type, validite (mois, 1 à 240), duree?, dureeHeures? (t122 : 0,25 à 2 000 ; absente : inchangée, vide : effacée), organisme?, cout?, validation (`presence`/`evaluation`) ; message : titres devenus échus si la validité change, ligne du journal rattachée à leurs titulaires | RH, référent HSE |
| `referentiel.formation.archiver` | id, archive? (faux : rétablie) ; refusé tant qu'une habilitation en vigueur l'exige en prérequis ou qu'une session est ouverte ; message : demandes des collaborateurs restées en attente | RH, référent HSE |
| `referentiel.habilitation.enregistrer` | code ou id, nom, detail?, prereqs (formations du catalogue en vigueur ; une habilitation archivée garde ceux déjà inscrits, archivés depuis), medical, validite, signataire (proposé à la délivrance), modele? (t115 : `generique`/`electrique`/`conduite`, titre imprimé ; absent : inchangé, générique à la création) ; message : titres devenus échus, ligne du journal rattachée à leurs titulaires | RH, référent HSE |
| `referentiel.habilitation.archiver` | id, archive? ; rétablissement refusé tant qu'un prérequis est archivé (formation à rétablir d'abord) ; message : titres demandés et demandes restés en attente | RH, référent HSE |
| `referentiel.destination.enregistrer` | code (pays ISO à deux lettres, pas FR) ou id, pays, visa (`VISA_RULES`), visaSub?, oblig [vaccins], rec [vaccins, sans le DTP], passMois (0 à 24), secu? (vide : selon le code pays), vigilance? (`vert`/`jaune`/`orange`/`rouge`, vide : non renseignée ; absente avec vigilanceLe : inchangée), vigilanceLe? (exigée avec une couleur, pas à venir) ; passage à l'orange ou au rouge : déplacements prévus dans le message et au journal, managers et boîte du service RH notifiés (t068) | RH |
| `referentiel.destination.archiver` | id, archive? | RH |
| `referentiel.poste.enregistrer` | id? (modification ; sans : création), nom (80 caractères, unique parmi les postes en vigueur), formations [codes], habilitations [codes] (en vigueur ; déjà exigés et archivés depuis : gardés), sir?, expose? (poste exposé à des risques particuliers), risquesL4154? (liste des postes à risques particuliers, formation renforcée) ; message : salariés qui deviennent non conformes (ligne du journal rattachée à eux), intitulé recopié sur les fiches des titulaires | RH |
| `referentiel.poste.archiver` | id, archive? ; refusé tant qu'un salarié présent occupe le poste ; rétablissement refusé si un poste en vigueur porte le même intitulé | RH |
| `referentiel.equipe.exigences` | nom (équipe), formations, habilitations (vides : aucune exigence commune), nuit? (travail de nuit ou en continu : refusé si l'équipe compte un salarié mineur), couverture? ([{ formation, min }] : formation du catalogue en vigueur, une fois chacune, minimum entier de 1 à l'effectif présent ; [] : retirée ; absente : inchangée ; journal : codes et nombres avant et après) ; message comme pour un poste | RH |
| `referentiel.equipe.exigences` | nom (équipe), formations, habilitations (vides : aucune exigence commune), nuit? (travail de nuit ou en continu : refusé si l'équipe compte un salarié mineur), horaire? (code de l'horaire de poste proposé par défaut, « » ou null : aucun ; absent : inchangé ; archivé : refus) ; message comme pour un poste | RH |
| `referentiel.horaire.enregistrer` / `referentiel.horaire.archiver` | code (création : 1 à 6 lettres ou chiffres commençant par une lettre, unique, archivés compris) ou id (le code), nom (60 caractères), debut, fin (« HH:MM », « 8 h »… ; fin avant le début : le lendemain), pause (minutes, 0 à 240, plus courte que l'horaire) / id, archive? (faux : rétabli) ; archivage refusé tant qu'une équipe le propose par défaut ; les feuilles qui le portent le gardent | RH |
| `referentiel.poste.expositions` | id (poste, archivé compris), facteurs [codes `repetitif`, `hyperbare`, `temperatures`, `bruit` ; [] : aucun] : facteurs d'exposition du C2P cochés sur le poste (lot 7, `shared/rules/c2p.ts`) ; journal : identifiant, codes avant et après | RH, référent HSE |
| `referentiel.horaire.alternant` | id (code de l'horaire), alternant (vrai : équipes successives alternantes ; faux : non ; null ou « » : à qualifier) ; vaut pour toutes les nuits comptées sous cet horaire ; journal : code, valeur avant et après | RH, référent HSE |
| `passeport.declarer` | cles [« cert:<id> », « suivie:<id> » : lignes du Passeport de prévention, 2 000 au plus], le (jour de la déclaration sur la plateforme : ni à venir, ni avant le dernier jour d'une formation) ; ligne inconnue, annulée, d'une formation plus marquée ou déjà déclarée : refus, rien d'écrit (lot 7, `shared/rules/passeport-prevention.ts`) ; journal : jour, nombre de lignes, salariés concernés | RH, référent HSE |
| `passeport.retirer` | cle (ligne marquée déclarée) : marque posée par erreur retirée, ligne de nouveau proposée à l'export ; journal : la clé, le salarié | RH, référent HSE |
| `hab.demander` | empId, h : habilitation exigée jamais délivrée, titre « en attente » de délivrance (déjà demandée : rien n'est refait ; déjà délivrée ou archivée : refus) | RH, référent HSE |
| `referentiel.charger` | referentiel (`formations`/`habilitations`/`destinations`) : référentiel type (celui de la démonstration) chargé dans un référentiel vide, archivés compris ; habilitations après les formations (prérequis présents et en vigueur) | RH, référent HSE (destinations : RH) |
| `medical.demander` | empId, motif? (`periodique`/`embauche`/`reprise`/`employeur`/`mi_carriere`/`fin_carriere` ; par défaut celui de la visite due la plus proche, sinon embauche sans visite enregistrée, sinon périodique) ; e-mail au service de santé au travail | RH (une demande en cours par collaborateur) |
| `medical.annuler` | id | RH (demande de visite en cours) |
| `medical.avis` | empId, date (passée), avis (`apte`/`restrictions`/`inapte`), motif? (motif de visite : clôt la demande en cours de ce motif quelle que soit sa date ; `mi_carriere`/`fin_carriere` sans demande : visite réalisée de ce motif enregistrée, qui clôt la visite due ; absent du journal), restrictions [{texte, jusquau?}] (avis avec restrictions), prochaineVisite? (fixée par le médecin, après la visite, 5 ans au plus ; ignorée pour un avis d’inaptitude), examen? (examen médical d’aptitude du suivi renforcé), suspendre [h]?, lever [h]? | RH (suspensions « Restriction d’aptitude » ; levée des seules suspensions d’un avis précédent, jamais pour un avis d’inaptitude) |
| `medical.suivi` | empId, suivi (`vip`/`vip_adapte`/`sir`, vide : VIP par défaut), expose? (booléen, absent : inchangé : exposé à des risques particuliers, visite post-exposition à la sortie) ; journal : `empId` seul | RH (un suivi renforcé déduit du référentiel prime) |
| `demande.accepter` / `demande.refuser` | id ; refus : motif? (500 caractères, `motifRefus`, montré au collaborateur seul, même quand son manager a fait la demande) ; acceptation refusée quand la formation ou l'habilitation demandée a été archivée depuis (à refuser, ou à rétablir d'abord) | RH ; référent HSE pour une demande de formation ou d'habilitation (document déclaré : RH) |
| `demande.annuler` | id : demande de formation ou d'habilitation en attente, passée « retirée » | son auteur : le collaborateur pour la sienne, le manager pour celle qu'il a faite pour un membre de son équipe |
| `demande.reouvrir` | id, motif (obligatoire ; `rouverteMotif`, service RH seul) : demande de formation ou d'habilitation acceptée ou refusée, de nouveau « en attente » ; ce que l'acceptation a créé (`suite`) est défait : inscription à la session (convocation annulée par e-mail, session quittée retrouvée si elle l'accueille encore : sinon recyclage à planifier, inscription initiale retirée), ligne du plan prévue supprimée, titre en attente retiré ou demande effacée du titre ; refus si la session a commencé ou est clôturée, la ligne engagée, l'exercice clos, l'habilitation délivrée depuis | RH, référent HSE (jamais la sienne) |
| `demande.formation` | f (ou `autre`), libelle, sessionId, motif, empId (manager) ; refusée si une demande identique attend (même formation, ou même intitulé hors catalogue), si le salarié est déjà inscrit à une session à venir, ou absent le jour de la session souhaitée | collaborateur pour lui-même, manager pour un membre de son équipe |
| `demande.habilitation` | h, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `voyage.creer` | empId, dest, depart, retour, motif ; refusé s'il chevauche un autre déplacement ou une absence en vigueur | RH |
| `voyage.detachement` | id, detachementLe?, informationLe? (date passée ; vide : saisie effacée) ; déplacement annulé refusé | RH (certificat de sécurité sociale du détachement, information écrite d’une mission de plus de 4 semaines) |
| `voyage.modifier` | id, dest?, depart, retour, motif? (non transmis : inchangés) ; contrôles de `voyage.creer`, le déplacement lui-même exclu des conflits (contrôlés seulement si les dates changent) ; formalités de détachement devenues caduques effacées (`formalitesCaduques`) ; venu de Keystone : dates seules (destination et motif du chantier), `deplacement.modifie` mis en file ; hebergement?, contactSurPlace? (200 caractères), arianeLe? (date passée) : coordonnées sur place (t068), seules ou avec les dates, Keystone non prévenu ; annulé ou terminé : 409 | RH |
| `voyage.annuler` | id, motif (obligatoire pour un déplacement venu de Keystone, 500 caractères ; gardé dans Cursus, `annuleMotif`, jamais transmis à Keystone ; remis au salarié dans la copie de ses données) : `annuleLe`, `annulePar` ; déplacement gardé dans l'historique, hors de tous les calculs ; venu de Keystone : `deplacement.annule` mis en file ; déjà annulé ou terminé : 409 | RH |
| `chantier.grandDeplacement` | id (chantier Keystone en France), grandDeplacement (vrai, faux, null : à qualifier) : qualification de toutes ses missions pour la paie (t031) ; chantier à l'étranger refusé ; journal : code du chantier, avant et après, salariés de ses missions (archive paie) | RH |
| `employe.contactUrgence` | empId, nom, telephone (les deux, ou aucun : retiré ; téléphone : chiffres, espaces, points, tirets, « + ») : contact d'urgence de la fiche (t068), service RH et intéressé seulement ; journal : salarié, champs masqués | le salarié pour lui-même (portail), RH |
| `forfait.avenant` | empId, annee, jours (demi-journées), taux (%), signeLe, reference? : avenant de renonciation à des jours de repos d'un forfait jours (t043), seulement avec la référence de l'accord collectif (Paramètres → Forfait jours) ; forfait plus jours rachetés de l'année dans la limite de `forfaitJoursPlafond` (235), majoration d'au moins `forfaitJoursMajorationMin` (10 %), signature passée, au plus tard le 31 décembre de l'année ; jamais pour soi-même ; journal : salarié, année, jours, taux, date, référence masquée (archive paie) | RH |
| `forfait.annulerAvenant` | id, motif (obligatoire, gardé sur l'avenant, visible du service RH, remis au salarié dans la copie de ses données) : refusée (409) tant que les jours rachetés sont dans un lot à confirmer ; déjà transmis : annulé, à régulariser dans Sage ; journal : identifiant, salarié, motif masqué (archive paie) | RH |
| `formalite.enregistrer` | empId, kind (`passeport`/`visa`/`vaccin`), numero, expire, dest, visaType, obtenu, v, date | RH (écrit dans le dossier), ou le collaborateur pour lui-même (déclaration en attente, voir ci-dessous) |
| `voyages.importer` | texte (CSV) ; ligne sans référence : `DD-<n° du déplacement>` (suffixe si déjà prise) ; demandeur : nom du salarié reconnu, sinon tel que saisi (service RH seulement) | RH |
| `keystone.accepter` / `keystone.refuser` | id ; refus : motif? (conservé dans Cursus, demande et message du journal, jamais transmis à Keystone) | RH (demande en attente ; l'acceptation revalide affectation, chantier actif, destination, effectifs et l'absence de déplacement déjà créé, et est refusée si le salarié est déjà en déplacement ou absent ces jours-là ; la demande reste en base avec statut, date et décideur) |
| `plan.importer` | texte, exercice, mode (`add`/`replace`) ; exercice clos refusé | RH ; `replace` (supprime les lignes prévues d'origine `import` ; celles issues d'une demande, d'un report ou sans origine sont conservées) : administrateur RH |
| `budget.enveloppes` | exercice, enveloppes {équipe: montant} ; exercice clos refusé | RH |
| `plan.avancer` | id, de? (statut affiché : déjà dépassé, rien n'est refait ; revenu à « prévue », refus), coutReel (vers « réalisé », exigé : euros, 0 accepté), effectifReel?, beneficiaires? [empId] avec du, au?, duree? (t116 : formation suivie d'origine `plan` pour chacun, membre de l'équipe de la ligne ou demandeur d'une demande acceptée qui l'a créée ; refus si une session clôturée réalise la ligne) ; exercice clos ou action reportée refusés | RH |
| `plan.modifier` | id, f? (vide : hors catalogue), libelle?, equipe?, periode? (`T1`…`T4`), effectif? (1 à 1 000), cout? (0 à 1 000 000 €), motif (obligatoire) ; ligne prévue ou engagée d'un exercice ouvert ; une session ouverte rattachée fige la formation | RH |
| `plan.supprimer` | id, motif (obligatoire) : ligne prévue ou engagée d'un exercice ouvert, sans session ouverte rattachée (l'annuler d'abord) ; gardée en base (`annuleLe`…), hors de l'instantané et des sommes | administrateur RH |
| `plan.cloturerExercice` | exercice (passé et ouvert : jamais l'exercice en cours), reporter [id] (actions prévues ou engagées à reporter sur l'exercice suivant) | administrateur RH |
| `temps.setCell` | empId, week, li, di (0 = lundi … 5 = samedi, 6 = dimanche), value ; une ligne de 5 valeurs est complétée à 7 | salarié, manager direct ou RH (feuille soumise : valideur uniquement) ; aucune heure un jour d’absence validée ou signalée, ni hors contrat, vider la cellule reste possible ; pas de feuille pour une semaine hors contrat ; samedi et dimanche saisissables, repos hebdomadaire signalé sans blocage ; jour férié saisissable si `feriesTravaillesAutorises` (par défaut), saisie tracée (`temps.ferie`, ou `temps.correction` par autrui) |
| `temps.derogationDominicale` | equipe, type (`aucune`/`feu_continu`/`suppleance`), reference (exigée hors `aucune`, 120 caractères ; journal : seulement « renseignée ») : clé `derogationsDominicales` de la table settings, suit l'équipe renommée et disparaît avec l'équipe supprimée | administrateur RH |
| `temps.horaire` | empId, week, di (0 = lundi … 6 = dimanche), code (« » : aucun horaire ; un horaire archivé ne se choisit plus) : horaire de poste du jour, au niveau de la feuille ; seuls les choix y sont inscrits ; l'horaire retenu, avec ses heures, est figé à part à la soumission et à la validation (`horairesAFiger`, `FeuilleTemps.horairesFiges` : les jours non choisis qui portent des heures reçoivent l'horaire de l'équipe) ; tracé quand il est choisi par autrui | comme `temps.setCell` (salarié, manager direct ou RH ; feuille soumise : valideur) |
| `referentiel.activite.enregistrer` / `referentiel.activite.archiver` | code (création : `INT-` + 2 à 12 lettres ou chiffres, ou `ECOLE`, unique parmi tous les projets) ou id (le code), nom (80 caractères) / id, archive? (faux : rétablie) ; une activité archivée n'est plus imputable, les heures déjà saisies restent | RH |
| `mandat.enregistrer` / `mandat.supprimer` | id? (modification), empId, role (`titulaire`/`suppleant`), du, au?, credit (0 à 200 h par mois, au quart d'heure ; deux mandats du même salarié ne se chevauchent pas) / id | RH (jamais son propre mandat) |
| `temps.addLine` / `temps.removeLine` | empId, week, projet / li, projet?, tache?, lignes? (ligne visée : déjà supprimée, rien n'est refait ; feuille changée, refus) | idem |
| `temps.suggest` / `temps.submit` | empId, week, motif? | idem (soumission : brouillon ou à corriger, sans heures un jour d’absence validée ; semaine entièrement couverte par une absence : sans heure ; 24 h par jour au plus, toutes lignes cumulées ; motif exigé au-delà de 10 h par jour ou 48 h par semaine, 13 h pour un forfait jours) |
| `temps.validate` / `temps.reject` | empId, week, comment?, motif? | manager direct ou RH, jamais pour sa propre feuille (validation : sans heures un jour d’absence validée ; une demande d’absence en attente sur des jours qui portent des heures est décidée d’abord ; une feuille sans heure exige une semaine encore couverte par une absence ; 24 h par jour au plus ; motif du dépassement exigé s'il manque, après une correction du valideur : celui du salarié n'est jamais remplacé ; majoration des fériés et contrepartie obligatoire en repos figées, `cor` au journal ; seuils de durée franchis rappelés dans le message) |
| `temps.pushSage` | — ; simulation seulement : lot de toutes les feuilles en attente, aussitôt marqué transmis (référence « SIM-… », rien n'est envoyé, message qui le dit) ; en mode fichier, refus 503 sans rien marquer | administrateur RH, paie |
| `temps.relancer` | empId? (sinon tout le périmètre) : feuilles des semaines suivies manquantes, en brouillon ou à corriger, échéance passée ; e-mail (ou récapitulatif) au salarié et à son valideur ; rien en retard : refus | manager direct (son équipe) ou RH |
| `temps.validerLot` | feuilles [{empId, week}] (200 au plus) : chacune passe par `temps.validate` dans son point de reprise (SAVEPOINT) ; refus listés dans le message, les autres validées, avec les alertes de durée de chacune (5 au plus en entier) ; aucune validée : 403 si toutes l'étaient pour des droits, sinon 400 avec la liste | manager direct ou RH (comme `temps.validate`) |
| `paie.lotGenerer` | periode (AAAA-MM) : lot des feuilles validées en attente dont la période de destination vient au plus tard (rappels compris), contenu figé, clé d'idempotence (UUID), feuilles réservées (`feuilles.lotId`), libellé de chaque code Sage figé (`contenu.libelles`) ; hors simulation, refus si un salarié n'a pas de matricule de paie (liste) ou 409 si une rubrique émise et exportée n'a pas de code Sage confirmé (liste) ; en simulation, avertissement | administrateur RH, paie (écran Temps) |
| `paie.lotConfirmer` | id, reference? (code de 40 caractères au plus) : confirmation de l'import dans Sage, datée et signée, qui seule marque les feuilles transmises ; lot de fichier : fichier téléchargé au moins une fois (409 sinon) ; lot de simulation refusé hors simulation ; déjà confirmé : rien n'est refait ; annulé : 409 | administrateur RH, paie |
| `paie.lotAnnuler` | id : avant la confirmation seulement (409 ensuite : une feuille se corrige par `temps.rouvrir`, puis lot correctif) ; feuilles libérées | administrateur RH, paie |
| `temps.validate` / `temps.reject` | empId, week, comment?, motif? | manager direct ou RH, jamais pour sa propre feuille (validation : sans heures un jour d’absence validée ; une demande d’absence en attente sur des jours qui portent des heures est décidée d’abord ; une feuille sans heure exige une semaine encore couverte par une absence ; 24 h par jour au plus ; motif du dépassement exigé s'il manque, après une correction du valideur : celui du salarié n'est jamais remplacé) |
| `temps.pushSage` | — ; simulation seulement : lot de toutes les feuilles en attente (et des absences jusqu'à leur dernière période), aussitôt marqué transmis (référence « SIM-… », rien n'est envoyé, message qui le dit) ; en mode fichier, refus 503 sans rien marquer | administrateur RH, paie |
| `temps.rouvrir` | empId, week, motif (obligatoire, 500 caractères ; gardé sur la feuille, `reouverture.motif` ; journal : seulement « renseigné »), renvoyer? (vrai : « à corriger », motif en commentaire, salarié prévenu ; sinon « soumise », corrigée par son valideur) : feuille validée seulement ; 409 si elle est dans un lot de paie généré (annuler d'abord le lot) ou si c'est celle d'un intérimaire dont le relevé est parti ; transmise, elle garde les rubriques parties (`reouverture.rubriques`) et, revalidée, son écart part dans le lot suivant (lot correctif) ; heures déjà renvoyées à Keystone gardées (`reouverture.keystone`) ; COR refigée à la revalidation | administrateur RH, jamais pour sa propre feuille |
| `temps.relancer` | empId? (sinon tout le périmètre) : feuilles des semaines suivies manquantes, en brouillon ou à corriger, échéance passée ; e-mail (ou récapitulatif) au salarié et à son valideur ; rien en retard : refus | manager direct (son équipe) ou RH |
| `temps.validerLot` | feuilles [{empId, week}] (200 au plus) : chacune passe par `temps.validate` dans son point de reprise (SAVEPOINT) ; refus listés dans le message, les autres validées ; aucune validée : 403 si toutes l'étaient pour des droits, sinon 400 avec la liste | manager direct ou RH (comme `temps.validate`) |
| `paie.lotGenerer` | periode (AAAA-MM) : lot des feuilles validées en attente dont la période de destination vient au plus tard (rappels compris) et, réglage `absencesFichierPaie`, des absences validées ventilées par mois avec leurs régularisations (`shared/rules/absences-paie.ts` ; lot possible sans feuille), contenu figé, clé d'idempotence (UUID), feuilles et absences réservées (`feuilles.lotId`, `absences.lotId`), libellé de chaque code Sage figé (`contenu.libelles`) ; hors simulation, refus si un salarié n'a pas de matricule de paie (liste) ou 409 si une rubrique émise et exportée n'a pas de code Sage confirmé (liste) ; en simulation, avertissement ; « annule et remplace » (`negatifs` faux) avec des feuilles à régulariser : lot correctif des seules régularisations, 409 si un autre lot attend la confirmation de son import | administrateur RH, paie (écran Temps) |
| `paie.lotConfirmer` | id, reference? (code de 40 caractères au plus) : confirmation de l'import dans Sage, datée et signée, qui seule marque les feuilles et les absences transmises (`absences.sage`) ; lot de fichier : fichier téléchargé au moins une fois (409 sinon) ; lot de simulation refusé hors simulation ; déjà confirmé : rien n'est refait ; annulé : 409 | administrateur RH, paie |
| `paie.lotAnnuler` | id : avant la confirmation seulement (409 ensuite : une feuille se corrige par `temps.rouvrir`, puis lot correctif) ; feuilles et absences libérées (une absence reprend le dernier lot transmis qui l'a emportée) | administrateur RH, paie |
| `paie.formatFichier` | separateur? (`;`/`,`/`tab`), colonnes? (matricule, periode, rubrique, quantite chacune une fois ; facultatives, absentes par défaut, une fois au plus : dossier, libelle, debut, fin), formatPeriode? (`AAAA-MM`/`MM/AAAA`/`AAAAMM`/`MMAAAA`), formatDate? (`JJ/MM/AAAA`/`AAAA-MM-JJ`/`JJMMAAAA`), decimale? (`,`/`.`, différente du séparateur), entete?, encodage? (`utf-8` sans BOM par défaut, `windows-1252`), negatifs? (quantités négatives acceptées par l'import, vrai par défaut ; faux : feuilles rouvertes régularisées en « annule et remplace », lu à la génération du lot) : clé `formatFichierPaie` de la table settings | administrateur RH, paie |
| `paie.lotGenerer` | periode (AAAA-MM) : lot des feuilles validées en attente dont la période de destination vient au plus tard (rappels compris) et, réglage `absencesFichierPaie`, des absences validées ventilées par mois avec leurs régularisations (`shared/rules/absences-paie.ts` ; lot possible sans feuille), contenu figé, clé d'idempotence (UUID), feuilles et absences réservées (`feuilles.lotId`, `absences.lotId`), libellé de chaque code Sage figé (`contenu.libelles`) ; soldes de sortie des rubriques de sortie actives (`soldesSortie.lotId`, t128 ; à la confirmation, ceux de la période sans rubrique active sont réglés hors fichier) ; hors simulation, refus si un salarié n'a pas de matricule de paie (liste) ou 409 si une rubrique émise et exportée n'a pas de code Sage confirmé (liste) ; en simulation, avertissement | administrateur RH, paie (écran Temps) |
| `paie.lotConfirmer` | id, reference? (code de 40 caractères au plus) : confirmation de l'import dans Sage, datée et signée, qui seule marque les feuilles et les absences transmises (`absences.sage`), ainsi que les soldes de sortie (réglés hors fichier quand aucune rubrique de sortie active ne les emporte, t128) ; lot de fichier : fichier téléchargé au moins une fois (409 sinon) ; lot de simulation refusé hors simulation ; déjà confirmé : rien n'est refait ; annulé : 409 | administrateur RH, paie |
| `paie.lotAnnuler` | id : avant la confirmation seulement (409 ensuite : lot correctif à venir) ; feuilles et absences libérées (une absence reprend le dernier lot transmis qui l'a emportée) | administrateur RH, paie |
| `paie.formatFichier` | separateur? (`;`/`,`/`tab`), colonnes? (matricule, periode, rubrique, quantite chacune une fois ; facultatives, absentes par défaut, une fois au plus : dossier, libelle, debut, fin), formatPeriode? (`AAAA-MM`/`MM/AAAA`/`AAAAMM`/`MMAAAA`), formatDate? (`JJ/MM/AAAA`/`AAAA-MM-JJ`/`JJMMAAAA`), decimale? (`,`/`.`, différente du séparateur), entete?, encodage? (`utf-8` sans BOM par défaut, `windows-1252`) : clé `formatFichierPaie` de la table settings | administrateur RH, paie |
| `paie.rubrique` | code (RUBRIQUES_PAIE), codeSage?, active?, confirmer? (`true` : confirmé ce jour par la personne connectée ; `false` : confirmation retirée ; un code changé sans `true` repasse « à confirmer ») ; jamais deux unités sur un même code Sage | administrateur RH, paie (écran Temps) |
| `releve.envoyer` | agence, semaine (lundi, pas à venir) : relevé des feuilles validées des intérimaires de l'agence, envoi ou renvoi (feuilles en attente nommées) | RH, paie |
| `absence.demander` | empId, kind (`CP`/`RTT`/`RECUP`/`CET` : congé pris sur le compte épargne-temps, journées entières, contrôlé sur son solde), du, au, debutDemi, finDemi (`matin`/`apres_midi`, facultatifs ; pas pour `CET`) ; congés payés : avertissements du congé principal et du fractionnement (`shared/rules/fractionnement.ts`), jamais bloquants | intéressé ou RH (demande, refusée si ces jours portent des heures sur une feuille validée) ; manager direct (posée et validée, refusée si des heures sont saisies ces jours-là) |
| `absence.decider` | id, ok, motif? (refus : `motifRefus`, montré au salarié et à son manager ; jours rendus à une période de CP close : report reçu sur la suivante, `recrediterPeriodesCloses`) | manager direct ou RH, jamais pour sa propre demande (validation refusée si des heures sont saisies ces jours-là ; même décision déjà prise : rien n'est refait) |
| `absence.signaler` | empId, du, au | intéressé, manager direct ou RH : absence imprévue « à qualifier », en vigueur aussitôt |
| `absence.saisir` | empId, nature, du, au, justificatif, justificatifLe | RH (absence hors congés validée d’emblée), jamais pour lui-même |
| `absence.qualifier` | id, nature, du?, au?, justificatif, justificatifLe | RH (absence signalée ou qualifiée, hors congés), jamais la sienne |
| `absence.prolonger` | id, au | intéressé, manager direct ou RH (hors congés ; hors RH, l’absence repasse « à qualifier ») |
| `absence.annuler` | id (jours rendus à une période de CP close : report reçu sur la suivante, tracé ; absence déjà partie à la paie : régularisation au prochain lot, annoncée au service RH) | demande : intéressé ou RH ; absence à venir : manager direct ou RH (et l’intéressé pour son propre signalement, ni qualifié ni prolongé) ; commencée ou passée : RH ; hors périmètre : refus unique (403) |
| `cet.placer` | empId, kind, jours, annee? (RTT de l'année précédente, tant que sa clôture n'est pas faite) | intéressé ou RH |
| `report.accorder` | empId, jours, motif (échéance : 31 mai suivant, seul un report légal court au-delà) : jours de la période en cours reportés sur la suivante, dans la limite du solde non encore reporté, appliqués à la clôture | RH, jamais pour lui-même |
| `conges.cloturer` | type (`CP`/`RTT`), periode (année de prise des CP, année des RTT), lignes? [{empId, decision `reporter`/`perdre`, jours? (report imposé compris)}] (CP) : période terminée ; une ligne déjà clôturée n'est jamais refaite, une ligne sans décision reste à clôturer, un salarié sans solde est clos d'emblée ; une ligne dont une demande de CP de la période est en attente n'est pas close (refus nommant la demande) ; perte refusée pour les jours d'un report imposé ; RTT : soldes perdus (non reportables), salarié dont une demande de RTT de l'année est en attente non clôturé | RH ; jamais sa propre ligne de CP |
| `conges.informer` | id (arrêt de maladie ou d'accident terminé, dans `retoursAInformer`) : information du salarié sur ses congés à son retour (art. L3141-19-3) — e-mail sans la nature de l'arrêt, ligne `informationsCp` (jours communiqués, date limite, échéance du report), reports légaux qui couraient pendant la suite d'arrêts prolongés jusqu'à 15 mois après l'information ; arrêt en cours, suivi d'un autre arrêt ou retour antérieur à la mise en service refusés ; information déjà donnée pour la fin actuelle de l'arrêt : rien n'est refait (arrêt prolongé depuis : nouvelle information) | RH, jamais pour lui-même |
| `conges.fractionnement` | periode (année de prise), lignes [{empId, decision `crediter`/`renoncer`, jours? (proposés par défaut ; règle légale : 1 ou 2, accord : par demi-journée, 6 au plus)}] : après la fin de la période du congé principal, salariés proposés seulement (`fractionnementsAProposer` : période suivie, ni clôturée ni déjà décidée ; une ligne déjà décidée entre-temps est ignorée et signalée) ; crédit = report reçu sur la période (`origine` `fractionnement`, jusqu'au 31 mai) ; renonciation du salarié notée sans jour ; une décision par salarié et période (table `fractionnements`) ; règle « aucun jour » : refus ; journal : période, salarié, décision et jours (archive paie) | RH, jamais pour lui-même |
| `entretien.planifier` | empId, kind, date, nonTenu? ; un seul entretien planifié par type : une nouvelle date le reprogramme (passé avec un compte rendu commencé, seulement avec `nonTenu`, l'évaluateur confirmant qu'il n'a pas eu lieu) ; refusé un jour d'absence du salarié ; convocation par e-mail (`.ics`, même événement à la reprogrammation) | manager direct ou RH (jamais son propre entretien) |
| `entretien.annuler` | id, confirmer? (exigé si le compte rendu est commencé : supprimé avec l'entretien) ; entretien planifié seulement (clos : 409), retiré ; date à venir : `.ics` d'annulation au salarié (même UID `entretien-<id>`) | évaluateur (manager direct) ou RH, jamais son propre entretien |
| `entretien.modifier` | id, section?, value?, info? | évaluateur / salarié selon la section (un membre du RH n'évalue pas son propre entretien) |
| `entretien.clore` | id, date? (jour où l'entretien a eu lieu, aujourd'hui au plus tard et pas avant sa planification ; exigée pour un entretien prévu à une date à venir) | évaluateur (l'écran enregistre d'abord chaque section ; un échec interrompt la clôture) |
| `entretien.signer` | id | salarié |
| `entretien.remettre` | id, mode (`main_propre`/`refus`/`portail`), date? (main propre, refus : de la clôture à aujourd'hui ; portail : le jour même, compte actif exigé, e-mail avec le seul lien vers Cursus) ; une remise sur papier est définitive, une mise à disposition se complète par une remise sur papier | évaluateur (manager direct) ou RH, jamais pour son propre entretien |
| `entretien.telecharger` | id : premier téléchargement du compte rendu clos, daté (`telechargeLe`) | salarié, depuis son espace |
| `parametres.maj` | champs de la table `REGLAGES` (`shared/reglages.ts`, chacun passé par son contrôle : horizonAlerte, seuilBudget, rtt39, uniquementReglementaire, partageKeystone, identifiantKeystone, politiqueReportCp, rttAnneeSuivanteDes, heuresSupMode, heuresSupAccord, periodeRattachement, clotureJour, majorationDimanche, campagneDebut, campagneFin, campagneAncienneteMois, campagneExclus, campagnePreavisJours, relancesActives, relancesPaliers, relancesJour, formationsTemps, santeMiCarriereAge…, cpMaladie, feriesTravaillesAutorises, tauxMajorationFerie, plafondHeuresComplementaires, heuresComplementairesAccord, moyenne12SemainesMax, moyenne12SemainesAccord, contingentHeuresSup, contingentAlerte, contingentAccord, absencesFichierPaie, absencesPaieAPartirDu, piecesStockage, formationRenforceeCode, entretienMiCarriereActif, entretienMiCarriereMois, consultationN2, deplacementsFichierPaie, deplacementsPaieAPartirDu, vigilanceRappelJours, fractionnementRegle, fractionnementAccord, fractionnementDebut, fractionnementFin, cetPlafondRtt, cetPlafondCp), silent? ; saisie refusée par un contrôle ou par `COHERENCE` (repos sans référence d'accord, campagne dont l'ouverture suit la clôture, fractionnement fixé par accord ou écarté sans référence, période du congé principal inversée) : 400, rien n'est enregistré | administrateur RH |
| `parametres.maj` | champs de la table `REGLAGES` (`shared/reglages.ts`, chacun passé par son contrôle : horizonAlerte, seuilBudget, rtt39, uniquementReglementaire, partageKeystone, identifiantKeystone, politiqueReportCp, rttAnneeSuivanteDes, heuresSupMode, heuresSupAccord, periodeRattachement, clotureJour, majorationDimanche, campagneDebut, campagneFin, campagneAncienneteMois, campagneExclus, campagnePreavisJours, relancesActives, relancesPaliers, relancesJour, formationsTemps, santeMiCarriereAge…, cpMaladie, feriesTravaillesAutorises, tauxMajorationFerie, plafondHeuresComplementaires, heuresComplementairesAccord, moyenne12SemainesMax, moyenne12SemainesAccord, contingentHeuresSup, contingentAlerte, contingentAccord, absencesFichierPaie, absencesPaieAPartirDu), silent? ; saisie refusée par un contrôle ou par `COHERENCE` (repos sans référence d'accord, campagne dont l'ouverture suit la clôture) : 400, rien n'est enregistré | administrateur RH |
| `parametres.feries` | annee (de l'année en cours, 2027 au plus tôt, à deux ans après), solidarite (`pentecote_chomee`/`pentecote_travaillee`/`autre_ferie`/`hors_calendrier`), solidariteFerie? (`autre_ferie` : ni le 1er mai, ni le lundi de Pentecôte, ni un férié qui tombe un samedi ou un dimanche de l'année), nonChomes [codes des fériés, jamais `1er_mai`], motif? (exigé, 409 sinon, pour une année engagée : absences de l'année transmises à la paie ou dans un lot, congés clôturés sur une période qui la couvre ; 500 caractères, service RH seulement, jamais au journal) : clé `calendrierFeries` de la table settings ; message : absences dont le décompte change (salariés rattachés à la ligne du journal) ; même réglage : rien n'est refait | administrateur RH |
| `demo.reinitialiser` | — | administrateur RH, mode démonstration |
| `compte.creer` | empId (ou nom, adresse : compte externe), type (`microsoft`/`local`), identifiant, profilRh | administrateur RH (mot de passe provisoire dans `result`, affiché une fois) |
| `compte.profil` | id, profilRh (`aucun`/`rh_gestionnaire`/`rh_admin`/`referent_hse`/`paie`/`lecture_seule`) | administrateur RH (jamais le dernier administrateur actif ; un compte externe garde un profil) |
| `compte.rattacher` | id, empId | administrateur RH (compte externe seulement, vers la fiche d'un salarié présent qui n'a pas de compte ; le compte prend le nom de la fiche et ouvre ses espaces) |
| `compte.activer` | id, actif | administrateur RH (désactiver ferme les sessions ; pas son propre compte) |
| `compte.reinitialiser` | id | administrateur RH (compte local : nouveau mot de passe provisoire ; compte Microsoft rattaché : « Délier », `oid` retiré pour une identité recréée ; sessions fermées) |
| `envoi.relancer` | id | RH (envoi en échec, intégration configurée : nouvelle série de tentatives, même clé d'idempotence) |
| `envoi.classer` | id | RH (envoi en échec examiné : reste listé, ne compte plus parmi les échecs en cours ; une relance le remet en cours) |
| `messagerie.regler` | rh?, rhMode? (`immediat`/`quotidien`), santeTravail?, agences? [{nom, adresse}] (adresse vide : agence retirée ; date `depuis` gardée, celle du jour pour une agence ajoutée) | administrateur RH |
| `messagerie.essai` | adresse : e-mail d'essai (mise en service, `docs/EMAILS.md`) | administrateur RH |
| `messagerie.recapituler` | — : récapitulatifs des notifications en attente envoyés sans attendre 7 h | RH |
| `notification.regler` | empId? (soi par défaut), mode (`immediat`/`quotidien`) | la personne elle-même, ou RH |
| `confidentialite.regler` | responsable?, dpo? (texte, 300 caractères au plus ; vide : effacé, la page renvoie au service RH) ; journal : nom des champs dont la valeur change, jamais leur texte | administrateur RH |
| `piece.joindre` | jetons (ou jeton) : pièces envoyées par `POST /api/pieces` par le même compte, encore en attente ; objet (`absence`/`certification`/`habTitre`/`declaration`/`voyage`), objetId ; 10 pièces en vigueur au plus par objet ; fonction désactivée : 409. Les mêmes jetons se passent en `pieces` à `absence.saisir`, `absence.qualifier`, `absence.signaler` (intéressé ou RH), `cert.ajouter`, `hab.delivrer` et `formalite.enregistrer` (déclaration du collaborateur ; celle qu'elle remplace lui laisse ses pièces) | absence (hors congés, ni annulée ni refusée) : intéressé, RH ; certification, titre d'habilitation : RH, référent HSE ; document déclaré : intéressé tant qu'il attend, RH ; déplacement : RH ; jamais le manager |
| `piece.retirer` | id, motif (obligatoire, 500 caractères ; gardé avec la pièce, lu par le service RH et par le salarié dans l'export de ses données, masqué au journal) : description gardée, fichier effacé après la validation de l'action ; le refus d'un document déclaré retire aussi ses pièces | RH ; référent HSE pour une certification ou un titre d'habilitation ; jamais sur son propre dossier |
| `employe.anonymiser` | ids (1 à 100), motif (obligatoire, 500 caractères ; gardé dans la table `effacements`, jamais au journal), avantEcheance? (droit à l'effacement : un seul salarié, sorti, même fonction désactivée ; catégories sans obligation légale ou échues effacées, identité, titre de séjour, santé et temps gardés jusqu'à leur échéance, 409 si rien à effacer) ; sans `avantEcheance`, fonction activée avec la décision du DPO (409 sinon) et dossiers proposés seulement (409 sinon) : catégories échues effacées, fiche anonymisée à l'échéance du dossier ; 409 tant qu'un solde de sortie est dans un lot à confirmer ; message et journal sans nom | administrateur RH (jamais son propre dossier) |
| `agenda.creerJeton` / `agenda.revoquerJeton` | — : nouveau jeton (le précédent révoqué), renvoyé une seule fois dans `result`, jamais au journal ; flux désactivé : 409 / révocation de son abonnement | le salarié pour lui-même, depuis l'espace collaborateur ou manager |
| `agenda.revoquerTout` | — : tous les abonnements révoqués | administrateur RH |
| `reprise.importer` | type (`salaries`/`soldes`/`certifications`/`visites`/`habilitations`), texte (CSV), colonnes (champ de chaque colonne), dateReprise (soldes), equipes (rapprochement), confirmations (lignes cochées : réembauche sur un matricule, visite sans avis), comptes (comptes Microsoft 365, y compris pour une fiche déjà à jour), fichier ; analyse de `shared/rules/reprise.ts`, seules les lignes retenues par l'aperçu sont écrites ; ses propres soldes refusés (fiche rattachée au compte) ; lot conservé (table `reprises`) ; journal `reprise.<type>` | administrateur RH |

## Journal des actions

Table `journal`, écrite par `server/src/journal.ts` (actions) et `journaliser` de `server/src/comptes.ts`
(connexions et autres événements) ; libellés, familles et durées dans `shared/journal.ts`.

- **Contenu** : chaque action réussie (`POST /api/actions/:nom`) est tracée dans sa transaction, signée du nom
  de la personne, de son compte et de l'espace. Du paramètre reçu, seuls les champs de la liste blanche de
  l'action (`REGLES`) sont recopiés : identifiants, codes, dates, statuts — jamais un numéro de passeport, un
  mot de passe, un CSV importé, un texte libre (motifs, réponses, comptes rendus, évaluation à chaud) ni une
  donnée de santé (vaccin, nature d'absence, visite médicale). Une action sans règle ne recopie aucun champ.
  La règle désigne aussi la ligne modifiée : ses colonnes utiles sont lues avant et après l'action, d'où les
  anciennes et nouvelles valeurs (`avant`, `apres` : poste, équipe, statut d'une feuille ou d'une absence,
  profil RH, paramètres…). Les messages sont expurgés de toute nature d'absence, médicale ou non
  (« [nature d’absence] » : un marqueur réservé aux natures médicales les désignerait), et des vaccins
  (« [donnée de santé] ») ; congés payés, RTT et récupération restent lisibles. `salaries` : salariés concernés
  (paramètre `empId`, ligne modifiée, participants d'une session clôturée, inscrits d'une session confirmée,
  modifiée ou annulée lus avant et après l'action, salariés des feuilles transmises à la paie ou des
  déplacements importés…), pour le filtre, l'historique de la fiche et l'export de ses données. La règle
  peut lire un état avant l'action (`etat`) et des valeurs après (`bilan` : feuilles transmises `{ empId,
  week }`, nombre de déplacements importés, total d'heures d'une feuille soumise ou validée).
- **Événements tracés** : actions ; saisie d'heures par le manager ou le service RH sur la feuille d'un autre,
  quel que soit son statut (soumise, renvoyée, brouillon : `temps.correction`, ancienne et nouvelle valeur,
  statut de la feuille ; la saisie du salarié sur sa propre feuille ne l'est pas, sauf un jour férié : `temps.ferie`,
  mêmes valeurs, archive paie) ; rédaction
  d'un compte rendu d'entretien (section nommée, jamais son contenu, une ligne par compte et par demi-heure) ;
  connexions, refus, déconnexions, changements d'espace ; refus d'accès (403) d'une personne connectée
  (`acces.refuse`, motif borné à 200 caractères, rien n'est modifié ; tout message est borné à 2 000) ;
  appels et messages de Keystone ; exports (journal, données d'un salarié, CSV et impressions de l'interface
  signalés par `POST /api/exports`, `client/src/print.ts`) ; consultation de l'archive (chaque page lue, une
  ligne par compte et par filtre pendant 15 minutes) ; application des durées de conservation.
- **Conservation** (décision de l'entreprise) : 1 an pour tout ; au-delà, les actions liées à la paie
  (`ACTIONS_PAIE` : validations des feuilles (une à une ou en groupe) et des absences, prolongations et annulations
  d'absences, clôtures des congés, jours de fractionnement, corrections d'heures, transmissions à la paie, lots de paie et téléchargements de leur
  fichier (`sage.fichier`) et export des variables de la période (`sage.variables`), date de départ des absences dans le
  fichier (`migration.absencesPaie`), sorties et leur annulation, solde de RTT gardé lors d'un changement de régime, renouvellements de CDD et avenants appliqués à leur date) passent dans l'archive (`archivee`), absente de l'écran et
  consultée sur demande par le service RH, et toute ligne est supprimée au bout de 3 ans. Une action ajoutée
  à `ACTIONS_PAIE` vaut aussi pour les lignes déjà écrites (`marquerPaie`, au démarrage). Appliquée au
  démarrage puis toutes les heures (`demarrerJournal`), avec la purge de la file d'envoi (envois réussis ou
  simulés de plus d'un an, échecs classés depuis plus d'un an ; un échec non traité reste). Une ligne
  `journal.conservation` par jour fait le bilan, complétée à chaque passage. Les lignes écrites avant la
  liste blanche sont expurgées une fois (`reprendreJournal`). La réinitialisation de la démonstration
  conserve le journal (`clearAll` de `db.ts`).
- **Consultation** (`routesJournal`) : `GET /api/journal` (droit « rh », ou « consultation » d'un profil en
  lecture seule, `lecteurJournal` de `shared/journal.ts` : le profil compte, pas l'espace, ni le référent HSE ni
  la paie n'y ont accès ; 403 tracé sinon ; sans le droit « rh », message et détail des actions touchant à la
  santé sont masqués, `pourLecteur`) avec `vue` (`tout` sans les appels de Keystone, sauf si le filtre
  « Action » les désigne, `operations`, `connexions`, `keystone`, `archive`), `du`, `au` (dates locales
  incluses), `auteur` (nom ou identifiant), `action` (code ou `famille:<id>`), `salarie`, `page`, `taille` (50
  par défaut, 200 au plus) → `{ lignes, total, page, taille }`. `GET /api/journal/csv` : mêmes filtres et
  mêmes droits, toutes les pages (100 000 lignes au plus), UTF-8 avec BOM, cellules commençant par `=`, `+`,
  `-`, `@` précédées d'une apostrophe ; export tracé. Écran : Paramètres → Journal des actions
  (`client/src/pages/Journal.tsx`) ; historique dans la fiche du collaborateur (mêmes droits).
- **Données personnelles** (`server/src/donnees.ts`, droit d'accès et portabilité) : `GET
  /api/salaries/:id/donnees` (droit « rh » seul, `dossierComplet` : le dossier porte des données de santé ;
  bouton « Exporter ses données » de la fiche) renvoie un fichier JSON lisible : fiche, chaque table du schéma qui
  porte `empId` (une table ajoutée plus tard l'est aussi), compte (sans empreinte du mot de passe), sessions
  de connexion (sans leur identifiant), équipes encadrées, messages envoyés à Keystone à son matricule, et
  le journal des actions le concernant (archive comprise), et le contenu de ses pièces justificatives en base64. `GET /api/mes-donnees` : le salarié connecté
  (espace collaborateur ou manager) télécharge les siennes depuis le portail, sans le journal, que le RH
  remet sur demande, ni l'auteur des lignes de l'historique du contrat (`par`, `parId` : d'autres personnes, comme le
  journal ; `RETIREES_SALARIE`). Chaque export est tracé (`salarie.export`, `donnees.export`).
- **Information des salariés** (art. 13 du RGPD) : page Confidentialité (`pages/Confidentialite.tsx`, vue commune
  `confidentialite` de `VUES_COMMUNES`, ouverte dans tous les espaces et sans connexion depuis l'écran de connexion),
  texte `INFO_CONFIDENTIALITE` de `shared/confidentialite.ts` (modèle à faire valider par le DPO, mentions « à compléter
  par le DPO », durées décidées reprises de `shared/journal.ts`). Responsable du traitement et contact du DPO : clé
  `confidentialite` de la table `settings`, réglée par `confidentialite.regler` (Paramètres → Confidentialité,
  `pages/parametres/Rgpd.tsx`) et lue sans connexion par `GET /api/confidentialite` ; vides, la page renvoie au service
  RH. Descriptif du traitement pour le registre et l'AIPD : `docs/RGPD.md`, à tenir à jour avec la page.
- **Aide** (t155) : page `pages/Aide.tsx`, seconde vue commune de `VUES_COMMUNES` (`aide`), ouverte sous le menu de chaque
  espace et depuis l'écran de connexion, sans lire l'instantané. Texte : `GUIDE_AIDE` de `shared/aide.ts`, six parties
  (collaborateur, manager, service RH, gestionnaire de paie, groupe pilote, à faire avant la mise en service) ; celle de
  l'espace ouvert s'affiche d'abord (`partieParDefaut`). Version détaillée : `docs/GUIDE-UTILISATEUR.md`. Les deux se
  tiennent ensemble : mêmes titres de parties, et chaque libellé cité entre « » doit exister dans `client/src` ou
  `shared` (`tests/aide.test.ts`) : renommer un bouton oblige à mettre le guide à jour. Le calendrier de paie, inconnu,
  reste « à compléter par le gestionnaire de paie » (`A_COMPLETER_PAIE`, mis en valeur à l'écran).

## Hiérarchie des managers (t136)

Décision de l'entreprise : un manager dépend de son propre responsable « pour tout » (absences, feuilles de temps,
entretiens). Une équipe peut désigner une **équipe parente** (`Equipe.parente`, colonne `parente` de `equipes`, action
`equipe.parente`, écran Équipes & managers). Règles : `shared/rules/hierarchie.ts`.

- **Valideur** (`Domain.mgrOf`, `valideurHierarchique`) : le manager de l'équipe du salarié ; pour le manager membre de
  son équipe, le premier manager d'une équipe parente qui n'est pas lui (N+1), sinon le service RH (0). Une équipe sans
  manager reste validée par le service RH. Tous les contrôles qui passent par `mgrOf` (`isValidatorOf`, `isManagerOf`,
  `canAccess`, notifications, relances, écrans) suivent donc la hiérarchie sans autre changement.
- **Contrôles** : pas de boucle, `PROFONDEUR_MAX` (4) niveaux, pas de validation croisée nouvelle (`croiseeNouvelle`,
  qui compare `validationsCroisees` avant et après). Ce dernier refus vaut pour toute action qui change un valideur une
  fois la hiérarchie en place : `equipe.parente`, `equipe.manager` (et `equipe.modifier`), `equipe.affecter` et
  `employe.modifier` quand l'équipe change (`refuserCroisee`, server/src/actions/hierarchie.ts).
  Sans équipe parente (défaut, migration `lot6-hierarchie-equipes` qui retire seulement les rattachements impossibles),
  rien ne change.
- **Redirection** : à l'enregistrement, `elementsRediriges` compare les valideurs avant et après pour les demandes de
  congés (`demandee`), les feuilles soumises et les entretiens planifiés ; message, e-mail au nouveau valideur
  (`hierarchie.redirection`) et journal (`redirections` : type, identifiant, ancien et nouveau valideur). Le changement
  du manager d'une équipe parente (`equipe.manager`, `equipe.modifier`) redirige de même les éléments des managers des
  équipes rattachées (ceux des membres de l'équipe passent au nouveau manager comme auparavant, annoncés par la
  confirmation) ; la confirmation les liste avant l'enregistrement.
- **Consultation N+2** (réglage `consultationN2`, Paramètres → Hiérarchie des managers, désactivé par défaut) :
  `lectureSeuleIds` (server/src/dataset.ts) ajoute au périmètre du manager les membres des équipes descendantes de celles
  qu'il encadre (`equipesDescendantes`), transmis dans `Dataset.lectureSeule`. Mêmes filtres que pour l'équipe directe,
  aptitude réduite à `ok` et `aProgrammer` (ni avis, ni restrictions), ni entretiens ni demandes au service RH ; aucune
  action (le valideur reste le N+1). À l'écran : mention « Lecture seule » (Collaborateurs, Temps, Congés & absences),
  filtre par sous-équipe dans Collaborateurs ; hors des entretiens du manager (`perimetreEntretiens`).
- `equipes.parente` est déclarée dans `REFERENCES` (server/src/integrite.ts).

## Délégation des validations d'un manager absent (t135)

Pendant ses absences, un manager confie ses validations à un suppléant pour une période datée (table `delegations` :
manager, suppléant, `du`, `au` bornes comprises, `perimetre`, auteur, révocation, `annonceeLe`). Règles :
`shared/rules/delegations-manager.ts` ; actions `equipe.delegation` et `equipe.revoquerDelegation`
(server/src/actions/delegations-manager.ts) ; écrans : Mon espace (le manager pour lui-même, le suppléant pour ce qu'il
reçoit) et Équipes & managers (service RH ; lecture seule en consultation), `client/src/components/Delegations.tsx`,
`dialogs/DelegationDialog.tsx`.

- **Valideurs** (`valideursDe`) : le valideur hiérarchique (`Domain.mgrOf`) reste valideur (retour anticipé) ; pendant une
  délégation de son périmètre, le suppléant s'y ajoute. Pas d'auto-validation : pour le suppléant lui-même, c'est le N+1
  du manager (`mgrOf` du manager, service RH à défaut). Suppléant proposé : le N+1 du manager (`suppleantPropose`, réponse
  de l'entreprise « son propre responsable, pour tout »), sinon une personne choisie. Une délégation ne se transmet pas
  (le suppléant n'a pas lui-même délégué sur la période, et le manager ne remplace personne sur la période). Pas de
  validation croisée nouvelle (même garde-fou que `croiseeNouvelle` de t136) : un suppléant qui deviendrait, un jour de la
  période, le valideur de l'un de ses propres valideurs est refusé, par exemple un membre d'une équipe rattachée quand le
  N+1 délègue, ou un suppléant déjà reçu de son manager quand le N+1 de celui-ci délègue au même.
- **Périmètre** : congés et feuilles de temps par défaut ; les entretiens seulement si le réglage `delegationEntretiens`
  (Paramètres → Hiérarchie des managers, désactivé par défaut) les ouvre : le refermer les retire aussitôt
  (`perimetreEffectif`).
- **Droits** : `isValidatorOf(ctx, e, perimetre)` et `isManagerOf(ctx, e, perimetre)` (server/src/actions/context.ts)
  acceptent le suppléant, dans l'espace manager seulement, pour ce périmètre (absences.ts : `absences` ; temps.ts et
  `temps.validerLot`, `temps.relancer` : `feuilles` ; entretiens, annulation et remise : `entretiens`) ; sans périmètre
  (fiche, formations, inscriptions), rien ne change. `canAccess` l'accepte pour tout périmètre. L'espace manager est ouvert
  au suppléant du premier au dernier jour (`espacesDuCompte`, server/src/comptes.ts), refermé dès la révocation.
- **Périmètre de données** (server/src/dataset.ts) : `deleguesDe` ajoute à `scopeIds` les salariés dont il décide, avec
  les filtres de l'équipe directe ; sans le périmètre `entretiens`, ni leurs entretiens ni leurs demandes au service RH
  (`perimetreEntretiens` les écarte aussi à l'écran). `Dataset.delegues` (salarié, manager remplacé, périmètre) sert aux
  écrans (`client/src/state/delegues.ts`, `decideur`) ; `Dataset.delegations` : toutes pour le service RH et la lecture
  seule, rien pour le référent HSE et la paie ; ailleurs, celles données ou reçues, celles des managers dont la personne
  est le N+1 et celle de son propre valideur (« en son absence, … » dans Mon espace). Le manager qui encadre une équipe
  reçoit hors de l'espace RH `Dataset.suppleantsPossibles` (présents, hors intérim, réduits à l'annuaire : nom, équipe,
  poste) pour le dialogue de délégation de Mon espace, dont l'instantané n'a que sa fiche (`client/src/state/delegation-saisie.ts`) ;
  la présence du suppléant sur la période et les validations croisées sont alors contrôlées par le serveur seul.
- **Signature** : une décision prise par le suppléant est signée « par délégation de X » : message de l'action
  (`signerDelegation`, server/src/app.ts), journal (`parDelegation` : identifiants des managers remplacés, à côté du nom
  de l'auteur) et e-mail au salarié (`signature`, server/src/notifications.ts). Ni le N+1 qui décide des demandes du
  suppléant (il en est le responsable, le manager ne lui a rien délégué), ni une relance des feuilles (pas une décision :
  `decideParDelegation` ne signe pas) ne sont signés.
- **Notifications et relances** : demandes de congés et feuilles soumises notifiées aussi au suppléant
  (`notifierSuppleants`, objet « en l'absence de X ») ; relance des feuilles (`notifierRelanceSuppleants`) ; récapitulatif
  des échéances : entretiens dus des membres si la délégation les comprend (server/src/relances.ts). Le premier jour, le
  suppléant reçoit la liste des demandes déjà en attente (`annoncerDelegations`, server/src/delegations.ts, tâches de fond
  des e-mails ; aussitôt si la délégation commence le jour de sa saisie).
- **Base** : colonnes `delegations.manager_id` et `suppleant_id` dans `REFERENCES` (server/src/integrite.ts : intégrité et
  cascade d'anonymisation) ; migration `lot6-hierarchie-delegations` (révoque les délégations impossibles d'une saisie hors
  de Cursus, et fait refuser la base par une version antérieure) ; export des données d'un salarié : section
  « Délégations des validations ». Sans délégation, rien ne change : les validations restent au manager, et au service RH
  à défaut.

## Contrat et temps de travail

Chaque fiche porte trois notions distinctes (`shared/constants.ts`) :

- **Statut** (`STATUTS`) : les catégories de la CCN Industries chimiques — ouvrier / employé,
  technicien / agent de maîtrise (non-cadres) et ingénieur / cadre.
- **Nature du contrat** (`TYPES_CONTRAT`) : CDI, CDD, intérim, alternance.
- **Organisation du temps** (`TEMPS_TRAVAIL`) : horaire collectif 35 h, 39 h avec RTT, forfait
  hebdomadaire en heures, forfait annuel en heures, forfait annuel en jours, temps partiel, cadre dirigeant.

`Domain.contratOf(e)` lit ces champs et expose les indicateurs utilisés par les règles (`seuil` des heures
supplémentaires, `forfait` jours, `annuel`, `hebdo`, `partiel`, `dirigeant`, `interim`, `rtt`).
`shared/rules/profil.ts` contient les contrôles de cohérence (bloquants et avertissements) partagés par
le formulaire et le serveur. Une base créée avant ce modèle est convertie au démarrage (`server/src/migrate.ts`).

Les équipes (`referentiels.equipes`) portent leur manager ; un collaborateur sans équipe (`equipe = null`)
est « à affecter » et relève du service RH.

### Sortie d'un salarié

Règles dans `shared/rules/contrats.ts`, actions dans `server/src/actions/sorties.ts`, dialogue `dialogs/SortieDialog.tsx`,
section Contrat de la fiche `components/Sortie.tsx`. Décision de l'entreprise : Cursus fait foi pour la liste des salariés
après la reprise depuis Lucca ; la sortie se saisit dans Cursus (si Sage faisait foi plus tard, elle viendrait d'un import).

- **Date et motif** : la date de fin du contrat (`Employe.fin`, son dernier jour) sert de date de sortie pour tous les
  contrats, CDI compris ; s'y ajoute un motif en liste fermée (`motifSortie`, `MOTIFS_SORTIE` : démission, rupture
  conventionnelle, licenciement, fin de CDD, fin de période d'essai, retraite, décès, fin de mission, autre), sans texte
  libre. Un CDI ne prend fin qu'avec son motif (`validerProfil`) ; la fin d'un CDD, d'une mission ou d'une alternance sans
  motif n'est que prévue. La fiche (`employe.modifier`) ne change ni le motif ni la date d'une sortie enregistrée ; le
  passage d'un CDD en CDI efface la fin du CDD (dialogue de la fiche). Une fiche reprise d'un autre outil peut porter sa
  sortie dès sa création (`employe.creer`).
- **Effets** (`employe.sortie`, `controleSortie`, partagé avec le dialogue qui les affiche avant l'envoi) : les absences et
  demandes entièrement postérieures à la date sont annulées (Keystone reçoit `absence.annulee`) ; le salarié quitte les
  sessions ouvertes postérieures (recyclage détaché, inscription en formation initiale retirée, convocation reçue annulée
  par e-mail, `annulerSiConvoque`) ; ses entretiens planifiés après la date sont retirés (sans e-mail d'annulation) ; ses
  demandes de visite en cours sont annulées par une sortie passée ou du jour (le service de santé au travail est à
  prévenir) — à venir, elles restent suivies jusqu'au départ, une visite de reprise restant due tant que le salarié
  travaille (avertissement du dialogue) ; ses feuilles de temps vides
  non validées des semaines suivantes sont retirées ; une sortie déjà passée ferme ses sessions de connexion
  (`revokeSessionsOf`). La fin prévue au contrat est gardée (`finPrevue`) et rétablie par `employe.annulerSortie` (aucune
  pour un CDI) ; ce que la sortie a annulé ne l'est pas.
- **Après le dernier jour, rien ne se planifie** (`horsContratLe`, sortie enregistrée ou fin prévue d'un CDD) : inscription
  à une session (`plan.inscrire`, demande de formation acceptée), entretien (`entretien.planifier`), et, une fois la date
  passée, demande de visite (`medical.demander`) ; les dialogues le signalent avant l'envoi. Dès l'enregistrement, les
  échéances (`Domain.echeances`) et obligations d'entretien (`obligations`) qui tombent après la date disparaissent ; les
  échues restent, comme un entretien planifié avant le départ.
- **Blocages** : salarié manager d'une équipe (le remplacer d'abord), heures saisies après la date sur une feuille de
  n'importe quel statut, absence ou demande à cheval sur la date (la raccourcir ou l'annuler d'abord), date antérieure à
  l'entrée ou postérieure à la fin prévue du contrat (prolonger d'abord le contrat dans la fiche), aucun autre administrateur
  RH en place après la date (`adminsDurables` : un administrateur dont la sortie est déjà enregistrée ne compte pas ; de
  même pour désactiver ou changer le profil d'un administrateur, `compte.activer`, `compte.profil`). La sortie d'un
  salarié dont le compte ouvre l'espace RH, qui ferme ce compte, est réservée à l'administrateur RH, comme la gestion des
  comptes. La nature d'une absence n'est jamais citée.
- **Passé la date** (`present`, `sorti`) : connexion refusée et sessions sans effet (`refusDuCompte`), plus de notification
  (`adresseSalarie`), aucune feuille ni absence (bornes du contrat) — protections déjà en place pour les CDD ; le salarié
  quitte `Domain.enrich` (conformité, tableaux de bord, habilitations, formations, équipes), les échéances
  (`Domain.echeances`) et les obligations d'entretien (`obligations`). Il reste consultable dans Collaborateurs avec le
  filtre « Sortis » (`enrich(…, { sortis: true })`, fiche sans action à planifier). Sur les chantiers où il est affecté, il
  reste évalué en « No Go CONTRAT » (`Domain.evaluateChantiers`) : Keystone en est prévenu au lieu de le voir disparaître.
  Un salarié sorti n'est plus désigné manager ; une équipe qui ne compte plus que des salariés sortis se supprime (ils
  en sont détachés).
- **Confidentialité** : le motif et la fin prévue ne sont transmis qu'au service RH, à la paie (solde de tout compte), à la
  lecture seule et à l'intéressé ; le manager et le référent HSE ne voient que la date et l'indication qu'une sortie est
  enregistrée (`sortieEnregistree`, `server/src/dataset.ts`), pour que leurs échéances du contrat soient celles du RH.
- **Solde de sortie** (t128, `shared/rules/solde-sortie.ts`, `server/src/soldes-sortie.ts`, `components/SoldeSortie.tsx`,
  `client/src/solde-sortie.ts`) : Cursus fait foi pour les compteurs (décision de l'entreprise). `etatSortie(d, e, date)`
  applique les règles des compteurs à un instantané vu au dernier jour (`domaineALaDate` : jour du calcul et fin du
  contrat à cette date, absences postérieures annulées) : CP de la période acquise (droits, reports non échus compris,
  moins pris et posés) et jours acquis sur la période en cours jusqu'au mois de la sortie (`acquisAu`, mois compté si le
  salarié est sous contrat à la mi-mois) moins les jours pris par anticipation, leur somme étant à indemniser ; RTT ou
  repos au prorata moins pris et posés (négatif : trop-pris signalé, sans retenue) ; récupération en heures ; CET liquidé
  en entier (aucun accord connu). Demi-journées comprises. Points à voir : période de CP ou année de RTT précédente pas
  encore clôturée, demande de congé en attente. Le dialogue de sortie l'affiche avant la confirmation ; `employe.sortie`
  le photographie (table `soldesSortie`, un solde courant par salarié : état, date, auteur), le refait à chaque
  modification tant qu'il n'est pas parti à la paie (ensuite gardé tel quel à la même date, l'écart se corrige dans
  Sage ; à une autre date, remplacé : `remplaceLe`, gardé pour l'historique, et un nouveau solde est photographié) ;
  `employe.annulerSortie` le retire, ou, transmis, le marque remplacé (une nouvelle sortie photographie un nouveau
  solde). Les jours pris sur la période N repris de Lucca (« CP N », `reprisSur`) et les placements CET de la période en
  cours se déduisent des jours en cours d'acquisition ; une feuille non validée jusqu'à la sortie est signalée (son repos
  n'est pas compté). Tant qu'il est dans un lot à confirmer, la sortie ne se modifie ni ne s'annule (409 : annuler
  d'abord le lot). Fiche (section Sortie) : solde photographié, état de sa transmission, calcul du jour s'il diffère
  (service RH ; une sortie sans photographie ne se calcule qu'au service RH, la paie et la lecture seule n'ayant pas la
  nature des absences), soldes remplacés rappelés, impression et export CSV tracés. Transmis au service RH, à la paie et à la lecture seule ; ni au manager,
  ni au référent HSE, ni à l'intéressé (`dataset.ts`).
- **Journal** : `employe.sortie` (date, motif, nombre d'éléments annulés, identifiant du solde photographié — ses
  quantités figurent dans le message —, anciennes et nouvelles valeurs de `fin` et `motifSortie`) et
  `employe.annulerSortie`, actions liées à la paie (archive de 3 ans).

### Période d'essai

Règles dans `shared/rules/contrats.ts` (`essaiMaximum`, `controleEssai`, `limitePrevenance`), champs `essaiFin` et
`essaiRenouveleJusquau` de la fiche (`employe.creer`, `employe.modifier`, section « Période d'essai » du dialogue de la
fiche, `components/ContratFiche.tsx` dans la section Contrat du panneau).

- **Aucune durée proposée** : l'essai n'existe que s'il est écrit au contrat (art. L1221-23) et la CCN Industries
  chimiques peut prévoir moins que la loi. Le service RH saisit la fin (et celle du renouvellement) écrite au contrat ;
  une valeur proposée et gardée par erreur ferait arriver l'alerte après la vraie fin (rupture devenue licenciement).
- **Contrôles** (`validerProfil`) : bloquants pour la cohérence (fin avant l'entrée ou après la fin prévue du contrat,
  renouvellement sans période initiale ou qui finit avant elle). La borne est la fin prévue au contrat (`finPrevue` après
  une sortie), jamais la date de sortie : une rupture pendant l'essai la précède, et la fiche reste modifiable ; avertissement au-delà du maximum légal — CDI : 2, 3 ou
  4 mois selon le statut, 4, 6 ou 8 renouvellement compris (`ESSAI_MAX_CDI` de `shared/constants.ts`, art. L1221-19 et
  L1221-21) ; CDD et alternance à terme : 1 jour par semaine, au plus 2 semaines jusqu'à 6 mois de contrat, 1 mois
  au-delà (art. L1242-10), sans renouvellement légal ; intérim : 2, 3 ou 5 jours travaillés selon la mission
  (art. L1251-14). La table des durées de la CCN s'ajoutera à `ESSAI_MAX_CDI` une fois vérifiée.
- **Délai de prévenance** (art. L1221-25 : 24 h, 48 h, 2 semaines, 1 mois selon la présence ; il ne prolonge pas
  l'essai) : `limitePrevenance` donne le dernier jour où notifier une rupture en le respectant ; ni l'intérim ni un essai
  de moins d'une semaine n'en ont (la fin de l'essai elle-même).
- **Visibilité** : service RH, paie, lecture seule, manager (il en évalue l'issue) et intéressé ; pas le référent HSE.

### Titre de séjour (autorisation de travail)

Règles dans `shared/rules/contrats.ts` (`TYPES_TITRE_SEJOUR`, `validerAutorisation`, `etatAutorisation`), action
`employe.autorisationTravail` (`server/src/actions/contrats.ts`), dialogue `dialogs/AutorisationDialog.tsx`, colonne JSON
`autorisationTravail` de `employes` (null : non requise).

- **Données** : type (liste fermée), numéro (registre unique du personnel), expiration (sauf carte de résident permanent),
  date de vérification auprès de la préfecture ; ni copie (elle ira dans la GED Codex), ni nationalité. Information des
  salariés : `INFO_TITRE_SEJOUR`, affichée dans le dialogue, à faire valider par le DPO (`docs/RGPD.md`).
- **Embauche** (art. R5221-41) : la règle porte sur l'envoi de la demande d'authentification (`demandeLe`), au moins 2
  jours ouvrables avant une embauche récente ou à venir (`joursOuvrablesAvant`), pas sur la réponse (`verifieLe`) : sans
  réponse sous 2 jours ouvrables, l'obligation est remplie. Avertissement si rien n'est tracé, si la demande est tardive,
  ou si, sans date d'envoi, la réponse arrive après la date limite (elle ne prouve alors rien).
- **Alertes** : échéance « Titre de séjour » à la première alerte (`titreSejourAlerte`, 120 jours, fenêtre de la demande
  de renouvellement) puis « Relance » (`titreSejourRelance`, 60 jours), réglables (Paramètres → Contrats). Expiré
  (art. L5221-8) : « Expiré — non conforme », salarié non conforme (`Domain.enrich`), « No Go CONTRAT » sur les chantiers
  (état du jour, comme l'aptitude), avertissement sur la feuille de temps (`AlerteAutorisation`, sans bloquer la saisie).
- **Confidentialité** : numéro au service RH et à l'intéressé seulement, jamais au journal (règle de
  `employe.autorisationTravail` : colonne aplatie, `numero` masqué) ; la lecture seule voit le titre sans numéro ; le
  manager, le référent HSE et la paie reçoivent le verdict seul (`autorisationVerdict`, aucune échéance datée). Keystone
  ne reçoit, en partage détaillé, que « Situation contractuelle à régulariser » (`SITUATION_A_REGULARISER`), jamais la
  mention d'un titre. Le titre fait partie de la fiche dans l'export des données du salarié (`server/src/donnees.ts`).

### Échéances du contrat

`echeancesContrat` (type `contrat` de `Domain.echeances`, filtre « Contrats » de l'écran Échéances et export CSV) :
fin de période d'essai datée de `limitePrevenance` (« À décider » sous le seuil d'alerte, « Prévenance dépassée » ensuite,
jusqu'à la fin de l'essai ; retirée par une sortie enregistrée) ; fin prévue d'un CDD, d'une mission ou d'une alternance sans sortie enregistrée (« À
anticiper » sous le seuil, action « Enregistrer la sortie ») ; titre de séjour. Tableau de bord : panneau « Contrats à
suivre » (hors des indicateurs de renouvellement) ; manager : panneau « Fins d'essai et de contrat » de son équipe en
tête de l'écran Équipe. Les relances par e-mail relèvent de t034.

### Historique des contrats (t074)

Table `contratsHistorique` (`server/src/db.ts`), règles dans `shared/rules/historique-contrat.ts`, écritures côté serveur dans
`server/src/avenants.ts`, section « Historique du contrat » de la fiche (`components/HistoriqueContrat.tsx`).

- **Lignes** : salarié, date d'effet, nature (`embauche`, `avenant`, `renouvellement`), régime figé (`ContratFige` : statut,
  nature du contrat, organisation du temps, durée, forfait, jours non travaillés ; null : régime antérieur inconnu), terme
  du contrat fixé par la ligne (`jusquau`), date de signature et référence de l'avenant, jour, nom et fiche de l'auteur
  (`par`, `parId`, dans `REFERENCES` de `server/src/integrite.ts`), `applique` (faux : avenant programmé), `annuleLe`, `fin`
  (sortie). Écrites par `employe.creer` (embauche), `employe.modifier` (avenant à chaque changement de régime ; date
  d'entrée corrigée suivie par l'embauche), `employe.renouvelerCdd`, `employe.sortie` (date de la dernière ligne qui a pris
  effet ; avenants programmés et renouvellements d'un CDD qui devaient commencer après elle annulés : une sortie anticipée
  ne laisse compter aucun renouvellement sans effet ; une sortie modifiée rend effet à ceux d'avant sa nouvelle date) et
  `employe.annulerSortie` (date retirée, renouvellements annulés par la sortie rétablis avec la fin prévue). Une fiche sans ligne (antérieure, importée) est
  d'abord amorcée comme par la migration.
- **Régime à une date** (`segmentsContrat`, `regimeAu`) : lignes appliquées, la dernière prenant le régime de la fiche, qui
  fait foi pour le régime en cours (une fiche changée hors de l'historique, par un import, l'emporte ; un `tempsDepuis`
  postérieur à la dernière ligne ouvre une période, le régime d'avant restant celui de la ligne s'il diffère, sinon inconnu),
  puis avenants programmés. Sans ligne : la fiche depuis l'entrée ou `tempsDepuis`, inconnu avant — le comportement d'avant
  l'historique. Utilisé : à la création d'une feuille (`server/src/actions/temps.ts`, figée sur le régime de sa semaine s'il
  diffère de la fiche, `regimeAFiger` : une feuille créée 12 semaines avant un changement prend l'ancien régime), par
  `employeDeLaFeuille` en repli d'une feuille sans régime figé, par `rttDroit` (somme, mois par mois, du douzième du droit
  de chaque régime de l'année : un passage de 39 h à 35 h au 1er octobre garde 9/12 des RTT ; jours de repos d'un forfait au
  prorata de même ; un régime inconnu ne compte pas), par `cumulAnnuel` (cible d'un forfait annuel en heures au prorata des
  périodes sous forfait ; un seul régime connu : la cible d'avant) et par le décompte des jours non travaillés d'un temps
  partiel (`countedDays`, régime du premier jour de l'absence). Les CP s'acquièrent de même quel que soit le régime (temps
  partiel compris, art. L3123-5) : `cpDroit` est inchangé.
- **Avenant à date future** : `employe.modifier` avec une date d'effet postérieure à aujourd'hui (organisation du temps
  seulement, statut et nature du contrat changeant le jour même ; un seul avenant programmé à la fois ; pas après la fin du
  contrat) inscrit la ligne sans changer la fiche ; les brouillons des semaines suivantes sont figés sur le régime à venir
  et les RTT de l'année le comptent. `appliquerAvenants` (`server/src/avenants.ts`, au démarrage puis toutes les heures)
  écrit à sa date l'organisation du temps et `tempsDepuis` sur la fiche, fige l'ancien régime sur les feuilles antérieures
  qui n'en ont pas, refige les brouillons et trace `employe.avenantApplique` (identifiant de la ligne, date d'effet).
  `employe.annulerAvenant` l'annule tant qu'il n'est pas appliqué.
- **Garde-fou conservé** : à un changement daté du jour ou passé, les feuilles antérieures sans régime figé reçoivent
  l'ancien (comme avant) et chaque semaine sous contrat des 8 précédentes (`SEMAINES_FIGEES`, `semainesAFiger`) encore sans
  feuille en reçoit une, brouillon et vide, figée sur l'ancien régime. RTT de l'année pris ou posés que le nouveau régime
  ne couvre plus même au prorata (`rttPerdus` : aucun droit dans l'année, au tout début de l'année ou en intérim ; jours
  pris et posés au-delà du nouveau droit au prorata, solde négatif) : le service RH confirme (`confirmerRtt`, refus 400
  sinon) et le solde affiché juste avant est gardé au journal pour la paie, sous le code `employe.rtt` (archive paie) avec
  `soldeRtt` (droit, pris, posés, solde, date d'effet, nouveau droit au prorata, RTT posés ou validés après la date
  d'effet, cités dans la confirmation pour être revus). Des RTT posés après la date d'effet et couverts par le droit au
  prorata ne demandent rien : acquis sous l'ancien régime, ils se prennent ensuite.
- **Migration** `lot6-contrats-historique` (`server/src/migrations/lot6-contrats.ts`, `historiqueDepuisFiches`, aussi pour
  le jeu de démonstration) : embauche à l'entrée au régime de la fiche (terme prévu d'un contrat à durée déterminée) ;
  fiche dont le régime a changé après l'entrée : régimes figés des feuilles antérieures au changement (hors ceux égaux au
  régime actuel), à défaut un régime inconnu, puis l'avenant à `tempsDepuis`. Tracée `migration.contratsHistorique`
  (nombres). Non-régression (`tests/contrats-historique.test.ts`) : sur le jeu de démonstration, tout salarié d'un seul
  régime garde exactement ses droits (RTT, CP, récupération, forfait annuel, décompte des feuilles) ; les cas de paie
  (`tests/cas-paie.test.ts`) se rejouent migrations appliquées. Aucune période clôturée ni aucun compteur repris n'est
  recalculé : une clôture garde son solde photographié, et un solde repris de Lucca reste celui de l'ancien outil à la date
  d'arrêté (`reprise`).
- **Réembauche** : nouvelle fiche qui réutilise le matricule de paie (confirmation de l'administrateur RH, comportement
  inchangé) ; la section de la fiche nomme les fiches précédentes du même matricule, avec un lien (service RH, paie,
  lecture seule).
- **Visibilité** : service RH, paie et lecture seule (tout) ; intéressé sans la référence ni l'auteur ; manager, pour les
  membres de son équipe, les régimes seuls (embauche et avenants, sans terme `jusquau`, ni date de signature, ni ligne de
  renouvellement : le terme initial et la fin prévue lui sont masqués) ; référent HSE : rien (`server/src/dataset.ts`).

### CDD : motif de recours, renouvellements, carence (t053)

Règles dans `shared/rules/cdd.ts`, champs `motifRecours` et `cddFinInitiale` de la fiche (`validerProfil`), action
`employe.renouvelerCdd` (`server/src/actions/avenants.ts`), dialogue `dialogs/RenouvelerCddDialog.tsx`, section Contrat de la
fiche (`components/ContratFiche.tsx`), réglages de Paramètres → Contrats.

- **Motif** (`MOTIFS_RECOURS`, liste fermée, art. L1242-2 et L1242-3) : remplacement d'un salarié absent, départ avant
  suppression du poste, attente d'un salarié recruté en CDI, accroissement temporaire d'activité, travaux urgents de
  sécurité, emploi saisonnier ou d'usage, commande exceptionnelle à l'exportation, CDD senior, politique de l'emploi ou
  formation. Facultatif pour l'intérim (art. L1251-6) et sur une fiche existante (pas de migration : `openDb` ajoute les
  colonnes), rappelé tant qu'il manque sur un CDD.
- **Durée maximale renouvellements compris** (règles supplétives, art. L1242-8-1) : 18 mois en général, 9 mois en attente
  d'un salarié recruté en CDI ou pour des travaux urgents, 24 mois pour l'exportation ou un départ avant suppression de
  poste, 36 mois pour un CDD senior ; aucune pour un emploi saisonnier ou d'usage, ni pour un contrat de la politique de
  l'emploi. Un CDD de remplacement ou d'attente peut être à terme imprécis (art. L1242-7) : rappelé dans l'avertissement.
  **Renouvellements** : 2 (art. L1243-13-1), un seul pour un CDD senior. Réglages `cddRenouvellementsMax` (2),
  `cddDureeMaxMois` (0 : selon le motif) et `cddAccordBranche` (référence exigée dès qu'une valeur diffère de la loi,
  `COHERENCE` ; masquée au journal) : la branche peut y déroger (art. L1242-8 et L1243-13), à vérifier pour la CCN ; pas
  pour le CDD senior, dont la durée et l'unique renouvellement sont fixés par décret (art. D1242-2).
- **Renouvellement** : ligne `renouvellement` de l'historique (effet au lendemain de l'ancien terme, nouveau terme, date de
  signature, référence), fin de la fiche repoussée, terme initial gardé ; contrat dont le terme est passé : refus (la
  relation poursuivie en a fait un CDI, art. L1243-11, ou un nouveau contrat est une nouvelle fiche). Une fin repoussée
  directement par `employe.modifier` est enregistrée avec l'avertissement d'utiliser le renouvellement.
- **Carence** (`carences`, art. L1244-3 et L1244-3-1) : à la création d'une fiche CDD ou intérim, contrat antérieur (CDD ou
  intérim) terminé avant l'entrée sur le même poste du référentiel ou du même titulaire (matricule de paie, ou nom et date
  de naissance) ; délai du tiers de sa durée renouvellements compris (moitié en deçà de 14 jours), en jours d'ouverture
  comptés du lundi au vendredi hors fériés (à vérifier pour un service en continu) ; aucun pour les motifs exceptés (art.
  L1244-4-1 : remplacement, travaux urgents, saisonnier ou d'usage), les autres exceptions rappelées. Avertissement dans le
  dialogue et le message de création.
- **Tout en avertissement** : rien n'est bloqué (seuls un motif hors de la liste et un terme initial incohérent sont
  refusés). **Visibilité** du motif et du terme initial : service RH, paie, lecture seule, intéressé ; ni le manager ni le
  référent HSE. Journal : codes et dates seulement (référence de l'avenant : « [texte renseigné] »).

### Date de naissance et âge

Lot 5, chantier E (salariés mineurs), étape 1. `naissanceLe` (colonne `naissance_le`, déclarée dans `TABLES` : le schéma
déclaratif l'ajoute aux bases existantes, sans migration nommée, aucune donnée n'étant à reprendre) porte la date
complète ; `naissance` en reste l'année, dérivée de la date par `normaliserProfil` quand elle est saisie, seule connue
d'une fiche antérieure. Règles dans `shared/rules/mineurs.ts` :

- `ageAu(e, date)` : âge révolu avec la date (atteint le jour anniversaire, le 28 février pour un 29 février d'une année
  non bissextile, comme `addMonths`) ; avec l'année seule, âge atteint dans l'année civile (règle d'avant). `dateDesAns`
  donne le jour où un âge est atteint (18 ans : échéance de l'étape 2) ;
- `mineurAu(e, date)` : moins de 18 ans selon `ageAu`, donc règle à l'année avec l'année seule (majeur dès le 1er janvier
  de l'année de ses 18 ans) ; les règles des mineurs (étape 2) ne lisent que `mineurAu`, pour une seule réponse par fiche ;
- sections « fin de carrière » (`needsFinCarriere`, shared/rules/entretiens.ts) : 58 ans atteints **à la date de
  l'entretien**, ou section déjà rédigée (un entretien reprogrammé, une date de naissance complétée ne retirent pas un
  texte saisi, voire signé, de l'écran ni du compte rendu imprimé) ; le supplément de 5 jours de congés à 59 ans (`supplementAge`) reste à l'année civile (choix retenu) ;
- saisie (fiche) : date requise pour une nouvelle fiche, au moins 14 ans à la date d'entrée (`AGE_MINIMUM`, art.
  L4153-3) ; une fiche qui n'a que l'année s'enregistre sans date, l'année reste contrôlée comme avant ; une date déjà
  enregistrée se corrige mais ne s'efface pas (`naissance.enregistree` de `validerProfil`, client et serveur) ; le
  dialogue du manager, sans la date, ne contrôle pas la naissance (`naissance.masquee`), que le serveur contrôle ;
- reprise depuis Lucca (`naissanceDe`, shared/rules/reprise.ts) : une date complète est gardée telle quelle ; une année
  seule ne remplace la date d'une fiche que si elle la contredit.

Confidentialité (`server/src/dataset.ts`, `naissanceVueManager`) : le manager (membres de son équipe) et les profils
restreints de l'espace RH reçoivent `naissanceLe: null`, l'année (règle à l'année des congés, transmise comme avant) et
`mineur` au jour de l'instantané ; pas d'âge exact, qui à côté de l'année trahirait le jour anniversaire. Leurs feuilles
portent `mineur` (un jour au moins de la semaine) et, seulement quand c'est le cas, `moins16` (repos quotidien de 14 h,
nuit de 20 h à 6 h), pour que leurs contrôles soient ceux du serveur. Les sections de
fin de carrière de leurs entretiens sont calculées par le serveur (`finCarriere` de l'entretien), pour que l'évaluateur
rédige celles que `entretien.modifier` accepte. Le journal nomme `naissanceLe` parmi les champs modifiés, sans sa valeur.

### Salariés de moins de 18 ans

Lot 5, chantier E, étape 2. Règles dans `shared/rules/mineurs.ts`, qui ne lisent que `mineurAu` : elles s'appliquent jour
par jour et cessent d'elles-mêmes le jour des 18 ans (date complète), ou le 1er janvier de l'année des 18 ans (année seule).

- **Durées** (art. L3162-1) : `controlesMineur`, appelé par `calcSheet` (une ligne, `depassementsMineur` de `SheetCalc`) ;
  plus de 8 h un jour de minorité, plus de 35 h sur les jours de minorité de la semaine (la semaine des 18 ans, les heures
  faites majeur n'y comptent pas). Ces dépassements rejoignent `depassements` : soumission et validation exigent, comme
  au-delà de 10 h ou 48 h, un motif (`motifDepassement`), ici « motif ou référence de la dérogation de l'inspection du
  travail » (décision de l'entreprise du 17 octobre 2026). Le journal de `temps.submit` et `temps.validate` trace que le
  motif est renseigné (`[texte renseigné]`, jamais son texte) et les contrôles en cause (`depassementMineur` :
  `jour_8h`, `semaine_35h`). Les rubriques de paie ne changent pas.
- **Repos** (alertes, `repos` de `SheetCalc`, comme le repos hebdomadaire des majeurs) : heures le dimanche (art.
  L3164-5, sans dérogation pour l'industrie chimique, même quand l'équipe a une dérogation au repos dominical) ; à défaut,
  semaine sans deux jours consécutifs sans heure (art. L3164-2), le samedi travaillé laissant possible un repos dimanche
  et lundi suivant, que l'alerte invite à vérifier. Avec un horaire de poste sur la feuille (lot 6,
  `shared/rules/repos-nuit.ts`) : repos quotidien de 12 h (14 h avant 16 ans, art. L3164-1 ; vues sans la date de
  naissance : indication `moins16` de la feuille, comme `mineur`, `moins16DeLaSemaine`) et pause de 30 min au-delà de
  4 h 30 (art. L3162-3), à motiver comme les durées ; sans horaire, ni l'un ni l'autre ne sont contrôlés.
- **Nuit** (art. L3163-2) : case « travail de nuit ou en continu » de l'équipe (`Equipe.nuit`, colonne JSON pour garder
  `null`, case pas encore renseignée, distincte de « non » ; le schéma déclaratif l'ajoute, sans migration nommée),
  saisie dans le dialogue des exigences communes (Référentiels → Postes : « À renseigner », « Oui », « Non » ; envoyée
  seulement sur une réponse, enregistrer les seules exigences la laisse à renseigner) et envoyée avec elles
  (`referentiel.equipe.exigences`, paramètre `nuit` ; server/src/actions/mineurs.ts), tracée avec sa valeur d'avant. Un
  mineur (aujourd'hui, ou à sa date d'entrée si elle est à venir) n'est pas affecté à une équipe cochée : `refusEquipeNuit`,
  dans `validerProfil` (option `mineurs` : fiche, client et serveur, import de reprise) et dans `equipe.affecter` ; une
  équipe qui compte un mineur ne se coche pas. Tant que la case de son équipe n'est pas renseignée, la fiche du mineur
  rappelle l'interdiction (`MineurFiche`, client/src/components/Mineur.tsx).
- **Travaux réglementés** (art. R4153-40 et suivants) : `derogationTravauxLe`, date de la déclaration de dérogation, saisie
  par le service RH sur la fiche (champ de `PROFIL_FIELDS`, proposé pour un salarié mineur ; jamais future), sans lien aux
  postes tant que les postes à risques ne sont pas connus. Validité de 3 ans (`finDerogationTravaux`, art. R4153-41).
- **Échéances** (`echeancesMineur`, appelée par `echeancesContrat`, type `contrat`) : « 18 ans », qui lève ces règles (à
  l'année : 1er janvier, avec l'action « Saisir la date de naissance »), et fin de la dérogation quand elle précède les
  18 ans (à renouveler sous l'horizon d'alerte, expirée ensuite). Aucune dans une vue sans la date de naissance. Le
  récapitulatif des échéances par e-mail les relance sous des clés propres (`mineur:18ans:…`, `derogation:…`) et au seul
  service RH (`sante: true`, comme le titre de séjour) : le jour des 18 ans donnerait au manager la date de naissance.

Confidentialité : le manager ne reçoit pas la dérogation (`derogationTravauxLe: null`) ; le référent HSE et la lecture
seule la reçoivent, la paie non. Sans la date de naissance, ces deux vues reçoivent aussi `derogationApresMajorite`
(validité au-delà des 18 ans, sans date) pour des échéances identiques à celles du service RH. Dans les vues sans la date
(manager pour les membres de son équipe, paie, lecture seule), chaque feuille porte l'indication `mineur` de sa semaine
(`mineurDeLaSemaine`, mineur un jour au moins), que `calcSheet` lit à la place de celle du jour (`naissanceDeLaFeuille`) :
la semaine passée d'un salarié devenu majeur garde ses contrôles, et le manager le champ du motif que le serveur exige. La
semaine des 18 ans, la vue applique les règles aux sept jours (motif demandé un peu plus tôt que par le serveur). La case de nuit d'une équipe n'est pas une donnée personnelle.

## Certifications et habilitations

- **Certification en vigueur** : pour chaque collaborateur et chaque formation, seule la plus récente
  compte (`certEnVigueur` de `shared/domain.ts`) — statut, échéances, indicateurs, prérequis des
  habilitations, Go / No Go, fiche et passeport formation. Les certifications remplacées par un
  recyclage restent en base : `EmpX.anciennes` les expose comme historique (« remplacée le … »).
  Leur place dans une session ouverte postérieure au recyclage est libérée (`cert.ajouter`, `session.modifier`
  quand la session est redatée après lui, et au démarrage pour une base existante : `server/src/migrate.ts`).
- **Suspension et retrait** : un titre délivré porte une éventuelle mesure (`mesure`, `mesureDate`,
  `mesureMotif`, `mesurePar`). Suspendu (`susp`) ou retiré (`retiree`), il n'est plus valide : fiche
  non conforme, échéance dépassée, No Go avec les codes `HABILITATION_SUSPENDUE` / `HABILITATION_RETIREE`.
  La suspension se lève (RH) ; le retrait est définitif, seule une nouvelle délivrance, datée au plus tôt
  du jour du retrait, rétablit le titre. Une demande acceptée après un retrait reste notée sur le titre
  (`demande`) jusqu'à cette nouvelle délivrance.
- **Renouvellement d'un titre expiré** : la demande acceptée (`demande.accepter`) inscrit sa date sur le titre existant
  (`demande`), comme après un retrait ; « Renouvellement demandé le … » (`HabInfo.note`), compté « En attente » dans
  l'écran Habilitations (filtre et cartes, `renouvellementDemande`) sans changer son statut : il reste expiré pour le statut,
  les échéances et le Go / No Go jusqu'à la nouvelle délivrance, qui efface la demande. Un titre expiré ou retiré dont le
  renouvellement est accepté ne se redemande pas (`habEnCours`).
  Le motif est un texte libre visible du manager et du collaborateur, jamais transmis à Keystone.
  Une base existante reçoit les nouvelles colonnes au démarrage (schéma déclaratif de `server/src/db.ts`).

## Corrections d'une saisie erronée

Règles dans `shared/rules/corrections.ts`, actions dans `server/src/actions/corrections.ts`, interface :
`components/Corrections.tsx` (fiche du collaborateur : « Corriger », « Supprimer » sur chaque certification, certifications
supprimées dans l'historique, section « Demandes au service RH » avec « Rouvrir » et « Retirer la demande »),
`dialogs/CertDialog.tsx` (correction, `certId`), `dialogs/PlanLigneDialog.tsx` (Plan & budget : « Corriger »,
« Supprimer »), « Retirer la demande » au portail ; confirmations `state/confirmations-corrections.ts`.

- **Rien n'est effacé** : une certification ou une ligne du plan supprimée garde `annuleLe`, `annulePar`, `annuleMotif` et sort
  de l'instantané (`loadFull` : certifications hors de `certs`, de `avecInscrits`, des prérequis et du Go / No Go — gardées
  dans `Employe.certsAnnulees` pour le service RH seul ; lignes hors de `plan`) ; `certEnVigueur` et `certsOf` les écartent
  aussi, comme la reprise `libererPlacesRemplacees` de `server/src/migrate.ts`. Une correction garde `corrigeLe`,
  `corrigePar`, `corrigeMotif` (dernière correction) ; le journal garde les valeurs avant et après.
- **Motif obligatoire** (500 caractères) pour toute correction du service RH : texte libre retiré des instantanés du manager,
  du collaborateur et des profils restreints (`sansCorrections`, `ligneSansMotif`, `demandeSansMotifRh` de
  `server/src/dataset.ts`), jamais recopié au journal ; le salarié le retrouve dans la copie de ses données.
- **Habilitations** (`habilitationsAppuyees`) : une correction ou une suppression qui ferait tomber le prérequis d'une
  habilitation délivrée et valide (ni suspendue, ni retirée, ni expirée) est refusée, au dialogue comme au serveur ; une
  autre certification valide de la même formation, revenue en vigueur, suffit. Le message propose de suspendre d'abord
  l'habilitation (décision tracée, signalée à Keystone). Après la correction, les verdicts Keystone sont recalculés.
- **Sessions** : la certification supprimée, ou corrigée vers une autre formation, quitte la session ouverte où elle est
  inscrite (convocation reçue annulée par e-mail ; session commencée ou à clôturer : la clôturer d'abord) et le résultat de
  clôture qui la désignait (`participations.certId`) ne la désigne plus. Une certification que la correction rend remplacée
  libère sa place dans une session postérieure (règle de `cert.ajouter`). L'inscription en formation initiale que
  `cert.ajouter` clôt est gardée sur la certification (`inscriptionsCloses`, service RH seul) : la suppression de la
  certification, ou sa correction vers une autre formation, la rend telle qu'elle était si la session l'accueille encore
  (`inscriptionsARendre`, `server/src/actions/inscriptions-closes.ts`), sinon le message et la confirmation disent de
  réinscrire le salarié.
- **Retour dans une session** (`refusRetour`) : un salarié ne retrouve une session quittée (réouverture d'une demande,
  inscription rendue) qu'aux conditions de `plan.inscrire` : session ouverte et à venir, place libre, dans le contrat, sans
  absence ni autre session ces jours-là. Sinon le recyclage redevient à planifier, l'inscription initiale est retirée (à
  refaire) ; la confirmation de réouverture (`effetsReouverture`) l'annonce de même. Le journal de `demande.reouvrir` garde
  ce qu'elle a défait (identifiants ; ligne du plan : exercice, formation, équipe, trimestre et coût).
- **Plan** : seules les lignes prévues ou engagées d'un exercice ouvert se corrigent ou se suppriment ; une session ouverte
  rattachée (`sessions.planId`) fige la formation et empêche la suppression (annuler d'abord la session, qui rend la ligne
  « prévue »).
- **Demandes** : l'auteur retire sa demande tant qu'elle attend (statut `retiree`) ; le service RH ou le référent HSE rouvre
  une demande de formation ou d'habilitation acceptée ou refusée par erreur (jamais un document déclaré, déjà écrit au
  dossier). `demande.accepter` enregistre ce qu'elle crée (`suite` : session et certification ou inscription, session
  quittée, ligne du plan, titre d'habilitation), que la réouverture défait ; pour une demande acceptée avant, la suite est
  retrouvée d'après la demande (`suiteAcceptation` : rattachement à la session souhaitée, titre, dernière ligne du plan issue
  d'une demande pour la même formation et l'équipe du salarié).
- **Base existante** : colonnes ajoutées au démarrage (schéma déclaratif), aucune migration nommée.

## Référentiels

Formations, habilitations et destinations (tables `formations`, `habilitations`, `destinations`) se tiennent dans
l'écran Référentiels (`client/src/pages/Referentiels.tsx`, onglets Formations, Habilitations, Destinations), avec les
actions `referentiel.*` (`server/src/actions/referentiels.ts`) et les contrôles partagés de `shared/rules/referentiels.ts`.
Une base de production démarre avec des référentiels vides (seul le jeu de démonstration les remplit).

- **Droits** (décision de l'entreprise) : formations et habilitations, service RH et référent HSE / formation (droit
  `formations`) ; destinations, service RH ; la lecture seule consulte l'écran. Chaque création, modification, archivage
  ou rétablissement est tracé au journal avec les valeurs avant et après (famille « Référentiels ») : du paramètre, seul
  le code normalisé de l'élément est recopié (et `retablir` pour un archivage, le référentiel visé pour un chargement),
  jamais une valeur libre.
- **Codes** : identifiant d'une formation ou d'une habilitation (minuscules, chiffres, « - », « _ ») ou code pays ISO
  d'une destination ; choisi à la création (proposé d'après le nom court), jamais modifié, unique même parmi les archivés :
  il désigne l'élément dans les dossiers et auprès de Keystone (exigences des chantiers, `GET /referentiels`, qui donne
  aussi la date d'archivage : un code archivé reste reçu, mais Keystone ne le propose plus).
- **Archivage plutôt que suppression** (`archive` : date d'archivage) : un élément archivé n'est plus proposé (catalogue
  `Domain.forms`, dialogues de certification, de session, de délivrance, de demande, de déplacement et de visa, import
  des déplacements) et le serveur refuse toute nouvelle saisie sur lui (`refusArchive`) ; ses titres ne comptent plus dans
  les statuts ni les échéances (`habSuivie`) mais restent au dossier et lisibles (historique de la fiche, certifications
  remplacées comprises ; « Mes certifications » et « Mes habilitations » de l'espace collaborateur), dans les prérequis, le
  Go / No Go et les échanges avec Keystone. Il se rétablit d'un clic. Une formation exigée en prérequis par une
  habilitation en vigueur, ou qui a une session ouverte, ne s'archive pas ; symétriquement, une habilitation ne se
  rétablit pas tant qu'un de ses prérequis est archivé (`prerequisArchives`) : une habilitation en vigueur n'exige
  jamais une formation que nul ne peut plus obtenir.
- **Demandes en attente** : une demande de formation ou d'habilitation déposée avant l'archivage ne s'accepte plus
  (`demande.accepter` refusée : à refuser, ou à rétablir l'élément d'abord). La confirmation d'archivage annonce ces
  demandes (`demandesEnAttente`) et, pour une habilitation, les titres demandés pas encore délivrés (`titresADelivrer`),
  qui quittent l'écran Habilitations et restent à délivrer après un rétablissement ; le tableau de bord marque la
  demande « archivée ».
- **Validité modifiée** (décision de l'entreprise) : les échéances étant calculées à l'affichage, la nouvelle durée (ou les
  nouveaux prérequis et la condition d'aptitude d'une habilitation) vaut aussi pour les titres déjà délivrés. Avant
  l'enregistrement, le dialogue annonce les titres qui deviennent échus (`effetModification`) et demande confirmation ;
  le message de l'action les reprend (la ligne du journal est donc rattachée à leurs titulaires : filtre « salarié »,
  export de leurs données), et les verdicts Go / No Go modifiés partent à Keystone (`changeVerdicts`).
- **Référentiel type** : « Charger le référentiel type » (`referentiel.charger`) reprend, dans un référentiel vide, les
  11 formations, 6 habilitations et 8 destinations de la démonstration (`FORMATIONS`, `HABILITATIONS`, `DESTS` de
  `server/src/seed.ts`), à vérifier ensuite par le service RH ; les habilitations après les formations, leurs prérequis
  (refusé tant que l'une de ces formations manque ou est archivée).
- **Instantanés** : les référentiels, archivés compris, sont transmis à tous les espaces (aucune donnée personnelle) :
  ils nomment les titres de l'historique, et les listes en écartent les archivés (`actifs`).
- Vaccins (`VACCINS`) et règles de visa (`VISA_RULES`) restent dans le code (`shared/constants.ts`) pour cette version.
- **Activités internes** (onglet Activités internes, `pages/ReferentielsActivites.tsx`, `shared/rules/activites.ts`,
  actions `referentiel.activite.*` de `server/src/actions/activites.ts`) : codes hors projet Keystone (`INT-…`, `ECOLE`)
  imputables dans les feuilles de temps, dans la table `projets`, jamais renvoyés à Keystone (`ACTIVITES_INTERNES`).
  Le service RH les crée (code choisi une fois pour toutes), les renomme, les archive et les rétablit ; la lecture seule
  consulte. Les codes de base (INT-PROD, INT-LOG, INT-MAINT, INT-HSE, INT-QUA, INT-ADM, ECOLE, INT-DELEG) sont amorcés
  une fois par base, en production comme en démonstration, par la migration `lot5-temps-activites-internes`
  (`amorcerActivites`, rejouée par le jeu de démonstration) : sans Keystone, les heures internes restent saisissables.

### Postes et exigences (t055)

Table `postes` (intitulé, `formations` et `habilitations` exigées, `archive`), colonne `exigences` des `equipes`
(exigences communes à tous les membres, quel que soit leur poste) et `posteId` des fiches ; règles dans
`shared/rules/exigences.ts`, onglet Postes de l'écran Référentiels (`pages/ReferentielsPostes.tsx`, dialogues
`RefPosteDialog`, `RefEquipeDialog`), tenu par le service RH (le référent HSE et la lecture seule consultent).

- **Exigence manquante** : formation exigée dont le salarié n'a aucune certification, habilitation exigée jamais
  délivrée (un titre seulement demandé ne suffit pas). Elle compte « Non conforme » dans `Domain.enrich` (`EmpX.manquants`,
  `worst`) et donne une échéance `kind: 'exigence'` sans date, classée au jour parmi les dépassées
  (`echeanceExigence`) : « Inscrire à la formation » (ou la session planifiée, la session passée à clôturer),
  « Demander l'habilitation » (`hab.demander` : titre en attente, puis l'action d'un titre demandé : délivrer, ou d'abord
  ses prérequis ; confirmée, car le titre en attente ne se retire pas). Un titre obtenu mais échu reste suivi par sa propre échéance. Formations et habilitations archivées ne
  sont plus exigées ; le filtre « réglementaires uniquement » écarte les formations exigées qui ne le sont pas.
- **Aucune exigence d'office** (décision de l'entreprise) : tant qu'un poste n'en a pas, le statut de ses titulaires ne
  change pas. Le dialogue propose comme point de départ les titres que détiennent déjà tous les titulaires
  (`exigencesProposees`), à valider, et annonce avant l'enregistrement les salariés qui deviennent non conformes
  (`effetExigences`, confirmation).
- **Poste de la fiche** : choisi dans la liste (`components/PosteChoix.tsx`), son intitulé devient celui de la fiche
  (libellé conservé : exports, imports, historique ; un poste renommé est recopié sur les fiches qui portaient son
  ancien intitulé). `rattacherPoste` (`server/src/actions/referentiels.ts`, appelé par `employe.creer` et
  `employe.modifier`) : un intitulé seul est rattaché au poste en vigueur du même nom ; sans `posteId`, ou avec le
  même poste, une fiche qui a un poste en garde le libellé précisé (« Cariste confirmé ») ; sinon le service RH crée le
  poste, sans exigence (« Nouveau poste… »). Le poste se change par le service RH seulement : ses exigences décident
  de la conformité. Le manager ne fait que préciser l'intitulé (`posteId` refusé, poste inchangé). Un poste occupé ne
  s'archive pas.
- **Fiches écrites sans poste** (import ou reprise des salariés, base antérieure) : le statut applique tout de suite les
  exigences du poste en vigueur de même intitulé (`posteDe` de `shared/rules/exigences.ts`) ; `rattacherFiches`
  (`server/src/migrations/referentiels.ts`) les rattache, en créant au besoin le poste sans exigence, à chaque démarrage
  (`server/src/migrate.ts`). Note de fusion pour la reprise depuis Lucca (chantier 2, étape 2, `ecrire` de
  `server/src/actions/reprise.ts`) : appeler `rattacherFiches(ctx.db)` à la fin de l'écriture des salariés, et ne pas
  remettre `posteId` à null sur une fiche mise à jour qui en a un (ne pas le recopier de `normaliserProfil`).
- **Reprise** : la migration nommée `lot4-referentiels-postes` crée un poste par intitulé déjà saisi (casse, accents et
  ponctuation ignorés, variantes réunies sous la plus fréquente, à égalité une forme qui n'est pas tout en capitales)
  et y rattache les fiches, sans exigence ni changement de leur libellé ; tracée (`migration.postes` : identifiants et
  nombres de fiches, jamais d'intitulé). La démonstration en déclare quelques-unes (cariste, technicien de maintenance,
  apprenti électromécanicien, SST de la Logistique).
- **Données transmises** : postes et exigences des équipes à tous les espaces (aucune donnée personnelle) ; le profil
  paie, qui ne reçoit ni certifications ni habilitations, les reçoit sans exigences (`sansExigences` de
  `server/src/dataset.ts`), sans quoi tout le monde y serait non conforme.
- **Écrans** : colonne « Exigences » et section « Exigences du poste » de Collaborateurs (`components/Exigences.tsx`),
  filtre « Exigences » des Échéances, indicateur « Exigences manquantes » du tableau de bord (celui des expirées n'en
  compte ni les échéances ni les salariés), motif et demandes de l'espace collaborateur (`ExigencesPortail`).

### Sécurité au poste (lot 6, chantier 4, étape 1)

- **Postes à risques particuliers et formation renforcée (t061, `shared/rules/formation-renforcee.ts`)** : case
  `Poste.risquesL4154` (« Liste des postes à risques particuliers (art. L4154-2) », colonne `risques_l4154` de `postes`,
  décochée par défaut), distincte de `sir` et `expose` ; les postes en suivi renforcé, exposés ou qui exigent une
  habilitation SIR ou ATEX sont signalés « à examiner » (`raisonsDExaminer`), jamais cochés d'office. Formation exigée :
  réglage `formationRenforceeCode` (Paramètres → Postes à risques particuliers, `pages/parametres/PostesRisques.tsx`), vide
  par défaut : aucune exigence et l'avertissement `avertissementRenforcee` (Paramètres, Référentiels, dialogue du poste).
  `exigencesDe` ajoute pour un CDD, un intérimaire ou un alternant (`CONTRATS_RENFORCEE`) titulaire d'un poste coché
  l'exigence `renforcee` d'origine « contrat … sur poste à risques », satisfaite seulement par une certification obtenue
  depuis l'entrée (`depuis`), même hors du filtre « réglementaires uniquement » : « Non conforme », échéance
  « Formation renforcée non suivie », action « Inscrire à la formation », récapitulatif. Go / No Go : `motifRenforcee`,
  No Go sous le code `CERTIFICATION` (contrat de l'API v1 inchangé), réserve si une session est planifiée avant le
  démarrage. Liste imprimable (`client/src/postes-risques.ts`, « Imprimer la liste des postes à risques », sans nom de
  salarié). Profil paie : case retirée avec les exigences (`sansExigences`).
- **Couverture minimale des équipes (t067, `shared/rules/couverture.ts`)** : `Equipe.couverture` ([{ formation, min }],
  colonne JSON de `equipes`), saisie avec les exigences de l'équipe (`RefEquipeDialog`, `server/src/actions/couverture.ts`),
  aucun seuil par défaut (« Proposer 1 SST au minimum », recommandation INRS en aide ; une équipe par quart en équipes
  successives). `etatsCouverture` compte chaque jour, d'aujourd'hui à l'horizon d'alerte, les membres entrés, pas sortis,
  sans absence validée ou signalée, titulaires d'une certification valide ; premier jour sous le minimum (`manque` : date,
  nombre, dernier jour du manque, causes : expiration, sortie, absence, titulaires trop peu nombreux). Calculé par le
  serveur (`Dataset.couverture`, `server/src/dataset.ts`) : service RH, lecture seule et référent HSE toutes les équipes ;
  manager, ses équipes ; collaborateur et paie, rien (paie : seuils retirés). Le référent HSE, qui ne reçoit que les
  absences des ressources des chantiers, a sa couverture calculée avec celles-là seules (`couvertureVueHse`,
  `sansAbsences`, « couverture à vérifier avec le service RH ») : un manque daté par une autre absence lui désignerait,
  par élimination parmi les titulaires dont il voit les certifications, l'absent et ses dates. Un seuil déjà enregistré
  que l'effectif présent ne permet plus d'atteindre reste valable (pas de plafond pour une ligne inchangée). Affichage : `components/Couverture.tsx` (tableau de bord, Équipes & managers,
  Échéances filtre « Couverture », équipe du manager, cellule de Référentiels → Postes). Récapitulatif : relance
  `couverture` (`relancesCouverture`, clé `couverture:<équipe>:<formation>:<date>`, `empId` 0, `equipe`) : manque à
  venir relancé par paliers sous sa date ; déjà là, comme échu sous la date de son début (`debutManque` : lendemain de
  l'expiration ou de la sortie, premier jour de l'absence ; `en-cours` sans cause datée), stable d'un jour à l'autre ; au
  service RH et au manager de l'équipe ; au référent HSE, la couverture de sa vue, sous des clés `hse:couverture:…`. Hors de `Domain.echeances`, dont chaque ligne désigne un salarié.
- **Entretien de mi-carrière (t069, `shared/rules/entretien-mi-carriere.ts`)** : une visite `mi_carriere` réalisée rend
  dû un entretien de parcours (`epp`, libellé « Entretien de parcours de mi-carrière ») `entretienMiCarriereMois` après
  elle (2 par défaut, 1 à 12, Paramètres → Entretien de mi-carrière, bandeau « délai à confirmer juridiquement »,
  `entretienMiCarriereActif`) ; plus proche que l'échéance périodique, il l'avance dans `obligations()` ; un entretien de
  parcours réalisé depuis la visite le remplit. Manager et lecture seule : `Employe.entretienMiCarriere`, échéance seule
  calculée par le serveur, sans la visite ; ailleurs (service RH, intéressé) calculé sur l'instantané.
- **Aucune migration nommée** : colonnes nouvelles déclarées dans `TABLES` (vides : décoché, aucun seuil), réglages par
  défaut de `REGLAGES` ; aucune action nouvelle (paramètres ajoutés à `referentiel.poste.enregistrer` et
  `referentiel.equipe.exigences`, journal complété). Démonstration : 4 SST au minimum en Production.

### Compte professionnel de prévention (lot 7, chantier B, étape 1 : t052)

Règle pure `shared/rules/c2p.ts`, actions `server/src/actions/c2p.ts`, écran Expositions (C2P) (`pages/Prevention.tsx`,
vue `prevention`, groupe « Prévention » du menu), colonnes des onglets Postes et Horaires de Référentiels.

- **Nuits** : un jour de feuille **validée** compte une nuit quand l'horaire figé ce jour-là (`horairesFiges`) donne au moins
  1 h de travail entre 0 h et 5 h (`heuresC2p` : `heuresDeNuit` de `repos-nuit.ts` sur la plage `C2P_PLAGE`, la pause
  placée hors de la plage tant qu'elle y tient et retirée seulement pour la part qui n'y tient pas — un poste 20 h – 1 h
  avec 30 min de pause compte donc 1 h —, rattachée au jour où commence le poste ; `repos-nuit.ts` n'est pas modifié). Une nuit faite sous un horaire qualifié
  « équipes successives alternantes » (`Horaire.alternant`, colonne JSON : vrai, faux, null « à qualifier ») compte au seuil
  de 50 nuits, les autres au seuil de 120, sans double compte ; la qualification est lue au référentiel (le roulement n'est
  pas figé avec les heures). Un horaire de nuit non qualifié compte au travail de nuit et il est listé « à qualifier »
  (`horairesAQualifier` : en vigueur et de nuit à sa durée nominale, ou utilisé par une nuit de l'année). Une feuille sans
  horaire ne compte aucune nuit (« semaines sans horaire » signalées) ; une feuille non validée ne compte pas encore.
- **Seuils réglementaires** (art. D4163-2) en constantes non réglables (`C2P_SEUIL_NUIT` 120, `C2P_SEUIL_ALTERNANT` 50,
  plage 0 h – 5 h) : un accord ne les modifie pas. Au prorata de la période du contrat dans l'année (jours de la période sur
  jours de l'année, au centième) ; un contrat de moins d'un mois (`contratMoinsDUnMois`) n'est pas déclaré ; un intérimaire
  est déclaré par l'entreprise de travail temporaire (ligne « à lui transmettre », hors de l'export).
- **Facteurs du poste** (`Poste.c2p`, colonne JSON) : travail répétitif, milieu hyperbare, températures extrêmes, bruit,
  cochés par le service RH ou le référent HSE (`referentiel.poste.expositions`, dialogue `RefPosteC2pDialog`) quand les
  titulaires y sont exposés au-delà du seuil après protections ; décochés par défaut. Exposition d'un salarié = poste
  occupé (`posteDe`) × sa période dans l'année. `referentiel.poste.enregistrer` n'y touche pas.
- **Codes** (`FACTEURS_C2P` de `shared/constants.ts`) : libellé, code interne (`C2P-NUIT`, `C2P-ESA`, `C2P-REP`, `C2P-HYP`,
  `C2P-TEMP`, `C2P-BRUIT`), code DSN présumé du facteur (S21.G00.34.001 : 08, 09, 10, 05, 06, 07), à confirmer par la paie,
  seuil cité. Export CSV `exportC2p` (« Exporter pour la DSN (CSV) », `downloadCsv`, tracé avec son nombre de lignes) : une
  ligne par salarié déclaré par l'employeur et par facteur exposé, matricule de paie, période, nuits et seuil, mention
  « À saisir dans la DSN — codes de facteur à confirmer par la paie ». Aucune rubrique du fichier d'import Sage.
- **Données transmises** (`server/src/dataset.ts`) : `Dataset.c2p` (année en cours et précédente, `syntheseC2p` sur toutes les
  feuilles validées) au service RH, au référent HSE (qui ne reçoit pas les feuilles) et à la lecture seule ; ni au manager,
  ni au collaborateur, ni à la paie, à qui les facteurs des postes sont aussi retirés (`sansC2p`). `Horaire.alternant` est
  transmis à tous (aucune donnée personnelle).
- **Base** : colonnes déclarées dans `TABLES`, vides par défaut (rien coché d'office, horaires d'exemple compris) ; migration
  nommée `lot7-prevention-c2p` (rien à reprendre ; exécutée sans effet sur une base neuve, notée faite ailleurs) ;
  PostgreSQL : `0006_prevention.sql`.

### Passeport de prévention (lot 7, chantier B, étape 2 : t066)

Règle pure `shared/rules/passeport-prevention.ts`, actions `server/src/actions/passeport-prevention.ts`, export
`server/src/passeport-prevention.ts`, panneau « Passeport de prévention » de l'écran Formations
(`components/PasseportPrevention.tsx`, dialogue `PasseportDeclarerDialog`), section de Paramètres
(`pages/parametres/PasseportPrevention.tsx`). Le format d'import de la plateforme (Caisse des dépôts) côté employeur et son
calendrier d'ouverture ne sont pas connus : seuls le marquage et le suivi « déclarée le », qui n'en dépendent pas, sont
définitifs ; l'export est un gabarit réglable portant la mention `MENTION_PASSEPORT` (« format à confirmer »).

- **Marquage** : `Formation.passeportPrevention` (colonne booléenne `passeport_prevention`), case du dialogue
  `RefFormationDialog` (`referentiel.formation.enregistrer`, journal avant et après ; absente de la saisie : inchangée ;
  décochée à la création, l'aide la propose pour une formation santé-sécurité, `passeportPropose`), étiquette dans l'onglet
  Formations de Référentiels. Migration nommée `lot7-prevention-passeport` (et `0009` en PostgreSQL) : coche, en SQL figé,
  les formations du catalogue reconnues santé-sécurité sur le code, le nom court ou l'intitulé (SST, CACES, ATEX,
  électrique, AIPR, EPI incendie, travail en hauteur, PRAP ; ni FCO ni RGPD), tracée `migration.passeportPrevention`
  (codes) ; le référentiel type et la démonstration portent la case. Aucune case sur les habilitations : la plateforme
  recense des formations, les titres d'habilitation n'y sont pas déclarés tant que le format ne le prévoit pas.
- **Lignes** (`lignesPasseport`) : certifications obtenues et formations suivies, non annulées, des formations marquées,
  dont le dernier jour tombe dans la période (année civile à l'écran) ; une formation suivie que représente une
  certification (`suivieCertifiee`) n'est comptée qu'une fois ; dossiers anonymisés écartés ; intérimaire signalé (la
  déclaration revient en principe à l'agence). Une certification est toujours datée de son obtention : du, au et heures
  de la session seulement pour celle qu'une session clôturée a produite (participation qui la porte, `certId` posé par
  `session.cloturer`, et fin de session égale à l'obtention) ; sinon le jour d'obtention et la durée du catalogue.
  `Certification.sessionId` (recyclage où elle est inscrite) ne date jamais une ligne : une certification inscrite à un
  recyclage à venir garde sa date, et rien n'est proposé pour une session non clôturée. Résultat « Acquise (évaluation
  réussie) », « Acquise (présence) » ou « Formation suivie ».
- **Suivi « déclarée le »** : table `declarationsPasseport` (salarié, `certId` ou `suivieId`, uniques, jour de la
  déclaration, jour et auteur de la marque), écrite par `passeport.declarer`, retirée par `passeport.retirer`. Une ligne
  déclarée n'est plus proposée ni exportée (sauf « Déjà déclarées »). Le dialogue « Marquer déclarées… » fait cocher les
  lignes une à une : seules celles du dernier export fait depuis l'écran (clés renvoyées par le serveur) le sont d'office ;
  une ligne saisie depuis l'export, ou refusée par la plateforme, reste à déclarer ; sans export connu (écran rechargé),
  rien n'est coché. Correction ou annulation d'une certification ou d'une
  formation suivie déclarée : le message rappelle de la corriger aussi sur la plateforme (`rappelDeclaration`). Références
  dans `REFERENCES` (`integrite.ts`) et `TRAITEMENTS` (conservation : lignes gardées, auteur balayé) ; section de la copie
  des données, sans l'auteur pour l'intéressé.
- **Export** : `GET /api/formations/passeport-prevention?du=&au=[&vue=a-declarer|declarees]` (droit `formations` : service RH et
  référent HSE ; lecture seule et paie : 403 tracé), produit par le serveur, qui lit la date de naissance que l'instantané du
  référent HSE ne porte jamais ; colonnes du réglage `passeportColonnes` (Paramètres → Passeport de prévention,
  administrateur RH, au moins une ; par défaut nom, prénom — premier mot du nom de la fiche —, date de naissance, matricule de
  paie, intitulé, organisme, du, au, durée, résultat ; NIR et code de la formation facultatifs), dans l'ordre du gabarit,
  puis la mention. Le NIR n'est pas dans Cursus (colonne toujours vide : rapprochement par le matricule dans Sage). Vue
  `a-declarer` (par défaut) : lignes sans marque, intérimaires écartés (déclarés en principe par l'agence, comme au C2P) ;
  `declarees` : lignes marquées seules, comme à l'écran. En-têtes de la réponse : `X-Passeport-Nombre` (lignes du
  fichier), `X-Passeport-Interimaires` (écartés), `X-Passeport-Lignes` (clés des lignes à déclarer exportées, omis
  au-delà de 6 000 caractères). Tracé `passeport.exporter` : période, vue, nombre de lignes, intérimaires écartés,
  salariés concernés, jamais d'intitulé ni de nom.
- **Données transmises** : `Dataset.declarationsPasseport` au service RH ; sans l'auteur au référent HSE et à la lecture
  seule (avec les certifications) ; rien au manager, au collaborateur ni à la paie. La case du catalogue va à tous (aucune
  donnée personnelle).

### Formations suivies, titres d'habilitation et heures (lot 6, chantier 4, étape 2)

- **Formations suivies (t116, `shared/rules/formations-suivies.ts`, `server/src/actions/formations-suivies.ts`)** : table
  `formationsSuivies` (salarié, formation du catalogue `f` ou intitulé hors catalogue `libelle`, du, au, durée en heures,
  organisme, `obligatoire`, origine `saisie`/`plan`/`demande`/`session`, `planActionId`, `demandeId`, auteur ; correction et
  annulation motivées comme les certifications). Une formation hors catalogue est « non obligatoire » par défaut, case
  modifiable. Sources : saisie directe (fiche, service RH et référent HSE), bénéficiaires d'une action du plan réalisée
  (`plan.avancer`, `PlanRealiserDialog`, membres de l'équipe cochés, demandeur coché d'office), demande hors catalogue
  acceptée à clore (« Enregistrer la formation suivie », `demandesAClore` ; la ligne du plan créée par l'acceptation, encore
  prévue ou engagée, est signalée « à passer réalisée »). `origine: 'session'` est réservée : une session du catalogue
  produit des certifications. Une action du plan d'une formation du catalogue réalisée sans session crée des formations
  suivies ; la certification se saisit en plus (conformité) et, obtenue du premier jour au dernier plus 7 jours, représente
  seule la formation au passeport et dans les indicateurs (`suivieCertifiee`, `suiviesHorsCertifications` : pas de double
  compte). Une demande dont la formation suivie est enregistrée ne se rouvre plus (`demande.reouvrir`, 400) : supprimer
  d'abord la formation suivie saisie par erreur. Journal de `plan.avancer` : bénéficiaires réellement enregistrés
  (`result.beneficiaires`), jamais ceux seulement envoyés. Bilan à 8 ans (`obligations()`, `formationNonObligatoireDepuis`) : une
  certification non « Réglementaire » ou une formation suivie non obligatoire terminée depuis 8 ans évite le risque
  d'abondement correctif (art. L6323-13). Vues (`server/src/dataset.ts`) : service RH tout (annulées comprises) ; référent
  HSE, lecture seule, manager (son équipe) et intéressé : en vigueur, sans motif ni auteur ; paie : rien. Fiche
  (`components/FormationsSuivies.tsx`), portail (« Mes formations suivies »), passeport, export CSV (Plan & budget), copie
  des données (section « Formations suivies », sans l'auteur pour le salarié). Pas de reprise des historiques existants
  (réponse « pas encore tranché ») : saisie manuelle, ou plus tard un import CSV de reprise sur le modèle de
  `shared/rules/reprise.ts`.
- **Délivrances d'habilitation (t115, `server/src/delivrances.ts`)** : table `habDelivrances`, une ligne par délivrance et
  par renouvellement (date, signataire `par`, échéance calculée à la délivrance, auteur) ; `habTitres` reste le titre en
  vigueur (Go / No Go, mesures, pièces). Au renouvellement (`hab.delivrer`, reprise depuis Lucca), la délivrance précédente
  est close (`remplaceeLe`) avec la mesure en cours figée (suspension ou retrait, date ; jamais le motif) ; un titre
  délivré avant l'historique y est inscrit au moment où il est remplacé. Migration `lot6-securite-hab-delivrances`
  (`delivrancesDepuisTitres`, aussi pour la démonstration) : délivrance en vigueur de chaque titre délivré, tracée
  `migration.habDelivrances` ; les délivrances écrasées avant le lot 6 sont perdues. Fiche et passeport : « Habilitations
  antérieures ». Vues : celles des habilitations, sans l'auteur hors du service RH ; paie : rien.
- **Titre d'habilitation imprimé (`client/src/titre-habilitation.ts`)** : modèle au référentiel (`HabType.modele` :
  `electrique` NF C18-510, `conduite` art. R4323-56 / R489 / R486, `generique` par défaut ; démonstration : électrique et
  autorisations de conduite), choisi dans `RefHabilitationDialog`. Titulaire (nom, fonction, équipe), intitulé, précision
  (symboles et domaine de tension, catégories), délivrance et validité, prérequis vérifiés (certification valide à la date
  de délivrance) et aptitude médicale « vérifiée » si la visite est en cours de validité (jamais l'avis ni les
  restrictions), mentions du modèle, signatures de l'employeur (`par`) et du titulaire. Imprimé depuis la fiche (« Imprimer
  le titre », service RH et référent HSE ; seulement un titre en vigueur, `titreImprimable` : jamais retiré, suspendu, échu
  ou aux prérequis manquants) ou aussitôt après la délivrance (`HabDialog`, case cochée par défaut) ; impression tracée (`POST /api/exports`). Modèles à faire valider par le référent HSE.
- **Passeport formation (`client/src/passeport.ts`)** : sections communes à la fiche et au portail (« Imprimer mon passeport
  formation ») : certifications en vigueur et remplacées, habilitations, habilitations antérieures, formations suivies ;
  impression tracée au journal, rattachée au salarié (le collaborateur sur son propre périmètre).
- **Durée en heures et indicateurs (t122, `shared/rules/heures-formation.ts`)** : `Formation.dureeHeures` (colonne
  `duree_heures`), facultative, extraite du texte de la durée quand il en donne une seule (migration
  `lot6-securite-duree-heures`, `dureeHeuresDe` : « 21 h », « 7 h (MAC) » ; « 2 jours », « 7 h + 7 h », « 2 x 7 h » ou
  « 7 h par jour sur 3 jours » restent vides, jamais d'estimation), saisie dans
  `RefFormationDialog`. Heures d'une participation présente : horaires de la session (`heuresSession`), sinon la durée du
  catalogue ; formation suivie : sa durée, sinon celle du catalogue ; sans l'une ni l'autre, « durée inconnue », signalée.
  `indicateursFormation(d, exercice)` (année civile) : participations présentes aux sessions clôturées, certifications sans
  session, formations suivies ; stagiaires, formations et heures par catégorie (`FormationType` ou « Hors catalogue »), par
  équipe et par statut ; actions du plan hors reportées, réalisées, taux de réalisation, coûts prévu et réalisé. Panneau
  « Indicateurs de formation » de Plan & budget (`components/IndicateursFormation.tsx`), exports CSV des indicateurs et des
  formations suivies de l'exercice (`client/src/formations-csv.ts`) ; `csvPlan` gagne « Catégorie » et « Durée (h) ».
  Indicateurs BDESE seulement (environ 100 salariés : pas de bilan social).
- **Intégrité et cascade** : `REFERENCES` (`server/src/integrite.ts`) reçoit `emp_id` et `auteur_id` des deux tables, le
  titre, l'habilitation, la formation, la ligne du plan et la demande.

## Santé au travail

Règles dans `shared/rules/sante.ts` et `Domain.medInfo` (`shared/domain.ts`), actions dans `server/src/actions/sante.ts`.

- **Aptitude** : valide jusqu'à l'échéance de la prochaine visite (`Domain.medInfo`, `shared/rules/suivi-medical.ts`, voir
  « Suivi médical » ci-dessous), sauf avis d'inaptitude. Elle compte dans le statut
  du collaborateur (`EmpX.worst`, même sans habilitation qui l'exige) et dans les échéances (type « Visite médicale » : échue,
  à renouveler sous l'horizon d'alerte, jamais enregistrée — sans date, parmi les dépassées —, avis d'inaptitude ; action
  « Demander la visite »). Une visite saisie avant l'enregistrement des avis (colonne `avis` vide) vaut avis apte.
- **Suivi médical (t059)** : type de suivi de chaque salarié — suivi individuel renforcé (SIR) déduit d'une habilitation
  détenue ou demandée (titre non retiré) ou du poste cochés « suivi individuel renforcé » au référentiel (`HabType.sir`,
  `Poste.sir`, cases décochées par défaut, art. R4624-23), qui prime ; sinon le type saisi sur la fiche par le service RH
  (`medical.suivi`, `Employe.suivi` : VIP, VIP adaptée, SIR) ; sinon VIP (`suiviDe`). Échéance (`echeanceVisite`) : la date
  de la prochaine visite fixée par le médecin, saisie avec l'avis (`Employe.prochaineVisite`, remise à zéro par chaque avis
  et par une visite reprise de Lucca), prime toujours ; sinon la périodicité de Paramètres → Santé (`santeVipMois`,
  `santeVipAdapteeMois`, `santeSirIntermediaireMois`, `santeSirAptitudeMois` : 24, 24, 24 et 48 mois par défaut, bornés
  aux maximums légaux R4624-16, R4624-17 et R4624-28). Suivi renforcé : la plus proche de la visite intermédiaire (dernière
  visite + périodicité intermédiaire) et du renouvellement de l'examen d'aptitude (dernier examen, `Employe.examenAptitude`,
  daté par un avis coché « examen médical d'aptitude », + périodicité de l'examen). Suivi renforcé sans examen enregistré :
  `MedInfo.examenRequis`, l'aptitude en cours reste valide mais passe « à renouveler », avec l'échéance sans date
  « Examen d’aptitude requis » (`EXAMEN_REQUIS`, à programmer, relancée comme échue, clé `med:<id>:examen`), en plus de
  l'échéance datée de l'aptitude et de ses relances par paliers ; aucun motif Go / No Go. Dans le dialogue d'avis, la case
  « examen médical d'aptitude » n'est cochée par défaut que si l'examen est attendu (`examenAttendu` : jamais enregistré, ou
  renouvellement plus proche que la visite intermédiaire), pour qu'une visite intermédiaire ne redate pas l'examen. Le texte de l'aptitude précise l'origine de l'échéance hors du cas courant (VIP à la périodicité réglée).
  Aucune migration nommée : les colonnes nouvelles (`TABLES`) sont vides sur une base existante, ce qui vaut VIP à
  24 mois, l'échéance d'avant.
- **Visites dues (t060)** : `visitesDues` (`shared/rules/visites-dues.ts`, `MedInfo.dues`), visites qu'un événement rend
  obligatoires, datées, dans les échéances (type « Visite médicale », `EchItem.motifVisite` ; « À programmer » sous
  l'horizon d'alerte, « Dépassée » ensuite), le récapitulatif (clé `med:<id>:<motif>:<échéance>`, libellé neutre
  « Visite médicale à programmer ») et l'action « Demander la visite », qui propose leur motif (`motifParDefaut`, motifs
  `mi_carriere` et `fin_carriere` ajoutés à `MOTIFS_VISITE`). Embauche (art. R4624-10) : 3 mois après l'entrée, le jour
  de l'entrée en suivi renforcé (art. R4624-24) ou pour un mineur à l'entrée (art. R4624-18, `mineurAu`) ; close par une
  visite enregistrée depuis l'entrée ; une visite des 5 ans qui la précèdent (2 ans en suivi renforcé, jamais pour un
  mineur ni avec un avis d'inaptitude) en dispense (art. R4624-15 et R4624-27) ; suivie pour une entrée des 2 dernières
  années, et, sans aucune visite, elle remplace « Visite médicale non renseignée ». Reprise (art. R4624-31, seuils de la
  loi, non réglables) : après tout congé de maternité et toute maladie professionnelle, 30 jours d'accident du travail,
  60 jours de maladie, d'arrêt longue maladie ou d'accident de trajet ; absences validées seulement, arrêts jointifs
  réunis, les jours comptés par catégorie (maternité, maladie professionnelle, accident du travail, non professionnel :
  5 jours d'AT prolongés par 25 jours de maladie n'ouvrent rien) ; le dernier arrêt qui l'ouvre, échéance au premier jour ouvré
  qui suit (`lendemainOuvre`), close par une visite postérieure à sa fin. Mi-carrière (art. L4624-2-2) : 31 décembre de
  l'année de l'âge réglé (Paramètres → Santé, `santeMiCarriereAge`, 45 ans par défaut, 40 à 55), à partir de 2022, suivie
  l'année même et la suivante ; fin de carrière ou post-exposition (art. L4624-2-1, R4624-28-1) : sortie enregistrée
  (sauf décès) d'un salarié en suivi renforcé ou exposé à des risques particuliers (case du poste, `Poste.expose`,
  Référentiels → Postes, ou de la fiche, `Employe.expose`, `medical.suivi`), échéance le dernier jour du contrat. Ces deux
  dernières ne sont closes que par une visite de leur motif, datée de la visite : demande de ce motif close par l'avis
  (`medical.avis` clôt la demande de son `motif` même faite après la visite), ou avis saisi avec ce motif sans demande
  (convocation directe, visite passée avant la mise en service : ligne `realisee` de `demandesVisite`, datée de la
  visite) ; une visite périodique ne les remplace pas. Une demande en cours les affiche comme planifiées. Dialogue de sortie (`texteVisiteSortie`) :
  visite à demander avant le départ, ou, sans case cochée, rappel « vérifier si une visite post-exposition est due » pour
  une habilitation cochée SIR ou ATEX détenue ou exigée par le poste ; jamais un blocage, rien au message ni au journal de
  `employe.sortie`. Limite : le travail de nuit (visite préalable, art. R4624-18) n'est pas connu de la fiche. Aucune
  migration nommée (colonnes `expose` déclarées dans `TABLES`, motifs en texte).
- **Avis du médecin du travail** (`medical.avis`) : date de la visite, avis (apte, apte avec restrictions ou aménagements de
  poste, inapte) et restrictions recopiées telles qu'écrites, chacune jusqu'à une date ou sans terme (`Employe.avis`,
  `Employe.restrictions`, contrôlés par `controlerAvis`, partagé avec le dialogue). Dans la même écriture, le service RH
  suspend les habilitations incompatibles — motif `MOTIF_RESTRICTION` (« Restriction d’aptitude »), sans détail, daté du
  jour de la décision — et lève celles d'un avis précédent. Inapte : les habilitations qui exigent l'aptitude sont non valides
  d'office (prérequis). Une visite ne se saisit plus dans la fiche (`employe.modifier` refuse de changer `visite`) ; la
  création d'une fiche peut porter la dernière visite (avis apte).
- **Demandes de visite** (table `demandesVisite`, `medical.demander`) : motif, date, auteur ; une seule en cours par
  collaborateur. Elle part par e-mail au service de prévention et de santé au travail (`transmettreDemandeVisite`,
  adresse de Paramètres → Messagerie), dans la transaction de la demande, et s'imprime aussi (identité, poste, motif,
  habilitations qui exigent l'aptitude, aucune donnée médicale) ; sans adresse, le service RH transmet l'imprimé. Tant
  qu'elle est en cours, « Visite demandée le … » remplace l'action « Demander une visite médicale » : dans les échéances
  (visite et habilitations qui en dépendent, affichées comme planifiées) et sur les habilitations (`Domain.habAction`, qui
  ouvre la demande en cours : impression, annulation). La saisie d'une visite datée du jour de la demande ou après la
  clôt (`realisee`) ; le service RH peut l'annuler (`medical.annuler`).
- **Confidentialité** : dates de visite, avis daté, demandes et suivi médical (type, prochaine visite, examen d'aptitude :
  `suivi`, `prochaineVisite`, `examenAptitude`, `expose` vidés par `server/src/dataset.ts` ; visites dues : le manager et les
  profils restreints ne reçoivent que `aptitude.aProgrammer`, « visite à programmer » sans motif ni date, calculé par le
  serveur (`visiteAProgrammer` : visite d'embauche, de mi-carrière ou de fin de carrière échue ou sous l'horizon d'alerte ;
  jamais la visite de reprise, qui, rapprochée des dates d'absence et des seuils connus de l'art. R4624-31, trahirait une
  maladie professionnelle ou une maternité : le service RH la suit seul, comme l'entretien de reprise) ; au journal, `medical.suivi` ne retient
  que `empId`, et le message, qui nomme le type, est masqué aux lecteurs hors service RH (`ACTIONS_SANTE`) ; absents de la
  demande de visite ; dans la fiche de l'export RGPD) sont réservés au service RH et à l'intéressé. Le manager reçoit
  `aptitude` (`aptitudeVueManager` : aptitude valide ou non, avis, restrictions en vigueur), aucune échéance datée ; Keystone,
  le seul code `APTITUDE`, selon l'état du jour, avec un libellé neutre en partage détaillé (voir Go / No Go).

## Sessions de formation

Règles dans `shared/rules/sessions.ts` (inscrits nominatifs, contrôles, liste pour l'organisme), actions dans
`server/src/actions/sessions.ts`.

- **Cycle de vie** : « À confirmer » → « Confirmée » → « Clôturée », ou « Annulée ». Une session ouverte (ni
  clôturée ni annulée, `sessionActive`) dont la date est passée s'affiche « Session passée — à clôturer »
  (`Domain.sessionStatut`, `Domain.aCloturer`) : tableau de bord, Formations, échéances, fiche collaborateur.
  Ses inscrits ne comptent plus comme planifiés (`CertInfo.session` ne désigne qu'une session à venir,
  `CertInfo.sessionPassee` la session passée) et le Go / No Go ne donne plus « Go sous réserve » sur sa foi.
- **Inscrits** : certifications rattachées (`sessionId`, recyclage) et inscriptions en formation initiale.
  Leur nombre (`Session.inscrits`) n'est jamais stocké : il est calculé au chargement (`avecInscrits`, sur
  toutes les données avant la restriction au périmètre) ; l'ancienne colonne `inscrits` d'une base
  existante n'est plus lue. Après la clôture, il compte les résultats enregistrés ; une session annulée n'en a aucun.
  Un inscrit d'une session passée, pas encore clôturée, n'en sort que par la clôture : `plan.inscrire` et
  `demande.accepter` refusent de le déplacer, la fiche propose « Clôturer la session » (RH) plutôt que de replanifier.
- **Création** : date postérieure à aujourd'hui, places entières ; l'action du plan indiquée existe, porte la
  même formation et est « prévue » : elle passe « engagée » et reste rattachée (`planId`).
- **Confirmer** : le RH transmet la liste nominative à l'organisme (affichage, export CSV : nom, poste,
  parcours, date de la certification à renouveler) ; l'organisme n'a pas encore d'adresse dans Cursus.
- **Convocations** : « Envoyer maintenant » (`plan.inscrire`) ou « Envoyer la convocation » (`convocation.envoyer`,
  unitaire ou groupé, pour les convocations « à envoyer ») : e-mail avec un fichier `.ics` (journées entières, ou créneaux horaires : voir « Plusieurs jours »,
  `UID` stable par session et salarié : un renvoi met à jour l'événement), date d'envoi `convocLe` sur la
  certification ou l'inscription. Sans adresse e-mail, la convocation est notée envoyée, à remettre en main propre.
  Le `.ics` porte l'organisateur (boîte d'envoi, sinon celle du service RH) et, pour une session « à confirmer »,
  le statut provisoire (`TENTATIVE`). « Désinscrire » (`plan.desinscrire`) libère la place. Une convocation reçue
  (`convocationEnvoyee` : « envoyée », ou remise « à renvoyer » avec sa date `convocLe`) est annulée par e-mail
  (`.ics` d'annulation, même `UID`) dès que la personne quitte une session à venir : désinscription, changement
  de session (`plan.inscrire`, `demande.accepter`), recyclage enregistré avant la session (`cert.ajouter`), place
  libérée par une nouvelle date (`session.modifier`), annulation de la session.
  **Modifier** : date, lieu, places (au moins les inscrits). Une session à venir garde une date future ; un
  changement de date ou de lieu repasse les convocations envoyées « à envoyer », et une nouvelle date repasse
  une session confirmée « à confirmer ». Une session passée, à clôturer, se redate au jour où elle a eu lieu
  (la clôture date les certifications de ce jour). Une nouvelle date postérieure à un recyclage déjà enregistré
  libère la place de la certification remplacée (`placesRemplacees`). **Annuler** : les certifications rattachées redeviennent à planifier,
  les inscriptions en formation initiale restent attachées à la session annulée, à replanifier
  (`plan.inscrire` avec `inscriptionId`) ; l'action du plan engagée (sans autre session ouverte) redevient « prévue ».
- **Clôture** (RH, à partir du jour de la session, du dernier jour pour une session de plusieurs jours) : chaque formation du catalogue porte son mode de
  validation (`Formation.validation` : `presence` ou `evaluation`). Pour chaque inscrit, présent / absent
  et, si l'évaluation est exigée, réussie / échouée, choisis explicitement (aucune valeur par défaut : la clôture
  est définitive). Présent (et reçu) : certification datée du jour de la
  session (de son dernier jour), la certification renouvelée passe en historique ; absent ou échec : recyclage de nouveau à
  planifier, formation initiale à replanifier. Un recyclage déjà saisi depuis (`cert.ajouter` daté du jour de la
  session ou après) n'appelle aucune décision. Les résultats sont conservés (table `participations`, restreinte
  au périmètre comme les inscriptions), l'action du plan rattachée passe « réalisée » si aucune autre session
  ouverte ne la porte, l'évaluation à chaud (note sur 5, commentaire) est facultative. Une seule transaction,
  tracée au journal. Le bilan (`Session.bilan` : évaluation à chaud, motif d'annulation, textes libres parfois
  nominatifs) n'est transmis qu'au service RH ; les autres n'en reçoivent que la date (`le`, sans auteur : départ de la
  demande d'avis à chaud, t121).
- **Plusieurs jours** (t118, `shared/rules/plage-session.ts`) : `date` reste le premier jour (lu tel quel partout où
  un seul jour suffit), `fin` le dernier, `jours` les jours de la session (ouvrés par défaut entre les deux, premier et
  dernier compris, modifiables ; 20 au plus sur 92 jours), `horaires` aucun (journées entières), un seul pour tous les
  jours ou un par jour (début, fin, pause en minutes). Contrôle commun au dialogue et au serveur (`controlePlage`,
  appelé par `controleSession`). Seuls dépendent de la plage : les conflits (`conflitsSession` : chacun des jours, pas le
  week-end entre deux ; `sessionChevauche` pour les autres engagements), le contrat (aucun jour après le dernier jour du
  contrat), le `.ics` (journées entières jusqu'au dernier jour ; avec horaires, créneaux à l'heure de Paris : `RRULE`
  quotidienne, `EXDATE` des jours sautés, `RECURRENCE-ID` d'un jour à un autre horaire, un seul UID), la clôture (à
  partir du dernier jour ; certifications datées du dernier jour), l'état « passée » (`Domain.aCloturer`,
  `sessionStatut`, `certInfo`, `etatInscription` : après le dernier jour) et l'affichage (`plageCourte`, `plageTexte`,
  `sessionDu`, `joursTexte`). Une session commencée ne reçoit plus d'inscrit et ne perd plus les siens avant la clôture ;
  du deuxième au dernier jour, ni « à venir » ni « à clôturer », elle est listée « en cours » (`Domain.enCours` : page
  Formations ; tableau de bord le dernier jour, avec la clôture). Changer la plage d'une session pas encore finie
  repasse les convocations envoyées « à envoyer » (renvoi possible jusqu'au dernier jour) et, avant le premier jour,
  une session confirmée « à confirmer » ; changer les horaires repasse seulement les convocations. Le journal de
  `session.creer` et de `session.modifier` garde les jours, pas les horaires.
  Une session écrite sans plage (base ancienne, test) tient en un jour (`completerSession` au chargement ; migration
  nommée `lot5-formations-plage-sessions`).
- **Heures de formation dans la feuille de temps** (`shared/rules/formations-temps.ts`, une ligne dans `suggestLines`) :
  « Proposer » propose une ligne interne `INT-FORM` / formation (`ks: false`, jamais envoyée à Keystone,
  `ACTIVITE_FORMATION` de `shared/constants.ts`, amorcée dans les projets par `lot5-formations-activite-interne`) pour
  chaque session de la semaine où le salarié est inscrit, ou présent après la clôture : heures de l'horaire du jour, pause
  déduite (`HEURES_JOUR_MAX` au plus), sinon durée du catalogue (« 21 h », « 3 h 30 ») répartie sur les jours et
  plafonnée à la journée de travail du salarié (`Domain.dayH` : 7 h à 35 h) ; zéro les jours fériés, d'absence, non
  travaillés ou hors contrat. Les lignes déjà saisies sont gardées (`fusionProposition`) : seules les lignes Keystone
  d'une proposition précédente (quand la semaine a des tâches Keystone) et la ligne `INT-FORM` de la même formation sont
  remplacées ; un jour qui dépasserait 24 h, toutes lignes cumulées, voit ses heures de formation réduites d'autant (la
  formation ne bloque jamais la proposition Keystone). Modifiables comme toute ligne proposée. Réglage `formationsTemps`
  (Paramètres → Formations, actif par défaut).
- **Liste d'attente** (lot 7, chantier C, t120 ; règles `shared/rules/liste-attente.ts`, serveur `server/src/liste-attente.ts`,
  table `attentesSession`, migration PostgreSQL `0007_formations.sql`, index SQLite `lot7-formations-index-attentes`) :
  une demande de formation acceptée sur une session complète (`demande.accepter`, choix `complete` : `attente` par défaut ou
  `plan`) place le salarié dans la file de la session, dans l'ordre où le service RH accepte les demandes (`rang`, donné à
  l'acceptation, pas à la date de la demande), sans priorité métier ; la réponse et
  l'e-mail (`attente.formation`) disent que la session est complète et sa place (`position`, calculée au chargement sur
  toutes les attentes, jamais stockée). Réglage `formationsListeAttente` (Paramètres → Liste d'attente des sessions) :
  désactivé, la demande va au plan de formation, la réponse dit que la session était complète. Places libres de
  `demande.accepter` : hors de celles déjà proposées à la file (`placesAProposer`). Une place libérée appelle
  `promouvoirAttente` dans la transaction de l'action : changement de session (`plan.inscrire`, `demande.accepter`,
  `attente.confirmer`), désinscription, recyclage enregistré (`cert.ajouter`), correction ou annulation d'une
  certification, places augmentées ou libérées par une nouvelle date (`session.modifier`), sortie (`employe.sortie`),
  réouverture d'une demande, retrait d'une personne proposée. Le premier encore admissible (`nonAdmissible` : session
  ouverte et pas commencée, dans le contrat, pas déjà inscrit, certification à renouveler toujours en vigueur ou formation
  initiale pas obtenue depuis, sans absence ni autre session ces jours-là, session précédente pas à clôturer) est proposé
  au service RH (`proposee`, e-mail `attente.proposition` à la boîte du service RH), qui confirme (`attente.confirmer` :
  convocation à ce moment-là, réponse de l'entreprise du 23 octobre 2026) ; réglage `formationsAttenteMode` à
  `automatique` : inscrit et convoqué aussitôt (`attente.inscrite` au journal). Un non-admissible est passé
  (`attente.sautee`, motif codé, jamais le détail d'une absence) ; s'il n'a plus d'objet (hors contrat, déjà inscrit,
  recyclage enregistré, certification remplacée, session commencée), il sort de la file. Le message de l'action ne nomme
  les personnes de la file qu'au service RH et au référent HSE. Session annulée ou clôturée : file close
  (`purgerAttente`, `attente.purgee`), ceux qui y étaient par une demande repassent au plan de formation (ligne prévue,
  à replanifier) et en sont prévenus. Sortie : ses attentes de sessions qui finissent après son départ sont retirées ;
  `cert.ajouter` : celles de la formation. Réouverture d'une demande : l'attente encore en file en sort
  (`demande_rouverte`) ; une inscription faite depuis la file est défaite comme une acceptation directe (`suite` de la
  demande, `attenteId`). Instantané : file entière au service RH, au référent HSE et à la lecture seule, celles de son
  périmètre au manager, la sienne au salarié (sa place sans voir les autres), sans les auteurs hors du service RH.
  Écrans : file dans le détail de la session (rang, état, « Confirmer l'inscription », « Retirer »), résumé sur la liste
  des sessions (Formations), « Mes listes d'attente » et place du jour sous la réponse (Mon espace), section de la fiche
  (retrait par le manager), choix « liste d'attente ou plan » à l'acceptation (dialogue `accepterAttente`), sessions
  complètes proposées dans la demande de formation quand la liste est activée.
  Places proposées : `Session.proposees` (calculé au chargement sur toute la file, connu du manager qui ne la voit pas).
  `plan.inscrire` ne les prend pas au manager (« proposées à sa liste d'attente : le service RH confirme ») ; le service
  RH et le référent HSE peuvent passer outre, et `ajusterPropositions` remet alors en attente, à leur rang, les dernières
  propositions qui n'ont plus de place (`attente.remise`, motif `plus_de_place`) ; de même quand `session.modifier` réduit
  les places. Le retour dans une session quittée (réouverture d'une demande, certification annulée : `refusRetour`) ne
  prend pas non plus une place proposée. Une personne proposée devenue indisponible (absence, autre session, session
  précédente à clôturer) ne bloque pas la place : `attente.confirmer` la remet en attente à son rang (`attente.remise`,
  motif codé) et propose la place au suivant admissible. Une personne de la file inscrite directement voit son attente
  close (`inscription`). Une inscription supprimée (désinscription, clôture, sortie, certification, réouverture) n'est
  plus désignée par `attentesSession.inscriptionId` (`retirerInscription` ; PostgreSQL : `ON DELETE SET NULL`), sans quoi
  SQLite garderait une référence orpheline, refusée par la reprise vers PostgreSQL.
- **Évaluation des formations** (lot 7, chantier C, étape 2, t121 ; règles `shared/rules/evaluation-formation.ts`, actions
  `server/src/actions/evaluations-formation.ts`, e-mails `server/src/evaluations-formation.ts`, table `evaluationsFormation`,
  migration PostgreSQL `0010_evaluations_formation.sql`, index SQLite `lot7-formations-index-evaluations`). Formation
  évaluable (`ciblesEvaluation`) : participation présente à une session clôturée (`p<id>`), ou formation suivie en vigueur
  (`s<id>`) ; organisme du catalogue ou de la formation suivie ; exercice : année du premier jour (comme les heures).
  Une ligne par formation, type et répondant (clés uniques), remplacée par une nouvelle saisie. **À chaud** : note de 1 à
  5 et commentaire, avis du salarié, donné dans Mon espace (encart « À faire » 30 jours, `DELAI_CHAUD_JOURS`, à partir du
  jour où la formation devient évaluable — dernier jour, ou clôture de la session ou saisie de la formation suivie si elle
  vient après, `CibleEvaluation.ouverte` —, jamais au-delà du début de l'évaluation à froid, `periodeChaud` ; un e-mail) ou
  recueilli par le service RH à la clôture (`session.cloturer`, `participants[].note`) ou plus tard (« Recueillir », détail
  de la session) ; le salarié le modifie jusqu'au début de l'évaluation à froid. **À froid** : efficace, partiellement,
  non ; `evaluationFroidDelai` jours après le dernier jour (90 par défaut), par le salarié et son manager direct
  (`evaluationFroidPar` : `les_deux`, réponse de l'entreprise du 23 octobre 2026), pour les catégories cochées
  (`evaluationFroidCategories` : Réglementaires et Recommandées) ; réponse tardive acceptée. Échéances : « À faire » du
  salarié (`aFaireCollaborateur().evaluations`, pastille Accueil) et du manager (`evaluationsAFaireManager`, panneau et
  pastille Formations), 60 jours (`FENETRE_FROID_JOURS`) ; e-mails `evaluation.demande` (salarié) et `evaluation.manager`
  (manager, un par passage pour son équipe), une fois par palier (`demande`, `relance-15`, `relance-30`), notés dans la
  table `relances` (clé `evaluation:<formation>:<type>:<répondant>`), tâche de `tachesEmails` à partir de 7 h ; jamais de
  note ni de commentaire dans l'e-mail. Un premier envoi à un palier de relance (fonction réactivée, délai réduit, reprise
  de formations anciennes) ne porte pas la mention « relance » : elle suppose un envoi précédent de la même clé. Réglage `evaluationsActives` (Paramètres → Évaluation des formations) : désactivé,
  plus de saisie, d'à faire ni d'e-mail, les avis restent. **Indicateurs** (`indicateursEvaluation`) : total, par organisme
  et par formation : participants, avis à chaud (nombre, moyenne, taux), avis à froid attendus (`avisFroidAttendus`, ceux
  qui sont demandés : formation concernée échue, salarié présent à l'échéance, avis du manager seulement s'il en a un ;
  au moins les réponses reçues) et reçus, efficace / partielle / non, taux d'efficacité (« efficace » sur les réponses),
  taux de réponse ; `Session.bilan.note` (appréciation de session d'avant le lot 7) reprise telle quelle par session, jamais
  répartie par personne. Panneau sous les indicateurs de Plan & budget et export CSV (`csvEvaluations`). **Droits** :
  service RH tout (commentaires, auteurs) ; manager : ses avis de manager sur son équipe directe (hors N+2), jamais l'avis
  d'un membre ; salarié : ses avis, sans qui les a saisis ; référent HSE et lecture seule : aucune ligne, indicateurs
  calculés par le serveur (`Dataset.indicateursEvaluation`) sans moyenne ni efficacité sous 3 réponses (`SEUIL_ANONYMAT`,
  `masque`), vus dans Formations (référent HSE) ou Plan & budget ; paie : rien. Journal : `evaluation.enregistrer`
  (formation, type, répondant, ligne ; jamais la note, l'efficacité ni le commentaire), `evaluation.retirer`, et la case
  `avis` des participants de `session.cloturer`. Conservation : catégorie formations, commentaire vidé, note et efficacité
  gardées ; auteur (`auteurId`) gardé, nom retiré par le balayage. Export des données : section « Évaluations des formations
  suivies » ; le salarié qui télécharge les siennes n'y a que ses avis, sans l'auteur (`LIGNES_SALARIE` : l'avis à froid
  du manager reste au service RH, comme le dialogue le promet au manager) ; l'export du service RH les a tous.
- **Base existante** : colonnes et table ajoutées au démarrage (schéma déclaratif) ; `server/src/migrate.ts`
  valide sur la présence les formations sans mode de validation, libère la place d'une certification remplacée
  dans toute session ouverte postérieure au recyclage, puis clôture une fois les sessions passées de l'ancienne
  base sans décision à prendre (aucun inscrit, ou recyclages déjà saisis : `reprendreSessions`, auteur « Cursus ») ;
  les autres restent à clôturer.

## Documents déclarés par le collaborateur

Un passeport, un visa ou une vaccination saisi par le collaborateur dans son espace n'est pas écrit
dans son dossier : `formalite.enregistrer` crée une demande « document » qui conserve la déclaration
contrôlée (`DemandeCollab.declaration`, `shared/rules/formalites.ts`). Tant qu'elle attend, elle ne
compte ni dans la préparation des voyages ni dans le Go / No Go. Le tableau de bord RH montre le
contenu déclaré et la valeur actuelle du dossier : **Valider** (`demande.accepter`) revalide la
déclaration et l'écrit dans le dossier, dans la même transaction ; **Refuser** ne change rien.
Une nouvelle déclaration du même document (passeport, visa d'un pays, vaccin) remplace celle encore
en attente. Le contenu d'une déclaration n'est transmis qu'au RH et à l'intéressé, jamais au manager.
Une saisie du RH reste écrite tout de suite. Au démarrage, les demandes en attente d'une ancienne base
(formalité déjà écrite) reprennent leur contenu du dossier (`dejaAuDossier`) : un refus l'en retire.
Seule la plus récente demande de chaque document le reprend ; les plus anciennes restent à contrôler
dans le dossier, et leur refus n'y touche pas. Le refus ne retire pas non plus une pièce qui a changé
depuis ou que le RH a validée par une autre demande (`retireeAuRefus`) ; une pièce qui a changé se
valide comme une déclaration ordinaire.

Vaccinations (décision de l'entreprise : tous les vaccins avec leur date d'injection) : données de santé transmises au
seul service RH (droit `rh`) et à l'intéressé ; ni le manager, ni les profils restreints, ni Keystone (« formalité
sanitaire ») ne voient le vaccin. Avant toute saisie, le dialogue affiche l'information de la personne (art. 13 du
RGPD, `INFO_VACCINATIONS` de `shared/constants.ts`, texte à faire valider par le DPO, qui fixe la durée de
conservation : aucune purge n'est encore appliquée, et les déclarations acceptées gardent les injections antérieures).

## Pièces justificatives (t133, lot 6 étape 1)

Décision de l'entreprise du 18 octobre 2026 : fonction livrée **désactivée** (réglage `piecesStockage`, Paramètres →
Pièces justificatives, `pages/parametres/Pieces.tsx`) ; l'administrateur RH l'active (« Dossier des données de Cursus »)
après avis du DPO. Le choix « GED » (espace documentaire développé avec Codex) est refusé tant que son adaptateur
(`server/src/integrations/ged.ts`, même contrat `DepotPieces` que le dossier local) n'est pas écrit ; désactiver la
fonction n'efface rien et laisse les pièces jointes consultables.

- **Fichiers** (`shared/rules/pieces.ts`) : PDF, JPEG ou PNG reconnus sur leurs premiers octets ; seul le type reconnu
  est gardé et servi (une photo JPEG nommée .png est acceptée comme JPEG ; le type déclaré ne sert qu'à recevoir le
  corps brut), 10 Mo au plus (`express.raw`, 413 au-delà), nom d'origine nettoyé (sans chemin ni guillemet, extension du type
  reconnu). Stockage local (`DepotLocal` de `server/src/pieces.ts`) : `dossierPieces` de `chemins.ts`, `pieces/` à côté
  de la base ou `CURSUS_PIECES_DIR` (dossier en 700, fichiers en 600 dès leur création), nom aléatoire de 32 caractères
  hexadécimaux, écrit sous un nom provisoire puis renommé, empreinte SHA-256 en base. Table `pieces` : salarié, objet et
  identifiant, nom, type, taille, empreinte, nom stocké, envoi (date, auteur, compte), `conserverJusquau` (null : la
  durée de l'objet, appliquée par la conservation du chantier 7 étape 2), retrait (date, auteur, motif) ; index de la
  migration `lot6-pieces-index`.
- **Envoi en deux temps** (`server/src/pieces-routes.ts`) : `POST /api/pieces` (toute personne connectée, fonction
  active, 20 pièces en attente au plus par compte) enregistre une pièce sans objet et renvoie un **jeton** aléatoire ;
  l'action du dialogue la joint dans sa transaction (`joindrePieces` de `server/src/actions/pieces.ts`), après ses propres
  contrôles de droits. Seul le compte qui a envoyé la pièce peut la joindre (même refus pour un jeton inconnu, déjà
  utilisé ou d'un autre compte) ; le dialogue réutilise le jeton d'un fichier déjà envoyé si l'action est refusée puis
  reprise (`usePieceJointe` de `client/src/components/PieceJointe.tsx`). Une pièce jamais jointe est effacée au bout de 24 h.
- **Consultation** : `GET /api/pieces/:id` (`?telecharger=1` : en pièce jointe), mêmes règles que l'instantané
  (`voitPiece`) : service RH, tout ; référent HSE, certifications et titres d'habilitation ; salarié, les siennes ;
  manager, certifications et titres de son équipe, jamais un justificatif d'absence ni un document déclaré ; paie et
  lecture seule, rien. Hors de portée : 404 (rien ne dit que la pièce existe) et refus tracé ; retirée : 410 ; empreinte
  différente : 409 ; `Content-Security-Policy: default-src 'none'` (aucun script), `no-store`. L'instantané (`Dataset.pieces`,
  `piecesVisibles`) ne transmet que la description, jamais le nom stocké ni le jeton ; l'empreinte et les pièces retirées
  au service RH seulement.
- **Écrans** : champ « fichier » (`ChoixPiece`) dans la saisie et la qualification d'une absence (« Justificatif reçu »
  coché au choix d'un fichier, et dès l'ouverture quand une pièce est déjà jointe), le signalement par l'intéressé, l'ajout d'une certification, la délivrance d'une
  habilitation et la déclaration d'un document ; pièces déjà jointes listées (`PiecesJointes` : ouvrir, télécharger,
  aperçu d'une image, retirer avec motif) dans ces dialogues ; « Justificatif » sur ses absences en cours
  (`dialogs/PieceDialog.tsx`, `piece.joindre`) ; liens sur les déclarations à valider du tableau de bord ; section
  « Pièces justificatives » de la fiche (`components/PiecesFiche.tsx` : attestations et titres, « Joindre » pour une
  certification reprise de Lucca). Justificatif joint à une absence dont la réception n'est pas inscrite
  (`justificatifAVerifier`, souvent envoyé par l'intéressé après la qualification) : « justificatif joint, à vérifier par
  le service RH » dans la liste des absences, pour le service RH comme pour le salarié, et « Vérifier » pour le service RH ;
  la réception reste une décision du service RH, après avoir ouvert la pièce. Rien ne s'affiche tant que la fonction est
  désactivée.
- **Journal** : `piece.deposer` (type, taille), `piece.consulter` (une ligne par compte et par pièce pendant
  15 minutes), `piece.joindre`, `piece.retirer` (motif masqué) et le nombre de pièces jointes par une autre action
  (`pieces`) ; jamais le nom du fichier ni un jeton. Famille « Pièces justificatives » ; message et détail masqués à la
  lecture seule (`ACTIONS_SANTE`).
- **Retrait et nettoyage** : un fichier n'est jamais effacé dans la transaction d'une action (elle peut être annulée) :
  la pièce est marquée retirée, puis `nettoyerPieces` efface son fichier (aussitôt après la validation, et chaque heure
  avec les pièces en attente de plus de 24 h et les fichiers que plus aucune pièce ne désigne depuis 24 h).
- **Sauvegarde, restauration, intégrité, export** : voir `docs/SAUVEGARDE.md` (dossier `pieces-<base>/` des copies,
  remise en place à la restauration), « Exploitation » (contrôle d'intégrité) et « Journal des actions » (l'export des
  données d'un salarié joint le contenu de ses pièces en base64, sans nom stocké ni jeton).

## Conservation des dossiers (t016, lot 6 chantier 7 étape 2)

Décisions de l'entreprise : « Cursus propose, le RH confirme » ; réponse du 18 octobre 2026 : durées préremplies (dossier
5 ans après la sortie, temps 3 ans, paie 5 ans, titre de séjour 5 ans, santé 5 ans, passeport et visas à la sortie) mais
**inactives** tant que la référence de la décision du DPO n'est pas saisie. Règles : `shared/rules/conservation.ts` ;
serveur : `server/src/conservation.ts`, action `employe.anonymiser` (`server/src/actions/conservation.ts`) ; écran :
Paramètres → Conservation des dossiers (`pages/parametres/Conservation.tsx`, administrateur RH), dialogue
`dialogs/AnonymiserDialog.tsx`, encart « Dossiers à effacer » du tableau de bord (`components/DossiersEchus.tsx`).

- **Réglages** (section « Conservation des dossiers » de `REGLAGES`) : `conservationActive` (« Proposer les dossiers échus »,
  décochée), `conservationDecisionDpo` (texte masqué au journal), une durée en années par catégorie
  (`conservation…Ans`, 0 à 10, 0 : dès le lendemain du dernier jour). `COHERENCE` : activation sans décision du DPO
  refusée ; dossier 5 ans au moins (registre unique du personnel, art. R1221-26 : identité et titre de séjour) ; aucune
  catégorie au-delà du dossier (son anonymisation efface tout).
- **Dossiers échus** (`dossiersEchus`) : salarié sorti (`sorti`), non anonymisé, dont une catégorie échue
  (`echeanceConservation` : lendemain du dernier jour + durée) a encore des données (`aEffacer` : une catégorie déjà
  effacée revient si des données y ont été saisies depuis), ou dont le dossier est échu. Transmis dans `Dataset.conservation` à l'administrateur RH seulement ; vide tant que la fonction est inactive.
- **Effacement par catégorie** (étapes de `etapes`) : passeport et visas (fiche, visas, déclarations et leurs pièces) ;
  santé (visites, avis, restrictions, suivi, demandes de visite, vaccinations, déclarations) ; titre de séjour ; entretiens
  (lignes et comptes rendus) ; temps (commentaires et motifs des feuilles, absences, reports, clôtures ; justificatifs
  d'absence) ; formations (motifs de correction et de mesure, demandes, attestations et titres joints). La paie n'a pas
  d'effacement propre : lots et soldes de sortie restent, sans nom, après l'anonymisation.
- **Droit à l'effacement** (`avantEcheance`, `categoriesDroitEffacement`) : salarié sorti seulement ; sont effacées
  les catégories sans obligation légale (passeport et visas, entretiens, formations) et celles déjà échues ; l'identité
  (registre unique, 5 ans), le titre de séjour, la santé et le temps restent jusqu'à leur échéance (`obligation` de chaque
  catégorie, art. 17-3-b du RGPD), listés dans le dialogue et le message ; dossier échu : anonymisation complète.
- **Anonymisation** (échéance du dossier) : les étapes de toutes les catégories (idempotentes, même déjà effacées), puis la cascade
  fondée sur `REFERENCES` (`server/src/integrite.ts`) et non sur le seul nom `empId` : chaque colonne qui désigne un
  salarié a son traitement dans `TRAITEMENTS` (lignes supprimées, textes vidés, ligne gardée, compte fermé, pièces
  retirées, auteur gardé, référence détachée) ; `tests/conservation.test.ts` échoue si une référence n'en a pas — à
  rejouer après chaque fusion (délégations, historique des contrats…). Fiche : « Salarié anonymisé n° X » (nom, adresse
  e-mail, date de naissance complète, matricule de paie, contact d'urgence retirés ; `anonymiseLe`), compte désactivé,
  identifiant `anonyme-<n°>` (au journal aussi), sessions supprimées. La trace `effacements` est écrite, puis le nom et
  les adresses e-mail (l'identifiant de connexion seulement s'il est une adresse ; un terme d'un seul mot : 8 caractères
  au moins) sont remplacés dans les colonnes de texte et JSON du schéma (`retirerIdentite` : journal et son auteur, file
  d'envoi, notifications, comptes rendus de reprise, auteurs nommés dans d'autres dossiers, motif de l'effacement),
  quelle que soit la durée du journal. Seules les occurrences délimitées sont remplacées (`motifTerme` : ni lettre,
  chiffre, « . », « _ », « - » ni « @ » autour) ; la fiche et les comptes d'un autre salarié (réembauche, homonyme), les
  réglages et le nom des actions du journal ne sont jamais touchés.
  Heures par projet, absences, certifications, coûts de formation, lots de paie et soldes de sortie restent, sans nom.
  Trace : table `effacements` (catégories, date, auteur, motif, nombre d'éléments, `avantEcheance`), gardée.
- **Signalement** (`verifierConservation`, au démarrage puis toutes les heures, un passage par jour) : nouveaux dossiers
  échus signalés à la boîte du service RH (récapitulatif quotidien) et au journal (`conservation.signalement`, nombre et
  identifiants) ; rien n'est effacé.
- **Fichiers et sauvegardes** : les fichiers des pièces retirées sont effacés après la validation (`nettoyerBientot`) ;
  les sauvegardes gardent les données jusqu'à leur rotation (`docs/SAUVEGARDE.md`).

## Agenda (t036, lot 6 chantier 7 étape 2)

Décision de l'entreprise : tout le monde a une adresse Microsoft 365 (Outlook). `server/src/agenda.ts` :

- **Congés** : la décision d'un congé validé (`absence.decider`, `absence.demander` posée par le manager) joint un `.ics`
  en journées entières (`icsConge`, UID `absence-<n°>`, demi-journée dans la description) quand le salarié reçoit ses
  notifications aussitôt (le récapitulatif quotidien ne porte pas de pièce jointe) ; l'annulation d'un congé validé à
  venir (`absence.annuler`) envoie le même événement annulé (`annulerAgendaConge`, `server/src/notifications.ts`).
- **Flux personnel** (`GET /api/agenda/<jeton>.ics`, hors session et hors CSRF, après le limiteur de l'API ; débit propre
  par adresse et par jeton, `DEBIT_AGENDA`) : sessions inscrites, entretiens planifiés, absences en vigueur sous le libellé
  neutre « Absent » quelle que soit leur nature, déplacements (pays), de 3 mois en arrière à un an en avant ; un
  VCALENDAR sans METHOD, événements produits par `calendrier` de `integrations/email.ts`. Réglages (section « Agenda ») :
  `agendaFluxActif` (désactivé par défaut) et `agendaContenu`. Jeton de 256 bits en base64url, montré une seule fois,
  stocké haché (table `jetonsAgenda`, empreinte SHA-256) ; un jeton inconnu, révoqué, d'un salarié sorti ou anonymisé,
  d'un compte désactivé, ou un flux désactivé : même 404. Dernier accès noté au plus une fois par heure. Portail : panneau
  « Mon agenda dans Outlook » (`components/AgendaPortail.tsx`) ; `Dataset.agendaJeton` ne donne que la date de création.

## Données Keystone

Chantiers, projets, missions et tâches viennent de Keystone par l'API entrante
(`server/src/integrations/keystone-entrant.ts`), y compris en démonstration : `seed.ts` passe par
les mêmes fonctions et les mêmes tables. Chaque objet porte son identifiant Keystone (`ref` pour les
affectations, tâches et demandes, index uniques créés au démarrage) : un nouvel envoi le met à jour.

- **Projet** (`projets`) : imputable dans les feuilles de temps ; archivé, il n'est plus proposé (saisie,
  « Proposer depuis Keystone »). Les activités internes (`INT-*`, `ECOLE`) passent par la même route,
  mais un instantané qui les omet ne les archive pas.
- **Chantier** (`chantiers`) : exigences du Go / No Go. `ressources` est recalculé : salariés dont
  une affectation chevauche les dates du chantier. Archivé, il n'est plus évalué (`evaluateChantiers`).
- **Affectation** = mission (`missions`, `projet` = chantier) : lieu et nature déduits du chantier.
- **Tâche planifiée** (`taches`) : heures prévues par date (`heures`), entre `debut` et `fin` ;
  `tachesDeLaSemaine` / `suggestLines` (`shared/rules/temps.ts`) ne proposent que la semaine affichée.
  L'instantané envoyé au navigateur n'en garde que 8 semaines avant et après la semaine en cours
  (`tachesProches` de `dataset.ts`) ; `temps.suggest`, côté serveur, lit tout le planning.
- **Demande de déplacement** (`demandesKeystone`) : contrôlée à la réception (affectation exigée),
  revalidée à l'acceptation, conservée après décision.

Les salariés sont désignés par `identifiantKeystone` (`shared/rules/matricules.ts`) : le matricule Cursus
(`matricule()` de `shared/format.ts`, `EMP-0001`) par défaut, ou le matricule de paie si le réglage
`identifiantKeystone` l'a retenu (un salarié sans matricule de paie garde le sien) ; même fonction pour les
envois, les verdicts et les réponses de l'API. La correspondance inverse est faite à un seul endroit
(`correspondance()` de keystone-entrant.ts, dans `contexte()`) : après une réembauche, deux fiches portent le
même matricule de paie et la fiche présente l'emporte. Contrat : `docs/API-KEYSTONE.md` et `docs/keystone-openapi.json` (codes de motif :
`CODES_MOTIF` de `shared/constants.ts`).

## Go / No Go

`Domain.resourceStatus` (`shared/domain.ts`) évalue chaque ressource d'un chantier actif ; codes de motif
`CODES_MOTIF` (`shared/constants.ts`), contrat `docs/API-KEYSTONE.md`.

- **Présence** (`Domain.presence`) : affectations du salarié sur le chantier, ramenées aux dates du chantier et
  fusionnées si elles se touchent ; sans affectation connue, les dates du chantier. Disponibilité, déplacement et
  formalités portent sur la présence restante (`Domain.presenceRestante`, à partir du jour même) : sur un chantier en
  cours, une absence terminée ou une entrée déjà faite ne bloque plus ; une présence finie n'exige plus de déplacement.
- **Disponibilité** (No Go) : contrat (CDD, intérim, alternance, ou sortie enregistrée, CDI compris) qui finit avant la
  fin de la présence ou commence après son début (`CONTRAT`, `borneContrat`) ; titre de séjour expiré au jour de
  l'évaluation (`CONTRAT`, libellé transmis « Situation contractuelle à régulariser », jamais la mention du titre) ; un salarié sorti, absent des collaborateurs
  enrichis, reste évalué sur les chantiers où il est affecté ; absence validée ou signalée pendant la présence (`ABSENCE`), une
  demande en attente ne donnant qu'une réserve. Le libellé, même en partage détaillé, ne nomme jamais la nature.
- **Aptitude médicale** (`APTITUDE`) : état du jour, jamais rapporté aux dates de présence que Keystone fixe lui-même
  (des affectations sondes en déduiraient la date d'une visite ou la fin d'une restriction). Avis d'inaptitude : No Go ;
  aptitude non valide (visite périodique en retard, aucune visite) ou restrictions en vigueur aujourd'hui : une seule
  réserve (affectation à vérifier avec le service RH), qu'une habilitation exigée dépende de l'aptitude ou non. L'écran
  Chantiers en donne la cause au service RH ; Keystone, en partage détaillé, un libellé neutre (`GngReason.transmis`).
- **Titres** : habilitations et certifications exigées, valides sur les dates du chantier. Formation renforcée à la sécurité d'un CDD, d'un intérimaire ou d'un alternant sur un poste à risques particuliers, non suivie depuis son entrée : No Go `CERTIFICATION`, réserve si une session est planifiée avant le démarrage (« Sécurité au poste »).
- **Hors de France** : un déplacement rattaché au chantier, ou vers son pays pendant la présence (un voyage des mois
  plus tôt ne compte pas : `DEPLACEMENT`, à créer ou demande en attente). Chaque période de présence doit tenir dans
  un déplacement (départ au plus tard le premier jour, retour au plus tôt le dernier), sinon réserve
  `DEPLACEMENT_PARTIEL`. Formalités du salarié (`FORMALITES_VOYAGE`) : réserve tant que leur délai d'obtention le
  permet, No Go au-delà. Formalités de détachement (`DETACHEMENT`) : réserve jusqu'au départ, même une fois le délai
  indicatif entamé (« Urgent » au dossier voyage) ; No Go à partir du jour du départ si elles ne sont pas faites.
- **Détachement** : la destination porte sa formalité de sécurité sociale (`Destination.secu` ; sinon `secuDe` la
  déduit du code pays : certificat A1 dans l'Union européenne, l'EEE, en Suisse et au Royaume-Uni, certificat de la
  convention bilatérale, ou maintien au régime français sans convention). Une mission de plus de 4 semaines
  (`MISSION_LONGUE_JOURS`) exige en plus l'information écrite du salarié avant son départ. Le service RH en
  enregistre les dates sur le déplacement (`voyage.detachement` : `detachementLe`, `informationLe`), écran Voyages ;
  elles entrent dans le dossier voyage (`Domain.readiness`) et ne sont pas des données de santé. À la mise à jour d'une
  base antérieure, les déplacements déjà partis sont réputés en règle, une seule fois (`reprendreDetachements` de
  `server/src/migrate.ts`, tracé dans le journal : `migration.detachement`).
- **Horodatage** : `verdictKeystone` et `keystonePayload` exigent l'heure de l'évaluation (`evalue_le`, ISO UTC), sans
  valeur par défaut : la route de l'API (`new Date().toISOString()`) et le panneau « Réponse transmise à Keystone » de
  l'écran Chantiers (heure de l'affichage) donnent l'heure réelle, jamais une heure fictive.
## Dates, temps de travail et congés payés

- **Dates** : `isValidDate` (`shared/dates.ts`) n'accepte qu'une date qui existe au calendrier (« 2026-02-31 » est refusée,
  jamais décalée au mois suivant) ; `toIso` (import CSV) aussi. Une échéance de date à date (`addMonths`, `addM` : titres,
  aptitude, vaccins, passeport, entretiens) tombe au même jour du mois cible, ou à son dernier jour quand ce jour n'y existe
  pas : 29/02/2024 + 36 mois donne le 28/02/2027, 31/03 + 6 mois le 30/09. La date du jour (`todayIso` de `server/src/dataset.ts`) est
  celle de Paris (`isoParis`), quel que soit le fuseau du serveur ; la transmission à Sage est horodatée à l'heure réelle,
  décalage d'hiver ou d'été compris (`horodatageParis`).
- **Semaines** : l'année d'une semaine ISO est celle de son jeudi (`isoWeekYear`) : la semaine du lundi 29 décembre 2025
  part à Sage en « 2026-S01 ». Le cumul du forfait annuel en heures (`cumulAnnuel`) ventile une semaine à cheval jour par jour.
- **Période de paie** (`shared/rules/paie.ts`) : déduite de la semaine, plus du jour de l'envoi. Une semaine à cheval sur deux
  mois va sur le mois de son dimanche (réglage `periodeRattachement` : aussi le mois du vendredi, ou une ventilation jour par
  jour, `partsSemaine`, où chaque part reçoit le décompte cumulé jusqu'à son dernier jour moins celui des parts précédentes :
  les heures supplémentaires, dernières heures de la semaine, suivent leur jour et les parts s'additionnent exactement).
  Clôture des variables le dernier jour du mois (`clotureJour`, ou le 1er au 28) : une période close reçoit encore ses
  semaines en rappel sur la période ouverte (`periode_origine`), signalé dans la confirmation et le message de la
  transmission. L'écran Temps montre les feuilles en attente par période (`feuillesParPeriode`).
- **Heures supplémentaires** (`calcSheet`, `sageRubriques`) : payées avec majoration par défaut (HS25, HS50, sans repos) ;
  remplacées par un repos compensateur équivalent (RCR_ACQUIS seul, crédité au compteur de récupération) quand l'administrateur
  RH choisit ce mode avec la référence de l'accord collectif qui le prévoit (art. L3121-33 ; à défaut de délégué
  syndical, décision de l'employeur sans opposition du CSE, art. L3121-37) ; heures incluses à un forfait hebdomadaire
  (HSF25, HSF50) toujours payées. Le mode est figé sur la feuille à sa validation (`FeuilleTemps.heuresSup`),
  comme le régime à la soumission. Reprise d'une base antérieure (migration `lot4-paie-heures-sup`) : feuilles déjà
  transmises au calcul d'origine (« historique » : payées et repos crédité), feuilles validées non transmises au mode
  réglé ; le journal (`migration.heuresSup`) liste les salariés dont le solde de récupération devient négatif. Sans repos
  repris, acquis ni posé, le compteur de récupération n'apparaît pas (`recupInfo`).
- **Semaine à 7 jours** (décision de l'entreprise du 17 octobre 2026, `shared/rules/semaine.ts`) : la feuille couvre la
  semaine civile du lundi au dimanche (`joursSemaine` ; `wDays` garde les cinq jours ouvrés des congés et des contrats).
  Samedi et dimanche, normalement non travaillés, sont grisés (repliés en une colonne tant qu'ils sont vides) mais
  saisissables pour un chantier, un déplacement ou un impératif, et proposés depuis Keystone. Leurs heures prennent leur
  rang dans les heures supplémentaires (art. L3121-35) et la ventilation jour par jour (`partsSemaine`, 7 jours) ; le
  dimanche part en plus en quantité (HDIM) et, si le réglage `majorationDimanche` (Paramètres → Paie, 0 % par défaut)
  en prévoit une, en heures équivalentes (MAJ_DIM), majoration figée sur la feuille à sa validation (`majDimanche`).
  Alertes sans blocage (`SheetCalc.repos`, sous-ensemble de `warn`, signalées dans la file de validation) : 7 jours
  travaillés (6 au plus, art. L3132-1, et repos de 35 h consécutives approché par une journée sans heure tant que les
  horaires ne sont pas saisis, art. L3132-2), heures le dimanche sans dérogation de l'équipe (art. L3132-3 ; dérogation
  réglée par l'administrateur RH dans Paramètres → Repos hebdomadaire : travail en continu, art. L3132-12 et R3132-5, ou
  équipe de suppléance, art. L3132-16, avec sa référence ; supprimée avec l'équipe) ; aucune pour un cadre dirigeant.
  Le service RH les retrouve après la validation (`shared/rules/repos-a-verifier.ts`, `components/ReposAVerifier.tsx` :
  « Repos hebdomadaire à vérifier » sous Temps, feuilles soumises ou validées des 12 dernières semaines) ; la
  confirmation de la validation groupée compte les feuilles concernées. Les lignes de 5 valeurs
  sont lues avec un week-end vide et complétées une fois par base (migration `lot5-temps-semaine-7-jours`) ; rien n'est
  recalculé (le contenu des lots de paie est figé). Relevé des intérimaires et `heures.validees` comptent le week-end.
- **Heures de délégation** (`shared/rules/delegation.ts`, `components/Delegation.tsx`, `dialogs/MandatDialog.tsx`, table
  `mandats`) : mandats d'élu au CSE saisis par le service RH sur la fiche (titulaire ou suppléant, dates, crédit mensuel
  proposé d'après la table de l'art. R2314-1 selon l'effectif présent hors intérim, modifiable). Compteur des 12 derniers
  mois sous la feuille de temps : heures imputées au code `INT-DELEG` dans les feuilles validées, jour par jour, comparées
  au crédit ; report sur 12 mois glissants et limite d'une fois et demie le crédit dans le mois (art. R2315-5 et
  R2315-6 ; pour un suppléant sans crédit propre, celui d'un titulaire). Alerte seulement (circonstances exceptionnelles,
  art. L2315-7). Instantané : service RH (tous), l'élu (les siens) ; ni le manager (il voit la ligne de la feuille), ni
  les profils restreints. L'effectif de référence (`Dataset.effectifCse`, un nombre) est calculé par le serveur sur toutes
  les fiches et transmis au RH et à l'élu : l'instantané de l'élu ne contient que lui, le compteur y serait faux. Un membre
  du RH ne saisit ni ne retire son propre mandat (`refuserSoiMeme`). Sans mandat, rien ne s'affiche.
- **Jours fériés** (`shared/rules/majorations.ts`) : saisissables par défaut (réglage `feriesTravaillesAutorises`,
  Paramètres → Décompte des heures ; désactivé, `temps.setCell` refuse une heure un jour férié), mention « Férié
  travaillé » dans la feuille et ligne au journal (`temps.ferie`). Les heures restent du travail effectif (rang des heures
  supplémentaires) et sont repérées à part (`SheetCalc.mai1`, `ferie`, d'après la semaine de la feuille) : 1er mai majoré
  de 100 % fixé par la loi (art. L3133-6, MAJ_1MAI en heures équivalentes, non réglable) ; autres fériés en quantité
  (FERIE_TRAV) et majorés en MAJ_FERIE seulement si `tauxMajorationFerie` le prévoit (0 % par défaut), taux figé à la
  validation (`FeuilleTemps.majFerie`). La journée de solidarité travaillée et les fériés non chômés, réglés
  par année (« Jours fériés et journée de solidarité », ci-dessous), ne sont plus fériés : ni FERIE_TRAV ni majoration
  (art. L3133-8 : ses 7 h ne sont pas payées à un mensualisé, la paie le sait). Forfait jours : JTRAV seul.
- **Jours fériés et journée de solidarité** (t051, `shared/rules/feries.ts`, calendrier dans `shared/dates.ts`) : réglés par
  année civile par l'administrateur RH (Paramètres → Jours fériés et journée de solidarité, `parametres.feries`, clé
  `calendrierFeries` de la table settings, `Dataset.calendrierFeries`, sans le motif hors du service RH). Par défaut, et
  pour toute année sans réglage : lundi de Pentecôte chômé, tous les fériés chômés. Journée de solidarité : lundi de
  Pentecôte travaillé, autre férié travaillé (jamais le 1er mai), ou hors calendrier (fractionnée, sur un RTT : aucun effet).
  Fériés non chômés : une case par férié, le 1er mai toujours chômé (art. L3133-4). Un férié travaillé ainsi n'est plus
  férié : `isFerie` (signature inchangée) lit un état du module posé par `configurerFeries`, appelé par `loadFull` et par le
  constructeur de `Domain` (serveur et navigateur), caches vidés seulement quand le réglage change ; la vingtaine d'appels
  (décompte des congés, heures proposées, repos du forfait jours, acquisition des CP, majorations, préavis, sessions,
  journal) suivent sans changer. Jour de solidarité travaillé : décompté en congé, heures proposées, ni FERIE_TRAV ni
  majoration, mention « Journée de solidarité » sur la feuille ; ses 7 h ne sont pas payées à un mensualisé (art.
  L3133-8, au prorata pour un temps partiel) : simple mention, aucune rubrique. **Aucun effet rétroactif** : réglable à
  partir de 2027 (`ANNEE_FERIES_MIN`, mise en service) et jamais pour une année passée ; une ligne d'une année antérieure
  est ignorée par le calendrier ; le réglage d'une année ne change que les décomptes de cette année
  (`tests/feries-horaires.test.ts` : régler 2027 ne modifie aucun décompte de 2026). Une année engagée exige un motif ;
  l'écran et le message nomment les absences recalculées (`absencesRecalculees`, calcul fait avec le calendrier du
  réglage puis celui en vigueur rétabli : `avecCalendrier`) ; une absence déjà transmise se régularise au lot suivant
  (écart de `shared/rules/absences-paie.ts`), une clôture de congés n'est pas refaite. Repos du forfait jours
  (`reposForfait`, inchangé) : il suit `isFerie`, un férié de semaine travaillé ouvre un jour de plus à répartir.
- **Horaires de poste** (t048, étape 1 ; `shared/rules/horaires.ts`) : référentiel « Horaires » (table `horaires` : code
  choisi une fois pour toutes, libellé, début, fin « HH:MM », pause en minutes ; fin avant le début : le lendemain),
  distinct des postes et de leurs exigences, tenu par le service RH (Référentiels → Horaires, `server/src/actions/horaires.ts`),
  archivé plutôt que supprimé. Exemples amorcés par la migration `lot6-horaires-exemples` (J 8 h – 16 h, M 5 h – 13 h,
  AM 13 h – 21 h, N 21 h – 5 h), modifiables. Horaire par défaut d'une équipe (`Equipe.horaire`, dialogue des exigences de
  l'équipe). Horaire du jour sur la feuille, au niveau de la feuille (`FeuilleTemps.horaires`, 7 valeurs : null non choisi,
  « » aucun, ou un code ; seuls les choix explicites) : ligne « Horaire du jour » de la grille, sélecteur sous le titre du jour sur téléphone
  (`client/src/components/HorairesFeuille.tsx`) ; un jour non choisi qui porte des heures affiche l'horaire de l'équipe,
  en italique, tant que la feuille est en saisie. Ce qui est retenu est figé à part (`FeuilleTemps.horairesFiges` : code,
  début, fin et pause de chaque jour, `horairesAFiger`) à la soumission, puis de nouveau à la validation (jour complété
  par le valideur) ; les heures d'un code déjà figé ne changent plus : modifier un horaire au référentiel ne change pas
  le sens d'une feuille soumise ou validée. Une feuille renvoyée repart des choix et de l'équipe (un jour qui a perdu
  ses heures perd l'horaire proposé, un jour qui en a reçu se le voit proposer), puis se refige. Facultatif : sans horaire, la feuille se
  tient comme avant ; une feuille d'avant les horaires n'en reçoit jamais (aucun contrôle rétroactif). Keystone ne transmet
  que des heures par jour. Données transmises à tous les espaces (aucune donnée personnelle).
- **Repos quotidien, pause et travail de nuit** (t048, étape 2 ; `shared/rules/repos-nuit.ts`, appelé par `calcSheet`) :
  d'après l'horaire de chaque jour (figé, sinon choisi ou proposé par l'équipe), la plage de travail est estimée du
  début de l'horaire à ce début plus les heures saisies ce jour-là et la pause (des heures en plus la prolongent).
  Un jour sans horaire n'est pas contrôlé ; une feuille d'avant les horaires n'a ni contrôle ni heure de nuit.
  - Repos quotidien de 11 h (art. L3131-1 ; 12 h pour un mineur, 14 h avant 16 ans, art. L3164-1) entre la fin d'un jour
    et le début du suivant, le dimanche de la feuille précédente compris (`veilleDe`) ; pause de 20 min dès 6 h de
    travail (art. L3121-16 ; 30 min au-delà de 4 h 30 pour un mineur, art. L3162-3), celle de l'horaire. Alertes à
    motiver (`SheetCalc.reposQuotidien`, dans `depassements`), sans autre blocage, tant que l'accord n'est pas connu ;
    aucune pour un cadre dirigeant. Le journal de `temps.submit` et `temps.validate` garde leurs codes (`reposNuit` :
    `repos_quotidien`, `pause`, d'après les horaires figés, sans le dimanche précédent), jamais le motif.
  - Nuit d'un salarié mineur (de 22 h à 6 h, de 20 h à 6 h avant 16 ans, art. L3163-2) : refusée sans motif possible, au
    choix de l'horaire (`temps.horaire`, `refusNuitMineur`) comme à la soumission et à la validation (`SheetCalc.nuitMineur`,
    l'horaire proposé par l'équipe compris).
  - Heures de nuit (`SheetCalc.nuit`) : la plage de travail dans la plage de nuit réglée (Paramètres → Décompte des
    heures : 21 h – 6 h par défaut, art. L3122-20 ; 21 h ou 22 h à 6 h ou 7 h, 9 h au moins, art. L3122-2), la pause
    retirée au prorata, rattachées au jour où commence le poste. Rubriques HNUIT (quantité, comprise dans les heures) et
    MAJ_NUIT (heures équivalentes au taux `nuitMajoration`, 0 % par défaut, figé sur la feuille à sa validation :
    `FeuilleTemps.majNuit` ; migration `lot6-horaires-majoration-nuit` : 0 % sur les feuilles déjà validées) ; un forfait
    jours n'en a pas (décompte en jours). Désactivées par défaut (`inactiveParDefaut`) : tant que la paie ne les a pas
    activées, elles sortent du fichier mais figurent, salarié par salarié, dans le résumé du lot et l'export des
    variables comme « à saisir dans Sage » (`SagePush.aSaisir`, famille `nuit`, rempli par `buildSagePayload`). Le lot
    garde par feuille ce qu'il a listé (`RubriquesFeuille.aSaisir`, `nuitASaisirDeLaFeuille`), que la réouverture reprend
    (`ReouvertureFeuille.aSaisir`) : une feuille régularisée liste l'écart, positif ou négatif, détail « régularisation »
    (rappel d'une période close sur la période ouverte) ; rubrique activée depuis, la quantité saisie à la main est à
    retirer, le fichier emporte la nouvelle.
  - Travailleur de nuit (`statutNuit`, art. L3122-5) : sur les feuilles validées, deux semaines au moins parmi les quatre
    dernières validées qui comptent chacune deux jours d'au moins 3 h de nuit (lecture de « deux fois par semaine, selon
    son horaire habituel » ; une feuille sans horaire compte comme une semaine sans nuit, si bien que des nuits ponctuelles
    dans une équipe de journée n'en font pas un), ou 270 h de nuit sur 12 mois glissants
    (art. L3122-23, supplétif) ; seuils réglables avec la référence de l'accord (COHERENCE). Repéré sur la fiche
    (`components/TravailNuit.tsx`) ; encore en VIP, alerte « Suivi médical adapté à prévoir » (`MedInfo.suiviNuit`,
    échéance sans date parmi les visites dues, « Demander la visite » ; VIP adaptée, art. R4624-17), sans changer d'office
    le type de suivi. Calculé sur les feuilles déjà transmises ; le référent HSE, qui ne les reçoit pas, a l'indication
    `Employe.travailleurNuit` calculée par le serveur.
  - Réglages (`nuitDebut`, `nuitFin`, `nuitSeuilQuotidien`, `nuitSeuilAnnuel`, `nuitMajoration`, `nuitAccord`, texte
    masqué au journal) : bloc « Travail de nuit » de Paramètres → Décompte des heures (`components/ReglagesNuit.tsx`) ;
    plage ou seuils autres que ceux de la loi exigent la référence de l'accord (art. L3122-15 et L3122-16).
- **Heures complémentaires** : au-delà du dixième de la durée contractuelle (art. L3123-28), ou du tiers avec la
  référence d'un accord (`plafondHeuresComplementaires`, `heuresComplementairesAccord`, art. L3123-20 ; COHERENCE),
  dépassement de `SheetCalc.depassements` : motif exigé à la soumission. Majoration inchangée : 10 % jusqu'au dixième,
  25 % au-delà (art. L3123-29). Avenants de complément d'heures (art. L3123-22) non développés.
- **Durées sur plusieurs semaines** (`shared/rules/durees.ts`, feuilles validées, alertes sans blocage) : moyenne des 12
  dernières semaines travaillées (semaine sans feuille validée ou sans heure sautée, un an au plus) au-delà de 44 h
  (art. L3121-22 ; `moyenne12SemainesMax` jusqu'à 46 h seulement avec la référence d'un accord, art. L3121-23), hors
  forfaits et cadre dirigeant ; temps partiel dont l'horaire réel dépasse le contrat d'au moins 2 h 12 semaines sur les
  15 dernières travaillées, avec le nouvel horaire proposé (art. L3123-13, seuils non réglables) ; contingent annuel
  (`contingentAnnuel` : heures supplémentaires de l'année civile, incluses à un forfait hebdomadaire comprises, sans celles
  remplacées par un repos ni l'intérim, semaine à cheval ventilée jour par jour, plus `SoldeReprise.heuresSupAnnee` reprises
  de Lucca pour l'année de la date d'arrêté (la reprise signale les heures sup déjà validées dans Cursus avant l'arrêté,
  comptées en plus) ; 220 h par défaut, art. D3121-24, alerte à `contingentAlerte` %, référence
  `contingentAccord` sinon rappel « valeur conventionnelle à vérifier »). Au-delà, contrepartie obligatoire en repos de
  100 % (plus de 20 salariés, art. L3121-38) : à chaque validation, `corAValider` fige sur la feuille (`FeuilleTemps.cor`,
  par année) la COR de l'année recalculée sur toutes les feuilles validées moins celle déjà figée sur les autres ; une
  validation hors de l'ordre chronologique, une feuille rouverte ou un contingent changé portent leur écart (négatif s'il
  le faut) sur la feuille validée, et le total de l'année reste juste. Créditée au compteur de récupération même en mode
  « payées » (`recupInfo`), émise dans COR_ACQUIS (dernière part d'une semaine ventilée). Écran Temps : alertes sur la
  feuille, contingent au récapitulatif (de chaque année pour une semaine à cheval sur le 31 décembre), encart « Durées du
  travail à surveiller » pour le service RH (`components/AlertesDurees.tsx`) ; message de validation quand la feuille
  franchit un seuil (le contingent de chacune de ses années) ou crédite une COR, repris aussi par `temps.validerLot`.
- **Durées** : une journée compte 24 h au plus, toutes lignes de la feuille cumulées
 (saisie, proposition Keystone,
  soumission, validation). Au-delà des durées maximales (`SheetCalc.depassements`), la soumission exige un motif
  (`FeuilleTemps.motifDepassement`), affiché au valideur ; s'il a lui-même porté la feuille au-delà, il le donne en validant.
  Le motif du salarié est conservé : celui du valideur ne sert que s'il manque.
- **Reports de CP** (`ReportCp.periode`, `expire`) : un report reçu s'ajoute aux droits de sa période (année de prise) ;
  un report accordé en cours de période (`report.accorder`) vise la suivante et ne compte qu'une fois appliqué par la
  clôture (`reportEnAttente`). Un report décidé par le service RH s'éteint le 31 mai (`echeanceReport`) ; seul un report
  légal (`estReportLegal`) a une autre échéance. Échu en cours de période, il ne garde que ses jours déjà pris
  (`reportsAu` : jours pris imputés d'abord sur lui) ; les jours posés après l'échéance ne le consomment plus.
- **Clôture des congés** (`shared/rules/clotures.ts`, `conges.cloturer`) : proposée par le bandeau de l'écran Congés &
  absences (`cloturesAFaire`) à partir du 1er juin (CP de la période close au 31 mai) et du 1er janvier (RTT de l'année
  close), pour les périodes postérieures à la date d'arrêté des compteurs repris. CP : solde photographié pour chaque
  salarié présent au 31 mai (ni intérimaire, ni sorti : indemnité compensatrice), report (plafonné au solde, échéance
  au 31 mai suivant, report reçu sur la période suivante) ou perte décidés ligne par ligne, jamais d'office
  ni en bloc ; réglage `politiqueReportCp` : sans proposition (défaut) ou report du solde proposé. Report imposé (perte
  refusée), lot 5 : jours liés à une absence protégée (santé, maternité, paternité, adoption, absence encore à qualifier)
  — acquis pendant elle sur la période de référence (`acquisPendantArrets`) et jours ouvrés de la période de prise
  qu'elle a empêché de prendre (`joursEmpeches`), au demi-jour supérieur, dans la limite du solde (`LigneClotureCp.acquisArret`,
  `empeches`, `legal`) —, 15 mois après la fin de la période (31 août A+2 : art. L3141-2 et L3141-19-1), ou 15 mois après
  l'information du salarié à son retour si elle tombe plus tard (`echeanceReportArret`) ; les seuls jours restants
  d'un report légal reçu qui court au-delà de la période, jusqu'à sa propre échéance (le reste du solde est au choix du
  service RH ; une ligne au report légal imposé propose toujours le report de tout le solde, même au cas par cas : aucun
  jour n'est prérempli comme perdu) ; motif réservé au service RH et à l'intéressé. Une ligne n'est pas close tant qu'une demande de CP de la
  période attend une décision ; une période close ne reçoit plus de congé (`checkAbsence`), et les jours qu'un refus ou
  une annulation lui rendent sont reportés sur la période suivante (`recrediterPeriodesCloses`, tracé). RTT : non reportables, soldes photographiés et perdus ; ceux
  de l'année close restent plaçables sur le CET (`cet.placer`, `annee`) jusqu'à la confirmation. Table `clotures` (une
  ligne par salarié et période, unique) : relancer est sans effet.
- **Acquisition des congés payés pendant les absences** (lot 5, t041, `shared/rules/acquisition-cp.ts`, loi 2024-364) :
  `droitsAcquis` (droits d'une période) et les jours acquis à une date (`acquisAu` : anticipation, période en cours
  d'acquisition, reprise) sont calculés mois par mois (`acquisitionPeriode`). Un mois compte s'il est couvert à la mi-mois
  par le contrat (comme avant) ; chaque absence validée ou signalée y joue selon `NatureDef.cpAcquisition` : `assimile`
  (accident du travail ou de trajet, maladie professionnelle sans limite de durée, maternité, paternité, adoption,
  événements familiaux : travail effectif), `maladie` (maladie, longue maladie, et absence à qualifier : 2 jours ouvrables
  par mois, soit 5/3 de jour ouvré, 24 ouvrables, soit 20 ouvrés, par période au plus ; art. L3141-5-1) ou `non` (congé
  parental, sans solde, absence injustifiée, enfant malade : prorata des jours du mois). Un mois qui garde 4 semaines ou 24
  jours ouvrables de travail effectif compte en entier (équivalence, art. L3141-4) ; droits arrondis au jour supérieur.
  Réglage `cpMaladie` (Paramètres → Congés et clôtures) : `legal` par défaut, `assimile` si un accord ou la CCN plus
  favorable est confirmé (maladie comptée comme du travail effectif). Calcul mémorisé par instantané (`WeakMap` sur le
  `Domain`, clé salarié, dates du contrat et période) : `imputer` le demande pour chaque demi-journée posée. Reprise depuis
  Lucca : `reprise()` déduit les jours pris des droits calculés, absences comprises : le solde à la date d'arrêté reste
  celui de Lucca même avec un arrêt saisi en 2026. Confidentialité : le manager, le référent HSE et la lecture seule
  reçoivent une nature médicale comme « Absence », calculée comme une maladie (affichage approché, plus prudent pour un
  accident du travail ; le serveur, qui contrôle les demandes, a la vraie nature) ; le profil paie reçoit en plus les
  jours acquis chaque mois, calculés par le serveur avec la vraie nature (`Dataset.acquisitionsCp`, `acquisitionsCalculees`,
  par salarié et par période que traverse une absence masquée), que `acquisitionPeriode` reprend tels quels : ses soldes
  et ses exports sont ceux du service RH, sans qu'aucun effet soit transmis absence par absence (il désignerait un
  accident du travail ou un congé enfant malade).
- **Information au retour d'un arrêt** (lot 5, t041, `shared/rules/information-retour.ts`, art. L3141-19-3) : à la fin
  d'un arrêt de maladie ou d'accident (catégorie santé, validé ou signalé, terminé ; deux arrêts qui se suivent ne font
  qu'un retour, au dernier : `suiteArrets`, l'information porte sur toute la suite — dates, jours acquis, reports échus
  depuis son premier jour), tâche « Informations au retour à faire » de l'écran Congés & absences (`retoursAInformer` ; à faire dans
  le mois qui suit la reprise, « en retard » au-delà ; salariés présents, hors intérim, retours dont le délai n'était pas
  échu à la date d'arrêté des compteurs repris). « Informer » (`conges.informer`, sur confirmation) envoie au salarié le
  nombre de jours dont il dispose sur la période en cours, la date limite pour les prendre, les jours acquis pendant
  l'absence et l'échéance du report de 15 mois (`contenuInformation`, e-mail `conges.information` sans la nature de
  l'arrêt), enregistre l'information (table `informationsCp`, une par arrêt et par fin d'arrêt, unique sur `absenceId`
  et `au` : un arrêt prolongé après l'information — `absence.prolonger` repousse sa fin — redevient à informer à son
  nouveau terme ; jours, date limite, échéance, auteur) et prolonge jusqu'à 15 mois après l'information les reports
  légaux qui couraient pendant la suite d'arrêts. Le salarié retrouve
  l'information dans « Mes absences » ; ni son manager ni les profils restreints ne la reçoivent (elle désigne un arrêt de
  santé) ; au journal, masquée à la lecture seule (`ACTIONS_SANTE`, e-mail simulé compris) ; dans Paramètres → Envois,
  la lecture seule voit l'e-mail sans son objet ni son texte (`envoisPourLecteur`, server/src/envois-lecteur.ts : de même
  pour la demande de visite et le récapitulatif quotidien qui contient l'une d'elles).
- **Demi-journées** (`shared/rules/demi-journees.ts`, décision de l'entreprise) : CP, RTT ou jours de repos du forfait
  jours, récupération. Colonnes `debutDemi` et `finDemi` de l'absence (null : journée entière) : après-midi seul le
  premier jour, matin seul le dernier ; un congé d'un seul jour porte une seule demi-journée, matin ou après-midi
  (`debutDemi`). Refusée sur une autre nature, ou sur un premier ou dernier jour non décompté (week-end, férié, jour non
  travaillé), comme une valeur inconnue (« Demi-journée inconnue » ; le journal ne garde que la valeur normalisée).
  `countedDays` donne chaque jour décompté avec son poids (1, ou 0,5), `countDays` leur somme : soldes CP,
  RTT et récupération (une demi-journée de récupération vaut la moitié de `dayH`), exports, annulation. `imputationCp`
  impute par demi-journée : une journée se répartit entre la période en cours et l'anticipation (ou le hors droit) quand
  il ne reste qu'une demi-journée ; la clôture rend les jours au demi-jour (`recrediterPeriodesCloses`). Deux
  demi-journées opposées le même jour ne se chevauchent pas (`chevauche`, dans `checkAbsence` et `checkNature`). Feuille
  de temps : le jour d'une seule demi-journée d'absence reste saisissable, une demi-journée de travail au plus
  (`heuresDemiJournee` : la moitié de `dayH`, au moins 4 h pour une journée de 7 h ou plus, la moitié seule pour une
  journée plus courte de temps partiel), toutes lignes cumulées (`demiJoursAbsence`, `heuresSurAbsence`,
  `temps.setCell`, proposition Keystone plafonnée) ; deux demi-journées opposées couvrent le jour (`joursAbsence`). La
  validation d'une feuille contrôle les demandes en attente réunies aux absences en vigueur (`heuresSurDemandes`) : une
  demi-journée demandée à côté d'une demi-journée validée ferait un jour entier, à décider avant. Keystone reçoit la journée entière (`absence.validee` inchangé). Migration
  `lot5-conges-demi-journees` : colonnes ajoutées vides par le schéma (journées entières), valeurs hors de la règle
  ramenées à la journée entière.
- **RTT de l'année suivante** (`rttDemande`) : une demande de RTT est évaluée sur l'année de son premier jour, avec le
  droit et le solde de cette année (`rttInfo(d, e, Y)`), dès maintenant (réglage `rttAnneeSuivanteDes` : à partir d'un
  jour de l'année, vide par défaut) ; refusée à cheval sur deux années, sur une année close (`rttAnneeClose` : clôture
  faite, année antérieure à la précédente ou à la date d'arrêté) ou au-delà de l'année suivante.
- **RTT et jours de repos** (`rttDroit`) : au prorata des mois passés dans l'année sous le régime actuel, de l'entrée (ou
  du changement de régime) à la fin du contrat ; un mois compte si le salarié y est présent à la mi-mois (`monthsPresent`,
  comme l'acquisition des CP) : un contrat d'une semaine ne donne aucun jour.
- **Congés payés** (`imputationCp` de `shared/rules/conges.ts`) : chaque jour de CP, validé ou demandé, est imputé dans
  l'ordre chronologique sur la période dont les droits se prennent à sa date (`anneeCp` : du 1er juin A au 31 mai A+1, les
  CP acquis du 1er juin A-1 au 31 mai A). Un congé de mai à juin est réparti sur deux périodes ; un congé de l'été prochain
  est décompté sur la période en cours d'acquisition. Période épuisée : prise par anticipation sur la période suivante,
  dans la limite des jours qui seront acquis à la date du congé (décision de l'entreprise), puis déduite de celle-ci au
  1er juin ; au-delà, solde insuffisant (`checkAbsence`, qui refuse aussi une demande qui repousserait un congé déjà posé
  au-delà des jours acquis). `cpInfo` donne le solde de la période en cours et `suivante` / `anticipes`, les jours déjà
  imputés sur la suivante. Les compteurs repris de l'ancien système (`soldesReprise`) sont datés (`arreteLe`) : les CP pris
  s'imputent sur la période de cette date (`anneeCp`), les RTT pris sur son année civile, la récupération reste cumulée
  (`reprise`). Une base existante a reçu la date de mise en service (migration `lot4-reprise-soldes-dates`).
  Les 5 jours de la CCN à partir de 59 ans (`supplementAge`) suivent une seule règle pour la période en cours et les autres :
  accordés dès l'année civile des 59 ans, ils restent acquis à la période une fois passée (sans quoi les jours pris dessus
  seraient repris par anticipation sur la suivante au 1er juin).
- **Congé principal et fractionnement** (lot 6, t046, `shared/rules/fractionnement.ts`, Paramètres → Fractionnement des
  congés) : période du congé principal réglable (`fractionnementDebut`, `fractionnementFin`, du 1er mai au 31 octobre par
  défaut). Seuils légaux en jours ouvrables, Cursus en jours ouvrés : 5 ouvrés valent 6 ouvrables (24 ouvrables = 20 ouvrés,
  12 = 10, 6 = 5, 3 = 2,5). Calcul par période de CP `A` sur les jours imputés à cette période (`imputationCp`, validés et
  demandés), comparés à la fenêtre de l'année `A` : un congé du 1er au 31 mai A, imputé à la période A-1 (prise à partir du
  1er juin), compte hors période pour A-1 ; pris par anticipation sur A, il tombe dans la fenêtre de A. Congé principal :
  20 ouvrés au plus des droits acquis, sans la 5e semaine ni le supplément d'âge (art. L3141-23). Congés continus
  (`blocsConges`) : absences de CP qui se suivent réunies (aucun jour décompté entre elles), une demi-journée travaillée
  coupe. `checkAbsence` avertit, sans bloquer, d'un congé continu de plus de 20 ouvrés (art. L3141-17, dérogations
  rappelées), d'une demande qui ne laisse plus de quoi prendre la fraction continue de 10 ouvrés dans la fenêtre (art.
  L3141-18 et L3141-19), et des jours de fractionnement qu'ouvre une demande hors période (règle légale : 2 jours pour
  6 ouvrables ou plus du principal hors période, 1 pour 3 à 5, crédités en jours ouvrés). « Congé principal à prévoir »
  (`principauxAPrevoir`, `components/Fractionnement.tsx`) dans les 60 jours qui précèdent la fin de la fenêtre (service RH,
  manager pour son équipe) ; « Jours de fractionnement à décider » à partir du lendemain (`fractionnementsAProposer` :
  jours dus si tout le reste du principal se prend hors période, `potentiel`), décidés par `conges.fractionnement`
  (`dialogs/FractionnementDialog.tsx`) : crédit en report reçu (`ReportCp.origine` `fractionnement`, compté dans `cpDroit`,
  le solde, la clôture et le solde de sortie), ou renonciation individuelle du salarié (art. L3141-19) ; table
  `fractionnements` (une décision par salarié et période, `REFERENCES` d'integrite.ts ; une ligne reçue déjà décidée est
  ignorée et comptée dans le message, les autres sont enregistrées). Réglage `fractionnementRegle` :
  `legal` (défaut), `accord` (la règle légale reste proposée, à ajuster ; crédit par demi-journée jusqu'à 6) ou `aucun`
  (renonciation par accord collectif, art. L3141-21 : rien n'est proposé) ; la référence `fractionnementAccord` est exigée
  hors de la loi (COHERENCE) et masquée au journal. Périodes suivies : fenêtre qui commence à la date d'arrêté des compteurs
  repris ou après (avant, les congés pris sont des totaux de Lucca) — la première est celle de 2027. Instantané :
  `fractionnements` au service RH, à la paie et à la lecture seule, à l'intéressé pour lui ; le manager voit le crédit dans
  les reports reçus de son équipe (sans motif, `reportNeutre`), jamais une renonciation.
- **Congé pris sur le CET** (lot 6, t127, `shared/rules/conges.ts`) : type de congé `CET`, ouvert dès qu'un jour est épargné
  (`cetEpargne` : placements et solde repris), journées entières en jours ouvrés (`countedDays` comme un CP), demandé par le
  salarié et validé par son manager comme un CP, contrôlé sur `cetInfo.solde` (placements + repris − congés pris −
  demandés), le même solde étant affiché, exporté et liquidé à la sortie (`CET_LIQ` : une demande en attente y compte comme
  posée, comme pour les CP) ; `cetInfo.total` ne déduit que les congés pris. Plafonds de
  placement réglables (`cetPlafondRtt`, `cetPlafondCp`, 5 et 5 ; Paramètres → Compte épargne-temps). Paie : rubrique `CET`
  désactivée et « code Sage à confirmer » ; d'ici là, chaque congé figure nominativement « à saisir dans Sage » dans le
  résumé du lot et l'export des variables (absence sans code Sage, `elementsASaisir`). Keystone reçoit l'indisponibilité
  sans la nature. Monétisation (`cet.monetiser`, CET_MON) reportée : elle se branchera sur le registre des éléments de lot
  quand l'accord CET sera connu.
- **Entretiens** : `entretien.clore` refuse un entretien prévu à une date à venir, sauf à indiquer le jour où il a eu
  lieu, qui devient sa date (échéance suivante, état des lieux à 8 ans). Cette date n'est pas antérieure au jour de la
  planification ou de la reprogrammation (`Entretien.planifieLe`, `debutCloture`), ni au dernier entretien du même type
  réalisé ; un entretien planifié avant que Cursus conserve ce jour se date au plus tôt de sa date prévue si elle est
  passée, sinon 30 jours avant la clôture.

## Entretiens : campagne, comptes rendus et remise

- **Campagne d'entretiens annuels** (`shared/rules/campagne.ts`, Paramètres → Campagne d'entretiens annuels,
  `pages/parametres/Entretiens.tsx`) : ouverture et clôture (« MM-JJ », l'échéance est la clôture), ancienneté minimale à
  l'ouverture, contrats exclus (CDD, alternance ; l'intérim l'est toujours), affichage de l'échéance avant l'ouverture
  (toute l'année, ou 90 à 0 jours avant). Par défaut, le fonctionnement d'origine : du 1er octobre au 15 décembre, sans
  ancienneté, seul l'intérim exclu, échéance affichée toute l'année. `obligations()` et l'indicateur « Campagne annuelle »
  lisent ces réglages.
- **Remise du compte rendu** (`shared/rules/remise.ts`, `server/src/actions/remise.ts`) : le compte rendu s'imprime dès la
  clôture par l'évaluateur (`dialogs/compteRendu.ts`, mention « non signé par le salarié ») ; l'évaluateur ou le service RH
  enregistre la remise de la copie (`entretien.remettre`, colonnes `remiseLe`, `remiseMode`, `remisePar`) : en main propre,
  après un refus de signer, ou par mise à disposition dans le portail (salarié qui a un compte actif ; e-mail
  `entretien.remise` avec le seul lien vers Cursus, jamais le texte, que la file d'envoi conserverait). Après une remise sur
  papier, la copie fait foi : les sections du salarié ne se modifient plus (`entretien.modifier`), la signature reste
  possible. Le premier téléchargement par le salarié, depuis son espace, est daté (`entretien.telecharger`, `telechargeLe`,
  tracé une fois). L'état de la remise s'affiche dans le compte rendu et dans la liste (« Remis », « Refus de signer »,
  « Mis à disposition », « Téléchargé »).
- **Espace manager** : ses propres entretiens (échéances, liste, indicateurs, pastille du menu) n'y figurent pas
  (`perimetreEntretiens`) ; son responsable les mène, il les prépare et les signe dans son espace collaborateur, vers
  lequel l'écran le renvoie (« Mes entretiens »). Les données restent transmises : rien ne change côté serveur.
- **Annulation et date dépassée** (`server/src/actions/annulation-entretien.ts`) : l'évaluateur ou le service RH annule un
  entretien planifié qui n'a plus lieu d'être (`entretien.annuler`, bouton « Annuler l’entretien » du compte rendu) ; il est
  retiré et l'obligation redevient à planifier. Un compte rendu commencé n'est supprimé avec lui que sur confirmation
  (`confirmer`, que la confirmation de l'écran n'envoie que si elle a annoncé un compte rendu commencé : écrit depuis par le
  salarié, il fait refuser l'annulation, 409, et l'évaluateur la reprend sur des données à jour). Date à venir : le salarié reçoit l'annulation
  de l'événement de sa convocation (`.ics` CANCEL, même UID `entretien-<id>`, e-mail `convocation.annulee`). Un entretien
  planifié dont la date est passée sans avoir été clos compte en retard dans `obligations()` (`st: 'late'`, libellé
  « Planifié, date dépassée » : `statutObligation`), entretien annuel de l'année compris, donc dans les indicateurs, la
  pastille du menu et le récapitulatif des échéances ; la liste et le compte
  rendu le signalent (« Date dépassée » : à clore s'il a eu lieu, sinon à reprogrammer ou à annuler).

## Déplacements dans la paie et registre des éléments de lot (lot 6, chantier 2)

- **Registre** (`server/src/elements-lot.ts`) : `FAMILLES`, une entrée par famille d'éléments qu'un lot emporte en plus des
  feuilles et des absences (`cle` du contenu figé et colonne du lot, `aEmettre`, `aSaisir`, `reserver`, `confirmer`,
  `liberer`, `avant`). `creerLot`, `paie.lotGenerer`, `temps.pushSage`, `paie.lotConfirmer`, `paie.lotAnnuler`, l'export des
  variables et le journal (salariés du lot, `sage.fichier`) les parcourent. Soldes de sortie (`FAMILLE_SORTIES`) : même
  comportement qu'au lot 5. Une famille nouvelle (heures de nuit, monétisation du CET) : un objet dans le fichier de son
  chantier, une ligne dans `FAMILLES`, une clé dans `SagePush` et `LotPaie`, une colonne json de `lotsPaie`.
- **À saisir dans Sage** (`shared/rules/elements-lot.ts`, règle commune) : un élément calculé dont la rubrique est
  désactivée (ou la famille laissée à Sage par un réglage) ne disparaît pas sans bruit : `resume.aSaisir` du lot (absences et
  déplacements sans code Sage, `contenu.aSaisir` des familles qui ne gardent pas leurs éléments inactifs : soldes de sortie),
  nominatif, affiché sur l'écran Temps (lots à confirmer et dernier lot transmis) et dans l'export des variables
  (« À saisir dans Sage »). Hors droit « paie », la rubrique d'une absence y est vidée (`sansCodesAbsences`).
- **Déplacements** (t031, `shared/rules/deplacements-paie.ts`, `server/src/deplacements-paie.ts`) : séjours = déplacements à
  l'étranger en vigueur (pays de la destination, jamais FR) et missions des chantiers en France qualifiés « grand
  déplacement » par le service RH (`chantiers.grandDeplacement`, `chantier.grandDeplacement`, écran Missions ; proposé pour
  tout chantier en France, retenu seulement une fois choisi) ; les missions d'un salarié qui se chevauchent ou se suivent
  forment un seul séjour (identifiant de la première ; chaque jour compté une fois). Par séjour et par mois : jours calendaires hors absences
  validées ou signalées et hors jours après la sortie (`GD_JOUR` ou `ETR_JOUR`), nuits = jours − 1 (`GD_NUIT`), trajets
  aller et retour (`TRAJET`) ; un mois clos part en rappel. Écart avec la table `deplacementsPaie` (lignes émises par les
  lots non annulés, supprimées à l'annulation, `sage` à la confirmation), par séjour, salarié, mois, rubrique et pays :
  une affectation réaffectée par Keystone se régularise chez l'ancien salarié et part chez le nouveau ; un séjour annulé, raccourci ou déqualifié se
  régularise en négatif sous le code d'origine ; un séjour réservé par un lot à confirmer attend. Intérimaires exclus.
  Rubriques désactivées par défaut et réglage `deplacementsFichierPaie` décoché par défaut (réponse du 18 octobre 2026) :
  l'élément part alors dans le lot sans code Sage (hors fichier, « à saisir dans Sage ») et ne repart pas une fois le lot
  confirmé — d'où aucune date de départ à poser quand le réglage est coché. Premier jour transmis : réglage
  `deplacementsPaieAPartirDu` et clé `deplacementsPaieDepuis` (migration `lot6-paie-deplacements-depart` d'une base qui a
  des séjours ou des lots, premier lot d'une base neuve ; journal `migration.deplacementsPaie`). Instantané : `deplacementsPaie`
  (éléments en attente par salarié, période, rubrique et pays ; chantiers à qualifier) pour le service RH, la paie et la
  lecture seule. Le fichier n'a pas de colonne de pays : `ETR_JOUR` s'additionne par salarié et période (une rubrique par
  pays ou par zone reste à décider avec la paie).
- **Vigilance, coordonnées, contact d'urgence** (t068, `shared/rules/vigilance.ts`, `server/src/vigilance.ts`) :
  `destinations.vigilance` (vert, jaune, orange, rouge ; null : non renseignée) et `vigilanceLe` (exigé avec une couleur,
  pas à venir), saisis dans `RefDestinationDialog`. Passage à l'orange ou au rouge : déplacements à venir ou en cours
  listés dans le message, salariés au journal, notification `voyage.vigilance` au manager de chaque voyageur et à la boîte
  du service RH avec la liste entière (exception assumée à « jamais la personne qui agit » : la boîte est partagée par les
  collègues qui suivent les déplacements ; `notifier(…, boitePartagee)`). Zone rouge : réserve `DEPLACEMENT` du Go / No Go (« Destination
  formellement déconseillée »), API Keystone inchangée. Rappel sur le dossier voyage tant que la vérification manque ou
  date de plus de `vigilanceRappelJours` (30). `voyages.hebergement`, `contactSurPlace` (textes, retirés hors du service
  RH, masqués au journal) et `arianeLe`, modifiables par `voyage.modifier` (Keystone compris, sans le prévenir).
  `employes.urgenceNom`, `urgenceTel` : retirés des vues du manager et des profils restreints, compris dans la fiche de la
  copie des données, mentionnés dans la page Confidentialité.

### Forfait jours : cumul, alertes, avenant de renonciation (lot 6, chantier 2, étape 2 : t043)

Règles : `shared/rules/forfait-jours.ts` ; serveur : `server/src/forfait-jours.ts` (contrôle de la validation, famille
« rachats » du registre) et `server/src/actions/forfait-jours.ts` ; écrans : `components/ForfaitJours.tsx` (fiche,
récapitulatif de la feuille, file de validation, jours rachetés en attente sur l'écran Temps), `dialogs/AvenantForfaitDialog.tsx`,
`pages/parametres/ForfaitJours.tsx`.

- **Cumul** (`cumulForfaitJours`) : jours des feuilles validées de l'année décomptées en forfait jours (régime figé de la
  feuille), une demi-journée jusqu'à 4 h et une journée au-delà (comme `calcSheet`), ventilés jour par jour (une semaine
  à cheval sur le 31 décembre compte pour ses deux années, comme `cumulAnnuel`). Cible : le forfait de la fiche au prorata
  de la présence et des périodes sous forfait jours (historique des contrats) ; cible à date ; jours de repos de l'année
  (`rttInfo`, inchangé) moins les jours rachetés (`reposForfaitInfo`, affichage seulement : `shared/rules/conges.ts`
  n'est pas modifié).
- **Plafond et alertes** : plafond = cible + jours rachetés par les avenants en vigueur de l'année. Alerte à
  `forfaitJoursAlerte` % (90) sur la feuille, la file de validation et la fiche, et dans le message de validation ; au-delà
  du plafond, `controleValidationForfait` (un seul appel dans `validerFeuille` de `server/src/actions/temps.ts`, par
  `controleForfaitJours`) exige le motif du valideur (`motifForfait`, colonne de `feuilles`, 500 caractères, journal :
  « [texte renseigné] ») ; la validation groupée la refuse et la nomme. La soumission n'est pas concernée.
- **Avenant** (table `avenantsForfait`, art. L3121-59) : fermé tant que `forfaitJoursRachat` n'est pas coché avec la
  référence de l'accord (`forfaitJoursAccord`, COHERENCE de `shared/reglages.ts`, art. L3121-63 et L3121-64 ; masquée au
  journal). Valeurs supplétives réglables : 235 jours au plus (`forfaitJoursPlafond`, art. L3121-66), majoration de 10 %
  au moins (`forfaitJoursMajorationMin`). Annulation avec motif (texte libre gardé sur l'avenant). Instantanés : service RH
  complet ; paie et lecture seule sans le motif d'annulation ; manager, pour son équipe directe, année, jours rachetés et
  dates ; ni majoration, ni référence, ni auteur, ni motif (le plafond affiché à la validation est celui du serveur) ;
  l'intéressé, les siens sans auteur ; référent HSE, rien (la fiche ne lui montre pas le bloc « Forfait jours »).
  Export des données du salarié : compris (sans les auteurs pour l'export remis à l'intéressé).
- **Paie** (famille `rachats` de `FAMILLES`, colonne `lotsPaie.rachats`, `SagePush.rachats`) : rubrique `JREN`, quantité
  en jours, taux de majoration en détail (export des variables) ; période : mois de la signature ou décembre de l'année
  (`forfaitJoursJren`), un mois clos partant sur la période ouverte. L'avenant en attente est toujours réservé par le lot
  de sa période (`lotId`), libéré à son annulation, transmis à sa confirmation ; l'annuler est refusé (409) tant que ce
  lot n'est pas confirmé. `JREN` désactivée par défaut (code à donner par la paie) : comme un déplacement, l'élément part
  dans le contenu sans code Sage (`codeSage` null), hors du fichier, listé « à saisir dans Sage » dans le résumé du lot
  (famille `rachats`) ; la confirmation de ce lot-là le règle hors fichier (`horsFichier`), d'après le contenu figé
  seulement (`confirmerRachats`) : un avenant enregistré après la génération attend le lot suivant, et une rubrique activée
  entre la génération et la confirmation ne le renvoie pas dans un autre fichier. Aucune migration : table et colonnes
  nouvelles seulement.

## Astreintes (lot 7, chantier A : t049)

- **Règles** (`shared/rules/astreintes.ts`) : une astreinte est une période planifiée par le manager ou le service RH
  (`astreinte.planifier`, `.modifier`, `.annuler` avec motif), communiquée au moins `astreinteDelaiPrevenance` jours avant
  (15 par défaut, art. L3121-9 ; en dessous, motif de circonstances exceptionnelles et jour franc au minimum), 31 jours au
  plus, refusée sur une absence, hors contrat ou pour un mineur (`astreinteMineurs`). Les interventions sont du travail
  effectif, déclarées sur la feuille de temps (`astreinte.intervention`, `.retirerIntervention` ; ligne `INT-AST` en
  lecture seule) avec contrôle du repos qui suit.
  Serveur : `server/src/astreintes.ts`, `server/src/actions/astreintes.ts` (journal, e-mail et .ics au salarié).
- **Écrans** : « Planning des astreintes » de l'écran Temps (manager, RH), encart « Astreinte » de la feuille de temps,
  « Mes astreintes » et récapitulatif mensuel imprimable du portail (art. R3121-2 : heures, périodes, interventions,
  forme de la compensation), section Paramètres → Astreintes (`client/src/pages/parametres/Astreintes.tsx`).
- **Paie** (`shared/rules/astreintes-paie.ts`, `server/src/astreintes-paie.ts`) : famille « astreintes » du registre des
  éléments de lot ; une astreinte terminée part avec le lot (heures `AST_H` réparties par mois, période `AST_PER`),
  réservée, libérée à l'annulation, figée à la confirmation (`astreintes.lot_id`, `astreintes.sage`). `AST_COMP`
  (compensation) est déclarée. Les trois rubriques sont inactives par défaut : éléments « à saisir dans Sage » tant que la
  paie n'a pas donné ses codes. Compensation `astreinteCompensation` : financière par défaut (réponse du 23 octobre 2026),
  ou repos ; son montant ou sa durée attend l'accord sur les astreintes (`astreinteAccord`).
- **Base** : migrations nommées `lot7-astreintes*` (SQLite) et `0005_astreintes.sql`, `0008_astreintes_paie.sql`
  (PostgreSQL). Aucune vue `pub_` pour Keystone tant qu'elle n'est pas demandée et validée.

## Déplacements modifiés ou annulés

*Déplacements importés du formulaire de demande* (`voyages.importer`, `parseTrips` de `shared/rules/imports.ts`) : une
ligne sans référence reçoit `DD-<n° du déplacement>`, comme dans le prototype (`referenceDeplacement` : suffixe si la
référence est déjà prise) ; les déplacements importés avant le lot 5 sans référence la reçoivent par la migration
`lot5-voyages-references` (tracée, `migration.referencesDeplacements`). L'origine affichée reste « Formulaire de demande »
sans « null ». La colonne « demandeur » est gardée (`voyages.demandeur`) : nom du salarié reconnu, sinon tel que saisi ;
montrée dans l'aperçu de l'import et le dossier voyage, retirée des instantanés manager, collaborateur et profils restreints.

Règles dans `shared/rules/deplacements.ts`, actions dans `server/src/actions/deplacements.ts`, écran Voyages (boutons
« Modifier le déplacement » et « Annuler le déplacement » du dossier voyage, `dialogs/TripModifierDialog.tsx`, confirmation
`state/confirmations-annulations.ts`).

- **Modification** (`voyage.modifier`) : dates, destination et motif, avec les contrôles de la création (destination du
  référentiel en vigueur ou déjà celle du déplacement, conflits de dates en excluant le déplacement lui-même, contrôlés seulement si les dates changent : les coordonnées sur
  place s'enregistrent malgré une absence signalée pendant le déplacement). Un
  déplacement venu de Keystone ne change que de dates (destination et motif sont ceux du chantier). Les formalités de
  détachement devenues caduques sont effacées (`formalitesCaduques`), et le dossier redevient incomplet : le certificat de
  sécurité sociale si le pays change ou si la période déborde de celle d'origine, l'information écrite d'une mission longue
  si le pays ou les dates changent.
- **Annulation** (`voyage.annuler`) : colonnes `annuleLe`, `annulePar`, `annuleMotif` (texte libre du service RH : retiré
  des instantanés manager, collaborateur et profils restreints ; le journal n'en garde que « renseigné » ; le salarié le
  retrouve dans la copie de ses données, `GET /api/mes-donnees`, au titre du droit d'accès). Motif obligatoire
  pour un déplacement venu de Keystone. Le déplacement reste en base et s'affiche dans « Déplacements annulés » (six
  derniers), mais `voyageActif` l'écarte de tous les calculs : `Domain.tripsAll` (dossier à préparer, tableau de bord,
  Go / No Go, verdicts transmis), conflits de dates, avertissements d'une sortie, acceptation d'une demande Keystone
  (`motifsRefusAcceptation`), déplacements prévus d'une destination, missions, relances. Annulé ou terminé (retour passé),
  un déplacement ne se modifie plus et ne s'annule plus (409) ; annulé, ses formalités de détachement non plus.
- **Keystone** : pour un déplacement d'origine `keystone`, `deplacement.modifie` et `deplacement.annule` (identifiant du
  déplacement, de la demande acceptée, référence, matricule, chantier, destination, dates ; jamais le motif) partent par la
  file d'envoi, simulés tant que `KEYSTONE_URL` n'est pas défini (docs/API-KEYSTONE.md) ; le verdict recalculé suit
  (`verdict.modifie`), toute action `voyage.*` relançant le recalcul.

## Récapitulatif des échéances

Règles dans `shared/rules/relances.ts`, envoi dans `server/src/relances.ts`, appelé par `tachesEmails` (tâches de fond des
e-mails, tous les quarts d'heure) : une fois par jour à partir de 7 h (réglage `relancesEcheancesLe` de la table
`settings`), le jour réglé, si le récapitulatif est actif (Paramètres → Messagerie · récapitulatif des échéances,
`pages/parametres/RelancesEcheances.tsx` ; réglages `relancesActives`, `relancesPaliers`, `relancesJour`).

- **Contenu** (`relancesDues`) : échéances du domaine (certifications, habilitations, visite médicale et visites dues à un
  événement, passeport, visas, vaccinations), déplacements au dossier incomplet (selon la date de départ), obligations d'entretien non planifiées ou
  planifiées à une date dépassée (entretien de mi-carrière compris), fins de contrat prévues sans sortie enregistrée, couverture minimale des équipes
  (premier jour sous le minimum, sans nom : service RH, manager de l'équipe, référent HSE). Écartés : salariés sortis, échéances
  déjà prises en charge (session planifiée, visite demandée), avis d'inaptitude, feuilles de temps (relance propre au suivi
  des feuilles). Une vaccination n'est qu'une « formalité sanitaire de voyage », une visite qu'une « visite médicale ».
- **Paliers** : 90, 30 et 7 jours avant l'échéance par défaut (90, 60, 30, 15, 7 au choix, un au moins), puis l'échéance
  dépassée. La table `relances` (clé de l'objet avec sa date d'échéance, palier, jour) retient chaque palier relancé :
  un objet n'est relancé qu'une fois par palier ; un renouvellement (nouvelle date) repart de zéro. Tant que la boîte du
  service RH (destinataire de tout le périmètre) n'est pas renseignée, le passage du jour n'envoie ni ne note rien : les
  paliers franchis partent au premier passage qui suit son réglage. Lignes de plus de 400 jours purgées.
- **Destinataires** : la boîte du service RH (tout) ; chaque manager d'une équipe, à l'adresse de sa fiche (ses membres
  sans lui-même, sans visite, vaccination ni entretien de reprise) ; chaque compte actif de référent HSE (formations et
  habilitations). Une même adresse reçoit un seul e-mail. Type `echeances.recapitulatif` de la file d'envoi.

## Plan de formation : coût réel et exercices

Règles dans `shared/rules/exercices.ts` et `shared/rules/budget.ts`, actions dans `server/src/actions/budget.ts` et
`server/src/actions/exercices.ts`.

- **Coût réel** : une action engagée passe « réalisée » avec son coût réel (`coutReel`, 0 accepté, 1 000 000 € au plus) et
  son effectif réel (`effectifReel`, facultatif), saisis dans `dialogs/PlanRealiserDialog.tsx`, préremplis du prévu. La
  clôture d'une session qui réalise l'action rattachée propose ce coût (`ClotureDialog`) ; le coût réel est réservé au service
  RH : sans coût transmis, ou pour le référent HSE (qui ne voit pas le plan), le coût prévu ; effectif réel : les présents de ses sessions clôturées. Le réalisé des enveloppes
  compte le coût réel, avec l'écart au prévu (`budgetSummary`). Les actions déjà réalisées d'une base existante reçoivent
  leur coût prévu comme coût réel (migration `lot4-entretiens-cout-reel`, tracée `migration.coutReel`).
- **Import « Remplacer »** : seules les lignes prévues d'origine `import` sont supprimées ; celles issues d'une demande
  acceptée (`demande`), d'un report (`report`) ou sans origine (anciennes bases, démonstration) sont conservées.
- **Exercices** : le sélecteur propose tous les exercices qui ont un plan ou des enveloppes, l'année en cours et la
  suivante ; « Reprendre les enveloppes de N » préremplit celles d'un exercice. `plan.cloturerExercice` (administrateur RH,
  exercice passé seulement : clos en cours d'année, ses actions engagées réaliseraient sur l'enveloppe suivante une
  dépense de l'année) fige le plan et les enveloppes (table `exercicesClos` : `plan.avancer`, `plan.importer`,
  `budget.enveloppes` et la création d'une session sur une de ses actions prévues sont refusés) ; les actions prévues ou
  engagées cochées sont recréées sur l'exercice suivant (premier trimestre, même coût prévu, même statut, origine `report`,
  `reportDe`), l'action d'origine passe « reportée » (hors des sommes) et ses sessions ouvertes suivent la nouvelle ligne.
  Le report est proposé, jamais imposé (les engagées sont cochées d'office). Une demande de formation acceptée s'ajoute au
  premier exercice ouvert (`exerciceOuvert`). La clôture d'une session réalise encore une action non reportée d'un
  exercice clos (le fait a eu lieu).

## Doublons et conflits de dates

`conflitsDates` (`shared/rules/conflits.ts`) liste les engagements d'un salarié qui chevauchent une période : absences
(en vigueur ou demandées), déplacements, sessions de formation où il est inscrit (`sessionsInscrit`), entretiens planifiés.
Il bloque quand le salarié est absent (absence validée ou signalée) ou qu'un engagement du même genre existe déjà
(deux déplacements, deux sessions le même jour), et avertit sinon. Les dialogues l'affichent en direct (`Controles`) ;
le serveur refuse les blocages (`blocage`) : `plan.inscrire`, `demande.formation`, `demande.accepter`, `voyage.creer`, `voyage.modifier`,
`voyages.importer` (lignes en conflit, ou qui se chevauchent dans le fichier), `keystone.accepter` (affiché sur la demande,
dans Voyages), `entretien.planifier`. Une absence posée sur une session, un déplacement ou un entretien n'est qu'avertie
(`checkAbsence`, `checkNature`) : à reprogrammer. La nature d'une absence médicale n'est jamais citée. S'y ajoutent les
doublons : demande de formation identique en attente ; entretien du même type déjà planifié, que la nouvelle date
reprogramme (`reprogrammation` de `shared/rules/entretiens.ts`) — passé avec un compte rendu commencé, il a pu avoir lieu :
il se clôt à sa date réelle, ou n'est reprogrammé que sur confirmation qu'il n'a pas été tenu.

## Absences hors congés

Référentiel `NATURES_ABSENCE` (`shared/constants.ts`) : santé (arrêt maladie, arrêt longue maladie, accident du travail
ou de trajet, maladie professionnelle), parentalité (maternité, paternité, adoption, congé parental), événements
familiaux (art. L3142-4), congé de deuil (L3142-1-1) et enfant malade (L1225-61), absences non payées (congé sans solde, absence injustifiée).
Chaque nature porte sa catégorie, sa rémunération (payée, indemnisée, non payée), son décompte (jours ouvrés ou
calendaires), le justificatif attendu, sa durée légale le cas échéant et l’effet attendu sur l’acquisition des CP.
Les durées sont les minimums du Code du travail : la CCN Industries chimiques peut être plus favorable, elles se
modifient dans ce référentiel ; un dépassement n’est qu’un avertissement. Le décès d’un enfant de moins de 25 ans
ouvre 7 jours ouvrés (art. L3142-4), auxquels s’ajoute le congé de deuil de 8 jours (`DEUIL_ENFANT`, art. L3142-1-1),
saisi à part dans l’année qui suit le décès. L’effet sur l’acquisition des CP (`cpAcquisition` : assimilé, maladie ou non, texte `cp`
affiché au service RH) est appliqué mois par mois (« Acquisition des congés payés pendant les absences »).
Règles : `shared/rules/absences.ts` (confidentialité, décompte, reprise, annulation, bornes du contrat) et
`checkNature` (`shared/rules/conges.ts`).

- **Circuit** : le salarié ou son manager signale une absence imprévue (`absence.signaler`, type `ABSENCE`, statut
  `signalee`, `signaleParInteresse` quand le salarié la signale lui-même) ; le service RH la qualifie
  (`absence.qualifier` : nature, justificatif reçu et sa date, dates corrigées), ce qui la valide. Le RH saisit directement une absence prévisible (`absence.saisir`). Une absence
  signalée compte aussitôt, comme une absence validée.
- **Prolongation** (`absence.prolonger`) : nouvelle fin, sans chevauchement ; la fin initiale est conservée
  (`finInitiale`). Prolongée par le salarié ou le manager, une absence qualifiée repasse « à qualifier ».
- **Motif de reprise** (`MOTIFS_REPRISE` de `shared/constants.ts`) : liste fermée des cas de l’art. L6315-1 (congés de
  maternité, d’adoption, parental, de proche aidant, sabbatique, temps partiel parental, mobilité volontaire sécurisée,
  mandat syndical, « absence longue »), sans texte libre ni information médicale : l’arrêt longue maladie s’inscrit
  « absence longue ». Contrôlé par `validerProfil` (formulaire et serveur) ; au démarrage, un ancien texte libre est
  ramené à la liste (`motifsDeReprise` de `server/src/migrate.ts`), un texte non reconnu devenant « absence longue ».
- **Confidentialité** : `dataset.ts` remplace pour le manager la nature médicale d’un membre de son équipe par
  `ABSENCE`, sans justificatif (`absenceVueManager`) ; le salarié voit ses absences en détail. Sont médicales (`medicale`)
  les arrêts (maladie, longue maladie, accident du travail ou de trajet, maladie professionnelle) et la santé d’un enfant
  (annonce d’un handicap, enfant malade). Keystone ne reçoit que l’identifiant de l’absence, le matricule et la période, jamais la nature (`absenceKeystone`). Les messages d’erreur ne
  nomment jamais une nature médicale, quel que soit le lecteur. La reprise inscrite par un arrêt longue maladie est
  masquée au manager (`repriseMedicale`) : une « Absence » suivie d’une reprise trahirait la nature de l’arrêt, les autres
  natures à reprise lui étant montrées en clair ; l’entretien de reprise est suivi par le RH. Limite : un entretien de
  reprise planifié reste visible du manager dans la liste des entretiens de son équipe.
- **Effets** : `joursAbsence` (feuilles de temps) couvre les absences validées et signalées ; une semaine dont aucun
  jour n’attend d’heure (absence, férié, jour non travaillé, hors contrat) se soumet sans heure. Les soldes CP / RTT
  ne sont débités que par les congés. La fin d’une maternité, d’une adoption, d’un congé parental ou d’un arrêt longue
  maladie inscrit la reprise sur la fiche (motif, premier jour ouvré suivant, `repriseAInscrire`). Seule l’écriture
  d’une absence de ces natures (saisie, qualification, prolongation, annulation) la recalcule : une reprise saisie ou
  effacée à la main n’est pas remise en cause par une autre absence. Sont conservées une reprise saisie à la main plus
  récente et une reprise antérieure à la nouvelle absence dont l’entretien (parcours ou reprise) n’est pas réalisé :
  l’obligation reste due, le message du RH indique la reprise à inscrire ensuite.
- **Annulation** (`absence.annuler`, statut `annulee`, date et auteur) : le salarié retire sa demande en attente, et
  son propre signalement tant qu’il n’est ni qualifié ni prolongé (`propreSignalement`) ; le manager direct ou le RH
  annulent une absence qui n’a pas commencé ; le RH seul une absence commencée ou passée. Hors de ce périmètre, le refus
  est le même quelle que soit l’absence. Le solde est recrédité, Keystone reçoit `absence.annulee` (une prolongation ou des dates corrigées renvoient `absence.validee` avec la période complète, sous le même identifiant) ; une feuille déjà
  validée n’est pas modifiée. Une feuille soumise sans heure que l’absence annulée (ou raccourcie par la qualification)
  couvrait est renvoyée au salarié pour saisie ; `temps.validate` refuse de toute façon une feuille sans heure dont la
  semaine n’est plus couverte.
- **Bornes du contrat** : aucune absence avant l’entrée ni après la fin du contrat (CDD, mission, alternance), aucune
  feuille pour une semaine entièrement hors contrat, aucune heure un jour hors contrat.
- **Base existante** : les colonnes des absences (signalement, justificatif, fin initiale, annulation) sont ajoutées
  au démarrage par le schéma déclaratif (`db.ts`), après une copie de sécurité ; les absences existantes sont reprises
  telles quelles (un signalement antérieur n’est pas réputé fait par l’intéressé : seul son manager ou le RH l’annule).

## Intégrations

- **Keystone → Cursus** : API `/api/integrations/keystone/v1` (en-tête `X-Api-Key`, variable
  `KEYSTONE_API_KEY`) — projets, chantiers, affectations, tâches, instantané, verdict Go / No Go,
  demandes ; les routes sans `/v1` restent servies comme alias obsolètes. Seuls des matricules et
  codes de motif sortent de Cursus.
- **Cursus → Keystone** : `server/src/integrations/keystone.ts` (`sendToKeystone`) met en file
  (`server/src/envois.ts`, table `envois`) les décisions sur les demandes de déplacement, les heures
  validées sur les projets Keystone (`heuresKeystone` : ni `INT-*`, ni `ECOLE`), les absences validées
  ou annulées (`absenceKeystone` : période, jamais la nature) et les verdicts modifiés. La mise en file
  se fait dans la transaction de l'action : une action refusée n'envoie rien. Le processus de fond
  (`demarrerEnvois`, toutes les 2 s) envoie un message à la fois par cible, dans l'ordre :
  `POST ${KEYSTONE_URL}/api/cursus/v1/evenements`, jeton `KEYSTONE_TOKEN`, en-tête `Idempotency-Key`
  (clé stable entre tentatives), 10 s au plus ; 2xx → envoyé avec l'accusé, 4xx (hors 408 et 429) →
  échec, sinon nouvelle tentative de 1 min à 1 h, 10 au plus. Sans `KEYSTONE_URL`, statut « simulé » et
  message écrit dans le journal. Suivi, relance et classement des échecs : Paramètres → Envois
  (`GET /api/envois`, RH ; lecture seule sans le contenu des e-mails de santé, `envoisPourLecteur`) ; l'état de l'intégration ne compte que les échecs non classés.
- **Verdicts Go / No Go** : `server/src/integrations/keystone-verdicts.ts` (`suivreVerdicts`) mémorise le
  dernier verdict transmis par chantier et ressource (table `verdictsKeystone`) et met en file
  `verdict.modifie` (codes de motif seulement) quand il change. Recalcul après chaque action, sauf les
  familles sans effet (`changeVerdicts` de `actions/index.ts` : temps, compteurs de congés, entretiens… ;
  les actions d'absence, qui peuvent bloquer une ressource, y donnent lieu), après
  chaque écriture de Keystone et une fois par jour. Les verdicts du jeu de démonstration sont mémorisés
  sans envoi. Ceux mémorisés en simulation ne sont pas réputés transmis : le réglage `verdictsKeystoneMode`
  retient le mode du suivi, et le premier calcul en mode API vide la table, d'où un premier verdict
  (`precedent: null`) pour chaque ressource suivie.
- **Cursus → Matrix** (catalogue des bases) : `server/src/integrations/matrix.ts`, portage du module de référence de
  Matrix (`integration/declarer-schema.mjs`, partie SQLite). Au démarrage, après `migrate(db)` et les migrations nommées,
  `declarerBase` lit le schéma réel (`sqlite_master`, `PRAGMA table_info`, `foreign_key_list`, `index_list` ; table
  technique `migrations` et tables internes `sqlite_*` écartées) et l'envoie, non attendu, à
  `POST ${MATRIX_URL}/api/declarations` (contrat `matrix.schema/1`, empreinte qui fait ignorer une déclaration
  inchangée ; jeton `MATRIX_TOKEN` dans `X-Matrix-Token`, identifiants de l'adresse en Basic, 10 s au plus). Sans
  `MATRIX_URL`, rien ne part ; `MATRIX_DECLARATIONS_DIR` écrit aussi `cursus.json`. Un échec n'écrit qu'un avertissement
  `[matrix]`. Les liens logiques entre tables (Cursus ne déclare pas de clés étrangères) sont ajoutés par le collecteur
  de Matrix.
- **Sage Paie** : `server/src/integrations/sage.ts`, mode `SAGE_MODE` (`sageMode`) : `simulation` (démonstration et
  développement : rien ne part, les feuilles sont marquées transmises et l'écran, la confirmation et le message le disent),
  `fichier` (mode de production par défaut : lot de paie, fichier d'import téléchargé par la paie, import confirmé, qui seul
  marque les feuilles transmises ; `temps.pushSage` y refuse sans rien marquer). Pas d'envoi par API (décision du
  15 octobre 2026 : la paie importe le fichier dans Sage) : `SAGE_MODE=api` est une valeur inconnue, refusée au
  démarrage en production ; la migration `lot5-paie-mode-api-retire` passe en `fichier` un lot historique de l'ancien
  mode. `SAGE_URL` ne fait rien basculer et est refusée en production (`server/src/config.ts`), comme la simulation hors
  application de bureau. `buildSagePayload` ne porte plus d'adresse d'envoi (`endpoint`, gardé dans les contenus figés
  d'avant le lot 5). Rubriques (`shared/rules/paie.ts`) : liste unique des codes internes
  (`RUBRIQUES_PAIE` de `shared/constants.ts`), correspondance enregistrée par rubrique modifiée (table `rubriquesPaie` ; sans
  ligne : code Sage égal au code interne, à confirmer), traduite par `buildSagePayload` (rubriques désactivées retirées,
  quantités nulles omises, deux rubriques sur un même code additionnées). Écran Temps (`components/LotsPaie.tsx`,
  `RubriquesPaie.tsx`) : l'administrateur RH et la paie saisissent et confirment les codes ; le service RH et la lecture
  seule consultent ; le manager, le collaborateur et le référent HSE ne reçoivent pas la table (`dataset.ts`). La file
  d'envoi (`server/src/envois.ts`) n'a pas de cible Sage : le suivi de la paie passe par les lots (statut, clé,
  téléchargements, confirmation datée et signée).
  - Lots de paie (`shared/rules/lots-paie.ts`, actions `paie.lot…` de `server/src/actions/paie.ts`, table `lotsPaie`) :
    cycle généré → transmis (confirmation de l'import, ou simulation) ou annulé avant la confirmation ; contenu figé
    (`SagePush` : une ligne par feuille et par période, matricule de paie, codes Sage), feuilles du lot gardées même après
    une annulation, `feuilles.lotId` (une feuille n'est que dans un lot actif ; `sagePending` : feuilles validées sans lot
    ni case `sage`). L'instantané (service RH, paie, lecture seule) porte les lots sans leur contenu, et le format du
    fichier ; le manager, le collaborateur et le référent HSE ne reçoivent ni l'un ni l'autre.
  - Fichier d'import (`GET /api/paie/lots/:id/fichier`, `server/src/fichier-paie.ts`, droit « paie ») : CSV d'une ligne par
    salarié, période et rubrique (quantités additionnées sur la période, rappel compris), colonnes, séparateur, période,
    décimale et en-tête réglés par `paie.formatFichier` ; refusé pour un lot annulé ou historique. Chaque téléchargement
    est compté sur le lot et tracé (`sage.fichier`, archive paie, salariés du lot).
    Colonnes facultatives, absentes par défaut : code dossier (`dossier` du contenu, `SAGE_DOSSIER`), libellé de la
    rubrique (figé à la génération ; lot plus ancien : libellés de la table en vigueur), début et fin de la période (mois
    civil, format de date réglable). Encodage : UTF-8 sans BOM par défaut, ou Windows-1252 (`shared/encodage.ts`, table
    sans dépendance ; un caractère absent devient « ? »), annoncé dans `Content-Type` (`charset`).
  - Reprise : migration `lot4-paie-lots-historiques` (feuilles déjà transmises sans lot réunies en un lot historique,
    transmis, sans contenu, périodes selon la règle de rattachement au jour de la dernière transmission, plus celles
    qu'elle avait annoncées ; journal `migration.lotsPaie`). Le réglage `lastSagePush` n'est plus écrit ni transmis.
  - Pas d'envoi automatique à Sage (décision du 15 octobre 2026) : ni cible `sage` dans la file d'envoi, ni connecteur.
  - Absences dans le fichier (lot 5, chantier I, t028 ; `shared/rules/absences-paie.ts`, `server/src/absences-paie.ts`) :
    réglage `absencesFichierPaie` (Paramètres → Absences et paie, `pages/parametres/AbsencesPaie.tsx`), activé par défaut.
    Rubriques internes `CP` (jours ouvrés), `RTT` (jours), `RECUP` (heures : jours × durée d'une journée), `ABS_NP` et
    `ABS_IND_` / `ABS_MAINT_` + `SANTE`, `PARENT` ou `FAMILLE` (`rubriqueAbsence` : rémunération et catégorie de la nature,
    `NATURES_ABSENCE`), à confirmer comme les autres. Quantités : jours décomptés de `Domain.countedDays` (0,5 la
    demi-journée), jours calendaires pour une nature décomptée ainsi (`uniteDecompte`), ventilés jour par jour sur leur mois
    (`partsAbsence`) ; un mois clos part sur la période ouverte (rappel). `elementsAbsences` : pour chaque absence validée
    (ou déjà partie), chaque mois et chaque rubrique, l'écart entre le dû et ce qu'ont emporté les lots non annulés (lus
    dans `contenu.absences`) — prolongation : nouveaux jours ; annulation, raccourcissement, requalification :
    régularisation négative dans le lot suivant ; absence réservée par un lot généré, demandée ou signalée (à qualifier) :
    rien ; intérimaires exclus. Le lot fige les éléments (`ElementAbsencePaie` : absence, salarié, matricule, mois, période,
    rubrique, code Sage figé ou null pour une rubrique désactivée, quantité, jours du mois) dans `contenu.absences`, la
    liste `absences` (identifiant, salarié) et `resume.absences` ; `absences.lotId` réserve (lot généré) ou désigne le
    dernier lot transmis (`libererAbsences` à l'annulation), `absences.sage` marque les jours transmis au moins une fois
    (confirmation). Le fichier additionne heures et absences par salarié, période et code Sage (`lignesFichier`). Un lot
    peut ne porter que des absences (régularisation). Message du service RH quand une absence déjà partie change
    (`suitePaie`). Une régularisation reprend d'abord ce qui est parti en dernier, sous son code Sage d'origine (pile par
    mois et rubrique ; null : parti sous une rubrique désactivée, jamais en négatif dans le fichier, listé « À saisir dans
    Sage » dans l'export des variables). Premier jour transmis (`premierJourTransmis`, `DepartAbsences`) : le plus tardif
    de la date de mise en service (réglage `absencesPaieAPartirDu`, Paramètres → Absences et paie, pour toutes les
    absences) et de la date de départ `absencesPaieDepuis` (table settings), qui ne vaut que pour les absences
    d'identifiant au plus `absencesPaieJusqua` (enregistrées quand elle a été posée : une absence d'un mois clos
    enregistrée ensuite part en rappel). Cursus pose la date de départ (`poserDepart`, premier jour de la période
    ouverte, une date plus tardive déjà posée gardée) par la migration `lot5-paie-absences-anterieures` sur une base qui
    portait déjà des absences validées, au premier lot de paie d'une base neuve (`departAuPremierLot`) et à la réactivation
    du réglage `absencesFichierPaie` (`reactivationAbsences`, `parametres.maj`) ; journal `migration.absencesPaie` (date,
    borne et nombre seulement). Jours d'avant : ni dus, ni régularisés ; le service RH est prévenu à l'enregistrement, la
    validation, la qualification ou l'annulation (`joursAvantDepart`).
    Confidentialité : le code révèle la catégorie (santé) ; le contenu ne quitte le serveur que par le fichier et l'export
    (droit « paie ») ; l'instantané porte `absencesPaie` (absences en attente par période : nombre, salariés,
    régularisations, rappels, rubriques) au service RH, à la paie et à la lecture seule, rubriques et codes de
    `resume.absences` retirés hors droit « paie » (`sansCodesAbsences`) ; `lotId` et `sage` des absences retirés pour le
    manager, le collaborateur et le référent HSE (`absenceSansPaie`). Journal des lots : identifiants des absences et
    salariés, jamais la nature ni la rubrique.
  - Réouverture et lots correctifs (lot 5, chantier A, t131 ; `shared/rules/regularisation.ts`,
    `server/src/actions/reouverture.ts`, `server/src/regularisation-paie.ts`) : `temps.rouvrir` (administrateur RH seul,
    motif obligatoire de 500 caractères au plus, réponse de l'entreprise du 17 octobre 2026) remet une feuille validée
    « soumise » ou « à corriger » et note la réouverture sur la feuille (colonne `feuilles.reouverture` : instant, auteur,
    motif, réouvertures précédentes). Refus : feuille d'un lot généré (annuler d'abord le lot), intérimaire dont le relevé
    est parti (table `releves`). Feuille transmise : `sage` et `lotId` vidés, rubriques déjà parties gardées en codes Sage
    par période d'origine (`reouverture.rubriques`, `transmisDeLaFeuille` : `contenu.rubriquesFeuilles` du dernier lot
    transmis qui la porte, figé par `buildSagePayload` pour chaque feuille depuis le lot 5 ; sinon ses lignes rapprochées
    par matricule et semaine ; sinon, lot historique sans contenu, la feuille recalculée telle que validée). Revalidée,
    elle revient dans `sagePending`, « à régulariser » (`aRegulariser`) ; `buildSagePayload` émet pour elle l'écart
    (`lignesRegularisation`, `correctif: true`) sur sa période d'origine si elle est ouverte, sinon sur la période ouverte
    avec `periode_origine` ; le lot porte `type: 'correctif'` et `correctifs` (salarié, semaine). Format du fichier sans
    quantité négative (`negatifs: false`, `paie.formatFichier`) : « annule et remplace » (`remplace: true`), rubriques
    complètes du salarié pour la période d'origine (autres feuilles transmises comprises, rouvertes depuis comprises avec
    les rubriques gardées à leur réouverture), une quantité nulle gardée dans le fichier ; ce lot correctif ne porte que
    les régularisations (`selectionRemplace` de `paie.lotGenerer` : feuilles ordinaires et absences laissées au lot
    suivant, 409 si un autre lot attend la confirmation de son import ou si un lot « annule et remplace » l'attend) ; `contenu.regularisation` dit le mode retenu à la génération. Keystone : `projetsRevalidation` renvoie à 0
    les projets déjà envoyés puis retirés, et une semaine vidée de toute heure Keystone envoie l'événement. Récupération
    (`recupInfo`, feuilles validées seulement) et COR (`corAValider`, `cor` vidé à la réouverture) se recalculent. Vues :
    manager et collaborateur reçoivent la réouverture sans motif, rubriques ni heures Keystone (`reouvertureNeutre`),
    sauf le commentaire d'une feuille renvoyée au salarié (le motif, que voient le salarié et son valideur ; `renvoyee`
    repasse à faux à la nouvelle soumission).
    Journal `temps.rouvrir` (action de paie, archive) : salarié, semaine, statut avant et après, renvoi, feuille
    transmise et son lot, jamais le motif. Reprise : migration `lot5-paie-rubriques-par-feuille` (rubriques par feuille
    des lots d'avant, d'après leurs lignes et le matricule actuel ; journal `migration.rubriquesFeuilles`). Les absences
    gardent leur propre régularisation (quantités négatives, `elementsAbsences`), sans « annule et remplace ».
  - Variables de la période (`GET /api/paie/variables/:periode`, `server/src/variables-paie.ts`, droit « paie ») : CSV
    (« ; », UTF-8 avec BOM) des lignes des lots générés ou transmis de la période puis de ce qui attend un lot : matricule
    de paie, salarié, code Sage, libellé, quantité, détail (semaine, ou absence et ses dates, rappel, régularisation, jamais
    la nature), lot, état ; écran Temps (`components/VariablesPaie.tsx`) ; tracé (`sage.variables`, archive paie,
    salariés concernés, période et nombre de lignes).
  - Soldes de sortie (lot 5, chantier I, t128 ; `shared/rules/solde-sortie.ts`, `server/src/soldes-sortie.ts`) : rubriques
    internes `ICCP_J` (CP à indemniser, jours ouvrés), `RTT_SOLDE` (jours), `RECUP_H` (heures), `CET_LIQ` (jours),
    désactivées par défaut (`inactiveParDefaut` de `RUBRIQUES_PAIE` : le solde de tout compte reste saisi dans Sage tant
    que la paie n'a pas donné ses codes). Une fois actives, le lot de la période du mois de la sortie (ou de la période
    ouverte s'il est clos) emporte le solde photographié (`elementsSorties` : quantités positives, rubriques actives,
    code Sage figé, `contenu.sorties`) ; réservé (`soldesSortie.lotId`), libéré à l'annulation du lot, marqué transmis
    (`sage`) à la confirmation, comme une absence ; un code à confirmer bloque un lot réel (409). Un solde n'émet qu'une
    fois : une rubrique activée après son départ ne le rattrape pas. Un solde de la période (ou d'avant) qu'aucune
    rubrique active n'emporte est réglé hors fichier à la confirmation du lot (`soldesHorsFichier` : `horsFichier`,
    `sage` et `lotId` du lot), la paie l'ayant saisi dans Sage. Lot possible sans feuille ; message, journal
    (`sorties` : identifiants) et variables de la période (« Solde de sortie au JJ/MM/AAAA ») les nomment. Le montant de
    l'indemnité (dixième ou maintien) reste calculé par Sage.
- **Suivi des feuilles de temps** (`shared/rules/suivi-feuilles.ts`, `client/src/components/SuiviFeuilles.tsx`,
  `server/src/actions/suivi-feuilles.ts`) : état de chaque semaine × collaborateur sur les `suiviSemaines` dernières
  semaines (attendue, non saisie, brouillon, à valider, à corriger, validée, transmise ; en retard après l'échéance
  `feuilleLimiteJour` / `feuilleLimiteHeure` de la semaine suivante, heure de Paris) ; semaines hors contrat, couvertes
  par une absence ou antérieures à la première feuille enregistrée exclues (début de la saisie calculé par le serveur sur
  toutes les feuilles et transmis dans l'instantané, `debutSaisieFeuilles` : le manager voit les mêmes retards que ceux
  que la relance envoie, même si son équipe n'a encore rien saisi). Service RH (par équipe), paie et lecture seule
  (consultation), manager (son équipe). Relance (`temps.relancer`, e-mail `temps.relance` au salarié et à son valideur,
  `server/src/notifications.ts`) et validation groupée (`temps.validerLot`). Réglages : Paramètres → Suivi des feuilles
  de temps (`pages/parametres/FeuillesTemps.tsx`).
- **Microsoft 365** : `server/src/microsoft.ts` (voir Sécurité) ; un compte Microsoft se retrouve par
  son `oid`, ou par son identifiant (adresse de connexion) à la première connexion.
- **E-mails** (`server/src/integrations/email.ts`, guide `docs/EMAILS.md`) : cible `email` de la file d'envoi,
  `POST https://graph.microsoft.com/v1.0/users/{CURSUS_MAIL_FROM}/sendMail` avec un jeton applicatif (client
  credentials, `fetch`, gardé jusqu'à 5 min de son expiration ; refusé par le service de jetons : échec
  définitif ; 401 de Graph : jeton renouvelé et nouvelle tentative). Configuration `configMail` de
  `server/src/config.ts` (variables `CURSUS_MAIL_*`, sinon `CURSUS_OIDC_*`) ; sans elle, statut « simulé » et
  ligne `email.<type>` au journal. Contenu (`Courriel` : destinataires, objet, texte brut, réponse au service
  RH, pièces jointes `.ics` ou CSV) mis en file dans la transaction de l'action. Jamais de donnée de santé, de
  nature d'absence médicale, de numéro de passeport ni de texte libre saisi (commentaire, motif).
  - Adresses (`server/src/messagerie.ts`) : `employes.email` (fiche, saisie par le RH, unique, en minuscules ;
    reprise de l'identifiant du compte Microsoft 365 à sa création, par `compte.creer` ou `npm run comptes`, et
    une fois pour une base existante), réglage `messagerie` (boîte du service RH et son mode, service de santé au
    travail, agences d'intérim avec la date `depuis` où leur adresse a été renseignée).
  - Notifications (`server/src/notifications.ts`) : demande de congés → valideur ; décision ou congés posés →
    salarié ; feuille soumise → valideur ; feuille renvoyée → salarié ; compte rendu d'entretien clos →
    salarié ; réponse à une demande au service RH → salarié et manager demandeur. Valideur sans manager : la
    boîte du service RH. Ni à l'auteur de l'action, ni à un salarié sans adresse ou sorti. Réglage
    `employes.notifications` : aussitôt, ou table `notifications` regroupée chaque jour à partir de 7 h
    (`tachesEmails`, relevé tous les quarts d'heure par `planifierEmails` ; réglage `recapitulatifLe`) ou sur
    demande (`messagerie.recapituler`), à l'adresse en vigueur à l'envoi (destinataire sorti ou sans adresse :
    notifications closes sans envoi). Convocations (formation, entretien) et mise à disposition d'un compte rendu d'entretien
    (lien vers Cursus seulement, `server/src/actions/remise.ts`) : toujours aussitôt.
  - Relevés des intérimaires (`server/src/releves.ts`, règles `shared/rules/releves.ts`) : par agence et par
    semaine, heures des feuilles validées (par jour, normales, majorées), jours d'absence sans leur nature,
    CSV joint, heures au centième. Envoi automatique (`semainesAutomatiques` : les cinq semaines précédentes, et la
    semaine en cours après son vendredi, sans remonter avant la semaine qui précède l'adresse de l'agence) quand
    toutes les feuilles de l'agence sont validées, à la validation de la dernière (`temps.validate`) et par les
    tâches de fond, si la semaine n'a pas été transmise ou si le dernier envoi était incomplet ; envoi (feuilles
    en attente comprises) ou renvoi par le RH (`releve.envoyer`). Chaque envoi est conservé (table `releves`, avec
    le nombre de feuilles alors en attente `enAttente` ; instantané RH `releves` avec le statut de l'e-mail).

## Mise en service : reprise depuis Lucca

Écran `pages/MiseEnService.tsx` (vue `miseEnService`, hors du menu, ouverte depuis Paramètres → Mise en service,
`pages/parametres/Reprise.tsx`), règles `shared/rules/reprise.ts`, action `reprise.importer` (`server/src/actions/reprise.ts`),
procédure dans `docs/DEPLOIEMENT.md` (« Procédure de reprise »).

- **Lecture** : `lireCsv` (`shared/rules/imports.ts`, aussi pour le plan et les déplacements) : BOM, séparateur détecté
  hors guillemets, cellules entre guillemets (« ; », guillemets doublés, sauts de ligne), numéro de ligne gardé pour le
  compte rendu. Colonnes reconnues par leur en-tête (`reconnaitreColonnes` : nom exact, sinon contenu, le plus long
  l'emporte), puis rapprochées à la main dans l'aperçu ; un modèle CSV par import (`modeleReprise`).
- **Analyse partagée** (`analyserReprise`) : l'aperçu et le serveur calculent la même issue par ligne (ajout, mise à
  jour, ignorée, refusée avec ses motifs) ; le serveur n'écrit que les lignes retenues, dans une transaction. Salariés :
  rapprochés par matricule de paie, sinon nom et date d'entrée (matricule trouvé sous un autre nom ou une autre date
  d'entrée : refus, faute de frappe probable) ; « Non cadre » repris ouvrier / employé avec un avertissement ; case des
  comptes cochée (`avecCompte`) : une fiche à jour sans compte devient une mise à jour qui l'ouvre ; contrôles de `validerProfil` (doublons du fichier
  compris) ; réembauche sur un matricule et visite sans avis confirmées ligne par ligne (`confirmations`) ; sortie et
  changement de régime d'une fiche qui a déjà des feuilles ou des absences refusés (à faire depuis la fiche). Titres :
  catalogue exigé, prérequis en avertissement ; habilitation et visite : la plus récente du fichier l'emporte, une
  plus récente déjà enregistrée n'est pas remplacée. Avis : la négation d'abord (« non apte » : inapte, « apte sans
  restriction » : apte).
- **Soldes repris tels quels** : colonnes `cpSolde`, `cpSoldeSuivant`, `rttSolde`, `cetSolde` de `soldesReprise` (la
  récupération va dans `recupAcquis` / `recupPris`) ; `reprise()` de `shared/rules/conges.ts` en déduit les jours pris à
  partir des droits calculés à la date d'arrêté (CP acquis de la période, jours acquis sur la période suivante, RTT de
  l'année) : le solde affiché à cette date est celui de Lucca, même si la fiche est corrigée ensuite. Le CET repris
  s'ajoute au total de `cetInfo`. Même date d'arrêté qu'un import précédent : seuls les compteurs du fichier changent
  (cellule ou colonne absente : compteur gardé) ; autre date : la ligne est remplacée (aperçu averti). Pas de soldes
  sur sa propre fiche (`soiMeme`, comme `report.accorder`).
- **Lots** (table `reprises`, `Dataset.reprises`) : type, date, auteur, colonnes, options, décompte et compte rendu
  (nominatif) ; jamais le fichier. Pas de donnée de santé dans le compte rendu : une visite écrite y figure par sa date
  seule (« Visite du … reprise »), sans avis ni avertissement qui le laisse deviner, et un avis illisible n'est jamais
  recopié dans un motif. Le compte rendu ne porte donc que noms, issues et motifs administratifs ; il reste le temps
  de la reprise (les lots ne sont pas purgés) et n'entre pas dans l'export des données d'un salarié (pas de colonne
  `empId`) : les données qu'il décrit y sont, sur leurs propres tables. Transmis au service RH seul (vide pour le manager, le collaborateur et les profils
  restreints) ; « Rejouer » reprend colonnes, rapprochements et date avec un fichier rechargé.
- **Journal** : code `reprise.<type>` (`code` de la règle), type, date de reprise, case des comptes, décompte, salariés
  concernés, comptes Microsoft 365 ouverts (`comptesOuverts` : fiche et identifiant de chacun, comme `compte.creer`) ; `reprise.soldes` dans `ACTIONS_PAIE`, `reprise.visites` masqué pour la lecture seule (`ACTIONS_SANTE`).
