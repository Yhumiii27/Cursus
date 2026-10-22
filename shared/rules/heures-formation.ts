// Durée des formations en heures et indicateurs du plan de formation par exercice (t122). La durée du catalogue reste un
// texte libre (« 7 h (MAC) ») ; `dureeHeures`, facultative, en est le nombre, extrait du texte à la reprise quand c'est
// possible (migration lot6-securite-duree-heures). Heures réalisées d'une participation présente : horaires de la session
// s'ils sont saisis, sinon la durée du catalogue ; sans l'une ni l'autre, la ligne compte « durée inconnue » et est
// signalée. Les indicateurs suivent la catégorie du catalogue (Réglementaire, Recommandée, Interne, hors catalogue) : un
// site d'environ 100 salariés n'a pas de bilan social obligatoire, ils servent à la BDESE.
import { STATUTS } from '../constants.ts';
import type { Domain } from '../domain.ts';
import type { Formation, FormationType, ISODate, Session, Statut } from '../types.ts';
import { coutRetenu } from './exercices.ts';
import { heuresSuivie, intituleSuivie, suiviesEnVigueur } from './formations-suivies.ts';
import { heuresHoraire, horaireDuJour, joursSession } from './plage-session.ts';

/** Durée maximale saisie (heures) : au-delà, une faute de frappe. */
export const DUREE_HEURES_MAX = 2000;

/** Durée en heures acceptée : de 0,25 à 2 000. */
export const dureeValide = (n: number) => Number.isFinite(n) && n >= 0.25 && n <= DUREE_HEURES_MAX;

/**
 * Nombre d'heures lu dans une durée en texte : « 21 h », « 7 h (MAC) », « 3,5 heures », « 14h » ; null sinon (« 2 jours »,
 * vide, plusieurs durées différentes). Jamais d'estimation : une durée en jours reste à compléter.
 */
export function dureeHeuresDe(texte: string | null | undefined): number | null {
  const t = (texte ?? '').toLowerCase();
  const trouves = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:h(?![a-z])|heures?\b)/g)].map(m => Number(m[1].replace(',', '.')));
  const distincts = [...new Set(trouves)];
  return distincts.length === 1 && dureeValide(distincts[0]) ? distincts[0] : null;
}

/** Heures d'une session pour un participant présent : horaires de chaque jour, sinon la durée du catalogue, sinon null. */
export function heuresSession(s: Pick<Session, 'date' | 'fin' | 'jours' | 'horaires'>, fm: Pick<Formation, 'dureeHeures'> | null | undefined): number | null {
  if (s.horaires?.length) {
    const h = joursSession(s).map(j => horaireDuJour(s, j)).reduce((n, x) => n + (x ? heuresHoraire(x) : 0), 0);
    if (h > 0) return Math.round(h * 100) / 100;
  }
  return fm?.dureeHeures ?? null;
}

/** Catégorie d'une formation pour les indicateurs : type du catalogue, ou « Hors catalogue ». */
export type CategorieFormation = FormationType | 'Hors catalogue';
export const CATEGORIES_FORMATION: readonly CategorieFormation[] = ['Réglementaire', 'Recommandée', 'Interne', 'Hors catalogue'];

/** Formation réalisée par un salarié, comptée dans les indicateurs. */
export interface Realisation {
  empId: number; nom: string; equipe: string; statut: Statut; categorie: CategorieFormation; intitule: string; date: ISODate;
  /** Heures ; null : durée inconnue (ni horaires, ni durée du catalogue ou saisie). */
  heures: number | null;
  source: 'session' | 'certification' | 'suivie';
}

/** Ligne d'un indicateur : stagiaires (salariés distincts), formations réalisées, heures connues, lignes de durée inconnue. */
export interface LigneIndicateur { cle: string; stagiaires: number; realisations: number; heures: number; inconnues: number }

export interface IndicateursFormation {
  exercice: number;
  total: LigneIndicateur;
  parCategorie: LigneIndicateur[];
  parEquipe: LigneIndicateur[];
  parStatut: LigneIndicateur[];
  /** Actions du plan de l'exercice (hors reportées), réalisées, et taux de réalisation (%, null sans action). */
  actions: number; actionsRealisees: number; tauxRealisation: number | null;
  /** Coût prévu de toutes les actions (hors reportées) et coût retenu des réalisées (réel saisi à la clôture). */
  coutPrevu: number; coutRealise: number;
  /** Réalisations sans durée connue, à compléter (durée en heures du catalogue ou de la formation suivie). */
  inconnues: Realisation[];
  realisations: Realisation[];
}

/**
 * Formations réalisées pendant l'année civile `exercice` : participations présentes aux sessions clôturées (horaires ou
 * durée du catalogue), certifications enregistrées sans session (saisie, reprise) et formations suivies (hors catalogue,
 * plan, saisie). Une certification produite par une session n'est comptée qu'une fois, par sa participation.
 */
export function realisationsDe(d: Domain, exercice: number): Realisation[] {
  const debut = `${exercice}-01-01`, fin = `${exercice}-12-31`;
  const dans = (j: ISODate) => j >= debut && j <= fin;
  const out: Realisation[] = [];
  const pour = (empId: number) => {
    const e = d.emp(empId);
    return e ? { empId, nom: e.nom, equipe: e.equipe ?? 'À affecter', statut: e.statut } : null;
  };
  const sessions = new Map(d.ds.sessions.map(s => [s.id, s]));
  const parSession = new Set<number>();
  for (const p of d.ds.participations) {
    if (p.certId) parSession.add(p.certId);
    const s = sessions.get(p.sessionId);
    if (!p.present || !s || s.statut !== 'Clôturée' || !dans(s.date)) continue;
    const qui = pour(p.empId), fm = d.fm(s.formation);
    if (qui) out.push({ ...qui, categorie: fm?.type ?? 'Hors catalogue', intitule: fm?.nom ?? s.formation, date: s.date, heures: heuresSession(s, fm), source: 'session' });
  }
  for (const e of d.ds.employes) {
    for (const c of e.certs) {
      if (parSession.has(c.id) || !dans(c.obtenue)) continue;
      const fm = d.fm(c.f);
      out.push({ empId: e.id, nom: e.nom, equipe: e.equipe ?? 'À affecter', statut: e.statut, categorie: fm?.type ?? 'Hors catalogue', intitule: fm?.nom ?? c.f, date: c.obtenue, heures: fm?.dureeHeures ?? null, source: 'certification' });
    }
  }
  for (const x of suiviesEnVigueur(d.ds)) {
    const qui = pour(x.empId);
    if (!qui || !dans(x.du)) continue;
    const fm = x.f ? d.fm(x.f) : null;
    out.push({ ...qui, categorie: fm?.type ?? 'Hors catalogue', intitule: intituleSuivie(d, x), date: x.du, heures: heuresSuivie(d, x), source: 'suivie' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.nom.localeCompare(b.nom));
}

function ligne(cle: string, rs: Realisation[]): LigneIndicateur {
  return {
    cle, stagiaires: new Set(rs.map(r => r.empId)).size, realisations: rs.length,
    heures: Math.round(rs.reduce((n, r) => n + (r.heures ?? 0), 0) * 100) / 100, inconnues: rs.filter(r => r.heures == null).length,
  };
}
const grouper = (rs: Realisation[], cle: (r: Realisation) => string, ordre?: readonly string[]) => {
  const cles = ordre ?? [...new Set(rs.map(cle))].sort((a, b) => a.localeCompare(b));
  return cles.map(k => ligne(k, rs.filter(r => cle(r) === k)));
};

/** Indicateurs de l'exercice : stagiaires, heures par catégorie, par équipe et par statut, coûts et taux de réalisation. */
export function indicateursFormation(d: Domain, exercice: number): IndicateursFormation {
  const realisations = realisationsDe(d, exercice);
  const plan = d.ds.plan.filter(l => l.exercice === exercice && l.statut !== 'reporte');
  const realisees = plan.filter(l => l.statut === 'realise');
  return {
    exercice,
    total: ligne('Total', realisations),
    parCategorie: grouper(realisations, r => r.categorie, CATEGORIES_FORMATION),
    parEquipe: grouper(realisations, r => r.equipe),
    parStatut: grouper(realisations, r => STATUTS[r.statut]?.label ?? r.statut, Object.values(STATUTS).map(s => s.label)),
    actions: plan.length, actionsRealisees: realisees.length, tauxRealisation: plan.length ? Math.round(realisees.length / plan.length * 100) : null,
    coutPrevu: plan.reduce((n, l) => n + l.cout, 0), coutRealise: realisees.reduce((n, l) => n + coutRetenu(l), 0),
    inconnues: realisations.filter(r => r.heures == null),
    realisations,
  };
}
