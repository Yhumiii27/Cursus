// Migrations nommées du chantier « temps » (lot 5) : lignes des feuilles de temps complétées à 7 jours (semaine du lundi
// au dimanche) ; activités internes de base amorcées, en production comme en démonstration (sans elles, aucune heure
// interne n'est saisissable tant que Keystone ne les pousse pas).
import { plural } from '../../../shared/format.ts';
import { ACTIVITES_DE_BASE } from '../../../shared/rules/activites.ts';
import { JOURS_FEUILLE } from '../../../shared/rules/semaine.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Feuilles dont une ligne a moins de 7 valeurs (enregistrées avant la semaine à 7 jours). */
const A_COMPLETER = `FROM feuilles WHERE EXISTS (SELECT 1 FROM json_each(feuilles.lignes) AS l WHERE json_array_length(l.value, '$.h') < ${JOURS_FEUILLE})`;
const aCompleter = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n ${A_COMPLETER}`) as { n: number }).n);

/**
 * Chaque ligne de feuille de temps reçoit un samedi et un dimanche vides (7 valeurs, du lundi au dimanche). Aucun calcul
 * ne change : le décompte d'une ligne de 5 valeurs lisait déjà ces jours à zéro, et les feuilles transmises ou figées dans
 * un lot de paie ne sont pas recalculées (le contenu d'un lot est figé). Faite en SQL, ligne par ligne du JSON.
 */
export const SEMAINE_7_JOURS: Migration = {
  nom: 'lot5-temps-semaine-7-jours',
  necessaire: async db => db.neuve || await aCompleter(db) > 0,
  executer: async db => {
    const n = await aCompleter(db);
    if (!n) return;
    await db.exec(`UPDATE feuilles SET lignes = (
      SELECT json_group_array(json_set(l.value, '$.h', (
        SELECT json_group_array(COALESCE(json_extract(l.value, '$.h[' || j.value || ']'), 0))
        FROM json_each('[0,1,2,3,4,5,6]') AS j
      )))
      FROM json_each(feuilles.lignes) AS l
    ) WHERE id IN (SELECT id ${A_COMPLETER})`);
    return `${plural(n, 'feuille de temps complétée', 'feuilles de temps complétées')} à 7 jours`;
  },
};

/**
 * Activités internes de base absentes de la table des projets, ajoutées en vigueur ; celles qui existent déjà (poussées
 * par Keystone, créées par le service RH, archivées) ne sont pas touchées. Aussi appelée par le jeu de démonstration
 * (server/src/seed.ts), qu'une réinitialisation recharge sans rejouer les migrations. Renvoie les codes ajoutés.
 */
export async function amorcerActivites(db: Db): Promise<string[]> {
  const ajoutees: string[] = [];
  for (const a of ACTIVITES_DE_BASE) {
    if (await db.one('SELECT 1 FROM projets WHERE code = ?', [a.code])) continue;
    await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif')`, [a.code, a.nom]);
    ajoutees.push(a.code);
  }
  return ajoutees;
}
const manquantes = async (db: Db) => {
  let n = 0;
  for (const a of ACTIVITES_DE_BASE) if (!await db.one('SELECT 1 FROM projets WHERE code = ?', [a.code])) n++;
  return n;
};

export const ACTIVITES_INTERNES: Migration = {
  nom: 'lot5-temps-activites-internes',
  necessaire: async db => await manquantes(db) > 0,
  executer: async db => {
    const codes = await amorcerActivites(db);
    return codes.length ? `${plural(codes.length, 'activité interne ajoutée', 'activités internes ajoutées')} (${codes.join(', ')})` : undefined;
  },
};
