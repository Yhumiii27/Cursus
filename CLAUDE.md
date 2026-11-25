# Cursus — consignes pour les sessions Claude

@norma/REGLES.md

Règles communes de la suite EPC2I (Norma) : copie versionnée dans `norma/` (version `norma/VERSION`), contrôlée par
`npm run norma:check` (CI) ; elles se changent dans le dépôt `Yhumiii27/Norma`, jamais ici. Ce fichier n'ajoute que les
règles propres à Cursus.

Coque commune et logo (Norma 2.3.0, 25 novembre 2026, `norma/charte/COQUE.md` § 2 et § 8 bis) : la marque de la barre
latérale (26 px, `.coque-logo-mark`) et de la barre supérieure (20 px, `.coque-topbar-mark`) affiche `ToolLogo code="cursus"`
(`norma/charte/ds/ToolLogo.tsx`, importé par `client/src/layout/Shell.tsx`) ; le favicon `client/public/favicon.svg` est
`norma/charte/logos/cursus.svg` recopié. Les icônes PNG de l'application installée (`client/public/icons/` : 192, 512,
512 masquable, iOS 180) sont ce logo rendu sans dépendance par `scripts/icones.mjs`, à relancer quand le logo change
(`tests/pwa.test.ts` compare au contenu commité).

Cursus est l'outil RH du groupe EPC2I (formations, habilitations, temps, absences, entretiens, déplacements, frais).
Lire d'abord `README.md` et `docs/ARCHITECTURE.md` ; le reste à faire se tient dans Norma (`reste-a-faire/cursus.json` du dépôt `Yhumiii27/Norma`, page globale
https://claude.ai/artifact/Rs7kooJdowShdYUqNS8jQf, `norma/REGLES.md` § 3) ; `docs/RESTE_A_FAIRE.md` est la liste close au
24 novembre 2026, gardée pour ses décisions et ses preuves.

## Échanges avec les autres outils (décisions M-17 et M-18 de Matrix)

Matrix administre seul le serveur PostgreSQL commun : il définit ce que chaque outil publie, qui le lit et qui écrit
chez qui, et l'applique lui-même. Détail : `docs/ARCHITECTURE.md`, « Échanges avec les autres outils » ; inventaire :
`docs/ECHANGES.md` ; forme des demandes : `docs/demandes/LISEZ-MOI.md`.

- **Lire** chez un autre outil seulement par ses vues `pub_`, jamais par ses tables.
- **Écrire** chez un autre outil seulement par son API ou par une fonction `pub_` qu'il fournit ; jamais d'`INSERT`,
  `UPDATE` ni `DELETE` dans son schéma.
- **Les vues `pub_` de Cursus sont définies par Matrix** (écran « Publications ») : aucune migration de Cursus ne crée,
  ne modifie, ne commente ni ne supprime une vue `pub_` et n'y pose de droit (`tests/m18-publications.test.ts`). Une
  donnée à publier se demande à Matrix comme une publication ; avant de modifier une colonne lue par une vue `pub_`,
  Matrix fait d'abord évoluer la publication.
- **Un accès nouveau** se déclare comme un lien du registre `matrix.liens` (lecteur, objet, nature `lecture` ou
  `execution`, justification), par une demande rédigée dans `docs/demandes/`.
- **Une écriture qu'un autre outil ferait chez Cursus** passe par l'API de Cursus, ou par une fonction
  `pub_<verbe>_<objet>` de Cursus (`SECURITY DEFINER`, `SET search_path = cursus, pg_temp`, appelant identifié par
  `session_user`, règles et journal de Cursus, `REVOKE EXECUTE … FROM PUBLIC`) ; Matrix accorde son exécution.
- **Jamais d'écriture dans un autre dépôt** (Matrix, Keystone, Codex, Vigie, Arche, Crucible) : une demande se rédige
  dans `docs/demandes/` et attend la validation du propriétaire, qui la porte dans le `REQUESTS.md` de l'outil.

## Connecteurs

Un dossier par outil sous `server/src/integrations/` (`clavis/`, `codex/`, `keystone/`, `matrix/` ; hors du groupe
`microsoft/`, `push/`, `sage/`) : tout nouvel échange avec un autre outil s'y range (Norma § 5). Une source illisible est
un état affiché (« source indisponible », refus motivé, 503 avec message), jamais une erreur interne ; détail
`docs/ECHANGES.md`, « Où vivent les connecteurs ».

## Connexion par Clavis (24 novembre 2026)

Décision du propriétaire : une seule base pour tous les outils. Avec `CURSUS_OIDC_EMETTEUR` (adresse de Clavis) la
connexion « Microsoft 365 » passe par Clavis ; avec `CURSUS_ACCES_CLAVIS=on`, l'accès et le profil RH sont lus dans
`clavis.pub_acces` (`server/src/integrations/clavis/acces-clavis.ts`) à la connexion (`server/src/microsoft.ts`) et au plus toutes les
minutes pendant la session (`examinerSession`, `server/src/auth.ts`) ; compte créé à la première connexion, rattaché à
la fiche de même e-mail ; lecture impossible = refus. Guide : `docs/CONNEXION-MICROSOFT.md` § 6 bis.
