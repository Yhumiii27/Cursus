-- Copie du dépôt Matrix (github.com/Yhumiii27/Matrix, privé), infra/postgres/init/03-droits.sql au commit 403ff37
-- (recopie du lot 8, 24/10/2026 ; dernier changement de infra/postgres/init : 403ff37). Sert seulement à l'intégration
-- continue de Cursus (.github/workflows/ci.yml, job postgres) et aux essais locaux : socle du serveur commun EPC2I. Ne
-- pas modifier ici : recopier le fichier depuis Matrix (tests/socle-colonnes-sensibles.test.ts contrôle la copie).

-- Serveur PostgreSQL commun EPC2I, étape 3 sur 3 : droits de Matrix et protection des colonnes sensibles.
--
-- Lancement : automatique au premier démarrage du conteneur, ou à la main en superutilisateur, après les étapes 1 et 2 :
--   psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f init/03-droits.sql
-- Rejouable : tout est recréé ou remis à jour dans une seule transaction.
--
-- Ce que fait le script :
--   1. matrix_lecture : USAGE sur keystone, codex, cursus, vigie ; SELECT sur les tables futures par
--      ALTER DEFAULT PRIVILEGES ; matrix_admin : tous les droits sur les cinq schémas.
--   2. Schéma droits (propriétaire : le superutilisateur), avec :
--        droits.colonnes_sensibles   la liste des colonnes interdites à matrix_lecture ;
--        droits.appliquer_droits()   remet les droits de toutes les relations à l'état voulu ;
--        droits.verifier()           liste les écarts (gravité erreur, attention, info), y compris les droits
--                                    croisés des outils : seule la convention de partage est acceptée (USAGE sur
--                                    le schéma d'un autre et SELECT sur ses vues pub_, rien d'autre ; aucune vue
--                                    pub_ ne lit une colonne sensible ; voir infra/postgres/partage/) ;
--        droits.declarer_admin(nom)  crée un administrateur nominatif, membre de matrix_admin, journalisé.
--   3. Deux déclencheurs d'événement, droits_ddl et droits_suppression.
--
-- Pourquoi un déclencheur d'événement. ALTER DEFAULT PRIVILEGES accorde SELECT sur une table entière : il ne sait
-- pas exclure une colonne. Le déclencheur droits_ddl s'exécute à la fin de chaque commande CREATE, ALTER, GRANT
-- ou REVOKE qui touche une relation des cinq schémas, dans la transaction de cette commande. Il retire le SELECT
-- de table de matrix_lecture et le remplace par un SELECT colonne par colonne, sans les colonnes de la liste. La
-- table n'est visible des autres sessions qu'au COMMIT : à aucun moment matrix_lecture ne lit une colonne
-- sensible. Les migrations des outils n'ont rien à faire, et rejouer droits.appliquer_droits() après une
-- migration reste possible (contrôle de sécurité, sans effet si tout est en ordre).
--
-- Règles appliquées à matrix_lecture, relation par relation (schémas keystone, codex, cursus, vigie) :
--   - table sans colonne listée               SELECT sur la table ;
--   - table avec colonnes listées             SELECT sur chaque autre colonne, rien sur les colonnes listées ;
--   - table listée avec la colonne « * »      table entière fermée, colonnes futures comprises (données de santé,
--                                             journal de consultation : vigie.benign_accidents, access_log, attachments) ;
--   - colonne listée absente de la table      table entière fermée (la colonne a pu être renommée) ;
--   - table protégée renommée ou déplacée     table entière fermée, jusqu'à la mise à jour de la liste ;
--   - vue qui lit une colonne listée          vue fermée (une vue lit avec les droits de son propriétaire) ;
--   - séquences                               aucun droit ;
--   - PUBLIC                                  aucun droit (matrix_lecture en hériterait).
-- Une partition ou une table héritée suit la liste de sa table mère.
-- Le schéma droits appartient au superutilisateur : le propriétaire d'un schéma peut supprimer tout objet qu'il
-- contient, donc la liste et les fonctions ne peuvent pas vivre dans le schéma matrix (propriété de matrix_app,
-- lui-même membre de matrix_lecture).

\set ON_ERROR_STOP on
\connect epc2i

BEGIN;

-- Recréés en fin de script, dans la même transaction : les autres sessions ne voient jamais de trou.
DROP EVENT TRIGGER IF EXISTS droits_ddl;
DROP EVENT TRIGGER IF EXISTS droits_suppression;

-- ── 1. Accès aux schémas et privilèges par défaut ───────────────────────
GRANT USAGE ON SCHEMA keystone, codex, cursus, vigie TO matrix_lecture;
GRANT USAGE ON SCHEMA keystone, codex, cursus, vigie, matrix TO matrix_admin;

-- Tables, vues et séquences créées plus tard par chaque outil. Le SELECT de matrix_lecture porte sur la table
-- entière ; droits_ddl le réduit aussitôt aux colonnes autorisées (voir l'en-tête).
ALTER DEFAULT PRIVILEGES FOR ROLE keystone_app IN SCHEMA keystone GRANT SELECT ON TABLES TO matrix_lecture;
ALTER DEFAULT PRIVILEGES FOR ROLE codex_app    IN SCHEMA codex    GRANT SELECT ON TABLES TO matrix_lecture;
ALTER DEFAULT PRIVILEGES FOR ROLE cursus_app   IN SCHEMA cursus   GRANT SELECT ON TABLES TO matrix_lecture;
ALTER DEFAULT PRIVILEGES FOR ROLE vigie_app    IN SCHEMA vigie    GRANT SELECT ON TABLES TO matrix_lecture;

ALTER DEFAULT PRIVILEGES FOR ROLE keystone_app IN SCHEMA keystone GRANT ALL ON TABLES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE codex_app    IN SCHEMA codex    GRANT ALL ON TABLES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE cursus_app   IN SCHEMA cursus   GRANT ALL ON TABLES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE vigie_app    IN SCHEMA vigie    GRANT ALL ON TABLES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE matrix_app   IN SCHEMA matrix   GRANT ALL ON TABLES TO matrix_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE keystone_app IN SCHEMA keystone GRANT ALL ON SEQUENCES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE codex_app    IN SCHEMA codex    GRANT ALL ON SEQUENCES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE cursus_app   IN SCHEMA cursus   GRANT ALL ON SEQUENCES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE vigie_app    IN SCHEMA vigie    GRANT ALL ON SEQUENCES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE matrix_app   IN SCHEMA matrix   GRANT ALL ON SEQUENCES TO matrix_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE keystone_app IN SCHEMA keystone GRANT EXECUTE ON ROUTINES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE codex_app    IN SCHEMA codex    GRANT EXECUTE ON ROUTINES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE cursus_app   IN SCHEMA cursus   GRANT EXECUTE ON ROUTINES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE vigie_app    IN SCHEMA vigie    GRANT EXECUTE ON ROUTINES TO matrix_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE matrix_app   IN SCHEMA matrix   GRANT EXECUTE ON ROUTINES TO matrix_admin;

-- Une fonction SECURITY DEFINER d'un outil, exécutable par PUBLIC, contournerait les droits par colonne.
ALTER DEFAULT PRIVILEGES FOR ROLE keystone_app, codex_app, cursus_app, vigie_app, matrix_app
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

-- ── 2. Schéma droits ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS droits AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA droits FROM PUBLIC;
GRANT USAGE ON SCHEMA droits TO matrix_lecture, matrix_admin;
COMMENT ON SCHEMA droits IS 'Droits du serveur EPC2I : colonnes sensibles et contrôle des droits de matrix_lecture. Propriété du superutilisateur. Voir infra/postgres/init/03-droits.sql dans Matrix.';

CREATE TABLE IF NOT EXISTS droits.colonnes_sensibles (
  schema_nom   text NOT NULL,
  table_nom    text NOT NULL,
  colonne_nom  text NOT NULL,
  motif        text NOT NULL,
  origine      text NOT NULL DEFAULT 'ajout',
  ajoute_le    timestamptz NOT NULL DEFAULT now(),
  ajoute_par   text NOT NULL DEFAULT session_user,
  CONSTRAINT colonnes_sensibles_pkey PRIMARY KEY (schema_nom, table_nom, colonne_nom),
  CONSTRAINT colonnes_sensibles_schema_ck CHECK (schema_nom IN ('keystone', 'codex', 'cursus', 'vigie')),
  CONSTRAINT colonnes_sensibles_origine_ck CHECK (origine IN ('convention', 'proposition', 'ajout'))
);
COMMENT ON TABLE droits.colonnes_sensibles IS 'Colonnes que matrix_lecture ne lit jamais ; colonne_nom = ''*'' ferme la table entière. origine : convention (décision du 15/10/2026 et données de santé de Vigie, retirée par un superutilisateur seulement), proposition (à confirmer), ajout.';

-- Tables protégées, repérées par leur OID : un renommage de table est détecté et la table reste fermée.
CREATE TABLE IF NOT EXISTS droits.relations_protegees (
  relid       oid PRIMARY KEY,
  schema_nom  text NOT NULL,
  table_nom   text NOT NULL,
  vu_le       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE droits.relations_protegees IS 'Tables à colonnes sensibles déjà traitées (OID et nom). Tenue par les fonctions du schéma droits.';

-- Lecteurs des vues pub_ posés par partage/90-droits.sql, repérés par leur nom (le nom survit à une restauration,
-- pas l'OID). droits.verifier() signale un lecteur qui a perdu son USAGE ou son SELECT, et une vue de la liste
-- devenue absente : restauration d'un schéma avec --no-privileges, DROP SCHEMA … CASCADE, vue supprimée.
-- Une vue retirée volontairement se retire de la liste par DELETE (matrix_admin).
CREATE TABLE IF NOT EXISTS droits.partage_lecteurs (
  vue       text        NOT NULL,
  lecteur   text        NOT NULL,
  pose_le   timestamptz NOT NULL DEFAULT now(),
  pose_par  text        NOT NULL DEFAULT session_user,
  CONSTRAINT partage_lecteurs_pkey PRIMARY KEY (vue, lecteur),
  CONSTRAINT partage_lecteurs_vue_check CHECK (vue ~ '^(keystone|codex|cursus|vigie|matrix)\.pub_[a-z0-9_]+$'),
  CONSTRAINT partage_lecteurs_lecteur_check CHECK (lecteur IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'matrix_app'))
);
COMMENT ON TABLE droits.partage_lecteurs IS 'Convention de partage : lecteurs attendus de chaque vue pub_ (schéma.vue, rôle), écrits par partage/90-droits.sql et contrôlés par droits.verifier().';

-- ── 3. Fonctions ─────────────────────────────────────────────────────────

-- Colonnes listées pour une relation, y compris celles de ses tables mères (partitions, héritage).
CREATE OR REPLACE FUNCTION droits._colonnes_listees(p_rel oid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  WITH RECURSIVE ascendants(relid) AS (
    SELECT p_rel
    UNION
    SELECT i.inhparent FROM pg_inherits i JOIN ascendants a ON i.inhrelid = a.relid
  )
  SELECT coalesce(array_agg(DISTINCT s.colonne_nom ORDER BY s.colonne_nom), '{}'::text[])
  FROM ascendants a
  JOIN pg_class c ON c.oid = a.relid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN droits.colonnes_sensibles s ON s.schema_nom = n.nspname AND s.table_nom = c.relname
$$;

-- État voulu d'une table pour matrix_lecture : 'ouverte', 'colonnes' ou 'fermee'.
CREATE OR REPLACE FUNCTION droits._etat_table(p_rel oid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_nsp text;
  v_nom text;
  v_p record;
  v_listees text[];
BEGIN
  SELECT n.nspname, c.relname INTO v_nsp, v_nom
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = p_rel;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Table protégée renommée ou déplacée, alors que la liste vise encore son ancien nom.
  SELECT * INTO v_p FROM droits.relations_protegees WHERE relid = p_rel;
  IF FOUND AND (v_p.schema_nom, v_p.table_nom) IS DISTINCT FROM (v_nsp, v_nom)
     AND EXISTS (SELECT FROM droits.colonnes_sensibles s
                 WHERE s.schema_nom = v_p.schema_nom AND s.table_nom = v_p.table_nom) THEN
    RETURN 'fermee';
  END IF;
  v_listees := droits._colonnes_listees(p_rel);
  IF cardinality(v_listees) = 0 THEN
    RETURN 'ouverte';
  END IF;
  -- Table fermée en entier (colonne « * ») : aucune colonne lisible, même ajoutée plus tard.
  IF '*' = ANY (v_listees) THEN
    RETURN 'fermee';
  END IF;
  -- Colonne listée absente (renommée ou supprimée) : on ne sait plus quelle colonne protéger.
  IF EXISTS (SELECT FROM unnest(v_listees) AS l(nom)
             WHERE NOT EXISTS (SELECT FROM pg_attribute a
                               WHERE a.attrelid = p_rel AND a.attname = l.nom AND a.attnum > 0 AND NOT a.attisdropped)) THEN
    RETURN 'fermee';
  END IF;
  RETURN 'colonnes';
END $$;

-- Vrai si la vue (ou vue matérialisée) lit une colonne sensible, directement ou par une autre vue. Une vue qui
-- utilise une ligne entière (SELECT t FROM table t) d'une table à colonnes sensibles est aussi fermée.
CREATE OR REPLACE FUNCTION droits._vue_sensible(p_rel oid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_etat text;
BEGIN
  FOR r IN
    WITH RECURSIVE vues(relid) AS (
      SELECT p_rel
      UNION
      SELECT d.refobjid
      FROM vues v
      JOIN pg_rewrite rw ON rw.ev_class = v.relid
      JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass
      JOIN pg_class c ON c.oid = d.refobjid AND c.relkind IN ('v', 'm')
      WHERE d.refobjid <> v.relid
    )
    SELECT DISTINCT d.refobjid AS tbl, d.refobjsubid AS att,
           rw.ev_action::text LIKE '%:varattno 0 %' AS ligne_entiere
    FROM vues v
    JOIN pg_rewrite rw ON rw.ev_class = v.relid
    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class c ON c.oid = d.refobjid AND c.relkind IN ('r', 'p', 'f')
  LOOP
    v_etat := droits._etat_table(r.tbl);
    IF v_etat = 'fermee' THEN
      RETURN true;
    END IF;
    IF v_etat = 'colonnes' THEN
      IF r.att = 0 AND r.ligne_entiere THEN
        RETURN true;
      END IF;
      IF r.att > 0 AND EXISTS (SELECT FROM pg_attribute a
                               WHERE a.attrelid = r.tbl AND a.attnum = r.att
                                 AND a.attname = ANY (droits._colonnes_listees(r.tbl))) THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;
  RETURN false;
END $$;

-- Vrai si la relation est une vue publiée pour ce lecteur (convention de partage, infra/postgres/partage/) :
-- vue pub_* d'un des cinq schémas, ou, pour matrix_lecture et matrix_app seulement, vue de contrôle *_v1 de cursus.
CREATE OR REPLACE FUNCTION droits._vue_publiee(p_rel oid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((
    SELECT c.relkind = 'v'
           AND n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix')
           AND (c.relname LIKE 'pub\_%'
                OR (n.nspname = 'cursus' AND c.relname LIKE '%\_v1' AND p_role IN ('matrix_lecture', 'matrix_app')))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = p_rel), false)
$$;

-- Vues qui dépendent, directement ou non, des relations données.
CREATE OR REPLACE FUNCTION droits._vues_dependantes(p_rels oid[]) RETURNS oid[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  WITH RECURSIVE vues(relid) AS (
    SELECT rw.ev_class
    FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
    WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = ANY (p_rels) AND rw.ev_class <> d.refobjid
    UNION
    SELECT rw.ev_class
    FROM vues v
    JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = v.relid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite rw ON rw.oid = d.objid
    WHERE rw.ev_class <> d.refobjid
  )
  SELECT coalesce(array_agg(relid), '{}'::oid[]) FROM vues
$$;

-- Met une relation dans l'état voulu (matrix_admin, PUBLIC, matrix_lecture). N'écrit que s'il y a un écart.
CREATE OR REPLACE FUNCTION droits._appliquer_relation(p_rel oid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_nsp text;
  v_nom text;
  v_kind "char";
  v_acl aclitem[];
  v_id text;
  v_objet text;
  v_ml oid := (SELECT oid FROM pg_roles WHERE rolname = 'matrix_lecture');
  v_ma oid := (SELECT oid FROM pg_roles WHERE rolname = 'matrix_admin');
  v_nb integer;
  v_etat text;
  v_listees text[];
  v_tbl text[];
  v_col text[];
  v_tbl_voulu text[];
  v_col_voulu text[];
  v_cols text;
BEGIN
  SELECT n.nspname, c.relname, c.relkind, c.relacl INTO v_nsp, v_nom, v_kind, v_acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = p_rel;
  IF NOT FOUND OR v_nsp NOT IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix')
     OR v_kind NOT IN ('r', 'p', 'v', 'm', 'f', 'S') THEN
    RETURN;
  END IF;
  v_id := format('%I.%I', v_nsp, v_nom);
  v_objet := CASE WHEN v_kind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END;

  -- matrix_admin : tous les droits sur les cinq schémas (7 pour une table ou une vue, 3 pour une séquence).
  SELECT count(DISTINCT a.privilege_type) INTO v_nb FROM aclexplode(v_acl) a WHERE a.grantee = v_ma;
  IF v_nb < (CASE WHEN v_kind = 'S' THEN 3 ELSE 7 END) THEN
    EXECUTE format('GRANT ALL ON %s %s TO matrix_admin', v_objet, v_id);
  END IF;

  IF v_nsp = 'matrix' THEN
    RETURN;
  END IF;

  -- PUBLIC : aucun droit dans les schémas des outils.
  IF EXISTS (SELECT FROM aclexplode(v_acl) a WHERE a.grantee = 0)
     OR EXISTS (SELECT FROM pg_attribute at, aclexplode(at.attacl) a WHERE at.attrelid = p_rel AND a.grantee = 0) THEN
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC', v_objet, v_id);
  END IF;

  -- matrix_lecture : état voulu.
  IF v_kind = 'S' THEN
    v_etat := 'fermee';
  ELSIF v_kind IN ('v', 'm') THEN
    v_etat := CASE WHEN droits._vue_sensible(p_rel) THEN 'fermee' ELSE 'ouverte' END;
  ELSE
    v_etat := droits._etat_table(p_rel);
  END IF;
  v_listees := droits._colonnes_listees(p_rel);

  v_tbl := ARRAY(SELECT a.privilege_type FROM aclexplode(v_acl) a WHERE a.grantee = v_ml ORDER BY 1);
  v_col := ARRAY(SELECT at.attname || ':' || a.privilege_type
                 FROM pg_attribute at, aclexplode(at.attacl) a
                 WHERE at.attrelid = p_rel AND at.attnum > 0 AND NOT at.attisdropped AND a.grantee = v_ml
                 ORDER BY 1);
  v_tbl_voulu := CASE WHEN v_etat = 'ouverte' THEN ARRAY['SELECT'] ELSE '{}'::text[] END;
  IF v_etat = 'colonnes' THEN
    v_col_voulu := ARRAY(SELECT at.attname || ':SELECT'
                         FROM pg_attribute at
                         WHERE at.attrelid = p_rel AND at.attnum > 0 AND NOT at.attisdropped
                           AND NOT (at.attname = ANY (v_listees))
                         ORDER BY 1);
  ELSE
    v_col_voulu := '{}'::text[];
  END IF;

  IF v_tbl IS DISTINCT FROM v_tbl_voulu OR v_col IS DISTINCT FROM v_col_voulu THEN
    -- REVOKE sur la table retire aussi les droits par colonne.
    EXECUTE format('REVOKE ALL ON %s %s FROM matrix_lecture', v_objet, v_id);
    IF v_etat = 'ouverte' THEN
      EXECUTE format('GRANT SELECT ON TABLE %s TO matrix_lecture', v_id);
    ELSIF v_etat = 'colonnes' AND cardinality(v_col_voulu) > 0 THEN
      SELECT string_agg(quote_ident(at.attname), ', ' ORDER BY at.attnum) INTO v_cols
      FROM pg_attribute at
      WHERE at.attrelid = p_rel AND at.attnum > 0 AND NOT at.attisdropped AND NOT (at.attname = ANY (v_listees));
      EXECUTE format('GRANT SELECT (%s) ON TABLE %s TO matrix_lecture', v_cols, v_id);
    END IF;
  END IF;

  -- Mémoire des tables protégées (une table fermée en entier aussi : renommée, elle reste fermée).
  IF v_etat = 'colonnes' OR (v_etat = 'fermee' AND v_kind IN ('r', 'p', 'f') AND '*' = ANY (v_listees)) THEN
    INSERT INTO droits.relations_protegees (relid, schema_nom, table_nom) VALUES (p_rel, v_nsp, v_nom)
    ON CONFLICT (relid) DO UPDATE SET schema_nom = EXCLUDED.schema_nom, table_nom = EXCLUDED.table_nom, vu_le = now();
  ELSIF v_etat = 'ouverte' AND v_kind IN ('r', 'p', 'f') THEN
    DELETE FROM droits.relations_protegees WHERE relid = p_rel;
  ELSIF v_etat = 'fermee' AND v_kind IN ('r', 'p', 'f') AND NOT ('*' = ANY (v_listees)) THEN
    RAISE WARNING 'droits : % est fermée à matrix_lecture (colonne de la liste absente : pas encore créée, renommée ou supprimée ; ou table renommée). Mettez à jour droits.colonnes_sensibles, ou passez la migration qui crée la colonne : les droits sont alors réappliqués.', v_id;
  END IF;
END $$;

-- Passe complète sur les cinq schémas.
CREATE OR REPLACE FUNCTION droits._appliquer_tout() RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rel oid;
  v_n integer := 0;
BEGIN
  DELETE FROM droits.relations_protegees p WHERE NOT EXISTS (SELECT FROM pg_class c WHERE c.oid = p.relid);
  FOR v_rel IN
    SELECT c.oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND c.relkind IN ('r', 'p', 'f', 'S', 'v', 'm')
    ORDER BY CASE WHEN c.relkind IN ('v', 'm') THEN 1 ELSE 0 END, n.nspname, c.relname
  LOOP
    PERFORM droits._appliquer_relation(v_rel);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Point d'entrée public : à rejouer après une migration ou une modification de la liste (sans effet si tout est
-- en ordre). Renvoie le nombre de relations contrôlées.
CREATE OR REPLACE FUNCTION droits.appliquer_droits() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_avant text := coalesce(current_setting('droits.application_en_cours', true), '');
  v_n integer;
BEGIN
  -- Les GRANT et REVOKE ci-dessous déclenchent droits_ddl : ce drapeau l'empêche de repartir en boucle.
  PERFORM set_config('droits.application_en_cours', 'on', true);
  v_n := droits._appliquer_tout();
  PERFORM set_config('droits.application_en_cours', v_avant, true);
  RETURN v_n;
END $$;
COMMENT ON FUNCTION droits.appliquer_droits() IS 'Remet les droits de matrix_lecture et matrix_admin à l''état voulu sur les cinq schémas. Rejouable sans effet de bord.';

-- Déclencheur d'événement : fin de chaque commande CREATE, ALTER, GRANT, REVOKE (voir la liste plus bas).
CREATE OR REPLACE FUNCTION droits._sur_ddl() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_rels oid[] := '{}';
  v_tout boolean := false;
  v_rel oid;
BEGIN
  IF coalesce(current_setting('droits.application_en_cours', true), '') = 'on' THEN
    RETURN;
  END IF;
  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF r.command_tag IN ('GRANT', 'REVOKE') THEN
      v_tout := true;   -- la commande ne dit pas quelle relation elle touche
    ELSIF r.classid = 'pg_class'::regclass AND r.schema_name IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') THEN
      v_rels := v_rels || r.objid;
    END IF;
  END LOOP;
  IF NOT v_tout AND cardinality(v_rels) = 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('droits.application_en_cours', 'on', true);
  IF v_tout THEN
    PERFORM droits._appliquer_tout();
  ELSE
    FOR v_rel IN SELECT DISTINCT x FROM unnest(v_rels || droits._vues_dependantes(v_rels)) AS x LOOP
      PERFORM droits._appliquer_relation(v_rel);
    END LOOP;
  END IF;
  PERFORM set_config('droits.application_en_cours', '', true);
END $$;

CREATE OR REPLACE FUNCTION droits._sur_suppression() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM droits.relations_protegees
  WHERE relid IN (SELECT o.objid FROM pg_event_trigger_dropped_objects() o
                  WHERE o.classid = 'pg_class'::regclass AND o.objsubid = 0);
END $$;

-- Liste modifiée : les droits sont réappliqués dans la même transaction.
CREATE OR REPLACE FUNCTION droits._sur_liste() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM droits.appliquer_droits();
  RETURN NULL;
END $$;

-- Les colonnes de la convention du 15/10/2026 ne se retirent qu'en superutilisateur.
CREATE OR REPLACE FUNCTION droits._proteger_convention() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.origine = 'convention' AND NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
      MESSAGE = format('La colonne %s.%s.%s fait partie de la convention du 15/10/2026 : seul un superutilisateur peut la modifier ou la retirer.',
                       OLD.schema_nom, OLD.table_nom, OLD.colonne_nom);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- Écarts entre l'état des droits et la convention. Aucune ligne « erreur » attendue.
CREATE OR REPLACE FUNCTION droits.verifier()
RETURNS TABLE (gravite text, objet text, constat text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_db oid := (SELECT oid FROM pg_database WHERE datname = current_database());
BEGIN
  -- Déclencheurs d'événement.
  RETURN QUERY
  SELECT 'erreur', e.nom, 'déclencheur d''événement absent ou désactivé : les nouvelles tables ne sont plus contrôlées'
  FROM (VALUES ('droits_ddl'), ('droits_suppression')) AS e(nom)
  WHERE NOT EXISTS (SELECT FROM pg_event_trigger t WHERE t.evtname = e.nom AND t.evtenabled <> 'D');

  -- Colonnes sensibles lisibles par matrix_lecture.
  RETURN QUERY
  SELECT 'erreur', format('%I.%I.%I', n.nspname, c.relname, a.attname), 'colonne sensible lisible par matrix_lecture'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie') AND c.relkind IN ('r', 'p', 'f')
    AND a.attname = ANY (droits._colonnes_listees(c.oid))
    AND has_column_privilege('matrix_lecture', c.oid, a.attnum, 'SELECT');

  -- Tables fermées (en entier, ou faute d'une colonne de la liste) et vues sensibles lisibles.
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname),
         CASE WHEN c.relkind IN ('r', 'p', 'f') AND '*' = ANY (droits._colonnes_listees(c.oid))
              THEN 'table fermée en entier (droits.colonnes_sensibles, colonne « * » : données de santé, journal de consultation) lisible par matrix_lecture'
              ELSE 'relation lisible par matrix_lecture alors qu''elle doit être fermée' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie')
    AND ((c.relkind IN ('v', 'm') AND droits._vue_sensible(c.oid))
         OR (c.relkind IN ('r', 'p', 'f') AND droits._etat_table(c.oid) = 'fermee'))
    AND has_any_column_privilege('matrix_lecture', c.oid, 'SELECT');

  -- Vues publiées (pub_* des cinq schémas, *_v1 de cursus) : elles sont lues par d'autres rôles avec les droits de
  -- leur propriétaire. Aucune ne lit de colonne sensible, ne dépend d'un autre schéma, n'appartient à un autre rôle
  -- que le propriétaire du schéma ou ne s'exécute avec security_invoker.
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname),
         'vue publiée qui lit une colonne sensible (droits.colonnes_sensibles), une ligne entière d''une table protégée ou une table fermée'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND c.relkind = 'v'
    AND (c.relname LIKE 'pub\_%' OR (n.nspname = 'cursus' AND c.relname LIKE '%\_v1'))
    AND droits._vue_sensible(c.oid);
  RETURN QUERY
  SELECT DISTINCT 'erreur', format('%I.%I', nv.nspname, v.relname), format('vue publiée qui dépend de %I.%I (autre schéma)', nt.nspname, t.relname)
  FROM pg_class v
  JOIN pg_namespace nv ON nv.oid = v.relnamespace
  JOIN pg_rewrite rw ON rw.ev_class = v.oid
  JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid
                  AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> v.oid
  JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r', 'p', 'v', 'm', 'f')
  JOIN pg_namespace nt ON nt.oid = t.relnamespace
  WHERE nv.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND v.relkind = 'v'
    AND (v.relname LIKE 'pub\_%' OR (nv.nspname = 'cursus' AND v.relname LIKE '%\_v1'))
    AND t.relnamespace <> v.relnamespace;
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname),
         CASE WHEN c.relowner <> n.nspowner
              THEN format('vue publiée qui appartient à %s au lieu de %s', pg_get_userbyid(c.relowner), pg_get_userbyid(n.nspowner))
              ELSE 'vue publiée qui s''exécute avec security_invoker' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND c.relkind = 'v'
    AND (c.relname LIKE 'pub\_%' OR (n.nspname = 'cursus' AND c.relname LIKE '%\_v1'))
    AND (c.relowner <> n.nspowner
         OR EXISTS (SELECT FROM unnest(c.reloptions) AS o(opt)
                    WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on', 'security_invoker=1', 'security_invoker=yes')));

  -- Droits croisés des outils : dans le schéma d'un autre, seulement SELECT sur des vues pub_. Tout autre droit est
  -- une erreur : table, colonne, vue non publiée, vue *_v1 de cursus, écriture, séquence, fonction.
  RETURN QUERY
  SELECT 'erreur', format('%s, %I.%I', r.nom, n.nspname, c.relname),
         format('droit %s croisé : un outil ne reçoit que SELECT sur les vues pub_ d''un autre schéma', p.priv)
  FROM (VALUES ('keystone_app', 'keystone'), ('codex_app', 'codex'), ('cursus_app', 'cursus'), ('vigie_app', 'vigie')) AS r(nom, propre)
  JOIN pg_roles x ON x.rolname = r.nom
  CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits') AND n.nspname <> r.propre
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege(x.oid, c.oid, p.priv)
         OR (p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(x.oid, c.oid, p.priv)))
    AND NOT (p.priv = 'SELECT' AND droits._vue_publiee(c.oid, r.nom));
  RETURN QUERY
  SELECT 'erreur', format('%s, %I.%I', r.nom, n.nspname, c.relname), format('droit %s croisé sur une séquence', p.priv)
  FROM (VALUES ('keystone_app', 'keystone'), ('codex_app', 'codex'), ('cursus_app', 'cursus'), ('vigie_app', 'vigie')) AS r(nom, propre)
  JOIN pg_roles x ON x.rolname = r.nom
  CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND n.nspname <> r.propre AND c.relkind = 'S'
    AND has_sequence_privilege(x.oid, c.oid, p.priv);
  RETURN QUERY
  SELECT 'erreur', format('%s, %I.%I(%s)', r.nom, n.nspname, f.proname, pg_get_function_identity_arguments(f.oid)),
         'droit EXECUTE croisé sur une fonction'
  FROM (VALUES ('keystone_app', 'keystone'), ('codex_app', 'codex'), ('cursus_app', 'cursus'), ('vigie_app', 'vigie')) AS r(nom, propre)
  JOIN pg_roles x ON x.rolname = r.nom
  CROSS JOIN pg_proc f
  JOIN pg_namespace n ON n.oid = f.pronamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits') AND n.nspname <> r.propre
    AND has_schema_privilege(x.oid, n.oid, 'USAGE')
    AND has_function_privilege(x.oid, f.oid, 'EXECUTE');

  -- Lecteurs attendus (droits.partage_lecteurs, écrits par partage/90-droits.sql) : chacun garde USAGE sur le
  -- schéma et SELECT sur la vue. Une restauration avec --no-privileges ou un DROP … CASCADE les retire sans bruit.
  RETURN QUERY
  SELECT 'erreur', format('%s, %s', p.lecteur, p.vue),
         CASE WHEN NOT has_schema_privilege(x.oid, c.relnamespace, 'USAGE')
              THEN 'lecteur prévu par partage/90-droits.sql sans USAGE sur le schéma : rejouer partage/90-droits.sql'
              ELSE 'lecteur prévu par partage/90-droits.sql sans SELECT sur la vue : rejouer partage/90-droits.sql' END
  FROM droits.partage_lecteurs p
  JOIN pg_roles x ON x.rolname = p.lecteur
  JOIN pg_class c ON c.oid = to_regclass(p.vue)
  WHERE c.relkind = 'v'
    AND NOT (has_schema_privilege(x.oid, c.relnamespace, 'USAGE') AND has_table_privilege(x.oid, c.oid, 'SELECT'));
  RETURN QUERY
  SELECT DISTINCT 'attention', p.vue,
         'vue pub_ prévue par partage/90-droits.sql absente (schéma restauré, DROP … CASCADE) : rejouer le fichier de partage de l''outil, puis 90-droits.sql et 95 ; ou retirer la vue de droits.partage_lecteurs'
  FROM droits.partage_lecteurs p
  WHERE to_regclass(p.vue) IS NULL;
  RETURN QUERY
  SELECT 'attention', 'matrix.journal_unifie',
         'vue absente alors que le partage est en place (supprimée par un DROP … CASCADE ?) : rejouer partage/95-matrix-journal-unifie.sql'
  WHERE EXISTS (SELECT FROM droits.partage_lecteurs) AND to_regclass('matrix.journal_unifie') IS NULL;

  -- matrix_app ne lit que dans les schémas des outils (directement ou par matrix_lecture).
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname), format('matrix_app a le droit %s', p.priv)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'droits') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege('matrix_app', c.oid, p.priv)
         OR (p.priv IN ('INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege('matrix_app', c.oid, p.priv)));

  -- matrix_lecture ne fait que lire.
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname), format('matrix_lecture a le droit %s', p.priv)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege('matrix_lecture', c.oid, p.priv)
         OR (p.priv IN ('INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege('matrix_lecture', c.oid, p.priv)));
  RETURN QUERY
  SELECT 'erreur', format('%I.%I', n.nspname, c.relname), format('matrix_lecture a le droit %s sur la séquence', p.priv)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('USAGE'), ('UPDATE')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix') AND c.relkind = 'S'
    AND has_sequence_privilege('matrix_lecture', c.oid, p.priv);

  -- Fonction SECURITY DEFINER d'un outil que matrix_lecture peut appeler : elle lit avec les droits de l'outil,
  -- colonnes sensibles comprises. Les privilèges par défaut retirent EXECUTE à PUBLIC ; un GRANT explicite de l'outil
  -- le rend de nouveau possible, et seul ce contrôle le voit.
  RETURN QUERY
  SELECT 'attention', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
         'fonction SECURITY DEFINER exécutable par matrix_lecture : elle lit avec les droits de l''outil, colonnes sensibles comprises ; retirer le GRANT EXECUTE ou la rendre SECURITY INVOKER'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie') AND p.prosecdef
    AND has_function_privilege('matrix_lecture', p.oid, 'EXECUTE');

  -- Relations que Matrix ne lit pas.
  RETURN QUERY
  SELECT CASE WHEN c.relkind IN ('v', 'm') OR '*' = ANY (droits._colonnes_listees(c.oid)) THEN 'info' ELSE 'attention' END,
         format('%I.%I', n.nspname, c.relname),
         CASE WHEN c.relkind IN ('v', 'm') THEN 'vue fermée à matrix_lecture : elle lit une colonne sensible'
              WHEN '*' = ANY (droits._colonnes_listees(c.oid)) THEN 'table fermée en entier à matrix_lecture (droits.colonnes_sensibles, colonne « * »)'
              WHEN droits._etat_table(c.oid) = 'fermee' THEN 'table fermée à matrix_lecture : colonne de la liste absente (pas encore créée, renommée ou supprimée) ou table renommée ; mettez à jour droits.colonnes_sensibles'
              ELSE 'table illisible par matrix_lecture' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT has_any_column_privilege('matrix_lecture', c.oid, 'SELECT');

  -- Entrées de la liste sans objet.
  RETURN QUERY
  SELECT CASE WHEN c.oid IS NULL THEN 'info' ELSE 'attention' END,
         format('%I.%I.%I', s.schema_nom, s.table_nom, s.colonne_nom),
         CASE WHEN c.oid IS NULL THEN 'table absente : pas encore créée, renommée ou supprimée'
              ELSE 'colonne absente : la table est fermée à matrix_lecture' END
  FROM droits.colonnes_sensibles s
  LEFT JOIN pg_namespace n ON n.nspname = s.schema_nom
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.table_nom AND c.relkind IN ('r', 'p', 'f')
  WHERE c.oid IS NULL
     OR (s.colonne_nom <> '*'
         AND NOT EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = s.colonne_nom AND a.attnum > 0 AND NOT a.attisdropped));

  -- Schémas : présence et propriétaire.
  RETURN QUERY
  SELECT 'erreur', s.nsp,
         CASE WHEN n.oid IS NULL THEN 'schéma absent' ELSE format('propriétaire %s au lieu de %s', pg_get_userbyid(n.nspowner), s.proprio) END
  FROM (VALUES ('keystone', 'keystone_app'), ('codex', 'codex_app'), ('cursus', 'cursus_app'),
               ('vigie', 'vigie_app'), ('matrix', 'matrix_app')) AS s(nsp, proprio)
  LEFT JOIN pg_namespace n ON n.nspname = s.nsp
  WHERE n.oid IS NULL OR pg_get_userbyid(n.nspowner) <> s.proprio;

  -- Accès des rôles aux schémas : chaque outil chez soi, plus la convention de partage. Un outil peut avoir USAGE
  -- sur le schéma d'un autre (keystone, codex, cursus, vigie, matrix) s'il y lit au moins une vue pub_ ; ses autres
  -- droits dans ce schéma sont contrôlés plus haut (droits croisés). CREATE croisé : toujours une erreur. Le schéma
  -- extensions (init/02 : pg_trgm) n'est ouvert qu'à codex_app, et à epc2i_sauvegarde par pg_read_all_data ; CREATE
  -- n'y est accordé à aucun de ces rôles.
  RETURN QUERY
  SELECT 'erreur', format('%s, schéma %s', r.nom, n.nspname),
         CASE WHEN p.priv = 'USAGE' AND r.lecteur AND n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix')
              THEN 'droit USAGE inattendu : aucune vue pub_ de ce schéma n''est accordée au rôle'
              ELSE format('droit %s inattendu', p.priv) END
  FROM (VALUES ('keystone_app', ARRAY['keystone'], ARRAY['keystone'], true),
               ('codex_app', ARRAY['codex', 'extensions'], ARRAY['codex'], true),
               ('cursus_app', ARRAY['cursus'], ARRAY['cursus'], true),
               ('vigie_app', ARRAY['vigie'], ARRAY['vigie'], true),
               ('matrix_app', ARRAY['matrix', 'keystone', 'codex', 'cursus', 'vigie', 'droits'], ARRAY['matrix'], false),
               ('matrix_lecture', ARRAY['keystone', 'codex', 'cursus', 'vigie', 'droits'], ARRAY[]::text[], false),
               ('matrix_admin', ARRAY['keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits'], ARRAY[]::text[], false),
               ('epc2i_sauvegarde', ARRAY['keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits', 'public', 'extensions'], ARRAY[]::text[], false)
       ) AS r(nom, usage_ok, create_ok, lecteur)
  JOIN pg_roles x ON x.rolname = r.nom
  CROSS JOIN pg_namespace n
  CROSS JOIN (VALUES ('USAGE'), ('CREATE')) AS p(priv)
  WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix', 'droits', 'public', 'extensions')
    AND NOT (n.nspname::text = ANY (CASE WHEN p.priv = 'USAGE' THEN r.usage_ok ELSE r.create_ok END))
    AND has_schema_privilege(x.oid, n.oid, p.priv)
    AND NOT (p.priv = 'USAGE' AND r.lecteur AND n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'matrix')
             AND EXISTS (SELECT FROM pg_class v
                         WHERE v.relnamespace = n.oid AND v.relkind = 'v' AND v.relname LIKE 'pub\_%'
                           AND has_table_privilege(x.oid, v.oid, 'SELECT')));

  -- Droit CREATE sur la base et attributs d'administration.
  RETURN QUERY
  SELECT 'erreur', r.rolname::text, 'droit CREATE sur la base (il permettrait de créer un schéma)'
  FROM pg_roles r
  WHERE r.rolname IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'matrix_app', 'matrix_lecture', 'matrix_admin', 'epc2i_sauvegarde')
    AND has_database_privilege(r.oid, v_db, 'CREATE');
  RETURN QUERY
  SELECT 'erreur', r.rolname::text, 'attribut d''administration (SUPERUSER, CREATEROLE, CREATEDB, REPLICATION ou BYPASSRLS)'
  FROM pg_roles r
  WHERE r.rolname IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'matrix_app', 'matrix_lecture', 'matrix_admin', 'epc2i_sauvegarde')
    AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls);

  -- Appartenances attendues.
  RETURN QUERY
  SELECT 'erreur', m.membre, format('doit être membre de %s', m.groupe)
  FROM (VALUES ('matrix_app', 'matrix_lecture'), ('epc2i_sauvegarde', 'pg_read_all_data')) AS m(membre, groupe)
  WHERE NOT pg_has_role(m.membre, m.groupe, 'USAGE');

  -- search_path des rôles de connexion.
  RETURN QUERY
  SELECT 'attention', r.nom, format('search_path attendu sur epc2i : %s', r.nsp)
  FROM (VALUES ('keystone_app', 'keystone'), ('codex_app', 'codex'), ('cursus_app', 'cursus'),
               ('vigie_app', 'vigie'), ('matrix_app', 'matrix')) AS r(nom, nsp)
  WHERE NOT EXISTS (SELECT FROM pg_db_role_setting d JOIN pg_roles x ON x.oid = d.setrole
                    WHERE x.rolname = r.nom AND d.setdatabase = v_db AND format('search_path=%s', r.nsp) = ANY (d.setconfig));

  -- Administrateurs nominatifs : requêtes journalisées.
  RETURN QUERY
  SELECT 'attention', m.rolname::text, 'membre de matrix_admin sans journalisation : CALL droits.declarer_admin(nom) ou ALTER ROLE … SET log_statement = ''all'''
  FROM pg_auth_members am
  JOIN pg_roles g ON g.oid = am.roleid AND g.rolname = 'matrix_admin'
  JOIN pg_roles m ON m.oid = am.member
  WHERE m.rolcanlogin
    AND NOT EXISTS (SELECT FROM pg_db_role_setting d
                    WHERE d.setrole = m.oid AND d.setdatabase IN (0, v_db) AND 'log_statement=all' = ANY (d.setconfig));

  -- Privilèges par défaut de matrix_lecture.
  RETURN QUERY
  SELECT 'attention', format('%s, schéma %s', r.nom, r.nsp), 'privilège par défaut SELECT pour matrix_lecture absent (rejouer init/03-droits.sql)'
  FROM (VALUES ('keystone_app', 'keystone'), ('codex_app', 'codex'), ('cursus_app', 'cursus'), ('vigie_app', 'vigie')) AS r(nom, nsp)
  WHERE NOT EXISTS (SELECT FROM pg_default_acl d
                    JOIN pg_roles x ON x.oid = d.defaclrole
                    JOIN pg_namespace n ON n.oid = d.defaclnamespace
                    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE x.rolname = r.nom AND n.nspname = r.nsp AND d.defaclobjtype = 'r'
                      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'matrix_lecture') AND a.privilege_type = 'SELECT');
END $$;
COMMENT ON FUNCTION droits.verifier() IS 'Écarts entre les droits réels et la convention (gravité erreur, attention, info), convention de partage comprise (USAGE et SELECT sur les seules vues pub_ pour les outils ; vues publiées sans colonne sensible). Aucune ligne erreur attendue.';

-- Administrateur nominatif : rôle de connexion, membre de matrix_admin, toutes ses requêtes journalisées.
-- Superutilisateur seulement. Le mot de passe se fixe ensuite avec \password <nom> (psql ne l'affiche pas).
CREATE OR REPLACE PROCEDURE droits.declarer_admin(p_nom text)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = p_nom) THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', p_nom);
  END IF;
  EXECUTE format('GRANT matrix_admin TO %I', p_nom);
  -- log_statement ne peut être changé que par un superutilisateur : l'administrateur ne peut pas le couper.
  EXECUTE format('ALTER ROLE %I SET log_statement TO %L', p_nom, 'all');
  RAISE NOTICE 'Administrateur % prêt. Fixez son mot de passe : \password %', p_nom, p_nom;
END $$;

-- ── 4. Liste des colonnes sensibles ─────────────────────────────────────
-- Ajouts proposés : seulement à la première installation (liste vide), pour ne pas défaire un retrait décidé
-- plus tard. Ils couvrent des copies de données de santé repérées dans Cursus (question P-04 du plan).
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine)
SELECT v.* FROM (VALUES
  ('cursus', 'journal', 'payload', 'Copie du corps des actions : naissance, visite médicale, vaccins, passeport (employe.creer, employe.modifier, formalite.enregistrer)', 'proposition'),
  ('cursus', 'journal', 'message', 'Message lisible : « Vaccination … enregistrée », « Passeport … valide jusqu''au … »', 'proposition'),
  ('cursus', 'demandes_collab', 'label', 'Libellé de demande : « Vaccination Fièvre jaune déclarée »', 'proposition')
) AS v(schema_nom, table_nom, colonne_nom, motif, origine)
WHERE NOT EXISTS (SELECT FROM droits.colonnes_sensibles);

-- Convention du 15/10/2026 : toujours présente, remise à chaque passage du script.
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'employes', 'visite', 'Santé : date de la visite médicale d''aptitude', 'convention'),
  ('cursus', 'employes', 'passeport_numero', 'Identité : numéro de passeport', 'convention'),
  ('cursus', 'employes', 'passeport_expire', 'Identité : fin de validité du passeport', 'convention'),
  ('cursus', 'employes', 'naissance', 'Identité : année de naissance', 'convention'),
  ('cursus', 'employes', 'reprise_motif', 'Santé ou vie privée : motif de l''absence longue', 'convention'),
  ('cursus', 'vaccinations', 'v', 'Santé : vaccin reçu', 'convention'),
  ('cursus', 'vaccinations', 'date', 'Santé : date d''injection', 'convention'),
  ('cursus', 'visas', 'type', 'Déplacement personnel : type de visa', 'convention'),
  ('cursus', 'visas', 'obtenu', 'Déplacement personnel : date d''obtention du visa', 'convention'),
  ('cursus', 'visas', 'expire', 'Déplacement personnel : fin de validité du visa', 'convention'),
  ('cursus', 'entretiens', 'cr', 'Vie professionnelle : compte rendu d''entretien', 'convention'),
  -- Ajouts du 22/10/2026 (8.b de Cursus) : contact d'urgence et pièces justificatives (arrêts, déclarations…).
  ('cursus', 'employes', 'urgence_nom', 'Vie privée : personne à prévenir en cas d''urgence', 'convention'),
  ('cursus', 'employes', 'urgence_tel', 'Vie privée : téléphone de la personne à prévenir', 'convention'),
  ('cursus', 'pieces', 'jeton', 'Sécurité : jeton de téléchargement d''une pièce justificative', 'convention'),
  ('cursus', 'pieces', 'nom', 'Santé ou vie privée : nom du fichier d''une pièce justificative', 'convention'),
  ('cursus', 'pieces', 'fichier', 'Santé ou vie privée : emplacement du fichier d''une pièce justificative', 'convention'),
  -- Suivi médical et identité (colonnes de Cursus relevées au 22/10/2026), même convention : aucune donnée de santé
  -- ni pièce d'identité lue par Matrix. Vaccinations et visas : tables fermées en entier.
  ('cursus', 'employes', 'naissance_le', 'Identité : date de naissance', 'convention'),
  ('cursus', 'employes', 'reprise_date', 'Santé ou vie privée : date de reprise après une absence longue', 'convention'),
  ('cursus', 'employes', 'avis', 'Santé : avis d''aptitude de la médecine du travail', 'convention'),
  ('cursus', 'employes', 'restrictions', 'Santé : restrictions d''aptitude', 'convention'),
  ('cursus', 'employes', 'suivi', 'Santé : type de suivi médical (VIP, VIP adapté, SIR)', 'convention'),
  ('cursus', 'employes', 'prochaine_visite', 'Santé : date de la prochaine visite médicale', 'convention'),
  ('cursus', 'employes', 'examen_aptitude', 'Santé : date de l''examen d''aptitude', 'convention'),
  ('cursus', 'employes', 'autorisation_travail', 'Identité : autorisation de travail (titre de séjour)', 'convention'),
  ('cursus', 'vaccinations', '*', 'Santé : vaccinations (table entière)', 'convention'),
  ('cursus', 'visas', '*', 'Déplacement personnel : visas (table entière)', 'convention'),
  ('vigie', 'events', 'injury', 'Santé : nature de la lésion (accident du travail)', 'convention'),
  ('vigie', 'events', 'lost_days', 'Santé : jours d''arrêt de travail', 'convention'),
  -- Données de santé d'un accident du travail (Vigie : HEALTH_LABELS de src/components/events/shared.ts, réservées à
  -- l'animateur QHSE et à la direction), application de la même convention (aucune donnée de santé lue par Matrix).
  ('vigie', 'events', 'cpam_declared_on', 'Santé : date de déclaration de l''accident du travail à la CPAM', 'convention'),
  ('vigie', 'events', 'lesion_nature', 'Santé : nature des lésions (déclaration d''accident du travail)', 'convention'),
  ('vigie', 'events', 'lesion_site', 'Santé : siège des lésions', 'convention'),
  ('vigie', 'events', 'care_given', 'Santé : soins dispensés, transport', 'convention'),
  ('vigie', 'events', 'reserves_on', 'Santé : date des réserves motivées adressées à la CPAM', 'convention'),
  ('vigie', 'events', 'cpam_waived_at', 'Santé : déclaration CPAM non faite par l''entreprise (date)', 'convention'),
  ('vigie', 'events', 'cpam_waived_by_id', 'Santé : déclaration CPAM non faite par l''entreprise (auteur)', 'convention'),
  ('vigie', 'events', 'cpam_waiver_reason', 'Santé : motif de l''absence de déclaration CPAM', 'convention'),
  -- Copies de ces données dans le journal des modifications (logChange : champs de HEALTH_LABELS avec leurs valeurs,
  -- noms des pièces médicales, inscriptions au registre des accidents bénins ; motif d'absence de déclaration CPAM).
  -- Matrix garde le reste du journal (entité, action, résumé, auteur, date), que publie aussi vigie.pub_journal.
  ('vigie', 'change_log', 'details', 'Santé (copie) : valeurs avant et après des champs modifiés, champs de santé d''un accident du travail compris', 'convention'),
  ('vigie', 'change_log', 'reason', 'Santé (copie) : motif saisi, dont le motif d''absence de déclaration CPAM', 'convention'),
  -- Tables fermées en entier (« * ») : registre des accidents bénins (soins, donneur de soins), journal des
  -- consultations (qui a lu quelle donnée de santé ou pièce médicale), pièces jointes (le nom d'une pièce médicale,
  -- par exemple un arrêt de travail, nomme souvent la victime ; attachments.health ne se filtre pas par colonne).
  ('vigie', 'benign_accidents', '*', 'Santé : registre des accidents du travail bénins (soins dispensés, donneur de soins)', 'convention'),
  ('vigie', 'access_log', '*', 'Journal des consultations : consultations des données de santé et des pièces médicales', 'convention'),
  ('vigie', 'attachments', '*', 'Santé : pièces médicales (attachments.health) et leurs noms de fichier', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;

-- ── 5. Déclencheurs ──────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER colonnes_sensibles_convention
  BEFORE UPDATE OR DELETE ON droits.colonnes_sensibles
  FOR EACH ROW EXECUTE FUNCTION droits._proteger_convention();
CREATE OR REPLACE TRIGGER colonnes_sensibles_appliquer
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON droits.colonnes_sensibles
  FOR EACH STATEMENT EXECUTE FUNCTION droits._sur_liste();

CREATE EVENT TRIGGER droits_ddl ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE',
               'CREATE VIEW', 'ALTER VIEW', 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW',
               'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE', 'IMPORT FOREIGN SCHEMA',
               'CREATE SEQUENCE', 'ALTER SEQUENCE', 'CREATE SCHEMA', 'GRANT', 'REVOKE')
  EXECUTE FUNCTION droits._sur_ddl();
CREATE EVENT TRIGGER droits_suppression ON sql_drop
  EXECUTE FUNCTION droits._sur_suppression();
COMMENT ON EVENT TRIGGER droits_ddl IS 'Réduit le SELECT de matrix_lecture aux colonnes non sensibles dès la création ou la modification d''une relation (infra/postgres/init/03-droits.sql).';
COMMENT ON EVENT TRIGGER droits_suppression IS 'Oublie les tables supprimées dans droits.relations_protegees.';

-- ── 6. Droits sur le schéma droits ──────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA droits FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA droits FROM PUBLIC;
GRANT SELECT ON droits.colonnes_sensibles TO matrix_lecture, matrix_admin;
GRANT INSERT, UPDATE, DELETE ON droits.colonnes_sensibles TO matrix_admin;
GRANT SELECT ON droits.relations_protegees TO matrix_admin;
GRANT SELECT ON droits.partage_lecteurs TO matrix_lecture, matrix_admin;
GRANT INSERT, DELETE ON droits.partage_lecteurs TO matrix_admin;
GRANT EXECUTE ON FUNCTION droits.verifier() TO matrix_lecture, matrix_admin;
GRANT EXECUTE ON FUNCTION droits.appliquer_droits() TO matrix_admin;

-- ── 7. Application immédiate (rejeu : remet les relations existantes en ordre) ──
SELECT droits.appliquer_droits() AS relations_controlees;

COMMIT;

\echo 'Étape 3 terminée. Écarts (erreur, attention) :'
SELECT gravite, objet, constat
FROM droits.verifier()
WHERE gravite <> 'info'
ORDER BY CASE gravite WHEN 'erreur' THEN 1 ELSE 2 END, objet;
