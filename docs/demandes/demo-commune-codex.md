# Codex — démonstration commune : matricules des utilisateurs de démonstration

**Statut** : proposition à valider par le propriétaire (2 novembre 2026), puis à porter dans le `REQUESTS.md` de Codex.
Rien n'est écrit dans le dépôt de Codex depuis Cursus ; référentiel : `docs/DEMO-COMMUNE.md`.

## Besoin

Les 25 utilisateurs de la démonstration de Codex (`src/db/seed-org.ts`, `USERS`) n'ont ni matricule ni adresse ; Codex
rapproche ses utilisateurs des salariés de Cursus par matricule (`pub_salaries`).

## Demande

1. Matricules : `mlefebvre` EMP-0025, `raubert` EMP-0026, `sperrin` EMP-0027, `cmoreau` EMP-0028, `lmarchand` EMP-0029,
   `mkerviel` EMP-0033, `agirard` EMP-0034, `jwagner` EMP-0035, `shaddad` EMP-0036, `cmorvan` EMP-0037, `pnogues`
   EMP-0038, `oblanc` EMP-0040, `lfabre` EMP-0041, `gcomte` EMP-0044, `hsauvage` EMP-0045, `fbertrand` EMP-0046,
   `cbardet` EMP-0047, `hcosta` EMP-0048, `nbenali` EMP-0049, `tweil` EMP-0050, `irahmani` EMP-0051, `mdelorme` EMP-0052,
   `lmartin` EMP-0053, `yait` EMP-0054, `jholt` EMP-0055. Comptes système (`codex`, `keystone`, `vigie`) : aucun.
2. Facultatif : adresses de démonstration `prenom.nom@epc2i.example` (celles que porte Cursus, sauf personas de Keystone
   en `@epc2i.fr`).
3. Départements et sites inchangés : Cursus les a repris tels quels (unités `DIR`… et sites `lyon`, `le_havre`,
   `marseille`) ; James Holt, sans site chez Codex, est rattaché à `lyon`.

## Conformité (M-17, M-18)

Lecture par `cursus.pub_salaries` ; aucune écriture croisée, aucune vue nouvelle.
