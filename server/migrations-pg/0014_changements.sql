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
-- migrations, révision) et `changements` elle-même. Table technique, sans donnée personnelle (identifiants seulement),
-- hors de TABLES et de la déclaration à Matrix.
--> statement-breakpoint
CREATE TABLE "changements" (
  "n" bigint NOT NULL,
  "tbl" text NOT NULL,
  "pk" text
);
--> statement-breakpoint
COMMENT ON TABLE "changements" IS 'Journal des lignes changées par révision de la base de Cursus (table, clé primaire ; clé NULL : toute la table) : relecture partielle du cache de l''instantané. Aucune donnée personnelle.';
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
-- une instruction, un seul marqueur NULL. Une table sans clé primaire simple arrête la migration.
DO $$
DECLARE
  t text;
  k text;
  corps text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
    AND tablename NOT IN ('journal', 'connexions', 'comptes', 'jetons_agenda', 'schema_migrations', 'revision', 'changements') ORDER BY tablename
  LOOP
    SELECT min(a.attname) INTO k FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = format('%I.%I', current_schema(), t)::regclass AND i.indisprimary HAVING count(*) = 1;
    IF k IS NULL THEN
      RAISE EXCEPTION 'table % sans clé primaire simple : journal des changements impossible', t;
    END IF;
    -- %1$L : nom de la table ; %2$s : lignes à inscrire (requête sur la table de transition) ; %3$s : table compteuse.
    corps := $f$
DECLARE r bigint; c bigint;
BEGIN
  SELECT n INTO r FROM revision;
  SELECT count(*) INTO c FROM (SELECT 1 FROM %3$s LIMIT 1001) x;
  IF c > 1000 THEN
    INSERT INTO changements (n, tbl, pk) VALUES (r, %1$L, NULL);
  ELSIF c > 0 THEN
    INSERT INTO changements (n, tbl, pk) SELECT r, %1$L, x.k FROM (%2$s) x;
  END IF;
  RETURN NULL;
END
$f$;
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_i',
      format(corps, t, format('SELECT (%I)::text AS k FROM nouvelles', k), 'nouvelles'));
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_u',
      format(corps, t, format('SELECT (%1$I)::text AS k FROM nouvelles UNION SELECT (%1$I)::text FROM anciennes', k), 'nouvelles'));
    EXECUTE format('CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS %L', 'revision_lignes_' || t || '_d',
      format(corps, t, format('SELECT (%I)::text AS k FROM anciennes', k), 'anciennes'));
    EXECUTE format('CREATE TRIGGER revision_lignes_i AFTER INSERT ON %I REFERENCING NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_i');
    EXECUTE format('CREATE TRIGGER revision_lignes_u AFTER UPDATE ON %I REFERENCING OLD TABLE AS anciennes NEW TABLE AS nouvelles FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_u');
    EXECUTE format('CREATE TRIGGER revision_lignes_d AFTER DELETE ON %I REFERENCING OLD TABLE AS anciennes FOR EACH STATEMENT EXECUTE FUNCTION %I()', t, 'revision_lignes_' || t || '_d');
    EXECUTE format('CREATE TRIGGER revision_lignes_t AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION revision_lignes_tronquee()', t);
  END LOOP;
END
$$;
