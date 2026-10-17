# Connexion Microsoft 365 (Entra ID)

Guide destiné au service informatique. Les salariés dotés d'un compte Microsoft 365 de l'entreprise se
connectent à Cursus avec ce compte, depuis leur ordinateur Windows (Edge, Chrome) comme depuis leur
téléphone : Cursus ne voit jamais leur mot de passe, et l'authentification multifacteur et les règles
d'accès conditionnel de l'entreprise s'appliquent. Le personnel sans compte Microsoft (ouvriers,
intérimaires, alternants) garde un compte Cursus, identifiant et mot de passe.

Cursus suit le flux OpenID Connect « code d'autorisation » avec PKCE :

```
Navigateur ──▶ Cursus /api/auth/microsoft ──302──▶ login.microsoftonline.com (connexion, MFA)
Navigateur ◀──302── Microsoft : code ──▶ Cursus /api/auth/microsoft/retour
                    Cursus ──HTTPS──▶ Microsoft : code + secret client ──▶ jeton d'identité vérifié ──▶ session de 12 h
```

Prérequis : Cursus installé selon `docs/DEPLOIEMENT.md` et joignable en HTTPS à son adresse publique
(dans ce guide `https://cursus.example.fr`) ; le serveur doit pouvoir joindre
`https://login.microsoftonline.com` (sortie HTTPS, port 443) pour échanger le code et lire les clés de
signature de Microsoft. Les opérations dans Entra demandent le rôle « Administrateur d'application »
(ou « Administrateur d'application cloud »).

## 1. Inscrire l'application

Centre d'administration Microsoft Entra (https://entra.microsoft.com) → **Identité** → **Applications**
→ **Inscriptions d'applications** → **Nouvelle inscription** :

- **Nom** : `Cursus` (le nom apparaît sur la page de connexion Microsoft).
- **Types de comptes pris en charge** : « Comptes dans cet annuaire d'organisation uniquement
  (locataire unique) ». Cursus refuse tout jeton d'un autre annuaire.
- **URI de redirection** : plateforme **Web**, `https://cursus.example.fr/api/auth/microsoft/retour`,
  exactement : `https`, nom en minuscules, sans barre finale.

Sur la page **Vue d'ensemble** de l'application, relever :

| Valeur Entra | Variable de Cursus |
| --- | --- |
| ID d'application (client) | `CURSUS_OIDC_CLIENT_ID` |
| ID de l'annuaire (locataire), au format GUID | `CURSUS_OIDC_TENANT` |

## 2. Authentification et jeton d'ID

**Gérer** → **Authentification** :

- Plateforme **Web** : l'URI de redirection ci-dessus, seule. Elle sert aussi au retour après la
  déconnexion Microsoft (« Se déconnecter » dans Cursus ferme aussi la session Microsoft du navigateur).
- **Flux implicites et hybrides** : laisser décochés « Jetons d'accès » et « Jetons d'ID ». Cursus
  reçoit le jeton d'ID par l'échange du code, de serveur à serveur ; le flux implicite est inutile et
  moins sûr.
- **Autoriser les flux clients publics** : Non.
- **URL de déconnexion du canal frontal** : vide.

Le jeton d'ID standard suffit (**Configuration des jetons** : aucune revendication facultative à
ajouter). Cursus lit `oid` (identifiant immuable de la personne), `tid` (annuaire),
`preferred_username` (adresse de connexion) et `name`.

**Autorisations d'API** : Cursus ne demande que `openid`, `profile` et `email`. La permission déléguée
Microsoft Graph `User.Read` ajoutée par défaut peut rester. Cliquer sur **Accorder un consentement
d'administrateur pour l'organisation** : personne n'aura à consentir à la première connexion.

## 3. Secret client et date d'expiration

**Gérer** → **Certificats & secrets** → **Secrets client** → **Nouveau secret client** :

- Description : `Cursus production` (un secret distinct pour l'instance de recette, voir plus bas).
- Expiration : 12 mois (24 au plus).
- Copier aussitôt la **Valeur** — pas l'« ID du secret » — dans `CURSUS_OIDC_CLIENT_SECRET` : Entra ne
  l'affiche qu'une fois.

**Noter la date d'expiration** dans le calendrier d'exploitation, avec un rappel un mois avant. Un
secret expiré bloque toutes les connexions Microsoft (le journal de Cursus indique alors
`AADSTS7000222`). Renouvellement sans coupure : créer un nouveau secret, le poser dans
`/etc/cursus/cursus.env`, `sudo systemctl restart cursus`, vérifier une connexion, puis supprimer
l'ancien secret dans Entra.

## 4. Limiter l'accès : affectation requise

Par défaut, tout compte de l'annuaire peut se présenter à Cursus. Pour que Microsoft refuse d'emblée
les personnes non concernées :

**Identité** → **Applications** → **Applications d'entreprise** → **Cursus** → **Propriétés** :
**Affectation requise ?** → **Oui**, puis **Utilisateurs et groupes** → **Ajouter un
utilisateur/groupe** → un groupe, par exemple « Cursus – utilisateurs » (salariés du site et service RH).

Une personne hors du groupe est arrêtée chez Microsoft (`AADSTS50105`). Cursus vérifie de toute façon
qu'elle a un compte Cursus actif : une personne du groupe sans compte voit « Accès non autorisé :
demandez l'ouverture d'un compte au service RH », et la tentative est tracée dans le journal.

Les stratégies d'accès conditionnel de l'entreprise (MFA, appareils conformes, pays) s'appliquent à
Cursus comme aux autres applications : les cibler sur l'application « Cursus » si besoin.

## 5. Variables de Cursus

Dans `/etc/cursus/cursus.env` (modèle commenté : `.env.example`) :

| Variable | Valeur |
| --- | --- |
| `CURSUS_OIDC_TENANT` | ID de l'annuaire (locataire), GUID. `common`, `organizations` ou un nom de domaine ne conviennent pas |
| `CURSUS_OIDC_CLIENT_ID` | ID d'application (client) |
| `CURSUS_OIDC_CLIENT_SECRET` | Valeur du secret client |
| `CURSUS_PUBLIC_URL` | Adresse publique de Cursus, en https, sans chemin : `https://cursus.example.fr` |

```bash
sudo nano /etc/cursus/cursus.env
sudo systemctl restart cursus
journalctl -u cursus -n 20
```

Le journal affiche `Connexion Microsoft 365 active : locataire …, URI de redirection
https://cursus.example.fr/api/auth/microsoft/retour` : cette URI doit être celle inscrite dans Entra.
En production, Cursus refuse de démarrer si une partie seulement des quatre variables est définie,
si le locataire n'est pas un GUID ou si `CURSUS_PUBLIC_URL` n'est pas en https. Sans aucune des quatre,
seuls les comptes Cursus fonctionnent. `CURSUS_OIDC_AUTORITE` est réservée aux tests automatiques (faux
fournisseur local) : jamais sur un serveur, Cursus refuse alors de démarrer.

**Variables dans Coolify** (installation en conteneur, README.md, « Mise en ligne ») : les quatre variables se
saisissent dans l'onglet « Environment Variables » de l'application, `CURSUS_OIDC_CLIENT_SECRET` cochée comme secrète
(« Is Literal » aussi si la valeur contient un `$`), puis « Redeploy » : le conteneur est recréé avec elles.
`CURSUS_PUBLIC_URL` est l'adresse déclarée dans « Domains » de Coolify, en `https://`. La ligne « Connexion Microsoft 365
active » se lit dans l'onglet « Logs » (champ `message` de la ligne JSON) ; une configuration refusée y apparaît en
ligne de niveau `erreur`, et le conteneur s'arrête avec le code 1 (Coolify affiche alors un déploiement en échec).

Instance de recette : une inscription d'application distincte (« Cursus recette »), avec son URI de
redirection `https://cursus-recette.example.fr/api/auth/microsoft/retour` et son propre secret.

## 6. Comptes dans Cursus

La connexion Microsoft prouve l'identité ; le compte Cursus décide de l'accès.

- **Créer le compte** : Paramètres → Comptes et accès → **Créer un compte**, type **Microsoft 365**.
  L'identifiant est l'**adresse de connexion Microsoft** de la personne (son UPN, en général son adresse
  professionnelle `prenom.nom@entreprise.fr`). Premier administrateur RH sur une installation vide :
  `npm run comptes -- admin prenom.nom@entreprise.fr` (voir `docs/DEPLOIEMENT.md`).
- **Première connexion** : Cursus retrouve le compte Microsoft dont l'identifiant est l'adresse reçue
  de Microsoft et lui rattache l'identité Microsoft de la personne (`oid`). Ensuite, le compte se
  retrouve par cette identité, même si l'adresse change (changement de nom).
- **Espace d'arrivée** : RH si le compte a un profil RH, sinon manager si la personne encadre une équipe,
  sinon collaborateur ; « Espace », dans la barre latérale, passe aux autres espaces du compte.
- **Identité Microsoft recréée** (départ puis retour, compte supprimé et recréé dans Entra) : l'adresse
  est la même mais l'identité a changé, la connexion est refusée. L'administrateur RH clique sur
  **Délier** dans Comptes et accès ; la connexion suivante rattache la nouvelle identité.
- **Départ d'un salarié** : désactiver son compte Microsoft dans Entra empêche toute nouvelle
  connexion, mais une session Cursus déjà ouverte dure jusqu'à 12 heures. Désactiver aussi son compte
  dans Cursus (ou saisir sa date de sortie) ferme ses sessions aussitôt.

## 7. Vérifications

```bash
curl -s https://cursus.example.fr/api/session | grep -o '"microsoft":[a-z]*'                     # "microsoft":true
curl -sI https://cursus.example.fr/api/auth/microsoft | grep -i '^location'                      # https://login.microsoftonline.com/<locataire>/oauth2/v2.0/authorize?…
```

Puis, depuis un poste et depuis un téléphone de l'entreprise : « Se connecter avec Microsoft », retour
dans Cursus dans le bon espace, « Se déconnecter » (retour à l'écran de connexion de Cursus). Le
journal (Paramètres → Journal) montre « Connexion Microsoft 365 — première connexion, compte rattaché à
son identité Microsoft ».

## 8. Dépannage

Chaque refus est écrit dans le journal de Cursus (action `connexion.refusee`, avec l'adresse et
l'identité reçues de Microsoft) et les incidents techniques dans `journalctl -u cursus`. Paramètres →
Journal → **Connexions** n'affiche que les connexions. Au-delà de 30 refus en 15 minutes depuis une
même adresse, les suivants ne sont plus journalisés jusqu'à la fin de cette période (une ligne le
signale) : le journal ne peut pas être noyé par des retours forgés. Un refus de Microsoft est noté
avec son code (`access_denied`, `consent_required`…) et son numéro `AADSTS` quand il y en a un.

| Symptôme | Cause probable | Remède |
| --- | --- | --- |
| Pas de bouton « Se connecter avec Microsoft » | Variables absentes | Section 5 ; `journalctl -u cursus` liste les problèmes de configuration |
| Microsoft affiche `AADSTS50011` | URI de redirection différente | Inscrire exactement `CURSUS_PUBLIC_URL` + `/api/auth/microsoft/retour` (https, sans barre finale) |
| Microsoft affiche `AADSTS50105` | Personne non affectée à l'application | L'ajouter au groupe affecté (section 4) |
| Microsoft affiche `AADSTS700016` | ID d'application ou locataire erroné | Reprendre les valeurs de la Vue d'ensemble |
| Microsoft demande un consentement, ou `AADSTS65001` | Consentement administrateur non accordé | Section 2, Autorisations d'API |
| « Connexion impossible » ; journal : `Échange du code refusé par Microsoft (… invalid_client) — AADSTS7000215` ou `AADSTS7000222` | Secret erroné ou expiré | Nouveau secret (section 3) |
| « Connexion impossible » ; journal : `Jeton d'identité expiré` ou `pas encore valable` | Horloge du serveur décalée de plus de 5 minutes | `timedatectl` : synchronisation NTP active |
| « Connexion interrompue » | Retour plus de 10 minutes après le départ vers Microsoft, connexion lancée dans deux onglets, cookies bloqués, ou adresse utilisée différente de `CURSUS_PUBLIC_URL` | Recommencer depuis l'adresse publique |
| « Connexion Microsoft indisponible » | Le serveur ne joint pas `login.microsoftonline.com` (pare-feu, DNS) ou locataire inexistant | `journalctl -u cursus` donne le détail ; `curl -sI https://login.microsoftonline.com` depuis le serveur |
| « Accès non autorisé : demandez l'ouverture d'un compte au service RH » | Aucun compte Cursus à cette adresse, ou compte déjà rattaché à une autre identité Microsoft | Créer le compte, corriger son identifiant (adresse de connexion exacte, visible dans le journal) ou **Délier** |
| « Accès non autorisé : votre compte Cursus est désactivé… » | Compte désactivé ou date de sortie passée | Réactiver le compte ou corriger la date de sortie |
| « Session expirée » au bout de 12 heures | Fin normale de la session | Se reconnecter par-dessus l'écran ; la saisie du formulaire ouvert est conservée et restaurée au retour de Microsoft |

## Ce que Cursus vérifie

- **PKCE (S256)** : le code n'est utilisable qu'avec le vérificateur gardé par le navigateur qui a lancé
  la connexion.
- **state** et **nonce** aléatoires, gardés avec le vérificateur et la page de retour dans un cookie
  signé de 10 minutes (`cursus_oidc`, HttpOnly, SameSite=Lax, Secure en production), à usage unique.
- **Jeton d'identité** : signature RS256 par les clés publiées par Microsoft (relues lors d'une rotation),
  émetteur `https://login.microsoftonline.com/<locataire>/v2.0`, audience = ID d'application, dates
  `exp` et `nbf` à 5 minutes près, nonce, annuaire (`tid`) = locataire configuré.
- La page de retour est toujours un chemin de Cursus : jamais une autre adresse.
- Le secret client ne quitte pas le serveur et n'est jamais écrit dans le journal.
