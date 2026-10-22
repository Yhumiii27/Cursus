// Limitation du débit des appels à l'API (hors API Keystone, qui a la sienne) : par adresse IP et par compte,
// en plus des limites propres à la connexion (échecs de mot de passe : auth.ts, LimiteParIp). Cursus est
// joignable depuis Internet, smartphones compris (décision de l'entreprise) : sans limite, un seul poste
// pourrait saturer le serveur. Au-delà, réponse 429 avec Retry-After. Mémoire bornée (`maxCles`).
import type { NextFunction, Request, Response } from 'express';
import { plural } from '../../shared/format.ts';
import { compteDeLaRequete } from './auth.ts';
import type { Db } from './db.ts';

/**
 * Seau à jetons par clé (adresse IP, compte) : `capacite` requêtes d'avance, rechargées au rythme de `parMinute`.
 * Une rafale passe tant que le seau n'est pas vide ; ensuite, une requête par intervalle de recharge.
 * Au-delà de `maxCles` clés suivies, les seaux pleins (clés inactives) sont oubliés, puis les moins récemment
 * utilisés : la mémoire reste bornée même face à une multitude d'adresses.
 */
export class LimiteurDebit {
  readonly capacite: number;
  readonly parMinute: number;
  readonly maxCles: number;
  private seaux = new Map<string, { jetons: number; maj: number }>();
  private maintenant: () => number;
  constructor({ capacite, parMinute, maxCles = 10_000 }: { capacite: number; parMinute: number; maxCles?: number }, maintenant = () => Date.now()) {
    this.capacite = capacite; this.parMinute = parMinute; this.maxCles = maxCles; this.maintenant = maintenant;
  }

  private recharge(s: { jetons: number; maj: number }, t: number) {
    return Math.min(this.capacite, s.jetons + (t - s.maj) * this.parMinute / 60_000);
  }

  /** Clés suivies (contrôle de la mémoire). */
  get taille() { return this.seaux.size; }

  /** Compte une requête pour `cle` : 0 si elle passe, sinon l'attente en secondes avant la suivante (Retry-After). */
  prendre(cle: string): number {
    const t = this.maintenant();
    const s = this.seaux.get(cle);
    if (s) this.seaux.delete(cle); // remise en fin de file : la plus récemment utilisée
    else this.liberer(t);
    const seau = s ? { jetons: this.recharge(s, t), maj: t } : { jetons: this.capacite, maj: t };
    this.seaux.set(cle, seau);
    if (seau.jetons >= 1) { seau.jetons -= 1; return 0; }
    return Math.max(1, Math.ceil((1 - seau.jetons) * 60 / this.parMinute));
  }

  /** Place pour une nouvelle clé : seaux pleins oubliés, puis les moins récemment utilisés (jusqu'à 90 % de la limite). */
  private liberer(t: number) {
    if (this.seaux.size < this.maxCles) return;
    for (const [k, s] of this.seaux) if (this.recharge(s, t) >= this.capacite) this.seaux.delete(k);
    for (const k of this.seaux.keys()) {
      if (this.seaux.size < this.maxCles * 0.9) break;
      this.seaux.delete(k);
    }
  }
}

/**
 * Limites retenues. Un atelier entier peut sortir par une seule adresse IP (box, réseau du site) : la limite par
 * adresse est large ; celle par compte vise un poste ou un script qui s'emballe (une saisie, même rapide, reste loin
 * de deux requêtes par seconde en continu). Le retour de la connexion Microsoft appelle Microsoft (échange du code) :
 * limite propre par adresse, assez large pour que tout un site se connecte à la prise de poste.
 */
export const DEBIT = {
  ip: { capacite: 1200, parMinute: 1200 },
  compte: { capacite: 240, parMinute: 120 },
  microsoft: { capacite: 300, parMinute: 120 },
} as const;

/** « 3 secondes », « 2 minutes » : délai d'attente annoncé. */
export const delaiTexte = (s: number) => s < 120 ? plural(s, 'seconde', 'secondes') : plural(Math.ceil(s / 60), 'minute', 'minutes');

/**
 * Réponse 429 : en-tête Retry-After (secondes) et message en français ; JSON pour l'API, texte pour une page
 * ouverte par le navigateur (aller et retour de la connexion Microsoft).
 */
export function tropDeRequetes(req: Request, res: Response, attente: number, quoi = 'Trop de requêtes depuis ce poste') {
  const error = `${quoi} : réessayez dans ${delaiTexte(attente)}.`;
  res.status(429).set('Retry-After', String(attente));
  if (req.method === 'GET' && req.accepts(['json', 'html']) === 'html') return res.type('text/plain; charset=utf-8').send(error);
  res.json({ error });
}

/**
 * Middleware monté sur /api (après l'API Keystone) : par adresse IP pour toute requête, par compte pour une requête
 * qui porte une session ouverte, et par adresse IP pour la connexion Microsoft. `req.ip` suit le reverse proxy de
 * confiance (CURSUS_TRUST_PROXY) : c'est l'adresse du client, non celle du proxy.
 */
export function limiterDebit(db: Db, limites = {
  ip: new LimiteurDebit(DEBIT.ip), compte: new LimiteurDebit(DEBIT.compte), microsoft: new LimiteurDebit(DEBIT.microsoft),
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    let attente = limites.ip.prendre(ip);
    if (!attente && req.path.startsWith('/auth/microsoft')) attente = limites.microsoft.prendre(ip);
    if (!attente) {
      const compte = await compteDeLaRequete(db, req);
      if (compte != null) attente = limites.compte.prendre(String(compte));
    }
    if (!attente) return next();
    tropDeRequetes(req, res, attente);
  };
}
