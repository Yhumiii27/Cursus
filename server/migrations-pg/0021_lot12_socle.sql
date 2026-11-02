-- Cursus : migration 0021 du schéma PostgreSQL, lot 12, socle commun (S0), posé seul avant les six chantiers du lot. Une
-- seule contrainte, aucune table, aucune colonne, aucune vue pub_ touchée, aucune migration publiée modifiée :
-- 1. Objets auxquels une pièce justificative se joint (`pieces.objet`, contrainte `pieces_objet_check`, dernière
--    définition dans 0015_lot11_socle.sql) : valeurs existantes plus les trois objets prévus par le lot 12, pour que deux
--    chantiers ne réécrivent pas la même contrainte en parallèle :
--    - `inscriptionElearning` : attestation de suivi d'un module d'e-learning (chantier C4, organismes de formation et
--      e-learning) ;
--    - `organisme` : pièce d'un organisme de formation (certification Qualiopi, convention ; C4) ;
--    - `correctionPointage` : justificatif d'une demande de correction d'un pointage (chantier C6, badgeage virtuel).
-- La contrainte n'admet ces valeurs qu'en base : côté code, l'union ObjetPiece (shared/types.ts), OBJETS_PIECE et
-- TABLE_OBJET (server/src/pieces.ts) restent inchangés, et estObjetPiece refuse encore ces objets à l'API ; chaque chantier
-- les élargit dans son bloc le jour où sa table existe. Aucune migration SQLite : les tables y sont créées d'après TABLES
-- (server/src/db.ts), sans contrainte CHECK sur `objet`.
-- Mêmes règles que 0015_lot11_socle.sql : suppression puis recréation sous le même nom, valeurs dans l'ordre de la
-- définition précédente puis dans l'ordre du lot. Les lignes existantes satisfont la nouvelle contrainte (elle ne fait
-- qu'ajouter des valeurs) ; aucune donnée n'est réécrite.
--> statement-breakpoint
ALTER TABLE "pieces" DROP CONSTRAINT "pieces_objet_check";
--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_objet_check" CHECK ("objet" IN ('absence', 'certification', 'habTitre', 'declaration', 'voyage', 'dossierOpco', 'ligneFrais', 'ligneFraisSante', 'vehiculePerso', 'inscriptionElearning', 'organisme', 'correctionPointage'));
