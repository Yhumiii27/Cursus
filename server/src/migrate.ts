// Migrations de données des bases créées par une version antérieure de Cursus.
import type { Db } from './db.ts';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

/** Ancienne colonne `contrat` (qui mêlait nature du contrat et durée du travail) → statut, type de contrat, temps. */
const ANCIEN_CONTRAT: Record<string, { typeContrat: string; temps: string; cadre?: boolean }> = {
  '35h': { typeContrat: 'cdi', temps: '35h' },
  '39h': { typeContrat: 'cdi', temps: '39h_rtt' },
  forfait: { typeContrat: 'cdi', temps: 'forfait_jours', cadre: true },
  reel: { typeContrat: 'cdi', temps: '35h', cadre: true },
  partiel: { typeContrat: 'cdi', temps: 'partiel' },
  alternance: { typeContrat: 'alternance', temps: '35h' },
  cdd: { typeContrat: 'cdd', temps: '35h' },
  interim: { typeContrat: 'interim', temps: '35h' },
};

/** Catégorie déduite de l'ancien contrat et de l'intitulé de poste, faute de mieux. */
function statutDuPoste(poste: string, contrat: string): string {
  if (contrat === 'alternance' || /apprenti|assistant/i.test(poste)) return 'ouvrier';
  if (/\bdirect(eur|rice)\b|responsable|ingénieur|cadre|chargée? d[’']affaires|grands comptes/i.test(poste)) return 'cadre';
  if (/technicien|chef|maîtrise|animat|audit|gestionnaire|chargé|électromécanicien/i.test(poste)) return 'technicien';
  return 'ouvrier';
}

export function migrate(db: Db) {
  // Une base réellement modifiée est d'abord copiée (une seule copie pour toutes les étapes).
  const avant = () => { sauvegarderAvantMigration(db); };
  convertirContrats(db, avant);
  figerFeuilles(db, avant);
}

/**
 * Les feuilles soumises ou validées avant le gel du régime reçoivent le régime actuel de la fiche.
 * `avant` est appelé juste avant d'écrire (sauvegarde au démarrage ; rien au chargement de la démo).
 */
export function figerFeuilles(db: Db, avant = () => {}) {
  const rows = db.sql.prepare(`SELECT f.id, e.statut, e.type_contrat, e.temps, e.heures, e.forfait_heures, e.forfait_jours, e.jour_off
    FROM feuilles f JOIN employes e ON e.id = f.emp_id WHERE f.contrat IS NULL AND f.statut IN ('soumise', 'validee') AND e.temps IS NOT NULL`).all() as Record<string, unknown>[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) {
      const contrat = { statut: r.statut, typeContrat: r.type_contrat, temps: r.temps, heures: r.heures, forfaitHeures: r.forfait_heures, forfaitJours: r.forfait_jours, jourOff: JSON.parse(String(r.jour_off ?? '[]')) };
      db.sql.prepare('UPDATE feuilles SET contrat = ? WHERE id = ?').run(JSON.stringify(contrat), r.id as number);
    }
  });
}

function convertirContrats(db: Db, avant: () => void) {
  if (!db.columns('employes').includes('contrat')) return;
  const rows = db.sql.prepare('SELECT id, contrat, poste FROM employes WHERE temps IS NULL AND contrat IS NOT NULL').all() as { id: number; contrat: string; poste: string }[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) {
      const m = ANCIEN_CONTRAT[r.contrat] ?? ANCIEN_CONTRAT['35h'];
      db.sql.prepare('UPDATE employes SET type_contrat = ?, temps = ?, statut = ?, forfait_jours = ? WHERE id = ?')
        .run(m.typeContrat, m.temps, m.cadre ? 'cadre' : statutDuPoste(r.poste, r.contrat), m.temps === 'forfait_jours' ? 218 : null, r.id);
    }
  });
  console.log(`Migration : ${rows.length} fiches converties au nouveau modèle de contrat.`);
}
