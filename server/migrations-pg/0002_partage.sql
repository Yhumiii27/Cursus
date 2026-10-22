-- Cursus : migration 0002 du schéma PostgreSQL, partage des données EPC2I (Matrix, docs/convergence-des-donnees.md
-- § 1.3 et docs/architecture-postgres.md § 4.9) : colonnes prérequises puis vues publiées pub_ (contrats D01, D08, D09,
-- D18, D19). Reprise de infra/postgres/partage/20-cursus.sql de Matrix, adaptée : noms non qualifiés (search_path),
-- fonctions json (les colonnes JSON de Cursus sont en json, pas en jsonb : server/migrations-pg/0001_init.sql). Le
-- fichier de partage de Matrix devient la copie qualifiée de ces vues (infra/postgres-partage/20-cursus.sql de Cursus).
--
-- Aucun droit ici : les vues sont accordées aux lecteurs par 90-droits.sql de Matrix ; le déclencheur droits_ddl du
-- socle donne à matrix_lecture les colonnes autorisées des colonnes ajoutées.
--
-- Colonnes sensibles, jamais lues par une vue pub_ (convention du 15/10/2026, droits.colonnes_sensibles du socle,
-- propositions P-04) : employes.visite, passeport_numero, passeport_expire, naissance, naissance_le, reprise_motif,
-- reprise_date, avis, restrictions, suivi, prochaine_visite, examen_aptitude, autorisation_travail ; vaccinations et
-- visas (tables entières) ; entretiens.cr ; journal.payload, journal.message ; demandes_collab.label. 90-droits.sql de
-- Matrix échoue si l'une d'elles apparaît dans information_schema.view_column_usage.
--
-- Contrat des vues : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : un filtre posé par le lecteur ne s'évalue qu'après ceux de la vue.
--> statement-breakpoint
-- ═══ Prérequis : colonnes du partage ═══
-- Elles ne font pas encore partie de l'objet TABLES de server/src/db.ts : Cursus ne les lit ni ne les écrit, les vues
-- les publient vides (NULL) jusqu'aux lots qui les rempliront (D14 sites, D15 organigramme, D01 sortie, D09 organisme,
-- D18 auteur et objet du journal). Le contrôle du schéma au démarrage (TABLES ⊂ schéma) les tolère.
--
-- D14 : site de rattachement, code de matrix.pub_sites (contrôle à la saisie par Cursus, puis contrôle d'orphelins par
-- Matrix ; pas de clé étrangère entre schémas). Ne pas confondre avec agence (agence d'intérim).
ALTER TABLE "employes" ADD COLUMN "site_code" text CONSTRAINT "employes_site_code_check" CHECK ("site_code" ~ '^[a-z][a-z0-9_]{1,31}$');
--> statement-breakpoint
-- D15 : unité de rattachement, code de matrix.pub_organigramme (niveau équipe).
ALTER TABLE "employes" ADD COLUMN "unite_code" text CONSTRAINT "employes_unite_code_check" CHECK ("unite_code" ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "unite_code" text CONSTRAINT "budgets_unite_code_check" CHECK ("unite_code" ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');
--> statement-breakpoint
ALTER TABLE "plan_actions" ADD COLUMN "unite_code" text CONSTRAINT "plan_actions_unite_code_check" CHECK ("unite_code" ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');
--> statement-breakpoint
-- D01 : date de sortie effective, CDI compris (fin ne vaut que pour les contrats à terme) : calcul de actif.
ALTER TABLE "employes" ADD COLUMN "sortie" date CONSTRAINT "employes_sortie_check" CHECK ("sortie" >= "entree");
--> statement-breakpoint
CREATE INDEX "employes_unite_code_index" ON "employes" USING btree ("unite_code");
--> statement-breakpoint
CREATE INDEX "employes_site_code_index" ON "employes" USING btree ("site_code");
--> statement-breakpoint
-- D09 : organisme de la formation suivie (Vigie le saisit pour chaque titre détenu) ; la vue retombe sur celui du catalogue.
ALTER TABLE "certifications" ADD COLUMN "organisme" text;
--> statement-breakpoint
-- D18 : auteur et objet du journal en colonnes (pub_journal ne lit ni payload ni message). Pas de clé étrangère vers
-- employes, contrairement au fichier de Matrix : le journal est conservé quand la démonstration est rechargée (fiches
-- effacées, server/src/db-pg.ts clearAll) et garde l'auteur d'une fiche supprimée par une purge (la vue le laisse vide).
ALTER TABLE "journal" ADD COLUMN "actor_emp_id" integer;
--> statement-breakpoint
ALTER TABLE "journal" ADD COLUMN "objet_ref" text;
--> statement-breakpoint
ALTER TABLE "journal" ADD COLUMN "projet_code" text;
--> statement-breakpoint
-- ═══ Vues publiées ═══
-- D01 · Salariés : une ligne par salarié, sortis compris.
CREATE VIEW "pub_salaries" WITH (security_barrier) AS
SELECT e.matricule,
       e.nom,
       e.poste,
       e.unite_code,
       e.site_code,
       e.entree,
       e.sortie,
       ((e.entree IS NULL OR e.entree <= current_date)
        AND (e.fin IS NULL OR e.fin >= current_date)
        AND (e.sortie IS NULL OR e.sortie >= current_date)) AS actif
FROM employes e;
--> statement-breakpoint
COMMENT ON VIEW "pub_salaries" IS 'Contrat D01 v1 : une ligne par salarié, sortis compris. Jamais : visite, reprise_motif, reprise_date, naissance, naissance_le, passeport_*, avis, restrictions, suivi, temps, heures, forfait_*, jour_off, agence, statut, type_contrat, aptitude. Lecteurs : keystone_app, codex_app, vigie_app, matrix_app.';
--> statement-breakpoint
-- D08 · Catalogue des titres : titre_id porte la nature (atex, hauteur et aipr existent en formation et en habilitation).
CREATE VIEW "pub_titres" WITH (security_barrier) AS
SELECT 'formation.' || f.id                 AS titre_id,
       'formation'::text                    AS nature,
       f.id                                 AS code,
       f.nom                                AS libelle,
       coalesce(nullif(f.court, ''), f.nom) AS libelle_court,
       f.validite                           AS validite_mois
FROM formations f
UNION ALL
SELECT 'habilitation.' || h.id, 'habilitation'::text, h.id, h.nom, h.nom, h.validite
FROM habilitations h;
--> statement-breakpoint
COMMENT ON VIEW "pub_titres" IS 'Contrat D08 v1 : formations et habilitations du catalogue Cursus. validite_mois NULL = sans échéance. Lecteurs : vigie_app, keystone_app, matrix_app.';
--> statement-breakpoint
-- D09 · Titres détenus : dernière obtention par (salarié, formation) ; habilitations délivrées. L'aptitude médicale n'est
-- pas publiée (donnée de santé).
CREATE VIEW "pub_titres_detenus" WITH (security_barrier) AS
WITH cert AS (
  SELECT DISTINCT ON (c.emp_id, c.f) c.id, c.emp_id, c.f, c.obtenue AS obtenu_le, c.session_id, c.organisme
  FROM certifications c
  WHERE c.obtenue IS NOT NULL
  ORDER BY c.emp_id, c.f, c.obtenue DESC, c.id DESC
), hab AS (
  SELECT h.id, h.emp_id, h.h, h.delivree AS delivre_le, h.par
  FROM hab_titres h
  WHERE h.delivree IS NOT NULL
)
SELECT 'certification.' || c.id     AS cursus_ref,
       e.matricule,
       'formation.' || c.f          AS titre_id,
       'formation'::text            AS nature,
       c.f                          AS code,
       c.obtenu_le,
       (c.obtenu_le + make_interval(months => f.validite))::date AS expire_le,
       (c.obtenu_le + make_interval(months => f.validite))::date AS utilisable_jusqu_au,
       false                        AS prerequis_manquant,
       coalesce(c.organisme, f.organisme) AS organisme,
       NULL::text                   AS delivre_par,
       CASE WHEN s.date > c.obtenu_le THEN s.date END AS session_prevue_le
FROM cert c
JOIN employes e   ON e.id = c.emp_id
JOIN formations f ON f.id = c.f
LEFT JOIN sessions s ON s.id = c.session_id
UNION ALL
SELECT 'hab_titre.' || h.id,
       e.matricule,
       'habilitation.' || h.h,
       'habilitation'::text,
       h.h,
       h.delivre_le,
       x.expire_le,
       least(x.expire_le, pr.prerequis_jusqu_au),
       coalesce(pr.manquant, false),
       NULL::text,
       h.par,
       NULL::date
FROM hab h
JOIN employes e      ON e.id = h.emp_id
JOIN habilitations m ON m.id = h.h
CROSS JOIN LATERAL (
  SELECT (h.delivre_le + make_interval(months => m.validite))::date AS expire_le
) x
LEFT JOIN LATERAL (
  -- Formations prérequises (habilitations.prereqs) : manquante, ou date de fin de la plus proche.
  SELECT bool_or(dernier.obtenu_le IS NULL) AS manquant, min(dernier.expire_le) AS prerequis_jusqu_au
  FROM json_array_elements_text(coalesce(m.prereqs, '[]'::json)) AS p(f)
  LEFT JOIN LATERAL (
    SELECT c2.obtenue AS obtenu_le, (c2.obtenue + make_interval(months => f2.validite))::date AS expire_le
    FROM certifications c2
    JOIN formations f2 ON f2.id = c2.f
    WHERE c2.emp_id = h.emp_id AND c2.f = p.f AND c2.obtenue IS NOT NULL
    ORDER BY c2.obtenue DESC, c2.id DESC
    LIMIT 1
  ) dernier ON true
) pr ON true;
--> statement-breakpoint
COMMENT ON VIEW "pub_titres_detenus" IS 'Contrat D09 v1 : titres détenus par salarié (dernière formation suivie, habilitations délivrées). Aucune donnée de santé : l''aptitude médicale n''est pas publiée. Lecteurs : vigie_app, keystone_app, matrix_app.';
--> statement-breakpoint
-- D19 · Horizon d'alerte : seule la clé app.horizonAlerte est lue (jamais secret ni les autres réglages).
CREATE VIEW "pub_parametres" WITH (security_barrier) AS
SELECT coalesce((s.value ->> 'horizonAlerte')::integer, 90) AS horizon_alerte_jours
FROM (SELECT 1) AS une_ligne
LEFT JOIN settings s ON s.key = 'app';
--> statement-breakpoint
COMMENT ON VIEW "pub_parametres" IS 'Contrat D19 v1 : une ligne. Seule la clé app.horizonAlerte est lue (jamais secret ni lastSagePush). Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
-- D18 · Journal : colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie
-- (95-matrix-journal-unifie.sql de Matrix). Ni payload ni message (données de santé possibles).
CREATE VIEW "pub_journal" WITH (security_barrier) AS
SELECT 'journal:' || j.id::text  AS ref_source,
       CASE WHEN j.role = 'integration' THEN 'integration' ELSE 'audit' END AS nature,
       j.at                      AS quand,
       j.actor                   AS qui,
       a.matricule               AS qui_ref,
       j.role                    AS qui_role,
       j.action,
       j.objet_ref               AS objet,
       NULL::text                AS detail,
       j.projet_code             AS projet,
       a.matricule               AS qui_matricule
FROM journal j
LEFT JOIN employes a ON a.id = j.actor_emp_id;
--> statement-breakpoint
COMMENT ON VIEW "pub_journal" IS 'Contrat D18 v1 : journal de Cursus aux colonnes communes. Ni payload ni message. Lecteur : matrix_app (matrix.journal_unifie).';
