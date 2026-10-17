// Semaine à 7 jours de la feuille de temps (décision de l'entreprise du 17 octobre 2026) : le samedi et le dimanche,
// normalement non travaillés, sont grisés mais restent saisissables pour un chantier, un déplacement ou un impératif.
// Les heures du week-end comptent dans la semaine civile du lundi au dimanche (rang des heures supplémentaires,
// art. L3121-35) et partent dans le fichier d'import de la paie (HDIM pour celles du dimanche).
// Repos hebdomadaire contrôlé en alerte, jamais en blocage (`calcSheet` de ./temps.ts) : 6 jours travaillés au plus
// (art. L3132-1), repos de 35 h consécutives approché par une journée sans heure tant que les horaires ne sont pas saisis
// (art. L3132-2), repos dominical (art. L3132-3) sauf dérogation réglée pour l'équipe (travail en continu, suppléance).
// Lignes enregistrées avant la semaine à 7 jours (5 valeurs) : lues comme si samedi et dimanche étaient vides, complétées
// une fois par base par la migration `lot5-temps-semaine-7-jours` (server/src/migrations/temps.ts).
import { fH, num } from '../format.ts';
import type { Dataset, DerogationDominicale, Employe, TypeDerogationDominicale } from '../types.ts';

/** Jours de la feuille : 0 = lundi … 4 = vendredi, 5 = samedi, 6 = dimanche. */
export const JOURS_FEUILLE = 7;
export const SAMEDI = 5;
export const DIMANCHE = 6;
/** Samedi ou dimanche : grisé dans la feuille, saisissable. */
export const estWeekEnd = (di: number) => di >= SAMEDI;

/** Heures d'une ligne sur les 7 jours : une ligne de 5 valeurs (avant la semaine à 7 jours) est complétée de zéros. */
export const completerSemaine = (h: readonly number[] | null | undefined): number[] =>
  Array.from({ length: JOURS_FEUILLE }, (_, i) => num(h?.[i]));

/** Dérogations au repos dominical (Paramètres → Repos hebdomadaire) : libellé et texte d'aide. */
export const DEROGATIONS_DOMINICALES: Record<TypeDerogationDominicale, { label: string; aide: string }> = {
  aucune: {
    label: 'Aucune dérogation',
    aide: 'Repos dominical (art. L3132-3) : toute heure saisie un dimanche est signalée au service RH sur la feuille, sans bloquer la saisie.',
  },
  feu_continu: {
    label: 'Travail en continu',
    aide: 'Dérogation de droit pour les activités qui ne peuvent être interrompues (art. L3132-12, R3132-5) : le repos hebdomadaire est donné par roulement, un autre jour que le dimanche.',
  },
  suppleance: {
    label: 'Équipe de suppléance',
    aide: 'Équipe de fin de semaine qui remplace les équipes de semaine pendant leur repos (art. L3132-16 : accord collectif ou autorisation de l’inspection du travail).',
  },
};
export const estTypeDerogation = (v: unknown): v is TypeDerogationDominicale => typeof v === 'string' && Object.hasOwn(DEROGATIONS_DOMINICALES, v);

/** Dérogation au repos dominical en vigueur pour l'équipe du salarié (null : aucune, ou salarié sans équipe). */
export function derogationDe(ds: Pick<Dataset, 'derogationsDominicales'>, e: Pick<Employe, 'equipe'>): DerogationDominicale | null {
  return ds.derogationsDominicales?.find(x => x.equipe === e.equipe && x.type !== 'aucune') ?? null;
}

/**
 * Alertes du repos hebdomadaire d'une semaine (heures par jour, du lundi au dimanche), sans blocage : la feuille se soumet
 * et se valide, le valideur et le service RH les lisent sur la feuille. `derogation` : celle de l'équipe (heures du dimanche
 * alors attendues).
 */
export function alertesRepos(perDay: readonly number[], derogation: DerogationDominicale | null): string[] {
  const out: string[] = [];
  // Sans horaires saisis, le repos de 35 h consécutives (24 h + 11 h de repos quotidien) est approché par une journée
  // entière sans heure : sept jours travaillés le rendent impossible, comme ils dépassent les six jours permis.
  if (perDay.filter(h => h > 0).length > 6) {
    out.push('7 jours travaillés sans journée de repos : 6 jours au plus par semaine et repos hebdomadaire de 35 h consécutives (art. L3132-1 et L3132-2)');
  }
  if (perDay[DIMANCHE] > 0 && !derogation) {
    out.push(`${fH(perDay[DIMANCHE])} le dimanche : repos dominical (art. L3132-3), aucune dérogation réglée pour l’équipe — signalé au service RH`);
  }
  return out;
}
