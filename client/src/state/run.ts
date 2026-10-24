// Exécution des actions serveur et reprise après l'expiration de la session (t159), sortie de state/store.tsx pour être
// testée sans React ni navigateur (tests/client-run.test.ts) : le magasin ne fait que brancher ses fonctions.
// - Une action réussie remet l'instantané renvoyé (sinon, `relire`, le relit) et affiche son message (sauf `silent`).
// - Session expirée (401) alors qu'une personne est connectée : l'action attend la reconnexion dans la file, puis est
//   rejouée ; l'écran qui l'a lancée attend sa réponse, ou reçoit « action non enregistrée » si la personne renonce.
// - Espace changé dans un autre onglet (409) : rien n'a été fait, l'onglet suit la session, l'action n'est pas rejouée.
// - Autre refus : message d'erreur, puis relecture des données (l'écran était peut-être en retard).
// - La même action déjà en cours (double clic, double envoi) n'est pas renvoyée (AppelsEnCours de state/actions.ts).
import type { CompteSession, Dataset, Role } from '../../../shared/types.ts';
import type { ActionResponse, NomAction } from '../api.ts';
import { cleAction, type AppelsEnCours } from './actions.ts';

/** Réponse d'une action interrompue puis abandonnée (« Changer de compte »). */
export const NON_ENREGISTREE = 'Session expirée : action non enregistrée';

/** Action interrompue par l'expiration de la session. */
export interface Attente { rejouer: () => Promise<unknown>; abandonner: () => void }

export interface OptionsAction { silent?: boolean }
export type Executer = (name: NomAction, payload: Record<string, unknown>, opts?: OptionsAction) => Promise<ActionResponse>;

/** Ce que l'exécution demande au magasin : l'appel, l'état de la session et les suites d'une réponse. */
export interface DependancesAction {
  /** Appel de l'API (POST /api/actions/:nom), avec l'espace affiché. */
  appeler: (name: NomAction, payload: Record<string, unknown>) => Promise<ActionResponse>;
  /** Une personne est connectée (sinon un 401 ne met rien en attente : l'écran de connexion s'affiche). */
  connecte: () => boolean;
  /** Instantané renvoyé par l'action. */
  recevoir: (d: Dataset) => void;
  notifier: (text: string, error?: boolean) => void;
  /** Met l'action en attente de la reconnexion. */
  attendre: (a: Attente) => void;
  /** 409 : l'onglet suit la session. */
  suivre: () => void;
  /** Autre refus : relecture des données. */
  rafraichir: () => void;
}

/** Exécution d'une action, avec ses suites (message, instantané, attente de la reconnexion, relecture). */
export function executeurActions(dep: DependancesAction): Executer {
  const executer: Executer = async (name, payload, opts) => {
    const r = await dep.appeler(name, payload);
    if (r.ok) {
      if (r.data) dep.recevoir(r.data);
      // Action faite, instantané non relu par le serveur (Cursus occupé) : relu à part, l'action n'est pas refaite.
      else if (r.relire) dep.rafraichir();
      if (r.message && !opts?.silent) dep.notifier(r.message);
      return r;
    }
    // Session expirée : l'action attend la reconnexion, puis est rejouée ; l'écran qui l'a lancée attend sa réponse.
    if (r.status === 401 && dep.connecte()) {
      return new Promise<ActionResponse>(resolve => dep.attendre({
        rejouer: () => executer(name, payload, opts).then(resolve),
        abandonner: () => resolve({ ok: false, message: null, error: NON_ENREGISTREE, status: 401 }),
      }));
    }
    dep.notifier(r.error || 'Action impossible', true);
    // Espace changé dans un autre onglet : rien n'a été fait ; l'onglet suit la session, l'action n'est pas rejouée.
    if (r.status === 409) dep.suivre();
    // Action refusée : l'écran était peut-être en retard (demande déjà traitée, feuille modifiée ailleurs).
    else if (r.status !== 401) dep.rafraichir();
    return r;
  };
  return executer;
}

/**
 * Lance une action : la même action déjà en cours (même nom, mêmes paramètres) rend la même réponse, sauf si un appel
 * différent de cette action est parti depuis (la dernière intention doit arriver).
 */
export function lancerAction(appels: AppelsEnCours<ActionResponse>, executer: Executer, name: NomAction,
  payload: Record<string, unknown> = {}, opts?: OptionsAction): Promise<ActionResponse> {
  return appels.lancer(cleAction(name, payload), () => executer(name, payload, opts), name);
}

/** Actions interrompues par l'expiration de la session, dans l'ordre où elles ont été lancées. */
export class FileAttente {
  private attentes: Attente[] = [];
  get taille(): number { return this.attentes.length; }
  /** Ajoute une action ; renvoie le nombre d'actions en attente (affiché par la reconnexion). */
  ajouter(a: Attente): number { this.attentes.push(a); return this.attentes.length; }
  /** Renonce à toutes : chaque écran reçoit « action non enregistrée ». */
  abandonnerTout(): void { for (const a of this.attentes.splice(0)) a.abandonner(); }
  /**
   * Rejoue toutes les actions, une à une dans l'ordre (la suivante part après la réponse de la précédente) ; chacune
   * rend sa réponse à l'écran qui l'attend. La file est vidée tout de suite : une nouvelle expiration repart de zéro.
   */
  rejouerTout(): Promise<void> {
    const file = this.attentes.splice(0);
    return (async () => { for (const a of file) await a.rejouer(); })();
  }
}

/** Personne à reconnecter : son compte, l'espace où elle travaillait, sa méthode de connexion. */
export interface ReconnexionCible { compte: CompteSession; role: Role }
/** Session renvoyée par la connexion (sous-ensemble de SessionState). */
export interface SessionReconnectee { role: Role; user: unknown; compte: CompteSession | null }

/**
 * Suite d'une reconnexion, d'après la session obtenue :
 * - `remplacer` : mot de passe provisoire à remplacer, ou autre compte (`autreCompte`) : rien n'est rejoué, et un autre
 *   compte ne reprend pas l'écran (fiche, filtres) de la personne précédente ;
 * - `reprendre` : même compte ; `espace` est l'espace à rétablir (la connexion ouvre le premier espace du compte), null
 *   s'il n'y a rien à changer ou si l'espace a été retiré au compte entre-temps.
 */
export function suiteReconnexion(rc: ReconnexionCible, s: SessionReconnectee):
  { quoi: 'remplacer'; autreCompte: boolean } | { quoi: 'reprendre'; espace: Role | null } {
  if (!s.user || s.compte?.id !== rc.compte.id) return { quoi: 'remplacer', autreCompte: !!s.compte && s.compte.id !== rc.compte.id };
  return { quoi: 'reprendre', espace: s.role !== rc.role && s.compte.espaces.includes(rc.role) ? rc.role : null };
}

/** Après le retour à l'espace : les actions ne sont rejouées que dans l'espace où elles ont été lancées. */
export const rejouable = (rc: ReconnexionCible, s: { role: Role }) => s.role === rc.role;
