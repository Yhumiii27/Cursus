# Sauvegarde et restauration de Cursus

Destinataire : le service informatique, qui exploite Cursus sur la machine louée chez l'hébergeur
(France ou Union européenne) : installation, mises à jour, surveillance des sauvegardes.

Les exemples supposent l'installation décrite dans `docs/DEPLOIEMENT.md` : code dans `/opt/cursus`,
compte système `cursus`, service `cursus.service`, variables dans `/etc/cursus/cursus.env`, base dans
`/var/lib/cursus/cursus.db`. Adaptez les chemins si l'installation diffère.

## En bref

- Toutes les données de Cursus tiennent dans **un seul fichier SQLite** (`CURSUS_DB`).
- `npm run backup` en fait une copie **à chaud** (sans arrêter le serveur), vérifiée, et ne garde que
  les 14 copies les plus récentes. Elle est lancée **chaque nuit par un timer systemd**.
- Une copie est aussi faite **automatiquement** avant une migration de la base (nouvelle version) et
  avant la réinitialisation de la démonstration.
- Les copies partent **chiffrées hors de la machine** (restic), chez un hébergeur en France ou dans l'UE,
  sur un stockage où la machine peut ajouter des copies mais pas les effacer.
- Restaurer : arrêter le service, `npm run restore -- <fichier>`, redémarrer.
- **Serveur PostgreSQL commun** (`DATABASE_URL`) : la base est sauvegardée par Matrix (`pg_dump` du schéma `cursus`),
  les pièces justificatives par une copie restic chiffrée de leur volume, prise juste après (section 10).
- **Tester une restauration chaque trimestre**, et après toute modification de cette procédure.

## 1. Ce qui est sauvegardé

| Élément | Emplacement | Sauvegarde |
| --- | --- | --- |
| Base Cursus : fiches, contrats, formations, habilitations, visites médicales, vaccinations, passeports et visas, feuilles de temps, absences, compteurs, entretiens, plan de formation, journal des actions, paramètres | `CURSUS_DB` (et ses fichiers `-wal` / `-shm`) | `npm run backup` |
| Pièces justificatives (lot 6, si l'administrateur RH les a activées) : attestations, titres d'habilitation signés, justificatifs d'absence, copies de documents déclarés | `pieces/` à côté de la base (`CURSUS_PIECES_DIR`), un fichier par pièce sous un nom aléatoire, empreinte SHA-256 en base | avec la base, voir ci-dessous |
| Clé de chiffrement des pièces (`CURSUS_PIECES_KEY`, lot 8) | fichier d'environnement du service, jamais en base | **non** : à conserver dans le coffre-fort de mots de passe, avec le mot de passe de restic ; **perdue, les pièces chiffrées sont perdues** |
| Clé de signature des sessions | dans la base si `CURSUS_SECRET` n'est pas défini (retirée de la base au démarrage dès qu'elle l'est ; les copies antérieures la gardent) | avec la base |
| Configuration : `CURSUS_SECRET`, `KEYSTONE_API_KEY`, adresses Keystone et Sage | fichier d'environnement du service | **non** : à conserver dans le coffre-fort de mots de passe du service informatique |
| Code de l'application | dépôt Git, version déployée | **non** : redéployable ; noter la version (commit) en service |
| Journaux du serveur | journald | **non** |

**Pièces justificatives** (`server/src/pieces-sauvegarde.ts`) : chaque copie de la base emporte les fichiers qu'elle
désigne. Un fichier de pièce ne change pas une fois écrit, sauf au chiffrement d'une pièce déposée en clair (section 10 :
`npm run pieces:chiffrer` remplace alors sa copie en clair, la sauvegarde suivante à défaut) : il est copié une seule fois
dans `pieces-<base>/` du dossier des copies (`backups/pieces-cursus/`, en `700`, fichiers en `600`), avant que la copie de la base n'apparaisse sous son nom
définitif ; après la rotation, un fichier que plus aucune copie conservée ne désigne en est retiré. Ce dossier part avec
les copies dans la copie externe (section 5 : restic sauvegarde tout le dossier des copies). `npm run backup` affiche le
nombre de pièces désignées et copiées, et signale (sans échouer) un fichier absent du dossier des pièces. La
restauration (section 7) remet dans le dossier des pièces les fichiers que désigne la copie restaurée et qui y manquent,
pris à côté du fichier restauré (copie rapatriée de la copie externe avec son dossier `pieces-cursus/`), sinon dans le
dossier des copies. Les pièces confiées plus tard à l'espace documentaire de l'entreprise (GED) sont sauvegardées par lui.

**Les copies sont aussi sensibles que la base** : elles contiennent des données de santé et de paie
(catégories particulières au sens de l'article 9 du RGPD). En conséquence :

- le dossier des copies est créé en `700` et chaque copie en `600` dès sa création, pendant l'écriture
  comprise (lecture par le seul compte `cursus`) ; la base elle-même est ramenée en `600`, dans un dossier en `700`, à
  chaque démarrage du serveur (`docs/DEPLOIEMENT.md`, « Protection des données sur le disque ») ;
- le disque qui porte la base et les copies locales est chiffré (même section) ;
- toute copie qui quitte la machine est chiffrée **avant** l'envoi ;
- l'accès aux copies et à la clé de chiffrement est limité aux administrateurs nommés ;
- une donnée effacée dans Cursus subsiste dans les copies jusqu'à leur expiration : la durée de
  conservation des copies (section 5) est à reporter dans le registre des traitements, avec le DPO. C'est le cas des
  dossiers anonymisés à la fin de leur durée de conservation (Paramètres → Conservation des dossiers) : restaurer une
  copie antérieure à l'anonymisation fait revenir le dossier nominatif, à anonymiser de nouveau aussitôt après la
  restauration (la liste des dossiers échus le propose de nouveau).
- après la purge des données fictives (`npm run purge-demo`, `docs/DEPLOIEMENT.md`, « Passage de la démonstration à la
  production »), toutes les copies antérieures (locales avec leur miroir `pieces-cursus/`, distantes restic, pg_dump de
  Matrix) contiennent encore la démonstration : `--supprimer-copies-demo` retire les copies locales, sauf la copie
  `avant-purge` ; les instantanés restic antérieurs à la date de la purge sont oubliés (`restic forget`), et Matrix
  marque ses pg_dump antérieurs comme non restaurables en production. Aucune de ces copies ne se restaure sur la base de
  production : elle y ramènerait les 24 salariés fictifs et leurs matricules EMP-0001 à EMP-0024.

## 2. `npm run backup`

1. **Copie à chaud** par `VACUUM INTO` : SQLite lit un instantané cohérent de la base, y compris les
   écritures encore dans le journal WAL, et écrit un fichier autonome et compacté. Les utilisateurs ne
   sont pas bloqués ; inutile d'arrêter le serveur.
2. La copie est écrite sous un nom provisoire (`….db.partiel`), **vérifiée** (`PRAGMA integrity_check`),
   puis renommée : une sauvegarde interrompue ne laisse jamais de fichier d'apparence valide. Un
   `.partiel` abandonné (arrêt brutal ou coupure pendant la copie) est supprimé par la sauvegarde
   suivante, une heure au moins après sa dernière écriture.
3. **Rotation** : seules les `CURSUS_BACKUP_KEEP` copies les plus récentes de chaque type sont gardées
   (voir le tableau ci-dessous). La copie qui vient d'être faite n'est jamais supprimée, même si
   l'horloge a reculé. Les autres fichiers du dossier ne sont jamais touchés.
4. **Compte rendu** sur la sortie standard ; en cas d'échec, message sur la sortie d'erreur et **code
   de sortie 1** (base introuvable, disque plein, copie endommagée, variable invalide).

```
$ npm run backup
Sauvegarde de /var/lib/cursus/cursus.db
  Copie : /var/lib/cursus/backups/cursus-2026-10-10T021500Z.db
  2,4 Mo · 24 collaborateurs · dernière action du journal : 09/10/2026 18:42
  Intégrité vérifiée · durée 85 ms
  Rotation : 14 copies conservées (14 au plus), 1 supprimée
    − /var/lib/cursus/backups/cursus-2026-09-26T021500Z.db
  Espace libre : 41,2 Go
```

| Fichier | Créé par |
| --- | --- |
| `cursus-2026-10-10T021500Z.db` | `npm run backup` (planifié ou manuel) |
| `cursus-…Z-avant-migration.db` | le démarrage d'une nouvelle version qui doit modifier une base existante ou y enregistrer des migrations nommées (ou `npm run comptes` / `npm run reset-demo` lancés avant lui) |
| `cursus-…Z-avant-reinitialisation.db` | `npm run reset-demo` et le bouton « Réinitialiser les données » (démonstration) |
| `cursus-…Z-avant-restauration.db` | `npm run restore` (état remplacé, pour pouvoir revenir en arrière) |
| `cursus-…Z-avant-purge.db` | `npm run purge-demo` (passage de la démonstration à la production) : dernier état de la démonstration, pièces comprises dans le miroir ; à garder jusqu'à la fin de la recette de janvier 2027, puis à supprimer à la main (il ne contient que des données fictives, mais ne doit jamais être restauré en production) |
| `cursus-…Z-avant-restauration-brut/` | `npm run restore -- … --force` sur une base illisible : fichiers copiés tels quels, hors rotation |

L'horodatage est en **UTC** (suffixe `Z`) pour rester dans l'ordre aux changements d'heure. Le préfixe
est le nom du fichier de base (`cursus` pour `cursus.db`) : plusieurs bases peuvent partager un dossier
**à condition que leurs fichiers portent des noms différents**. Deux bases `cursus.db` (production et
recette, par exemple) doivent avoir chacune leur `CURSUS_BACKUP_DIR` : sinon la rotation et la liste
des copies les confondent.

| Variable | Effet | Défaut |
| --- | --- | --- |
| `CURSUS_DB` | Base à sauvegarder | `data/cursus.db` du dossier du code (un chemin relatif part du dossier de lancement) |
| `CURSUS_BACKUP_DIR` | Dossier des copies | `backups/` à côté de la base (`data/backups`) ; à côté de sa cible si `CURSUS_DB` est un lien symbolique |
| `CURSUS_BACKUP_KEEP` | Copies gardées **par type** (la rotation compte des copies, pas des jours) | `14` ; `0` = aucune suppression |

Espace disque : une copie pèse à peu près la taille de la base ; prévoir au moins
`4 × CURSUS_BACKUP_KEEP` copies. Si la machine a un second disque, y placer `CURSUS_BACKUP_DIR`.

Base placée sur un volume de données par un lien symbolique (`CURSUS_DB` est un lien) : les commandes
suivent le lien. Les copies vont par défaut à côté du fichier réel, et la restauration remplace ce
fichier en laissant le lien en place. Définir alors `CURSUS_BACKUP_DIR` pour garder les copies à
l'emplacement attendu par la copie externe.

## 3. Copies automatiques

- **Avant une migration** : au démarrage, si la nouvelle version doit ajouter des tables ou des colonnes
  à une base existante, ou en convertir les données, le serveur fait une copie `avant-migration`
  (une seule par démarrage) puis migre. **Si cette copie échoue, le serveur refuse de démarrer** : lire
  `journalctl -u cursus`, libérer de l'espace ou corriger `CURSUS_BACKUP_DIR`, puis redémarrer.
  Une base neuve, ou déjà à jour sans nouvelle migration nommée, ne produit aucune copie. Chaque migration nommée
  n'est faite qu'une fois par base (table `migrations`) ; une version qui en apporte fait toujours sa copie avant
  d'enregistrer leurs noms, même si elles ne changent rien d'autre, et le chemin de la copie est enregistré avec eux.
  Une base qu'une version plus récente a migrée est refusée par une version plus ancienne (« restaurer la copie
  avant-migration ») : le message nomme la copie faite au début de cette mise à jour, celle qu'il faut restaurer pour
  revenir en arrière ; s'il n'en nomme aucune (copie supprimée depuis), restaurer la sauvegarde faite juste avant la
  mise à jour (section 9), jamais une copie plus ancienne : les saisies faites depuis seraient perdues.
- **Avant la réinitialisation de la démonstration** (`npm run reset-demo`, bouton de l'écran
  Paramètres) : si la copie échoue, rien n'est effacé. Le message de confirmation donne le nom de la copie.

## 4. Planification : timer systemd

**Choix retenu** : un timer systemd lance `npm run backup` chaque nuit, plutôt qu'une minuterie dans le
serveur. Il est indépendant du processus serveur (un serveur arrêté ou bloqué n'empêche pas la
sauvegarde), un échec est visible comme une unité en échec (`systemctl --failed`, alerte `OnFailure`),
`Persistent=true` rattrape une sauvegarde manquée si la machine était éteinte, et la copie hors de la
machine s'enchaîne dans la même unité. C'est l'outil que la supervision du service informatique sait déjà suivre.

Les trois unités ci-dessous sont livrées, identiques, dans le dossier `deploy/` du code : `deploy/cursus-sauvegarde.service`,
`deploy/cursus-sauvegarde.timer` et `deploy/cursus-alerte@.service` (adresse d'alerte à remplacer) :

```bash
sudo install -m 644 /opt/cursus/deploy/cursus-sauvegarde.service /opt/cursus/deploy/cursus-sauvegarde.timer \
  /opt/cursus/deploy/cursus-alerte@.service /etc/systemd/system/
```

`/etc/systemd/system/cursus-sauvegarde.service` :

```ini
[Unit]
Description=Cursus : sauvegarde de la base
OnFailure=cursus-alerte@%n.service

[Service]
Type=oneshot
User=cursus
Group=cursus
WorkingDirectory=/opt/cursus
EnvironmentFile=/etc/cursus/cursus.env
UMask=0077
Nice=10
IOSchedulingClass=idle
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/backup.ts
# Copie chiffrée hors de la machine (section 5), lancée seulement si la sauvegarde a réussi.
# Préfixe + : sous root, car ses secrets ne doivent pas être lisibles par le compte du serveur web.
ExecStartPost=+/usr/local/sbin/cursus-copie-externe
```

`/etc/systemd/system/cursus-sauvegarde.timer` :

```ini
[Unit]
Description=Cursus : sauvegarde quotidienne de la base

[Timer]
OnCalendar=*-*-* 02:15:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

`/etc/systemd/system/cursus-alerte@.service` (à adapter à l'outil d'alerte habituel ; ici un e-mail,
qui suppose `mail` et un relais SMTP configurés) :

```ini
[Unit]
Description=Cursus : alerte d'échec de %i

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'systemctl status --no-pager --full %i | mail -s "[Cursus] échec : %i" informatique@exemple.fr'
```

Mise en service et contrôle :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cursus-sauvegarde.timer
systemctl list-timers cursus-sauvegarde.timer      # prochaine et dernière exécution
sudo systemctl start cursus-sauvegarde.service     # sauvegarde immédiate (essai)
journalctl -u cursus-sauvegarde.service -n 20      # comptes rendus
```

`CURSUS_DB` (et le cas échéant `CURSUS_BACKUP_DIR`, `CURSUS_BACKUP_KEEP`) doivent être définis dans
`/etc/cursus/cursus.env`, le même fichier que le service Cursus. La sauvegarde doit tourner sous le
compte du service (`User=cursus`) : sous `root`, SQLite pourrait laisser des fichiers `-wal` / `-shm`
appartenant à `root`, que le serveur ne pourrait plus ouvrir.

**Fréquence** : une copie par nuit, soit au plus une journée de saisies perdue. Pour réduire cette perte,
ajouter des passages (par exemple une seconde ligne `OnCalendar=Mon..Fri 12:30`) et augmenter
`CURSUS_BACKUP_KEEP` d'autant.

**Variante cron** (si systemd n'est pas disponible) : la sortie standard est jetée pour que cron
n'envoie un e-mail qu'en cas d'erreur.

```cron
# /etc/cron.d/cursus-sauvegarde : tous les jours à 2 h 15 ; la sauvegarde sous le compte du service,
# puis la copie externe sous root (section 5)
MAILTO=informatique@exemple.fr
15 2 * * * root runuser -u cursus -- sh -c 'cd /opt/cursus && set -a && . /etc/cursus/cursus.env && set +a && exec /usr/bin/node --disable-warning=ExperimentalWarning server/src/backup.ts' >/dev/null && /usr/local/sbin/cursus-copie-externe
```

## 5. Copie hors de la machine, chiffrée

Une copie restée sur la machine ne protège ni contre la perte de la machine, ni contre un incident chez
l'hébergeur, ni contre un rançongiciel. Exigences :

- **chiffrement sur la machine, avant l'envoi** : le stockage distant ne voit jamais les données en clair ;
- stockage **en France ou dans l'UE**, dans un autre centre de données que la machine, de préférence
  chez un autre prestataire ;
- **la machine ne peut qu'ajouter des copies** : ses identifiants n'ont pas le droit de supprimer
  définitivement. La purge des copies expirées se fait depuis un poste d'administration, avec d'autres
  identifiants jamais stockés sur la machine. Une machine compromise ne peut ainsi pas effacer les copies
  distantes ;
- la copie externe tourne **sous root, pas sous le compte `cursus`** du serveur web : une faille de
  l'application ne donne accès ni au mot de passe de chiffrement, ni aux identifiants du stockage ;
- le **mot de passe de chiffrement** est conservé hors de la machine (coffre-fort de mots de passe du
  service informatique, et une copie sous scellé) : sans lui, les copies sont irrécupérables.

Outil recommandé : **restic** (paquet `restic` de Debian / Ubuntu) : chiffrement authentifié AES-256,
déduplication (une copie quotidienne ne coûte que les pages modifiées), stockage S3 ou serveur REST.

Stockage en ajout seul, au choix :

- **serveur REST de restic** (`rest-server --append-only`) sur une machine d'un autre prestataire :
  la machine Cursus peut ajouter des copies, pas en supprimer ;
- **stockage objet S3** avec **versionnage** activé (et, si l'hébergeur le propose, verrouillage d'objets) :
  la clé de la machine peut lire, écrire et supprimer des objets (restic retire ses fichiers de verrou ;
  avec le versionnage, une suppression ne fait que masquer l'objet), mais **pas** supprimer de versions
  ni modifier la configuration du compartiment (versionnage, cycle de vie, règles d'accès). Une règle
  de cycle de vie efface les versions masquées au bout de 30 jours : à ajouter à la durée de
  conservation déclarée au registre des traitements.

Mise en place, une fois :

```bash
sudo sh -c 'umask 077; openssl rand -base64 32 > /etc/cursus/restic.pass'
sudoedit /etc/cursus/restic.env          # contenu ci-dessous
sudo chown root:root /etc/cursus/restic.pass /etc/cursus/restic.env
sudo chmod 600 /etc/cursus/restic.pass /etc/cursus/restic.env
sudo sh -c 'set -a; . /etc/cursus/restic.env; set +a; restic init'
```

```sh
# /etc/cursus/restic.env (root:root, 600) : identifiants en ajout seul
RESTIC_REPOSITORY=s3:https://<point d'accès S3 de l'hébergeur>/cursus-sauvegardes
RESTIC_PASSWORD_FILE=/etc/cursus/restic.pass
# Cache de restic hors du dossier personnel du compte cursus : sous systemd, HOME reste le sien.
RESTIC_CACHE_DIR=/var/cache/cursus-restic
AWS_ACCESS_KEY_ID=<identifiant sans droit de suppression des versions>
AWS_SECRET_ACCESS_KEY=<secret>
```

Avec un serveur REST : `RESTIC_REPOSITORY=rest:https://<compte>:<mot de passe>@<serveur>/cursus`, sans
les lignes `AWS_…`.

Reporter aussitôt le contenu de `/etc/cursus/restic.pass` dans le coffre-fort de mots de passe.

`/usr/local/sbin/cursus-copie-externe` (`root:root`, `chmod 755` ; livré dans `deploy/cursus-copie-externe` :
`sudo install -o root -g root -m 755 /opt/cursus/deploy/cursus-copie-externe /usr/local/sbin/`) :

```sh
#!/bin/sh
# Copie chiffrée des sauvegardes de Cursus hors de la machine (restic), lancée sous root.
# Ajout seul : la purge des copies expirées se fait depuis un poste d'administration.
set -eu
set -a; . /etc/cursus/restic.env; set +a
restic backup --quiet --tag cursus /var/lib/cursus/backups
```

Purge des copies expirées, chaque mois, **depuis un poste d'administration** et avec des identifiants
autorisés à supprimer (pour un serveur REST : sur le serveur de stockage lui-même, hors mode ajout seul) :

```bash
# Conservation distante : 14 quotidiennes, 8 hebdomadaires, 12 mensuelles (à valider avec le DPO).
restic forget --tag cursus --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
```

Limite : root sur la machine peut lire le mot de passe de chiffrement, donc relire l'historique distant
(sans pouvoir l'effacer). Pour s'en protéger aussi, alternative sans restic : chiffrer chaque copie avec
`age` vers une clé publique (la clé privée reste hors de la machine), puis l'envoyer avec `rclone` ou
`rsync` vers un stockage en ajout seul.

## 6. Surveillance

- **Échec** : l'unité `cursus-sauvegarde.service` passe en échec et déclenche `cursus-alerte@` ;
  `systemctl --failed` la liste.
- **Fraîcheur** (détecte aussi un timer désactivé) : la dernière copie planifiée doit avoir moins de 26 h.
  Sonde pour l'outil de supervision ; code de sortie 2 (critique) attendu par Nagios, Icinga, Centreon… :

  ```sh
  #!/bin/sh
  # Fraîcheur des sauvegardes de Cursus : 0 = OK, 2 = CRITIQUE.
  if sudo -n -u cursus find /var/lib/cursus/backups -name 'cursus-*Z.db' -mmin -1560 | grep -q .; then
    echo "OK : sauvegarde de Cursus de moins de 26 h"
  else
    echo "CRITIQUE : aucune sauvegarde de Cursus depuis 26 h"; exit 2
  fi
  ```

  Le dossier des copies est en `700` : la recherche doit tourner sous le compte `cursus` (ou root).
  Accorder au compte de l'agent de supervision une règle sudo limitée à cette seule commande `find`.

- **Espace disque** : la dernière ligne du compte rendu donne l'espace libre du dossier des copies.
- **Copie externe**, sous root avec `/etc/cursus/restic.env` : `restic snapshots --tag cursus --latest 1`
  (date de la dernière copie distante) et, chaque mois, `restic check --read-data-subset=10%`.

## 7. Restaurer, pas à pas

À faire après accord du service RH (les saisies postérieures à la copie seront perdues), sous le compte
du service et avec ses variables d'environnement. Les commandes ci-dessous appellent directement
`node server/src/restore.ts`, équivalent de `npm run restore --` qui ne dépend pas de npm pour un compte système.

1. **Choisir la copie.** Sans argument, la commande liste les copies locales, les plus récentes d'abord :

   ```bash
   cd /opt/cursus
   sudo -u cursus sh -c 'set -a; . /etc/cursus/cursus.env; set +a; node server/src/restore.ts'
   ```

   Copie absente de la machine : la récupérer depuis la copie externe, sous root et dans un dossier
   fermé aux autres comptes (`sudo install -d -m 700 /var/tmp/restauration`), par exemple
   `sudo sh -c 'set -a; . /etc/cursus/restic.env; set +a; restic restore latest --tag cursus --target /var/tmp/restauration'`
   (le fichier est alors sous `/var/tmp/restauration/var/lib/cursus/backups/`), puis
   `sudo chown -R cursus:cursus /var/tmp/restauration`.
2. **Arrêter le service** et suspendre les sauvegardes planifiées pendant l'opération :
   `sudo systemctl stop cursus cursus-sauvegarde.timer`.
3. **Restaurer** :

   ```bash
   sudo -u cursus sh -c 'set -a; . /etc/cursus/cursus.env; set +a; node server/src/restore.ts /var/lib/cursus/backups/cursus-2026-10-10T021500Z.db'
   ```

   La commande vérifie l'intégrité du fichier et qu'il s'agit d'une base Cursus, copie la base actuelle
   (`…-avant-restauration.db`), remplace la base et supprime ses fichiers `-wal` / `-shm`. Elle remet ensuite en place
   les pièces justificatives que désigne la copie (section 1) ; « Attention : … introuvable » nomme le nombre de
   fichiers absents des sauvegardes : rapatrier aussi le dossier `pieces-cursus/` de la copie externe, puis relancer.
4. **Lire le compte rendu** : nombre de collaborateurs et date de la dernière action du journal doivent
   correspondre à l'état attendu.
5. **Redémarrer** : `sudo systemctl start cursus cursus-sauvegarde.timer`, puis ouvrir Cursus et
   contrôler quelques fiches.
   Une copie faite par une version plus ancienne est migrée au démarrage (avec sa copie `avant-migration`).
6. **Prévenir le service RH** : les saisies faites après l'heure de la copie sont à refaire. Les feuilles
   de temps transmises à Sage Paie ou les décisions envoyées à Keystone après cette heure apparaissent de
   nouveau comme non transmises : vérifier avant toute nouvelle transmission, pour éviter un doublon.
7. **Revenir en arrière** si besoin : restaurer de la même façon le fichier `…-avant-restauration.db`.

Refus possibles (la base n'est alors pas modifiée, code de sortie 1) :

| Message | Que faire |
| --- | --- |
| « Le serveur Cursus semble démarré » | Arrêter le service. Le serveur écrit `cursus.db.pid` au démarrage et le retire à l'arrêt ; un verrou laissé par un arrêt brutal est ignoré si le processus n'existe plus, si son numéro a été réattribué à un autre processus ou si la machine a redémarré. En cas de doute sur un verrou périmé : vérifier avec `systemctl status cursus`, puis ajouter `--force`. |
| « n'est pas une base SQLite valide » / « n'est pas une base Cursus » / « Base endommagée » | Choisir une autre copie : celle-ci est inutilisable. |
| « La base actuelle n'a pas pu être sauvegardée » | La base en place est illisible (souvent la raison de la restauration) : relancer avec `--force`, ses fichiers sont alors copiés tels quels dans `…-avant-restauration-brut/`. |

Ne restaurer que des fichiers produits par `npm run backup` (ou par les copies automatiques) : une simple
copie du fichier de base faite serveur démarré peut être incomplète sans son fichier `-wal`.

Le même verrou empêche deux serveurs d'utiliser la même base : un second serveur lancé avec le
`CURSUS_DB` d'un serveur en service (essai manuel, ancienne version encore active) s'arrête aussitôt,
avec le code 1 et le message « Démarrage impossible : Un autre serveur Cursus utilise déjà cette base »,
sans ouvrir la base. Une instance d'essai utilise sa propre base (section 8).

## 8. Test de restauration périodique

Chaque trimestre, et après toute modification de cette procédure, sur une autre machine ou dans un dossier
temporaire, **jamais sur la base en service** :

```bash
# 1. Récupérer la dernière copie externe, sous root (vérifie aussi le chiffrement et le mot de passe),
#    dans un dossier fermé aux autres comptes.
sudo install -d -m 700 -o cursus -g cursus /var/tmp/essai-restauration
sudo sh -c 'set -a; . /etc/cursus/restic.env; set +a; restic restore latest --tag cursus --target /var/tmp/essai-restauration'
sudo chown -R cursus:cursus /var/tmp/essai-restauration
# 2. La restaurer vers une base d'essai, sous le compte du service (le fichier d'environnement de
#    production n'est pas chargé).
cd /opt/cursus
sudo -u cursus env CURSUS_DB=/var/tmp/essai-restauration/cursus.db \
  node server/src/restore.ts /var/tmp/essai-restauration/var/lib/cursus/backups/cursus-<date>Z.db
```

Le test est réussi si la commande se termine sans erreur et que le compte rendu donne le nombre de
collaborateurs attendu et une dernière action du journal datée de la veille. Pour un contrôle complet,
démarrer une instance d'essai sur cette base, toujours sous le compte du service :

```bash
sudo -u cursus env CURSUS_DB=/var/tmp/essai-restauration/cursus.db CURSUS_API_PORT=3299 \
  CURSUS_HOST=127.0.0.1 NODE_ENV=production node server/src/index.ts
```

**Attention** : sans `CURSUS_DEMO=0`, cette instance est en mode démonstration, donc l'espace RH s'ouvre
sans mot de passe, sur les données réelles. Elle n'écoute que sur la machine : la consulter par un tunnel
SSH (`ssh -L 3299:127.0.0.1:3299 <machine>`), puis l'arrêter (Ctrl+C) dès le contrôle fait.

Supprimer ensuite le dossier d'essai (`sudo rm -rf /var/tmp/essai-restauration` : il contient des données
personnelles) et consigner le test dans le registre d'exploitation : date, copie testée, durée de la
restauration, résultat, nom de l'opérateur.

Les tests automatiques (`npm test`, fichier `tests/sauvegarde.test.ts`) vérifient à chaque version la
copie, la rotation, la restauration, les refus et les copies automatiques ; ils ne remplacent pas ce
test, qui valide aussi la copie externe, le mot de passe de chiffrement et la procédure.

## 9. Avant une mise à jour de Cursus

Lancer `sudo systemctl start cursus-sauvegarde.service` et vérifier son compte rendu avant d'installer la
nouvelle version : la copie `avant-migration` faite au redémarrage s'y ajoute, mais seulement si la base
doit être modifiée ou recevoir de nouvelles migrations nommées. C'est aussi la sauvegarde à restaurer pour
revenir à la version précédente si la copie `avant-migration` a disparu depuis.

## 10. Serveur PostgreSQL commun EPC2I (`DATABASE_URL`)

Avec `DATABASE_URL`, `npm run backup` et `npm run restore` refusent de tourner : la base n'est plus un fichier. Deux
choses sont alors à sauvegarder, à la même heure : le schéma `cursus` du serveur commun, et le volume des pièces
justificatives (fichiers hors de la base, `/data/pieces` dans le conteneur, `CURSUS_PIECES_DIR` sinon). Le serveur et
sa sauvegarde relèvent de Matrix (`infra/postgres/README.md` du dépôt Matrix, « Sauvegarde et restauration ») ; ce qui
suit en est la part de Cursus, à valider avec l'exploitant du serveur et le DPO.

### Qui, quand, où

| Quoi | Qui | Quand | Où |
| --- | --- | --- | --- |
| Schéma `cursus` (toutes les données sauf les fichiers des pièces) | exploitant du serveur commun : tâche planifiée Coolify `sh /opt/epc2i/sauvegarde/sauvegarder.sh` (rôle `epc2i_sauvegarde`, membre de `pg_read_all_data`) | chaque nuit à 2 h 15 (proposition de Matrix) | `cursus.dump` du dossier daté du volume `epc2i_sauvegardes`, 14 jours ; copie hors du serveur chiffrée (question P-08 de Matrix) |
| Volume des pièces justificatives | service informatique (exploitant de Cursus) : copie restic ci-dessous | juste après la sauvegarde du schéma, chaque nuit (2 h 45 par exemple) | dépôt restic hors de la machine, en France ou dans l'UE, en ajout seul (section 5) |
| `CURSUS_PIECES_KEY`, `CURSUS_SECRET`, mot de passe restic | service informatique | à chaque changement | coffre-fort de mots de passe, jamais avec les copies |

Un fichier de pièce n'est jamais supprimé ni renommé tant que la base le désigne (nom aléatoire, empreinte en base),
et son contenu ne change qu'une fois, au chiffrement d'une pièce déposée en clair (ci-dessous) : une copie du volume
prise **après** le `pg_dump` contient tous les fichiers que ce dump désigne (une pièce déposée entre les deux y figure
en plus, sans dommage). L'ordre inverse perdrait les pièces déposées entre la copie du volume et le dump.

### Chiffrement des pièces au repos (lot 8)

Avant d'activer les pièces justificatives en production (Paramètres → Pièces justificatives, après avis du DPO) :

1. Générer la clé : `openssl rand -hex 32`, la ranger dans le coffre-fort, puis la poser dans les variables du service
   (`CURSUS_PIECES_KEY`, onglet « Environment Variables » de Coolify, jamais « Build Variable ») et redéployer. Sans
   elle, Cursus refuse en production d'activer les pièces dans le dossier local, et refuse chaque envoi si elles
   l'étaient déjà (règle de `server/src/config.ts`, avertissement au démarrage).
2. Chaque nouveau fichier est alors chiffré par Cursus (AES-256-GCM, `server/src/pieces-chiffrement.ts`) et déchiffré à
   la consultation ; l'empreinte SHA-256 et la taille enregistrées restent celles du document d'origine, vérifiées après
   déchiffrement.
3. Pièces déposées avant la clé (installation qui les avait déjà activées) : `npm run pieces:chiffrer -- --apercu`, puis
   `npm run pieces:chiffrer`, avec l'environnement du service (terminal du conteneur sous Coolify), une fois Cursus
   redémarré avec la clé. Le service peut rester en marche ; la commande peut être relancée sans dommage. Elle ne touche
   jamais un fichier dont l'empreinte ne correspond plus (preuve gardée telle quelle, signalée). En SQLite, elle
   remplace aussi par le fichier chiffré la copie en clair de chaque pièce dans le dossier commun des sauvegardes
   (`pieces-cursus/`, section 5) ; à défaut (dossier déplacé), la sauvegarde suivante le fait. Seuls les instantanés
   **déjà emportés par restic** gardent leur version en clair, jusqu'à leur oubli par `restic forget --prune` (selon la
   conservation choisie, section 5) : à noter dans le registre d'exploitation, avec la date du chiffrement. Pour s'en
   défaire plus tôt : `restic forget` des instantanés antérieurs à cette date, puis `restic prune`.
4. La clé ne se change pas dans cette version : une nouvelle clé rendrait illisibles les fichiers chiffrés avec
   l'ancienne (`npm run pieces:verifier` les compte « illisibles »). Clé perdue : pièces chiffrées perdues.

Les copies de sauvegarde prises après le chiffrement (copie restic du volume ; en SQLite, dossier `pieces-cursus/` des
copies) emportent les fichiers **chiffrés tels quels** : une copie volée ne livre aucune pièce sans la clé, et la
restauration remet les fichiers à l'identique. Un fichier remis en clair par la restauration d'un instantané plus ancien
reste lisible ; `npm run pieces:chiffrer` le chiffre à nouveau (étape 3 de la restauration ci-dessous).

### Copie restic du volume des pièces

Sur l'hôte Coolify, sous root, avec le dépôt restic et le fichier `/etc/cursus/restic.env` de la section 5 (un dépôt
distinct de celui du serveur commun, ou le même avec l'étiquette `cursus-pieces`). Chemin du volume : celui que montre
l'onglet des volumes de l'application Cursus dans Coolify (`docker volume inspect <volume> --format '{{ .Mountpoint }}'`).

```sh
#!/bin/sh
# /usr/local/sbin/cursus-pieces-copie-externe : copie chiffrée des pièces justificatives de Cursus (serveur commun),
# lancée chaque nuit après la sauvegarde du schéma cursus par Matrix (sauvegarder.sh, 2 h 15).
set -eu
set -a; . /etc/cursus/restic.env; set +a
VOLUME=/var/lib/docker/volumes/<volume de Cursus>/_data
# Seulement si la sauvegarde du schéma de la nuit est faite (dossier daté du jour dans le volume epc2i_sauvegardes).
SAUVEGARDES=/var/lib/docker/volumes/<volume epc2i_sauvegardes>/_data
ls -d "$SAUVEGARDES/$(date +%Y-%m-%d)_"* >/dev/null 2>&1 || { echo "Pas de sauvegarde du schéma cursus cette nuit : copie des pièces reportée" >&2; exit 1; }
restic backup --tag cursus-pieces --host cursus "$VOLUME/pieces"
```

Planification : `45 2 * * * root /usr/local/sbin/cursus-pieces-copie-externe` (après les 2 h 15 de Matrix ; à décaler
si sa sauvegarde dure plus longtemps), échec signalé par la supervision comme en section 6. Conservation distante : celle
du dump du schéma (les deux se restaurent ensemble).

### Restaurer, avec contrôle des empreintes

1. Arrêter Cursus (Coolify : « Stop »), puis restaurer le schéma `cursus` selon la procédure de Matrix (`pg_restore` en
   `cursus_app`, `--schema=cursus --no-owner --no-privileges --single-transaction`, partage reposé, `droits.verifier()`).
2. Restaurer les pièces de la même nuit, dans un dossier fermé aux autres comptes, puis les remettre dans le volume :

   ```sh
   sudo install -d -m 700 /var/tmp/restauration-pieces
   sudo sh -c 'set -a; . /etc/cursus/restic.env; set +a; restic restore latest --tag cursus-pieces --target /var/tmp/restauration-pieces'
   # Fichiers copiés tels quels (chiffrés), sans écraser ceux déjà en place.
   sudo rsync -a --ignore-existing /var/tmp/restauration-pieces/<chemin du volume>/pieces/ <chemin du volume>/pieces/
   ```

   Le volume appartient au compte du service : au redémarrage, l'image le lui rend (`server/src/conteneur.ts`).
3. **Contrôle des empreintes**, dans le terminal de l'application (environnement du service, donc avec
   `CURSUS_PIECES_KEY`), avant de rouvrir Cursus aux utilisateurs : `npm run pieces:verifier`. Chaque fichier que
   désigne la base restaurée est lu, déchiffré et comparé à l'empreinte de son envoi. Attendu : « N fichiers conformes
   sur N ». Un fichier absent : prendre une copie restic plus récente (`restic snapshots --tag cursus-pieces`) ; altéré
   ou illisible : vérifier la clé, puis prendre une autre copie. Le contrôle d'intégrité horaire de Cursus (état
   « degrade » de `/api/health`) ne compare que les tailles (celle du document d'origine, plus l'en-tête du
   chiffrement quand le fichier le porte).
   Puis, si la clé est posée, `npm run pieces:chiffrer` : il note chiffrées les pièces dont le fichier l'est déjà (dump
   pris avant le chiffrement, restauré sur un volume déjà chiffré), et chiffre à nouveau les fichiers remis en clair
   (instantané restic pris avant le chiffrement). « aucune pièce à chiffrer » : rien n'était à reprendre. Un dernier
   `npm run pieces:verifier` doit alors répondre « N fichiers conformes sur N », sans « dont … en clair ».
4. Redémarrer Cursus, puis supprimer `/var/tmp/restauration-pieces` (données personnelles).

**Journal des changements et cache (lot 9).** Chaque instance de Cursus garde l'instantané en mémoire et le met à jour
d'une révision à l'autre par le journal des lignes changées (table `changements`), tant que l'« époque » de la base
reste la même. Un `pg_restore` qui recrée les tables (procédure ci-dessus, après `DROP SCHEMA cursus CASCADE`) change
l'époque de lui-même : elle compte l'identifiant interne (OID) de la table `revision`, que la restauration renouvelle.
Un **rechargement des données seules** (`pg_restore --data-only`, copie de tables d'un autre schéma, `COPY` à la main)
garde au contraire l'OID et remet l'ancienne époque : redémarrer alors toutes les instances, pour qu'elles relisent
tout. `npm run revision:epoque`, lancé dans le terminal de l'application (service en marche admis : une seule
écriture), change l'époque ; il ne dispense du redémarrage que les instances dont le cache compare l'époque (cache
incrémental du lot 9) : le cache qui n'a pour clé que la révision et le jour ne la lit pas. Sans cela, une instance
restée en service pourrait servir un instantané qui mêle l'état d'avant et celui d'après le rechargement. Le journal
lui-même se purge avec les tâches du quart d'heure (`server/src/purge-changements.ts`) : il garde au moins 20 000
révisions de changements et, sur PostgreSQL, au moins une heure, mesurée par les relevés de l'instance, qui repartent à
zéro à son démarrage (une instance ne purge donc qu'après une heure de marche) ; sur SQLite, une seule instance, la
purge n'attend pas. Une instance dont le cache est plus ancien relit tout.

Test de restauration : chaque trimestre, comme en section 8, sur un schéma d'essai d'un serveur d'essai (jamais le
serveur commun en service), avec `npm run pieces:verifier` comme critère de réussite.

### Disque de l'hôte : chiffrement à vérifier

Le chiffrement des pièces par Cursus ne couvre ni la base (dumps, fichiers du serveur PostgreSQL) ni les journaux.
Le disque de l'hôte Coolify qui porte le serveur commun, les volumes de Cursus et `epc2i_sauvegardes` doit donc être
chiffré au repos (option de l'hébergeur ou LUKS, `docs/DEPLOIEMENT.md`, « Protection des données sur le disque »).
**À vérifier et à noter** dans le registre d'exploitation avant la mise en service : ce n'est pas établi aujourd'hui pour
l'hôte Coolify (constat D6 du lot 8). La copie hors du serveur des dumps de Matrix doit être chiffrée de même (question
P-08 de Matrix).

