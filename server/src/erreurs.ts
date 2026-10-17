// Réponses d'erreur de l'API, toujours en JSON ({ error }) et sans pile d'appels : montées après toutes les routes
// (server/src/app.ts). Sans elles, Express répondait en HTML (« Cannot GET », pile d'appels hors production) à une
// adresse /api inconnue ou à un corps JSON illisible, ce que l'interface ne sait pas afficher. L'erreur imprévue est
// écrite dans les journaux du serveur (server/src/logs.ts), avec sa pile, jamais dans la réponse.
import type { NextFunction, Request, Response } from 'express';
import { cheminJournal, log } from './logs.ts';

/** Taille maximale d'un corps JSON (express.json) ; au-delà, 413. */
export const LIMITE_CORPS = '2mb';

export const ADRESSE_INCONNUE = 'Adresse inconnue de l’API';
export const JSON_ILLISIBLE = 'Corps de requête illisible : JSON attendu.';
export const CORPS_TROP_VOLUMINEUX = 'Requête trop volumineuse : 2 Mo au plus.';
export const ERREUR_INTERNE = 'Erreur interne';

/** Erreur imprévue : écrite dans les journaux du serveur avec la requête (méthode, chemin) et la pile. */
export function signalerErreur(req: Request, err: unknown) {
  log.erreur(`Erreur interne : ${req.method} ${cheminJournal(req.originalUrl ?? req.url)}`, {
    pile: err instanceof Error ? err.stack ?? err.message : String(err),
  });
}

/** Adresse /api sans route : 404 JSON (le reste du site renvoie l'interface, server/src/app.ts). */
export function apiInconnue() {
  return (_req: Request, res: Response) => { res.status(404).json({ error: ADRESSE_INCONNUE }); };
}

/**
 * Gestionnaire final : JSON illisible → 400, corps au-delà de 2 Mo → 413, autre refus de l'analyse du corps ou de
 * l'envoi d'un fichier (encodage inconnu, adresse mal formée…) → son statut 4xx, sinon 500 « Erreur interne ».
 * Réponse déjà commencée : Express coupe la connexion (la ligne de la requête est marquée « interrompue »).
 */
export function gestionnaireErreurs() {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = (err ?? {}) as { type?: string; status?: number; statusCode?: number };
    const statut = e.status ?? e.statusCode;
    if (e.type === 'entity.parse.failed') return res.status(400).json({ error: JSON_ILLISIBLE });
    if (e.type === 'entity.too.large') return res.status(413).json({ error: CORPS_TROP_VOLUMINEUX });
    if (typeof statut === 'number' && statut >= 400 && statut < 500) return res.status(statut).json({ error: statut === 404 ? 'Introuvable' : 'Requête refusée' });
    signalerErreur(req, err);
    res.status(500).json({ error: ERREUR_INTERNE });
  };
}
