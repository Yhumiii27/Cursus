// Convocations aux sessions de formation : envoi unitaire ou groupé des convocations « à envoyer » (inscription
// avec « Envoyer plus tard », session redatée ou déplacée), et désinscription, qui libère la place. Chaque envoi
// est daté (`convocLe`) et part par e-mail avec le fichier .ics de la session (server/src/notifications.ts).
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { finSession, sessionDu } from '../../../shared/rules/plage-session.ts';
import { inscritsDe } from '../../../shared/rules/sessions.ts';
import type { Certification, Inscription, Session } from '../../../shared/types.ts';
import { annulerSiConvoque, convoquerFormation } from '../notifications.ts';
import { promouvoirAttente } from '../liste-attente.ts';
import { ActionError, aDroit, getEmp, isManagerOf, type ActionHandler, type Ctx } from './context.ts';

/** Session ouverte et à venir : seule une telle session reçoit des convocations ou perd des inscrits. */
function sessionOuverte(ctx: Ctx, id: unknown, enCours = false): Session {
  const s = ctx.d.session(Number(id));
  if (!s) throw new ActionError('Session introuvable', 404);
  if (!sessionActive(s)) throw new ActionError(`Session ${s.statut === 'Annulée' ? 'annulée' : 'clôturée'}`);
  // Session sur plusieurs jours commencée : plus de désinscription, elle se clôt à partir de son dernier jour ; les
  // convocations (`enCours`) se renvoient encore jusqu'à ce jour-là, après un changement des jours restants.
  if (s.date < ctx.d.ti && !(enCours && finSession(s) >= ctx.d.ti)) {
    const etat = finSession(s) >= ctx.d.ti ? `en cours jusqu’au ${fmt(parse(finSession(s)))}` : 'passée';
    throw new ActionError(`Session du ${fmt(parse(s.date))} ${etat} : ${aDroit(ctx, 'formations') ? 'clôturez-la' : 'le service RH la clôture'} (présence, résultat)`);
  }
  return s;
}

const nomSession = (ctx: Ctx, s: Session) => `session ${ctx.d.fm(s.formation)?.court ?? s.formation} ${sessionDu(s)}`;

/**
 * Envoi des convocations d'une session : celles des inscrits désignés (`empIds`, un renvoi est possible), sinon
 * toutes celles « à envoyer ». Service RH, ou manager pour les membres de son équipe. Un inscrit sans adresse
 * e-mail est noté convoqué : sa convocation est à lui remettre en main propre.
 */
const envoyer: ActionHandler = async (ctx, p) => {
  const s = sessionOuverte(ctx, p.sessionId, true);
  const liste = Array.isArray(p.empIds) ? new Set(p.empIds.map(Number)) : null;
  // Un recyclage déjà enregistré depuis n'appelle plus de convocation.
  let inscrits = inscritsDe(ctx.d, s).filter(i => !i.dejaObtenue && (liste ? liste.has(i.empId) : i.convoc !== 'now'));
  if (!aDroit(ctx, 'formations')) {
    const equipe = inscrits.filter(i => { const e = ctx.d.emp(i.empId); return !!e && isManagerOf(ctx, e); });
    if (!equipe.length || (liste && equipe.length < inscrits.length)) throw new ActionError('Convocation réservée au service RH, au référent HSE / formation ou au manager du collaborateur', 403);
    inscrits = equipe;
  }
  if (liste && inscrits.length < liste.size) throw new ActionError('Collaborateur non inscrit à cette session');
  if (!inscrits.length) throw new ActionError('Aucune convocation à envoyer pour cette session');
  const sansAdresse: string[] = [];
  for (const i of inscrits) {
    const patch = { convoc: 'now' as const, convocLe: ctx.d.ti };
    if (i.certId) await ctx.db.update<Certification>('certifications', i.certId, patch);
    else await ctx.db.update<Inscription>('inscriptions', i.inscriptionId!, patch);
    if (!await convoquerFormation(ctx, s, { id: i.empId, nom: i.nom }, i.parcours)) sansAdresse.push(i.nom);
  }
  const envoyees = inscrits.length - sansAdresse.length;
  const remettre = sansAdresse.length ? ` · sans adresse e-mail, à remettre en main propre : ${sansAdresse.join(', ')}` : '';
  if (inscrits.length === 1) return `Convocation ${envoyees ? 'envoyée par e-mail à' : 'enregistrée pour'} ${inscrits[0].nom} — ${nomSession(ctx, s)}${remettre}`;
  return `${nomSession(ctx, s).replace(/^s/, 'S')} — ${plural(envoyees, 'convocation envoyée', 'convocations envoyées')} par e-mail${remettre}`;
};

/**
 * Désinscription d'une session à venir : la place est libérée (le nombre d'inscrits est calculé). Recyclage :
 * la certification redevient à planifier ; formation initiale : l'inscription est retirée. Une convocation
 * déjà envoyée (même « à renvoyer » depuis) est annulée par e-mail (.ics d'annulation). Service RH ou manager direct.
 */
const desinscrire: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!aDroit(ctx, 'formations') && !isManagerOf(ctx, emp)) throw new ActionError('Désinscription réservée au service RH, au référent HSE / formation ou au manager du collaborateur', 403);
  const s = sessionOuverte(ctx, p.sessionId);
  const i = inscritsDe(ctx.d, s).find(x => x.empId === emp.id);
  if (!i) throw new ActionError(`${emp.nom} n’est pas inscrit à cette session`);
  for (const c of emp.certs.filter(c => c.sessionId === s.id)) await ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null, convocLe: null });
  for (const x of ctx.ds.inscriptions.filter(x => x.empId === emp.id && x.sessionId === s.id)) await ctx.db.remove('inscriptions', x.id);
  // Convocation reçue, même remise « à renvoyer » par un changement de date ou de lieu : annulée par e-mail.
  const annulee = await annulerSiConvoque(ctx, s, emp, i);
  // Place libérée : proposée à la liste d'attente de la session (lot 7, t120).
  const attente = await promouvoirAttente(ctx, s.id);
  return `${emp.nom} désinscrit de la ${nomSession(ctx, s)} — place libérée`
    + (i.parcours === 'recyclage' ? ' · recyclage de nouveau à planifier' : ' · inscription en formation initiale retirée')
    + (annulee ? ' · annulation envoyée par e-mail' : '') + (attente ? ` · ${attente}` : '');
};

export const convocationsActions = {
  'convocation.envoyer': envoyer,
  'plan.desinscrire': desinscrire,
} satisfies Record<string, ActionHandler>;
