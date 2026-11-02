// Planning d'équipe (lot 12, chantier C5, étape 2) : pré-remplissage de la feuille de temps. L'horaire du créneau publié du
// jour (la version communiquée au salarié, jamais un brouillon) est proposé sur la feuille à la place de l'horaire par défaut
// de l'équipe (`horairesDeLaFeuille`, shared/rules/horaires.ts) : une proposition, que le salarié change, figée à la
// soumission comme avant ; aucune heure n'est pré-remplie (réponse de l'entreprise : horaire seulement). Module désactivé
// (réglage `planningActif`) : rien n'est proposé. Les créneaux lus sont ceux de l'instantané (8 semaines passées à
// 12 semaines à venir) : une feuille plus ancienne garde l'horaire de l'équipe.
import { addD } from '../dates.ts';
import type { Dataset, HoraireFige, ISODate } from '../types.ts';
import type { Creneau } from '../types-planning.ts';

/** Créneaux publiés par salarié et par jour (« empId|jour »), une fois par liste lue (identité). */
const INDEX = new WeakMap<readonly Creneau[], Map<string, Creneau>>();
function publies(creneaux: readonly Creneau[]): Map<string, Creneau> {
  let m = INDEX.get(creneaux);
  if (!m) {
    m = new Map();
    for (const c of creneaux) if (c.empId != null && c.statut === 'publie') m.set(`${c.empId}|${c.jour}`, c);
    INDEX.set(creneaux, m);
  }
  return m;
}

/**
 * Horaire publié de chaque jour de la semaine `week` (lundi) du salarié : l'horaire figé du créneau, null pour un repos
 * publié, undefined sans créneau publié (ou module désactivé, ou semaine inconnue).
 */
export function horairesPlanifies(ds: Pick<Dataset, 'settings'> & Partial<Pick<Dataset, 'creneaux'>>, empId: number, week: ISODate | null | undefined): (HoraireFige | null | undefined)[] | undefined {
  if (!ds.settings.planningActif || !week || !ds.creneaux?.length) return undefined;
  const m = publies(ds.creneaux);
  const jours = Array.from({ length: 7 }, (_, i) => m.get(`${empId}|${addD(week, i)}`));
  if (!jours.some(Boolean)) return undefined;
  return jours.map(c => (!c ? undefined : c.horaire && c.debut && c.fin ? { code: c.horaire, debut: c.debut, fin: c.fin, pause: c.pause ?? 0 } : null));
}
