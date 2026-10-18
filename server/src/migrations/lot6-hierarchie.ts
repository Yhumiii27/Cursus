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
  necessaire: (db: Db) => db.neuve || Number((db.sql.prepare(`SELECT COUNT(*) AS n ${IMPOSSIBLES}`).get() as { n: number }).n) > 0,
  executer: (db: Db) => {
    const n = Number(db.sql.prepare(`UPDATE equipes SET parente = NULL WHERE nom IN (SELECT nom ${IMPOSSIBLES})`).run().changes);
    if (!n) return;
    return `${n} rattachement${n > 1 ? 's' : ''} d’équipe impossible${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''}`;
  },
};
