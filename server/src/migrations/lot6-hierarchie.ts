// Migration nommée du chantier « hiérarchie des managers » (lot 6, t136) : colonne `parente` des équipes, ajoutée vide par
// le schéma déclaratif (server/src/db.ts) — aucune équipe parente, donc aucun valideur changé, tant que le service RH n'en
// saisit pas. La migration retire les rattachements impossibles qu'une saisie hors de Cursus aurait laissés (équipe
// parente absente ou l'équipe elle-même) : le contrôle de `equipe.parente` ne voit que ses propres saisies. Son nom
// enregistré fait aussi refuser la base par une version antérieure, qui ignorerait la hiérarchie et renverrait au service
// RH les validations des managers rattachés (docs/ARCHITECTURE.md, « Cadre commun du lot 4 »).
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Équipes rattachées à elles-mêmes ou à une équipe qui n'existe pas. */
const IMPOSSIBLES = `FROM equipes WHERE parente IS NOT NULL AND (parente = nom OR parente NOT IN (SELECT nom FROM equipes))`;

export const HIERARCHIE_EQUIPES: Migration = {
  nom: 'lot6-hierarchie-equipes',
  // Base neuve : exécutée, sans effet (cadre commun) ; base existante : seulement s'il reste un rattachement impossible.
  necessaire: async (db: Db) => db.neuve || Number(((await db.one(`SELECT COUNT(*) AS n ${IMPOSSIBLES}`)) as { n: number }).n) > 0,
  executer: async (db: Db) => {
    const n = Number((await db.run(`UPDATE equipes SET parente = NULL WHERE nom IN (SELECT nom ${IMPOSSIBLES})`)).changes);
    if (!n) return;
    return `${n} rattachement${n > 1 ? 's' : ''} d’équipe impossible${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''}`;
  },
};

/** Délégations impossibles : à soi-même, période inversée, ou manager ou suppléant absent des fiches. */
const DELEGATIONS_IMPOSSIBLES = `FROM delegations WHERE revoquee_le IS NULL AND (manager_id = suppleant_id OR au < du
  OR manager_id NOT IN (SELECT id FROM employes) OR suppleant_id NOT IN (SELECT id FROM employes))`;

/**
 * Délégation des validations (t135, étape 2) : table `delegations` créée vide par le schéma déclaratif — aucun suppléant,
 * donc aucun valideur changé tant qu'un manager ou le service RH n'en saisit pas. La migration révoque les délégations
 * impossibles qu'une saisie hors de Cursus aurait laissées (le contrôle de `equipe.delegation` ne voit que les siennes),
 * et son nom enregistré fait refuser la base par une version antérieure, qui ignorerait les suppléants en cours.
 */
export const DELEGATIONS_VALIDATION: Migration = {
  nom: 'lot6-hierarchie-delegations',
  necessaire: async (db: Db) => db.neuve || Number(((await db.one(`SELECT COUNT(*) AS n ${DELEGATIONS_IMPOSSIBLES}`)) as { n: number }).n) > 0,
  executer: async (db: Db) => {
    const n = Number((await db.run(`UPDATE delegations SET revoquee_le = ?, revoquee_par = 'Migration' WHERE id IN (SELECT id ${DELEGATIONS_IMPOSSIBLES})`,
      [new Date().toISOString()])).changes);
    if (!n) return;
    return `${n} délégation${n > 1 ? 's' : ''} de validation impossible${n > 1 ? 's' : ''} révoquée${n > 1 ? 's' : ''}`;
  },
};
