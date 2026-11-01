// Saisie hors ligne de l'application mobile (lot 11, chantier C2, t196) : registre des actions que l'application, déjà
// ouverte avec du réseau, peut mettre en file quand elle le perd, puis envoyer au retour du réseau. Créé vide par le socle
// commun du lot 11 (S0) pour que plusieurs chantiers y ajoutent leurs actions sans se disputer la création du fichier :
// chacun ajoute les siennes dans un bloc « // lot 11 — <module> » en fin de liste. Réponse du propriétaire (31 octobre
// 2026) : le hors ligne ne vaut que pour une application ouverte en ligne qui perd le réseau ; aucun instantané n'est gardé
// sur le téléphone. Une action ne s'y inscrit que si elle n'a besoin d'aucune donnée lue hors ligne pour être refusée ou
// acceptée par le serveur au retour du réseau (droits et contrôles rejoués côté serveur, comme toute action) ; chaque nom
// est celui d'une action du registre du serveur (server/src/actions/index.ts, contrôlé par tests/lot11-socle.test.ts).
//
// Règles communes (chantier C2) : une saisie hors ligne est personnelle (le salarié pour lui-même, jamais pour son équipe :
// le manager qui pose une absence pour un salarié la valide du même coup), jamais une validation ni une action liée à la
// paie (ACTIONS_PAIE de shared/journal.ts), jamais une donnée de santé (demande d'absence limitée aux congés, sans
// justificatif). Le serveur applique `refusHorsLigne` à toute requête marquée hors ligne (en-tête EN_TETE_HORS_LIGNE,
// server/src/app.ts) ; le client (client/src/state/hors-ligne.ts) ne met en file que ce qu'elle admet.

/** Noms des actions acceptées dans la file hors ligne. */
export const ACTIONS_HORS_LIGNE: readonly string[] = [
  // lot 11 — pwa : heures du jour (cellule désignée par projet et tâche, avec la valeur vue : temps.saisir), ligne de projet
  // ajoutée hors ligne (créée seulement si elle manque au rejeu), demande de congé.
  'temps.saisir', 'temps.addLine', 'absence.demander',
  // lot 11 — notes de frais : dépense (photo du reçu, montant, date) ajoutée à sa propre note, ou au brouillon du mois
  // (dépense rapide, sans note désignée) ; jamais une dépense médicale (donnée de santé), ni une soumission ou une validation.
  'frais.ligne.ajouter',
];

/** En-tête de la clé d'idempotence d'un envoi (UUID tiré par le client, server/src/idempotence.ts). */
export const EN_TETE_IDEMPOTENCE = 'idempotency-key';
/**
 * En-tête posé par la file hors ligne sur chaque rejeu (« 1 ») : l'action est contrôlée par `refusHorsLigne` et tracée au
 * journal avec `horsLigne: true` (server/src/journal.ts). Rien d'autre ne change : droits et contrôles de l'action.
 */
export const EN_TETE_HORS_LIGNE = 'x-cursus-hors-ligne';
/** Clé d'idempotence admise : 16 à 100 caractères sûrs (UUID de crypto.randomUUID, ou équivalent). */
export const FORME_CLE_IDEMPOTENCE = /^[A-Za-z0-9_-]{16,100}$/;

/** Natures d'absence admises hors ligne : les congés, jamais une absence à nature de santé ni le compte épargne-temps. */
export const CONGES_HORS_LIGNE: readonly string[] = ['CP', 'RTT', 'RECUP'];

/** Conservation de la file sur l'appareil, en jours : au-delà, elle est purgée (clé comprise). */
export const CONSERVATION_FILE_JOURS = 7;
/** Pause entre deux envois du rejeu, en millisecondes : une équipe qui retrouve le réseau ne sature pas le serveur. */
export const PAUSE_REJEU_MS = 300;

/**
 * Refus d'une action rejouée depuis la file hors ligne (`empId` : salarié du compte qui agit), ou null si elle est admise.
 * Contrôle de forme seulement : l'action fait ensuite tous ses contrôles habituels.
 */
export function refusHorsLigne(nom: string, p: Record<string, unknown>, empId: number | null): string | null {
  if (!ACTIONS_HORS_LIGNE.includes(nom)) return 'Action non admise hors ligne : refaites-la une fois connecté';
  // lot 11 — pwa : saisie personnelle seulement, congés sans justificatif.
  if (empId == null || Number(p.empId) !== empId) return 'Hors ligne, seule votre propre saisie est admise : refaites-la une fois connecté';
  // lot 11 — notes de frais : jamais de frais médicaux hors ligne.
  if (nom === 'frais.ligne.ajouter' && p.categorie === 'medical') return 'Hors ligne, les frais médicaux ne se saisissent pas : refaites la dépense une fois connecté';
  if (nom === 'absence.demander') {
    if (!CONGES_HORS_LIGNE.includes(String(p.kind ?? ''))) return 'Hors ligne, seuls les congés payés, RTT et récupérations peuvent être demandés';
    if (p.jetons != null || p.pieces != null) return 'Hors ligne, une demande de congé part sans pièce justificative';
  }
  return null;
}
