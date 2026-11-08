// lot 14 — personnes sur site, côté serveur : matricule de site suivant, lu en base dans la transaction de l'écriture
// (toutes les fiches, retirées comprises : un matricule n'est jamais réattribué). Règles : shared/rules/personnes-site.ts.
import { prochainMatriculeSite } from '../../shared/rules/personnes-site.ts';
import type { Db } from './db.ts';

/** Matricule de site suivant d'un préfixe (I : intérimaire, E : extérieur). */
export async function matriculeSiteSuivant(db: Db, prefixe: 'I' | 'E'): Promise<string> {
  const lignes = await db.query<{ m: string }>('SELECT matricule_site AS m FROM employes WHERE matricule_site IS NOT NULL');
  return prochainMatriculeSite(prefixe, lignes.map(l => l.m));
}
