-- Partage des données EPC2I, fichier 20 : vues publiées par Cursus (schéma cursus).
--
-- Copie qualifiée des vues pub_ de la migration 0002_partage de Cursus (server/migrations-pg/0002_partage.sql du dépôt
-- Cursus, sous-étape 8.b) : c'est Cursus qui crée ses vues et leurs colonnes prérequises, à son démarrage. Rejouer ce
-- fichier ne change rien ; il échoue avec un message clair si la migration de Cursus n'est pas passée (§ 4.9 de
-- docs/architecture-postgres.md). Il remplace la version du 18/10/2026, qui créait elle-même les prérequis et lisait
-- les colonnes JSON en jsonb : les colonnes JSON de Cursus sont en json (texte conservé, ordre des clés compris),
-- d'où json_array_elements_text dans pub_titres_detenus.
--
-- Décisions : D01 personnes, D08 catalogue des titres, D09 titres détenus, D15 organigramme (unite_code), D14 sites
-- (site_code), D18 journal, D19 horizon d'alerte, CU-1 absences (Crucible). Hors de ce fichier : D06 et D07 (vues *_v1, migration echanges_rh).
-- Lot 8 (24/10/2026) : pub_titres_detenus de la migration 0011_pub_titres_valides (certifications annulées retirées,
-- habilitation suspendue ou retirée bornée par sa mesure, colonnes mesure et mesure_le en fin). Copie à reporter chez
-- Matrix AVANT le déploiement de 0011 : l'ancienne copie échouerait ensuite au rejeu (CREATE OR REPLACE VIEW ne retire
-- pas de colonne). Celle-ci ne lit que des colonnes présentes dès 0002 : elle se rejoue avant comme après 0011.
-- Exécution : en tant que cursus_app (ou un administrateur membre de matrix_admin, SET ROLE cursus_app), après le
-- premier démarrage de Cursus sur le serveur (voir README.md) :
--   psql "postgres://cursus_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/20-cursus.sql
-- Rejouable. Les vues ne lisent que des tables du schéma cursus. Droits : 90-droits.sql.
--
-- Colonnes sensibles, jamais lues par une vue pub_ (convention du 15/10/2026, droits.colonnes_sensibles, P-04) :
--   employes : visite, passeport_numero, passeport_expire, naissance, naissance_le, reprise_motif, reprise_date, avis,
--   restrictions, suivi, prochaine_visite, examen_aptitude, autorisation_travail ; vaccinations, visas (tables
--   entières) ; entretiens.cr ; journal.payload, journal.message ; demandes_collab.label.
-- Le contrôle de 90-droits.sql échoue si l'une d'elles apparaît dans information_schema.view_column_usage.

\set ON_ERROR_STOP on

-- ═══ Prérequis : migrations 0002_partage et 0004_pub_absences de Cursus passées ═══
DO $prerequis$
BEGIN
  IF to_regclass('cursus.schema_migrations') IS NULL
     OR NOT EXISTS (SELECT FROM cursus.schema_migrations WHERE nom = '0002_partage')
     OR NOT EXISTS (SELECT FROM cursus.schema_migrations WHERE nom = '0004_pub_absences') THEN
    RAISE EXCEPTION 'Cursus n''a pas encore appliqué ses migrations 0002_partage et 0004_pub_absences sur ce serveur : démarrez Cursus avec DATABASE_URL (rôle cursus_app), puis rejouez ce fichier.';
  END IF;
END $prerequis$;

-- ═══ Vues publiées ═══
-- D01 · Salariés : une ligne par salarié, sortis compris.
CREATE OR REPLACE VIEW cursus.pub_salaries WITH (security_barrier) AS
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
FROM cursus.employes e;
COMMENT ON VIEW cursus.pub_salaries IS 'Contrat D01 v1 : une ligne par salarié, sortis compris. Jamais : visite, reprise_motif, reprise_date, naissance, naissance_le, passeport_*, avis, restrictions, suivi, temps, heures, forfait_*, jour_off, agence, statut, type_contrat, aptitude. Lecteurs : keystone_app, codex_app, vigie_app, matrix_app.';
-- D08 · Catalogue des titres : titre_id porte la nature (atex, hauteur et aipr existent en formation et en habilitation).
CREATE OR REPLACE VIEW cursus.pub_titres WITH (security_barrier) AS
SELECT 'formation.' || f.id                 AS titre_id,
       'formation'::text                    AS nature,
       f.id                                 AS code,
       f.nom                                AS libelle,
       coalesce(nullif(f.court, ''), f.nom) AS libelle_court,
       f.validite                           AS validite_mois
FROM cursus.formations f
UNION ALL
SELECT 'habilitation.' || h.id, 'habilitation'::text, h.id, h.nom, h.nom, h.validite
FROM cursus.habilitations h;
COMMENT ON VIEW cursus.pub_titres IS 'Contrat D08 v1 : formations et habilitations du catalogue Cursus. validite_mois NULL = sans échéance. Lecteurs : vigie_app, keystone_app, matrix_app.';
-- D09 · Titres détenus : dernière obtention non annulée par (salarié, formation) ; habilitations délivrées, bornées par
-- une suspension ou un retrait (avenant du lot 8, migration 0011_pub_titres_valides de Cursus : colonnes mesure et
-- mesure_le ajoutées en fin). L'aptitude médicale n'est pas publiée (donnée de santé), ni le motif de la mesure.
CREATE OR REPLACE VIEW cursus.pub_titres_detenus WITH (security_barrier) AS
WITH cert AS (
  SELECT DISTINCT ON (c.emp_id, c.f) c.id, c.emp_id, c.f, c.obtenue AS obtenu_le, c.session_id, c.organisme
  FROM cursus.certifications c
  WHERE c.obtenue IS NOT NULL AND c.annule_le IS NULL
  ORDER BY c.emp_id, c.f, c.obtenue DESC, c.id DESC
), hab AS (
  SELECT h.id, h.emp_id, h.h, h.delivree AS delivre_le, h.par, h.mesure,
         -- Mesure sans date (reprise d'un ancien système) : le titre n'est plus utilisable depuis sa délivrance.
         CASE WHEN h.mesure IS NOT NULL THEN coalesce(h.mesure_date, h.delivree) END AS mesure_le
  FROM cursus.hab_titres h
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
       CASE WHEN s.date > c.obtenu_le THEN s.date END AS session_prevue_le,
       NULL::text                   AS mesure,
       NULL::date                   AS mesure_le
FROM cert c
JOIN cursus.employes e   ON e.id = c.emp_id
JOIN cursus.formations f ON f.id = c.f
LEFT JOIN cursus.sessions s ON s.id = c.session_id
UNION ALL
SELECT 'hab_titre.' || h.id,
       e.matricule,
       'habilitation.' || h.h,
       'habilitation'::text,
       h.h,
       h.delivre_le,
       x.expire_le,
       -- least ignore les NULL : échéance, prérequis, puis veille de la suspension ou du retrait (utilisable_jusqu_au
       -- est inclus, comme expire_le : le titre n'est plus utilisable le jour de la mesure, comme dans Cursus).
       least(x.expire_le, pr.prerequis_jusqu_au, (h.mesure_le - 1)),
       coalesce(pr.manquant, false),
       NULL::text,
       h.par,
       NULL::date,
       h.mesure,
       h.mesure_le
FROM hab h
JOIN cursus.employes e      ON e.id = h.emp_id
JOIN cursus.habilitations m ON m.id = h.h
CROSS JOIN LATERAL (
  SELECT (h.delivre_le + make_interval(months => m.validite))::date AS expire_le
) x
LEFT JOIN LATERAL (
  -- Formations prérequises (habilitations.prereqs) : manquante, ou date de fin de la plus proche ; certification
  -- annulée jamais comptée.
  SELECT bool_or(dernier.obtenu_le IS NULL) AS manquant, min(dernier.expire_le) AS prerequis_jusqu_au
  FROM json_array_elements_text(coalesce(m.prereqs, '[]'::json)) AS p(f)
  LEFT JOIN LATERAL (
    SELECT c2.obtenue AS obtenu_le, (c2.obtenue + make_interval(months => f2.validite))::date AS expire_le
    FROM cursus.certifications c2
    JOIN cursus.formations f2 ON f2.id = c2.f
    WHERE c2.emp_id = h.emp_id AND c2.f = p.f AND c2.obtenue IS NOT NULL AND c2.annule_le IS NULL
    ORDER BY c2.obtenue DESC, c2.id DESC
    LIMIT 1
  ) dernier ON true
) pr ON true;
COMMENT ON VIEW cursus.pub_titres_detenus IS 'Contrat D09 v1, avenant du lot 8 : titres détenus par salarié (dernière formation suivie non annulée, habilitations délivrées). utilisable_jusqu_au borné à la veille d''une suspension ou d''un retrait ; colonnes ajoutées en fin : mesure (suspension | retrait | null), mesure_le. Aucune donnée de santé : l''aptitude médicale n''est pas publiée ; motif de la mesure jamais publié. Lecteurs : vigie_app, keystone_app, matrix_app.';
-- D19 · Horizon d'alerte : seule la clé app.horizonAlerte est lue (jamais secret ni les autres réglages).
CREATE OR REPLACE VIEW cursus.pub_parametres WITH (security_barrier) AS
SELECT coalesce((s.value ->> 'horizonAlerte')::integer, 90) AS horizon_alerte_jours
FROM (SELECT 1) AS une_ligne
LEFT JOIN cursus.settings s ON s.key = 'app';
COMMENT ON VIEW cursus.pub_parametres IS 'Contrat D19 v1 : une ligne. Seule la clé app.horizonAlerte est lue (jamais secret ni lastSagePush). Lecteurs : vigie_app, matrix_app.';
-- D18 · Journal : colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie
-- (95-matrix-journal-unifie.sql de Matrix). Ni payload ni message (données de santé possibles).
CREATE OR REPLACE VIEW cursus.pub_journal WITH (security_barrier) AS
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
FROM cursus.journal j
LEFT JOIN cursus.employes a ON a.id = j.actor_emp_id;
COMMENT ON VIEW cursus.pub_journal IS 'Contrat D18 v1 : journal de Cursus aux colonnes communes. Ni payload ni message. Lecteur : matrix_app (matrix.journal_unifie).';
-- CU-1 · Absences (demande de Crucible, migration 0004_pub_absences de Cursus) : qui est absent et quand, jamais pourquoi.
-- statut 'validee' (validée ou signalée) ou 'demandee' ; une absence annulée garde 'validee' avec annulee = true ; les
-- absences refusées ne sont pas publiées. maj_le : posée par le déclencheur absences_maj_le de Cursus.
CREATE OR REPLACE VIEW cursus.pub_absences WITH (security_barrier) AS
SELECT e.matricule,
       a.du,
       a.au,
       CASE WHEN a.statut = 'demandee' THEN 'demandee' ELSE 'validee' END AS statut,
       (a.statut = 'annulee' OR a.annulee_le IS NOT NULL)                AS annulee,
       a.maj_le
FROM cursus.absences a
JOIN cursus.employes e ON e.id = a.emp_id
WHERE a.statut IN ('demandee', 'validee', 'signalee', 'annulee')
  AND e.matricule IS NOT NULL
  AND a.du IS NOT NULL AND a.au IS NOT NULL;
COMMENT ON VIEW cursus.pub_absences IS 'Contrat CU-1 v1 (demande de Crucible) : qui est absent et quand. statut validee | demandee, annulee, maj_le. Jamais : type, motif de refus, justificatif, demi-journées, signalement. Absences refusées non publiées. Lecteurs : crucible_app, matrix_app.';
