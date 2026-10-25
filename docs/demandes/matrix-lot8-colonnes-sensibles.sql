-- Demande de Cursus à Matrix (lot 8, chantier D, D1) : colonnes de Cursus à ajouter à droits.colonnes_sensibles, en
-- 'convention', avant la reprise des données de Lucca (1er janvier 2027). Texte de la demande et justification :
-- docs/DEMANDES-LOT8-DONNEES.md. Ce fichier n'est jamais exécuté sur le serveur commun par Cursus : il propose les lignes
-- à reporter dans infra/postgres/init/03-droits.sql de Matrix (bloc « Convention du 15/10/2026 », même forme), et la
-- CI de Cursus le rejoue sur son socle d'essai pour vérifier que, une fois appliqué, aucune colonne déclarée sensible
-- par Cursus ne reste lisible par matrix_lecture et que droits.verifier() ne signale aucune erreur.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot8-colonnes-sensibles.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  -- Comptes et sessions : empreintes scrypt (cassables hors ligne), identifiant Entra ID, blocage ; sessions.
  ('cursus', 'comptes', 'mot_de_passe', 'Sécurité : empreinte scrypt du mot de passe d''un compte local', 'convention'),
  ('cursus', 'comptes', 'oid', 'Sécurité : identifiant de l''utilisateur dans Entra ID', 'convention'),
  ('cursus', 'comptes', 'blocage_fin', 'Sécurité : blocage du compte après des échecs de connexion', 'convention'),
  ('cursus', 'connexions', '*', 'Sécurité : sessions de connexion (table entière)', 'convention'),
  ('cursus', 'jetons_agenda', 'empreinte', 'Sécurité : empreinte du jeton d''abonnement à l''agenda', 'convention'),
  ('cursus', 'reprises', '*', 'Vie professionnelle : comptes rendus nominatifs de la reprise des données (table entière)', 'convention'),
  -- Santé au travail et absences (art. 9 du RGPD).
  ('cursus', 'demandes_visite', '*', 'Santé : demandes de visite médicale, dont les visites de reprise (table entière)', 'convention'),
  ('cursus', 'informations_cp', '*', 'Santé : informations sur les congés au retour d''un arrêt (table entière)', 'convention'),
  -- Journal des lignes changées par révision (lot 9, migration 0014) : l'ordre des écritures rattache à un salarié
  -- l'activité des tables fermées ci-dessus (vaccination, visite, retour d'arrêt).
  ('cursus', 'changements', '*', 'Santé (activité) : journal des lignes changées par révision (table entière)', 'convention'),
  ('cursus', 'absences', 'type', 'Santé : nature de l''absence (maladie, accident du travail…)', 'convention'),
  ('cursus', 'absences', 'justificatif', 'Santé : justificatif d''absence reçu', 'convention'),
  ('cursus', 'employes', 'expose', 'Santé : exposition à des risques particuliers (suivi médical)', 'convention'),
  ('cursus', 'employes', 'motif_sortie', 'Vie professionnelle : motif de la sortie', 'convention'),
  -- Journal : de 'proposition' à 'convention'.
  ('cursus', 'journal', 'payload', 'Santé (copie) : corps des actions (naissance, visite médicale, vaccins, passeport)', 'convention'),
  ('cursus', 'journal', 'message', 'Santé (copie) : message lisible (« Vaccination … enregistrée »)', 'convention'),
  -- Textes libres (motifs, commentaires, adresses, messages envoyés) : ils peuvent nommer une personne ou une maladie.
  ('cursus', 'demandes_collab', 'label', 'Santé (copie) : libellé de demande (« Vaccination Fièvre jaune déclarée »)', 'convention'),
  ('cursus', 'demandes_collab', 'motif', 'Texte libre : motif d''une demande', 'convention'),
  ('cursus', 'demandes_collab', 'motif_refus', 'Texte libre : motif d''un refus', 'convention'),
  ('cursus', 'demandes_collab', 'reponse', 'Texte libre : réponse du service RH', 'convention'),
  ('cursus', 'demandes_collab', 'rouverte_motif', 'Texte libre : motif d''une réouverture', 'convention'),
  ('cursus', 'demandes_collab', 'declaration', 'Santé (copie) : déclaration du salarié (vaccination, passeport, visa)', 'convention'),
  ('cursus', 'absences', 'motif_refus', 'Texte libre : motif du refus d''une absence', 'convention'),
  ('cursus', 'plan_actions', 'corrige_motif', 'Texte libre : motif de correction', 'convention'),
  ('cursus', 'plan_actions', 'annule_motif', 'Texte libre : motif d''annulation', 'convention'),
  ('cursus', 'pieces', 'retiree_motif', 'Texte libre : motif du retrait d''une pièce justificative', 'convention'),
  ('cursus', 'demandes_keystone', 'motif_refus', 'Texte libre : motif du refus d''une demande de Keystone', 'convention'),
  ('cursus', 'astreintes', 'motif', 'Texte libre : circonstances d''un délai de prévenance court', 'convention'),
  ('cursus', 'astreintes', 'annule_motif', 'Texte libre : motif d''annulation d''une astreinte', 'convention'),
  ('cursus', 'evaluations_formation', 'commentaire', 'Texte libre nominatif : avis du salarié ou du manager', 'convention'),
  ('cursus', 'formations_suivies', 'corrige_motif', 'Texte libre : motif de correction', 'convention'),
  ('cursus', 'formations_suivies', 'annule_motif', 'Texte libre : motif d''annulation', 'convention'),
  ('cursus', 'certifications', 'corrige_motif', 'Texte libre : motif de correction', 'convention'),
  ('cursus', 'certifications', 'annule_motif', 'Texte libre : motif d''annulation', 'convention'),
  ('cursus', 'hab_titres', 'mesure_motif', 'Santé ou vie professionnelle : motif d''une suspension ou d''un retrait d''habilitation', 'convention'),
  ('cursus', 'avenants_forfait', 'reference', 'Texte libre : référence de l''avenant', 'convention'),
  ('cursus', 'avenants_forfait', 'annule_motif', 'Texte libre : motif d''annulation', 'convention'),
  ('cursus', 'effacements', 'motif', 'Texte libre : motif d''un effacement (peut nommer le salarié)', 'convention'),
  ('cursus', 'feuilles', 'comment', 'Texte libre : commentaire du salarié sur sa semaine', 'convention'),
  ('cursus', 'feuilles', 'motif_depassement', 'Texte libre : motif d''un dépassement des durées maximales', 'convention'),
  ('cursus', 'feuilles', 'motif_forfait', 'Texte libre : motif lié au forfait jours', 'convention'),
  ('cursus', 'feuilles', 'reouverture', 'Texte libre : réouverture d''une feuille et son motif', 'convention'),
  ('cursus', 'voyages', 'motif', 'Texte libre : objet du déplacement', 'convention'),
  ('cursus', 'voyages', 'hebergement', 'Vie privée : adresse d''hébergement en déplacement', 'convention'),
  ('cursus', 'voyages', 'contact_sur_place', 'Vie privée : contact sur place', 'convention'),
  ('cursus', 'voyages', 'annule_motif', 'Texte libre : motif d''annulation', 'convention'),
  ('cursus', 'reports', 'motif', 'Texte libre : motif d''un report de congés', 'convention'),
  ('cursus', 'clotures', 'motif', 'Texte libre : motif d''une décision de clôture', 'convention'),
  ('cursus', 'envois', 'contenu', 'Texte libre : corps des messages sortants (e-mails, Keystone)', 'convention'),
  ('cursus', 'envois', 'erreur', 'Texte libre : réponse d''erreur du destinataire', 'convention'),
  ('cursus', 'envois', 'accuse', 'Texte libre : accusé de réception du destinataire', 'convention'),
  ('cursus', 'notifications', 'objet', 'Texte libre : objet d''un message au salarié', 'convention'),
  ('cursus', 'notifications', 'texte', 'Texte libre : texte d''un message au salarié', 'convention'),
  -- Paie : contenu figé et résumé des lots (rubriques d'absence santé, absence par absence, avec matricule et dates).
  ('cursus', 'lots_paie', 'contenu', 'Santé : contenu figé du lot de paie (rubriques d''absence révélant un arrêt, matricule, dates)', 'convention'),
  ('cursus', 'lots_paie', 'resume', 'Santé : résumé du lot de paie (éléments nominatifs à saisir dans Sage, rubrique d''absence)', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;
