-- Cursus : migration 0014 du schéma PostgreSQL, lot 9, chantier 1 (journal des changements en base), étape 1. Aucune vue
-- pub_ touchée, aucune migration publiée modifiée :
-- 1. Journal des lignes changées (table `changements`) : pour chaque révision de la base (`revision.n`, migration 0013),
--    la table et la clé primaire de chaque ligne insérée, modifiée ou supprimée, écrites par déclencheur dans la
--    transaction de l'écriture, quelle que soit l'instance, la tâche de fond ou l'outil qui écrit (SQL direct compris).
--    Une transaction annulée n'y laisse rien. Le cache de l'instantané (server/src/cache-instantane.ts) peut ainsi passer
--    d'une révision à une autre en ne relisant que les lignes changées (`Db.lireChangements`, `Db.lireLignes`,
--    server/src/db.ts). Clé NULL : marqueur « toute la table » (TRUNCATE, instruction de plus de 1 000 lignes) : la
--    table est alors relue en entier.
-- 2. Colonnes `revision.purge` (plus haute révision dont les changements ont été purgés : un écart qui part d'en deçà est
--    inconnu, relecture complète) et `revision.epoque` (change quand la base est remplacée : relecture complète).
--    L'époque part de l'heure de création (millisecondes) ; sa lecture, la commande qui la change et la purge planifiée
--    viennent à l'étape 2 du chantier.
-- Les déclencheurs `revision_lignes_*` passent après le déclencheur `revision` de la même table (ordre alphabétique des
-- noms, même moment, même niveau) : ils lisent la révision que l'instruction vient d'augmenter. Tables exclues : celles de
-- la migration 0013 (journal des actions, sessions de connexion, comptes, abonnements à l'agenda, journal des
-- migrations, révision) et `changements` elle-même. Table technique (identifiants et noms de tables seulement), hors de
-- TABLES et de la déclaration à Matrix, mais qui révèle l'activité des tables, dans l'ordre des écritures : rapprochée des
-- lignes voisines d'une même transaction (fiche du salarié, journal), l'écriture d'une vaccination ou d'une demande de
-- visite désigne une donnée de santé. D'où, contre la lecture de matrix_lecture (droits par défaut du socle) :
-- - tables fermées en entier à Matrix (`vaccinations`, `visas` : socle ; `demandes_visite`, `informations_cp`,
--   `reprises` : demande du lot 8) inscrites sans clé, par le seul marqueur « toute la table » (petites tables, relues en
--   entier par le cache) ; même liste que `TABLES_CHANGEMENTS_SANS_CLE` (server/src/db.ts) ;
-- - `changements` elle-même fermée en entier (commentaire « Sensible », ligne de docs/demandes/matrix-lot8-colonnes-sensibles.sql).
--> statement-breakpoint
CREATE TABLE "changements" (
  "n" bigint NOT NULL,
  "tbl" text NOT NULL,
  "pk" text
);
--> statement-breakpoint
COMMENT ON TABLE "changements" IS 'Système : journal des lignes changées par révision de la base de Cursus (table, clé primaire ; clé NULL : toute la table), relecture partielle du cache de l''instantané. Sensible (table entière : l''ordre des écritures rattache l''activité des tables de santé à un salarié) : à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
CREATE INDEX "changements_n" ON "changements" USING btree ("n");
--> statement-breakpoint
ALTER TABLE "revision" ADD COLUMN "purge" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "revision" ADD COLUMN "epoque" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "revision" SET "epoque" = (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
--> statement-breakpoint
-- TRUNCATE : marqueur « toute la table », à la révision que le déclencheur `revision` vient d'augmenter.
CREATE FUNCTION "revision_lignes_tronquee"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO changements (n, tbl, pk) SELECT n, TG_TABLE_NAME, NULL FROM revision;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Par table : trois fonctions (insertion, modification, suppression) écrites pour sa clé primaire, sans to_jsonb, et
-- leurs déclencheurs par instruction avec la table de transition (`nouvelles`, `anciennes`). Une modification inscrit
-- l'ancienne et la nouvelle clé (clé changée : la ligne quitte l'une et arrive à l'autre). Au-delà de 1 000 lignes dans
-- une instruction, un seul marqueur NULL ; table fermée à Matrix : le marqueur NULL seul. Le nom inscrit est celui de la
-- table au moment de l'écriture (TG_TABLE_NAME), pas celui de la création : une table renommée plus tard garde des
-- déclencheurs justes. Une table sans clé primaire simple arrête la migration.
DO $$
DECLARE
  t text;
  k text;
  corps text;
  i_cles text;
  u_cles text;
  d_cles text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
    AND tablename NOT IN ('journal', 'connexions', 'comptes', 'jetons_agenda', 'schema_migrations', 'revision', 'changements') ORDER BY tablename
  LOOP
    SELECT min(a.attname) INTO k FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = format('%I.%I', current_schema(), t)::regclass AND i.indisprimary HAVING count(*) = 1;
    IF k IS NULL THEN
      RAISE EXCEPTION 'table % sans clé primaire simple : journal des changements impossible', t;
    END IF;
    IF t IN ('vaccinations', 'visas', 'demandes_visite', 'informations_cp', 'reprises') THEN
      i_cles := 'SELECT NULL::text AS k';
      u_cles := i_cles;
      d_cles := i_cles;
    ELSE
      i_cles := format('SELECT (%I)::text AS k FROM nouvelles', k);
      u_cles := format('SELECT (%1$I)::text AS k FROM nouvelles UNION SELECT (%1$I)::text FROM anciennes', k);
      d_cles := format('SELECT (%I)::text AS k FROM anciennes', k);
    END IF;
    -- %1$s : lignes à inscrire (requête sur la table de transition) ; %2$s : table compteuse.
    corps := $f$
DECLARE r bigint; c bigint;
BEGIN
  SELECT n INTO r FROM revision;
  SELECT count(*) INTO c FROM (SELECT 1 FROM %2$s LIMIT 1001) x;
  IF c > 1000 THEN
    INSERT INTO changements (n, tbl, pk) VALUES (r, TG_TABLE_NAME, NULL);
  ELSIF c > 0 THEN
    INSERT INTO changements (n, tbl, pk) SELECT r, TG_TABLE_NAME, x.k FROM (%1$s) x;
  END IF;
  RETURN NULL;
END
$f$;
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_i',
      format(corps, i_cles, 'nouvelles'));
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_u',
      format(corps, u_cles, 'nouvelles'));
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_d',
      format(corps, d_cles, 'anciennes'));
    EXECUTE format('CREATE TRIGGER revision_lignes_i AFTER INSERT ON %I REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_i');
    EXECUTE format('CREATE TRIGGER revision_lignes_u AFTER UPDATE ON %I REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_u');
    EXECUTE format('CREATE TRIGGER revision_lignes_d AFTER DELETE ON %I REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_d');
    EXECUTE format('CREATE TRIGGER revision_lignes_t AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION revision_lignes_tronquee()', t);
  END LOOP;
END
$$;
