// Synthèse du C2P recalculée pour les seuls salariés touchés (lot 10, chantier A). La synthèse de l'année
// (`syntheseC2p`, shared/rules/c2p.ts) relit toutes les feuilles validées : 0,2 s sur 5 ans, refaite pour chaque vue RH
// qui la reçoit à chaque révision, alors qu'une tranche de validation groupée ne change que les feuilles de quelques
// dizaines de salariés. Ici, même composition que `syntheseC2p`, mais :
// - la ligne d'un salarié (`ligneC2p`) est gardée par fiche (même objet), année, référentiels (même objet) et liste de
//   ses feuilles (mêmes objets, dans le même ordre) : elle ne se recalcule que si l'une a changé ;
// - les nuits à qualifier d'une feuille (`nuitsC2pDeLaFeuille`) sont gardées par feuille (même objet) et liste des
//   horaires (même objet).
// `ligneC2p` et `nuitsC2pDeLaFeuille` sont pures et ne lisent que ces entrées ; les données partagées ne sont jamais
// modifiées (gel sous node --test). Résultat identique à `syntheseC2p` (tests/memo-vues.test.ts, sur la démonstration
// et après une suite d'écritures) ; CURSUS_MEMO_VUES=0 revient à `syntheseC2p`.
import type { Dataset, Employe, FeuilleTemps, Horaire, LigneC2p, SyntheseC2p } from '../../shared/types.ts';
import { horairesAQualifier, ligneC2p, type NuitC2p, nuitsC2pDeLaFeuille, syntheseC2p } from '../../shared/rules/c2p.ts';
import { horairesDe } from '../../shared/rules/horaires.ts';
import { MEMO, memoVuesActif } from './memo-vues.ts';

type Source = Pick<Dataset, 'referentiels' | 'employes' | 'feuilles' | 'today'>;

/** Ligne gardée d'un salarié : ce qu'elle a lu, et la ligne. */
interface LigneGardee { referentiels: Dataset['referentiels']; annee: number; feuilles: readonly FeuilleTemps[]; ligne: LigneC2p | null }
const lignes = new WeakMap<Employe, LigneGardee[]>();
/** Nuits à qualifier d'une feuille (sans qualification d'alternance) : année du jour et code de l'horaire. */
const aQualifier = new WeakMap<FeuilleTemps, { horaires: readonly Horaire[]; nuits: { an: string; code: string }[] }>();

const memesFeuilles = (a: readonly FeuilleTemps[], b: readonly FeuilleTemps[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function ligneGardee(ds: Pick<Dataset, 'referentiels'>, e: Employe, feuilles: FeuilleTemps[], annee: number): LigneC2p | null {
  let l = lignes.get(e);
  if (!l) lignes.set(e, l = []);
  const g = l.find(x => x.annee === annee && x.referentiels === ds.referentiels && memesFeuilles(x.feuilles, feuilles));
  if (g) { MEMO.servis++; return g.ligne; }
  MEMO.calcules++;
  const ligne = ligneC2p(ds, e, feuilles, annee);
  // Une entrée par année suivie (en cours et précédente), remplacée quand ses feuilles changent.
  const autres = l.filter(x => x.annee !== annee);
  lignes.set(e, [...autres.slice(-3), { referentiels: ds.referentiels, annee, feuilles, ligne }]);
  return ligne;
}

/**
 * Nuits à qualifier de la feuille `sh` (`nuitsC2pDeLaFeuille`, alternance non qualifiée), gardées par feuille et liste
 * des horaires : année de chaque nuit et code de son horaire.
 */
function nuitsAQualifier(sh: FeuilleTemps, horaires: readonly Horaire[]): { an: string; code: string }[] {
  const g = aQualifier.get(sh);
  if (g && g.horaires === horaires) return g.nuits;
  const n = nuitsC2pDeLaFeuille(sh, horaires).filter((x: NuitC2p) => x.alternant == null).map(x => ({ an: x.jour.slice(0, 4), code: x.code }));
  aQualifier.set(sh, { horaires, nuits: n });
  return n;
}

/** Synthèse de l'année `annee`, comme `syntheseC2p(ds, annee)`, lignes et nuits reprises quand rien de ce qu'elles lisent n'a changé. */
export function syntheseC2pIncrementale(ds: Source, annee: number): SyntheseC2p {
  if (!memoVuesActif()) return syntheseC2p(ds, annee);
  const parSalarie = new Map<number, FeuilleTemps[]>();
  for (const sh of ds.feuilles) {
    const l = parSalarie.get(sh.empId);
    if (l) l.push(sh);
    else parSalarie.set(sh.empId, [sh]);
  }
  const lignesAnnee = ds.employes.map(e => ligneGardee(ds, e, parSalarie.get(e.id) ?? [], annee)).filter((x): x is LigneC2p => !!x);
  // Horaires sous lesquels une nuit à qualifier a été comptée cette année (un horaire archivé depuis compris). Le tri des
  // feuilles par semaine de `syntheseC2p` ne fait qu'éviter des calculs : une nuit de l'année vient d'une feuille dont la
  // semaine touche l'année ; ici, les nuits de chaque feuille sont gardées, et seules celles de l'année comptent.
  const horaires = horairesDe(ds.referentiels), utilises = new Set<string>(), an = String(annee);
  for (const sh of ds.feuilles) for (const n of nuitsAQualifier(sh, horaires)) if (n.an === an) utilises.add(n.code);
  return { annee, arrete: ds.today, lignes: lignesAnnee, horairesAQualifier: horairesAQualifier(ds.referentiels, utilises) };
}
