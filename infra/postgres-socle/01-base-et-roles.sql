-- Copie du dépôt Matrix (github.com/Yhumiii27/Matrix, privé), infra/postgres/init/01-base-et-roles.sql au commit 403ff37
-- (recopie du lot 8, 24/10/2026 ; dernier changement de infra/postgres/init : 403ff37). Sert seulement à l'intégration
-- continue de Cursus (.github/workflows/ci.yml, job postgres) et aux essais locaux : socle du serveur commun EPC2I. Ne
-- pas modifier ici : recopier le fichier depuis Matrix (tests/socle-colonnes-sensibles.test.ts contrôle la copie).

-- Serveur PostgreSQL commun EPC2I, étape 1 sur 3 : base epc2i et rôles.
--
-- Lancement :
--   - automatique au premier démarrage du conteneur (image officielle, dossier /docker-entrypoint-initdb.d) ;
--   - à la main, en superutilisateur, avec psql 15 ou plus (commande \getenv) :
--       psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f init/01-base-et-roles.sql
--     N'ajoutez pas -e ni -a : psql afficherait les mots de passe.
--
-- Rejouable : le script crée ce qui manque, puis remet les attributs, les appartenances et les mots de passe
-- aux valeurs ci-dessous. Les mots de passe sont lus dans l'environnement, et aucun ne peut être vide :
--   KEYSTONE_APP_PASSWORD  CODEX_APP_PASSWORD  CURSUS_APP_PASSWORD  VIGIE_APP_PASSWORD
--   MATRIX_APP_PASSWORD    EPC2I_SAUVEGARDE_PASSWORD
--
-- Rôles créés :
--   keystone_app, codex_app, cursus_app, vigie_app  connexion d'un outil, propriétaire de son seul schéma
--   matrix_app                                      connexion de Matrix, propriétaire du schéma matrix,
--                                                   membre de matrix_lecture
--   matrix_lecture  (groupe)                        SELECT sur les 4 schémas des outils, colonnes sensibles exclues
--   matrix_admin    (groupe)                        tous les droits ; attribué nominativement (droits.declarer_admin)
--   epc2i_sauvegarde                                connexion des sauvegardes, membre de pg_read_all_data

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ce script avec un superutilisateur (par exemple postgres), pas avec %.', current_user;
  END IF;
END $$;

-- ── 1. Mots de passe lus dans l'environnement ───────────────────────────
\getenv mdp_keystone_app KEYSTONE_APP_PASSWORD
\getenv mdp_codex_app CODEX_APP_PASSWORD
\getenv mdp_cursus_app CURSUS_APP_PASSWORD
\getenv mdp_vigie_app VIGIE_APP_PASSWORD
\getenv mdp_matrix_app MATRIX_APP_PASSWORD
\getenv mdp_epc2i_sauvegarde EPC2I_SAUVEGARDE_PASSWORD
\if :{?mdp_keystone_app}
\else
  \set mdp_keystone_app ''
\endif
\if :{?mdp_codex_app}
\else
  \set mdp_codex_app ''
\endif
\if :{?mdp_cursus_app}
\else
  \set mdp_cursus_app ''
\endif
\if :{?mdp_vigie_app}
\else
  \set mdp_vigie_app ''
\endif
\if :{?mdp_matrix_app}
\else
  \set mdp_matrix_app ''
\endif
\if :{?mdp_epc2i_sauvegarde}
\else
  \set mdp_epc2i_sauvegarde ''
\endif

SELECT string_agg(variable, ', ' ORDER BY variable) AS mdp_manquants
FROM (VALUES ('KEYSTONE_APP_PASSWORD', :'mdp_keystone_app'), ('CODEX_APP_PASSWORD', :'mdp_codex_app'),
             ('CURSUS_APP_PASSWORD', :'mdp_cursus_app'), ('VIGIE_APP_PASSWORD', :'mdp_vigie_app'),
             ('MATRIX_APP_PASSWORD', :'mdp_matrix_app'), ('EPC2I_SAUVEGARDE_PASSWORD', :'mdp_epc2i_sauvegarde')) AS v(variable, mdp)
WHERE mdp = '' \gset
\if :{?mdp_manquants}
  \echo 'Variables d''environnement absentes ou vides :' :mdp_manquants
  DO $$ BEGIN RAISE EXCEPTION 'Mots de passe manquants : rien n''a été modifié.'; END $$;
\endif

SELECT string_agg(variable, ', ' ORDER BY variable) AS mdp_courts
FROM (VALUES ('KEYSTONE_APP_PASSWORD', :'mdp_keystone_app'), ('CODEX_APP_PASSWORD', :'mdp_codex_app'),
             ('CURSUS_APP_PASSWORD', :'mdp_cursus_app'), ('VIGIE_APP_PASSWORD', :'mdp_vigie_app'),
             ('MATRIX_APP_PASSWORD', :'mdp_matrix_app'), ('EPC2I_SAUVEGARDE_PASSWORD', :'mdp_epc2i_sauvegarde')) AS v(variable, mdp)
WHERE length(mdp) < 16 \gset
\if :{?mdp_courts}
  \echo 'Attention : mots de passe de moins de 16 caractères :' :mdp_courts
\endif

-- ── 2. Base epc2i ────────────────────────────────────────────────────────
-- Tri binaire (C) et classes de caractères Unicode (C.UTF-8) : les mêmes réglages que PGlite, pour que les
-- outils trient comme aujourd'hui. Sans locale C.UTF-8 sur le système, repli sur C (avec un avertissement).
SELECT coalesce((SELECT collctype FROM pg_collation
                 WHERE collprovider = 'c' AND lower(collname) IN ('c.utf8', 'c.utf-8') ORDER BY collname LIMIT 1),
                'C') AS ctype_epc2i \gset
\if :{?ctype_epc2i}
\else
  \set ctype_epc2i C
\endif
SELECT :'ctype_epc2i' = 'C' AS ctype_repli \gset
\if :ctype_repli
  \echo 'Attention : locale C.UTF-8 absente, la base epc2i est créée avec LC_CTYPE = C.'
\endif

SELECT format('CREATE DATABASE epc2i WITH TEMPLATE template0 ENCODING %L LC_COLLATE %L LC_CTYPE %L',
              'UTF8', 'C', :'ctype_epc2i')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'epc2i') \gexec

-- Fuseau UTC et format ISO, comme PGlite : les dates et horodatages lus par les outils ne changent pas.
ALTER DATABASE epc2i SET timezone TO 'UTC';
ALTER DATABASE epc2i SET datestyle TO 'ISO, MDY';
COMMENT ON DATABASE epc2i IS 'Serveur commun EPC2I : un schéma par outil (keystone, codex, cursus, vigie, matrix). Voir infra/postgres/README.md dans Matrix.';

-- ── 3. Rôles ─────────────────────────────────────────────────────────────
BEGIN;

SELECT format('CREATE ROLE %I', nom)
FROM unnest(ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'matrix_app',
                  'matrix_lecture', 'matrix_admin', 'epc2i_sauvegarde']) AS nom
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = nom) \gexec

-- Rôles de groupe : pas de connexion directe.
ALTER ROLE matrix_lecture WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE matrix_admin   WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- Rôles de connexion : aucun attribut d'administration, mot de passe chiffré en SCRAM (défaut depuis PostgreSQL 14).
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L',
              nom, mdp)
FROM (VALUES ('keystone_app', :'mdp_keystone_app'), ('codex_app', :'mdp_codex_app'),
             ('cursus_app', :'mdp_cursus_app'), ('vigie_app', :'mdp_vigie_app'),
             ('matrix_app', :'mdp_matrix_app'), ('epc2i_sauvegarde', :'mdp_epc2i_sauvegarde')) AS v(nom, mdp) \gexec

-- Matrix lit les schémas des outils par le groupe matrix_lecture.
GRANT matrix_lecture TO matrix_app;
-- Sauvegardes : lecture de toutes les données, colonnes sensibles comprises (pg_dump).
GRANT pg_read_all_data TO epc2i_sauvegarde;
-- Administration : un membre de matrix_admin peut prendre le rôle d'un outil (SET ROLE) pour une opération de
-- structure exceptionnelle, sans en hériter les droits au quotidien. Ses requêtes sont journalisées.
GRANT keystone_app, codex_app, cursus_app, vigie_app, matrix_app TO matrix_admin WITH INHERIT FALSE, SET TRUE;

COMMENT ON ROLE keystone_app IS 'Connexion de Keystone : propriétaire du schéma keystone ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE codex_app IS 'Connexion de Codex : propriétaire du schéma codex ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE cursus_app IS 'Connexion de Cursus : propriétaire du schéma cursus ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE vigie_app IS 'Connexion de Vigie : propriétaire du schéma vigie ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE matrix_app IS 'Connexion de Matrix : propriétaire du schéma matrix, lit les outils par matrix_lecture.';
COMMENT ON ROLE matrix_lecture IS 'Groupe : SELECT sur keystone, codex, cursus, vigie, sauf les colonnes de droits.colonnes_sensibles.';
COMMENT ON ROLE matrix_admin IS 'Groupe : tous les droits sur les cinq schémas. Attribué nominativement par droits.declarer_admin (requêtes journalisées).';
COMMENT ON ROLE epc2i_sauvegarde IS 'Connexion des sauvegardes (pg_dump) : membre de pg_read_all_data.';

-- ── 4. Accès à la base ───────────────────────────────────────────────────
-- Personne ne se connecte à epc2i sans droit explicite ; aucun rôle (hors superutilisateur) n'y crée de schéma.
REVOKE ALL ON DATABASE epc2i FROM PUBLIC;
GRANT CONNECT ON DATABASE epc2i
  TO keystone_app, codex_app, cursus_app, vigie_app, matrix_app, matrix_lecture, matrix_admin, epc2i_sauvegarde;

COMMIT;

\echo 'Étape 1 terminée : base epc2i et rôles en place.'
