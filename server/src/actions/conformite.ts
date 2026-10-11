// Formations, sessions, certifications, habilitations et demandes des collaborateurs.
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { estAuDossier, relireDeclaration, retireeAuRefus } from '../../../shared/rules/formalites.ts';
import type { Certification, DemandeCollab, HabTitre, Inscription, Session } from '../../../shared/types.ts';
import { ActionError, enriched, getEmp, isManagerOf, isRh, requireRh, str, type ActionHandler, type Ctx } from './context.ts';
import { appliquerFormalite, retirerFormalite } from './voyages.ts';

const inscrire: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!isRh(ctx) && !isManagerOf(ctx, emp)) throw new ActionError('Inscription réservée au service RH ou au manager du collaborateur', 403);
  const cert = emp.certs.find(c => c.id === Number(p.certId));
  const sess = ctx.d.session(Number(p.sessionId));
  if (!cert || !sess) throw new ActionError('Certification ou session introuvable');
  if (sess.formation !== cert.f) throw new ActionError('Session d’une autre formation');
  if (sess.date < ctx.d.ti) throw new ActionError('Session déjà passée');
  if (cert.sessionId === sess.id) return `${emp.nom} est déjà inscrit à cette session`;
  if (sess.inscrits >= sess.places) throw new ActionError('Cette session est complète');
  const conv = p.conv === 'later' ? 'later' : 'now';
  // Changement de session : la place de l'ancienne session est libérée.
  const ancienne = ctx.d.session(cert.sessionId);
  if (ancienne && ancienne.date >= ctx.d.ti) ctx.db.update<Session>('sessions', ancienne.id, { inscrits: Math.max(0, ancienne.inscrits - 1) });
  ctx.db.update<Certification>('certifications', cert.id, { sessionId: sess.id, convoc: conv });
  ctx.db.update<Session>('sessions', sess.id, { inscrits: sess.inscrits + 1 });
  return `${emp.nom} — inscription à la session du ${fmt(parse(sess.date))}${conv === 'now' ? ' · convocation envoyée' : ' · convocation à envoyer'}`;
};

const ajouterCert: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const fm = ctx.d.fm(str(p.f));
  if (!fm) throw new ActionError('Formation inconnue');
  if (!isValidDate(p.date)) throw new ActionError('Date d’obtention invalide');
  ctx.db.insert<Certification>('certifications', { empId: emp.id, f: fm.id, obtenue: p.date, sessionId: null, convoc: null });
  // La certification obtenue clôt l'inscription en formation initiale correspondante.
  ctx.ds.inscriptions.filter(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === fm.id).forEach(i => ctx.db.remove('inscriptions', i.id));
  return `${fm.court} ajoutée au dossier de ${emp.nom}`;
};

const creerSession: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const fm = ctx.d.fm(str(p.f));
  const places = Number(p.places), lieu = str(p.lieu);
  if (!fm) throw new ActionError('Formation inconnue');
  if (!isValidDate(p.date) || !lieu || !(places > 0)) throw new ActionError('Date, lieu et nombre de places requis');
  const s = ctx.db.insert<Session>('sessions', { formation: fm.id, date: p.date, lieu, places, inscrits: 0, statut: 'À confirmer' });
  if (p.planId) ctx.db.update('planActions', Number(p.planId), { statut: 'engage' });
  return { message: `Session ${fm.court} créée pour le ${fmt(parse(p.date))} — ${places} places`, result: { id: s.id } };
};

const delivrerHab: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const hm = ctx.d.hm(str(p.h));
  const par = str(p.par);
  if (!hm) throw new ActionError('Habilitation inconnue');
  if (!isValidDate(p.date) || !par) throw new ActionError('Date de délivrance et signataire requis');
  const x = enriched(ctx).find(e => e.id === emp.id)!;
  const info = ctx.d.habInfo({ h: hm.id, delivree: p.date }, x.rawCerts, x.med, ctx.ds.settings.horizonAlerte);
  if (!info.prereqOk) throw new ActionError(`Délivrance impossible — ${info.failing.map(c => c.label).join(', ')}`);
  const existing = emp.habs.find(h => h.h === hm.id);
  const entry = { delivree: p.date, par, demande: null };
  if (existing) ctx.db.update<HabTitre>('habTitres', existing.id, entry);
  else ctx.db.insert<HabTitre>('habTitres', { empId: emp.id, h: hm.id, ...entry });
  return `${hm.nom} ${p.mode === 'renew' ? 'renouvelée' : 'délivrée'} — ${emp.nom} · valide jusqu’au ${fmt(addMonths(parse(p.date), hm.validite))}`;
};

const demanderVisite: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  return `Demande de visite médicale transmise au service de santé au travail — ${emp.nom}`;
};

const accepterDemande: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const r = ctx.ds.demandesCollab.find(x => x.id === Number(p.id));
  if (!r || r.statut !== 'attente') throw new ActionError('Demande introuvable ou déjà traitée');
  const emp = getEmp(ctx, r.empId);
  const done = (reponse: string) => ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'acceptee', reponse });
  if (r.type === 'formation') {
    const sess = r.sessionId && r.f
      ? ctx.ds.sessions.find(s => s.id === r.sessionId && s.formation === r.f && s.date >= ctx.d.ti && s.inscrits < s.places)
      : undefined;
    if (sess) {
      const certs = emp.certs.filter(c => c.f === r.f);
      if (certs.length) {
        // Recyclage : la certification la plus récente est rattachée à la session (l'ancienne place est libérée).
        const cert = [...certs].sort((a, b) => b.obtenue.localeCompare(a.obtenue))[0];
        const ancienne = ctx.d.session(cert.sessionId);
        if (ancienne && ancienne.id !== sess.id && ancienne.date >= ctx.d.ti) ctx.db.update<Session>('sessions', ancienne.id, { inscrits: Math.max(0, ancienne.inscrits - 1) });
        if (cert.sessionId !== sess.id) ctx.db.update<Session>('sessions', sess.id, { inscrits: sess.inscrits + 1 });
        ctx.db.update<Certification>('certifications', cert.id, { sessionId: sess.id, convoc: 'now' });
      } else if (!ctx.ds.inscriptions.some(i => i.empId === emp.id && i.sessionId === sess.id)) {
        // Formation initiale : inscription suivie jusqu'à l'obtention de la certification.
        ctx.db.insert<Inscription>('inscriptions', { empId: emp.id, sessionId: sess.id, convoc: 'now', date: ctx.d.ti });
        ctx.db.update<Session>('sessions', sess.id, { inscrits: sess.inscrits + 1 });
      }
      done(`Inscrit à la session du ${fmt(parse(sess.date))} — convocation envoyée`);
      return `${emp.nom} inscrit à la session du ${fmt(parse(sess.date))}`;
    }
    if (!emp.equipe) throw new ActionError(`Affectez d’abord ${emp.nom} à une équipe pour l’inscrire au plan de formation`);
    const ex = ctx.d.year;
    const tri = `T${Math.floor(ctx.d.today.getMonth() / 3) + 1}`;
    ctx.db.insert('planActions', { exercice: ex, f: r.f, libelle: r.libelle, equipe: emp.equipe, periode: tri, effectif: 1, cout: r.f ? ctx.d.fm(r.f).cout : 0, statut: 'prevu', origine: 'demande' });
    done(`Ajoutée au plan de formation ${ex} (${tri})`);
    return `${emp.nom} — demande ajoutée au plan de formation ${ex}`;
  }
  if (r.type === 'habilitation') {
    if (r.h && !emp.habs.some(h => h.h === r.h)) ctx.db.insert<HabTitre>('habTitres', { empId: emp.id, h: r.h, delivree: null, par: null, demande: ctx.d.ti });
    done('Acceptée — délivrance après contrôle des prérequis');
    return `${emp.nom} — ${ctx.d.hm(r.h!).nom} en attente de délivrance (onglet Habilitations)`;
  }
  // Document déclaré : revalidé puis écrit dans le dossier (même transaction que la décision).
  // Une déclaration reprise d'une ancienne base, encore au dossier telle quelle, n'a rien à réécrire.
  if (!r.declaration || (r.declaration.dejaAuDossier && estAuDossier(emp, r.declaration))) {
    done('Document contrôlé par le service RH');
    return `${r.label} — ${emp.nom} · contrôlé`;
  }
  const x = relireDeclaration(ctx.d, r.declaration);
  if (typeof x === 'string') throw new ActionError(`Déclaration invalide — ${x}. Refusez-la et demandez une nouvelle saisie.`);
  const msg = appliquerFormalite(ctx, emp, x);
  done('Validée — enregistrée dans votre dossier');
  return `${msg} · déclaration validée`;
};

const refuserDemande: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const r = ctx.ds.demandesCollab.find(x => x.id === Number(p.id));
  if (!r || r.statut !== 'attente') throw new ActionError('Demande introuvable ou déjà traitée');
  const emp = getEmp(ctx, r.empId);
  // Document déclaré : rien n'a été écrit dans le dossier, sauf pour une déclaration
  // antérieure à la validation RH, qui en est retirée (voir retireeAuRefus).
  const retire = retireeAuRefus(ctx.d, emp, r) && retirerFormalite(ctx, emp, r.declaration!);
  const defaut = r.type !== 'document' ? 'Refusée par le service RH'
    : retire ? 'Refusée par le service RH — document retiré de votre dossier' : 'Refusée par le service RH — votre dossier n’a pas été modifié';
  ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'refusee', reponse: str(p.reponse) || defaut });
  return `Demande refusée — ${emp.nom} notifié${retire ? ' · document retiré du dossier' : ''}`;
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
const demandeFormation: ActionHandler = (ctx, p) => {
  const { emp, parId } = demandeur(ctx, p);
  const autre = p.f === 'autre' || !p.f;
  const libelle = str(p.libelle), motif = str(p.motif);
  if (!motif || (autre && !libelle)) throw new ActionError('Motif et intitulé requis');
  if (!autre && !ctx.d.fm(p.f)) throw new ActionError('Formation inconnue');
  if (p.sessionId) {
    const s = ctx.d.session(Number(p.sessionId));
    if (autre || !s || s.formation !== p.f || s.date < ctx.d.ti) throw new ActionError('Session invalide pour cette formation');
  }
  ctx.db.insert<DemandeCollab>('demandesCollab', {
    empId: emp.id, type: 'formation', f: autre ? null : p.f, h: null, libelle: autre ? libelle : null, label: null,
    sessionId: p.sessionId ? Number(p.sessionId) : null, motif, date: ctx.d.ti, statut: 'attente', reponse: null, parId,
  });
  return parId ? `Demande de formation pour ${emp.nom} envoyée au service RH` : 'Demande de formation envoyée au service RH';
};

const demandeHabilitation: ActionHandler = (ctx, p) => {
  const { emp, parId } = demandeur(ctx, p);
  const motif = str(p.motif), hm = ctx.d.hm(str(p.h));
  if (!hm || !motif) throw new ActionError('Habilitation et motif requis');
  const x = enriched(ctx).find(e => e.id === emp.id)!;
  const already = x.habs.some(h => h.h === hm.id && h.key !== 'exp')
    || ctx.ds.demandesCollab.some(r => r.empId === emp.id && r.type === 'habilitation' && r.h === hm.id && r.statut === 'attente');
  if (already) throw new ActionError(parId ? `${emp.nom} détient déjà ce titre, ou une demande est déjà en cours.` : 'Vous détenez déjà ce titre, ou une demande est déjà en cours.');
  ctx.db.insert<DemandeCollab>('demandesCollab', {
    empId: emp.id, type: 'habilitation', f: null, h: hm.id, libelle: null, label: null, sessionId: null, motif, date: ctx.d.ti, statut: 'attente', reponse: null, parId,
  });
  return parId ? `Demande d’habilitation pour ${emp.nom} envoyée au service RH` : 'Demande d’habilitation envoyée au service RH';
};

export const conformiteActions: Record<string, ActionHandler> = {
  'plan.inscrire': inscrire,
  'cert.ajouter': ajouterCert,
  'session.creer': creerSession,
  'hab.delivrer': delivrerHab,
  'medical.demander': demanderVisite,
  'demande.accepter': accepterDemande,
  'demande.refuser': refuserDemande,
  'demande.formation': demandeFormation,
  'demande.habilitation': demandeHabilitation,
};
