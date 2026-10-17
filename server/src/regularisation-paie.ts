// Régularisation de la paie d'une feuille rouverte (t131), côté serveur : ce qui est déjà parti pour une feuille, lu dans
// le contenu figé des lots transmis (que seul le serveur garde), et ce qu'il faut au contenu d'un lot correctif (mode de
// régularisation du format du fichier, rubriques déjà transmises des autres feuilles du salarié en « annule et
// remplace »). Règles : shared/rules/regularisation.ts ; action : server/src/actions/reouverture.ts.
import { isoWeek, isoWeekYear } from '../../shared/dates.ts';
import type { Domain } from '../../shared/domain.ts';
import { key } from '../../shared/format.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import { additionner, modeRegularisation, rubriquesDeLaFeuille, type OptionsRegularisation } from '../../shared/rules/regularisation.ts';
import type { FeuilleTemps, ISODate, ReouvertureFeuille, RubriquesFeuille, SagePush } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { lireFormatFichier, type LotEnregistre } from './lots-paie.ts';

const semaineIso = (week: ISODate) => `${isoWeekYear(week)}-S${String(isoWeek(week)).padStart(2, '0')}`;

type ParPeriode = Record<string, Record<string, number>>;

/**
 * Rubriques d'une feuille d'après les lignes d'un contenu (lot d'avant les rubriques par feuille) : lignes de sa semaine
 * sous le matricule `matricule`, additionnées par période d'origine. Null si le salarié n'a aucune ligne dans ce contenu
 * (matricule changé depuis : rien ne permet de les rapprocher).
 */
export function rubriquesDesLignes(contenu: Pick<SagePush, 'lignes'>, matricule: string, week: ISODate): ParPeriode | null {
  if (!contenu.lignes.some(l => l.matricule === matricule)) return null;
  return additionner(...contenu.lignes.filter(l => l.matricule === matricule && l.semaine === semaineIso(week))
    .map(l => ({ [l.periode_origine ?? l.periode ?? '']: l.rubriques })));
}

/** Lots transmis qui portent la feuille, du plus récent au plus ancien. */
const lotsTransmis = (db: Db, sh: Pick<FeuilleTemps, 'empId' | 'week'>) => db.all<LotEnregistre>('lotsPaie')
  .filter(l => l.statut === 'transmis' && l.feuilles.some(f => f.empId === sh.empId && f.week === sh.week))
  .sort((a, b) => b.id - a.id);

/**
 * Ce que la paie a déjà reçu pour une feuille transmise : rubriques figées par le dernier lot transmis qui la porte (son
 * contenu les garde depuis le lot 5) ; sinon ses lignes dans les lots transmis, rapprochées par matricule et semaine ;
 * sinon (lot historique, sans contenu) la feuille recalculée telle qu'elle a été validée (régime, mode des heures
 * supplémentaires, majorations et contrepartie figés), traduite avec la table des rubriques en vigueur.
 */
export function transmisDeLaFeuille(db: Db, d: Domain, sh: FeuilleTemps): Pick<ReouvertureFeuille, 'rubriques' | 'lot' | 'source'> {
  const lots = lotsTransmis(db, sh);
  const lot = lots[0]?.id ?? null;
  for (const l of lots) {
    const r = l.contenu?.rubriquesFeuilles?.find(x => x.empId === sh.empId && x.week === sh.week);
    if (r) return { rubriques: r.periodes, lot: l.id, source: 'lot' };
  }
  const e = d.emp(sh.empId);
  const parLignes = e ? lots.flatMap(l => (l.contenu ? [rubriquesDesLignes(l.contenu, matriculeAffiche(e), sh.week)] : [])).filter((x): x is ParPeriode => x !== null) : [];
  if (parLignes.length) return { rubriques: additionner(...parLignes), lot, source: 'lignes' };
  return { rubriques: rubriquesDeLaFeuille(d, sh), lot, source: 'recalcul' };
}

/**
 * Options de la régularisation d'un lot : mode lu dans le format du fichier (quantités négatives acceptées, par défaut) ;
 * en « annule et remplace », rubriques déjà transmises des autres feuilles du salarié pour la période d'origine.
 */
export function optionsRegularisation(db: Db, d: Domain): Omit<OptionsRegularisation, 'semaine'> {
  const mode = modeRegularisation(lireFormatFichier(db));
  if (mode === 'ecart') return { mode };
  return {
    mode,
    autres: (empId, periode, exclues) => additionner(...d.ds.feuilles
      .filter(sh => sh.empId === empId && sh.sage && !exclues.includes(sh.week))
      .map(sh => ({ [periode]: transmisDeLaFeuille(db, d, sh).rubriques?.[periode] ?? {} })))[periode] ?? {},
  };
}

/** Relevé d'heures déjà parti à l'agence d'intérim pour cette semaine (nom d'agence comparé sans casse ni accents). */
export function releveParti(db: Db, agence: string | null | undefined, semaine: ISODate): boolean {
  if (!agence) return false;
  const rows = db.sql.prepare('SELECT agence FROM releves WHERE semaine = ?').all(semaine) as { agence: string }[];
  return rows.some(r => key(r.agence) === key(agence));
}

/**
 * Rubriques par feuille d'un lot d'avant le lot 5 (migration lot5-paie-rubriques-par-feuille), d'après ses lignes et le
 * matricule actuel de chaque salarié : une feuille dont le salarié n'a aucune ligne dans le lot n'en reçoit pas.
 */
export function rubriquesFeuillesDuLot(lot: Pick<LotEnregistre, 'feuilles' | 'contenu'>, matriculeDe: (empId: number) => string | null): RubriquesFeuille[] {
  if (!lot.contenu) return [];
  return lot.feuilles.flatMap(f => {
    const m = matriculeDe(f.empId);
    const periodes = m ? rubriquesDesLignes(lot.contenu!, m, f.week) : null;
    return periodes ? [{ empId: f.empId, week: f.week, periodes }] : [];
  });
}
