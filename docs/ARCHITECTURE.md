# Architecture de Cursus

Cursus est une application web full-stack légère : un serveur Node/Express qui
stocke les données dans SQLite (module natif `node:sqlite`) et une interface
React + TypeScript compilée par Vite. Les règles métier sont écrites une seule
fois dans `shared/` et utilisées des deux côtés.

```
shared/            Domaine partagé (aucune dépendance)
  types.ts         Modèle de données (Dataset = instantané visible par l'utilisateur)
  constants.ts     Libellés, classes de statut, règles fixes (contrats, visas, vaccins, entretiens)
  dates.ts         Dates ISO, jours fériés calculés, périodes de référence CP
  format.ts        Mise en forme française (dates, heures, jours, euros, pluriels)
  domain.ts        Classe Domain : conformité, habilitations, voyages, échéances, Go / No Go
  rules/           temps.ts, conges.ts, entretiens.ts, budget.ts, imports.ts
server/src/
  db.ts            Schéma déclaratif SQLite + requêtes génériques (all/get/insert/update/remove/tx)
  seed.ts          Données de démonstration
  dataset.ts       Assemblage de l'instantané + restriction par rôle (RH / manager / collaborateur)
  auth.ts          Sessions signées ; point d'entrée pour l'authentification unique
  actions/         Actions métier (POST /api/actions/:nom), contrôles d'accès et validations
  integrations/    Adaptateurs Keystone et Sage Paie (simulation par défaut)
  index.ts         Routes HTTP
client/src/
  state/store.tsx  Session, données, navigation, filtres d'écran (ui), dialogue ouvert, notifications
  state/derived.ts Hooks mémorisés : useDomain, useEnriched, useTrips, useRole
  components/      ui.tsx (Page, Kpi, Panel, Tag, Seg, Two, Bar…) et Dialog.tsx (Dialog, Field…)
  layout/Shell.tsx Barre latérale, en-tête, notification
  pages/           Un fichier par écran
  dialogs/         Un fichier par dialogue, rendus par DialogHost
  styles/          nocturne.css (design system, ne pas modifier) et app.css (mise en page)
design/            Prototype Claude Design de référence et guide du design system Nocturne
```

## Flux de données

1. `GET /api/data` renvoie l'instantané `Dataset` **déjà restreint au périmètre**
   de l'utilisateur : un manager ne reçoit que son équipe, sans données de santé
   (`visite` remplacée par `aptitude.ok`, vaccinations retirées, état des dossiers
   voyage précalculé dans `voyage.dossierStatut`) ; un collaborateur ne reçoit que
   ses propres données.
2. Le client calcule l'affichage avec `shared/` (statuts, soldes, échéances…).
3. Toute modification passe par `run('nom.action', payload)` → `POST /api/actions/:nom`.
   Le serveur vérifie les droits, valide, écrit dans une transaction, trace l'action
   dans le journal et renvoie `{ message, data }` : le client remplace son instantané
   et affiche le message.

## Conventions d'écran

- Reprendre fidèlement le prototype `design/prototype-suivi-formations.dc.html`
  (structure, libellés, ordre des colonnes, textes d'aide). Ses valeurs calculées sont
  dans `renderVals()` ; les règles correspondantes existent déjà dans `shared/`.
- Utiliser les composants de `components/ui.tsx` et `components/Dialog.tsx` et les
  classes de `styles/app.css` ; les couleurs, espacements et rayons viennent toujours
  des variables Nocturne (`var(--color-*)`, `var(--space-*)`…), jamais de valeurs en dur.
- Les filtres et sélections persistants entre écrans vivent dans `ui` (`useStore().ui`,
  `setUi`) ; l'état local d'un formulaire vit dans le composant.
- Ouvrir un dialogue : `openDialog({ type: 'plan', … })` (types dans `state/store.tsx`).
  Un dialogue garde ses champs en `useState`, appelle `run(...)` et se ferme si `r.ok`.
- Les propositions d'action calculées par le domaine (`Proposal.intent`) s'exécutent
  avec `runIntent(intent)`.
- Masquer les actions que le rôle n'a pas le droit d'effectuer (le serveur refuse de
  toute façon) : `useRole()` donne `rh`, `manager`, `collab`, `me`.
- Icônes : Phosphor (`@phosphor-icons/react`, noms suffixés `Icon`).

## Actions disponibles

| Action | Paramètres | Droits |
| --- | --- | --- |
| `employe.creer` | fiche complète (`ProfilInput` de `shared/rules/profil.ts`) | RH |
| `employe.modifier` | id + champs de la fiche | RH : tous ; manager : `poste`, `jourOff` (temps partiel) des membres de son équipe |
| `equipe.creer` / `equipe.renommer` / `equipe.supprimer` | nom, managerId? / nom, nouveau / nom | RH |
| `equipe.manager` | nom, managerId (null = aucun) | RH |
| `equipe.affecter` | empId, equipe (null = à affecter) | RH ; manager : ajout à une équipe qu'il encadre, retrait d'un membre |
| `plan.inscrire` | empId, certId, sessionId, conv (`now`/`later`) | RH, manager direct |
| `cert.ajouter` | empId, f, date | RH |
| `session.creer` | f, date, lieu, places, planId? | RH |
| `hab.delivrer` | empId, h, date, par, mode | RH |
| `hab.suspendre` | empId, h, motif, date? (aujourd’hui par défaut) | RH ; manager pour un membre de son équipe (jamais lui-même) |
| `hab.lever` | empId, h | RH |
| `hab.retirer` | empId, h, motif, date? | RH |
| `medical.demander` | empId | RH |
| `demande.accepter` / `demande.refuser` | id | RH |
| `demande.formation` | f (ou `autre`), libelle, sessionId, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `demande.habilitation` | h, motif, empId (manager) | collaborateur pour lui-même, manager pour un membre de son équipe |
| `voyage.creer` | empId, dest, depart, retour, motif | RH |
| `formalite.enregistrer` | empId, kind (`passeport`/`visa`/`vaccin`), numero, expire, dest, visaType, obtenu, v, date | RH, ou le collaborateur pour lui-même |
| `voyages.importer` | texte (CSV) | RH |
| `keystone.accepter` / `keystone.refuser` | id | RH |
| `plan.importer` | texte, exercice, mode (`add`/`replace`) | RH |
| `budget.enveloppes` | exercice, enveloppes {équipe: montant} | RH |
| `plan.avancer` | id | RH |
| `temps.setCell` | empId, week, li, di, value | salarié, manager direct ou RH (feuille soumise : valideur uniquement) |
| `temps.addLine` / `temps.removeLine` | empId, week, projet / li | idem |
| `temps.suggest` / `temps.submit` | empId, week | idem (soumission : brouillon ou à corriger) |
| `temps.validate` / `temps.reject` | empId, week, comment? | manager direct ou RH |
| `temps.pushSage` | — | RH |
| `absence.demander` | empId, kind (`CP`/`RTT`/`RECUP`), du, au | intéressé ou RH (demande) ; manager direct (posée et validée) |
| `absence.decider` | id, ok | manager direct ou RH |
| `cet.placer` | empId, kind, jours | intéressé ou RH |
| `report.accorder` | empId, jours, motif | RH |
| `entretien.planifier` | empId, kind, date | manager direct ou RH |
| `entretien.modifier` | id, section?, value?, info? | évaluateur / salarié selon la section |
| `entretien.clore` | id | évaluateur |
| `entretien.signer` | id | salarié |
| `parametres.maj` | horizonAlerte, seuilBudget, rtt39, uniquementReglementaire, partageKeystone, silent? | RH |
| `demo.reinitialiser` | — | RH, mode démonstration |

## Contrat et temps de travail

Chaque fiche porte trois notions distinctes (`shared/constants.ts`) :

- **Statut** (`STATUTS`) : les catégories de la CCN Industries chimiques — ouvrier / employé,
  technicien / agent de maîtrise (non-cadres) et ingénieur / cadre.
- **Nature du contrat** (`TYPES_CONTRAT`) : CDI, CDD, intérim, alternance.
- **Organisation du temps** (`TEMPS_TRAVAIL`) : horaire collectif 35 h, 39 h avec RTT, forfait
  hebdomadaire en heures, forfait annuel en heures, forfait annuel en jours, temps partiel, cadre dirigeant.

`Domain.contratOf(e)` lit ces champs et expose les indicateurs utilisés par les règles (`seuil` des heures
supplémentaires, `forfait` jours, `annuel`, `hebdo`, `partiel`, `dirigeant`, `interim`, `rtt`).
`shared/rules/profil.ts` contient les contrôles de cohérence (bloquants et avertissements) partagés par
le formulaire et le serveur. Une base créée avant ce modèle est convertie au démarrage (`server/src/migrate.ts`).

Les équipes (`referentiels.equipes`) portent leur manager ; un collaborateur sans équipe (`equipe = null`)
est « à affecter » et relève du service RH.

## Certifications et habilitations

- **Certification en vigueur** : pour chaque collaborateur et chaque formation, seule la plus récente
  compte (`certEnVigueur` de `shared/domain.ts`) — statut, échéances, indicateurs, prérequis des
  habilitations, Go / No Go, fiche et passeport formation. Les certifications remplacées par un
  recyclage restent en base : `EmpX.anciennes` les expose comme historique (« remplacée le … »).
  Leur place dans une session à venir, postérieure au recyclage, est libérée (`cert.ajouter`, et au
  démarrage pour une base existante : `server/src/migrate.ts`).
- **Suspension et retrait** : un titre délivré porte une éventuelle mesure (`mesure`, `mesureDate`,
  `mesureMotif`, `mesurePar`). Suspendu (`susp`) ou retiré (`retiree`), il n'est plus valide : fiche
  non conforme, échéance dépassée, No Go avec les codes `HABILITATION_SUSPENDUE` / `HABILITATION_RETIREE`.
  La suspension se lève (RH) ; le retrait est définitif, seule une nouvelle délivrance, datée au plus tôt
  du jour du retrait, rétablit le titre. Une demande acceptée après un retrait reste notée sur le titre
  (`demande`) jusqu'à cette nouvelle délivrance.
  Le motif est un texte libre visible du manager et du collaborateur, jamais transmis à Keystone.
  Une base existante reçoit les nouvelles colonnes au démarrage (schéma déclaratif de `server/src/db.ts`).

## Intégrations

- **Keystone → Cursus** : `GET /api/integrations/keystone/chantiers/:id/go-no-go` et
  `POST /api/integrations/keystone/demandes` (en-tête `X-Api-Key`, variable
  `KEYSTONE_API_KEY`). Seuls des matricules et codes de motif sortent de Cursus.
- **Cursus → Keystone** : `server/src/integrations/keystone.ts` (`sendToKeystone`) —
  décisions sur les demandes, heures validées, absences validées, verdicts modifiés par une
  suspension, une levée, un retrait ou la nouvelle délivrance qui suit un retrait (`verdict.modifie` :
  chantier, matricule, codes de motif). En simulation, les messages sont écrits dans le journal.
- **Sage Paie** : `server/src/integrations/sage.ts` (`pushToSage`).
- **Authentification unique** : `server/src/auth.ts` et la route `/api/login`.
