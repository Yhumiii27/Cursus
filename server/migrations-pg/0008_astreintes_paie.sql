-- Cursus : migration 0008 du schéma PostgreSQL, astreintes dans la paie (lot 7, chantier A, étape 2, t049 ;
-- server/src/astreintes-paie.ts) : heures (AST_H) et périodes (AST_PER) des astreintes terminées, famille « astreintes » du
-- registre des éléments de lot. 3 colonnes ajoutées, aucune table : lot qui emporte l'astreinte et import
-- confirmé (astreintes.lot_id, astreintes.sage), astreintes du lot (lots_paie.astreintes, comme lots_paie.rachats de
-- 0003_lot6_etape2.sql). Les rubriques AST_H, AST_PER et AST_COMP n'ont pas de ligne en base tant que la paie ne les a pas
-- réglées (désactivées par défaut : shared/constants.ts). Une base SQLite existante passe par npm run reprise-postgres.
--
-- Mêmes règles que 0001_init.sql (types d'après les valeurs écrites par le code, clés étrangères des références de
-- server/src/integrite.ts). Noms non qualifiés, aucun droit : le déclencheur droits_ddl du socle ne concerne que les tables.
-- Aucune vue pub_.
--> statement-breakpoint
ALTER TABLE "astreintes" ADD COLUMN "lot_id" integer;
--> statement-breakpoint
ALTER TABLE "astreintes" ADD COLUMN "sage" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "lots_paie" ADD COLUMN "astreintes" json;
--> statement-breakpoint
-- ═══ Clé étrangère (référence de server/src/integrite.ts) ═══
ALTER TABLE "astreintes" ADD CONSTRAINT "astreintes_lot_id_lots_paie_id_fk" FOREIGN KEY ("lot_id") REFERENCES "lots_paie"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ═══ Index de lecture (comme la migration nommée lot7-astreintes-paie-index de SQLite) ═══
CREATE INDEX "astreintes_lot" ON "astreintes" USING btree ("lot_id");
--> statement-breakpoint
COMMENT ON COLUMN "astreintes"."lot_id" IS 'Paie : lot qui emporte les heures et la période de l''astreinte terminée (AST_H, AST_PER).';
