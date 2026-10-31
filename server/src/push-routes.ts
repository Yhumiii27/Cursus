// Notifications sur le téléphone (lot 11, chantier C2, t196) : lectures propres au compte connecté, hors de l'instantané
// (les abonnements sont dans TABLES_SANS_REVISION, jamais lus par lireTout) et sans en-tête d'espace : un compte gère ses
// appareils depuis n'importe quel espace.
//   GET /api/push/cle        { active, cle } : notifications actives sur le serveur, clé publique VAPID (applicationServerKey)
//   GET /api/push/appareils  appareils abonnés du compte (libellé, empreinte de l'adresse, types choisis, derniers envois),
//                            jamais l'adresse du service de push ni les clés
import express, { type Request, type Response, type Router } from 'express';
import { TYPES_PUSH } from '../../shared/notifications-push.ts';
import { identite } from './connexion.ts';
import type { Db } from './db.ts';
import { appareilsDe, clesPush } from './push.ts';

export function routesPush(db: Db): Router {
  const r = express.Router();
  r.get('/api/push/cle', async (req: Request, res: Response) => {
    if (!await identite(db, req)) return res.status(401).json({ error: 'Connexion requise' });
    const c = clesPush();
    res.json({ active: !!c, cle: c?.publique ?? null, types: TYPES_PUSH });
  });
  r.get('/api/push/appareils', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    res.json({ active: !!clesPush(), appareils: await db.lecture(async () => await appareilsDe(db, id.compte.id), { courte: true }) });
  });
  return r;
}
