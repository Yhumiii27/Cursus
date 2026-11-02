# Matrix — démonstration commune : sites, unités et adresse des salariés

**Statut** : proposition à valider par le propriétaire (2 novembre 2026), puis à porter dans le `REQUESTS.md` de Matrix.
Rien n'est écrit dans le dépôt de Matrix depuis Cursus ; référentiel : `docs/DEMO-COMMUNE.md`.

## Demande

1. **Sites** : Cursus pose dans son cache `sites` les trois sites de `matrix.sites` (`lyon`, `le_havre`, `marseille`,
   mêmes libellés) et deux codes de démonstration au format de Matrix : `lyon_essais` (zone d'essais de Vigie, `ville-b`)
   et `site_rd` (site d'essais de Crucible, `RD-SITE`). À ajouter à `matrix.sites` (ou à remplacer par les vrais codes) ;
   la correspondance `ville-a` = `lyon` reste à confirmer par le QHSE.
2. **Unités** : `pub_salaries.unite_code` de la démonstration porte les 15 départements de l'organigramme (`DIR`, `PRJ`,
   `ING`, `MEP`, `CHA`, `QUA`, `HSE`, `ACH`, `RHU`, `FIN`, `JUR`, `DSI`, `CMN`, `RDI`, et `COM` par `COM-VENTE`) et des
   services `XXX-SUFFIXE` : `CHA-PROD`, `CHA-MAINT`, `ACH-LOG`, `HSE-QHSE`, `RHU-ADM`, `COM-VENTE`, `PRJ-HAVRE`, `ING-BE`,
   `ING-ESSAIS`, `CHA-MONTAGE`, `CHA-USINAGE`, `ACH-MAGASIN`, `RDI-ESSAIS`. À ajouter à l'organigramme de démonstration
   de Matrix si les autres outils doivent les lire ; `responsable_matricule` des départements : manager de l'équipe du
   département (EMP-0048 DIR, EMP-0025 PRJ, EMP-0033 ING, EMP-0038 MEP, EMP-0040 CHA, EMP-0044 QUA, EMP-0047 HSE,
   EMP-0046 ACH, EMP-0049 RHU, EMP-0050 FIN, EMP-0051 JUR, EMP-0052 DSI, EMP-0053 CMN, EMP-0054 RDI).
3. **Adresse électronique** dans `pub_salaries` (publication, M-18) : Keystone rapproche par matricule puis par e-mail.
   Proposition : colonne `email` en fin de vue (adresse professionnelle, `employes.email`), lecteurs `keystone_app`,
   `codex_app`, `vigie_app`, `crucible_app` ; justification : rapprochement des comptes Entra ID à la mise en production.
   Cursus ne la publie pas d'ici là (aucune vue `pub_` dans ses migrations).
4. **Purge** : à la mise en production, `npm run purge-demo` vide les fiches EMP-0001 à EMP-0081 ; les outils qui en
   gardent une copie (correspondances, journal unifié) les vident aussi. Le premier vrai salarié reçoit EMP-1001.

## Conformité (M-17, M-18)

Aucune vue `pub_` créée ni modifiée par Cursus ; la colonne `email` est une demande de publication.
