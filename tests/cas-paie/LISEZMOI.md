# Cas de paie

Chaque fichier `<nom>.json` de ce dossier est un cas de paie : un salarié, son contrat, ses absences et ses heures
validées, avec les résultats que la paie attend. `npm test` (`tests/cas-paie.test.ts`) rejoue chaque cas sur une base
en mémoire neuve, à la date du jour du cas, et liste chaque écart valeur par valeur. Ajouter un cas ne demande aucun
code : déposer le fichier, lancer `npm test`. Un dossier sans cas ne fait échouer aucun test.

Les trois cas livrés (`source: "fabriqué"`) sont construits à partir des règles légales et des réglages par défaut
(CCN des industries chimiques, 23 RTT, heures supplémentaires payées, période de paie du mois du dimanche). Les cas
réels promis par la paie avant la mise en service s'ajoutent avec `source: "paie"`, **anonymisés** : nom fictif,
matricule fictif, aucune donnée de santé (une absence garde sa nature, `MALADIE`, `AT`…, sans motif ni justificatif).

## Format

```json
{
  "description": "Ouvrier 39 h + RTT, une semaine à 48 h",
  "commentaire": "facultatif : origine, règle vérifiée, écart analysé avec la paie",
  "source": "paie",
  "aujourdhui": "2026-10-31",
  "reglages": { "heuresSupMode": "paiement", "rtt39": 23 },
  "salarie": { "nom": "Salarié A", "matriculePaie": "CAS001", "entree": "2024-01-08", "fin": null, "naissanceLe": "1985-04-12" },
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
- `reglages` : seulement ceux qui diffèrent des valeurs par défaut de Paramètres (`shared/reglages.ts`).
- `contrat` : `statut` (`ouvrier`, `technicien`, `cadre`), `typeContrat` (`cdi`, `cdd`, `alternance`, `interim`),
  `temps` (`35h`, `39h_rtt`, `partiel`, `forfait_heures_hebdo`, `forfait_heures_annuel`, `forfait_jours`, `dirigeant`) ;
  `heures` pour un temps partiel ou un forfait hebdomadaire, `jourOff` (0 = lundi … 4 = vendredi) pour un temps partiel.
- `reprise` : compteurs arrêtés dans Lucca, comme l'import de la mise en service.
- `absences` : validées par défaut ; types de `shared/types.ts` (`CP`, `RTT`, `RECUP`, `MALADIE`, `AT`…).
- `semaines` : feuilles validées ; heures du lundi au dimanche (7 valeurs, ou 5 sans le week-end).
- `attendu` : ne sont comparées que les valeurs écrites. `cp`, `rtt`, `recup` : compteurs (`droit`, `pris`, `poses`,
  `solde` ; `null` : Cursus ne doit pas tenir ce compteur). `semaines` : décompte (`total`, `normal`, `sup25`, `sup50`,
  `hc10`, `hc25`, `incluses25`, `incluses50`, `recup`, `jours`). `fichierSage` : lignes du fichier d'import du lot, par
  période et rubrique (codes internes tant que la correspondance avec le plan de paie n'est pas saisie), quantités
  cumulées ; toute ligne produite par Cursus et absente du cas est un écart.

Un écart n'est pas corrigé en changeant le cas : il s'analyse avec la paie, puis la règle de Cursus ou le cas est
corrigé, avec l'explication dans `commentaire`.
