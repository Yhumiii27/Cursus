// Cycle de vie des sessions de formation : création, confirmation, modification, annulation, clôture
// (service RH et référent HSE / formation).
// Le nombre d'inscrits n'est jamais stocké : il suit les certifications et inscriptions rattachées.
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { controleSession, exigeEvaluation, inscritsDe, placesRemplacees } from '../../../shared/rules/sessions.ts';
import type { Certification, Inscription, Participation, PlanAction, Session, SessionBilan } from '../../../shared/types.ts';
import { ActionError, requireFormations, str, type ActionHandler, type Ctx } from './context.ts';

/** Session désignée par `id` ; refusée si elle est clôturée ou annulée (sauf `toutes`). */
function sessionOf(ctx: Ctx, id: unknown, toutes = false): Session {
  const s = ctx.d.session(Number(id));
  if (!s) throw new ActionError('Session introuvable', 404);
  if (!toutes && !sessionActive(s)) throw new ActionError(`Session ${s.statut === 'Annulée' ? 'annulée' : 'clôturée'} : elle ne peut plus être modifiée`);
  return s;
}

const quand = (s: Pick<Session, 'date'>) => fmt(parse(s.date));
const nomSession = (ctx: Ctx, s: Session) => `Session ${ctx.d.fm(s.formation)?.court ?? s.formation} du ${quand(s)}`;

/** Une autre session ouverte rattachée à la même action du plan. */
const autreSessionDuPlan = (ctx: Ctx, s: Session) => ctx.ds.sessions.some(x => x.id !== s.id && x.planId === s.planId && sessionActive(x));

/**
 * Nouvelle session, éventuellement pour une action du plan. L'action doit exister, porter la même formation
 * et être encore « prévue » : elle passe « engagée ». Date postérieure à aujourd'hui, places entières.
 */
const creer: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const fm = ctx.d.fm(str(p.f));
  if (!fm) throw new ActionError('Formation inconnue');
  const err = controleSession(ctx.d.ti, { date: p.date, lieu: p.lieu, places: p.places });
  if (err) throw new ActionError(err);
  let plan: PlanAction | undefined;
  if (p.planId != null && p.planId !== '') {
    plan = ctx.ds.plan.find(l => l.id === Number(p.planId));
    if (!plan) throw new ActionError('Action du plan introuvable');
    if (plan.f !== fm.id) throw new ActionError('L’action du plan porte sur une autre formation');
    if (plan.statut !== 'prevu') throw new ActionError(`Action du plan déjà ${plan.statut === 'engage' ? 'engagée' : 'réalisée'}`);
  }
  const places = Number(p.places), lieu = str(p.lieu);
  const s = ctx.db.insert<Session>('sessions', { formation: fm.id, date: p.date, lieu, places, statut: 'À confirmer', planId: plan?.id ?? null, bilan: null });
  if (plan) ctx.db.update<PlanAction>('planActions', plan.id, { statut: 'engage' });
  return { message: `Session ${fm.court} créée pour le ${fmt(parse(p.date))} — ${plural(places, 'place', 'places')}${plan ? ' · action du plan engagée' : ''}`, result: { id: s.id } };
};

/** Confirmation par l'organisme : la liste nominative lui est transmise (affichée et exportée par l'interface). */
const confirmer: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  if (s.statut === 'Confirmée') throw new ActionError('Session déjà confirmée');
  if (s.date < ctx.d.ti) throw new ActionError('Session passée : clôturez-la, ou annulez-la si elle n’a pas eu lieu');
  ctx.db.update<Session>('sessions', s.id, { statut: 'Confirmée' });
  const n = inscritsDe(ctx.d, s).length;
  return `${nomSession(ctx, s)} confirmée — liste de ${plural(n, 'inscrit', 'inscrits')} à transmettre à ${ctx.d.fm(s.formation)?.organisme ?? 'l’organisme'}`;
};

/**
 * Date, lieu, places. Une nouvelle date est postérieure à aujourd'hui, sauf pour une session passée, à clôturer,
 * qui se redate au jour où elle a eu lieu ; les places couvrent les inscrits. Une nouvelle date postérieure à
 * un recyclage déjà enregistré libère la place de la certification remplacée (même règle que `cert.ajouter`).
 * Pour une session à venir, un changement de date ou de lieu rend caduques les convocations envoyées (elles
 * repassent « à envoyer »), et une nouvelle date est à faire confirmer par l'organisme (« à confirmer »).
 */
const modifier: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  const v = { date: p.date ?? s.date, lieu: p.lieu ?? s.lieu, places: p.places ?? s.places };
  const err = controleSession(ctx.d.ti, v, { dateActuelle: s.date, inscrits: s.inscrits });
  if (err) throw new ActionError(err);
  const date = String(v.date), lieu = str(v.lieu), places = Number(v.places);
  const changes = [
    date !== s.date ? `date : ${fmt(parse(date))}` : '',
    lieu !== s.lieu ? `lieu : ${lieu}` : '',
    places !== s.places ? plural(places, 'place', 'places') : '',
  ].filter(Boolean);
  if (!changes.length) return 'Aucune modification';
  // Nouvelle date postérieure à un recyclage déjà enregistré : la certification remplacée libère sa place.
  const liberees = date !== s.date ? placesRemplacees(ctx.d, s.id, date) : [];
  liberees.forEach(x => ctx.db.update<Certification>('certifications', x.c.id, { sessionId: null, convoc: null }));
  // Session passée corrigée après coup : plus de convocation ni de confirmation à demander.
  const aVenir = date >= ctx.d.ti;
  let aRenvoyer = 0;
  if (aVenir && (date !== s.date || lieu !== s.lieu)) {
    for (const x of inscritsDe(ctx.d, s).filter(i => i.convoc === 'now' && !liberees.some(l => l.c.id === i.certId))) {
      if (x.certId) ctx.db.update<Certification>('certifications', x.certId, { convoc: 'later' });
      else ctx.db.update<Inscription>('inscriptions', x.inscriptionId!, { convoc: 'later' });
      aRenvoyer++;
    }
  }
  const reconfirmer = aVenir && date !== s.date && s.statut === 'Confirmée';
  ctx.db.update<Session>('sessions', s.id, { date, lieu, places, ...(reconfirmer ? { statut: 'À confirmer' as const } : {}) });
  return [
    `${nomSession(ctx, s)} modifiée — ${changes.join(' · ')}`,
    liberees.length ? `recyclage déjà enregistré avant cette date, ${liberees.length > 1 ? 'places libérées' : 'place libérée'} : ${liberees.map(x => ctx.d.personName(x.empId)).join(', ')}` : '',
    aRenvoyer ? plural(aRenvoyer, 'convocation à renvoyer', 'convocations à renvoyer') : '',
    reconfirmer ? `nouvelle date à faire confirmer par ${ctx.d.fm(s.formation)?.organisme ?? 'l’organisme'}` : '',
  ].filter(Boolean).join(' · ');
};

/**
 * Annulation : les certifications rattachées redeviennent à planifier ; les inscriptions en formation
 * initiale restent attachées à la session annulée, à replanifier. L'action du plan engagée pour elle
 * (sans autre session ouverte) redevient « prévue ».
 */
const annuler: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  const motif = str(p.motif) || null;
  if (motif && motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  const inscrits = inscritsDe(ctx.d, s);
  ctx.ds.employes.flatMap(e => e.certs).filter(c => c.sessionId === s.id)
    .forEach(c => ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null }));
  const plan = s.planId ? ctx.ds.plan.find(l => l.id === s.planId) : undefined;
  const replan = plan?.statut === 'engage' && !autreSessionDuPlan(ctx, s);
  if (replan) ctx.db.update<PlanAction>('planActions', plan!.id, { statut: 'prevu' });
  const bilan: SessionBilan = { le: ctx.d.ti, par: ctx.user.nom, note: null, commentaire: null, motif };
  ctx.db.update<Session>('sessions', s.id, { statut: 'Annulée', bilan });
  return `${nomSession(ctx, s)} annulée${inscrits.length ? ` — ${plural(inscrits.length, 'inscrit à replanifier', 'inscrits à replanifier')}` : ''}${replan ? ' · action du plan de nouveau prévue' : ''}`;
};

/** Décision saisie pour un inscrit : présence et, si la formation l'exige, résultat de l'évaluation. */
interface Decision { empId: number; present: unknown; reussi?: unknown }

/**
 * Clôture d'une session passée (ou du jour). Pour chaque inscrit : présent et, si la formation l'exige,
 * reçu à l'évaluation → certification datée du jour de la session ; absent ou échec → retour à planifier
 * (recyclage : certification détachée ; formation initiale : inscription à replanifier). Résultats
 * conservés (participations), action du plan réalisée, évaluation à chaud facultative.
 */
const cloturer: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id, true);
  if (s.statut === 'Clôturée') throw new ActionError('Session déjà clôturée');
  if (s.statut === 'Annulée') throw new ActionError('Session annulée : rien à clôturer');
  if (s.date > ctx.d.ti) throw new ActionError('La session n’a pas encore eu lieu');
  const fm = ctx.d.fm(s.formation);
  const evaluation = exigeEvaluation(fm);
  const note = p.note == null || p.note === '' ? null : Number(p.note);
  if (note != null && !(Number.isInteger(note) && note >= 1 && note <= 5)) throw new ActionError('Évaluation à chaud : note entière de 1 à 5');
  const commentaire = str(p.commentaire) || null;
  if (commentaire && commentaire.length > 1000) throw new ActionError('Commentaire trop long (1 000 caractères au plus)');

  // Chaque inscrit reçoit une décision ; une liste périmée (inscrit ajouté ou retiré entre-temps) est refusée.
  const inscrits = inscritsDe(ctx.d, s);
  const decisions = new Map<number, Decision>((Array.isArray(p.participants) ? p.participants as Decision[] : []).map(x => [Number(x?.empId), x]));
  for (const id of decisions.keys()) {
    if (!inscrits.some(i => i.empId === id)) throw new ActionError(`${ctx.d.personName(id)} ne figure pas parmi les inscrits : rouvrez la clôture`);
  }
  const lignes = inscrits.map(i => {
    if (i.dejaObtenue) return { i, present: true, reussi: null, ok: true };
    const x = decisions.get(i.empId);
    if (typeof x?.present !== 'boolean') throw new ActionError(`Présence à renseigner : ${i.nom}`);
    if (evaluation && x.present && typeof x.reussi !== 'boolean') throw new ActionError(`Résultat de l’évaluation à renseigner : ${i.nom}`);
    const reussi = evaluation && x.present ? x.reussi as boolean : null;
    return { i, present: x.present, reussi, ok: x.present && reussi !== false };
  });

  let obtenues = 0;
  const aReplanifier: string[] = [];
  for (const l of lignes) {
    let certId = l.i.dejaObtenue?.id ?? null;
    if (!l.i.dejaObtenue && l.ok) {
      // Certification datée du jour de la session ; la certification renouvelée garde la session (historique).
      certId = ctx.db.insert<Certification>('certifications', { empId: l.i.empId, f: s.formation, obtenue: s.date, sessionId: null, convoc: null }).id;
      if (l.i.inscriptionId) ctx.db.remove('inscriptions', l.i.inscriptionId);
      obtenues++;
    } else if (!l.ok) {
      // Recyclage : la certification se planifie de nouveau. Formation initiale : l'inscription reste
      // attachée à la session clôturée, à replanifier.
      if (l.i.certId) ctx.db.update<Certification>('certifications', l.i.certId, { sessionId: null, convoc: null });
      aReplanifier.push(l.i.nom);
    }
    ctx.db.insert<Participation>('participations', { sessionId: s.id, empId: l.i.empId, parcours: l.i.parcours, present: l.present, reussi: l.reussi, certId });
  }
  const plan = s.planId ? ctx.ds.plan.find(x => x.id === s.planId) : undefined;
  const realise = !!plan && plan.statut !== 'realise' && !autreSessionDuPlan(ctx, s);
  if (realise) ctx.db.update<PlanAction>('planActions', plan!.id, { statut: 'realise' });
  const bilan: SessionBilan = { le: ctx.d.ti, par: ctx.user.nom, note, commentaire, motif: null };
  ctx.db.update<Session>('sessions', s.id, { statut: 'Clôturée', bilan });
  return [
    `${nomSession(ctx, s)} clôturée — ${plural(obtenues, 'certification enregistrée', 'certifications enregistrées')}`,
    aReplanifier.length ? `à replanifier : ${aReplanifier.join(', ')}` : '',
    realise ? 'action du plan réalisée' : '',
  ].filter(Boolean).join(' · ');
};

export const sessionsActions: Record<string, ActionHandler> = {
  'session.creer': creer,
  'session.confirmer': confirmer,
  'session.modifier': modifier,
  'session.annuler': annuler,
  'session.cloturer': cloturer,
};
