# Norma — règles communes de la suite EPC2I

Ce fichier est la copie que chaque outil garde dans `norma/` (version dans `norma/VERSION`). Le `CLAUDE.md` de l'outil
l'importe par `@norma/REGLES.md` et n'ajoute que ses propres règles. Une règle commune se change dans le dépôt
`Yhumiii27/Norma`, jamais dans la copie d'un outil (`node norma/outils/norma.mjs verifier` le refuse).

## 1. La suite

| Outil | Rôle | Schéma |
| --- | --- | --- |
| Keystone | projets EPC2i (exécution) | `keystone` |
| Codex | documents (GED) | `codex` |
| Vigie | QHSE | `vigie` |
| Cursus | ressources humaines | `cursus` |
| Arche | CAPEX des filiales (DIG-PRODI) | `arche` |
| Crucible | moyens d'essais R&D | `crucible` |
| Clavis | annuaire, accès, connexion centrale | `clavis` |
| Matrix | serveur PostgreSQL commun, publications, liens entre outils | `matrix` |
| Modulus | commercial et chiffrage : catalogue machines, BOM standard, prix, affaires, savoir-faire | `modulus` |

Dépôts, rôles PostgreSQL, ports et variables de connexion : `norma/registre/outils.json`.

## 2. Langues

- Répondre au propriétaire **en français**.
- Code et identifiants en anglais. Messages de commit : la langue de l'outil (`langue_commits` du registre : anglais
  pour Keystone, Arche, Crucible, Clavis, Modulus ; français pour Codex, Vigie, Cursus, Matrix).
- Interface : chaînes sources en anglais traduites par l'i18n de l'outil ; **le français est la langue par défaut**.
  Le texte saisi par les personnes s'affiche tel quel, jamais passé par `t()`.

## 3. Travail dans les dépôts

- Chaque session travaille dans **le dépôt de son outil** ; les autres dépôts se lisent. Une demande à un autre outil
  s'écrit dans le `REQUESTS.md` de cet outil, après une note détaillée au propriétaire (dépôt, demande, raison,
  conséquence d'un refus) et son « validé ».
- Le propriétaire peut autoriser une session à modifier plusieurs dépôts (lancement de la suite, 23 novembre 2026) :
  chaque changement passe alors par une branche et une PR **dans chaque dépôt touché**.
- **Chaque lot vérifié va sur `main` par une PR fusionnée une fois la CI verte.** Jamais de force-push sur `main`, jamais
  de test désactivé ou contourné pour obtenir le vert.
- Aucun secret dans le dépôt ; aucune adresse e-mail personnelle ; un fichier qui nomme des personnes réelles (annuaire)
  reste hors de Git.
- Rien hors du cahier des charges sans l'accord du propriétaire : un ajout se propose (question de `DECISIONS.md` de
  l'outil) avant d'être construit.
- **Reste à faire de la solution** : une seule liste, tenue dans Norma (`reste-a-faire/<outil>.json`, schéma
  `reste-a-faire/SCHEMA.md`). Après chaque développement : mettre à jour le fichier de l'outil dans Norma (état des points,
  ligne d'historique, `updated`), lancer `npm run reste-a-faire` dans Norma, ouvrir la PR de Norma, puis republier la page
  globale `.artifacts/reste-a-faire.html` à la même adresse d’artefact, https://claude.ai/artifact/Rs7kooJdowShdYUqNS8jQf. Un outil ne tient
  plus de liste propre : sa documentation renvoie à celle de Norma.
- **Questionnaire du responsable produit** : par le modèle de Norma (`node norma/outils/questionnaire/build.mjs`, réglé par
  `scripts/questionnaire/config.json` et `questions.json` de l'outil) ; les réponses (base de l'artefact, collection
  `answers`) sont relues avant chaque livraison et reportées dans le `DECISIONS.md` de l'outil.

## 4. Données : un serveur PostgreSQL commun

- **PostgreSQL seul** : pas de PGlite ni d'autre moteur pour un nouvel outil (dérogations : `dependances.json`). Les tests
  ont une base PostgreSQL neuve par fichier.
- Chaque outil écrit **seulement dans son schéma**, avec son rôle (`<outil>_app`). Tables déclarées dans le schéma de
  l'outil (`pgSchema(...).table(...)`, objet de schéma jamais exporté : aucune migration ne crée de schéma ni d'extension).
- **Migrations générées, jamais modifiées** une fois publiées ; tout changement passe par une nouvelle migration.
- **Les formats vivent dans la base** : chaque colonne a sa contrainte (domaine d'un état, forme d'un code, nom non vide,
  cohérence entre colonnes). L'application contrôle aussi, pour un message clair, jamais seule.
- **Journal d'audit en ajout seul** (déclencheur) : jamais de mise à jour ni de suppression d'une ligne d'audit, ni en code,
  ni en test. Pas de suppression physique d'un enregistrement métier tracé : archivage ou annulation motivés.
- Les indicateurs se calculent, ils ne se stockent pas ; une seule horloge métier par outil (jamais de date figée dans le
  code).

## 5. Échanges entre outils (décisions M-17, M-18, M-19 de Matrix)

- **Lire** un autre outil seulement par ses vues `pub_`, jamais par ses tables.
- **Écrire** chez un autre outil seulement par son API ou une fonction `pub_<verbe>_<objet>` qu'il fournit ; jamais
  d'`INSERT`, `UPDATE` ni `DELETE` dans son schéma.
- **Matrix définit, applique et possède les vues `pub_`** (écran « Publications », rôle `matrix_gestion`). Aucune
  migration d'un outil ne crée, ne modifie, ne commente ni ne supprime une vue `pub_` ; une publication ou une colonne de
  plus se demande à Matrix. Une colonne publiée ne se retire ni ne se renomme ; un changement incompatible passe par une
  vue `…_v2`. Avant de modifier une colonne lue par une vue, Matrix fait d'abord évoluer la publication.
- Une écriture qu'un autre outil doit faire chez soi passe par son API, ou par une fonction créée par migration :
  `SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de
  l'outil appliqués, `REVOKE EXECUTE … FROM PUBLIC`, signature jamais changée.
- Un besoin d'accès se déclare comme **un lien** du registre de Matrix (lecteur, objet `schéma.pub_…`, nature `lecture`
  ou `execution`, raison), jamais comme une copie de données.
- Un connecteur vit dans `src/server/integrations/<outil>/` : miroir en lecture seule, file d'envoi, liens profonds vers
  l'outil propriétaire. Une source illisible est un état affiché (« source indisponible »), jamais une erreur de page.

## 6. Connexion et droits : Clavis

- La connexion passe par **Clavis** (OpenID Connect, forme Entra ID) : l'outil pose son émetteur sur Clavis (variable du
  registre) et s'inscrit avec `npm run oidc:client` dans Clavis.
- **Les droits se lisent dans la base**, dans `clavis.pub_acces` (personne, application, niveau, rôle propre à l'outil,
  `ouvert`), à la connexion et à chaque requête (ou au plus chaque minute), jamais dans le jeton. Un accès retiré ou un
  rôle changé dans Clavis vaut à la page suivante. **Lecture impossible = refus.**
- L'outil contrôle le droit de la personne à agir ; la base contrôle le droit de l'outil et les formats.
- Clavis ne tient aucune donnée personnelle hors de l'annuaire public interne ; l'annuaire Microsoft se lit, ne s'écrit
  jamais.
- Toute Server Function valide ses entrées et les droits **côté serveur** ; isolation par périmètre dans la couche
  d'accès aux données (un objet hors périmètre est un 404).

## 7. Interface : la charte Nocturne

Charte et composants : `norma/charte/` (mode d'emploi `norma/charte/README.md`). En bref :
- couleurs, polices, espacements, rayons et ombres viennent des variables de `nocturne.css`, jamais en dur ;
- Inter servie depuis le dépôt (le `build` ne demande pas le réseau) ; icônes Phosphor ;
- barre latérale par thème, recherche de pages ⌘K, sélecteur FR / EN dans l’en-tête, et juste à côté le bouton
  d’affichage sombre / clair (cookie `epc2i-theme`, attribut `data-theme` de `<html>`) ;
- actions de la page dans l'en-tête (au-delà de trois : menu « Actions ») ; aucun formulaire ouvert dans la page : un
  bouton ouvre un panneau latéral, fermé au succès ;
- accessibilité : focus visible, contrastes de la charte, bouton à icône seule nommé.

## 8. Dépendances

`norma/dependances.json` : versions minimales, bibliothèques autorisées, interdites (avec leur raison) et dérogations.
Une dépendance absente des listes se déclare dans Norma avant d'être utilisée.

## 9. Exploitation

- Installation directe sur le serveur interne, sans Docker : guide `docs/installation-directe.md` du dépôt Matrix
  (fichiers `/etc/epc2i/<outil>.env`, services systemd, mandataire HTTPS, sauvegardes).
- Configuration par variables d'environnement validées au démarrage (une variable invalide arrête l'outil) ; toutes
  décrites dans `.env.example`.
- Ports sur le Mac du propriétaire : ceux du registre. **Ne jamais utiliser ni arrêter le port d'un autre outil.**
- Aucune donnée ne sort du serveur interne sans l'accord de la DSI (pas de mesure d'audience, pas de service externe) ;
  l'IA n'est active qu'avec une clé posée et le fournisseur validé par la DSI (C-13).

## 10. Ce que Claude fait seul, et ce qu'il demande

- Seul : lire, développer sur une branche, ouvrir une PR (brouillon), fusionner une PR verte quand le propriétaire l'a
  demandé, mettre à jour la documentation de l'outil.
- Après un « validé » explicite : écrire dans le `REQUESTS.md` d'un autre outil, toucher au serveur commun (droits,
  rôles), supprimer ou restaurer des données.
- Jamais : `DROP DATABASE`, force-push sur `main`, secret ou donnée personnelle dans un dépôt, contournement d'un test.
