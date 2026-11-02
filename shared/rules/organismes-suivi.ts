// Suivi des organismes de formation (lot 12, chantier C4, étape 2) : règles pures communes au serveur et aux écrans.
// - Évaluations consolidées par organisme (fiche, `organisme_id`, et non plus par le texte) sur plusieurs exercices
//   glissants (3 par défaut) et en cumul : sessions tenues ou annulées, stagiaires, avis à chaud et à froid, coût réel des
//   actions du plan réalisées ; même masquage sous SEUIL_ANONYMAT que les indicateurs de l'exercice (vue agrégée du
//   référent HSE et de la lecture seule, calculée par le serveur : server/src/vues-organismes.ts) ; jamais de commentaire.
//   Les évaluations supprimées par la conservation ne sont plus comptées.
// - Alertes Qualiopi : relance du service RH au premier palier réglé (`organismeAlerteQualiopiJours`, 60 jours), à 15
//   jours, puis « échue » (récapitulatif des échéances, server/src/relances.ts) ; fiches à surveiller de l'onglet
//   Organismes (Qualiopi à renouveler, échu ou sans date, déclaration d'activité absente) ; marques du plan.
//   Avertissement seulement, jamais un blocage (choix par défaut du chantier).
import { days, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { ISODate, LigneEvaluation, PlanAction, Settings } from '../types.ts';
import type { Organisme } from '../types-organismes.ts';
import { avisFroidAttendus, ciblesEvaluation, ligneEvaluation, type CibleEvaluation, type Element } from './evaluation-formation.ts';
import {
  avertissementsOrganisme, etatQualiopi, ndaManquant, organismeActif, organismeDeSession, organismeDeSuivie, organismeDuPlan, organismeFinal, QUALIOPI_SECOND_PALIER,
  type EtatQualiopi,
} from './organismes.ts';
import { palierDe, type Relance } from './relances.ts';

/** Horizon de consolidation par défaut : 3 exercices glissants (l'exercice en cours et les deux précédents), plus le cumul. */
export const HORIZON_EVALUATIONS = 3;
/** Horizons proposés à l'écran (exercices glissants). */
export const HORIZONS_EVALUATIONS = [3, 5] as const;

/** Exercices glissants qui finissent l'année de `today` : `n` années, la plus ancienne d'abord. */
export function exercicesGlissants(today: ISODate, n = HORIZON_EVALUATIONS): number[] {
  const an = Number(today.slice(0, 4));
  return Array.from({ length: Math.max(1, n) }, (_, i) => an - Math.max(1, n) + 1 + i);
}

/** Activité et évaluations d'un organisme sur un exercice (`exercice` 0 : cumul des exercices retenus). */
export interface ExerciceOrganisme {
  exercice: number;
  /** Sessions clôturées (tenues) et annulées de l'exercice, dont l'organisme est celui de la fiche. */
  sessions: number; annulees: number;
  /** Indicateurs des évaluations (participants, à chaud, à froid), masqués sous le seuil dans la vue agrégée. */
  ligne: LigneEvaluation;
  /** Coût réel des actions du plan réalisées avec cet organisme (sinon le coût prévu de l'action). */
  coutReel: number;
}

/** Évaluations d'une formation du catalogue chez un organisme, en cumul (comparatif entre organismes). */
export interface FormationOrganisme { formation: string; intitule: string; ligne: LigneEvaluation }

/** Indicateurs consolidés d'un organisme (fiche finale : une fiche fusionnée compte dans celle qui l'a absorbée). */
export interface IndicateursOrganisme {
  organismeId: number;
  /** Nombre d'exercices glissants consolidés (le serveur envoie à la vue agrégée chaque horizon proposé). */
  horizon: number;
  exercices: ExerciceOrganisme[]; cumul: ExerciceOrganisme; parFormation: FormationOrganisme[];
}

/** Organisme (fiche finale) d'une formation évaluable : celui de la session, figé, ou celui de la formation suivie. */
export function organismeDeCible(d: Domain, c: Pick<CibleEvaluation, 'sessionId' | 'formationSuivieId'>): number | null {
  if (c.sessionId != null) {
    const s = d.session(c.sessionId);
    return s ? organismeDeSession(d.ds, s)?.id ?? null : null;
  }
  const x = (d.ds.formationsSuivies ?? []).find(f => f.id === c.formationSuivieId);
  return x ? organismeDeSuivie(d.ds, x)?.id ?? null : null;
}

const annee = (j: ISODate) => Number(j.slice(0, 4));

/**
 * Indicateurs consolidés de chaque organisme sur les `exercices` (année du premier jour de la formation, comme les heures
 * et les indicateurs de l'exercice) et en cumul. `seuil` : vue agrégée (SEUIL_ANONYMAT), sinon 0 (service RH). Seuls les
 * organismes qui ont une activité sur la période sont rendus.
 */
export function indicateursOrganismes(d: Domain, exercices: readonly number[], seuil = 0): IndicateursOrganisme[] {
  const retenus = new Set(exercices);
  const evals = d.ds.evaluationsFormation ?? [];
  const final = (id: number | null | undefined) => organismeFinal(d.ds.organismes, id)?.id ?? null;
  // Formations évaluables de la période, rattachées à leur fiche.
  const elements = ciblesEvaluation(d).filter(c => retenus.has(annee(c.debut))).flatMap(cible => {
    const organismeId = final(organismeDeCible(d, cible));
    if (organismeId == null) return [];
    const el: Element = {
      cible,
      evaluations: evals.filter(e => (cible.participationId ? e.participationId === cible.participationId : e.formationSuivieId === cible.formationSuivieId)),
      froidAttendus: avisFroidAttendus(d, cible),
    };
    return [{ organismeId, el }];
  });
  const sessions = d.ds.sessions.filter(s => retenus.has(annee(s.date)) && (s.statut === 'Clôturée' || s.statut === 'Annulée'))
    .map(s => ({ s, organismeId: final(organismeDeSession(d.ds, s)?.id) }));
  const plan = d.ds.plan.filter((l: PlanAction) => l.statut === 'realise' && retenus.has(l.exercice))
    .map(l => ({ l, organismeId: final(organismeDuPlan(d.ds, l)?.id) }));
  const ids = new Set<number>([...elements.map(e => e.organismeId), ...sessions.flatMap(x => (x.organismeId == null ? [] : [x.organismeId])),
    ...plan.flatMap(x => (x.organismeId == null ? [] : [x.organismeId]))]);
  // Note de session du service RH (Session.bilan.note, d'avant le lot 7) : comptée comme dans les indicateurs de l'exercice.
  const ligneDe = (cle: string, els: Element[], ses: typeof sessions) =>
    ligneEvaluation(cle, els, ses.filter(x => x.s.statut === 'Clôturée' && x.s.bilan?.note != null).map(x => x.s.bilan!.note!), seuil);
  const exerciceDe = (id: number, ex: number): ExerciceOrganisme => {
    const dans = (a: number) => ex === 0 || a === ex;
    const ses = sessions.filter(x => x.organismeId === id && dans(annee(x.s.date)));
    return {
      exercice: ex,
      sessions: ses.filter(x => x.s.statut === 'Clôturée').length, annulees: ses.filter(x => x.s.statut === 'Annulée').length,
      ligne: ligneDe(String(ex || 'Cumul'), elements.filter(e => e.organismeId === id && dans(annee(e.el.cible.debut))).map(e => e.el), ses),
      coutReel: plan.filter(x => x.organismeId === id && dans(x.l.exercice)).reduce((n, x) => n + (x.l.coutReel ?? x.l.cout), 0),
    };
  };
  return [...ids].sort((a, b) => a - b).map(id => {
    const siens = elements.filter(e => e.organismeId === id && e.el.cible.formation);
    const formations = [...new Set(siens.map(e => e.el.cible.formation!))].sort();
    return {
      organismeId: id, horizon: retenus.size,
      exercices: [...retenus].sort((a, b) => a - b).map(ex => exerciceDe(id, ex)),
      cumul: exerciceDe(id, 0),
      parFormation: formations.map(f => {
        const els = siens.filter(e => e.el.cible.formation === f).map(e => e.el);
        return { formation: f, intitule: els[0].cible.intitule, ligne: ligneEvaluation(f, els, [], seuil) };
      }),
    };
  });
}

/**
 * Comparatif d'une formation entre organismes (fiche, onglet Évaluations) : la ligne cumulée de chaque organisme qui l'a
 * dispensée sur la période, celui de la fiche en tête.
 */
export function comparatifFormation(liste: readonly IndicateursOrganisme[], formation: string, organismeId: number): { organismeId: number; ligne: LigneEvaluation }[] {
  return liste.flatMap(x => x.parFormation.filter(f => f.formation === formation).map(f => ({ organismeId: x.organismeId, ligne: f.ligne })))
    .sort((a, b) => Number(b.organismeId === organismeId) - Number(a.organismeId === organismeId) || b.ligne.participants - a.ligne.participants);
}

/**
 * Indicateurs affichés : ceux calculés par le serveur pour une vue agrégée (référent HSE, lecture seule : sans les
 * évaluations nominatives), sinon calculés sur l'instantané (service RH).
 */
export function indicateursOrganismesAffiches(d: Domain, exercices: readonly number[]): IndicateursOrganisme[] {
  const calcules = d.ds.indicateursOrganismes;
  return calcules ? calcules.filter(x => x.horizon === exercices.length) : indicateursOrganismes(d, exercices);
}

// — Alertes Qualiopi —

/** Fiche à surveiller : état Qualiopi à renouveler, échu ou sans date, ou déclaration d'activité absente (organisme externe). */
export interface AlerteOrganisme { organisme: Organisme; etat: EtatQualiopi; ndaManquant: boolean }

/** Fiches en vigueur à surveiller le `today` (premier palier réglé), Qualiopi échu d'abord. */
export function organismesASurveiller(organismes: readonly Organisme[] | undefined, today: ISODate, s: Pick<Settings, 'organismeAlerteQualiopiJours'>): AlerteOrganisme[] {
  const rang: Partial<Record<EtatQualiopi, number>> = { echu: 0, a_echeance: 1, a_verifier: 2 };
  return (organismes ?? []).filter(organismeActif).flatMap(o => {
    const etat = etatQualiopi(o, today, s.organismeAlerteQualiopiJours);
    const nda = ndaManquant(o);
    return rang[etat] != null || nda ? [{ organisme: o, etat, ndaManquant: nda }] : [];
  }).sort((a, b) => (rang[a.etat] ?? 9) - (rang[b.etat] ?? 9) || a.organisme.nomUsuel.localeCompare(b.organisme.nomUsuel, 'fr'));
}

/**
 * Relances Qualiopi du récapitulatif des échéances (boîte du service RH seulement) : fiche en vigueur, externe ou formateur
 * indépendant, certifiée avec une date de validité ; paliers : premier palier réglé, 15 jours, puis « échue ». Clé
 * `organisme:<id>:qualiopi:<date>` : une nouvelle date de validité repart de zéro. Une fiche sans date (« à vérifier ») n'a
 * pas d'échéance : elle est signalée dans l'onglet Organismes.
 */
export function relancesQualiopi(organismes: readonly Organisme[] | undefined, today: ISODate, s: Pick<Settings, 'organismeAlerteQualiopiJours'>): Relance[] {
  const paliers = [...new Set([s.organismeAlerteQualiopiJours, QUALIOPI_SECOND_PALIER])].filter(p => p > 0);
  return (organismes ?? []).filter(o => organismeActif(o) && o.type !== 'interne' && o.qualiopi && o.qualiopiValideJusquau).flatMap(o => {
    const fin = o.qualiopiValideJusquau!;
    const jours = days(parse(today), parse(fin));
    const palier = palierDe(jours, paliers);
    if (!palier) return [];
    return [{
      cle: `organisme:${o.id}:qualiopi:${fin}`, empId: 0, categorie: 'organisme' as const, echeance: fin, jours, palier, sante: false, rhSeul: true,
      libelle: `Certification Qualiopi de ${o.nomUsuel} (${o.code}) : fin de validité`,
    }];
  });
}

/**
 * Avertissements d'une ligne du plan (marque de Plan & budget) : ceux de son organisme prévu, à la date du début de son
 * trimestre (ou aujourd'hui s'il est passé) ; une action réalisée n'en a plus.
 */
export function avertissementsPlan(ds: Domain['ds'], l: PlanAction, today: ISODate): string[] {
  if (l.statut === 'realise' || l.statut === 'reporte') return [];
  const o = organismeDuPlan(ds, l);
  if (!o) return [];
  const debut = `${l.exercice}-${String((Number(l.periode.replace(/\D/g, '')) - 1) * 3 + 1).padStart(2, '0')}-01`;
  return avertissementsOrganisme(o, debut > today ? debut : today);
}
