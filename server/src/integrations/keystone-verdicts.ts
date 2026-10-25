// Verdicts Go / No Go poussés à Keystone. Le dernier verdict transmis est mémorisé par chantier et
// par ressource (table verdictsKeystone) ; chaque recalcul met en file un événement `verdict.modifie`
// pour chaque verdict qui a changé : statut ou codes de motif, jamais de libellé (même en partage
// détaillé). Recalcul après les actions qui peuvent changer un verdict (server/src/index.ts), après
// chaque écriture de Keystone (keystone-routes.ts) et chaque jour, pour les expirations.
// En simulation, rien ne part : les verdicts mémorisés alors ne sont pas réputés transmis, et le
// passage en mode API (KEYSTONE_URL) les renvoie tous comme des premiers verdicts.
import { GNG_CODE } from '../../../shared/constants.ts';
import { Domain } from '../../../shared/domain.ts';
import { identifiantKeystone } from '../../../shared/rules/matricules.ts';
import type { CurrentUser, Dataset } from '../../../shared/types.ts';
import { jeuApres } from '../cache-instantane.ts';
import { loadFull, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import { keystoneSortant, sendToKeystone, type CodeGng, type MotifKeystone } from './keystone.ts';

interface VerdictTransmis { id: number; chantier: string; empId: number; statut: CodeGng; motifs: MotifKeystone[]; date: string }

/**
 * Lecture du périmètre complet, comme le service RH, sans les résumés de la paie (lot 9, chantier 2, étape 2 : profil
 * référent HSE, qui voit tout le jeu sauf les absences et déplacements en attente du fichier de paie) : aucun calcul des
 * verdicts ne les lit (evaluateChantiers, enrich, tripsAll), et leur calcul, refait à chaque action d'absence, tiendrait
 * le verrou d'écriture pour rien.
 */
export const SUIVI: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Suivi des verdicts', profilRh: 'referent_hse' };

/**
 * Jeu des verdicts : l'instantané complet de `SUIVI` à l'état de la transaction en cours. Après une action (`depart` : le
 * jeu remis à l'action par `donneesAction`), lecture brute de départ plus le delta des écritures de l'action
 * (`jeuApres`, server/src/cache-instantane.ts) ; sinon, ou si ce départ est inconnu, `loadFull` (tâche du jour, API
 * Keystone, jeu de démonstration).
 */
export async function jeuDeSuivi(db: Db, depart?: Dataset): Promise<Dataset> {
  return (depart && await jeuApres(db, depart, SUIVI)) || await loadFull(db, SUIVI);
}

/** Forme comparable d'un verdict : l'ordre des exigences du chantier n'est pas un changement. */
const empreinte = (statut: string, motifs: MotifKeystone[]) => `${statut}|${motifs.map(m => `${m.code}:${m.niveau}`).sort().join(',')}`;

/** Réglage : mode d'envoi (`api` ou `simulation`) dans lequel les verdicts de verdictsKeystone ont été mémorisés. */
export const MODE_VERDICTS = 'verdictsKeystoneMode';

/**
 * Verdicts mémorisés en simulation (ou par une base antérieure à ce réglage) : jamais reçus par Keystone.
 * En mode API, ils sont oubliés, et chaque ressource suivie repart avec un premier verdict (`precedent: null`).
 */
async function oublierVerdictsSimules(db: Db) {
  const mode = keystoneSortant() ? 'api' : 'simulation';
  const avant = await db.getSetting<string | null>(MODE_VERDICTS, null);
  if (mode === avant) return;
  if (mode === 'api') await db.exec('DELETE FROM verdicts_keystone'); // réglage absent : base antérieure, verdicts jamais envoyés
  await db.setSetting(MODE_VERDICTS, mode);
}

/**
 * Compare le verdict de chaque ressource des chantiers actifs, en cours ou à venir, au dernier verdict
 * transmis, et met en file un événement pour chacun qui a changé, premier verdict compris. `initial` :
 * mémorise sans rien envoyer (jeu de démonstration). `depart` : jeu remis à l'action qui vient d'écrire, dans la même
 * transaction (POST /api/actions, server/src/app.ts) ; le jeu des verdicts en est dérivé (`jeuDeSuivi`). Renvoie les
 * verdicts signalés.
 */
export async function suivreVerdicts(db: Db, { initial = false, depart }: { initial?: boolean; depart?: Dataset } = {}): Promise<{ chantier: string; empId: number }[]> {
  await oublierVerdictsSimules(db);
  const full = await jeuDeSuivi(db, depart);
  const d = new Domain(full);
  const transmis = new Map((await db.all<VerdictTransmis>('verdictsKeystone')).map(v => [`${v.chantier}|${v.empId}`, v]));
  const suivis = new Set<number>(), signales: { chantier: string; empId: number }[] = [];
  const date = new Date().toISOString();
  for (const x of d.evaluateChantiers(d.enrich(full.settings.horizonAlerte, false), d.tripsAll())) {
    if (x.c.fin < d.ti) continue;
    for (const r of x.res) {
      const statut = GNG_CODE[r.status], motifs = r.reasons.map(m => ({ code: m.code, niveau: GNG_CODE[m.level] }));
      const avant = transmis.get(`${x.c.id}|${r.e.id}`);
      if (avant) suivis.add(avant.id);
      if (avant && empreinte(avant.statut, avant.motifs) === empreinte(statut, motifs)) continue;
      if (avant) await db.update('verdictsKeystone', avant.id, { statut, motifs, date });
      else await db.insert('verdictsKeystone', { chantier: x.c.id, empId: r.e.id, statut, motifs, date });
      if (initial) continue;
      await sendToKeystone(db, {
        type: 'verdict.modifie', chantier: x.c.id, statut: GNG_CODE[x.status],
        ressource: { matricule: identifiantKeystone(full.settings.identifiantKeystone, r.e), statut, motifs, precedent: avant?.statut ?? null },
      });
      signales.push({ chantier: x.c.id, empId: r.e.id });
    }
  }
  // Ressource retirée, chantier archivé ou terminé : plus suivi ; s'il revient, son verdict repart comme un premier verdict.
  for (const v of transmis.values()) { if (!suivis.has(v.id)) await db.remove('verdictsKeystone', v.id); }
  return signales;
}

/** Recalcul au démarrage, puis à chaque changement de date (contrôlé toutes les heures) : expirations, chantiers terminés. */
export async function suivreVerdictsChaqueJour(db: Db) {
  let jour = '';
  const relever = async () => {
    const ti = todayIso();
    if (ti === jour) return;
    try {
      await db.tx(async () => await suivreVerdicts(db));
      jour = ti;
    } catch (err) {
      console.error('Suivi des verdicts Go / No Go :', err);
    }
  };
  await relever();
  setInterval(relever, 3600_000).unref();
}
