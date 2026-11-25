# Demande à Matrix — rôle `cursus_purge` (purge du journal des actions de Cursus)

**Statut** : validée par le propriétaire le 25 novembre 2026 (« ok pour la purge par rôle dédié sur Cursus ») ; portée
le même jour dans le socle de Matrix par une PR de Matrix (session autorisée à modifier plusieurs dépôts, Norma § 3).
Point CU-N03 du reste à faire (Norma, `reste-a-faire/cursus.json`).

## Besoin

Norma § 4 exige un journal d'audit en ajout seul. Le journal des actions de Cursus (`cursus.journal`) applique pourtant
une conservation RGPD : 12 mois, 36 mois pour les actions liées à la paie. Depuis la migration
`server/migrations-pg/0035_journal_ajout_seul.sql`, un déclencheur y refuse toute modification, suppression ou
troncature, au rôle `cursus_app` compris ; la seule exception est la suppression d'une ligne échue par un rôle dédié,
`cursus_purge`, pendant la fonction `cursus.purger_journal()` (aucun paramètre, aucun autre filtre), qui inscrit chaque
passage au registre `cursus.journal_purges` (date, règle, limites, nombres, dates extrêmes ; jamais le contenu).

Cursus ne crée ni rôle ni droit sur le serveur commun : le rôle et ses droits sont au socle de Matrix.

## Ce qui est demandé

1. `init/01-base-et-roles.sql` : rôle `cursus_purge`, aucun attribut d'administration, membre d'aucun groupe ; LOGIN
   avec le mot de passe `CURSUS_PURGE_PASSWORD` s'il est fourni (facultatif, comme `bi_reader`), sinon NOLOGIN ;
   CONNECT sur `epc2i`.
2. `init/03-droits.sql` (rejoué après la migration 0035 de Cursus ; sans effet tant qu'elle n'est pas passée) : exactement
   les droits de `docs/demandes/matrix-lot16-purge-journal.sql` (`droitsPurgeSql` de `server/src/journal-purge.ts`) :
   USAGE sur `cursus` ; SELECT (id, at, action, paie) et DELETE sur `cursus.journal` ; SELECT sur
   `cursus.journal_actions_paie` ; INSERT et SELECT (id) sur `cursus.journal_purges` ; EXECUTE sur
   `cursus.purger_journal()` ; rien d'autre (jamais `payload`, `message` ni aucune autre table).
3. `droits.verifier()` : signaler tout autre droit de `cursus_purge`, un attribut d'administration, et un déclencheur
   `journal_ajout_seul*` absent ou désactivé sur `cursus.journal`.
4. `verifier-droits.sql` : cas qui éprouvent ces droits et refus.

## Sans cette demande

La purge reste désactivée sur le serveur commun (avertissement au démarrage de Cursus) : rien n'est supprimé, les lignes
échues restent en base, masquées à l'écran, et la durée de conservation n'est plus tenue.

## Côté Cursus

`CURSUS_PURGE_DATABASE_URL=postgres://cursus_purge:<mot de passe>@epc2i-postgres:5432/epc2i` (docs/DEPLOIEMENT.md,
« Variante : serveur PostgreSQL commun EPC2I », point 7).
