// Verdicts Go / No Go poussés à Keystone. Le dernier verdict transmis est mémorisé par chantier et
// par ressource (table verdictsKeystone) ; chaque recalcul met en file un événement `verdict.modifie`
// pour chaque verdict qui a changé : statut ou codes de motif, jamais de libellé (même en partage
// détaillé). Recalcul après les actions qui peuvent changer un verdict (server/src/index.ts), après
// chaque écriture de Keystone (keystone-routes.ts) et chaque jour, pour les expirations.
// En simulation, rien ne part : les verdicts mémorisés alors ne sont pas réputés transmis, et le
// passage en mode API (KEYSTONE_URL) les renvoie tous comme des premiers verdicts.
import { GNG_CODE } from '../../../shared/constants.ts';
import { Domain } from '../../../shared/domain.ts';
import { matricule } from '../../../shared/format.ts';
import type { CurrentUser } from '../../../shared/types.ts';
import { loadFull, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import { keystoneSortant, sendToKeystone, type CodeGng, type MotifKeystone } from './keystone.ts';

interface VerdictTransmis { id: number; chantier: string; empId: number; statut: CodeGng; motifs: MotifKeystone[]; date: string }

/** Lecture du périmètre complet, comme le service RH. */
const SUIVI: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Suivi des verdicts' };

/** Forme comparable d'un verdict : l'ordre des exigences du chantier n'est pas un changement. */
const empreinte = (statut: string, motifs: MotifKeystone[]) => `${statut}|${motifs.map(m => `${m.code}:${m.niveau}`).sort().join(',')}`;

/** Réglage : mode d'envoi (`api` ou `simulation`) dans lequel les verdicts de verdictsKeystone ont été mémorisés. */
export const MODE_VERDICTS = 'verdictsKeystoneMode';

/**
 * Verdicts mémorisés en simulation (ou par une base antérieure à ce réglage) : jamais reçus par Keystone.
 * En mode API, ils sont oubliés, et chaque ressource suivie repart avec un premier verdict (`precedent: null`).
 */
function oublierVerdictsSimules(db: Db) {
  const mode = keystoneSortant() ? 'api' : 'simulation';
  const avant = db.getSetting<string | null>(MODE_VERDICTS, null);
  if (mode === avant) return;
  if (mode === 'api') db.sql.exec('DELETE FROM verdicts_keystone'); // réglage absent : base antérieure, verdicts jamais envoyés
  db.setSetting(MODE_VERDICTS, mode);
}

/**
 * Compare le verdict de chaque ressource des chantiers actifs, en cours ou à venir, au dernier verdict
 * transmis, et met en file un événement pour chacun qui a changé, premier verdict compris. `initial` :
 * mémorise sans rien envoyer (jeu de démonstration). Renvoie les verdicts signalés.
 */
export function suivreVerdicts(db: Db, { initial = false } = {}): { chantier: string; empId: number }[] {
  oublierVerdictsSimules(db);
  const full = loadFull(db, SUIVI);
  const d = new Domain(full);
  const transmis = new Map(db.all<VerdictTransmis>('verdictsKeystone').map(v => [`${v.chantier}|${v.empId}`, v]));
  const suivis = new Set<number>(), signales: { chantier: string; empId: number }[] = [];
  const date = new Date().toISOString();
  for (const x of d.evaluateChantiers(d.enrich(full.settings.horizonAlerte, false), d.tripsAll())) {
    if (x.c.fin < d.ti) continue;
    for (const r of x.res) {
      const statut = GNG_CODE[r.status], motifs = r.reasons.map(m => ({ code: m.code, niveau: GNG_CODE[m.level] }));
      const avant = transmis.get(`${x.c.id}|${r.e.id}`);
      if (avant) suivis.add(avant.id);
      if (avant && empreinte(avant.statut, avant.motifs) === empreinte(statut, motifs)) continue;
      if (avant) db.update('verdictsKeystone', avant.id, { statut, motifs, date });
      else db.insert('verdictsKeystone', { chantier: x.c.id, empId: r.e.id, statut, motifs, date });
      if (initial) continue;
      sendToKeystone(db, {
        type: 'verdict.modifie', chantier: x.c.id, statut: GNG_CODE[x.status],
        ressource: { matricule: matricule(r.e.id), statut, motifs, precedent: avant?.statut ?? null },
      });
      signales.push({ chantier: x.c.id, empId: r.e.id });
    }
  }
  // Ressource retirée, chantier archivé ou terminé : plus suivi ; s'il revient, son verdict repart comme un premier verdict.
  transmis.forEach(v => { if (!suivis.has(v.id)) db.remove('verdictsKeystone', v.id); });
  return signales;
}

/** Recalcul au démarrage, puis à chaque changement de date (contrôlé toutes les heures) : expirations, chantiers terminés. */
export function suivreVerdictsChaqueJour(db: Db) {
  let jour = '';
  const relever = () => {
    const ti = todayIso();
    if (ti === jour) return;
    try {
      db.tx(() => suivreVerdicts(db));
      jour = ti;
    } catch (err) {
      console.error('Suivi des verdicts Go / No Go :', err);
    }
  };
  relever();
  setInterval(relever, 3600_000).unref();
}
