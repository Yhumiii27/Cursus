-- Cursus : migration 0006 du schéma PostgreSQL, lot 7, chantier B (prévention), étape 1 : compte professionnel de
-- prévention (t052, shared/rules/c2p.ts). Deux colonnes ajoutées, aucune table (57 en tout) :
-- - postes.c2p : facteurs d'exposition que Cursus ne mesure pas (travail répétitif, milieu hyperbare, températures
--   extrêmes, bruit), cochés sur le poste par le service RH ou le référent HSE ; NULL : aucun (décochés par défaut) ;
-- - horaires.alternant : horaire d'un roulement en équipes successives alternantes ; NULL : pas encore qualifié (ses
--   nuits comptent au travail de nuit, signalées « à qualifier »), distinct de false (non alternant).
-- Rien n'est coché d'office : la migration nommée SQLite lot7-prevention-c2p ne modifie aucune donnée et n'écrit aucun
-- compte rendu (les horaires de nuit à qualifier sont signalés sur l'écran Expositions et dans Référentiels → Horaires),
-- il n'y a donc rien à reprendre ici. Aucune vue pub_ : les expositions restent à Cursus.
--
-- Mêmes règles que 0001_init.sql (types d'après les valeurs écrites par le code, CHECK des domaines fermés de
-- shared/types.ts, « dans le doute, pas de CHECK »). Noms non qualifiés, aucun droit : le déclencheur droits_ddl du socle
-- traite les colonnes ajoutées.
--> statement-breakpoint
ALTER TABLE "postes" ADD COLUMN "c2p" json CONSTRAINT "postes_c2p_check" CHECK ("c2p" IS NULL OR json_typeof("c2p") IN ('array', 'null'));
--> statement-breakpoint
ALTER TABLE "horaires" ADD COLUMN "alternant" json CONSTRAINT "horaires_alternant_check" CHECK ("alternant" IS NULL OR json_typeof("alternant") IN ('boolean', 'null'));
--> statement-breakpoint
COMMENT ON COLUMN "postes"."c2p" IS 'Prévention : facteurs d''exposition du C2P cochés sur le poste (repetitif, hyperbare, temperatures, bruit) ; null : aucun.';
COMMENT ON COLUMN "horaires"."alternant" IS 'Prévention : horaire en équipes successives alternantes (C2P, 50 nuits par an) ; null : à qualifier.';
