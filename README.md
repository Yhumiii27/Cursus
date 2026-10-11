# Cursus

Outil RH de suivi des **formations, certifications et habilitations**, des **feuilles de
temps**, des **congés**, des **entretiens obligatoires** et des **déplacements**, avec
un verdict **Go / No Go** par chantier pour Keystone et la transmission des variables
de paie à **Sage Paie**.

Construit à partir de la maquette Claude Design « Outil RH gestion formations »
(design system Nocturne) — voir `design/`.

## Démarrer

Prérequis : Node.js 22.18 ou plus récent (aucune base de données à installer : SQLite est intégré à Node).

```bash
npm install
```

```bash
npm run dev
```

Ouvrir http://localhost:5173. Au premier lancement, la base `data/cursus.db` est créée
avec les données de démonstration (24 collaborateurs d'un site industriel, CCN
Industries chimiques).

### Trois espaces

Le sélecteur **Vue** de la barre latérale bascule entre les espaces (mode démonstration) :

- **RH** (Sandrine Vidal) : tout l'outil, dont la création et la modification des fiches
  (statut, contrat, organisation du temps) et l'écran « Équipes & managers » (créer, renommer,
  supprimer une équipe, désigner son manager, affecter les collaborateurs).
- **Manager** : son équipe — inscriptions aux sessions et demandes de formation / habilitation,
  absences posées et validées, saisie et correction des feuilles de temps, poste et jours non
  travaillés des fiches, ajout et retrait de membres, entretiens, missions.
  Pas d'accès aux données de santé (seul le verdict d'aptitude est transmis).
- **Utilisateur** (collaborateur) : ses formations, habilitations, voyages, heures,
  absences, entretiens et demandes au service RH.

En démonstration, n'importe quel mot de passe est accepté.

## Application de bureau (macOS)

```bash
npm run app
```

Crée `Cursus.app` sur le Bureau : double-cliquez pour ouvrir Cursus dans sa propre fenêtre. L'application
démarre le serveur local (port 3217, accessible uniquement depuis ce Mac) et l'arrête à la fermeture.
Relancez `npm run app` après une modification du code ou un déplacement du dossier. Journal du serveur :
`~/Library/Logs/Cursus/serveur.log`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | API (port 3210) + interface Vite (port 5173) avec rechargement à chaud |
| `npm run build` puis `npm start` | Production : l'API sert l'interface compilée sur le port `PORT` (3210 par défaut) |
| `npm test` | Tests des règles métier et des droits d'accès |
| `npm run typecheck` | Vérification TypeScript |
| `npm run backup` | Copie à chaud vérifiée de la base dans `data/backups`, avec rotation |
| `npm run restore -- <fichier>` | Remplace la base par une sauvegarde (serveur arrêté) |
| `npm run reset-demo` | Recharge les données de démonstration |

## Configuration (variables d'environnement)

| Variable | Effet |
| --- | --- |
| `PORT` / `CURSUS_API_PORT` | Port du serveur (3210 par défaut) |
| `CURSUS_DB` | Fichier SQLite (`data/cursus.db` par défaut) |
| `CURSUS_BACKUP_DIR` | Dossier des sauvegardes (`backups/` à côté de la base par défaut) |
| `CURSUS_BACKUP_KEEP` | Sauvegardes conservées par type (14 par défaut, `0` pour tout garder) |
| `CURSUS_TODAY` | Fige la date du jour (AAAA-MM-JJ), utile pour la démonstration — les données de démo sont datées d'octobre 2026 |
| `CURSUS_DEMO` | `0` pour désactiver le mode démonstration (connexion libre, sélecteur de vue, réinitialisation) |
| `CURSUS_SECRET` | Clé de signature des sessions (générée et stockée en base sinon) |
| `KEYSTONE_API_KEY` | Clé attendue des appels entrants de Keystone (`demo-keystone` par défaut) |
| `KEYSTONE_URL`, `SAGE_URL`, `SAGE_DOSSIER` | Bascule des adaptateurs en mode API (à compléter, voir ci-dessous) |

## Sauvegarde

Toutes les données tiennent dans le fichier SQLite `CURSUS_DB`. `npm run backup` en fait une copie
cohérente sans arrêter le serveur (`VACUUM INTO`), la vérifie et ne garde que les 14 plus récentes ;
le code de sortie signale un échec à la supervision. Une copie est aussi faite automatiquement avant
une migration de la base et avant la réinitialisation de la démonstration. `npm run restore -- <fichier>`
vérifie la sauvegarde, refuse de s'exécuter si le serveur tourne (sauf `--force`), copie la base
actuelle puis la remplace.

Planification (timer systemd), copie chiffrée hors de la machine, restauration pas à pas et test
périodique : `docs/SAUVEGARDE.md`.

## Ce qui reste simulé

- **Authentification** : sélection d'un profil + mot de passe libre. Brancher l'authentification
  unique de l'entreprise (OIDC / SAML) dans `server/src/auth.ts` et la route `/api/login`.
- **Keystone** : les appels entrants (`GET /api/integrations/keystone/chantiers/:id/go-no-go`,
  `POST /api/integrations/keystone/demandes`) sont réels ; les messages sortants (décisions,
  heures et absences validées) sont tracés dans le journal (`server/src/integrations/keystone.ts`).
- **Sage Paie** : la transmission produit le JSON des variables et un accusé fictif
  (`server/src/integrations/sage.ts`) ; la correspondance des rubriques avec le plan de paie reste à paramétrer.
- **Convocations, demandes de visite médicale** : notifiées dans l'interface et tracées, sans envoi d'e-mail.

## Contrat et temps de travail

Chaque fiche distingue le **statut** (catégories de la CCN Industries chimiques : ouvrier / employé,
technicien / agent de maîtrise, ingénieur / cadre), la **nature du contrat** (CDI, CDD, intérim,
alternance) et l'**organisation du temps** : horaire collectif 35 h, 39 h avec RTT, forfait
hebdomadaire en heures, forfait annuel en heures, forfait annuel en jours, temps partiel, cadre
dirigeant. Un changement d'organisation du temps prend effet à une date choisie : les semaines
antérieures gardent l'ancien régime (figé sur chaque feuille soumise) et les RTT / jours de repos
sont proratisés.

## Règles métier implémentées

Validité des certifications et seuil d'alerte (30–180 j) · prérequis des habilitations
(formation + aptitude médicale de 24 mois) avec suspension automatique · formalités de
voyage par destination (passeport, visas, vaccins, délais) · Go / No Go par chantier
(matricules et codes de motif uniquement) · heures supplémentaires +25 % / +50 %,
heures complémentaires +10 % / +25 %, forfait jours, alertes 10 h / 48 h · repos
compensateur · CP 25 jours ouvrés (+5 j à 59 ans, CCN Chimie), RTT, jours de repos
forfait calculés, CET (5 RTT/an, 5e semaine de CP), reports tracés · entretiens de
parcours (L6315-1 : 1re année puis tous les 4 ans, reprise, état des lieux 8 ans avec
risque d'abondement CPF), entretien annuel forfait jours (L3121-64) · plan de formation,
enveloppes par équipe, import CSV.

Jours fériés et périodes de référence (CP, RTT, campagnes) calculés à partir de la date du jour.

Architecture et conventions : `docs/ARCHITECTURE.md`. Travail restant, priorisé : `docs/RESTE_A_FAIRE.md`.
