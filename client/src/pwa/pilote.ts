// Saisie hors ligne branchée sur l'application (lot 11, chantier C2, t196, étape 2) : entre l'écran qui lance une action
// (store.tsx, `run`) et la file chiffrée de l'appareil (state/hors-ligne.ts). Sans React ni navigateur : le magasin
// (`useHorsLigne`) injecte l'appel de l'API, l'instantané en mémoire et les messages ; tests/client-pwa.test.ts.
// - Envoi d'une saisie admise (saisie-hors-ligne.ts) : en ligne comme avant ; serveur injoignable (réponse sans statut)
//   ou appareil hors ligne : la saisie entre dans la file, la feuille affichée la montre, l'écran reçoit « saisie gardée »
//   au lieu d'une erreur. Une demande de congé part en ligne avec sa clé d'idempotence, que la file reprend : si la
//   première réponse s'est seulement perdue, le rejeu rend la réponse gardée par le serveur, sans seconde demande.
// - Rejeu (`rejouer`) au chargement, au retour du réseau, au retour sur l'application et après une reconnexion : en série,
//   pour le compte et l'espace de la session seulement, une relecture de l'instantané à la fin ; refus → « À reprendre ».
// - Session d'un autre compte : file purgée ; saisies de plus de 7 jours purgées ; « Appareil partagé » : rien n'est gardé.
import { plural } from '../../../shared/format.ts';
import type { Dataset, Role } from '../../../shared/types.ts';
import type { ActionResponse, NomAction, SessionState } from '../api.ts';
import type { BilanRejeu, EntreeFile, Envoyeur, FileHorsLigne, Porteur } from '../state/hors-ligne.ts';
import { appliquerLocalement, versFile } from './saisie-hors-ligne.ts';

/** Message rendu à l'écran pour une saisie gardée sur l'appareil. */
export const MESSAGE_GARDEE = 'Hors ligne : saisie gardée sur cet appareil, envoyée au retour du réseau';

export interface DependancesPilote {
  /** File de l'appareil (null : navigateur sans IndexedDB ni WebCrypto, ou appareil partagé). */
  file: FileHorsLigne | null;
  session: () => SessionState | null;
  donnees: () => Dataset | null;
  /** Instantané en mémoire qui montre la saisie gardée. */
  montrer: (d: Dataset) => void;
  /** POST /api/actions/:nom (api.action), avec l'espace et, au besoin, la clé d'idempotence. */
  appelerApi: (name: NomAction, payload: Record<string, unknown>, espace?: Role, rejeu?: { cle: string; horsLigne?: boolean }) => Promise<ActionResponse>;
  envoyeur: (espace: Role) => Envoyeur;
  relire: () => unknown;
  notifier: (texte: string, erreur?: boolean) => void;
  enLigne: () => boolean;
  /** Appareil partagé : ni file ni notifications. */
  partage: () => boolean;
  /** État changé (file, rejeu) : l'écran se redessine. */
  changement: () => void;
}

/** Compte et espace de la session, si une personne est connectée. */
export function porteurDe(s: SessionState | null): Porteur | null {
  return s?.user && s.compte ? { compteId: s.compte.id, espace: s.role } : null;
}

export class PiloteHorsLigne {
  /** Saisies du compte et de l'espace de la session, dans l'ordre (en attente, puis « À reprendre »). */
  entrees: EntreeFile[] = [];
  /** Rejeu en cours. */
  rejeu = false;
  private readonly dep: DependancesPilote;

  constructor(dep: DependancesPilote) { this.dep = dep; }

  private get file(): FileHorsLigne | null { return this.dep.partage() ? null : this.dep.file; }

  /** Relit la file pour la session (après tout changement). */
  async actualiser(): Promise<void> {
    const f = this.file, qui = porteurDe(this.dep.session());
    this.entrees = f && qui ? await f.lister(qui).catch(() => []) : [];
    this.dep.changement();
  }

  /** Action lancée par l'écran : en ligne, ou gardée dans la file si elle le peut et que le réseau manque. */
  async appeler(name: NomAction, payload: Record<string, unknown>): Promise<ActionResponse> {
    const s = this.dep.session(), f = this.file, qui = porteurDe(s);
    const mf = f && qui ? versFile(name, payload, this.dep.donnees()) : null;
    if (!f || !qui || !mf) return await this.dep.appelerApi(name, payload, s?.role);
    // Même action et mêmes paramètres que la file : la clé de l'envoi en ligne la suit (jamais deux fois la même saisie).
    const cle = mf.nom === name && mf.payload === payload ? crypto.randomUUID() : undefined;
    let r: ActionResponse | null = null;
    if (this.dep.enLigne()) {
      r = await this.dep.appelerApi(name, payload, s?.role, cle ? { cle, horsLigne: false } : undefined);
      if (r.status !== 0) return r;
    }
    try {
      await f.ajouter(qui, mf.nom, mf.payload, cle ? { id: cle } : {});
    } catch {
      // Stockage refusé (navigation privée, espace plein) : l'erreur d'origine, comme avant le hors ligne.
      return r ?? { ok: false, message: null, error: 'Hors ligne : saisie impossible à garder sur cet appareil, refaites-la une fois connecté', status: 0 };
    }
    const d = this.dep.donnees();
    if (d) this.dep.montrer(appliquerLocalement(d, mf));
    await this.actualiser();
    return { ok: true, message: MESSAGE_GARDEE };
  }

  /** Envoie la file de la session, si le réseau est là ; null si rien n'a été tenté. */
  async rejouer(): Promise<BilanRejeu | null> {
    const f = this.file, qui = porteurDe(this.dep.session());
    if (!f || !qui || this.rejeu || !this.dep.enLigne()) return null;
    this.rejeu = true;
    this.dep.changement();
    let b: BilanRejeu | null = null;
    try {
      b = await f.rejouer(qui, this.dep.envoyeur(qui.espace), this.dep.relire);
      // Rien d'envoyé mais des refus : la feuille affichée portait la saisie refusée, elle est relue.
      if (b.aReprendre && !b.envoyees) await this.dep.relire();
    } catch {
      // File illisible (clé effacée par le navigateur) : rien n'est perdu de plus, la file reste telle quelle.
    } finally {
      this.rejeu = false;
    }
    await this.actualiser();
    if (b?.envoyees) this.dep.notifier(`${plural(b.envoyees, 'saisie envoyée', 'saisies envoyées')} au retour du réseau`);
    if (b?.aReprendre) this.dep.notifier(`${plural(b.aReprendre, 'saisie refusée', 'saisies refusées')} par le serveur : voyez « À reprendre »`, true);
    return b;
  }

  /** Session lue (chargement, connexion, reconnexion) : purges, puis rejeu. */
  async surSession(): Promise<void> {
    const f = this.file, qui = porteurDe(this.dep.session());
    if (f && qui) {
      await f.purgerAutreCompte(qui.compteId).catch(() => false);
      await f.purgerAnciennes().catch(() => 0);
    }
    await this.actualiser();
    await this.rejouer();
  }

  /** « Renvoyer » une saisie « À reprendre », puis rejeu. */
  async reprendre(id: string): Promise<void> {
    await this.file?.reprendre(id);
    await this.actualiser();
    await this.rejouer();
  }

  /** « Abandonner » une saisie (en attente ou à reprendre) ; la feuille affichée est relue. */
  async abandonner(id: string): Promise<void> {
    await this.file?.abandonner(id);
    await this.actualiser();
    if (this.dep.enLigne()) await this.dep.relire();
  }

  /** Purge complète de la file de l'appareil (déconnexion, appareil partagé). */
  async purger(): Promise<void> {
    await this.dep.file?.purger().catch(() => {});
    await this.actualiser();
  }
}
