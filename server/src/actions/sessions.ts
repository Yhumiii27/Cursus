// Cycle de vie des sessions de formation : création, confirmation, modification, annulation, clôture
// (service RH et référent HSE / formation).
// Le nombre d'inscrits n'est jamais stocké : il suit les certifications et inscriptions rattachées.
import { sessionActive } from '../../../shared/domain.ts';
import { days, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { refusArchive } from '../../../shared/rules/referentiels.ts';
import { clotureDe, montantReel } from '../../../shared/rules/exercices.ts';
import { controlePlage, decalerPlage, finSession, horaireTexte, type Plage, plageTexte, sessionDu } from '../../../shared/rules/plage-session.ts';
import { controleSession, exigeEvaluation, inscritsDe, placesRemplacees } from '../../../shared/rules/sessions.ts';
import type { Certification, Inscription, Participation, PlanAction, Session, SessionBilan } from '../../../shared/types.ts';
import { annulerSiConvoque } from '../notifications.ts';
import { ActionError, type ActionHandler, type Ctx, isRh, requireFormations, str } from './context.ts';

/** Session désignée par `id` ; refusée si elle est clôturée ou annulée (sauf `toutes`). */
function sessionOf(ctx: Ctx, id: unknown, toutes = false): Session {
  const s = ctx.d.session(Number(id));
  if (!s) throw new ActionError('Session introuvable', 404);
  if (!toutes && !sessionActive(s)) throw new ActionError(`Session ${s.statut === 'Annulée' ? 'annulée' : 'clôturée'} : elle ne peut plus être modifiée`);
  return s;
}

/** Plage contrôlée (controleSession l'a déjà acceptée) : dernier jour, jours, horaires. */
function plageDe(date: string, v: { fin?: unknown; jours?: unknown; horaires?: unknown }): Plage {
  const r = controlePlage(date, v);
  if ('message' in r) throw new ActionError(r.message);
  return r.plage;
}

const nomSession = (ctx: Ctx, s: Session) => `Session ${ctx.d.fm(s.formation)?.court ?? s.formation} ${sessionDu(s)}`;

/** Une autre session ouverte rattachée à la même action du plan. */
const autreSessionDuPlan = (ctx: Ctx, s: Session) => ctx.ds.sessions.some(x => x.id !== s.id && x.planId === s.planId && sessionActive(x));

/**
 * Nouvelle session, éventuellement pour une action du plan. L'action doit exister, porter la même formation
 * et être encore « prévue » : elle passe « engagée ». Date postérieure à aujourd'hui, places entières.
 */
const creer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const fm = ctx.d.fm(str(p.f));
  if (!fm) throw new ActionError('Formation inconnue');
  if (fm.archive) throw new ActionError(refusArchive(fm, 'Formation')!);
  const err = controleSession(ctx.d.ti, { date: p.date, lieu: p.lieu, places: p.places, fin: p.fin, jours: p.jours, horaires: p.horaires });
  if (err) throw new ActionError(err);
  const plage = plageDe(p.date, p);
  let plan: PlanAction | undefined;
  if (p.planId != null && p.planId !== '') {
    plan = ctx.ds.plan.find(l => l.id === Number(p.planId));
    if (!plan) throw new ActionError('Action du plan introuvable');
    if (plan.f !== fm.id) throw new ActionError('L’action du plan porte sur une autre formation');
    if (plan.statut !== 'prevu') throw new ActionError(`Action du plan déjà ${plan.statut === 'engage' ? 'engagée' : plan.statut === 'reporte' ? 'reportée' : 'réalisée'}`);
    if (clotureDe(ctx.ds, plan.exercice)) throw new ActionError(`Action du plan ${plan.exercice} : exercice clos, il ne se modifie plus`);
  }
  const places = Number(p.places), lieu = str(p.lieu);
  const s = await ctx.db.insert<Session>('sessions', { formation: fm.id, date: p.date, ...plage, lieu, places, statut: 'À confirmer', planId: plan?.id ?? null, bilan: null });
  if (plan) await ctx.db.update<PlanAction>('planActions', plan.id, { statut: 'engage' });
  const pour = plage.fin === p.date ? `pour le ${fmt(parse(p.date))}` : plageTexte({ date: p.date, ...plage });
  return { message: `Session ${fm.court} créée ${pour} — ${plural(places, 'place', 'places')}${plan ? ' · action du plan engagée' : ''}`, result: { id: s.id } };
};

/** Confirmation par l'organisme : la liste nominative lui est transmise (affichée et exportée par l'interface). */
const confirmer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  if (s.statut === 'Confirmée') throw new ActionError('Session déjà confirmée');
  if (s.date < ctx.d.ti) throw new ActionError('Session passée : clôturez-la, ou annulez-la si elle n’a pas eu lieu');
  await ctx.db.update<Session>('sessions', s.id, { statut: 'Confirmée' });
  const n = inscritsDe(ctx.d, s).length;
  return `${nomSession(ctx, s)} confirmée — liste de ${plural(n, 'inscrit', 'inscrits')} à transmettre à ${ctx.d.fm(s.formation)?.organisme ?? 'l’organisme'}`;
};

/**
 * Date (premier jour), plage (dernier jour, jours, horaires), lieu, places. Une nouvelle date est postérieure à
 * aujourd'hui, sauf pour une session passée, à clôturer, qui se redate au jour où elle a eu lieu ; les places couvrent
 * les inscrits. Une nouvelle date postérieure à un recyclage déjà enregistré libère la place de la certification
 * remplacée (même règle que `cert.ajouter`). Pour une session à venir ou en cours, un changement de dates, d'horaires ou de lieu
 * rend caduques les convocations envoyées (elles repassent « à envoyer »), et de nouvelles dates sont à faire confirmer
 * par l'organisme (« à confirmer », pour une session pas encore commencée).
 */
const modifier: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  // Nouvelle date sans nouvelle plage (fin, jours) : la session garde sa forme, décalée d'autant.
  const decalee = p.date !== undefined && p.date !== s.date && p.fin === undefined && p.jours === undefined && typeof p.date === 'string' && isValidDate(p.date)
    ? decalerPlage(s, days(parse(s.date), parse(p.date))) : null;
  const v = {
    date: p.date ?? s.date, lieu: p.lieu ?? s.lieu, places: p.places ?? s.places,
    // Nouveau dernier jour sans les jours : les jours ouvrés de la nouvelle période.
    fin: p.fin ?? decalee?.fin ?? s.fin, jours: p.jours ?? decalee?.jours ?? (p.fin !== undefined && p.fin !== s.fin ? undefined : s.jours), horaires: p.horaires ?? s.horaires,
  };
  const err = controleSession(ctx.d.ti, v, { dateActuelle: s.date, inscrits: s.inscrits });
  if (err) throw new ActionError(err);
  const date = String(v.date), lieu = str(v.lieu), places = Number(v.places);
  const plage = plageDe(date, v);
  // Plage changée (premier ou dernier jour, jours de la session) : comme une nouvelle date ; horaires changés : comme un
  // nouveau lieu (convocations à renvoyer, sans nouvelle confirmation de l'organisme).
  const nouvellePlage = date !== s.date || plage.fin !== finSession(s) || plage.jours.join() !== s.jours.join();
  const nouveauxHoraires = JSON.stringify(plage.horaires) !== JSON.stringify(s.horaires);
  const changes = [
    nouvellePlage ? (plage.fin === date ? `date : ${fmt(parse(date))}` : `dates : ${plageTexte({ date, ...plage })}`) : '',
    nouveauxHoraires ? (plage.horaires.length ? `horaires : ${plage.horaires.length === 1 ? horaireTexte(plage.horaires[0]) : 'par jour'}` : 'sans horaire') : '',
    lieu !== s.lieu ? `lieu : ${lieu}` : '',
    places !== s.places ? plural(places, 'place', 'places') : '',
  ].filter(Boolean);
  if (!changes.length) return 'Aucune modification';
  // Nouvelle date postérieure à un recyclage déjà enregistré : la certification remplacée libère sa place, et la
  // convocation reçue pour la session (telle qu'elle était) est annulée par e-mail.
  const liberees = date !== s.date ? placesRemplacees(ctx.d, s.id, date) : [];
  let prevenus = 0;
  for (const x of liberees) if (await annulerSiConvoque(ctx, s, { id: x.empId, nom: ctx.d.personName(x.empId) }, x.c)) prevenus++;
  for (const x of liberees) await ctx.db.update<Certification>('certifications', x.c.id, { sessionId: null, convoc: null, convocLe: null });
  // Session passée corrigée après coup : plus de convocation ni de confirmation à demander. Session commencée, pas
  // finie (jours restants) : convocations à renvoyer, sans nouvelle confirmation (`session.confirmer` la refuse).
  const aVenir = date >= ctx.d.ti, pasFinie = plage.fin >= ctx.d.ti;
  let aRenvoyer = 0;
  if (pasFinie && (nouvellePlage || nouveauxHoraires || lieu !== s.lieu)) {
    for (const x of inscritsDe(ctx.d, s).filter(i => i.convoc === 'now' && !liberees.some(l => l.c.id === i.certId))) {
      if (x.certId) await ctx.db.update<Certification>('certifications', x.certId, { convoc: 'later' });
      else await ctx.db.update<Inscription>('inscriptions', x.inscriptionId!, { convoc: 'later' });
      aRenvoyer++;
    }
  }
  const reconfirmer = aVenir && nouvellePlage && s.statut === 'Confirmée';
  await ctx.db.update<Session>('sessions', s.id, { date, ...plage, lieu, places, ...(reconfirmer ? { statut: 'À confirmer' as const } : {}) });
  return [
    `${nomSession(ctx, s)} modifiée — ${changes.join(' · ')}`,
    liberees.length ? `recyclage déjà enregistré avant cette date, ${liberees.length > 1 ? 'places libérées' : 'place libérée'} : ${liberees.map(x => ctx.d.personName(x.empId)).join(', ')}` : '',
    prevenus ? `${plural(prevenus, 'annulation envoyée', 'annulations envoyées')} par e-mail` : '',
    aRenvoyer ? plural(aRenvoyer, 'convocation à renvoyer', 'convocations à renvoyer') : '',
    reconfirmer ? `nouvelle date à faire confirmer par ${ctx.d.fm(s.formation)?.organisme ?? 'l’organisme'}` : '',
  ].filter(Boolean).join(' · ');
};

/**
 * Annulation : les certifications rattachées redeviennent à planifier ; les inscriptions en formation
 * initiale restent attachées à la session annulée, à replanifier. L'action du plan engagée pour elle
 * (sans autre session ouverte) redevient « prévue ».
 */
const annuler: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id);
  const motif = str(p.motif) || null;
  if (motif && motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  const inscrits = inscritsDe(ctx.d, s);
  for (const c of ctx.ds.employes.flatMap(e => e.certs).filter(c => c.sessionId === s.id)) await ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null, convocLe: null });
  const plan = s.planId ? ctx.ds.plan.find(l => l.id === s.planId) : undefined;
  const replan = plan?.statut === 'engage' && !autreSessionDuPlan(ctx, s);
  if (replan) await ctx.db.update<PlanAction>('planActions', plan!.id, { statut: 'prevu' });
  const bilan: SessionBilan = { le: ctx.d.ti, par: ctx.user.nom, note: null, commentaire: null, motif };
  await ctx.db.update<Session>('sessions', s.id, { statut: 'Annulée', bilan });
  // Convocations déjà envoyées (même remises « à renvoyer » par un changement de date ou de lieu) : annulées par
  // e-mail avec le .ics d'annulation, sans le motif. Session passée : plus rien à annuler.
  let prevenus = 0;
  for (const i of inscrits) if (await annulerSiConvoque(ctx, s, { id: i.empId, nom: i.nom }, i, 'annulation')) prevenus++;
  return `${nomSession(ctx, s)} annulée${inscrits.length ? ` — ${plural(inscrits.length, 'inscrit à replanifier', 'inscrits à replanifier')}` : ''}${replan ? ' · action du plan de nouveau prévue' : ''}`
    + (prevenus ? ` · ${plural(prevenus, 'annulation envoyée', 'annulations envoyées')} par e-mail` : '');
};

/** Décision saisie pour un inscrit : présence et, si la formation l'exige, résultat de l'évaluation. */
interface Decision { empId: number; present: unknown; reussi?: unknown }

/**
 * Clôture d'une session passée (ou de son dernier jour). Pour chaque inscrit : présent et, si la formation l'exige,
 * reçu à l'évaluation → certification datée du dernier jour de la session ; absent ou échec → retour à planifier
 * (recyclage : certification détachée ; formation initiale : inscription à replanifier). Résultats
 * conservés (participations), action du plan réalisée, évaluation à chaud facultative.
 */
const cloturer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const s = sessionOf(ctx, p.id, true);
  if (s.statut === 'Clôturée') throw new ActionError('Session déjà clôturée');
  if (s.statut === 'Annulée') throw new ActionError('Session annulée : rien à clôturer');
  if (s.date > ctx.d.ti) throw new ActionError('La session n’a pas encore eu lieu');
  // Session sur plusieurs jours : clôturée à partir de son dernier jour, qui date les certifications.
  const dernier = finSession(s);
  if (dernier > ctx.d.ti) throw new ActionError(`La session dure jusqu’au ${fmt(parse(dernier))} : clôturez-la à partir de son dernier jour`);
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
      // Certification datée du dernier jour de la session ; la certification renouvelée garde la session (historique).
      certId = (await ctx.db.insert<Certification>('certifications', { empId: l.i.empId, f: s.formation, obtenue: dernier, sessionId: null, convoc: null })).id;
      if (l.i.inscriptionId) await ctx.db.remove('inscriptions', l.i.inscriptionId);
      obtenues++;
    } else if (!l.ok) {
      // Recyclage : la certification se planifie de nouveau. Formation initiale : l'inscription reste
      // attachée à la session clôturée, à replanifier.
      if (l.i.certId) await ctx.db.update<Certification>('certifications', l.i.certId, { sessionId: null, convoc: null });
      aReplanifier.push(l.i.nom);
    }
    await ctx.db.insert<Participation>('participations', { sessionId: s.id, empId: l.i.empId, parcours: l.i.parcours, present: l.present, reussi: l.reussi, certId });
  }
  // L'action du plan réalisée prend le coût réel saisi à la clôture (`coutReel`, prérempli du coût prévu ; le coût prévu
  // s'il n'est pas transmis) et, pour effectif réel, les présents de ses sessions clôturées. Le coût réel est réservé au
  // service RH : le référent HSE, sans droit sur le plan ni sur les enveloppes, clôt au coût prévu.
  const plan = s.planId ? ctx.ds.plan.find(x => x.id === s.planId) : undefined;
  const realise = !!plan && plan.statut !== 'realise' && plan.statut !== 'reporte' && !autreSessionDuPlan(ctx, s);
  if (realise) {
    const coutReel = !isRh(ctx) || p.coutReel === undefined || p.coutReel === null || p.coutReel === '' ? plan!.cout : montantReel(p.coutReel);
    if (coutReel === null) throw new ActionError('Coût réel de l’action du plan : montant en euros, 0 ou plus');
    const presents = Number((await ctx.db.one('SELECT COUNT(*) AS n FROM participations p JOIN sessions s ON s.id = p.session_id WHERE s.plan_id = ? AND p.present = TRUE', [plan!.id]) as { n: number }).n);
    await ctx.db.update<PlanAction>('planActions', plan!.id, { statut: 'realise', coutReel, effectifReel: presents });
  }
  const bilan: SessionBilan = { le: ctx.d.ti, par: ctx.user.nom, note, commentaire, motif: null };
  await ctx.db.update<Session>('sessions', s.id, { statut: 'Clôturée', bilan });
  return [
    `${nomSession(ctx, s)} clôturée — ${plural(obtenues, 'certification enregistrée', 'certifications enregistrées')}`,
    aReplanifier.length ? `à replanifier : ${aReplanifier.join(', ')}` : '',
    realise ? 'action du plan réalisée' : '',
  ].filter(Boolean).join(' · ');
};

export const sessionsActions = {
  'session.creer': creer,
  'session.confirmer': confirmer,
  'session.modifier': modifier,
  'session.annuler': annuler,
  'session.cloturer': cloturer,
} satisfies Record<string, ActionHandler>;
