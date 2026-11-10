# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Cursus — Publier les absences sans leur motif (vue pub_absences)
- Statut : FAITE
- Demande : publier une vue `cursus.pub_absences` des absences des salariés, limitée à ce qu'un planificateur doit savoir : qui est absent, quand, et si l'absence est validée — sans le type ni aucun motif.
- Justification : Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) planifie les opérateurs d'essai avec les moyens (livraison 4 de Crucible) : un moyen libre sans opérateur habilité présent est inutilisable, et c'est l'une des causes possibles de la sous-occupation du PDE. Sans la vue, les indisponibilités des opérateurs sont saisies à la main dans Crucible, avec le risque de proposer un créneau à une personne absente. Matrix a déjà prévu le droit de lecture (`90-droits.sql` : `cursus.pub_absences` → `crucible_app`).
- Détails techniques : vue `pub_absences` (schéma `cursus`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement) sur `absences` jointe aux salariés pour le matricule. Colonnes : `matricule` (text), `du` (date), `au` (date), `statut` (text : validée / demandée), `annulee` (boolean, `annulee_le` non nul), `maj_le` (timestamptz). Exclus volontairement : `type`, justificatifs, suivi médical et toute donnée de santé. Lecteur : `crucible_app` (droit accordé par Matrix). Crucible lit par `matricule` et période.
- Validé par Guillaume le : 2026-10-22
- Réalisé le 2026-10-22 (branche `main-n9x7ps`) : migration `server/migrations-pg/0004_pub_absences.sql` de Cursus, copie qualifiée dans `infra/postgres-partage/20-cursus.sql` (à reporter dans `partage/20-cursus.sql` de Matrix). Colonnes, dans l'ordre : `matricule`, `du`, `au`, `statut` (codes `validee` ou `demandee`, sans accent ; une absence signalée — arrêt, absence constatée — est publiée `validee`), `annulee` (absence annulée, gardée pour que le lecteur retire l'indisponibilité ; elle garde `validee`), `maj_le` (posée à chaque écriture par le déclencheur `absences_maj_le`). Absences refusées non publiées. Jamais : type, motif de refus, justificatifs, demi-journées, auteur du signalement. Test : `tests/db-pg.test.ts`.


## [2026-10-30] Matrix → Cursus — M-17 : accès entre outils décidés par Matrix (plus de copie de vue, écritures par API ou fonction `pub_`)
- Statut : FAITE
- Demande : appliquer dans Cursus la décision M-17 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 sexies du dépôt Matrix) :
  1. **Lire** les données d'un autre outil uniquement par ses vues `pub_` (R2), jamais par ses tables ;
  2. **Écrire** chez un autre outil uniquement par son API ou par une fonction `pub_` qu'il fournit (R4), jamais par `INSERT` / `UPDATE` / `DELETE` dans son schéma ;
  3. pour un **nouvel échange**, ne plus demander à Matrix de recopier une vue dans `partage/` : la migration de Cursus reste la seule définition de ses vues `pub_` (R3), et le besoin d'accès se déclare comme un lien du registre `matrix.liens` (R5) — en attendant l'API `POST /api/liens` (lot M17-4), par une entrée courte dans le `REQUESTS.md` de Matrix : lecteur, objet (`schéma.pub_…`), nature (`lecture` ou `execution`), justification ;
  4. pour une **écriture qu'un autre outil doit faire chez Cursus** : lui fournir une API, ou une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de Cursus appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; § « Fonctions pub_ » de la note) ;
  5. reprendre ces règles dans le `CLAUDE.md` de Cursus et dans ses documents de demandes à Matrix, et faire l'inventaire de ses échanges (point de départ ci-dessous), en signalant à Matrix tout accès qui n'y serait pas conforme.
- Justification : décision du responsable produit du 30/10/2026 (M-17) : Matrix décide de chaque accès d'un outil aux données d'un autre, PostgreSQL l'applique. Les vues `pub_` restent les contrats de lecture, mais leur copie par Matrix (quatre étapes par échange, dont deux à la main) disparaît, et l'écriture entre outils devient possible sous le contrôle de Matrix sans contourner les règles métier du propriétaire.
- Détails techniques : relevé du 30/10/2026 sur `main` de Cursus (requêtes SQL vers d'autres schémas) : `matrix.pub_sites`, `matrix.pub_organigramme` ; appels de Keystone par API ; Cursus n'est pas encore basculé sur le serveur commun (SQLite) : à appliquer à la bascule. Toutes ces lectures passent déjà par des vues `pub_` et aucune écriture directe dans un autre schéma n'a été trouvée : aucune correction urgente. Les vues, droits et fichiers de partage actuels restent en place pendant la transition (lots M17-1 à M17-5 côté Matrix) ; une vue `pub_` existante ne change pas.
- Validé par Guillaume le : 2026-10-30
- Réalisé le 2026-11-01 (lot 12, socle, branche `lot12/socle-1`) : règles R2 à R5 et fonctions `pub_<verbe>_<objet>` dans `docs/ARCHITECTURE.md`, section « Échanges avec les autres outils » (Cursus n'a pas de `CLAUDE.md` à la racine) ; reprises en tête des demandes, `docs/demandes/LISEZ-MOI.md` ; inventaire des échanges et de leur conformité dans `docs/ECHANGES.md` : aucune lecture de table ni écriture dans un autre schéma, vues `pub_` définies par les migrations de Cursus, deux points à signaler à Matrix (accès de `matrix_lecture` aux tables de `cursus`, copie de partage `infra/postgres-partage/20-cursus.sql` à ne plus mettre à jour) et l'entrée prête à porter dans le `REQUESTS.md` de Matrix après validation. Aucun fichier d'un autre dépôt modifié.

## [2026-11-01] Matrix → Cursus — M-18 : Matrix définit vos vues `pub_` et décide de vos écritures croisées (plus de vue `pub_` dans vos migrations)
- Statut : FAITE
- Demande : appliquer dans Cursus la décision M-18 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 septies du dépôt Matrix), qui **remplace le point 3 de la demande M-17** du 30/10/2026 (« la migration reste la seule définition des vues `pub_` ») :
  1. **ne plus créer, modifier ni supprimer de vue `pub_` dans vos migrations** (les migrations déjà appliquées ne changent pas) : une nouvelle publication, ou une colonne de plus, se demande à Matrix, qui la définit dans son écran « Publications » (`matrix.publications`) et l'applique lui-même (rôle `matrix_gestion`). Votre migration crée les tables et colonnes ; la vue est celle de Matrix ;
  2. **avant de modifier ou de supprimer une colonne lue par une vue `pub_`**, le signaler à Matrix (entrée dans son `REQUESTS.md`) : la migration échouerait, la vue en dépend. Une colonne publiée ne se retire ni ne se renomme ; un changement incompatible passe par une vue `…_v2` ;
  3. **écritures que d'autres outils font chez vous** : votre API reste permise ; pour une écriture en SQL, fournir une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, vos règles et votre journal appliqués, `REVOKE EXECUTE … FROM PUBLIC`). Le droit de l'exécuter est un lien « écriture » décidé dans Matrix ; une fonction exécutable par tous est signalée en erreur par `droits.verifier()` ;
  4. **vos besoins chez les autres** (lecture d'une vue, exécution d'une fonction) se déclarent comme liens dans Matrix (écran « Liens entre outils » ou entrée courte dans son `REQUESTS.md` : outil, objet `schéma.pub_…`, nature `lecture` ou `execution`, justification), plus par une demande de copie de vue ;
  5. reprendre ces règles dans votre `CLAUDE.md`, puis passer cette entrée à FAITE : Matrix reprend alors vos vues `pub_` (`partage/14-reprise-publications.sql` : elles passent au rôle `matrix_gestion`, leurs lecteurs gardent leur droit).
- Justification : décision du responsable produit du 01/11/2026 (M-18) : « matrix [doit] être le seul outil qui permette d'administrer la base de données postgre […] c'est matrix qui doit avoir la main sur ce que chaque outil publie, lie, écrit ». Matrix est en place (lots P1 à P4 fusionnés le 01/11/2026 : rôle `matrix_gestion`, registre et écran « Publications », liens appliqués tout de suite, liens d'écriture). Tant que la reprise n'est pas faite, rien ne change pour Cursus ; après la reprise, une migration qui recréerait une vue `pub_` échouerait (« must be owner of view »), d'où le point 1 d'abord.
- Détails techniques : vues de Cursus reprises par Matrix : pub_journal, pub_parametres, pub_salaries, pub_titres, pub_titres_detenus et les vues publiées depuis (pub_absences…). Les vues de contrôle `*_v1` ne sont pas concernées : elles restent à Cursus. Écritures reçues d'autres outils : demandes de déplacement de Keystone (API, flux F02) : conforme, rien à changer. Une vue reprise garde son nom, ses colonnes, son commentaire et ses lecteurs ; seule sa propriété change. Contrôles : `droits.verifier()` (vue `pub_` encore à l'outil : attention, « pas encore reprise »). Pour un essai local (PGlite, base de démonstration), vos migrations anciennes continuent de créer les vues : seule une **nouvelle** migration ne doit plus en créer ni en modifier.
- Validé par Guillaume le : 2026-11-01
- Réalisé le 2026-11-02 (branche `main-n9x7ps`), points 1 à 5 : garde-fou `tests/m18-publications.test.ts` (aucune migration après
  `0029` ne crée, modifie, commente une vue `pub_` ni ne pose de droit dessus) ; règles dans `docs/ARCHITECTURE.md`
  (« Échanges avec les autres outils »), `docs/demandes/LISEZ-MOI.md` et `CLAUDE.md` ; inventaire `docs/ECHANGES.md` ;
  procédure de bascule (`docs/DEPLOIEMENT.md`, « Variante : serveur PostgreSQL commun EPC2I » ; `docs/BASCULE-PRODUCTION.md`)
  : les vues de Cursus sont reprises par Matrix (`-v outils=cursus`) au lieu de rejouer `20-cursus.sql`. Répétition du
  2 novembre 2026 sur PostgreSQL 16 avec le socle et le partage de Matrix à jour : reprise à blanc puis réelle, six vues
  passées à `matrix_gestion`, lecteurs conservés, Cursus redémarré sans erreur, `droits.verifier()` sans erreur. Aucun
  fichier de Matrix modifié. Cursus ne reçoit aucune écriture par la base (Keystone passe par l'API) : aucune fonction
  `pub_` à créer.


## [2026-11-04] Vigie → Cursus — Intérimaires et extérieurs : matricule I / E permanent et pré-déclaration publique avant l'arrivée sur site
- Statut : FAITE
- Demande :
  1. Tenir dans Cursus les intérimaires et les salariés des entreprises extérieures avec un matricule propre, préfixé `I` (intérimaire) ou `E` (extérieur), **permanent** : une personne qui revient sur site retrouve son matricule et son historique (accueils, titres, interventions passées).
  2. Ouvrir un formulaire accessible hors de l'entreprise (sans compte Entra, lien public protégé) où un intérimaire ou un salarié d'entreprise extérieure se déclare avant de venir : nom, prénom, entreprise (ou agence d'intérim), site, dates d'arrivée et de départ prévues, objet (intervention, mission). Les RH valident la déclaration ; Cursus retrouve la personne si elle est déjà venue (sinon crée le matricule `I` ou `E`).
  3. Rendre publiables (voir la demande à Matrix) : pour chaque personne, sa catégorie (salarié, intérimaire, extérieur), son entreprise et son adresse e-mail professionnelle quand elle existe ; pour chaque déclaration validée, la présence prévue sur un site (matricule, site, du, au, entreprise).
- Justification : décision du responsable produit du 03/11/2026 (convergence M-02, D01, question CV-10) : Vigie n'a plus aucune fiche de personne à lui, toutes viennent de Cursus, y compris les intérimaires et les extérieurs. Vigie a besoin de ces personnes pour les plans de prévention, les permis, les accueils sécurité et les événements, et produira à partir des présences prévues la liste des arrivées et départs à venir pour le poste de garde. L'e-mail sert à rattacher un compte Microsoft Entra à sa fiche lors de la connexion à Vigie. Sans ces données, Vigie garde ses fiches locales (doublon contraire à M-02).
- Détails techniques : données tenues par Cursus seulement ; pas de donnée de santé ; formulaire public avec les protections d'un formulaire sans compte (jeton, limite de débit, champ piège, comme le signalement terrain de Vigie) ; conservation des déclarations refusées ou sans suite à fixer avec le DPO. Contrat proposé des publications : voir la demande à Matrix.
- Validé par Guillaume le : 2026-11-04
- Réalisé du 2026-11-05 au 2026-11-07 (lot 14, branche `main-n9x7ps`, commits `c90cc57` et `2dc7237`), selon les choix de Guillaume du 05/11/2026 :
  1. **Matricule de site permanent** : `I00001`… pour un intérimaire (fiche ordinaire de l'annuaire, attribué à la création ou au passage à l'intérim ; reprise des intérimaires existants), `E00001`… pour un extérieur (fiche de catégorie « extérieur » : nom, entreprise, e-mail, titres et habilitations ; hors paie, congés, temps et effectifs). Unique, jamais réattribué ; le matricule Cursus `EMP-…` reste l'identifiant échangé avec Keystone. Migration `0031_personnes_site.sql`.
  2. **Pré-déclaration** : un lien public par entreprise ou par agence (jeton de 256 bits montré une fois, haché en base, révocable), page `/declarer/<jeton>` sans compte (nom, prénom, e-mail facultatif, site, dates, objet ; champ piège, débit limité par adresse et par lien, plafond de 200 en attente, 404 pour un lien inconnu ou révoqué). Le service RH valide (rattachement à la fiche proposée — même e-mail ou même nom —, ou création de la fiche E d'un extérieur ; un intérimaire est rattaché à sa fiche d'intérim), refuse ou classe sans suite (motif, jamais publié ni journalisé). Refusées et sans suite effacées 3 mois après (à confirmer par le DPO). Migration `0032_declarations_presence.sql`.
  3. **Publications** : aucune vue `pub_` créée par Cursus (M-18). Colonnes et expressions proposées pour `pub_salaries` (D01 v2 : `categorie`, `entreprise`, `email`) et `pub_presences_prevues` (déclarations validées ou annulées après validation, dans l'ordre du contrat de Matrix), et point à trancher sur le matricule publié (EMP ou I/E) : `docs/demandes/matrix-lot14-personnes-site.md` ; colonnes sensibles (empreinte, motif) : `docs/demandes/matrix-lot14-declarations-presence.sql`. **À valider par Guillaume** avant d'être portées dans le `REQUESTS.md` de Matrix ; Vigie lira ces données quand Matrix aura défini les deux publications.
  Documentation : `docs/ARCHITECTURE.md` (« Lot 14 »), `docs/GUIDE-UTILISATEUR.md`, `docs/RGPD.md`. Tests : `tests/personnes-site.test.ts`, `tests/declarations-presence.test.ts`. Aucun fichier d'un autre dépôt modifié.

## [2026-11-05] Matrix → Cursus — M-19 · Fonction d'édition `cursus.pub_editer` : corriger les données de Cursus depuis Matrix, par vos règles
- Statut : FAITE
- Demande : fournir, par une migration de Cursus, la fonction
  `cursus.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb`
  (`SECURITY DEFINER`, `SET search_path = cursus, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`), qui ajoute, corrige ou retire une ligne
  d'une table de Cursus en appliquant vos règles et votre journal :
  - `p_action` = `ajouter` | `corriger` | `retirer` (un retrait peut être un archivage) ; `p_cle` = clé primaire de la ligne
    (null pour `ajouter`) ; `p_valeurs` = colonnes à écrire (null pour `retirer`) ;
  - `p_par` = nom de la personne connectée à Matrix (Microsoft Entra ID, rôle Administrateur) ; `p_motif` = motif saisi
    (obligatoire) ;
  - refus par `RAISE EXCEPTION` (message montré tel quel dans Matrix) ; la fonction renvoie la ligne après modification,
    sans colonne sensible ;
  - elle refuse les tables que Cursus ne veut pas ouvrir et toute colonne de `droits.colonnes_sensibles` (Matrix ne les
    transmet jamais, mais la fonction ne doit pas en dépendre) ;
  - règle propre à Cursus à respecter : données personnelles des salariés : seules les colonnes hors `droits.colonnes_sensibles` peuvent être touchées, et vos règles RH s'appliquent.
  Une fonction par table (`cursus.pub_editer_<table>`, mêmes paramètres sans `p_table`) reste possible et passe avant la
  générique. Une fois la migration passée, passer cette entrée à FAITE : la DSI autorise alors le lien d'écriture dans Matrix.
- Justification : décision M-19 du 05/11/2026 (responsable produit) : « pour le moment, l'admin IT peut modifier toutes les
  données à l'exception des données sensibles RGPD », **par les outils** : Matrix n'écrit jamais lui-même dans vos tables
  (M-18) ; la DSI corrige depuis la visionneuse de Matrix, Cursus garde ses règles et son journal.
- Détails techniques : convention complète et exemple dans `docs/edition-par-les-outils.md` du dépôt Matrix. Le droit
  d'exécution est un lien « écriture » `matrix_app` → `cursus.pub_editer`, décidé dans Matrix (« Liens entre outils ») et posé
  par `droits.accorder_execution` ; `droits.verifier()` signale une fonction `pub_` exécutable par tous ou sans
  `search_path` fixé. Rien ne change pour Cursus tant que la fonction n'existe pas : la visionneuse reste en lecture seule.
- Validé par Guillaume le : 2026-11-05
- Réalisé le 2026-11-09 (lot 15, branche `main-n9x7ps`), périmètre choisi par Guillaume le 09/11/2026 (« Libellés des référentiels ») : fonction générique `cursus.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb`, migration `server/migrations-pg/0033_pub_editer.sql` (`SECURITY DEFINER`, `search_path` figé au schéma de Cursus puis `pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`).
  - Ouvert : action `corriger` sur les colonnes descriptives de `formations` (nom, court, duree, cout, duree_heures), `habilitations` (nom, detail, signataire), `destinations` (pays, visa_sub), `organismes` (raison_sociale, adresse, site_web, conditions) et `modules_elearning` (intitule, url, duree_heures), avec les contrôles des formulaires de Cursus (obligatoire, longueur, nombres bornés, adresses, libellé unique parmi les éléments en vigueur).
  - Refusé, avec un message qui renvoie vers Cursus : `ajouter` et `retirer` (création avec code et règles, archivage contrôlé dans l'écran Référentiels), validités et prérequis (recalcul des titres et verdicts envoyés à Keystone), toute autre table (salariés et toute donnée personnelle, postes, équipes, paie, journal, copies d'autres outils).
  - Journal de Cursus : action `matrix.editer`, auteur « <nom> (Matrix) », rôle `integration`, colonnes, valeurs avant et après, motif ; une valeur inchangée n'est ni écrite ni tracée. Test : `tests/pub-editer.test.ts` (PostgreSQL).
  - Reste à Matrix : décider le lien « écriture » `matrix_app` → `cursus.pub_editer`. Ouvrir d'autres colonnes ou les salariés se fera par une nouvelle migration qui remplace la fonction (signature inchangée).

