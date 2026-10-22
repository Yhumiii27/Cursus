# Cursus — reste à faire

Audit du 10 octobre 2026 (branche `main-n9x7ps`). Chaque point a été relevé dans le code puis contre-vérifié par une seconde lecture qui a écarté ce qui était déjà fait ou inexact. Les preuves renvoient aux fichiers et lignes à cette date.

**179 tâches** (168 faites au 22 octobre 2026 ; suivi à jour : https://claude.ai/artifact/8Dn4CRz3fcHgew8RzbNGEc) : 26 bloquantes pour une mise en production, 98 importantes, 55 souhaitables.

Légende — priorité : 🔴 **Bloquant** (empêche un usage réel : sécurité, données faussées, obligation légale) · 🟠 **Important** (attendu par les utilisateurs) · 🟢 **Souhaitable** (confort). Effort : **S** moins d’une journée · **M** 1 à 3 jours · **L** plus de 3 jours.

| Thème | 🔴 | 🟠 | 🟢 | Total |
| --- | ---: | ---: | ---: | ---: |
| Mise en production & sécurité | 6 | 3 | 3 | 12 |
| Données personnelles & traçabilité | 0 | 4 | 2 | 6 |
| Intégrations (Keystone, Sage, e-mails) | 6 | 10 | 2 | 18 |
| Conformité droit du travail : temps et congés | 2 | 11 | 4 | 17 |
| Conformité : santé, sécurité et obligations employeur | 2 | 12 | 2 | 16 |
| Bugs à corriger (calculs et données) | 5 | 14 | 6 | 25 |
| Bugs de l'interface | 0 | 7 | 7 | 14 |
| Fonctions métier : formations, habilitations, sessions | 2 | 9 | 3 | 14 |
| Fonctions métier : collaborateurs, temps, absences, déplacements | 2 | 9 | 3 | 14 |
| Ergonomie & accessibilité | 0 | 9 | 10 | 19 |
| Tests & qualité | 0 | 5 | 5 | 10 |
| Exploitation | 1 | 5 | 8 | 14 |
| **Total** | **26** | **98** | **55** | **179** |

## Avant toute mise en production

Les tâches 🔴, toutes thématiques confondues :

- [x] Rendre la démo opt-in et contrôler la configuration au démarrage — *Mise en production & sécurité, effort S*
- [x] Supprimer la clé Keystone par défaut « demo-keystone » — *Mise en production & sécurité, effort S*
- [x] Placer Cursus derrière HTTPS et ajouter les en-têtes de sécurité — *Mise en production & sécurité, effort S*
- [x] Faire expirer et révoquer les sessions — *Mise en production & sécurité, effort M*
- [x] Brancher l'authentification unique de l'entreprise (OIDC/SAML) — *Mise en production & sécurité, effort L*
- [x] Créer des comptes nominatifs reliés aux salariés — *Mise en production & sécurité, effort L*
- [ ] Coder l'envoi réel à Sage Paie et ne marquer « transmis » qu'après accusé — *Intégrations (Keystone, Sage, e-mails), effort M*
- [x] Coder l'envoi HTTP sortant vers Keystone — *Intégrations (Keystone, Sage, e-mails), effort M*
- [x] Stocker le vrai matricule de paie — *Intégrations (Keystone, Sage, e-mails), effort M*
- [x] Rendre paramétrable la correspondance des rubriques de paie Sage — *Intégrations (Keystone, Sage, e-mails), effort M*
- [x] Alimenter depuis Keystone les chantiers, projets, missions et tâches — *Intégrations (Keystone, Sage, e-mails), effort L*
- [x] Créer une file d'envoi persistante avec reprise sur échec et écran de suivi — *Intégrations (Keystone, Sage, e-mails), effort L*
- [x] Choisir entre paiement et repos des heures supplémentaires — *Conformité droit du travail : temps et congés, effort M*
- [x] Ajouter les absences hors congés (maladie, AT/MP, maternité, événements familiaux…) — *Conformité droit du travail : temps et congés, effort L*
- [x] Permettre de retirer ou suspendre manuellement une habilitation — *Conformité : santé, sécurité et obligations employeur, effort S*
- [x] Définir les formations et habilitations exigées par poste — *Conformité : santé, sécurité et obligations employeur, effort L*
- [x] Ne retenir que la dernière certification après un renouvellement — *Bugs à corriger (calculs et données), effort M*
- [x] N'appliquer un document déclaré par le salarié qu'après validation RH — *Bugs à corriger (calculs et données), effort M*
- [x] Rattacher soldes repris et reports de CP à une période — *Bugs à corriger (calculs et données), effort M*
- [x] Refuser les heures saisies sur un jour d'absence validée — *Bugs à corriger (calculs et données), effort M*
- [x] Historiser les régimes de temps et contrats avec leur date d'effet — *Bugs à corriger (calculs et données), effort L*
- [x] Clôturer les sessions passées : présence, résultats et recyclages — *Fonctions métier : formations, habilitations, sessions, effort L*
- [x] Permettre au RH d'administrer formations, habilitations et destinations — *Fonctions métier : formations, habilitations, sessions, effort L*
- [x] Outiller la mise en service : import des salariés, soldes d'ouverture et titres — *Fonctions métier : collaborateurs, temps, absences, déplacements, effort L*
- [x] Gérer la sortie d'un collaborateur — *Fonctions métier : collaborateurs, temps, absences, déplacements, effort L*
- [x] Mettre en place sauvegarde, rotation et restauration testée — *Exploitation, effort M*

## Mise en production & sécurité

- [x] **Rendre la démo opt-in et contrôler la configuration au démarrage** — 🔴 Bloquant · S
  La démo est active par défaut : tout poste du réseau obtient l'espace RH sans mot de passe et peut tout effacer. Activer la démo seulement avec CURSUS_DEMO=1 et refuser de démarrer en production si la démo est active, si CURSUS_SECRET ou KEYSTONE_API_KEY manquent ou si CURSUS_TODAY est défini. Ajouter le fichier .env.example.
  <br><sub>Preuves : server/src/auth.ts:18 (DEMO actif sauf CURSUS_DEMO=0) · server/src/index.ts:56 (session RH d'office) et :168 (écoute 0.0.0.0) · curl /api/session en NODE_ENV=production → cookie RH, /api/data → 200 · ls .env.example → absent</sub>
- [x] **Supprimer la clé Keystone par défaut « demo-keystone »** — 🔴 Bloquant · S
  Sans configuration, les routes Keystone acceptent une clé publiée dans le README : n'importe qui peut lire les Go / No Go et injecter des demandes. Désactiver ces routes si la clé n'est pas définie et comparer la clé en temps constant (timingSafeEqual).
  <br><sub>Preuves : server/src/integrations/keystone.ts:24 · README.md:73 · server/src/index.ts:131-133 (comparaison !==) · curl -H 'x-api-key: demo-keystone' → authentification acceptée</sub>
- [x] **Placer Cursus derrière HTTPS et ajouter les en-têtes de sécurité** — 🔴 Bloquant · S
  En production le cookie est marqué Secure, donc refusé en HTTP sur le réseau local, et aucune protection (CSP, HSTS, anti-iframe) n'est envoyée. Fournir et documenter un reverse proxy TLS avec Cursus sur 127.0.0.1, puis ajouter les en-têtes de sécurité (adapter le script inline de l'impression).
  <br><sub>Preuves : server/src/index.ts:169 (HTTP seul) et :26 (seul x-powered-by désactivé) · server/src/auth.ts:60 (Secure en production) · client/src/print.ts:33 (script inline) · grep helmet\|Strict-Transport → aucun résultat</sub>
- [x] **Faire expirer et révoquer les sessions** — 🔴 Bloquant · M
  Le cookie signé n'a pas de date d'expiration : copié, il reste valable indéfiniment, même après déconnexion ou départ du salarié. Ajouter date d'émission et d'expiration signées, une table de sessions révocables, un refus si la date de sortie est passée et un CURSUS_SECRET obligatoire en production.
  <br><sub>Preuves : server/src/auth.ts:39-52 et :59-61 (aucune expiration) · server/src/dataset.ts:86-89 (e.fin non vérifié) · cookie RH rejoué après POST /api/logout → 200</sub>
- [x] **Brancher l'authentification unique de l'entreprise (OIDC/SAML)** — 🔴 Bloquant · L
  Hors démo, la connexion renvoie 501 : l'outil est inutilisable en production. Implémenter le flux OIDC ou SAML (redirection, vérification du jeton, création de session), avec en secours des comptes locaux à mot de passe haché.
  <br><sub>Preuves : server/src/index.ts:72 (501 hors démo) · server/src/auth.ts:1-4 (OIDC/SAML à brancher) · README.md:78-79</sub>
- [x] **Créer des comptes nominatifs reliés aux salariés** — 🔴 Bloquant · L
  Le RH est une identité unique dont le nom est modifiable dans les paramètres : toutes les actions RH sont signées du même nom et l'auteur du journal est falsifiable. Créer une table de comptes (identifiant SSO → salarié, rôle, actif), permettre plusieurs RH, et une session portant une seule personne sans changement d'espace non authentifié.
  <br><sub>Preuves : server/src/dataset.ts:85 (RH = settings.rhNom) · server/src/actions/parametres.ts:23 (rhNom modifiable) · server/src/index.ts:111 (actor: user.nom) et :60-67 (/api/mode) · server/src/db.ts:17-24 (aucun identifiant de connexion)</sub>
- [x] **Ne plus envoyer au manager le numéro de passeport de son équipe** — 🟠 Important · S
  Les données envoyées au manager contiennent le numéro de passeport complet des membres, alors que l'écran n'affiche que la date d'expiration. Ne transmettre que cette date (les visas restent affichés volontairement) et ajouter le cas au test serveur.
  <br><sub>Preuves : server/src/dataset.ts:116-118 (seuls visite et vaccins masqués) · client/src/pages/Collaborateurs.tsx:314 · tests/server.test.ts:26-37 (aucune assertion passeport) · buildSnapshot manager 12 → employes[2].passeport.numero = '20AB···91'</sub>
- [x] **Empêcher un manager de prendre seul un salarié d'une autre équipe** — 🟠 Important · S
  Un manager peut affecter à son équipe n'importe quel salarié d'une autre équipe et accéder aussitôt à ses absences, temps et entretiens. Limiter l'ajout direct aux salariés « à affecter », ou passer par une demande de mutation validée par le RH.
  <br><sub>Preuves : server/src/actions/equipes.ts:132-148 (équipe d'origine non contrôlée) · tests/equipes.test.ts:145 (transfert Logistique → Maintenance validé) · server/src/dataset.ts:98-104 (périmètre manager)</sub>
- [x] **Chiffrer la base et les données sensibles au repos** — 🟠 Important · M
  Le fichier SQLite est en clair et contient passeports, vaccinations, visites médicales et, sans CURSUS_SECRET, la clé de signature des sessions. Chiffrer les colonnes sensibles ou la base, restreindre les droits du fichier et documenter des sauvegardes chiffrées.
  <br><sub>Preuves : server/src/db.ts:193-194 (base en clair) · server/src/db.ts:22,28 (passeport, visite, vaccinations) · server/src/auth.ts:23-24 (secret stocké en base) · .gitignore:15</sub>
- [x] **Ajouter une protection CSRF sur les requêtes POST** — 🟢 Souhaitable · S
  Seul l'attribut SameSite=Lax protège les actions ; un POST text/plain d'une autre origine est exécuté. Refuser les POST dont l'origine n'est pas Cursus ou dont le type n'est pas JSON.
  <br><sub>Preuves : server/src/auth.ts:61 · server/src/index.ts:99-121 · curl POST text/plain Origin evil.example sur temps.pushSage → handler exécuté</sub>
- [x] **Neutraliser l'injection de formules dans les exports CSV** — 🟢 Souhaitable · S
  Une cellule commençant par =, +, - ou @ s'exécute comme formule dans Excel ; un collaborateur peut en glisser une via le type de visa, exporté ensuite par le RH. Préfixer ces cellules d'une apostrophe.
  <br><sub>Preuves : client/src/print.ts:41 (cell()) · server/src/actions/voyages.ts:36 (visaType libre) · shared/domain.ts:376 · client/src/pages/Echeances.tsx:44</sub>
- [x] **Limiter le débit des appels** — 🟢 Souhaitable · S
  Aucune limite n'existe sur la connexion, les actions et les routes Keystone. Ajouter un limiteur par IP et par identité (réponse 429) et configurer trust proxy derrière le reverse proxy.
  <br><sub>Preuves : server/src/index.ts:131-133 · package.json (aucune dépendance de limitation)</sub>

## Données personnelles & traçabilité

- [x] **Expurger le journal et lui fixer une durée de conservation** — 🟠 Important · M
  Le journal copie le contenu complet de chaque requête (numéro de passeport, vaccinations, CSV importés) sans limite de durée, et la réinitialisation de démo l'efface. Journaliser une liste blanche de champs par action, fixer une durée de conservation avec purge et archive, et exclure le journal de la réinitialisation.
  <br><sub>Preuves : server/src/index.ts:111 (payload: req.body) · server/src/actions/voyages.ts:28-30 et :41-47 · server/src/db.ts:48 (aucune purge) · server/src/seed.ts:291 (clearAll, journal compris)</sub>
- [x] **Rendre le journal d'audit complet et consultable** — 🟠 Important · M
  Seules les 100 dernières lignes s'affichent, sans filtre ni export, avec des codes techniques ; connexions, changements d'espace, appels Keystone entrants et corrections d'heures par le valideur ne sont pas tracés. Tracer ces événements, puis ajouter filtres (dates, auteur, action, salarié), pagination, export CSV, libellés français et historique par fiche.
  <br><sub>Preuves : server/src/index.ts:126 (LIMIT 100) et :60-91, :147-157 (non tracés) · server/src/actions/index.ts:23-24 (temps.setCell et entretien.modifier silencieux) · server/src/actions/temps.ts:24 (correction d'une feuille soumise) · client/src/pages/Parametres.tsx:191, :210</sub>
- [x] **Encadrer les données de santé (vaccins, motif de reprise)** — 🟠 Important · M
  Cursus stocke vaccins, dates d'injection et un motif de reprise en texte libre, alors que le portail affirme « sans aucune information médicale ». Passer le motif en liste fermée non médicale, ne garder que la conformité requise, corriger la mention et afficher l'information art. 13 avant saisie.
  <br><sub>Preuves : server/src/actions/voyages.ts:41-47 · client/src/dialogs/EmployeDialog.tsx:297-298 · client/src/pages/Portail.tsx:168 · shared/constants.ts:92</sub>
- [x] **Anonymiser les salariés sortis et purger les données échues** — 🟠 Important · M
  Aucune durée de conservation n'est appliquée et aucune action ne supprime ou n'anonymise une fiche. Paramétrer une durée par catégorie, ajouter une action RH d'anonymisation en cascade (fiche, passeport, vaccins, comptes rendus, journal) et une tâche planifiée de purge ; prérequis : la date de sortie pour tout contrat.
  <br><sub>Preuves : grep conservation\|purge\|anonymi → aucun résultat · server/src/actions/equipes.ts:153-161 (pas de suppression) · shared/rules/profil.ts:62,74 (pas de date de fin pour un CDI) · server/src/index.ts:166-170 (aucune tâche planifiée)</sub>
- [x] **Rédiger la documentation RGPD et une page Confidentialité** — 🟢 Souhaitable · S
  Aucun descriptif du traitement ni mention d'information n'existe. Rédiger docs/RGPD.md (finalités, catégories, destinataires, durées) pour alimenter le registre et l'AIPD de l'employeur, et ajouter une page Confidentialité dans la navigation.
  <br><sub>Preuves : ls docs → ARCHITECTURE.md uniquement · client/src/layout/Shell.tsx:39-49 (aucune page d'information)</sub>
- [x] **Permettre l'export complet des données d'un salarié** — 🟢 Souhaitable · M
  Rien ne permet de remettre à un salarié l'ensemble de ses données (droit d'accès et portabilité). Ajouter une route RH d'export JSON/PDF et un bouton « Télécharger mes données » dans le portail.
  <br><sub>Preuves : server/src/index.ts:53-157 (aucune route d'export) · client/src/pages/Collaborateurs.tsx:207 (export partiel)</sub>

## Intégrations (Keystone, Sage, e-mails)

- [ ] **Coder l'envoi réel à Sage Paie et ne marquer « transmis » qu'après accusé** — 🔴 Bloquant · M
  Dès que SAGE_URL est défini, l'écran annonce l'envoi, mais rien ne part et les feuilles sont marquées transmises à la paie. En attendant, lever une erreur en mode API ; ensuite faire l'appel HTTP hors transaction, contrôler et conserver l'accusé.
  <br><sub>Preuves : server/src/integrations/sage.ts:7 et :10-15 (branche api vide) · server/src/actions/temps.ts:105-108 (sage: true) · client/src/pages/Parametres.tsx:167 · server/src/actions/context.ts:23 (handler synchrone)</sub>
- [x] **Coder l'envoi HTTP sortant vers Keystone** — 🔴 Bloquant · M
  En mode API, sendToKeystone n'envoie rien et journalise « (simulation) » alors que Paramètres affiche « API connectée ». Faire le POST avec gestion des erreurs et trancher le contrat (heures sur projets internes INT-* et ECOLE).
  <br><sub>Preuves : server/src/integrations/keystone.ts:15-21 · client/src/pages/Parametres.tsx:159 · server/src/actions/temps.ts:88-90</sub>
- [x] **Stocker le vrai matricule de paie** — 🔴 Bloquant · M
  Le matricule envoyé à Sage et Keystone est fabriqué à partir de l'identifiant interne (EMP-0001) et ne correspondra pas au dossier de paie. Ajouter un matricule unique saisi ou importé et l'utiliser partout.
  <br><sub>Preuves : shared/format.ts:21 · server/src/db.ts:17-23 · shared/rules/temps.ts:136 · server/src/index.ts:150</sub>
- [x] **Rendre paramétrable la correspondance des rubriques de paie Sage** — 🔴 Bloquant · M
  Les codes HN, HS25, RCR_ACQUIS… sont écrits en dur ; l'interface indique elle-même « à paramétrer ». Créer une table de correspondance modifiable par le RH et bloquer la transmission d'une rubrique sans correspondance.
  <br><sub>Preuves : shared/rules/temps.ts:102-117 · client/src/pages/Parametres.tsx:180 et :20-28 (HSF25/HSF50 absentes de la liste) · client/src/pages/Temps.tsx:200</sub>
- [x] **Alimenter depuis Keystone les chantiers, projets, missions et tâches** — 🔴 Bloquant · L
  Ces données ne viennent que du jeu de démo : en production, le Go / No Go répond 404, les demandes Keystone sont rejetées et aucune ligne de temps ne peut être saisie (projet inconnu). Ajouter des routes entrantes protégées (ou une synchronisation) et rattacher la ressource au chantier quand une demande est acceptée.
  <br><sub>Preuves : server/src/seed.ts:298-299, :315-316 (seuls écrivains) · server/src/index.ts:137, :147, :152 (seules routes, chantier inconnu → 400) · server/src/actions/temps.ts:48-49 (projet inconnu refusé) · server/src/actions/voyages.ts:65-77 (ressource non rattachée)</sub>
- [x] **Créer une file d'envoi persistante avec reprise sur échec et écran de suivi** — 🔴 Bloquant · L
  Les appels à Keystone et Sage se font dans la transaction de l'action et les indicateurs « transmis » sont posés sans confirmation. Créer une table d'envois (statut, tentatives, erreur, accusé, clé d'idempotence) traitée par un worker, et une vue « Envois » dans Paramètres avec bouton Relancer.
  <br><sub>Preuves : server/src/index.ts:106-114 (appels dans db.tx) · server/src/actions/absences.ts:19-21, :33-34 · grep setInterval\|fetch( server/src → aucun résultat · server/src/index.ts:123-128 (journal sans suivi d'envoi)</sub>
- [x] **Calculer la période de paie Sage à partir de la semaine** — 🟠 Important · S
  La période de paie est le mois d'envoi : une semaine de septembre transmise en octobre part sur octobre, et l'heure d'envoi est figée à 09:00+02:00. Déduire la période de la semaine (ou d'une date de clôture), regrouper par période et horodater réellement.
  <br><sub>Preuves : shared/rules/temps.ts:128-135 · shared/rules/temps.ts:119-126 (sagePending sans période)</sub>
- [x] **Pousser à Keystone les changements de verdict Go / No Go** — 🟠 Important · M
  L'écran Chantiers promet qu'un changement de verdict est poussé à Keystone, mais l'événement n'est jamais émis. Mémoriser le dernier verdict par chantier et ressource, le recalculer après les actions concernées et chaque jour (expirations), et l'envoyer quand il change.
  <br><sub>Preuves : client/src/pages/Chantiers.tsx:79 · server/src/integrations/keystone.ts:11 (type déclaré seulement) · grep verdict.modifie → aucune émission · design/prototype-suivi-formations.dc.html:699</sub>
- [x] **Contrôler et tracer les demandes Keystone entrantes** — 🟠 Important · M
  La route accepte des dates impossibles, un retour avant le départ, des doublons et un salarié non affecté au chantier, sans rien journaliser ; les demandes traitées sont supprimées. Ajouter ces contrôles (400/409), une référence externe unique, le journal des appels et la conservation des décisions.
  <br><sub>Preuves : server/src/index.ts:147-157 · server/src/db.ts:34 (pas de référence externe) · server/src/actions/voyages.ts:66-78 (acceptation sans revalidation), :75 et :85 (suppression)</sub>
- [x] **Transmettre à la paie les absences validées et proposer un export CSV** — 🟠 Important · M
  Les CP, RTT et récupérations validés ne partent que vers Keystone ; la paie ne peut ni calculer l'indemnité de congés ni l'indemnité de fin de contrat. Ajouter les rubriques d'absence et le solde à la sortie au lot Sage, un indicateur de transmission et un export CSV des variables par période.
  <br><sub>Preuves : shared/rules/temps.ts:102-140 (heures uniquement) · server/src/db.ts:38 (pas d'indicateur sage sur absences) · server/src/actions/absences.ts:21, :34 · shared/rules/conges.ts:141</sub>
- [x] **Tracer chaque transmission Sage en lot identifié et rejouable** — 🟠 Important · M
  Une feuille ne garde qu'un booléen et le dernier envoi est écrasé à chaque transmission. Créer une table des lots (période, date, statut, accusé), référencer le lot sur chaque feuille, l'envoyer comme clé d'idempotence et afficher l'historique avec Renvoyer / Annuler.
  <br><sub>Preuves : server/src/db.ts:37 · server/src/actions/temps.ts:108 (lastSagePush écrasé) · server/src/dataset.ts:78</sub>
- [x] **Produire et envoyer le relevé d'heures des intérimaires** — 🟠 Important · M
  L'écran affiche « relevé envoyé à l'agence d'intérim » alors qu'aucun relevé n'est produit. Créer un export hebdomadaire par agence, un indicateur « relevé transmis » et l'envoi à l'adresse de l'agence.
  <br><sub>Preuves : client/src/pages/Temps.tsx:255 et :192 · shared/rules/temps.ts:124-125 (intérimaires seulement exclus) · grep relevé server → aucun résultat</sub>
- [x] **Transmettre à la paie les jours de déplacement et le temps de trajet** — 🟠 Important · M
  Déplacements et missions ne produisent aucune variable de paie (grand déplacement, travail à l'étranger, contrepartie du trajet inhabituel, L3121-4). Calculer ces jours par salarié et période et créer les rubriques correspondantes, à paramétrer.
  <br><sub>Preuves : shared/rules/temps.ts:102-116 · shared/types.ts:95, :97 · grep trajet → aucun résultat</sub>
- [x] **Créer le module d'envoi d'e-mails et stocker les adresses** — 🟠 Important · M
  Aucune adresse e-mail ni aucun envoi n'existe, alors que l'interface parle de convocations envoyées et de personnes notifiées. Ajouter l'e-mail sur la fiche, les adresses RH, santé au travail et agences, et un module SMTP avec mode simulation tracé.
  <br><sub>Preuves : shared/types.ts:49-86 (aucune adresse) · package.json (aucun client SMTP) · grep smtp\|nodemailer\|courriel → aucun résultat</sub>
- [x] **Notifier par e-mail les étapes de validation** — 🟠 Important · M
  Demande d'absence, feuille soumise ou renvoyée, entretien planifié ou clos, demande refusée : le destinataire ne l'apprend qu'en ouvrant Cursus. Émettre une notification par e-mail pour chaque étape, avec un réglage immédiat ou récapitulatif quotidien.
  <br><sub>Preuves : server/src/actions/absences.ts:24 · server/src/actions/temps.ts:74, :97 · server/src/actions/entretiens.ts:22, :50 · server/src/actions/conformite.ts:121</sub>
- [x] **Planifier des relances automatiques des échéances** — 🟠 Important · L
  Les échéances ne sont calculées qu'à l'affichage : personne n'est averti sans ouvrir l'écran. Ajouter une tâche quotidienne qui envoie au RH et aux managers un récapitulatif (titres, visites, passeports, entretiens, fins de contrat, feuilles non soumises) en mémorisant les relances.
  <br><sub>Preuves : shared/domain.ts:361 · shared/rules/entretiens.ts:14 · grep setInterval\|cron server → aucun résultat</sub>
- [x] **Publier un contrat OpenAPI versionné des routes Keystone** — 🟢 Souhaitable · S
  Les routes appelées par Keystone ne sont décrites que par une liste de chemins, sans schéma ni version. Publier une spécification OpenAPI (demande, verdict, erreurs) et préfixer les routes par /v1.
  <br><sub>Preuves : client/src/pages/Parametres.tsx:30-33 · server/src/index.ts:137, :147 · shared/domain.ts:430 (forme des motifs variable)</sub>
- [x] **Proposer un export calendrier (.ics)** — 🟢 Souhaitable · M
  Sessions, entretiens, absences et déplacements ne peuvent pas aller dans Outlook. Générer des fichiers .ics joints aux convocations et un flux personnel par abonnement à jeton révocable.
  <br><sub>Preuves : grep vcalendar\|.ics → aucun résultat · server/src/actions/entretiens.ts:22 · server/src/actions/conformite.ts:23</sub>

## Conformité droit du travail : temps et congés

- [x] **Choisir entre paiement et repos des heures supplémentaires** — 🔴 Bloquant · M
  Une semaine de 40 h envoie à la fois HS25=5 (payées) et RCR_ACQUIS=6,3 (mêmes heures en repos) : les heures risquent d'être payées et récupérées. Ajouter un paramètre de mode (paiement, repos ou mixte) qui alimente l'une ou l'autre rubrique.
  <br><sub>Preuves : shared/rules/temps.ts:70 et :110-114 · client/src/pages/Temps.tsx:73 · sageRubriques(35 h, 8h×5) = {HN:35, HS25:5, RCR_ACQUIS:6.3}</sub>
- [x] **Ajouter les absences hors congés (maladie, AT/MP, maternité, événements familiaux…)** — 🔴 Bloquant · L
  Seuls CP, RTT et récupération existent : un arrêt maladie ne peut pas être saisi, la feuille reste vide, Keystone planifie la personne et la reprise se saisit à la main. Créer ces types (effet sur les soldes, les CP, la paie, Keystone, justificatif) et en déduire la date de reprise.
  <br><sub>Preuves : shared/types.ts:15 (CP \| RTT \| RECUP) · shared/constants.ts:17 · server/src/actions/temps.ts:71 (feuille sans heure refusée) · shared/rules/entretiens.ts:31-33</sub>
- [x] **Repérer et majorer les heures travaillées un jour férié** — 🟠 Important · S
  L'interface verrouille les jours fériés et le serveur les compterait comme des heures normales ; le 1er mai travaillé doit être payé double. Permettre la saisie avec une rubrique dédiée (1er mai, autres fériés selon la CCN) contrôlée côté serveur.
  <br><sub>Preuves : client/src/pages/Temps.tsx:240, :305 · shared/rules/temps.ts:35-73 (calcSheet sans isFerie) · sageRubriques semaine du 27/04/2026 → {HN:35}</sub>
- [x] **Contrôler les moyennes sur 12 semaines (44 h, requalification temps partiel)** — 🟠 Important · S
  Seules les limites hebdomadaires sont contrôlées. Calculer sur les feuilles validées la moyenne glissante de 44 h sur 12 semaines et le dépassement de 2 h par semaine d'un temps partiel (12 semaines), avec alerte au RH.
  <br><sub>Preuves : shared/rules/temps.ts:44-45 et :50-56 · shared/rules/profil.ts:126 · grep L3123-13 → aucun résultat</sub>
- [x] **Calculer l'acquisition des CP pendant les arrêts (loi 2024-364)** — 🟠 Important · M
  Un mois compte en entier dès que le contrat court, même en arrêt. Appliquer 2 jours ouvrables par mois en maladie (plafond 24), l'assimilation complète AT/MP, le report de 15 mois et l'information du salarié au retour.
  <br><sub>Preuves : shared/rules/conges.ts:12-19, :28 · grep L3141-5 → aucun résultat</sub>
- [x] **Suivre le contingent annuel d'heures supplémentaires** — 🟠 Important · M
  Les heures supplémentaires ne sont pas cumulées sur l'année. Cumuler par année civile les heures non remplacées par du repos, alerter à l'approche du contingent paramétrable (220 h par défaut) et créditer puis transmettre la contrepartie obligatoire en repos.
  <br><sub>Preuves : shared/rules/temps.ts:57-71 · shared/types.ts:117-126 · grep contingent → aucun résultat</sub>
- [x] **Forfait jours : cumul annuel et renonciation à des jours de repos** — 🟠 Important · M
  Rien ne compare les jours travaillés au forfait (218 j) et la renonciation est même bloquée. Ajouter le cumul annuel avec alerte et l'avenant de renonciation (majoration, plafond 235 j, rubrique paie).
  <br><sub>Preuves : client/src/pages/Temps.tsx:50, :75 · shared/rules/temps.ts:79, :104 · shared/rules/profil.ts:132</sub>
- [ ] **Forfait annuel en heures : calculer la régularisation de fin d'année** — 🟠 Important · M
  L'écran signale des « heures à régulariser » mais rien ne les calcule ni ne les transmet. Ajouter une clôture annuelle produisant les rubriques Sage (heures au-delà du forfait, heures complémentaires).
  <br><sub>Preuves : shared/rules/temps.ts:105 · client/src/pages/Temps.tsx:95</sub>
- [x] **Stocker la date de naissance complète et appliquer les règles d'âge** — 🟠 Important · M
  Seule l'année est saisie : +5 CP à 59 ans et sections fin de carrière à 58 ans tombent jusqu'à un an trop tôt ou trop tard, et aucune règle mineurs n'existe. Passer à une date de naissance, puis appliquer aux moins de 18 ans les limites de durée, l'interdiction de nuit, les repos et la dérogation travaux réglementés.
  <br><sub>Preuves : shared/types.ts:71 · shared/rules/conges.ts:29 · shared/rules/entretiens.ts:56-57 · shared/rules/profil.ts:109 (14 ans accepté)</sub>
- [x] **Contrôler le congé principal et créditer les jours de fractionnement** — 🟠 Important · M
  Ni la limite de 24 jours ouvrables d'affilée, ni les 12 jours continus entre mai et octobre, ni les jours de fractionnement ne sont gérés. Ajouter ces contrôles et le crédit automatique au 31 octobre.
  <br><sub>Preuves : shared/rules/conges.ts:122-145 · shared/rules/conges.ts:26-33 · grep fraction\|L3141 → aucun résultat</sub>
- [x] **Ajouter samedi et dimanche à la feuille de temps et contrôler le repos hebdomadaire** — 🟠 Important · L
  La feuille ne compte que 5 jours : les heures du week-end (arrêts techniques, travail posté) ne peuvent pas être déclarées. Passer à 7 jours et contrôler 6 jours maximum, 35 h de repos consécutif et le repos dominical.
  <br><sub>Preuves : shared/rules/temps.ts:37 · shared/dates.ts:36 · server/src/actions/temps.ts:37 (di < 5)</sub>
- [x] **Saisir horaires ou postes pour contrôler repos, pause et travail de nuit** — 🟠 Important · L
  Une ligne de temps n'a pas d'heure de début ni de fin : repos de 11 h, pause, heures de nuit et statut de travailleur de nuit ne sont pas contrôlés. Ajouter un code de poste ou des horaires et des rubriques de nuit pour la paie.
  <br><sub>Preuves : shared/types.ts:101 · shared/rules/temps.ts:42 (heuristique > 13 h) · grep nuit\|L3122 → aucun résultat</sub>
- [ ] **Gérer les astreintes** — 🟠 Important · L
  Aucune notion d'astreinte n'existe alors qu'elle est courante en maintenance. Ajouter le planning communiqué 15 jours avant, la saisie des interventions comme travail effectif, la compensation transmise à Sage et le récapitulatif mensuel.
  <br><sub>Preuves : grep astreinte → aucun résultat · shared/types.ts:100-105</sub>
- [x] **Temps partiel : plafond d'heures complémentaires paramétrable et avenants** — 🟢 Souhaitable · M
  Le code suppose un plafond au tiers, valable seulement avec accord ; sinon c'est le dixième. Paramétrer le plafond et gérer les avenants de complément d'heures.
  <br><sub>Preuves : shared/rules/temps.ts:52-55 · shared/constants.ts:77 · grep avenant → aucun résultat</sub>
- [x] **Paramétrer la journée de solidarité et les jours fériés chômés** — 🟢 Souhaitable · M
  Le lundi de Pentecôte est toujours traité comme chômé, ce qui fausse CP, heures proposées et jours de repos du forfait s'il est travaillé. Ajouter un paramètre d'établissement (jour de solidarité, liste des fériés).
  <br><sub>Preuves : shared/dates.ts:61-70 · shared/types.ts:117-126</sub>
- [ ] **Suivre les expositions du compte professionnel de prévention (C2P)** — 🟢 Souhaitable · M
  Nuits travaillées et équipes alternantes ne sont pas comptées. Une fois les postes saisis, compter les nuits par salarié et produire l'export annuel pour la DSN.
  <br><sub>Preuves : grep C2P\|L4163 → aucun résultat · shared/types.ts:101</sub>
- [x] **CDD : enregistrer motif et renouvellements, alerter sur la durée maximale** — 🟢 Souhaitable · M
  La fiche ne demande qu'une date de fin. Ajouter motif de recours et nombre de renouvellements, avec avertissements sur la durée maximale et, à terme, le délai de carence (historique des contrats).
  <br><sub>Preuves : shared/rules/profil.ts:97 · shared/types.ts:50-84 · grep L1242\|carence → aucun résultat</sub>

## Conformité : santé, sécurité et obligations employeur

- [x] **Permettre de retirer ou suspendre manuellement une habilitation** — 🔴 Bloquant · S
  On peut délivrer ou renouveler une habilitation, jamais la retirer après un incident ou une restriction médicale ; Keystone reçoit alors toujours « Go ». Ajouter retrait et suspension (motif, date, auteur, journal) pris en compte par le statut et le Go / No Go.
  <br><sub>Preuves : server/src/actions/conformite.ts:49-64, :171 (seul hab.delivrer) · shared/constants.ts:14 · shared/domain.ts:222</sub>
- [x] **Définir les formations et habilitations exigées par poste** — 🔴 Bloquant · L
  Le statut ne regarde que les titres détenus : un cariste sans CACES apparaît « À jour ». Créer un référentiel poste → exigences, calculer les manquants dans le statut, le tableau de bord et les Échéances.
  <br><sub>Preuves : shared/domain.ts:249-262 · shared/types.ts:55 (poste en texte libre) · client/src/pages/Dashboard.tsx:59</sub>
- [x] **Afficher l'échéance d'aptitude médicale dans les Échéances et le statut** — 🟠 Important · S
  Une aptitude échue n'apparaît nulle part si le salarié n'a pas d'habilitation qui l'exige. Ajouter un type « Visite médicale » aux Échéances (filtre, export, action) et en tenir compte dans le statut.
  <br><sub>Preuves : shared/domain.ts:361-380 · shared/domain.ts:256 · client/src/pages/Echeances.tsx:55</sub>
- [x] **Remettre le compte rendu d'entretien sans signature électronique** — 🟠 Important · S
  Le compte rendu ne s'imprime qu'après signature du salarié dans Cursus ; un salarié sans compte ou qui refuse bloque la remise de la copie (L6315-1). Le rendre imprimable dès la clôture et tracer « remis en main propre / refus de signer ».
  <br><sub>Preuves : client/src/dialogs/EntDialog.tsx:107 · server/src/actions/entretiens.ts:53-58</sub>
- [x] **Go / No Go : refuser une ressource dont le contrat finit avant le chantier** — 🟠 Important · S
  Le verdict ignore la fin d'un CDD, d'une mission d'intérim ou d'une alternance, que seul Cursus connaît. Ajouter un motif CONTRAT (et facultativement ABSENCE pour les congés validés).
  <br><sub>Preuves : shared/domain.ts:383-411 · server/src/actions/absences.ts:21, :34</sub>
- [x] **Moduler la périodicité des visites selon le type de suivi (VIP, SIR)** — 🟠 Important · M
  Toutes les aptitudes durent 24 mois, d'où de fausses alertes et l'impossibilité de saisir une périodicité fixée par le médecin. Ajouter le type de suivi (déduit des habilitations ou saisi) et calculer l'échéance en conséquence.
  <br><sub>Preuves : shared/constants.ts:31 · shared/domain.ts:201 · server/src/seed.ts:26-28</sub>
- [x] **Générer les visites d'embauche, de reprise, de mi-carrière et de fin de carrière** — 🟠 Important · M
  Aucune visite n'est déclenchée par un événement. Créer automatiquement ces échéances selon le Code du travail (dont la visite post-exposition, importante sur un site chimique).
  <br><sub>Preuves : shared/domain.ts:197-199 · shared/rules/entretiens.ts:31 · grep mi-carri\|post-exposition → aucun résultat</sub>
- [x] **Identifier les postes à risques et exiger la formation renforcée des CDD et intérimaires** — 🟠 Important · M
  Ni postes ni chantiers ne portent de notion de risque particulier. Ajouter l'indicateur, la formation renforcée obligatoire pour CDD, intérimaires et alternants concernés, et un motif No Go.
  <br><sub>Preuves : shared/types.ts:32 · shared/domain.ts:383-411 · server/src/seed.ts:56 (chantier ATEX)</sub>
- [x] **Enregistrer l'avis du médecin du travail (apte, restrictions, inapte)** — 🟠 Important · M
  Seule la date de visite est gardée : impossible de saisir une inaptitude ou une restriction (charges, hauteur, conduite). Ajouter type d'avis et restrictions datées, suspendre les habilitations incompatibles et ne montrer au manager que le verdict.
  <br><sub>Preuves : shared/types.ts:76 · shared/domain.ts:196-203 · client/src/dialogs/EmployeDialog.tsx:293-294</sub>
- [x] **Suivre la période d'essai et alerter avant les fins de contrat** — 🟠 Important · M
  Aucune donnée de période d'essai n'existe et la fin de CDD ou d'intérim n'est signalée que dans la fiche. Ajouter les dates d'essai (durées CCN) et des échéances « Fin d'essai » et « Fin de contrat ».
  <br><sub>Preuves : grep essai → aucun résultat · shared/types.ts:50-84 · client/src/pages/Collaborateurs.tsx:170, :331</sub>
- [x] **Suivre les titres de séjour valant autorisation de travail** — 🟠 Important · M
  L'employeur ne peut pas employer un étranger dont l'autorisation a expiré (L5221-8), mais Cursus ne suit ni nationalité ni titre de séjour. Ajouter ce document avec échéance et alerte anticipée.
  <br><sub>Preuves : grep séjour\|nationalit → libellés de visa seulement · shared/types.ts:50-84</sub>
- [x] **Exiger le certificat de détachement (A1) pour les missions à l'étranger** — 🟠 Important · M
  Une destination ne décrit que visa, vaccins et passeport : aucune formalité de sécurité sociale ou de détachement n'est contrôlée, ni l'information écrite au-delà de 4 semaines. Ajouter ces formalités à la destination, à la préparation et au Go / No Go.
  <br><sub>Preuves : shared/types.ts:29 · shared/domain.ts:280-327 · server/src/seed.ts:34-43</sub>
- [ ] **Exporter les formations santé-sécurité vers le Passeport de prévention** — 🟠 Important · M
  Cursus a les données (SST, CACES, ATEX…) mais ne propose ni marquage ni export. Marquer ces formations au catalogue et produire l'export au format de la plateforme (à vérifier).
  <br><sub>Preuves : grep L4141 → aucun résultat · shared/types.ts:27 · server/src/seed.ts:11</sub>
- [x] **Suivre la couverture minimale en SST et équipiers incendie par équipe** — 🟠 Important · M
  Rien ne vérifie qu'un atelier garde au moins un sauveteur secouriste (R4224-15). Ajouter un seuil par équipe et une alerte quand il n'est plus atteint (expiration, départ, absence).
  <br><sub>Preuves : client/src/pages/Dashboard.tsx:57-62, :136 · grep couverture\|R4224 → aucun résultat</sub>
- [x] **Ajouter contact d'urgence et niveau de risque pays au dossier voyage** — 🟢 Souhaitable · M
  Le dossier voyage n'a ni contact d'urgence, ni coordonnées sur place, ni niveau de vigilance. Ajouter ces champs et une alerte si un pays de destination passe en zone déconseillée.
  <br><sub>Preuves : shared/types.ts:29, :95 · client/src/pages/Voyages.tsx:162, :202</sub>
- [x] **Déclencher l'entretien de parcours lié à la visite de mi-carrière** — 🟢 Souhaitable · M
  Seules les sections fin de carrière à 58 ans existent. Ajouter l'obligation d'entretien après la visite de mi-carrière, après vérification juridique du calendrier.
  <br><sub>Preuves : shared/rules/entretiens.ts:14-52, :56-57 · client/src/pages/Entretiens.tsx:59</sub>

## Bugs à corriger (calculs et données)

- [x] **Ne retenir que la dernière certification après un renouvellement** — 🔴 Bloquant · M
  Après un recyclage enregistré, l'ancienne certification expirée continue de compter : le salarié reste « Non conforme », l'échéance expirée reste affichée et les compteurs doublent. Ne retenir que la plus récente par formation dans le statut, les échéances, les KPI et la fiche, en gardant les anciennes comme historique.
  <br><sub>Preuves : server/src/actions/conformite.ts:32 (insert sans clôture) · shared/domain.ts:252-257 et :364 · client/src/pages/Formations.tsx:49 vs :63 · script : cert.ajouter {empId:2, f:'elec', date:'2026-10-06'} → worst='exp'</sub>
- [x] **N'appliquer un document déclaré par le salarié qu'après validation RH** — 🔴 Bloquant · M
  Passeport, visa ou vaccin déclaré par le salarié est écrit tout de suite ; si le RH refuse, la donnée reste et compte dans le Go / No Go, et l'ancienne valeur est perdue. Garder la déclaration dans la demande, l'afficher au RH et ne l'appliquer qu'à la validation.
  <br><sub>Preuves : server/src/actions/voyages.ts:30, :37-38, :44-45, :49-51 · server/src/actions/conformite.ts:115-121 (refus = statut seul) · client/src/pages/Dashboard.tsx:107 · reproduit : passeport FAUX123 refusé reste en base</sub>
- [x] **Rattacher soldes repris et reports de CP à une période** — 🔴 Bloquant · M
  Les compteurs repris sont déduits à vie (RTT faux dès le 1er janvier 2027, CP dès le 1er juin 2027), les reports reçus ne s'éteignent jamais et les reports accordés disparaissent à la bascule. Ajouter une période, plafonner les reports et créer une clôture tracée qui convertit et fait expirer les reports.
  <br><sub>Preuves : shared/types.ts:107-109 · shared/rules/conges.ts:30-32, :44, :81 · server/src/actions/absences.ts:55-56 · script au 2027-02-01 : Mehdi rtt pris=16 sans RTT posé</sub>
- [x] **Refuser les heures saisies sur un jour d'absence validée** — 🔴 Bloquant · M
  Une feuille peut contenir des heures un jour de CP validé, d'où un double paiement ; et la cellule déjà remplie devient verrouillée sans correction possible. Contrôler à la soumission, à la validation et à la pose d'absence, et laisser corriger une cellule remplie.
  <br><sub>Preuves : server/src/actions/temps.ts:67-75, :85-92 · shared/rules/conges.ts:128 · client/src/pages/Temps.tsx:240, :305</sub>
- [x] **Historiser les régimes de temps et contrats avec leur date d'effet** — 🔴 Bloquant · L
  Une feuille créée après un changement de régime pour une semaine antérieure prend le nouveau régime (heures sup faussées), un changement en cours d'année fait perdre les RTT acquis, et une réembauche n'est pas représentable. Créer un historique daté des contrats et avenants utilisé par les feuilles, RTT et CP.
  <br><sub>Preuves : server/src/actions/equipes.ts:73-74 · server/src/actions/temps.ts:73 · shared/rules/conges.ts:68-70, :77-79 · script : 39 h→35 h → {HN:35, HS25:4} sur semaine antérieure</sub>
- [x] **Afficher au manager le statut de dossier voyage calculé par le serveur** — 🟠 Important · S
  Le manager voit « À compléter » là où le RH voit « Prêt », car le statut est recalculé sans les vaccins masqués. Utiliser d.tripStatus() comme dans Missions.
  <br><sub>Preuves : client/src/pages/Collaborateurs.tsx:155, :317 · server/src/dataset.ts:116-123 · client/src/pages/Missions.tsx:30</sub>
- [x] **Utiliser l'année ISO pour les semaines à cheval sur deux ans** — 🟠 Important · S
  La semaine du 29/12/2025 part à Sage en « 2025-S01 » au lieu de 2026-S01 et le cumul du forfait annuel est mal rattaché. Calculer l'année du jeudi et ventiler le cumul jour par jour, avec test aux bornes.
  <br><sub>Preuves : shared/rules/temps.ts:137, :82 · shared/dates.ts:39-44</sub>
- [x] **Bloquer une journée de plus de 24 h** — 🟠 Important · S
  Deux lignes à 20 h le même jour sont acceptées puis payées. Refuser plus de 24 h par jour toutes lignes cumulées et demander un motif au-delà de 10 h ou 48 h.
  <br><sub>Preuves : server/src/actions/temps.ts:39, :67-75 · shared/rules/temps.ts:37-46</sub>
- [x] **Proratiser RTT et jours de repos jusqu'à la fin de contrat** — 🟠 Important · S
  Un CDD de janvier à mars reçoit 23 RTT au lieu d'environ 6. Borner le calcul sur l'entrée et la date de fin.
  <br><sub>Preuves : shared/rules/conges.ts:64-71 · shared/rules/conges.ts:12-19</sub>
- [x] **Rejeter les dates impossibles** — 🟠 Important · S
  « 2026-02-31 » ou « 2026-13-45 » sont acceptées puis décalées au mois suivant, notamment via l'import CSV et l'API Keystone. Vérifier que la date relue est identique.
  <br><sub>Preuves : shared/dates.ts:11-13, :46-51 · server/src/index.ts:152</sub>
- [x] **Interdire la clôture d'un entretien avant sa date** — 🟠 Important · S
  Un entretien futur peut être clos et signé, ce qui fausse l'échéance suivante et l'état des lieux à 8 ans. Exiger une date passée ou mettre la date à jour à la clôture.
  <br><sub>Preuves : server/src/actions/entretiens.ts:46-50 · shared/rules/entretiens.ts:23, :29, :38</sub>
- [x] **Contrôler action du plan, date et places à la création de session** — 🟠 Important · S
  Une action déjà réalisée repasse « engagée », une action inexistante passe sans erreur, et une session peut être créée dans le passé avec 2,5 places. Exiger une action existante « prévue » de la même formation, une date future et un nombre entier de places.
  <br><sub>Preuves : server/src/actions/conformite.ts:41-45 · client/src/dialogs/SessionDialog.tsx:37</sub>
- [x] **Refuser absences et feuilles hors de la période de contrat** — 🟠 Important · S
  Un CP après la fin d'un CDD ou une feuille de 2020 pour un intérimaire entré en 2026 sont acceptés. Borner sur entrée et fin de contrat.
  <br><sub>Preuves : shared/rules/conges.ts:122-144 · server/src/actions/temps.ts:18-27</sub>
- [x] **Calculer « aujourd'hui » dans le fuseau Europe/Paris** — 🟠 Important · S
  Sur un serveur en UTC, « aujourd'hui » reste la veille entre minuit et 2 h : échéances, Go / No Go et bascules sont décalés ; l'envoi Sage porte une heure fixe fausse en hiver. Calculer la date en Europe/Paris et horodater réellement.
  <br><sub>Preuves : server/src/dataset.ts:20-23 · shared/dates.ts:8-10 · shared/rules/temps.ts:134</sub>
- [x] **Go / No Go : n'accepter qu'un déplacement couvrant les dates du chantier** — 🟠 Important · S
  N'importe quel voyage vers le même pays, même des mois plus tard, valide le chantier. Exiger départ avant le début et retour après la fin, sinon motif « couverture partielle ».
  <br><sub>Preuves : shared/domain.ts:401 · shared/domain.ts:330-336 · script : voyage Maroc en mars → Go pour Tanger en novembre</sub>
- [x] **Dater les tâches Keystone pour ne proposer que les heures de la semaine** — 🟠 Important · S
  « Proposer depuis Keystone » recopie les mêmes heures chaque semaine, même avant le début du chantier. Ajouter des dates aux tâches et filtrer sur la semaine affichée.
  <br><sub>Preuves : shared/types.ts:98 · shared/rules/temps.ts:94-100 · server/src/seed.ts:54, :166</sub>
- [x] **Imputer chaque jour de CP sur sa période de référence** — 🟠 Important · M
  Des CP de juillet 2027 sont déduits de la période en cours, des jours de juin d'une absence commencée en mai ne sont jamais décomptés, et les CP pris par anticipation sont effacés au 1er juin. Ventiler jour par jour et contrôler contre le solde de la bonne période.
  <br><sub>Preuves : shared/rules/conges.ts:40-42 · shared/rules/conges.ts:127-131 · script : solde -19 au 20/05/2027 puis +10 au 15/06/2027</sub>
- [x] **Permettre de poser des RTT de l'année suivante avant le 1er janvier** — 🟠 Important · M
  Un RTT du 5 janvier demandé en octobre est refusé. Évaluer la demande sur le droit de l'année de la date et ne bloquer que les demandes à cheval.
  <br><sub>Preuves : shared/rules/conges.ts:132, :139 · shared/rules/conges.ts:64-82</sub>
- [x] **Contrôler doublons et conflits de dates (formation, absence, déplacement, entretien)** — 🟠 Important · M
  On peut créer deux demandes de formation identiques, deux entretiens planifiés, deux déplacements qui se chevauchent, ou inscrire un salarié en formation pendant ses congés. Ajouter un contrôle commun (avertissement ou blocage) affiché dans les dialogues.
  <br><sub>Preuves : server/src/actions/conformite.ts:7-24, :136-151 · server/src/actions/entretiens.ts:15-23 · server/src/actions/voyages.ts:10-20 · shared/rules/conges.ts:128-129</sub>
- [x] **Afficher l'horodatage réel dans « Réponse transmise à Keystone »** — 🟢 Souhaitable · S
  Le panneau affiche une heure fictive (07:00+02:00) différente de la réponse réelle. Utiliser le même horodatage que l'endpoint.
  <br><sub>Preuves : shared/domain.ts:425 · client/src/pages/Chantiers.tsx:19 · server/src/index.ts:143</sub>
- [x] **Générer une référence pour les déplacements importés sans référence** — 🟢 Souhaitable · S
  L'origine affichée devient « Formulaire de demande null » et la colonne demandeur est ignorée. Générer DD-<id> comme le prototype et conserver le demandeur.
  <br><sub>Preuves : server/src/actions/voyages.ts:61 · shared/domain.ts:357 · shared/rules/imports.ts:67-70 · design/prototype-suivi-formations.dc.html:2574</sub>
- [x] **Marquer « en attente » une habilitation expirée dont la demande est acceptée** — 🟢 Souhaitable · S
  Le message annonce « en attente de délivrance » mais le titre reste « Expirée », sans date de demande. Renseigner la demande sur le titre existant et l'afficher.
  <br><sub>Preuves : server/src/actions/conformite.ts:107-109, :158 · shared/domain.ts:219-222</sub>
- [x] **Limiter l'import « Remplacer » du plan aux lignes importées** — 🟢 Souhaitable · S
  Le mode Remplacer efface aussi les lignes issues de demandes acceptées, qui restent affichées « Ajoutée au plan ». Ne supprimer que les lignes d'origine import.
  <br><sub>Preuves : server/src/actions/budget.ts:13 · server/src/actions/conformite.ts:102-103</sub>
- [x] **Libérer la place de session quand une certification clôt une inscription** — 🟢 Souhaitable · S
  Saisir la certification supprime l'inscription sans décrémenter le compteur : la session peut paraître complète à tort. Décrémenter ou recalculer les inscrits.
  <br><sub>Preuves : server/src/actions/conformite.ts:34 · server/src/actions/conformite.ts:91-95</sub>
- [x] **Borner le calcul des échéances au dernier jour du mois** — 🟢 Souhaitable · S
  Un titre obtenu le 29/02/2024 + 36 mois expire au 01/03/2027 au lieu du 28/02. Ramener au dernier jour du mois cible.
  <br><sub>Preuves : shared/dates.ts:14-18 · shared/domain.ts:189, :201, :220</sub>

## Bugs de l'interface

- [x] **Bloquer clôture et signature d'un entretien si une section n'est pas enregistrée** — 🟠 Important · S
  Une section dont l'envoi a échoué est marquée enregistrée, puis l'entretien est clos sans elle et n'est plus modifiable. Ne marquer qu'après succès et interrompre la clôture en cas d'échec.
  <br><sub>Preuves : client/src/dialogs/EntDialog.tsx:43-47, :76-82 · server/src/actions/entretiens.ts:49</sub>
- [x] **Bloquer les doubles clics et rendre les transitions idempotentes** — 🟠 Important · S
  Un double clic sur « Engager » passe la ligne du plan directement en « Réalisé » ; ailleurs le second appel affiche une erreur qui masque le succès, et la croix de ligne supprime deux lignes. Désactiver les boutons pendant l'appel et envoyer le statut attendu au serveur.
  <br><sub>Preuves : client/src/pages/Budget.tsx:34-37, :139-140 · server/src/actions/budget.ts:37-43 · client/src/pages/Absences.tsx:143-144 · client/src/pages/Temps.tsx:310 et server/src/actions/temps.ts:54-57</sub>
- [x] **Empêcher la fermeture involontaire des dialogues** — 🟠 Important · S
  Une sélection de texte relâchée sur le fond ferme le dialogue et perd la saisie (fiche de 30 champs, CSV collé). Ne fermer que si clic complet sur le fond et demander confirmation si le formulaire est modifié.
  <br><sub>Preuves : client/src/components/Dialog.tsx:10, :15, :18 · client/src/dialogs/EmployeDialog.tsx:121</sub>
- [x] **Gérer les échecs de chargement et les erreurs de rendu** — 🟠 Important · S
  Si le serveur ne répond pas, l'écran reste sur « Chargement… » ou propose à tort l'authentification unique, et une erreur de rendu laisse un écran blanc. Ajouter un écran d'erreur avec « Réessayer » et une ErrorBoundary par page et autour des dialogues.
  <br><sub>Preuves : client/src/App.tsx:31-33 · client/src/state/store.tsx:123-129, :138 · client/src/pages/Login.tsx:22 · grep ErrorBoundary client/src → aucun résultat</sub>
- [x] **Corriger les notifications d'erreur** — 🟠 Important · S
  Une erreur s'affiche avec une coche verte, n'est pas annoncée aux lecteurs d'écran, disparaît en 4,5 s et montre « Failed to fetch ». Ajouter une région live permanente, role=alert, icône d'avertissement, fermeture manuelle et messages réseau en français.
  <br><sub>Preuves : client/src/layout/Shell.tsx:130-138 · client/src/state/store.tsx:120 · client/src/api.ts:16, :22-23, :38-39</sub>
- [x] **Rafraîchir les données au retour sur l'onglet et périodiquement** — 🟠 Important · S
  Un manager qui garde l'écran ouvert ne voit pas les nouvelles demandes de son équipe. Recharger au retour sur l'onglet, toutes les quelques minutes et après une action refusée.
  <br><sub>Preuves : client/src/state/store.tsx:163-168, :209 · grep visibilitychange\|setInterval client/src → aucun résultat</sub>
- [x] **Gérer l'expiration de session sans perdre la saisie** — 🟠 Important · M
  À l'expiration (12 h), l'écran bascule sur la connexion, démonte le dialogue ouvert et le rouvre vide après reconnexion. Afficher une reconnexion par-dessus l'écran qui rejoue l'action, ou au minimum conserver le brouillon.
  <br><sub>Preuves : client/src/state/store.tsx:168, :191-200 · client/src/api.ts:23, :38-39 · client/src/App.tsx:32</sub>
- [x] **Ignorer les réponses obsolètes dans run()** — 🟢 Souhaitable · S
  Une réponse ancienne arrivée après une plus récente peut vider une cellule d'heures enregistrée. N'appliquer que la réponse de la dernière requête ou sérialiser les actions.
  <br><sub>Preuves : client/src/state/store.tsx:161-164 · client/src/dialogs/EntDialog.tsx:29, :46</sub>
- [x] **Fiabiliser le changement d'espace et la déconnexion** — 🟢 Souhaitable · S
  Sans réseau, aucun message n'apparaît et les filtres sont perdus ; pendant le changement d'espace, la page du nouveau rôle s'affiche brièvement avec les données de l'ancien. Gérer l'erreur et attendre les nouvelles données avant d'afficher.
  <br><sub>Preuves : client/src/state/store.tsx:132-135, :183-189, :202-207 · client/src/state/derived.ts:47-50</sub>
- [x] **Traiter les propres entretiens du manager dans l'espace manager** — 🟢 Souhaitable · S
  Ses entretiens apparaissent et comptent dans le badge « en retard », mais il ne peut ni rédiger ni signer. Les masquer avec renvoi vers l'espace collaborateur ou aligner les droits sur « soi-même ».
  <br><sub>Preuves : server/src/dataset.ts:102 · client/src/dialogs/EntDialog.tsx:36, :62 · server/src/actions/entretiens.ts:30, :55</sub>
- [x] **Rendre atomique la modification d'une équipe** — 🟢 Souhaitable · S
  Renommage puis changement de manager sont deux appels : si le second échoue, la saisie est perdue. Créer une action unique ou garder le dialogue ouvert.
  <br><sub>Preuves : client/src/dialogs/EquipeDialog.tsx:57-69 · server/src/actions/equipes.ts:91, :104</sub>
- [x] **Ajouter les messages de liste vide au tableau de bord et aux missions** — 🟢 Souhaitable · S
  Sur une base vide, le tableau de bord n'affiche que des cadres vides. Ajouter « Aucune échéance », « Aucune session », etc.
  <br><sub>Preuves : client/src/pages/Dashboard.tsx:127-128, :150, :168 · client/src/pages/Missions.tsx:107-108</sub>
- [x] **Revenir au dialogue d'origine après « Créer une session »** — 🟢 Souhaitable · S
  Après création, le RH est renvoyé vers Formations et doit retrouver le collaborateur pour l'inscrire. Rouvrir le dialogue de planification avec la session présélectionnée.
  <br><sub>Preuves : client/src/dialogs/PlanDialog.tsx:40 · client/src/dialogs/SessionDialog.tsx:27-28 · client/src/dialogs/ReqFormDialog.tsx:106</sub>
- [x] **Détecter les modifications concurrentes d'une fiche** — 🟢 Souhaitable · M
  Deux personnes qui modifient la même fiche s'écrasent sans avertissement. N'envoyer que les champs modifiés avec une version vérifiée par le serveur.
  <br><sub>Preuves : client/src/dialogs/EmployeDialog.tsx:84, :132 · server/src/actions/equipes.ts:53</sub>

## Fonctions métier : formations, habilitations, sessions

- [x] **Clôturer les sessions passées : présence, résultats et recyclages** — 🔴 Bloquant · L
  Une certification rattachée à une session passée reste « planifiée » sans action, et le Go / No Go donne « Go sous réserve » à quelqu'un qui a manqué son recyclage. Afficher « Session passée », et créer une clôture de session (présents → certification, absents → replanification, plan réalisé, évaluation à chaud).
  <br><sub>Preuves : shared/domain.ts:193, :366-368, :396-397 · client/src/pages/Collaborateurs.tsx:243-244 vs :263-281 · client/src/pages/Dashboard.tsx:55 · CURSUS_TODAY=2026-10-20 : Inès Dupont EPI et Camille Roux SST restent planifiées</sub>
- [x] **Permettre au RH d'administrer formations, habilitations et destinations** — 🔴 Bloquant · L
  Catalogue, validités, coûts, prérequis, signataires, règles de visa et vaccins ne viennent que des données de démo ou du code : l'entreprise ne peut pas déclarer les siens. Ajouter un onglet Référentiels (création, modification, archivage plutôt que suppression, journal).
  <br><sub>Preuves : server/src/seed.ts:294-296 (seuls écrivains) · shared/constants.ts:33-46 (VACCINS, VISA_RULES) · client/src/pages/Voyages.tsx:162 (« tenues par le service RH ») · shared/domain.ts:101-102 (fm()!/hm()!)</sub>
- [x] **Saisir le coût réel à la clôture d'une action du plan** — 🟠 Important · S
  « Clôturer » garde le coût estimé : le réalisé et la consommation des enveloppes sont faux. Demander le coût (et l'effectif) réels.
  <br><sub>Preuves : server/src/actions/budget.ts:37-45 · client/src/pages/Budget.tsx:140</sub>
- [x] **Gérer le cycle de vie des sessions : confirmer, modifier, annuler, voir les inscrits** — 🟠 Important · M
  Une session reste « À confirmer » pour toujours, ne peut être ni modifiée ni annulée, et le RH ne voit qu'un compteur d'inscrits. Ajouter confirmer (avec envoi de la liste à l'organisme), modifier, annuler (libère inscriptions et certifications) et le détail nominatif des inscrits.
  <br><sub>Preuves : server/src/actions/conformite.ts:44, :170 (seul session.creer) · shared/types.ts:89 · client/src/pages/Formations.tsx:172-184 · shared/types.ts:27 (organisme sans contact)</sub>
- [x] **Ajouter « Envoyer la convocation » et « Désinscrire »** — 🟠 Important · M
  Après « Envoyer plus tard », la convocation reste « à envoyer » pour toujours, et on ne peut pas désinscrire quelqu'un. Ajouter l'envoi (unitaire et groupé, daté, par e-mail avec .ics) et la désinscription qui libère la place.
  <br><sub>Preuves : client/src/dialogs/PlanDialog.tsx:70 · client/src/pages/Collaborateurs.tsx:243, :275 · server/src/actions/conformite.ts:15, :21, :90, :93 · README.md:85</sub>
- [x] **Suivre les demandes de visite médicale** — 🟠 Important · M
  « Demander une visite médicale » ne fait qu'afficher un message : rien n'est enregistré ni envoyé et le bouton reste proposé. Stocker la demande, l'envoyer au service de santé au travail, afficher « Visite demandée le … » et la clore à la saisie de la visite.
  <br><sub>Preuves : server/src/actions/conformite.ts:66-70 · shared/domain.ts:245 · client/src/state/store.tsx:178</sub>
- [x] **Imprimer le titre d'habilitation et le passeport formation du collaborateur** — 🟠 Important · M
  Aucun titre d'habilitation à signer n'est produit (NF C18-510, R489), un renouvellement écrase l'ancienne délivrance, et le collaborateur ne peut pas imprimer son passeport formation. Ajouter l'impression du titre, une ligne par délivrance et l'impression depuis le portail.
  <br><sub>Preuves : client/src/dialogs/HabDialog.tsx:67 · server/src/actions/conformite.ts:59-61 · grep printDocument → Collaborateurs.tsx:208, EntDialog.tsx:100 · shared/constants.ts:117</sub>
- [x] **Historiser les formations suivies, y compris hors catalogue** — 🟠 Important · M
  Une formation hors catalogue devient une ligne de plan par équipe sans lien avec le salarié, et l'état des lieux à 8 ans peut signaler à tort un risque CPF. Créer une table des formations réalisées par salarié.
  <br><sub>Preuves : shared/rules/entretiens.ts:39 · server/src/actions/conformite.ts:102 · shared/types.ts:92</sub>
- [x] **Clôturer l'exercice du plan de formation et consulter les années passées** — 🟠 Important · M
  Après le 1er janvier, le plan de l'année écoulée n'est plus consultable et les enveloppes doivent être ressaisies. Proposer tous les exercices, une clôture avec report des actions engagées et la copie des enveloppes.
  <br><sub>Preuves : client/src/pages/Budget.tsx:26 · server/src/actions/budget.ts:21-34</sub>
- [x] **Gérer des sessions sur plusieurs jours avec horaires** — 🟠 Important · M
  Une session n'a qu'une date alors que certaines formations durent 21 à 35 h. Ajouter début, fin, jours et horaires, et préremplir la feuille de temps.
  <br><sub>Preuves : shared/types.ts:89 · client/src/dialogs/SessionDialog.tsx:42 · server/src/seed.ts:11-19</sub>
- [x] **Corriger ou supprimer une saisie erronée (certification, action du plan, demande)** — 🟠 Important · L
  Une certification saisie avec une mauvaise date ou formation reste en base et peut lever un prérequis d'habilitation ; plan et demandes ne sont pas non plus modifiables. Ajouter modification et suppression tracées (RH), avec libération des places de session.
  <br><sub>Preuves : server/src/actions/conformite.ts:26-36 · client/src/dialogs/CertDialog.tsx:22, :39 · server/src/actions/budget.ts:46-50 · grep remove('certifications' → aucun résultat</sub>
- [ ] **Gérer une liste d'attente pour les sessions complètes** — 🟢 Souhaitable · M
  Une demande acceptée sur une session pleine bascule en silence dans le plan. Ajouter une liste d'attente et l'inscription automatique quand une place se libère.
  <br><sub>Preuves : server/src/actions/conformite.ts:16, :79-81, :99-104</sub>
- [ ] **Enregistrer l'évaluation des formations** — 🟢 Souhaitable · M
  Rien ne mesure l'efficacité d'une formation (ISO 9001/45001). Ajouter une évaluation à chaud et à froid rattachée à l'inscription et un indicateur par organisme.
  <br><sub>Preuves : shared/types.ts:44, :91 · grep satisfaction → aucun résultat</sub>
- [x] **Exporter le plan de formation et les indicateurs du bilan social** — 🟢 Souhaitable · M
  Le plan n'a aucun export et la durée d'une formation est du texte. Ajouter une durée en heures et des exports par exercice et par catégorie.
  <br><sub>Preuves : shared/types.ts:27 · client/src/pages/Budget.tsx:43-47</sub>

## Fonctions métier : collaborateurs, temps, absences, déplacements

- [x] **Outiller la mise en service : import des salariés, soldes d'ouverture et titres** — 🔴 Bloquant · L
  Une base vide reçoit d'office 24 salariés fictifs même hors démo, et rien ne permet d'importer l'effectif, les soldes repris (forcés à 0) ni les certifications, habilitations et visites existantes. Ne charger la démo qu'en mode démo et ajouter des imports CSV avec aperçu et rapport d'erreurs.
  <br><sub>Preuves : server/src/index.ts:20-23 (seed sans tester DEMO) · server/src/actions/equipes.ts:41 (soldes à 0) · shared/rules/imports.ts:26, :64 (seuls plan et voyages) · CURSUS_DEMO=0 base neuve → 24 salariés</sub>
- [x] **Gérer la sortie d'un collaborateur** — 🔴 Bloquant · L
  Un CDI ne peut pas avoir de date de fin, et un salarié parti reste dans la conformité, les échéances, le Go / No Go et peut encore saisir. Ajouter date et motif de sortie, une action RH et l'exclusion des sortis des calculs et des saisies.
  <br><sub>Preuves : shared/rules/profil.ts:62, :74 · client/src/dialogs/EmployeDialog.tsx:231 · shared/domain.ts:251 · server/src/actions/temps.ts:18-29</sub>
- [x] **Permettre d'annuler une absence demandée ou validée** — 🟠 Important · M
  Le salarié ne peut pas retirer sa demande et une absence validée ne peut pas être annulée, alors qu'elle bloque les dates et débite le solde. Ajouter l'annulation selon statut et rôle, avec message d'annulation à Keystone.
  <br><sub>Preuves : server/src/actions/absences.ts:60-65 · server/src/integrations/keystone.ts:7-11 · shared/rules/conges.ts:128</sub>
- [x] **Modifier ou annuler un déplacement et reprogrammer un entretien** — 🟠 Important · M
  Un déplacement annulé reste et pèse sur le Go / No Go ; un entretien reporté reste « planifié » à une date passée et masque le retard. Ajouter modifier/annuler pour les voyages (avec notification Keystone) et reprogrammer/annuler pour les entretiens, en refusant les doublons.
  <br><sub>Preuves : server/src/actions/voyages.ts:90-96 · server/src/actions/entretiens.ts:15-23, :60-65 · shared/rules/entretiens.ts:25-26</sub>
- [ ] **Utiliser et liquider les jours épargnés sur le CET** — 🟠 Important · M
  Le CET ne fait que se remplir. Ajouter un congé pris sur le CET, la monétisation et la liquidation à la sortie.
  <br><sub>Preuves : shared/types.ts:15, :106 · server/src/actions/absences.ts:38-48</sub>
- [x] **Calculer l'état des compteurs à la date de sortie** — 🟠 Important · M
  À la sortie, seule une phrase annonce l'indemnité compensatrice. Calculer CP restants et en cours, RTT au prorata, repos et CET, puis les éditer et les transmettre à la paie.
  <br><sub>Preuves : shared/rules/conges.ts:141, :46, :85-96</sub>
- [x] **Permettre les demi-journées de congé, RTT ou récupération** — 🟠 Important · M
  Une absence se compte en journées entières. Ajouter matin / après-midi sur le premier et le dernier jour.
  <br><sub>Preuves : shared/types.ts:105 · shared/domain.ts:162-173</sub>
- [x] **Suivre les feuilles de temps par semaine et valider en groupe** — 🟠 Important · M
  Rien ne montre qui n'a pas saisi ou doit corriger avant l'envoi à Sage. Ajouter un tableau semaine × collaborateur, la relance et la validation groupée.
  <br><sub>Preuves : client/src/pages/Temps.tsx:129-132, :141-143 · server/src/actions/temps.ts:85-92</sub>
- [x] **Rouvrir une feuille validée et transmettre une régularisation** — 🟠 Important · M
  Une erreur découverte après validation ou envoi ne peut pas être corrigée. Ajouter une réouverture RH motivée et l'envoi d'un correctif à Sage et Keystone.
  <br><sub>Preuves : server/src/actions/temps.ts:24-25, :112-121</sub>
- [x] **Administrer les codes d'imputation internes et suivre les heures de délégation** — 🟠 Important · M
  Les codes hors projet (INT-*, ECOLE) sont figés par la démo et les heures de délégation CSE ne sont pas suivies. Permettre au RH de gérer ces codes et ajouter un compteur mensuel de délégation.
  <br><sub>Preuves : server/src/seed.ts:47-52 · server/src/actions/temps.ts:45-51</sub>
- [x] **Stocker les pièces justificatives** — 🟠 Important · L
  Aucun fichier ne peut être joint (attestations, cartes CACES, titres signés, passeports) : le RH valide un document sans le voir. Ajouter stockage, envoi et téléchargement contrôlés par rôle.
  <br><sub>Preuves : grep upload\|multipart → aucun résultat · server/src/index.ts:27 · server/src/actions/conformite.ts:114-115</sub>
- [x] **Paramétrer la campagne d'entretiens annuels** — 🟢 Souhaitable · S
  Les dates (1er octobre – 15 décembre) et la population sont codées en dur. Les rendre paramétrables (dates, ancienneté minimale, contrats).
  <br><sub>Preuves : shared/rules/entretiens.ts:48-49 · client/src/pages/Parametres.tsx:96-121</sub>
- [x] **Déléguer la validation d'un manager absent** — 🟢 Souhaitable · M
  Pendant les congés du manager, tout reste en attente ou revient au RH. Ajouter une délégation datée à un suppléant.
  <br><sub>Preuves : shared/domain.ts:111-116 · server/src/actions/context.ts:54-56</sub>
- [x] **Gérer une hiérarchie à plusieurs niveaux** — 🟢 Souhaitable · L
  Un responsable ne voit pas les équipes de ses chefs d'équipe. Ajouter une équipe parente et une consultation N+2 en lecture.
  <br><sub>Preuves : shared/types.ts:30 · server/src/dataset.ts:98-105</sub>

## Ergonomie & accessibilité

- [x] **Gérer le focus dans les dialogues** — 🟠 Important · S
  À l'ouverture le focus ne va pas dans le dialogue et Tab parcourt la page derrière. Ajouter focus initial, piège Tab, retour au bouton d'origine et aria-labelledby.
  <br><sub>Preuves : client/src/components/Dialog.tsx:9-25, :17</sub>
- [x] **Rendre les dialogues défilables sur petit écran** — 🟠 Important · S
  Un dialogue plus haut que l'écran est coupé et ses boutons deviennent inaccessibles. Rendre le fond défilable et passer les formulaires en une colonne sous 600 px.
  <br><sub>Preuves : client/src/styles/nocturne.css:277-281 · client/src/styles/app.css:157-161</sub>
- [x] **Afficher le panneau de détail dans le champ de vision sur petit écran** — 🟠 Important · S
  Sur téléphone, toucher une ligne ouvre la fiche sous toute la liste, sans effet visible. Faire défiler et placer le focus sur le panneau, ou l'afficher en plein écran.
  <br><sub>Preuves : client/src/styles/app.css:188 · client/src/pages/Collaborateurs.tsx:127</sub>
- [x] **Ajouter des exports CSV aux listes RH** — 🟠 Important · S
  Seule la page Échéances s'exporte ; en cas d'audit, le RH ne peut extraire ni le registre des habilitations, ni l'annuaire, ni les soldes, ni le plan. Ajouter « Exporter (CSV) » respectant les filtres.
  <br><sub>Preuves : grep downloadCsv → Echeances.tsx:44 seulement · client/src/print.ts:39-48</sub>
- [x] **Demander confirmation et motif avant les refus et actions irréversibles** — 🟠 Important · M
  Refus d'absence ou de demande, refus Keystone, suppression de ligne, clôture d'entretien, transmission à Sage partent en un clic, et le salarié ne voit jamais le motif du refus. Créer un dialogue de confirmation avec motif (remplaçant les window.confirm) et stocker le motif.
  <br><sub>Preuves : client/src/pages/Dashboard.tsx:110 (refus sans motif) · server/src/actions/conformite.ts:120 · client/src/pages/Absences.tsx:143 · client/src/pages/Equipes.tsx:209-210, :252</sub>
- [x] **Rendre accessibles au clavier les lignes et cartes cliquables** — 🟠 Important · M
  Plusieurs écrans ne s'ouvrent qu'à la souris ; un collaborateur au clavier ne peut pas ouvrir son entretien pour le signer. Utiliser de vrais boutons ou un composant accessible commun.
  <br><sub>Preuves : client/src/pages/Entretiens.tsx:104-105 · client/src/pages/Collaborateurs.tsx:97 · grep tabIndex → Equipes.tsx:90 seulement</sub>
- [x] **Adapter la saisie des heures au téléphone et étiqueter chaque cellule** — 🟠 Important · M
  La grille demande environ 620 px et toutes les cellules s'appellent « Heures » pour un lecteur d'écran. Étiqueter projet et jour, et proposer une vue par jour sur mobile.
  <br><sub>Preuves : client/src/pages/Temps.tsx:37-39, :299, :284-321</sub>
- [x] **Rendre explicite la validation des formulaires** — 🟠 Important · M
  Dix-huit dialogues grisent le bouton sans dire pourquoi et Entrée ne valide pas. Marquer les champs obligatoires, afficher l'erreur sous chaque champ et utiliser de vrais formulaires.
  <br><sub>Preuves : client/src/dialogs/SessionDialog.tsx:19, :34 · client/src/dialogs/EmployeDialog.tsx:145-148 · grep aria-invalid → aucun résultat</sub>
- [x] **Ajouter tri par colonne et pagination aux grandes listes** — 🟠 Important · M
  Aucun tableau n'est triable ni paginé ; la page Absences affiche tous les soldes et absences sans filtre. Ajouter tri, filtres et pagination au-delà d'environ 50 lignes.
  <br><sub>Preuves : grep aria-sort → aucun résultat · client/src/pages/Absences.tsx:56, :62-67 · client/src/pages/Collaborateurs.tsx:57-60</sub>
- [x] **Adapter les contrôles au tactile** — 🟢 Souhaitable · S
  Champs en 14 px (zoom iOS), petites cibles et contrôles segmentés qui débordent à 360 px. Passer à 16 px, 44 px minimum et autoriser le retour à la ligne.
  <br><sub>Preuves : client/src/styles/nocturne.css:165-167, :188-191 · client/src/pages/Temps.tsx:310</sub>
- [x] **Ajouter lien d'évitement, titre par page et annonce de navigation** — 🟢 Souhaitable · S
  Pas de lien « Aller au contenu », titre d'onglet identique partout et changement de page non annoncé. Ajouter ces trois éléments.
  <br><sub>Preuves : client/index.html:7 · client/src/state/store.tsx:154-159</sub>
- [x] **Rendre accessible la grille de planning des missions** — 🟢 Souhaitable · S
  Le sens des cases n'est donné que par la couleur et une infobulle. Ajouter un résumé textuel et un détail au toucher ou au focus.
  <br><sub>Preuves : client/src/pages/Missions.tsx:94-97</sub>
- [x] **Rendre visibles les bordures des champs** — 🟢 Souhaitable · S
  Bordure de champ à 1,6:1 et métadonnées à 4,3:1, sous les seuils WCAG. Renforcer ces couleurs.
  <br><sub>Preuves : client/src/styles/nocturne.css:16, :168-169, :212-215</sub>
- [x] **Signaler au collaborateur ce qui attend une action** — 🟢 Souhaitable · S
  Un compte rendu à signer ou une feuille renvoyée ne sont visibles qu'en ouvrant la page. Ajouter des pastilles sur « Mes entretiens » et « Mes heures ».
  <br><sub>Preuves : client/src/layout/Shell.tsx:46-49 · client/src/pages/Entretiens.tsx:40</sub>
- [x] **Créer une navigation mobile** — 🟢 Souhaitable · M
  Sous 900 px le menu RH (14 entrées) s'empile au-dessus de chaque page. Ajouter un menu repliable ou une barre d'onglets.
  <br><sub>Preuves : client/src/styles/app.css:183-189 · client/src/layout/Shell.tsx:30-36</sub>
- [x] **Faire une vraie recherche globale de collaborateurs** — 🟢 Souhaitable · M
  La recherche est réservée au RH, ignore le matricule et redirige dès la première lettre ; les listes déroulantes n'affichent que le nom. Ajouter des suggestions qui ouvrent la fiche, réutilisées dans les dialogues.
  <br><sub>Preuves : client/src/layout/Shell.tsx:114, :119 · client/src/pages/Collaborateurs.tsx:59</sub>
- [x] **Rendre l'impression fiable et lisible** — 🟢 Souhaitable · M
  Ctrl+P donne un texte quasi blanc, l'impression échoue si les fenêtres surgissantes sont bloquées et les documents n'ont pas d'en-tête d'entreprise. Redéfinir les couleurs d'impression, imprimer via iframe, ajouter format A4, raison sociale et matricule.
  <br><sub>Preuves : client/src/styles/app.css:192-196 · client/src/print.ts:9-10, :32 · shared/types.ts:117-126</sub>
- [x] **Refléter la sélection et les filtres dans l'adresse de la page** — 🟢 Souhaitable · M
  On ne peut pas partager le lien d'une fiche ou d'une feuille et F5 perd la sélection. Encoder fiche, semaine et filtres dans l'URL.
  <br><sub>Preuves : client/src/state/store.tsx:98, :139, :154-159</sub>
- [x] **Rédiger un guide utilisateur par rôle** — 🟢 Souhaitable · M
  Seule une documentation technique existe. Rédiger un guide court pour RH, manager et collaborateur et la procédure mensuelle de transmission à Sage.
  <br><sub>Preuves : ls docs → ARCHITECTURE.md uniquement</sub>

## Tests & qualité

- [x] **Créer une CI GitHub Actions et figer la version de Node** — 🟠 Important · S
  Typecheck et tests (41, tous verts) ne tournent qu'à la main. Ajouter un workflow (npm ci, typecheck, test, build) sur Node 22 figé par .nvmrc et aligner @types/node sur Node 22.
  <br><sub>Preuves : ls .github → absent · package.json:7-8 (node >=22.18) et :30 (@types/node ^24) · npm test → 41 pass ; tsc --noEmit → 0</sub>
- [x] **Extraire createApp et tester la couche HTTP** — 🟠 Important · M
  index.ts démarre le serveur dès l'import : aucune route, ni l'authentification, ni l'API Keystone n'est testée. Extraire l'application puis tester 401/403/404/501, cookies altérés, clé Keystone et données manager.
  <br><sub>Preuves : server/src/index.ts:18, :169 · couverture auth.ts 44 %, index.ts absent · grep /api/\|fetch( tests → aucun résultat</sub>
- [x] **Ajouter un test « matrice des droits » par action et rôle** — 🟠 Important · M
  Les refus 403 ne sont testés que ponctuellement, et 21 des 42 actions ne sont jamais appelées. Écrire une table action × rôle qui échoue si une action n'a pas de règle testée.
  <br><sub>Preuves : server/src/actions/index.ts:12-21 · tests/server.test.ts:46-51</sub>
- [x] **Tester le code client** — 🟠 Important · M
  Les 45 fichiers du client n'ont aucun test. Extraire et tester les fonctions pures (run, api.action, CSV), puis les dialogues critiques avec Vitest et Testing Library.
  <br><sub>Preuves : package.json:18 · client/src/state/store.tsx:100 · client/src/print.ts:41</sub>
- [ ] **Couvrir par des tests les actions et règles non testées** — 🟠 Important · L
  Entretiens, budget et paramètres sont à 0 % de fonctions couvertes ; voyages, demandes, CET, reports, rejet de feuille, annulation de transaction et échéances ne sont pas testés. Ajouter ces tests métier.
  <br><sub>Preuves : couverture entretiens.ts, budget.ts, parametres.ts à 0 % des fonctions · voyages.ts 22 % des fonctions · server/src/actions/temps.ts:55-57, :95-97 · shared/domain.ts:361-380 (echeances non testée)</sub>
- [x] **Activer Dependabot et npm audit** — 🟢 Souhaitable · S
  Rien ne surveille les dépendances. Ajouter dependabot.yml et une étape npm audit dans la CI.
  <br><sub>Preuves : git grep dependabot\|renovate → aucun résultat · npm outdated → express 5.2.1 / 5.3.0</sub>
- [x] **Ajouter un script check et un seuil de couverture** — 🟢 Souhaitable · S
  La couverture (89,7 % des lignes) n'est pas mesurée en routine. Ajouter test:coverage avec seuil et un script check appelé par la CI.
  <br><sub>Preuves : package.json:17-18 · node --test --experimental-test-coverage → 89,68 %</sub>
- [x] **Configurer ESLint avec les règles React hooks** — 🟢 Souhaitable · M
  Aucun linter : les 65 hooks du client ne sont pas vérifiés. Ajouter ESLint (typescript-eslint, react-hooks) et le lancer en CI.
  <br><sub>Preuves : git grep eslint → aucun résultat · server/src/actions/context.ts:23</sub>
- [x] **Typer le contrat des actions entre client et serveur** — 🟢 Souhaitable · M
  Noms et contenus des actions sont des chaînes libres : une faute n'est vue qu'à l'exécution. Créer un type partagé ActionPayloads vérifié par tsc.
  <br><sub>Preuves : client/src/state/store.tsx:74 · client/src/api.ts:34 · server/src/actions/context.ts:23</sub>
- [x] **Mettre en place des tests de bout en bout Playwright** — 🟢 Souhaitable · L
  Aucun test ne vérifie les parcours complets. Ajouter des scénarios par rôle (connexion, inscription, congé, feuille de temps) sur base isolée à date figée.
  <br><sub>Preuves : git grep playwright → aucun résultat · server/src/db.ts:193 (CURSUS_DB) · server/src/dataset.ts:20-22 (CURSUS_TODAY)</sub>

## Exploitation

- [x] **Mettre en place sauvegarde, rotation et restauration testée** — 🔴 Bloquant · M
  Toutes les données RH tiennent dans un fichier SQLite sans aucune sauvegarde. Ajouter npm run backup (VACUUM INTO) planifié avec rotation, une sauvegarde avant migration et réinitialisation, et un script de restauration testé.
  <br><sub>Preuves : grep backup\|VACUUM → aucun résultat · server/src/db.ts:79 (WAL) · server/src/seed.ts:291 (clearAll)</sub>
- [x] **Protéger npm run reset-demo contre l'effacement d'une base réelle** — 🟠 Important · S
  La commande vide toutes les tables sans vérifier le mode, sans confirmation ni sauvegarde. Refuser hors démo, exiger --yes et sauvegarder avant.
  <br><sub>Preuves : server/src/reset.ts:5-6 · server/src/seed.ts:291 · package.json:17</sub>
- [x] **Résoudre les chemins de l'interface et de la base depuis le code** — 🟠 Important · S
  Lancé depuis un autre dossier, le serveur sert l'API sans interface et crée une nouvelle base remplie de démo. Résoudre depuis import.meta.dirname et journaliser le chemin de la base.
  <br><sub>Preuves : server/src/index.ts:160 · server/src/db.ts:193</sub>
- [x] **Fournir un packaging serveur (Docker ou systemd)** — 🟠 Important · M
  Aucune procédure d'installation serveur ; le script start échoue sous Windows et l'absence de dist/ n'est pas signalée. Fournir un Dockerfile ou une unité systemd et documenter installation et mise à jour.
  <br><sub>Preuves : ls Dockerfile* → absent · package.json:16 · server/src/index.ts:160-164</sub>
- [x] **Versionner les migrations de schéma** — 🟠 Important · M
  Le schéma est recréé à chaque démarrage sans numéro de version : impossible de renommer une colonne ou d'ajouter une contrainte. Créer des migrations numérotées exécutées une fois, avec user_version.
  <br><sub>Preuves : server/src/db.ts:83-97 · server/src/migrate.ts:24-27 · PRAGMA user_version → 0</sub>
- [x] **Charger les données par périmètre et ne renvoyer que ce qui change** — 🟠 Important · L
  Chaque action relit deux fois toute la base et renvoie tout l'instantané (26 Mo et ~1 s bloquante pour 500 salariés sur 3 ans), y compris pour chaque cellule d'heures. Filtrer en SQL par périmètre et période, ajouter des index, renvoyer seulement l'entité modifiée et partager un Domain unique côté client.
  <br><sub>Preuves : server/src/index.ts:107, :115 · server/src/dataset.ts:31-80, :107-145 · client/src/state/store.tsx:164 · mesure : 504 salariés → instantané RH 26,1 Mo en ~1 s</sub>
- [x] **Structurer les logs et répondre en JSON aux erreurs** — 🟢 Souhaitable · S
  Quelques console.log sans contexte, et un JSON invalide ou une route /api inconnue renvoient une page HTML avec la pile d'appels. Ajouter des logs JSON (requête, durée, statut) et un gestionnaire d'erreurs JSON final.
  <br><sub>Preuves : server/src/index.ts:118 · server/src/index.ts:27, :162 (aucun middleware d'erreur) · curl POST '{bad' /api/login → 400 text/html</sub>
- [x] **Ajouter un point de santé /api/health** — 🟢 Souhaitable · S
  /health renvoie la page d'accueil et /api/health n'existe pas. Créer une route qui vérifie la base et indique version et mode.
  <br><sub>Preuves : curl /api/health → 404 · desktop/CursusApp.swift:116-123</sub>
- [x] **Activer la compression et un cache long sur les fichiers statiques** — 🟢 Souhaitable · S
  Le bundle de 531 Ko et les données JSON partent sans compression et sont revalidés à chaque visite. Compresser et mettre un cache immuable sur /assets.
  <br><sub>Preuves : server/src/index.ts:162 · curl -I /assets/index-*.js → max-age=0, sans Content-Encoding</sub>
- [x] **Gérer l'arrêt propre et le délai d'attente SQLite** — 🟢 Souhaitable · S
  Le serveur ignore SIGTERM et aucun busy_timeout n'est fixé. Ajouter l'arrêt propre (fermeture HTTP et base) et PRAGMA busy_timeout.
  <br><sub>Preuves : grep SIGTERM server → aucun résultat · server/src/db.ts:79</sub>
- [x] **Découper le bundle client par écran** — 🟢 Souhaitable · S
  Toute l'interface tient dans un fichier, et le seuil d'alerte de Vite a été relevé. Charger pages et dialogues à la demande et séparer React.
  <br><sub>Preuves : client/src/App.tsx:5-20 · vite.config.ts:15</sub>
- [x] **Retirer du dépôt les deux archives zip de la maquette** — 🟢 Souhaitable · S
  Deux zips d'environ 840 Ko dupliquent la maquette. N'en garder qu'un exemplaire (design/ ou Git LFS).
  <br><sub>Preuves : git ls-files → 'Outil RH gestion formations.zip' et '…-handoff.zip'</sub>
- [ ] **Application de bureau : base hors du dossier source et journaux conservés** — 🟢 Souhaitable · M
  La base RH est créée dans le dossier du projet (effacée par git clean) et le journal est vidé à chaque lancement. Placer la base dans Application Support et ouvrir le journal en ajout.
  <br><sub>Preuves : desktop/CursusApp.swift:70, :76-83</sub>
- [ ] **Déclarer clés étrangères et contraintes dans le schéma** — 🟢 Souhaitable · M
  Aucune clé étrangère ni contrainte n'est déclarée : une référence orpheline ferait planter le chargement. Ajouter clés étrangères, CHECK et index.
  <br><sub>Preuves : server/src/db.ts:10-49, :79 · shared/domain.ts:101</sub>
