# Crucible — démonstration commune : matricules et site d'essais

**Statut** : proposition à valider par le propriétaire (2 novembre 2026), puis à porter dans `docs/DEMANDES-CRUCIBLE`
ou le `REQUESTS.md` de Crucible. Rien n'est écrit dans le dépôt de Crucible depuis Cursus ; référentiel :
`docs/DEMO-COMMUNE.md`.

## Demande

1. Matricules des personnes d'EPC2i (`src/server/db/seed/demo.ts`, `DEMO_PEOPLE`) : Hélène Marchal EMP-0060, Antoine
   Leroy EMP-0061 (homonyme d'EMP-0014, chargé RH de Cursus : deux personnes distinctes, distinguées par matricule et par
   adresse `a.leroy@epc2i.example`), Nathalie Brun EMP-0062, Damien Petit EMP-0063, Camille Fabre EMP-0064, Julien Masson
   EMP-0065, Olivier Caron EMP-0066, Sandrine Roux EMP-0067, Mehdi Arnaud EMP-0068. Aucune fiche pour Isabelle Garnier
   (partenaire EPC France) ni pour l'administrateur.
2. Site `RD-SITE`, hors format de Matrix : code proposé `site_rd` (à créer dans `matrix.sites`, voir
   `demo-commune-matrix.md`), à reprendre dans la démonstration de Crucible.
3. Responsables : Crucible désigne Hélène Marchal « Head of R&D » et Olivier Caron responsable ingénierie, Codex Yasmine
   Aït-Saïd et Marion Kerviel. Cursus les garde tous (Hélène Marchal manager de l'équipe « Essais R&D », rattachée à
   « R&D ») : à trancher.

## Conformité (M-17, M-18)

Lecture par `cursus.pub_salaries` ; aucune écriture croisée, aucune vue nouvelle.
