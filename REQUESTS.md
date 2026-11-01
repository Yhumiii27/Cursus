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
- Statut : OUVERTE
- Demande : appliquer dans Cursus la décision M-17 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 sexies du dépôt Matrix) :
  1. **Lire** les données d'un autre outil uniquement par ses vues `pub_` (R2), jamais par ses tables ;
  2. **Écrire** chez un autre outil uniquement par son API ou par une fonction `pub_` qu'il fournit (R4), jamais par `INSERT` / `UPDATE` / `DELETE` dans son schéma ;
  3. pour un **nouvel échange**, ne plus demander à Matrix de recopier une vue dans `partage/` : la migration de Cursus reste la seule définition de ses vues `pub_` (R3), et le besoin d'accès se déclare comme un lien du registre `matrix.liens` (R5) — en attendant l'API `POST /api/liens` (lot M17-4), par une entrée courte dans le `REQUESTS.md` de Matrix : lecteur, objet (`schéma.pub_…`), nature (`lecture` ou `execution`), justification ;
  4. pour une **écriture qu'un autre outil doit faire chez Cursus** : lui fournir une API, ou une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de Cursus appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; § « Fonctions pub_ » de la note) ;
  5. reprendre ces règles dans le `CLAUDE.md` de Cursus et dans ses documents de demandes à Matrix, et faire l'inventaire de ses échanges (point de départ ci-dessous), en signalant à Matrix tout accès qui n'y serait pas conforme.
- Justification : décision du responsable produit du 30/10/2026 (M-17) : Matrix décide de chaque accès d'un outil aux données d'un autre, PostgreSQL l'applique. Les vues `pub_` restent les contrats de lecture, mais leur copie par Matrix (quatre étapes par échange, dont deux à la main) disparaît, et l'écriture entre outils devient possible sous le contrôle de Matrix sans contourner les règles métier du propriétaire.
- Détails techniques : relevé du 30/10/2026 sur `main` de Cursus (requêtes SQL vers d'autres schémas) : `matrix.pub_sites`, `matrix.pub_organigramme` ; appels de Keystone par API ; Cursus n'est pas encore basculé sur le serveur commun (SQLite) : à appliquer à la bascule. Toutes ces lectures passent déjà par des vues `pub_` et aucune écriture directe dans un autre schéma n'a été trouvée : aucune correction urgente. Les vues, droits et fichiers de partage actuels restent en place pendant la transition (lots M17-1 à M17-5 côté Matrix) ; une vue `pub_` existante ne change pas.
- Validé par Guillaume le : 2026-10-30
