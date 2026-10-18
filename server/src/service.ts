// Cycle de vie du serveur, pour le service informatique (journalctl -u cursus) : écoute du port, avec un refus clair et
// le code de sortie 1 si le port est pris (systemd le voit, Restart=on-failure le relance) ; arrêt ordonné sur SIGTERM
// (systemctl stop, docker stop) ou SIGINT (Ctrl+C) : plus de nouvelle connexion, requêtes en cours terminées (10 s au
// plus), tâches de fond arrêtées, base fermée (point de contrôle du journal WAL), verrou retiré, code de sortie 0.
import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Db } from './db.ts';
import { log } from './logs.ts';

/** Délai laissé aux requêtes en cours à l'arrêt ; au-delà, les connexions restantes sont coupées. */
export const DELAI_ARRET = 10_000;

/** Adresse d'écoute telle qu'on la tape dans un navigateur (0.0.0.0 → localhost, IPv6 entre crochets). */
export const hoteAffiche = (hote: string) => hote === '0.0.0.0' ? 'localhost' : hote.includes(':') ? `[${hote}]` : hote;

/** Cause d'un échec d'écoute, en français, avec la variable à corriger. */
export function messageEcoute(err: NodeJS.ErrnoException, port: number, hote: string): string {
  switch (err.code) {
    case 'EADDRINUSE': return `Le port ${port} est déjà utilisé sur ${hote} : arrêtez l’autre service ou changez CURSUS_API_PORT.`;
    case 'EACCES': return `Le port ${port} est réservé sur ${hote} (droits insuffisants) : choisissez un port au-delà de 1023 avec CURSUS_API_PORT.`;
    case 'EADDRNOTAVAIL': return `L’adresse d’écoute ${hote} n’existe pas sur cette machine : corrigez CURSUS_HOST.`;
    default: return `Écoute impossible sur ${hote}, port ${port} (${err.code ?? err.message}).`;
  }
}

const pause = (ms: number) => new Promise(ok => setTimeout(ok, ms));

/**
 * Arrêt du serveur, installé dès le verrou de la base posé : un signal reçu pendant le démarrage (migrations) attend la
 * fin des étapes de démarrage (`demarrer`), puis arrête proprement ce qui a été lancé. Les étapes s'inscrivent au fil du démarrage :
 * base (`base`), tâches de fond (`tache` : fonction d'arrêt), traitements à laisser finir (`attendre`), serveur HTTP
 * (`ecouter`). Le verrou est retiré en dernier, base fermée : npm run restore ne voit jamais une base encore ouverte.
 */
export class Arret {
  private db: Db | null = null;
  private serveur: Server | null = null;
  private readonly taches: (() => void)[] = [];
  private readonly enCours: (() => boolean)[] = [];
  private demande = false;
  private demarrage: Promise<void> = Promise.resolve();
  private readonly retirerVerrou: () => void;
  private readonly delai: number;

  constructor(retirerVerrou: () => void, delai = DELAI_ARRET) {
    this.retirerVerrou = retirerVerrou;
    this.delai = delai;
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { void this.signal(sig); });
  }

  base(db: Db) { this.db = db; }
  /**
   * Démarrage en cours (migrations, chargement de la démonstration… désormais asynchrones) : un signal reçu entre-temps
   * attend sa fin, comme il attendait la fin des étapes synchrones d'avant. Renvoie la fonction qui le déclare terminé.
   */
  demarrer(): () => void {
    let fin!: () => void;
    this.demarrage = new Promise<void>(ok => { fin = ok; });
    return fin;
  }
  /** Tâche de fond (minuteur) : sa fonction d'arrêt est appelée dès le signal. */
  tache(arreter: () => void) { this.taches.push(arreter); }
  /** Traitement asynchrone (envoi à Keystone, e-mail) : attendu jusqu'au délai, pour que son issue soit enregistrée. */
  attendre(enCours: () => boolean) { this.enCours.push(enCours); }

  /**
   * Écoute le port ; `pret` n'est appelé qu'une fois le port obtenu (annonce du démarrage, tâches de fond). Port pris,
   * réservé ou adresse inconnue : message en français, base fermée, verrou retiré, code de sortie 1.
   */
  ecouter(app: Express, port: number, hote: string, pret: (serveur: Server) => void): Server {
    const serveur = app.listen(port, hote, err => {
      if (err) return this.echec(messageEcoute(err as NodeJS.ErrnoException, port, hote));
      if (this.demande) return; // arrêt demandé pendant le démarrage : rien n'est lancé
      pret(serveur);
    });
    this.serveur = serveur;
    return serveur;
  }

  /** Démarrage impossible : base fermée, verrou retiré, code de sortie 1 (le message est la cause, pour journalctl). */
  echec(message: string): never {
    log.erreur(`Démarrage impossible : ${message}`);
    // Rien n'est en cours sur la base à ce moment (étape de démarrage refusée) : elle est fermée aussitôt.
    void this.fermerBase();
    this.retirerVerrou();
    process.exit(1);
  }

  /** Ferme la base : aussitôt si rien n'est en cours, sinon après la transaction en cours (server/src/db.ts). */
  private async fermerBase() {
    try {
      await this.db?.fermer();
    } catch (err) {
      log.erreur(`Fermeture de la base : ${err instanceof Error ? err.message : err}`);
    }
  }

  private async signal(sig: NodeJS.Signals) {
    if (this.demande) {
      // Second signal (Ctrl+C répété) : les requêtes encore en cours sont coupées, l'arrêt ordonné se poursuit.
      log.info('Arrêt immédiat : connexions en cours coupées.');
      this.serveur?.closeAllConnections();
      return;
    }
    this.demande = true;
    const limite = Date.now() + this.delai;
    log.info(`Arrêt demandé (${sig}) : fin des requêtes en cours, ${this.delai / 1000} s au plus.`);
    await this.demarrage;
    for (const t of this.taches) {
      try { t(); } catch { /* minuteur déjà arrêté */ }
    }
    const serveur = this.serveur;
    if (serveur?.listening) {
      // Plus aucune connexion acceptée ; les connexions inactives (keep-alive) sont fermées aussitôt par Node.
      const ferme = new Promise<void>(ok => serveur.close(() => ok()));
      const relance = setInterval(() => serveur.closeIdleConnections(), 100); // connexions libérées par une réponse
      const delai = new Promise<boolean>(ok => setTimeout(() => ok(true), Math.max(0, limite - Date.now())));
      if (await Promise.race([ferme.then(() => false), delai])) {
        log.info(`Requêtes encore en cours après ${this.delai / 1000} s : connexions coupées.`);
        serveur.closeAllConnections();
      }
      clearInterval(relance);
    }
    // Envoi en cours (Keystone, e-mail) : son issue est enregistrée avant la fermeture de la base, sinon il repart au
    // prochain démarrage avec la même clé d'idempotence.
    while (this.enCours.some(f => f()) && Date.now() < limite) await pause(50);
    await this.fermerBase();
    this.retirerVerrou();
    log.info('Cursus arrêté.');
    process.exit(0);
  }
}
