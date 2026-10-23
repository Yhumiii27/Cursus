-- Cursus : migration 0004 du schéma PostgreSQL, vue publiée pub_absences (demande CU-1 de Crucible, REQUESTS.md du
-- 22/10/2026, validée par Guillaume le 22/10/2026). Crucible planifie les opérateurs d'essai avec les moyens : il lui faut
-- savoir qui est absent et quand, jamais pourquoi. Droit de lecture accordé par 90-droits.sql de Matrix
-- (cursus.pub_absences → crucible_app, matrix_app) ; aucun GRANT ici.
--
-- Jamais publiés : le type d'absence (maladie, accident du travail, maternité… : donnée de santé ou de vie privée), le
-- motif de refus, les justificatifs, les demi-journées, l'auteur du signalement. Les absences refusées ne sont pas
-- publiées ; une absence annulée reste publiée avec annulee = true, pour qu'un lecteur retire l'indisponibilité.
--
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
--> statement-breakpoint
-- Prérequis : date de dernière modification de chaque absence, posée par la base à chaque écriture (Cursus ne la lit ni
-- ne l'écrit ; absente de TABLES, que le contrôle du schéma au démarrage tolère). Absences existantes : date de cette
-- migration.
ALTER TABLE "absences" ADD COLUMN "maj_le" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE FUNCTION "absences_maj_le"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.maj_le := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "absences_maj_le" BEFORE INSERT OR UPDATE ON "absences" FOR EACH ROW EXECUTE FUNCTION "absences_maj_le"();
--> statement-breakpoint
-- CU-1 · Absences : une ligne par absence demandée, validée, signalée ou annulée d'un salarié qui a un matricule.
-- statut : 'validee' (absence validée, ou signalée : arrêt, absence constatée) ou 'demandee' (en attente de décision) ;
-- pour une absence annulée, statut garde 'validee' et annulee vaut true.
CREATE VIEW "pub_absences" WITH (security_barrier) AS
SELECT e.matricule,
       a.du,
       a.au,
       CASE WHEN a.statut = 'demandee' THEN 'demandee' ELSE 'validee' END AS statut,
       (a.statut = 'annulee' OR a.annulee_le IS NOT NULL)                AS annulee,
       a.maj_le
FROM absences a
JOIN employes e ON e.id = a.emp_id
WHERE a.statut IN ('demandee', 'validee', 'signalee', 'annulee')
  AND e.matricule IS NOT NULL
  AND a.du IS NOT NULL AND a.au IS NOT NULL;
--> statement-breakpoint
COMMENT ON VIEW "pub_absences" IS 'Contrat CU-1 v1 (demande de Crucible) : qui est absent et quand. statut validee | demandee, annulee, maj_le. Jamais : type, motif de refus, justificatif, demi-journées, signalement. Absences refusées non publiées. Lecteurs : crucible_app, matrix_app.';
