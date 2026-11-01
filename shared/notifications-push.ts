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

/**
 * Notifications push, par clé : le type de la notification e-mail (`Notification.type`, server/src/notifications.ts) qu'elles
 * doublent, ou un type propre (`push.essai`).
 */
export const NOTIFICATIONS_PUSH: Readonly<Record<string, ModeleNotificationPush>> = {
  // lot 11 — pwa : étapes de validation (les informations au retour d'un arrêt, liées à la santé, n'en ont pas).
  'absence.demande': { titre: 'Demande de congé à valider', corps: 'Une demande de congé attend votre décision.', vue: 'absences' },
  'absence.decision': { titre: 'Demande de congé', corps: 'Une décision a été prise sur une demande de congé.', vue: 'absences' },
  'temps.soumise': { titre: 'Feuille de temps à valider', corps: 'Une feuille de temps attend votre validation.', vue: 'temps' },
  'temps.renvoyee': { titre: 'Feuille de temps renvoyée', corps: 'Une feuille de temps est à corriger.', vue: 'temps' },
  'temps.relance': { titre: 'Feuille de temps à compléter', corps: 'Une feuille de temps reste à saisir ou à soumettre.', vue: 'temps' },
  'entretien.clos': { titre: 'Entretien', corps: 'Un compte rendu d’entretien est disponible.', vue: 'entretiens' },
  'demande.reponse': { titre: 'Réponse du service RH', corps: 'Le service RH a répondu à une demande.' },
  // lot 11 — notes de frais : circuit (la boîte du service RH, prévenue des notes à contrôler, n'a pas d'appareil ; les
  // comptes de la comptabilité, oui).
  'frais.soumise': { titre: 'Note de frais à valider', corps: 'Une note de frais attend votre validation.', vue: 'frais' },
  'frais.acontroler': { titre: 'Note de frais à contrôler', corps: 'Une note de frais attend votre contrôle.', vue: 'frais' },
  'frais.renvoyee': { titre: 'Note de frais renvoyée', corps: 'Une note de frais est à corriger.', vue: 'frais' },
  'frais.validee': { titre: 'Note de frais', corps: 'Une note de frais a été validée.', vue: 'frais' },
  'frais.payee': { titre: 'Note de frais remboursée', corps: 'Une note de frais a été remboursée.', vue: 'frais' },
  'push.essai': { titre: 'Notifications de Cursus', corps: 'Les notifications fonctionnent sur cet appareil.' },
};

// — lot 11 — pwa : préférences, plage de silence, appareil (règles partagées par le serveur et l'interface) —

/** Types que la personne choisit de recevoir (tous coupés par défaut) : tout le registre, sauf la notification d'essai. */
export const TYPES_PUSH: readonly string[] = Object.keys(NOTIFICATIONS_PUSH).filter(t => t !== 'push.essai');

/** Durée de validité d'une notification chez le service de push (en-tête TTL), et dans la file après l'heure d'envoi admise. */
export const TTL_PUSH_S = 24 * 3600;
/** Plage de silence (droit à la déconnexion, art. L2242-17) : aucun envoi avant 7 h, ni à partir de 20 h, ni le week-end. */
export const SILENCE_PUSH = { debut: 20, fin: 7 } as const;
/** Abonnements au plus par compte (le plus ancien est remplacé). */
export const MAX_ABONNEMENTS_PUSH = 10;

/** Systèmes et navigateurs reconnus par l'application (libellé d'appareil, jamais saisi). */
export const SYSTEMES_PUSH = { ios: 'iPhone ou iPad', android: 'Android', windows: 'Windows', macos: 'Mac', linux: 'Linux', autre: 'Appareil' } as const;
export const NAVIGATEURS_PUSH = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', samsung: 'Samsung Internet', autre: 'navigateur' } as const;

/** Libellé d'un appareil (« Android, Chrome ») d'après les codes envoyés par l'application ; code inconnu : « autre ». */
export function libelleAppareil(systeme: unknown, navigateur: unknown): string {
  const s = Object.hasOwn(SYSTEMES_PUSH, String(systeme)) ? SYSTEMES_PUSH[systeme as keyof typeof SYSTEMES_PUSH] : SYSTEMES_PUSH.autre;
  const n = Object.hasOwn(NAVIGATEURS_PUSH, String(navigateur)) ? NAVIGATEURS_PUSH[navigateur as keyof typeof NAVIGATEURS_PUSH] : NAVIGATEURS_PUSH.autre;
  return `${s}, ${n}`;
}

/** Codes du système et du navigateur, devinés d'après l'agent du navigateur (application, sans donnée saisie). */
export function codesAppareil(agent: string): { systeme: keyof typeof SYSTEMES_PUSH; navigateur: keyof typeof NAVIGATEURS_PUSH } {
  const a = agent.toLowerCase();
  const systeme = /iphone|ipad|ipod/.test(a) ? 'ios' : a.includes('android') ? 'android' : a.includes('windows') ? 'windows'
    : a.includes('mac os') || a.includes('macintosh') ? 'macos' : a.includes('linux') ? 'linux' : 'autre';
  const navigateur = a.includes('samsungbrowser') ? 'samsung' : /edg\//.test(a) ? 'edge' : /firefox|fxios/.test(a) ? 'firefox'
    : /chrome|crios/.test(a) ? 'chrome' : a.includes('safari') ? 'safari' : 'autre';
  return { systeme, navigateur };
}

/** Préférences reçues : types connus seulement, sans doublon, dans l'ordre du registre. */
export const typesValides = (v: unknown): string[] => (Array.isArray(v) ? TYPES_PUSH.filter(t => v.includes(t)) : []);

/**
 * Heure et jour de la semaine à Paris (0 : dimanche) : le serveur peut tourner en UTC. Calculés par Intl, comme
 * shared/dates.ts.
 */
function heureParis(d: Date): { jour: string; heure: number; semaine: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour), semaine: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/**
 * Premier instant d'envoi admis à partir de `d` : `d` lui-même du lundi au vendredi entre 7 h et 20 h (heure de Paris),
 * sinon le jour ouvré suivant (lundi à vendredi) à 7 h. Les jours fériés ne sont pas exclus.
 */
export function prochainEnvoiAdmis(d: Date): Date {
  const { jour, heure, semaine } = heureParis(d);
  const ouvre = semaine >= 1 && semaine <= 5;
  if (ouvre && heure >= SILENCE_PUSH.fin && heure < SILENCE_PUSH.debut) return d;
  // Jour du prochain envoi : aujourd'hui avant 7 h un jour ouvré, sinon le lendemain, reporté après le week-end.
  let j = new Date(`${jour}T12:00:00Z`);
  if (!(ouvre && heure < SILENCE_PUSH.fin)) j = new Date(j.getTime() + 86_400_000);
  while (j.getUTCDay() === 0 || j.getUTCDay() === 6) j = new Date(j.getTime() + 86_400_000);
  // 7 h à Paris ce jour-là : midi UTC moins l'écart, corrigé d'après l'heure de Paris lue à midi UTC (été comme hiver).
  const midi = heureParis(j).heure; // 13 l'hiver, 14 l'été
  return new Date(j.getTime() + (SILENCE_PUSH.fin - midi) * 3600_000);
}
