-- Cursus : migration 0013 du schéma PostgreSQL, lot 8, chantier E (montée en charge), étape 2. Deux objets, aucune vue
-- pub_ touchée :
-- 1. Index du journal (compte_id, action, id DESC) : regroupement des actions répétées d'un même compte
--    (server/src/journal.ts, `regrouper`) et dernière consultation d'une pièce (server/src/pieces-routes.ts) cherchent
--    les dernières lignes d'un compte pour une action ; seuls journal(at) et journal(action) étaient indexés
--    (300 000 lignes après 5 ans). Même index en SQLite : migration nommée lot8-index-journal.
-- 2. Révision de la base (table `revision`, une seule ligne) : augmentée par un déclencheur, une fois par instruction, à
--    chaque écriture d'une table que lit l'instantané (toutes les tables de Cursus sauf le journal des actions et les
--    sessions de connexion, écrits à chaque consultation). L'instantané en cache (server/src/cache-instantane.ts) est
--    indexé par cette révision, lue au début de chaque lecture stable : une écriture validée par n'importe quelle
--    instance, tâche de fond ou outil (purge, reprise) le rend périmé. Écrite dans la transaction de l'écriture, la
--    révision n'est visible qu'avec elle et disparaît avec elle si la transaction est annulée. Une table ajoutée plus tard
--    reçoit son déclencheur dans sa migration : le démarrage le contrôle (server/src/db-pg.ts, `controlerSchema`).
--    Aucune donnée personnelle ; table technique, hors de TABLES et de la déclaration à Matrix.
--> statement-breakpoint
CREATE INDEX "journal_compte_action" ON "journal" USING btree ("compte_id", "action", "id" DESC);
--> statement-breakpoint
CREATE TABLE "revision" (
  "cle" boolean PRIMARY KEY DEFAULT true CHECK ("cle"),
  "n" bigint NOT NULL
);
--> statement-breakpoint
COMMENT ON TABLE "revision" IS 'Révision de la base de Cursus (une ligne) : augmentée à chaque écriture d''une table lue par l''instantané ; clé du cache de l''instantané. Aucune donnée personnelle.';
--> statement-breakpoint
INSERT INTO "revision" ("cle", "n") VALUES (true, 0);
--> statement-breakpoint
-- search_path figé à la création : la révision du schéma de Cursus, quelle que soit la session qui écrit.
CREATE FUNCTION "revision_suivante"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE revision SET n = n + 1;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Un déclencheur par table du schéma (instruction entière : une insertion de mille lignes l'augmente une fois), sauf le
-- journal des actions, les sessions de connexion, le journal des migrations et la révision elle-même.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
    AND tablename NOT IN ('journal', 'connexions', 'schema_migrations', 'revision') ORDER BY tablename
  LOOP
    EXECUTE format('CREATE TRIGGER revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION revision_suivante()', t);
  END LOOP;
END
$$;
