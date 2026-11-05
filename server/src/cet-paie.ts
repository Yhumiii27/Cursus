// lot 13 — CET (monétisation) dans la paie, côté serveur : famille « monetisationsCet » du registre des éléments de lot
// (server/src/elements-lot.ts, `FAMILLE_MONETISATIONS_CET`, clé `lotsPaie.monetisationsCet`). Jours monétisés d'une demande
// validée par le service RH (rubrique CET_MON), comme les jours rachetés d'un forfait jours : toujours réservés par le lot
// de leur période (mois de la validation, au plus tôt la période ouverte), transmis à la confirmation de l'import, libérés
// à l'annulation du lot. Rubrique désactivée par défaut (code Sage à confirmer par la paie) : l'élément part sans code
// Sage, absent du fichier, listé « à saisir dans Sage » dans le résumé du lot, et la confirmation de ce lot-là règle la
// demande hors fichier. Règles : shared/rules/cet-monetisation.ts.
import { elementsMonetisationsCet, monetisationsDuContenu } from '../../shared/rules/cet-monetisation.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import type { ElementMonetisationCetPaie, LotPaie, MonetisationCet, RubriquePaie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import type { FamilleLot } from './elements-lot.ts';
import type { LotEnregistre } from './lots-paie.ts';

/**
 * Confirmation d'un lot : demandes qu'il a réservées transmises ; celles qu'il a listées sans code Sage (CET_MON désactivée
 * à la génération) réglées hors fichier — la paie les a saisies dans Sage d'après son résumé. Seul le contenu figé compte.
 */
async function confirmer(db: Db, lot: Pick<LotPaie, 'id'>) {
  await db.run('UPDATE monetisations_cet SET sage = TRUE WHERE lot_id = ?', [lot.id]);
  const contenu = (await db.get<LotEnregistre>('lotsPaie', lot.id))?.contenu;
  for (const x of monetisationsDuContenu((contenu?.monetisationsCet ?? []).filter(x => !x.codeSage))) {
    if ((await db.get<MonetisationCet>('monetisationsCet', x.id))?.lotId === lot.id) await db.update<MonetisationCet>('monetisationsCet', x.id, { horsFichier: true });
  }
}

/** Famille du registre des éléments de lot : jours monétisés du compte épargne-temps (lot 13). */
export const FAMILLE_MONETISATIONS_CET: FamilleLot<ElementMonetisationCetPaie> = {
  cle: 'monetisationsCet',
  libelles: ['monétisation du CET', 'monétisations du CET'],
  aEmettre: async (db, d, jusqua) => elementsMonetisationsCet(d, jusqua, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie'))),
  aSaisir: async () => [], // gardées dans le lot sans code Sage : listées par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: monetisationsDuContenu,
  reserver: async (db, lotId, elements) => {
    for (const x of monetisationsDuContenu(elements)) await db.update('monetisationsCet', x.id, { lotId });
  },
  confirmer: async (db, _d, lot) => await confirmer(db, lot),
  liberer: async (db, lot) => { await db.run('UPDATE monetisations_cet SET lot_id = NULL WHERE lot_id = ? AND sage = FALSE', [lot.id]); },
};
