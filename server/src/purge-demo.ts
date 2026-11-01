// Passage de la démonstration à la production (lot 8, chantier A) : règles de npm run purge-demo
// (server/src/purge-demo-cli.ts), qui vide une base de démonstration de ses données fictives en ne gardant que le
// paramétrage choisi. Contrôles et aperçu sans effet, testés sans lancer la commande (tests/purge-demo.test.ts), comme
// server/src/reinitialisation.ts pour npm run reset-demo. Lectures par l'API Db commune : SQLite comme PostgreSQL.
// - Options de la ligne de commande (`lireOptionsPurge`) : une option inconnue est refusée.
// - Constat de la base (`releverBase`) : marqueurs `demo` et `exploitation` (server/src/marqueurs.ts), purge déjà faite,
//   reprise sur le serveur PostgreSQL, comptes Microsoft réels, indices d'une démonstration chargée avant le marqueur,
//   ajouts des visiteurs (fiches hors du jeu, reprises, lots de paie, fichiers Sage, comptes créés).
// - Décision (`deciderPurge`) : déjà faite, refusée sans appel (base exploitée, sans preuve de démonstration…), ou
//   possible, avec les points à lever avant d'exécuter (fiches ajoutées sans --inclure-ajouts, compte gardé inconnu).
// - Plan par profil (`planPurge`) : sort de chaque table de TABLES et des réglages ; séquence des salariés
//   (`prochainIdEmploye`, EMP-1001 au plus tôt), jamais remise à zéro, pour qu'aucun vrai salarié ne reprenne un matricule EMP-00xx déjà lu
//   par Keystone, Vigie, Codex ou Matrix.
// - Aperçu à blanc (`apercuPurge`, `texteApercu`) : ce qui part et ce qui reste, sans rien écrire.
// L'exécution (service arrêté, sauvegarde préalable, transaction, pièces, copies) : server/src/purge-demo-execution.ts.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { matricule, plural } from '../../shared/format.ts';
import type { Env } from './config.ts';
import { jsonLu, snake, TABLES, type Db, type TableName } from './db.ts';
import { CLE_DEPUIS, CLE_JUSQUA } from './absences-paie.ts';
import { CLE_DEPUIS_DEPLACEMENTS } from './deplacements-paie.ts';
import { REFERENCES } from './integrite.ts';
import { MODE_VERDICTS } from './integrations/keystone-verdicts.ts';
import { ACTION_PURGE_DEMO, type MarqueurDemo, type MarqueurExploitation, REGLAGE_DEMO, REGLAGE_EXPLOITATION } from './marqueurs.ts';
import { dossierPiecesDe, NOM_LOCAL } from './pieces.ts';
import { dossierMiroir } from './pieces-sauvegarde.ts';
import { ACTION_REPRISE } from './reprise-postgres.ts';
import { dossierSauvegardes, listerSauvegardes } from './sauvegarde.ts';
import { CREE_PAR_DEMO, DOMAINE_DEMO, HABILITATIONS, LOT_DEMO, SALARIES_DEMO } from './seed.ts';

export class PurgeRefusee extends Error {}

export const USAGE_PURGE = 'Usage : npm run purge-demo -- [--a-blanc] [--garder parametrage|catalogue|rien] [--garder-compte <identifiant>]… '
  + '[--inclure-ajouts] [--yes] [--force] [--sauvegarde <pg_dump>] [--supprimer-copies-demo]';

// — Options —

/** Profil de ce qui est gardé : tout le paramétrage (défaut, réponse de l'entreprise du 24 octobre 2026), le seul catalogue, rien. */
export type ProfilPurge = 'parametrage' | 'catalogue' | 'rien';
export const PROFILS_PURGE: readonly ProfilPurge[] = ['parametrage', 'catalogue', 'rien'];

export interface OptionsPurge {
  /** --a-blanc : aperçu seulement, rien n'est écrit. */
  aBlanc: boolean;
  /** --garder <profil> : `parametrage` par défaut. */
  garder: ProfilPurge;
  /** --garder-compte <identifiant ou numéro>, répétable : comptes gardés, rendus externes (sans fiche, oid, mot de passe ni session). */
  comptes: string[];
  /** --inclure-ajouts : fiches ajoutées par les visiteurs purgées avec les fictives (après relecture de l'aperçu). */
  inclureAjouts: boolean;
  /** --yes : purge confirmée d'avance (sinon, dans un terminal, le mot « PRODUCTION <nombre> »). */
  oui: boolean;
  /** --force : lève seulement le contrôle du serveur en service sur le fichier SQLite, jamais les autres. */
  force: boolean;
  /** --sauvegarde <fichier> : pg_dump vérifié, exigé sur le serveur PostgreSQL. */
  sauvegarde: string | null;
  /** --supprimer-copies-demo : copies locales antérieures et miroir des pièces supprimés après la purge (sauf avant-purge). */
  supprimerCopies: boolean;
}

const DRAPEAUX = { '--a-blanc': 'aBlanc', '--inclure-ajouts': 'inclureAjouts', '--yes': 'oui', '--force': 'force', '--supprimer-copies-demo': 'supprimerCopies' } as const;

/** Options de la ligne de commande ; une option inconnue, ou une valeur manquante, est refusée (une faute de frappe ne purge rien). */
export function lireOptionsPurge(args: readonly string[]): OptionsPurge {
  const o: OptionsPurge = { aBlanc: false, garder: 'parametrage', comptes: [], inclureAjouts: false, oui: false, force: false, sauvegarde: null, supprimerCopies: false };
  const valeur = (i: number, option: string) => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new PurgeRefusee(`${option} attend une valeur. ${USAGE_PURGE}`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a in DRAPEAUX) o[DRAPEAUX[a as keyof typeof DRAPEAUX]] = true;
    else if (a === '--garder') {
      const v = valeur(i++, a);
      if (!PROFILS_PURGE.includes(v as ProfilPurge)) throw new PurgeRefusee(`profil inconnu « ${v} » : parametrage, catalogue ou rien. ${USAGE_PURGE}`);
      o.garder = v as ProfilPurge;
    } else if (a === '--garder-compte') o.comptes.push(valeur(i++, a));
    else if (a === '--sauvegarde') o.sauvegarde = valeur(i++, a);
    else throw new PurgeRefusee(`option inconnue ${a}. ${USAGE_PURGE}`);
  }
  return o;
}

/**
 * Contrôle de l'environnement de la commande, avant toute ouverture de la base : refus avec CURSUS_DEMO_PUBLIQUE posée
 * (la commande est lancée depuis l'instance de démonstration publiée, qui tourne encore ou va redémarrer sur la base).
 * CURSUS_DEMO est sans effet : la commande est la passerelle de sortie de la démonstration.
 */
export function controlerEnvironnementPurge(env: Env) {
  if (env.CURSUS_DEMO_PUBLIQUE?.trim()) {
    throw new PurgeRefusee('CURSUS_DEMO_PUBLIQUE est posée : arrêtez l’instance de démonstration publiée et retirez la variable avant de purger (docs/DEPLOIEMENT.md).');
  }
}

/** Mot à taper pour confirmer dans un terminal, faute de --yes : le nombre de salariés supprimés, lu dans l'aperçu. */
export const motConfirmationPurge = (salaries: number) => `PRODUCTION ${salaries}`;
/** Réponse tapée : seul le mot exact confirme (espaces autour admis). */
export const confirmationPurgeTapee = (reponse: string | null | undefined, salaries: number) => (reponse ?? '').trim() === motConfirmationPurge(salaries);

// — Constat de la base —

/** Ajouts d'une catégorie : nombre, première et dernière date connues (null : date inconnue). */
export interface Ajout { nombre: number; premier: string | null; dernier: string | null }

export interface AjoutsVisiteurs {
  /** Fiches hors du jeu (identifiant absent des 24 salariés de démonstration), avec leurs identifiants. */
  fiches: Ajout & { ids: number[] };
  /** Lots importés depuis l'écran Mise en service (`reprise.importer`). */
  reprises: Ajout;
  /** Lots de paie autres que le lot historique « Démonstration ». */
  lots: Ajout;
  /** Lots dont le fichier d'import Sage a été téléchargé. */
  fichiersSage: Ajout;
  /** Comptes de connexion créés après le chargement (auteur autre que le jeu de démonstration). */
  comptes: Ajout;
}

export interface IndicesDemo {
  /** Salariés du jeu présents avec leur identifiant et leur nom (sur 24). */
  salariesDuJeu: number;
  /** Comptes créés par le jeu de démonstration. */
  comptesDuJeu: number;
  /** Adresses du domaine de démonstration (comptes, fiches). */
  domaineDemo: boolean;
  /** Lot de paie historique « Démonstration ». */
  lotDemo: boolean;
}

export interface ConstatBase {
  moteur: Db['moteur'];
  demo: MarqueurDemo | null;
  exploitation: MarqueurExploitation | null;
  /** Purge déjà faite (ligne `purge.demo` du journal). */
  purge: { le: string; message: string | null } | null;
  /** Reprise de la base SQLite sur le serveur PostgreSQL (ligne `migration.postgres`). */
  migrationPostgres: string | null;
  /** Comptes dont l'identifiant Microsoft (oid) est renseigné hors du domaine de démonstration. */
  comptesMicrosoftReels: number;
  indices: IndicesDemo;
  ajouts: AjoutsVisiteurs;
}

/** Salariés du jeu à retrouver, au moins (sur 24), pour reconnaître une démonstration chargée avant le marqueur : des fiches renommées ou anonymisées par un visiteur sont admises. */
export const SEUIL_SALARIES_JEU = 20;

const ajout = (dates: readonly (string | null | undefined)[]): Ajout => {
  const d = dates.filter((x): x is string => !!x).sort();
  return { nombre: dates.length, premier: d[0] ?? null, dernier: d.at(-1) ?? null };
};
const finDomaine = `%@${DOMAINE_DEMO}`;

/** Relevé de la base, en lecture seule : marqueurs, refus possibles, indices de démonstration, ajouts des visiteurs. */
export async function releverBase(db: Db): Promise<ConstatBase> {
  return await db.lecture(async () => {
    const purge = await db.one<{ at: string; message: string | null }>('SELECT at, message FROM journal WHERE action = ? ORDER BY id LIMIT 1', [ACTION_PURGE_DEMO]);
    const migration = await db.one<{ at: string }>('SELECT at FROM journal WHERE action = ? ORDER BY id LIMIT 1', [ACTION_REPRISE]);
    const comptesReels = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM comptes WHERE oid IS NOT NULL AND oid <> '' AND identifiant NOT ${db.like} ?`, [finDomaine]);
    const employes = await db.query<{ id: number; nom: string | null; entree: string | null }>('SELECT id, nom, entree FROM employes ORDER BY id');
    const jeu = new Map(SALARIES_DEMO.map(s => [s.id, s.nom]));
    const comptes = await db.query<{ cree_par: string | null; creation: string | null }>('SELECT cree_par, creation FROM comptes');
    const domaine = await db.one<{ n: number }>(`SELECT (SELECT COUNT(*) FROM comptes WHERE identifiant ${db.like} ?) + (SELECT COUNT(*) FROM employes WHERE email ${db.like} ?) AS n`, [finDomaine, finDomaine]);
    const lots = await db.query<{ auteur: string | null; historique: unknown; creation: string | null; telecharge_le: string | null }>('SELECT auteur, historique, creation, telecharge_le FROM lots_paie');
    const estLotDemo = (l: (typeof lots)[number]) => l.auteur === LOT_DEMO && !!l.historique;
    // Date d'arrivée d'une fiche ajoutée : sa création ou son import tracés au journal, à défaut inconnue.
    const ajoutees = employes.filter(e => !jeu.has(e.id));
    const creees = new Map<number, string>();
    if (ajoutees.length) {
      const traces = await db.query<{ at: string; salaries: unknown }>(`SELECT at, salaries FROM journal WHERE action = 'employe.creer' OR action ${db.like} 'reprise.%' ORDER BY id`);
      for (const t of traces) {
        const ids = jsonLu(t.salaries);
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'number' && !creees.has(id)) creees.set(id, t.at);
      }
    }
    const reprises = await db.query<{ le: string | null }>('SELECT le FROM reprises');
    return {
      moteur: db.moteur,
      demo: await db.getSetting<MarqueurDemo | null>(REGLAGE_DEMO, null),
      exploitation: await db.getSetting<MarqueurExploitation | null>(REGLAGE_EXPLOITATION, null),
      purge: purge ? { le: purge.at, message: purge.message } : null,
      migrationPostgres: migration?.at ?? null,
      comptesMicrosoftReels: Number(comptesReels!.n),
      indices: {
        salariesDuJeu: employes.filter(e => jeu.get(e.id) === e.nom).length,
        comptesDuJeu: comptes.filter(c => c.cree_par === CREE_PAR_DEMO).length,
        domaineDemo: Number(domaine!.n) > 0,
        lotDemo: lots.some(estLotDemo),
      },
      ajouts: {
        fiches: { ...ajout(ajoutees.map(e => creees.get(e.id) ?? null)), ids: ajoutees.map(e => e.id) },
        reprises: ajout(reprises.map(r => r.le)),
        lots: ajout(lots.filter(l => !estLotDemo(l)).map(l => l.creation)),
        fichiersSage: ajout(lots.filter(l => l.telecharge_le).map(l => l.telecharge_le)),
        comptes: ajout(comptes.filter(c => c.cree_par !== CREE_PAR_DEMO).map(c => c.creation)),
      },
    };
  });
}

/** Preuve que la base est une démonstration : le marqueur, sinon le faisceau d'indices complet, sinon aucune. */
export function preuveDemo(c: Pick<ConstatBase, 'demo' | 'indices'>): 'marqueur' | 'faisceau' | null {
  if (c.demo) return 'marqueur';
  const i = c.indices;
  return i.salariesDuJeu >= SEUIL_SALARIES_JEU && i.comptesDuJeu > 0 && i.domaineDemo && i.lotDemo ? 'faisceau' : null;
}

export type DecisionPurge =
  | { statut: 'deja-faite'; le: string; message: string | null }
  | { statut: 'refusee'; motifs: string[] }
  | { statut: 'possible'; preuve: 'marqueur' | 'faisceau'; aLever: string[] };

/**
 * Décision sur le constat : purge déjà faite (la commande est idempotente) ; refus sans appel, que --force ne lève
 * jamais (base exploitée en production, reprise sur le serveur commun, compte Microsoft réel, aucune preuve de
 * démonstration) ; sinon possible, avec les points à lever avant d'exécuter (l'aperçu à blanc les montre sans refuser).
 */
export function deciderPurge(c: ConstatBase, options: Pick<OptionsPurge, 'inclureAjouts'>): DecisionPurge {
  if (c.purge) return { statut: 'deja-faite', le: c.purge.le, message: c.purge.message };
  const motifs: string[] = [];
  if (c.exploitation) {
    motifs.push(`la base a servi en production (premier démarrage hors démonstration le ${c.exploitation.premierDemarrageHorsDemo}, version ${c.exploitation.version}) : elle ne se purge jamais.`);
  }
  if (c.migrationPostgres) motifs.push(`la base a été reprise sur le serveur PostgreSQL commun le ${c.migrationPostgres} (ligne migration.postgres du journal) : purgez la base SQLite d’origine avant la reprise.`);
  if (c.comptesMicrosoftReels) {
    motifs.push(`${plural(c.comptesMicrosoftReels, 'compte Microsoft s’est connecté', 'comptes Microsoft se sont connectés')} avec une adresse hors de ${DOMAINE_DEMO} : la base porte de vraies connexions.`);
  }
  const preuve = preuveDemo(c);
  if (!preuve) {
    const i = c.indices;
    motifs.push(`rien ne prouve que la base est une démonstration : ni réglage « ${REGLAGE_DEMO} », ni faisceau d’indices complet (salariés du jeu ${i.salariesDuJeu}/${SALARIES_DEMO.length}, `
      + `au moins ${SEUIL_SALARIES_JEU} attendus ; comptes du jeu ${i.comptesDuJeu} ; domaine ${DOMAINE_DEMO} ${i.domaineDemo ? 'présent' : 'absent'} ; lot « ${LOT_DEMO} » ${i.lotDemo ? 'présent' : 'absent'}).`);
  }
  if (motifs.length || !preuve) return { statut: 'refusee', motifs };
  const aLever: string[] = [];
  const f = c.ajouts.fiches;
  if (f.nombre && !options.inclureAjouts) {
    aLever.push(`${plural(f.nombre, 'fiche ajoutée', 'fiches ajoutées')} par des visiteurs (identifiants ${f.ids.join(', ')}) : relisez l’aperçu, puis relancez avec --inclure-ajouts pour les purger aussi.`);
  }
  return { statut: 'possible', preuve, aLever };
}

// — Plan par profil —

/** Sort d'une table : vidée, gardée telle quelle, ou gardée avec des colonnes remises à NULL (`nulles`). */
export interface RegleTable {
  sort: 'supprimer' | 'garder' | 'ajuster';
  /** Colonnes (camelCase de TABLES) remises à NULL sur les lignes gardées. */
  nulles?: string[];
  /** Lignes d'amorçage reposées ensuite par mettreAJourBase (activités internes, horaires d'exemple). */
  amorcee?: boolean;
  /** Raison affichée dans l'aperçu. */
  pourquoi: string;
}

export interface PlanPurge {
  profil: ProfilPurge;
  tables: Record<TableName, RegleTable>;
  /** Réglages supprimés (remis à leur valeur par défaut) ; `'*'` : tous. */
  reglagesSupprimes: readonly string[] | '*';
}

/**
 * Données de personnes et de fonctionnement : vidées quel que soit le profil. Les comptes gardés (--garder-compte) et la
 * ligne `purge.demo` du journal sont traités à part (`planPurge`).
 */
const TOUJOURS: Partial<Record<TableName, string>> = {
  ...Object.fromEntries(['employes', 'contratsHistorique', 'demandesVisite', 'certifications', 'habTitres', 'habDelivrances', 'formationsSuivies', 'visas', 'vaccinations']
    .map(t => [t, 'salariés et dossier individuel'])),
  ...Object.fromEntries(['sessions', 'inscriptions', 'participations', 'attentesSession', 'evaluationsFormation', 'declarationsPasseport'].map(t => [t, 'formations organisées'])),
  ...Object.fromEntries(['voyages', 'demandesKeystone', 'missions', 'taches', 'verdictsKeystone'].map(t => [t, 'déplacements, missions et verdicts transmis à Keystone'])),
  ...Object.fromEntries(['feuilles', 'mandats', 'delegations', 'avenantsForfait', 'astreintes', 'astreinteInterventions'].map(t => [t, 'temps et astreintes'])),
  ...Object.fromEntries(['lotsPaie', 'deplacementsPaie', 'soldesSortie', 'absences', 'cet', 'reports', 'soldesReprise', 'reprises', 'clotures', 'fractionnements', 'informationsCp']
    .map(t => [t, 'paie et compteurs'])),
  ...Object.fromEntries(['entretiens', 'demandesCollab', 'effacements', 'jetonsAgenda'].map(t => [t, 'entretiens, demandes et agenda'])),
  ...Object.fromEntries(['envois', 'notifications', 'releves', 'relances', 'pieces'].map(t => [t, 'envois, notifications et pièces'])),
  // lot 11 — pwa : réponses gardées des actions rejouées, appareils abonnés et notifications en file, liés aux comptes
  // (supprimés ci-dessous) : en SQLite, sans clé étrangère, ils resteraient orphelins et l'intégrité refuserait la purge.
  ...Object.fromEntries(['idempotence', 'abonnementsPush', 'envoisPush'].map(t => [t, 'actions rejouées et notifications sur le téléphone'])),
  // lot 11 — dossiers OPCO : rattachés au plan de formation fictif (et, plus tard, à des salariés).
  ...Object.fromEntries(['dossiersOpco', 'versementsOpco'].map(t => [t, 'dossiers OPCO du plan de formation fictif'])),
  // lot 11 — notes de frais : notes, dépenses, véhicules, avances, exports et sceaux fictifs ; barème, forfaits et taux de
  // démonstration (montants cités de mémoire, à ressaisir par le service RH et la comptabilité).
  ...Object.fromEntries(['notesFrais', 'lignesFrais', 'vehiculesPerso', 'avancesFrais', 'exportsFrais', 'sceauxPieces', 'baremesKm', 'forfaitsFrais', 'tauxDevises']
    .map(t => [t, 'notes de frais et valeurs de démonstration'])),
  // lot 12 — C1 (forfait annuel en heures) : clôtures fictives (éléments de paie).
  cloturesForfaitHeures: 'paie et compteurs',
  // lot 12 — C3 (entretiens suivis et 360°) : objectifs et feedback 360° des entretiens fictifs.
  ...Object.fromEntries(['objectifs', 'feedbackSollicitations', 'feedbackTampon', 'feedbackReponses'].map(t => [t, 'entretiens, demandes et agenda'])),
  // lot 12 — C4 : inscriptions des salariés fictifs aux modules d'e-learning ; contacts (personnes fictives) et tarifs de
  // démonstration ; modules de démonstration (liens fictifs en « .example »). Les fiches des organismes, reprises du
  // catalogue gardé, restent sans leurs valeurs fictives et « à vérifier » (`ORGANISMES_FICTIFS`).
  ...Object.fromEntries(['inscriptionsElearning', 'organismeContacts', 'organismeTarifs', 'modulesElearning']
    .map(t => [t, 'inscriptions e-learning, contacts, tarifs et modules de démonstration'])),
  connexions: 'sessions de connexion',
  comptes: 'comptes de connexion',
  journal: 'journal des actions fictives (remplacé par la seule ligne purge.demo)',
};

/**
 * Réglages supprimés par le profil parametrage : clé de session, état de la paie, expurgation du journal, messagerie
 * fictive, marqueur de démonstration ; et l'état des traitements qui ont tourné sur les données fictives : mode des
 * verdicts Go / No Go mémorisés (ils partent avec verdicts_keystone), dossiers déjà signalés à la fin de leur durée de
 * conservation (identifiants fictifs), jours des derniers passages quotidiens (conservation, relances, récapitulatif,
 * évaluations à froid), qui repartent au démarrage suivant sur la base vide, et dates de départ des absences et des
 * déplacements dans le fichier de paie, avec le plus grand identifiant d'absence fictif (server/src/absences-paie.ts,
 * server/src/deplacements-paie.ts) : sans elles, le premier vrai lot pose sa propre date de départ (departAuPremierLot)
 * et n'envoie pas en rappel les absences et déplacements repris des mois que Lucca et Sage ont payés. Les marqueurs des
 * reprises faites une seule fois (repriseDetachement, adressesComptesReprises) sont gardés : elles ne doivent pas
 * repasser sur les vraies données. Les autres réglages gardés sont du paramétrage : app, calendrierFeries,
 * confidentialite, derogationsDominicales, formatFichierPaie (et exploitation, qui fait refuser la purge).
 */
export const REGLAGES_SUPPRIMES_PARAMETRAGE: readonly string[] = [
  'secret', 'lastSagePush', 'journalExpurge', 'messagerie', REGLAGE_DEMO, MODE_VERDICTS,
  'conservationSignales', 'conservationVerifieeLe', 'relancesEcheancesLe', 'recapitulatifLe', 'evaluationsDemandeesLe',
  CLE_DEPUIS, CLE_JUSQUA, CLE_DEPUIS_DEPLACEMENTS,
];

/**
 * lot 12 — C4 : valeurs fictives des fiches d'organismes gardées (SIRET et déclarations d'activité inventés, Qualiopi et ses
 * dates, adresse et site en « .example », conditions), remises à NULL ; la purge remet aussi chaque fiche « à vérifier »,
 * sans Qualiopi ni subrogation (server/src/purge-demo-execution.ts) : le service RH les complète avant le premier dossier
 * OPCO, qui préremplit SIRET, déclaration d'activité et Qualiopi depuis la fiche.
 */
export const ORGANISMES_FICTIFS: readonly string[] = [
  'raisonSociale', 'siret', 'nda', 'ndaRegion', 'qualiopiCertificateur', 'qualiopiNumero', 'qualiopiValideJusquau', 'qualiopiVerifieLe', 'adresse', 'siteWeb',
  'delaiAnnulationJours', 'conditions', 'fusionneMotif',
];

/** Sort de chaque table et des réglages selon le profil ; `comptesGardes` : des comptes restent (rendus externes). */
export function planPurge(profil: ProfilPurge, comptesGardes = false): PlanPurge {
  const tables = {} as Record<TableName, RegleTable>;
  const garder = (pourquoi: string): RegleTable => ({ sort: 'garder', pourquoi });
  const supprimer = (pourquoi: string, amorcee = false): RegleTable => ({ sort: 'supprimer', pourquoi, ...(amorcee ? { amorcee } : {}) });
  for (const t of Object.keys(TABLES) as TableName[]) {
    if (TOUJOURS[t]) { tables[t] = supprimer(TOUJOURS[t]); continue; }
    if (profil === 'rien') { tables[t] = supprimer('profil rien : base neuve', t === 'projets' || t === 'horaires'); continue; }
    tables[t] = garder('paramétrage');
  }
  if (comptesGardes) tables.comptes = { sort: 'ajuster', nulles: ['empId', 'oid', 'motDePasse', 'blocageFin', 'derniereConnexion'], pourquoi: 'comptes gardés (--garder-compte), rendus externes' };
  if (profil !== 'rien') {
    // Projets et chantiers viennent du Keystone simulé ; budgets, plan de formation et exercices clos sont fictifs.
    tables.projets = supprimer('projets du Keystone simulé (activités internes reposées)', true);
    tables.chantiers = supprimer('chantiers du Keystone simulé');
    for (const t of ['budgets', 'planActions', 'exercicesClos'] as const) tables[t] = supprimer('budgets et plan de formation fictifs');
    tables.equipes = { sort: 'ajuster', nulles: ['managerId'], pourquoi: 'responsable fictif retiré' };
    // Confirmation et dernière modification : faites pendant la démonstration, sous le nom d'un utilisateur fictif.
    tables.rubriquesPaie = { sort: 'ajuster', nulles: ['confirmeLe', 'confirmePar', 'modifieLe', 'modifiePar'], pourquoi: 'confirmation et auteur effacés, à revalider par la paie' };
    tables.settings = { sort: 'ajuster', pourquoi: 'réglages fictifs ou techniques retirés' };
    tables.organismes = { sort: 'ajuster', nulles: [...ORGANISMES_FICTIFS], pourquoi: 'SIRET, Qualiopi et coordonnées fictifs effacés, fiches à vérifier' };
  }
  if (profil === 'catalogue') {
    tables.postes = supprimer('postes déduits des intitulés fictifs');
    tables.horaires = supprimer('horaires remis à défaut', true);
    tables.equipes = { sort: 'ajuster', nulles: ['managerId', 'horaire'], pourquoi: 'responsable fictif retiré, horaire remis à défaut' };
    tables.settings = supprimer('réglages remis à défaut');
  }
  return { profil, tables, reglagesSupprimes: profil === 'parametrage' ? REGLAGES_SUPPRIMES_PARAMETRAGE : '*' };
}

// — Séquence des salariés —

/** Premier identifiant d'un vrai salarié : EMP-1001 au plus tôt. */
export const PREMIER_ID_PRODUCTION = 1001;
/** Dernier identifiant au format du matricule partagé sur 4 chiffres (EMP-9999, 0001_init.sql). */
export const DERNIER_ID_4_CHIFFRES = 9999;

/**
 * Identifiant du prochain salarié créé après la purge : max(1001, plus grand identifiant déjà attribué + 1), compteur de
 * la séquence compris (décision du propriétaire pour l'étape 2 : les vrais salariés commencent à EMP-1001). Sur la
 * démonstration standard (24 salariés), le premier vrai salarié est EMP-1001 ; des fiches créées par des visiteurs
 * au-delà de 1000 sont suivies. Jamais de remise à zéro : aucun vrai salarié ne reçoit un matricule déjà vu par les
 * autres outils.
 */
export const prochainIdEmploye = (plusGrand: number): number => Math.max(PREMIER_ID_PRODUCTION, Math.max(0, plusGrand) + 1);

/** Plus grand identifiant de salarié déjà attribué : lignes présentes et compteur de la séquence (ids de fiches supprimées compris). */
export async function plusGrandIdEmploye(db: Db): Promise<number> {
  const max = Number((await db.one<{ n: number | null }>('SELECT MAX(id) AS n FROM employes'))?.n ?? 0);
  const seq = db.moteur === 'pg'
    ? (await db.one<{ n: string | number | null }>(`SELECT pg_sequence_last_value(pg_get_serial_sequence('employes', 'id')::regclass) AS n`))?.n
    : (await db.one<{ n: number | null }>(`SELECT seq AS n FROM sqlite_sequence WHERE name = 'employes'`))?.n;
  return Math.max(max, Number(seq ?? 0));
}

// — Aperçu à blanc —

export interface LigneApercu { table: TableName; sort: RegleTable['sort']; pourquoi: string; lignes: number; partent: number; restent: number; amorcee: boolean }

export interface ApercuPurge {
  profil: ProfilPurge;
  moteur: Db['moteur'];
  decision: DecisionPurge;
  tables: LigneApercu[];
  /** Salariés supprimés (mot de confirmation « PRODUCTION <nombre> »). */
  salaries: number;
  /** Références gardées qui désigneraient une ligne supprimée (« equipes.manager_id → employes » : nombre). */
  orphelines: Record<string, number>;
  ajouts: AjoutsVisiteurs;
  pieces: { dossier: string; fichiers: number; orphelins: number; octets: number };
  reglages: { supprimes: string[]; gardes: string[] };
  comptesGardes: { id: number; identifiant: string }[];
  /** Habilitations gardées dont le signataire par défaut est un nom du jeu : signataire vidé, à compléter au référentiel. */
  signataires: { id: string; signataire: string }[];
  /** Copies locales antérieures (fichier SQLite) et miroir des pièces : elles contiennent encore les données fictives. */
  copies: { dossier: string | null; fichiers: string[]; miroir: string | null };
  sequence: { plusGrand: number; prochain: number; matricule: string };
  /** Avertissements qui n'empêchent pas la purge. */
  avertissements: string[];
}

const TABLE_DE_SNAKE = new Map((Object.keys(TABLES) as TableName[]).map(t => [snake(t), t]));
const colonneCamel = (table: TableName, colonne: string) => Object.keys(TABLES[table].cols).find(c => snake(c) === colonne) ?? colonne;
const typeColonne = (table: TableName, colonne: string) => (TABLES[table].cols as Record<string, string>)[colonneCamel(table, colonne)];

/**
 * Références des tables gardées vers des tables vidées, après le plan : valeur renseignée sur une ligne gardée, colonne
 * non remise à NULL. Le contrôle d'intégrité de la fin de purge (controlerIntegrite) les signalerait.
 */
export async function orphelinesApres(db: Db, plan: PlanPurge): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of REFERENCES) {
    const source = TABLE_DE_SNAKE.get(r.table), cible = TABLE_DE_SNAKE.get(r.cible);
    if (!source || !cible) continue;
    const s = plan.tables[source], c = plan.tables[cible];
    if (s.sort === 'supprimer' || c.sort !== 'supprimer' || s.nulles?.includes(colonneCamel(source, r.colonne))) continue;
    const vide = typeColonne(source, r.colonne) === 'int' ? '0' : "''";
    const n = Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${r.table} t WHERE t.${r.colonne} IS NOT NULL AND t.${r.colonne} <> ${vide}${r.si ? ` AND ${r.si}` : ''}`))!.n);
    if (n) out[`${r.table}.${r.colonne} → ${r.cible}`] = n;
  }
  return out;
}

/** Comptes désignés par --garder-compte (identifiant, insensible à la casse, ou numéro) ; les inconnus sont rendus à part. */
async function comptesDesignes(db: Db, designations: readonly string[]): Promise<{ trouves: { id: number; identifiant: string }[]; inconnus: string[] }> {
  const tous = await db.query<{ id: number; identifiant: string }>('SELECT id, identifiant FROM comptes ORDER BY id');
  const trouves = new Map<number, { id: number; identifiant: string }>(), inconnus: string[] = [];
  for (const d of designations) {
    const v = d.trim().toLowerCase();
    const c = tous.find(x => x.identifiant?.toLowerCase() === v) ?? (/^\d+$/.test(v) ? tous.find(x => Number(x.id) === Number(v)) : undefined);
    if (c) trouves.set(Number(c.id), { id: Number(c.id), identifiant: c.identifiant });
    else inconnus.push(d);
  }
  return { trouves: [...trouves.values()], inconnus };
}

/**
 * Habilitations gardées par le profil dont le signataire par défaut est un nom de la démonstration : salarié du jeu,
 * fiche de la base (toutes partent) ou signataire du référentiel du jeu. Ce signataire est proposé à chaque délivrance
 * et repris par la reprise Lucca quand le fichier n'en donne pas (shared/rules/reprise.ts) : gardé, il ferait signer
 * les titres des vrais salariés par une personne fictive. La purge le vide (la délivrance et la reprise exigent alors
 * un signataire) ; le service RH le complète à l'écran Référentiels.
 */
export async function signatairesFictifs(db: Db, plan: PlanPurge): Promise<{ id: string; signataire: string }[]> {
  if (plan.tables.habilitations.sort === 'supprimer') return [];
  const cle = (n: string) => n.trim().toLowerCase();
  const noms = new Set([...SALARIES_DEMO.map(s => s.nom), ...HABILITATIONS.map(h => h.signataire)].map(cle));
  for (const e of await db.query<{ nom: string | null }>('SELECT nom FROM employes')) if (e.nom) noms.add(cle(e.nom));
  const habs = await db.query<{ id: string; signataire: string | null }>('SELECT id, signataire FROM habilitations ORDER BY id');
  return habs.filter(h => h.signataire && noms.has(cle(h.signataire))).map(h => ({ id: h.id, signataire: h.signataire! }));
}

/** Fichiers de pièces à effacer : ceux des pièces (retirées comprises) et ceux du dossier qu'aucune pièce ne désigne. */
async function fichiersPieces(db: Db): Promise<ApercuPurge['pieces']> {
  const dossier = dossierPiecesDe(db);
  const designes = new Set((await db.query<{ fichier: string | null }>('SELECT fichier FROM pieces')).map(p => p.fichier).filter((f): f is string => !!f && NOM_LOCAL.test(f)));
  const presents = existsSync(dossier) ? readdirSync(dossier).filter(f => NOM_LOCAL.test(f)) : [];
  let octets = 0;
  for (const f of presents) {
    try { octets += statSync(join(dossier, f)).size; } catch { /* fichier effacé entre-temps */ }
  }
  return { dossier, fichiers: designes.size, orphelins: presents.filter(f => !designes.has(f)).length, octets };
}

/** Copies locales de la base SQLite (toutes antérieures à la purge, donc fictives) et miroir des pièces. */
function copiesAnterieures(db: Db): ApercuPurge['copies'] {
  const f = db.emplacement;
  if (!f) return { dossier: null, fichiers: [], miroir: null };
  const dossier = dossierSauvegardes(f);
  const base = basename(f).replace(/\.(db|sqlite3?)$/i, '');
  const miroir = dossierMiroir(dossier, base);
  return { dossier, fichiers: listerSauvegardes(dossier).filter(c => c.base === base).map(c => c.nom), miroir: existsSync(miroir) ? miroir : null };
}

/**
 * Aperçu de la purge, sans rien écrire (--a-blanc) : décision, sort et décompte de chaque table, références qui
 * deviendraient orphelines, ajouts des visiteurs, pièces, réglages, comptes gardés, copies à éliminer, séquence.
 */
export async function apercuPurge(db: Db, options: Pick<OptionsPurge, 'garder' | 'comptes' | 'inclureAjouts'>): Promise<ApercuPurge> {
  const constat = await releverBase(db);
  const decision = deciderPurge(constat, options);
  const { trouves, inconnus } = await comptesDesignes(db, options.comptes);
  if (decision.statut === 'possible') for (const d of inconnus) decision.aLever.push(`compte « ${d} » introuvable (--garder-compte) : identifiant ou numéro de compte attendu.`);
  const plan = planPurge(options.garder, trouves.length > 0);
  const cles = (await db.query<{ key: string }>('SELECT key FROM settings ORDER BY key')).map(r => r.key);
  const supprimes = plan.reglagesSupprimes === '*' ? cles : cles.filter(k => plan.reglagesSupprimes.includes(k));
  const tables: LigneApercu[] = [];
  for (const t of Object.keys(TABLES) as TableName[]) {
    const r = plan.tables[t], lignes = await db.count(t);
    const restent = r.sort === 'supprimer' ? 0 : t === 'comptes' ? trouves.length : t === 'settings' ? lignes - supprimes.length : lignes;
    tables.push({ table: t, sort: r.sort, pourquoi: r.pourquoi, lignes, partent: lignes - restent, restent: t === 'journal' ? 1 : restent, amorcee: !!r.amorcee });
  }
  const plusGrand = await plusGrandIdEmploye(db), prochain = prochainIdEmploye(plusGrand);
  const avertissements: string[] = [];
  if (prochain > DERNIER_ID_4_CHIFFRES) avertissements.push(`le prochain identifiant (${prochain}) dépasse ${DERNIER_ID_4_CHIFFRES} : matricule sur 5 chiffres, à signaler aux outils qui lisent pub_salaries.`);
  if (db.moteur === 'pg') avertissements.push('serveur PostgreSQL : les copies sont les pg_dump de Matrix ; celles d’avant la purge contiennent les données fictives (docs/SAUVEGARDE.md).');
  return {
    profil: options.garder, moteur: db.moteur, decision, tables, salaries: tables.find(t => t.table === 'employes')!.partent,
    orphelines: await orphelinesApres(db, plan), ajouts: constat.ajouts, pieces: await fichiersPieces(db),
    reglages: { supprimes, gardes: cles.filter(k => !supprimes.includes(k)) }, comptesGardes: trouves, signataires: await signatairesFictifs(db, plan),
    copies: copiesAnterieures(db),
    sequence: { plusGrand, prochain, matricule: matricule(prochain) }, avertissements,
  };
}

const SORT_LIBELLE: Record<RegleTable['sort'], string> = { supprimer: 'vidée', garder: 'gardée', ajuster: 'gardée, ajustée' };
const fmtAjout = (libelle: string, a: Ajout) => `  - ${libelle} : ${a.nombre}${a.nombre ? ` (${a.premier ? (a.premier === a.dernier ? `le ${a.premier}` : `du ${a.premier} au ${a.dernier}`) : 'date inconnue'})` : ''}`;

/** Aperçu mis en forme pour le terminal, une ligne par élément. */
export function texteApercu(a: ApercuPurge): string[] {
  const out: string[] = [`Aperçu de la purge (profil ${a.profil}, base ${a.moteur === 'pg' ? 'PostgreSQL' : 'SQLite'}) : rien n’a été modifié.`];
  const d = a.decision;
  if (d.statut === 'refusee') out.push('Purge refusée :', ...d.motifs.map(m => `  - ${m}`));
  if (d.statut === 'possible') {
    out.push(`Base de démonstration reconnue (${d.preuve === 'marqueur' ? `réglage « ${REGLAGE_DEMO} »` : 'faisceau d’indices'}).`);
    if (d.aLever.length) out.push('À lever avant la purge :', ...d.aLever.map(m => `  - ${m}`));
  }
  out.push('Tables (lignes qui partent / qui restent) :');
  for (const t of a.tables) {
    if (!t.lignes && !t.amorcee) continue;
    out.push(`  - ${snake(t.table)} : ${t.partent} / ${t.restent} — ${SORT_LIBELLE[t.sort]}, ${t.pourquoi}${t.amorcee ? ' ; amorçages reposés' : ''}`);
  }
  const orph = Object.entries(a.orphelines);
  out.push(orph.length ? `Références orphelines après la purge : ${orph.map(([k, n]) => `${k} (${n})`).join(', ')}` : 'Références orphelines après la purge : aucune.');
  out.push('Ajouts des visiteurs :', fmtAjout('fiches hors du jeu', a.ajouts.fiches), fmtAjout('reprises importées', a.ajouts.reprises),
    fmtAjout('lots de paie hors « Démonstration »', a.ajouts.lots), fmtAjout('fichiers Sage téléchargés', a.ajouts.fichiersSage), fmtAjout('comptes créés', a.ajouts.comptes));
  out.push(`Fichiers de pièces à effacer : ${a.pieces.fichiers} désignés par une pièce et ${a.pieces.orphelins} sans pièce dans ${a.pieces.dossier} (${a.pieces.octets} octets).`);
  out.push(`Réglages à remettre à défaut : ${a.reglages.supprimes.join(', ') || 'aucun'} ; gardés : ${a.reglages.gardes.join(', ') || 'aucun'}.`);
  out.push(a.comptesGardes.length ? `Comptes gardés (rendus externes) : ${a.comptesGardes.map(c => c.identifiant).join(', ')}.` : 'Comptes gardés : aucun (premier administrateur : npm run comptes -- admin).');
  if (a.signataires.length) {
    out.push(`Signataires fictifs au référentiel des habilitations, vidés par la purge (à compléter à l’écran Référentiels avant la reprise Lucca) : `
      + `${a.signataires.map(h => `${h.id} (${h.signataire})`).join(', ')}.`);
  }
  if (a.copies.dossier) {
    out.push(`Copies antérieures qui contiennent encore les données fictives (${a.copies.dossier}) : ${a.copies.fichiers.length ? a.copies.fichiers.join(', ') : 'aucune'}`
      + `${a.copies.miroir ? ` ; miroir des pièces ${a.copies.miroir}` : ''}.`);
  }
  out.push(`Salariés supprimés : ${a.salaries}. Prochain salarié : identifiant ${a.sequence.prochain} (${a.sequence.matricule}), plus grand identifiant attribué ${a.sequence.plusGrand}.`);
  out.push(...a.avertissements.map(m => `Attention : ${m}`));
  return out;
}
