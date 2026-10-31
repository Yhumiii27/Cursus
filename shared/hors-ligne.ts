// Saisie hors ligne de l'application mobile (lot 11, chantier C2, t196) : registre des actions que l'application, déjà
// ouverte avec du réseau, peut mettre en file quand elle le perd, puis envoyer au retour du réseau. Créé vide par le socle
// commun du lot 11 (S0) pour que plusieurs chantiers y ajoutent leurs actions sans se disputer la création du fichier :
// chacun ajoute les siennes dans un bloc « // lot 11 — <module> » en fin de liste. Réponse du propriétaire (31 octobre
// 2026) : le hors ligne ne vaut que pour une application ouverte en ligne qui perd le réseau ; aucun instantané n'est gardé
// sur le téléphone. Une action ne s'y inscrit que si elle n'a besoin d'aucune donnée lue hors ligne pour être refusée ou
// acceptée par le serveur au retour du réseau (droits et contrôles rejoués côté serveur, comme toute action) ; chaque nom
// est celui d'une action du registre du serveur (server/src/actions/index.ts, contrôlé par tests/lot11-socle.test.ts).

/** Noms des actions acceptées dans la file hors ligne (vide tant que C2 n'a rien inscrit). */
export const ACTIONS_HORS_LIGNE: readonly string[] = [];
