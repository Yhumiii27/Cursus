-- Cursus : migration 0035 du schéma PostgreSQL, journal des actions en ajout seul (Norma § 4, point CU-N03 du reste à
-- faire ; décision du propriétaire du 25 novembre 2026 : « ok pour la purge par rôle dédié sur Cursus »). Aucune vue
-- pub_ créée ni modifiée (M-18), aucune colonne lue par une publication changée, aucune migration publiée modifiée.
-- 1. Le journal (`journal`) n'accepte plus ni UPDATE, ni DELETE, ni TRUNCATE, quel que soit le rôle (cursus_app, son
--    propriétaire, compris) ; une seule exception : DELETE d'une ligne échue, fait par le rôle dédié `cursus_purge`
--    pendant la fonction `purger_journal()`. Ligne échue : plus de 36 mois, ou plus de 12 mois pour une ligne qui n'est
--    pas liée à la paie (durées de conservation décidées, shared/journal.ts), comptées depuis le début du jour.
-- 2. `purger_journal()` (SECURITY INVOKER, search_path figé, EXECUTE retiré à PUBLIC) : appelée par la tâche de purge de
--    Cursus sur sa propre connexion (CURSUS_PURGE_DATABASE_URL, rôle cursus_purge), elle supprime les seules lignes
--    échues (aucun paramètre, aucun autre filtre) et ajoute une ligne au registre `journal_purges` (date, règle, limites,
--    nombres, dates de la plus ancienne et de la plus récente ligne supprimée ; jamais leur contenu).
-- 3. `journal_actions_paie` : codes des actions liées à la paie (ACTIONS_PAIE de shared/journal.ts), inscrits par Cursus au
--    démarrage, jamais retirés : une action devenue « liée à la paie » vaut aussi pour les lignes déjà écrites (3 ans au
--    lieu d'1), sans modifier ces lignes (remplace l'ancien UPDATE … SET paie = TRUE de `marquerPaie`).
-- 4. `journal.regroupe` : une action répétée du même compte sur le même objet (avancement d'un objectif, rédaction d'un
--    compte rendu, consultation de l'archive) n'est plus fusionnée dans la ligne précédente (UPDATE) : elle est ajoutée,
--    rattachée à la première ligne du groupe, et l'écran réunit le groupe à la lecture (server/src/journal.ts).
-- 5. `journal_purges` et `journal_actions_paie` sont eux aussi en ajout seul.
-- Le rôle cursus_purge n'est pas créé ici (Cursus ne crée ni rôle ni droit sur le serveur commun) : il l'est par le socle de
-- Matrix (infra/postgres/init/01-base-et-roles.sql), qui lui accorde aussi ses droits (03-droits.sql) : CONNECT sur la base,
-- USAGE sur le schéma, SELECT (id, at, action, paie) et DELETE sur journal, SELECT sur journal_actions_paie, INSERT et
-- SELECT (id) sur journal_purges, EXECUTE sur purger_journal(), rien d'autre (server/src/journal-purge.ts, `droitsPurgeSql`). Rôle ou droits absents : la purge échoue sans rien supprimer
-- (server/src/journal-purge.ts le dit). Ici, les noms ne sont que du texte : la migration passe sans le rôle.
-- Limite : le propriétaire des tables (cursus_app) peut encore désactiver un déclencheur (ALTER TABLE … DISABLE TRIGGER) ;
-- Cursus refuse de démarrer si les déclencheurs manquent ou sont désactivés (server/src/db-pg.ts, `controlerSchema`), et
-- droits.verifier() de Matrix le signale.
--> statement-breakpoint
SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_temp', true);
--> statement-breakpoint
-- ═══ 4. Groupes d'actions répétées ═══
ALTER TABLE "journal" ADD COLUMN "regroupe" integer;
--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_regroupe_anterieure" CHECK ("regroupe" IS NULL OR "regroupe" < "id");
--> statement-breakpoint
CREATE INDEX "journal_regroupe" ON "journal" USING btree ("regroupe") WHERE "regroupe" IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "journal"."regroupe" IS 'Première ligne du groupe (action répétée du même compte sur le même objet), réuni à la lecture ; NULL : ligne de tête.';
--> statement-breakpoint
-- ═══ 3. Actions liées à la paie ═══
CREATE TABLE "journal_actions_paie" (
  "action" text PRIMARY KEY,
  "depuis" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journal_actions_paie_action_forme" CHECK ("action" ~ '^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$')
);
--> statement-breakpoint
COMMENT ON TABLE "journal_actions_paie" IS 'Codes des actions liées à la paie (conservées 3 ans au journal au lieu d''1), inscrits par Cursus au démarrage ; en ajout seul. Aucune donnée personnelle.';
--> statement-breakpoint
-- ═══ 2. Registre des purges ═══
CREATE TABLE "journal_purges" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "le" timestamp with time zone DEFAULT now() NOT NULL,
  "par" text DEFAULT session_user NOT NULL,
  "regle" text NOT NULL,
  "limite_journal" timestamp with time zone NOT NULL,
  "limite_paie" timestamp with time zone NOT NULL,
  "supprimees_un_an" integer NOT NULL,
  "supprimees_trois_ans" integer NOT NULL,
  "plus_ancienne" timestamp with time zone,
  "plus_recente" timestamp with time zone,
  CONSTRAINT "journal_purges_par_non_vide" CHECK (btrim("par") <> ''),
  CONSTRAINT "journal_purges_regle_non_vide" CHECK (btrim("regle") <> ''),
  CONSTRAINT "journal_purges_limites" CHECK ("limite_paie" < "limite_journal" AND "limite_journal" <= "le"),
  CONSTRAINT "journal_purges_nombres" CHECK ("supprimees_un_an" >= 0 AND "supprimees_trois_ans" >= 0),
  CONSTRAINT "journal_purges_dates" CHECK (
    ("supprimees_un_an" + "supprimees_trois_ans" = 0) = ("plus_ancienne" IS NULL)
    AND ("plus_ancienne" IS NULL) = ("plus_recente" IS NULL)
    AND ("plus_ancienne" IS NULL OR ("plus_ancienne" <= "plus_recente" AND "plus_recente" < "limite_journal")))
);
--> statement-breakpoint
COMMENT ON TABLE "journal_purges" IS 'Registre des purges du journal des actions (conservation RGPD) : une ligne par passage de purger_journal() ; date, règle, limites, nombres, dates extrêmes, jamais le contenu des lignes. En ajout seul. Aucune donnée personnelle.';
--> statement-breakpoint
-- ═══ 1. Journal en ajout seul ═══
-- Ligne échue (même règle que purger_journal, limites prises au début du jour de la transaction) supprimée par
-- cursus_purge pendant la purge : seule exception. TRUNCATE : toujours refusé.
CREATE FUNCTION "journal_ajout_seul"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user = 'cursus_purge' AND current_setting('cursus.purge_journal', true) = 'on' THEN
      IF OLD.at < date_trunc('day', now()) - interval '36 months' THEN
        RETURN OLD;
      END IF;
      IF OLD.at < date_trunc('day', now()) - interval '12 months'
         AND NOT (coalesce(OLD.paie, false) OR OLD.action LIKE 'sage.%'
                  OR EXISTS (SELECT 1 FROM journal_actions_paie a WHERE a.action = OLD.action)) THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0C01',
    MESSAGE = format('Journal des actions de Cursus en ajout seul (Norma § 4) : %s refusé sur %I.', TG_OP, TG_TABLE_NAME),
    HINT = 'Seule la purge des lignes échues (12 mois, 36 mois pour la paie) par le rôle cursus_purge, fonction purger_journal(), peut supprimer.';
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_ajout_seul" BEFORE UPDATE OR DELETE ON "journal" FOR EACH ROW EXECUTE FUNCTION "journal_ajout_seul"();
--> statement-breakpoint
CREATE TRIGGER "journal_ajout_seul_vidage" BEFORE TRUNCATE ON "journal" FOR EACH STATEMENT EXECUTE FUNCTION "journal_ajout_seul"();
--> statement-breakpoint
-- ═══ 5. Registre et codes de la paie en ajout seul ═══
CREATE FUNCTION "ajout_seul"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0C01',
    MESSAGE = format('Table %I de Cursus en ajout seul (Norma § 4) : %s refusé.', TG_TABLE_NAME, TG_OP);
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_purges_ajout_seul" BEFORE UPDATE OR DELETE ON "journal_purges" FOR EACH ROW EXECUTE FUNCTION "ajout_seul"();
--> statement-breakpoint
CREATE TRIGGER "journal_purges_ajout_seul_vidage" BEFORE TRUNCATE ON "journal_purges" FOR EACH STATEMENT EXECUTE FUNCTION "ajout_seul"();
--> statement-breakpoint
CREATE TRIGGER "journal_actions_paie_ajout_seul" BEFORE UPDATE OR DELETE ON "journal_actions_paie" FOR EACH ROW EXECUTE FUNCTION "ajout_seul"();
--> statement-breakpoint
CREATE TRIGGER "journal_actions_paie_ajout_seul_vidage" BEFORE TRUNCATE ON "journal_actions_paie" FOR EACH STATEMENT EXECUTE FUNCTION "ajout_seul"();
--> statement-breakpoint
-- ═══ 2. Purge des lignes échues ═══
-- SECURITY INVOKER : elle supprime avec les droits de son appelant, qui doit être cursus_purge (vérifié ici et par le
-- déclencheur) ; le propriétaire du schéma qui l'appellerait serait refusé. Aucun paramètre : la règle est écrite ici.
CREATE FUNCTION "purger_journal"()
RETURNS TABLE ("registre" integer, "supprimees_un_an" integer, "supprimees_trois_ans" integer, "plus_ancienne" timestamp with time zone, "plus_recente" timestamp with time zone)
LANGUAGE plpgsql SECURITY INVOKER SET search_path FROM CURRENT AS $$
DECLARE
  v_un timestamp with time zone := date_trunc('day', now()) - interval '12 months';
  v_trois timestamp with time zone := date_trunc('day', now()) - interval '36 months';
  v_un_an integer;
  v_trois_ans integer;
  v_min timestamp with time zone;
  v_max timestamp with time zone;
  v_id integer;
BEGIN
  IF session_user <> 'cursus_purge' OR current_user <> 'cursus_purge' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0C02',
      MESSAGE = format('purger_journal() est réservée au rôle cursus_purge (connexion : %s).', session_user);
  END IF;
  -- Deux instances qui purgent ensemble : l'une après l'autre (la seconde ne trouve plus rien).
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.purge_journal'));
  PERFORM set_config('cursus.purge_journal', 'on', true);
  WITH d AS (
    DELETE FROM journal j
    WHERE j.at < v_trois
       OR (j.at < v_un AND NOT (coalesce(j.paie, false) OR j.action LIKE 'sage.%'
                                OR EXISTS (SELECT 1 FROM journal_actions_paie a WHERE a.action = j.action)))
    RETURNING j.at
  )
  SELECT count(*) FILTER (WHERE d.at >= v_trois), count(*) FILTER (WHERE d.at < v_trois), min(d.at), max(d.at)
    INTO v_un_an, v_trois_ans, v_min, v_max FROM d;
  PERFORM set_config('cursus.purge_journal', 'off', true);
  INSERT INTO journal_purges (regle, limite_journal, limite_paie, supprimees_un_an, supprimees_trois_ans, plus_ancienne, plus_recente)
  VALUES ('12 mois ; 36 mois pour les actions liées à la paie (comptés depuis le début du jour)', v_un, v_trois, v_un_an, v_trois_ans, v_min, v_max)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_un_an, v_trois_ans, v_min, v_max;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "purger_journal"() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "journal_ajout_seul"() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "ajout_seul"() FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION "purger_journal"() IS 'Conservation RGPD du journal (décision du propriétaire du 25/11/2026) : supprime les lignes échues (12 mois ; 36 mois pour la paie) et inscrit le passage dans journal_purges. Réservée au rôle cursus_purge (droit accordé par le socle de Matrix).';
