// Absences dans le fichier d'import de la paie (t028, lot 5, chantier I) : les absences validées partent dans le lot de
// paie avec les heures, quand le réglage `absencesFichierPaie` est actif (par défaut, réponse de l'entreprise du
// 17 octobre 2026). Partagé par la génération du lot (server/src/actions/paie.ts), le résumé de l'instantané
// (server/src/absences-paie.ts), l'export des variables de la période et l'écran Temps (client/src/components/LotsPaie.tsx).
// - Rubrique : CP, RTT (ou jours de repos du forfait jours), RECUP pour les congés ; hors congés, une rubrique par
//   rémunération de la nature (non payée, indemnisée, salaire maintenu) et par catégorie (santé, parentalité, famille).
//   Le code révèle donc la catégorie : les lignes ne vont qu'au droit « paie » (fichier, export), le journal ne garde
//   jamais ni rubrique ni nature (natureAbsence de shared/rules/temps.ts).
// - Quantité : jours décomptés au demi-jour (`Domain.countedDays` : 0,5 la demi-journée du premier ou du dernier jour),
//   jours calendaires pour les natures décomptées ainsi (arrêts, parentalité), heures pour la récupération (jours × durée
//   d'une journée, comme son compteur `recupInfo`).
// - Ventilation : jour par jour, chaque jour sur le mois où il tombe (période naturelle) ; un mois déjà clos part en rappel
//   sur la période ouverte, comme une semaine (shared/rules/paie.ts).
// - Écart : ce qui est dû moins ce que les lots non annulés ont déjà emporté, absence par absence, mois et rubrique. Une
//   absence prolongée envoie ses nouveaux jours ; annulée, raccourcie ou requalifiée après sa transmission, une
//   régularisation négative part dans le lot suivant (sans réglage « annule et remplace » pour l'instant). Une absence
//   réservée par un lot en attente de confirmation attend sa confirmation ou son annulation ; une absence repassée
//   « à qualifier » (prolongation signalée) attend sa qualification. Une régularisation reprend d'abord ce qui est parti en
//   dernier, sous le code Sage de l'élément d'origine : ce qui était parti sous une rubrique désactivée (saisi à la main
//   dans Sage) se régularise de même, sans code, jamais en négatif dans le fichier.
// - Premier jour transmis (`DepartAbsences`) : date de mise en service (réglage `absencesPaieAPartirDu`, pour toutes les
//   absences) et date de départ posée par Cursus (mise à jour d'une base existante, premier lot, réactivation du
//   réglage), pour les seules absences déjà enregistrées à ce moment ; les jours d'avant restent à la saisie dans Sage.
import { addD, parse, days } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { AbsencesPaieAttente, Absence, AbsenceType, ElementAbsencePaie, ISODate, Settings } from '../types.ts';
import type { CategorieAbsence } from '../constants.ts';
import { natureDef, uniteDecompte } from './absences.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeOuverte } from './paie.ts';

/** Ce que le fichier contient quand les absences y partent (écran, confirmations, docs/DEPLOIEMENT.md). */
export const PERIMETRE_FICHIER_ABSENCES = 'Heures validées de la semaine, samedi et dimanche compris (heures du dimanche aussi en HDIM), et absences validées en jours (récupération en heures), ventilées par mois : déplacements et heures de nuit restent saisis dans Sage.';

/** Les absences partent-elles dans le fichier ? Réglage de l'administrateur RH, actif par défaut. */
export const absencesDansLeFichier = (s: Partial<Pick<Settings, 'absencesFichierPaie'>> | undefined) => s?.absencesFichierPaie ?? true;

const CATEGORIE: Record<CategorieAbsence, string> = { sante: 'SANTE', parentalite: 'PARENT', famille: 'FAMILLE', non_payee: 'NP' };

/**
 * Rubrique interne (RUBRIQUES_PAIE) d'une absence : CP, RTT, RECUP ; hors congés, ABS_NP pour une absence non payée,
 * sinon ABS_IND_<catégorie> (indemnités journalières, complément employeur) ou ABS_MAINT_<catégorie> (salaire maintenu).
 * Null pour une absence à qualifier, qui ne part pas.
 */
export function rubriqueAbsence(t: AbsenceType): string | null {
  if (t === 'CP' || t === 'RTT' || t === 'RECUP') return t;
  const n = natureDef(t);
  if (!n) return null;
  if (n.paie === 'non_payee' || n.categorie === 'non_payee') return 'ABS_NP';
  return `ABS_${n.paie === 'indemnisee' ? 'IND' : 'MAINT'}_${CATEGORIE[n.categorie]}`;
}

/** Quantités du fichier au centième, comme les heures (shared/rules/lots-paie.ts). */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Jours d'une absence, mois par mois : quantité (jours pondérés, ou heures de récupération) et premier et dernier jour. */
export interface PartMois { mois: string; quantite: number; du: ISODate; au: ISODate }

/**
 * Jours décomptés d'une absence ventilés par mois (décompte de la nature : calendaires, ou ouvrés et travaillés au
 * demi-jour par `countedDays`), à partir de `depuis` (jours antérieurs laissés à la saisie dans Sage) et jusqu'au
 * dernier jour du mois `jusqua` inclus. Récupération en heures.
 */
export function partsAbsence(d: Domain, a: Pick<Absence, 'empId' | 'type' | 'du' | 'au' | 'debutDemi' | 'finDemi'>, jusqua: string, depuis: ISODate | null = null): PartMois[] {
  const e = d.emp(a.empId);
  if (!e) return [];
  const jours = uniteDecompte(a.type) === 'calendaires'
    ? Array.from({ length: days(parse(a.du), parse(a.au)) + 1 }, (_, i) => ({ jour: addD(a.du, i), poids: 1 }))
    : d.countedDays(e, a.du, a.au, a.type, a);
  const facteur = a.type === 'RECUP' ? d.dayH(e) : 1;
  const parts = new Map<string, PartMois>();
  for (const j of jours) {
    const mois = moisDe(j.jour);
    if ((depuis && j.jour < depuis) || mois > jusqua) continue;
    const p = parts.get(mois) ?? { mois, quantite: 0, du: j.jour, au: j.jour };
    p.quantite += j.poids * facteur;
    p.au = j.jour;
    parts.set(mois, p);
  }
  return [...parts.values()].map(p => ({ ...p, quantite: r2(p.quantite) }));
}

/** Élément d'absence calculé, avant la traduction de sa rubrique en code Sage (faite à la génération du lot). */
/**
 * `codeSage` présent : code imposé à une régularisation, celui de l'élément d'origine (null : parti sous une rubrique
 * désactivée, à corriger à la main dans Sage) ; absent : traduit avec la table des rubriques.
 */
export type ElementCalcule = Omit<ElementAbsencePaie, 'codeSage'> & { codeSage?: string | null };
/** Ce qu'un lot non annulé a déjà emporté d'une absence (code Sage figé ; absent : inconnu, traduit de nouveau). */
export type ElementEmis = Pick<ElementAbsencePaie, 'absence' | 'mois' | 'rubrique' | 'quantite' | 'du' | 'au'> & { codeSage?: string | null };

/**
 * Premier jour transmis par Cursus : `aPartirDu`, date de mise en service (réglage de l'administrateur RH), vaut pour
 * toutes les absences ; `depuis`, date de départ posée par Cursus (mise à jour d'une base existante, premier lot de paie,
 * réactivation du réglage), ne vaut que pour les absences déjà enregistrées alors (identifiant au plus `jusqua`, toutes
 * si null) : une absence d'un mois passé enregistrée ensuite part en rappel, la paie ne l'a pas saisie dans Sage.
 */
export interface DepartAbsences { aPartirDu: ISODate | null; depuis: ISODate | null; jusqua: number | null }

/** Premier jour transmis d'une absence : la plus tardive des bornes qui la concernent ; null : tous ses jours. */
export function premierJourTransmis(a: Pick<Absence, 'id'>, dep: DepartAbsences | null | undefined): ISODate | null {
  if (!dep) return null;
  const depuis = dep.depuis && (dep.jusqua == null || a.id <= dep.jusqua) ? dep.depuis : null;
  return [dep.aPartirDu, depuis].filter((x): x is ISODate => !!x).sort().at(-1) ?? null;
}

export interface OptionsAbsencesPaie {
  /** Période du lot (AAAA-MM) : éléments dont la période de destination vient au plus tard. */
  jusqua: string;
  /** Éléments des lots non annulés (générés ou transmis). */
  emis: readonly ElementEmis[];
  /** Absences réservées par un lot généré, en attente de la confirmation de son import. */
  reservees: ReadonlySet<number>;
  /** Premier jour transmis par Cursus (les jours d'avant sont saisis dans Sage) ; null : tous. */
  depart: DepartAbsences | null;
}

/**
 * Éléments d'absence d'un lot : pour chaque absence validée (ou déjà transmise), chaque mois et chaque rubrique, l'écart
 * entre ce qui est dû et ce que les lots ont déjà emporté ; écart nul omis. Intérimaires exclus (absences gérées par
 * l'agence) ; absence en attente (demandée, ou signalée à qualifier) ou réservée par un lot à confirmer : rien.
 */
export function elementsAbsences(d: Domain, o: OptionsAbsencesPaie): ElementCalcule[] {
  const ouverte = periodeOuverte(d.ti, d.ds.settings?.clotureJour ?? 0);
  const emisPar = new Map<number, ElementEmis[]>();
  for (const x of o.emis) emisPar.set(x.absence, [...(emisPar.get(x.absence) ?? []), x]);
  const out: ElementCalcule[] = [];
  for (const a of d.ds.absences) {
    const deja = emisPar.get(a.id) ?? [];
    const rubrique = rubriqueAbsence(a.type);
    if (o.reservees.has(a.id) || a.statut === 'demandee' || a.statut === 'signalee') continue;
    const e = d.emp(a.empId);
    if (!e || d.contratOf(e).interim) continue;
    // Jours d'avant le premier jour transmis : ni dus, ni régularisés (laissés à Sage).
    const premier = premierJourTransmis(a, o.depart);
    const parti = premier ? deja.filter(x => x.au >= premier) : deja;
    const due = a.statut === 'validee' && rubrique ? partsAbsence(d, a, o.jusqua, premier) : [];
    if (!due.length && !parti.length) continue;
    // Clés « mois|rubrique » : ce qui est dû, et ce qui est parti (une requalification change la rubrique), avec la pile
    // de ce qui est parti sous chaque code Sage, dans l'ordre des lots.
    const cles = new Map<string, { mois: string; rubrique: string; du: ISODate; au: ISODate; due: number; emis: number; pile: Pile }>();
    for (const p of due) cles.set(`${p.mois}|${rubrique}`, { mois: p.mois, rubrique: rubrique!, du: p.du, au: p.au, due: p.quantite, emis: 0, pile: [] });
    for (const x of parti) {
      const k = `${x.mois}|${x.rubrique}`;
      const c = cles.get(k) ?? { mois: x.mois, rubrique: x.rubrique, du: x.du, au: x.au, due: 0, emis: 0, pile: [] };
      c.emis += x.quantite;
      if (x.quantite > 0) c.pile.push({ codeSage: x.codeSage, quantite: x.quantite });
      else retirer(c.pile, -x.quantite);
      cles.set(k, c);
    }
    for (const c of cles.values()) {
      const quantite = r2(c.due - c.emis);
      const periode = c.mois >= ouverte ? c.mois : ouverte;
      if (!quantite || periode > o.jusqua) continue;
      const base = { absence: a.id, empId: a.empId, matricule: matriculeAffiche(e), mois: c.mois, periode, rubrique: c.rubrique, du: c.du, au: c.au };
      if (quantite > 0) out.push({ ...base, quantite });
      // Régularisation : sous le code de ce qui est parti en dernier (null : saisi à la main dans Sage, corrigé de même).
      else for (const r of retirer(c.pile, -quantite)) out.push({ ...base, quantite: -r.quantite, ...(r.codeSage !== undefined ? { codeSage: r.codeSage } : {}) });
    }
  }
  return out.sort((x, y) => x.periode.localeCompare(y.periode) || x.empId - y.empId || x.absence - y.absence || x.mois.localeCompare(y.mois));
}

/** Quantités parties sous chaque code Sage, dans l'ordre des lots (undefined : code inconnu, traduit de nouveau). */
type Pile = { codeSage: string | null | undefined; quantite: number }[];

/**
 * Retire `q` de la pile en commençant par ce qui est parti en dernier ; renvoie ce qui est retiré, par code Sage (au-delà
 * de la pile : code inconnu).
 */
function retirer(pile: Pile, q: number): Pile {
  const out: Pile = [];
  let reste = r2(q);
  while (reste > 0 && pile.length) {
    const haut = pile.at(-1)!, n = Math.min(haut.quantite, reste), prec = out.at(-1);
    if (prec && prec.codeSage === haut.codeSage) prec.quantite = r2(prec.quantite + n);
    else out.push({ codeSage: haut.codeSage, quantite: r2(n) });
    haut.quantite = r2(haut.quantite - n);
    reste = r2(reste - n);
    if (haut.quantite <= 0) pile.pop();
  }
  if (reste > 0) out.push({ codeSage: undefined, quantite: reste });
  return out;
}

/** Absences en attente par période de destination (écran Temps), rubriques internes émises comprises. */
export function absencesParPeriode(elements: readonly ElementCalcule[]): AbsencesPaieAttente[] {
  const periodes = [...new Set(elements.map(x => x.periode))].sort();
  return periodes.map(periode => {
    const l = elements.filter(x => x.periode === periode);
    return {
      periode,
      absences: new Set(l.map(x => x.absence)).size,
      ids: [...new Set(l.map(x => x.absence))].sort((a, b) => a - b),
      empIds: [...new Set(l.map(x => x.empId))].sort((a, b) => a - b),
      regularisations: new Set(l.filter(x => x.quantite < 0).map(x => x.absence)).size,
      idsRegularisations: [...new Set(l.filter(x => x.quantite < 0).map(x => x.absence))].sort((a, b) => a - b),
      rappels: [...new Set(l.filter(x => x.mois !== periode).map(x => x.mois))].sort(),
      rubriques: [...new Set(l.map(x => x.rubrique))].sort(),
    };
  });
}

/**
 * Absences en attente d'un lot de la période `periode` : celles des périodes qui viennent au plus tard, chacune une fois
 * (une absence ventilée sur deux périodes de destination appartient aux deux groupes).
 */
export function absencesDuLot(groupes: readonly AbsencesPaieAttente[], periode: string) {
  const l = groupes.filter(g => g.periode <= periode);
  return {
    absences: new Set(l.flatMap(g => g.ids)).size, regularisations: new Set(l.flatMap(g => g.idsRegularisations)).size, empIds: [...new Set(l.flatMap(g => g.empIds))],
    rappels: [...new Set(l.flatMap(g => g.rappels))].sort(), rubriques: [...new Set(l.flatMap(g => g.rubriques))].sort(),
  };
}

/**
 * Détail d'un élément pour l'export des variables de la période : « Absence n° 12, du 12/10/2026 au 16/10/2026 », rappel
 * d'un mois clos, régularisation. Jamais la nature : la rubrique suffit à la paie.
 */
export function detailElement(x: Pick<ElementAbsencePaie, 'absence' | 'mois' | 'periode' | 'quantite' | 'du' | 'au'>, moisLabel: (p: string) => string): string {
  const jour = (s: ISODate) => s.split('-').reverse().join('/');
  return `Absence n° ${x.absence}, ${x.du === x.au ? `le ${jour(x.du)}` : `du ${jour(x.du)} au ${jour(x.au)}`}`
    + (x.mois !== x.periode ? ` · rappel de ${moisLabel(x.mois)}` : '')
    + (x.quantite < 0 ? ' · régularisation (absence annulée, raccourcie ou requalifiée après transmission)' : '');
}

/** Totaux des éléments d'absence d'un contenu : éléments, salariés, quantité par code Sage (rubriques exportées). */
export function resumeAbsences(elements: readonly Pick<ElementAbsencePaie, 'empId' | 'codeSage' | 'quantite'>[]) {
  const rubriques: Record<string, number> = {};
  for (const x of elements) if (x.codeSage) rubriques[x.codeSage] = r2((rubriques[x.codeSage] ?? 0) + x.quantite);
  return { elements: elements.length, salaries: new Set(elements.map(x => x.empId)).size, rubriques };
}
