// File hors ligne de l'application mobile (lot 11, chantier C2, t196) : saisies faites pendant une coupure du réseau,
// gardées chiffrées sur l'appareil puis envoyées au retour du réseau. Testée sans navigateur (tests/client-hors-ligne.test.ts) :
// le stockage (`Magasin`) et l'envoi (`Envoyeur`) sont injectés ; IndexedDB en service (`magasinIndexedDb`).
// Réponse du propriétaire (31 octobre 2026) : le hors ligne ne vaut que pour une application ouverte avec du réseau qui le
// perd ; aucun instantané n'est gardé sur l'appareil, seulement les saisies en attente.
// - Actions admises : registre ACTIONS_HORS_LIGNE (shared/hors-ligne.ts), saisie personnelle, jamais une validation ni une
//   action de paie ; le serveur le contrôle de nouveau (`refusHorsLigne`).
// - Chiffrement : AES-GCM 256 avec une CryptoKey non extractible créée par WebCrypto et rangée avec la file (IndexedDB
//   garde l'objet de clé sans jamais en exposer les octets). Protège une copie du profil du navigateur ou une sauvegarde
//   de l'appareil ; ne protège pas d'un script de la même origine ni d'un téléphone déverrouillé. En clair : le compte,
//   l'espace, la date de saisie, l'état et le nombre de tentatives ; tout le reste (action, saisie, pièces, motif d'un
//   refus) est chiffré.
// - Liée au compte et à l'espace : seules les saisies du compte connecté, dans l'espace où elles ont été faites, sont
//   rejouées ; une session d'un autre compte purge tout (`purgerAutreCompte`).
// - Rejeu en série, dans l'ordre de saisie, avec une pause entre deux envois et une seule relecture de l'instantané à la
//   fin. Chaque envoi porte sa clé d'idempotence (l'identifiant de l'entrée) : une saisie dont la réponse s'est perdue
//   n'est jamais faite deux fois. Les pièces partent d'abord, avec leur propre clé, puis l'action qui les joint ; au plus
//   20 pièces envoyées et pas encore jointes (MAX_PIECES_EN_ATTENTE, shared/rules/pieces.ts). Un jeton n'est valable que
//   24 h sur le serveur (DELAI_PIECE_EN_ATTENTE_MS) : au-delà de 23 h, ou quand la personne reprend une saisie refusée,
//   la pièce encore gardée sur l'appareil est renvoyée avec une nouvelle clé (l'ancienne rendrait 410).
// - Refus du serveur (conflit, règle, droit) : l'entrée passe dans « À reprendre » avec le motif ; réseau, session expirée,
//   serveur occupé : le rejeu s'arrête, l'entrée reste en attente.
// - Purge : à la déconnexion, au changement de compte, après 7 jours (CONSERVATION_FILE_JOURS) et sur « appareil partagé ».
import { ACTIONS_HORS_LIGNE, CONSERVATION_FILE_JOURS, FORME_CLE_IDEMPOTENCE, PAUSE_REJEU_MS } from '../../../shared/hors-ligne.ts';
import { DELAI_PIECE_EN_ATTENTE_MS, MAX_PIECES_EN_ATTENTE } from '../../../shared/rules/pieces.ts';
import type { Role } from '../../../shared/types.ts';
import { type ActionResponse, api, type NomAction } from '../api.ts';

/** Stockage clé → valeur (structured clone) : IndexedDB en service, une Map dans les tests. */
export interface Magasin {
  lire(cle: string): Promise<unknown>;
  ecrire(cle: string, v: unknown): Promise<void>;
  effacer(cle: string): Promise<void>;
  cles(): Promise<string[]>;
  vider(): Promise<void>;
}

/** Magasin en mémoire (tests, navigateur sans IndexedDB : la file ne survit alors pas à la page). */
export function magasinMemoire(): Magasin & { contenu: Map<string, unknown> } {
  const contenu = new Map<string, unknown>();
  return {
    contenu,
    lire: async k => contenu.get(k),
    ecrire: async (k, v) => { contenu.set(k, v); },
    effacer: async k => { contenu.delete(k); },
    cles: async () => [...contenu.keys()],
    vider: async () => { contenu.clear(); },
  };
}

/** Magasin IndexedDB (base `nom`, un seul magasin d'objets « file »). */
export function magasinIndexedDb(nom = 'cursus-hors-ligne'): Magasin {
  let base: Promise<IDBDatabase> | null = null;
  const ouvrir = () => base ??= new Promise<IDBDatabase>((ok, ko) => {
    const r = indexedDB.open(nom, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('file'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const requete = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await ouvrir();
    return await new Promise<T>((ok, ko) => {
      const r = f(db.transaction('file', mode).objectStore('file'));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  };
  return {
    lire: async k => await requete('readonly', s => s.get(k)),
    ecrire: async (k, v) => { await requete('readwrite', s => s.put(v, k)); },
    effacer: async k => { await requete('readwrite', s => s.delete(k)); },
    cles: async () => (await requete('readonly', s => s.getAllKeys())).map(String),
    vider: async () => { await requete('readwrite', s => s.clear()); },
  };
}

/** Compte et espace de la session : la file leur est liée. */
export interface Porteur { compteId: number; espace: Role }

/** Pièce jointe à une saisie (photo d'un reçu…) : contenu gardé chiffré jusqu'à son envoi. */
export interface PieceLocale { nom: string; type: string; octets: Uint8Array }

/** Envoi au serveur : action avec sa clé d'idempotence (en-tête hors ligne posé), pièce avec la sienne. */
export interface Envoyeur {
  action(nom: NomAction, payload: Record<string, unknown>, cle: string): Promise<ActionResponse>;
  /** Pièce envoyée : son jeton ; erreur avec `status` (0 : réseau) sinon. */
  piece(p: PieceLocale, cle: string): Promise<{ jeton: string }>;
}

/** Saisie en file, telle que l'affiche l'application (« N saisies en attente d'envoi », « À reprendre »). */
export interface EntreeFile {
  id: string; nom: NomAction; payload: Record<string, unknown>; creeLe: string; etat: 'attente' | 'a_reprendre'; motif: string | null; tentatives: number; pieces: number;
}

/** Bilan d'un rejeu ; `arret` : cause de l'arrêt avant la fin de la file (le reste attend le prochain rejeu). */
export interface BilanRejeu { envoyees: number; aReprendre: number; restantes: number; arret: 'reseau' | 'session' | 'serveur' | 'pieces' | null }

/** Partie chiffrée d'une entrée. */
interface Contenu {
  nom: NomAction; payload: Record<string, unknown>; motif: string | null;
  /**
   * Pièces : contenu dans `piece:<cle>` ; clé d'idempotence de leur envoi (`cleEnvoi`, `cle` à défaut, renouvelée quand
   * le jeton est abandonné), nom, type, jeton une fois envoyées et heure de cet envoi.
   */
  pieces: { cle: string; cleEnvoi?: string; nom: string; type: string; jeton: string | null; envoiLe?: string | null }[];
  /** Champ du paramètre qui reçoit les jetons des pièces. */
  champPieces: string;
}
/** Entrée stockée : en clair, ce qui sert au tri et au rattachement ; le reste chiffré. */
interface Stockee { id: string; rang: number; compteId: number; espace: Role; creeLe: string; etat: EntreeFile['etat']; tentatives: number; chiffre: Chiffre }
interface Chiffre { iv: Uint8Array; donnees: ArrayBuffer }

const CLE = 'cle', ENTREE = 'entree:', PIECE = 'piece:';
/** Âge au-delà duquel un jeton de pièce n'est plus utilisé : une heure de marge sur sa validité côté serveur (24 h). */
const JETON_PERIME_MS = DELAI_PIECE_EN_ATTENTE_MS - 3600_000;
const attendre = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Statut d'une réponse qui demande d'attendre (réseau, session, serveur occupé) au lieu de classer la saisie « À reprendre ». */
const arretDe = (status: number | undefined): BilanRejeu['arret'] => status === 0 || status === undefined ? 'reseau' : status === 401 ? 'session'
  : status === 408 || status === 429 || status >= 500 ? 'serveur' : null;

export class FileHorsLigne {
  private readonly magasin: Magasin;
  private readonly maintenant: () => Date;
  private readonly pause: (ms: number) => Promise<void>;
  private rejeu: Promise<BilanRejeu> | null = null;
  private rang = 0;

  constructor(magasin: Magasin, o: { maintenant?: () => Date; pause?: (ms: number) => Promise<void> } = {}) {
    this.magasin = magasin;
    this.maintenant = o.maintenant ?? (() => new Date());
    this.pause = o.pause ?? attendre;
  }

  /** Clé AES-GCM de la file, créée au premier besoin, non extractible. */
  private async cle(): Promise<CryptoKey> {
    const c = await this.magasin.lire(CLE) as CryptoKey | undefined;
    if (c) return c;
    const nouvelle = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await this.magasin.ecrire(CLE, nouvelle);
    return nouvelle;
  }
  private async chiffrer(octets: Uint8Array): Promise<Chiffre> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv, donnees: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.cle(), octets as Uint8Array<ArrayBuffer>) };
  }
  private async dechiffrer(c: Chiffre): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv as Uint8Array<ArrayBuffer> }, await this.cle(), c.donnees));
  }
  private async contenu(s: Stockee): Promise<Contenu> { return JSON.parse(new TextDecoder().decode(await this.dechiffrer(s.chiffre))) as Contenu; }
  private async garder(s: Omit<Stockee, 'chiffre'>, c: Contenu) {
    await this.magasin.ecrire(ENTREE + s.id, { ...s, chiffre: await this.chiffrer(new TextEncoder().encode(JSON.stringify(c))) });
  }
  private async stockees(): Promise<Stockee[]> {
    const cles = (await this.magasin.cles()).filter(k => k.startsWith(ENTREE));
    const l = await Promise.all(cles.map(async k => await this.magasin.lire(k) as Stockee));
    return l.filter(Boolean).sort((a, b) => a.rang - b.rang);
  }

  /**
   * Met une saisie en file pour ce compte et cet espace ; renvoie son identifiant (sa clé d'idempotence). Refuse une
   * action hors du registre. `pieces` : contenu gardé chiffré, envoyé avant l'action, jetons passés dans `champPieces`.
   */
  async ajouter(qui: Porteur, nom: NomAction, payload: Record<string, unknown>, o: { pieces?: PieceLocale[]; champPieces?: string; id?: string } = {}): Promise<string> {
    if (!ACTIONS_HORS_LIGNE.includes(nom)) throw new Error('Action non admise hors ligne : refaites-la une fois connecté');
    if ((o.pieces?.length ?? 0) > 10) throw new Error('10 pièces au plus par saisie');
    // `id` (étape 2) : clé d'idempotence déjà portée par l'envoi en ligne interrompu (même saisie, même clé : jamais deux fois).
    if (o.id !== undefined && !FORME_CLE_IDEMPOTENCE.test(o.id)) throw new Error('Clé d’idempotence invalide');
    const id = o.id ?? crypto.randomUUID();
    const pieces: Contenu['pieces'] = [];
    for (const p of o.pieces ?? []) {
      const cle = crypto.randomUUID();
      await this.magasin.ecrire(PIECE + cle, await this.chiffrer(p.octets));
      pieces.push({ cle, nom: p.nom, type: p.type, jeton: null });
    }
    const rang = Math.max(this.maintenant().getTime(), this.rang + 1);
    this.rang = rang;
    await this.garder({ id, rang, compteId: qui.compteId, espace: qui.espace, creeLe: this.maintenant().toISOString(), etat: 'attente', tentatives: 0 },
      { nom, payload, motif: null, pieces, champPieces: o.champPieces ?? 'pieces' });
    return id;
  }

  /** Saisies du compte dans cet espace, dans l'ordre de saisie. */
  async lister(qui: Porteur): Promise<EntreeFile[]> {
    const out: EntreeFile[] = [];
    for (const s of await this.stockees()) {
      if (s.compteId !== qui.compteId || s.espace !== qui.espace) continue;
      const c = await this.contenu(s);
      out.push({ id: s.id, nom: c.nom, payload: c.payload, creeLe: s.creeLe, etat: s.etat, motif: c.motif, tentatives: s.tentatives, pieces: c.pieces.length });
    }
    return out;
  }

  /**
   * Toutes les saisies de l'appareil, sans session (page « Hors ligne » d'une ouverture sans réseau : la session n'est
   * pas connue). La file ne garde que celles du dernier compte connecté : un autre compte la purge à sa connexion.
   */
  async listerTout(): Promise<(EntreeFile & Porteur)[]> {
    const out: (EntreeFile & Porteur)[] = [];
    for (const s of await this.stockees()) {
      const c = await this.contenu(s);
      out.push({ id: s.id, compteId: s.compteId, espace: s.espace, nom: c.nom, payload: c.payload, creeLe: s.creeLe, etat: s.etat, motif: c.motif, tentatives: s.tentatives, pieces: c.pieces.length });
    }
    return out;
  }

  /** Nombre de saisies en file, tous comptes confondus (alerte avant la déconnexion). */
  async taille(): Promise<number> { return (await this.stockees()).length; }

  /** Retire une saisie (et ses pièces) de la file : abandonnée par la personne, ou envoyée. */
  async abandonner(id: string): Promise<void> {
    const s = await this.magasin.lire(ENTREE + id) as Stockee | undefined;
    if (!s) return;
    for (const p of (await this.contenu(s)).pieces) await this.magasin.effacer(PIECE + p.cle);
    await this.magasin.effacer(ENTREE + id);
  }

  /**
   * Remet une saisie « À reprendre » en attente (renvoyée au prochain rejeu). Ses pièces encore gardées sur l'appareil
   * seront renvoyées : le refus peut venir d'un jeton expiré ou déjà consommé, qu'il ne sert à rien de présenter de nouveau.
   */
  async reprendre(id: string): Promise<void> {
    const s = await this.magasin.lire(ENTREE + id) as Stockee | undefined;
    if (!s || s.etat !== 'a_reprendre') return;
    const c = await this.contenu(s);
    await this.oublierJetons(c, () => true);
    await this.garder({ ...s, etat: 'attente' }, { ...c, motif: null });
  }

  /**
   * Abandonne le jeton des pièces choisies dont le contenu est encore sur l'appareil, avec une nouvelle clé d'envoi (la
   * précédente rendrait la réponse gardée, ou 410). Renvoie vrai si au moins une a changé.
   */
  private async oublierJetons(c: Contenu, choisir: (p: Contenu['pieces'][number]) => boolean): Promise<boolean> {
    let change = false;
    for (const p of c.pieces) {
      if (!p.jeton || !choisir(p) || !(await this.magasin.lire(PIECE + p.cle))) continue;
      Object.assign(p, { jeton: null, envoiLe: null, cleEnvoi: crypto.randomUUID() });
      change = true;
    }
    return change;
  }

  /** Purge complète (clé comprise) : déconnexion, appareil partagé. */
  async purger(): Promise<void> { await this.magasin.vider(); }

  /** Session d'un autre compte : tout ce qui appartient à un autre compte est effacé (purge complète). Vrai si purgée. */
  async purgerAutreCompte(compteId: number): Promise<boolean> {
    if (!(await this.stockees()).some(s => s.compteId !== compteId)) return false;
    await this.purger();
    return true;
  }

  /** Saisies de plus de 7 jours effacées ; file vide : clé effacée aussi. Renvoie le nombre de saisies effacées. */
  async purgerAnciennes(): Promise<number> {
    const limite = this.maintenant().getTime() - CONSERVATION_FILE_JOURS * 86_400_000;
    const toutes = await this.stockees();
    const anciennes = toutes.filter(s => Date.parse(s.creeLe) < limite);
    for (const s of anciennes) await this.abandonner(s.id);
    if (anciennes.length === toutes.length) await this.purger();
    return anciennes.length;
  }

  /**
   * Envoie les saisies en attente du compte et de l'espace, une à une ; relit l'instantané une fois à la fin si au moins
   * une est partie (`relire`). Un seul rejeu à la fois : un second appel pendant le premier rend le même bilan.
   */
  rejouer(qui: Porteur, envoyeur: Envoyeur, relire: () => unknown): Promise<BilanRejeu> {
    this.rejeu ??= this.rejouerTout(qui, envoyeur, relire).finally(() => { this.rejeu = null; });
    return this.rejeu;
  }

  private async rejouerTout(qui: Porteur, envoyeur: Envoyeur, relire: () => unknown): Promise<BilanRejeu> {
    const bilan: BilanRejeu = { envoyees: 0, aReprendre: 0, restantes: 0, arret: null };
    const file = (await this.stockees()).filter(s => s.compteId === qui.compteId && s.espace === qui.espace && s.etat === 'attente');
    let premier = true;
    for (const [i, s] of file.entries()) {
      if (!premier) await this.pause(PAUSE_REJEU_MS);
      premier = false;
      const c = await this.contenu(s);
      const issue = await this.envoyer(s, c, envoyeur);
      if (issue === 'envoyee') { bilan.envoyees++; continue; }
      if (issue === 'a_reprendre') { bilan.aReprendre++; continue; }
      await this.garder({ ...s, tentatives: s.tentatives + 1 }, c);
      bilan.arret = issue;
      bilan.restantes = file.length - i;
      break;
    }
    if (bilan.envoyees) await relire();
    return bilan;
  }

  /** Une saisie : ses pièces (jetons gardés au fur et à mesure), puis l'action. */
  private async envoyer(s: Stockee, c: Contenu, envoyeur: Envoyeur): Promise<'envoyee' | 'a_reprendre' | NonNullable<BilanRejeu['arret']>> {
    const aReprendre = async (motif: string) => { await this.garder({ ...s, etat: 'a_reprendre' }, { ...c, motif }); return 'a_reprendre' as const; };
    // Jeton de plus de 23 h (rejeu après une longue coupure) : la pièce est renvoyée plutôt que de faire échouer l'action.
    const limite = this.maintenant().getTime() - JETON_PERIME_MS;
    if (await this.oublierJetons(c, p => !p.envoiLe || Date.parse(p.envoiLe) < limite)) await this.garder(s, c);
    if (c.pieces.filter(p => !p.jeton).length > MAX_PIECES_EN_ATTENTE) return 'pieces';
    for (const p of c.pieces) {
      if (p.jeton) continue;
      const chiffre = await this.magasin.lire(PIECE + p.cle) as Chiffre | undefined;
      if (!chiffre) return await aReprendre('Pièce introuvable sur cet appareil : refaites la saisie');
      try {
        p.jeton = (await envoyeur.piece({ nom: p.nom, type: p.type, octets: await this.dechiffrer(chiffre) }, p.cleEnvoi ?? p.cle)).jeton;
        p.envoiLe = this.maintenant().toISOString();
      } catch (err) {
        const status = (err as { status?: number }).status;
        const arret = arretDe(status);
        if (arret) return arret;
        return await aReprendre((err as Error).message);
      }
      // Jeton gardé : un rejeu interrompu ne renvoie pas la pièce (la clé d'idempotence la rendrait de toute façon).
      await this.garder(s, c);
    }
    const payload = c.pieces.length ? { ...c.payload, [c.champPieces]: c.pieces.map(p => p.jeton) } : c.payload;
    const r = await envoyeur.action(c.nom, payload, s.id);
    if (r.ok) {
      await this.abandonner(s.id);
      return 'envoyee';
    }
    return arretDe(r.status) ?? await aReprendre(r.error || 'Saisie refusée par le serveur');
  }
}

/** Envoi par l'API de Cursus, dans l'espace de la file : en-têtes d'idempotence et de rejeu hors ligne (client/src/api.ts). */
export function envoyeurApi(espace: Role): Envoyeur {
  return {
    action: async (nom, payload, cle) => await api.action(nom, payload, espace, { cle }),
    piece: async (p, cle) => await api.envoyerPiece(new File([p.octets as Uint8Array<ArrayBuffer>], p.nom, { type: p.type }), espace, cle),
  };
}
