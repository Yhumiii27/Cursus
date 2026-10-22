// Forfait jours (t043), côté serveur : contrôle du plafond à la validation d'une feuille (un seul appel dans
// server/src/actions/temps.ts) et famille « rachats » du registre des éléments de lot (server/src/elements-lot.ts) : jours
// rachetés par avenant de renonciation (table `avenantsForfait`), rubrique JREN. Comme les soldes de sortie : seule une
// rubrique active part dans le fichier ; désactivée (par défaut, tant que la paie n'a pas donné son code), les jours sont
// listés « à saisir dans Sage » dans le résumé du lot, puis réglés hors fichier à la confirmation du lot de leur période.
// Règles : shared/rules/forfait-jours.ts.
import type { Domain } from '../../shared/domain.ts';
import { controleValidationForfait, elementsRachats, periodeRachat, rachatsASaisir, rachatsDuContenu, RUBRIQUE_JREN } from '../../shared/rules/forfait-jours.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import type { AvenantForfait, ElementRachatPaie, Employe, FeuilleTemps, LotPaie, RubriquePaie } from '../../shared/types.ts';
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
 * Confirmation d'un lot : jours rachetés de sa période (ou d'avant) qu'il n'emporte pas, faute de rubrique JREN active,
 * réglés hors fichier (la paie les a saisis dans Sage) ; une rubrique activée ensuite ne les rattrape pas.
 */
export function rachatsHorsFichier(db: Db, d: Domain, lot: Pick<LotPaie, 'id' | 'periode'>) {
  if (table(db).find(t => t.code === RUBRIQUE_JREN)?.active) return;
  for (const a of db.all<AvenantForfait>('avenantsForfait')) {
    if (a.annuleLe || a.lotId != null || a.sage || periodeRachat(a, d.ds.settings, d.ti) > lot.periode) continue;
    db.update<AvenantForfait>('avenantsForfait', a.id, { lotId: lot.id, sage: true, horsFichier: true });
  }
}

/** Famille du registre des éléments de lot : jours rachetés d'un forfait jours (t043). */
export const FAMILLE_RACHATS: FamilleLot<ElementRachatPaie> = {
  cle: 'rachats',
  libelles: ['avenant de renonciation (forfait jours)', 'avenants de renonciation (forfait jours)'],
  aEmettre: (db, d, jusqua) => elementsRachats(d, jusqua, table(db)),
  aSaisir: (db, d, jusqua) => rachatsASaisir(d, jusqua, table(db)),
  idsDuContenu: rachatsDuContenu,
  reserver: (db, lotId, elements) => rachatsDuContenu(elements).forEach(x => db.update('avenantsForfait', x.id, { lotId })),
  confirmer: (db, d, lot) => {
    db.sql.prepare('UPDATE avenants_forfait SET sage = 1 WHERE lot_id = ?').run(lot.id);
    rachatsHorsFichier(db, d, lot);
  },
  liberer: (db, lot) => { db.sql.prepare('UPDATE avenants_forfait SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id); },
};
