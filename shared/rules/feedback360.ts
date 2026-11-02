// Feedback 360° d'un entretien annuel ou de mi-année (lot 12, chantier C3, t194, étape 3) : règles pures, partagées par les
// actions (server/src/actions/feedback360.ts), le versement par lot (server/src/feedback360.ts), les vues et les écrans.
// Choix par défaut du chantier et réponses du propriétaire du 1er novembre 2026 :
// - module livré désactivé ; activation refusée sans la référence de l'avis du CSE (art. L2312-38, moyen d'évaluation des
//   salariés) ni celle de l'analyse d'impact (AIPD, RGPD art. 35) ; le questionnaire, fixe et versionné, est porté à la
//   connaissance des salariés avant toute sollicitation (art. L1222-3 et L1222-4) ;
// - répondants internes seulement (collègues, N+2, collaborateurs encadrés), proposés par le salarié et validés par
//   l'évaluateur, 3 à 8 par entretien ; fenêtre de réponse de 21 jours ; participation facultative (« décliner ») ;
// - confidentialité, pas anonymat : la réponse attend la clôture de la fenêtre, chiffrée et invisible de tous, puis est
//   versée par lot avec les autres, dans un ordre aléatoire, sous un identifiant non séquentiel, sans répondant ni date de
//   réception ; l'évalué et l'évaluateur ne voient qu'un compteur global, jamais quelle sollicitation a répondu ;
// - restitution agrégée calculée par le serveur, par catégorie de répondants seulement à partir du seuil (3 par défaut,
//   jamais moins) : les catégories sous le seuil sont fusionnées, ou rien n'est restitué ; verbatims restitués après la
//   relecture (modération) du service RH ; aucune question sur la santé ni la vie personnelle ;
// - réponses brutes supprimées à la clôture de l'entretien, 6 mois au plus tard après la sollicitation ; la synthèse reste
//   jointe à l'entretien.
import { addD, addM, isoParis, isValidDate } from '../dates.ts';
import type { EntretienType, ISODate, Reponse360, Settings, Sollicitation360, Suivi360 } from '../types.ts';

export type Relation360 = Sollicitation360['relation'];
export type Statut360 = Sollicitation360['statut'];

/** Types d'entretien qui peuvent recevoir un feedback 360° : jamais un entretien de parcours professionnel (art. L6315-1). */
export const TYPES_360: readonly EntretienType[] = ['annuel', 'mi_annee'];

export const RELATIONS_360 = ['pair', 'n2', 'encadre'] as const satisfies readonly Relation360[];
export const RELATION_360_LABEL: Record<Relation360, string> = { pair: 'Collègues', n2: 'Responsable N+2', encadre: 'Collaborateurs encadrés' };
/** Libellé d'une relation pour une seule personne (sollicitation, écran du répondant). */
export const RELATION_360_UN: Record<Relation360, string> = { pair: 'Collègue', n2: 'Responsable N+2', encadre: 'Collaborateur encadré' };

/** Sollicitations au plus par entretien (proposées et envoyées) ; au moins le seuil de restitution pour lancer la collecte. */
export const SOLLICITATIONS_MAX = 8;
/** Seuil de restitution par catégorie : jamais sous 3 (SEUIL_ANONYMAT des évaluations de formation), 5 au plus. */
export const SEUIL_360_MIN = 3;
export const SEUIL_360_MAX = 5;
/** Fenêtre de réponse par défaut (jours), réglable de 7 à 42. */
export const FENETRE_360_DEFAUT = 21;
/** Conservation des réponses brutes après la sollicitation (mois) : 6 au plus (choix par défaut du chantier). */
export const CONSERVATION_360_MAX_MOIS = 6;
/** Relance automatique des répondants qui n'ont rien fait, quelques jours avant l'échéance de la fenêtre. */
export const RELANCE_360_JOURS = 3;
export const VERBATIM_360_MAX = 500;

/** Échelle des réponses (1 à 4) ; une question sans réponse vaut « je ne peux pas me prononcer ». */
export const ECHELLE_360: readonly [number, string][] = [[1, 'Rarement'], [2, 'Parfois'], [3, 'Souvent'], [4, 'Toujours']];

export interface Question360 { cle: string; theme: string; libelle: string }
/**
 * Questionnaire fixe et versionné (art. L1222-3 : méthode portée à la connaissance des salariés avant sa mise en œuvre) :
 * comportements professionnels observables seulement, en lien direct avec l'emploi (art. L1222-2) ; aucune question sur la
 * santé, la vie personnelle ou les opinions. Une nouvelle version ne remplace pas l'ancienne : les réponses gardent celle
 * sous laquelle elles ont été données, et la synthèse ne mêle pas deux versions.
 */
export const QUESTIONNAIRE_360: { version: string; questions: readonly Question360[] } = {
  version: '2027-1',
  questions: [
    { cle: 'cooperation', theme: 'Coopération', libelle: 'Travaille en bonne coopération avec ses collègues et les autres équipes.' },
    { cle: 'communication', theme: 'Communication', libelle: 'Transmet les informations utiles, clairement et au bon moment.' },
    { cle: 'fiabilite', theme: 'Fiabilité', libelle: 'Tient ses engagements (délais, qualité, consignes).' },
    { cle: 'securite', theme: 'Sécurité', libelle: 'Applique et fait respecter les règles de sécurité au poste.' },
    { cle: 'partage', theme: 'Partage', libelle: 'Partage ses connaissances et aide à la montée en compétence des autres.' },
    { cle: 'ecoute', theme: 'Écoute', libelle: 'Écoute les remarques et en tient compte.' },
    { cle: 'organisation', theme: 'Organisation', libelle: 'Organise son travail et fixe les priorités.' },
    { cle: 'initiative', theme: 'Initiative', libelle: 'Propose des améliorations et prend des initiatives utiles.' },
  ],
};

export const STATUT_360_LABEL: Record<Statut360, string> = {
  proposee: 'Proposé, à valider', envoyee: 'Sollicité', repondue: 'Avis donné', declinee: 'Décliné', expiree: 'Sans réponse', annulee: 'Retiré',
};

/** Réglages du module (Paramètres → Objectifs et points de suivi). */
export type Reglages360 = Pick<Settings, 'feedback360Actif' | 'feedback360Cse' | 'feedback360Aipd' | 'feedback360Seuil' | 'feedback360FenetreJours' | 'feedback360ConservationMois'>;

/**
 * Activation refusée sans la référence de l'avis du CSE (information-consultation sur les méthodes d'évaluation, art.
 * L2312-38) ni celle de l'analyse d'impact (AIPD) : sans elles, le dispositif serait inopposable (art. L1222-4).
 */
export function refusActivation360(s: Pick<Settings, 'feedback360Actif' | 'feedback360Cse' | 'feedback360Aipd'>): string | null {
  if (!s.feedback360Actif) return null;
  const manque = [!s.feedback360Cse?.trim() && 'la référence de l’avis du CSE (art. L2312-38)', !s.feedback360Aipd?.trim() && 'celle de l’analyse d’impact (AIPD)'].filter(Boolean);
  return manque.length ? `Feedback 360° : activation refusée sans ${manque.join(' ni ')}` : null;
}

// ——— Sollicitations ———

/** Sollicitation encore comptée (proposée ou envoyée, quelle qu'en soit la suite) : seules les propositions retirées sortent. */
export const sollicitationActive = (s: Pick<Sollicitation360, 'statut'>) => s.statut !== 'annulee';
/** Sollicitation partie au répondant (la fenêtre de l'entretien est ouverte dès la première). */
export const sollicitationEnvoyee = (s: Pick<Sollicitation360, 'statut'>) => ['envoyee', 'repondue', 'declinee', 'expiree'].includes(s.statut);

/** Collecte d'un entretien : sollicitations envoyées, ouverte tant qu'aucune n'est close. */
export interface Collecte360 {
  envoyees: number; proposees: number; reponses: number; declinees: number;
  /** Échéance commune de la fenêtre (null : rien d'envoyé). */
  echeance: ISODate | null;
  ouverte: boolean; close: boolean;
}

/** État de la collecte de l'entretien d'après ses sollicitations (vue du service RH, et du serveur). */
export function collecte360(sollicitations: readonly Sollicitation360[], entretienId: number): Collecte360 {
  const l = sollicitations.filter(s => s.entretienId === entretienId && sollicitationActive(s));
  const envoyees = l.filter(sollicitationEnvoyee);
  const echeances = envoyees.map(s => s.echeance).filter((e): e is string => !!e).sort();
  const close = envoyees.length > 0 && envoyees.every(s => !!s.closeLe);
  return {
    envoyees: envoyees.length, proposees: l.filter(s => s.statut === 'proposee').length,
    reponses: l.filter(s => s.statut === 'repondue').length, declinees: l.filter(s => s.statut === 'declinee').length,
    echeance: echeances.at(-1) ?? null, ouverte: envoyees.length > 0 && !close, close,
  };
}

/**
 * Compteur global remis à l'évaluateur et à l'évalué (champ `suiviFeedback` de leur vue) : nombres seulement, jamais
 * l'état d'une sollicitation désignée.
 */
export const suivi360 = (sollicitations: readonly Sollicitation360[], entretienId: number): Suivi360 => {
  const c = collecte360(sollicitations, entretienId);
  return { entretienId, envoyees: c.envoyees, reponses: c.reponses, declinees: c.declinees, echeance: c.echeance, close: c.close };
};

/**
 * Sollicitation vue par l'évalué ou l'évaluateur : qui a été sollicité, jamais s'il a répondu, décliné ou laissé passer
 * l'échéance (« Sollicité ») ; ni relance ni dates propres au répondant.
 */
export const sollicitationMasquee = (s: Sollicitation360): Sollicitation360 => ({
  ...s, statut: sollicitationEnvoyee(s) ? 'envoyee' : s.statut, relanceeLe: null,
});

/**
 * Relation du répondant à l'évalué, déduite de l'organisation (jamais déclarée, sans quoi une catégorie pourrait être
 * faussée pour passer le seuil) : son N+2, un collaborateur qu'il encadre, sinon un collègue. `mgrOf` : manager valideur.
 */
export function relation360(mgrOf: (empId: number) => number | null, evalueId: number, repondantId: number): Relation360 {
  const n1 = mgrOf(evalueId);
  if (n1 && mgrOf(n1) === repondantId) return 'n2';
  if (mgrOf(repondantId) === evalueId) return 'encadre';
  return 'pair';
}

/** Jour (heure de Paris) d'un horodatage du feedback 360° (envoi, relance, clôture). */
export const jour360 = (horodatage: string): ISODate => isoParis(new Date(horodatage));

/** Date d'échéance d'une fenêtre ouverte aujourd'hui. */
export const echeance360 = (today: ISODate, jours: number) => addD(today, jours);

/** Sollicitations à relancer automatiquement : fenêtre ouverte, échéance proche, aucune relance depuis l'envoi récent. */
export function aRelancer360(sollicitations: readonly Sollicitation360[], today: ISODate): Sollicitation360[] {
  return sollicitations.filter(s => s.statut === 'envoyee' && !s.closeLe && !!s.echeance && s.echeance >= today
    && s.echeance <= addD(today, RELANCE_360_JOURS) && (!s.relanceeLe || jour360(s.relanceeLe) < addD(today, -RELANCE_360_JOURS)));
}

// ——— Réponse ———

/** Contenu d'une réponse, tel qu'il attend le versement (chiffré dans `feedback_tampon`) puis qu'il est versé. */
export interface ContenuReponse360 { version: string; notes: Record<string, number>; verbatim: string | null }

/**
 * Réponse saisie, contrôlée : une note de 1 à 4 par question du questionnaire en vigueur (absente : « je ne peux pas me
 * prononcer »), au moins une note, verbatim facultatif limité. Message d'erreur sinon.
 */
export function lireReponse360(p: { notes?: unknown; verbatim?: unknown }): ContenuReponse360 | string {
  const brutes = p.notes && typeof p.notes === 'object' ? p.notes as Record<string, unknown> : {};
  const notes: Record<string, number> = {};
  for (const [cle, v] of Object.entries(brutes)) {
    if (v === null || v === '' || v === undefined) continue;
    if (!QUESTIONNAIRE_360.questions.some(q => q.cle === cle)) return 'Question inconnue du questionnaire en vigueur';
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 4) return 'Chaque réponse se donne de 1 (rarement) à 4 (toujours)';
    notes[cle] = n;
  }
  if (!Object.keys(notes).length) return 'Répondez à au moins une question, ou déclinez la sollicitation';
  const verbatim = typeof p.verbatim === 'string' ? p.verbatim.trim().replace(/[ \t]+/g, ' ') : '';
  if (verbatim.length > VERBATIM_360_MAX) return `Commentaire : ${VERBATIM_360_MAX} caractères au plus`;
  return { version: QUESTIONNAIRE_360.version, notes, verbatim: verbatim || null };
}

// ——— Synthèse ———

/** Groupe restitué : relations réunies (une seule, ou fusionnées), nombre de réponses, moyenne par question (null : sous le seuil). */
export interface Groupe360 { relations: Relation360[]; reponses: number; moyennes: Record<string, number | null> }
/**
 * Synthèse jointe à l'entretien (`entretiens.synthese_feedback`), calculée par le serveur à la clôture de la collecte et
 * après chaque modération : agrégats et verbatims retenus seulement, jamais une réponse prise seule.
 */
export interface Synthese360 {
  version: string; closeLe: ISODate; seuil: number;
  envoyees: number; reponses: number;
  /** Moins de réponses que le seuil : rien n'est restitué (réponses supprimées aussitôt). */
  insuffisant: boolean;
  /**
   * Catégories des sollicitations envoyées (pas celles qui ont répondu) : elles fixent les groupes et leurs intitulés.
   * Absent d'une synthèse antérieure : catégories des réponses versées.
   */
  sollicitees?: Relation360[];
  /** Partition des réponses en groupes d'au moins `seuil` réponses (catégories fusionnées en dessous). */
  groupes: Groupe360[];
  ensemble: Groupe360 | null;
  /** Verbatims retenus par le service RH, dans l'ordre alphabétique (aucun ordre de réception). */
  verbatims: string[];
  /** Verbatims encore à relire par le service RH (restitués après). */
  aModerer: number;
  /** Verbatims jamais relus quand l'entretien a été clos (réponses brutes supprimées) : jamais restitués. */
  nonRelus?: number;
}

const moyennes = (rs: readonly Pick<Reponse360, 'notes'>[], seuil: number): Record<string, number | null> => Object.fromEntries(QUESTIONNAIRE_360.questions.map(q => {
  const v = rs.map(r => r.notes[q.cle]).filter((n): n is number => Number.isInteger(n));
  return [q.cle, v.length >= seuil ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null];
}));

/**
 * Groupes restitués, construits d'après les catégories **sollicitées** (`sollicitees`, connues à la clôture) et non d'après
 * celles qui ont répondu : chaque catégorie d'au moins `seuil` réponses seule ; les autres (moins de `seuil` réponses,
 * aucune comprise) toujours versées dans le plus petit de ces groupes, et toujours citées dans son intitulé, qu'elles aient
 * répondu ou non. Sans catégorie au seuil, un seul groupe (l'ensemble). Ainsi la réponse d'une petite catégorie (le N+2,
 * une personne au plus) ne change que les nombres et les moyennes, jamais les groupes ni leurs intitulés : personne ne lit
 * dans la synthèse quelle sollicitation a répondu. Jamais un groupe sous le seuil, ni deux groupes dont la différence
 * désignerait une petite catégorie. Moins de `seuil` réponses en tout : aucun groupe.
 */
export function groupes360(reponses: readonly Pick<Reponse360, 'relation' | 'notes'>[], seuil: number, sollicitees: readonly Relation360[] = []): Groupe360[] {
  if (reponses.length < seuil) return [];
  const par = new Map<Relation360, Pick<Reponse360, 'relation' | 'notes'>[]>();
  for (const r of reponses) par.set(r.relation, [...(par.get(r.relation) ?? []), r]);
  const grands: { relations: Relation360[]; rs: Pick<Reponse360, 'relation' | 'notes'>[] }[] = [];
  const petits: { relations: Relation360[]; rs: Pick<Reponse360, 'relation' | 'notes'>[] } = { relations: [], rs: [] };
  for (const rel of relationsRestituees(reponses, sollicitees)) {
    const rs = par.get(rel) ?? [];
    if (rs.length >= seuil) grands.push({ relations: [rel], rs });
    else { petits.relations.push(rel); petits.rs.push(...rs); }
  }
  if (!grands.length) grands.push(petits);
  else if (petits.relations.length) {
    // Le plus petit groupe ne dépend que des catégories au seuil : la réponse d'une petite catégorie ne le change pas.
    const cible = [...grands].sort((a, b) => a.rs.length - b.rs.length)[0];
    cible.relations = RELATIONS_360.filter(r => cible.relations.includes(r) || petits.relations.includes(r));
    cible.rs = [...cible.rs, ...petits.rs];
  }
  return grands.map(g => ({ relations: g.relations, reponses: g.rs.length, moyennes: moyennes(g.rs, seuil) }));
}

/** Catégories restituées : celles qui ont été sollicitées (et, par sûreté, celles qui ont répondu), dans l'ordre de RELATIONS_360. */
const relationsRestituees = (reponses: readonly Pick<Reponse360, 'relation'>[], sollicitees: readonly Relation360[]) =>
  RELATIONS_360.filter(r => sollicitees.includes(r) || reponses.some(y => y.relation === r));

/**
 * Synthèse d'après les réponses versées de l'entretien ; verbatims restitués : retenus par le service RH, seuil atteint.
 * `sollicitees` : catégories des sollicitations envoyées (gardées dans la synthèse, car les sollicitations sont purgées) ;
 * les groupes et les relations de l'ensemble en dépendent, jamais des catégories qui ont répondu.
 */
export function synthese360(reponses: readonly Reponse360[], x: { envoyees: number; closeLe: ISODate; seuil: number; sollicitees?: readonly Relation360[] }): Synthese360 {
  const seuil = Math.max(SEUIL_360_MIN, x.seuil);
  const sollicitees = relationsRestituees(reponses, x.sollicitees ?? []);
  const insuffisant = reponses.length < seuil;
  const groupes = insuffisant ? [] : groupes360(reponses, seuil, sollicitees);
  const ensemble = insuffisant ? null : moyennes(reponses, seuil);
  // Question masquée dans un groupe (moins de `seuil` notes) : masquée aussi dans l'ensemble, sans quoi la différence avec
  // les autres groupes donnerait la moyenne de quelques personnes.
  if (ensemble && groupes.length > 1) for (const q of Object.keys(ensemble)) if (groupes.some(g => g.moyennes[q] === null)) ensemble[q] = null;
  return {
    version: reponses[0]?.versionQuestionnaire ?? QUESTIONNAIRE_360.version, closeLe: x.closeLe, seuil, envoyees: x.envoyees, reponses: reponses.length, insuffisant,
    sollicitees,
    groupes: groupes.length > 1 ? groupes : [],
    ensemble: ensemble ? { relations: sollicitees, reponses: reponses.length, moyennes: ensemble } : null,
    verbatims: insuffisant ? [] : reponses.filter(r => r.verbatim && r.verbatimStatut === 'retenu').map(r => r.verbatim!).sort((a, b) => a.localeCompare(b, 'fr')),
    aModerer: insuffisant ? 0 : reponses.filter(r => r.verbatim && r.verbatimStatut === 'a_moderer').length,
  };
}

/** Synthèse lue dans l'entretien (colonne json), ou null si elle n'en a pas la forme. */
export function lireSynthese360(v: unknown): Synthese360 | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<Synthese360>;
  return typeof s.reponses === 'number' && Array.isArray(s.groupes) && Array.isArray(s.verbatims) && typeof s.closeLe === 'string' && isValidDate(s.closeLe)
    ? s as Synthese360 : null;
}

/** Libellé d'un groupe restitué (« Collègues », « Responsable N+2 et collaborateurs encadrés »). */
export function libelleGroupe360(g: Pick<Groupe360, 'relations'>): string {
  const l = g.relations.map(r => RELATION_360_LABEL[r]);
  const t = l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l.at(-1)!.toLowerCase()}` : l[0] ?? 'Répondants';
  return l.length > 1 ? `${t} (regroupés)` : t;
}

/**
 * Limite de conservation des réponses brutes et des sollicitations : envoi le plus ancien plus `mois` (6 au plus). Les
 * collectes envoyées avant ce jour sont purgées, synthèse gardée.
 */
export function limiteConservation360(today: ISODate, mois: number): ISODate {
  return addM(today, -Math.min(CONSERVATION_360_MAX_MOIS, Math.max(1, mois)));
}

/** Vocabulaire des écrans : la réponse est confidentielle (jamais « anonyme » : le service RH sait qui a été sollicité). */
export const TEXTE_CONFIDENTIALITE_360 = 'Votre avis est confidentiel : il est gardé chiffré jusqu’à la fin de la collecte, puis versé avec les autres réponses, sans votre nom ni la date de votre réponse. '
  + 'Il n’est restitué qu’en moyenne, par catégorie de répondants à partir de 3 réponses (catégories regroupées en dessous) ; votre commentaire n’est restitué qu’après la relecture du service RH. '
  + 'Ni l’évalué ni son évaluateur ne savent qui a répondu.';
