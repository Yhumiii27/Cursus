// Migration nommée du chantier « planning d'équipe » (lot 12, C5, t192, étape 1) : index de lecture des créneaux (par salarié
// et jour, par équipe et jour), des affectations au roulement et des échanges de poste, comme ceux de
// server/migrations-pg/0026_planning_equipe.sql ; modèles de cycles amorcés (Journée, 2x8, 3x8, 5x8 :
// shared/rules/cycles.ts), en production comme en démonstration, une fois par base (tables créées par le schéma
// déclaratif de server/src/db.ts). Base PostgreSQL : même amorçage au démarrage (server/src/demarrage.ts).
import { plural } from '../../../shared/format.ts';
import { CYCLES_MODELES, horairesDuCycle } from '../../../shared/rules/cycles.ts';
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

/**
 * Modèles de cycles amorcés si la table des cycles est vide (aucun cycle créé, modifié ou archivé par le service RH), et
 * seulement ceux dont les horaires d'exemple existent et sont en vigueur. Aussi appelée par le jeu de démonstration
 * (server/src/seed.ts) et au démarrage d'une base PostgreSQL. Renvoie les codes ajoutés.
 */
export async function amorcerCycles(db: Db): Promise<string[]> {
  if (await db.one('SELECT 1 FROM cycles')) return [];
  const enVigueur = new Set((await db.query<{ code: string }>('SELECT code FROM horaires WHERE archive IS NULL')).map(h => h.code));
  const codes: string[] = [];
  for (const c of CYCLES_MODELES) {
    if (!horairesDuCycle(c).every(h => enVigueur.has(h))) continue;
    await db.insert('cycles', { ...c, archive: null, creeLe: new Date().toISOString(), creePar: 'Cursus' });
    codes.push(c.code);
  }
  return codes;
}

/** Index de lecture des tables du planning. */
const INDEX_PLANNING: Record<string, string> = {
  creneaux_emp_jour: 'CREATE INDEX IF NOT EXISTS creneaux_emp_jour ON creneaux (emp_id, jour)',
  creneaux_equipe_jour: 'CREATE INDEX IF NOT EXISTS creneaux_equipe_jour ON creneaux (equipe, jour)',
  creneaux_jour: 'CREATE INDEX IF NOT EXISTS creneaux_jour ON creneaux (jour)',
  roulements_emp: 'CREATE INDEX IF NOT EXISTS roulements_emp ON roulements (emp_id)',
  echanges_poste_demandeur: 'CREATE INDEX IF NOT EXISTS echanges_poste_demandeur ON echanges_poste (demandeur_id)',
  echanges_poste_partenaire: 'CREATE INDEX IF NOT EXISTS echanges_poste_partenaire ON echanges_poste (partenaire_id)',
};

export const PLANNING_EQUIPE: Migration = {
  nom: 'lot12-planning-equipe',
  necessaire: async (db: SqliteDb) => Object.keys(INDEX_PLANNING).some(i => !indexExiste(db, i)) || !await db.one('SELECT 1 FROM cycles'),
  executer: async (db: Db) => {
    for (const sql of Object.values(INDEX_PLANNING)) await db.exec(sql);
    const codes = await amorcerCycles(db);
    return `index ${Object.keys(INDEX_PLANNING).join(', ')}${codes.length ? ` ; ${plural(codes.length, 'cycle d’exemple ajouté', 'cycles d’exemple ajoutés')} (${codes.join(', ')})` : ''}`;
  },
};
