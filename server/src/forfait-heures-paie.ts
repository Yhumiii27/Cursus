// Forfait annuel en heures dans la paie (lot 12, chantier C1, t044), côté serveur : famille « forfaitHeures » du registre
// des éléments de lot (server/src/elements-lot.ts, `FAMILLE_FORFAIT_HEURES`, clé `lotsPaie.forfaitHeures`). Heures de la
// clôture d'une plage sous forfait (HFA25, HFA50, HCA10, HCA25), comme les jours rachetés d'un forfait jours : toujours
// réservées par le lot de leur période d'émission (mois de la confirmation, ou dernier mois de la plage selon
// `forfaitHeuresEmission` ; mois de la sortie pour une plage close par la sortie, avec le solde de sortie), transmises à la
// confirmation de l'import, libérées à l'annulation du lot. Rubriques désactivées par défaut (codes Sage à confirmer par la
// paie) : l'élément part sans code Sage, absent du fichier, listé « à saisir dans Sage » dans le résumé du lot, et la
// confirmation de ce lot-là règle la ligne hors fichier. Une version qui remplace une ligne transmise (réouverture après
// transmission) n'émet que l'écart avec celle-ci, positif ou négatif (lot correctif) ; un écart négatif part sans code
// Sage quand le format du fichier refuse les quantités négatives. Heures non réalisées : jamais émises.
// Règles : shared/rules/forfait-heures.ts.
import { cloturesDuContenu, elementsForfaitHeures } from '../../shared/rules/forfait-heures.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import type { ClotureForfaitHeures, ElementForfaitHeuresPaie, RubriquePaie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import type { FamilleLot } from './elements-lot.ts';
import { lireFormatFichier, type LotEnregistre } from './lots-paie.ts';

/**
 * Confirmation d'un lot : lignes qu'il a réservées transmises ; celles qu'il a listées sans code Sage (rubriques désactivées)
 * réglées hors fichier — la paie les a saisies dans Sage d'après son résumé. Seul le contenu figé du lot compte.
 */
async function confirmer(db: Db, lot: Pick<LotEnregistre, 'id'>) {
  await db.run('UPDATE clotures_forfait_heures SET sage = TRUE WHERE lot_id = ?', [lot.id]);
  const contenu = (await db.get<LotEnregistre>('lotsPaie', lot.id))?.contenu;
  const elements = contenu?.forfaitHeures ?? [];
  for (const x of cloturesDuContenu(elements)) {
    // Toutes les quantités de la ligne sans code Sage : réglée hors fichier.
    if (elements.some(e => e.cloture === x.id && e.codeSage)) continue;
    if ((await db.get<ClotureForfaitHeures>('cloturesForfaitHeures', x.id))?.lotId === lot.id) await db.update<ClotureForfaitHeures>('cloturesForfaitHeures', x.id, { horsFichier: true });
  }
}

/** Famille du registre des éléments de lot : heures de la clôture d'un forfait annuel en heures (t044). */
export const FAMILLE_FORFAIT_HEURES: FamilleLot<ElementForfaitHeuresPaie> = {
  cle: 'forfaitHeures',
  libelles: ['clôture de forfait annuel en heures', 'clôtures de forfait annuel en heures'],
  aEmettre: async (db, d, jusqua) => elementsForfaitHeures(d, jusqua, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie')), (await lireFormatFichier(db)).negatifs !== false),
  aSaisir: async () => [], // gardées dans le lot sans code Sage : listées par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: cloturesDuContenu,
  reserver: async (db, lotId, elements) => {
    for (const x of cloturesDuContenu(elements)) await db.update('cloturesForfaitHeures', x.id, { lotId });
  },
  confirmer: async (db, _d, lot) => await confirmer(db, lot),
  liberer: async (db, lot) => { await db.run('UPDATE clotures_forfait_heures SET lot_id = NULL WHERE lot_id = ? AND sage = FALSE', [lot.id]); },
  // Version qui corrige une ligne transmise : le lot est un lot correctif.
  correctif: elements => elements.some(x => x.correctif),
};
