# Note à Matrix — lot 14 : personnes sur site (intérimaires, extérieurs, présences prévues)

**Statut : proposition à valider par le propriétaire** (5 novembre 2026, complétée le 7 novembre 2026 après l'étape 2). Rien n'est écrit dans le dépôt de Matrix depuis
Cursus ; une fois validée, la note se porte dans le `REQUESTS.md` de Matrix, en réponse à la demande de Vigie du
4 novembre 2026 (« Publications et liens de lecture pour les personnes (D01) et les présences prévues sur site »), que
Matrix a acceptée le 5 novembre 2026 (contrats `data/contrats/cursus.pub_salaries-d01-v2.json` et
`data/contrats/cursus.pub_presences_prevues.json`).

## Ce que Cursus fournit (migration `0031_personnes_site.sql`, lot 14)

Colonnes de `cursus.employes` :

| Colonne | Contenu |
|---|---|
| `exterieur` | `true` pour un salarié d'entreprise extérieure (fiche sans contrat avec l'entreprise) |
| `entreprise` | raison sociale de l'entreprise d'un extérieur |
| `agence` (existante) | agence d'un intérimaire (`type_contrat = 'interim'`) |
| `matricule_site` | matricule de site permanent : `I00001` pour un intérimaire, `E00001` pour un extérieur ; unique, jamais réattribué ; null pour un salarié |

Attention : la colonne existante `employes.categorie` est la catégorie socioprofessionnelle des indicateurs sociaux
(ouvrier, employé, TAM, cadre), sans rapport avec la catégorie demandée par Vigie. Elle ne doit pas être publiée sous ce nom.

Expressions proposées pour les trois colonnes du contrat D01 v2 de `cursus.pub_salaries` :

```sql
CASE WHEN e.exterieur THEN 'exterieur' WHEN e.type_contrat = 'interim' THEN 'interimaire' ELSE 'salarie' END AS categorie,
CASE WHEN e.exterieur THEN e.entreprise WHEN e.type_contrat = 'interim' THEN e.agence END                       AS entreprise,
e.email                                                                                                          AS email,
```

## Point à trancher : quel matricule publier pour un intérimaire ou un extérieur

Le propriétaire a décidé le 5 novembre 2026 que le matricule I s'ajoute au matricule Cursus `EMP-…` d'un intérimaire,
qui reste l'identifiant échangé avec Keystone (API). Or `pub_salaries.matricule` publie aujourd'hui `employes.matricule`
(`EMP-…`, colonne calculée), lu par Keystone, Codex, Vigie et Matrix, et le contrat de `pub_presences_prevues` décrit
sa colonne `matricule` comme le matricule I ou E.

Proposition de Cursus, sans rien retirer ni renommer (règle des contrats) :

1. `pub_salaries.matricule` reste `EMP-…` pour tout le monde (aucun lecteur actuel n'est touché).
2. Une quatrième colonne s'ajoute en fin du contrat D01 v2 de `pub_salaries` : `matricule_site` (`I…`, `E…`, ou null),
   que Vigie affiche et sur laquelle le poste de garde s'appuie.
3. `pub_presences_prevues.matricule` publie le matricule Cursus `EMP-…` (clé de jointure D01 avec `pub_salaries`), et
   une colonne `matricule_site` s'ajoute en fin de son contrat.

Variante, si Vigie préfère ne joindre que sur le matricule de site : `pub_presences_prevues.matricule` =
`employes.matricule_site`, et la jointure de Vigie se fait sur `pub_salaries.matricule_site`.

## Présences prévues (`cursus.pub_presences_prevues`)

Tables fournies par la migration `0032_declarations_presence.sql` (lot 14, étape 2) :

| Table | Colonnes utiles à la publication |
|---|---|
| `declarations_presence` | `id`, `categorie` (`exterieur` ou `interimaire`), `entreprise` (raison sociale ou agence), `site_code` (code du site de Matrix), `du`, `au` (dates), `objet`, `statut` (`a_valider`, `validee`, `refusee`, `annulee`), `emp_id` (fiche rattachée à la validation), `validee_le`, `maj_le` |
| `liens_declaration` | rien à publier (`empreinte` : sensible, demandée fermée à `matrix_lecture` : `matrix-lot14-declarations-presence.sql`) |

Ne sont publiables que les déclarations **validées**, puis éventuellement **annulées** après validation (`validee_le` non
nul) : jamais une déclaration en attente, refusée ou classée sans suite (données d'une personne qui n'est pas venue,
effacées 3 mois après). Colonnes jamais publiées : `nom`, `prenom`, `email` (la personne se lit par sa fiche,
`pub_salaries`), `motif` (texte libre, sensible), `decide_par`, `lien_id`.

Expression proposée, colonnes dans l'ordre du contrat `data/contrats/cursus.pub_presences_prevues.json` de Matrix
(proposition principale ci-dessus : matricule Cursus, plus le matricule de site en fin) :

```sql
SELECT 'DP-' || lpad(d.id::text, 6, '0') AS declaration_ref,
       e.matricule                      AS matricule,        -- EMP-… : clé de jointure D01 avec pub_salaries
       d.site_code                      AS site_code,        -- code de matrix.sites (D14)
       d.entreprise                     AS entreprise,
       d.du                             AS du,
       d.au                             AS au,
       d.objet                          AS objet,
       CASE d.statut WHEN 'validee' THEN 'validee' ELSE 'annulee' END AS statut,
       d.maj_le                         AS maj_le,
       e.matricule_site                 AS matricule_site    -- I… ou E…, ajouté en fin de contrat
FROM declarations_presence d JOIN employes e ON e.id = d.emp_id
WHERE d.validee_le IS NOT NULL AND d.statut IN ('validee', 'annulee')
```

Variante (Vigie joint sur le matricule de site) : `e.matricule_site AS matricule` à la place, sans la dernière colonne.
Une déclaration n'est jamais supprimée avant la fiche de la personne une fois validée ; annulée, elle reste publiée avec
le statut `annulee` pour que le poste de garde ne l'attende plus.

## Conformité aux règles M-17 et M-18

- Aucune vue `pub_` créée ni modifiée par Cursus (`tests/m18-publications.test.ts`) : Matrix définit les deux publications.
- Lien de lecture `vigie_app` → `cursus.pub_presences_prevues` : déjà inscrit par Matrix à la demande de Vigie.
- Aucune donnée de santé ; l'adresse e-mail publiée est l'adresse professionnelle saisie par le service RH ou validée par
  lui à partir d'une pré-déclaration.
