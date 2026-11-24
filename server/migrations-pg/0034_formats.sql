-- Cursus : migration 0034 du schéma PostgreSQL, formats dans la base (Norma § 4, point CU-191 du reste à faire) : les
-- colonnes que 0001 à 0033 laissaient sans contrainte reçoivent la leur. Aucune vue pub_ créée ni modifiée (M-18), aucune
-- colonne lue par une publication changée, aucune migration publiée modifiée.
-- 1. Noms et libellés non vides (btrim(…) <> '' ; NULL reste admis là où la colonne l'admet).
-- 2. Forme des codes choisis une fois pour toutes, mêmes expressions que les règles du code (shared/rules/…).
-- 3. Cohérence entre colonnes : une fin de période n'est pas avant son début (NULL : période ouverte).
-- Les clés étrangères des références contrôlées (server/src/integrite.ts) et les domaines des états sont déjà déclarés
-- par 0001 et les migrations suivantes. Les copies tenues par Keystone (missions, tâches, chantiers : dates et types tels
-- que Keystone les publie) ne reçoivent pas de règle entre colonnes : Cursus ne les écrit pas lui-même. Restent aussi sans
-- règle : l'identifiant d'une formation ou d'une habilitation (CODE_TITRE ne vaut que pour les codes créés dans Cursus ;
-- une reprise garde ceux de l'existant) et la fin d'une affectation au roulement (la veille du début est admise : fin
-- d'une affectation pas encore commencée).
-- Contraintes posées NOT VALID (contrôle des lignes écrites ensuite), puis validées dans la même transaction quand les
-- lignes existantes les respectent ; une base qui en porte une contraire garde la contrainte non validée, sans bloquer la
-- mise à jour (avertissement dans le journal du serveur PostgreSQL) : la ligne se corrige, puis
-- ALTER TABLE … VALIDATE CONSTRAINT … (docs/DEPLOIEMENT.md). Aucune ligne n'est modifiée ni supprimée.
--> statement-breakpoint
-- ═══ 1. Noms et libellés non vides ═══
ALTER TABLE "chantiers" ADD CONSTRAINT "chantiers_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "comptes" ADD CONSTRAINT "comptes_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "declarations_presence" ADD CONSTRAINT "declarations_presence_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "demandes_collab" ADD CONSTRAINT "demandes_collab_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
ALTER TABLE "employes" ADD CONSTRAINT "employes_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "entites" ADD CONSTRAINT "entites_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "equipes" ADD CONSTRAINT "equipes_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "formations" ADD CONSTRAINT "formations_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "formations_suivies" ADD CONSTRAINT "formations_suivies_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
ALTER TABLE "habilitations" ADD CONSTRAINT "habilitations_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "horaires" ADD CONSTRAINT "horaires_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "objectifs" ADD CONSTRAINT "objectifs_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
ALTER TABLE "organisme_contacts" ADD CONSTRAINT "organisme_contacts_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "plan_actions" ADD CONSTRAINT "plan_actions_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
ALTER TABLE "postes" ADD CONSTRAINT "postes_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "projets" ADD CONSTRAINT "projets_nom_non_vide" CHECK (btrim("nom") <> '') NOT VALID;
ALTER TABLE "sites" ADD CONSTRAINT "sites_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
ALTER TABLE "zones_pointage" ADD CONSTRAINT "zones_pointage_libelle_non_vide" CHECK (btrim("libelle") <> '') NOT VALID;
--> statement-breakpoint
-- ═══ 2. Forme des codes ═══
-- CODE_HORAIRE, shared/rules/horaires.ts
ALTER TABLE "horaires" ADD CONSTRAINT "horaires_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9]{0,5}$') NOT VALID;
-- CODE_PAYS, shared/rules/referentiels.ts
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_code_format" CHECK ("code" ~ '^[A-Z]{2}$') NOT VALID;
-- CODE_MODULE, shared/rules/elearning.ts
ALTER TABLE "modules_elearning" ADD CONSTRAINT "modules_elearning_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$') NOT VALID;
-- CODE_ORGANISME, shared/rules/organismes.ts
ALTER TABLE "organismes" ADD CONSTRAINT "organismes_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$') NOT VALID;
--> statement-breakpoint
-- ═══ 3. Fin de période après son début ═══
ALTER TABLE "absences" ADD CONSTRAINT "absences_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "deplacements_paie" ADD CONSTRAINT "deplacements_paie_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "formations_suivies" ADD CONSTRAINT "formations_suivies_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "informations_cp" ADD CONSTRAINT "informations_cp_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_au_apres_du" CHECK ("du" IS NULL OR "au" IS NULL OR "au" >= "du") NOT VALID;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_fin_apres_date" CHECK ("date" IS NULL OR "fin" IS NULL OR "fin" >= "date") NOT VALID;
ALTER TABLE "contrats_historique" ADD CONSTRAINT "contrats_historique_jusquau_apres_effet" CHECK ("effet" IS NULL OR "jusquau" IS NULL OR "jusquau" >= "effet") NOT VALID;
--> statement-breakpoint
-- ═══ Validation des lignes existantes ═══
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE connamespace = current_schema()::regnamespace AND contype = 'c' AND NOT convalidated
      AND (conname LIKE '%\_non\_vide' OR conname LIKE '%\_format' OR conname LIKE '%\_apres\_%')
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'Cursus 0034 : contrainte % de % non validée (lignes existantes contraires, à corriger)', c.conname, c.tbl;
    END;
  END LOOP;
END $$;
