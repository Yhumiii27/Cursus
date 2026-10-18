// File d'envoi des messages sortants : relance ou classement d'un envoi en échec (vue « Envois » des paramètres).
import { classerEnvoi, relancerEnvoi, type Cible, type Envoi } from '../envois.ts';
import { configMail } from '../config.ts';
import { keystoneSortant } from '../integrations/keystone.ts';
import { ActionError, requireRh, type ActionHandler } from './context.ts';

const NOM_CIBLE: Record<Cible, string> = { keystone: 'Keystone', email: 'la messagerie Microsoft 365' };

/** Cible dont l'adresse est configurée (Sage Paie ne passe pas par la file : fichier d'import). */
const configuree = (c: Cible) => (c === 'keystone' && !!keystoneSortant()) || (c === 'email' && !!configMail());

/** Nouvelle série de tentatives pour un envoi en échec, avec la même clé d'idempotence (RH). */
const relancer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const e = await ctx.db.get<Envoi>('envois', Number(p.id));
  if (!e) throw new ActionError('Envoi introuvable', 404);
  if (e.statut !== 'echec') throw new ActionError('Seul un envoi en échec peut être relancé');
  if (!configuree(e.cible)) throw new ActionError(`Envoi vers ${NOM_CIBLE[e.cible]} non configuré : relance impossible`);
  await relancerEnvoi(ctx.db, e);
  return `Envoi ${e.type} relancé vers ${NOM_CIBLE[e.cible]} — nouvelle tentative dans quelques secondes`;
};

/**
 * Classe un envoi en échec examiné par le RH (refus définitif que la relance ne corrige pas) : il reste
 * dans la liste, mais l'état de l'intégration ne le compte plus. Une relance le remet en cours.
 */
const classer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const e = await ctx.db.get<Envoi>('envois', Number(p.id));
  if (!e) throw new ActionError('Envoi introuvable', 404);
  if (e.statut !== 'echec') throw new ActionError('Seul un envoi en échec peut être classé');
  if (e.classe) throw new ActionError('Envoi déjà classé');
  await classerEnvoi(ctx.db, e);
  return `Échec de l’envoi ${e.type} classé — il ne compte plus parmi les échecs en cours`;
};

export const envoisActions: Record<string, ActionHandler> = {
  'envoi.relancer': relancer,
  'envoi.classer': classer,
};
