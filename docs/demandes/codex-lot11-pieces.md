# Demande à Codex (GED) — pièces du lot 11

Demande rédigée par Cursus, **à valider par le propriétaire avant tout envoi** : rien n'est écrit dans le dépôt de Codex.
Cursus garde ses pièces chiffrées (`pieces`, stockage « local ») ; l'adaptateur `ged` (`server/src/integrations/ged.ts`)
les enverrait à Codex sans changer l'interface, le jour où ces types existent côté Codex.

## Dossiers OPCO (chantier C4)

Pièces de l'entreprise, sans salarié (objet `dossierOpco`, `pieces.emp_id` NULL), rattachées à une action du plan de
formation et à son dossier de prise en charge par l'OPCO.

| Nature Cursus (`pieces.nature`) | Type de document proposé côté Codex | Conservation proposée |
| --- | --- | --- |
| `facture` | Facture d'organisme de formation (pièce comptable) | 10 ans après la fin de l'exercice (art. L123-22 du Code de commerce) |
| `accord` | Accord de prise en charge de l'OPCO | 10 ans après la fin de l'exercice |
| `demande`, `convention`, `programme`, `convocation`, `certificat_realisation`, `avis_paiement`, `autre` | Pièce de dossier OPCO | Durée du plan de formation, à fixer avec le DPO |
| `emargement` | Feuille d'émargement (porte les noms des stagiaires : donnée personnelle) | Celle de la pièce comptable qu'elle justifie, avis du DPO |

Métadonnées que Cursus transmettrait : nature, exercice de l'action, OPCO, numéro de dossier de l'OPCO, empreinte SHA-256,
date et auteur du dépôt. Jamais de montant ni de motif. Questions à Codex : horodatage et valeur probante (Cursus garde une
empreinte, pas un archivage au sens de la norme NF Z42-013), rétention par type, retrait d'une pièce jointe par erreur.
