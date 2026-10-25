// Formations, sessions, certifications, habilitations et demandes des collaborateurs.
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { certEnVigueur, Domain, habEnCours, sessionActive } from '../../../shared/domain.ts';
import { fmt, key, plural } from '../../../shared/format.ts';
import { blocage, conflitsSession, sessionsInscrit } from '../../../shared/rules/conflits.ts';
import { horsContratLe } from '../../../shared/rules/contrats.ts';
import { exerciceOuvert } from '../../../shared/rules/exercices.ts';
import { finSession } from '../../../shared/rules/plage-session.ts';
import { estAuDossier, relireDeclaration, retireeAuRefus } from '../../../shared/rules/formalites.ts';
import { refusArchive } from '../../../shared/rules/referentiels.ts';
import type { Certification, DemandeCollab, Employe, HabTitre, HabType, Inscription, PlanAction, SuiteDemande } from '../../../shared/types.ts';
import { jeuApres } from '../cache-instantane.ts';
import { loadFull } from '../dataset.ts';
import { auteurDe, inscrireDelivrance } from '../delivrances.ts';
import { suivreVerdicts } from '../integrations/keystone-verdicts.ts';
import { annulerSiConvoque, convoquerFormation, notifierDecisionDemande } from '../notifications.ts';
import {
  ActionError, type ActionHandler, aDroit, type Ctx, enriched, getEmp, isManagerOf, refuserSoiMeme, requireFormations, requireRh, REVIENT_FORMATIONS, REVIENT_RH, str,
} from './context.ts';
import { clore } from './inscriptions-closes.ts';
import { joindrePieces, retirerPiecesDe } from './pieces.ts';
import { appliquerFormalite, retirerFormalite } from './voyages.ts';
import { placesAProposer } from '../../../shared/rules/liste-attente.ts';
import { accepterEnAttente, ajusterPropositions, cloreAttenteInscrit, promouvoirAttente, promouvoirAttentes, retirerAttentesFormation } from '../liste-attente.ts';

/**
 * Inscrit d'une session passée, pas encore clôturée : seule la clôture (service RH) l'en sort, avec sa présence
 * et son résultat. Le déplacer avant la clôture effacerait sa participation.
 */
export function attendCloture(ctx: Ctx, sessionId: number | null) {
  const s = ctx.d.session(sessionId);
  if (s && sessionActive(s) && s.date < ctx.d.ti) {
    // Session de plusieurs jours commencée : elle se clôt à partir de son dernier jour.
    const enCours = finSession(s) >= ctx.d.ti ? ` en cours jusqu’au ${fmt(parse(finSession(s)))}` : ' passée';
    throw new ActionError(`Session du ${fmt(parse(s.date))}${enCours} : ${aDroit(ctx, 'formations') ? 'clôturez-la d’abord' : 'le service RH la clôture d’abord'} (présence, résultat)`);
  }
}

/**
 * Inscription à une session : recyclage d'une certification détenue (`certId`), ou formation initiale
 * à replanifier (`inscriptionId` : session annulée, absent, évaluation échouée). Le nombre d'inscrits est
 * calculé : changer de session libère la place de l'ancienne, sauf d'une session passée à clôturer ; la
 * convocation reçue pour l'ancienne session, si elle est à venir, est annulée par e-mail.
 */
const inscrire: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!aDroit(ctx, 'formations') && !isManagerOf(ctx, emp)) throw new ActionError('Inscription réservée au service RH, au référent HSE / formation ou au manager du collaborateur', 403);
  const initiale = p.inscriptionId != null;
  const cert = initiale ? undefined : emp.certs.find(c => c.id === Number(p.certId));
  const insc = initiale ? ctx.ds.inscriptions.find(i => i.id === Number(p.inscriptionId) && i.empId === emp.id) : undefined;
  const f = cert?.f ?? (insc && ctx.d.session(insc.sessionId)?.formation);
  const sess = ctx.d.session(Number(p.sessionId));
  if (!f || !sess) throw new ActionError(initiale ? 'Inscription ou session introuvable' : 'Certification ou session introuvable');
  if (sess.formation !== f) throw new ActionError('Session d’une autre formation');
  if (cert && certEnVigueur(emp.certs, cert.f) !== cert) throw new ActionError('Certification remplacée par un recyclage : planifiez la certification en vigueur');
  if (!sessionActive(sess)) throw new ActionError(`Session ${sess.statut === 'Annulée' ? 'annulée' : 'clôturée'}`);
  if (sess.date < ctx.d.ti) throw new ActionError('Session déjà passée');
  // Session sur plusieurs jours : aucun de ses jours après la fin du contrat (le dernier suffit à le dire).
  const hors = horsContratLe(emp, finSession(sess));
  if (hors) throw new ActionError(hors);
  attendCloture(ctx, (cert ?? insc)!.sessionId);
  if ((cert ?? insc)!.sessionId === sess.id || (insc && ctx.ds.inscriptions.some(i => i.empId === emp.id && i.sessionId === sess.id))) {
    return `${emp.nom} est déjà inscrit à cette session`;
  }
  if (sess.inscrits >= sess.places) throw new ActionError('Cette session est complète');
  // Places libres toutes proposées à la liste d'attente (lot 7, t120) : elles reviennent à la file, dans l'ordre, et le
  // service RH confirme. Le manager ne les prend pas ; le service RH et le référent HSE peuvent passer outre (urgence) :
  // les propositions en trop sont alors remises en attente, à leur rang (`ajusterPropositions`).
  const prisSurFile = placesAProposer(sess, (ctx.ds.attentesSession ?? []).filter(a => a.empId !== emp.id)) <= 0;
  if (prisSurFile && !aDroit(ctx, 'formations')) {
    throw new ActionError('Les places libres de cette session sont proposées à sa liste d’attente : le service RH confirme ces inscriptions dans l’ordre de la file');
  }
  // Absent un jour de la session (congé validé, arrêt…) ou inscrit à une autre session ce jour-là : refusé.
  const conflit = blocage(conflitsSession(ctx.d, emp.id, sess, { sessionId: (cert ?? insc)!.sessionId }));
  if (conflit) throw new ActionError(conflit);
  const conv = p.conv === 'later' ? 'later' : 'now';
  const convocLe = conv === 'now' ? ctx.d.ti : null;
  // Changement de session : la convocation de l'ancienne (à venir) est annulée avant l'envoi de la nouvelle.
  const ancienne = ctx.d.session((cert ?? insc)!.sessionId);
  const annulee = await annulerSiConvoque(ctx, ancienne, emp, cert ?? insc!);
  if (cert) await ctx.db.update<Certification>('certifications', cert.id, { sessionId: sess.id, convoc: conv, convocLe });
  else await ctx.db.update<Inscription>('inscriptions', insc!.id, { sessionId: sess.id, convoc: conv, date: ctx.d.ti, convocLe });
  // « Envoyer maintenant » : convocation par e-mail avec le fichier .ics (sans adresse : à remettre en main propre).
  const envoi = conv === 'now' && !await convoquerFormation(ctx, sess, emp, cert ? 'recyclage' : 'initiale') ? ' · convocation à remettre en main propre (aucune adresse e-mail)' : '';
  // Personne de la file inscrite directement : son attente est close ; place proposée prise par le service RH : la
  // proposition en trop revient en attente. Place libérée dans l'ancienne session : proposée à sa liste d'attente (lot 7,
  // t120, server/src/liste-attente.ts).
  await cloreAttenteInscrit(ctx, emp.id, sess.id);
  const attente = [await ajusterPropositions(ctx, sess.id), await promouvoirAttente(ctx, ancienne?.id)].filter(Boolean).join(' · ');
  return `${emp.nom} — inscription à la session du ${fmt(parse(sess.date))}${conv === 'now' ? envoi || ' · convocation envoyée' : ' · convocation à envoyer'}`
    + (annulee ? ` · convocation à la session du ${fmt(parse(ancienne!.date))} annulée par e-mail` : '') + (attente ? ` · ${attente}` : '');
};

const ajouterCert: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  // Séparation des tâches (lot 8, chantier C) : une certification ouvre des habilitations et le Go chantier.
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas ajouter une certification à votre propre dossier', REVIENT_FORMATIONS);
  const fm = ctx.d.fm(str(p.f));
  if (!fm) throw new ActionError('Formation inconnue');
  if (fm.archive) throw new ActionError(refusArchive(fm, 'Formation')!);
  if (!isValidDate(p.date)) throw new ActionError('Date d’obtention invalide');
  const avant = certEnVigueur(emp.certs, fm.id);
  // La certification obtenue clôt l'inscription en formation initiale correspondante ; elle la garde pour la rendre si
  // elle est annulée (saisie sur la mauvaise fiche, actions/inscriptions-closes.ts).
  const closes = await clore(ctx, emp, fm.id);
  const cert = await ctx.db.insert<Certification>('certifications', { empId: emp.id, f: fm.id, obtenue: p.date, sessionId: null, convoc: null, inscriptionsCloses: closes.length ? closes : null });
  // Attestation jointe (pièce justificative, actions/pieces.ts).
  const pieces = await joindrePieces(ctx, p.pieces, 'certification', cert.id, emp.id);
  // Liste d'attente (lot 7, t120) : certification en vigueur, ses attentes pour cette formation n'ont plus d'objet ; une place
  // qui lui était proposée se propose au suivant.
  const attentes = certEnVigueur([...emp.certs, cert], fm.id) === cert ? await retirerAttentesFormation(ctx, emp, fm.id) : { n: 0, sessions: [] };
  const sortiFile = attentes.n ? ` · retiré de ${attentes.n > 1 ? `${attentes.n} listes d’attente` : 'la liste d’attente'}` : '';
  const promues = await promouvoirAttentes(ctx, attentes.sessions);
  // Recyclage enregistré : une session ouverte, postérieure à l'obtention, n'a plus d'objet pour la certification
  // remplacée (qui ne se planifie plus) ; sa place est libérée. Une session antérieure ou du jour même garde
  // l'inscrit : c'est elle qui a produit le recyclage, sa clôture le constatera.
  const sess = avant && certEnVigueur([...emp.certs, cert], fm.id) === cert ? ctx.d.session(avant.sessionId) : null;
  if (sess && sessionActive(sess) && sess.date > p.date) {
    // La convocation reçue pour cette session, si elle est à venir, est annulée par e-mail.
    const annulee = await annulerSiConvoque(ctx, sess, emp, avant!);
    await ctx.db.update<Certification>('certifications', avant!.id, { sessionId: null, convoc: null, convocLe: null });
    // Place libérée : proposée à la liste d'attente de la session.
    const attente = [promues, await promouvoirAttente(ctx, sess.id)].filter(Boolean).join(' · ');
    return `${fm.court} ajoutée au dossier de ${emp.nom}${pieces} · inscription à la session du ${fmt(parse(sess.date))} annulée${annulee ? ' · annulation envoyée par e-mail' : ''}${sortiFile}${attente ? ` · ${attente}` : ''}`;
  }
  return `${fm.court} ajoutée au dossier de ${emp.nom}${pieces}${sortiFile}${promues ? ` · ${promues}` : ''}`;
};

const delivrerHab: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas vous délivrer une habilitation', REVIENT_FORMATIONS);
  const hm = ctx.d.hm(str(p.h));
  const par = str(p.par);
  if (!hm) throw new ActionError('Habilitation inconnue');
  if (hm.archive) throw new ActionError(refusArchive(hm, 'Habilitation')!);
  if (!isValidDate(p.date) || !par) throw new ActionError('Date de délivrance et signataire requis');
  const existing = emp.habs.find(h => h.h === hm.id);
  // Une suspension se lève explicitement ; après un retrait, une nouvelle délivrance reste possible.
  if (existing?.delivree && existing.mesure === 'suspension') throw new ActionError(`${hm.nom} suspendue pour ${emp.nom} — levez d’abord la suspension`);
  const retire = existing?.delivree && existing.mesure === 'retrait' ? existing : null;
  // Le retrait est définitif : une délivrance antidatée rétablirait l'ancien titre.
  if (retire?.mesureDate && p.date < retire.mesureDate) throw new ActionError(`Nouvelle délivrance antérieure au retrait du ${fmt(parse(retire.mesureDate))}`);
  const x = enriched(ctx).find(e => e.id === emp.id)!;
  const info = ctx.d.habInfo({ h: hm.id, delivree: p.date }, x.rawCerts, x.med, ctx.ds.settings.horizonAlerte);
  if (!info.prereqOk) throw new ActionError(`Délivrance impossible — ${info.failing.map(c => c.label).join(', ')}`);
  const entry = { delivree: p.date, par, demande: null, mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null };
  if (existing) await ctx.db.update<HabTitre>('habTitres', existing.id, entry);
  const titreId = existing ? existing.id : (await ctx.db.insert<HabTitre>('habTitres', { empId: emp.id, h: hm.id, ...entry })).id;
  // Historique (t115, server/src/delivrances.ts) : la délivrance précédente est close, mesure figée ; la nouvelle s'inscrit.
  await inscrireDelivrance(ctx.db, existing, titreId, { empId: emp.id, h: hm.id, delivree: p.date, par }, auteurDe(ctx.user, ctx.d.ti));
  // Titre signé joint (pièce justificative, actions/pieces.ts).
  const pieces = await joindrePieces(ctx, p.pieces, 'habTitre', titreId, emp.id);
  // Après un retrait ou une expiration, Keystone a reçu le No Go : il reçoit aussi le verdict rétabli.
  const { keystone } = await signaler(ctx, emp);
  return `${hm.nom} ${p.mode === 'renew' ? 'renouvelée' : 'délivrée'} — ${emp.nom} · valide jusqu’au ${fmt(addMonths(parse(p.date), hm.validite))}${pieces}${keystone}`;
};

/**
 * Décision sur une demande : formation et habilitation, service RH et référent HSE / formation ; document déclaré
 * (passeport, visa, vaccination), service RH seulement.
 */
function demandeADecider(ctx: Ctx, id: unknown): DemandeCollab {
  requireFormations(ctx);
  const r = ctx.ds.demandesCollab.find(x => x.id === Number(id));
  if (r?.type === 'document') requireRh(ctx);
  if (!r || r.statut !== 'attente') throw new ActionError('Demande introuvable ou déjà traitée');
  // Sa propre demande (formation, habilitation, document déclaré) : jamais décidée par soi-même (lot 8, chantier C).
  const emp = ctx.d.emp(r.empId);
  if (emp) refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas décider de votre propre demande', r.type === 'document' ? REVIENT_RH : REVIENT_FORMATIONS);
  return r;
}

const accepterDemande: ActionHandler = async (ctx, p) => {
  const r = demandeADecider(ctx, p.id);
  const emp = getEmp(ctx, r.empId);
  // Formation ou habilitation archivée depuis la demande : ni session, ni délivrance ne pourraient plus aboutir.
  const archivee = r.type === 'formation' && r.f ? refusArchive(ctx.d.fm(r.f), 'Formation')
    : r.type === 'habilitation' && r.h ? refusArchive(ctx.d.hm(r.h), 'Habilitation') : null;
  if (archivee) throw new ActionError(`${archivee}, ou refusez la demande`);
  // `suite` : ce que l'acceptation crée, que la réouverture (`demande.reouvrir`, actions/corrections.ts) défait.
  const done = async (reponse: string, suite: SuiteDemande = {}) => await ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'acceptee', reponse, suite });
  let suite: SuiteDemande = {};
  if (r.type === 'formation') {
    const demandee = r.sessionId && r.f
      ? ctx.ds.sessions.find(s => s.id === r.sessionId && s.formation === r.f && sessionActive(s) && s.date >= ctx.d.ti)
      : undefined;
    // Place libre qui n'est pas déjà proposée à la liste d'attente de la session (lot 7, t120).
    const sess = demandee && placesAProposer(demandee, ctx.ds.attentesSession ?? []) > 0 ? demandee : undefined;
    if (sess) {
      const cert = certEnVigueur(emp.certs, r.f!);
      // Absent le jour de la session, ou inscrit ailleurs ce jour-là : la demande ne peut pas être acceptée telle quelle.
      const quittee = cert ? cert.sessionId : ctx.ds.inscriptions.find(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === r.f)?.sessionId;
      const conflit = horsContratLe(emp, finSession(sess)) ?? blocage(conflitsSession(ctx.d, emp.id, sess, { sessionId: quittee }));
      if (conflit) throw new ActionError(`${conflit} : refusez la demande, ou inscrivez ${emp.nom} à une autre session depuis sa fiche`);
      // Le nombre d'inscrits est calculé : rattacher à la session libère l'éventuelle place d'une autre
      // (une session passée, à clôturer, garde ses inscrits jusqu'à la clôture).
      // Inscription déplacée d'une autre session à venir : la convocation reçue pour celle-ci est annulée par e-mail.
      if (cert) {
        // Recyclage : la certification en vigueur est rattachée à la session.
        if (cert.sessionId !== sess.id) {
          attendCloture(ctx, cert.sessionId);
          await annulerSiConvoque(ctx, ctx.d.session(cert.sessionId), emp, cert);
          suite = { sessionId: sess.id, certId: cert.id, depuis: cert.sessionId };
        }
        await ctx.db.update<Certification>('certifications', cert.id, { sessionId: sess.id, convoc: 'now', convocLe: ctx.d.ti });
      } else if (!ctx.ds.inscriptions.some(i => i.empId === emp.id && i.sessionId === sess.id)) {
        // Formation initiale : inscription suivie jusqu'à l'obtention de la certification. Une inscription de la
        // même formation (autre session, ou à replanifier) est déplacée plutôt que doublée.
        const existante = ctx.ds.inscriptions.find(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === r.f);
        if (existante) {
          attendCloture(ctx, existante.sessionId);
          await annulerSiConvoque(ctx, ctx.d.session(existante.sessionId), emp, existante);
          await ctx.db.update<Inscription>('inscriptions', existante.id, { sessionId: sess.id, convoc: 'now', date: ctx.d.ti, convocLe: ctx.d.ti });
          suite = { sessionId: sess.id, inscriptionId: existante.id, depuis: existante.sessionId };
        } else {
          const i = await ctx.db.insert<Inscription>('inscriptions', { empId: emp.id, sessionId: sess.id, convoc: 'now', date: ctx.d.ti, convocLe: ctx.d.ti });
          suite = { sessionId: sess.id, inscriptionId: i.id, cree: true };
        }
      }
      // Déjà dans la file de cette session (demande précédente) : son attente est close (lot 7, t120).
      await cloreAttenteInscrit(ctx, emp.id, sess.id);
      await done(`Inscrit à la session du ${fmt(parse(sess.date))} — convocation envoyée`, suite);
      // La convocation (e-mail et .ics) tient lieu de réponse au salarié ; le manager qui a fait la demande est prévenu.
      await notifierDecisionDemande(ctx, emp, r, true, await convoquerFormation(ctx, sess, emp, cert ? 'recyclage' : 'initiale'));
      // Session quittée pour celle-ci : sa place libérée est proposée à sa liste d'attente.
      const attente = suite.depuis ? await promouvoirAttente(ctx, suite.depuis) : '';
      return `${emp.nom} inscrit à la session du ${fmt(parse(sess.date))}${attente ? ` · ${attente}` : ''}`;
    }
    // Session demandée complète (lot 7, t120, server/src/liste-attente.ts) : le salarié prend son rang dans la liste
    // d'attente, sauf choix du plan de formation (`complete: 'plan'`) ou liste d'attente désactivée (Paramètres).
    if (demandee && ctx.ds.settings.formationsListeAttente && p.complete !== 'plan') return await accepterEnAttente(ctx, r, emp, demandee);
    if (!emp.equipe) throw new ActionError(`Affectez d’abord ${emp.nom} à une équipe pour l’inscrire au plan de formation`);
    // Exercice en cours, ou le suivant s'il est déjà clos (plan.cloturerExercice) : alors au premier trimestre.
    const ex = exerciceOuvert(ctx.ds, ctx.d.year);
    const tri = ex > ctx.d.year ? 'T1' : `T${Math.floor(ctx.d.today.getMonth() / 3) + 1}`;
    const l = await ctx.db.insert<PlanAction>('planActions', { exercice: ex, f: r.f, libelle: r.libelle, equipe: emp.equipe, periode: tri, effectif: 1, cout: r.f ? ctx.d.fm(r.f).cout : 0, statut: 'prevu', origine: 'demande' });
    // Session demandée complète : la réponse le dit, le salarié sait pourquoi il n'est pas inscrit.
    const complete = demandee ? `Session du ${fmt(parse(demandee.date))} complète — ajoutée` : 'Ajoutée';
    await done(`${complete} au plan de formation ${ex} (${tri})${demandee ? ' : le service RH vous inscrira à une prochaine session' : ''}`, { planId: l.id });
    await notifierDecisionDemande(ctx, emp, r, true);
    return `${emp.nom} — ${demandee ? `session du ${fmt(parse(demandee.date))} complète, ` : ''}demande ajoutée au plan de formation ${ex}`;
  }
  if (r.type === 'habilitation') {
    const t = emp.habs.find(h => h.h === r.h);
    // Titre retiré ou expiré : la demande acceptée reste attachée au titre jusqu'à la nouvelle délivrance, qui l'efface.
    // Le titre expiré le reste pour le Go / No Go ; l'onglet Habilitations le compte « en attente » de renouvellement.
    const retire = t?.delivree && t.mesure === 'retrait' ? t : null;
    const expire = t?.delivree && enriched(ctx).find(e => e.id === emp.id)?.habs.find(x => x.h === t.h)?.key === 'exp' ? t : null;
    if (retire || expire) {
      await ctx.db.update<HabTitre>('habTitres', (retire ?? expire)!.id, { demande: ctx.d.ti });
      suite = { habTitreId: (retire ?? expire)!.id, cree: false };
    } else if (r.h && !t) suite = { habTitreId: (await ctx.db.insert<HabTitre>('habTitres', { empId: emp.id, h: r.h, delivree: null, par: null, demande: ctx.d.ti })).id, cree: true };
    await done(expire ? 'Acceptée — renouvellement après contrôle des prérequis' : 'Acceptée — délivrance après contrôle des prérequis', suite);
    await notifierDecisionDemande(ctx, emp, r, true);
    return retire
      ? `${emp.nom} — ${ctx.d.hm(r.h!).nom} retirée : nouvelle délivrance à effectuer après contrôle des prérequis (onglet Habilitations)`
      : expire
        ? `${emp.nom} — ${ctx.d.hm(r.h!).nom} expirée : renouvellement en attente de délivrance (onglet Habilitations, « En attente »)`
        : `${emp.nom} — ${ctx.d.hm(r.h!).nom} en attente de délivrance (onglet Habilitations)`;
  }
  // Document déclaré : revalidé puis écrit dans le dossier (même transaction que la décision).
  // Une déclaration reprise d'une ancienne base, encore au dossier telle quelle, n'a rien à réécrire.
  if (!r.declaration || (r.declaration.dejaAuDossier && estAuDossier(emp, r.declaration))) {
    await done('Document contrôlé par le service RH');
    await notifierDecisionDemande(ctx, emp, r, true);
    return `${r.label} — ${emp.nom} · contrôlé`;
  }
  const x = relireDeclaration(ctx.d, r.declaration);
  if (typeof x === 'string') throw new ActionError(`Déclaration invalide — ${x}. Refusez-la et demandez une nouvelle saisie.`);
  const msg = await appliquerFormalite(ctx, emp, x);
  await done('Validée — enregistrée dans votre dossier');
  await notifierDecisionDemande(ctx, emp, r, true);
  return `${msg} · déclaration validée`;
};

const refuserDemande: ActionHandler = async (ctx, p) => {
  const r = demandeADecider(ctx, p.id);
  const emp = getEmp(ctx, r.empId);
  // Motif du refus, montré au collaborateur avec la réponse (l'écran l'exige ; un appel sans motif reste accepté).
  const motif = str(p.motif);
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  // Document déclaré : rien n'a été écrit dans le dossier, sauf pour une déclaration
  // antérieure à la validation RH, qui en est retirée (voir retireeAuRefus).
  const retire = retireeAuRefus(ctx.d, emp, r) && await retirerFormalite(ctx, emp, r.declaration!);
  const defaut = r.type !== 'document' ? 'Refusée par le service RH'
    : retire ? 'Refusée par le service RH — document retiré de votre dossier' : 'Refusée par le service RH — votre dossier n’a pas été modifié';
  await ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'refusee', reponse: str(p.reponse) || defaut, motifRefus: motif || null });
  // Document refusé : ses pièces (copie de passeport, carnet de vaccination) n'ont plus lieu d'être gardées (actions/pieces.ts).
  const pieces = r.type === 'document' ? await retirerPiecesDe(ctx, 'declaration', r.id, 'Déclaration refusée') : 0;
  await notifierDecisionDemande(ctx, emp, r, false);
  return `Demande refusée — ${emp.nom} notifié${retire ? ' · document retiré du dossier' : ''}${pieces ? ` · ${plural(pieces, 'pièce jointe effacée', 'pièces jointes effacées')}` : ''}`;
};

/** Demandeur d'une demande au RH : le collaborateur lui-même, ou son manager pour un membre de l'équipe. */
function demandeur(ctx: Ctx, p: Record<string, any>) {
  if (ctx.user.role === 'collaborateur') return { emp: getEmp(ctx, ctx.user.empId), parId: null };
  if (ctx.user.role === 'manager') {
    const emp = getEmp(ctx, p.empId);
    if (!isManagerOf(ctx, emp)) throw new ActionError('Ce collaborateur ne fait pas partie de votre équipe', 403);
    return { emp, parId: ctx.user.empId };
  }
  throw new ActionError('Le service RH inscrit directement les collaborateurs', 403);
}

/** Demandes envoyées depuis l'espace collaborateur ou par le manager pour son équipe. */
const demandeFormation: ActionHandler = async (ctx, p) => {
  const { emp, parId } = demandeur(ctx, p);
  const autre = p.f === 'autre' || !p.f;
  const libelle = str(p.libelle), motif = str(p.motif);
  if (!motif || (autre && !libelle)) throw new ActionError('Motif et intitulé requis');
  if (!autre && !ctx.d.fm(p.f)) throw new ActionError('Formation inconnue');
  if (!autre && ctx.d.fm(p.f).archive) throw new ActionError(refusArchive(ctx.d.fm(p.f), 'Formation')!);
  // Doublons : une demande identique attend la réponse du service RH (hors catalogue : même intitulé), ou le salarié
  // est déjà inscrit à une session à venir de cette formation.
  const qui = parId ? emp.nom : 'vous';
  const identique = ctx.ds.demandesCollab.some(r => r.empId === emp.id && r.type === 'formation' && r.statut === 'attente'
    && (autre ? !r.f && key(r.libelle) === key(libelle) : r.f === p.f));
  if (identique) throw new ActionError(`Une demande pour cette formation est déjà en cours pour ${qui}, en attente de réponse du service RH`);
  const inscrit = autre ? undefined : sessionsInscrit(ctx.d, emp.id).find(s => s.formation === p.f && s.date >= ctx.d.ti);
  if (inscrit) throw new ActionError(`${parId ? `${emp.nom} est` : 'Vous êtes'} déjà inscrit à la session du ${fmt(parse(inscrit.date))}`);
  if (p.sessionId) {
    const s = ctx.d.session(Number(p.sessionId));
    if (autre || !s || s.formation !== p.f || s.date < ctx.d.ti || !sessionActive(s)) throw new ActionError('Session invalide pour cette formation');
    const conflit = blocage(conflitsSession(ctx.d, emp.id, s));
    if (conflit) throw new ActionError(conflit);
  }
  await ctx.db.insert<DemandeCollab>('demandesCollab', {
    empId: emp.id, type: 'formation', f: autre ? null : p.f, h: null, libelle: autre ? libelle : null, label: null,
    sessionId: p.sessionId ? Number(p.sessionId) : null, motif, date: ctx.d.ti, statut: 'attente', reponse: null, parId,
  });
  return parId ? `Demande de formation pour ${emp.nom} envoyée au service RH` : 'Demande de formation envoyée au service RH';
};

const demandeHabilitation: ActionHandler = async (ctx, p) => {
  const { emp, parId } = demandeur(ctx, p);
  const motif = str(p.motif), hm = ctx.d.hm(str(p.h));
  if (!hm || !motif) throw new ActionError('Habilitation et motif requis');
  if (hm.archive) throw new ActionError(refusArchive(hm, 'Habilitation')!);
  const x = enriched(ctx).find(e => e.id === emp.id)!;
  const already = x.habs.some(h => h.h === hm.id && habEnCours(h))
    || ctx.ds.demandesCollab.some(r => r.empId === emp.id && r.type === 'habilitation' && r.h === hm.id && r.statut === 'attente');
  if (already) throw new ActionError(parId ? `${emp.nom} détient déjà ce titre, ou une demande est déjà en cours.` : 'Vous détenez déjà ce titre, ou une demande est déjà en cours.');
  await ctx.db.insert<DemandeCollab>('demandesCollab', {
    empId: emp.id, type: 'habilitation', f: null, h: hm.id, libelle: null, label: null, sessionId: null, motif, date: ctx.d.ti, statut: 'attente', reponse: null, parId,
  });
  return parId ? `Demande d’habilitation pour ${emp.nom} envoyée au service RH` : 'Demande d’habilitation envoyée au service RH';
};

// — Suspension et retrait des habilitations —

/** Titre délivré d'un collaborateur, désigné par son type (un titre par type et par collaborateur). */
function titreDelivre(ctx: Ctx, emp: Employe, h: unknown): { hm: HabType; t: HabTitre } {
  const hm = ctx.d.hm(str(h));
  if (!hm) throw new ActionError('Habilitation inconnue');
  const t = emp.habs.find(x => x.h === hm.id);
  if (!t?.delivree) throw new ActionError(`${emp.nom} ne détient pas ce titre`);
  return { hm, t };
}

/** Motif (obligatoire) et date (aujourd'hui par défaut, ni future ni antérieure à la délivrance) d'une mesure. */
function decision(ctx: Ctx, p: Record<string, any>, t: HabTitre) {
  const motif = str(p.motif);
  if (!motif) throw new ActionError('Motif obligatoire');
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  const date = p.date ? p.date : ctx.d.ti;
  if (!isValidDate(date)) throw new ActionError('Date invalide');
  if (date > ctx.d.ti) throw new ActionError('La date ne peut pas être postérieure à aujourd’hui');
  if (date < t.delivree!) throw new ActionError(`Date antérieure à la délivrance du titre (${fmt(parse(t.delivree!))})`);
  return { motif, date };
}

/**
 * Signale à Keystone les verdicts Go / No Go modifiés par l'écriture (suivi des verdicts transmis :
 * matricule et codes de motif uniquement). Renvoie l'état après l'écriture et le nombre de chantiers
 * signalés pour le collaborateur (aussi pour l'avis du médecin du travail : actions/sante.ts). Jeu des verdicts et état
 * d'après l'écriture dérivés du jeu de l'action (`ctx.ds`) et du delta de ses écritures (lot 9, `jeuApres`), sans relire
 * toute la base ; relecture complète si ce départ est inconnu (cache coupé, jeu remplacé).
 */
export async function signaler(ctx: Ctx, emp: Employe) {
  const signales = (await suivreVerdicts(ctx.db, { depart: ctx.ds })).filter(v => v.empId === emp.id).length;
  const apres = (await jeuApres(ctx.db, ctx.ds, ctx.user)) ?? await loadFull(ctx.db, ctx.user);
  return { apres: new Domain(apres), keystone: signales ? ` · ${plural(signales, 'chantier signalé', 'chantiers signalés')} à Keystone` : '' };
}

/** Enregistre la mesure, puis signale à Keystone les verdicts qu'elle modifie. */
async function mesurer(ctx: Ctx, emp: Employe, t: HabTitre, patch: Pick<HabTitre, 'mesure' | 'mesureDate' | 'mesureMotif' | 'mesurePar'>) {
  await ctx.db.update<HabTitre>('habTitres', t.id, patch);
  return await signaler(ctx, emp);
}

/** Suspension après un incident ou une restriction : RH, référent HSE, ou manager pour un membre de son équipe (jamais lui-même). */
const suspendreHab: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const gere = aDroit(ctx, 'formations');
  if (!gere && !isManagerOf(ctx, emp)) throw new ActionError('Suspension réservée au service RH, au référent HSE / formation ou au manager du collaborateur', 403);
  const { hm, t } = titreDelivre(ctx, emp, p.h);
  if (t.mesure === 'retrait') throw new ActionError(`${hm.nom} déjà retirée à ${emp.nom}`);
  if (t.mesure === 'suspension') throw new ActionError(`${hm.nom} déjà suspendue pour ${emp.nom}`);
  const { motif, date } = decision(ctx, p, t);
  const { keystone } = await mesurer(ctx, emp, t, { mesure: 'suspension', mesureDate: date, mesureMotif: motif, mesurePar: ctx.user.nom });
  return `${hm.nom} suspendue — ${emp.nom}${keystone}${gere ? '' : ' · levée réservée au service RH et au référent HSE'}`;
};

/** Levée de la suspension : service RH et référent HSE. Le titre redevient valide si ses prérequis et son échéance le permettent. */
const leverHab: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  // Se suspendre soi-même reste permis (cela restreint) ; lever sa propre suspension rétablirait le Go chantier.
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas lever la suspension de votre propre habilitation', REVIENT_FORMATIONS);
  const { hm, t } = titreDelivre(ctx, emp, p.h);
  if (t.mesure !== 'suspension') throw new ActionError(`${hm.nom} n’est pas suspendue pour ${emp.nom}`);
  const { apres, keystone } = await mesurer(ctx, emp, t, { mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null });
  const hi = apres.enrich(ctx.ds.settings.horizonAlerte, false).find(e => e.id === emp.id)?.habs.find(x => x.h === hm.id);
  const reste = hi && (hi.key === 'exp' || hi.key === 'susp') ? ` · titre toujours non valide (${hi.key === 'exp' ? 'expiré' : 'prérequis non satisfait'})` : '';
  return `Suspension levée — ${hm.nom} · ${emp.nom}${reste}${keystone}`;
};

/** Retrait définitif : service RH et référent HSE. Une nouvelle délivrance reste possible ensuite. */
const retirerHab: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  // Le retrait de son propre titre pourrait masquer une mesure (une suspension, son motif) : un autre la décide.
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas retirer votre propre habilitation', REVIENT_FORMATIONS);
  const { hm, t } = titreDelivre(ctx, emp, p.h);
  if (t.mesure === 'retrait') throw new ActionError(`${hm.nom} déjà retirée à ${emp.nom}`);
  const { motif, date } = decision(ctx, p, t);
  const { keystone } = await mesurer(ctx, emp, t, { mesure: 'retrait', mesureDate: date, mesureMotif: motif, mesurePar: ctx.user.nom });
  return `${hm.nom} retirée — ${emp.nom}${keystone}`;
};

export const conformiteActions = {
  'plan.inscrire': inscrire,
  'cert.ajouter': ajouterCert,
  'hab.delivrer': delivrerHab,
  'hab.suspendre': suspendreHab,
  'hab.lever': leverHab,
  'hab.retirer': retirerHab,
  'demande.accepter': accepterDemande,
  'demande.refuser': refuserDemande,
  'demande.formation': demandeFormation,
  'demande.habilitation': demandeHabilitation,
} satisfies Record<string, ActionHandler>;
