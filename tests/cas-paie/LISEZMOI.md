# Cas de paie

Chaque fichier `<nom>.json` de ce dossier est un cas de paie : un salarié, son contrat, ses absences et ses heures
validées, avec les résultats que la paie attend. `npm test` (`tests/cas-paie.test.ts`) rejoue chaque cas sur une base
en mémoire neuve, à la date du jour du cas, et liste chaque écart valeur par valeur. Ajouter un cas ne demande aucun
code : déposer le fichier, lancer `npm test`. Un dossier sans cas ne fait échouer aucun test.

Les trois cas livrés (`source: "fabriqué"`) sont construits à partir des règles légales et des réglages par défaut
(CCN des industries chimiques, 23 RTT, heures supplémentaires payées, période de paie du mois du dimanche). Les cas
réels promis par la paie avant la mise en service s'ajoutent avec `source: "paie"`.

## Cas réels : anonymisation avant tout versionnement

Ce dossier est versionné dans le dépôt git : un fichier qui y entre reste dans l'historique (et chez l'hébergeur du
dépôt) et ne peut plus en être retiré sans réécrire cet historique. Sur un site d'une centaine de personnes, une date
de naissance ou une date d'entrée suffit à reconnaître un salarié. Un cas réel n'y est donc déposé qu'une fois
transformé ainsi :

- **aucun élément identifiant** : nom et matricule fictifs (`Salarié A`, `CAS101`), aucun poste, équipe, commentaire
  ou détail qui permette de reconnaître la personne ;
- **date de naissance fictive** : à omettre quand l'âge ne joue pas ; sinon une date fictive qui garde seulement la
  tranche d'âge utile au calcul (mineur, 58 ans, 59 ans) ;
- **dates décalées** : entrée, sortie, absences et semaines décalées d'un même nombre de semaines (les jours de la
  semaine sont conservés), en restant dans la même période de congés, la même année de RTT et sans faire entrer ni
  sortir un jour férié du cas ; quand le calcul ne le permet pas, le cas reste hors du dépôt (ci-dessous) ;
- **aucune donnée de santé** : la nature d'une absence pour raison de santé (`MALADIE`, `ALD`, `AT`, `TRAJET`, `MP`,
  `ENFANT_MALADE`, `HANDICAP_ENFANT`) est elle-même une donnée de santé (docs/RGPD.md, art. 9), comme dans le journal
  et les e-mails qui l'expurgent. Elle est remplacée par une absence non médicale de même effet sur le calcul quand il
  en existe une (par exemple `SANS_SOLDE` pour une absence qui ne fait qu'interrompre les heures) ; sinon le cas reste
  hors du dépôt. Le test refuse un cas `source: "paie"` de ce dossier qui contient une nature médicale.

**Cas hors du dépôt.** Un cas réel qui ne peut pas être anonymisé ainsi (congés acquis pendant un arrêt, accident du
travail, reprise après une longue maladie…) est déposé dans un dossier hors du dépôt, sur le poste de la personne qui
l'analyse avec la paie, et rejoué par `CURSUS_CAS_PAIE=/chemin/absolu/du/dossier npm test`. Ces cas suivent le même
format, ne sont jamais copiés dans `tests/cas-paie/` et sont supprimés une fois l'écart analysé ; seul un cas
fabriqué qui reproduit la même règle (`source: "fabriqué"`, natures médicales permises) entre dans le dépôt.

## Format

```json
{
  "description": "Ouvrier 39 h + RTT, une semaine à 48 h",
  "commentaire": "facultatif : origine, règle vérifiée, écart analysé avec la paie",
  "source": "paie",
  "aujourdhui": "2026-10-31",
  "reglages": { "heuresSupMode": "paiement", "rtt39": 23 },
  "salarie": { "nom": "Salarié A", "matriculePaie": "CAS101", "entree": "2024-01-08", "fin": null, "naissanceLe": null },
  "contrat": { "statut": "ouvrier", "typeContrat": "cdi", "temps": "39h_rtt", "heures": null, "forfaitJours": null, "jourOff": [] },
  "reprise": { "arreteLe": "2026-05-31", "cpPris": 3, "rttPris": 2 },
  "absences": [{ "type": "CP", "du": "2026-08-03", "au": "2026-08-14", "statut": "validee", "debutDemi": null, "finDemi": null }],
  "semaines": [{ "lundi": "2026-10-12", "heures": [9, 9, 9, 9, 8, 4, 0], "projet": "INT-PROD" }],
  "attendu": {
    "cp": { "droit": 25, "pris": 10, "solde": 15 },
    "rtt": { "droit": 23, "pris": 1, "solde": 22 },
    "recup": null,
    "semaines": [{ "lundi": "2026-10-12", "normal": 39, "sup25": 4, "sup50": 5 }],
    "fichierSage": [{ "periode": "2026-10", "rubrique": "HS25", "quantite": 4 }]
  }
}
```

- `aujourdhui` : date du calcul (comme `CURSUS_TODAY`) ; elle fixe la période de congés en cours, l'année des RTT et la
  période de paie ouverte (une semaine d'une période close part en rappel sur la période ouverte).
- `reglages` : seulement ceux qui diffèrent des valeurs par défaut de Paramètres (`shared/reglages.ts`), avec une
  valeur que Paramètres accepte telle quelle.
- `contrat` : `statut` (`ouvrier`, `technicien`, `cadre`), `typeContrat` (`cdi`, `cdd`, `alternance`, `interim`),
  `temps` (`35h`, `39h_rtt`, `partiel`, `forfait_heures_hebdo`, `forfait_heures_annuel`, `forfait_jours`, `dirigeant`) ;
  `heures` pour un temps partiel ou un forfait hebdomadaire, `jourOff` (0 = lundi … 4 = vendredi) pour un temps partiel.
- `reprise` : compteurs arrêtés dans Lucca, comme l'import de la mise en service.
- `absences` : validées par défaut (`statut` : `demandee`, `validee`, `refusee`, `signalee`, `annulee`) ; types de
  `shared/types.ts` (`CP`, `RTT`, `RECUP`, `SANS_SOLDE`…, natures médicales réservées aux cas fabriqués et aux cas
  hors du dépôt) ; `debutDemi` et `finDemi` : `matin` ou `apres_midi`.
- `semaines` : feuilles validées ; heures du lundi au dimanche (7 valeurs, ou 5 sans le week-end).
- `attendu` : ne sont comparées que les valeurs écrites. `cp`, `rtt`, `recup` : compteurs (`droit`, `pris`, `poses`,
  `solde` ; `null` : Cursus ne doit pas tenir ce compteur). `semaines` : décompte (`total`, `normal`, `sup25`, `sup50`,
  `hc10`, `hc25`, `incluses25`, `incluses50`, `recup`, `jours`). `fichierSage` : lignes du fichier d'import du lot, par
  période et rubrique (codes internes tant que la correspondance avec le plan de paie n'est pas saisie), quantités
  cumulées ; toute ligne produite par Cursus et absente du cas est un écart.

Tout champ absent de ce format (faute de frappe comprise, à tous les niveaux) et toute valeur hors des listes
ci-dessus font échouer le cas avec le message « Cas <nom> : … » : sinon le cas serait rejoué avec la valeur par défaut
et l'erreur du fichier passerait pour un écart de calcul.

Un écart n'est pas corrigé en changeant le cas : il s'analyse avec la paie, puis la règle de Cursus ou le cas est
corrigé, avec l'explication dans `commentaire`.
