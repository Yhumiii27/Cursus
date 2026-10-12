// Messagerie : adresses du service RH, du service de santé au travail et des agences d'intérim, e-mail d'essai
// (administrateur RH) ; récapitulatif quotidien envoyé sans attendre et relevés d'heures des intérimaires (RH) ;
// réglage des notifications de chacun (la personne, ou le service RH).
import { MODE_NOTIFICATION_LABEL } from '../../../shared/constants.ts';
import { isValidDate, isoWeek, mondayOf, parse } from '../../../shared/dates.ts';
import { fmt, key, plural } from '../../../shared/format.ts';
import { controleAdresse, normaliserAdresse } from '../../../shared/rules/messagerie.ts';
import { heuresTexte } from '../../../shared/rules/releves.ts';
import type { Messagerie, ModeNotification } from '../../../shared/types.ts';
import { configMail } from '../config.ts';
import { envoyerEmail } from '../integrations/email.ts';
import { courriel, lireMessagerie } from '../messagerie.ts';
import { envoyerRecapitulatifs, recapitulatifEnAttente } from '../notifications.ts';
import { envoyerReleve } from '../releves.ts';
import { ActionError, getEmp, isRh, isSelf, requireRh, requireRhAdmin, str, type ActionHandler } from './context.ts';

const mode = (v: unknown): ModeNotification => {
  if (v !== 'immediat' && v !== 'quotidien') throw new ActionError('Réglage inconnu : aussitôt ou récapitulatif quotidien');
  return v;
};

/** Adresse saisie, normalisée et contrôlée (vide : aucune). */
function adresse(v: unknown, libelle: string): string | null {
  const a = normaliserAdresse(v);
  const err = controleAdresse(a, libelle);
  if (err) throw new ActionError(err);
  return a;
}

/** Adresses du service RH (et réglage de ses notifications), du service de santé au travail, des agences d'intérim. */
const regler: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const next: Messagerie = { ...lireMessagerie(ctx.db) };
  if (p.rh !== undefined) next.rh = adresse(p.rh, 'Adresse du service RH');
  if (p.rhMode !== undefined) next.rhMode = mode(p.rhMode);
  if (p.santeTravail !== undefined) next.santeTravail = adresse(p.santeTravail, 'Adresse du service de santé au travail');
  if (p.agences !== undefined) {
    if (!Array.isArray(p.agences)) throw new ActionError('Liste des agences invalide');
    const agences: Messagerie['agences'] = [];
    for (const x of p.agences as { nom?: unknown; adresse?: unknown }[]) {
      const nom = str(x?.nom), a = adresse(x?.adresse, `Adresse de l’agence ${nom}`);
      if (!nom || !a) continue; // agence sans adresse : retirée
      if (agences.some(y => key(y.nom) === key(nom))) throw new ActionError(`Agence en double : ${nom}`);
      // Date où l'adresse a été renseignée, gardée quand elle change : l'envoi automatique des relevés ne remonte pas avant.
      const avant = next.agences.find(y => key(y.nom) === key(nom));
      agences.push({ nom, adresse: a, depuis: avant ? avant.depuis ?? null : ctx.d.ti });
    }
    next.agences = agences;
  }
  ctx.db.setSetting('messagerie', next);
  return 'Adresses de la messagerie enregistrées';
};

/** E-mail d'essai (mise en service par le service informatique) : suivi dans Paramètres → Envois. */
const essai: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const a = adresse(p.adresse, 'Adresse');
  if (!a) throw new ActionError('Adresse du destinataire requise');
  const cfg = configMail();
  envoyerEmail(ctx.db, 'essai', courriel(lireMessagerie(ctx.db), a, 'Cursus — e-mail d’essai',
    `Cet e-mail d’essai a été demandé par ${ctx.user.nom} depuis Cursus (Paramètres → Messagerie) le ${fmt(parse(ctx.d.ti))}. `
    + `Sa réception confirme que Cursus peut envoyer des e-mails${cfg ? ` depuis ${cfg.from}` : ''}.`));
  return cfg
    ? `E-mail d’essai mis en file pour ${a} — suivi dans Envois`
    : `E-mail d’essai simulé pour ${a} (envoi non configuré : CURSUS_MAIL_FROM) — visible dans Envois`;
};

/** Récapitulatifs des notifications en attente, envoyés sans attendre l'heure du récapitulatif quotidien. */
const recapituler: ActionHandler = (ctx) => {
  requireRh(ctx);
  if (!recapitulatifEnAttente(ctx.db)) throw new ActionError('Aucune notification en attente du récapitulatif');
  const n = envoyerRecapitulatifs(ctx.db);
  if (!n) return 'Aucun récapitulatif envoyé — destinataires sans adresse e-mail ou sortis de l’entreprise : notifications closes';
  return `${plural(n, 'récapitulatif envoyé', 'récapitulatifs envoyés')} — notifications en attente transmises`;
};

/** Notifications d'étapes d'un salarié : aussitôt, ou récapitulatif quotidien. La personne elle-même, ou le service RH. */
const reglerNotifications: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId ?? ctx.user.empId);
  if (!isRh(ctx) && !isSelf(ctx, emp.id)) throw new ActionError('Réglage réservé à la personne elle-même ou au service RH', 403);
  const m = mode(p.mode);
  ctx.db.update('employes', emp.id, { notifications: m });
  const quoi = isSelf(ctx, emp.id) ? 'Vos notifications par e-mail' : `Notifications par e-mail de ${emp.nom}`;
  return `${quoi} : ${MODE_NOTIFICATION_LABEL[m].toLowerCase()}${emp.email ? '' : ' · aucune adresse e-mail sur la fiche'}`;
};

/** Relevé d'heures d'une agence pour une semaine : envoi (feuilles encore en attente comprises) ou renvoi. */
const envoyerReleveAction: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const agence = str(p.agence), semaine = str(p.semaine);
  if (!agence) throw new ActionError('Agence requise');
  if (!isValidDate(semaine) || mondayOf(semaine) !== semaine) throw new ActionError('Semaine invalide');
  if (semaine > mondayOf(ctx.d.ti)) throw new ActionError('Semaine à venir : aucun relevé à envoyer');
  const deja = ctx.ds.releves.some(r => key(r.agence) === key(agence) && r.semaine === semaine);
  const x = envoyerReleve(ctx.db, ctx.d, agence, semaine, ctx.user.nom, lireMessagerie(ctx.db));
  if (typeof x === 'string') throw new ActionError(x);
  const attente = x.r.enAttente.length ? ` · feuille non validée : ${x.r.enAttente.map(e => e.nom).join(', ')}` : '';
  return `Relevé de la semaine ${isoWeek(semaine)} ${deja ? 'renvoyé' : 'envoyé'} à ${agence} (${x.releve.adresse}) — `
    + `${plural(x.r.lignes.length, 'intérimaire', 'intérimaires')}, ${heuresTexte(x.r.heures)} h${attente}`;
};

export const messagerieActions: Record<string, ActionHandler> = {
  'messagerie.regler': regler,
  'messagerie.essai': essai,
  'messagerie.recapituler': recapituler,
  'notification.regler': reglerNotifications,
  'releve.envoyer': envoyerReleveAction,
};
