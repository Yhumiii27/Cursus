-- Copie du dépôt Matrix (github.com/Yhumiii27/Matrix, privé), infra/postgres/init/02-schemas.sql au commit 403ff37
-- (recopie du lot 8, 24/10/2026 ; dernier changement de infra/postgres/init : 403ff37). Sert seulement à l'intégration
-- continue de Cursus (.github/workflows/ci.yml, job postgres) et aux essais locaux : socle du serveur commun EPC2I. Ne
-- pas modifier ici : recopier le fichier depuis Matrix (tests/socle-colonnes-sensibles.test.ts contrôle la copie).

-- Serveur PostgreSQL commun EPC2I, étape 2 sur 3 : un schéma par outil.
--
-- Lancement : automatique au premier démarrage du conteneur, ou à la main en superutilisateur, après l'étape 1 :
--   psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f init/02-schemas.sql
-- Rejouable : crée les schémas qui manquent et remet propriétaires et paramètres de session.
--
--   schéma    propriétaire   search_path du rôle
--   keystone  keystone_app   keystone
--   codex     codex_app      codex
--   cursus    cursus_app     cursus
--   vigie     vigie_app      vigie
--   matrix    matrix_app     matrix
--
-- Chaque outil crée ses tables et le journal de ses migrations dans son propre schéma. Aucun rôle d'outil n'a le
-- droit CREATE sur la base : il ne peut ni créer un autre schéma, ni écrire dans public.
--
-- Extensions : schéma extensions, propriété du superutilisateur, fermé à PUBLIC. Il porte pg_trgm (paquet contrib,
-- index de recherche document_terms_term de Codex), que codex_app ne peut pas créer lui-même. Hors du schéma codex :
-- ses fonctions, exécutables par tous, y seraient un droit EXECUTE croisé pour chaque lecteur des vues codex.pub_
-- (droits.verifier()). Seul codex_app reçoit USAGE sur extensions ; Codex l'ajoute au search_path de sa seule
-- transaction de migration.

\set ON_ERROR_STOP on
\connect epc2i

BEGIN;

-- public reste vide et fermé : un objet créé par erreur sans schéma échoue au lieu d'atterrir là.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS keystone AUTHORIZATION keystone_app;
CREATE SCHEMA IF NOT EXISTS codex    AUTHORIZATION codex_app;
CREATE SCHEMA IF NOT EXISTS cursus   AUTHORIZATION cursus_app;
CREATE SCHEMA IF NOT EXISTS vigie    AUTHORIZATION vigie_app;
CREATE SCHEMA IF NOT EXISTS matrix   AUTHORIZATION matrix_app;

-- Rejeu : remet le bon propriétaire si quelqu'un l'a changé.
ALTER SCHEMA keystone OWNER TO keystone_app;
ALTER SCHEMA codex    OWNER TO codex_app;
ALTER SCHEMA cursus   OWNER TO cursus_app;
ALTER SCHEMA vigie    OWNER TO vigie_app;
ALTER SCHEMA matrix   OWNER TO matrix_app;

REVOKE ALL ON SCHEMA keystone, codex, cursus, vigie, matrix FROM PUBLIC;

COMMENT ON SCHEMA keystone IS 'Keystone (gestion de projets) : tables et journal des migrations (__drizzle_migrations). Propriétaire keystone_app.';
COMMENT ON SCHEMA codex    IS 'Codex (GED) : tables et journal des migrations (__drizzle_migrations). Propriétaire codex_app.';
COMMENT ON SCHEMA cursus   IS 'Cursus (RH) : tables et journal des migrations (schema_migrations). Propriétaire cursus_app.';
COMMENT ON SCHEMA vigie    IS 'Vigie (QHSE) : tables et journal des migrations (__drizzle_migrations). Propriétaire vigie_app.';
COMMENT ON SCHEMA matrix   IS 'Matrix (catalogue des bases) : catalogue, correspondances, historique, journal. Propriétaire matrix_app.';

-- Paramètres de session, appliqués à chaque connexion de l'outil sur epc2i (y compris derrière PgBouncer,
-- qui refuse le paramètre de démarrage « options »).
ALTER ROLE keystone_app IN DATABASE epc2i SET search_path TO keystone;
ALTER ROLE codex_app    IN DATABASE epc2i SET search_path TO codex;
ALTER ROLE cursus_app   IN DATABASE epc2i SET search_path TO cursus;
ALTER ROLE vigie_app    IN DATABASE epc2i SET search_path TO vigie;
ALTER ROLE matrix_app   IN DATABASE epc2i SET search_path TO matrix;

-- Une transaction ouverte et oubliée garde ses verrous, dont le verrou d'écriture de l'outil (voir
-- docs/architecture-postgres.md, § 4.5) : elle est coupée au bout de 5 minutes d'inactivité.
ALTER ROLE keystone_app IN DATABASE epc2i SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE codex_app    IN DATABASE epc2i SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE cursus_app   IN DATABASE epc2i SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE vigie_app    IN DATABASE epc2i SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE matrix_app   IN DATABASE epc2i SET idle_in_transaction_session_timeout TO '5min';

-- Extensions demandées par les outils (voir l'en-tête) : pg_trgm pour Codex. Rejeu : le schéma garde son
-- propriétaire et ses droits, l'extension n'est créée que si elle manque (une restauration de codex.dump la suppose).
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION CURRENT_USER;
ALTER SCHEMA extensions OWNER TO CURRENT_USER;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO codex_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
COMMENT ON SCHEMA extensions IS 'Extensions installées par le superutilisateur pour les outils : pg_trgm (Codex). USAGE à codex_app seul. Voir infra/postgres/init/02-schemas.sql dans Matrix.';

COMMIT;

\echo 'Étape 2 terminée : schémas keystone, codex, cursus, vigie, matrix et extensions (pg_trgm) en place.'
