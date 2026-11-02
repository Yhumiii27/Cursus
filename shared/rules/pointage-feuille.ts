// Badgeage virtuel, mode « calcule » (lot 12, chantier C6, étape 2 ; t191) : passage des pointages à la feuille de temps.
// - Le total pointé de chaque jour (postes de la semaine, pauses déduites, corrections validées comprises :
//   shared/rules/pointage.ts) alimente une ligne système `PTG`, marquée `pt: true` à l'image de `ks`, jamais saisissable
//   dans la grille ni supprimable. Elle porte le pointé qui n'est pas encore ventilé sur un projet : la ventilation par
//   projet Keystone reste déclarative, et la somme de la feuille vaut toujours le pointé du jour.
// - Une ventilation qui dépasse le pointé d'un jour est signalée sur la feuille et refusée à la soumission et à la
//   validation : en mode « calcule », les heures payées viennent des pointages (un pointage oublié se corrige par une
//   demande de correction, `pointage.corriger`).
// - À la soumission, puis à la validation, le pointé est figé sur la feuille (`FeuilleTemps.pointeFige`, comme
//   `horairesFiges`) ; un pointage arrivé ensuite n'est jamais réécrit dans la feuille : il est signalé en anomalie
//   (`apres_validation`, shared/rules/pointage.ts) et passe par la réouverture.
// - `calcSheet` et `sageRubriques` (shared/rules/temps.ts) ne changent pas : la ligne PTG est une ligne d'heures comme les
//   autres pour le décompte et la paie ; elle n'est jamais renvoyée à Keystone (server/src/integrations/keystone.ts).
// Règles pures communes au serveur (server/src/actions/temps.ts, server/src/actions/pointage.ts) et à l'interface.
import { addD } from '../dates.ts';
import { fH, num } from '../format.ts';
import type { FeuilleTemps, ISODate, LigneTemps } from '../types.ts';
import type { Poste } from './pointage.ts';
import { realiseParJour } from './pointage.ts';
import { completerSemaine, JOURS_FEUILLE } from './semaine.ts';

/** Code et libellé de la ligne système des heures pointées (jamais un projet du référentiel). */
export const CODE_PTG = 'PTG';
export const TACHE_PTG = 'Heures pointées, reste à ventiler';

/** Ligne tirée des pointages (mode « calcule ») : ni saisie, ni supprimée, ni renvoyée à Keystone. */
export const estLignePointee = (l: Pick<LigneTemps, 'projet'> & { pt?: boolean }) => !!l.pt || l.projet === CODE_PTG;

/** Feuille au mode « calcule » (figé à sa création, shared/rules/pointage.ts) : ses heures viennent des pointages. */
export const feuilleCalculee = (sh: Pick<FeuilleTemps, 'modeTemps'> | null | undefined) => sh?.modeTemps === 'calcule';

const centieme = (h: number) => Math.round(h * 100) / 100;

/** Pointé de chaque jour de la semaine `week` (lundi), en heures au centième, d'après les postes (jour de rattachement). */
export function pointeDeLaSemaine(postes: readonly Poste[], week: ISODate): number[] {
  const r = realiseParJour(postes);
  return Array.from({ length: JOURS_FEUILLE }, (_, i) => centieme((r.get(addD(week, i)) ?? 0) / 60));
}

/** Jour où la ventilation par projet dépasse le pointé : indice (0 = lundi), heures ventilées et pointées. */
export interface EcartVentilation { di: number; ventile: number; pointe: number }

/**
 * Lignes de la feuille avec la ligne PTG en tête : pour chaque jour, pointé moins les heures ventilées sur les autres
 * lignes (jamais négatif). Les jours où la ventilation dépasse le pointé sont rendus à part (`ecarts`), sans rien
 * retirer des lignes du salarié.
 */
export function avecLignePointee(lignes: readonly LigneTemps[], pointe: readonly number[]): { lignes: LigneTemps[]; ecarts: EcartVentilation[] } {
  const autres = lignes.filter(l => !estLignePointee(l));
  const ventile = Array.from({ length: JOURS_FEUILLE }, (_, i) => centieme(autres.reduce((n, l) => n + num(l.h[i]), 0)));
  const ecarts: EcartVentilation[] = [];
  const h = ventile.map((v, i) => {
    const p = centieme(num(pointe[i]));
    if (v > p + 0.005) ecarts.push({ di: i, ventile: v, pointe: p });
    return centieme(Math.max(0, p - v));
  });
  return { lignes: [{ projet: CODE_PTG, tache: TACHE_PTG, ks: false, pt: true, h }, ...autres.map(l => ({ ...l, h: completerSemaine(l.h) }))], ecarts };
}

/** « mardi 6 : 9 h ventilées pour 7,5 h pointées » ; `jours` : libellé de chaque jour de la semaine. */
export function ecartsTexte(ecarts: readonly EcartVentilation[], jours: readonly string[]): string {
  return ecarts.map(e => `${jours[e.di]} : ${fH(e.ventile)} ventilées pour ${fH(e.pointe)} pointées`).join(' ; ');
}

/** Lignes égales (projet, tâche, heures) : la ligne PTG recalculée ne réécrit pas une feuille inchangée. */
export function memesLignes(a: readonly LigneTemps[], b: readonly LigneTemps[]): boolean {
  return a.length === b.length && a.every((l, i) => l.projet === b[i].projet && l.tache === b[i].tache && !!l.pt === !!b[i].pt
    && completerSemaine(l.h).every((v, j) => num(v) === num(completerSemaine(b[i].h)[j])));
}
