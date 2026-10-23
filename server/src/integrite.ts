// Contrôle d'intégrité de la base (t179, étape 1) : références orphelines, c'est-à-dire des lignes qui désignent un
// salarié, une session, une formation… absents de leur table. Le schéma ne déclare encore aucune clé étrangère (elles
// viendront une fois la base de reprise du 1er janvier 2027 vérifiée propre) : une telle ligne passerait inaperçue
// jusqu'à faire échouer un calcul. Le contrôle est fait au démarrage, inscrit au journal des actions et dans les journaux
// du serveur quand il trouve quelque chose, puis refait au plus une fois par heure pour le point de santé : réponse
// publique « degrade » seulement, nombre et références dans le détail réservé au poste local ou au jeton de supervision
// (server/src/supervision.ts). Jamais de donnée personnelle : des noms de tables et de colonnes, des nombres.
import { plural } from '../../shared/format.ts';
import { journaliser } from './comptes.ts';
import type { ObjetPiece } from '../../shared/types.ts';
import { snake, TABLES, type Db, type TableName } from './db.ts';
import { controlerPieces, TABLE_OBJET } from './pieces.ts';
import { log } from './logs.ts';

/** Référence contrôlée : colonne (snake_case) d'une table qui désigne la clé d'une autre table. */
interface Reference {
  table: string; colonne: string; cible: string; cle: string;
  /** Lignes concernées seulement (référence polymorphe : la pièce justificative désigne la table de son objet). */
  si?: string;
}

const ref = (table: string, colonne: string, cible: string, cle = 'id', si?: string): Reference => ({ table, colonne, cible, cle, ...(si ? { si } : {}) });

/**
 * Références contrôlées. Salariés, sessions, référentiels, postes et lots ne sont jamais supprimés (archivés, annulés) :
 * une ligne qui en désigne un absent vient d'une reprise de données ou d'une modification faite hors de Cursus.
 */
export const REFERENCES: readonly Reference[] = [
  ...['demandes_visite', 'certifications', 'hab_titres', 'visas', 'vaccinations', 'inscriptions', 'participations', 'voyages', 'demandes_keystone',
    'missions', 'taches', 'feuilles', 'mandats', 'absences', 'cet', 'reports', 'soldes_reprise', 'clotures', 'entretiens', 'demandes_collab', 'comptes',
    'notifications', 'verdicts_keystone', 'informations_cp', 'soldes_sortie', 'pieces', 'contrats_historique',
    // Conservation des dossiers et agenda personnel (t016, t036, chantier 7 étape 2).
    'effacements', 'jetons_agenda'].map(t => ref(t, 'emp_id', 'employes')),
  // Auteur d'une ligne de l'historique des contrats (fiche du compte qui l'a enregistrée, t074).
  ref('contrats_historique', 'par_id', 'employes'),
  // Manager qui a demandé une formation ou une habilitation pour un membre de son équipe (server/src/actions/conformite.ts).
  ref('demandes_collab', 'par_id', 'employes'),
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
  // Délégation des validations (t135) : manager qui délègue et suppléant (cascade d'anonymisation comprise).
  ref('delegations', 'manager_id', 'employes'),
  ref('delegations', 'suppleant_id', 'employes'),
  ref('feuilles', 'lot_id', 'lots_paie'),
  ref('absences', 'lot_id', 'lots_paie'),
  ref('soldes_sortie', 'lot_id', 'lots_paie'),
  ref('informations_cp', 'absence_id', 'absences'),
  ref('demandes_keystone', 'voyage_id', 'voyages'),
  // Pièces justificatives (server/src/pieces.ts) : compte qui l'a envoyée, et objet auquel elle est jointe.
  ref('pieces', 'depose_compte_id', 'comptes'),
  ...(Object.entries(TABLE_OBJET) as [ObjetPiece, TableName][]).map(([o, t]) => ref('pieces', 'objet_id', snake(t), 'id', `t.objet = '${o}'`)),
  // Éléments de déplacement des lots de paie (t031) : salarié et lot.
  ref('deplacements_paie', 'emp_id', 'employes'),
  ref('deplacements_paie', 'lot_id', 'lots_paie'),
  // Avenants de renonciation d'un forfait jours (t043) : salarié et lot de paie des jours rachetés.
  ref('avenants_forfait', 'emp_id', 'employes'),
  ref('avenants_forfait', 'lot_id', 'lots_paie'),
  // Horaire de poste par défaut d'une équipe (lot 6) ; ceux des feuilles (JSON, archivés gardés) ne sont jamais supprimés.
  ref('equipes', 'horaire', 'horaires', 'code'),
  // Jours de fractionnement (t046) : salarié et report reçu qui porte le crédit.
  ref('fractionnements', 'emp_id', 'employes'),
  ref('fractionnements', 'report_id', 'reports'),
  // Délivrances d'habilitation (t115) et formations suivies (t116) : salarié, auteur de l'enregistrement (fiche du compte),
  // titre, habilitation, formation du catalogue, ligne du plan et demande qui les ont produites.
  ...['hab_delivrances', 'formations_suivies'].flatMap(t => [ref(t, 'emp_id', 'employes'), ref(t, 'auteur_id', 'employes')]),
  ref('hab_delivrances', 'titre_id', 'hab_titres'),
  ref('hab_delivrances', 'h', 'habilitations'),
  ref('formations_suivies', 'f', 'formations'),
  ref('formations_suivies', 'plan_action_id', 'plan_actions'),
  ref('formations_suivies', 'demande_id', 'demandes_collab'),
  // Astreintes (t049, lot 7) : salarié de l'astreinte ; salarié et astreinte de chaque intervention (0005_astreintes.sql).
  ref('astreintes', 'emp_id', 'employes'),
  ref('astreinte_interventions', 'emp_id', 'employes'),
  ref('astreinte_interventions', 'astreinte_id', 'astreintes'),
  // Liste d'attente des sessions complètes (lot 7, chantier C, t120 ; clés étrangères de 0007_formations.sql) : salarié,
  // session, demande qui l'y a placé, certification à renouveler ou inscription à replanifier.
  ref('attentes_session', 'emp_id', 'employes'),
  ref('attentes_session', 'session_id', 'sessions'),
  ref('attentes_session', 'demande_id', 'demandes_collab'),
  ref('attentes_session', 'cert_id', 'certifications'),
  ref('attentes_session', 'inscription_id', 'inscriptions'),
  // Évaluations des formations (lot 7, chantier C, t121 ; clés étrangères de 0010_evaluations_formation.sql) : salarié
  // évalué, auteur de la saisie (fiche du compte), participation ou formation suivie évaluée.
  ref('evaluations_formation', 'emp_id', 'employes'),
  ref('evaluations_formation', 'auteur_id', 'employes'),
  ref('evaluations_formation', 'participation_id', 'participations'),
  ref('evaluations_formation', 'formation_suivie_id', 'formations_suivies'),
];

export interface Integrite {
  /** Lignes orphelines, toutes références confondues. */
  orphelins: number;
  /** Nombre par référence (« feuilles.emp_id → employes ») ; seules celles qui en ont figurent. */
  parReference: Record<string, number>;
  /** Heure du contrôle (ISO). */
  le: string;
}

/** Valeur « aucun » d'une colonne de référence : 0 pour un identifiant, chaîne vide pour un code (types de TABLES). */
function vide(r: Reference): string {
  const def = (Object.entries(TABLES) as [string, { cols: Record<string, string> }][]).find(([n]) => snake(n) === r.table)?.[1];
  const type = def && Object.entries(def.cols).find(([c]) => snake(c) === r.colonne)?.[1];
  return type === 'int' ? '0' : "''";
}

/** Compte les références orphelines (valeur renseignée, absente de la table visée). Lecture seule. */
export async function controlerOrphelins(db: Db, references: readonly Reference[] = REFERENCES): Promise<Integrite> {
  const parReference: Record<string, number> = {};
  let orphelins = 0;
  for (const r of references) {
    // Valeur 0 : « aucun » dans quelques colonnes anciennes (identifiants SQLite à partir de 1), jamais une référence.
    const n = Number((await db.one(`SELECT COUNT(*) AS n FROM ${r.table} t WHERE t.${r.colonne} IS NOT NULL AND t.${r.colonne} <> ${vide(r)}${r.si ? ` AND ${r.si}` : ''}
      AND NOT EXISTS (SELECT 1 FROM ${r.cible} c WHERE c.${r.cle} = t.${r.colonne})`) as { n: number }).n);
    if (n) { parReference[`${r.table}.${r.colonne} → ${r.cible}`] = n; orphelins += n; }
  }
  // Fichiers des pièces justificatives absents du dossier, ou d'une autre taille que celle de l'envoi (server/src/pieces.ts).
  if (references === REFERENCES) {
    for (const [k, n] of Object.entries(await controlerPieces(db))) { parReference[k] = n; orphelins += n; }
  }
  return { orphelins, parReference, le: new Date().toISOString() };
}

/** Dernier contrôle par base : refait au plus une fois par heure (point de santé interrogé toutes les 30 s). */
const derniers = new WeakMap<Db, Integrite>();
export const VALIDITE_CONTROLE = 3600_000;

/** État d'intégrité de la base, depuis le dernier contrôle s'il a moins d'une heure. */
export async function etatIntegrite(db: Db, maintenant = Date.now()): Promise<Integrite> {
  const d = derniers.get(db);
  if (d && maintenant - Date.parse(d.le) < VALIDITE_CONTROLE) return d;
  const r = await controlerOrphelins(db);
  derniers.set(db, r);
  return r;
}

/**
 * Contrôle du démarrage (server/src/index.ts, après les migrations) : avertissement dans les journaux du serveur et ligne
 * `integrite.orphelins` au journal des actions s'il trouve des orphelins (références et nombres seulement) ; rien sinon.
 */
export async function controlerIntegrite(db: Db): Promise<Integrite> {
  const r = await controlerOrphelins(db);
  derniers.set(db, r);
  if (r.orphelins) {
    const detail = Object.entries(r.parReference).map(([k, n]) => `${k} : ${n}`).join(', ');
    const nombre = plural(r.orphelins, 'référence orpheline', 'références orphelines');
    log.avertissement(`Intégrité de la base : ${nombre} (${detail}). À examiner avant d’activer les clés étrangères (docs/DEPLOIEMENT.md, « Exploitation courante »).`,
      { orphelins: r.orphelins });
    await db.tx(async () => await journaliser(db, {
      actor: 'Cursus', role: null, action: 'integrite.orphelins',
      message: `Contrôle d’intégrité au démarrage : ${nombre}`,
      payload: { orphelins: r.orphelins, references: r.parReference },
    }));
  }
  return r;
}
