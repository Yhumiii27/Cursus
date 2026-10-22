// Migrations nommées du chantier « entretiens, plan de formation et déplacements ».
import { plural } from '../../../shared/format.ts';
import { journaliser } from '../comptes.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Actions réalisées sans coût réel : celles d'avant la saisie du coût réel à la clôture (colonne `cout_reel`). */
const SANS_COUT_REEL = `FROM plan_actions WHERE statut = 'realise' AND cout_reel IS NULL`;

/**
 * Coût réel des actions du plan déjà réalisées : leur coût prévu, faute de mieux. Le réalisé des enveloppes, désormais
 * calculé sur le coût réel (shared/rules/budget.ts), reste ainsi celui d'avant la mise à jour. Tracé dans le journal
 * (identifiants des actions et montants repris).
 */
export const COUT_REEL = {
  nom: 'lot4-entretiens-cout-reel',
  // Base neuve : exécutée, sans effet (cadre commun) ; base existante : seulement s'il reste des actions à reprendre.
  necessaire: async (db: Db) => db.neuve || Number((await db.one(`SELECT COUNT(*) AS n ${SANS_COUT_REEL}`) as { n: number }).n) > 0,
  executer: async (db: Db) => {
    const lignes = await db.query(`SELECT id, exercice, cout ${SANS_COUT_REEL} ORDER BY id`) as { id: number; exercice: number; cout: number }[];
    if (!lignes.length) return;
    await db.exec(`UPDATE plan_actions SET cout_reel = cout WHERE statut = 'realise' AND cout_reel IS NULL`);
    const n = plural(lignes.length, 'action réalisée', 'actions réalisées');
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.coutReel', message: `Reprise : coût réel des ${n} du plan de formation égal à leur coût prévu`,
      payload: { actions: lignes.map(l => ({ id: l.id, exercice: l.exercice, cout: l.cout })) },
    });
    return `coût réel repris pour ${n}`;
  },
} satisfies Migration;
