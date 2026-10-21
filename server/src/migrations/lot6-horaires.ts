// Migrations nommées du chantier « horaires de poste et jours fériés » (lot 6) : horaires d'exemple amorcés une fois par
// base, en production comme en démonstration (J, M, AM, N : shared/rules/horaires.ts), modifiables et archivables
// ensuite par le service RH. Aucune équipe ne reçoit d'horaire par défaut et les feuilles existantes restent sans
// horaire (colonne `horaires` vide) : aucun contrôle rétroactif. Les jours fériés n'en demandent pas : sans réglage,
// une année garde le calendrier légal complet (shared/dates.ts).
import { plural } from '../../../shared/format.ts';
import { HORAIRES_EXEMPLES } from '../../../shared/rules/horaires.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/**
 * Horaires d'exemple absents du référentiel, ajoutés en vigueur ; un code déjà pris (créé, modifié ou archivé par le
 * service RH) n'est pas touché. Aussi appelée par le jeu de démonstration (server/src/seed.ts), qu'une réinitialisation
 * recharge sans rejouer les migrations. Renvoie les codes ajoutés.
 */
export async function amorcerHoraires(db: Db): Promise<string[]> {
  const codes: string[] = [];
  for (const h of HORAIRES_EXEMPLES) {
    if (await db.one('SELECT 1 FROM horaires WHERE code = ?', [h.code])) continue;
    await db.run('INSERT INTO horaires (code, nom, debut, fin, pause) VALUES (?, ?, ?, ?, ?)', [h.code, h.nom, h.debut, h.fin, h.pause]);
    codes.push(h.code);
  }
  return codes;
}

const manquants = async (db: Db) => {
  let n = 0;
  for (const h of HORAIRES_EXEMPLES) if (!await db.one('SELECT 1 FROM horaires WHERE code = ?', [h.code])) n++;
  return n;
};

export const HORAIRES_EXEMPLES_MIGRATION: Migration = {
  nom: 'lot6-horaires-exemples',
  necessaire: async db => (await manquants(db)) > 0,
  executer: async db => {
    const codes = await amorcerHoraires(db);
    return codes.length ? `${plural(codes.length, 'horaire de poste d’exemple ajouté', 'horaires de poste d’exemple ajoutés')} (${codes.join(', ')})` : undefined;
  },
};
