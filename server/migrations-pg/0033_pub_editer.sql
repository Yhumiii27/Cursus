-- Cursus : migration 0033 du schéma PostgreSQL, lot 15 (demande M-19 de Matrix du 5 novembre 2026 ; périmètre choisi par le
-- propriétaire le 9 novembre 2026 : « Libellés des référentiels »). Fonction `pub_editer` : la DSI corrige depuis la
-- visionneuse de Matrix quelques libellés des référentiels de Cursus, par cette fonction, avec les contrôles et le journal
-- de Cursus. Matrix n'écrit jamais dans les tables de Cursus (M-18) ; le droit d'exécution est un lien « écriture »
-- matrix_app → cursus.pub_editer, décidé dans Matrix. Aucune vue pub_ (tests/m18-publications.test.ts).
-- Ouvert (tout le reste est refusé, avec un message qui renvoie vers Cursus) :
--   - action « corriger » seulement : ajouter un élément (code, type, validité, prérequis…) ou le retirer (archivage
--     refusé tant qu'une habilitation l'exige ou qu'une session est ouverte, demandes en attente) se fait dans Cursus,
--     écran Référentiels ;
--   - colonnes descriptives sans effet hors de la ligne, mêmes contrôles que les formulaires de Cursus
--     (shared/rules/referentiels.ts, organismes.ts, elearning.ts) :
--       formations (clé id) : nom, court, duree, cout, duree_heures ;
--       habilitations (clé id) : nom, detail, signataire ;
--       destinations (clé code) : pays, visa_sub ;
--       organismes (clé id) : raison_sociale, adresse, site_web, conditions (pas le nom usuel, recopié sur les formations) ;
--       modules_elearning (clé id) : intitule, url, duree_heures.
--   Fermé : validités et prérequis (recalcul des titres et des verdicts envoyés à Keystone), postes, équipes, horaires,
--   salariés et toute donnée personnelle, sites, entités, projets et chantiers (copies d'autres outils), paie, journal.
-- Chaque correction est écrite au journal de Cursus (action matrix.editer, auteur « <nom> (Matrix) », rôle integration,
-- valeurs avant et après, motif), et monte la révision (déclencheurs de 0013 et 0014) : l'instantané se relit.
-- search_path figé à la création : le schéma de Cursus, puis pg_temp (jamais en tête), comme le demande la convention de
-- Matrix (docs/edition-par-les-outils.md) ; posé pour la seule transaction de la migration.
--> statement-breakpoint
SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_temp', true);
--> statement-breakpoint
CREATE FUNCTION "pub_editer"(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_key text;            -- colonne clé
  v_cols text[];         -- colonnes que Matrix peut corriger
  v_unique text;         -- colonne dont le libellé est unique parmi les éléments en vigueur
  v_col text;
  v_val text;
  v_num numeric;
  v_keyval text;
  v_before jsonb;
  v_after jsonb;
  v_valeurs jsonb := '{}'::jsonb;
  v_changes text[] := ARRAY[]::text[];
  v_avant jsonb := '{}'::jsonb;
  v_apres jsonb := '{}'::jsonb;
  v_set text;
  v_doublon boolean;
  v_max integer;         -- longueur maximale d'un texte
  v_change boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.ecritures'));
  IF coalesce(btrim(p_par), '') = '' THEN RAISE EXCEPTION 'Le nom de la personne est obligatoire'; END IF;
  IF coalesce(btrim(p_motif), '') = '' THEN RAISE EXCEPTION 'Le motif est obligatoire'; END IF;
  IF length(btrim(p_motif)) > 300 THEN RAISE EXCEPTION 'Motif trop long (300 caractères au plus)'; END IF;

  CASE p_table
    WHEN 'formations' THEN v_key := 'id'; v_cols := ARRAY['nom', 'court', 'duree', 'cout', 'duree_heures']; v_unique := 'nom';
    WHEN 'habilitations' THEN v_key := 'id'; v_cols := ARRAY['nom', 'detail', 'signataire']; v_unique := 'nom';
    WHEN 'destinations' THEN v_key := 'code'; v_cols := ARRAY['pays', 'visa_sub']; v_unique := 'pays';
    WHEN 'organismes' THEN v_key := 'id'; v_cols := ARRAY['raison_sociale', 'adresse', 'site_web', 'conditions']; v_unique := NULL;
    WHEN 'modules_elearning' THEN v_key := 'id'; v_cols := ARRAY['intitule', 'url', 'duree_heures']; v_unique := NULL;
    ELSE
      RAISE EXCEPTION 'La table % n''est pas modifiable depuis Matrix : Cursus n''ouvre que les libellés de ses référentiels (formations, habilitations, destinations, organismes, modules_elearning)', p_table;
  END CASE;

  IF p_action = 'ajouter' THEN
    RAISE EXCEPTION 'Ajout refusé : un élément de % se crée dans Cursus (écran Référentiels), avec son code et ses règles', p_table;
  ELSIF p_action = 'retirer' THEN
    RAISE EXCEPTION 'Retrait refusé : un élément de % s''archive dans Cursus (écran Référentiels), qui vérifie qu''il n''est plus exigé ni en cours', p_table;
  ELSIF p_action IS DISTINCT FROM 'corriger' THEN
    RAISE EXCEPTION 'Action inconnue : %', p_action;
  END IF;

  v_keyval := p_cle ->> v_key;
  IF v_keyval IS NULL THEN RAISE EXCEPTION 'Clé manquante : %', v_key; END IF;
  EXECUTE format('SELECT to_jsonb(t.*) FROM %I t WHERE t.%I::text = $1 FOR UPDATE', p_table, v_key) INTO v_before USING v_keyval;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Élément introuvable : %.% = %', p_table, v_key, v_keyval; END IF;
  IF p_table = 'organismes' AND (v_before ->> 'fusionne_dans') IS NOT NULL THEN
    RAISE EXCEPTION 'Organisme fusionné dans un autre : corrigez la fiche qui le remplace';
  END IF;

  -- Valeurs : colonnes ouvertes seulement, contrôlées comme dans les formulaires de Cursus ; texte : espaces réduits.
  IF p_valeurs IS NULL OR jsonb_typeof(p_valeurs) <> 'object' OR p_valeurs = '{}'::jsonb THEN RAISE EXCEPTION 'Aucune valeur à écrire'; END IF;
  FOR v_col IN SELECT jsonb_object_keys(p_valeurs) LOOP
    IF NOT v_col = ANY (v_cols) THEN
      RAISE EXCEPTION 'La colonne %.% n''est pas modifiable depuis Matrix (colonnes ouvertes : %)', p_table, v_col, array_to_string(v_cols, ', ');
    END IF;
    IF jsonb_typeof(p_valeurs -> v_col) = 'null' THEN
      v_val := NULL;
    ELSIF jsonb_typeof(p_valeurs -> v_col) IN ('string', 'number') THEN
      v_val := nullif(btrim(regexp_replace(p_valeurs ->> v_col, '\s+', ' ', 'g')), '');
    ELSE
      RAISE EXCEPTION 'Valeur refusée pour %.% : texte ou nombre attendu', p_table, v_col;
    END IF;
    -- Libellés obligatoires et longueurs (formulaires de Cursus).
    IF v_col IN ('nom', 'court', 'signataire', 'pays', 'intitule', 'url') AND v_val IS NULL THEN
      RAISE EXCEPTION 'La valeur de %.% est obligatoire', p_table, v_col;
    END IF;
    v_max := CASE v_col
      WHEN 'nom' THEN 120 WHEN 'court' THEN 40 WHEN 'duree' THEN 40 WHEN 'detail' THEN 120 WHEN 'signataire' THEN 80
      WHEN 'pays' THEN 60 WHEN 'visa_sub' THEN 80 WHEN 'raison_sociale' THEN 120 WHEN 'adresse' THEN 200
      WHEN 'site_web' THEN 200 WHEN 'conditions' THEN 500 WHEN 'intitule' THEN 120 WHEN 'url' THEN 500 ELSE 10000 END;
    IF length(v_val) > v_max THEN RAISE EXCEPTION 'Valeur trop longue pour %.% (% caractères au plus)', p_table, v_col, v_max; END IF;
    -- Nombres : coût de 0 à 100 000 € (vide : 0) ; durée en heures de 0,25 à 2 000 (formation : vide efface).
    IF v_col IN ('cout', 'duree_heures') THEN
      IF v_val IS NULL THEN
        IF v_col = 'cout' THEN v_val := '0';
        ELSIF p_table = 'modules_elearning' THEN RAISE EXCEPTION 'La durée en heures du module est obligatoire'; END IF;
      END IF;
      IF v_val IS NOT NULL THEN
        BEGIN
          v_num := replace(v_val, ',', '.')::numeric;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'Valeur refusée pour %.% : nombre attendu', p_table, v_col;
        END;
        IF v_col = 'cout' AND (v_num < 0 OR v_num > 100000) THEN RAISE EXCEPTION 'Coût en euros : nombre de 0 à 100 000'; END IF;
        IF v_col = 'duree_heures' AND (v_num < 0.25 OR v_num > 2000) THEN RAISE EXCEPTION 'Durée en heures : nombre de 0,25 à 2 000'; END IF;
        v_val := round(v_num, 2)::text;
      END IF;
    END IF;
    -- Adresses : site web en http ou https, lien d'un module en https, sans identifiants.
    IF v_col = 'site_web' AND v_val IS NOT NULL AND v_val !~* '^https?://[^/@\s]+(/\S*)?$' THEN
      RAISE EXCEPTION 'Site web : adresse http ou https, sans identifiants';
    END IF;
    IF v_col = 'url' AND v_val !~ '^https://[^/@\s]+(/\S*)?$' THEN
      RAISE EXCEPTION 'Lien d''accès : adresse https complète, sans identifiants';
    END IF;
    v_valeurs := v_valeurs || jsonb_build_object(v_col, v_val);
  END LOOP;

  -- Libellé unique parmi les éléments en vigueur (casse et espaces ignorés), comme les formulaires de Cursus.
  IF v_unique IS NOT NULL AND v_valeurs ? v_unique THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I t WHERE t.%I::text <> $1 AND t.archive IS NULL AND lower(t.%I) = lower($2))', p_table, v_key, v_unique)
      INTO v_doublon USING v_keyval, v_valeurs ->> v_unique;
    IF v_doublon THEN RAISE EXCEPTION 'Un autre élément de % porte déjà ce libellé : %', p_table, v_valeurs ->> v_unique; END IF;
  END IF;

  -- Seules les valeurs changées sont écrites et tracées.
  FOR v_col IN SELECT jsonb_object_keys(v_valeurs) LOOP
    v_change := CASE WHEN v_col IN ('cout', 'duree_heures') THEN (v_before ->> v_col)::numeric IS DISTINCT FROM (v_valeurs ->> v_col)::numeric
                     ELSE (v_before -> v_col) IS DISTINCT FROM (v_valeurs -> v_col) END;
    IF v_change THEN
      v_changes := v_changes || v_col;
      v_avant := v_avant || jsonb_build_object(v_col, v_before -> v_col);
      v_apres := v_apres || jsonb_build_object(v_col, v_valeurs -> v_col);
    END IF;
  END LOOP;
  IF cardinality(v_changes) = 0 THEN RETURN v_before; END IF;

  SELECT string_agg(format('%I = r.%I', c, c), ', ') INTO v_set FROM unnest(v_changes) c;
  EXECUTE format('UPDATE %I t SET %s FROM jsonb_populate_record(NULL::%I, $1) r WHERE t.%I::text = $2 RETURNING to_jsonb(t.*)', p_table, v_set, p_table, v_key)
    INTO v_after USING v_valeurs, v_keyval;

  INSERT INTO journal (at, actor, role, action, message, payload, compte_id, identifiant, salaries, paie)
  VALUES (now(), btrim(p_par) || ' (Matrix)', 'integration', 'matrix.editer',
    format('Correction depuis Matrix — %s « %s » : %s', p_table, v_keyval, array_to_string(v_changes, ', ')),
    json_build_object('table', p_table, 'cle', v_keyval, 'champs', to_json(v_changes), 'avant', v_avant::json, 'apres', v_apres::json, 'motif', btrim(p_motif)),
    NULL, NULL, '[]'::json, false);
  RETURN v_after;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "pub_editer"(text, text, jsonb, jsonb, text, text) FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION "pub_editer"(text, text, jsonb, jsonb, text, text) IS 'M-19 : correction depuis Matrix des libellés des référentiels de Cursus (formations, habilitations, destinations, organismes, modules_elearning), action « corriger » seulement, contrôles et journal de Cursus (action matrix.editer). Exécution accordée par Matrix (lien écriture matrix_app).';
