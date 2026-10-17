// Âge des salariés et salariés mineurs. La date de naissance complète (`naissanceLe`) donne l'âge exact à une date ;
// une fiche qui n'en a que l'année (fiche antérieure, reprise d'un fichier qui ne portait qu'elle) garde la règle à
// l'année. Les vues du manager et des profils restreints de l'espace RH ne reçoivent pas la date : l'indication
// `mineur`, calculée par le serveur, la remplace (server/src/dataset.ts).
import { addM, isValidDate } from '../dates.ts';
import type { Employe, ISODate } from '../types.ts';

/** Âge de la majorité (art. 414 du Code civil) : en deçà, les règles des jeunes travailleurs s'appliquent (art. L3161-1). */
export const MAJORITE = 18;

/** Ce que les règles d'âge lisent d'une fiche : année, date complète si elle est connue, indication des vues sans la date. */
export type Naissance = Pick<Employe, 'naissance'> & Partial<Pick<Employe, 'naissanceLe' | 'mineur'>>;

/** Date de naissance complète et valide de la fiche, null si seule l'année est connue. */
export const dateNaissance = (e: Naissance): ISODate | null => (isValidDate(e.naissanceLe) ? e.naissanceLe : null);

/**
 * Jour où la personne atteint `ans` ans, null sans date de naissance complète. Né un 29 février : le 28 février d'une
 * année non bissextile, comme toute échéance de Cursus (`addMonths`, dernier jour du mois quand le quantième manque).
 */
export function dateDesAns(e: Naissance, ans: number): ISODate | null {
  const le = dateNaissance(e);
  return le ? addM(le, 12 * ans) : null;
}

/**
 * Âge à la date `date`. Date de naissance connue : âge révolu, atteint le jour anniversaire (`dateDesAns`). Année seule :
 * âge atteint dans l'année civile de `date` (règle d'avant la date complète, conservée pour ces fiches).
 */
export function ageAu(e: Naissance, date: ISODate): number {
  const annees = Number(date.slice(0, 4)) - e.naissance;
  const le = dateNaissance(e);
  if (!le) return annees;
  const a = Number(date.slice(0, 4)) - Number(le.slice(0, 4));
  return date >= addM(le, 12 * a) ? a : a - 1;
}

/**
 * Salarié mineur à la date `date`. Vue sans la date de naissance (manager, profils restreints) : l'indication du jour
 * transmise par le serveur. Année seule : mineur jusqu'à la fin de l'année civile de ses 18 ans, faute de savoir quand
 * il les atteint (les règles des mineurs protègent ; la date complète, saisie sur la fiche, les lève au bon jour).
 */
export function mineurAu(e: Naissance, date: ISODate): boolean {
  if (dateNaissance(e)) return ageAu(e, date) < MAJORITE;
  if (typeof e.mineur === 'boolean') return e.mineur;
  return Number.isFinite(e.naissance) && Number(date.slice(0, 4)) - e.naissance <= MAJORITE;
}

/**
 * Naissance d'une fiche vue par le manager (membres de son équipe) et les profils restreints de l'espace RH : ni la date
 * complète, ni rien qui la laisse deviner ; l'année (règle à l'année des congés de la CCN, transmise comme avant) et
 * l'indication « mineur » du jour, qui suffit aux règles des jeunes travailleurs. Un âge exact à côté de l'année
 * trahirait le jour anniversaire, le jour où il change : il n'est pas transmis.
 */
export const naissanceVueManager = (e: Naissance, today: ISODate): Pick<Employe, 'naissanceLe' | 'mineur'> =>
  ({ naissanceLe: null, mineur: mineurAu(e, today) });
