// Activités internes : codes hors projet Keystone (production, logistique, maintenance, HSE, qualité, fonctions support,
// cours en CFA, délégation du CSE), imputables dans les feuilles de temps et jamais renvoyées à Keystone
// (ACTIVITES_INTERNES de shared/constants.ts). Elles vivent dans la même table que les projets Keystone (`projets`) :
// le service RH les crée, les renomme et les archive dans l'écran Référentiels (onglet Activités internes,
// server/src/actions/activites.ts) ; les codes de base sont amorcés une fois par base, en production comme en
// démonstration (migration `lot5-temps-activites-internes`, server/src/migrations/temps.ts).
// Contrôles partagés par le dialogue (client/src/dialogs/RefActiviteDialog.tsx) et l'action.
import { ACTIVITES_INTERNES } from '../constants.ts';
import type { Projet } from '../types.ts';

/** Code des heures de délégation des élus au CSE (shared/rules/delegation.ts) : une activité interne, jamais envoyée à Keystone. */
export const CODE_DELEGATION = 'INT-DELEG';

/** Activités internes de base, amorcées à l'installation et modifiables ensuite par le service RH. */
export const ACTIVITES_DE_BASE: readonly Pick<Projet, 'code' | 'nom'>[] = [
  { code: 'INT-PROD', nom: 'Production — lignes internes' },
  { code: 'INT-LOG', nom: 'Logistique interne' },
  { code: 'INT-MAINT', nom: 'Maintenance interne' },
  { code: 'INT-HSE', nom: 'Qualité, hygiène, sécurité' },
  { code: 'INT-QUA', nom: 'Contrôle qualité' },
  { code: 'INT-ADM', nom: 'Fonctions support' },
  { code: 'ECOLE', nom: 'Cours en CFA (alternance)' },
  { code: CODE_DELEGATION, nom: 'Heures de délégation (CSE)' },
];

/** Activité interne (code INT-… ou ECOLE) plutôt que projet Keystone. */
export const estActiviteInterne = (code: string) => ACTIVITES_INTERNES.test(code);
/** Activités internes du référentiel des projets, archivées comprises, dans l'ordre des codes. */
export const activitesInternes = (projets: readonly Projet[]): Projet[] =>
  projets.filter(p => estActiviteInterne(p.code)).sort((a, b) => a.code.localeCompare(b.code));

/** Code d'une activité créée : « INT- » suivi de 2 à 12 lettres ou chiffres, ou ECOLE (reconnus par ACTIVITES_INTERNES). */
export const CODE_ACTIVITE = /^(?:INT-[A-Z0-9]{2,12}|ECOLE)$/;
/** Code saisi, en majuscules et sans espaces autour. */
export const normaliserCodeActivite = (v: unknown) => String(v ?? '').trim().toUpperCase();
export const NOM_ACTIVITE_MAX = 80;

export interface ErreursActivite { code?: string; nom?: string }

/**
 * Création (`existante` null : code choisi, jamais modifié ensuite, unique parmi tous les projets, archivés et Keystone
 * compris) ou renommage d'une activité interne. Renvoie l'activité normalisée, ou les erreurs par champ.
 */
export function controlerActivite(p: { code?: unknown; nom?: unknown }, projets: readonly Projet[], existante: Projet | null): { erreurs: ErreursActivite; activite: Projet | null } {
  const erreurs: ErreursActivite = {};
  const code = existante ? existante.code : normaliserCodeActivite(p.code);
  const nom = String(p.nom ?? '').replace(/\s+/g, ' ').trim();
  if (!existante) {
    if (!code) erreurs.code = 'Indiquez le code de l’activité (INT-… ou ECOLE).';
    else if (!CODE_ACTIVITE.test(code)) erreurs.code = 'Code : « INT- » suivi de 2 à 12 lettres ou chiffres (INT-FORM), ou ECOLE.';
    else if (projets.some(x => x.code === code)) erreurs.code = `Le code ${code} existe déjà (activité ou projet, archivés compris).`;
  }
  if (!nom) erreurs.nom = 'Indiquez le libellé de l’activité.';
  else if (nom.length > NOM_ACTIVITE_MAX) erreurs.nom = `Libellé : ${NOM_ACTIVITE_MAX} caractères au plus.`;
  return Object.keys(erreurs).length ? { erreurs, activite: null } : { erreurs, activite: { code, nom, statut: existante?.statut ?? 'actif' } };
}
