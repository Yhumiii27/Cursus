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
l'application dans Entra) : voir `docs/CONNEXION-MICROSOFT.md`.

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
  hébergement certifié HDS.
- **Nom de domaine** : un sous-domaine dédié (dans ce guide `cursus.example.fr`) dont les
  enregistrements DNS A / AAAA pointent vers la machine.

## Machine

- Debian 12 ou Ubuntu 24.04 LTS, 2 vCPU, 2 à 4 Go de mémoire, 20 Go de disque : SQLite n'exige
  aucun serveur de base de données.
- Mises à jour de sécurité automatiques :

  ```bash
  sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
  ```

- Fuseau horaire de Paris : la date du jour de Cursus (échéances, semaines, date de sortie des
  salariés) suit l'heure locale de la machine, souvent laissée en UTC chez l'hébergeur. Le service
  systemd pose aussi `TZ=Europe/Paris`.

  ```bash
  sudo timedatectl set-timezone Europe/Paris
  ```

- Accès SSH par clé uniquement (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`).
- Pare-feu : seuls SSH, HTTP (redirection et certificat) et HTTPS sont ouverts.

  ```bash
  sudo ufw default deny incoming
  sudo ufw allow OpenSSH
  sudo ufw allow 80,443/tcp
  sudo ufw enable
  ```

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
| `CURSUS_DB` | `/var/lib/cursus/cursus.db` |
| `CURSUS_SECRET` | 64 caractères aléatoires, propres à cette installation. La changer déconnecte tout le monde |
| `KEYSTONE_API_KEY` | clé aléatoire transmise à Keystone par un canal sûr. Sans elle, les routes Keystone répondent 503 |
| `CURSUS_OIDC_TENANT`, `CURSUS_OIDC_CLIENT_ID`, `CURSUS_OIDC_CLIENT_SECRET` | connexion Microsoft 365 : ID de l'annuaire (GUID), ID d'application et secret client relevés dans Entra (`docs/CONNEXION-MICROSOFT.md`). Noter la date d'expiration du secret |
| `CURSUS_PUBLIC_URL` | `https://cursus.example.fr` : adresse publique, sans chemin. URI de redirection à inscrire dans Entra : `https://cursus.example.fr/api/auth/microsoft/retour` |
| `CURSUS_OIDC_AUTORITE` | **jamais** : réservée aux tests automatiques, Cursus refuse de démarrer avec elle |
| `KEYSTONE_URL`, `KEYSTONE_TOKEN` | envois à Keystone : adresse de base de Keystone sur le réseau interne (`http://keystone.interne:8080`) et jeton convenu avec lui. Cursus refuse de démarrer avec l'adresse sans le jeton, ou avec des identifiants dans l'adresse. Sans adresse, les messages ne sont que tracés dans le journal |
| `SAGE_URL`, `SAGE_TOKEN`, `SAGE_DOSSIER` | envoi à Sage Paie, quand il sera livré |
| `CURSUS_DEMO`, `CURSUS_TODAY`, `CURSUS_INSECURE_COOKIE` | **jamais** sur ce serveur. La démonstration ouvre l'espace RH sans mot de passe : Cursus refuse de démarrer avec elle, et refuserait de toute façon (403) chaque requête relayée par le proxy |

Au démarrage, Cursus contrôle cette configuration. S'il manque une valeur obligatoire ou si un
réglage est dangereux, il refuse de démarrer, liste chaque problème dans le journal
(`journalctl -u cursus`) et sort avec le code 1. La connexion Microsoft 365 est facultative mais
entière : les quatre variables `CURSUS_OIDC_*` et `CURSUS_PUBLIC_URL` (en https), ou aucune.

## Service systemd

`/etc/systemd/system/cursus.service` :

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
# Date du jour à l'heure de Paris, quel que soit le fuseau de la machine.
Environment=TZ=Europe/Paris
ExecStart=/usr/bin/node server/src/index.ts
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

Le journal doit afficher `Cursus — API sur http://127.0.0.1:3210 (application servie)`, sans
« mode démonstration ». Une base vide reste vide : aucune donnée fictive n'est chargée. Tant
qu'aucun administrateur RH n'existe, il le rappelle : `Aucun administrateur RH : créez-le avec…`.

## Premier administrateur RH

Une installation vide n'a aucun compte. Le service informatique crée le premier administrateur RH
sur le serveur, en tant qu'utilisateur `cursus` ; la commande fonctionne service démarré ou arrêté.
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

L'administrateur RH crée ensuite les comptes des salariés et des autres membres du service RH
(gestionnaires RH) dans Paramètres → Comptes et accès. Chaque création est tracée dans le journal.

Recours : si plus aucun administrateur ne peut se connecter (mot de passe oublié, compte bloqué ou
désactivé, identité Microsoft recréée), relancer la même commande avec l'identifiant existant. Elle
rétablit le profil administrateur RH, réactive et débloque le compte et, pour un compte Cursus, affiche
un nouveau mot de passe provisoire ; pour un compte Microsoft, elle retire le rattachement à l'identité
Microsoft, rétabli à la connexion suivante (les sessions ouvertes de ce compte sont fermées).

Protection des comptes Cursus : mot de passe haché (scrypt), message d'échec identique quel que
soit l'identifiant, blocage du compte 15 minutes après 5 échecs, et refus (429) des tentatives d'une
adresse IP au-delà de 30 échecs en 15 minutes — un atelier entier peut sortir par une même adresse.
Chaque tentative est comptée dès son arrivée, avant la vérification du mot de passe : des requêtes
envoyées en même temps ne passent pas ces limites (une connexion réussie est rendue à l'adresse).
Connexions réussies et refusées sont tracées dans le journal, jamais les mots de passe ; le filtre
« Connexions » / « Opérations » de Paramètres → Journal les sépare des opérations RH.

## Reverse proxy HTTPS : Caddy (recommandé)

Caddy obtient et renouvelle seul le certificat (Let's Encrypt) et redirige HTTP vers HTTPS.

```bash
sudo apt install caddy
```

`/etc/caddy/Caddyfile` (`203.0.113.10` : adresse d'où Keystone appelle Cursus, à remplacer) :

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

Caddy n'a pas de limitation de débit sans module complémentaire : Cursus résume lui-même les appels
refusés faute de clé (une ligne de journal par minute), et la restriction d'adresse suffit à écarter
Internet.

```bash
sudo systemctl reload caddy
```

Caddy transmet `X-Forwarded-Proto` et `X-Forwarded-For` : Cursus, qui fait confiance au proxy
local (`CURSUS_TRUST_PROXY=loopback`), sait que la requête est en HTTPS et ajoute l'en-tête
`Strict-Transport-Security` (HSTS, un an).

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

## Vérifications après installation

```bash
curl -sI https://cursus.example.fr/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type'
curl -s https://cursus.example.fr/api/session                   # "demo":false, "user":null et, avec Microsoft 365, "microsoft":true
curl -s -o /dev/null -w '%{http_code}\n' http://cursus.example.fr/                       # 301 ou 308 vers HTTPS
curl -s -o /dev/null -w '%{http_code}\n' https://cursus.example.fr/api/integrations/keystone/v1/chantiers/X/go-no-go   # 403 hors de l'adresse de Keystone
```

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

4. Vérifications après installation (ci-dessus).
   Mise à jour vers la version qui suit les formalités de détachement (certificat A1 ou de la convention bilatérale,
   information écrite au-delà de 4 semaines) : les déplacements déjà partis sont réputés en règle au premier démarrage
   (journal : `migration.detachement`). Ceux à venir apparaissent « à faire » : le service RH saisit dès la mise à
   jour les formalités déjà obtenues (écran Voyages, dossier du déplacement : « Enregistrer l’obtention »), faute de
   quoi le Go / No Go transmis à Keystone reste en réserve jusqu'au départ, puis passe en No Go le jour du départ.
5. En cas de problème : revenir à la version précédente (`git checkout <version>`, `npm ci`,
   `npm run build`), restaurer la sauvegarde et redémarrer.

## Exploitation courante

- Surveillance : `https://cursus.example.fr/api/session` doit répondre 200 ; journal du service
  (`journalctl -u cursus`) et du proxy ; espace disque de `/var/lib/cursus`.
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
- Mise en service des envois (premier démarrage avec `KEYSTONE_URL`) : les verdicts Go / No Go calculés
  en simulation n'ont jamais été reçus ; Cursus envoie alors le verdict actuel de chaque ressource des
  chantiers en cours ou à venir, un message chacune. `KEYSTONE_URL` ne porte jamais d'identifiants
  (`utilisateur:motdepasse@`) : le jeton passe par `KEYSTONE_TOKEN`.
- Changer `CURSUS_SECRET` (fuite supposée) : même procédure ; toutes les sessions sont fermées.
- Secret client Microsoft : le renouveler avant sa date d'expiration (`docs/CONNEXION-MICROSOFT.md`,
  section 3) ; expiré, il bloque toutes les connexions Microsoft.
