// Forfait jours (t043), côté serveur : contrôle du plafond à la validation d'une feuille (un seul appel dans
// server/src/actions/temps.ts) et famille « rachats » du registre des éléments de lot (server/src/elements-lot.ts) : jours
// rachetés par avenant de renonciation (table `avenantsForfait`), rubrique JREN. Comme les déplacements : l'avenant en
// attente est toujours réservé par le lot de sa période ; seule une rubrique active le met dans le fichier. Désactivée (par
// défaut, tant que la paie n'a pas donné son code), il part sans code Sage, listé « à saisir dans Sage » dans le résumé du
// lot, et la confirmation de ce lot-là le règle hors fichier : un avenant enregistré après la génération attend le lot
// suivant, et une rubrique activée entre la génération et la confirmation ne le renvoie pas dans un autre fichier.
// Règles : shared/rules/forfait-jours.ts.
import { controleValidationForfait, elementsRachats, rachatsDuContenu } from '../../shared/rules/forfait-jours.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import type { AvenantForfait, ElementRachatPaie, Employe, FeuilleTemps, LotPaie, RubriquePaie } from '../../shared/types.ts';
import type { LotEnregistre } from './lots-paie.ts';
import type { Db } from './db.ts';
import { ActionError, type Ctx, str } from './actions/context.ts';
import type { FamilleLot } from './elements-lot.ts';

/** Motif du dépassement du forfait : 500 caractères au plus, comme celui des durées maximales. */
const MOTIF_MAX = 500;

/**
 * Validation d'une feuille de forfait jours (`validee` : la feuille telle qu'elle sera enregistrée) : au-delà du plafond
 * de l'année (forfait, plus les jours rachetés par avenant), le motif du valideur (`p.motifForfait`) est exigé et
 * enregistré sur la feuille ; au seuil d'alerte, une alerte s'ajoute au message, sans blocage.
 */
export function controleForfaitJours(ctx: Ctx, emp: Employe, validee: FeuilleTemps, p: Record<string, any>): { champs: Partial<Pick<FeuilleTemps, 'motifForfait'>>; alertes: string[] } {
  const { depassements, alertes } = controleValidationForfait(ctx.d, emp, validee);
  if (!depassements.length) return { champs: {}, alertes };
  const motif = str(p.motifForfait) || validee.motifForfait || '';
  if (!motif) throw new ActionError(`${depassements.join(' ; ')} : indiquez le motif du dépassement avant de valider la feuille (ou enregistrez un avenant de renonciation, si l’accord collectif le permet)`);
  if (motif.length > MOTIF_MAX) throw new ActionError(`Motif trop long (${MOTIF_MAX} caractères au plus)`);
  return { champs: { motifForfait: motif }, alertes: depassements };
}

const table = (db: Db) => rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie'));

/**
 * Confirmation d'un lot : avenants qu'il a réservés transmis ; ceux qu'il a listés sans code Sage (JREN désactivée à la
 * génération) réglés hors fichier — la paie les a saisis dans Sage d'après son résumé. Seul le contenu figé du lot compte :
 * ni l'état présent de la rubrique, ni un avenant enregistré depuis.
 */
export function confirmerRachats(db: Db, lot: Pick<LotPaie, 'id'>) {
  db.sql.prepare('UPDATE avenants_forfait SET sage = 1 WHERE lot_id = ?').run(lot.id);
  const contenu = db.get<LotEnregistre>('lotsPaie', lot.id)?.contenu;
  for (const x of rachatsDuContenu((contenu?.rachats ?? []).filter(x => !x.codeSage))) {
    if (db.get<AvenantForfait>('avenantsForfait', x.id)?.lotId === lot.id) db.update<AvenantForfait>('avenantsForfait', x.id, { horsFichier: true });
  }
}

/** Famille du registre des éléments de lot : jours rachetés d'un forfait jours (t043). */
export const FAMILLE_RACHATS: FamilleLot<ElementRachatPaie> = {
  cle: 'rachats',
  libelles: ['avenant de renonciation (forfait jours)', 'avenants de renonciation (forfait jours)'],
  aEmettre: (db, d, jusqua) => elementsRachats(d, jusqua, table(db)),
  aSaisir: () => [], // gardés dans le lot sans code Sage : listés par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: rachatsDuContenu,
  reserver: (db, lotId, elements) => rachatsDuContenu(elements).forEach(x => db.update('avenantsForfait', x.id, { lotId })),
  confirmer: (db, _d, lot) => confirmerRachats(db, lot),
  liberer: (db, lot) => { db.sql.prepare('UPDATE avenants_forfait SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id); },
};
