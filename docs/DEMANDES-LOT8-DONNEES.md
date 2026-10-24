# Demandes de Cursus aux autres dépôts — lot 8, chantier D (données personnelles sur le serveur commun)

Textes rédigés par Cursus, **non envoyés** : chaque demande part dans le `REQUESTS.md` du dépôt concerné seulement après
validation explicite de Guillaume (réponse du 24/10/2026 : Cursus n'écrit jamais dans un autre dépôt). Format de
`REQUESTS.md` (entrée prête à recopier). Ordre : la demande 2 part avant tout déploiement de la migration
`0011_pub_titres_valides` sur le serveur commun ; la demande 1 avant la reprise des données de Lucca (1er janvier 2027).

## [2026-10-24] Cursus → Matrix — Fermer à matrix_lecture les colonnes sensibles de Cursus (droits.colonnes_sensibles)
- Statut : À VALIDER (rédigée, pas envoyée)
- Demande : ajouter à `droits.colonnes_sensibles` (`infra/postgres/init/03-droits.sql`, bloc « Convention du
  15/10/2026 », origine `convention`) les 53 lignes de `docs/demandes/matrix-lot8-colonnes-sensibles.sql` du dépôt
  Cursus, puis rejouer `03-droits.sql` (le déclencheur `colonnes_sensibles_appliquer` retire aussitôt les droits).
  `journal.payload`, `journal.message` et `demandes_collab.label` passent de `proposition` à `convention`.
- Justification : Matrix ferme par liste d'exclusion. Le SELECT est accordé par défaut à `matrix_lecture` sur toutes les
  tables de `cursus` et `droits_ddl` ne retire que les colonnes listées. Restent donc lisibles par Matrix, ou par un
  administrateur qui fait `SET ROLE matrix_lecture` :
  - la nature des absences (`absences.type` : maladie, accident du travail…), les demandes de visite (visite de reprise
    = retour d'arrêt) et les informations de congés au retour d'un arrêt : données de santé (art. 9 du RGPD) ;
  - les empreintes scrypt des mots de passe des comptes locaux (ouvriers, intérimaires), cassables hors ligne ;
  - les sessions (`connexions`) ;
  - le contenu et le résumé des lots de paie : absence par absence, le matricule, les dates et la rubrique, qui révèle un
    arrêt de travail (`ABS_IND_SANTE`, `ABS_MAINT_SANTE`) ; Cursus réserve ces lignes au droit « paie » ;
  - les déclarations des salariés (`demandes_collab.declaration` : vaccination, numéro de passeport, visa) ;
  - les textes libres : motifs (de refus, de réouverture, d'annulation, de retrait d'une pièce), réponses du service RH,
    commentaires d'évaluation, adresse d'hébergement, corps des e-mails envoyés.
  Huit de ces colonnes étaient déjà commentées « à exclure de matrix_lecture » par les migrations de Cursus. La reprise
  Lucca du 1er janvier les remplira sur le serveur commun : la liste doit être en place avant.
- Détails techniques :
  - Lignes demandées (table entière : `*`) :
    - comptes et sessions : `comptes.mot_de_passe`, `oid`, `blocage_fin` ; `connexions` `*` ;
      `jetons_agenda.empreinte` ; `reprises` `*` ;
    - santé : `demandes_visite` `*` ; `informations_cp` `*` ; `absences.type` et `justificatif` ;
      `employes.expose` et `motif_sortie` ;
    - journal : `journal.payload` et `message` ;
    - paie : `lots_paie.contenu` et `resume` ;
    - textes libres : `demandes_collab.label`, `motif`, `motif_refus`, `reponse`, `rouverte_motif`, `declaration` ;
      `absences.motif_refus` ; `plan_actions.corrige_motif`, `annule_motif` ; `pieces.retiree_motif` ;
      `demandes_keystone.motif_refus` ; `astreintes.motif`, `annule_motif` ;
      `evaluations_formation.commentaire` ; `formations_suivies` et `certifications` : `corrige_motif`, `annule_motif` ;
      `hab_titres.mesure_motif` ; `avenants_forfait.reference`, `annule_motif` ; `effacements.motif` ;
      `feuilles.comment`, `motif_depassement`, `motif_forfait`, `reouverture` ; `voyages.motif`, `hebergement`,
      `contact_sur_place`, `annule_motif` ; `reports.motif` ; `clotures.motif` ; `envois.contenu`, `erreur`, `accuse` ;
      `notifications.objet`, `texte`.
  - Aucune vue `pub_` de Cursus ne lit ces colonnes. Vérifié par la CI de Cursus : la liste est rejouée sur un socle
    jetable, puis `droits.verifier()` ne signale aucune erreur et plus aucune colonne déclarée sensible n'est lisible
    (étape « Demande à Matrix appliquée au socle d'essai »).
  - Non demandé : `settings` en entier. La vue `pub_parametres` (D19) la lit, et `droits.verifier()` refuse une vue
    publiée qui lit une table fermée. La table ne porte en production ni secret (`CURSUS_SECRET` obligatoire) ni donnée
    d'un salarié. En démonstration sans `CURSUS_SECRET`, la clé de signature y est encore enregistrée, mais elle ne
    suffit plus à forger une session : depuis le lot 8, `connexions` ne garde que l'empreinte SHA-256 de l'identifiant.
  - Côté Cursus, après application : recopier `infra/postgres-socle/` depuis le nouveau commit de Matrix, vider
    `docs/demandes/matrix-lot8-colonnes-sensibles.sql` (`tests/socle-colonnes-sensibles.test.ts` le réclame), puis
    rendre bloquante l'étape « Colonnes déclarées sensibles fermées à matrix_lecture » du job `postgres`
    (`scripts/colonnes-sensibles-pg.sql`).
- Validé par Guillaume le :

## [2026-10-24] Cursus → Matrix — Reporter la nouvelle vue pub_titres_detenus (migration 0011) dans partage/20-cursus.sql
- Statut : À VALIDER (rédigée, pas envoyée) ; à faire **avant** le déploiement de la migration 0011 de Cursus.
- Demande : remplacer `partage/20-cursus.sql` de Matrix par `infra/postgres-partage/20-cursus.sql` du dépôt Cursus
  (lot 8), puis rejouer `90-droits.sql`.
- Justification : la migration `0011_pub_titres_valides` redéfinit `cursus.pub_titres_detenus`. Les certifications
  annulées ne sont plus publiées ; une habilitation suspendue ou retirée n'est plus utilisable dès le jour de sa mesure,
  ni une habilitation dont un prérequis manque ; deux
  colonnes sont ajoutées en fin. L'ancienne copie de Matrix échouerait au rejeu après 0011, car `CREATE OR REPLACE VIEW`
  ne peut pas retirer les colonnes `mesure` et `mesure_le`. La nouvelle copie ne lit que des colonnes présentes dès la
  migration 0002 : elle se rejoue avant comme après 0011.
- Détails techniques : prérequis du fichier inchangés (`0002_partage`, `0004_pub_absences`). Colonnes de la vue :
  celles du contrat D09 v1, inchangées et dans le même ordre, puis `mesure` (text : `suspension`, `retrait` ou NULL) et
  `mesure_le` (date). La vue ne lit ni `hab_titres.mesure_motif`, ni `mesure_par`, ni les motifs des certifications.
- Validé par Guillaume le :

## [2026-10-24] Cursus → Keystone, Vigie — Avenant du contrat D09 (pub_titres_detenus)
- Statut : À VALIDER (rédigée, pas envoyée) ; une entrée par dépôt (`REQUESTS.md` de Keystone et de Vigie).
- Demande : prendre en compte l'avenant du lot 8 du contrat D09, publié par la migration `0011_pub_titres_valides`.
- Justification : une certification annulée (CACES saisi par erreur, par exemple) ou une habilitation retirée ou
  suspendue (habilitation électrique après un incident) restait publiée comme valide. Une personne non habilitée
  pouvait donc être affectée à un chantier (Keystone) ou à un contrôle (Vigie).
- Détails techniques :
  - Une certification annulée disparaît de la vue : sa ligne `certification.<id>` n'est plus rendue. Le lecteur retire
    de son miroir toute ligne absente de la vue, ce qui vaut aussi pour une annulation passée. La dernière certification
    non annulée de la même formation reprend la place, s'il y en a une. Une certification annulée ne compte plus comme
    prérequis : `prerequis_manquant` peut passer à vrai.
  - Prérequis manquant (`prerequis_manquant` vrai) : `utilisable_jusqu_au` vaut la veille de la délivrance, le titre
    n'est jamais utilisable, comme dans Cursus (habilitation « suspendue » faute de prérequis). Avant l'avenant, la
    colonne gardait l'échéance du titre (ou celle du prérequis présent le plus proche) : seul `prerequis_manquant`
    signalait le cas.
  - Habilitation suspendue ou retirée : `utilisable_jusqu_au` vaut au plus la veille de la mesure (date incluse, comme
    `expire_le` : le titre n'est plus utilisable le jour même), et `expire_le` ne change pas. Une mesure sans date
    (reprise d'un ancien système) vaut depuis la délivrance. À la levée d'une
    suspension, la ligne revient à son échéance normale.
  - Colonnes ajoutées en fin : `mesure` (`suspension`, `retrait` ou NULL ; toujours NULL pour une formation) et
    `mesure_le` (date). Le motif n'est jamais publié.
  - Lecture conseillée : un titre est utilisable le jour J si `utilisable_jusqu_au >= J` et `prerequis_manquant` est
    faux. Depuis l'avenant, la première condition suffit (prérequis manquant et mesure bornent `utilisable_jusqu_au`) ;
    la seconde est gardée par prudence et donne l'état « suspendu », comme le prévoit déjà le contrat.
- Validé par Guillaume le :
