// Migrations nommées du chantier « horaires de poste et jours fériés » (lot 6) : horaires d'exemple amorcés une fois par
// base, en production comme en démonstration (J, M, AM, N : shared/rules/horaires.ts), modifiables et archivables
// ensuite par le service RH. Aucune équipe ne reçoit d'horaire par défaut et les feuilles existantes restent sans
// horaire (colonne `horaires` vide) : aucun contrôle rétroactif. Les jours fériés n'en demandent pas : sans réglage,
// une année garde le calendrier légal complet (shared/dates.ts). Étape 2 : majoration de nuit figée à 0 % sur les feuilles
// déjà validées.
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

/** Feuilles validées sans majoration de nuit figée (validées avant les heures de nuit). */
const sansMajNuit = async (db: Db) => Number(((await db.one("SELECT COUNT(*) AS n FROM feuilles WHERE statut = 'validee' AND maj_nuit IS NULL")) as { n: number }).n);

/**
 * Étape 2 (heures de nuit, shared/rules/repos-nuit.ts) : la majoration des heures de nuit est figée à la validation, comme
 * celles du dimanche et des fériés. Les feuilles déjà validées la reçoivent à 0 % (la valeur par défaut du réglage) : un
 * taux réglé plus tard ne s'applique pas à une semaine validée avant lui. Leurs heures de nuit ne viennent que des horaires
 * figés ; une feuille d'avant les horaires n'en a aucune (aucun contrôle rétroactif).
 */
export const HORAIRES_NUIT_FIGEE: Migration = {
  nom: 'lot6-horaires-majoration-nuit',
  // Base neuve : exécutée, sans effet ; base sans feuille validée à reprendre : notée faite.
  necessaire: async db => db.neuve || await sansMajNuit(db) > 0,
  executer: async db => {
    const n = Number((await db.run("UPDATE feuilles SET maj_nuit = 0 WHERE statut = 'validee' AND maj_nuit IS NULL")).changes);
    return n ? `majoration de nuit figée à 0 % sur ${plural(n, 'feuille validée', 'feuilles validées')}` : undefined;
  },
};
