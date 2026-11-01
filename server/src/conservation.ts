// Conservation des dossiers des salariés sortis (t016, règles : shared/rules/conservation.ts). Décision de l'entreprise :
// « Cursus propose, le RH confirme ». Ce module :
// - repère les dossiers dont une durée est échue (`dossiersEchus`), pour l'écran Paramètres → Conservation des dossiers ;
// - efface, sur la confirmation de l'administrateur RH (`employe.anonymiser`), les données échues d'une catégorie, puis, à
//   l'échéance du dossier, anonymise la fiche en cascade (`effacerDossier`) : chaque colonne qui désigne un salarié
//   (REFERENCES de server/src/integrite.ts, et non le seul nom `empId`) a son traitement (TRAITEMENTS), vérifié par
//   tests/conservation.test.ts ; le nom et les adresses sont ensuite retirés des colonnes de texte de la base (journal,
//   file d'envoi, comptes rendus de reprise…), occurrence délimitée par occurrence délimitée, sans jamais toucher à la
//   fiche ni au compte d'un autre salarié (réembauche, homonyme) ;
// - signale chaque jour au service RH les dossiers échus (`verifierConservation`), sans rien effacer de lui-même.
// Les sauvegardes gardent les données effacées jusqu'à leur rotation (docs/SAUVEGARDE.md).
import { addM } from '../../shared/dates.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import { CATEGORIES, CATEGORIES_CONSERVATION, categoriesEchues, conservationActive, nomAnonyme } from '../../shared/rules/conservation.ts';
import type { CategorieConservation, DossierEchu, Employe, ISODate, ReouvertureFeuille, Settings } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { loadSettings, todayIso } from './dataset.ts';
import { snake, type SqlValeur, TABLES, type Db, type TableName } from './db.ts';
import { log } from './logs.ts';
import { lireMessagerie } from './messagerie.ts';
import { nettoyerBientot } from './pieces.ts';

/**
 * Traitement de chaque référence à un salarié (clé « table.colonne » de REFERENCES) :
 * - `lignes` : lignes supprimées à l'échéance de la catégorie (le dossier les emporte toutes) ;
 * - `textes` : lignes gardées (agrégats sans nom une fois la fiche anonymisée), textes libres vidés ;
 * - `gardee` : ligne gardée telle quelle (agrégat non nominatif, trace de l'effacement) ;
 * - `compte`, `pieces` : traitement propre (compte fermé ; pièces retirées, fichiers effacés) ;
 * - `auteur` : auteur d'une ligne d'un autre salarié, gardé ; son nom est retiré par le balayage des textes ;
 * - `detachee` : référence retirée (manager d'une équipe).
 * Une référence ajoutée à REFERENCES sans traitement fait échouer tests/conservation.test.ts.
 */
export type Traitement =
  | { mode: 'lignes' | 'textes'; categorie: CategorieConservation }
  | { mode: 'gardee' | 'compte' | 'pieces' | 'auteur' | 'detachee' };
export const TRAITEMENTS: Record<string, Traitement> = {
  'demandes_visite.emp_id': { mode: 'lignes', categorie: 'sante' },
  'vaccinations.emp_id': { mode: 'lignes', categorie: 'sante' },
  'visas.emp_id': { mode: 'lignes', categorie: 'passeport' },
  'entretiens.emp_id': { mode: 'lignes', categorie: 'entretiens' },
  'demandes_collab.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'notifications.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'verdicts_keystone.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'jetons_agenda.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'certifications.emp_id': { mode: 'textes', categorie: 'formations' },
  'hab_titres.emp_id': { mode: 'textes', categorie: 'formations' },
  'feuilles.emp_id': { mode: 'textes', categorie: 'temps' },
  'absences.emp_id': { mode: 'textes', categorie: 'temps' },
  'reports.emp_id': { mode: 'textes', categorie: 'temps' },
  'clotures.emp_id': { mode: 'textes', categorie: 'temps' },
  'voyages.emp_id': { mode: 'textes', categorie: 'dossier' },
  'demandes_keystone.emp_id': { mode: 'textes', categorie: 'dossier' },
  'contrats_historique.emp_id': { mode: 'textes', categorie: 'dossier' },
  'formations_suivies.emp_id': { mode: 'textes', categorie: 'formations' },
  'avenants_forfait.emp_id': { mode: 'textes', categorie: 'paie' },
  'inscriptions.emp_id': { mode: 'gardee' },
  'participations.emp_id': { mode: 'gardee' },
  'missions.emp_id': { mode: 'gardee' },
  'taches.emp_id': { mode: 'gardee' },
  'mandats.emp_id': { mode: 'gardee' },
  'cet.emp_id': { mode: 'gardee' },
  'soldes_reprise.emp_id': { mode: 'gardee' },
  'informations_cp.emp_id': { mode: 'gardee' },
  'soldes_sortie.emp_id': { mode: 'gardee' },
  'deplacements_paie.emp_id': { mode: 'gardee' },
  'effacements.emp_id': { mode: 'gardee' },
  // Lot 6, vague 2 : délégations (identifiants et dates), fractionnement (décision codée), délivrances d'habilitation.
  'delegations.manager_id': { mode: 'gardee' },
  'delegations.suppleant_id': { mode: 'gardee' },
  'fractionnements.emp_id': { mode: 'gardee' },
  'hab_delivrances.emp_id': { mode: 'gardee' },
  // Liste d'attente des sessions (lot 7, t120) : rang, statut et issue codés, gardés comme les inscriptions ; la demande qui
  // l'y a placé est détachée avant d'être supprimée (pas de référence orpheline), l'auteur (nom) retiré par le balayage.
  'attentes_session.emp_id': { mode: 'textes', categorie: 'formations' },
  // Évaluations des formations (lot 7, t121) : comme les formations suivies, notes et efficacité gardées (agrégats), commentaire
  // (texte libre) vidé ; l'auteur d'une évaluation (manager, service RH) est gardé, son nom retiré par le balayage.
  'evaluations_formation.emp_id': { mode: 'textes', categorie: 'formations' },
  'evaluations_formation.auteur_id': { mode: 'auteur' },
  'comptes.emp_id': { mode: 'compte' },
  'pieces.emp_id': { mode: 'pieces' },
  'contrats_historique.par_id': { mode: 'auteur' },
  'demandes_collab.par_id': { mode: 'auteur' },
  'hab_delivrances.auteur_id': { mode: 'auteur' },
  'formations_suivies.auteur_id': { mode: 'auteur' },
  'equipes.manager_id': { mode: 'detachee' },
  // Astreintes (t049, lot 7) : lignes gardées avec les feuilles de temps, motifs (textes libres) vidés ; interventions
  // (jours, heures) gardées telles quelles.
  'astreintes.emp_id': { mode: 'textes', categorie: 'temps' },
  'astreinte_interventions.emp_id': { mode: 'gardee' },
  // Passeport de prévention (lot 7, t066) : déclarations (identifiants et dates) gardées avec les certifications et les
  // formations suivies qu'elles désignent ; l'auteur (nom) retiré par le balayage des textes.
  'declarations_passeport.emp_id': { mode: 'gardee' },
  'declarations_passeport.auteur_id': { mode: 'auteur' },
  // lot 11 — dossiers OPCO : colonne réservée aux dossiers d'alternance (plus tard), jamais remplie aujourd'hui ; un dossier
  // est une pièce comptable de l'entreprise, gardé (montants sans nom une fois la fiche anonymisée).
  'dossiers_opco.emp_id': { mode: 'gardee' },
  // lot 11 — notes de frais : lignes supprimées à l'échéance de la catégorie, sauf les notes payées encore dans leur terme
  // comptable (étapes de la catégorie « frais », qui se protègent par leur date de paiement).
  'notes_frais.emp_id': { mode: 'lignes', categorie: 'frais' },
  'lignes_frais.emp_id': { mode: 'lignes', categorie: 'frais' },
  'vehicules_perso.emp_id': { mode: 'lignes', categorie: 'frais' },
  'avances_frais.emp_id': { mode: 'lignes', categorie: 'frais' },
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe) : créneaux, affectations et échanges gardés avec les feuilles de temps (catégorie
  // « temps », au moins un an : art. D3171-16), motifs et codes d'alerte (textes libres, réserve d'aptitude) vidés ; le
  // suppléant qui a validé un échange est un auteur, son nom retiré par le balayage.
  'creneaux.emp_id': { mode: 'textes', categorie: 'temps' },
  'roulements.emp_id': { mode: 'textes', categorie: 'temps' },
  'echanges_poste.demandeur_id': { mode: 'textes', categorie: 'temps' },
  'echanges_poste.partenaire_id': { mode: 'textes', categorie: 'temps' },
  'echanges_poste.par_delegation_de': { mode: 'auteur' },
  // lot 12 — C6 (badgeage virtuel)
};

/**
 * Une étape d'effacement : lignes visées (`ou`, chaque « ? » reçoit l'identifiant du salarié), supprimées, ou dont les
 * colonnes `vider` passent à NULL et les colonnes `poser` reçoivent une valeur (liée) ou une expression SQL (`sql`).
 */
interface Etape { table: string; ou: string; supprimer?: true; vider?: readonly string[]; poser?: Record<string, unknown>; sql?: Record<string, string>; reecrire?: Reecriture }
/**
 * Valeur JSON réécrite en TypeScript (textes libres retirés d'un document gardé) : `champ` de la table (`table` est alors
 * aussi le nom déclaré dans TABLES), lu et écrit par l'API de Db (même codage sur les deux moteurs) ; une ligne compte
 * quand la réécriture change sa valeur (étape idempotente).
 */
interface Reecriture { champ: string; f: (v: any) => unknown }

/**
 * Réouverture d'une feuille (`feuilles.reouverture`, shared/types.ts) gardée sans ses motifs (textes de l'administrateur
 * RH), précédentes comprises : les rubriques transmises et les heures envoyées à Keystone servent encore à la
 * régularisation ; l'auteur (nom) est retiré par le balayage à l'anonymisation (lot 8, D4).
 */
export const reouvertureSansMotif = (r: ReouvertureFeuille): ReouvertureFeuille => ({
  ...r, motif: '', ...(r.precedentes ? { precedentes: r.precedentes.map(x => ({ ...x, motif: '' })) } : {}),
});

/** Pièces retirées (fichier effacé après la validation, description gardée). */
const retrait = (cx: Cx, ou: string): Etape => ({ table: 'pieces', ou: `${ou} AND retiree_le IS NULL`, poser: { retiree_le: cx.le, retiree_par: cx.par, retiree_motif: 'Durée de conservation échue' } });
/** Déclarations d'un document (passeport, visa, vaccin) faites par le salarié. */
const declarations = (db: Db, kinds: string) => `emp_id = ? AND type = 'document' AND ${db.jsonCle('declaration', 'kind')} IN (${kinds})`;

/** Contexte d'un effacement : jour, auteur. */
export interface Cx {
  ti: ISODate; le: string; par: string;
  // lot 11 — notes de frais : durée de conservation des notes payées (réglage `conservationFraisAns`) ; 10 ans à défaut.
  fraisAns?: number;
}

/**
 * lot 11 — notes de frais : condition SQL d'une note (alias `n`) hors de son terme comptable, à effacer : non payée (ni en
 * paiement), ou payée avant le jour `limite` (aujourd'hui moins la durée réglée). Date contrôlée, écrite en littéral.
 */
const noteHorsTerme = (limite: ISODate) => `NOT (n.statut IN ('en_paiement', 'payee') AND COALESCE(n.payee_le, '9999-12-31') >= '${limite.replace(/[^0-9-]/g, '')}')`;
const avanceHorsTerme = (limite: ISODate) => `NOT (statut IN ('en_paiement', 'versee') AND COALESCE(versee_le, '9999-12-31') >= '${limite.replace(/[^0-9-]/g, '')}')`;
/** Véhicules encore désignés par une ligne de frais gardée. */
const VEHICULES_UTILISES = 'SELECT vehicule_id FROM lignes_frais WHERE vehicule_id IS NOT NULL';

/** Étapes propres à chaque catégorie, dans l'ordre (les pièces d'un objet avant l'objet). */
export function etapes(db: Db, cat: CategorieConservation, cx: Cx, empId: number): Etape[] {
  switch (cat) {
    case 'passeport': return [
      retrait(cx, `emp_id = ? AND objet = 'declaration' AND objet_id IN (SELECT id FROM demandes_collab WHERE ${declarations(db, `'passeport', 'visa'`)})`),
      { table: 'demandes_collab', ou: declarations(db, `'passeport', 'visa'`), supprimer: true },
      { table: 'visas', ou: 'emp_id = ?', supprimer: true },
      { table: 'employes', ou: 'id = ?', vider: ['passeport_numero', 'passeport_expire'] },
    ];
    case 'sante': return [
      retrait(cx, `emp_id = ? AND objet = 'declaration' AND objet_id IN (SELECT id FROM demandes_collab WHERE ${declarations(db, `'vaccin'`)})`),
      { table: 'demandes_collab', ou: declarations(db, `'vaccin'`), supprimer: true },
      { table: 'vaccinations', ou: 'emp_id = ?', supprimer: true },
      { table: 'demandes_visite', ou: 'emp_id = ?', supprimer: true },
      { table: 'employes', ou: 'id = ?', vider: ['visite', 'avis', 'restrictions', 'suivi', 'prochaine_visite', 'examen_aptitude', 'expose', 'reprise_motif', 'reprise_date'] },
    ];
    case 'titreSejour': return [{ table: 'employes', ou: 'id = ?', vider: ['autorisation_travail'] }];
    case 'entretiens': return [{ table: 'entretiens', ou: 'emp_id = ?', supprimer: true }];
    case 'temps': return [
      retrait(cx, `emp_id = ? AND objet = 'absence'`),
      // Motif du dépassement du plafond d'un forfait jours (lot 6) et motifs des réouvertures : textes libres du valideur
      // et de l'administrateur RH (lot 8, D4).
      { table: 'feuilles', ou: 'emp_id = ?', vider: ['comment', 'motif_depassement', 'motif_forfait'] },
      { table: 'feuilles', ou: 'emp_id = ? AND reouverture IS NOT NULL', reecrire: { champ: 'reouverture', f: reouvertureSansMotif } },
      { table: 'absences', ou: 'emp_id = ?', vider: ['motif_refus'] },
      { table: 'reports', ou: 'emp_id = ?', vider: ['motif'] },
      { table: 'clotures', ou: 'emp_id = ?', vider: ['motif'] },
      { table: 'astreintes', ou: 'emp_id = ?', vider: ['motif', 'annule_motif'] },
      // lot 12 — C5 (planning d'équipe) : motifs et codes des alertes acceptées (réserve d'aptitude) ; postes et jours gardés.
      { table: 'creneaux', ou: 'emp_id = ?', vider: ['motif', 'motif_alertes', 'alertes_acceptees', 'annule_motif'] },
      { table: 'roulements', ou: 'emp_id = ?', vider: ['fin_motif'] },
      { table: 'echanges_poste', ou: 'demandeur_id = ? OR partenaire_id = ?', vider: ['motif_refus', 'alertes_acceptees'] },
    ];
    case 'formations': return [
      retrait(cx, `emp_id = ? AND objet IN ('certification', 'habTitre')`),
      { table: 'certifications', ou: 'emp_id = ?', vider: ['corrige_motif', 'annule_motif'] },
      { table: 'hab_titres', ou: 'emp_id = ?', vider: ['mesure_motif'] },
      { table: 'formations_suivies', ou: 'emp_id = ?', vider: ['corrige_motif', 'annule_motif'] },
      // Évaluations des formations (lot 7, t121) : commentaire vidé, note et efficacité gardées.
      { table: 'evaluations_formation', ou: 'emp_id = ?', vider: ['commentaire'] },
      // Liste d'attente (lot 7, t120) : la demande supprimée ci-dessous n'y est plus désignée.
      { table: 'attentes_session', ou: 'emp_id = ?', vider: ['demande_id'] },
      { table: 'demandes_collab', ou: `emp_id = ? AND type IN ('formation', 'habilitation')`, supprimer: true },
    ];
    // Avenants de renonciation d'un forfait jours : référence et motif d'annulation (textes libres du service RH).
    case 'paie': return [{ table: 'avenants_forfait', ou: 'emp_id = ?', vider: ['reference', 'annule_motif'] }];
    // lot 11 — notes de frais : seules les notes hors de leur terme comptable (payées depuis plus de la durée réglée, ou
    // jamais payées) partent, avec leurs lignes, leurs justificatifs et les avances soldées ; les véhicules et leurs pièces
    // quand plus aucune ligne gardée ne les désigne. Le dossier anonymisé garde les autres, sans nom.
    case 'frais': {
      const limite = addM(cx.ti || todayIso(), -12 * (cx.fraisAns ?? 10));
      const lignes = `SELECT l.id FROM lignes_frais l JOIN notes_frais n ON n.id = l.note_id WHERE ${noteHorsTerme(limite)}`;
      return [
        retrait(cx, `emp_id = ? AND objet IN ('ligneFrais', 'ligneFraisSante') AND objet_id IN (${lignes})`),
        // Pièces détachées des lignes supprimées ci-dessous (description gardée, sans objet désigné).
        { table: 'pieces', ou: `emp_id = ? AND objet IN ('ligneFrais', 'ligneFraisSante') AND objet_id IN (${lignes})`, vider: ['objet_id'] },
        { table: 'lignes_frais', ou: `emp_id = ? AND id IN (${lignes})`, supprimer: true },
        { table: 'notes_frais', ou: `emp_id = ? AND id IN (SELECT n.id FROM notes_frais n WHERE ${noteHorsTerme(limite)})`, supprimer: true },
        { table: 'avances_frais', ou: `emp_id = ? AND ${avanceHorsTerme(limite)}`, supprimer: true },
        retrait(cx, `emp_id = ? AND objet = 'vehiculePerso' AND objet_id NOT IN (${VEHICULES_UTILISES})`),
        { table: 'pieces', ou: `emp_id = ? AND objet = 'vehiculePerso' AND objet_id NOT IN (${VEHICULES_UTILISES})`, vider: ['objet_id'] },
        { table: 'vehicules_perso', ou: `emp_id = ? AND id NOT IN (${VEHICULES_UTILISES})`, supprimer: true },
      ];
    }
    case 'dossier': return [
      // Pièces restantes (déplacements, autres déclarations) retirées, et leur nom d'origine, qui peut nommer la personne.
      // lot 11 — notes de frais : les justificatifs des notes encore dans leur terme comptable restent (la catégorie
      // « frais », appliquée avant, a retiré les autres).
      retrait(cx, `emp_id = ? AND (objet IS NULL OR objet NOT IN ('ligneFrais', 'ligneFraisSante', 'vehiculePerso') OR objet_id IS NULL)`),
      { table: 'pieces', ou: `emp_id = ? AND nom NOT LIKE 'piece-%'`, sql: { nom: `'piece-' || id` } },
      { table: 'attentes_session', ou: 'emp_id = ?', vider: ['demande_id'] },
      { table: 'demandes_collab', ou: 'emp_id = ?', supprimer: true },
      { table: 'notifications', ou: 'emp_id = ?', supprimer: true },
      { table: 'verdicts_keystone', ou: 'emp_id = ?', supprimer: true },
      { table: 'jetons_agenda', ou: 'emp_id = ?', supprimer: true },
      { table: 'voyages', ou: 'emp_id = ?', vider: ['motif', 'hebergement', 'contact_sur_place', 'annule_motif', 'demandeur'] },
      { table: 'demandes_keystone', ou: 'emp_id = ?', vider: ['motif_refus'] },
      { table: 'contrats_historique', ou: 'emp_id = ?', vider: ['reference'] },
      { table: 'equipes', ou: 'manager_id = ?', vider: ['manager_id'] },
      // Compte de connexion fermé : sessions supprimées, identité retirée (l'identifiant unique devient « anonyme-<n°> »).
      { table: 'connexions', ou: 'compte_id IN (SELECT id FROM comptes WHERE emp_id = ?)', supprimer: true },
      // Identifiant de connexion noté au journal : celui du compte fermé (un identifiant local n'est pas balayé, ci-dessous).
      { table: 'journal', ou: `compte_id IN (SELECT id FROM comptes WHERE emp_id = ?) AND identifiant IS NOT NULL AND identifiant NOT LIKE 'anonyme-%'`, sql: { identifiant: `'anonyme-' || compte_id` } },
      {
        table: 'comptes', ou: `emp_id = ? AND identifiant NOT LIKE 'anonyme-%'`, vider: ['nom', 'adresse', 'oid', 'mot_de_passe', 'blocage_fin'],
        poser: { actif: 0, changer_mot_de_passe: 0 }, sql: { identifiant: `'anonyme-' || id` },
      },
      // Fiche : identité neutre ; l'année de naissance, le poste, l'équipe et le contrat restent (agrégats sans nom).
      {
        table: 'employes', ou: 'id = ? AND anonymise_le IS NULL',
        vider: ['email', 'naissance_le', 'matricule_paie', 'urgence_nom', 'urgence_tel', 'derogation_travaux_le'],
        poser: { nom: nomAnonyme(empId), anonymise_le: cx.ti },
      },
    ];
  }
}

/** Type déclaré (TABLES) de chaque colonne, par noms SQL : « table.colonne ». */
const TYPES_SQL = new Map(Object.entries(TABLES as Record<string, { cols: Record<string, string> }>)
  .flatMap(([t, def]) => Object.entries(def.cols).map(([c, type]) => [`${snake(t)}.${snake(c)}`, type] as const)));

/**
 * Valeur considérée comme vide (rien à effacer) : NULL, chaîne vide, liste vide, case décochée, zéro. Condition écrite
 * d'après le type de la colonne, commune aux deux moteurs (en PostgreSQL, une date ou un booléen ne se compare pas à '').
 */
function renseignee(table: string, c: string): string {
  switch (TYPES_SQL.get(`${table}.${c}`)) {
    case 'bool': return `(${c} IS NOT NULL AND ${c} = TRUE)`;
    case 'int': case 'real': return `(${c} IS NOT NULL AND ${c} <> 0)`;
    default: return `(${c} IS NOT NULL AND CAST(${c} AS text) NOT IN ('', '[]'))`;
  }
}
const lier = (ou: string, empId: number) => Array.from({ length: (ou.match(/\?/g) ?? []).length }, () => empId);

/** Lignes dont la réécriture change la valeur, avec leur nouvelle valeur. */
async function aReecrire(db: Db, e: Etape & { reecrire: Reecriture }, empId: number): Promise<{ id: number; v: unknown }[]> {
  const out: { id: number; v: unknown }[] = [];
  for (const { id } of await db.query<{ id: number }>(`SELECT id FROM ${e.table} WHERE ${e.ou} ORDER BY id`, lier(e.ou, empId))) {
    const avant = (await db.get<Record<string, unknown>>(e.table as TableName, id))?.[e.reecrire.champ];
    if (avant === null || typeof avant !== 'object') continue;
    const v = e.reecrire.f(avant);
    if (JSON.stringify(v) !== JSON.stringify(avant)) out.push({ id, v });
  }
  return out;
}

/** Lignes ou valeurs qu'une étape effacerait encore. */
async function compter(db: Db, e: Etape, empId: number): Promise<number> {
  if (e.reecrire) return (await aReecrire(db, { ...e, reecrire: e.reecrire }, empId)).length;
  const reste = e.vider && !e.poser && !e.sql ? ` AND (${e.vider.map(c => renseignee(e.table, c)).join(' OR ')})` : '';
  return Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${e.table} WHERE ${e.ou}${reste}`, lier(e.ou, empId)))?.n ?? 0);
}

async function appliquer(db: Db, e: Etape, empId: number): Promise<number> {
  if (e.supprimer) return Number((await db.run(`DELETE FROM ${e.table} WHERE ${e.ou}`, lier(e.ou, empId))).changes);
  if (e.reecrire) {
    const lignes = await aReecrire(db, { ...e, reecrire: e.reecrire }, empId);
    for (const l of lignes) await db.update(e.table as TableName, l.id, { [e.reecrire.champ]: l.v });
    return lignes.length;
  }
  const n = await compter(db, e, empId);
  if (!n) return 0;
  // Case à cocher vidée : décochée (FALSE ; colonne NOT NULL en PostgreSQL, lue faux comme NULL en SQLite).
  const sets = [...(e.vider ?? []).map(c => `${c} = ${TYPES_SQL.get(`${e.table}.${c}`) === 'bool' ? 'FALSE' : 'NULL'}`), ...Object.keys(e.poser ?? {}).map(c => `${c} = ?`), ...Object.entries(e.sql ?? {}).map(([c, x]) => `${c} = ${x}`)];
  await db.run(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE ${e.ou}`, [...Object.values(e.poser ?? {}) as (string | number)[], ...lier(e.ou, empId)]);
  return n;
}

const cxNeutre = (ti: ISODate): Cx => ({ ti, le: '', par: '' });

/** Données d'une catégorie partielle encore présentes (lignes et valeurs). */
export async function aEffacer(db: Db, empId: number, cat: CategorieConservation, ti: ISODate = todayIso()): Promise<number> {
  let n = 0;
  // lot 11 — notes de frais : terme comptable d'après le réglage en vigueur, au jour `ti`.
  const cx = cat === 'frais' ? { ...cxNeutre(ti), fraisAns: (await loadSettings(db)).conservationFraisAns } : cxNeutre('');
  for (const e of etapes(db, cat, cx, empId)) n += await compter(db, e, empId);
  return n;
}

/**
 * Données encore présentes de chaque catégorie donnée (`aEffacer`), lues d'avance : les règles de shared/ les demandent
 * par une fonction synchrone (`aDesDonnees` de `categoriesEchues`, `categoriesDroitEffacement`).
 */
export async function quantitesAEffacer(db: Db, empId: number, categories: readonly CategorieConservation[], ti?: ISODate): Promise<Map<CategorieConservation, number>> {
  const out = new Map<CategorieConservation, number>();
  for (const c of new Set(categories)) out.set(c, await aEffacer(db, empId, c, ti));
  return out;
}

// lot 11 — notes de frais : salariés qui ont encore des données de frais (dossier anonymisé compris).
const DOSSIERS_AVEC_FRAIS = 'SELECT emp_id FROM notes_frais UNION SELECT emp_id FROM avances_frais UNION SELECT emp_id FROM vehicules_perso';

/**
 * Dossiers proposés à l'effacement : salariés sortis, non anonymisés, dont une catégorie qui a encore des données est
 * échue (une catégorie déjà effacée revient si des données y ont été saisies depuis), ou dont le dossier est échu. Vide
 * tant que la fonction n'est pas activée avec la décision du DPO.
 */
export async function dossiersEchus(db: Db, s?: Settings, ti: ISODate = todayIso()): Promise<DossierEchu[]> {
  s ??= await loadSettings(db);
  if (!conservationActive(s)) return [];
  // lot 11 — notes de frais : aussi les dossiers anonymisés qui gardent des notes de frais (ou leurs avances et véhicules),
  // reproposés quand ces données passent leur terme comptable.
  const sortis = (await db.query<{ id: number; fin: string; anonymise_le: string | null }>(
    `SELECT id, fin, anonymise_le FROM employes WHERE fin IS NOT NULL AND fin < ? AND (anonymise_le IS NULL OR id IN (${DOSSIERS_AVEC_FRAIS})) ORDER BY fin, id`, [ti]))
    .map(e => ({ id: e.id, fin: e.fin, anonymiseLe: e.anonymise_le }));
  const out: DossierEchu[] = [];
  for (const e of sortis) {
    // Catégories échues sans regarder les données (aucune lecture pour un dossier dont rien n'est échu), puis données
    // de celles-là seulement : même sélection que si chaque catégorie était comptée à la demande.
    const candidates = categoriesEchues(e, s, ti);
    if (!candidates) continue;
    const quantites = await quantitesAEffacer(db, e.id, candidates.categories, ti);
    const r = categoriesEchues(e, s, ti, c => (quantites.get(c) ?? 0) > 0);
    if (!r) continue;
    const elements = r.categories.reduce((n, c) => n + (quantites.get(c) ?? 0), 0);
    out.push({ empId: e.id, fin: e.fin, categories: r.categories, dossier: r.dossier, elements });
  }
  return out;
}

// — Retrait de l'identité des textes de la base —

/**
 * Termes d'identité retirés des textes : nom et adresses e-mail de la fiche et des comptes. L'identifiant de connexion
 * n'est retenu que s'il est une adresse complète : un identifiant local (« marc », « paie ») est souvent un mot courant.
 * Un terme sans espace ni « @ » (nom d'un seul mot) doit avoir 8 caractères au moins, les autres 4.
 */
async function identite(db: Db, empId: number): Promise<string[]> {
  const e = await db.get<Employe>('employes', empId);
  const comptes = await db.query<{ nom: string | null; adresse: string | null; identifiant: string | null }>('SELECT nom, adresse, identifiant FROM comptes WHERE emp_id = ?', [empId]);
  return [...new Set([e?.nom, e?.email, ...comptes.flatMap(c => [c.nom, c.adresse, c.identifiant?.includes('@') ? c.identifiant : null])]
    .filter((t): t is string => typeof t === 'string').map(t => t.trim())
    .filter(t => t.length >= (/[\s@]/.test(t) ? 4 : 8)))]
    .filter(t => !t.startsWith('anonyme-') && !t.startsWith('Salarié anonymisé'))
    .sort((a, b) => b.length - a.length);
}

/**
 * Hors balayage : la fiche et les comptes des autres salariés (seules les lignes du salarié visé sont balayées : une
 * réembauche ou un homonyme garde son nom et son adresse), les réglages de l'application (codes, boîtes partagées) et le
 * nom de l'action au journal (code).
 */
const LIGNES_DU_SALARIE: Partial<Record<string, string>> = { employes: 'id', comptes: 'emp_id' };
const TABLES_EXCLUES = new Set(['settings']);
const COLONNES_EXCLUES = new Set(['journal.action']);

const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Occurrence délimitée d'un terme, sans tenir compte de la casse : ni précédée ni suivie d'une lettre, d'un chiffre, de
 * « _ », « - », « @ » ou « . » (un point final de phrase, suivi d'une espace ou de la fin, reste un séparateur).
 * « Jean Martin » ne touche ni « Jean Martineau » ni « jean.martin@… ».
 */
export const motifTerme = (t: string) => new RegExp(`(?<![\\p{L}\\p{N}_@.-])${echapper(t)}(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}])`, 'giu');

/**
 * Balayage : chaque occurrence délimitée d'un terme est remplacée par le nom neutre dans les colonnes de texte et JSON du
 * schéma (journal des actions et son auteur, file d'envoi, notifications, comptes rendus de reprise, auteurs nommés dans
 * d'autres dossiers, motif de la trace de l'effacement…). Les lignes candidates sont repérées en SQL, le remplacement
 * borné est fait ici. Renvoie le nombre de valeurs modifiées.
 */
export async function retirerIdentite(db: Db, empId: number, termes: readonly string[], neutre: string): Promise<number> {
  if (!termes.length) return 0;
  let n = 0;
  for (const [table, def] of Object.entries(TABLES) as [string, { pk: string; cols: Record<string, string> }][]) {
    const t = snake(table);
    if (TABLES_EXCLUES.has(t)) continue;
    const borne = LIGNES_DU_SALARIE[t];
    // Ligne désignée par sa clé (PostgreSQL n'a pas de rowid) ; valeur lue en texte (JSON compris : le texte écrit).
    const cle = snake(def.pk);
    for (const [col, type] of Object.entries(def.cols)) {
      const c = snake(col);
      if ((type !== 'text' && type !== 'json') || COLONNES_EXCLUES.has(`${t}.${c}`)) continue;
      // JSON : le terme aussi tel qu'il est écrit dans une chaîne JSON (guillemets et barres obliques échappés).
      const formes = [...new Set(termes.flatMap(x => [x, ...(type === 'json' ? [JSON.stringify(x).slice(1, -1)] : [])]))].sort((a, b) => b.length - a.length);
      // Lignes candidates (sous-chaîne, sans tenir compte de la casse ; un « _ » ou un « % » du terme élargit seulement la
      // sélection) ; le remplacement borné est fait ici.
      const lignes = await db.query<{ r: SqlValeur; v: string }>(`SELECT ${cle} AS r, CAST(${c} AS text) AS v FROM ${t} WHERE (${formes.map(() => `lower(CAST(${c} AS text)) LIKE '%' || lower(CAST(? AS text)) || '%'`).join(' OR ')})${borne ? ` AND ${borne} = ?` : ''}`,
        [...formes, ...(borne ? [empId] : [])]);
      for (const l of lignes) {
        const v = formes.reduce((x, f) => x.replace(motifTerme(f), neutre), l.v);
        if (v === l.v) continue;
        await db.run(`UPDATE ${t} SET ${c} = ? WHERE ${cle} = ?`, [v, l.r]);
        n++;
      }
    }
  }
  return n;
}

/**
 * Efface les catégories données (partielles, et le dossier : anonymisation complète, qui reprend les étapes de toutes
 * les catégories, idempotentes, y compris celles déjà effacées où des données sont revenues) et trace l'effacement
 * (table `effacements`, écrite avant le balayage : un motif qui nomme le salarié ne garde pas son nom). Dans la
 * transaction de l'action ; les fichiers des pièces sont effacés après sa validation. Renvoie le nombre d'éléments effacés.
 */
export async function effacer(db: Db, empId: number, categories: readonly CategorieConservation[], cx: Cx, o: { motif: string; avantEcheance: boolean }): Promise<number> {
  const dossier = categories.includes('dossier');
  const liste = dossier ? [...CATEGORIES.filter(c => c !== 'dossier'), 'dossier' as const] : categories.filter(c => c !== 'dossier');
  const termes = dossier ? await identite(db, empId) : [];
  // lot 11 — notes de frais : terme comptable d'après le réglage en vigueur.
  cx = { ...cx, fraisAns: cx.fraisAns ?? (await loadSettings(db)).conservationFraisAns };
  let elements = 0;
  for (const c of liste) for (const e of etapes(db, c, cx, empId)) elements += await appliquer(db, e, empId);
  await db.insert('effacements', { empId, categories: liste, le: cx.le, par: cx.par, motif: o.motif, avantEcheance: o.avantEcheance, elements });
  if (dossier) await retirerIdentite(db, empId, termes, nomAnonyme(empId));
  nettoyerBientot(db);
  return elements;
}

// — Signalement quotidien au service RH (aucun effacement) —

/** Réglages : jour du dernier passage, et dossiers déjà signalés (identifiants), pour ne signaler que les nouveaux. */
const VERIFIEE_LE = 'conservationVerifieeLe', SIGNALES = 'conservationSignales';

/**
 * Une fois par jour : dossiers échus calculés ; s'il en apparaît de nouveaux, notification à la boîte du service RH (dans
 * son récapitulatif quotidien) et ligne au journal, sans nom (nombre et identifiants). Rien n'est effacé. Renvoie le
 * nombre de dossiers échus, null si le passage du jour est déjà fait.
 */
export async function verifierConservation(db: Db, ti: ISODate = todayIso()): Promise<number | null> {
  // Jour du dernier passage lu dans la transaction qui le note : deux passages simultanés n'en font qu'un.
  return await db.tx(async () => {
    if (await db.getSetting<string | null>(VERIFIEE_LE, null) === ti) return null;
    await db.setSetting(VERIFIEE_LE, ti);
    const echus = await dossiersEchus(db, await loadSettings(db), ti);
    const signales = new Set(await db.getSetting<number[]>(SIGNALES, []));
    const nouveaux = echus.filter(d => !signales.has(d.empId));
    await db.setSetting(SIGNALES, echus.map(d => d.empId));
    if (!nouveaux.length) return echus.length;
    const rh = (await lireMessagerie(db)).rh;
    const texte = `${plural(echus.length, 'dossier de salarié sorti a', 'dossiers de salariés sortis ont')} une durée de conservation échue `
      + `(${plural(nouveaux.length, 'nouveau', 'nouveaux')} depuis le dernier signalement). Cursus n’efface rien de lui-même : l’administrateur RH les examine `
      + 'et confirme chaque effacement dans Paramètres → Conservation des dossiers.';
    if (rh) {
      await db.insert('notifications', { empId: null, adresse: rh, type: 'conservation.echus', objet: 'Dossiers de salariés sortis à effacer', texte, creation: new Date().toISOString(), envoiId: null });
    }
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'conservation.signalement', message: `Conservation des dossiers au ${fmtIso(ti)} : ${texte.split(' (')[0]}`,
      payload: { echus: echus.length, nouveaux: nouveaux.map(d => d.empId) }, salaries: nouveaux.map(d => d.empId),
    });
    return echus.length;
  });
}

/** Au démarrage puis toutes les heures (un passage par jour) ; renvoie la fonction d'arrêt (server/src/index.ts). */
export async function demarrerConservation(db: Db): Promise<() => void> {
  const passer = async () => {
    try { await verifierConservation(db); } catch (err) { log.erreur(`Conservation des dossiers : ${err instanceof Error ? err.message : err}`); }
  };
  await passer();
  const t = setInterval(async () => await passer(), 3600_000);
  t.unref();
  return () => clearInterval(t);
}

/** Libellé d'une catégorie (messages). */
export const libelleCategorie = (c: CategorieConservation) => CATEGORIES_CONSERVATION[c].label;
