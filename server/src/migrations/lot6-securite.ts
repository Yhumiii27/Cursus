// Migrations nommées du chantier « sécurité, habilitations et formations suivies » (lot 6, chantier 4, étape 2).
// - Délivrances des habilitations (t115) : la délivrance en vigueur de chaque titre délivré amorce l'historique ; les
//   délivrances plus anciennes, écrasées avant le lot 6, sont perdues (une reprise d'historiques passera, le cas échéant,
//   par l'import CSV de la mise en service). Aussi utilisé par le jeu de démonstration (server/src/seed.ts).
// - Durée en heures du catalogue (t122) : extraite du texte de la durée quand il en donne une seule (« 21 h », « 7 h
//   (MAC) ») ; sinon laissée vide, à compléter dans Référentiels (la formation compte alors « durée inconnue »).
import { addMonths, iso, parse } from '../../../shared/dates.ts';
import { plural } from '../../../shared/format.ts';
import { dureeHeuresDe } from '../../../shared/rules/heures-formation.ts';
import type { ISODate } from '../../../shared/types.ts';
import { journaliser } from '../comptes.ts';
import { todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Titres délivrés sans aucune ligne de délivrance. */
const SANS_DELIVRANCE = 'FROM hab_titres t WHERE t.delivree IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hab_delivrances d WHERE d.titre_id = t.id)';
const sansDelivrance = async (db: Db) => Number(((await db.one(`SELECT COUNT(*) AS n ${SANS_DELIVRANCE}`)) as { n: number }).n);

/**
 * Délivrance en vigueur de chaque titre délivré qui n'en a pas : date, signataire, échéance calculée avec la validité
 * actuelle de l'habilitation (fin de mois comprise, `addMonths`). Idempotente ; renvoie le nombre de lignes écrites.
 */
export async function delivrancesDepuisTitres(db: Db, le: ISODate = todayIso()): Promise<number> {
  const titres = await db.query<{ id: number; emp_id: number; h: string; delivree: string; par: string | null; validite: number | null }>(
    `SELECT t.id, t.emp_id, t.h, t.delivree, t.par, h.validite ${SANS_DELIVRANCE.replace('FROM hab_titres t', 'FROM hab_titres t LEFT JOIN habilitations h ON h.id = t.h')} ORDER BY t.id`);
  for (const t of titres) {
    const expire = t.validite ? iso(addMonths(parse(t.delivree), t.validite)) : null;
    await db.run(`INSERT INTO hab_delivrances (emp_id, h, titre_id, delivree, par, expire, remplacee_le, mesure, mesure_date, le, auteur, auteur_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL)`, [t.emp_id, t.h, t.id, t.delivree, t.par, expire, le]);
  }
  return titres.length;
}

/** Historique des délivrances amorcé avec la délivrance en vigueur de chaque titre (t115), tracé au journal (un nombre). */
export const HAB_DELIVRANCES: Migration = {
  nom: 'lot6-securite-hab-delivrances',
  // Base neuve : exécutée, sans effet ; base existante : seulement s'il reste des titres délivrés sans délivrance.
  necessaire: async db => db.neuve || await sansDelivrance(db) > 0,
  executer: async db => {
    const n = await delivrancesDepuisTitres(db);
    if (!n) return;
    const texte = plural(n, 'délivrance en vigueur inscrite', 'délivrances en vigueur inscrites');
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.habDelivrances',
      message: `Reprise : historique des habilitations amorcé (${texte})`, payload: { delivrances: n },
    });
    return texte;
  },
};

/** Formations du catalogue dont la durée en heures se lit dans le texte de la durée, sans encore de durée en heures. */
async function dureesAExtraire(db: Db): Promise<{ id: string; heures: number }[]> {
  const lignes = await db.query<{ id: string; duree: string }>(`SELECT id, duree FROM formations WHERE duree_heures IS NULL AND duree IS NOT NULL AND duree <> ''`);
  return lignes.flatMap(l => {
    const heures = dureeHeuresDe(l.duree);
    return heures == null ? [] : [{ id: l.id, heures }];
  });
}

/** Durée en heures du catalogue extraite du texte (t122) ; les autres restent vides, « durée inconnue ». */
export const DUREE_HEURES: Migration = {
  nom: 'lot6-securite-duree-heures',
  necessaire: async db => db.neuve || (await dureesAExtraire(db)).length > 0,
  executer: async db => {
    const a = await dureesAExtraire(db);
    for (const x of a) await db.run('UPDATE formations SET duree_heures = ? WHERE id = ?', [x.heures, x.id]);
    return a.length ? plural(a.length, 'durée en heures extraite', 'durées en heures extraites') : undefined;
  },
};
