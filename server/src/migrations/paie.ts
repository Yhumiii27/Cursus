// Migrations nommées du chantier « paie » (lot 4) : mode des heures supplémentaires figé sur les feuilles validées.
import { Domain } from '../../../shared/domain.ts';
import { matricule, plural } from '../../../shared/format.ts';
import { recupInfo } from '../../../shared/rules/conges.ts';
import type { CurrentUser, Dataset, FeuilleTemps } from '../../../shared/types.ts';
import { journaliser } from '../comptes.ts';
import { loadFull, loadSettings } from '../dataset.ts';
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
