-- Cursus : migration 0011 du schéma PostgreSQL, lot 8, chantier D (données personnelles sur le serveur commun),
-- étape 1. Deux objets :
-- 1. Vue pub_titres_detenus (contrat D09, avenant du lot 8) : les autres outils (Vigie, Keystone, Matrix) ne voient plus
--    comme valide un titre que Cursus ne tient plus pour valide. Certification annulée (certifications.annule_le, saisie
--    par erreur) : jamais publiée, ni comptée comme prérequis d'une habilitation ; la dernière certification non annulée
--    reprend sa place, comme dans Cursus (server/src/dataset.ts). Habilitation suspendue ou retirée (hab_titres.mesure,
--    server/src/actions/conformite.ts) : utilisable_jusqu_au borné à la veille de la mesure (date incluse, comme
--    expire_le), comme shared/domain.ts (habInfo : la mesure prime sur l'échéance et les prérequis, dès son jour). Colonnes existantes inchangées et dans le même ordre ;
--    deux colonnes ajoutées en fin : mesure (suspension | retrait | null) et mesure_le (date de la mesure). Le motif de
--    la mesure n'est pas publié (texte libre).
-- 2. Commentaires « Sensible » sur les colonnes et tables que matrix_lecture ne doit pas lire (empreintes de mots de
--    passe, sessions, données de santé, textes libres) : le contrôle de la CI (job postgres,
--    scripts/colonnes-sensibles-pg.sql) les couvre ainsi toutes. La fermeture elle-même est faite par Matrix
--    (droits.colonnes_sensibles du socle) : demande dans docs/DEMANDES-LOT8-DONNEES.md. La table settings n'est pas
--    marquée : pub_parametres (D19) la lit, et droits.verifier() refuse une vue publiée qui lit une table fermée ; elle
--    ne porte en production ni secret (CURSUS_SECRET obligatoire) ni donnée d'un salarié, et la clé de signature de la
--    démonstration n'y suffit plus à forger une session (connexions ne garde que l'empreinte de l'identifiant).
--
-- À reporter dans partage/20-cursus.sql de Matrix AVANT le déploiement de cette migration (copie qualifiée :
-- infra/postgres-partage/20-cursus.sql) : l'ancienne copie de Matrix échouerait au rejeu, car CREATE OR REPLACE VIEW ne
-- retire pas de colonne. Aucun droit ici ; colonnes sensibles jamais lues par la vue (convention du 15/10/2026).
--> statement-breakpoint
CREATE OR REPLACE VIEW "pub_titres_detenus" WITH (security_barrier) AS
WITH cert AS (
  SELECT DISTINCT ON (c.emp_id, c.f) c.id, c.emp_id, c.f, c.obtenue AS obtenu_le, c.session_id, c.organisme
  FROM certifications c
  WHERE c.obtenue IS NOT NULL AND c.annule_le IS NULL
  ORDER BY c.emp_id, c.f, c.obtenue DESC, c.id DESC
), hab AS (
  SELECT h.id, h.emp_id, h.h, h.delivree AS delivre_le, h.par, h.mesure,
         -- Mesure sans date (reprise d'un ancien système) : le titre n'est plus utilisable depuis sa délivrance.
         CASE WHEN h.mesure IS NOT NULL THEN coalesce(h.mesure_date, h.delivree) END AS mesure_le
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
       CASE WHEN s.date > c.obtenu_le THEN s.date END AS session_prevue_le,
       NULL::text                   AS mesure,
       NULL::date                   AS mesure_le
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
JOIN employes e      ON e.id = h.emp_id
JOIN habilitations m ON m.id = h.h
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
    FROM certifications c2
    JOIN formations f2 ON f2.id = c2.f
    WHERE c2.emp_id = h.emp_id AND c2.f = p.f AND c2.obtenue IS NOT NULL AND c2.annule_le IS NULL
    ORDER BY c2.obtenue DESC, c2.id DESC
    LIMIT 1
  ) dernier ON true
) pr ON true;
--> statement-breakpoint
COMMENT ON VIEW "pub_titres_detenus" IS 'Contrat D09 v1, avenant du lot 8 : titres détenus par salarié (dernière formation suivie non annulée, habilitations délivrées). utilisable_jusqu_au borné à la veille d''une suspension ou d''un retrait ; colonnes ajoutées en fin : mesure (suspension | retrait | null), mesure_le. Aucune donnée de santé : l''aptitude médicale n''est pas publiée ; motif de la mesure jamais publié. Lecteurs : vigie_app, keystone_app, matrix_app.';
--> statement-breakpoint
-- ═══ Colonnes et tables à exclure de matrix_lecture ═══
-- Marque lue par le contrôle de la CI : « Sensible » dans le commentaire de la colonne, ou de la table pour une table
-- fermée en entier (colonne_nom = '*' de droits.colonnes_sensibles). Les commentaires déjà posés par les migrations
-- 0001, 0003, 0005 et 0010 sont gardés ; journal.payload reçoit la marque, qui lui manquait.
-- Comptes et sessions : empreintes scrypt (cassables hors ligne), identifiant Microsoft, blocage.
COMMENT ON COLUMN "comptes"."mot_de_passe" IS 'Sensible : empreinte scrypt du mot de passe d''un compte local, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "comptes"."oid" IS 'Sensible : identifiant de l''utilisateur dans Entra ID (Microsoft 365), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "comptes"."blocage_fin" IS 'Sensible : fin du blocage après des échecs de connexion (sécurité du compte), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON TABLE "connexions" IS 'Système : sessions de connexion (empreinte SHA-256 de l''identifiant porté par le cookie). Sensible (table entière) : à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON TABLE "reprises" IS 'Mise en service : lots importés depuis l''ancien système (compte rendu, sans le fichier). Sensible (table entière : comptes rendus nominatifs) : à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
-- Santé au travail et absences (art. 9 du RGPD : la nature d'une absence ou d'une visite de reprise désigne un arrêt).
COMMENT ON TABLE "demandes_visite" IS 'Santé au travail : demandes de visite médicale du service RH. Sensible (table entière : santé) : à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON TABLE "informations_cp" IS 'Temps et congés : informations des salariés sur leurs congés au retour d''un arrêt (L3141-19-3). Sensible (table entière : sa présence désigne un arrêt) : à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "absences"."type" IS 'Sensible (santé) : nature de l''absence (maladie, accident du travail…), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "absences"."justificatif" IS 'Sensible (santé) : justificatif d''absence reçu, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "employes"."expose" IS 'Sensible (santé) : salarié exposé à des risques particuliers (suivi médical, visite post-exposition), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "employes"."motif_sortie" IS 'Sensible : motif de la sortie (licenciement, rupture…), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "journal"."payload" IS 'Sensible : copie du corps des actions (peut contenir des données de santé), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "journal"."message" IS 'Sensible : message lisible de l''action (peut citer une vaccination ou un passeport), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
-- Textes libres : demandes, mesures, corrections, motifs, déplacements, messages envoyés.
COMMENT ON COLUMN "demandes_collab"."label" IS 'Sensible : libellé de la demande (peut citer une vaccination), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "demandes_collab"."motif" IS 'Sensible : texte libre du salarié ou du manager, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "demandes_collab"."motif_refus" IS 'Sensible : texte libre du service RH, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "certifications"."corrige_motif" IS 'Sensible : texte libre du service RH, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "certifications"."annule_motif" IS 'Sensible : texte libre du service RH, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "hab_titres"."mesure_motif" IS 'Sensible : motif de la suspension ou du retrait (incident, restriction d''aptitude), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "avenants_forfait"."reference" IS 'Sensible : référence libre de l''avenant signé, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "feuilles"."comment" IS 'Sensible : commentaire libre du salarié sur sa semaine, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "feuilles"."motif_depassement" IS 'Sensible : texte libre (dépassement des durées maximales), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "feuilles"."motif_forfait" IS 'Sensible : texte libre (forfait jours), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "feuilles"."reouverture" IS 'Sensible : dernière réouverture de la feuille validée, avec son motif libre, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "voyages"."motif" IS 'Sensible : texte libre (objet du déplacement), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "voyages"."hebergement" IS 'Sensible : adresse d''hébergement du salarié en déplacement, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "voyages"."contact_sur_place" IS 'Sensible : contact sur place (nom, téléphone), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "voyages"."annule_motif" IS 'Sensible : texte libre du service RH, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "reports"."motif" IS 'Sensible : texte libre (report de congés : arrêt, situation personnelle), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "clotures"."motif" IS 'Sensible : texte libre du service RH, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "envois"."contenu" IS 'Sensible : corps des messages sortants (e-mails, appels à Keystone), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "envois"."erreur" IS 'Sensible : réponse d''erreur du destinataire (peut citer le message), à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "envois"."accuse" IS 'Sensible : accusé de réception du destinataire, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "notifications"."objet" IS 'Sensible : objet du message destiné au salarié, à exclure de matrix_lecture (Matrix).';
--> statement-breakpoint
COMMENT ON COLUMN "notifications"."texte" IS 'Sensible : texte du message destiné au salarié, à exclure de matrix_lecture (Matrix).';
