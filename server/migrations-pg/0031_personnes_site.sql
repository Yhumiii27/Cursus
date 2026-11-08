-- Cursus : migration 0031 du schéma PostgreSQL, lot 14 (personnes sur site : demande de Vigie du 4 novembre 2026, décision
-- CV-10 ; shared/rules/personnes-site.ts). Aucune vue pub_ (décision M-18 de Matrix : les vues pub_ de Cursus sont
-- définies par Matrix, tests/m18-publications.test.ts), aucune migration publiée modifiée :
-- 1. employes.exterieur : fiche d'un salarié d'entreprise extérieure (sans contrat avec l'entreprise ; rangée à part dans
--    l'instantané, hors paie, congés, temps, entretiens, effectifs) ; employes.entreprise : sa raison sociale (l'agence d'un
--    intérimaire reste dans employes.agence).
-- 2. employes.matricule_site : matricule de site permanent, I00001 pour un intérimaire, E00001 pour un extérieur ; unique,
--    jamais réattribué ; le matricule Cursus (employes.matricule, EMP-…) reste l'identifiant échangé avec Keystone (choix du
--    propriétaire du 5 novembre 2026).
-- 3. Reprise : chaque intérimaire existant reçoit son matricule I, dans l'ordre des fiches.
-- Les colonnes à publier (catégorie, entreprise, matricule de site) sont décrites à Matrix :
-- docs/demandes/matrix-lot14-personnes-site.md. Noms non qualifiés, aucun droit.
--> statement-breakpoint
ALTER TABLE "employes" ADD COLUMN "exterieur" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "employes" ADD COLUMN "entreprise" text;
--> statement-breakpoint
ALTER TABLE "employes" ADD COLUMN "matricule_site" text CONSTRAINT "employes_matricule_site_check" CHECK ("matricule_site" ~ '^[IE][0-9]{5}$');
--> statement-breakpoint
ALTER TABLE "employes" ADD CONSTRAINT "employes_matricule_site_unique" UNIQUE ("matricule_site");
--> statement-breakpoint
-- Un extérieur n'est jamais intérimaire, et son matricule de site commence par E ; celui d'un intérimaire par I.
ALTER TABLE "employes" ADD CONSTRAINT "employes_exterieur_check" CHECK (NOT "exterieur" OR "type_contrat" IS DISTINCT FROM 'interim');
--> statement-breakpoint
ALTER TABLE "employes" ADD CONSTRAINT "employes_matricule_site_prefixe_check" CHECK ("matricule_site" IS NULL OR left("matricule_site", 1) = CASE WHEN "exterieur" THEN 'E' ELSE 'I' END);
--> statement-breakpoint
-- ═══ Reprise : matricule I des intérimaires existants ═══
UPDATE "employes" e SET "matricule_site" = 'I' || lpad(n.rang::text, 5, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "id") AS rang FROM "employes" WHERE "type_contrat" = 'interim' AND NOT "exterieur") n
WHERE e."id" = n."id";
--> statement-breakpoint
COMMENT ON COLUMN "employes"."exterieur" IS 'Salarié d''une entreprise extérieure (sans contrat avec l''entreprise) : fiche pour ses titres et ses venues sur site.';
--> statement-breakpoint
COMMENT ON COLUMN "employes"."entreprise" IS 'Raison sociale de l''entreprise d''un extérieur (l''agence d''un intérimaire est dans agence).';
--> statement-breakpoint
COMMENT ON COLUMN "employes"."matricule_site" IS 'Matricule de site permanent : I pour un intérimaire, E pour un extérieur (décision CV-10, demande de Vigie du 4 novembre 2026).';
