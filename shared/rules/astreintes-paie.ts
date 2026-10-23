// Astreintes dans la paie (t049, lot 7, étape 2) : famille « astreintes » du registre des éléments de lot
// (server/src/astreintes-paie.ts, server/src/elements-lot.ts). Ce que Cursus transmet : les heures d'astreinte du mois
// (AST_H) et le nombre de périodes (AST_PER), quantités seules ; la compensation elle-même (AST_COMP : montant, ou durée du
// repos) attend l'accord sur les astreintes et n'est pas calculée (réponse de l'entreprise du 23 octobre 2026 :
// compensation « je ne sais pas encore »). Les interventions, du travail effectif, sont déjà sur la feuille de temps
// (ligne INT-AST : heures normales, supplémentaires, de nuit et du dimanche) : elles ne passent pas ici.
// - Une astreinte part à la paie une fois terminée : elle ne change plus (ni annulation ni modification, sa fin ne
//   s'avance plus), d'où aucune régularisation à prévoir. Les heures sont réparties entre les mois de la période (heures
//   d'horloge, comme le récapitulatif mensuel, `bilanMensuel` de shared/rules/astreintes.ts) ; la période est comptée le
//   mois où elle commence. Un mois clos part en rappel sur la période ouverte, comme les absences.
// - Toujours réservée par le lot qui l'emporte (`Astreinte.lotId`), transmise à sa confirmation (`sage`), libérée à son
//   annulation ; rubrique désactivée (par défaut, tant que la paie n'a pas confirmé ses codes) : l'élément part sans code
//   Sage, absent du fichier, listé « à saisir dans Sage » dans le résumé du lot et l'export des variables (comme JREN).
// - Intérimaires exclus (payés par leur agence) ; astreinte annulée : rien.
import type { Domain } from '../domain.ts';
import { fH } from '../format.ts';
import type { Astreinte, ElementAstreintePaie } from '../types.ts';
import { astreinteActive, astreinteTerminee, debutAstreinte, finAstreinte, instant } from './astreintes.ts';
import { matriculeAffiche } from './matricules.ts';
import { periodeOuverte, type RubriqueVue } from './paie.ts';

/** Rubriques internes des astreintes émises par Cursus (RUBRIQUES_PAIE), dans l'ordre d'affichage. */
export const RUBRIQUES_ASTREINTE = ['AST_H', 'AST_PER'] as const;
export type RubriqueAstreinte = typeof RUBRIQUES_ASTREINTE[number];
/** Compensation des astreintes (montant ou repos) : rubrique déclarée pour la paie, chiffrée après l'accord. */
export const RUBRIQUE_COMPENSATION_ASTREINTE = 'AST_COMP';

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Mois suivant « AAAA-MM ». */
const moisSuivant = (m: string) => { const y = Number(m.slice(0, 4)), n = Number(m.slice(5, 7)); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };

/** Quantité d'une astreinte pour un mois et une rubrique. */
export interface PartAstreinte { mois: string; rubrique: RubriqueAstreinte; quantite: number }

/**
 * Parts d'une astreinte, mois par mois : heures comprises dans chaque mois (AST_H), une période le mois de son début
 * (AST_PER).
 */
export function partsAstreinte(a: Pick<Astreinte, 'du' | 'debut' | 'au' | 'fin'>): PartAstreinte[] {
  const debut = debutAstreinte(a), fin = finAstreinte(a), out: PartAstreinte[] = [];
  for (let m = a.du.slice(0, 7); m <= a.au.slice(0, 7); m = moisSuivant(m)) {
    const h = (Math.min(fin, instant(`${moisSuivant(m)}-01`, '00:00')) - Math.max(debut, instant(`${m}-01`, '00:00'))) / 60;
    if (h > 0) out.push({ mois: m, rubrique: 'AST_H', quantite: r2(h) });
    if (m === a.du.slice(0, 7)) out.push({ mois: m, rubrique: 'AST_PER', quantite: 1 });
  }
  return out.sort((x, y) => x.mois.localeCompare(y.mois) || RUBRIQUES_ASTREINTE.indexOf(x.rubrique) - RUBRIQUES_ASTREINTE.indexOf(y.rubrique));
}

/** Astreinte en attente de la paie à l'instant `maintenant` : en vigueur, terminée, ni dans un lot, ni transmise. */
export const astreinteAPayer = (a: Astreinte, maintenant: number) => astreinteActive(a) && astreinteTerminee(a, maintenant) && a.lotId == null && !a.sage;

/**
 * Éléments d'astreinte d'un lot de la période `jusqua`, à l'instant `maintenant` (minutes d'horloge, `instant`) : chaque
 * astreinte terminée en attente, entière (toutes ses parts arrivent au plus tard à `jusqua`, sinon elle attend le lot
 * suivant), sous le code Sage de la rubrique active ; désactivée, sans code Sage (à saisir dans Sage).
 */
export function elementsAstreintes(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[], maintenant: number): ElementAstreintePaie[] {
  const ouverte = periodeOuverte(d.ti, d.ds.settings?.clotureJour ?? 0);
  const code = (rubrique: string) => { const r = table.find(t => t.code === rubrique); return r?.active ? r.codeSage : null; };
  const out: ElementAstreintePaie[] = [];
  for (const a of d.ds.astreintes ?? []) {
    if (!astreinteAPayer(a, maintenant)) continue;
    const e = d.emp(a.empId);
    if (!e || d.contratOf(e).interim) continue;
    const parts = partsAstreinte(a).map(p => ({ ...p, periode: p.mois < ouverte ? ouverte : p.mois }));
    if (!parts.length || parts.some(p => p.periode > jusqua)) continue;
    for (const p of parts) {
      out.push({
        astreinte: a.id, empId: a.empId, matricule: matriculeAffiche(e), mois: p.mois, periode: p.periode, rubrique: p.rubrique, codeSage: code(p.rubrique),
        quantite: p.quantite, du: a.du, debut: a.debut, au: a.au, fin: a.fin,
      });
    }
  }
  return out.sort((x, y) => x.periode.localeCompare(y.periode) || x.empId - y.empId || x.astreinte - y.astreinte || x.mois.localeCompare(y.mois)
    || RUBRIQUES_ASTREINTE.indexOf(x.rubrique as RubriqueAstreinte) - RUBRIQUES_ASTREINTE.indexOf(y.rubrique as RubriqueAstreinte));
}

/** Astreintes d'un lot (identifiant, salarié), une fois chacune. */
export const astreintesDuContenu = (elements: readonly Pick<ElementAstreintePaie, 'astreinte' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.astreinte, { id: x.astreinte, empId: x.empId }])).values()];

/**
 * Détail d'un élément (export des variables, liste « à saisir dans Sage ») : « Astreinte n° 3 du 16/10/2026 18:00 au
 * 23/10/2026 08:00 », rappel d'un mois clos.
 */
export function detailAstreinte(x: Pick<ElementAstreintePaie, 'astreinte' | 'du' | 'debut' | 'au' | 'fin' | 'mois' | 'periode'>, moisLabel: (p: string) => string): string {
  const jour = (s: string) => s.split('-').reverse().join('/');
  return `Astreinte n° ${x.astreinte} du ${jour(x.du)} ${x.debut} au ${jour(x.au)} ${x.fin}` + (x.mois !== x.periode ? ` · rappel de ${moisLabel(x.mois)}` : '');
}

/** « 128 h, 2 périodes » : quantités d'une liste d'éléments (écran Temps). */
export function totauxAstreintes(elements: readonly Pick<ElementAstreintePaie, 'rubrique' | 'quantite'>[]): string {
  const h = r2(elements.filter(x => x.rubrique === 'AST_H').reduce((n, x) => n + x.quantite, 0));
  const p = elements.filter(x => x.rubrique === 'AST_PER').reduce((n, x) => n + x.quantite, 0);
  return `${fH(h)} d’astreinte (AST_H), ${p} période${p > 1 ? 's' : ''} (AST_PER)`;
}

/** État d'une astreinte pour la paie : « transmise à la paie (lot n° 4) », « dans le lot n° 4 », « en attente ». */
export function etatPaieAstreinte(a: Pick<Astreinte, 'lotId' | 'sage' | 'annuleLe'>): string | null {
  if (a.annuleLe) return null;
  if (a.sage) return `transmise à la paie (lot n° ${a.lotId})`;
  if (a.lotId != null) return `dans le lot de paie n° ${a.lotId}, import à confirmer`;
  return null;
}
