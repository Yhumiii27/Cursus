// Astreintes dans la paie (t049, lot 7, étape 2), côté serveur : famille « astreintes » du registre des éléments de lot
// (server/src/elements-lot.ts). Heures (AST_H) et périodes (AST_PER) des astreintes terminées, comme les jours rachetés d'un
// forfait jours : toujours réservées par le lot de leur période (`astreintes.lot_id`), transmises à la confirmation de
// l'import (`sage`), libérées à l'annulation du lot. Rubriques désactivées par défaut (codes Sage à confirmer par la paie) :
// l'élément part sans code Sage, absent du fichier, listé « à saisir dans Sage » dans le résumé du lot ; la confirmation de
// ce lot-là le compte transmis (la paie l'a saisi d'après le résumé). Règles : shared/rules/astreintes-paie.ts.
import { astreintesDuContenu, elementsAstreintes } from '../../shared/rules/astreintes-paie.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import type { ElementAstreintePaie, RubriquePaie } from '../../shared/types.ts';
import { instantPresent } from './astreintes.ts';
import type { FamilleLot } from './elements-lot.ts';

/** Famille du registre des éléments de lot : heures et périodes d'astreinte (t049). */
export const FAMILLE_ASTREINTES: FamilleLot<ElementAstreintePaie> = {
  cle: 'astreintes',
  libelles: ['astreinte', 'astreintes'],
  // Astreintes terminées à l'heure présente (heure de Paris, jour de Cursus).
  aEmettre: async (db, d, jusqua) => elementsAstreintes(d, jusqua, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie')), instantPresent(d.ti)),
  aSaisir: async () => [], // gardées dans le lot sans code Sage : listées par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: astreintesDuContenu,
  reserver: async (db, lotId, elements) => {
    for (const x of astreintesDuContenu(elements)) await db.update('astreintes', x.id, { lotId });
  },
  confirmer: async (db, _d, lot) => { await db.run('UPDATE astreintes SET sage = TRUE WHERE lot_id = ?', [lot.id]); },
  // Colonne `sage` vide sur une astreinte d'avant l'étape 2 (SQLite) : comptée non transmise.
  liberer: async (db, lot) => { await db.run('UPDATE astreintes SET lot_id = NULL WHERE lot_id = ? AND NOT COALESCE(sage, FALSE)', [lot.id]); },
};
