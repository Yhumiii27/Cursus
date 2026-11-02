# Vigie — démonstration commune : matricules, prénoms et sites

**Statut** : proposition à valider par le propriétaire (2 novembre 2026), puis à porter dans le `REQUESTS.md` de Vigie.
Rien n'est écrit dans le dépôt de Vigie depuis Cursus ; référentiel : `docs/DEMO-COMMUNE.md`.

## Besoin

Les 13 personnes de la démonstration de Vigie (`src/db/seeds/core.ts`) sont des placeholders « [C. Lefèvre] » sans
matricule ; Vigie doit rapprocher ses personnes des salariés de Cursus (source de vérité RH) par matricule.

## Demande

1. Matricules de Cursus et prénoms retenus (fidèles à l'initiale) : EMP-0069 Thierry Nguyen (`tnguyen`), EMP-0070 Michel
   Girard (`mgirard`), EMP-0071 Paul Roux (`proux`), EMP-0072 Alice Martin (`amartin`), EMP-0073 Jérôme Petit
   (`jpetit`), EMP-0074 René Fontaine (`rfontaine`), EMP-0075 Émilie Dubois (`edubois`), EMP-0076 Laurent Moreau
   (`lmoreau`), EMP-0077 Stéphane Benali (`sbenali`), EMP-0078 Kevin Bernard (`kbernard`), EMP-0079 Céline Lefèvre
   (`clefevre`), EMP-0080 Henri Marchand (`hmarchand`), EMP-0081 Yves Lambert (`ylambert`, sorti : fin de CDD le
   1er octobre 2026 dans Cursus). Adresses inchangées (`c.lefevre@epc2i.example`…), reprises par Cursus.
2. Sites : `ville-a` → `lyon` (hypothèse déjà notée par Matrix, à confirmer par le QHSE), `ville-b` (zone d'essais) →
   `lyon_essais` (code proposé ; à créer dans `matrix.sites`, voir `demo-commune-matrix.md`).
3. Services → équipes de Cursus : Atelier montage, Atelier usinage, Zone d'essais, Magasin, Bureau d'études (mêmes noms) ;
   Qualité → « Qualité », QHSE → « HSE », Direction → « Direction ».
4. Projets `K-2024-097`… inconnus de Keystone : à rapprocher des projets de Keystone (HLT-026…) ou à garder propres à la
   démonstration de Vigie.

## Conformité (M-17, M-18)

Lecture par `cursus.pub_salaries` et `matrix.pub_sites` ; aucune écriture croisée, aucune vue nouvelle.
