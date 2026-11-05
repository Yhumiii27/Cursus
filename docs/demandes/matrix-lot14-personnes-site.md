# Note à Matrix — lot 14 : personnes sur site (intérimaires, extérieurs, présences prévues)

**Statut : proposition à valider par le propriétaire** (5 novembre 2026). Rien n'est écrit dans le dépôt de Matrix depuis
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

Les tables des pré-déclarations arrivent à l'étape 2 du lot 14 ; leurs colonnes seront ajoutées à cette note avant sa
validation : déclaration (référence, statut `validee` ou `annulee`, dates, objet, site, entreprise, date de mise à jour),
personne rattachée par le service RH (`emp_id`, d'où le matricule). Seules les déclarations validées puis éventuellement
annulées sont publiables ; jamais une déclaration en attente ou refusée (données d'une personne qui n'est pas venue).

## Conformité aux règles M-17 et M-18

- Aucune vue `pub_` créée ni modifiée par Cursus (`tests/m18-publications.test.ts`) : Matrix définit les deux publications.
- Lien de lecture `vigie_app` → `cursus.pub_presences_prevues` : déjà inscrit par Matrix à la demande de Vigie.
- Aucune donnée de santé ; l'adresse e-mail publiée est l'adresse professionnelle saisie par le service RH ou validée par
  lui à partir d'une pré-déclaration.
