// Déplacements dans le fichier d'import de la paie (t031), côté serveur : famille « deplacements » du registre des
// éléments de lot (server/src/elements-lot.ts). Éléments déjà émis lus dans la table `deplacementsPaie` (une ligne par
// séjour, mois, rubrique et pays, avec son lot), séjours réservés par un lot à confirmer, premier jour transmis
// (réglage `deplacementsPaieAPartirDu` et clé `deplacementsPaieDepuis` de la table settings, posée par la migration
// lot6-paie-deplacements-depart d'une base existante ou par le premier lot d'une base neuve), éléments d'un nouveau lot
// (réservés à sa génération, supprimés à son annulation, transmis à sa confirmation), résumé de l'instantané pour l'écran
// Temps. Règles : shared/rules/deplacements-paie.ts.
import { droitsRh } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import {
  aQualifier, codeSageDeplacement, type DeplacementEmis, elementsDeplacements, sejoursDuContenu,
} from '../../shared/rules/deplacements-paie.ts';
import { periodeDeLaFeuille } from '../../shared/rules/lots-paie.ts';
import { moisDe, periodeOuverte, rubriquesPaie } from '../../shared/rules/paie.ts';
import { sagePending } from '../../shared/rules/temps.ts';
import type { CurrentUser, Dataset, DeplacementsPaieAttente, ElementDeplacementPaie, ISODate, LotPaie, RubriquePaie } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import type { FamilleLot } from './elements-lot.ts';

/** Ligne de la table `deplacementsPaie`. */
export type DeplacementPaieLigne = DeplacementEmis & { id: number; periode: string; lotId: number | null; sage: boolean };

/** Clé de la table settings : premier jour de déplacement transmis posé par Cursus (null ou absente : aucun). */
export const CLE_DEPUIS_DEPLACEMENTS = 'deplacementsPaieDepuis';

/** Premier jour transmis : la plus tardive de la date de mise en service réglée et de la date de départ posée. */
export function premierJourDeplacements(db: Db, s: Partial<Pick<Dataset['settings'], 'deplacementsPaieAPartirDu'>> | undefined): ISODate | null {
  return [s?.deplacementsPaieAPartirDu ?? null, db.getSetting<ISODate | null>(CLE_DEPUIS_DEPLACEMENTS, null)].filter((x): x is ISODate => !!x).sort().at(-1) ?? null;
}

/**
 * Pose la date de départ des déplacements : jours d'avant `depuis` laissés à Sage (la paie les a traités). Une date déjà
 * posée plus tardive est gardée. Tracé au journal (`migration.deplacementsPaie` : date, nombre de séjours commencés avant).
 */
export function poserDepartDeplacements(db: Db, depuis: ISODate, auteur: { actor: string; role: string | null }, raison: string): ISODate {
  const date = [db.getSetting<ISODate | null>(CLE_DEPUIS_DEPLACEMENTS, null), depuis].filter((x): x is ISODate => !!x).sort().at(-1)!;
  db.setSetting(CLE_DEPUIS_DEPLACEMENTS, date);
  const n = Number((db.sql.prepare(`SELECT (SELECT COUNT(*) FROM voyages WHERE depart < ? AND annule_le IS NULL) + (SELECT COUNT(*) FROM missions WHERE du < ?) AS n`).get(date, date) as { n: number }).n);
  journaliser(db, {
    ...auteur, action: 'migration.deplacementsPaie',
    message: `${raison} : déplacements transmis à la paie à partir du ${fmtIso(date)} — ${plural(n, 'séjour commencé', 'séjours commencés')} avant cette date, dont les jours d’avant restent à la saisie dans Sage`,
    payload: { depuis: date, sejours: n },
  });
  return date;
}

/** Lignes émises par les lots non annulés (celles d'un lot annulé ont été supprimées). */
const lignes = (db: Db) => db.all<DeplacementPaieLigne>('deplacementsPaie');

/** Séjours réservés par un lot généré, en attente de la confirmation de son import. */
function reserves(db: Db): Set<string> {
  const genere = new Set(db.all<LotPaie>('lotsPaie').filter(l => l.statut === 'genere').map(l => l.id));
  return new Set(lignes(db).filter(x => x.lotId != null && genere.has(x.lotId) && !x.sage).map(x => `${x.source}:${x.sourceId}`));
}

/** Éléments de déplacement d'un lot de la période `jusqua` (code Sage null : à saisir dans Sage). */
export function deplacementsAEmettre(db: Db, d: Domain, jusqua: string): ElementDeplacementPaie[] {
  return elementsDeplacements(d, {
    jusqua, emis: lignes(db), reserves: reserves(db), depuis: premierJourDeplacements(db, d.ds.settings),
    codeSage: codeSageDeplacement(d.ds.settings, rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie'))),
  });
}

/**
 * Premier lot de paie d'une base neuve (aucun lot, aucune date de départ) : la date de départ est posée au premier jour
 * de la période ouverte, pour que les séjours déjà enregistrés ne repartent pas en rappel des mois traités par Lucca et
 * Sage. Renvoie la suite du message du lot.
 */
export function departDeplacementsAuPremierLot(db: Db, d: Domain, user: CurrentUser): string {
  if (db.getSetting<ISODate | null>(CLE_DEPUIS_DEPLACEMENTS, null) !== null || db.all('lotsPaie').length) return '';
  const date = poserDepartDeplacements(db, `${periodeOuverte(d.ti, d.ds.settings.clotureJour)}-01`, { actor: user.nom, role: user.role }, 'Premier lot de paie');
  return ` · déplacements transmis à partir du ${fmtIso(date)}`;
}

/** Famille du registre des éléments de lot : déplacements (t031). */
export const FAMILLE_DEPLACEMENTS: FamilleLot<ElementDeplacementPaie> = {
  cle: 'deplacements',
  libelles: ['séjour (déplacement)', 'séjours (déplacements)'],
  avant: (db, d, user) => departDeplacementsAuPremierLot(db, d, user),
  aEmettre: deplacementsAEmettre,
  aSaisir: () => [], // gardés dans le lot sans code Sage : listés par le résumé (shared/rules/elements-lot.ts)
  idsDuContenu: sejoursDuContenu,
  reserver: (db, lotId, elements) => {
    for (const x of elements) {
      db.insert('deplacementsPaie', {
        empId: x.empId, source: x.source, sourceId: x.sourceId, mois: x.mois, periode: x.periode, rubrique: x.rubrique, pays: x.pays, quantite: x.quantite,
        du: x.du, au: x.au, codeSage: x.codeSage, lotId, sage: false,
      });
    }
  },
  confirmer: (db, _d, lot) => { db.sql.prepare('UPDATE deplacements_paie SET sage = 1 WHERE lot_id = ?').run(lot.id); },
  // Lot annulé : ses éléments disparaissent, l'écart du lot suivant les recalcule.
  liberer: (db, lot) => { db.sql.prepare('DELETE FROM deplacements_paie WHERE lot_id = ? AND sage = 0').run(lot.id); },
};

/**
 * Déplacements en attente du fichier de paie pour l'écran Temps : éléments jusqu'à la période ouverte (ou la dernière des
 * feuilles en attente), regroupés par salarié, période, rubrique et pays ; chantiers en France à qualifier qui ont des
 * missions. Service RH, paie et lecture seule ; null pour les autres.
 */
export function resumeDeplacementsPaie(db: Db, user: CurrentUser, ds: Dataset): DeplacementsPaieAttente | null {
  const droits = droitsRh(user);
  if (!droits.includes('rh') && !droits.includes('paie') && !droits.includes('consultation')) return null;
  const d = new Domain(ds);
  const jusqua = [periodeOuverte(d.ti, ds.settings.clotureJour), ...sagePending(d).map(sh => periodeDeLaFeuille(sh.week, ds.settings, d.ti))].sort().at(-1)!;
  const groupes = new Map<string, DeplacementsPaieAttente['elements'][number]>();
  for (const x of deplacementsAEmettre(db, d, jusqua)) {
    const k = `${x.empId}|${x.periode}|${x.rubrique}|${x.pays}|${x.codeSage ? 1 : 0}|${x.mois !== x.periode ? 1 : 0}`;
    const g = groupes.get(k) ?? { empId: x.empId, periode: x.periode, rubrique: x.rubrique, pays: x.pays, quantite: 0, aSaisir: !x.codeSage, rappel: x.mois !== x.periode };
    g.quantite = Math.round((g.quantite + x.quantite) * 100) / 100;
    groupes.set(k, g);
  }
  const depuis = premierJourDeplacements(db, ds.settings);
  const aQ = ds.referentiels.chantiers.filter(aQualifier).map(c => ({
    chantier: c.id, nom: c.nom,
    missions: ds.missions.filter(m => m.projet === c.id && moisDe(m.du) <= jusqua && (!depuis || m.au >= depuis)).length,
  })).filter(x => x.missions > 0);
  return { elements: [...groupes.values()].filter(g => g.quantite !== 0), aQualifier: aQ };
}
