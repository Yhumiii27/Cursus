// Migrations nommées du chantier « interface fiable » (lot 5, H) : références des déplacements importés du formulaire
// de demande sans référence (t090). Avant le lot 5, l'import les enregistrait sans référence, et le dossier affichait
// « Formulaire de demande null ».
import { plural } from '../../../shared/format.ts';
import { referenceDeplacement } from '../../../shared/rules/imports.ts';
import { journaliser } from '../comptes.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Déplacements importés du formulaire sans référence. */
const SANS_REF = `FROM voyages WHERE origine = 'formulaire' AND TRIM(COALESCE(ref, '')) = ''`;
const aReprendre = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n ${SANS_REF}`) as { n: number }).n);

/**
 * Chaque déplacement importé sans référence reçoit `DD-<identifiant>`, comme ceux que l'import crée désormais (une
 * référence déjà prise reçoit un suffixe : `referenceDeplacement`). Le journal garde le nombre de déplacements repris et
 * leurs salariés (identifiants seulement).
 */
export const REFERENCES_DEPLACEMENTS: Migration = {
  nom: 'lot5-voyages-references',
  // Base existante sans déplacement à reprendre : notée faite. Base neuve : exécutée, sans effet.
  necessaire: async db => db.neuve || await aReprendre(db) > 0,
  executer: async db => {
    const lignes = await db.query(`SELECT id, emp_id AS empId ${SANS_REF} ORDER BY id`) as { id: number; empId: number }[];
    if (!lignes.length) return;
    const prises = new Set((await db.query(`SELECT ref FROM voyages WHERE TRIM(COALESCE(ref, '')) <> ''`) as { ref: string }[]).map(r => r.ref));
    for (const l of lignes) {
      const ref = referenceDeplacement(l.id, prises);
      await db.run('UPDATE voyages SET ref = ? WHERE id = ?', [ref, l.id]);
      prises.add(ref);
    }
    const message = `Reprise : référence DD-<n° du déplacement> donnée à ${plural(lignes.length, 'déplacement importé', 'déplacements importés')} sans référence`;
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.referencesDeplacements', message,
      payload: { deplacements: lignes.length }, salaries: [...new Set(lignes.map(l => l.empId))],
    });
    return `${plural(lignes.length, 'déplacement importé', 'déplacements importés')} : référence DD-<n°> attribuée`;
  },
};
