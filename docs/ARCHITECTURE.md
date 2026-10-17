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
  journal.ts       Journal des actions : libellés, familles, actions liées à la paie, durées de conservation, droits de lecture
  reglages.ts      Réglages de Paramètres : table « champ → contrôle » (valeur par défaut, contrôle de chaque champ de Settings)
  confidentialite.ts Page Confidentialité : texte de l'information des salariés (art. 13), contrôle des coordonnées du
                   responsable et du DPO (descriptif complet du traitement : docs/RGPD.md)
  rules/           temps.ts, conges.ts, entretiens.ts, budget.ts, imports.ts, sante.ts (avis et visites médicales) ;
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
                   deplacements.ts (déplacement modifié ou annulé), relances.ts (récapitulatif des échéances par paliers)
server/src/
  db.ts            Schéma déclaratif SQLite + requêtes génériques (all/get/insert/update/remove/tx)
  migrate.ts       Reprises des bases antérieures, rejouées à chaque démarrage (idempotentes)
  migrations/      Migrations nommées, exécutées une seule fois par base : cadre.ts (contrôle et exécution), liste.ts (ordre),
                   outils.ts (reconstruction d'une table, index), un fichier par chantier (voir « Cadre commun du lot 4 ») :
                   exploitation.ts (index), entretiens.ts (coût réel des actions déjà réalisées), referentiels.ts (postes
                   créés depuis les intitulés des fiches), paie.ts (mode des heures supplémentaires, lot de paie historique),
                   voyages.ts (référence DD-<n°> des déplacements importés sans référence, lot 5)
  seed.ts          Données de démonstration
  sauvegarde.ts    Copie à chaud (VACUUM INTO), rotation, restauration, verrou du serveur ;
                   scripts backup.ts et restore.ts (npm run backup / restore, voir docs/SAUVEGARDE.md)
  dataset.ts       Assemblage de l'instantané + restriction par rôle (RH / profil restreint / manager / collaborateur)
  auth.ts          Sessions en base (cookie signé, 12 h, révocation) : un compte et l'espace actif
  comptes.ts       Comptes nominatifs (Microsoft 365 ou compte local), espaces, mots de passe (scrypt), journal
  connexion.ts     Routes de session : /api/session, /api/mode, /api/login, /api/motdepasse, /api/logout, /api/comptes
  microsoft.ts     Connexion Microsoft 365 (OpenID Connect, PKCE) : /api/auth/microsoft et /api/auth/microsoft/retour
  comptes-cli.ts   npm run comptes -- admin <identifiant> : premier administrateur RH (docs/DEPLOIEMENT.md)
  config.ts        Variables d'environnement, contrôlées au démarrage (refus en production si dangereuses)
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
                   d'import d'un lot (GET /api/paie/lots/:id/fichier, tracé)
  donnees.ts       Données personnelles d'un salarié (droit d'accès) : export RH et téléchargement par l'intéressé
  confidentialite.ts Coordonnées de la page Confidentialité : GET /api/confidentialite, lisible sans connexion
  messagerie.ts    Adresses (fiche, service RH, santé au travail, agences), forme commune des e-mails
  notifications.ts Notifications d'étapes (aussitôt ou récapitulatif quotidien), convocations .ics, tâches planifiées
  releves.ts       Relevés d'heures hebdomadaires des intérimaires envoyés à leur agence
  relances.ts      Récapitulatif des échéances par paliers (RH, managers, référent HSE), relances notées (table relances)
  integrations/    Adaptateurs Keystone, Sage Paie et e-mails (email.ts : Microsoft Graph, .ics ; simulation par défaut) ; API Keystone entrante :
                   keystone-entrant.ts (contrôles, écritures, instantané) et keystone-routes.ts (routes /v1) ;
                   keystone-verdicts.ts (verdicts Go / No Go transmis, changements signalés)
  index.ts         Démarrage (dans l'ordre : configuration, droits, verrou, migrations, tâches) et routes HTTP
client/src/
  state/store.tsx  Session, données, navigation, filtres d'écran (ui), dialogue ouvert, notifications, reconnexion
  state/brouillon.ts Brouillon gardé dans l'onglet pendant une reconnexion Microsoft (page, filtres, dialogue, champs)
  state/actions.ts Actions identiques jamais envoyées deux fois à la fois, garde des boutons (useAgir : double clic)
  state/revision.ts Instantané plus ancien que celui affiché ignoré (révision de la base : réponses dans le désordre)
  state/enregistrement.ts Enregistrement au fil de la saisie (sections du compte rendu d'entretien), arrêté par l'abandon
  state/confirmations.ts Confirmations des refus (motif) et des actions irréversibles, affichées par dialogs/ConfirmerDialog.tsx
  state/derived.ts Hooks mémorisés : useDomain, useEnriched, useTrips, useRole
  components/      ui.tsx (Page, Kpi, Panel, Tag, Seg, Two, Bar…), Dialog.tsx (Dialog, Field…) et
                   ErreurRendu.tsx (erreur de rendu d'une page, d'un dialogue ou de l'application)
                   focus.ts (focus des fenêtres modales), controles.ts (messages d'erreur des champs),
                   panneau.ts (panneau de détail amené dans le champ de vision sur écran étroit),
                   LotsPaie.tsx et RubriquesPaie.tsx (lots de paie, fichier d'import et rubriques de paie, écran Temps) ;
                   SuiviFeuilles.tsx (suivi des feuilles semaine par semaine, relance, validation groupée, écran Temps) ;
                   media.ts (requête média suivie), heures.ts (cellule d'heures, vue « un jour ») ;
                   Cliquable.tsx (bouton « Ouvrir » d'une ligne cliquable, carte sélectionnable CartePick)
  listes-csv.ts    Exports CSV des listes (annuaire, registre des habilitations, soldes, absences, plan de formation)
  layout/Shell.tsx Barre latérale, en-tête, notification ; layout/Reconnexion.tsx : session expirée, par-dessus l'écran ;
                   layout/Tiroir.tsx : menu en tiroir sur écran étroit ; layout/navigation.ts : titre de l'onglet, focus
                   sur le titre après un changement de page
  pages/           Un fichier par écran ; pages/parametres/ : une section de l'écran Paramètres par fichier (sections.tsx)
  dialogs/         Un fichier par dialogue, rendus par DialogHost
  styles/          nocturne.css (design system, ne pas modifier) et app.css (mise en page)
design/            Prototype Claude Design de référence et guide du design system Nocturne
deploy/            Fichiers d'installation prêts à copier (unités systemd, Caddyfile, copie externe), identiques à la doc
Dockerfile         Image facultative (hébergeur à conteneurs) ; .dockerignore
scripts/           dev.mjs (npm run dev), start.mjs (npm start : production, Windows compris)
.github/workflows/ ci.yml : npm ci puis npm run check, Node de .nvmrc
```

## Flux de données

1. `GET /api/data` renvoie l'instantané `Dataset` **déjà restreint au périmètre**
   de l'utilisateur : un manager ne reçoit que son équipe, sans données de santé
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
     - feuilles de temps jour par jour sous 600 px ou sur écran tactile (`pages/SaisieJour.tsx`, `VUE_JOUR`) : cinq
       jours avec leur total, une ligne par projet avec un champ de 44 px en 16 px, total du jour et de la semaine,
       même action `temps.setCell` ; « Ajouter un projet » et la soumission restent dessous. Ouverte sur aujourd'hui
       (le vendredi un week-end, le lundi d'une autre semaine), jour choisi gardé dans `ui.tsJour`. Le PC garde la
       grille de la semaine ;
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
  sans `CURSUS_MAIL_FROM`), `CURSUS_SUPERVISION_TOKEN` de moins de 32 caractères, Sage Paie (`SAGE_MODE` inconnu ou `api`,
  `SAGE_URL` définie, `SAGE_MODE=simulation` hors application de bureau : des feuilles seraient marquées transmises sans
  que rien ne parte) ; puis, base accessible à d'autres comptes (« Exploitation »).
  Le mode démonstration ne s'active qu'avec `CURSUS_DEMO=1` ; en production (application de bureau),
  `demoPosteLocal` (`server/src/securite.ts`) refuse en plus (403) toute requête relayée par un proxy
  ou adressée à un autre nom que la boucle locale.
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
  manager comme pour ces profils) ; le référent HSE ne reçoit ni temps, ni absences, ni entretiens, ni plan ; la paie ni formations, ni
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
  origine ne peut envoyer que du texte sans autorisation CORS, que Cursus n'accorde jamais). Une requête sans corps
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
- **Santé** (`server/src/supervision.ts`) : `GET /api/health`, monté avant le limiteur de débit et les autres routes
  `/api`, sans connexion. `SELECT 1` et `PRAGMA user_version` ; 200 `{statut: 'ok', base: 'ok'}`, 503
  `{statut: 'indisponible', base: 'erreur'}`. Appel local non relayé (boucle locale, aucun en-tête `X-Forwarded-*`) ou
  `Authorization: Bearer` égal à `CURSUS_SUPERVISION_TOKEN` : en plus `version`, `mode` (`production`, `demo`,
  `developpement`), `envoisEnEchec` (non classés, toutes cibles) et `depuis`. Jamais de donnée personnelle.
- **Base sur le disque** (`server/src/protection.ts`) : `protegerBase` ramène la base et ses fichiers `-wal`, `-shm`
  en `600` et son dossier en `700` (créé ainsi ; un dossier partagé — bit sticky, racine du système ou du projet,
  dossier de lancement, autre propriétaire — n'est jamais modifié, avertissement ; le dossier personnel du compte de
  service, `/var/lib/cursus`, est bien restreint) ; en production, `ProtectionError`
  (démarrage refusé, code 1) si un fichier reste accessible à d'autres comptes. Une base neuve est créée vide en `600`
  par le constructeur `Db`, avant que SQLite ne l'ouvre. `retirerSecretStocke` supprime le réglage `secret` (clé de
  session générée sans `CURSUS_SECRET`) dès que la variable est définie, avec `secure_delete` puis
  `wal_checkpoint(TRUNCATE)` : la clé ne reste ni dans une page libérée ni dans le `-wal`. Pas de chiffrement applicatif des colonnes :
  disque chiffré chez l'hébergeur (prérequis de `docs/DEPLOIEMENT.md`), avis du DPO attendu.
- **Installation** : `deploy/` reprend à l'identique les blocs de `docs/DEPLOIEMENT.md` et `docs/SAUVEGARDE.md`
  (`tests/exploitation.test.ts` les compare : modifier les deux ensemble) ; `Dockerfile` facultatif.

## Vérification du code

`npm run check` = `typecheck`, `test:coverage`, `build` : ce que la CI exécute (`.github/workflows/ci.yml`, après
`npm ci`, Node de `.nvmrc`, essai non bloquant sur Node 24, `dist/` publié en artefact). `test:coverage` mesure la
couverture des lignes, branches et fonctions du serveur et de `shared/` (`client/`, `tests/` et `scripts/` exclus tant
que le client n'a pas de tests de rendu) et échoue sous les seuils écrits dans le script (`--test-coverage-lines`…),
fixés juste sous la mesure du jour : les relever quand des tests s'ajoutent, jamais les baisser pour faire passer un
ajout non testé. Les serveurs lancés par les tests avec l'environnement du test sont mesurés aussi. Un contrôle de
style (lint) s'ajoutera à `check` quand il existera. `@types/node` suit Node 22.

## Conventions d'écran

- Reprendre fidèlement le prototype `design/prototype-suivi-formations.dc.html`
  (structure, libellés, ordre des colonnes, textes d'aide). Ses valeurs calculées sont
  dans `renderVals()` ; les règles correspondantes existent déjà dans `shared/`.
- Utiliser les composants de `components/ui.tsx` et `components/Dialog.tsx` et les
  classes de `styles/app.css` ; les couleurs, espacements et rayons viennent toujours
  des variables Nocturne (`var(--color-*)`, `var(--space-*)`…), jamais de valeurs en dur.
- Les filtres et sélections persistants entre écrans vivent dans `ui` (`useStore().ui`,
  `setUi`) ; l'état local d'un formulaire vit dans le composant.
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

`npm run comptes` et `npm run reset-demo` (`controlerPourOutil`) font le même contrôle, puis, service arrêté, mettent la
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
     necessaire: db => …,                                // facultatif ; faux : notée faite, sans être exécutée
     executer: db => { …; return `${n} lots repris`; },  // compte rendu facultatif, affiché au démarrage
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
| `employe.modifier` | id + champs de la fiche (l'écran n'envoie que ceux modifiés), avant? (valeur à l'ouverture de chaque champ envoyé, et d'eux seuls, sinon 400 : un champ changé entre-temps fait tout refuser, 412, rien n'est enregistré ; auteur nommé au service RH seul ; jamais recopié au journal), reutiliserMatricule?, `confirmerRtt` (changement de régime qui ferme le compteur de RTT de l'année) ; ni le motif ni la date d'une sortie enregistrée | RH : tous ; manager : `poste` (intitulé précisé ; le poste du référentiel, `posteId`, reste au RH), `jourOff` (temps partiel) des membres de son équipe ; changer ou retirer un matricule de paie déjà enregistré, réutiliser celui d'un salarié sorti : administrateur RH |
| `employe.sortie` | id, date (dernier jour du contrat), motif (`MOTIFS_SORTIE`) ; refusée tant que le salarié encadre une équipe, qu'une feuille porte des heures après la date, qu'une absence est à cheval sur elle, au-delà de la fin prévue du contrat ou quand aucun autre administrateur RH ne reste en place après la date ; une sortie enregistrée se modifie par la même action | RH (jamais pour lui-même) ; administrateur RH seul pour un salarié dont le compte ouvre l'espace RH |
| `employe.autorisationTravail` | id, requise (faux : ressortissant français, de l'UE, de l'EEE ou de la Suisse, titre effacé), type (`TYPES_TITRE_SEJOUR`), numero, expire (sauf résident permanent), demandeLe (envoi de la demande d'authentification) et verifieLe (réponse de la préfecture), jamais futures ; avertissements sans blocage (titre expiré, demande d'authentification non tracée ou tardive) ; journal : codes et dates validés seulement ; refusée pour un salarié sorti | RH (jamais pour lui-même) |
| `employe.annulerSortie` | id : fin prévue au contrat rétablie (aucune pour un CDI, même devenu CDI depuis la sortie) ; ce que la sortie a annulé ne l'est pas | RH (jamais pour lui-même) ; administrateur RH seul pour un salarié dont le compte ouvre l'espace RH |
| `equipe.creer` / `equipe.renommer` | nom, managerId? / nom, nouveau | RH |
| `equipe.supprimer` | nom | administrateur RH |
| `equipe.manager` | nom, managerId (null = aucun) | RH |
| `equipe.modifier` | nom, nouveau? (absent : inchangé), managerId? (null = aucun ; absent : inchangé) : renommage puis manager dans une seule transaction, avec les contrôles de `equipe.renommer` et `equipe.manager` ; un refus n'enregistre rien (dialogue de l'équipe) | RH |
| `equipe.affecter` | empId, equipe (null = à affecter) | RH ; manager : ajout à une équipe qu'il encadre d'un salarié « à affecter » (libéré par son manager) ou d'un membre d'une autre de ses équipes, retrait d'un membre — jamais le membre d'une autre équipe : sa mutation relève du RH |
| `plan.inscrire` | empId, certId (recyclage) ou inscriptionId (formation initiale à replanifier), sessionId, conv (`now`/`later`) ; refusé depuis une session passée non clôturée, et si le salarié est absent ou inscrit à une autre session ce jour-là ; convocation reçue pour l'ancienne session à venir annulée par e-mail | RH, référent HSE, manager direct |
| `convocation.envoyer` | sessionId, empIds? (sans liste : toutes les convocations « à envoyer » ; avec : envoi ou renvoi) ; session à venir ; e-mail avec `.ics`, date d'envoi `convocLe` | RH, référent HSE ; manager direct pour les membres de son équipe |
| `plan.desinscrire` | empId, sessionId (session à venir) : place libérée, recyclage de nouveau à planifier ou inscription initiale retirée, convocation reçue (même remise « à renvoyer ») annulée par e-mail | RH, référent HSE, manager direct |
| `cert.ajouter` | empId, f, date | RH, référent HSE |
| `session.creer` | f, date (postérieure à aujourd’hui), lieu, places (entier ≥ 1), planId? (action « prévue » de la même formation) | RH, référent HSE |
| `session.confirmer` | id | RH, référent HSE |
| `session.modifier` | id, date? (postérieure à aujourd’hui ; session passée, à clôturer : aussi une date passée), lieu?, places? (≥ inscrits) | RH, référent HSE |
| `session.annuler` | id, motif? | RH, référent HSE |
| `session.cloturer` | id, participants [{empId, present, reussi?}], note? (1 à 5), commentaire?, coutReel? (de l'action du plan qu'elle réalise, service RH seulement ; coût prévu par défaut et pour le référent HSE) | RH, référent HSE |
| `hab.delivrer` | empId, h, date, par, mode | RH, référent HSE |
| `hab.suspendre` | empId, h, motif, date? (aujourd’hui par défaut) | RH, référent HSE ; manager pour un membre de son équipe (jamais lui-même) |
| `hab.lever` | empId, h | RH, référent HSE |
| `hab.retirer` | empId, h, motif, date? | RH, référent HSE |
| `referentiel.formation.enregistrer` | code (création) ou id (modification : le code ne change pas), nom, court, type, validite (mois, 1 à 240), duree?, organisme?, cout?, validation (`presence`/`evaluation`) ; message : titres devenus échus si la validité change, ligne du journal rattachée à leurs titulaires | RH, référent HSE |
| `referentiel.formation.archiver` | id, archive? (faux : rétablie) ; refusé tant qu'une habilitation en vigueur l'exige en prérequis ou qu'une session est ouverte ; message : demandes des collaborateurs restées en attente | RH, référent HSE |
| `referentiel.habilitation.enregistrer` | code ou id, nom, detail?, prereqs (formations du catalogue en vigueur ; une habilitation archivée garde ceux déjà inscrits, archivés depuis), medical, validite, signataire (proposé à la délivrance) ; message : titres devenus échus, ligne du journal rattachée à leurs titulaires | RH, référent HSE |
| `referentiel.habilitation.archiver` | id, archive? ; rétablissement refusé tant qu'un prérequis est archivé (formation à rétablir d'abord) ; message : titres demandés et demandes restés en attente | RH, référent HSE |
| `referentiel.destination.enregistrer` | code (pays ISO à deux lettres, pas FR) ou id, pays, visa (`VISA_RULES`), visaSub?, oblig [vaccins], rec [vaccins, sans le DTP], passMois (0 à 24), secu? (vide : selon le code pays) | RH |
| `referentiel.destination.archiver` | id, archive? | RH |
| `referentiel.poste.enregistrer` | id? (modification ; sans : création), nom (80 caractères, unique parmi les postes en vigueur), formations [codes], habilitations [codes] (en vigueur ; déjà exigés et archivés depuis : gardés) ; message : salariés qui deviennent non conformes (ligne du journal rattachée à eux), intitulé recopié sur les fiches des titulaires | RH |
| `referentiel.poste.archiver` | id, archive? ; refusé tant qu'un salarié présent occupe le poste ; rétablissement refusé si un poste en vigueur porte le même intitulé | RH |
| `referentiel.equipe.exigences` | nom (équipe), formations, habilitations (vides : aucune exigence commune) ; message comme pour un poste | RH |
| `hab.demander` | empId, h : habilitation exigée jamais délivrée, titre « en attente » de délivrance (déjà demandée : rien n'est refait ; déjà délivrée ou archivée : refus) | RH, référent HSE |
| `referentiel.charger` | referentiel (`formations`/`habilitations`/`destinations`) : référentiel type (celui de la démonstration) chargé dans un référentiel vide, archivés compris ; habilitations après les formations (prérequis présents et en vigueur) | RH, référent HSE (destinations : RH) |
| `medical.demander` | empId, motif? (`periodique`/`embauche`/`reprise`/`employeur` ; par défaut embauche sans visite enregistrée, sinon périodique) ; e-mail au service de santé au travail | RH (une demande en cours par collaborateur) |
| `medical.annuler` | id | RH (demande de visite en cours) |
| `medical.avis` | empId, date (passée), avis (`apte`/`restrictions`/`inapte`), restrictions [{texte, jusquau?}] (avis avec restrictions), suspendre [h]?, lever [h]? | RH (suspensions « Restriction d’aptitude » ; levée des seules suspensions d’un avis précédent, jamais pour un avis d’inaptitude) |
| `demande.accepter` / `demande.refuser` | id ; refus : motif? (500 caractères, `motifRefus`, montré au collaborateur seul, même quand son manager a fait la demande) ; acceptation refusée quand la formation ou l'habilitation demandée a été archivée depuis (à refuser, ou à rétablir d'abord) | RH ; référent HSE pour une demande de formation ou d'habilitation (document déclaré : RH) |
| `demande.formation` | f (ou `autre`), libelle, sessionId, motif, empId (manager) ; refusée si une demande identique attend (même formation, ou même intitulé hors catalogue), si le salarié est déjà inscrit à une session à venir, ou absent le jour de la session souhaitée | collaborateur pour lui-même, manager pour un membre de son équipe |
| `demande.habilitation` | h, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `voyage.creer` | empId, dest, depart, retour, motif ; refusé s'il chevauche un autre déplacement ou une absence en vigueur | RH |
| `voyage.detachement` | id, detachementLe?, informationLe? (date passée ; vide : saisie effacée) ; déplacement annulé refusé | RH (certificat de sécurité sociale du détachement, information écrite d’une mission de plus de 4 semaines) |
| `voyage.modifier` | id, dest?, depart, retour, motif? (non transmis : inchangés) ; contrôles de `voyage.creer`, le déplacement lui-même exclu des conflits ; formalités de détachement devenues caduques effacées (`formalitesCaduques`) ; venu de Keystone : dates seules (destination et motif du chantier), `deplacement.modifie` mis en file ; annulé ou terminé : 409 | RH |
| `voyage.annuler` | id, motif (obligatoire pour un déplacement venu de Keystone, 500 caractères ; gardé dans Cursus, `annuleMotif`, jamais transmis à Keystone ; remis au salarié dans la copie de ses données) : `annuleLe`, `annulePar` ; déplacement gardé dans l'historique, hors de tous les calculs ; venu de Keystone : `deplacement.annule` mis en file ; déjà annulé ou terminé : 409 | RH |
| `formalite.enregistrer` | empId, kind (`passeport`/`visa`/`vaccin`), numero, expire, dest, visaType, obtenu, v, date | RH (écrit dans le dossier), ou le collaborateur pour lui-même (déclaration en attente, voir ci-dessous) |
| `voyages.importer` | texte (CSV) ; ligne sans référence : `DD-<n° du déplacement>` (suffixe si déjà prise) ; demandeur : nom du salarié reconnu, sinon tel que saisi (service RH seulement) | RH |
| `keystone.accepter` / `keystone.refuser` | id ; refus : motif? (conservé dans Cursus, demande et message du journal, jamais transmis à Keystone) | RH (demande en attente ; l'acceptation revalide affectation, chantier actif, destination, effectifs et l'absence de déplacement déjà créé, et est refusée si le salarié est déjà en déplacement ou absent ces jours-là ; la demande reste en base avec statut, date et décideur) |
| `plan.importer` | texte, exercice, mode (`add`/`replace`) ; exercice clos refusé | RH ; `replace` (supprime les lignes prévues d'origine `import` ; celles issues d'une demande, d'un report ou sans origine sont conservées) : administrateur RH |
| `budget.enveloppes` | exercice, enveloppes {équipe: montant} ; exercice clos refusé | RH |
| `plan.avancer` | id, de? (statut affiché : déjà dépassé, rien n'est refait ; revenu à « prévue », refus), coutReel (vers « réalisé », exigé : euros, 0 accepté), effectifReel? ; exercice clos ou action reportée refusés | RH |
| `plan.cloturerExercice` | exercice (passé et ouvert : jamais l'exercice en cours), reporter [id] (actions prévues ou engagées à reporter sur l'exercice suivant) | administrateur RH |
| `temps.setCell` | empId, week, li, di, value | salarié, manager direct ou RH (feuille soumise : valideur uniquement) ; aucune heure un jour d’absence validée ou signalée, ni hors contrat, vider la cellule reste possible ; pas de feuille pour une semaine hors contrat |
| `temps.addLine` / `temps.removeLine` | empId, week, projet / li, projet?, tache?, lignes? (ligne visée : déjà supprimée, rien n'est refait ; feuille changée, refus) | idem |
| `temps.suggest` / `temps.submit` | empId, week, motif? | idem (soumission : brouillon ou à corriger, sans heures un jour d’absence validée ; semaine entièrement couverte par une absence : sans heure ; 24 h par jour au plus, toutes lignes cumulées ; motif exigé au-delà de 10 h par jour ou 48 h par semaine, 13 h pour un forfait jours) |
| `temps.validate` / `temps.reject` | empId, week, comment?, motif? | manager direct ou RH, jamais pour sa propre feuille (validation : sans heures un jour d’absence validée ; une demande d’absence en attente sur des jours qui portent des heures est décidée d’abord ; une feuille sans heure exige une semaine encore couverte par une absence ; 24 h par jour au plus ; motif du dépassement exigé s'il manque, après une correction du valideur : celui du salarié n'est jamais remplacé) |
| `temps.pushSage` | — ; simulation seulement : lot de toutes les feuilles en attente, aussitôt marqué transmis (référence « SIM-… », rien n'est envoyé, message qui le dit) ; en mode fichier ou API, refus 503 sans rien marquer | administrateur RH, paie |
| `temps.relancer` | empId? (sinon tout le périmètre) : feuilles des semaines suivies manquantes, en brouillon ou à corriger, échéance passée ; e-mail (ou récapitulatif) au salarié et à son valideur ; rien en retard : refus | manager direct (son équipe) ou RH |
| `temps.validerLot` | feuilles [{empId, week}] (200 au plus) : chacune passe par `temps.validate` dans son point de reprise (SAVEPOINT) ; refus listés dans le message, les autres validées ; aucune validée : 403 si toutes l'étaient pour des droits, sinon 400 avec la liste | manager direct ou RH (comme `temps.validate`) |
| `paie.lotGenerer` | periode (AAAA-MM) : lot des feuilles validées en attente dont la période de destination vient au plus tard (rappels compris), contenu figé, clé d'idempotence (UUID), feuilles réservées (`feuilles.lotId`) ; mode API : 503 ; hors simulation, refus si un salarié n'a pas de matricule de paie (liste) ou 409 si une rubrique émise et exportée n'a pas de code Sage confirmé (liste) ; en simulation, avertissement | administrateur RH, paie (écran Temps) |
| `paie.lotConfirmer` | id, reference? (code de 40 caractères au plus) : confirmation de l'import dans Sage, datée et signée, qui seule marque les feuilles transmises ; lot de fichier : fichier téléchargé au moins une fois (409 sinon) ; lot de simulation refusé hors simulation ; déjà confirmé : rien n'est refait ; annulé : 409 | administrateur RH, paie |
| `paie.lotAnnuler` | id : avant la confirmation seulement (409 ensuite : lot correctif à venir) ; feuilles libérées | administrateur RH, paie |
| `paie.formatFichier` | separateur? (`;`/`,`/`tab`), colonnes? (matricule, periode, rubrique, quantite, chacune une fois), formatPeriode? (`AAAA-MM`/`MM/AAAA`/`AAAAMM`/`MMAAAA`), decimale? (`,`/`.`, différente du séparateur), entete? : clé `formatFichierPaie` de la table settings | administrateur RH, paie |
| `paie.rubrique` | code (RUBRIQUES_PAIE), codeSage?, active?, confirmer? (`true` : confirmé ce jour par la personne connectée ; `false` : confirmation retirée ; un code changé sans `true` repasse « à confirmer ») ; jamais deux unités sur un même code Sage | administrateur RH, paie (écran Temps) |
| `releve.envoyer` | agence, semaine (lundi, pas à venir) : relevé des feuilles validées des intérimaires de l'agence, envoi ou renvoi (feuilles en attente nommées) | RH, paie |
| `absence.demander` | empId, kind (`CP`/`RTT`/`RECUP`), du, au | intéressé ou RH (demande, refusée si ces jours portent des heures sur une feuille validée) ; manager direct (posée et validée, refusée si des heures sont saisies ces jours-là) |
| `absence.decider` | id, ok, motif? (refus : `motifRefus`, montré au salarié et à son manager ; jours rendus à une période de CP close : report reçu sur la suivante, `recrediterPeriodesCloses`) | manager direct ou RH, jamais pour sa propre demande (validation refusée si des heures sont saisies ces jours-là ; même décision déjà prise : rien n'est refait) |
| `absence.signaler` | empId, du, au | intéressé, manager direct ou RH : absence imprévue « à qualifier », en vigueur aussitôt |
| `absence.saisir` | empId, nature, du, au, justificatif, justificatifLe | RH (absence hors congés validée d’emblée), jamais pour lui-même |
| `absence.qualifier` | id, nature, du?, au?, justificatif, justificatifLe | RH (absence signalée ou qualifiée, hors congés), jamais la sienne |
| `absence.prolonger` | id, au | intéressé, manager direct ou RH (hors congés ; hors RH, l’absence repasse « à qualifier ») |
| `absence.annuler` | id (jours rendus à une période de CP close : report reçu sur la suivante, tracé) | demande : intéressé ou RH ; absence à venir : manager direct ou RH (et l’intéressé pour son propre signalement, ni qualifié ni prolongé) ; commencée ou passée : RH ; hors périmètre : refus unique (403) |
| `cet.placer` | empId, kind, jours, annee? (RTT de l'année précédente, tant que sa clôture n'est pas faite) | intéressé ou RH |
| `report.accorder` | empId, jours, motif (échéance : 31 mai suivant, seul un report légal court au-delà) : jours de la période en cours reportés sur la suivante, dans la limite du solde non encore reporté, appliqués à la clôture | RH, jamais pour lui-même |
| `conges.cloturer` | type (`CP`/`RTT`), periode (année de prise des CP, année des RTT), lignes? [{empId, decision `reporter`/`perdre`, jours? (report imposé compris)}] (CP) : période terminée ; une ligne déjà clôturée n'est jamais refaite, une ligne sans décision reste à clôturer, un salarié sans solde est clos d'emblée ; une ligne dont une demande de CP de la période est en attente n'est pas close (refus nommant la demande) ; perte refusée pour les jours d'un report imposé ; RTT : soldes perdus (non reportables), salarié dont une demande de RTT de l'année est en attente non clôturé | RH ; jamais sa propre ligne de CP |
| `entretien.planifier` | empId, kind, date, nonTenu? ; un seul entretien planifié par type : une nouvelle date le reprogramme (passé avec un compte rendu commencé, seulement avec `nonTenu`, l'évaluateur confirmant qu'il n'a pas eu lieu) ; refusé un jour d'absence du salarié ; convocation par e-mail (`.ics`, même événement à la reprogrammation) | manager direct ou RH (jamais son propre entretien) |
| `entretien.annuler` | id, confirmer? (exigé si le compte rendu est commencé : supprimé avec l'entretien) ; entretien planifié seulement (clos : 409), retiré ; date à venir : `.ics` d'annulation au salarié (même UID `entretien-<id>`) | évaluateur (manager direct) ou RH, jamais son propre entretien |
| `entretien.modifier` | id, section?, value?, info? | évaluateur / salarié selon la section (un membre du RH n'évalue pas son propre entretien) |
| `entretien.clore` | id, date? (jour où l'entretien a eu lieu, aujourd'hui au plus tard et pas avant sa planification ; exigée pour un entretien prévu à une date à venir) | évaluateur (l'écran enregistre d'abord chaque section ; un échec interrompt la clôture) |
| `entretien.signer` | id | salarié |
| `entretien.remettre` | id, mode (`main_propre`/`refus`/`portail`), date? (main propre, refus : de la clôture à aujourd'hui ; portail : le jour même, compte actif exigé, e-mail avec le seul lien vers Cursus) ; une remise sur papier est définitive, une mise à disposition se complète par une remise sur papier | évaluateur (manager direct) ou RH, jamais pour son propre entretien |
| `entretien.telecharger` | id : premier téléchargement du compte rendu clos, daté (`telechargeLe`) | salarié, depuis son espace |
| `parametres.maj` | champs de la table `REGLAGES` (`shared/reglages.ts`, chacun passé par son contrôle : horizonAlerte, seuilBudget, rtt39, uniquementReglementaire, partageKeystone, identifiantKeystone, politiqueReportCp, rttAnneeSuivanteDes, heuresSupMode, heuresSupAccord, periodeRattachement, clotureJour, campagneDebut, campagneFin, campagneAncienneteMois, campagneExclus, campagnePreavisJours, relancesActives, relancesPaliers, relancesJour), silent? ; saisie refusée par un contrôle ou par `COHERENCE` (repos sans référence d'accord, campagne dont l'ouverture suit la clôture) : 400, rien n'est enregistré | administrateur RH |
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
  statut de la feuille ; la saisie du salarié sur sa propre feuille ne l'est pas) ; rédaction
  d'un compte rendu d'entretien (section nommée, jamais son contenu, une ligne par compte et par demi-heure) ;
  connexions, refus, déconnexions, changements d'espace ; refus d'accès (403) d'une personne connectée
  (`acces.refuse`, motif borné à 200 caractères, rien n'est modifié ; tout message est borné à 2 000) ;
  appels et messages de Keystone ; exports (journal, données d'un salarié, CSV et impressions de l'interface
  signalés par `POST /api/exports`, `client/src/print.ts`) ; consultation de l'archive (chaque page lue, une
  ligne par compte et par filtre pendant 15 minutes) ; application des durées de conservation.
- **Conservation** (décision de l'entreprise) : 1 an pour tout ; au-delà, les actions liées à la paie
  (`ACTIONS_PAIE` : validations des feuilles (une à une ou en groupe) et des absences, prolongations et annulations
  d'absences, clôtures des congés, corrections d'heures, transmissions à la paie, lots de paie et téléchargements de leur
  fichier (`sage.fichier`), sorties et leur annulation, solde de RTT gardé lors d'un changement de régime) passent dans l'archive (`archivee`), absente de l'écran et
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
  le journal des actions le concernant (archive comprise). `GET /api/mes-donnees` : le salarié connecté
  (espace collaborateur ou manager) télécharge les siennes depuis le portail, sans le journal, que le RH
  remet sur demande. Chaque export est tracé (`salarie.export`, `donnees.export`).
- **Information des salariés** (art. 13 du RGPD) : page Confidentialité (`pages/Confidentialite.tsx`, vue commune
  `confidentialite` de `VUES_COMMUNES`, ouverte dans tous les espaces et sans connexion depuis l'écran de connexion),
  texte `INFO_CONFIDENTIALITE` de `shared/confidentialite.ts` (modèle à faire valider par le DPO, mentions « à compléter
  par le DPO », durées décidées reprises de `shared/journal.ts`). Responsable du traitement et contact du DPO : clé
  `confidentialite` de la table `settings`, réglée par `confidentialite.regler` (Paramètres → Confidentialité,
  `pages/parametres/Rgpd.tsx`) et lue sans connexion par `GET /api/confidentialite` ; vides, la page renvoie au service
  RH. Descriptif du traitement pour le registre et l'AIPD : `docs/RGPD.md`, à tenir à jour avec la page.

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
- **Journal** : `employe.sortie` (date, motif, nombre d'éléments annulés, anciennes et nouvelles valeurs de `fin` et
  `motifSortie`) et `employe.annulerSortie`, actions liées à la paie (archive de 3 ans).

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

### Garde-fou d'un changement de régime de temps

En attendant l'historique daté des contrats (lot 5), `employe.modifier` protège les calculs déjà faits quand le régime
change (organisation du temps, durée, forfait, jours non travaillés, statut ou nature du contrat) :

- les feuilles existantes antérieures à la date d'effet gardent l'ancien régime (`contrat`, comme avant) ; chaque semaine
  sous contrat des 8 semaines qui précèdent la date d'effet (`SEMAINES_FIGEES`, `semainesAFiger`) qui n'a pas encore de
  feuille en reçoit une, brouillon et vide, figée sur l'ancien régime : une feuille saisie ensuite pour cette semaine
  n'est plus calculée avec le nouveau (heures supplémentaires faussées) ;
- des RTT ou jours de repos de l'année pris ou posés que le nouveau régime n'ouvre plus (`rttPerdus` : 39 h + RTT vers
  35 h, forfait jours vers horaire collectif, passage en intérim) : le compteur disparaîtrait sans bruit. Le service RH
  confirme (`confirmerRtt`, confirmation dans le dialogue de la fiche, refus 400 sinon) et le solde affiché juste avant est
  gardé au journal pour la paie, sous le code `employe.rtt` (archive paie) avec `soldeRtt` (droit, pris, posés, solde).

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

## Santé au travail

Règles dans `shared/rules/sante.ts` et `Domain.medInfo` (`shared/domain.ts`), actions dans `server/src/actions/sante.ts`.

- **Aptitude** : valide 24 mois après la dernière visite (`MED_VALIDITE`), sauf avis d'inaptitude. Elle compte dans le statut
  du collaborateur (`EmpX.worst`, même sans habilitation qui l'exige) et dans les échéances (type « Visite médicale » : échue,
  à renouveler sous l'horizon d'alerte, jamais enregistrée — sans date, parmi les dépassées —, avis d'inaptitude ; action
  « Demander la visite »). Une visite saisie avant l'enregistrement des avis (colonne `avis` vide) vaut avis apte.
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
- **Confidentialité** : dates de visite, avis daté et demandes sont réservés au service RH et à l'intéressé. Le manager reçoit
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
  unitaire ou groupé, pour les convocations « à envoyer ») : e-mail avec un fichier `.ics` (journée entière,
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
- **Clôture** (RH, à partir du jour de la session) : chaque formation du catalogue porte son mode de
  validation (`Formation.validation` : `presence` ou `evaluation`). Pour chaque inscrit, présent / absent
  et, si l'évaluation est exigée, réussie / échouée, choisis explicitement (aucune valeur par défaut : la clôture
  est définitive). Présent (et reçu) : certification datée du jour de la
  session, la certification renouvelée passe en historique ; absent ou échec : recyclage de nouveau à
  planifier, formation initiale à replanifier. Un recyclage déjà saisi depuis (`cert.ajouter` daté du jour de la
  session ou après) n'appelle aucune décision. Les résultats sont conservés (table `participations`, restreinte
  au périmètre comme les inscriptions), l'action du plan rattachée passe « réalisée » si aucune autre session
  ouverte ne la porte, l'évaluation à chaud (note sur 5, commentaire) est facultative. Une seule transaction,
  tracée au journal. Le bilan (`Session.bilan` : évaluation à chaud, motif d'annulation, textes libres parfois
  nominatifs) n'est transmis qu'au service RH.
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
- **Titres** : habilitations et certifications exigées, valides sur les dates du chantier.
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
- **Durées** : une journée compte 24 h au plus, toutes lignes de la feuille cumulées (saisie, proposition Keystone,
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
  refusée) : tout le solde, 15 mois (31 août A+2 : art. L3141-2 et L3141-19-1), après une absence de santé, une
  maternité, une paternité, une adoption ou une absence encore à qualifier dans la période ; les seuls jours restants
  d'un report légal reçu qui court au-delà de la période, jusqu'à sa propre échéance (le reste du solde est au choix du
  service RH) ; motif réservé au service RH et à l'intéressé. Une ligne n'est pas close tant qu'une demande de CP de la
  période attend une décision ; une période close ne reçoit plus de congé (`checkAbsence`), et les jours qu'un refus ou
  une annulation lui rendent sont reportés sur la période suivante (`recrediterPeriodesCloses`, tracé). RTT : non reportables, soldes photographiés et perdus ; ceux
  de l'année close restent plaçables sur le CET (`cet.placer`, `annee`) jusqu'à la confirmation. Table `clotures` (une
  ligne par salarié et période, unique) : relancer est sans effet.
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
  référentiel en vigueur ou déjà celle du déplacement, conflits de dates en excluant le déplacement lui-même). Un
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

- **Contenu** (`relancesDues`) : échéances du domaine (certifications, habilitations, visite médicale, passeport, visas,
  vaccinations), déplacements au dossier incomplet (selon la date de départ), obligations d'entretien non planifiées ou
  planifiées à une date dépassée, fins de contrat prévues sans sortie enregistrée. Écartés : salariés sortis, échéances
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
saisi à part dans l’année qui suit le décès. L’effet sur les CP est indiqué pour mémoire : `cpDroit` ne l’applique pas (décision attendue).
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
  (`GET /api/envois`, RH) ; l'état de l'intégration ne compte que les échecs non classés.
- **Verdicts Go / No Go** : `server/src/integrations/keystone-verdicts.ts` (`suivreVerdicts`) mémorise le
  dernier verdict transmis par chantier et ressource (table `verdictsKeystone`) et met en file
  `verdict.modifie` (codes de motif seulement) quand il change. Recalcul après chaque action, sauf les
  familles sans effet (`changeVerdicts` de `actions/index.ts` : temps, compteurs de congés, entretiens… ;
  les actions d'absence, qui peuvent bloquer une ressource, y donnent lieu), après
  chaque écriture de Keystone et une fois par jour. Les verdicts du jeu de démonstration sont mémorisés
  sans envoi. Ceux mémorisés en simulation ne sont pas réputés transmis : le réglage `verdictsKeystoneMode`
  retient le mode du suivi, et le premier calcul en mode API vide la table, d'où un premier verdict
  (`precedent: null`) pour chaque ressource suivie.
- **Sage Paie** : `server/src/integrations/sage.ts`, mode `SAGE_MODE` (`sageMode`) : `simulation` (démonstration et
  développement : rien ne part, les feuilles sont marquées transmises et l'écran, la confirmation et le message le disent),
  `fichier` (mode de production par défaut : lot de paie, fichier d'import téléchargé par la paie, import confirmé, qui seul
  marque les feuilles transmises ; `temps.pushSage` y refuse sans rien marquer) et `api`
  (aucun contrat d'API fourni par Sage : refusé au démarrage en production, refusé à la transmission ; plus aucun accusé
  fictif). `SAGE_URL` ne fait plus basculer en mode API et est refusée en production (`server/src/config.ts`), comme la
  simulation hors application de bureau. Rubriques (`shared/rules/paie.ts`) : liste unique des codes internes
  (`RUBRIQUES_PAIE` de `shared/constants.ts`), correspondance enregistrée par rubrique modifiée (table `rubriquesPaie` ; sans
  ligne : code Sage égal au code interne, à confirmer), traduite par `buildSagePayload` (rubriques désactivées retirées,
  quantités nulles omises, deux rubriques sur un même code additionnées). Écran Temps (`components/LotsPaie.tsx`,
  `RubriquesPaie.tsx`) : l'administrateur RH et la paie saisissent et confirment les codes ; le service RH et la lecture
  seule consultent ; le manager, le collaborateur et le référent HSE ne reçoivent pas la table (`dataset.ts`). La file
  d'envoi prévoit la cible `sage`, sans la brancher (envoi automatique non fait).
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
  - Reprise : migration `lot4-paie-lots-historiques` (feuilles déjà transmises sans lot réunies en un lot historique,
    transmis, sans contenu, périodes selon la règle de rattachement au jour de la dernière transmission, plus celles
    qu'elle avait annoncées ; journal `migration.lotsPaie`). Le réglage `lastSagePush` n'est plus écrit ni transmis.
  - Envoi par API (mise en file, cible `sage`, clé d'idempotence = `cle` du lot, statut au succès) : avec le connecteur,
    quand Sage fournira un contrat d'API.
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
