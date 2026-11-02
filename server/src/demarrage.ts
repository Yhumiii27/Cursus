// Mise à jour de la base à l'ouverture, commune au serveur (server/src/index.ts) et aux outils qui y écrivent (npm run
// comptes, npm run reset-demo), selon le moteur :
// - SQLite : reprises historiques rejouées à chaque démarrage (server/src/migrate.ts), puis migrations nommées
//   (server/src/migrations/), qui écrivent du SQL propre à SQLite (json_each, json_array, sqlite_sequence) ;
// - PostgreSQL : le schéma part directement de l'état final (server/migrations-pg/, appliquées par openDb) ; restent les
//   amorçages de données qu'une base neuve reçoit des migrations nommées (activités internes, dont INT-AST des
//   interventions d'astreinte, horaires de poste d'exemple) et le rattachement des
//   fiches au référentiel des postes, rejoué à chaque démarrage comme en SQLite ;
// - les deux moteurs (lot 11) : amorçage de l'entité unique, s'il n'en existe aucune et qu'une équipe existe
//   (`amorcerEntites`) ; une équipe racine créée ensuite y est rattachée (`rattacherEquipeNeuve`).
import { type Db, SqliteDb } from './db.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations } from './migrations/cadre.ts';
import { amorcerActiviteFormation } from './migrations/formations.ts';
import { amorcerHoraires } from './migrations/lot6-horaires.ts';
import { rattacherFiches } from './migrations/referentiels.ts';
import { amorcerActivites } from './migrations/temps.ts';
import { amorcerActiviteAstreinte } from './migrations/lot7-astreintes.ts';
// lot 12 — C5 (planning d'équipe)
import { amorcerCycles } from './migrations/lot12-planning.ts';
// lot 11 — organigramme
import { plural } from '../../shared/format.ts';
import { entiteOuverte, equipesRessemblantAUnSite, NOM_ENTITE_MAX } from '../../shared/rules/entites.ts';
import type { Entite, Equipe } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { lireConfidentialite } from './confidentialite.ts';
import { recalerRattachements } from './rattachements.ts';
// lot 12 — C4 (organismes de formation et e-learning)
import { reprendreOrganismes } from './reprise-organismes.ts';

/**
 * Reprises et migrations de la base ouverte. SQLite : une MigrationError d'une migration nommée interrompue est rendue
 * telle quelle (le serveur refuse de démarrer). PostgreSQL : amorçages d'une base neuve, rattachement des fiches.
 */
export async function mettreAJourBase(db: Db): Promise<void> {
  if (db instanceof SqliteDb) {
    await migrate(db);
    await appliquerMigrations(db);
    // Déclencheurs de révision reposés : une migration nommée a pu reconstruire une table (lot 8, chantier E).
    db.poserRevision();
  } else {
    if (db.neuve) {
      await db.tx(async () => {
        await amorcerActivites(db);
        await amorcerActiviteFormation(db);
        await amorcerHoraires(db);
        await amorcerActiviteAstreinte(db);
      });
    }
    await rattacherFiches(db);
    // lot 12 — C5 (planning d'équipe) : modèles de cycles amorcés une fois (table vide), base neuve ou déjà en service.
    await db.tx(async () => { await amorcerCycles(db); });
  }
  // lot 12 — C4 : organismes saisis en texte libre repris en fiches, sur les deux moteurs, après les migrations (étape
  // idempotente : rien quand il ne reste aucun texte sans fiche ; server/src/reprise-organismes.ts).
  await reprendreOrganismes(db);
  // lot 11 — organigramme : entité unique amorcée sur les deux moteurs, une fois les réglages lisibles.
  await amorcerEntites(db);
  // Site et unité de rattachement des fiches tirés de leur équipe (étape 2) : une base d'avant le lot 11 les reçoit ici, et
  // pub_salaries cesse de les publier vides ; sans effet quand ils sont à jour.
  await db.tx(async () => { await recalerRattachements(db); });
}

// lot 11 — organigramme

/** Code de l'entité amorcée : stable, jamais modifié (le service RH en change le nom et le SIREN). */
export const CODE_ENTITE_AMORCEE = 'entreprise';

/** Bilan de l'amorçage des entités : rien (une entité existait déjà), ou l'entité créée et les équipes rattachées. */
export interface BilanEntites { code: string; nom: string; equipes: number; equipesSite: string[] }

/**
 * Amorçage neutre des entités (lot 11, t195), au démarrage et après le chargement de la démonstration, sur les deux
 * moteurs : s'il n'existe aucune entité mais au moins une équipe, une société est créée sous la raison sociale du
 * responsable du traitement (Paramètres → Confidentialité, première ligne) ou, à défaut, « Entreprise », et les équipes
 * racines y sont rattachées. Base sans équipe (premier démarrage de la production) : rien n'est créé, l'amorçage attend
 * la première équipe (`rattacherEquipeNeuve` : equipe.creer ou reprise de Lucca), une fois la raison sociale saisie.
 * Aucun valideur ne change (l'entité n'est qu'un regroupement au-dessus des équipes racines). Les équipes racines dont le
 * nom ressemble à un site sont seulement signalées au service RH (journal, `entite.amorcer`, quand des équipes sont
 * rattachées), jamais converties.
 * Idempotent : sans effet dès qu'une entité existe. Rend le bilan, ou null.
 */
export async function amorcerEntites(db: Db): Promise<BilanEntites | null> {
  return await db.tx(async () => {
    if (await db.count('entites') > 0) return null;
    const racines = (await db.all<Equipe>('equipes', 'ordre')).filter(q => !q.parente);
    // Aucune équipe : une société créée maintenant porterait le nom par défaut et ne serait plus jamais amorcée.
    if (!racines.length) return null;
    const responsable = (await lireConfidentialite(db)).responsable?.split('\n')[0].trim() ?? '';
    const nom = responsable.slice(0, NOM_ENTITE_MAX).trim() || 'Entreprise';
    await db.insert<Entite>('entites', {
      code: CODE_ENTITE_AMORCEE, nom, type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local',
    });
    await db.run('UPDATE equipes SET entite = ? WHERE parente IS NULL', [CODE_ENTITE_AMORCEE]);
    const bilan: BilanEntites = { code: CODE_ENTITE_AMORCEE, nom, equipes: racines.length, equipesSite: equipesRessemblantAUnSite(racines) };
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'entite.amorcer',
      message: `Entité ${nom} créée, ${plural(racines.length, 'équipe racine rattachée', 'équipes racines rattachées')}${bilan.equipesSite.length
        ? ` ; à vérifier par le service RH (nom de site, conversion à la main) : ${bilan.equipesSite.join(', ')}` : ''}`,
      payload: { code: CODE_ENTITE_AMORCEE, equipes: racines.length, ...(bilan.equipesSite.length ? { equipesSite: bilan.equipesSite } : {}) },
    });
    return bilan;
  });
}

/**
 * Entité d'une équipe racine nouvelle (equipe.creer ; reprise de Lucca, server/src/actions/reprise.ts), sans quoi les
 * équipes de la mise en service resteraient toutes sans entité : aucune entité encore, l'amorçage est fait maintenant
 * (`amorcerEntites`, qui rattache aussi cette équipe) ; une seule entité ouverte, et c'est une société, l'équipe y est
 * rattachée ; plusieurs entités ouvertes, le choix revient au service RH (equipe.entite) et l'équipe reste signalée dans
 * l'organigramme. Équipe rattachée à une équipe parente ou portant déjà une entité : rien. Aucun valideur ne change.
 * Rend l'entité posée, ou null.
 */
export async function rattacherEquipeNeuve(db: Db, nom: string): Promise<Entite | null> {
  return await db.tx(async () => {
    const q = await db.get<Equipe>('equipes', nom);
    if (!q || q.parente || q.entite) return null;
    const entites = await db.all<Entite>('entites');
    if (!entites.length) {
      const bilan = await amorcerEntites(db);
      return bilan ? (await db.get<Entite>('entites', bilan.code)) ?? null : null;
    }
    const ouvertes = entites.filter(entiteOuverte);
    if (ouvertes.length !== 1 || ouvertes[0].type !== 'societe') return null;
    await db.update<Equipe>('equipes', nom, { entite: ouvertes[0].code });
    return ouvertes[0];
  });
}

/**
 * Préchauffage du cache de l'instantané (lot 9, chantier 2, étape 2), après les migrations et le chargement de la base,
 * au démarrage du serveur seulement (jamais pour les outils, qui n'appellent que `mettreAJourBase`, ni sous node --test) :
 * l'entrée de la révision courante est lue avant les premières requêtes, qui la trouvent prête ou attendent cette même
 * lecture, au lieu d'une rafale froide qui relirait toute la base. Non bloquant : un échec n'écrit qu'un avertissement
 * (la première requête relira). Rend vrai si l'entrée a été lue.
 */
export async function prechaufferCache(db: Db, avertir: (message: string) => void = console.warn): Promise<boolean> {
  if (process.env.NODE_TEST_CONTEXT) return false;
  // Chargés ici seulement : les outils qui importent ce fichier n'en ont pas besoin.
  const { prechauffer } = await import('./cache-instantane.ts');
  const { loadFull, todayIso } = await import('./dataset.ts');
  try {
    return await prechauffer(db, todayIso(), async lecteur => await loadFull(db, lecteur));
  } catch (err) {
    avertir(`Préchauffage du cache de l’instantané impossible : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Préchauffage complet au démarrage du serveur (lot 10, chantier A) : l'entrée (`prechaufferCache`), puis les vues des
 * comptes actifs en tâche de fond (server/src/prechauffage-vues.ts, CURSUS_PRECHAUFFAGE_VUES=0 pour le couper). Jamais
 * sous node --test ni pour les outils. Non bloquant : un échec n'écrit qu'un avertissement. Rend le bilan des vues, ou
 * null si rien n'a été préchauffé.
 */
export async function prechaufferDemarrage(
  db: Db, o: { compression: boolean; arrete?: () => boolean; avertir?: (message: string) => void; info?: (message: string) => void },
): Promise<import('./prechauffage-vues.ts').BilanPrechauffage | null> {
  if (process.env.NODE_TEST_CONTEXT) return null;
  const avertir = o.avertir ?? console.warn;
  if (!await prechaufferCache(db, avertir)) return null;
  const { prechaufferVues, prechauffageVuesActif } = await import('./prechauffage-vues.ts');
  if (!prechauffageVuesActif()) return null;
  const bilan = await prechaufferVues(db, { compression: o.compression, arrete: o.arrete, avertir });
  o.info?.(`Vues préchauffées : ${bilan.vues} (${bilan.corps} corps compressés) en ${(bilan.ms / 1000).toFixed(1)} s${bilan.interrompu ? ', interrompu' : ''}.`);
  return bilan;
}

/** Intervalle du contrôle du changement de jour (millisecondes). */
export const CONTROLE_JOUR_MS = 60_000;

/**
 * Préchauffage au changement de jour (lot 10, chantier A) : l'entrée du cache est propre à la date du jour, et la
 * première lecture d'un jour nouveau relisait toute la base puis calculait sa vue ; chaque minute, si la date du jour a
 * changé, l'entrée et les vues du nouveau jour sont préchauffées en tâche de fond (`prechaufferDemarrage`). Rend la
 * fonction d'arrêt du minuteur. Jamais sous node --test.
 */
export function prechaufferChaqueJour(
  db: Db, o: Parameters<typeof prechaufferDemarrage>[1] & { jour: () => string },
): () => void {
  if (process.env.NODE_TEST_CONTEXT) return () => {};
  let dernier = o.jour();
  let enCours = false;
  const minuteur = setInterval(() => {
    const jour = o.jour();
    if (jour === dernier || enCours) return;
    dernier = jour;
    enCours = true;
    void prechaufferDemarrage(db, o).catch(() => null).finally(() => { enCours = false; });
  }, CONTROLE_JOUR_MS);
  minuteur.unref();
  return () => clearInterval(minuteur);
}
