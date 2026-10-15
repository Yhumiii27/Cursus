# Mise en production de Cursus

Guide destiné au service informatique, qui exploite Cursus. Cible retenue par l'entreprise :
une machine Linux louée chez un hébergeur en France ou dans l'Union européenne, joignable
directement depuis Internet (ordinateurs Windows attribués et téléphones fournis par
l'entreprise), Cursus derrière un reverse proxy HTTPS.

```
Navigateur ──HTTPS 443──▶ Caddy (ou nginx) ──HTTP──▶ Cursus 127.0.0.1:3210 ──▶ SQLite /var/lib/cursus
```

Cursus n'écoute que sur la boucle locale : seul le reverse proxy l'atteint. Le proxy porte le
certificat TLS ; Cursus envoie lui-même les en-têtes de sécurité (CSP, HSTS, anti-iframe…).

Sauvegardes et restauration : voir `docs/SAUVEGARDE.md`. Connexion Microsoft 365 (inscription de
l'application dans Entra) : voir `docs/CONNEXION-MICROSOFT.md`. Envoi des e-mails (autorisation Mail.Send,
boîte d'envoi, stratégie d'accès d'Exchange Online) : voir `docs/EMAILS.md`.

**Fichiers prêts à copier** : le dossier `deploy/` du code contient les unités systemd et la configuration Caddy
reproduites dans ce guide et dans `docs/SAUVEGARDE.md`, à l'identique (un test le vérifie à chaque version) :
`deploy/cursus.service`, `deploy/Caddyfile`, `deploy/cursus-sauvegarde.service`, `deploy/cursus-sauvegarde.timer`,
`deploy/cursus-alerte@.service`, `deploy/cursus-copie-externe`. Les copier évite les erreurs de recopie ; les
mêmes fichiers servent à l'instance de recette (« Recette », en adaptant noms, port et chemins). Un `Dockerfile`
facultatif est fourni pour un hébergeur qui imposerait des conteneurs (« Variante : conteneur Docker »).

## Avant de commencer

- **Comptes** : chaque personne a un compte nominatif. Les salariés dotés d'un compte Microsoft 365
  s'y connectent par Microsoft (application inscrite dans Entra, `docs/CONNEXION-MICROSOFT.md`) ; le
  personnel sans compte d'entreprise (ouvriers, intérimaires, alternants) a un compte Cursus,
  identifiant et mot de passe. Le premier administrateur RH se crée en ligne de commande (« Premier administrateur RH ») ;
  il crée ensuite les autres comptes dans Paramètres → Comptes et accès.
- **Recette** : chaque mise en production, première installation comme mise à jour, est précédée
  d'une recette par le groupe pilote (un RH, un manager, un collaborateur). Voir « Recette ».
- **Données personnelles** : Cursus conserve des données relatives à la santé (visites médicales,
  avis d'aptitude et restrictions de poste, vaccinations) et des documents de voyage. Faire valider le choix de l'hébergeur par le
  DPO : localisation dans l'UE, contrat de sous-traitance (RGPD, article 28) et question d'un
  hébergement certifié HDS. Le DPO valide aussi l'information affichée avant la saisie d'une vaccination
  (art. 13 du RGPD : `INFO_VACCINATIONS` de `shared/constants.ts`), qu'il complète au besoin de ses coordonnées,
  et y fixe la durée de conservation (rubrique « Conservation », « à préciser avant la mise en service ») : Cursus
  n'efface encore rien, même au départ du salarié, et garde les déclarations antérieures et le journal des actions.
- **Disque chiffré** (prérequis) : la base et ses sauvegardes sont sur un volume chiffré au repos (voir « Protection
  des données sur le disque »).
- **Nom de domaine** : un sous-domaine dédié (dans ce guide `cursus.example.fr`) dont les
  enregistrements DNS A / AAAA pointent vers la machine.

## Machine

- Debian 12 ou Ubuntu 24.04 LTS, 2 vCPU, 2 à 4 Go de mémoire, 20 Go de disque : SQLite n'exige
  aucun serveur de base de données.
- Mises à jour de sécurité automatiques :

  ```bash
  sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
  ```

- Fuseau horaire de Paris : Cursus calcule lui-même la date du jour (échéances, semaines, date de
  sortie des salariés) et l'horodatage des envois à la paie à l'heure de Paris, même sur une machine
  laissée en UTC chez l'hébergeur. Régler la machine sur Paris garde des journaux système lisibles ;
  le service systemd pose aussi `TZ=Europe/Paris`.

  ```bash
  sudo timedatectl set-timezone Europe/Paris
  ```

- Disque chiffré : voir « Protection des données sur le disque » ci-dessous.
- Accès SSH par clé uniquement (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`).
- Pare-feu : seuls SSH, HTTP (redirection et certificat) et HTTPS sont ouverts.

  ```bash
  sudo ufw default deny incoming
  sudo ufw allow OpenSSH
  sudo ufw allow 80,443/tcp
  sudo ufw enable
  ```

## Protection des données sur le disque

La base est un fichier SQLite qui contient des données de santé (visites médicales, avis d'aptitude et restrictions,
vaccinations), des numéros de passeport et les variables de paie. Elle est protégée ainsi :

- **Disque chiffré, prérequis de l'installation** : `/var/lib/cursus` (base et copies locales) est sur un volume
  chiffré au repos. Soit le chiffrement du disque proposé par l'hébergeur (volume ou disque système chiffré, à cocher
  à la commande ou à vérifier dans le contrat), soit un volume LUKS créé par le service informatique (`cryptsetup
  luksFormat`, clé hors de la machine ou saisie au démarrage). Le choix est consigné avec le DPO : il couvre le vol
  d'un disque ou sa réaffectation par l'hébergeur, pas un accès à la machine en marche.
- **Droits du fichier** : au démarrage, Cursus réserve la base et ses fichiers `-wal` et `-shm` au compte du service
  (`600`) et lui ferme son dossier (`700`) ; une base neuve est créée ainsi. En production, il refuse de démarrer si
  la base reste accessible à d'autres comptes, par exemple un fichier créé par `root` (« Démarrage impossible : la base
  reste accessible à d'autres comptes… » : `sudo chown cursus:cursus /var/lib/cursus/cursus.db*` puis `sudo chmod 600
  /var/lib/cursus/cursus.db*`). Un dossier partagé (`/tmp`, dossier du code) n'est jamais modifié : la base doit avoir
  son propre dossier. Les copies de sauvegarde sont déjà en `600` dans un dossier en `700` (`docs/SAUVEGARDE.md`).
- **Clé de session** : en production, `CURSUS_SECRET` est obligatoire. Une clé écrite dans la base par un essai sans
  elle (développement, démonstration) en est retirée au démarrage suivant (« Ancienne clé de session retirée de la
  base ») et effacée du fichier lui-même (suppression avec `secure_delete`, journal `-wal` vidé) ; les sauvegardes
  antérieures la contiennent encore jusqu'à leur rotation.
- **Chiffrement des colonnes par Cursus** : pas dans cette version. Le DPO dit si le disque chiffré suffit ou s'il
  exige en plus un chiffrement applicatif d'une courte liste de colonnes (passeport, avis et restrictions,
  vaccinations, comptes rendus d'entretien), voire un hébergement certifié HDS.

## Node.js

Node.js 22.18 ou plus récent (TypeScript exécuté nativement, SQLite intégré), par exemple depuis
les paquets NodeSource :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install nodejs
node --version   # v22.18 ou plus
```

## Utilisateur et dossiers

Un utilisateur système dédié, sans shell ; le code dans `/opt/cursus` (lecture seule pour le
service), la base dans `/var/lib/cursus` (lisible par Cursus seul), la configuration dans `/etc/cursus`.

```bash
sudo useradd --system --home-dir /var/lib/cursus --shell /usr/sbin/nologin cursus
sudo install -d -o cursus -g cursus -m 700 /var/lib/cursus
sudo install -d -o root -g cursus -m 750 /etc/cursus
sudo install -d -o cursus -g cursus -m 755 /opt/cursus
```

Installer le code (dépôt Git ou archive livrée), puis compiler l'interface :

```bash
sudo -u cursus git clone <dépôt> /opt/cursus
cd /opt/cursus
sudo -u cursus npm ci
sudo -u cursus npm run build
```

Cursus trouve son interface (`dist/`) et, sans `CURSUS_DB`, sa base (`data/cursus.db`) à partir de l'emplacement de
son code, quel que soit le dossier de lancement. Sans `dist/`, il le signale au démarrage (« Interface non compilée :
… Lancez npm run build ») et ne sert que l'API.

## Variables d'environnement

Partir du modèle commenté `.env.example` :

```bash
sudo cp /opt/cursus/.env.example /etc/cursus/cursus.env
sudo chown root:cursus /etc/cursus/cursus.env
sudo chmod 640 /etc/cursus/cursus.env
openssl rand -hex 32   # une fois pour CURSUS_SECRET, une autre fois pour KEYSTONE_API_KEY
sudo nano /etc/cursus/cursus.env
```

| Variable | Production |
| --- | --- |
| `NODE_ENV` | `production` |
| `CURSUS_API_PORT` | `3210` (port local, jamais ouvert au pare-feu) |
| `CURSUS_HOST` | à laisser vide : 127.0.0.1 par défaut en production |
| `CURSUS_TRUST_PROXY` | à laisser vide (`loopback`) quand le proxy est sur la même machine ; sinon, son adresse |
| `CURSUS_DB` | `/var/lib/cursus/cursus.db` (chemin absolu ; un chemin relatif partirait du dossier de lancement) |
| `CURSUS_SECRET` | 64 caractères aléatoires, propres à cette installation. La changer déconnecte tout le monde |
| `KEYSTONE_API_KEY` | clé aléatoire transmise à Keystone par un canal sûr. Sans elle, les routes Keystone répondent 503 |
| `CURSUS_SUPERVISION_TOKEN` | facultative : jeton aléatoire (32 caractères au moins, `openssl rand -hex 32`) de l'outil de supervision, qui obtient alors le détail du point de santé à travers le proxy (« Exploitation courante ») |
| `CURSUS_OIDC_TENANT`, `CURSUS_OIDC_CLIENT_ID`, `CURSUS_OIDC_CLIENT_SECRET` | connexion Microsoft 365 : ID de l'annuaire (GUID), ID d'application et secret client relevés dans Entra (`docs/CONNEXION-MICROSOFT.md`). Noter la date d'expiration du secret |
| `CURSUS_PUBLIC_URL` | `https://cursus.example.fr` : adresse publique, sans chemin. URI de redirection à inscrire dans Entra : `https://cursus.example.fr/api/auth/microsoft/retour` |
| `CURSUS_OIDC_AUTORITE` | **jamais** : réservée aux tests automatiques, Cursus refuse de démarrer avec elle |
| `CURSUS_MAIL_FROM` | boîte d'envoi des e-mails (`cursus@entreprise.fr`) ; sans elle, les e-mails sont simulés (`docs/EMAILS.md`) |
| `CURSUS_MAIL_TENANT`, `CURSUS_MAIL_CLIENT_ID`, `CURSUS_MAIL_CLIENT_SECRET` | application Entra autorisée à envoyer (`Mail.Send`, restreinte à la boîte d'envoi) ; par défaut celle de la connexion Microsoft. Noter la date d'expiration du secret |
| `KEYSTONE_URL`, `KEYSTONE_TOKEN` | envois à Keystone : adresse de base de Keystone sur le réseau interne (`http://keystone.interne:8080`) et jeton convenu avec lui. Cursus refuse de démarrer avec l'adresse sans le jeton, ou avec des identifiants dans l'adresse. Sans adresse, les messages ne sont que tracés dans le journal |
| `SAGE_URL`, `SAGE_TOKEN`, `SAGE_DOSSIER` | envoi à Sage Paie, quand il sera livré |
| `CURSUS_DEMO`, `CURSUS_TODAY`, `CURSUS_INSECURE_COOKIE` | **jamais** sur ce serveur. La démonstration ouvre l'espace RH sans mot de passe : Cursus refuse de démarrer avec elle, et refuserait de toute façon (403) chaque requête relayée par le proxy |

Au démarrage, Cursus contrôle cette configuration. S'il manque une valeur obligatoire ou si un
réglage est dangereux, il refuse de démarrer, liste chaque problème dans le journal
(`journalctl -u cursus`) et sort avec le code 1. La connexion Microsoft 365 est facultative mais
entière : les quatre variables `CURSUS_OIDC_*` et `CURSUS_PUBLIC_URL` (en https), ou aucune.

## Service systemd

`/etc/systemd/system/cursus.service` (fichier prêt à copier : `deploy/cursus.service`,
`sudo install -m 644 /opt/cursus/deploy/cursus.service /etc/systemd/system/`) :

```ini
[Unit]
Description=Cursus — suivi RH
After=network.target

[Service]
Type=simple
User=cursus
Group=cursus
WorkingDirectory=/opt/cursus
EnvironmentFile=/etc/cursus/cursus.env
# Heure locale de Paris pour le processus (Cursus calcule de toute façon la date du jour à l'heure de Paris).
Environment=TZ=Europe/Paris
ExecStart=/usr/bin/node server/src/index.ts
# Démarrage impossible (port pris, configuration refusée) : code 1, relancé 5 s plus tard.
# Arrêt (stop, restart) : SIGTERM, requêtes en cours terminées (10 s au plus), base fermée, verrou retiré.
Restart=on-failure
RestartSec=5
UMask=0077
# Durcissement : Cursus n'écrit que dans /var/lib/cursus.
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cursus
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cursus
sudo systemctl status cursus
journalctl -u cursus -n 50
```

Le journal doit afficher le chemin complet de la base et des sauvegardes
(`Cursus 0.1.0 — base /var/lib/cursus/cursus.db · sauvegardes /var/lib/cursus/backups`), puis
`Cursus — API sur http://127.0.0.1:3210 (application servie)`, sans « mode démonstration ». Une base vide reste
vide : aucune donnée fictive n'est chargée. Tant qu'aucun administrateur RH n'existe, il le rappelle :
`Aucun administrateur RH : créez-le avec…`.

Messages de démarrage à connaître (`journalctl -u cursus`) :

| Message | Que faire |
| --- | --- |
| `Démarrage impossible : Le port 3210 est déjà utilisé sur 127.0.0.1 : arrêtez l’autre service ou changez CURSUS_API_PORT.` | Un autre programme (ou une autre instance de Cursus, la recette par exemple) écoute ce port : `sudo ss -ltnp 'sport = :3210'`. Code de sortie 1 : systemd relance le service toutes les 5 s jusqu'à ce que le port se libère. |
| `Interface non compilée (/opt/cursus/dist introuvable)` | `sudo -u cursus npm run build`, puis redémarrer. |
| `Droits restreints au seul compte du service : …` | Information : la base ou son dossier étaient ouverts à d'autres comptes, c'est corrigé. |
| `Démarrage impossible : la base reste accessible à d’autres comptes…` | Voir « Protection des données sur le disque ». |
| `Démarrage impossible : Un autre serveur Cursus utilise déjà cette base` | Voir `docs/SAUVEGARDE.md`, section 7. |

À l'arrêt (`systemctl stop` ou `restart`), le journal affiche `Arrêt demandé (SIGTERM) : fin des requêtes en cours,
10 s au plus.` puis `Cursus arrêté.` : aucune requête n'est coupée net, la base est fermée proprement et son verrou
retiré. Si la base est momentanément occupée (`npm run comptes` lancé service démarré, sauvegarde), Cursus attend
jusqu'à 5 s avant de répondre par une erreur.

## Premier administrateur RH

Une installation vide n'a aucun compte. Le service informatique crée le premier administrateur RH
sur le serveur, en tant qu'utilisateur `cursus` ; la commande fonctionne service démarré ou arrêté
(service arrêté, elle met d'abord la base à jour comme au démarrage ; service démarré avec une version
antérieure à celle installée, elle refuse : redémarrer d'abord le service).
Avec la connexion Microsoft 365 configurée, l'identifiant est l'adresse de connexion Microsoft de la
personne : `npm run comptes -- admin prenom.nom@entreprise.fr` (aucun mot de passe : elle se connecte
par « Se connecter avec Microsoft »). Sinon, ou en secours, créer un compte Cursus (`--local`) :

```bash
cd /opt/cursus
sudo -u cursus env CURSUS_DB=/var/lib/cursus/cursus.db \
  npm run comptes -- admin rh.admin --local --nom "Prénom Nom" --adresse prenom.nom@entreprise.fr
```

La commande affiche un mot de passe provisoire, une seule fois : le remettre à la personne en main
propre ; elle le remplace à sa première connexion (12 caractères au moins). Sans `--local`,
l'identifiant est l'adresse Microsoft 365 de la personne (`npm run comptes -- admin
prenom.nom@entreprise.fr`). `--salarie <n°>` rattache le compte à la fiche d'un salarié déjà
saisie ; sans lui, le compte est externe (nom et adresse propres, espace RH seulement).

Un membre du service RH qui est aussi salarié doit porter son profil RH sur le compte rattaché à sa fiche :
c'est ce rattachement qui empêche Cursus de le laisser décider de ses propres absences, feuilles de temps ou
entretiens. Le premier administrateur, créé avant toute fiche, est un compte externe : une fois sa fiche saisie,
l'administrateur RH rattache son compte dans Paramètres → Comptes et accès (« Rattacher à une fiche »), ou le
service informatique relance la commande avec `--salarie <n°>`. Si la fiche a déjà son propre compte, porter le
profil RH sur ce compte-là, puis désactiver le compte externe.

L'administrateur RH crée ensuite les comptes des salariés et des autres membres du service RH
(gestionnaires RH) dans Paramètres → Comptes et accès. Chaque création est tracée dans le journal. Le profil se
choisit à la création et se modifie ensuite : gestionnaire ou administrateur RH, ou l'un des trois profils
restreints — référent HSE / formation, gestionnaire de paie (un cabinet extérieur reçoit un compte externe, nom et
adresse, sans fiche salarié), lecture seule pour la direction, le DPO ou un auditeur (`docs/ARCHITECTURE.md`,
« Profils »).

Recours : si plus aucun administrateur ne peut se connecter (mot de passe oublié, compte bloqué ou
désactivé, identité Microsoft recréée), relancer la même commande avec l'identifiant existant. Elle
rétablit le profil administrateur RH, réactive et débloque le compte et, pour un compte Cursus, affiche
un nouveau mot de passe provisoire ; pour un compte Microsoft, elle retire le rattachement à l'identité
Microsoft, rétabli à la connexion suivante (les sessions ouvertes de ce compte sont fermées).

Protection des comptes Cursus : mot de passe haché (scrypt), message d'échec identique quel que
soit l'identifiant, blocage du compte 15 minutes après 5 échecs, et refus (429, avec `Retry-After`) des
tentatives d'une adresse IP au-delà de 30 échecs en 15 minutes — un atelier entier peut sortir par une même adresse.
Chaque tentative est comptée dès son arrivée, avant la vérification du mot de passe : des requêtes
envoyées en même temps ne passent pas ces limites (une connexion réussie est rendue à l'adresse).
Connexions réussies et refusées sont tracées dans le journal, jamais les mots de passe ; la vue
« Connexions et accès » / « Opérations » de Paramètres → Journal les sépare des opérations RH.

## Référentiels de l'entreprise

Une base neuve n'a ni formation, ni habilitation, ni destination : sans elles, aucune certification ne se saisit et
Keystone voit refusés les chantiers qui en exigent (« inconnue du référentiel de Cursus »). Avant la reprise des
titres et l'ouverture à Keystone, l'administrateur RH (ou le référent HSE pour les formations et les habilitations)
les remplit dans l'écran Référentiels : saisie, ou « Charger le référentiel type » (11 formations, 6 habilitations
et 8 destinations courantes, les habilitations après les formations) puis vérification des validités, coûts,
organismes, signataires et formalités. Les codes, choisis à la création, sont ceux que Keystone envoie dans les
exigences de ses chantiers : les convenir avec l'équipe Keystone. Un élément inutile s'archive.

## Reverse proxy HTTPS : Caddy (recommandé)

Caddy obtient et renouvelle seul le certificat (Let's Encrypt) et redirige HTTP vers HTTPS.

```bash
sudo apt install caddy
```

`/etc/caddy/Caddyfile` (`203.0.113.10` : adresse d'où Keystone appelle Cursus, à remplacer ; fichier prêt à
copier : `deploy/Caddyfile`) :

```
cursus.example.fr {
	encode zstd gzip
	request_body {
		max_size 3MB
	}
	# API Keystone : réservée à l'adresse de Keystone (403 ailleurs).
	@keystone_ailleurs {
		path /api/integrations/keystone/*
		not remote_ip 203.0.113.10
	}
	respond @keystone_ailleurs 403
	reverse_proxy 127.0.0.1:3210
}
```

Caddy n'a pas de limitation de débit sans module complémentaire : Cursus limite lui-même le débit
(« Protections de l'API » ci-dessous), résume les appels refusés faute de clé (une ligne de journal par
minute), et la restriction d'adresse suffit à écarter Internet de l'API Keystone.

```bash
sudo systemctl reload caddy
```

Caddy transmet `X-Forwarded-Proto` et `X-Forwarded-For` : Cursus, qui fait confiance au proxy
local (`CURSUS_TRUST_PROXY=loopback`), sait que la requête est en HTTPS et ajoute l'en-tête
`Strict-Transport-Security` (HSTS, un an).

### Protections de l'API

- **Origine des requêtes** (CSRF) : Cursus refuse (403) une requête qui modifie et ne vient pas de sa propre page
  (en-têtes `Origin` et `Sec-Fetch-Site` du navigateur, corps JSON exigé). Il compare l'origine au nom demandé :
  le proxy doit donc transmettre le nom d'origine (`Host`, ce que font Caddy par défaut et la configuration nginx
  ci-dessous, ou `X-Forwarded-Host`) ; `CURSUS_PUBLIC_URL`, si elle est définie, est admise en plus.
- **Débit** : par adresse IP du client (`X-Forwarded-For` du proxy de confiance), 1 200 requêtes d'avance puis 20 par
  seconde — tout un site peut sortir par une même adresse ; par compte connecté, 240 puis 2 par seconde, du poste, du
  téléphone ou du domicile ; aller et retour de la connexion Microsoft, 300 puis 2 par seconde par adresse ; clés
  Keystone invalides, 60 en 5 minutes par adresse. Au-delà : `429 Too Many Requests` avec `Retry-After` (secondes) et
  un message en français. Compteurs en mémoire, remis à zéro au redémarrage, bornés à 10 000 adresses ou comptes.

## Variante : nginx et certbot

```bash
sudo apt install nginx certbot
sudo install -d /var/www/letsencrypt
```

Le certificat s'obtient d'abord, avec le seul bloc du port 80 : nginx refuse une configuration qui
cite un certificat encore absent. `/etc/nginx/sites-available/cursus` :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cursus.example.fr;

    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }   # validation Let's Encrypt
    location / { return 301 https://$host$request_uri; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cursus /etc/nginx/sites-enabled/cursus
sudo nginx -t && sudo systemctl reload nginx
# Renouvellement automatique (minuteur certbot), suivi d'un rechargement de nginx.
sudo certbot certonly --webroot -w /var/www/letsencrypt -d cursus.example.fr --deploy-hook 'systemctl reload nginx'
```

Une fois le certificat présent dans `/etc/letsencrypt/live/cursus.example.fr/`, ajouter le bloc
HTTPS au même fichier :

```nginx
server {
    listen 443 ssl http2;          # Debian 12 (nginx 1.22), Ubuntu 24.04 (nginx 1.24)
    listen [::]:443 ssl http2;     # nginx 1.25.1 et plus : « listen 443 ssl; » puis « http2 on; »
    server_name cursus.example.fr;

    ssl_certificate     /etc/letsencrypt/live/cursus.example.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cursus.example.fr/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 3m;       # imports CSV : 2 Mo côté Cursus

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Keystone : réservée à l'adresse de Keystone (203.0.113.10, à remplacer), débit limité.
    location /api/integrations/keystone/ {
        allow 203.0.113.10;
        deny all;
        limit_req zone=keystone burst=50 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3210;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

La zone de limitation se déclare en tête du même fichier, hors des blocs `server` (10 appels par
seconde en régime établi, 50 d'avance pour un instantané découpé) :

```nginx
limit_req_zone $binary_remote_addr zone=keystone:1m rate=10r/s;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Variante : conteneur Docker

Pour un hébergeur à conteneurs, Coolify en tête (réglages : README.md, « Mise en ligne »), ou une machine où l'on préfère Docker au service systemd. Le
`Dockerfile` du code construit l'interface dans une première étape, puis une image d'exécution sur `node:22-slim`
sans les dépendances de développement, sous un compte `cursus` sans droits, avec un volume `/data` pour la
base et ses sauvegardes, et une sonde `HEALTHCHECK` sur `/api/health`. L'image fixe le port 3000, la base `/data/cursus.db`, l'écoute sur toutes les
interfaces du conteneur (`CURSUS_HOST=0.0.0.0`) et la confiance dans les proxys de la boucle locale et des réseaux
privés (`CURSUS_TRUST_PROXY=loopback,uniquelocal`). Avec Coolify, il suffit de déclarer le port, le volume et les
variables ; sur une machine à soi, seul le port local est publié, derrière le même reverse proxy.

```bash
cd /opt/cursus
sudo docker build -t cursus:0.1.0 .
sudo docker volume create cursus-donnees
sudo docker run -d --name cursus --restart on-failure --stop-timeout 20 \
  --env-file /etc/cursus/cursus.env -e CURSUS_DB=/data/cursus.db -e CURSUS_HOST=0.0.0.0 \
  -e CURSUS_API_PORT=3000 -e CURSUS_TRUST_PROXY=loopback,uniquelocal \
  -v cursus-donnees:/data -p 127.0.0.1:3210:3000 cursus:0.1.0
sudo docker logs cursus                                          # mêmes messages que journalctl
sudo docker inspect --format '{{.State.Health.Status}}' cursus  # healthy
```

- `CURSUS_TRUST_PROXY` : le proxy atteint le conteneur par le réseau Docker, pas par la boucle locale ;
  sans ce réglage (adresses privées, ou l'adresse exacte du proxy), Cursus ne croirait pas `X-Forwarded-*` :
  ni HSTS, ni adresse du client pour la limite de débit.
- `-e CURSUS_HOST=0.0.0.0`, `-e CURSUS_API_PORT=3000` et `-e CURSUS_DB` après `--env-file` : le fichier de la machine laisse l'écoute sur la boucle locale, qui
  dans un conteneur ne recevrait rien de l'extérieur.
- `--stop-timeout 20` : `docker stop` envoie SIGTERM ; Cursus finit les requêtes en cours (10 s au plus) et ferme la
  base avant que Docker ne coupe le conteneur.
- Le volume reçoit le chiffrement du disque de la machine (« Protection des données sur le disque »).
- Point de santé : un `curl` lancé sur la machine vers `127.0.0.1:3210` entre dans le conteneur par le pont Docker,
  pas par sa boucle locale ; il n'obtient que la réponse publique `{"statut":"ok","base":"ok"}`. Le détail (version,
  mode, envois en échec) s'obtient dans le conteneur, comme la sonde `HEALTHCHECK` :
  `sudo docker exec cursus node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(console.log)"`,
  ou avec le jeton de supervision (`CURSUS_SUPERVISION_TOKEN`, « Exploitation courante »).
- Commandes d'exploitation dans le conteneur : `sudo docker exec -it cursus node server/src/comptes-cli.ts admin …`,
  `sudo docker exec cursus node --disable-warning=ExperimentalWarning server/src/backup.ts` ; la copie hors de la
  machine sauvegarde le dossier du volume (`docker volume inspect cursus-donnees`).
- Mise à jour : construire la nouvelle image, `docker stop cursus && docker rm cursus`, puis `docker run` avec la
  nouvelle version ; retour arrière : relancer l'ancienne image, après restauration de la base si elle a été migrée
  (« Mise à jour », étape 5).

## Vérifications après installation

```bash
curl -sI https://cursus.example.fr/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type'
curl -s https://cursus.example.fr/api/health                    # {"statut":"ok","base":"ok"}
curl -s http://127.0.0.1:3210/api/health                        # sur la machine (service systemd) : version, "mode":"production", envois en échec
curl -s https://cursus.example.fr/api/session                   # "demo":false, "user":null et, avec Microsoft 365, "microsoft":true
curl -s -o /dev/null -w '%{http_code}\n' http://cursus.example.fr/                       # 301 ou 308 vers HTTPS
curl -s -o /dev/null -w '%{http_code}\n' https://cursus.example.fr/api/integrations/keystone/v1/chantiers/X/go-no-go   # 403 hors de l'adresse de Keystone
```

Avec le conteneur Docker, le `curl` sur `127.0.0.1:3210` ne donne que `{"statut":"ok","base":"ok"}` : le détail
s'obtient par `docker exec` ou avec le jeton de supervision (« Variante : conteneur Docker »).

Depuis la machine de Keystone, la même commande répond `401` (clé absente).

Depuis un téléphone de l'entreprise, hors du réseau interne : la page de connexion s'affiche en
HTTPS, sans alerte de certificat.

## Postes et téléphones

- Ordinateurs Windows attribués : Edge ou Chrome à jour. Téléphones fournis : Safari ou Chrome à
  jour, verrouillage de l'écran imposé par la gestion de flotte.
- Une session dure 12 heures au plus depuis la connexion, sans prolongation : chacun se reconnecte
  au moins une fois par journée de travail. À l'expiration, la reconnexion s'affiche par-dessus l'écran
  sans perdre la saisie en cours. « Se déconnecter » invalide la session aussitôt ; pour un compte
  Microsoft, elle ferme aussi la session Microsoft du navigateur.
- Départ d'un salarié : ses sessions sont refusées dès le lendemain de sa date de sortie, à minuit
  heure de Paris (fuseau réglé, voir « Machine »). Désactiver son compte (Paramètres → Comptes et
  accès) ferme ses sessions aussitôt.
- Mot de passe Cursus oublié ou compte bloqué : l'administrateur RH attribue un nouveau mot de passe
  provisoire (« Mot de passe » dans Comptes et accès).

## Recette

Décision de l'entreprise : une recette par un groupe pilote (un RH, un manager, un collaborateur)
précède chaque mise en production.

- Instance de recette distincte, installée selon ce guide : autre sous-domaine (par exemple
  `cursus-recette.example.fr`), autre utilisateur ou dossier, autre port local (3211), autre base,
  ses propres `CURSUS_SECRET` et `KEYSTONE_API_KEY`, et sa propre inscription d'application dans Entra
  (« Cursus recette », `docs/CONNEXION-MICROSOFT.md`).
- Jamais de mode démonstration sur l'instance de recette : il ouvrirait l'espace RH sans mot de
  passe à tout visiteur d'Internet. Derrière le proxy, Cursus refuse de démarrer avec
  `CURSUS_DEMO=1` et refuserait (403) toute requête relayée. La recette se fait comme en
  production, avec des comptes nominatifs (premier administrateur : `npm run comptes`).
- Données de recette fictives ou anonymisées : jamais de copie de la base de production (données
  de santé). Les données de démonstration peuvent être chargées dans la base de recette, service
  arrêté ; `CURSUS_DEMO=1` ne vaut alors que pour cette commande, jamais pour le service :

  ```bash
  sudo systemctl stop cursus-recette
  cd /opt/cursus-recette
  sudo -u cursus-recette env CURSUS_DEMO=1 CURSUS_DB=/var/lib/cursus-recette/cursus.db node server/src/reset.ts
  sudo systemctl start cursus-recette
  ```

- La nouvelle version y est installée d'abord. Le groupe pilote vérifie, chacun dans son espace :
  connexion et déconnexion, tableau de bord, fiches collaborateurs, temps, absences, formations,
  impression du passeport formation, consultation sur téléphone.
- Le service informatique consigne la version, la date et l'accord des trois pilotes avant de
  passer en production.

## Mise en service : reprise depuis Lucca

Cursus fait foi, après la reprise, pour la liste des salariés et les compteurs de congés (décision de l'entreprise) ;
les compteurs sont arrêtés dans Lucca au 1er janvier 2027.

- **Matricules de paie** : chaque fiche porte le matricule du dossier de paie Sage (1 à 20 lettres et chiffres,
  unique), saisi par le service RH (fiche du collaborateur) ou repris de Lucca. Paramètres → Matricules de paie liste
  les salariés présents qui n'en ont pas (intérimaires exclus : payés par leur agence). Tant qu'il manque, le salarié
  est transmis à Sage sous son matricule Cursus en simulation, et une transmission réelle est refusée en le nommant :
  tous les matricules sont à saisir avant la première transmission réelle. Réembauche : reprendre le matricule d'un
  salarié sorti se confirme par l'administrateur RH (les deux fiches portent alors le même matricule ; Sage et Keystone
  ne reçoivent que la fiche présente). Seul l'administrateur RH change ou retire un matricule déjà enregistré.
- **Keystone** : il reçoit par défaut le matricule Cursus (`EMP-0001`), contrat de l'API v1. La bascule sur le
  matricule de paie (Paramètres → Matricules de paie, « Identifiant envoyé à Keystone », administrateur RH) vaut dans
  les deux sens, envois et appels reçus : l'annoncer à Keystone avant (`docs/API-KEYSTONE.md`), et ne la faire qu'une
  fois les matricules saisis.
- **Compteurs repris datés** : chaque compteur repris porte sa date d'arrêté ; les CP pris comptent sur la période de
  cette date (du 1er juin au 31 mai), les RTT pris sur son année civile, jamais au-delà. Au premier démarrage de cette
  version, une base existante reçoit la date du jour comme date d'arrêté et ses reports de CP leur période (un report
  accordé dont la période visée a déjà commencé devient un report reçu sur elle ; migration
  `lot4-reprise-soldes-dates`, journal : `migration.soldes`) : sans elle, les RTT repris seraient déduits à nouveau
  au 1er janvier et les CP au 1er juin.
- **Clôtures** : Cursus propose la clôture des RTT à partir du 1er janvier et celle des CP à partir du 1er juin
  (bandeau de l'écran Congés & absences), pour les périodes tenues par Cursus (postérieures à la date d'arrêté). Le
  service RH la confirme ; pour les CP, il décide salarié par salarié du report (plafonné au solde, jusqu'au 31 mai
  suivant) ou de la perte du solde, jamais d'office ; après une absence de santé, une maternité, une paternité ou une
  adoption dans la période, le solde est reporté de 15 mois. Un report légal reçu qui court au-delà du 31 mai (15 mois)
  est reporté de nouveau pour ses seuls jours restants, jusqu'à sa propre échéance, où il s'éteint ; le reste du solde
  est au choix du service RH. Une demande de CP de la période encore en attente est à décider avant la clôture de la
  ligne ; des jours rendus plus tard à une période close (refus, annulation) sont reportés sur la période suivante.
  Les RTT ne sont pas reportables : leur clôture photographie les soldes perdus, après le rappel du compte
  épargne-temps (un salarié dont une demande de RTT de l'année est en attente n'est clôturé qu'après sa décision). Première clôture des CP de la reprise : le
  1er juin 2027. Chaque clôture est tracée (`conges.cloturer`, archive paie de 3 ans) et sans effet si on la relance.

## Mise à jour

1. Recette de la nouvelle version (ci-dessus).
2. Sauvegarde de la base juste avant l'opération (`docs/SAUVEGARDE.md`).
3. Installation :

   ```bash
   cd /opt/cursus
   sudo -u cursus git pull          # ou dépôt de la nouvelle archive
   sudo -u cursus npm ci
   sudo -u cursus npm run build
   sudo systemctl restart cursus
   journalctl -u cursus -n 50       # les migrations de données s'exécutent au démarrage
   ```

   Chaque migration nommée ne s'exécute qu'une fois par base (« Migration lot4-… faite »), après la copie
   `…-avant-migration.db` ; une migration interrompue est annulée et le service ne démarre pas (« Démarrage
   impossible : migration … interrompue ») : la cause corrigée, il la retente au démarrage suivant. Une version qui
   apporte des migrations nommées fait toujours cette copie, même si elles ne changent rien d'autre (« notées faites
   sans modification ») : leurs noms enregistrés suffisent à faire refuser la base par la version précédente.

4. Vérifications après installation (ci-dessus).
   Mise à jour vers la version qui suit les formalités de détachement (certificat A1 ou de la convention bilatérale,
   information écrite au-delà de 4 semaines) : les déplacements déjà partis sont réputés en règle au premier démarrage
   (journal : `migration.detachement`). Ceux à venir apparaissent « à faire » : le service RH saisit dès la mise à
   jour les formalités déjà obtenues (écran Voyages, dossier du déplacement : « Enregistrer l’obtention »), faute de
   quoi le Go / No Go transmis à Keystone reste en réserve jusqu'au départ, puis passe en No Go le jour du départ.
5. En cas de problème : revenir à la version précédente (`git checkout <version>`, `npm ci`,
   `npm run build`), restaurer la sauvegarde et redémarrer. Sans restauration, la version précédente refuse de
   démarrer sur une base que la nouvelle a migrée (« Démarrage impossible : la base a été mise à jour par une version
   plus récente de Cursus le … (… migration inconnue …) », code 1). Restaurer la copie `…-avant-migration.db` que le
   message nomme : celle enregistrée dans la base avec la première migration que la version précédente ne connaît
   pas, faite juste avant, au premier démarrage de la nouvelle version (ou par `npm run comptes` ou
   `npm run reset-demo` lancés avant lui). Si le message n'en nomme aucune (copie supprimée depuis, à l'étape 6 ou par
   la rotation ; base créée par la nouvelle version), restaurer la sauvegarde de l'étape 2, jamais une copie plus
   ancienne. Commande : `npm run restore -- <fichier>` (`docs/SAUVEGARDE.md`) ; les saisies faites depuis la mise à
   jour sont perdues.
6. Mise à jour qui expurge le journal des actions (première version à liste blanche) : au démarrage, le
   serveur signale « Journal : … lignes antérieures expurgées » et nomme la copie `…-avant-migration.db`
   faite juste avant. Cette copie contient l'ancien journal non expurgé (numéros de passeport, CSV
   importés, natures d'absence, vaccins) ; la rotation compte les copies par type, pas les jours, et ne la
   supprimerait qu'après 14 migrations ultérieures, bien au-delà de la durée d'un an décidée par
   l'entreprise. Une fois la mise à jour vérifiée (étape 4), la supprimer :
   `sudo -u cursus rm /var/lib/cursus/backups/cursus-…Z-avant-migration.db`. La sauvegarde de l'étape 2,
   comme les copies quotidiennes, disparaît d'elle-même avec la rotation (deux semaines environ).

## Exploitation courante

- Surveillance : le point de santé `https://cursus.example.fr/api/health` répond 200 `{"statut":"ok","base":"ok"}`
  tant que Cursus et sa base répondent, et 503 `{"statut":"indisponible","base":"erreur"}` si la base ne répond plus
  (service arrêté : pas de réponse, ou 502 du proxy). Sans connexion, il ne donne rien d'autre. Appelé sur la machine
  (`curl -s http://127.0.0.1:3210/api/health` pour le service systemd, sans passer par le proxy ; `docker exec` pour
  le conteneur, voir « Variante : conteneur Docker ») ou avec le jeton de supervision
  (`curl -s -H "Authorization: Bearer $JETON" https://cursus.example.fr/api/health`, `CURSUS_SUPERVISION_TOKEN`), il
  ajoute la version, le mode (`production` attendu ; `demo` serait une erreur de configuration), le nombre d'envois en
  échec non classés (à faire traiter par le service RH dans Paramètres → Envois) et l'heure du démarrage. Il ne compte
  pas dans la limite de débit. Compléter par le journal du service (`journalctl -u cursus`) et du proxy, l'espace
  disque de `/var/lib/cursus` et la fraîcheur des sauvegardes (`docs/SAUVEGARDE.md`, section 6). L'application de
  bureau (macOS) garde sa propre sonde, `/api/session`.
- Certificat : renouvelé automatiquement (Caddy ou minuteur certbot) ; vérifier l'échéance une fois
  par trimestre.
- Changer la clé Keystone : nouvelle valeur dans `/etc/cursus/cursus.env`, `systemctl restart
  cursus`, puis transmission à Keystone.
- Keystone alimente les chantiers, projets, affectations et tâches par son API (`docs/API-KEYSTONE.md`) :
  sans elle, une base de production n'a ni chantier ni projet. Ses appels sont tracés dans le journal
  (Paramètres → Journal des actions, vue « Appels de Keystone », action `keystone.appel`) ; les appels
  sans clé valide y sont résumés, une ligne par minute au plus. Des résumés répétés signalent une clé
  mal recopiée côté Keystone, ou des appels venus d'ailleurs (restriction d'adresse du proxy à vérifier).
- Envois à Keystone (`KEYSTONE_URL`) : Paramètres → Envois montre chaque message (à envoyer, envoyé avec
  l'accusé de Keystone, en échec avec l'erreur). Keystone injoignable : les messages attendent et sont
  retentés jusqu'à 10 fois sur environ 4 h ; au-delà, ils passent en échec (journal : `keystone.echec`)
  et le service RH les relance une fois Keystone rétabli, ou les classe s'ils ne passeront jamais (refus
  définitif examiné) : classés, ils ne comptent plus dans l'état de l'intégration. Aucun message n'est
  perdu à un redémarrage : la file est dans la base.
- Journal des actions : conservé 1 an, puis supprimé, sauf les actions liées à la paie (validations,
  corrections d'heures, transmissions), qui passent dans une archive gardée 3 ans (Paramètres → Journal
  des actions → « Consulter l'archive paie », consultation tracée). Le serveur applique ces durées au
  démarrage puis toutes les heures, et retire en même temps de la file d'envoi les envois réussis ou simulés
  de plus d'un an (un échec non classé reste jusqu'à son traitement) ; une ligne `journal.conservation` par
  jour en fait le bilan. Au premier démarrage de cette version, les anciennes lignes sont expurgées (numéros
  de passeport, CSV importés, natures d'absence, vaccins…). Les sauvegardes gardent l'état de la base au
  moment de la copie : les copies quotidiennes et « avant-réinitialisation » disparaissent avec leur
  rotation (14 copies par type, soit deux semaines pour les copies quotidiennes), mais la copie
  « avant-migration » faite à ce démarrage, qui contient l'ancien journal non expurgé, resterait jusqu'à
  14 migrations ultérieures : la supprimer une fois la mise à jour vérifiée (« Mise à jour », étape 6).
- Demande d'accès d'un salarié à ses données (RGPD, article 15) : fiche du collaborateur → « Exporter ses
  données » (fichier JSON : toutes les tables qui le concernent et le journal des actions le concernant) ;
  l'export est tracé. Le salarié peut aussi télécharger lui-même ses données depuis son espace (sans le
  journal, qui cite d'autres personnes : à relire avant de le lui remettre).
- Mise en service des envois (premier démarrage avec `KEYSTONE_URL`) : les verdicts Go / No Go calculés
  en simulation n'ont jamais été reçus ; Cursus envoie alors le verdict actuel de chaque ressource des
  chantiers en cours ou à venir, un message chacune. `KEYSTONE_URL` ne porte jamais d'identifiants
  (`utilisateur:motdepasse@`) : le jeton passe par `KEYSTONE_TOKEN`.
- E-mails (`CURSUS_MAIL_FROM`) : Paramètres → Envois, filtre « E-mails », montre chaque e-mail (envoyé avec
  l'accusé de Microsoft 365, en échec avec l'erreur) ; mêmes nouvelles tentatives, relance et classement que
  pour Keystone (journal : `email.echec`). Causes et remèdes : `docs/EMAILS.md`, « Suivi et incidents ».
  Le récapitulatif quotidien part à partir de 7 h (heure de la machine, d'où le fuseau de Paris) ; les relevés
  d'heures des intérimaires dès que les feuilles de la semaine sont validées.
- Changer `CURSUS_SECRET` (fuite supposée) : même procédure ; toutes les sessions sont fermées.
- Secret client Microsoft : le renouveler avant sa date d'expiration (`docs/CONNEXION-MICROSOFT.md`,
  section 3) ; expiré, il bloque toutes les connexions Microsoft, et les e-mails s'il sert aussi à leur envoi.
