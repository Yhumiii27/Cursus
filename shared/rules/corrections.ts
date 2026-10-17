// Corrections d'une saisie erronée (t119) : certification, ligne du plan de formation, demande au service RH.
// Rien n'est supprimé physiquement : une certification ou une ligne du plan annulée garde sa date, son auteur et son motif
// (`annuleLe`, `annulePar`, `annuleMotif`) et sort de tous les calculs, comme un déplacement annulé ; une demande retirée
// par son auteur passe « retirée », une demande rouverte par le service RH revient « en attente ». Motif obligatoire pour
// toute correction du service RH, gardé dans Cursus (jamais recopié au journal, réservé au service RH).
// Contrôles communs aux dialogues et au serveur (server/src/actions/corrections.ts).
import { certEnVigueur, sessionActive, type Domain } from '../domain.ts';
import { parse } from '../dates.ts';
import { fmt, key } from '../format.ts';
import { blocage, conflitsSession } from './conflits.ts';
import { horsContratLe } from './contrats.ts';
import { montantReel } from './exercices.ts';
import { finSession } from './plage-session.ts';
import type { Certification, DemandeCollab, Employe, Inscription, PlanAction, Session, SuiteDemande, Trimestre } from '../types.ts';

/** Longueur maximale d'un motif de correction (comme les motifs de refus et d'annulation). */
export const MOTIF_CORRECTION_MAX = 500;
/** Intitulé d'une action hors catalogue. */
export const LIBELLE_PLAN_MAX = 120;
/** Effectif prévu d'une ligne du plan. */
export const EFFECTIF_PLAN_MAX = 1000;
export const TRIMESTRES: readonly Trimestre[] = ['T1', 'T2', 'T3', 'T4'];

/** Motif obligatoire d'une correction, 500 caractères au plus ; null s'il convient. */
export function erreurMotifCorrection(motif: unknown): string | null {
  const m = typeof motif === 'string' ? motif.trim() : '';
  if (!m) return 'Motif de la correction obligatoire';
  if (m.length > MOTIF_CORRECTION_MAX) return `Motif trop long (${MOTIF_CORRECTION_MAX} caractères au plus)`;
  return null;
}

/** Habilitation délivrée dont un prérequis tomberait : nom du titre et formations concernées. */
export interface AppuiHabilitation { h: string; nom: string; formations: string[] }

/**
 * Habilitations délivrées et valides (ni suspendues, ni retirées, ni expirées) dont un prérequis de formation est
 * satisfait aujourd'hui et ne le serait plus avec `certsApres` à la place des certifications du dossier : celles qui
 * s'appuient sur la certification corrigée ou annulée sans autre certification valide de la même formation (la
 * précédente, revenue en vigueur, peut suffire). Une habilitation suspendue ou retirée ne s'appuie sur rien.
 */
export function habilitationsAppuyees(d: Domain, emp: Employe, certsApres: Certification[]): AppuiHabilitation[] {
  const horizon = d.ds.settings.horizonAlerte;
  const med = d.medInfo(emp);
  const avant = d.certsOf(emp, horizon).vigueur, apres = d.certsOf({ ...emp, certs: certsApres }, horizon).vigueur;
  return emp.habs.filter(t => t.delivree && !t.mesure && d.hm(t.h)).flatMap(t => {
    const a = d.habInfo(t, avant, med, horizon);
    if (a.key !== 'ok' && a.key !== 'due') return [];
    const b = d.habInfo(t, apres, med, horizon);
    const tombes = b.failing.filter(c => c.type === 'cert' && a.checks.some(x => x.type === 'cert' && x.f === c.f && x.ok));
    return tombes.length ? [{ h: t.h, nom: a.hm.nom, formations: tombes.map(c => c.label) }] : [];
  });
}

/** Refus d'une correction qui ferait tomber une habilitation délivrée : la suspendre d'abord (décision tracée). */
export function refusAppui(appuis: AppuiHabilitation[], quoi: 'modifier' | 'annuler'): string | null {
  if (!appuis.length) return null;
  const titres = appuis.map(a => `${a.nom} (${a.formations.join(', ')})`).join(', ');
  return `${quoi === 'annuler' ? 'Suppression' : 'Correction'} impossible : ${appuis.length > 1 ? 'les habilitations' : 'l’habilitation'} ${titres} `
    + `${appuis.length > 1 ? 's’appuient' : 's’appuie'} sur cette certification, sans autre certification valide. `
    + `Suspendez d’abord ${appuis.length > 1 ? 'ces habilitations' : 'l’habilitation'} (fiche du collaborateur), puis ${quoi === 'annuler' ? 'supprimez' : 'corrigez'} la certification.`;
}

/** Certifications du dossier après la correction : `id` modifiée (`patch`) ou retirée (`patch` absent). */
export function certsApres(certs: readonly Certification[], id: number, patch?: Pick<Certification, 'f' | 'obtenue'>): Certification[] {
  return patch ? certs.map(c => (c.id === id ? { ...c, ...patch } : c)) : certs.filter(c => c.id !== id);
}

/** Saisie d'une ligne du plan : formation du catalogue (`f`) ou intitulé hors catalogue, équipe, trimestre, effectif, coût. */
export interface SaisieLignePlan { f: string | null; libelle: string; equipe: string; periode: string; effectif: unknown; cout: unknown }
export interface ErreursLignePlan { formation: string | null; equipe: string | null; periode: string | null; effectif: string | null; cout: string | null }

/** Effectif saisi : entier de 1 à 1 000 ; null sinon. */
export function effectifPlan(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= EFFECTIF_PLAN_MAX ? n : null;
}

/**
 * Contrôle d'une ligne du plan modifiée (`plan.modifier`, dialogs/PlanLigneDialog.tsx), champ par champ. La formation et
 * l'équipe actuelles restent acceptées même archivée ou disparue ; une ligne rattachée à une session ouverte garde sa
 * formation (la session porte sur elle).
 */
export function erreursLignePlan(d: Domain, l: PlanAction, v: SaisieLignePlan): ErreursLignePlan {
  const fm = v.f ? d.ds.referentiels.formations.find(x => x.id === v.f) : null;
  const libelle = v.libelle.trim();
  const session = sessionsDeLaLigne(d, l).length > 0;
  const formation = v.f
    ? !fm ? 'Formation inconnue.'
      : fm.archive && v.f !== l.f ? 'Formation archivée : rétablissez-la d’abord (écran Référentiels).'
      : session && v.f !== l.f ? 'Une session est rattachée à cette ligne : sa formation ne change plus (annulez d’abord la session).' : null
    : !libelle ? 'Choisissez la formation ou indiquez l’intitulé.'
      : libelle.length > LIBELLE_PLAN_MAX ? `Intitulé trop long (${LIBELLE_PLAN_MAX} caractères au plus).`
      : session && l.f ? 'Une session est rattachée à cette ligne : sa formation ne change plus (annulez d’abord la session).' : null;
  return {
    formation,
    equipe: !v.equipe ? 'Choisissez l’équipe.' : !d.equipes.includes(v.equipe) && v.equipe !== l.equipe ? 'Équipe inconnue.' : null,
    periode: TRIMESTRES.includes(v.periode as Trimestre) ? null : 'Choisissez le trimestre.',
    effectif: v.effectif === '' || v.effectif == null ? 'Indiquez l’effectif.' : effectifPlan(v.effectif) == null ? `Nombre entier de 1 à ${EFFECTIF_PLAN_MAX}.` : null,
    cout: v.cout === '' || v.cout == null ? 'Indiquez le coût prévu.' : montantReel(v.cout) == null ? 'Montant en euros, 0 ou plus (1 000 000 € au plus).' : null,
  };
}

/** Sessions ouvertes (à venir ou à clôturer) rattachées à une ligne du plan. */
export const sessionsDeLaLigne = (d: Domain, l: Pick<PlanAction, 'id'>) => d.ds.sessions.filter(s => s.planId === l.id && sessionActive(s));

/** Ligne du plan modifiable ou supprimable : prévue ou engagée (une ligne réalisée ou reportée a eu lieu ou vit ailleurs). */
export const ligneCorrigeable = (l: Pick<PlanAction, 'statut'>) => l.statut === 'prevu' || l.statut === 'engage';

/**
 * Suppression d'une ligne refusée : réalisée ou reportée, ou rattachée à une session ouverte (l'annuler d'abord, ce qui
 * rend la ligne de nouveau « prévue »). null : supprimable.
 */
export function refusSuppressionLigne(d: Domain, l: PlanAction): string | null {
  if (!ligneCorrigeable(l)) return `Action ${l.statut === 'realise' ? 'réalisée' : 'reportée'} : elle ne se supprime plus`;
  const s = sessionsDeLaLigne(d, l);
  return s.length ? 'Une session est rattachée à cette action : annulez d’abord la session (écran Formations), puis supprimez la ligne' : null;
}

/** Demande que son auteur peut encore retirer : en attente, de formation ou d'habilitation. */
export const demandeRetirable = (r: Pick<DemandeCollab, 'statut' | 'type'>) => r.statut === 'attente' && r.type !== 'document';
/** Demande que le service RH peut rouvrir : acceptée ou refusée, de formation ou d'habilitation (un document a été écrit au dossier). */
export const demandeRouvrable = (r: Pick<DemandeCollab, 'statut' | 'type'>) => (r.statut === 'acceptee' || r.statut === 'refusee') && r.type !== 'document';
/**
 * Auteur d'une demande, seul à pouvoir la retirer : le collaborateur pour la sienne, le manager pour celle qu'il a faite
 * pour un membre de son équipe (`parId`).
 */
export const auteurDemande = (r: Pick<DemandeCollab, 'empId' | 'parId'>) => r.parId ?? r.empId;

/**
 * Ce que l'acceptation d'une demande a créé : `suite`, enregistrée à l'acceptation, sinon (demande acceptée avant qu'elle
 * le soit) retrouvé d'après la demande : certification ou inscription rattachée à la session souhaitée, titre
 * d'habilitation, ou dernière ligne du plan issue d'une demande pour la même formation et l'équipe du salarié.
 */
export function suiteAcceptation(d: Domain, r: DemandeCollab, emp: Employe): SuiteDemande {
  if (r.suite) return r.suite;
  if (r.type === 'habilitation') {
    const t = emp.habs.find(x => x.h === r.h);
    return t ? { habTitreId: t.id, cree: !t.delivree } : {};
  }
  if (r.sessionId) {
    const cert = r.f ? certEnVigueur(emp.certs, r.f) : null;
    if (cert?.sessionId === r.sessionId) return { sessionId: r.sessionId, certId: cert.id, depuis: null };
    const i = d.ds.inscriptions.find(x => x.empId === emp.id && x.sessionId === r.sessionId);
    if (i) return { sessionId: r.sessionId, inscriptionId: i.id, cree: true };
  }
  const l = d.ds.plan
    .filter(x => x.origine === 'demande' && x.equipe === emp.equipe && (r.f ? x.f === r.f : !x.f && key(x.libelle ?? '') === key(r.libelle ?? '')))
    .sort((a, b) => b.id - a.id)[0];
  return l ? { planId: l.id } : {};
}

/**
 * Retour du salarié dans une session qu'une correction lui avait fait quitter (session quittée pour la demande rouverte,
 * inscription close par la certification annulée) : mêmes contrôles que `plan.inscrire` (server/src/actions/conformite.ts).
 * Session ouverte et à venir, place libre, dans le contrat, sans absence ni autre session ces jours-là (`quitte` : session
 * que le salarié quitte dans la même correction, qui ne compte pas comme un conflit). null : retour possible ; sinon la
 * raison, en minuscules, à placer dans une phrase.
 */
export function refusRetour(d: Domain, emp: Employe, s: Session, quitte: number | null = null): string | null {
  if (!sessionActive(s)) return `session ${s.statut === 'Annulée' ? 'annulée' : 'clôturée'}`;
  if (s.date < d.ti) return 'session commencée ou passée';
  if (s.inscrits >= s.places) return 'session complète';
  if (horsContratLe(emp, finSession(s))) return 'session après la fin du contrat';
  const conflit = blocage(conflitsSession(d, emp.id, s, { sessionId: quitte }));
  return conflit ? `${conflit.charAt(0).toLowerCase()}${conflit.slice(1)}` : null;
}

/** Inscription close par une certification, à rendre : `refus`, raison pour laquelle sa session ne l'accueille plus. */
export interface InscriptionARendre { i: Inscription; s: Session; refus: string | null }

/**
 * Inscriptions en formation initiale closes par la certification `c` (`inscriptionsCloses`), à rendre quand elle est
 * annulée ou change de formation (`certsApres` : certifications du dossier après la correction), une par formation. Aucune
 * si une certification de la même formation enregistrée depuis la clôt toujours, ou si le salarié s'est réinscrit.
 * Session ouverte : elle doit encore l'accueillir (`refusRetour`) ; annulée ou clôturée depuis : l'inscription revient, à
 * replanifier. Appliqué par server/src/actions/inscriptions-closes.ts, annoncé par la confirmation de suppression.
 */
export function inscriptionsARendre(d: Domain, emp: Employe, c: Certification, certsApres: readonly Certification[]): InscriptionARendre[] {
  const out: InscriptionARendre[] = [];
  const faites = new Set<string>();
  for (const i of c.inscriptionsCloses ?? []) {
    const s = d.session(i.sessionId);
    if (!s || faites.has(s.formation)) continue;
    faites.add(s.formation);
    if (certsApres.some(x => x.f === s.formation && x.id > c.id)) continue;
    if (d.ds.inscriptions.some(x => x.empId === emp.id && d.session(x.sessionId)?.formation === s.formation)) continue;
    out.push({ i, s, refus: sessionActive(s) ? refusRetour(d, emp, s, c.sessionId) : null });
  }
  return out;
}

/** Ce que la réouverture d'une demande acceptée défait, une phrase chacune (state/confirmations-corrections.ts). */
export function effetsReouverture(d: Domain, r: DemandeCollab, emp: Employe): string[] {
  if (r.statut !== 'acceptee') return [];
  const x = suiteAcceptation(d, r, emp);
  const s = x.sessionId ? d.session(x.sessionId) : null;
  if (s && sessionActive(s) && (x.certId || x.inscriptionId)) {
    // Mêmes règles que la réouverture (server/src/actions/corrections.ts, defaireAcceptation).
    const depuis = x.depuis ? d.session(x.depuis) : null;
    const refus = depuis ? refusRetour(d, emp, depuis, s.id) : null;
    const quand = depuis ? `à la session du ${fmt(parse(depuis.date))}` : '';
    const retour = !depuis ? ''
      : !refus ? `Il retrouve sa place ${quand}, convocation à envoyer.`
      : x.certId ? `Retour ${quand} impossible (${refus}) : le recyclage redevient à planifier.`
      : !sessionActive(depuis) ? `Sa formation initiale redevient à replanifier (${refus}).`
      : `Retour ${quand} impossible (${refus}) : l’inscription en formation initiale est retirée, à refaire.`;
    return [`${emp.nom} est retiré de la session du ${fmt(parse(s.date))} ; une convocation reçue est annulée par e-mail.`, retour].filter(Boolean);
  }
  if (x.planId && d.ds.plan.some(l => l.id === x.planId)) return ['La ligne ajoutée au plan de formation est supprimée (gardée en base, hors des calculs).'];
  if (x.habTitreId) {
    const t = emp.habs.find(h => h.id === x.habTitreId);
    if (t && x.cree && !t.delivree) return ['Le titre « en attente de délivrance » créé par l’acceptation est retiré.'];
    if (t?.demande) return ['La demande inscrite sur le titre (renouvellement ou nouvelle délivrance) est effacée.'];
  }
  return [];
}
