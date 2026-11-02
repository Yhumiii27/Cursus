# Cursus — consignes pour les sessions Claude

Cursus est l'outil RH du groupe EPC2I (formations, habilitations, temps, absences, entretiens, déplacements, frais).
Lire d'abord `README.md` et `docs/ARCHITECTURE.md` ; la suite des lots est dans `docs/RESTE_A_FAIRE.md`.

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
