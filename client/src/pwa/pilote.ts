// Saisie hors ligne branchée sur l'application (lot 11, chantier C2, t196, étape 2) : entre l'écran qui lance une action
// (store.tsx, `run`) et la file chiffrée de l'appareil (state/hors-ligne.ts). Sans React ni navigateur : le magasin
// (`useHorsLigne`) injecte l'appel de l'API, l'instantané en mémoire et les messages ; tests/client-pwa.test.ts.
// - Envoi d'une saisie admise (saisie-hors-ligne.ts) : en ligne comme avant ; serveur injoignable (réponse sans statut)
//   ou appareil hors ligne : la saisie entre dans la file, la feuille affichée la montre, l'écran reçoit « saisie gardée »
//   au lieu d'une erreur. Une demande de congé part en ligne avec sa clé d'idempotence, que la file reprend : si la
//   première réponse s'est seulement perdue, le rejeu rend la réponse gardée par le serveur, sans seconde demande.
// - Rejeu (`rejouer`) au chargement, au retour du réseau, au retour sur l'application et après une reconnexion : en série,
//   pour le compte et l'espace de la session seulement, une relecture de l'instantané à la fin ; refus → « À reprendre ».
// - Relecture périodique (store.tsx) : tant que des saisies attendent, elle devient un rejeu (`relecture`), qui relit à la
//   fin s'il en part au moins une. Sans cela, un serveur revenu sans événement « online » (Wi-Fi d'atelier sans accès,
//   puis accès rétabli) ferait relire une feuille sans la saisie gardée, qui semblerait perdue alors qu'elle attend.
// - Session d'un autre compte : file purgée ; saisies de plus de 7 jours purgées ; « Appareil partagé » : rien n'est gardé.
//   À chaque session lue, l'abonnement aux notifications du navigateur est rapproché des appareils du compte
//   (`verifierAbonnement`, pwa/push.ts) : celui d'un autre compte (session expirée, puis connexion d'une autre personne
//   sans déconnexion) est retiré, pour qu'elle ne reçoive pas les notifications de la précédente.
import { plural } from '../../../shared/format.ts';
import { refusHorsLigne } from '../../../shared/hors-ligne.ts';
import type { Dataset, Role } from '../../../shared/types.ts';
import type { ActionResponse, NomAction, SessionState } from '../api.ts';
import type { BilanRejeu, EntreeFile, Envoyeur, FileHorsLigne, PieceLocale, Porteur } from '../state/hors-ligne.ts';
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
  /** Abonnement aux notifications du navigateur retiré s'il n'est pas à ce compte (pwa/push.ts) ; erreurs ignorées. */
  verifierAbonnement?: () => Promise<unknown>;
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
  /** Saisies gardées sur l'appareil dans un autre espace du compte (bandeau, alerte avant la déconnexion). */
  autres = 0;
  /** Rejeu en cours. */
  rejeu = false;
  private readonly dep: DependancesPilote;

  constructor(dep: DependancesPilote) { this.dep = dep; }

  private get file(): FileHorsLigne | null { return this.dep.partage() ? null : this.dep.file; }

  /** Relit la file pour la session (après tout changement). */
  async actualiser(): Promise<void> {
    const f = this.file, qui = porteurDe(this.dep.session());
    this.entrees = f && qui ? await f.lister(qui).catch(() => []) : [];
    this.autres = f && qui ? Math.max(0, await f.taille().catch(() => 0) - this.entrees.length) : 0;
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

  /**
   * Relecture périodique de l'instantané (store.tsx) : rejeu d'abord si des saisies attendent (il relit à la fin s'il en
   * part une ; serveur encore injoignable : l'instantané affiché, qui les montre, reste tel quel), sinon relecture.
   */
  async relecture(): Promise<void> {
    if (this.file && this.entrees.some(e => e.etat === 'attente')) {
      if (this.dep.enLigne()) await this.rejouer();
      return;
    }
    await this.dep.relire();
  }

  /** Nombre de saisies gardées sur l'appareil, tous espaces confondus (purgées à la déconnexion). */
  async taille(): Promise<number> {
    return await this.dep.file?.taille().catch(() => 0) ?? 0;
  }

  /** Session lue (chargement, connexion, reconnexion) : purges, abonnement aux notifications rapproché du compte, rejeu. */
  async surSession(): Promise<void> {
    const f = this.file, qui = porteurDe(this.dep.session());
    if (f && qui) {
      await f.purgerAutreCompte(qui.compteId).catch(() => false);
      await f.purgerAnciennes().catch(() => 0);
    }
    if (qui) await this.dep.verifierAbonnement?.().catch(() => null);
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

  // lot 11 — notes de frais
  /**
   * Compte de la session gardé pour la dépense rapide de la page « Hors ligne » (`frais` : notes de frais activées et
   * salarié connecté) ; sinon effacé. Sans session ni instantané (ouverture sans réseau), rien ne change.
   */
  async memoriserPorteur(frais: boolean | undefined): Promise<void> {
    const f = this.file, s = this.dep.session(), qui = porteurDe(s);
    if (!f || !qui || frais === undefined) return;
    await f.garderPorteur(frais && s?.user?.empId ? { ...qui, empId: s.user.empId } : null).catch(() => {});
  }

  /**
   * Dépense avec la photo du reçu gardée sur l'appareil (réseau absent pendant l'envoi de la photo) : la photo part
   * avant l'action au retour du réseau, jetons dans `jetons`. Faux si la file ne peut pas la garder, ou si la saisie n'est
   * pas admise hors ligne (`refusHorsLigne`, comme `versFile` : la sienne seulement, jamais de frais médicaux) — la dépense
   * d'un autre salarié saisie par le service RH ne garde pas son reçu sur l'appareil.
   */
  async garderAvecPieces(nom: NomAction, payload: Record<string, unknown>, pieces: PieceLocale[]): Promise<boolean> {
    const f = this.file, s = this.dep.session(), qui = porteurDe(s);
    if (!f || !qui) return false;
    if (refusHorsLigne(nom, payload, s?.user?.empId ?? null) !== null) return false;
    try {
      await f.ajouter(qui, nom, payload, { pieces, champPieces: 'jetons' });
    } catch {
      return false;
    }
    await this.actualiser();
    return true;
  }

  /** Purge complète de la file de l'appareil (déconnexion, appareil partagé). */
  async purger(): Promise<void> {
    await this.dep.file?.purger().catch(() => {});
    await this.actualiser();
  }
}
