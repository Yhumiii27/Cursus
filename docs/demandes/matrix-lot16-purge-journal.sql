-- Demande de Cursus à Matrix (point CU-N03 du reste à faire ; décision du propriétaire du 25 novembre 2026 : « ok pour
-- la purge par rôle dédié sur Cursus ») : rôle `cursus_purge`, seul à pouvoir supprimer des lignes du journal des
-- actions de Cursus, et seulement les lignes échues (12 mois ; 36 mois pour la paie), par la fonction purger_journal() de
-- la migration server/migrations-pg/0035_journal_ajout_seul.sql. Note : docs/demandes/matrix-lot16-purge-journal.md.
-- Ce fichier n'est jamais exécuté sur le serveur commun par Cursus : il est porté dans le socle de Matrix
-- (init/01-base-et-roles.sql pour le rôle, avec CURSUS_PURGE_PASSWORD facultatif ; init/03-droits.sql pour les droits,
-- rejoué après la migration 0035 de Cursus). L'intégration continue de Cursus le rejoue sur son socle d'essai, après les
-- migrations, avec droits.verifier() (.github/workflows/ci.yml). Mêmes droits que `droitsPurgeSql` de
-- server/src/journal-purge.ts (contrôlé par tests/journal-ajout-seul.test.ts). Statut : validé le 25/11/2026, porté dans la
-- PR de Matrix du même jour.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot16-purge-journal.sql   (superutilisateur)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cursus_purge') THEN
    -- Sans mot de passe : aucune connexion possible (le socle de Matrix pose LOGIN avec CURSUS_PURGE_PASSWORD).
    CREATE ROLE cursus_purge NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  END IF;
END $$;
GRANT CONNECT ON DATABASE epc2i TO cursus_purge;
GRANT USAGE ON SCHEMA cursus TO cursus_purge;
GRANT SELECT (id, at, action, paie), DELETE ON cursus.journal TO cursus_purge;
GRANT SELECT ON cursus.journal_actions_paie TO cursus_purge;
GRANT INSERT, SELECT (id) ON cursus.journal_purges TO cursus_purge;
GRANT EXECUTE ON FUNCTION cursus.purger_journal() TO cursus_purge;
