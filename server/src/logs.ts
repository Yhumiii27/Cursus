// Journaux du serveur pour le service informatique (docker logs, journal de Coolify, journalctl -u cursus), distincts
// du journal des actions (server/src/journal.ts, dans la base). Deux formats (CURSUS_LOG_FORMAT, server/src/config.ts) :
// `json` par défaut en production, une ligne JSON par message, que l'agrégateur de Coolify ou du service informatique
// lit sans réglage ; `texte` ailleurs, lisible à l'œil. Une ligne par requête HTTP : heure, méthode, chemin sans ses
// paramètres, statut, durée et compte connecté. Jamais le corps ni les paramètres de la requête : ils portent des
// données personnelles (noms, dates d'absence, motifs).
import type { NextFunction, Request, Response } from 'express';
import { format as formater } from 'node:util';
import { formatJournaux } from './config.ts';

export type Niveau = 'info' | 'avertissement' | 'erreur';
/** Champs ajoutés à la ligne JSON (le format texte n'en garde que `pile`, sous le message). */
export type Champs = Record<string, string | number | boolean | null | undefined>;
/** Destination des lignes : sortie standard pour `info`, sortie d'erreur sinon (remplacée dans les tests). */
export type Sortie = (ligne: string, niveau: Niveau) => void;

const SORTIE_STANDARD: Sortie = (ligne, niveau) => { (niveau === 'info' ? process.stdout : process.stderr).write(ligne + '\n'); };

let format = formatJournaux();
let sortie = SORTIE_STANDARD;

/** Change le format ou la destination (tests) ; renvoie la fonction qui rétablit les précédents. */
export function reglerJournaux(o: { format?: 'json' | 'texte'; sortie?: Sortie }): () => void {
  const avant = { format, sortie };
  if (o.format) format = o.format;
  if (o.sortie) sortie = o.sortie;
  return () => { format = avant.format; sortie = avant.sortie; };
}

/** Écrit un message : une ligne JSON (heure, niveau, message, champs), ou le message seul, suivi de la pile éventuelle. */
export function ecrire(niveau: Niveau, message: string, champs: Champs = {}) {
  if (format === 'json') return sortie(JSON.stringify({ heure: new Date().toISOString(), niveau, message, ...champs }), niveau);
  sortie(champs.pile ? `${message}\n${champs.pile}` : message, niveau);
}

export const log = {
  info: (message: string, champs?: Champs) => ecrire('info', message, champs),
  avertissement: (message: string, champs?: Champs) => ecrire('avertissement', message, champs),
  erreur: (message: string, champs?: Champs) => ecrire('erreur', message, champs),
};

/**
 * Format JSON : les messages écrits par console.log, console.warn et console.error dans le reste du serveur (file
 * d'envoi, e-mails, Keystone…) passent aussi par une ligne JSON, avec leur niveau. Sans effet en format texte.
 * Installé au démarrage par server/src/index.ts ; renvoie la fonction qui rétablit la console.
 */
export function redirigerConsole(): () => void {
  if (format !== 'json') return () => {};
  const avant = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  console.log = console.info = console.debug = (...a: unknown[]) => ecrire('info', formater(...a));
  console.warn = (...a: unknown[]) => ecrire('avertissement', formater(...a));
  console.error = (...a: unknown[]) => ecrire('erreur', formater(...a));
  return () => Object.assign(console, avant);
}

// — Une ligne par requête —

/** Compte connecté de chaque requête, noté par la lecture de la session (server/src/auth.ts, readSession). */
const COMPTES = new WeakMap<Request, number>();
export function noterCompte(req: Request, compteId: number | null | undefined) {
  if (compteId != null) COMPTES.set(req, compteId);
}

/** Chemin sans paramètres de requête, réduit aux caractères imprimables (aucune ligne forgée), 200 caractères au plus. */
export function cheminJournal(url: string): string {
  return url.split('?')[0].replace(/[^\x21-\x7e]/g, '?').slice(0, 200);
}

export interface Requete { methode: string; chemin: string; statut: number; dureeMs: number; compte: number | null; interrompue: boolean }

/** Ligne d'une requête : « GET /api/data → 200 · 12 ms · compte 3 » ; en JSON, les mêmes valeurs en champs. */
export function ecrireRequete(r: Requete) {
  const message = `${r.methode} ${r.chemin} → ${r.statut} · ${r.dureeMs} ms${r.compte != null ? ` · compte ${r.compte}` : ''}${r.interrompue ? ' · interrompue' : ''}`;
  ecrire(r.statut >= 500 ? 'erreur' : 'info', message, {
    type: 'requete', methode: r.methode, chemin: r.chemin, statut: r.statut, duree_ms: r.dureeMs, compte: r.compte,
    interrompue: r.interrompue || undefined,
  });
}

/**
 * Journal des requêtes, monté en premier : la ligne est écrite à la fin de la réponse (ou à la coupure de la connexion,
 * marquée « interrompue »). La sonde de santé réussie (HEALTHCHECK toutes les 30 s, supervision) n'est pas écrite.
 */
export function journalRequetes() {
  return (req: Request, res: Response, next: NextFunction) => {
    const debut = process.hrtime.bigint();
    res.once('close', () => {
      const chemin = cheminJournal(req.originalUrl ?? req.url);
      if (chemin === '/api/health' && res.statusCode < 400) return;
      ecrireRequete({
        methode: req.method, chemin, statut: res.statusCode, dureeMs: Math.round(Number(process.hrtime.bigint() - debut) / 1e6),
        compte: COMPTES.get(req) ?? null, interrompue: !res.writableFinished,
      });
    });
    next();
  };
}
