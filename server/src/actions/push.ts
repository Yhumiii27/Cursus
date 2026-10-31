// Notifications sur le téléphone (lot 11, chantier C2, t196 ; server/src/push.ts). Chaque compte gère ses seuls
// appareils, depuis n'importe quel espace ; aucun abonnement ne se lit par équipe (un manager ne voit pas les appareils de
// son équipe). Jamais d'adresse de service de push ni de clé au journal ni dans un message.
//   push.abonner             endpoint, p256dh, auth, systeme, navigateur : abonne l'appareil (préférences du compte,
//                            toutes coupées pour un premier appareil) ; libellé d'appareil déduit des codes, jamais saisi
//   push.desabonner          endpoint, motif ('utilisateur' | 'deconnexion') : désabonne cet appareil (bouton, déconnexion)
//   push.preferences         types : types de notification reçus par tous les appareils du compte (shared/notifications-push.ts)
//   push.desabonnerAppareil  id : retire un de ses appareils (Mes appareils) ; tout : tous les abonnements de tous les
//                            comptes (administrateur RH : fuite, changement de clé)
//   push.tester              — : notification d'essai à tous ses appareils, aussitôt (plage de silence ignorée)
import { libelleAppareil, typesValides } from '../../../shared/notifications-push.ts';
import { plural } from '../../../shared/format.ts';
import { deB64u, endpointAdmis } from '../integrations/push.ts';
import { type AbonnementPush, cleEndpoint, clesPush, enregistrerAbonnement, mettreEnFilePush, PUSH_DESACTIVE, supprimerAbonnements } from '../push.ts';
import { ActionError, type ActionHandler, type Ctx, requireRhAdmin } from './context.ts';

/** Compte connecté (les lectures internes n'en ont pas : refus). */
function compteDe(ctx: Ctx): number {
  if (ctx.user.compteId == null) throw new ActionError('Compte de connexion requis', 403);
  return ctx.user.compteId;
}

/** Clé du navigateur en base64url, de la longueur attendue (65 octets pour p256dh, 16 pour auth). */
function cleNavigateur(v: unknown, octets: number, quoi: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s) || deB64u(s).length !== octets) throw new ActionError(`${quoi} invalide`);
  return s.replace(/=+$/, '');
}

const abonner: ActionHandler = async (ctx, p) => {
  const compteId = compteDe(ctx);
  if (!clesPush()) throw new ActionError(PUSH_DESACTIVE, 409);
  if (!endpointAdmis(p.endpoint)) throw new ActionError('Adresse de notification refusée : service de push inconnu');
  const navigateur = { endpoint: p.endpoint, p256dh: cleNavigateur(p.p256dh, 65, 'Clé de chiffrement'), auth: cleNavigateur(p.auth, 16, 'Secret d’authentification') };
  if (deB64u(navigateur.p256dh)[0] !== 4) throw new ActionError('Clé de chiffrement invalide');
  const appareil = libelleAppareil(p.systeme, p.navigateur);
  const { id, nouveau } = await enregistrerAbonnement(ctx.db, { compteId, navigateur, appareil });
  return { message: nouveau ? `Notifications activées sur cet appareil (${appareil}) : choisissez celles que vous recevez` : 'Notifications déjà activées sur cet appareil', result: { id, appareil } };
};

const MOTIFS = ['utilisateur', 'deconnexion'] as const;

const desabonner: ActionHandler = async (ctx, p) => {
  const compteId = compteDe(ctx);
  if (!MOTIFS.includes(p.motif)) throw new ActionError('Motif invalide');
  const a = typeof p.endpoint === 'string' ? (await ctx.db.where<AbonnementPush>('abonnementsPush', 'cleEndpoint', cleEndpoint(p.endpoint)))[0] : undefined;
  // Appareil d'un autre compte : même réponse qu'un appareil inconnu (rien ne dit qu'il existe).
  if (!a || a.compteId !== compteId) return { message: 'Aucune notification active sur cet appareil', result: { retires: 0 } };
  await supprimerAbonnements(ctx.db, [a.id]);
  return { message: 'Notifications désactivées sur cet appareil', result: { retires: 1, appareil: a.appareil } };
};

const preferences: ActionHandler = async (ctx, p) => {
  const compteId = compteDe(ctx);
  if (!Array.isArray(p.types)) throw new ActionError('Préférences invalides');
  const types = typesValides(p.types);
  const n = Number((await ctx.db.run(`UPDATE abonnements_push SET types = ? WHERE compte_id = ?`, [JSON.stringify(types), compteId])).changes);
  if (!n) throw new ActionError('Aucun appareil abonné : activez d’abord les notifications sur cet appareil', 409);
  return { message: types.length ? `${plural(types.length, 'notification choisie', 'notifications choisies')} sur vos appareils` : 'Notifications coupées sur vos appareils', result: { types } };
};

const desabonnerAppareil: ActionHandler = async (ctx, p) => {
  if (p.tout === true) {
    requireRhAdmin(ctx);
    const ids = (await ctx.db.query<{ id: number }>('SELECT id FROM abonnements_push')).map(r => Number(r.id));
    const n = await supprimerAbonnements(ctx.db, ids);
    return { message: n ? `${plural(n, 'appareil désabonné', 'appareils désabonnés')} : chacun réactive les notifications depuis l’application` : 'Aucun appareil abonné', result: { retires: n } };
  }
  const compteId = compteDe(ctx);
  const a = await ctx.db.get<AbonnementPush>('abonnementsPush', Number(p.id));
  if (!a || a.compteId !== compteId) throw new ActionError('Appareil introuvable', 404);
  await supprimerAbonnements(ctx.db, [a.id]);
  return { message: `Appareil retiré (${a.appareil ?? 'appareil'}) : il ne reçoit plus de notification`, result: { retires: 1, appareil: a.appareil } };
};

const tester: ActionHandler = async (ctx) => {
  const compteId = compteDe(ctx);
  if (!clesPush()) throw new ActionError(PUSH_DESACTIVE, 409);
  const n = await mettreEnFilePush(ctx.db, { compteId }, 'push.essai', { force: true });
  if (!n) throw new ActionError('Aucun appareil abonné : activez d’abord les notifications sur cet appareil', 409);
  return { message: `Notification d’essai envoyée à ${plural(n, 'appareil', 'appareils')}`, result: { appareils: n } };
};

export const pushActions = {
  'push.abonner': abonner,
  'push.desabonner': desabonner,
  'push.preferences': preferences,
  'push.desabonnerAppareil': desabonnerAppareil,
  'push.tester': tester,
} satisfies Record<string, ActionHandler>;
