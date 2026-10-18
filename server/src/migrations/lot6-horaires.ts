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
export function amorcerHoraires(db: Db): string[] {
  const existe = db.sql.prepare('SELECT 1 FROM horaires WHERE code = ?');
  const ajouter = db.sql.prepare('INSERT INTO horaires (code, nom, debut, fin, pause) VALUES (?, ?, ?, ?, ?)');
  return HORAIRES_EXEMPLES.filter(h => !existe.get(h.code)).map(h => { ajouter.run(h.code, h.nom, h.debut, h.fin, h.pause); return h.code; });
}

const manquants = (db: Db) => HORAIRES_EXEMPLES.filter(h => !db.sql.prepare('SELECT 1 FROM horaires WHERE code = ?').get(h.code)).length;

export const HORAIRES_EXEMPLES_MIGRATION: Migration = {
  nom: 'lot6-horaires-exemples',
  necessaire: db => manquants(db) > 0,
  executer: db => {
    const codes = amorcerHoraires(db);
    return codes.length ? `${plural(codes.length, 'horaire de poste d’exemple ajouté', 'horaires de poste d’exemple ajoutés')} (${codes.join(', ')})` : undefined;
  },
};
