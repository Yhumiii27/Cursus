// Évaluation des formations (lot 7, chantier C, t121 ; ISO 9001 et 45001 : efficacité des actions de formation). Après
// une formation, le salarié donne son avis (à chaud : note de 1 à 5 et commentaire), dans son espace ou recueilli par le
// service RH à la clôture de la session. N jours plus tard (90 par défaut), le salarié et son manager disent si elle a été
// efficace (à froid : efficace, partiellement, non), pour les catégories réglées (Réglementaires et Recommandées) :
// réponse de l'entreprise du 23 octobre 2026. Échelles fixes en attendant un questionnaire qualité de l'entreprise.
// Règles pures, communes à l'écran et au serveur (server/src/actions/evaluations-formation.ts, server/src/evaluations-
// formation.ts) : formations évaluables, fenêtres de saisie, ce qui attend le salarié et le manager, demandes et relances
// par e-mail, indicateurs par organisme et par formation sur l'exercice. `Session.bilan.note` (appréciation de la session
// par le service RH, d'avant le lot 7) est reprise telle quelle dans les indicateurs, jamais répartie par personne.
import { addD, days, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type {
  CategorieEvaluee, EfficaciteFormation, EvaluationFormation, IndicateursEvaluation, ISODate, LigneEvaluation, RepondantEvaluation, RepondantsFroid,
  Settings, TypeEvaluation,
} from '../types.ts';
import { present } from './contrats.ts';
import { intituleSuivie, suiviesEnVigueur } from './formations-suivies.ts';
import { finSession } from './plage-session.ts';

/** Note à chaud : entière, de 1 à 5. */
export const NOTE_MIN = 1;
export const NOTE_MAX = 5;
/** Commentaire d'une évaluation : 1 000 caractères au plus. */
export const COMMENTAIRE_EVALUATION_MAX = 1000;
/** L'avis à chaud est demandé au salarié pendant 30 jours après le dernier jour de la formation (encart « À faire »). */
export const DELAI_CHAUD_JOURS = 30;
/** À froid : demande le jour de l'échéance, relances 15 et 30 jours après ; la demande reste ouverte 60 jours. */
export const RELANCES_FROID = [15, 30] as const;
export const FENETRE_FROID_JOURS = 60;
/** Vue agrégée (référent HSE, lecture seule) : sous 3 réponses, ni moyenne ni taux, qui désigneraient la personne. */
export const SEUIL_ANONYMAT = 3;

export const EFFICACITE_LABEL: Record<EfficaciteFormation, string> = { efficace: 'Efficace', partielle: 'Partiellement efficace', non: 'Pas efficace' };
export const REPONDANT_LABEL: Record<RepondantEvaluation, string> = { salarie: 'Salarié', manager: 'Manager' };
export const TYPE_EVALUATION_LABEL: Record<TypeEvaluation, string> = { chaud: 'À chaud', froid: 'À froid' };
export const REPONDANTS_FROID_LABEL: Record<RepondantsFroid, string> = { les_deux: 'Le salarié et son manager', salarie: 'Le salarié', manager: 'Le manager' };
export const CATEGORIES_EVALUEES: readonly CategorieEvaluee[] = ['Réglementaire', 'Recommandée', 'Interne', 'Hors catalogue'];
export const estEfficacite = (v: unknown): v is EfficaciteFormation => v === 'efficace' || v === 'partielle' || v === 'non';

/**
 * Formation évaluable : participation présente à une session clôturée, ou formation suivie hors session (en vigueur).
 * `cle` : « p<participation> » ou « s<formation suivie> » ; `debut` (exercice des indicateurs, comme les heures de
 * formation) et `fin` (dernier jour : départ des délais) ; organisme du catalogue, ou celui saisi sur la formation suivie.
 */
export interface CibleEvaluation {
  cle: string; empId: number; participationId: number | null; formationSuivieId: number | null; sessionId: number | null;
  formation: string | null; intitule: string; organisme: string; categorie: CategorieEvaluee; debut: ISODate; fin: ISODate;
}

/** Organisme d'une formation suivie sans organisme ni formation du catalogue. */
export const ORGANISME_INCONNU = 'Organisme non renseigné';

/** Formations évaluables du jeu de données (déjà restreint au périmètre de la personne). */
export function ciblesEvaluation(d: Domain): CibleEvaluation[] {
  const out: CibleEvaluation[] = [];
  for (const p of d.ds.participations) {
    const s = d.session(p.sessionId);
    if (!p.present || !s || s.statut !== 'Clôturée') continue;
    const fm = d.ds.referentiels.formations.find(f => f.id === s.formation);
    out.push({
      cle: `p${p.id}`, empId: p.empId, participationId: p.id, formationSuivieId: null, sessionId: s.id, formation: s.formation,
      intitule: fm?.nom ?? s.formation, organisme: fm?.organisme || ORGANISME_INCONNU, categorie: fm?.type ?? 'Hors catalogue', debut: s.date, fin: finSession(s),
    });
  }
  for (const x of suiviesEnVigueur(d.ds)) {
    const fm = x.f ? d.ds.referentiels.formations.find(f => f.id === x.f) : undefined;
    out.push({
      cle: `s${x.id}`, empId: x.empId, participationId: null, formationSuivieId: x.id, sessionId: null, formation: x.f,
      intitule: intituleSuivie(d, x), organisme: x.organisme || fm?.organisme || ORGANISME_INCONNU, categorie: fm?.type ?? 'Hors catalogue', debut: x.du, fin: x.au,
    });
  }
  return out;
}

/** Formation évaluable désignée par sa participation ou sa formation suivie (une seule des deux). */
export function cibleDe(d: Domain, ref: { participationId?: unknown; formationSuivieId?: unknown }): CibleEvaluation | null {
  const p = Number(ref.participationId) || null, s = Number(ref.formationSuivieId) || null;
  if (!p === !s) return null;
  return ciblesEvaluation(d).find(c => (p ? c.participationId === p : c.formationSuivieId === s)) ?? null;
}

/** Évaluation enregistrée d'une formation, d'un type et d'un répondant. */
export const evaluationDe = (evaluations: readonly EvaluationFormation[] | undefined, c: Pick<CibleEvaluation, 'participationId' | 'formationSuivieId'>, type: TypeEvaluation, repondant: RepondantEvaluation) =>
  (evaluations ?? []).find(e => e.type === type && e.repondant === repondant
    && (c.participationId ? e.participationId === c.participationId : e.formationSuivieId === c.formationSuivieId)) ?? null;

/** Répondants de l'évaluation à froid selon le réglage. */
export const repondantsFroid = (s: Pick<Settings, 'evaluationFroidPar'>): RepondantEvaluation[] =>
  s.evaluationFroidPar === 'les_deux' ? ['salarie', 'manager'] : [s.evaluationFroidPar];

/** La formation est-elle évaluée à froid (évaluations activées, catégorie cochée) ? */
export const concerneFroid = (s: Pick<Settings, 'evaluationsActives' | 'evaluationFroidCategories'>, c: Pick<CibleEvaluation, 'categorie'>) =>
  s.evaluationsActives && s.evaluationFroidCategories.includes(c.categorie);

/** Jour où l'évaluation à froid est demandée : dernier jour de la formation + délai réglé. */
export const echeanceFroid = (s: Pick<Settings, 'evaluationFroidDelai'>, c: Pick<CibleEvaluation, 'fin'>): ISODate => addD(c.fin, s.evaluationFroidDelai);

/**
 * Refus d'une saisie (null : permise), commun au dialogue et au serveur. À chaud : l'avis du salarié, du dernier jour de la
 * formation jusqu'au début de l'évaluation à froid (le délai réglé). À froid : formation concernée, répondant prévu par
 * le réglage, à partir de l'échéance (une réponse tardive reste acceptée). `recueilli` : avis saisi par le service RH
 * (formulaire papier, entretien), à chaud sans limite de temps. Les droits (qui saisit pour qui) sont contrôlés par le
 * serveur.
 */
export function refusEvaluation(s: Settings, today: ISODate, c: CibleEvaluation, type: TypeEvaluation, repondant: RepondantEvaluation, recueilli = false): string | null {
  if (!s.evaluationsActives) return 'Évaluation des formations désactivée (Paramètres → Évaluation des formations)';
  if (c.fin > today) return 'La formation n’est pas terminée : évaluation possible à partir de son dernier jour';
  if (type === 'chaud') {
    if (repondant !== 'salarie') return 'L’évaluation à chaud est l’avis du salarié';
    if (!recueilli && today > echeanceFroid(s, c)) return `Évaluation à chaud close ${s.evaluationFroidDelai} jours après la formation`;
    return null;
  }
  if (!concerneFroid(s, c)) return `Formation ${c.categorie === 'Hors catalogue' ? 'hors catalogue' : c.categorie.toLowerCase()} : pas d’évaluation à froid (Paramètres → Évaluation des formations)`;
  if (!repondantsFroid(s).includes(repondant)) return `L’évaluation à froid est remplie par ${REPONDANTS_FROID_LABEL[s.evaluationFroidPar].toLowerCase()}`;
  const du = echeanceFroid(s, c);
  if (du > today) return `Évaluation à froid à partir du ${du.split('-').reverse().join('/')} (${s.evaluationFroidDelai} jours après la formation)`;
  return null;
}

/** Évaluation attendue : la formation, le type, le répondant et la date à partir de laquelle elle est demandée. */
export interface EvaluationAFaire { cible: CibleEvaluation; type: TypeEvaluation; repondant: RepondantEvaluation; depuis: ISODate }

/** Évaluations qu'un salarié a encore à donner (avis à chaud du mois, à froid échu depuis moins de 60 jours). */
export function evaluationsAFaire(d: Domain, empId: number | null): EvaluationAFaire[] {
  const e = empId != null ? d.emp(empId) : undefined, s = d.ds.settings;
  if (!e || !s.evaluationsActives || !present(e, d.ti)) return [];
  const out: EvaluationAFaire[] = [];
  for (const c of ciblesEvaluation(d).filter(x => x.empId === e.id)) {
    if (c.fin <= d.ti && d.ti <= addD(c.fin, DELAI_CHAUD_JOURS) && !evaluationDe(d.ds.evaluationsFormation, c, 'chaud', 'salarie')) out.push({ cible: c, type: 'chaud', repondant: 'salarie', depuis: c.fin });
    const du = echeanceFroid(s, c);
    if (concerneFroid(s, c) && repondantsFroid(s).includes('salarie') && du <= d.ti && d.ti <= addD(du, FENETRE_FROID_JOURS)
      && !evaluationDe(d.ds.evaluationsFormation, c, 'froid', 'salarie')) out.push({ cible: c, type: 'froid', repondant: 'salarie', depuis: du });
  }
  return out.sort((a, b) => a.depuis.localeCompare(b.depuis) || a.cible.cle.localeCompare(b.cible.cle));
}

/** Évaluations à froid qu'un manager a encore à donner sur les membres présents de son équipe (lui-même exclu). */
export function evaluationsAFaireManager(d: Domain, managerId: number | null): EvaluationAFaire[] {
  const s = d.ds.settings;
  if (!managerId || !s.evaluationsActives || !repondantsFroid(s).includes('manager')) return [];
  const out: EvaluationAFaire[] = [];
  for (const c of ciblesEvaluation(d)) {
    const e = d.emp(c.empId);
    if (!e || e.id === managerId || d.mgrOf(e) !== managerId || !present(e, d.ti) || !concerneFroid(s, c)) continue;
    const du = echeanceFroid(s, c);
    if (du <= d.ti && d.ti <= addD(du, FENETRE_FROID_JOURS) && !evaluationDe(d.ds.evaluationsFormation, c, 'froid', 'manager')) out.push({ cible: c, type: 'froid', repondant: 'manager', depuis: du });
  }
  return out.sort((a, b) => a.depuis.localeCompare(b.depuis) || a.cible.cle.localeCompare(b.cible.cle));
}

/**
 * Demande ou relance par e-mail : destinataire (le salarié, ou son manager), évaluation attendue et palier (« demande »,
 * puis « relance-15 » et « relance-30 » à froid). `cle` : objet de la relance, noté une fois envoyé (table `relances`),
 * avec le palier : chacun ne part qu'une fois.
 */
export interface DemandeEvaluation extends EvaluationAFaire { destinataire: number; palier: string; cle: string }

/** Palier atteint `jours` après le début de la demande à froid : « demande », puis les relances franchies. */
export const palierFroid = (jours: number): string => {
  const r = [...RELANCES_FROID].reverse().find(x => jours >= x);
  return r ? `relance-${r}` : 'demande';
};

/**
 * Demandes et relances dues aujourd'hui sur tout le périmètre : avis à chaud demandé une fois au salarié (sans relance),
 * évaluation à froid demandée au salarié et à son manager puis relancée. Rien pour un salarié sorti, ni au manager de
 * lui-même ; sans manager (validations par le service RH), pas de demande au manager.
 */
export function demandesEvaluation(d: Domain): DemandeEvaluation[] {
  const out: DemandeEvaluation[] = [];
  const depuis = (a: EvaluationAFaire) => palierFroid(days(parse(a.depuis), d.today));
  for (const empId of new Set(ciblesEvaluation(d).map(c => c.empId))) {
    for (const a of evaluationsAFaire(d, empId)) {
      out.push({ ...a, destinataire: empId, palier: a.type === 'chaud' ? 'demande' : depuis(a), cle: `evaluation:${a.cible.cle}:${a.type}:salarie` });
    }
  }
  for (const m of new Set(d.ds.referentiels.equipes.map(q => q.managerId).filter((x): x is number => !!x))) {
    for (const a of evaluationsAFaireManager(d, m)) out.push({ ...a, destinataire: m, palier: depuis(a), cle: `evaluation:${a.cible.cle}:froid:manager` });
  }
  return out;
}

// — Indicateurs —

const pct = (n: number, sur: number) => (sur ? Math.round(n / sur * 100) : null);
const moyenne = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length * 10) / 10 : null);

interface Element { cible: CibleEvaluation; evaluations: EvaluationFormation[]; froidAttendus: number }

function ligneEvaluation(cle: string, elements: Element[], notesSessions: number[], seuil: number): LigneEvaluation {
  const evals = elements.flatMap(e => e.evaluations);
  const chauds = evals.filter(e => e.type === 'chaud' && e.note != null).map(e => e.note!);
  const froids = evals.filter(e => e.type === 'froid' && e.efficacite);
  const compte = (v: EfficaciteFormation) => froids.filter(e => e.efficacite === v).length;
  const froidAttendus = elements.reduce((n, e) => n + Math.max(e.froidAttendus, e.evaluations.filter(x => x.type === 'froid').length), 0);
  const l: LigneEvaluation = {
    cle, participants: elements.length,
    chaud: chauds.length, moyenneChaud: moyenne(chauds), tauxChaud: pct(chauds.length, elements.length),
    froidAttendus, froid: froids.length, efficaces: compte('efficace'), partielles: compte('partielle'), non: compte('non'),
    tauxEfficacite: pct(compte('efficace'), froids.length), tauxFroid: pct(froids.length, froidAttendus),
    sessionsNotees: notesSessions.length, moyenneSessions: moyenne(notesSessions),
  };
  // Vue agrégée : sous le seuil, la moyenne et l'efficacité désigneraient la personne qui a répondu.
  if (seuil > 0 && ((l.chaud > 0 && l.chaud < seuil) || (l.froid > 0 && l.froid < seuil))) {
    if (l.chaud < seuil) l.moyenneChaud = null;
    if (l.froid < seuil) Object.assign(l, { efficaces: 0, partielles: 0, non: 0, tauxEfficacite: null });
    l.masque = true;
  }
  return l;
}

/**
 * Indicateurs des évaluations de l'exercice `exercice` (année du premier jour de la formation, comme les heures de
 * formation) : total, par organisme et par formation. Avis à froid attendus : formations concernées dont l'échéance est
 * passée, autant que de répondants prévus (au moins les réponses reçues). `seuil` : vue agrégée (SEUIL_ANONYMAT).
 */
export function indicateursEvaluation(d: Domain, exercice: number, seuil = 0): IndicateursEvaluation {
  const s = d.ds.settings, evals = d.ds.evaluationsFormation ?? [];
  const dans = (j: ISODate) => j.startsWith(`${exercice}-`);
  const elements: Element[] = ciblesEvaluation(d).filter(c => dans(c.debut)).map(cible => ({
    cible,
    evaluations: evals.filter(e => (cible.participationId ? e.participationId === cible.participationId : e.formationSuivieId === cible.formationSuivieId)),
    froidAttendus: concerneFroid(s, cible) && echeanceFroid(s, cible) <= d.ti ? repondantsFroid(s).length : 0,
  }));
  // Appréciation de la session par le service RH (Session.bilan.note, d'avant le lot 7) : par session clôturée de l'exercice.
  const notees = d.ds.sessions.filter(x => x.statut === 'Clôturée' && dans(x.date) && x.bilan?.note != null).map(x => {
    const fm = d.ds.referentiels.formations.find(f => f.id === x.formation);
    return { note: x.bilan!.note!, organisme: fm?.organisme || ORGANISME_INCONNU, intitule: fm?.nom ?? x.formation };
  });
  const grouper = (cle: (c: { organisme: string; intitule: string }) => string) => {
    const cles = [...new Set([...elements.map(e => cle(e.cible)), ...notees.map(cle)])].sort((a, b) => a.localeCompare(b, 'fr'));
    return cles.map(k => ligneEvaluation(k, elements.filter(e => cle(e.cible) === k), notees.filter(n => cle(n) === k).map(n => n.note), seuil));
  };
  return {
    exercice,
    total: ligneEvaluation('Total', elements, notees.map(n => n.note), seuil),
    parOrganisme: grouper(c => c.organisme),
    parFormation: grouper(c => c.intitule),
  };
}

/** Exercices qui ont des formations évaluables ou des sessions notées, et l'année en cours. */
export function exercicesEvaluation(d: Domain): number[] {
  const annees = new Set([Number(d.ti.slice(0, 4))]);
  for (const c of ciblesEvaluation(d)) annees.add(Number(c.debut.slice(0, 4)));
  for (const x of d.ds.sessions) if (x.statut === 'Clôturée' && x.bilan?.note != null) annees.add(Number(x.date.slice(0, 4)));
  return [...annees].sort((a, b) => a - b);
}

/**
 * Indicateurs affichés : ceux calculés par le serveur pour une vue agrégée (référent HSE, lecture seule), sinon calculés
 * sur l'instantané (service RH, qui a toutes les évaluations).
 */
export function indicateursAffiches(d: Domain, exercice: number): IndicateursEvaluation {
  const calcules = d.ds.indicateursEvaluation;
  if (!calcules) return indicateursEvaluation(d, exercice);
  const vide = ligneEvaluation('Total', [], [], 0);
  return calcules.find(x => x.exercice === exercice) ?? { exercice, total: vide, parOrganisme: [], parFormation: [] };
}
