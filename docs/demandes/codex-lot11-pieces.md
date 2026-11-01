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

## Justificatifs de frais (chantier C5)

Pièces nominatives rattachées à une dépense d'une note de frais (objets `ligneFrais` et `ligneFraisSante`) ou au véhicule
personnel déclaré pour les indemnités kilométriques (`vehiculePerso`). Photos du téléphone sans métadonnées (position GPS
retirée), PDF, JPEG ou PNG de 10 Mo au plus. Scellées à la soumission de la note dans une chaîne d'empreintes interne
(`sceaux_pieces`), puis immuables ; ni horodatage qualifié ni cachet : le papier reste conservé (choix par défaut, à
trancher avec l'expert-comptable).

| Objet Cursus | Type de document proposé côté Codex | Conservation proposée |
| --- | --- | --- |
| `ligneFrais` | Justificatif de note de frais (pièce comptable) | 10 ans après le paiement de la note (art. L123-22 du Code de commerce ; 6 ans en fiscal, LPF L102 B) |
| `ligneFraisSante` | Justificatif de frais médicaux en mission (donnée de santé) : même type que `ligneFrais` pour ne rien révéler, accès restreint au service RH et à la comptabilité | Comme `ligneFrais`, **avis du DPO** |
| `vehiculePerso` | Carte grise, attestation d'assurance « usage professionnel » | Durée d'usage du véhicule, plus celle des notes qu'il justifie |

Métadonnées que Cursus transmettrait : type, numéro de la note, mois des dépenses, empreinte SHA-256, sceau (empreinte
chaînée) et heure du scellement, date et auteur du dépôt. Jamais de montant, de commerçant, d'invité, de catégorie ni la
mention médicale. Questions à Codex : archivage à valeur probante (arrêté du 22 mars 2017 : PDF ou PDF/A-3, scellement et
horodatage, dossier de procédé) qui permettrait de détruire le papier ; accès de la comptabilité sans le reste du dossier
RH ; rétention par type à partir de la date de paiement que Cursus fournirait.
