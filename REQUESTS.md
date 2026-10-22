# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Cursus — Publier les absences sans leur motif (vue pub_absences)
- Statut : OUVERTE
- Demande : publier une vue `cursus.pub_absences` des absences des salariés, limitée à ce qu'un planificateur doit savoir : qui est absent, quand, et si l'absence est validée — sans le type ni aucun motif.
- Justification : Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) planifie les opérateurs d'essai avec les moyens (livraison 4 de Crucible) : un moyen libre sans opérateur habilité présent est inutilisable, et c'est l'une des causes possibles de la sous-occupation du PDE. Sans la vue, les indisponibilités des opérateurs sont saisies à la main dans Crucible, avec le risque de proposer un créneau à une personne absente. Matrix a déjà prévu le droit de lecture (`90-droits.sql` : `cursus.pub_absences` → `crucible_app`).
- Détails techniques : vue `pub_absences` (schéma `cursus`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement) sur `absences` jointe aux salariés pour le matricule. Colonnes : `matricule` (text), `du` (date), `au` (date), `statut` (text : validée / demandée), `annulee` (boolean, `annulee_le` non nul), `maj_le` (timestamptz). Exclus volontairement : `type`, justificatifs, suivi médical et toute donnée de santé. Lecteur : `crucible_app` (droit accordé par Matrix). Crucible lit par `matricule` et période.
- Validé par Guillaume le : 2026-10-22
