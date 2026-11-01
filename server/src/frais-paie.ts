// Notes de frais dans la paie (lot 11, chantier C5), côté serveur : famille « frais » du registre des éléments de lot
// (server/src/elements-lot.ts). Remboursements des notes contrôlées et avances validées (règles :
// shared/rules/frais-paie.ts), en euros, colonne « montant » du fichier d'import : toujours réservés par le lot de leur
// période (note « en paiement », `notesFrais.lotId` ; avance « en paiement »), payés à la confirmation de l'import
// (note « payée », avance « versée »), libérés à l'annulation du lot. Rubriques désactivées par défaut (codes Sage à
// confirmer par la paie) : l'élément part sans code Sage, absent du fichier, listé « à saisir dans Sage ». Un lot dont un
// élément de frais part dans le fichier est refusé tant que le format en vigueur n'a pas la colonne « montant »
// (Paramètres → Paie, format du fichier d'import) : sans elle, le fichier ne porterait qu'une quantité de 1.
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import { elementsFrais, fraisDuContenu } from '../../shared/rules/frais-paie.ts';
import type { ElementFraisPaie, RubriquePaie } from '../../shared/types.ts';
import { ActionError } from './actions/context.ts';
import type { FamilleLot } from './elements-lot.ts';
import { lireFormatFichier } from './lots-paie.ts';

/** Refus d'un lot dont des remboursements partiraient dans un fichier sans colonne « montant ». */
export const REFUS_SANS_MONTANT = 'Remboursements de frais à transmettre : le format du fichier d’import n’a pas la colonne « montant ». Ajoutez-la (format du fichier d’import, écran Temps), puis générez de nouveau le lot.';

/** Famille du registre des éléments de lot : remboursements de frais et avances (lot 11). */
export const FAMILLE_FRAIS: FamilleLot<ElementFraisPaie> = {
  cle: 'frais',
  libelles: ['remboursement de frais', 'remboursements de frais'],
  aEmettre: async (db, d, jusqua) => elementsFrais(d, jusqua, rubriquesPaie(await db.all<RubriquePaie>('rubriquesPaie'))),
  aSaisir: async () => [], // gardés dans le lot sans code Sage : listés par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: fraisDuContenu,
  reserver: async (db, lotId, elements) => {
    if (elements.some(x => x.codeSage) && !(await lireFormatFichier(db)).colonnes.includes('montant')) throw new ActionError(REFUS_SANS_MONTANT, 409);
    for (const x of fraisDuContenu(elements)) {
      if (x.avance) await db.update('avancesFrais', x.id, { lotId, statut: 'en_paiement' });
      else await db.update('notesFrais', x.id, { lotId, statut: 'en_paiement' });
    }
  },
  confirmer: async (db, d, lot) => {
    await db.run(`UPDATE notes_frais SET statut = 'payee', payee_le = ? WHERE lot_id = ? AND statut = 'en_paiement'`, [d.ti, lot.id]);
    await db.run(`UPDATE avances_frais SET statut = 'versee', versee_le = ? WHERE lot_id = ? AND statut = 'en_paiement'`, [d.ti, lot.id]);
  },
  liberer: async (db, lot) => {
    await db.run(`UPDATE notes_frais SET lot_id = NULL, statut = 'controlee' WHERE lot_id = ? AND statut = 'en_paiement'`, [lot.id]);
    await db.run(`UPDATE avances_frais SET lot_id = NULL, statut = 'validee' WHERE lot_id = ? AND statut = 'en_paiement'`, [lot.id]);
  },
};
