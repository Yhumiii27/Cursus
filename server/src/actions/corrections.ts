// Corrections d'une saisie erronée (t119, shared/rules/corrections.ts) : certification (modifier : service RH et référent
// HSE ; annuler : administrateur RH), ligne du plan de formation (modifier : service RH ; supprimer : administrateur RH),
// demande au service RH (retirer : son auteur, tant qu'elle attend ; rouvrir : service RH et référent HSE). Rien n'est
// supprimé : la certification ou la ligne annulée garde la date, l'auteur et le motif de l'annulation et sort de tous les
// calculs (server/src/dataset.ts). Motif obligatoire pour le service RH, gardé dans Cursus, jamais recopié au journal.
import { certEnVigueur, sessionActive } from '../../../shared/domain.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, fmtEur } from '../../../shared/format.ts';
import {
  auteurDemande, certsApres, demandeRetirable, demandeRouvrable, effectifPlan, erreurMotifCorrection, erreursLignePlan, habilitationsAppuyees,
  ligneCorrigeable, refusAppui, refusSuppressionLigne, sessionsDeLaLigne, suiteAcceptation,
} from '../../../shared/rules/corrections.ts';
import { montantReel } from '../../../shared/rules/exercices.ts';
import { refusArchive } from '../../../shared/rules/referentiels.ts';
import type { Certification, DemandeCollab, Employe, HabTitre, Inscription, Participation, PlanAction, Trimestre } from '../../../shared/types.ts';
import { annulerSiConvoque } from '../notifications.ts';
import { refuserExerciceClos } from './budget.ts';
import { attendCloture, signaler } from './conformite.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, refuserSoiMeme, requireFormations, requireRh, requireRhAdmin, str } from './context.ts';

/** Motif d'une correction : obligatoire, 500 caractères au plus. */
function motifDe(p: Record<string, any>): string {
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  return str(p.motif);
}

/** Marque d'une correction ou d'une annulation : jour, auteur, motif. */
const marque = (ctx: Ctx, prefixe: 'corrige' | 'annule' | 'rouverte', motif: string) =>
  ({ [`${prefixe}Le`]: ctx.d.ti, [`${prefixe}Par`]: ctx.user.nom, [`${prefixe}Motif`]: motif });

// — Certifications —

/** Certification du dossier (non annulée) et son titulaire. */
function certOf(ctx: Ctx, id: unknown): { emp: Employe; c: Certification } {
  const c = ctx.ds.employes.flatMap(e => e.certs).find(x => x.id === Number(id));
  if (!c) throw new ActionError('Certification introuvable ou déjà supprimée', 404);
  return { emp: getEmp(ctx, c.empId), c };
}

const nomCert = (ctx: Ctx, c: Pick<Certification, 'f' | 'obtenue'>) => `${ctx.d.fm(c.f)?.court ?? c.f} du ${fmt(parse(c.obtenue))}`;

/**
 * La certification quitte la session ouverte où elle est inscrite (recyclage planifié) : place libérée, convocation reçue
 * annulée par e-mail. Une session commencée ou passée, pas encore clôturée, attend d'abord sa clôture (présence, résultat).
 */
function quitterSession(ctx: Ctx, emp: Employe, c: Certification): string {
  const s = ctx.d.session(c.sessionId);
  if (!s || !sessionActive(s)) return '';
  attendCloture(ctx, s.id);
  const annulee = annulerSiConvoque(ctx, s, emp, c);
  ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null, convocLe: null });
  return `inscription à la session du ${fmt(parse(s.date))} annulée${annulee ? ' · annulation envoyée par e-mail' : ''}`;
}

/** Résultat de clôture qui désignait la certification : il ne la désigne plus (présence gardée). */
function detacherParticipations(ctx: Ctx, c: Certification) {
  ctx.ds.participations.filter(x => x.certId === c.id).forEach(x => ctx.db.update<Participation>('participations', x.id, { certId: null }));
}

/**
 * Après la correction, une certification remplacée par une plus récente ne se planifie plus : sa place dans une session
 * ouverte postérieure à la certification en vigueur est libérée (règle de `cert.ajouter`).
 */
function libererRemplacees(ctx: Ctx, emp: Employe, certs: Certification[], formations: string[]): string[] {
  const msgs: string[] = [];
  for (const f of new Set(formations)) {
    const vig = certEnVigueur(certs, f);
    for (const c of certs.filter(x => x.f === f && x !== vig && x.sessionId)) {
      const s = ctx.d.session(c.sessionId);
      if (!vig || !s || !sessionActive(s) || s.date <= vig.obtenue) continue;
      const annulee = annulerSiConvoque(ctx, s, emp, c);
      ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null, convocLe: null });
      msgs.push(`certification remplacée retirée de la session du ${fmt(parse(s.date))}${annulee ? ' · annulation envoyée par e-mail' : ''}`);
    }
  }
  return msgs;
}

/**
 * Correction d'une certification saisie avec une mauvaise date ou une mauvaise formation (service RH, référent HSE),
 * motif obligatoire. Refusée si une habilitation délivrée s'appuie sur elle sans autre certification valide (la suspendre
 * d'abord). Nouvelle formation : la session de recyclage de l'ancienne est quittée, le résultat de clôture ne la désigne
 * plus, l'inscription en formation initiale à la nouvelle est close (comme `cert.ajouter`).
 */
const modifierCert: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const { emp, c } = certOf(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Correction de votre propre certification');
  const f = p.f === undefined ? c.f : str(p.f);
  const fm = ctx.d.fm(f);
  if (!fm) throw new ActionError('Formation inconnue');
  if (fm.archive && f !== c.f) throw new ActionError(refusArchive(fm, 'Formation')!);
  const date = p.date === undefined ? c.obtenue : p.date;
  if (!isValidDate(date)) throw new ActionError('Date d’obtention invalide');
  if (date > ctx.d.ti) throw new ActionError('La date d’obtention ne peut pas être postérieure à aujourd’hui');
  if (f === c.f && date === c.obtenue) return 'Aucune modification';
  const motif = motifDe(p);
  const apres = certsApres(emp.certs, c.id, { f, obtenue: date });
  const refus = refusAppui(habilitationsAppuyees(ctx.d, emp, apres), 'modifier');
  if (refus) throw new ActionError(refus);
  const suites: string[] = [];
  if (f !== c.f) {
    suites.push(quitterSession(ctx, emp, c));
    detacherParticipations(ctx, c);
    ctx.ds.inscriptions.filter(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === f).forEach(i => ctx.db.remove('inscriptions', i.id));
  }
  ctx.db.update<Certification>('certifications', c.id, { f, obtenue: date, ...(f !== c.f ? { sessionId: null, convoc: null, convocLe: null } : {}), ...marque(ctx, 'corrige', motif) });
  suites.push(...libererRemplacees(ctx, emp, apres.map(x => (x.id === c.id && f !== c.f ? { ...x, sessionId: null } : x)), [c.f, f]));
  const { keystone } = signaler(ctx, emp);
  const quoi = [f !== c.f ? `formation : ${fm.court}` : '', date !== c.obtenue ? `obtenue le ${fmt(parse(date))}` : ''].filter(Boolean).join(', ');
  return [`${nomCert(ctx, c)} corrigée — ${emp.nom} · ${quoi}`, ...suites.filter(Boolean)].join(' · ') + keystone;
};

/**
 * Annulation d'une certification saisie par erreur (administrateur RH), motif obligatoire : elle reste en base, hors de tous
 * les calculs ; la précédente de la même formation, s'il y en a une, redevient en vigueur. Refusée si une habilitation
 * délivrée s'appuie sur elle sans autre certification valide (la suspendre d'abord). Sa place de session est libérée.
 */
const annulerCert: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const { emp, c } = certOf(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Suppression de votre propre certification');
  const motif = motifDe(p);
  const apres = certsApres(emp.certs, c.id);
  const refus = refusAppui(habilitationsAppuyees(ctx.d, emp, apres), 'annuler');
  if (refus) throw new ActionError(refus);
  const session = quitterSession(ctx, emp, c);
  detacherParticipations(ctx, c);
  ctx.db.update<Certification>('certifications', c.id, { sessionId: null, convoc: null, convocLe: null, ...marque(ctx, 'annule', motif) });
  const precedente = certEnVigueur(apres, c.f);
  const { keystone } = signaler(ctx, emp);
  return [
    `${nomCert(ctx, c)} supprimée du dossier de ${emp.nom}`,
    precedente && certEnVigueur(emp.certs, c.f) === c ? `certification du ${fmt(parse(precedente.obtenue))} de nouveau en vigueur` : '',
    session,
  ].filter(Boolean).join(' · ') + keystone;
};

// — Plan de formation —

function ligneOf(ctx: Ctx, id: unknown): PlanAction {
  const l = ctx.ds.plan.find(x => x.id === Number(id));
  if (!l) throw new ActionError('Action du plan introuvable ou déjà supprimée', 404);
  return l;
}

const nomLigne = (ctx: Ctx, l: Pick<PlanAction, 'f' | 'libelle' | 'equipe'>) => `${l.f ? ctx.d.fm(l.f)?.court ?? l.f : l.libelle} — ${l.equipe}`;

/**
 * Correction d'une ligne prévue ou engagée d'un exercice ouvert (service RH) : formation ou intitulé, équipe, trimestre,
 * effectif, coût prévu ; motif obligatoire. Une ligne rattachée à une session ouverte garde sa formation.
 */
const modifierLigne: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const l = ligneOf(ctx, p.id);
  if (!ligneCorrigeable(l)) throw new ActionError(`${nomLigne(ctx, l)} : action ${l.statut === 'realise' ? 'réalisée' : 'reportée'}, elle ne se modifie plus`);
  refuserExerciceClos(ctx, l.exercice);
  const v = {
    f: p.f === undefined ? l.f : str(p.f) || null,
    libelle: p.libelle === undefined ? l.libelle ?? '' : str(p.libelle),
    equipe: p.equipe === undefined ? l.equipe : str(p.equipe),
    periode: p.periode === undefined ? l.periode : str(p.periode),
    effectif: p.effectif === undefined ? l.effectif : p.effectif,
    cout: p.cout === undefined ? l.cout : p.cout,
  };
  const erreur = Object.values(erreursLignePlan(ctx.d, l, v)).find(Boolean);
  if (erreur) throw new ActionError(erreur.replace(/\.$/, ''));
  const patch = {
    f: v.f, libelle: v.f ? l.libelle : v.libelle.trim(), equipe: v.equipe, periode: v.periode as Trimestre, effectif: effectifPlan(v.effectif)!, cout: montantReel(v.cout)!,
  };
  const changes = [
    patch.f !== l.f || (!patch.f && patch.libelle !== l.libelle) ? `formation : ${patch.f ? ctx.d.fm(patch.f).court : patch.libelle}` : '',
    patch.equipe !== l.equipe ? `équipe : ${patch.equipe}` : '',
    patch.periode !== l.periode ? `période : ${patch.periode}` : '',
    patch.effectif !== l.effectif ? `effectif : ${patch.effectif}` : '',
    patch.cout !== l.cout ? `coût prévu : ${fmtEur(patch.cout)}` : '',
  ].filter(Boolean);
  if (!changes.length) return 'Aucune modification';
  const motif = motifDe(p);
  ctx.db.update<PlanAction>('planActions', l.id, { ...patch, ...marque(ctx, 'corrige', motif) });
  return `${nomLigne(ctx, l)} (${l.exercice}) corrigée — ${changes.join(' · ')}`;
};

/**
 * Suppression d'une ligne prévue ou engagée d'un exercice ouvert, saisie par erreur (administrateur RH), motif
 * obligatoire : gardée en base, hors de l'instantané et des sommes. Refusée tant qu'une session ouverte y est rattachée.
 */
const supprimerLigne: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const l = ligneOf(ctx, p.id);
  const refus = refusSuppressionLigne(ctx.d, l);
  if (refus) throw new ActionError(`${nomLigne(ctx, l)} : ${refus}`);
  refuserExerciceClos(ctx, l.exercice);
  const motif = motifDe(p);
  ctx.db.update<PlanAction>('planActions', l.id, marque(ctx, 'annule', motif));
  return `${nomLigne(ctx, l)} supprimée du plan ${l.exercice} (${l.periode}, ${fmtEur(l.cout)} prévus)`;
};

// — Demandes au service RH —

function demandeOf(ctx: Ctx, id: unknown): DemandeCollab {
  const r = ctx.ds.demandesCollab.find(x => x.id === Number(id));
  if (!r) throw new ActionError('Demande introuvable', 404);
  return r;
}

/**
 * Retrait d'une demande encore en attente par son auteur : le collaborateur pour la sienne, le manager pour celle qu'il a
 * faite pour un membre de son équipe. Rien n'avait été créé : la demande passe « retirée ».
 */
const annulerDemande: ActionHandler = (ctx, p) => {
  const r = demandeOf(ctx, p.id);
  if (ctx.user.role === 'rh' || ctx.user.empId !== auteurDemande(r)) {
    throw new ActionError(r.parId && ctx.user.empId === r.empId ? 'Demande faite par votre manager : lui seul peut la retirer' : 'Seul l’auteur de la demande peut la retirer', 403);
  }
  if (r.type === 'document') throw new ActionError('Une déclaration de document se corrige par le service RH, qui la refuse');
  if (!demandeRetirable(r)) throw new ActionError('Demande déjà traitée par le service RH : elle ne se retire plus');
  ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'retiree', reponse: `Retirée le ${fmt(parse(ctx.d.ti))}` });
  return r.parId ? `Demande pour ${ctx.d.personName(r.empId)} retirée` : 'Demande retirée';
};

/**
 * Ce que l'acceptation a créé est défait : inscription à la session souhaitée (convocation annulée par e-mail ; le recyclage
 * ou l'inscription retrouve la session à venir qu'il avait quittée), ligne du plan prévue (supprimée, avec le motif), titre
 * d'habilitation en attente (retiré) ou demande inscrite sur un titre (effacée). Refus quand c'est déjà allé plus loin :
 * session commencée ou clôturée, ligne engagée, exercice clos, habilitation délivrée depuis.
 */
function defaireAcceptation(ctx: Ctx, r: DemandeCollab, emp: Employe, motif: string): string {
  const x = suiteAcceptation(ctx.d, r, emp);
  if (x.sessionId && (x.certId || x.inscriptionId)) {
    const s = ctx.d.session(x.sessionId);
    if (s?.statut === 'Clôturée') throw new ActionError(`Session du ${fmt(parse(s.date))} clôturée : la formation a eu lieu, la demande ne se rouvre plus`);
    if (!s || !sessionActive(s)) return '';
    attendCloture(ctx, s.id);
    const depuis = ctx.d.session(x.depuis ?? null);
    const retour = depuis && sessionActive(depuis) && depuis.date >= ctx.d.ti ? depuis : null;
    const cert = x.certId ? emp.certs.find(c => c.id === x.certId && c.sessionId === s.id) : undefined;
    const insc = x.inscriptionId ? ctx.ds.inscriptions.find(i => i.id === x.inscriptionId && i.sessionId === s.id) : undefined;
    if (!cert && !insc) return '';
    const annulee = annulerSiConvoque(ctx, s, emp, (cert ?? insc)!);
    // Recyclage : la certification retrouve la session à venir qu'elle avait quittée, sinon redevient à planifier.
    // Formation initiale : l'inscription créée par l'acceptation est retirée ; déplacée, elle retrouve sa session
    // d'origine (à venir, ou annulée ou clôturée : à replanifier).
    let revenue = !!retour;
    if (cert) ctx.db.update<Certification>('certifications', cert.id, { sessionId: retour?.id ?? null, convoc: retour ? 'later' : null, convocLe: null });
    else if (x.cree || !x.depuis || ctx.ds.inscriptions.some(i => i.empId === emp.id && i.sessionId === x.depuis)) {
      ctx.db.remove('inscriptions', insc!.id);
      revenue = false;
    } else ctx.db.update<Inscription>('inscriptions', insc!.id, { sessionId: x.depuis, convoc: 'later', convocLe: null });
    return `retiré de la session du ${fmt(parse(s.date))}${annulee ? ' · annulation envoyée par e-mail' : ''}${revenue ? ` · de nouveau inscrit à la session du ${fmt(parse(retour!.date))}, convocation à envoyer` : ''}`;
  }
  if (x.planId) {
    const l = ctx.ds.plan.find(y => y.id === x.planId);
    if (!l) return '';
    refuserExerciceClos(ctx, l.exercice);
    if (l.statut !== 'prevu' || sessionsDeLaLigne(ctx.d, l).length) {
      throw new ActionError(`La ligne du plan ${l.exercice} ajoutée par l’acceptation est déjà ${l.statut === 'prevu' ? 'rattachée à une session' : l.statut === 'engage' ? 'engagée' : l.statut === 'realise' ? 'réalisée' : 'reportée'} : la demande ne se rouvre plus`);
    }
    ctx.db.update<PlanAction>('planActions', l.id, marque(ctx, 'annule', motif));
    return `ligne retirée du plan de formation ${l.exercice}`;
  }
  if (x.habTitreId) {
    const t = emp.habs.find(h => h.id === x.habTitreId);
    if (!t) return '';
    if (x.cree && !t.delivree) {
      ctx.db.remove('habTitres', t.id);
      return 'titre en attente de délivrance retiré';
    }
    if (!t.demande) throw new ActionError(`${ctx.d.hm(t.h)?.nom ?? t.h} délivrée depuis l’acceptation : la demande ne se rouvre plus`);
    ctx.db.update<HabTitre>('habTitres', t.id, { demande: null });
    return 'demande effacée du titre';
  }
  return '';
}

/**
 * Réouverture d'une demande de formation ou d'habilitation acceptée ou refusée par erreur (service RH, référent HSE), motif
 * obligatoire : la demande revient « en attente », à décider de nouveau ; ce que l'acceptation avait créé est défait.
 */
const rouvrirDemande: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const r = demandeOf(ctx, p.id);
  if (r.type === 'document') throw new ActionError('Une déclaration de document ne se rouvre pas : le dossier a été mis à jour ; corrigez-le depuis la fiche');
  if (!demandeRouvrable(r)) throw new ActionError(r.statut === 'attente' ? 'Demande déjà en attente' : 'Demande retirée par son auteur : rien à rouvrir');
  const emp = getEmp(ctx, r.empId);
  refuserSoiMeme(ctx, emp, 'Réouverture de votre propre demande');
  const motif = motifDe(p);
  const defait = r.statut === 'acceptee' ? defaireAcceptation(ctx, r, emp, motif) : '';
  ctx.db.update<DemandeCollab>('demandesCollab', r.id, { statut: 'attente', reponse: null, motifRefus: null, suite: null, ...marque(ctx, 'rouverte', motif) });
  return `Demande de ${emp.nom} rouverte, à décider de nouveau${defait ? ` · ${defait}` : ''}`;
};

export const correctionsActions: Record<string, ActionHandler> = {
  'cert.modifier': modifierCert,
  'cert.annuler': annulerCert,
  'plan.modifier': modifierLigne,
  'plan.supprimer': supprimerLigne,
  'demande.annuler': annulerDemande,
  'demande.reouvrir': rouvrirDemande,
};
