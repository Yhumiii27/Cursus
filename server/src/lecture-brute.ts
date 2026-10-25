// Lecture brute de la base et assemblage de l'instantané complet (lot 9, chantier 2, étape 1). La lecture complète
// (`loadFull`, server/src/dataset.ts) se fait désormais en deux temps :
// - `lireBrut(db)` lit les tables telles quelles (lignes décodées, dans l'ordre de leur clé ou de la colonne de tri de
//   `ORDRE_LECTURE`), plus cinq réglages et le statut des envois des relevés : aucune jointure ni aucun calcul ;
// - `assembler(brut, today, revision, user)` en tire le Dataset, sans lire la base : jointure des employés et de leurs
//   titres, nombre d'inscrits et places proposées des sessions, positions dans les listes d'attente, annuaire, début de
//   la saisie des feuilles, effectif du site, budgets, plan, reprises (de la plus récente à la plus ancienne), lots de
//   paie, relevés avec le statut de leur envoi, pièces. Chaque dérivé est mémoïsé sur l'identité de ses entrées : une
//   lecture brute qui reprend un tableau inchangé (delta fusionné, étape 2) reprend aussi les dérivés qui n'en dépendent
//   que, sans les recalculer.
// Les absences et déplacements en attente du fichier de paie lisent encore la base (contenu figé des lots, éléments
// émis) : `loadFull` les ajoute après l'assemblage, comme avant.
// `LECTURES` dit, pour chaque champ de l'instantané complet, les tables lues pour le remplir ; `HORS_INSTANTANE`, les
// tables à révision jamais lues par l'instantané. tests/lecture-brute.test.ts contrôle, par un espion sur `db.query`, que
// les tables réellement lues par `loadFull` sont exactement l'union de `LECTURES`, et que chaque table de TABLES est
// lue, hors de l'instantané ou sans révision (`TABLES_SANS_REVISION`).
import { configurerFeries } from '../../shared/dates.ts';
import { reglagesParDefaut } from '../../shared/reglages.ts';
import { avecPositions, avecProposees } from '../../shared/rules/liste-attente.ts';
import { avecInscrits } from '../../shared/rules/sessions.ts';
import { completerSession } from '../../shared/rules/plage-session.ts';
import { debutSaisieDe } from '../../shared/rules/suivi-feuilles.ts';
import { effectifSite } from '../../shared/rules/delegation.ts';
import type {
  Absence, Astreinte, AttenteSession, AvenantForfait, CalendrierFeries, Certification, CetMouvement, Chantier, ClotureConges, ContratHistorique, CurrentUser, Dataset,
  DeclarationPasseport, DelegationValidation, DemandeCollab, DemandeKeystone, DemandeVisite, DerogationDominicale, Destination, Employe, Entretien, Envoi,
  Equipe, EvaluationFormation, ExerciceClos, FeuilleTemps, Formation, FormationSuivie, FormatFichierPaie, Fractionnement, HabDelivrance, HabTitre, HabType,
  Horaire, InformationCp, Inscription, InterventionAstreinte, LotPaie, LotReprise, Mandat, Messagerie, Mission, Participation, PlanAction, Poste, Projet,
  ReleveInterim, ReportCp, RubriquePaie, Session, Settings, SoldeReprise, SoldeSortie, TacheKeystone, Vaccination, Visa, Voyage,
} from '../../shared/types.ts';
import type { Db, TableName } from './db.ts';
import { formatFichierDe } from './lots-paie.ts';
import { messagerieDe } from './messagerie.ts';
import { type PieceEnregistree, piecesDe } from './pieces.ts';

/** Réglages par défaut : colonne `defaut` de la table des réglages (shared/reglages.ts) ; `DEFAULT_SETTINGS` de server/src/dataset.ts. */
export const REGLAGES_DEFAUT: Settings = reglagesParDefaut();

/** Réglages de l'application : le réglage `app` enregistré, complété des valeurs par défaut. */
export function reglagesDe(enregistre: Partial<Settings> & { rhNom?: string; rhIntitule?: string }): Settings {
  // `rhNom` et `rhIntitule` (anciennes bases) désignaient le RH unique : l'identité vient désormais du compte connecté.
  const { rhNom: _n, rhIntitule: _i, ...app } = enregistre;
  return { ...REGLAGES_DEFAUT, ...app };
}

/** Fiche telle qu'elle est enregistrée : passeport en deux colonnes, sans les titres (tables à part). */
export type EmpRow = Omit<Employe, 'passeport' | 'certs' | 'habs' | 'visas' | 'vaccins'> & { passeportNumero: string | null; passeportExpire: string | null };

/** Réglages (table `settings`) lus par l'instantané, tels qu'enregistrés (valeur par défaut de `getSetting` sinon). */
export interface ReglagesBruts {
  app: Partial<Settings> & { rhNom?: string; rhIntitule?: string };
  calendrierFeries: CalendrierFeries;
  formatFichierPaie: Partial<FormatFichierPaie>;
  messagerie: Partial<Messagerie>;
  derogationsDominicales: DerogationDominicale[];
}

/**
 * Lecture brute de la base : une propriété par table lue, du nom de la table (lignes décodées, dans l'ordre de leur clé
 * ou de `ORDRE_LECTURE`), plus les réglages et le statut des envois des relevés. Jamais modifiée : un delta (étape 2)
 * en fait une nouvelle, qui reprend les tableaux des tables inchangées.
 */
export interface Brut {
  certifications: Certification[];
  habTitres: HabTitre[];
  visas: Visa[];
  vaccinations: Vaccination[];
  inscriptions: Inscription[];
  participations: Participation[];
  attentesSession: AttenteSession[];
  employes: EmpRow[];
  feuilles: FeuilleTemps[];
  budgets: { exercice: number; equipe: string; montant: number }[];
  formations: Formation[];
  habilitations: HabType[];
  destinations: Destination[];
  postes: Poste[];
  equipes: Equipe[];
  horaires: Horaire[];
  projets: Projet[];
  chantiers: Chantier[];
  sessions: Omit<Session, 'inscrits'>[];
  planActions: PlanAction[];
  exercicesClos: ExerciceClos[];
  voyages: Voyage[];
  demandesKeystone: DemandeKeystone[];
  missions: Mission[];
  taches: TacheKeystone[];
  absences: Absence[];
  cet: CetMouvement[];
  reports: ReportCp[];
  soldesReprise: SoldeReprise[];
  clotures: ClotureConges[];
  informationsCp: InformationCp[];
  fractionnements: Fractionnement[];
  soldesSortie: SoldeSortie[];
  contratsHistorique: ContratHistorique[];
  avenantsForfait: AvenantForfait[];
  entretiens: Entretien[];
  demandesCollab: DemandeCollab[];
  demandesVisite: DemandeVisite[];
  /** Lots de paie dans l'ordre de leur clé, sans la colonne `contenu` (lu par le seul téléchargement du fichier). */
  lotsPaie: LotPaie[];
  rubriquesPaie: RubriquePaie[];
  releves: Omit<ReleveInterim, 'envoi'>[];
  reprises: LotReprise[];
  mandats: Mandat[];
  /** Pièces enregistrées, en attente comprises (sans objet) : `assembler` n'en garde que la description des pièces jointes. */
  pieces: PieceEnregistree[];
  formationsSuivies: FormationSuivie[];
  habDelivrances: HabDelivrance[];
  delegations: DelegationValidation[];
  astreintes: Astreinte[];
  astreinteInterventions: InterventionAstreinte[];
  declarationsPasseport: DeclarationPasseport[];
  evaluationsFormation: EvaluationFormation[];
  reglages: ReglagesBruts;
  /** Statut de l'e-mail de chaque relevé (envois désignés par `releves.envoiId` seulement). */
  statutsEnvoi: ReadonlyMap<number, Envoi['statut']>;
}

/** Tables lues dans l'ordre d'une autre colonne que leur clé (`rowid` : ordre d'insertion ; `rang` en PostgreSQL). */
export const ORDRE_LECTURE: Partial<Record<TableName, string>> = {
  formations: 'rowid', habilitations: 'rowid', destinations: 'rowid', postes: 'nom', equipes: 'ordre', horaires: 'rowid', projets: 'rowid', chantiers: 'debut',
};

/** Identifiants passés au plus par requête `IN (…)` (bien en deçà des limites de SQLite et de PostgreSQL). */
const PAR_REQUETE_IN = 500;

/**
 * Statut des envois des relevés (lot 8, chantier E) : requêtes `IN (…)` de 500 identifiants au plus, au lieu d'une
 * lecture par relevé (680 relevés après 5 ans).
 */
async function statutsDesEnvois(db: Db, releves: readonly Pick<ReleveInterim, 'envoiId'>[]): Promise<Map<number, Envoi['statut']>> {
  const ids = [...new Set(releves.map(r => r.envoiId).filter((id): id is number => !!id))];
  const statuts = new Map<number, Envoi['statut']>();
  for (let i = 0; i < ids.length; i += PAR_REQUETE_IN) {
    const lot = ids.slice(i, i + PAR_REQUETE_IN);
    for (const e of await db.query<{ id: number; statut: Envoi['statut'] }>(`SELECT id, statut FROM envois WHERE id IN (${lot.map(() => '?').join(', ')})`, lot)) statuts.set(Number(e.id), e.statut);
  }
  return statuts;
}

/**
 * Lecture brute de la base, à faire dans une lecture stable (`Db.lecture`) ou une transaction : les tables, les réglages
 * et le statut des envois des relevés, tels quels.
 */
export async function lireBrut(db: Db): Promise<Brut> {
  const lire = async <T>(t: TableName) => await db.all<T>(t, ORDRE_LECTURE[t]);
  const releves = await lire<Omit<ReleveInterim, 'envoi'>>('releves');
  return {
    certifications: await lire('certifications'),
    habTitres: await lire('habTitres'),
    visas: await lire('visas'),
    vaccinations: await lire('vaccinations'),
    inscriptions: await lire('inscriptions'),
    participations: await lire('participations'),
    attentesSession: await lire('attentesSession'),
    employes: await lire('employes'),
    feuilles: await lire('feuilles'),
    budgets: await lire('budgets'),
    formations: await lire('formations'),
    habilitations: await lire('habilitations'),
    destinations: await lire('destinations'),
    postes: await lire('postes'),
    equipes: await lire('equipes'),
    horaires: await lire('horaires'),
    projets: await lire('projets'),
    chantiers: await lire('chantiers'),
    sessions: await lire('sessions'),
    planActions: await lire('planActions'),
    exercicesClos: await lire('exercicesClos'),
    voyages: await lire('voyages'),
    demandesKeystone: await lire('demandesKeystone'),
    missions: await lire('missions'),
    taches: await lire('taches'),
    absences: await lire('absences'),
    cet: await lire('cet'),
    reports: await lire('reports'),
    soldesReprise: await lire('soldesReprise'),
    clotures: await lire('clotures'),
    informationsCp: await lire('informationsCp'),
    fractionnements: await lire('fractionnements'),
    soldesSortie: await lire('soldesSortie'),
    contratsHistorique: await lire('contratsHistorique'),
    avenantsForfait: await lire('avenantsForfait'),
    entretiens: await lire('entretiens'),
    demandesCollab: await lire('demandesCollab'),
    demandesVisite: await lire('demandesVisite'),
    // Colonne `contenu` jamais lue ici (lot 8, chantier E) : 70 à 90 lots de 50 à 300 Ko chacun après 5 ans.
    lotsPaie: await db.allSans<LotPaie>('lotsPaie', ['contenu']),
    rubriquesPaie: await lire('rubriquesPaie'),
    releves,
    reprises: await lire('reprises'),
    mandats: await lire('mandats'),
    pieces: await lire('pieces'),
    formationsSuivies: await lire('formationsSuivies'),
    habDelivrances: await lire('habDelivrances'),
    delegations: await lire('delegations'),
    astreintes: await lire('astreintes'),
    astreinteInterventions: await lire('astreinteInterventions'),
    declarationsPasseport: await lire('declarationsPasseport'),
    evaluationsFormation: await lire('evaluationsFormation'),
    reglages: {
      app: await db.getSetting<ReglagesBruts['app']>('app', {}),
      calendrierFeries: await db.getSetting<CalendrierFeries>('calendrierFeries', {}),
      formatFichierPaie: await db.getSetting<Partial<FormatFichierPaie>>('formatFichierPaie', {}),
      messagerie: await db.getSetting<Partial<Messagerie>>('messagerie', {}),
      derogationsDominicales: await db.getSetting<DerogationDominicale[]>('derogationsDominicales', []),
    },
    statutsEnvoi: await statutsDesEnvois(db, releves),
  };
}

/** Étage de la mémoïsation : suite par entrée objet (WeakMap) ou valeur simple (date du jour), résultat au dernier étage. */
interface Etage<R> { objets: WeakMap<object, Etage<R>>; valeurs: Map<unknown, Etage<R>>; fait?: { r: R } }
const etage = <R>(): Etage<R> => ({ objets: new WeakMap(), valeurs: new Map() });

/**
 * Mémoïsation d'un dérivé sur l'identité de ses entrées : rappelée avec les mêmes objets (comparés par identité) et les
 * mêmes valeurs simples, la fonction rend le même résultat sans recalculer, même si d'autres entrées ont servi entre-
 * temps (entrée du cache et jeu d'une action dérivés de la même lecture). Les objets sont des clés de WeakMap : aucun
 * résultat n'est retenu au-delà de la vie de ses entrées, une lecture abandonnée libère ses dérivés.
 */
function memo<A extends [object, ...unknown[]], R>(f: (...a: A) => R): (...a: A) => R {
  const racine = etage<R>();
  return (...a: A) => {
    let e = racine;
    for (const x of a) {
      const objet = typeof x === 'object' && x !== null;
      const suite = objet ? e.objets.get(x) : e.valeurs.get(x);
      if (suite) e = suite;
      else {
        const n = etage<R>();
        if (objet) e.objets.set(x, n);
        else e.valeurs.set(x, n);
        e = n;
      }
    }
    e.fait ??= { r: f(...a) };
    return e.fait.r;
  };
}

/** Lignes regroupées par salarié, dans l'ordre de la table (comme un `filter` par salarié, en un seul parcours). */
function parSalarie<T extends { empId: number | null }>(lignes: readonly T[]): Map<number | null, T[]> {
  const m = new Map<number | null, T[]>();
  for (const l of lignes) {
    const g = m.get(l.empId);
    if (g) g.push(l);
    else m.set(l.empId, [l]);
  }
  return m;
}

// — Dérivés, chacun mémoïsé sur l'identité de ses entrées —

/** Certification annulée (saisie erronée, `cert.annuler`) : hors de tous les calculs, gardée à part pour le service RH. */
const certsDe = memo((toutes: Certification[]) => ({ certs: toutes.filter(c => !c.annuleLe), annulees: toutes.filter(c => c.annuleLe) }));

/** Fiches jointes à leurs titres : certifications (en vigueur et annulées), habilitations, visas, vaccinations. */
const employesDe = memo((lignes: EmpRow[], certs: Certification[], annulees: Certification[], habs: HabTitre[], visas: Visa[], vaccins: Vaccination[]): Employe[] => {
  const c = parSalarie(certs), a = parSalarie(annulees), h = parSalarie(habs), vi = parSalarie(visas), va = parSalarie(vaccins);
  return lignes.map(({ passeportNumero, passeportExpire, ...e }) => ({
    ...e,
    jourOff: e.jourOff ?? [],
    notifications: e.notifications === 'quotidien' ? 'quotidien' : 'immediat',
    restrictions: e.restrictions ?? [],
    passeport: passeportNumero && passeportExpire ? { numero: passeportNumero, expire: passeportExpire } : null,
    certs: c.get(e.id) ?? [],
    certsAnnulees: a.get(e.id) ?? [],
    habs: h.get(e.id) ?? [],
    visas: vi.get(e.id) ?? [],
    vaccins: va.get(e.id) ?? [],
  }));
});

const annuaireDe = memo((employes: Employe[]) => employes.map(e => ({ id: e.id, nom: e.nom, equipe: e.equipe, poste: e.poste })));

/** Listes d'attente des sessions complètes (lot 7, t120) : place de chacun dans sa file calculée sur toutes les attentes. */
const attentesDe = memo((attentes: AttenteSession[]) => avecPositions(attentes));

/**
 * Nombre d'inscrits calculé sur toutes les données, avant la restriction au périmètre. Session d'une base ancienne ou
 * écrite sans plage : un seul jour (completerSession). Places proposées à la liste d'attente (lot 7, t120), comptées
 * sur toute la file.
 */
const sessionsDe = memo((sessions: Omit<Session, 'inscrits'>[], certs: Certification[], inscriptions: Inscription[], participations: Participation[], attentes: AttenteSession[]) =>
  avecProposees(avecInscrits(sessions.map(completerSession), certs, inscriptions, participations), attentes));

const budgetsDe = memo((lignes: Brut['budgets']) => {
  const budgets: Dataset['budgets'] = {};
  for (const b of lignes) (budgets[String(b.exercice)] ||= {})[b.equipe] = b.montant;
  return budgets;
});

/** Ligne du plan supprimée (saisie erronée, `plan.supprimer`, demande rouverte) : hors de l'instantané et des calculs. */
const planDe = memo((lignes: PlanAction[]) => lignes.filter(l => !l.annuleLe));
/** Lots importés à la mise en service, du plus récent au plus ancien. */
const reprisesDe = memo((lignes: LotReprise[]) => [...lignes].reverse());
/** Lots de paie, du plus récent au plus ancien. */
const lotsDe = memo((lignes: LotPaie[]) => [...lignes].reverse());
const debutSaisie = memo((feuilles: FeuilleTemps[]) => debutSaisieDe(feuilles));
const effectifDe = memo((employes: Employe[], today: string) => effectifSite({ employes }, today));
const relevesDe = memo((releves: Omit<ReleveInterim, 'envoi'>[], statuts: ReadonlyMap<number, Envoi['statut']>): ReleveInterim[] =>
  releves.map(r => ({ ...r, envoi: r.envoiId ? statuts.get(r.envoiId) ?? null : null })));
const piecesDeBrut = memo((lignes: PieceEnregistree[]) => piecesDe(lignes));
const settingsDe = memo((app: ReglagesBruts['app']) => reglagesDe(app));
const formatDe = memo((f: Partial<FormatFichierPaie>) => formatFichierDe(f));
const messagerieDeBrut = memo((m: Partial<Messagerie>) => messagerieDe(m));
const referentielsDe = memo((formations: Formation[], habilitations: HabType[], destinations: Destination[], postes: Poste[], equipes: Equipe[], horaires: Horaire[], projets: Projet[], chantiers: Chantier[]) =>
  ({ formations, habilitations, destinations, postes, equipes, horaires, projets, chantiers }));

/**
 * Instantané complet tiré de la lecture brute, sans lire la base ni modifier `brut` : le Dataset de `loadFull`, ligne
 * pour ligne et dans le même ordre, sans les absences et déplacements en attente du fichier de paie (ajoutés par
 * `loadFull`). Pose les jours fériés réglés (état de module de shared/dates.ts), comme la lecture d'avant, avant tout
 * calcul de l'instantané (isFerie).
 */
export function assembler(brut: Brut, today: string, revision: number, user: CurrentUser): Dataset {
  const { calendrierFeries, derogationsDominicales } = brut.reglages;
  configurerFeries(calendrierFeries);
  const { certs, annulees } = certsDe(brut.certifications);
  const employes = employesDe(brut.employes, certs, annulees, brut.habTitres, brut.visas, brut.vaccinations);
  const attentesSession = attentesDe(brut.attentesSession);
  return {
    today,
    revision,
    user,
    settings: settingsDe(brut.reglages.app),
    // Formations, habilitations et destinations, archivées comprises (`archive`, date d'archivage) : transmises à tous les
    // espaces, qui en ont besoin pour nommer les titres et écarter les archivées des listes ; aucune donnée personnelle.
    // Postes et exigences (shared/rules/exigences.ts), horaires de poste (shared/rules/horaires.ts) : idem.
    referentiels: referentielsDe(brut.formations, brut.habilitations, brut.destinations, brut.postes, brut.equipes, brut.horaires, brut.projets, brut.chantiers),
    annuaire: annuaireDe(employes),
    employes,
    sessions: sessionsDe(brut.sessions, certs, brut.inscriptions, brut.participations, attentesSession),
    inscriptions: brut.inscriptions,
    participations: brut.participations,
    plan: planDe(brut.planActions),
    budgets: budgetsDe(brut.budgets),
    exercicesClos: brut.exercicesClos,
    voyages: brut.voyages,
    demandesKeystone: brut.demandesKeystone,
    missions: brut.missions,
    taches: brut.taches,
    feuilles: brut.feuilles,
    absences: brut.absences,
    cet: brut.cet,
    reports: brut.reports,
    soldesReprise: brut.soldesReprise,
    clotures: brut.clotures,
    // Informations au retour d'un arrêt (art. L3141-19-3) : elles désignent un arrêt de santé, service RH et intéressé.
    informationsCp: brut.informationsCp,
    fractionnements: brut.fractionnements,
    soldesSortie: brut.soldesSortie,
    contratsHistorique: brut.contratsHistorique,
    avenantsForfait: brut.avenantsForfait,
    entretiens: brut.entretiens,
    demandesCollab: brut.demandesCollab,
    demandesVisite: brut.demandesVisite,
    // Début de la saisie des feuilles, sur toutes les feuilles : transmis tel quel à tous les espaces (une date).
    debutSaisieFeuilles: debutSaisie(brut.feuilles),
    lotsPaie: lotsDe(brut.lotsPaie),
    formatFichierPaie: formatDe(brut.reglages.formatFichierPaie),
    rubriquesPaie: brut.rubriquesPaie,
    messagerie: messagerieDeBrut(brut.reglages.messagerie),
    releves: relevesDe(brut.releves, brut.statutsEnvoi),
    reprises: reprisesDe(brut.reprises),
    derogationsDominicales,
    calendrierFeries,
    mandats: brut.mandats,
    // Effectif du site (un nombre) pour la limite de délégation d'un suppléant : calculé sur toutes les fiches, car
    // l'instantané de l'élu ne contient que lui-même (ou son équipe).
    effectifCse: effectifDe(employes, today),
    pieces: piecesDeBrut(brut.pieces),
    formationsSuivies: brut.formationsSuivies,
    habDelivrances: brut.habDelivrances,
    delegations: brut.delegations,
    astreintes: brut.astreintes,
    interventionsAstreinte: brut.astreinteInterventions,
    attentesSession,
    declarationsPasseport: brut.declarationsPasseport,
    evaluationsFormation: brut.evaluationsFormation,
  };
}

/** Tables lues par les absences et déplacements en attente du fichier de paie (`resumeAbsencesPaie`, `resumeDeplacementsPaie`). */
export const DEP_PAIE: readonly TableName[] = ['lotsPaie', 'deplacementsPaie', 'rubriquesPaie', 'settings'];

/**
 * Registre des dépendances : pour chaque champ de l'instantané complet (`loadFull`, hors `today`, `revision` et `user`),
 * les tables lues pour le remplir. Un champ ne change que si l'une de ses tables a changé (cache incrémental, étape 2).
 * `absencesPaie` et `deplacementsPaie` ne sont lus que pour un profil qui voit la paie.
 */
export const LECTURES = {
  settings: ['settings'],
  referentiels: ['formations', 'habilitations', 'destinations', 'postes', 'equipes', 'horaires', 'projets', 'chantiers'],
  annuaire: ['employes'],
  employes: ['employes', 'certifications', 'habTitres', 'visas', 'vaccinations'],
  sessions: ['sessions', 'certifications', 'inscriptions', 'participations', 'attentesSession'],
  inscriptions: ['inscriptions'],
  participations: ['participations'],
  plan: ['planActions'],
  budgets: ['budgets'],
  exercicesClos: ['exercicesClos'],
  voyages: ['voyages'],
  demandesKeystone: ['demandesKeystone'],
  missions: ['missions'],
  taches: ['taches'],
  feuilles: ['feuilles'],
  absences: ['absences'],
  cet: ['cet'],
  reports: ['reports'],
  soldesReprise: ['soldesReprise'],
  clotures: ['clotures'],
  informationsCp: ['informationsCp'],
  fractionnements: ['fractionnements'],
  soldesSortie: ['soldesSortie'],
  contratsHistorique: ['contratsHistorique'],
  avenantsForfait: ['avenantsForfait'],
  entretiens: ['entretiens'],
  demandesCollab: ['demandesCollab'],
  demandesVisite: ['demandesVisite'],
  debutSaisieFeuilles: ['feuilles'],
  lotsPaie: ['lotsPaie'],
  formatFichierPaie: ['settings'],
  rubriquesPaie: ['rubriquesPaie'],
  messagerie: ['settings'],
  releves: ['releves', 'envois'],
  reprises: ['reprises'],
  derogationsDominicales: ['settings'],
  calendrierFeries: ['settings'],
  mandats: ['mandats'],
  effectifCse: ['employes'],
  pieces: ['pieces'],
  formationsSuivies: ['formationsSuivies'],
  habDelivrances: ['habDelivrances'],
  delegations: ['delegations'],
  astreintes: ['astreintes'],
  interventionsAstreinte: ['astreinteInterventions'],
  attentesSession: ['attentesSession'],
  declarationsPasseport: ['declarationsPasseport'],
  evaluationsFormation: ['evaluationsFormation'],
  absencesPaie: ['lotsPaie', 'rubriquesPaie', 'settings'],
  deplacementsPaie: DEP_PAIE,
} as const satisfies Partial<Record<keyof Dataset, readonly TableName[]>>;

/**
 * Tables à révision que l'instantané ne lit jamais : file d'envoi (seul le statut des envois des relevés est lu),
 * notifications en attente du récapitulatif, verdicts transmis à Keystone, relances déjà faites, effacements au titre
 * de la conservation (registre du service RH, lu à part). Leur écriture augmente la révision sans changer l'instantané.
 */
export const HORS_INSTANTANE: ReadonlySet<TableName> = new Set<TableName>(['notifications', 'verdictsKeystone', 'relances', 'effacements']);

/** Tables lues par l'instantané complet : l'union de `LECTURES`. */
export const TABLES_LUES: ReadonlySet<TableName> = new Set<TableName>(Object.values(LECTURES).flat());
