# Bascule de la démonstration vers la production

Procédure du passage en production de Cursus (mise en service prévue le 1er janvier 2027, reprise des données de Lucca),
avec ses critères et ses étapes de retour arrière. Elle s'appuie sur trois contrôles livrés par le lot 8 :

- **au démarrage**, le serveur refuse lui-même les configurations dangereuses en production (`server/src/config.ts`) et
  une base qui porte encore des données de démonstration ou une connexion en superutilisateur
  (`controlerDemarrage`, `server/src/pre-vol.ts`) ;
- **`npm run verifier-production`** dit en une page si l'instance est prête : configuration, base, sauvegarde et, avec
  `--url`, ce que voit un utilisateur à travers le proxy (docs/DEPLOIEMENT.md, « Vérification avant la mise en
  production ») ;
- **`/api/health`** passe en `degrade` tant qu'un point reste à traiter (données de démonstration, aucun administrateur
  RH, e-mails simulés, sauvegarde ancienne, secret qui expire, démonstration sur la base `epc2i`).

Qui fait quoi : le **service informatique** (Coolify, Traefik, variables, sauvegardes), l'**administrateur RH**
(premier compte, référentiels, reprise Lucca, page Confidentialité), le **propriétaire du projet** (décisions et
feu vert de chaque étape), le **responsable du serveur commun** (Matrix : socle, partage, sauvegardes).

## 1. Décision préalable

**Question Q1 (ouverte) : sur quelle base tourne la démonstration en ligne actuelle ?** Le propriétaire la vérifie dans
Coolify (variables de l'application de démonstration : `DATABASE_URL` présente ou non). D'ici la bascule, une
démonstration branchée sur le serveur commun est seulement signalée : avertissement au démarrage, état `degrade`
(`demo-base-commune`) du point de santé ; elle n'est jamais arrêtée par Cursus.

**Choix retenu : une nouvelle application Coolify `cursus-prod`, sur un volume neuf.** La démonstration reste à part,
dans son application, en SQLite (sans `DATABASE_URL`), derrière l'authentification basique de Coolify, aux données
fictives seulement. Reconvertir l'application de démonstration en production est possible, mais déconseillé : son volume
et, le cas échéant, son schéma portent des données fictives, des comptes de visiteurs et un historique à purger, et
une erreur de variable remettrait la démonstration sur la base de production.

Une fois la base de production démarrée, deux règles deviennent bloquantes d'elles-mêmes :

- le démarrage en production hors démonstration sur une base qui porte le réglage `demo`, des comptes du jeu de
  démonstration, des adresses `@entreprise.example` ou le lot de paie « Démonstration » est refusé ;
- une démonstration (`CURSUS_DEMO=1`) sur la base `epc2i` est refusée dès que cette base porte le réglage
  `exploitation` (premier démarrage en production) ou la trace de la purge (`purge.demo`).

**Au jour J (étape J0-1 ci-dessous), la démonstration sur `epc2i` est interdite** : si l'application de démonstration y
était branchée, elle est déplacée en SQLite ou arrêtée avant la purge, jamais après.

## 2. Tableau des secrets

Chaque secret est propre à l'instance de production (jamais repris de la démonstration ni d'une recette), saisi dans les
variables de l'application `cursus-prod` (jamais dans le dépôt ni dans l'image), et tous sont différents entre eux
(le pré-vol le contrôle, `config.secrets`).

| Secret | Propriétaire | Durée de vie | Rotation |
| --- | --- | --- | --- |
| `CURSUS_SECRET` (signature des sessions) | service informatique | sans échéance ; changé si fuite | nouvelle valeur (`openssl rand -hex 32`), redéploiement : tout le monde est déconnecté, rien d'autre ne change |
| `KEYSTONE_API_KEY` (appels entrants de Keystone) | service informatique, avec l'équipe Keystone | 1 an conseillé | nouvelle valeur convenue avec Keystone, posée des deux côtés dans la même fenêtre (Cursus d'abord, puis Keystone) : entre les deux, les appels de Keystone reçoivent 401 : fenêtre à garder courte |
| `KEYSTONE_TOKEN` (envois de Cursus vers Keystone) | équipe Keystone | 1 an conseillé | Keystone accepte le nouveau jeton, puis Cursus le reçoit et redéploie ; entre les deux, les envois échouent et attendent dans la file (retentés pendant environ 4 h) |
| `CURSUS_SUPERVISION_TOKEN` | service informatique | sans échéance | nouvelle valeur dans Cursus et dans l'outil de supervision, le même jour |
| `MATRIX_TOKEN` | responsable de Matrix | 1 an conseillé | même valeur posée sur Matrix et sur Cursus ; une déclaration refusée n'arrête jamais Cursus |
| Mot de passe de `cursus_app` (dans `DATABASE_URL`) | responsable du serveur commun | 1 an conseillé | `ALTER ROLE cursus_app PASSWORD '…'` en superutilisateur, puis nouvelle `DATABASE_URL` et redéploiement aussitôt : entre les deux, les nouvelles connexions sont refusées (`/api/health` répond 503) |
| `CURSUS_OIDC_CLIENT_SECRET` (connexion Microsoft 365) | service informatique (administrateur Entra) | 24 mois au plus (Entra) ; date dans `CURSUS_OIDC_SECRET_EXPIRE` | nouveau secret créé dans Entra avant l'échéance, posé avec sa date, redéploiement, ancien secret supprimé dans Entra ; alerte 30 jours avant (`/api/health`, récapitulatif des échéances) : docs/CONNEXION-MICROSOFT.md, section 3 |
| `CURSUS_MAIL_CLIENT_SECRET` (envoi des e-mails, si l'application d'envoi est distincte) | service informatique (administrateur Entra) | 24 mois au plus ; date dans `CURSUS_MAIL_SECRET_EXPIRE` | comme le précédent ; alerte `secret-envoi` 30 jours avant : docs/EMAILS.md |

## 3. Réglages Traefik (Coolify)

- **HTTPS seulement** : certificat Let's Encrypt du domaine définitif, redirection permanente de `http://` vers
  `https://` (le pré-vol attend 301 ou 308, `reseau.http`).
- **En-têtes de Cursus conservés** : aucun middleware qui réécrit `Content-Security-Policy`, `X-Frame-Options` ni
  `Strict-Transport-Security`. HSTS n'est posé par Cursus que si le proxy est cru et transmet `X-Forwarded-Proto: https`.
- **Proxy cru restreint** : relever l'adresse IP du seul conteneur Traefik (`coolify-proxy`) sur le réseau
  `coolify` (`docker inspect -f '{{(index .NetworkSettings.Networks "coolify").IPAddress}}' coolify-proxy`), et la
  poser seule dans `CURSUS_TRUST_PROXY` (par exemple `10.0.1.3`, ou `10.0.1.3/32`) au lieu de `loopback,uniquelocal`
  de l'image. **Jamais le sous-réseau du réseau `coolify`** (celui que donne `docker network inspect coolify`) :
  Keystone, Vigie, Matrix et postgres y sont aussi, et le croire revient à `uniquelocal` pour ce réseau ; tout
  conteneur du réseau pourrait alors falsifier l'adresse du client et le protocole, donc contourner
  `CURSUS_KEYSTONE_ADRESSES` et faire bloquer Keystone par le plafond des clés invalides (constat S7). Le pré-vol
  signale en avertissement (`config.proxy`) toute entrée qui couvre plus d'une adresse (`uniquelocal`, `linklocal`,
  un nombre de proxys, un réseau plus large que /32 en IPv4 ou /128 en IPv6). Pour que l'adresse ne change pas à
  chaque redémarrage du proxy, la fixer dans la configuration du proxy de Coolify (`ipv4_address`), ou placer Traefik
  et cursus-prod sur un réseau dédié au proxy ; la relever de nouveau après toute mise à jour de Coolify.
- **API Keystone fermée sur Internet** : Keystone appelle Cursus par le réseau interne Coolify
  (`http://<nom du service cursus-prod>:3000/api/integrations/keystone/v1/…`), et la route publique
  `/api/integrations/keystone` est fermée dans Traefik (routeur dédié avec un middleware `ipAllowList` vide, ou
  réponse 403). Le pré-vol accepte 401 (route ouverte, protégée par la clé) ou 403 (route fermée). En complément, si
  Keystone doit passer par une adresse connue, `CURSUS_KEYSTONE_ADRESSES` filtre dans Cursus (vide par défaut).
- **Authentification basique** de l'application : gardée jusqu'à l'étape J0-7, retirée en dernier. Laissée en place,
  elle bloque les appels de Keystone, les abonnements d'agenda (`.ics`) et le retour de Microsoft 365.

## 4. Calendrier

### J-30 à J-15 : préparation

1. Inscription Entra (docs/CONNEXION-MICROSOFT.md) et boîte d'envoi (docs/EMAILS.md). Relever les dates d'expiration
   des secrets (`CURSUS_OIDC_SECRET_EXPIRE`, `CURSUS_MAIL_SECRET_EXPIRE`).
2. Sauvegardes du serveur commun : responsable désigné ; tâche planifiée Coolify de `sauvegarder.sh` active ; copie
   chiffrée hors du serveur en place ; témoin de sauvegarde monté dans `cursus-prod` (`CURSUS_SAUVEGARDE_TEMOIN`, voir
   § 7) ; restauration complète d'essai du schéma `cursus`, du partage et des pièces sur un serveur d'essai, avec un
   compte rendu (README de Matrix, « Restaurer le schéma d'un outil »).
3. Domaine définitif, certificat, réglages Traefik du § 3, adresse IP du seul conteneur Traefik relevée (et fixée) pour
   `CURSUS_TRUST_PROXY`.
4. Recette sur une instance de recette séparée (base ou schéma distincts : jamais `epc2i/cursus`).

### J-7 : application de production, sans la démarrer

1. Créer l'application `cursus-prod` : même image, étiquetée (version et commit : `docker inspect`), volume `/data`
   neuf. Pour que les étiquettes ne valent pas « inconnue » : dans Coolify, cocher « Include Source Commit in Build »
   (commit dans `SOURCE_COMMIT`) et déclarer `CURSUS_VERSION` en variable de construction (« Build Variable », valeur :
   la version de `package.json`, à mettre à jour à chaque version) ; après le premier déploiement, vérifier
   `docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }} {{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>`.
   Puis variables de production (docs/DEPLOIEMENT.md, tableau des variables) : `DATABASE_URL` en `cursus_app` sur
   `epc2i`, `CURSUS_PUBLIC_URL` en https, `CURSUS_TRUST_PROXY` à la seule adresse de Traefik (§ 3), secrets du § 2, aucune variable de
   démonstration (`CURSUS_DEMO`, `CURSUS_DEMO_PUBLIQUE`, `CURSUS_DEMO_LIAISONS`, `CURSUS_TODAY`,
   `CURSUS_INSECURE_COOKIE`). Ne pas la démarrer.
2. Dans un conteneur ponctuel de cette application : `npm run verifier-production -- --config-seule` → aucun bloquant.
   Les avertissements restants sont relus un par un avec le propriétaire.

### J-1 : gel de la démonstration

1. Annoncer puis geler la démonstration (arrêt de l'application, ou lecture seule annoncée).
2. Si le schéma `cursus` du serveur commun contient la démonstration (Q1) :
   - arrêter **toutes** les instances branchées sur ce schéma (aucune connexion `application_name = 'cursus'` dans
     `pg_stat_activity`) ;
   - `pg_dump --format=custom --schema=cursus` juste après l'arrêt (§ 5), à garder comme « avant purge », non
     restaurable en production ;
   - vider le schéma : `npm run purge-demo` (chantier A du lot 8 : aperçu `--a-blanc`, puis exécution), ou le
     supprimer et le recréer par le socle de Matrix (`DROP SCHEMA cursus CASCADE`, `init/02-schemas.sql`,
     `init/03-droits.sql`) ;
   - au besoin, rejouer le partage (`partage/20-cursus.sql`, `90-droits.sql`, `95-matrix-journal-unifie.sql`) et
     vérifier que `droits.verifier()` ne renvoie aucune erreur ;
   - prévenir les lecteurs des vues `pub_` (Keystone, Vigie, Crucible, Codex, Matrix) qu'ils vident leurs copies des
     matricules EMP-0001 à EMP-0024 (§ 8).
3. Retirer de l'application de démonstration toute `DATABASE_URL` vers `epc2i` : elle repart en SQLite, ou reste
   arrêtée.

### J0 : mise en service

1. Premier démarrage de `cursus-prod` : migrations, amorçage ; le journal ne doit contenir ni « données de
   démonstration chargées » ni « Démarrage impossible ». La base est marquée `exploitation` à ce démarrage.
2. Premier administrateur RH : `npm run comptes -- admin <identifiant>` dans le terminal du conteneur
   (docs/DEPLOIEMENT.md, « Premier administrateur RH »).
3. Saisie des référentiels et de la page Confidentialité (responsable du traitement, DPO), puis reprise Lucca
   (docs/DEPLOIEMENT.md, « Mise en service : reprise depuis Lucca »).
4. `pg_dump --format=custom --schema=cursus` (§ 5) : sauvegarde « après reprise », point de retour arrière.
5. `npm run verifier-production -- --json --url https://cursus.entreprise.fr > pre-vol-J0.json` : aucun bloquant ;
   archiver la sortie avec le compte rendu de la recette. `/api/health` doit répondre `ok` (détail avec le jeton :
   `alertes` vide). L'alerte `aucun-admin` tombe dès l'appel qui suit la création de l'administrateur de l'étape 2
   (relue à chaque appel tant qu'elle est levée), sans redémarrage. Si `cursus-prod` est déjà derrière
   l'authentification basique, ses appels reçoivent 401 du proxy : relancer cette commande juste après l'étape 7 et
   archiver cette seconde sortie.
6. Prévenir Keystone, Vigie, Crucible, Codex et Matrix : adresse interne de Cursus, clés du § 2 ; les vues `pub_` ne
   portent plus de données fictives.
7. **Retirer l'authentification basique de Coolify seulement maintenant**, puis ouvrir au groupe pilote.
8. Application de démonstration : la supprimer, ou la garder isolée (SQLite seul, sans `DATABASE_URL`,
   authentification basique conservée, liaisons coupées).

## 5. Avant chaque déploiement : sauvegarde du schéma

Avec PostgreSQL, Cursus ne fait aucune copie avant ses migrations (contrairement au fichier SQLite). Avant tout
déploiement d'une nouvelle version de `cursus-prod`, et à chaque étape marquée ci-dessus :

```bash
pg_dump --format=custom --schema=cursus --file=cursus-$(date +%Y%m%d-%H%M)-avant-deploiement.dump \
  "postgres://cursus_app:<mot de passe>@epc2i-postgres:5432/epc2i"
sha256sum cursus-*-avant-deploiement.dump > cursus-avant-deploiement.sha256
```

Le fichier est rangé avec les sauvegardes du serveur commun (même chiffrement, même rétention). Noter aussi l'étiquette
de l'image en service (`docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'`) :
c'est elle qu'on redéploie au retour arrière. Puis déployer, et relancer `npm run verifier-production -- --url …`.

## 6. Retour arrière

**Critères, fixés d'avance** (le propriétaire décide, le service informatique exécute) : connexion impossible pour
plusieurs utilisateurs, erreurs 500 répétées dans le journal, `/api/health` en 503, compteurs (soldes, heures) faux
après la reprise, données d'un salarié visibles d'un autre.

- **Avant l'étape J0-7** (authentification basique encore en place) : arrêter `cursus-prod`. Rien n'a été exposé ; on
  corrige puis on reprend à l'étape en cause (la base peut être restaurée depuis le dump de l'étape J-1 ou J0-4).
- **Après l'étape J0-7** :
  1. remettre l'authentification basique de Coolify ;
  2. arrêter `cursus-prod` ;
  3. restaurer le dump de l'étape J0-4 (ou du dernier § 5) : README de Matrix, « Restaurer le schéma d'un outil »
     (`DROP SCHEMA cursus CASCADE`, socle, `pg_restore --schema=cursus --no-owner --no-privileges --single-transaction`) ;
  4. rejouer le partage (`20-cursus.sql`, `90-droits.sql`, `95`), contrôler `droits.verifier()` ;
  5. redéployer l'image précédente (étiquette notée au § 5) ;
  6. `npm run verifier-production -- --url …` ;
  7. prévenir les autres outils (vues `pub_` revenues à l'état du dump).

Lucca reste la source de vérité jusqu'à la fin de la période pilote : un retour arrière ne perd aucune donnée RH
définitivement ; les saisies faites dans Cursus depuis le dump sont à refaire.

## 7. Sauvegardes et témoin

Le schéma `cursus` est sauvegardé par la tâche du serveur commun (`sauvegarder.sh` de Matrix : `pg_dump` par schéma,
14 jours de rétention). Les pièces justificatives restent dans le volume `/data/pieces` de `cursus-prod` : elles se
copient à la même heure (docs/SAUVEGARDE.md).

Pour que Cursus sache si la sauvegarde a tourné, la tâche écrit après chaque sauvegarde réussie un **fichier témoin**
dont la première ligne est sa date ISO 8601 (`2027-01-05T02:15:00Z`). Le dossier qui le porte est monté en lecture seule
dans `cursus-prod`, et son chemin posé dans `CURSUS_SAUVEGARDE_TEMOIN`. Plus de 26 heures sans nouvelle sauvegarde :
`/api/health` passe en `degrade` (alerte `sauvegarde`, date et âge dans le détail), et le pré-vol le signale. Sans
témoin, le pré-vol rappelle seulement de vérifier la sauvegarde à la main (avertissement, jamais bloquant).

## 8. Demandes aux autres outils (à valider par le propriétaire avant envoi)

Rédigées ici seulement ; elles iront dans le `REQUESTS.md` de chaque dépôt après validation. Cursus ne modifie jamais
ces dépôts.

- **Matrix, sauvegardes** : faire écrire par `sauvegarder.sh`, après une sauvegarde réussie, un fichier témoin daté
  (`<dossier des sauvegardes>/cursus.temoin`, première ligne : date ISO 8601 en UTC), lisible par le conteneur de
  Cursus (volume en lecture seule) ; faire un `pg_dump --schema=cursus` juste après l'arrêt de la démonstration, avant
  la purge ; marquer comme non restaurables en production les dumps et instantanés antérieurs à la purge.
- **Matrix, journal unifié** : après la purge, retirer de `matrix.journal_unifie` (et de toute copie) les lignes de
  Cursus antérieures à `purge.demo`.
- **Keystone, Vigie, Crucible, Codex** : après la purge, vider les données lues dans `pub_salaries`,
  `pub_titres_detenus`, `pub_absences` et `pub_journal` pour les matricules EMP-0001 à EMP-0024.
- **Keystone** : appeler Cursus par le réseau interne Coolify, et convenir de la fenêtre de rotation de
  `KEYSTONE_API_KEY` et `KEYSTONE_TOKEN` (§ 2).
