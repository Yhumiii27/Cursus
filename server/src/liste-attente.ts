// Liste d'attente des sessions de formation complètes (lot 7, chantier C, t120 ; règles : shared/rules/liste-attente.ts).
// - `accepterEnAttente` : demande acceptée sur une session complète (`demande.accepter`), le salarié prend son rang dans la
//   file ; il en est prévenu (et le manager qui a fait la demande), sa demande le dit.
// - `promouvoirAttente` : appelée après chaque libération de place, dans la transaction de l'action qui la libère
//   (changement de session, désinscription, recyclage enregistré, places augmentées ou libérées par une nouvelle date,
//   sortie, correction d'une certification, réouverture d'une demande, retrait d'une personne proposée). Le premier
//   encore admissible est proposé au service RH, qui confirme (`attente.confirmer`, réponse de l'entreprise du 23 octobre
//   2026), ou, réglage `automatique`, inscrit et convoqué aussitôt. Les non-admissibles sont passés, motif codé au journal ;
//   ceux dont l'attente n'a plus d'objet sortent de la file.
// - `purgerAttente` : session annulée ou clôturée, la file est close ; ceux qui y étaient par une demande repassent au plan
//   de formation, à replanifier.
// - `retirerAttentesDe`, `retirerAttentesFormation`, `defaireAttente` : sortie du salarié, certification enregistrée,
//   demande rouverte.
// Rien de ce qui est tracé au journal n'est un texte libre : identifiants, codes de motif.
import { parse } from '../../shared/dates.ts';
import { certEnVigueur, Domain, sessionActive } from '../../shared/domain.ts';
import { fmt, plural } from '../../shared/format.ts';
import { exerciceOuvert } from '../../shared/rules/exercices.ts';
import { attenteActive, fileDe, ISSUE_ATTENTE_LABEL, nonAdmissible, placesAProposer, placeTexte, rangSuivant } from '../../shared/rules/liste-attente.ts';
import { finSession, sessionDu } from '../../shared/rules/plage-session.ts';
import type { AttenteSession, Certification, DemandeCollab, Employe, Inscription, IssueAttente, ISODate, PlanAction, Session, SuiteDemande } from '../../shared/types.ts';
import { ActionError, aDroit, type Ctx } from './actions/context.ts';
import { journaliser } from './comptes.ts';
import { loadFull } from './dataset.ts';
import { annulerSiConvoque, convoquerFormation, notifier, notifierDecisionDemande } from './notifications.ts';

const attentesDe = (ctx: Ctx) => ctx.ds.attentesSession ?? [];
const nomSession = (ctx: Ctx, s: Session) => `${ctx.d.fm(s.formation)?.court ?? s.formation} ${sessionDu(s)}`;

/** Contexte relu après les écritures de l'action : places, inscrits et file calculés sur l'état à jour. */
async function relire(ctx: Ctx): Promise<Ctx> {
  const ds = await loadFull(ctx.db, ctx.user);
  return { ...ctx, ds, d: new Domain(ds) };
}

/** Fin d'une attente : statut, motif codé, jour et auteur (« Cursus » pour une fin constatée sans décision). */
async function clore(ctx: Ctx, a: Pick<AttenteSession, 'id'>, statut: 'inscrit' | 'retire', issue: IssueAttente, par = ctx.user.nom) {
  await ctx.db.update<AttenteSession>('attentesSession', a.id, { statut, issue, issueLe: ctx.d.ti, issuePar: par });
}

/** Ligne du journal propre à la liste d'attente (effet d'une place libérée, file close) : identifiants et codes seulement. */
async function tracer(ctx: Ctx, action: string, payload: Record<string, unknown>, salaries: number[]) {
  await journaliser(ctx.db, { actor: ctx.user.nom, role: ctx.user.role, action, message: null, payload, salaries });
}
const ids = (a: Pick<AttenteSession, 'id' | 'sessionId' | 'empId'>) => ({ attenteId: a.id, sessionId: a.sessionId, empId: a.empId });

/** Notification au salarié (et au manager qui a fait la demande) sur sa place dans la liste d'attente. */
async function prevenir(ctx: Ctx, emp: Pick<Employe, 'id' | 'nom'>, r: DemandeCollab | null, objet: string, texte: string, texteManager: string) {
  await notifier(ctx, emp.id, { type: 'attente.formation', objet, texte });
  if (r?.parId && r.parId !== emp.id) await notifier(ctx, r.parId, { type: 'attente.formation', objet: `${objet} — ${emp.nom}`, texte: texteManager });
}

/**
 * Ligne prévue du plan de formation pour une demande (repli d'une session complète, file close) : exercice en cours, ou le
 * suivant s'il est déjà clos, comme `demande.accepter`. null : salarié sans équipe (le plan est par équipe).
 */
export async function ajouterAuPlan(ctx: Ctx, emp: Employe, r: DemandeCollab): Promise<{ l: PlanAction; texte: string } | null> {
  if (!emp.equipe) return null;
  const ex = exerciceOuvert(ctx.ds, ctx.d.year);
  const tri = ex > ctx.d.year ? 'T1' : `T${Math.floor(ctx.d.today.getMonth() / 3) + 1}`;
  const l = await ctx.db.insert<PlanAction>('planActions', { exercice: ex, f: r.f, libelle: r.libelle, equipe: emp.equipe, periode: tri, effectif: 1, cout: r.f ? ctx.d.fm(r.f).cout : 0, statut: 'prevu', origine: 'demande' });
  return { l, texte: `plan de formation ${ex} (${tri})` };
}

/**
 * Demande de formation acceptée alors que la session souhaitée est complète : le salarié prend son rang dans la file (ordre
 * d'arrivée), après les mêmes contrôles qu'une inscription (contrat, absences et autres sessions ces jours-là). Déjà en
 * file pour cette session : refus. Renvoie le message de l'action.
 */
export async function accepterEnAttente(ctx: Ctx, r: DemandeCollab, emp: Employe, s: Session): Promise<string> {
  const cert = certEnVigueur(emp.certs, s.formation);
  const refus = nonAdmissible(ctx.d, { sessionId: s.id, empId: emp.id, certId: cert?.id ?? null, le: ctx.d.ti });
  if (refus?.motif === 'deja_inscrit') throw new ActionError(`${emp.nom} est déjà inscrit à la session du ${fmt(parse(s.date))}`);
  if (refus) throw new ActionError(`${emp.nom} : ${refus.detail ?? refus.texte} — refusez la demande, ou inscrivez-le à une autre session depuis sa fiche`);
  const deja = attentesDe(ctx).find(a => a.sessionId === s.id && a.empId === emp.id);
  if (deja && attenteActive(deja)) throw new ActionError(`${emp.nom} est déjà en liste d’attente de la session du ${fmt(parse(s.date))}`);
  // Une formation initiale à replanifier (session annulée, absent, échec) est notée : c'est elle qui sera déplacée.
  const insc = cert ? undefined : ctx.ds.inscriptions.find(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === s.formation);
  const ligne = {
    sessionId: s.id, empId: emp.id, demandeId: r.id, certId: cert?.id ?? null, inscriptionId: insc?.id ?? null, rang: rangSuivant(attentesDe(ctx), s.id),
    le: ctx.d.ti, par: ctx.user.nom, statut: 'attente' as const, proposeeLe: null, issueLe: null, issuePar: null, issue: null,
  };
  // Une ligne par session et par salarié : celle d'une attente close est reprise, en fin de file.
  const a = deja ? { ...deja, ...ligne } : await ctx.db.insert<AttenteSession>('attentesSession', ligne);
  if (deja) await ctx.db.update<AttenteSession>('attentesSession', deja.id, ligne);
  const position = fileDe([...attentesDe(ctx).filter(x => x.id !== a.id), a], s.id).findIndex(x => x.id === a.id) + 1;
  const quand = `la session du ${fmt(parse(s.date))}`;
  await ctx.db.update<DemandeCollab>('demandesCollab', r.id, {
    statut: 'acceptee', suite: { attenteId: a.id },
    reponse: `Session du ${fmt(parse(s.date))} complète — placé ${placeTexte(position)} ce jour : vous serez inscrit si une place se libère`,
  });
  const fm = ctx.d.fm(s.formation);
  await prevenir(ctx, emp, r, `Liste d’attente : ${fm?.nom ?? s.formation} — session ${sessionDu(s)}`,
    `Votre demande de formation « ${fm?.nom ?? s.formation} » est acceptée par le service RH, mais ${quand} est complète : vous êtes ${placeTexte(position)}. `
      + 'Si une place se libère, le service RH vous y inscrira et vous recevrez votre convocation. Vous pouvez vous retirer de la liste depuis Cursus (Mon espace).',
    `La demande de formation « ${fm?.nom ?? s.formation} » que vous avez faite pour ${emp.nom} est acceptée par le service RH, mais ${quand} est complète : ${emp.nom} est ${placeTexte(position)}.`);
  return `${emp.nom} — session du ${fmt(parse(s.date))} complète : ${placeTexte(position)}, inscription si une place se libère`;
}

/**
 * Inscrit le salarié de l'attente à la session (contrôles faits) : recyclage rattaché, formation initiale déplacée ou créée,
 * comme `demande.accepter` ; convocation envoyée, demande mise à jour et décision notifiée. Renvoie la session quittée.
 */
async function inscrire(ctx: Ctx, a: AttenteSession, s: Session, emp: Employe): Promise<{ depuis: number | null; convoque: boolean }> {
  const cert = certEnVigueur(emp.certs, s.formation);
  let suite: SuiteDemande;
  let depuis: number | null = null;
  if (cert) {
    depuis = cert.sessionId;
    await annulerSiConvoque(ctx, ctx.d.session(cert.sessionId), emp, cert);
    await ctx.db.update<Certification>('certifications', cert.id, { sessionId: s.id, convoc: 'now', convocLe: ctx.d.ti });
    suite = { sessionId: s.id, certId: cert.id, depuis: cert.sessionId };
  } else {
    const existante = ctx.ds.inscriptions.find(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === s.formation);
    if (existante) {
      depuis = existante.sessionId;
      await annulerSiConvoque(ctx, ctx.d.session(existante.sessionId), emp, existante);
      await ctx.db.update<Inscription>('inscriptions', existante.id, { sessionId: s.id, convoc: 'now', date: ctx.d.ti, convocLe: ctx.d.ti });
      suite = { sessionId: s.id, inscriptionId: existante.id, depuis: existante.sessionId };
    } else {
      const i = await ctx.db.insert<Inscription>('inscriptions', { empId: emp.id, sessionId: s.id, convoc: 'now', date: ctx.d.ti, convocLe: ctx.d.ti });
      suite = { sessionId: s.id, inscriptionId: i.id, cree: true };
    }
  }
  await clore(ctx, a, 'inscrit', 'inscription');
  const convoque = await convoquerFormation(ctx, s, emp, cert ? 'recyclage' : 'initiale');
  const r = a.demandeId ? ctx.ds.demandesCollab.find(x => x.id === a.demandeId) : undefined;
  if (r) {
    // La réouverture de la demande (actions/corrections.ts) défait l'inscription comme celle d'une acceptation directe.
    await ctx.db.update<DemandeCollab>('demandesCollab', r.id, {
      suite: { ...suite, attenteId: a.id }, reponse: `Inscrit à la session du ${fmt(parse(s.date))} depuis la liste d’attente — convocation envoyée`,
    });
    // La convocation (e-mail et .ics) tient lieu de réponse au salarié ; le manager qui a fait la demande est prévenu.
    await notifierDecisionDemande(ctx, emp, r, true, convoque);
  }
  return { depuis: depuis !== s.id ? depuis : null, convoque };
}

/**
 * Place libérée dans la session : le premier encore admissible de la file est proposé au service RH (réglage `confirmer`,
 * par défaut), ou inscrit et convoqué (`automatique`), autant de fois qu'il y a de places libres non encore proposées. Les
 * non-admissibles sont passés, motif codé au journal (`attente.sautee`) ; une attente qui n'a plus d'objet sort de la file.
 * Rien pour une session annulée, clôturée ou commencée (la clôture purge la file). Renvoie le compte rendu à ajouter au
 * message de l'action, vide s'il n'y a rien eu à faire ; les noms ne sont cités qu'au service RH et au référent HSE.
 */
export async function promouvoirAttente(ctx: Ctx, sessionId: number | null | undefined): Promise<string> {
  // Aucune attente en file pour cette session avant l'action (l'action ne remplit jamais la file d'une session qu'elle libère).
  if (!sessionId || !attentesDe(ctx).some(a => a.sessionId === sessionId && attenteActive(a))) return '';
  const c = await relire(ctx);
  const s = c.d.session(sessionId);
  if (!s || !sessionActive(s) || s.date < c.d.ti) return '';
  let libres = placesAProposer(s, attentesDe(c));
  if (libres <= 0) return '';
  const auto = c.ds.settings.formationsAttenteMode === 'automatique';
  const proposes: string[] = [], inscrits: string[] = [], sautes: string[] = [];
  const quittees: number[] = [];
  for (const a of fileDe(attentesDe(c), s.id).filter(x => x.statut === 'attente')) {
    if (libres <= 0) break;
    const nom = c.d.personName(a.empId);
    const refus = nonAdmissible(c.d, a);
    if (refus) {
      if (refus.definitif) await clore(c, a, 'retire', refus.motif as IssueAttente, 'Cursus');
      await tracer(c, 'attente.sautee', { ...ids(a), motif: refus.motif, retire: refus.definitif }, [a.empId]);
      sautes.push(`${nom} (${refus.texte})`);
      continue;
    }
    if (auto) {
      const { depuis } = await inscrire(c, a, s, c.d.emp(a.empId)!);
      if (depuis) quittees.push(depuis);
      await tracer(c, 'attente.inscrite', ids(a), [a.empId]);
      inscrits.push(nom);
    } else {
      await c.db.update<AttenteSession>('attentesSession', a.id, { statut: 'proposee', proposeeLe: c.d.ti });
      await tracer(c, 'attente.proposee', ids(a), [a.empId]);
      proposes.push(nom);
    }
    libres--;
  }
  // Le service RH reçoit la proposition dans sa boîte, même quand l'un de ses membres a libéré la place (à partager).
  if (proposes.length) {
    await notifier(c, 0, {
      type: 'attente.proposition', objet: `Place libérée — liste d’attente : ${nomSession(c, s)}`,
      texte: `Une place s’est libérée dans la session ${nomSession(c, s)}. Proposé${proposes.length > 1 ? 's' : ''} depuis la liste d’attente, dans l’ordre d’arrivée : `
        + `${proposes.join(', ')}. Confirmez l’inscription dans Cursus (Formations, détail de la session) : la convocation part à ce moment-là.`,
    }, true);
  }
  // Inscription automatique depuis une autre session : la place qu'elle quitte se propose à son tour.
  const suites: string[] = [];
  for (const id of quittees) suites.push(await promouvoirAttente(c, id));
  const voitNoms = aDroit(ctx, 'formations');
  return [
    proposes.length ? (voitNoms
      ? `liste d’attente : ${proposes.join(', ')} proposé${proposes.length > 1 ? 's' : ''} au service RH (place à confirmer)`
      : `liste d’attente : ${plural(proposes.length, 'place proposée', 'places proposées')} au service RH`) : '',
    inscrits.length ? (voitNoms
      ? `liste d’attente : ${inscrits.join(', ')} inscrit${inscrits.length > 1 ? 's' : ''} et convoqué${inscrits.length > 1 ? 's' : ''}`
      : `liste d’attente : ${plural(inscrits.length, 'inscription', 'inscriptions')} depuis la file`) : '',
    sautes.length && voitNoms ? `passé${sautes.length > 1 ? 's' : ''} dans la file : ${sautes.join(', ')}` : '',
    ...suites,
  ].filter(Boolean).join(' · ');
}

/** Promotions de plusieurs sessions libérées par une même action, jointes en un compte rendu (« · »). */
export async function promouvoirAttentes(ctx: Ctx, ids: Iterable<number | null | undefined>): Promise<string> {
  const out: string[] = [];
  for (const id of new Set(ids)) out.push(await promouvoirAttente(ctx, id));
  return out.filter(Boolean).join(' · ');
}

/**
 * Session annulée ou clôturée : la file est close. Ceux qui y étaient par une demande repassent au plan de formation, à
 * replanifier (ligne prévue, comme le repli de `demande.accepter`), et en sont prévenus ; un recyclage reste à planifier
 * dans les échéances.
 */
export async function purgerAttente(ctx: Ctx, s: Session, issue: 'session_annulee' | 'session_cloturee'): Promise<string> {
  const file = fileDe(attentesDe(ctx), s.id);
  if (!file.length) return '';
  let auPlan = 0;
  for (const a of file) {
    await clore(ctx, a, 'retire', issue);
    const emp = ctx.d.emp(a.empId);
    const r = a.demandeId ? ctx.ds.demandesCollab.find(x => x.id === a.demandeId && x.statut === 'acceptee') : undefined;
    if (!emp || !r) continue;
    const plan = await ajouterAuPlan(ctx, emp, r);
    if (plan) auPlan++;
    const etat = issue === 'session_annulee' ? 'annulée' : 'clôturée';
    await ctx.db.update<DemandeCollab>('demandesCollab', r.id, {
      suite: { ...(plan ? { planId: plan.l.id } : {}), attenteId: a.id },
      reponse: `Session du ${fmt(parse(s.date))} ${etat} — liste d’attente close${plan ? `, ajoutée au ${plan.texte}` : ''} : le service RH vous inscrira à une prochaine session`,
    });
    const fm = ctx.d.fm(s.formation);
    await prevenir(ctx, emp, r, `Liste d’attente close : ${fm?.nom ?? s.formation} — session ${sessionDu(s)}`,
      `La session ${sessionDu(s)} de la formation « ${fm?.nom ?? s.formation} » est ${etat} : la liste d’attente où vous étiez est close. Le service RH vous inscrira à une prochaine session.`,
      `La session ${sessionDu(s)} de la formation « ${fm?.nom ?? s.formation} » est ${etat} : ${emp.nom} n’est plus en liste d’attente, le service RH l’inscrira à une prochaine session.`);
  }
  await tracer(ctx, 'attente.purgee', { sessionId: s.id, issue, attentes: file.map(a => a.id) }, file.map(a => a.empId));
  return `liste d’attente close : ${plural(file.length, 'personne', 'personnes')} à replanifier${auPlan ? ` (${auPlan > 1 ? `${auPlan} demandes` : 'une demande'} au plan de formation)` : ''}`;
}

/**
 * Attentes du salarié sorti dont la session finit après son dernier jour : retirées (`hors_contrat`). Renvoie les sessions
 * où une place proposée au service RH se libère ainsi.
 */
export async function retirerAttentesDe(ctx: Ctx, emp: Employe, date: ISODate): Promise<{ n: number; sessions: number[] }> {
  const out = { n: 0, sessions: [] as number[] };
  for (const a of attentesDe(ctx).filter(x => x.empId === emp.id && attenteActive(x))) {
    const s = ctx.d.session(a.sessionId);
    if (s && finSession(s) <= date) continue;
    await clore(ctx, a, 'retire', 'hors_contrat');
    out.n++;
    if (a.statut === 'proposee') out.sessions.push(a.sessionId);
  }
  return out;
}

/** Certification enregistrée (`cert.ajouter`) : les attentes du salarié pour cette formation n'ont plus d'objet. */
export async function retirerAttentesFormation(ctx: Ctx, emp: Employe, f: string): Promise<{ n: number; sessions: number[] }> {
  const out = { n: 0, sessions: [] as number[] };
  for (const a of attentesDe(ctx).filter(x => x.empId === emp.id && attenteActive(x) && ctx.d.session(x.sessionId)?.formation === f)) {
    await clore(ctx, a, 'retire', 'deja_certifie');
    out.n++;
    if (a.statut === 'proposee') out.sessions.push(a.sessionId);
  }
  return out;
}

/**
 * Réouverture d'une demande (`demande.reouvrir`) : l'attente qu'elle avait ouverte, encore en file, en sort
 * (`demande_rouverte`) ; une place qui lui était proposée se propose au suivant. Une attente déjà conclue par une
 * inscription est défaite par la réouverture elle-même (suite de la demande : session et certification ou inscription).
 */
export async function defaireAttente(ctx: Ctx, r: DemandeCollab): Promise<{ texte: string; attenteId?: number }> {
  const a = attentesDe(ctx).find(x => x.demandeId === r.id && attenteActive(x));
  if (!a) return { texte: '' };
  await clore(ctx, a, 'retire', 'demande_rouverte');
  const s = ctx.d.session(a.sessionId);
  const promotion = a.statut === 'proposee' ? await promouvoirAttente(ctx, a.sessionId) : '';
  return { texte: [`retiré de la liste d’attente${s ? ` de la session du ${fmt(parse(s.date))}` : ''}`, promotion].filter(Boolean).join(' · '), attenteId: a.id };
}

/** Attente en file désignée par `id`. */
function attenteOf(ctx: Ctx, id: unknown): AttenteSession {
  const a = attentesDe(ctx).find(x => x.id === Number(id));
  if (!a) throw new ActionError('Liste d’attente : inscription introuvable', 404);
  if (!attenteActive(a)) throw new ActionError(`Plus en liste d’attente (${ISSUE_ATTENTE_LABEL[a.issue ?? 'rh']})`);
  return a;
}

/**
 * Confirmation par le service RH (ou le référent HSE) de l'inscription d'une personne de la file : proposée par Cursus, ou
 * choisie par le service RH s'il reste une place libre qui n'est proposée à personne. Mêmes contrôles qu'une inscription ;
 * la convocation part à ce moment-là. Une place quittée dans une autre session se propose à son tour.
 */
export async function confirmerAttente(ctx: Ctx, id: unknown): Promise<string> {
  const a = attenteOf(ctx, id);
  const s = ctx.d.session(a.sessionId);
  const emp = ctx.d.emp(a.empId);
  if (!s || !emp) throw new ActionError('Session ou collaborateur introuvable', 404);
  const refus = nonAdmissible(ctx.d, a);
  if (refus) throw new ActionError(`${emp.nom} : ${refus.detail ?? refus.texte} — ${refus.definitif ? 'retirez-le de la liste d’attente' : 'inscription impossible pour l’instant'}`);
  if (s.inscrits >= s.places) throw new ActionError(`Session du ${fmt(parse(s.date))} complète : aucune place libre à confirmer`);
  if (a.statut === 'attente' && placesAProposer(s, attentesDe(ctx)) <= 0) {
    throw new ActionError('Les places libres sont déjà proposées à d’autres personnes de la liste d’attente (ordre d’arrivée) : confirmez-les, ou retirez-les d’abord');
  }
  const { depuis, convoque } = await inscrire(ctx, a, s, emp);
  const suite = depuis ? await promouvoirAttente(ctx, depuis) : '';
  return [
    `${emp.nom} inscrit à la session ${nomSession(ctx, s)} depuis la liste d’attente — ${convoque ? 'convocation envoyée' : 'convocation à remettre en main propre (aucune adresse e-mail)'}`,
    depuis ? `place libérée à la session du ${fmt(parse(ctx.d.session(depuis)?.date ?? s.date))}` : '',
    suite,
  ].filter(Boolean).join(' · ');
}

/**
 * Retrait de la file : le salarié lui-même, son manager, ou le service RH (et le référent HSE). La demande le dit ; une place
 * qui lui était proposée se propose au suivant.
 */
export async function retirerAttente(ctx: Ctx, id: unknown, issue: 'salarie' | 'manager' | 'rh'): Promise<string> {
  const a = attenteOf(ctx, id);
  const s = ctx.d.session(a.sessionId);
  const emp = ctx.d.emp(a.empId);
  await clore(ctx, a, 'retire', issue);
  const r = a.demandeId ? ctx.ds.demandesCollab.find(x => x.id === a.demandeId) : undefined;
  if (r && s) await ctx.db.update<DemandeCollab>('demandesCollab', r.id, { reponse: `Retiré de la liste d’attente de la session du ${fmt(parse(s.date))} (${ISSUE_ATTENTE_LABEL[issue]})` });
  // Retiré par un autre que lui : le salarié en est prévenu.
  if (emp && s && issue !== 'salarie') {
    const fm = ctx.d.fm(s.formation);
    await notifier(ctx, emp.id, {
      type: 'attente.formation', objet: `Liste d’attente : ${fm?.nom ?? s.formation} — session ${sessionDu(s)}`,
      texte: `Vous n’êtes plus en liste d’attente de la session ${sessionDu(s)} de la formation « ${fm?.nom ?? s.formation} » (${ISSUE_ATTENTE_LABEL[issue]}).`,
    });
  }
  const promotion = a.statut === 'proposee' ? await promouvoirAttente(ctx, a.sessionId) : '';
  return [`${emp?.nom ?? ctx.d.personName(a.empId)} retiré de la liste d’attente${s ? ` de la session ${nomSession(ctx, s)}` : ''}`, promotion].filter(Boolean).join(' · ');
}
