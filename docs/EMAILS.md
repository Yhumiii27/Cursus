# Envoi des e-mails de Cursus

Guide destiné au service informatique, qui exploite Cursus. Décisions de l'entreprise : les salariés
utilisent Microsoft 365 (Outlook, Teams) et chacun a une adresse e-mail professionnelle ; les relevés
d'heures des intérimaires partent chaque semaine par e-mail à leur agence.

```
Action dans Cursus ──▶ file d'envoi (base SQLite) ──▶ processus de fond ──HTTPS──▶ Microsoft Graph ──▶ Exchange Online
                                                         │                       POST /v1.0/users/{boîte d'envoi}/sendMail
                                                         └─HTTPS──▶ login.microsoftonline.com (jeton applicatif)
```

Cursus envoie ses e-mails depuis une **boîte d'envoi dédiée** (par exemple `cursus@entreprise.fr`) par
l'API Microsoft Graph, avec un jeton d'application (flux « client credentials » : aucun compte utilisateur,
aucun mot de passe de boîte aux lettres). Sans configuration, Cursus reste en **mode simulation** : rien ne
part, chaque e-mail est tracé dans le journal et visible dans Paramètres → Envois, marqué « simulé ».

## Ce que Cursus envoie

| E-mail | Destinataire | Quand |
| --- | --- | --- |
| Demande de congés à valider | Valideur : manager direct, sinon la boîte du service RH | Demande d'un salarié |
| Décision sur une demande de congés, congés posés par le manager | Salarié | Validation, refus, pose |
| Feuille de temps à valider | Valideur | Soumission |
| Feuille de temps à corriger | Salarié | Renvoi par le valideur, ou absence annulée qui couvrait la semaine |
| Compte rendu d'entretien à signer | Salarié | Clôture par l'évaluateur |
| Compte rendu d'entretien mis à disposition (lien vers Cursus seulement, jamais le texte du compte rendu) | Salarié | Remise « mis à disposition dans le portail » par l'évaluateur ou le service RH ; toujours aussitôt |
| Réponse à une demande au service RH | Salarié, et le manager qui l'a faite pour lui | Acceptation ou refus |
| Convocation à une formation, à un entretien (fichier `.ics` joint) | Salarié | Inscription avec « Envoyer maintenant », « Envoyer la convocation », planification d'un entretien |
| Annulation d'une convocation (`.ics` d'annulation) | Salarié qui a reçu la convocation, même remise « à renvoyer » par un changement de date ou de lieu | Désinscription, changement de session, recyclage enregistré avant la session, session annulée ; entretien planifié annulé (`entretien.annuler`, date à venir) |
| Récapitulatif des échéances : titres, visites médicales (échéance seule), formalités de voyage (une vaccination n'est qu'une « formalité sanitaire »), déplacements au dossier incomplet, entretiens, fins de contrat ; jamais d'avis d'aptitude | Boîte du service RH (tout le périmètre) ; chaque manager (son équipe, sans visite ni vaccination ni entretien de reprise, ni titre de séjour, ni 18 ans ou dérogation d'un salarié mineur) ; chaque référent HSE (formations et habilitations) | Chaque jour à partir de 7 h (ou un jour de la semaine), seulement les paliers franchis depuis la dernière relance (90, 30, 7 jours, échu par défaut) ; désactivable dans Paramètres → Messagerie |
| Demande de visite médicale (contenu de la demande imprimable : salarié, poste, motif, habilitations qui exigent l'aptitude ; aucune information médicale) | Service de prévention et de santé au travail (Paramètres → Messagerie) | Demande de visite enregistrée par le service RH ; sans adresse, la demande est à imprimer |
| Relevé d'heures des intérimaires (CSV joint) | Agence d'intérim | Chaque semaine, dès que toutes les feuilles de ses intérimaires sont validées, même avec retard (jusqu'à cinq semaines) ; relevé complet après un relevé envoyé incomplet par le service RH ; renvoi par le service RH |
| Récapitulatif quotidien | Personne qui l'a choisi | Chaque jour à partir de 7 h |
| E-mail d'essai | Adresse saisie | Paramètres → Messagerie |

Les notifications d'étapes partent aussitôt, ou sont regroupées dans un récapitulatif quotidien : chacun le
règle dans son espace (Accueil → « Mes notifications par e-mail ») ; le service RH règle celui de sa boîte
(Paramètres → Messagerie). Les convocations et les mises à disposition d'un compte rendu partent toujours aussitôt. Rien n'est envoyé à la personne qui
fait l'action, ni à un salarié sans adresse ou dont la date de sortie est passée. Le récapitulatif part à
l'adresse en vigueur le jour de son envoi (fiche, ou boîte du service RH) ; les notifications d'une personne
sortie ou sans adresse entre-temps sont closes sans envoi.

**Agenda** : convocations et annulations portent un fichier `.ics` (journées entières du premier au dernier jour de la
session ; avec des horaires, un créneau à l'heure de Paris répété chaque jour de la session, jours sautés exclus, un jour
à un autre horaire remplacé ; organisateur : la boîte d'envoi, identifiant stable par session et salarié). Le salarié ouvre celui de la convocation pour ajouter
l'événement à son agenda, celui de l'annulation pour l'en retirer ; une convocation renvoyée le met à jour. Une session « à confirmer » par l'organisme y figure comme
provisoire. Le comportement d'Outlook (ajout, mise à jour, retrait) est à vérifier à la mise en service (section 5).

**Contenu** : texte brut, objet clair, nom, dates, lien vers Cursus (`CURSUS_PUBLIC_URL`). Jamais de donnée de
santé, de motif d'absence médical, de numéro de passeport, ni les textes libres saisis dans Cursus
(commentaires, motifs de refus) : l'e-mail renvoie à Cursus pour le détail. Les réponses des destinataires
vont à la boîte du service RH (en-tête « Répondre à »), réglée dans Paramètres → Messagerie.

## 1. Boîte d'envoi dédiée

Créer dans Exchange Online une **boîte aux lettres partagée** (aucune licence requise), par exemple
`cursus@entreprise.fr`, nom affiché « Cursus ». Personne n'a besoin de s'y connecter : une copie de chaque
e-mail envoyé reste dans ses « Éléments envoyés » (preuve d'envoi d'une convocation). Faire valider par le DPO
une stratégie de rétention de ces copies (par exemple un an).

## 2. Autorisation Mail.Send dans Entra

Deux possibilités :

- **Application dédiée (recommandée)** : nouvelle inscription « Cursus — e-mails » dans Entra (centre
  d'administration Microsoft Entra → Identité → Applications → Inscriptions d'applications → Nouvelle
  inscription, comptes de cet annuaire uniquement, sans URI de redirection), avec son propre secret client
  (Certificats & secrets). Variables `CURSUS_MAIL_TENANT`, `CURSUS_MAIL_CLIENT_ID`, `CURSUS_MAIL_CLIENT_SECRET`.
- **Application de la connexion** (`docs/CONNEXION-MICROSOFT.md`) : sans variables `CURSUS_MAIL_TENANT`,
  `CURSUS_MAIL_CLIENT_ID` et `CURSUS_MAIL_CLIENT_SECRET`, Cursus reprend `CURSUS_OIDC_*`. Une seule
  application, mais un même secret pour la connexion et l'envoi.

Dans l'inscription retenue : **Autorisations d'API → Ajouter une autorisation → Microsoft Graph →
Autorisations d'application → `Mail.Send`**, puis **Accorder le consentement administrateur**. Le statut
doit afficher « Accordé ».

Seule, cette autorisation permet d'envoyer au nom de **n'importe quelle** boîte de l'entreprise : l'étape 3
est obligatoire.

## 3. Restreindre l'application à la seule boîte d'envoi

Stratégie d'accès d'application d'Exchange Online, en PowerShell (module ExchangeOnlineManagement), par un
administrateur Exchange. `<ID d'application>` : ID d'application (client) de l'inscription.

```powershell
Connect-ExchangeOnline -UserPrincipalName admin@entreprise.fr

# Groupe de sécurité à extension messagerie ne contenant que la boîte d'envoi.
New-DistributionGroup -Name "Cursus - envoi" -Alias cursus-envoi -Type Security -Members cursus@entreprise.fr

# L'application n'accède qu'aux boîtes de ce groupe.
New-ApplicationAccessPolicy -AppId <ID d'application> -PolicyScopeGroupId cursus-envoi@entreprise.fr `
  -AccessRight RestrictAccess -Description "Cursus : envoi depuis cursus@entreprise.fr uniquement"

# Vérification : Granted pour la boîte d'envoi, Denied pour toute autre.
Test-ApplicationAccessPolicy -Identity cursus@entreprise.fr -AppId <ID d'application>
Test-ApplicationAccessPolicy -Identity prenom.nom@entreprise.fr -AppId <ID d'application>
```

La stratégie peut mettre jusqu'à une heure à s'appliquer. Microsoft propose aussi, pour les nouveaux
déploiements, le contrôle d'accès par rôles des applications d'Exchange Online (`New-ManagementScope`,
`New-ManagementRoleAssignment -Role "Application Mail.Send" -CustomResourceScope …`) : dans ce cas, ne pas
accorder `Mail.Send` dans Entra (les deux autorisations s'additionnent), seulement l'attribution de rôle
limitée à la boîte d'envoi.

## 4. Variables d'environnement

Dans `/etc/cursus/cursus.env` (modèle : `.env.example`), puis `sudo systemctl restart cursus`.

| Variable | Valeur |
| --- | --- |
| `CURSUS_MAIL_FROM` | Adresse de la boîte d'envoi (`cursus@entreprise.fr`). Sans elle : simulation |
| `CURSUS_MAIL_TENANT` | ID de l'annuaire (locataire) Entra, au format GUID ; par défaut `CURSUS_OIDC_TENANT` |
| `CURSUS_MAIL_CLIENT_ID` | ID d'application (client) ; par défaut `CURSUS_OIDC_CLIENT_ID` |
| `CURSUS_MAIL_CLIENT_SECRET` | Valeur du secret client ; par défaut `CURSUS_OIDC_CLIENT_SECRET`. Noter sa date d'expiration |
| `CURSUS_PUBLIC_URL` | Adresse publique de Cursus (`https://cursus.example.fr`) : lien en pied de chaque e-mail, identifiant des événements `.ics`. Elle fait partie de la configuration de la connexion Microsoft (les quatre variables, ou aucune) |

Au démarrage, en production, Cursus refuse de démarrer et liste le problème si `CURSUS_MAIL_FROM` n'est pas
une adresse, si l'application n'est pas entièrement désignée (locataire, ID d'application, secret, par les
variables `CURSUS_MAIL_*` ou `CURSUS_OIDC_*`), si le locataire n'est pas un GUID, ou si des variables
`CURSUS_MAIL_*` sont définies sans `CURSUS_MAIL_FROM` (les e-mails resteraient simulés sans qu'on s'en aperçoive).

**Variables dans Coolify** (installation en conteneur, README.md, « Mise en ligne ») : les mêmes variables se saisissent
dans l'onglet « Environment Variables » de l'application, `CURSUS_MAIL_CLIENT_SECRET` cochée comme secrète (« Is
Literal » aussi si la valeur contient un `$`), puis « Redeploy ». Un problème de configuration apparaît dans l'onglet
« Logs » en ligne JSON de niveau `erreur`, et le conteneur s'arrête (déploiement en échec) ; un envoi en échec se suit
dans Paramètres → Envois (« Suivi et incidents »).

**Réseau** : la machine de Cursus doit joindre en HTTPS (443, sortant) `login.microsoftonline.com` et
`graph.microsoft.com`.

## 5. Mise en service et test

1. Redémarrer Cursus ; Paramètres → Messagerie affiche « Microsoft 365 » et la boîte d'envoi.
2. Avec l'administrateur RH : Paramètres → Messagerie → **E-mail d'essai**, vers votre adresse.
3. Paramètres → Envois, filtre « E-mails » : l'e-mail passe « Envoyé » avec l'accusé `HTTP 202` en quelques
   secondes ; il arrive dans votre boîte, et sa copie dans les « Éléments envoyés » de la boîte d'envoi.
4. `Test-ApplicationAccessPolicy` (étape 3) répond `Denied` pour une autre boîte que la boîte d'envoi.
5. Le service RH renseigne ensuite Paramètres → Messagerie (boîte du service RH, service de santé au travail,
   adresse de chaque agence d'intérim) et complète les fiches sans adresse (liste dans le même panneau).
   L'adresse d'un salarié est reprise de son compte Microsoft 365 à la création du compte (Paramètres →
   Comptes et accès, ou `npm run comptes -- admin … --salarie`), et une fois pour toutes les fiches d'une base
   existante à la mise à jour.
6. Convocation d'essai : inscrire un volontaire à une session avec « Envoyer maintenant », ouvrir le fichier `.ics`
   reçu dans Outlook (l'événement s'ajoute à l'agenda), puis le désinscrire et ouvrir le fichier d'annulation
   (l'événement disparaît).

## Suivi et incidents

Chaque e-mail passe par la file d'envoi persistante de Cursus (comme les messages à Keystone) : aucun n'est
perdu à un redémarrage, aucun appel réseau n'a lieu pendant une action. Un e-mail à la fois, dans l'ordre ;
après une erreur réseau, un délai dépassé (10 s), une erreur 5xx, 408 ou 429, nouvelle tentative de 1 min à
1 h plus tard, 10 fois au plus. Un jeton expiré (401) est renouvelé et l'envoi retenté. Toute autre erreur
met l'e-mail en échec (journal : `email.echec`) ; une fois la cause corrigée (et Cursus redémarré si la
configuration a changé), le service RH le **relance** depuis Paramètres → Envois, ou le **classe**. La relance
renvoie le même message aux mêmes destinataires : elle convient quand la cause est la configuration ou le
réseau, pas une adresse de destinataire erronée (voir ci-dessous).

| Erreur affichée dans Envois | Cause | Remède |
| --- | --- | --- |
| `Jeton Microsoft refusé : HTTP 401 · invalid_client — AADSTS7000215` | Secret client erroné | Recopier la valeur du secret (pas son ID) |
| `… AADSTS7000222` | Secret client expiré | Nouveau secret dans Entra, variable mise à jour, redémarrage |
| `… AADSTS700016` | Application inconnue dans ce locataire | Vérifier `CURSUS_MAIL_CLIENT_ID` et `CURSUS_MAIL_TENANT` |
| `HTTP 403 · ErrorAccessDenied` | `Mail.Send` non accordée (consentement), ou boîte hors de la stratégie d'accès | Étapes 2 et 3 ; attendre la propagation de la stratégie |
| `HTTP 404 · ErrorInvalidUser`, `MailboxNotEnabledForRESTAPI` | `CURSUS_MAIL_FROM` n'est pas une boîte Exchange Online | Corriger l'adresse ou créer la boîte |
| `HTTP 400 · ErrorInvalidRecipients` | Adresse du destinataire refusée | Corriger l'adresse (fiche du salarié, Paramètres → Messagerie), **classer** l'e-mail en échec (une relance reprendrait l'ancienne adresse), puis le renvoyer depuis Cursus : « Renvoyer la convocation » (fiche du salarié ou détail de la session), « Renvoyer » le relevé (Temps de travail, relevés d'heures des intérimaires). Une notification d'étape ne se renvoie pas : son destinataire la retrouve dans Cursus |
| `Erreur réseau`, `Délai dépassé`, `Jeton Microsoft : service de connexion injoignable` | Sortie HTTPS bloquée (pare-feu, proxy) | Ouvrir l'accès sortant (section 4) ; les envois reprennent seuls |

Renouveler le secret client avant sa date d'expiration : expiré, il bloque tous les e-mails (et, s'il est
partagé avec la connexion, toutes les connexions Microsoft).

## Données personnelles

Les e-mails portent des noms, des dates et des intitulés (formation, entretien, semaine), jamais de donnée de
santé. Ils sont conservés dans la base de Cursus (file d'envoi, visible du seul service RH) et dans les
« Éléments envoyés » de la boîte d'envoi : à mentionner au registre des traitements, avec leur durée de
conservation.
