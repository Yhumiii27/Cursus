// Déplacements dans le fichier d'import de la paie (t031, lot 6, chantier 2) : ce que Cursus transmet à la paie pour les
// missions sur chantier et les déplacements à l'étranger (décision de l'entreprise : jours et nuits de grand déplacement
// en France, jours de mission à l'étranger par pays, un forfait par trajet aller ou retour). Quantités seules : le barème
// des indemnités reste dans Sage. Partagé par la génération du lot (server/src/deplacements-paie.ts, registre des
// éléments de lot), le résumé de l'instantané, l'export des variables et les écrans Missions, Voyages et Temps.
// - Séjours : à l'étranger, chaque déplacement en vigueur (`voyageActif` : un déplacement annulé sort) vers une
//   destination du référentiel (jamais la France : `controlerDestination`) ; en France, chaque mission (affectation
//   Keystone) sur un chantier en France qualifié « grand déplacement » par le service RH (`Chantier.grandDeplacement`).
//   Le critère URSSAF (distance, temps de trajet) ne se calcule pas sans adresses : la qualification est saisie, proposée
//   pour un chantier en France (Keystone ne transmet que des chantiers chez les clients, hors du site). Une mission à
//   l'étranger ne compte pas : son déplacement porte les jours (pas de double compte).
// - Quantités : jours calendaires du séjour (week-end compris), sauf les jours d'absence validée ou signalée et ceux
//   après la sortie ; nuits de grand déplacement = jours − 1 par séjour (pas de nuit après le dernier jour compté) ;
//   2 trajets par séjour (aller le premier jour, retour le dernier), aucun si tous ses jours sont des absences.
// - Ventilation : jour par jour, chaque jour sur son mois ; un mois clos part en rappel sur la période ouverte, comme les
//   absences (shared/rules/absences-paie.ts). Écart : ce qui est dû moins ce que les lots non annulés ont emporté (table
//   `deplacementsPaie`), séjour par séjour, mois, rubrique et pays ; un séjour annulé ou raccourci après sa transmission
//   part en régularisation négative. Un séjour réservé par un lot à confirmer attend sa confirmation ou son annulation.
// - Premier jour transmis : date de mise en service (réglage `deplacementsPaieAPartirDu`) et date de départ posée par
//   Cursus (migration lot6-paie-deplacements-depart d'une base existante, premier lot d'une base neuve).
// - Fichier : réglage `deplacementsFichierPaie` décoché par défaut et rubriques désactivées par défaut. Sans l'un ou
//   l'autre, l'élément part quand même dans le lot sans code Sage : absent du fichier, listé « à saisir dans Sage » dans
//   le résumé du lot et l'export des variables, et compté comme émis à la confirmation (il ne repart pas ensuite).
import { addD, days, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Chantier, ElementDeplacementPaie, ISODate, Settings } from '../types.ts';
import { voyageActif } from './deplacements.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeOuverte, type RubriqueVue } from './paie.ts';

/** Rubriques internes des déplacements (RUBRIQUES_PAIE), dans l'ordre d'affichage. */
export const RUBRIQUES_DEPLACEMENT = ['GD_JOUR', 'GD_NUIT', 'ETR_JOUR', 'TRAJET'] as const;
export type RubriqueDeplacement = typeof RUBRIQUES_DEPLACEMENT[number];

/** Les déplacements partent-ils dans le fichier ? Réglage de l'administrateur RH, désactivé par défaut (codes Sage à confirmer). */
export const deplacementsDansLeFichier = (s: Partial<Pick<Settings, 'deplacementsFichierPaie'>> | undefined) => s?.deplacementsFichierPaie ?? false;

/** Grand déplacement proposé par Cursus tant que le service RH n'a pas qualifié le chantier : chantier en France. */
export const grandDeplacementPropose = (c: Pick<Chantier, 'pays'>) => c.pays === 'FR';
/** Chantier qualifié « grand déplacement » par le service RH (seule une qualification saisie compte pour la paie). */
export const grandDeplacement = (c: Pick<Chantier, 'pays' | 'grandDeplacement'>) => c.pays === 'FR' && c.grandDeplacement === true;
/** Chantier en France pas encore qualifié par le service RH. */
export const aQualifier = (c: Pick<Chantier, 'pays' | 'grandDeplacement'>) => c.pays === 'FR' && c.grandDeplacement == null;

/** Quantités au centième, comme le fichier. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Séjour donnant des éléments de paie : déplacement à l'étranger, ou mission sur un chantier en grand déplacement. */
export interface SejourPaie { source: 'voyage' | 'mission'; id: number; empId: number; du: ISODate; au: ISODate; pays: string }

/** Clé d'un séjour (« voyage:12 »), pour la réservation par un lot. */
export const cleSejour = (x: Pick<ElementDeplacementPaie, 'source' | 'sourceId'> | Pick<SejourPaie, 'source' | 'id'>) =>
  `${x.source}:${'sourceId' in x ? x.sourceId : x.id}`;

/** Séjours de l'instantané : déplacements à l'étranger en vigueur, missions des chantiers en grand déplacement. */
export function sejoursPaie(d: Domain): SejourPaie[] {
  const out: SejourPaie[] = [];
  for (const v of d.ds.voyages) {
    if (!voyageActif(v)) continue;
    const dest = d.destOf(v.dest);
    // Toute destination du référentiel est à l'étranger ; un code « FR » (donnée ancienne) ne compte pas comme tel.
    if (v.dest === 'FR' || (dest && dest.code === 'FR')) continue;
    out.push({ source: 'voyage', id: v.id, empId: v.empId, du: v.depart, au: v.retour, pays: v.dest });
  }
  for (const m of d.ds.missions) {
    const c = d.chantier(m.projet);
    if (!c || !grandDeplacement(c)) continue;
    out.push({ source: 'mission', id: m.id, empId: m.empId, du: m.du, au: m.au, pays: 'FR' });
  }
  return out;
}

/** Quantité d'un séjour pour un mois et une rubrique, avant l'écart avec ce qui est déjà parti. */
export interface PartDeplacement { rubrique: RubriqueDeplacement; mois: string; quantite: number; du: ISODate; au: ISODate }

/**
 * Parts d'un séjour, mois par mois, jusqu'au mois `jusqua` inclus et à partir du jour `depuis` : jours (GD_JOUR en France,
 * ETR_JOUR à l'étranger) hors absences validées ou signalées et hors des jours qui suivent la sortie, nuits de grand
 * déplacement (chaque jour compté sauf le dernier), trajets aller et retour (premier et dernier jour du séjour, s'il
 * compte au moins un jour).
 */
export function partsSejour(d: Domain, s: SejourPaie, jusqua: string, depuis: ISODate | null = null): PartDeplacement[] {
  const e = d.emp(s.empId);
  if (!e) return [];
  const n = days(parse(s.du), parse(s.au)) + 1;
  const comptes: ISODate[] = [];
  for (let i = 0; i < n; i++) {
    const j = addD(s.du, i);
    if (e.fin && j > e.fin) break;
    if (!d.absOn(s.empId, j)) comptes.push(j);
  }
  const parts = new Map<string, PartDeplacement>();
  const ajouter = (rubrique: RubriqueDeplacement, j: ISODate, q: number) => {
    const mois = moisDe(j);
    if ((depuis && j < depuis) || mois > jusqua) return;
    const cle = `${rubrique}|${mois}`;
    const p = parts.get(cle) ?? { rubrique, mois, quantite: 0, du: j, au: j };
    p.quantite += q;
    if (j < p.du) p.du = j;
    if (j > p.au) p.au = j;
    parts.set(cle, p);
  };
  const jour: RubriqueDeplacement = s.source === 'mission' ? 'GD_JOUR' : 'ETR_JOUR';
  comptes.forEach((j, i) => {
    ajouter(jour, j, 1);
    if (s.source === 'mission' && i < comptes.length - 1) ajouter('GD_NUIT', j, 1);
  });
  if (comptes.length) {
    ajouter('TRAJET', s.du, 1);
    ajouter('TRAJET', e.fin && s.au > e.fin ? e.fin : s.au, 1);
  }
  return [...parts.values()].map(p => ({ ...p, quantite: r2(p.quantite) }))
    .sort((a, b) => a.mois.localeCompare(b.mois) || RUBRIQUES_DEPLACEMENT.indexOf(a.rubrique) - RUBRIQUES_DEPLACEMENT.indexOf(b.rubrique));
}

/** Ce qu'un lot non annulé a déjà emporté d'un séjour (ligne de la table `deplacementsPaie`). */
export type DeplacementEmis = Pick<ElementDeplacementPaie, 'source' | 'sourceId' | 'empId' | 'mois' | 'rubrique' | 'pays' | 'quantite' | 'codeSage' | 'du' | 'au'> & { id?: number };

export interface OptionsDeplacementsPaie {
  /** Période du lot (AAAA-MM) : éléments dont la période de destination vient au plus tard. */
  jusqua: string;
  /** Éléments des lots non annulés (générés ou transmis). */
  emis: readonly DeplacementEmis[];
  /** Séjours réservés par un lot généré, en attente de la confirmation de son import (`cleSejour`). */
  reserves: ReadonlySet<string>;
  /** Premier jour transmis (date de mise en service, date de départ posée par Cursus) ; null : tous. */
  depuis: ISODate | null;
  /** Rubrique interne → code Sage du fichier, null si l'élément est à saisir dans Sage (rubrique désactivée, réglage décoché). */
  codeSage: (rubrique: string) => string | null;
}

/**
 * Éléments de déplacement d'un lot : pour chaque séjour, mois, rubrique et pays, l'écart entre ce qui est dû et ce que
 * les lots ont emporté ; écart nul omis. Un séjour qui n'est plus dû (annulé, chantier déqualifié) se régularise en
 * négatif, sous le code Sage du dernier élément parti (null : il avait été saisi à la main dans Sage). Intérimaires
 * exclus (payés par leur agence) ; séjour réservé par un lot à confirmer : rien.
 */
export function elementsDeplacements(d: Domain, o: OptionsDeplacementsPaie): ElementDeplacementPaie[] {
  const ouverte = periodeOuverte(d.ti, d.ds.settings?.clotureJour ?? 0);
  const cle = (x: { source: string; sourceId: number; mois: string; rubrique: string; pays: string }) => `${x.source}:${x.sourceId}|${x.mois}|${x.rubrique}|${x.pays}`;
  const emis = new Map<string, { q: number; dernier: DeplacementEmis }>();
  for (const x of o.emis) {
    const k = cle(x), deja = emis.get(k);
    emis.set(k, { q: r2((deja?.q ?? 0) + x.quantite), dernier: !deja || (x.id ?? 0) >= (deja.dernier.id ?? 0) ? x : deja.dernier });
  }
  const dus = new Map<string, { source: 'voyage' | 'mission'; sourceId: number; empId: number; mois: string; rubrique: string; pays: string; q: number; du: ISODate; au: ISODate }>();
  for (const s of sejoursPaie(d)) {
    if (o.reserves.has(cleSejour(s))) continue;
    const e = d.emp(s.empId);
    if (!e || d.contratOf(e).interim) continue;
    for (const p of partsSejour(d, s, o.jusqua, o.depuis)) {
      const x = { source: s.source, sourceId: s.id, empId: s.empId, mois: p.mois, rubrique: p.rubrique, pays: s.pays, q: p.quantite, du: p.du, au: p.au };
      dus.set(cle(x), x);
    }
  }
  const out: ElementDeplacementPaie[] = [];
  const matriculeDe = (empId: number) => { const e = d.emp(empId); return e ? matriculeAffiche(e) : String(empId); };
  for (const [k, x] of dus) {
    const ecart = r2(x.q - (emis.get(k)?.q ?? 0));
    if (!ecart) continue;
    out.push({
      source: x.source, sourceId: x.sourceId, empId: x.empId, matricule: matriculeDe(x.empId), mois: x.mois, periode: x.mois < ouverte ? ouverte : x.mois,
      rubrique: x.rubrique, codeSage: ecart < 0 ? emis.get(k)!.dernier.codeSage : o.codeSage(x.rubrique), quantite: ecart, pays: x.pays, du: x.du, au: x.au,
    });
  }
  // Séjours (ou parts) plus dus du tout : régularisation de ce qui est parti, sauf pour un séjour réservé.
  for (const [k, { q, dernier }] of emis) {
    if (dus.has(k) || !q || o.reserves.has(cleSejour(dernier)) || dernier.mois > o.jusqua) continue;
    out.push({
      source: dernier.source, sourceId: dernier.sourceId, empId: dernier.empId, matricule: matriculeDe(dernier.empId), mois: dernier.mois,
      periode: dernier.mois < ouverte ? ouverte : dernier.mois, rubrique: dernier.rubrique, codeSage: dernier.codeSage, quantite: -q, pays: dernier.pays, du: dernier.du, au: dernier.au,
    });
  }
  return out.sort((a, b) => a.periode.localeCompare(b.periode) || a.empId - b.empId || a.mois.localeCompare(b.mois)
    || RUBRIQUES_DEPLACEMENT.indexOf(a.rubrique as RubriqueDeplacement) - RUBRIQUES_DEPLACEMENT.indexOf(b.rubrique as RubriqueDeplacement) || a.pays.localeCompare(b.pays));
}

/**
 * Code Sage d'une rubrique de déplacement dans le fichier : celui de la table si le réglage est coché et la rubrique
 * active, sinon null (à saisir dans Sage).
 */
export const codeSageDeplacement = (s: Partial<Pick<Settings, 'deplacementsFichierPaie'>> | undefined, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[]) =>
  (rubrique: string): string | null => {
    if (!deplacementsDansLeFichier(s)) return null;
    const r = table.find(t => t.code === rubrique);
    return r?.active ? r.codeSage : null;
  };

/** Séjours d'un lot (source, identifiant, salarié), une fois chacun. */
export const sejoursDuContenu = (elements: readonly Pick<ElementDeplacementPaie, 'source' | 'sourceId' | 'empId'>[]) =>
  [...new Map(elements.map(x => [cleSejour(x), { source: x.source, id: x.sourceId, empId: x.empId }])).values()];

/**
 * Détail d'un élément (export des variables, liste « à saisir dans Sage ») : « Maroc · du 27/10/2026 au 31/10/2026 ·
 * déplacement n° 3 », rappel d'un mois clos, régularisation.
 */
export function detailDeplacement(x: Pick<ElementDeplacementPaie, 'source' | 'sourceId' | 'mois' | 'periode' | 'quantite' | 'du' | 'au' | 'pays'>, paysLabel: (code: string) => string, moisLabel: (p: string) => string): string {
  const jour = (s: ISODate) => s.split('-').reverse().join('/');
  return `${x.pays === 'FR' ? 'France, grand déplacement' : paysLabel(x.pays)} · ${x.du === x.au ? `le ${jour(x.du)}` : `du ${jour(x.du)} au ${jour(x.au)}`}`
    + ` · ${x.source === 'mission' ? `mission n° ${x.sourceId}` : `déplacement n° ${x.sourceId}`}`
    + (x.mois !== x.periode ? ` · rappel de ${moisLabel(x.mois)}` : '')
    + (x.quantite < 0 ? ' · régularisation (séjour annulé ou raccourci après transmission)' : '');
}

/** « GD_JOUR 5 · TRAJET 2 » : quantités par rubrique interne d'une liste d'éléments. */
export function totauxDeplacements(elements: readonly Pick<ElementDeplacementPaie, 'rubrique' | 'quantite'>[]): string {
  const t = new Map<string, number>();
  for (const x of elements) t.set(x.rubrique, r2((t.get(x.rubrique) ?? 0) + x.quantite));
  return RUBRIQUES_DEPLACEMENT.filter(r => t.get(r)).map(r => `${r} ${t.get(r)!.toLocaleString('fr-FR')}`).join(' · ');
}
