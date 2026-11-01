// Notifications sur le téléphone (lot 11, chantier C2, t196) : registre des notifications push que Cursus peut envoyer à
// une application installée. Créé vide par le socle commun du lot 11 (S0) pour que plusieurs chantiers (frais, OPCO,
// échéances…) y ajoutent les leurs sans se disputer la création du fichier : chacun ajoute les siennes dans un bloc
// « // lot 11 — <module> » en fin de registre. Réponse du propriétaire (31 octobre 2026) : notifications génériques, sans
// nom ni date (le service de push et l'écran verrouillé n'en voient rien), coupées par défaut, jamais de 20 h à 7 h ni le
// week-end ; le détail se lit dans Cursus, après connexion. Le titre et le texte sont donc fixes, sans gabarit à remplir
// (contrôlé par tests/lot11-socle.test.ts). Envoi par la table envois_push du chantier C2 ; la table envois, sa cible et
// sa file ne changent pas.

/** Texte fixe d'une notification, et écran de Cursus qu'elle ouvre. */
export interface ModeleNotificationPush {
  /** Titre court, sans nom ni date. */
  titre: string;
  /** Texte, sans nom ni date. */
  corps: string;
  /** Vue de Cursus ouverte au toucher (ALLOWED_VIEWS de shared/constants.ts) ; à défaut, l'accueil de l'espace. */
  vue?: string;
}

/** Notifications push, par clé (vide tant qu'aucun chantier n'en a inscrit). */
export const NOTIFICATIONS_PUSH: Readonly<Record<string, ModeleNotificationPush>> = {};
