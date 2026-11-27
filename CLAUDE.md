# Cursus — consignes pour les sessions Claude

@norma/REGLES.md

Règles communes de la suite EPC2I (Norma) : copie versionnée dans `norma/` (version `norma/VERSION`), contrôlée par
`npm run norma:check` (CI) ; elles se changent dans le dépôt `Yhumiii27/Norma`, jamais ici. Ce fichier n'ajoute que les
règles propres à Cursus.

Coque commune et logo (Norma 2.3.0, 25 novembre 2026, `norma/charte/COQUE.md` § 2 et § 8 bis) : la marque de la barre
latérale (26 px, `.coque-logo-mark`) et de la barre supérieure (20 px, `.coque-topbar-mark`) affiche `ToolLogo code="cursus"`
(`norma/charte/ds/ToolLogo.tsx`, importé par `client/src/layout/Shell.tsx`) ; le favicon `client/public/favicon.svg` est
`norma/charte/logos/cursus.svg` recopié. Les icônes PNG de l'application installée (`client/public/icons/` : 192, 512,
512 masquable, iOS 180) sont ce logo rendu sans dépendance par `scripts/icones.mjs`, à relancer quand le logo change
(`tests/pwa.test.ts` compare au contenu commité).

Cursus est l'outil RH du groupe EPC2I (formations, habilitations, temps, absences, entretiens, déplacements, frais).
Lire d'abord `README.md` et `docs/ARCHITECTURE.md` ; le reste à faire se tient dans Norma (`reste-a-faire/cursus.json` du dépôt `Yhumiii27/Norma`, page globale
https://claude.ai/artifact/Rs7kooJdowShdYUqNS8jQf, `norma/REGLES.md` § 3) ; `docs/RESTE_A_FAIRE.md` est la liste close au
24 novembre 2026, gardée pour ses décisions et ses preuves.

## Langue de l'interface (CU-N01, Norma § 2 et § 7)

Chaînes sources en anglais, traduites en français par `client/src/i18n/` ; le français est la langue par défaut et
l'interface française reste mot pour mot celle d'avant la reprise. Sélecteur FR / EN en haut de la paire
langue / affichage (`PrefsStack` de la coque, `i18n/BoutonLangue.tsx`), cookie `cursus-lang`, changement sans
rechargement.

- `t('English source')` : entrée exacte de `i18n/fr.ts` (`FR`), sinon règle à paramètres (`FR_REGLES`, pour une chaîne
  qui porte un nombre : ``t(`at least ${n} characters`)``), sinon segments autour de « · », « — », « → », « / ».
- `tn(n, 'entry', 'entries')` : nombre et nom (pluriel anglais dès 0, pluriel français au-delà de 1, comme `plural`).
- Contexte `'Approved#fem'` : départage deux traductions d'une même chaîne anglaise (« Validée », « Validé ») ; il ne
  s'affiche jamais. Une chaîne identique dans les deux langues va dans `MEMES_EN_FRANCAIS`.
- Une ternaire dans `t()` ne porte que des chaînes à traduire (`cond ? t('a') : t('b')` sinon) ; une table de libellés
  garde ses sources anglaises et se traduit au rendu (`t(TABLE[k].label)`), avec son test de complétude.
- Jamais par `t()` : le texte saisi, les noms, les données, les messages du serveur ; restent aussi en français pour
  l'instant les libellés de `shared/` (constantes, règles, aide) et les dates (`fmtIso`, `fr-FR`).
- Complétude : `tests/client-i18n.test.ts` (`ECRANS_MIGRES`, `FICHIERS_MIGRES`) — chaque littéral de `t()` et de `tn()`
  des fichiers migrés a sa traduction, et ils n'ont plus de texte français en dur dans le JSX. Un écran se reprend en
  entier (page, composants et dialogues qu'il ouvre), puis s'ajoute à `ECRANS_MIGRES`.
- Repris : la coque (`App.tsx`, `layout/`, `components/Dialog.tsx`, thème), la connexion (`pages/Login.tsx`), Hors ligne,
  Changer mon mot de passe, Avis demandés, Pointages (page, pointage du jour, semaine, corrections, présences du jour,
  dialogue de correction, confirmations), Habilitations (registre, délivrance, suspension, levée et retrait), avec les
  composants communs qu'il emploie (`components/TriListe.tsx`, `tri.ts`, `ReferentielVide.tsx`, `PieceJointe.tsx`,
  `controles.ts` : repris pour tous les écrans qui s'en servent), Confidentialité (cadre de la page ; le texte de
  `shared/confidentialite.ts` reste en français), Expositions (C2P), Formations (sessions, renouvellements, listes d'attente,
  e-learning, passeport de prévention, évaluations ; dialogues de session, de clôture, de planification et de demande ;
  sélecteur d'organisme), Congés & absences (soldes, demandes, règles, natures, clôtures, fractionnement, informations au
  retour, monétisations du CET et tous leurs dialogues ; mention « Lecture seule » de `components/Hierarchie.tsx`), avec les
  confirmations qu'ils ouvrent (`confirmations-attente.ts`, `confirmations-cet.ts`, abandon et suppression d'une
  inscription d'e-learning, désinscription et refus d'une absence de `confirmations.ts`), Notes de frais (Mes frais,
  validation, contrôle, avances, exports comptables, tableau de bord, historique et recherche, notes rattachées ; dialogues
  de dépense, de note, d'avance, de montant retenu, de véhicule, de taux, de limite d'exonération et de barème ;
  `confirmations-frais.ts`), Tableau de bord (indicateurs, demandes des collaborateurs et leur refus, acceptation sur liste
  d'attente, contrats, couvertures des équipes et des postes planifiés, habilitations des postes planifiés, dossiers à
  effacer), Échéances (avec fiches à compléter et dossiers OPCO), Missions & déplacements (planning des 4 semaines, grand
  déplacement), la saisie du jour des feuilles de temps (`SaisieJour.tsx`, `HorairesFeuille.tsx`), Voyages (dossier voyage,
  vigilance, dialogues de déplacement, d'import, de détachement et de formalité ; refus Keystone et annulation d'un
  déplacement), Collaborateurs (liste et fiche : aptitude et demande de visite imprimable, exigences, certifications,
  formations suivies, pièces, voyages, contrat — sortie et solde de sortie, CDD, titre de séjour, historique, forfaits jours
  et heures, mineur, nuit, mandats, contact d'urgence — ; dialogues de la fiche : collaborateur, sa propre fiche, membre,
  certification, visite, avis, suivi, demande d'habilitation, titre de séjour, avenants, CDD, sortie, mandat, pièce,
  formation suivie ; `PosteChoix.tsx`, `CopierLien.tsx`), la grille de la semaine de `Temps.tsx` (file de validation,
  récapitulatif paie), Équipes & managers (avec `Hierarchie.tsx`, `Delegations.tsx` et les dialogues d'équipe, de
  rattachement et de délégation), les dialogues d'e-learning (inscrire, terminer, corriger, importer), **toutes les
  confirmations** (`state/confirmations*.ts`), puis (partie 6) la recherche de l'annuaire (`layout/RechercheGlobale.tsx`) et
  `ChoixCollaborateur.tsx`, Organigramme (liste et vue graphique), Entretiens / 360° (échéances et comptes rendus, objectifs,
  points de suivi, feedback 360° ; compte rendu `EntDialog`, objectifs et souhaits `EntretienSuivi.tsx`, `Feedback360Bloc.tsx`,
  `Synthese360.tsx`, planification, remise, dialogues des objectifs, des souhaits et des répondants), Mes objectifs, Personnes
  sur site (et ses dialogues : extérieur, lien, validation d'une déclaration), Relevés (`Releves.tsx`) et Chantiers. Aide d'un motif lue au rendu : `aideMotifCorrection()`, `aideMotifOpco()`
  (`AIDE_MOTIF_CORRECTION` reste le texte français, pour les tests). Restent en français : le motif prérempli d'une demande
  de formation (texte saisi), les en-têtes des exports CSV et l'exemple de l'import e-learning, les jours abrégés de
  `SessionDialog`, les mois des notes de frais et des heures de délégation (comme les dates), les messages des règles de
  `shared/` (contrôles de la fiche, du CDD, du titre de séjour, de l'avis médical, `heuresSurAbsenceMessage`…), les libellés
  de `shared/` (statuts et catégories des notes de frais, types de véhicule, alertes, échéances, destinations, jours de la
  semaine, types d'entretien, statuts des objectifs et du 360°), le compte rendu d'entretien imprimé (`dialogs/compteRendu*.ts` :
  libellés des sections, mention d'information, aussi montrés dans `EntDialog`), l'organigramme imprimé et son export
  (`organigramme-vue.ts`), l'historique de la fiche (`HistoriqueFiche` de `pages/Journal.tsx`) et les panneaux de l'écran Temps hors de la
  grille (`LotsPaie`, `SuiviFeuilles`, `ReposAVerifier`, `AlertesDurees`, `Astreintes`, forfait annuel en heures,
  planning d'équipe). Tous les autres écrans restent en français en dur (prochains : Budget, Indicateurs, Mon planning et le
  planning d'équipe (`PlanningDialog.tsx`, `planning-vue.ts`), Référentiels, Paramètres, Comptes, Mise en service, Journal,
  Messagerie, Portail, Déclarer, Aide).
- Table exportée déjà lue par sa valeur (module sans React, test) : `traduites({ clé: 'English source' })` de
  `i18n/langue.ts` rend chaque libellé dans la langue affichée à la lecture (`LIBELLES_ONGLETS_FRAIS`, `MARQUE` du planning
  des missions).
- Contexte suivi d'un blanc : le blanc avant le contexte (`' on #le'`, `'Save #verb'`), jamais après (`sansContexte` ne
  retire qu'un contexte final).

## Échanges avec les autres outils (décisions M-17 et M-18 de Matrix)

Matrix administre seul le serveur PostgreSQL commun : il définit ce que chaque outil publie, qui le lit et qui écrit
chez qui, et l'applique lui-même. Détail : `docs/ARCHITECTURE.md`, « Échanges avec les autres outils » ; inventaire :
`docs/ECHANGES.md` ; forme des demandes : `docs/demandes/LISEZ-MOI.md`.

- **Lire** chez un autre outil seulement par ses vues `pub_`, jamais par ses tables.
- **Écrire** chez un autre outil seulement par son API ou par une fonction `pub_` qu'il fournit ; jamais d'`INSERT`,
  `UPDATE` ni `DELETE` dans son schéma.
- **Les vues `pub_` de Cursus sont définies par Matrix** (écran « Publications ») : aucune migration de Cursus ne crée,
  ne modifie, ne commente ni ne supprime une vue `pub_` et n'y pose de droit (`tests/m18-publications.test.ts`). Une
  donnée à publier se demande à Matrix comme une publication ; avant de modifier une colonne lue par une vue `pub_`,
  Matrix fait d'abord évoluer la publication.
- **Un accès nouveau** se déclare comme un lien du registre `matrix.liens` (lecteur, objet, nature `lecture` ou
  `execution`, justification), par une demande rédigée dans `docs/demandes/`.
- **Une écriture qu'un autre outil ferait chez Cursus** passe par l'API de Cursus, ou par une fonction
  `pub_<verbe>_<objet>` de Cursus (`SECURITY DEFINER`, `SET search_path = cursus, pg_temp`, appelant identifié par
  `session_user`, règles et journal de Cursus, `REVOKE EXECUTE … FROM PUBLIC`) ; Matrix accorde son exécution.
- **Jamais d'écriture dans un autre dépôt** (Matrix, Keystone, Codex, Vigie, Arche, Crucible) : une demande se rédige
  dans `docs/demandes/` et attend la validation du propriétaire, qui la porte dans le `REQUESTS.md` de l'outil.

## Connecteurs

Un dossier par outil sous `server/src/integrations/` (`clavis/`, `codex/`, `keystone/`, `matrix/` ; hors du groupe
`microsoft/`, `push/`, `sage/`) : tout nouvel échange avec un autre outil s'y range (Norma § 5). Une source illisible est
un état affiché (« source indisponible », refus motivé, 503 avec message), jamais une erreur interne ; détail
`docs/ECHANGES.md`, « Où vivent les connecteurs ».

Pièces justificatives dans Codex (lot 16, CU-037, contrat de Codex du 26 novembre 2026) : `codex/codex-documents.ts`
(jeton `CODEX_CURSUS_TOKEN`, signature facultative `CODEX_CURSUS_SECRET`, type `DPE` et `category` de
`shared/rules/pieces-codex.ts`, empreinte `X-Codex-SHA256` contrôlée à la lecture), Codex simulé `codex/codex-simule.ts`
(`CODEX_SIMULATION=1`, jamais en production) pour la démonstration et les essais ; détail `docs/ARCHITECTURE.md`,
« Lot 16 ». La reprise des pièces locales est une étape d'exploitation : jamais lancée sur des données réelles sans le
propriétaire.

## Connexion par Clavis (24 novembre 2026)

Décision du propriétaire : une seule base pour tous les outils. Avec `CURSUS_OIDC_EMETTEUR` (adresse de Clavis) la
connexion « Microsoft 365 » passe par Clavis ; avec `CURSUS_ACCES_CLAVIS=on`, l'accès et le profil RH sont lus dans
`clavis.pub_acces` (`server/src/integrations/clavis/acces-clavis.ts`) à la connexion (`server/src/microsoft.ts`) et au plus toutes les
minutes pendant la session (`examinerSession`, `server/src/auth.ts`) ; compte créé à la première connexion, rattaché à
la fiche de même e-mail ; lecture impossible = refus. Guide : `docs/CONNEXION-MICROSOFT.md` § 6 bis.
