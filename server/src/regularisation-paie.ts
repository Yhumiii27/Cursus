// Régularisation de la paie d'une feuille rouverte (t131), côté serveur : ce qui est déjà parti pour une feuille, lu dans
// le contenu figé des lots transmis (que seul le serveur garde), et ce qu'il faut au contenu d'un lot correctif (mode de
// régularisation du format du fichier, rubriques déjà transmises des autres feuilles du salarié en « annule et
// remplace »). Règles : shared/rules/regularisation.ts ; action : server/src/actions/reouverture.ts.
import { isoWeek, isoWeekYear } from '../../shared/dates.ts';
import type { Domain } from '../../shared/domain.ts';
import { key } from '../../shared/format.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import { additionner, aRegulariser, modeRegularisation, rubriquesDeLaFeuille, type OptionsRegularisation } from '../../shared/rules/regularisation.ts';
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

/** Lots transmis qui portent la feuille, du plus récent au plus ancien, parmi les lots de paie `tous`. */
const lotsTransmis = (tous: LotEnregistre[], sh: Pick<FeuilleTemps, 'empId' | 'week'>) => tous
  .filter(l => l.statut === 'transmis' && l.feuilles.some(f => f.empId === sh.empId && f.week === sh.week))
  .sort((a, b) => b.id - a.id);

/**
 * Ce que la paie a déjà reçu pour une feuille transmise : rubriques figées par le dernier lot transmis qui la porte (son
 * contenu les garde depuis le lot 5) ; sinon ses lignes dans les lots transmis, rapprochées par matricule et semaine ;
 * sinon (lot historique, sans contenu) la feuille recalculée telle qu'elle a été validée (régime, mode des heures
 * supplémentaires, majorations et contrepartie figés), traduite avec la table des rubriques en vigueur.
 */
export async function transmisDeLaFeuille(db: Db, d: Domain, sh: FeuilleTemps): Promise<Pick<ReouvertureFeuille, 'rubriques' | 'lot' | 'source'>> {
  return transmisParLesLots(await db.all<LotEnregistre>('lotsPaie'), d, sh);
}

/** Comme transmisDeLaFeuille, d'après les lots de paie déjà lus (`tous`). */
function transmisParLesLots(tous: LotEnregistre[], d: Domain, sh: FeuilleTemps): Pick<ReouvertureFeuille, 'rubriques' | 'lot' | 'source'> {
  const lots = lotsTransmis(tous, sh);
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
 * Ce que Sage a reçu pour une autre feuille du salarié, en « annule et remplace » : transmise, ce qu'en gardent les lots ;
 * rouverte depuis sa transmission (en cours de correction, ou revalidée et à régulariser hors de ce lot), les rubriques
 * gardées à sa réouverture, que Sage a toujours. Null : rien de transmis (feuille jamais partie).
 */
function dejaDansSage(tous: LotEnregistre[], d: Domain, sh: FeuilleTemps): ParPeriode | null {
  if (sh.sage) return transmisParLesLots(tous, d, sh).rubriques;
  return sh.reouverture?.rubriques ?? null;
}

/**
 * Options de la régularisation d'un lot : mode lu dans le format du fichier (quantités négatives acceptées, par défaut) ;
 * en « annule et remplace », rubriques déjà dans Sage des autres feuilles du salarié pour la période d'origine, celles
 * des feuilles rouvertes depuis leur transmission comprises (sans elles, le total remplacerait leurs heures par rien).
 */
export async function optionsRegularisation(db: Db, d: Domain): Promise<Omit<OptionsRegularisation, 'semaine'>> {
  const mode = modeRegularisation(await lireFormatFichier(db));
  if (mode === 'ecart') return { mode };
  // Lots lus une fois : `autres` est appelé par les règles de shared/ (synchrones) pendant la construction du lot.
  const lots = await db.all<LotEnregistre>('lotsPaie');
  return {
    mode,
    autres: (empId, periode, exclues) => additionner(...d.ds.feuilles
      .filter(sh => sh.empId === empId && !exclues.includes(sh.week))
      .map(sh => ({ [periode]: dejaDansSage(lots, d, sh)?.[periode] ?? {} })))[periode] ?? {},
  };
}

/**
 * « Annule et remplace » (format du fichier sans quantité négative) : un lot qui régularise des feuilles rouvertes ne
 * porte que ces régularisations, des totaux de période à importer en remplacement ; les feuilles ordinaires et les
 * absences, des quantités à ajouter, attendent le lot suivant. Pour que les totaux restent justes, ce lot correctif se
 * génère quand aucun autre lot n'attend la confirmation de son import, et aucun autre lot ne se génère tant que le sien
 * l'attend. Rend les feuilles du lot (toutes, en écart ou sans régularisation) et le nombre de feuilles qui attendent ;
 * refus (texte) sinon.
 */
export async function selectionRemplace(db: Db, sheets: readonly FeuilleTemps[]): Promise<{ sheets: FeuilleTemps[]; enAttente: number } | string> {
  if (modeRegularisation(await lireFormatFichier(db)) !== 'remplace') return { sheets: [...sheets], enAttente: 0 };
  const generes = (await db.all<LotEnregistre>('lotsPaie')).filter(l => l.statut === 'genere');
  const remplace = generes.find(l => l.contenu?.regularisation === 'remplace');
  if (remplace) {
    return `Lot correctif n° ${remplace.id} (annule et remplace) à confirmer : importez son fichier dans Sage en remplacement et confirmez l’import, ou annulez-le, avant de générer un autre lot`;
  }
  const correctifs = sheets.filter(aRegulariser);
  if (!correctifs.length) return { sheets: [...sheets], enAttente: 0 };
  if (generes.length) {
    return `Lot n° ${generes[0].id} à confirmer : en « annule et remplace », le lot correctif se génère quand aucun autre lot n’attend son import. Confirmez ou annulez d’abord ${generes.length > 1 ? `les lots n° ${generes.map(l => l.id).join(', ')}` : 'ce lot'}`;
  }
  return { sheets: correctifs, enAttente: sheets.length - correctifs.length };
}

/** Relevé d'heures déjà parti à l'agence d'intérim pour cette semaine (nom d'agence comparé sans casse ni accents). */
export async function releveParti(db: Db, agence: string | null | undefined, semaine: ISODate): Promise<boolean> {
  if (!agence) return false;
  const rows = await db.query('SELECT agence FROM releves WHERE semaine = ?', [semaine]) as { agence: string }[];
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
