# Architecture de Cursus

Cursus est une application web full-stack légère : un serveur Node/Express qui
stocke les données dans SQLite (module natif `node:sqlite`) et une interface
React + TypeScript compilée par Vite. Les règles métier sont écrites une seule
fois dans `shared/` et utilisées des deux côtés.

```
shared/            Domaine partagé (aucune dépendance)
  types.ts         Modèle de données (Dataset = instantané visible par l'utilisateur)
  constants.ts     Libellés, classes de statut, règles fixes (contrats, visas, vaccins, entretiens)
  dates.ts         Dates ISO, jours fériés calculés, périodes de référence CP
  format.ts        Mise en forme française (dates, heures, jours, euros, pluriels)
  domain.ts        Classe Domain : conformité, habilitations, voyages, échéances, Go / No Go
  rules/           temps.ts, conges.ts, entretiens.ts, budget.ts, imports.ts
server/src/
  db.ts            Schéma déclaratif SQLite + requêtes génériques (all/get/insert/update/remove/tx)
  seed.ts          Données de démonstration
  sauvegarde.ts    Copie à chaud (VACUUM INTO), rotation, restauration, verrou du serveur ;
                   scripts backup.ts et restore.ts (npm run backup / restore, voir docs/SAUVEGARDE.md)
  dataset.ts       Assemblage de l'instantané + restriction par rôle (RH / manager / collaborateur)
  auth.ts          Sessions en base (cookie signé, 12 h, révocation) : un compte et l'espace actif
  comptes.ts       Comptes nominatifs (Microsoft 365 ou compte local), espaces, mots de passe (scrypt), journal
  connexion.ts     Routes de session : /api/session, /api/mode, /api/login, /api/motdepasse, /api/logout, /api/comptes
  microsoft.ts     Connexion Microsoft 365 (OpenID Connect, PKCE) : /api/auth/microsoft et /api/auth/microsoft/retour
  comptes-cli.ts   npm run comptes -- admin <identifiant> : premier administrateur RH (docs/DEPLOIEMENT.md)
  config.ts        Variables d'environnement, contrôlées au démarrage (refus en production si dangereuses)
  securite.ts      En-têtes de sécurité HTTP (CSP, HSTS, anti-iframe…)
  actions/         Actions métier (POST /api/actions/:nom), contrôles d'accès et validations
  envois.ts        File d'envoi persistante des messages sortants (table envois), traitée en tâche de fond
  integrations/    Adaptateurs Keystone et Sage Paie (simulation par défaut) ; API Keystone entrante :
                   keystone-entrant.ts (contrôles, écritures, instantané) et keystone-routes.ts (routes /v1) ;
                   keystone-verdicts.ts (verdicts Go / No Go transmis, changements signalés)
  index.ts         Routes HTTP
client/src/
  state/store.tsx  Session, données, navigation, filtres d'écran (ui), dialogue ouvert, notifications, reconnexion
  state/brouillon.ts Brouillon gardé dans l'onglet pendant une reconnexion Microsoft (page, filtres, dialogue, champs)
  state/actions.ts Actions identiques jamais envoyées deux fois à la fois, garde des boutons (useAgir : double clic)
  state/derived.ts Hooks mémorisés : useDomain, useEnriched, useTrips, useRole
  components/      ui.tsx (Page, Kpi, Panel, Tag, Seg, Two, Bar…), Dialog.tsx (Dialog, Field…) et
                   ErreurRendu.tsx (erreur de rendu d'une page, d'un dialogue ou de l'application)
  layout/Shell.tsx Barre latérale, en-tête, notification ; layout/Reconnexion.tsx : session expirée, par-dessus l'écran
  pages/           Un fichier par écran
  dialogs/         Un fichier par dialogue, rendus par DialogHost
  styles/          nocturne.css (design system, ne pas modifier) et app.css (mise en page)
design/            Prototype Claude Design de référence et guide du design system Nocturne
```

## Flux de données

1. `GET /api/data` renvoie l'instantané `Dataset` **déjà restreint au périmètre**
   de l'utilisateur : un manager ne reçoit que son équipe, sans données de santé
   (`visite` remplacée par `aptitude.ok`, vaccinations retirées, état des dossiers
   voyage précalculé dans `voyage.dossierStatut`) ; un collaborateur ne reçoit que
   ses propres données.
2. Le client calcule l'affichage avec `shared/` (statuts, soldes, échéances…).
3. Toute modification passe par `run('nom.action', payload)` → `POST /api/actions/:nom`.
   Le serveur vérifie les droits, valide, écrit dans une transaction, trace l'action
   dans le journal et renvoie `{ message, data }` : le client remplace son instantané
   et affiche le message. L'instantané renvoyé est celui de la session relue après l'action (un compte
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
   - *Actions* : une action identique (nom et paramètres) à une action en cours n'est pas renvoyée, elle reçoit
     la même réponse (`AppelsEnCours` de `state/actions.ts`). Les boutons d'action d'un écran passent par
     `useAgir()` : désactivés pendant l'appel, second clic d'un double clic ignoré (`detail` > 1), car l'écran a
     pu changer sous le pointeur entre les deux clics. Les transitions reçoivent l'état affiché et ne se refont
     pas : `plan.avancer` (`de`), `absence.decider` (même décision), `temps.removeLine` (ligne visée).
   - *Appels sans réponse* : abandonnés après 20 s (lecture) ou 60 s (action), avec un message en français
     (`MSG_DELAI`, `MSG_DELAI_ACTION`) ; une erreur HTTP sans message de Cursus aussi (`messageHttp`).
     Premier chargement impossible : écran d'erreur avec « Réessayer », jamais l'écran de connexion.
   - *Notifications* (`layout/Shell.tsx`) : deux régions live permanentes, `status` pour un succès (effacé
     après 5 s au moins), `alert` pour une erreur (icône d'avertissement, reste affichée jusqu'à sa fermeture
     ou au message suivant) ; chacune se ferme à la main.
   - *Dialogues* (`components/Dialog.tsx`) : le fond ne ferme que sur un clic commencé et terminé sur lui (une
     sélection de texte relâchée hors de la carte ne ferme rien) ; fond, Échap ou « Annuler » demandent
     confirmation si la personne a modifié un champ depuis l'ouverture. Un dialogue qui enregistre au fil de la
     saisie (`enregistrer`, compte rendu d'entretien) enregistre avant de se fermer, confirmation en cas d'échec ;
     celui qui montre une information une seule fois (`fermerParBouton`, mot de passe provisoire) ne se ferme que
     par son bouton.
   - *Erreurs de rendu* (`components/ErreurRendu.tsx`) : limites autour de la page (remise à zéro au
     changement de page), du dialogue ouvert et de l'application ; message, détail technique replié, « Réessayer ».

## Sécurité

- **Configuration** (`server/src/config.ts`) : lue au démarrage. En production, le serveur s'arrête
  (code 1) en listant les problèmes : `CURSUS_SECRET` absente ou courte, `KEYSTONE_API_KEY` absente
  ou égale à la clé de démonstration (hors démonstration), `KEYSTONE_URL` sans `KEYSTONE_TOKEN`, qui
  n'est pas une adresse http(s) ou qui porte des identifiants, `CURSUS_TODAY` définie, démonstration sans
  `CURSUS_HOST` (ou `HOST`) explicite sur la boucle locale, `CURSUS_INSECURE_COOKIE=1` hors de ce cas,
  connexion Microsoft 365 configurée en partie, locataire autre qu'un GUID, `CURSUS_PUBLIC_URL` hors
  https, `CURSUS_OIDC_AUTORITE` définie (réservée aux tests).
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
- **Profils RH** (`PROFILS_RH` de `shared/constants.ts`) : `rh_gestionnaire` (droit `rh` : espace RH et
  actions courantes) et `rh_admin` (droits `rh` et `admin` : paramètres, transmission à la paie,
  suppressions, comptes et accès, réinitialisation de la démonstration). Contrôles serveur `requireRh` et
  `requireRhAdmin` (`server/src/actions/context.ts`). Les profils à venir (référent HSE, paie, lecture
  seule) s'ajoutent à `PROFILS_RH` avec leurs droits. Cursus garde toujours un administrateur RH actif.
- **Identité** : dans l'espace RH, `user.empId` reste null (la personne agit pour le service RH), mais
  `user.nom` est celui de la personne connectée : il signe le journal (avec `compteId` et `identifiant`)
  et les mesures (`mesurePar`, reports de CP). `rhNom` et `rhIntitule` ne sont plus des paramètres : le
  valideur d'un salarié sans manager est « le service RH ».
- **Sessions** (`server/src/auth.ts`, table `connexions`) : le cookie `cursus_session` ne porte que
  l'identifiant de session signé ; la session porte le compte, l'espace actif et le mode de connexion
  (`local`, `demo`, `microsoft`). Durée absolue de 12 h ;
  `/api/logout` révoque, `/api/mode` ne bascule que vers un espace du compte (403 sinon), une connexion
  en ouvre une nouvelle. `revokeSessionsOf(db, empId)` révoque toutes les sessions d'un salarié,
  `revokeSessionsDuCompte(db, compteId)` celles d'un compte. Les sessions expirées sont purgées au
  démarrage puis toutes les heures. En démonstration, la connexion reste libre (sélecteur de vue, choix
  d'un compte, mot de passe quelconque) mais passe par les mêmes comptes : le jeu de démonstration crée
  un compte par salarié et celui de la RH de démonstration, administratrice RH.
- **En-têtes** (`server/src/securite.ts`) : CSP stricte (`script-src 'self'`, `style-src 'self'`).
  Ne jamais produire de `<script>`, de `<style>` ni d'attribut `style="…"` en HTML brut : la prop
  `style` de React reste permise. Les documents imprimables utilisent `client/src/styles/print.css`
  et lancent l'impression avec le script servi `client/public/imprimer.js`.
- **Keystone** : clé comparée en temps constant ; sans `KEYSTONE_API_KEY` (hors démonstration), 503.
  Le corps n'est lu qu'après la clé ; chaque appel authentifié est tracé dans le journal
  (`keystone.appel` : méthode, chemin, statut, référence, champs refusés), jamais le contenu reçu (clés
  de `heures`, identifiants et segments de chemin mal formés remplacés par un générique). Les appels
  sans clé valide, que n'importe qui peut émettre, sont comptés et résumés en une ligne par minute au
  plus. `GET /api/journal` les sépare des actions (`?vue=keystone`) ; le proxy restreint l'adresse
  appelante (`docs/DEPLOIEMENT.md`).
- Mise en production : `docs/DEPLOIEMENT.md`.

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
- Un bouton d'action hors dialogue (valider, refuser, engager, supprimer une ligne) passe par `useAgir()` de
  `state/actions.ts` : `disabled={occupe}` et `onClick={agir(() => run(...))}` ; une transition envoie l'état
  affiché quand le serveur l'accepte (statut attendu, ligne visée).
- Les propositions d'action calculées par le domaine (`Proposal.intent`) s'exécutent
  avec `runIntent(intent)`.
- Masquer les actions que le rôle n'a pas le droit d'effectuer (le serveur refuse de
  toute façon) : `useRole()` donne `rh`, `admin` (administrateur RH), `manager`, `collab`, `me`.
- Icônes : Phosphor (`@phosphor-icons/react`, noms suffixés `Icon`).

## Actions disponibles

« RH » : administrateur et gestionnaires RH ; « administrateur RH » : profil `rh_admin` seulement.
`tests/droits.test.ts` vérifie chaque action pour six profils et échoue si une action n'y a pas sa ligne.

| Action | Paramètres | Droits |
| --- | --- | --- |
| `employe.creer` | fiche complète (`ProfilInput` de `shared/rules/profil.ts`) | RH |
| `employe.modifier` | id + champs de la fiche | RH : tous ; manager : `poste`, `jourOff` (temps partiel) des membres de son équipe |
| `equipe.creer` / `equipe.renommer` | nom, managerId? / nom, nouveau | RH |
| `equipe.supprimer` | nom | administrateur RH |
| `equipe.manager` | nom, managerId (null = aucun) | RH |
| `equipe.affecter` | empId, equipe (null = à affecter) | RH ; manager : ajout à une équipe qu'il encadre, retrait d'un membre |
| `plan.inscrire` | empId, certId (recyclage) ou inscriptionId (formation initiale à replanifier), sessionId, conv (`now`/`later`) ; refusé depuis une session passée non clôturée | RH, manager direct |
| `cert.ajouter` | empId, f, date | RH |
| `session.creer` | f, date (postérieure à aujourd’hui), lieu, places (entier ≥ 1), planId? (action « prévue » de la même formation) | RH |
| `session.confirmer` | id | RH |
| `session.modifier` | id, date? (postérieure à aujourd’hui ; session passée, à clôturer : aussi une date passée), lieu?, places? (≥ inscrits) | RH |
| `session.annuler` | id, motif? | RH |
| `session.cloturer` | id, participants [{empId, present, reussi?}], note? (1 à 5), commentaire? | RH |
| `hab.delivrer` | empId, h, date, par, mode | RH |
| `hab.suspendre` | empId, h, motif, date? (aujourd’hui par défaut) | RH ; manager pour un membre de son équipe (jamais lui-même) |
| `hab.lever` | empId, h | RH |
| `hab.retirer` | empId, h, motif, date? | RH |
| `medical.demander` | empId | RH |
| `demande.accepter` / `demande.refuser` | id | RH |
| `demande.formation` | f (ou `autre`), libelle, sessionId, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `demande.habilitation` | h, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `voyage.creer` | empId, dest, depart, retour, motif | RH |
| `formalite.enregistrer` | empId, kind (`passeport`/`visa`/`vaccin`), numero, expire, dest, visaType, obtenu, v, date | RH (écrit dans le dossier), ou le collaborateur pour lui-même (déclaration en attente, voir ci-dessous) |
| `voyages.importer` | texte (CSV) | RH |
| `keystone.accepter` / `keystone.refuser` | id | RH (demande en attente ; l'acceptation revalide affectation, chantier actif, destination, effectifs et l'absence de déplacement déjà créé ; la demande reste en base avec statut, date et décideur) |
| `plan.importer` | texte, exercice, mode (`add`/`replace`) | RH ; `replace` (supprime les lignes prévues) : administrateur RH |
| `budget.enveloppes` | exercice, enveloppes {équipe: montant} | RH |
| `plan.avancer` | id, de? (statut affiché : déjà dépassé, rien n'est refait ; revenu à « prévue », refus) | RH |
| `temps.setCell` | empId, week, li, di, value | salarié, manager direct ou RH (feuille soumise : valideur uniquement) ; aucune heure un jour d’absence validée ou signalée, ni hors contrat, vider la cellule reste possible ; pas de feuille pour une semaine hors contrat |
| `temps.addLine` / `temps.removeLine` | empId, week, projet / li, projet?, tache?, lignes? (ligne visée : déjà supprimée, rien n'est refait ; feuille changée, refus) | idem |
| `temps.suggest` / `temps.submit` | empId, week | idem (soumission : brouillon ou à corriger, sans heures un jour d’absence validée ; semaine entièrement couverte par une absence : sans heure) |
| `temps.validate` / `temps.reject` | empId, week, comment? | manager direct ou RH (validation : sans heures un jour d’absence validée ; une demande d’absence en attente sur des jours qui portent des heures est décidée d’abord ; une feuille sans heure exige une semaine encore couverte par une absence) |
| `temps.pushSage` | — | administrateur RH |
| `absence.demander` | empId, kind (`CP`/`RTT`/`RECUP`), du, au | intéressé ou RH (demande, refusée si ces jours portent des heures sur une feuille validée) ; manager direct (posée et validée, refusée si des heures sont saisies ces jours-là) |
| `absence.decider` | id, ok | manager direct ou RH (validation refusée si des heures sont saisies ces jours-là ; même décision déjà prise : rien n'est refait) |
| `absence.signaler` | empId, du, au | intéressé, manager direct ou RH : absence imprévue « à qualifier », en vigueur aussitôt |
| `absence.saisir` | empId, nature, du, au, justificatif, justificatifLe | RH (absence hors congés validée d’emblée) |
| `absence.qualifier` | id, nature, du?, au?, justificatif, justificatifLe | RH (absence signalée ou qualifiée, hors congés) |
| `absence.prolonger` | id, au | intéressé, manager direct ou RH (hors congés ; hors RH, l’absence repasse « à qualifier ») |
| `absence.annuler` | id | demande : intéressé ou RH ; absence à venir : manager direct ou RH (et l’intéressé pour son propre signalement, ni qualifié ni prolongé) ; commencée ou passée : RH ; hors périmètre : refus unique (403) |
| `cet.placer` | empId, kind, jours | intéressé ou RH |
| `report.accorder` | empId, jours, motif | RH |
| `entretien.planifier` | empId, kind, date | manager direct ou RH |
| `entretien.modifier` | id, section?, value?, info? | évaluateur / salarié selon la section |
| `entretien.clore` | id | évaluateur (l'écran enregistre d'abord chaque section ; un échec interrompt la clôture) |
| `entretien.signer` | id | salarié |
| `parametres.maj` | horizonAlerte, seuilBudget, rtt39, uniquementReglementaire, partageKeystone, silent? | administrateur RH |
| `demo.reinitialiser` | — | administrateur RH, mode démonstration |
| `compte.creer` | empId (ou nom, adresse : compte externe), type (`microsoft`/`local`), identifiant, profilRh | administrateur RH (mot de passe provisoire dans `result`, affiché une fois) |
| `compte.profil` | id, profilRh (`aucun`/`rh_gestionnaire`/`rh_admin`) | administrateur RH (jamais le dernier administrateur actif) |
| `compte.activer` | id, actif | administrateur RH (désactiver ferme les sessions ; pas son propre compte) |
| `compte.reinitialiser` | id | administrateur RH (compte local : nouveau mot de passe provisoire ; compte Microsoft rattaché : « Délier », `oid` retiré pour une identité recréée ; sessions fermées) |
| `envoi.relancer` | id | RH (envoi en échec, intégration configurée : nouvelle série de tentatives, même clé d'idempotence) |
| `envoi.classer` | id | RH (envoi en échec examiné : reste listé, ne compte plus parmi les échecs en cours ; une relance le remet en cours) |

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
  Le motif est un texte libre visible du manager et du collaborateur, jamais transmis à Keystone.
  Une base existante reçoit les nouvelles colonnes au démarrage (schéma déclaratif de `server/src/db.ts`).

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
  parcours, date de la certification à renouveler) ; l'envoi par e-mail viendra avec le module d'e-mails.
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

Les salariés sont désignés par `matricule()` (`shared/format.ts`) ; la correspondance inverse est
faite à un seul endroit (`contexte()` de keystone-entrant.ts), à reprendre quand le matricule de
paie sera stocké. Contrat : `docs/API-KEYSTONE.md` et `docs/keystone-openapi.json` (codes de motif :
`CODES_MOTIF` de `shared/constants.ts`).

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
  familles sans effet (`changeVerdicts` de `actions/index.ts` : temps, absences, entretiens…), après
  chaque écriture de Keystone et une fois par jour. Les verdicts du jeu de démonstration sont mémorisés
  sans envoi. Ceux mémorisés en simulation ne sont pas réputés transmis : le réglage `verdictsKeystoneMode`
  retient le mode du suivi, et le premier calcul en mode API vide la table, d'où un premier verdict
  (`precedent: null`) pour chaque ressource suivie.
- **Sage Paie** : `server/src/integrations/sage.ts` (`pushToSage`). La file d'envoi prévoit la cible
  `sage` (colonne `cible`, transports par cible), sans la brancher tant que l'envoi n'est pas décidé.
- **Microsoft 365** : `server/src/microsoft.ts` (voir Sécurité) ; un compte Microsoft se retrouve par
  son `oid`, ou par son identifiant (adresse de connexion) à la première connexion.
