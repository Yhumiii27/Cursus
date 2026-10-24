-- Cursus : migration 0012 du schéma PostgreSQL, lot 8, chantier D (données personnelles sur le serveur commun),
-- étape 2 : chiffrement au repos des pièces justificatives du dépôt local (constat D6, server/src/pieces-chiffrement.ts).
-- Une colonne ajoutée, aucune table : pieces.chiffree, vrai quand le fichier du dossier des pièces est chiffré par Cursus
-- (AES-256-GCM, clé CURSUS_PIECES_KEY hors de la base). Les pièces déjà déposées valent false (écrites en clair, toujours
-- lisibles) ; npm run pieces:chiffrer les chiffre ensuite (server/src/pieces-chiffrer.ts). Même colonne en SQLite :
-- déclarée dans TABLES (server/src/db.ts), migration nommée lot8-pieces-chiffrees (server/src/migrations/lot8-pieces.ts).
--
-- Mêmes règles que 0001_init.sql (bool → boolean NOT NULL DEFAULT false). Noms non qualifiés, aucun droit : le
-- déclencheur droits_ddl du socle traite la colonne ajoutée. Ni la clé ni le contenu des fichiers ne sont en base ;
-- la colonne n'est pas sensible (elle dit seulement si le fichier est chiffré). Aucune vue pub_.
--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "chiffree" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "pieces"."chiffree" IS 'Personnel : fichier de la pièce chiffré au repos par Cursus (AES-256-GCM, clé hors de la base) ; false : écrit en clair avant le lot 8.';
