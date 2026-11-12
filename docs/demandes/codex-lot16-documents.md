# Demande à Codex (GED) — tous les documents de Cursus stockés dans Codex (lot 16)

**Statut : validée par le propriétaire et portée le 10 novembre 2026** dans le `REQUESTS.md` de Codex (PR Codex#29), ouverte. Elle reprend et
complète `codex-lot11-pieces.md` (types des pièces des dossiers OPCO et des notes de frais), restée à valider.

## Décision du propriétaire (10 novembre 2026)

« Codex doit avoir tous les documents ; si les catégories adéquates ne sont pas disponibles, demande leur création dans
Matrix et Codex. Quel que soit le logiciel de notre suite, tout doit être stocké dans Codex. »

Cursus ne doit donc plus garder ses pièces dans son propre dossier : chaque fichier va dans Codex, et Cursus n'en garde que
la référence (`ged:<identifiant Codex>`, colonne `pieces.fichier`, adaptateur `server/src/integrations/ged.ts`).

## Ce qui empêche Cursus de le faire aujourd'hui

Le point d'entrée `POST /api/documents` (demande CX-03 d'Arche) suffit pour **déposer**, mais pas pour **tenir** les pièces
d'un dossier RH :

1. **Pas de lecture par l'application.** Cursus sert chaque pièce à ses propres utilisateurs (le salarié, son manager, le
   service RH, le référent HSE, la comptabilité), avec ses droits et son journal des consultations. Ces personnes n'ont pas
   toutes un compte Codex, et les droits de Codex ne sont pas ceux d'un dossier du personnel. Cursus doit pouvoir relire le
   fichier qu'il a déposé.
2. **Pas de retrait ni d'effacement par l'application.** Une pièce jointe par erreur se retire aussitôt ; au terme de sa
   durée de conservation (RGPD), ou à l'anonymisation d'un dossier, elle doit être détruite. Codex ne détruit jamais
   aujourd'hui.
3. **Un dépôt naît en brouillon et attend un circuit de validation.** Une pièce justificative est un enregistrement (une
   preuve reçue), pas un document à approuver : un circuit par pièce encombrerait les valideurs pour rien.
4. **Les catégories manquent.** La famille `RHF` (« RH & Formation ») n'a que les sous-types fiche de poste, matrice de
   compétences, support de formation et feuille de présence.

## Demande

### 1. Catégories (registre de Codex, `src/db/registry.ts`, publié dans `codex.pub_types_document`)

Un type pour les **enregistrements du dossier du personnel** (ou des sous-types de `RHF`, au choix de Codex), département
RH, avec la confidentialité et la conservation de chaque catégorie. Durées : celles de Cursus (`docs/RGPD.md`, § 5),
toutes **à confirmer par le DPO**.

| Objet Cursus (`pieces.objet`) | Catégorie demandée | Confidentialité | Conservation (départ du salarié sauf mention) | Donnée de santé |
| --- | --- | --- | --- | --- |
| `absence` | Justificatif d'absence (volet employeur d'un arrêt, convocation, justificatif d'un congé pour événement familial…) | Très confidentiel | 5 ans | oui |
| `declaration` | Document déclaré par le salarié (passeport, visa, carnet de vaccination) | Très confidentiel | Passeport et visas : effacés au départ ; vaccination : 5 ans | oui (vaccination) |
| `certification` | Attestation de formation | Confidentiel | 5 ans | non |
| `habTitre` | Titre d'habilitation signé (électrique, autorisation de conduite…) | Confidentiel | 5 ans | non |
| `voyage` | Pièce du dossier de déplacement (ordre de mission, A1, invitation) | Confidentiel | 5 ans | non |
| `ligneFrais` | Justificatif de note de frais (pièce comptable) | Confidentiel | 10 ans après le paiement de la note | non |
| `ligneFraisSante` | Justificatif de note de frais — même catégorie que `ligneFrais`, accès restreint | Très confidentiel | 10 ans après le paiement | oui (ne doit pas se voir) |
| `vehiculePerso` | Carte grise, attestation d'assurance du véhicule personnel | Confidentiel | Usage du véhicule + durée des notes justifiées | non |
| `dossierOpco` | Pièce de dossier OPCO (facture, accord, convention, émargement…) : voir `codex-lot11-pieces.md` | Confidentiel | 10 ans après l'exercice (factures, accords) | non |
| (à venir) | Compte rendu d'entretien signé | Confidentiel | 5 ans | non |

### 2. Dépôt d'un enregistrement, sans circuit

Pour ces catégories, `POST /api/documents` crée un document **déjà enregistré** (statut à définir par Codex : en vigueur
ou « enregistrement »), sans circuit de validation ni révision ultérieure, comme une pièce reçue. Champs utiles en plus
de ceux d'aujourd'hui :

- `subjectMatricule` : matricule Cursus du salarié concerné (`EMP-…`, ou `I…`/`E…` pour une personne sur site), pour le
  classement par salarié et pour la conservation déclenchée par son départ (Codex le lit dans `cursus.pub_salaries`) ;
- `expiresAt` (déjà prévu) : fin de conservation que Cursus calcule quand elle ne dépend pas du départ (notes de frais
  payées, dossiers OPCO) ;
- propriétaire : le compte de service de Cursus, jamais la personne connectée ; `sourceRef` :
  `cursus:piece/<identifiant>`, rejouable ; `sha256` toujours fourni.

### 3. Lecture du fichier par l'application

`GET /api/documents/{id}/file` avec le jeton de dépôt (ou un jeton de lecture propre à Cursus) : le fichier tel que
déposé, avec son type et son empreinte. Codex journalise la lecture (application, référence) ; Cursus garde son propre
journal des consultations (personne, pièce, heure). Réservé aux documents déposés par l'application (`sourceRef` de son
préfixe).

### 4. Retrait et destruction par l'application

`POST /api/documents/{id}/destroy` (ou équivalent) avec un motif codé : `retrait` (pièce jointe par erreur),
`conservation` (terme atteint), `effacement` (droit à l'effacement, anonymisation d'un dossier). Le fichier et ses
versions sont détruits ; Codex garde une trace sans contenu (identifiant, catégorie, date, motif, application), comme
Cursus le fait déjà. Refus si le document est sous gel juridique.

### 5. Confidentialité et données de santé

- Les catégories « Très confidentiel » ne sont lues que par le compte de service de Cursus et, dans Codex, par les
  personnes que le service RH désigne ; elles ne figurent jamais dans les vues `pub_` (c'est déjà le cas pour
  « Très confidentiel »).
- Chiffrement au repos des fichiers de ces catégories (Cursus chiffre aujourd'hui ses pièces en AES-256-GCM) ; antivirus
  au dépôt (déjà en place).
- Le titre du document ne nomme jamais une donnée de santé : Cursus envoie un titre neutre (« Justificatif d'absence —
  EMP-0042 — 2026-11 »).

## Ce que fera Cursus

- L'adaptateur `ged` (`server/src/integrations/ged.ts`) dépose, relit et détruit par ces points d'entrée ; le réglage
  « Stockage des pièces » passe à « GED » ; jeton et adresse dans l'environnement (`CODEX_URL`,
  `CODEX_DOCUMENTS_TOKEN`, `CODEX_DOCUMENTS_SECRET`), jamais dans la base.
- Reprise des pièces du dossier local : chacune déposée, vérifiée par son empreinte, puis effacée localement.
- Tant que les points 2 à 4 ne sont pas livrés, Cursus garde ses pièces en local : déposer des brouillons qu'on ne peut ni
  relire ni détruire ferait deux copies, dont une hors de ses règles de conservation.

## Conformité aux règles des échanges (M-17, M-18)

Écriture chez Codex par son API seulement ; lecture de l'état des documents par ses vues `pub_` (liens à décider par
Matrix : `matrix-lot16-documents.md`). Aucune vue `pub_` de Cursus.
