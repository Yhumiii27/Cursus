// Migrations nommées du chantier « paie » (lot 4) : mode des heures supplémentaires figé sur les feuilles validées ;
// feuilles déjà transmises réunies en un lot de paie historique. Lot 5 : ancien mode « api » des lots retiré ; absences
// des périodes passées laissées à la saisie dans Sage (premier jour transmis par le fichier d'import) ; rubriques
// transmises de chaque feuille reprises dans le contenu des lots (réouverture d'une feuille transmise, t131).
import { randomUUID } from 'node:crypto';
import { isoParis } from '../../../shared/dates.ts';
import { Domain } from '../../../shared/domain.ts';
import { matricule, plural } from '../../../shared/format.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { recupInfo } from '../../../shared/rules/conges.ts';
import { periodeOuverte, periodesSemaine } from '../../../shared/rules/paie.ts';
import type { CurrentUser, Dataset, FeuilleTemps } from '../../../shared/types.ts';
import { lireDepuis, poserDepart } from '../absences-paie.ts';
import type { LotEnregistre } from '../lots-paie.ts';
import { rubriquesFeuillesDuLot } from '../regularisation-paie.ts';
import { journaliser } from '../comptes.ts';
import { loadFull, loadSettings, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

const CURSUS: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Mise à jour de la base' };
const aFiger = `statut = 'validee' AND heures_sup IS NULL`;
/** Feuilles validées encore sans mode des heures supplémentaires. */
const aReprendre = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n FROM feuilles WHERE ${aFiger}`) as { n: number }).n);

/** Solde de récupération (heures) de chaque salarié qui en a un compteur, d'après l'instantané `ds`. */
function soldesRecup(ds: Dataset): Map<number, number> {
  const d = new Domain(ds), out = new Map<number, number>();
  for (const e of ds.employes) {
    const r = recupInfo(d, e);
    if (r) out.set(e.id, Math.round(r.solde * 100) / 100);
  }
  return out;
}

/**
 * Avant le lot 4, une heure supplémentaire était à la fois payée (HS25, HS50) et créditée en repos (RCR_ACQUIS). Les
 * feuilles validées reçoivent un mode figé : déjà transmises à la paie (`sage`), elles gardent ce calcul (« historique » :
 * ce qui est parti reste exact) ; validées sans être transmises, elles prennent le mode réglé (« paiement » par défaut),
 * sans quoi elles partiraient payées et en repos. Le repos qu'elles créditaient disparaît : le journal liste les salariés
 * dont le solde de récupération devient négatif, pour que la paie tranche. Les données sont reprises en SQL ; seul ce
 * contrôle des soldes lit le code métier (recupInfo), sans rien écrire d'autre que le journal.
 */
export const HEURES_SUP: Migration = {
  nom: 'lot4-paie-heures-sup',
  // Base existante sans feuille validée à reprendre (créée par cette version) : notée faite. Base neuve : exécutée, sans effet.
  necessaire: async db => db.neuve || await aReprendre(db) > 0,
  executer: async db => {
    if (!await aReprendre(db)) return;
    const mode = (await loadSettings(db)).heuresSupMode;
    // Soldes d'avant : chaque feuille validée encore sans mode avec le calcul d'origine (payée et en repos).
    const ancien = await loadFull(db, CURSUS);
    const avant = soldesRecup({ ...ancien, feuilles: ancien.feuilles.map((f): FeuilleTemps => (f.statut === 'validee' && !f.heuresSup ? { ...f, heuresSup: 'historique' } : f)) });
    const historique = Number((await db.run(`UPDATE feuilles SET heures_sup = 'historique' WHERE ${aFiger} AND sage = TRUE`)).changes);
    const reglees = Number((await db.run(`UPDATE feuilles SET heures_sup = ? WHERE ${aFiger}`, [mode])).changes);
    const apres = soldesRecup(await loadFull(db, CURSUS));
    const negatifs = [...apres].filter(([id, solde]) => solde < 0 && (avant.get(id) ?? 0) >= 0).map(([id, solde]) => ({ empId: id, avant: avant.get(id) ?? 0, apres: solde }));
    const message = `Reprise : mode des heures supplémentaires figé sur ${plural(historique + reglees, 'feuille validée', 'feuilles validées')}`
      + ` (${historique} déjà transmise${historique > 1 ? 's' : ''} : calcul d’origine, payées et en repos ; ${reglees} non transmise${reglees > 1 ? 's' : ''} : ${mode === 'paiement' ? 'payées, sans repos' : 'en repos'})`
      + (negatifs.length ? ` — solde de récupération devenu négatif pour ${plural(negatifs.length, 'salarié', 'salariés')}, à examiner avec la paie` : '');
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.heuresSup', message,
      payload: { mode, historique, reglees, soldesNegatifs: negatifs.map(n => ({ ...n, matricule: matricule(n.empId) })) },
      salaries: negatifs.map(n => n.empId),
    });
    return `${plural(historique + reglees, 'feuille', 'feuilles')} : mode des heures supplémentaires figé${negatifs.length ? `, ${plural(negatifs.length, 'solde', 'soldes')} de récupération négatif${negatifs.length > 1 ? 's' : ''} (journal)` : ''}`;
  },
};

const sansLot = `statut = 'validee' AND sage = TRUE AND lot_id IS NULL`;
/** Feuilles transmises à la paie avant les lots (simple case `sage`), sans lot. */
const transmisesSansLot = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n FROM feuilles WHERE ${sansLot}`) as { n: number }).n);

/**
 * Feuilles transmises sans lot réunies en un lot « historique », transmis, au contenu inconnu (avant les lots, seule la
 * dernière transmission était gardée, réglage `lastSagePush`, écrasé à chaque fois) : elles ne repartent jamais, et
 * l'historique des lots les montre. Mode de la dernière transmission connue (la simulation, seul mode qui marquait des
 * feuilles avant le lot 4 ; l'ancien mode « api » devient « fichier », mode réel), daté de celle-ci à défaut de mieux (`date` : date imposée). Renvoie le lot créé, ou null.
 * Appelée aussi par le jeu de démonstration (server/src/seed.ts), dont les plus anciennes feuilles sont déjà transmises.
 */
export async function lotHistorique(db: Db, auteur = 'Cursus', date?: string): Promise<{ id: number; feuilles: { empId: number; week: string }[] } | null> {
  const feuilles = await db.query(`SELECT emp_id AS "empId", week FROM feuilles WHERE ${sansLot} ORDER BY week, emp_id`) as { empId: number; week: string }[];
  if (!feuilles.length) return null;
  const dernier = await db.getSetting<{ mode?: string; envoye_le?: string; periodes?: unknown } | null>('lastSagePush', null);
  const envoi = new Date(date ?? dernier?.envoye_le ?? Number.NaN);
  const connu = !Number.isNaN(envoi.getTime());
  const quand = connu ? envoi.toISOString() : new Date().toISOString();
  // Périodes selon la règle de rattachement réglée, au jour de l'envoi (mois du dimanche par défaut, rappel d'une
  // période close), plus celles que la dernière transmission a annoncées ; période du lot : la plus récente.
  const settings = await loadSettings(db), jour = connu ? isoParis(envoi) : todayIso();
  const parts = feuilles.flatMap(f => periodesSemaine(f.week, settings, jour));
  const annoncees = Array.isArray(dernier?.periodes) ? dernier.periodes.filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p)) : [];
  const periodes = [...new Set([...parts.map(x => x.periode), ...annoncees])].sort();
  const rappels = [...new Set(parts.flatMap(x => (x.origine ? [x.origine] : [])))].sort();
  const lot = await db.insert<{ id: number }>('lotsPaie', {
    cle: randomUUID(), mode: dernier?.mode === 'api' || dernier?.mode === 'fichier' ? 'fichier' : 'simulation', statut: 'transmis',
    periode: periodes.at(-1), periodes, rappels, creation: quand, auteur, feuilles,
    resume: { lignes: 0, salaries: new Set(feuilles.map(f => f.empId)).size, rubriques: {} }, sansMatricule: [], contenu: null,
    telechargeLe: null, telechargePar: null, telechargements: 0, confirmeLe: quand, confirmePar: auteur, reference: null,
    annuleLe: null, annulePar: null, historique: true,
  });
  await db.run(`UPDATE feuilles SET lot_id = ? WHERE ${sansLot}`, [lot.id]);
  return { id: lot.id, feuilles };
}

/**
 * Avant les lots, une feuille transmise ne gardait qu'un booléen : elles forment un lot historique (t029), pour que
 * chaque feuille transmise appartienne à un lot et que l'historique de l'écran Temps soit complet. Tracé au journal
 * (`migration.lotsPaie`, archive paie), salarié par salarié.
 */
export const LOTS_HISTORIQUES: Migration = {
  nom: 'lot4-paie-lots-historiques',
  // Base neuve : exécutée, sans effet ; base existante sans feuille transmise hors lot : notée faite.
  necessaire: async db => db.neuve || await transmisesSansLot(db) > 0,
  executer: async db => {
    const lot = await lotHistorique(db);
    if (!lot) return;
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.lotsPaie',
      message: `Reprise : ${plural(lot.feuilles.length, 'feuille déjà transmise', 'feuilles déjà transmises')} à la paie réunies dans le lot historique n° ${lot.id}`,
      payload: { lot: lot.id, feuilles: lot.feuilles }, salaries: lot.feuilles.map(f => f.empId),
    });
    return `${plural(lot.feuilles.length, 'feuille transmise', 'feuilles transmises')} : lot historique n° ${lot.id}`;
  },
};

/** Lots de paie enregistrés dans l'ancien mode « api » (lot historique repris d'une transmission sous SAGE_URL). */
const lotsModeApi = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n FROM lots_paie WHERE mode = 'api'`) as { n: number }).n);

/**
 * Lot 5 : le mode « api » disparaît (la paie importe le fichier dans Sage, décision du 15 octobre 2026). Un lot
 * historique repris d'une transmission faite sous l'ancienne bascule SAGE_URL portait ce mode : il passe en « fichier »,
 * mode réel (ni l'un ni l'autre n'a jamais rien envoyé tout seul ; le lot reste transmis, sans contenu).
 */
export const MODE_API_RETIRE: Migration = {
  nom: 'lot5-paie-mode-api-retire',
  // Base neuve : exécutée, sans effet ; base existante sans lot en mode « api » : notée faite.
  necessaire: async db => db.neuve || await lotsModeApi(db) > 0,
  executer: async db => {
    const n = Number((await db.run(`UPDATE lots_paie SET mode = 'fichier' WHERE mode = 'api'`)).changes);
    if (n) return `${plural(n, 'lot de paie', 'lots de paie')} de l’ancien mode « api » en mode fichier d’import`;
  },
};

/** Absences validées d'une base existante : jusqu'au lot 5, la paie les saisissait elle-même dans Sage. */
const absencesValidees = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n FROM absences WHERE statut = 'validee'`) as { n: number }).n);

/**
 * Lot 5 (t028) : les absences validées partent dans le fichier d'import de la paie. Sur une base qui en porte déjà, la
 * paie a saisi celles des périodes passées dans Sage : Cursus ne transmet de ces absences que les jours à partir du
 * premier jour de la période de paie ouverte (date de départ, `poserDepart`), sans quoi elles repartiraient toutes en
 * rappel. Une absence enregistrée après la mise à jour part entière, en rappel pour un mois clos : la paie ne l'a pas
 * saisie. Base neuve, ou sans absence validée : la date de départ est posée par le premier lot de paie (la date de mise
 * en service se règle dans Paramètres → Absences et paie). Tracé au journal (date et nombre d'absences, jamais leur nature).
 */
export const ABSENCES_ANTERIEURES: Migration = {
  nom: 'lot5-paie-absences-anterieures',
  // Base neuve : exécutée, sans effet (aucune absence) ; base existante sans absence validée, ou date déjà posée : notée faite.
  necessaire: async db => db.neuve || (await absencesValidees(db) > 0 && await lireDepuis(db) === null),
  executer: async db => {
    if (!await absencesValidees(db)) return;
    const r = await poserDepart(db, `${periodeOuverte(todayIso(), (await loadSettings(db)).clotureJour)}-01`, { actor: 'Cursus', role: null }, 'Reprise');
    return `absences transmises à la paie à partir du ${r.depuis}`;
  },
};

/** Lots au contenu figé d'avant les rubriques par feuille (lot 5, t131). */
const sansRubriquesFeuilles = `FROM lots_paie WHERE contenu IS NOT NULL AND contenu <> 'null' AND json_extract(contenu, '$.rubriquesFeuilles') IS NULL`;
const lotsAReprendre = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n ${sansRubriquesFeuilles}`) as { n: number }).n);

/**
 * Lot 5 (t131) : le contenu d'un lot garde les rubriques de chaque feuille (codes Sage, par période d'origine), ce que la
 * réouverture d'une feuille transmise reprend pour n'envoyer que l'écart. Les lots d'avant ne gardaient que les lignes,
 * par matricule et semaine : elles sont rapprochées des feuilles du lot avec le matricule de paie actuel de chaque
 * salarié, au plus près de la transmission (un matricule changé ensuite ne permettrait plus de les retrouver). Une
 * feuille dont le salarié n'a aucune ligne dans le lot n'est pas reprise : sa réouverture la recalculera. Lots
 * historiques (sans contenu) inchangés. Tracé au journal (`migration.rubriquesFeuilles` : lots et nombre de feuilles).
 */
export const RUBRIQUES_PAR_FEUILLE: Migration = {
  nom: 'lot5-paie-rubriques-par-feuille',
  // Base neuve : exécutée, sans effet ; base existante sans lot à reprendre : notée faite.
  necessaire: async db => db.neuve || await lotsAReprendre(db) > 0,
  executer: async db => {
    if (!await lotsAReprendre(db)) return;
    const employes = new Map((await db.all<{ id: number; matriculePaie: string | null }>('employes')).map(e => [e.id, matriculeAffiche(e)]));
    const ids = (await db.query(`SELECT id ${sansRubriquesFeuilles}`) as { id: number }[]).map(r => r.id);
    let feuilles = 0;
    for (const id of ids) {
      const lot = (await db.get<LotEnregistre>('lotsPaie', id))!;
      const rubriquesFeuilles = rubriquesFeuillesDuLot(lot, empId => employes.get(empId) ?? null);
      feuilles += rubriquesFeuilles.length;
      await db.update<LotEnregistre>('lotsPaie', id, { contenu: { ...lot.contenu!, rubriquesFeuilles } });
    }
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.rubriquesFeuilles',
      message: `Reprise : rubriques transmises de ${plural(feuilles, 'feuille', 'feuilles')} gardées dans ${plural(ids.length, 'lot de paie', 'lots de paie')}, pour leur éventuelle réouverture`,
      payload: { lots: ids, feuilles },
    });
    return `${plural(ids.length, 'lot de paie', 'lots de paie')} : rubriques de ${plural(feuilles, 'feuille', 'feuilles')} reprises`;
  },
};
