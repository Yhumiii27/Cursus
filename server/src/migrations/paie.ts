// Migrations nommées du chantier « paie » (lot 4) : mode des heures supplémentaires figé sur les feuilles validées ;
// feuilles déjà transmises réunies en un lot de paie historique.
import { randomUUID } from 'node:crypto';
import { isoParis } from '../../../shared/dates.ts';
import { Domain } from '../../../shared/domain.ts';
import { matricule, plural } from '../../../shared/format.ts';
import { recupInfo } from '../../../shared/rules/conges.ts';
import { periodesSemaine } from '../../../shared/rules/paie.ts';
import type { CurrentUser, Dataset, FeuilleTemps } from '../../../shared/types.ts';
import { journaliser } from '../comptes.ts';
import { loadFull, loadSettings, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

const CURSUS: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Mise à jour de la base' };
const aFiger = `statut = 'validee' AND heures_sup IS NULL`;
/** Feuilles validées encore sans mode des heures supplémentaires. */
const aReprendre = (db: Db) => Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM feuilles WHERE ${aFiger}`).get() as { n: number }).n);

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
  necessaire: db => db.neuve || aReprendre(db) > 0,
  executer: db => {
    if (!aReprendre(db)) return;
    const mode = loadSettings(db).heuresSupMode;
    // Soldes d'avant : chaque feuille validée encore sans mode avec le calcul d'origine (payée et en repos).
    const ancien = loadFull(db, CURSUS);
    const avant = soldesRecup({ ...ancien, feuilles: ancien.feuilles.map((f): FeuilleTemps => (f.statut === 'validee' && !f.heuresSup ? { ...f, heuresSup: 'historique' } : f)) });
    const historique = Number(db.sql.prepare(`UPDATE feuilles SET heures_sup = 'historique' WHERE ${aFiger} AND sage = 1`).run().changes);
    const reglees = Number(db.sql.prepare(`UPDATE feuilles SET heures_sup = ? WHERE ${aFiger}`).run(mode).changes);
    const apres = soldesRecup(loadFull(db, CURSUS));
    const negatifs = [...apres].filter(([id, solde]) => solde < 0 && (avant.get(id) ?? 0) >= 0).map(([id, solde]) => ({ empId: id, avant: avant.get(id) ?? 0, apres: solde }));
    const message = `Reprise : mode des heures supplémentaires figé sur ${plural(historique + reglees, 'feuille validée', 'feuilles validées')}`
      + ` (${historique} déjà transmise${historique > 1 ? 's' : ''} : calcul d’origine, payées et en repos ; ${reglees} non transmise${reglees > 1 ? 's' : ''} : ${mode === 'paiement' ? 'payées, sans repos' : 'en repos'})`
      + (negatifs.length ? ` — solde de récupération devenu négatif pour ${plural(negatifs.length, 'salarié', 'salariés')}, à examiner avec la paie` : '');
    journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.heuresSup', message,
      payload: { mode, historique, reglees, soldesNegatifs: negatifs.map(n => ({ ...n, matricule: matricule(n.empId) })) },
      salaries: negatifs.map(n => n.empId),
    });
    return `${plural(historique + reglees, 'feuille', 'feuilles')} : mode des heures supplémentaires figé${negatifs.length ? `, ${plural(negatifs.length, 'solde', 'soldes')} de récupération négatif${negatifs.length > 1 ? 's' : ''} (journal)` : ''}`;
  },
};

const sansLot = `statut = 'validee' AND sage = 1 AND lot_id IS NULL`;
/** Feuilles transmises à la paie avant les lots (simple case `sage`), sans lot. */
const transmisesSansLot = (db: Db) => Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM feuilles WHERE ${sansLot}`).get() as { n: number }).n);

/**
 * Feuilles transmises sans lot réunies en un lot « historique », transmis, au contenu inconnu (avant les lots, seule la
 * dernière transmission était gardée, réglage `lastSagePush`, écrasé à chaque fois) : elles ne repartent jamais, et
 * l'historique des lots les montre. Mode de la dernière transmission connue (la simulation, seul mode qui marquait des
 * feuilles avant le lot 4), daté de celle-ci à défaut de mieux (`date` : date imposée). Renvoie le lot créé, ou null.
 * Appelée aussi par le jeu de démonstration (server/src/seed.ts), dont les plus anciennes feuilles sont déjà transmises.
 */
export function lotHistorique(db: Db, auteur = 'Cursus', date?: string): { id: number; feuilles: { empId: number; week: string }[] } | null {
  const feuilles = db.sql.prepare(`SELECT emp_id AS empId, week FROM feuilles WHERE ${sansLot} ORDER BY week, emp_id`).all() as { empId: number; week: string }[];
  if (!feuilles.length) return null;
  const dernier = db.getSetting<{ mode?: string; envoye_le?: string; periodes?: unknown } | null>('lastSagePush', null);
  const envoi = new Date(date ?? dernier?.envoye_le ?? Number.NaN);
  const connu = !Number.isNaN(envoi.getTime());
  const quand = connu ? envoi.toISOString() : new Date().toISOString();
  // Périodes selon la règle de rattachement réglée, au jour de l'envoi (mois du dimanche par défaut, rappel d'une
  // période close), plus celles que la dernière transmission a annoncées ; période du lot : la plus récente.
  const settings = loadSettings(db), jour = connu ? isoParis(envoi) : todayIso();
  const parts = feuilles.flatMap(f => periodesSemaine(f.week, settings, jour));
  const annoncees = Array.isArray(dernier?.periodes) ? dernier.periodes.filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p)) : [];
  const periodes = [...new Set([...parts.map(x => x.periode), ...annoncees])].sort();
  const rappels = [...new Set(parts.flatMap(x => (x.origine ? [x.origine] : [])))].sort();
  const lot = db.insert<{ id: number }>('lotsPaie', {
    cle: randomUUID(), mode: dernier?.mode === 'api' || dernier?.mode === 'fichier' ? dernier.mode : 'simulation', statut: 'transmis',
    periode: periodes.at(-1), periodes, rappels, creation: quand, auteur, feuilles,
    resume: { lignes: 0, salaries: new Set(feuilles.map(f => f.empId)).size, rubriques: {} }, sansMatricule: [], contenu: null,
    telechargeLe: null, telechargePar: null, telechargements: 0, confirmeLe: quand, confirmePar: auteur, reference: null,
    annuleLe: null, annulePar: null, historique: true,
  });
  db.sql.prepare(`UPDATE feuilles SET lot_id = ? WHERE ${sansLot}`).run(lot.id);
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
  necessaire: db => db.neuve || transmisesSansLot(db) > 0,
  executer: db => {
    const lot = lotHistorique(db);
    if (!lot) return;
    journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.lotsPaie',
      message: `Reprise : ${plural(lot.feuilles.length, 'feuille déjà transmise', 'feuilles déjà transmises')} à la paie réunies dans le lot historique n° ${lot.id}`,
      payload: { lot: lot.id, feuilles: lot.feuilles }, salaries: lot.feuilles.map(f => f.empId),
    });
    return `${plural(lot.feuilles.length, 'feuille transmise', 'feuilles transmises')} : lot historique n° ${lot.id}`;
  },
};
