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
- **Tester une restauration chaque trimestre**, et après toute modification de cette procédure.

## 1. Ce qui est sauvegardé

| Élément | Emplacement | Sauvegarde |
| --- | --- | --- |
| Base Cursus : fiches, contrats, formations, habilitations, visites médicales, vaccinations, passeports et visas, feuilles de temps, absences, compteurs, entretiens, plan de formation, journal des actions, paramètres | `CURSUS_DB` (et ses fichiers `-wal` / `-shm`) | `npm run backup` |
| Clé de signature des sessions | dans la base si `CURSUS_SECRET` n'est pas défini | avec la base |
| Configuration : `CURSUS_SECRET`, `KEYSTONE_API_KEY`, adresses Keystone et Sage | fichier d'environnement du service | **non** : à conserver dans le coffre-fort de mots de passe du service informatique |
| Code de l'application | dépôt Git, version déployée | **non** : redéployable ; noter la version (commit) en service |
| Journaux du serveur | journald | **non** |

**Les copies sont aussi sensibles que la base** : elles contiennent des données de santé et de paie
(catégories particulières au sens de l'article 9 du RGPD). En conséquence :

- le dossier des copies est créé en `700` et chaque copie en `600` dès sa création, pendant l'écriture
  comprise (lecture par le seul compte `cursus`) ;
- toute copie qui quitte la machine est chiffrée **avant** l'envoi ;
- l'accès aux copies et à la clé de chiffrement est limité aux administrateurs nommés ;
- une donnée effacée dans Cursus subsiste dans les copies jusqu'à leur expiration : la durée de
  conservation des copies (section 5) est à reporter dans le registre des traitements, avec le DPO.

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
| `cursus-…Z-avant-migration.db` | le démarrage d'une nouvelle version qui doit modifier une base existante |
| `cursus-…Z-avant-reinitialisation.db` | `npm run reset-demo` et le bouton « Réinitialiser les données » (démonstration) |
| `cursus-…Z-avant-restauration.db` | `npm run restore` (état remplacé, pour pouvoir revenir en arrière) |
| `cursus-…Z-avant-restauration-brut/` | `npm run restore -- … --force` sur une base illisible : fichiers copiés tels quels, hors rotation |

L'horodatage est en **UTC** (suffixe `Z`) pour rester dans l'ordre aux changements d'heure. Le préfixe
est le nom du fichier de base (`cursus` pour `cursus.db`) : plusieurs bases peuvent partager un dossier
**à condition que leurs fichiers portent des noms différents**. Deux bases `cursus.db` (production et
recette, par exemple) doivent avoir chacune leur `CURSUS_BACKUP_DIR` : sinon la rotation et la liste
des copies les confondent.

| Variable | Effet | Défaut |
| --- | --- | --- |
| `CURSUS_DB` | Base à sauvegarder | `data/cursus.db` |
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
  Une base déjà à jour ou neuve ne produit aucune copie. Chaque migration nommée n'est faite qu'une fois par base
  (table `migrations`) ; une base qu'une version plus récente a migrée est refusée par une version plus ancienne
  (« restaurer la copie avant-migration » : c'est cette copie qu'il faut restaurer pour revenir en arrière).
- **Avant la réinitialisation de la démonstration** (`npm run reset-demo`, bouton de l'écran
  Paramètres) : si la copie échoue, rien n'est effacé. Le message de confirmation donne le nom de la copie.

## 4. Planification : timer systemd

**Choix retenu** : un timer systemd lance `npm run backup` chaque nuit, plutôt qu'une minuterie dans le
serveur. Il est indépendant du processus serveur (un serveur arrêté ou bloqué n'empêche pas la
sauvegarde), un échec est visible comme une unité en échec (`systemctl --failed`, alerte `OnFailure`),
`Persistent=true` rattrape une sauvegarde manquée si la machine était éteinte, et la copie hors de la
machine s'enchaîne dans la même unité. C'est l'outil que la supervision du service informatique sait déjà suivre.

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

`/usr/local/sbin/cursus-copie-externe` (`root:root`, `chmod 755`) :

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
   (`…-avant-restauration.db`), remplace la base et supprime ses fichiers `-wal` / `-shm`.
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
doit être modifiée.
