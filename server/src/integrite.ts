// Contrôle d'intégrité de la base (t179, étape 1) : références orphelines, c'est-à-dire des lignes qui désignent un
// salarié, une session, une formation… absents de leur table. Le schéma ne déclare encore aucune clé étrangère (elles
// viendront une fois la base de reprise du 1er janvier 2027 vérifiée propre) : une telle ligne passerait inaperçue
// jusqu'à faire échouer un calcul. Le contrôle est fait au démarrage, inscrit au journal des actions et dans les journaux
// du serveur quand il trouve quelque chose, puis refait au plus une fois par heure pour le point de santé : réponse
// publique « degrade » seulement, nombre et références dans le détail réservé au poste local ou au jeton de supervision
// (server/src/supervision.ts). Jamais de donnée personnelle : des noms de tables et de colonnes, des nombres.
import { plural } from '../../shared/format.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import { log } from './logs.ts';

/** Référence contrôlée : colonne (snake_case) d'une table qui désigne la clé d'une autre table. */
interface Reference { table: string; colonne: string; cible: string; cle: string }

const ref = (table: string, colonne: string, cible: string, cle = 'id'): Reference => ({ table, colonne, cible, cle });

/**
 * Références contrôlées. Salariés, sessions, référentiels, postes et lots ne sont jamais supprimés (archivés, annulés) :
 * une ligne qui en désigne un absent vient d'une reprise de données ou d'une modification faite hors de Cursus.
 */
export const REFERENCES: readonly Reference[] = [
  ...['demandes_visite', 'certifications', 'hab_titres', 'visas', 'vaccinations', 'inscriptions', 'participations', 'voyages', 'demandes_keystone',
    'missions', 'taches', 'feuilles', 'mandats', 'absences', 'cet', 'reports', 'soldes_reprise', 'clotures', 'entretiens', 'demandes_collab', 'comptes',
    'notifications', 'verdicts_keystone', 'informations_cp', 'soldes_sortie'].map(t => ref(t, 'emp_id', 'employes')),
  ...['certifications', 'inscriptions', 'participations', 'demandes_collab'].map(t => ref(t, 'session_id', 'sessions')),
  ref('participations', 'cert_id', 'certifications'),
  ref('certifications', 'f', 'formations'),
  ref('sessions', 'formation', 'formations'),
  ref('hab_titres', 'h', 'habilitations'),
  ref('visas', 'dest', 'destinations', 'code'),
  ref('employes', 'poste_id', 'postes'),
  ref('employes', 'equipe', 'equipes', 'nom'),
  ref('equipes', 'manager_id', 'employes'),
  ref('equipes', 'parente', 'equipes', 'nom'),
  ref('feuilles', 'lot_id', 'lots_paie'),
  ref('absences', 'lot_id', 'lots_paie'),
  ref('soldes_sortie', 'lot_id', 'lots_paie'),
  ref('informations_cp', 'absence_id', 'absences'),
  ref('demandes_keystone', 'voyage_id', 'voyages'),
];

export interface Integrite {
  /** Lignes orphelines, toutes références confondues. */
  orphelins: number;
  /** Nombre par référence (« feuilles.emp_id → employes ») ; seules celles qui en ont figurent. */
  parReference: Record<string, number>;
  /** Heure du contrôle (ISO). */
  le: string;
}

/** Compte les références orphelines (valeur renseignée, absente de la table visée). Lecture seule. */
export function controlerOrphelins(db: Db, references: readonly Reference[] = REFERENCES): Integrite {
  const parReference: Record<string, number> = {};
  let orphelins = 0;
  for (const r of references) {
    // Valeur 0 : « aucun » dans quelques colonnes anciennes (identifiants SQLite à partir de 1), jamais une référence.
    const n = Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM ${r.table} t WHERE t.${r.colonne} IS NOT NULL AND t.${r.colonne} <> 0 AND t.${r.colonne} <> ''
      AND NOT EXISTS (SELECT 1 FROM ${r.cible} c WHERE c.${r.cle} = t.${r.colonne})`).get() as { n: number }).n);
    if (n) { parReference[`${r.table}.${r.colonne} → ${r.cible}`] = n; orphelins += n; }
  }
  return { orphelins, parReference, le: new Date().toISOString() };
}

/** Dernier contrôle par base : refait au plus une fois par heure (point de santé interrogé toutes les 30 s). */
const derniers = new WeakMap<Db, Integrite>();
export const VALIDITE_CONTROLE = 3600_000;

/** État d'intégrité de la base, depuis le dernier contrôle s'il a moins d'une heure. */
export function etatIntegrite(db: Db, maintenant = Date.now()): Integrite {
  const d = derniers.get(db);
  if (d && maintenant - Date.parse(d.le) < VALIDITE_CONTROLE) return d;
  const r = controlerOrphelins(db);
  derniers.set(db, r);
  return r;
}

/**
 * Contrôle du démarrage (server/src/index.ts, après les migrations) : avertissement dans les journaux du serveur et ligne
 * `integrite.orphelins` au journal des actions s'il trouve des orphelins (références et nombres seulement) ; rien sinon.
 */
export function controlerIntegrite(db: Db): Integrite {
  const r = controlerOrphelins(db);
  derniers.set(db, r);
  if (r.orphelins) {
    const detail = Object.entries(r.parReference).map(([k, n]) => `${k} : ${n}`).join(', ');
    const nombre = plural(r.orphelins, 'référence orpheline', 'références orphelines');
    log.avertissement(`Intégrité de la base : ${nombre} (${detail}). À examiner avant d’activer les clés étrangères (docs/DEPLOIEMENT.md, « Exploitation courante »).`,
      { orphelins: r.orphelins });
    db.tx(() => journaliser(db, {
      actor: 'Cursus', role: null, action: 'integrite.orphelins',
      message: `Contrôle d’intégrité au démarrage : ${nombre}`,
      payload: { orphelins: r.orphelins, references: r.parReference },
    }));
  }
  return r;
}
