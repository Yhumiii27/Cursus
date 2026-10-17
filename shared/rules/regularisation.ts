// Réouverture d'une feuille de temps validée et régularisation de la paie (t131, lot 5, chantier A) : une erreur
// découverte après la validation, ou après la transmission à Sage, se corrige sans tout ressaisir dans Sage.
// - Réouverture : administrateur RH seul, motif obligatoire (500 caractères au plus ; réponse de l'entreprise du
//   17 octobre 2026), action `temps.rouvrir` (server/src/actions/reouverture.ts). La feuille repasse « soumise » (corrigée
//   par son valideur) ou « à corriger » (renvoyée au salarié). Refusée pour une feuille d'un lot de paie généré mais pas
//   confirmé (annuler d'abord le lot) et pour celle d'un intérimaire dont le relevé est parti à l'agence.
// - Paie : une feuille transmise garde, à sa réouverture, les rubriques déjà parties (codes Sage, par période d'origine :
//   `ReouvertureFeuille.rubriques`). Revalidée, elle revient dans les feuilles en attente (« à régulariser ») ; le lot
//   suivant, de type « correctif », emporte l'écart sur la période ouverte (rappel de la période d'origine close), positif
//   ou négatif. Format du fichier sans quantité négative (`negatifs` décoché) : « annule et remplace », rubriques
//   complètes du salarié pour la période d'origine, une quantité nulle comprise.
// - Keystone : la revalidation renvoie `heures.validees`, qui remplace l'événement précédent de la semaine ; un projet
//   retiré y vaut 0, et une semaine vidée de toute heure Keystone envoie aussi l'événement (docs/API-KEYSTONE.md).
// - Récupération et contrepartie en repos : recalculées (`recupInfo` ne compte que les feuilles validées ; la COR de la
//   feuille revalidée suit `corAValider`, shared/rules/durees.ts : COR de l'année moins celle figée sur les autres).
import type { Domain } from '../domain.ts';
import type { FeuilleTemps, ISODate, ModeRegularisation, ReouvertureFeuille, SagePush } from '../types.ts';
import { matriculeAffiche } from './matricules.ts';
import { periodeOuverte, rubriquesPaie, traduireRubriques } from './paie.ts';
import { rubriquesParPeriode } from './temps.ts';

/** Longueur au plus du motif d'une réouverture. */
export const MOTIF_REOUVERTURE_MAX = 500;

/** Motif d'une réouverture : message d'erreur, ou null s'il convient. */
export function erreurMotifReouverture(motif: string): string | null {
  const t = motif.trim();
  if (!t) return 'Indiquez le motif de la réouverture.';
  return t.length > MOTIF_REOUVERTURE_MAX ? `Motif trop long (${MOTIF_REOUVERTURE_MAX} caractères au plus).` : null;
}

/** Feuille validée, déjà transmise une fois, dont l'écart reste à transmettre à la paie (lot correctif). */
export const aRegulariser = (sh: Pick<FeuilleTemps, 'statut' | 'sage' | 'lotId' | 'reouverture'>) =>
  sh.statut === 'validee' && !sh.sage && !sh.lotId && !!sh.reouverture?.rubriques;

/** Régularisation par écart, sauf si le format du fichier refuse les quantités négatives (« annule et remplace »). */
export const modeRegularisation = (f: { negatifs?: boolean } | null | undefined): ModeRegularisation => (f?.negatifs === false ? 'remplace' : 'ecart');

export const MODES_REGULARISATION: Record<ModeRegularisation, { label: string; aide: string }> = {
  ecart: {
    label: 'Écart, positif ou négatif',
    aide: 'Une feuille corrigée après sa transmission envoie la différence avec ce qui est déjà parti, sur la période ouverte (rappel de la période d’origine close).',
  },
  remplace: {
    label: 'Annule et remplace',
    aide: 'Sans quantité négative : une feuille corrigée après sa transmission envoie les rubriques complètes du salarié pour la période d’origine, quantité nulle comprise, à importer en remplacement.',
  },
};

/** Quantités au centième, comme le fichier (shared/rules/lots-paie.ts). */
const r2 = (n: number) => Math.round(n * 100) / 100;

type ParPeriode = Record<string, Record<string, number>>;

/**
 * Rubriques d'une feuille en codes Sage (rubriques désactivées retirées, quantités nulles omises), par période d'origine :
 * période de rattachement de chaque part, qu'elle soit encore ouverte ou close (rappel).
 */
export function rubriquesDeLaFeuille(d: Domain, sh: FeuilleTemps): ParPeriode {
  const e = d.emp(sh.empId);
  if (!e) return {};
  const table = rubriquesPaie(d.ds.rubriquesPaie);
  const out: ParPeriode = {};
  for (const p of rubriquesParPeriode(d, e, sh)) {
    const origine = p.origine ?? p.periode;
    for (const [code, q] of Object.entries(traduireRubriques(p.rubriques, table))) {
      const x = (out[origine] ??= {});
      x[code] = r2((x[code] ?? 0) + q);
    }
  }
  return out;
}

/** Somme de plusieurs rubriques par période. */
export function additionner(...l: readonly ParPeriode[]): ParPeriode {
  const out: ParPeriode = {};
  for (const r of l) {
    for (const [p, codes] of Object.entries(r)) {
      for (const [c, q] of Object.entries(codes)) {
        const x = (out[p] ??= {});
        x[c] = r2((x[c] ?? 0) + q);
      }
    }
  }
  return out;
}

/** Écart par période et code Sage entre les rubriques de la feuille revalidée et celles déjà transmises ; nul omis. */
export function ecartRubriques(nouveau: ParPeriode, transmis: ParPeriode): ParPeriode {
  const out: ParPeriode = {};
  for (const p of new Set([...Object.keys(nouveau), ...Object.keys(transmis)])) {
    for (const c of new Set([...Object.keys(nouveau[p] ?? {}), ...Object.keys(transmis[p] ?? {})])) {
      const v = r2((nouveau[p]?.[c] ?? 0) - (transmis[p]?.[c] ?? 0));
      if (v) (out[p] ??= {})[c] = v;
    }
  }
  return out;
}

/** Ligne du contenu d'un lot (variables d'une feuille, ou de sa régularisation). */
type Ligne = SagePush['lignes'][number];

export interface OptionsRegularisation {
  mode: ModeRegularisation;
  /** Semaine ISO de la ligne (« 2026-S42 »). */
  semaine: (week: ISODate) => string;
  /**
   * « Annule et remplace » : rubriques déjà transmises des autres feuilles du salarié pour la période d'origine (lues par
   * le serveur dans les lots), hors feuilles régularisées par le même lot.
   */
  autres?: (empId: number, periode: string, exclues: readonly ISODate[]) => Record<string, number>;
}

/**
 * Lignes de régularisation des feuilles `sheets` (à régulariser) :
 * - écart : par feuille et période d'origine, la différence avec ce qui est parti, sur la période d'origine si elle est
 *   encore ouverte, sinon sur la période ouverte avec `periode_origine` (rappel) ;
 * - annule et remplace : par salarié et période d'origine, ses rubriques complètes (autres feuilles déjà transmises,
 *   plus les feuilles régularisées telles que revalidées), sur la période d'origine ; un code parti puis retiré y vaut 0.
 * Rien pour une feuille dont la correction ne change aucune rubrique.
 */
export function lignesRegularisation(d: Domain, sheets: readonly FeuilleTemps[], o: OptionsRegularisation): Ligne[] {
  const ouverte = periodeOuverte(d.ti, d.ds.settings?.clotureJour ?? 0);
  const matriculeDe = (empId: number) => matriculeAffiche(d.emp(empId) ?? { id: empId, matriculePaie: null });
  const calc = sheets.map(sh => ({ sh, nouveau: rubriquesDeLaFeuille(d, sh), transmis: sh.reouverture?.rubriques ?? {} }));
  if (o.mode === 'ecart') {
    return calc.flatMap(({ sh, nouveau, transmis }) => Object.entries(ecartRubriques(nouveau, transmis)).sort(([a], [b]) => a.localeCompare(b)).map(([p, rubriques]): Ligne => ({
      matricule: matriculeDe(sh.empId), semaine: o.semaine(sh.week), periode: p >= ouverte ? p : ouverte, ...(p >= ouverte ? {} : { periode_origine: p }), rubriques, correctif: true,
    })));
  }
  // Annule et remplace : un groupe par salarié et période d'origine touchée par un écart.
  const groupes = new Map<string, { empId: number; periode: string; feuilles: typeof calc }>();
  for (const c of calc) {
    for (const p of Object.keys(ecartRubriques(c.nouveau, c.transmis))) {
      const k = `${c.sh.empId}|${p}`;
      const g = groupes.get(k) ?? { empId: c.sh.empId, periode: p, feuilles: [] };
      if (!g.feuilles.includes(c)) g.feuilles.push(c);
      groupes.set(k, g);
    }
  }
  return [...groupes.values()].sort((a, b) => a.empId - b.empId || a.periode.localeCompare(b.periode)).map(g => {
    const semaines = g.feuilles.map(c => c.sh.week).sort();
    const autres = o.autres?.(g.empId, g.periode, semaines) ?? {};
    const complet = additionner({ [g.periode]: autres }, ...g.feuilles.map(c => ({ [g.periode]: c.nouveau[g.periode] ?? {} })))[g.periode] ?? {};
    // Codes déjà partis pour cette période, retirés depuis : envoyés à 0 pour être remplacés.
    const codes = new Set([...Object.keys(autres), ...g.feuilles.flatMap(c => Object.keys(c.transmis[g.periode] ?? {})), ...Object.keys(complet)]);
    const rubriques = Object.fromEntries([...codes].sort().map(c => [c, complet[c] ?? 0]));
    return { matricule: matriculeDe(g.empId), semaine: o.semaine(semaines[0]), periode: g.periode, rubriques, correctif: true, remplace: true };
  });
}

/**
 * Heures par projet renvoyées à Keystone à la validation : celles de la feuille et, revalidée après une réouverture, 0
 * pour chaque projet déjà envoyé qui n'y figure plus (l'événement remplace le précédent de la semaine).
 */
export function projetsRevalidation(projets: Record<string, number>, reouverture: Pick<ReouvertureFeuille, 'keystone'> | null | undefined): Record<string, number> {
  const avant = reouverture?.keystone;
  if (!avant) return projets;
  return { ...Object.fromEntries(Object.keys(avant).filter(p => !(p in projets)).map(p => [p, 0])), ...projets };
}

/** Réouverture vue par le manager et le collaborateur : ni le motif, ni les rubriques de paie, ni les heures Keystone. */
export const reouvertureNeutre = (r: ReouvertureFeuille): ReouvertureFeuille => ({
  le: r.le, par: r.par, motif: '', renvoyee: r.renvoyee, transmise: r.transmise, lot: null, rubriques: null, keystone: null,
});

/** « Rouverte le 12/10/2026 par Sandrine Vidal » et la suite selon l'état de la feuille (écran Temps). */
export function mentionReouverture(sh: Pick<FeuilleTemps, 'statut' | 'sage' | 'lotId' | 'reouverture'>, fmtDate: (iso: string) => string): string {
  const r = sh.reouverture;
  if (!r) return '';
  const base = `Rouverte le ${fmtDate(r.le)} par ${r.par}`;
  if (!r.transmise) return base;
  if (sh.statut !== 'validee') return `${base} après sa transmission à la paie : à la revalidation, seul l’écart partira dans le prochain lot (lot correctif)`;
  // Revalidée, en attente du lot correctif : l'état de la feuille le dit déjà.
  if (aRegulariser(sh)) return `${base} · revalidée`;
  return `${base} · régularisation ${sh.sage ? 'transmise' : `dans le lot n° ${sh.lotId}, import à confirmer`}`;
}
