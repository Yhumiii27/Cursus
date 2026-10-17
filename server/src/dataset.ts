// Assemblage de l'instantané complet depuis la base, puis restriction au
// périmètre de l'utilisateur connecté (RH : tout ; profils restreints de l'espace RH :
// ce que leurs droits ouvrent ; manager : son équipe ; collaborateur : ses propres données).
import { Domain } from '../../shared/domain.ts';
import { addD, isoParis, isValidDate, mondayOf } from '../../shared/dates.ts';
import { absenceVueManager, repriseMedicale } from '../../shared/rules/absences.ts';
import { aptitudeVueManager } from '../../shared/rules/sante.ts';
import { visiteAProgrammer } from '../../shared/rules/visites-dues.ts';
import { naissanceVueManager } from '../../shared/rules/mineurs.ts';
import { needsFinCarriere } from '../../shared/rules/entretiens.ts';
import { verdictAutorisation } from '../../shared/rules/contrats.ts';
import { completerSession } from '../../shared/rules/plage-session.ts';
import { avecInscrits } from '../../shared/rules/sessions.ts';
import { finPeriodeCp, periodeReport } from '../../shared/rules/conges.ts';
import { debutSaisieDe } from '../../shared/rules/suivi-feuilles.ts';
import { effectifSite } from '../../shared/rules/delegation.ts';
import { reglagesParDefaut } from '../../shared/reglages.ts';
import type { DemandeVisite, LotReprise } from '../../shared/types.ts';
import type {
  Absence, Certification, Inscription, CetMouvement, Chantier, ClotureConges, CurrentUser, Dataset, DemandeCollab, DemandeKeystone, Destination, Employe, Entretien,
  DerogationDominicale, Envoi, Equipe, ExerciceClos, FeuilleTemps, Formation, HabTitre, HabType, ISODate, Mandat, Mission, Participation, PlanAction, Poste, Projet, ReleveInterim,
  ReportCp, RubriquePaie, Session,
  Settings, SoldeReprise, TacheKeystone, Vaccination, Visa, Voyage,
} from '../../shared/types.ts';
import { type DroitRh, droitsRh, PROFILS_RH } from '../../shared/constants.ts';
import type { Db } from './db.ts';
import type { SessionInfo } from './auth.ts';
import { compteValide, espacesDuCompte, nomDuCompte } from './comptes.ts';
import { lireFormatFichier, lireLots } from './lots-paie.ts';
import { lireMessagerie } from './messagerie.ts';

/** Réglages par défaut : colonne `defaut` de la table des réglages (shared/reglages.ts). */
export const DEFAULT_SETTINGS: Settings = reglagesParDefaut();

/**
 * Date du jour à Paris, quel que soit le fuseau du serveur (souvent UTC chez l'hébergeur : entre minuit et 2 h,
 * ce serait encore la veille). `CURSUS_TODAY` (AAAA-MM-JJ, date existante) permet de figer la démonstration.
 */
export function todayIso(maintenant = new Date()): string {
  const env = process.env.CURSUS_TODAY;
  return isValidDate(env) ? env : isoParis(maintenant);
}

export function loadSettings(db: Db): Settings {
  // `rhNom` et `rhIntitule` (anciennes bases) désignaient le RH unique : l'identité vient désormais du compte connecté.
  const { rhNom: _n, rhIntitule: _i, ...app } = db.getSetting<Partial<Settings> & { rhNom?: string; rhIntitule?: string }>('app', {});
  return { ...DEFAULT_SETTINGS, ...app };
}

type EmpRow = Omit<Employe, 'passeport' | 'certs' | 'habs' | 'visas' | 'vaccins'> & { passeportNumero: string | null; passeportExpire: string | null };

export function loadFull(db: Db, user: CurrentUser): Dataset {
  const certs = db.all<Certification>('certifications');
  const habs = db.all<HabTitre>('habTitres');
  const visas = db.all<Visa>('visas');
  const vaccins = db.all<Vaccination>('vaccinations');
  const inscriptions = db.all<Inscription>('inscriptions');
  const participations = db.all<Participation>('participations');
  const employes: Employe[] = db.all<EmpRow>('employes').map(({ passeportNumero, passeportExpire, ...e }) => ({
    ...e,
    jourOff: e.jourOff ?? [],
    notifications: e.notifications === 'quotidien' ? 'quotidien' : 'immediat',
    restrictions: e.restrictions ?? [],
    passeport: passeportNumero && passeportExpire ? { numero: passeportNumero, expire: passeportExpire } : null,
    certs: certs.filter(c => c.empId === e.id),
    habs: habs.filter(h => h.empId === e.id),
    visas: visas.filter(v => v.empId === e.id),
    vaccins: vaccins.filter(v => v.empId === e.id),
  }));
  const feuilles = db.all<FeuilleTemps>('feuilles');
  const budgets: Dataset['budgets'] = {};
  db.all<{ exercice: number; equipe: string; montant: number }>('budgets').forEach(b => {
    (budgets[String(b.exercice)] ||= {})[b.equipe] = b.montant;
  });
  return {
    today: todayIso(),
    revision: db.revision,
    user,
    settings: loadSettings(db),
    // Formations, habilitations et destinations, archivées comprises (`archive`, date d'archivage) : transmises à tous les
    // espaces, qui en ont besoin pour nommer les titres et écarter les archivées des listes ; aucune donnée personnelle.
    referentiels: {
      formations: db.all<Formation>('formations', 'rowid'),
      habilitations: db.all<HabType>('habilitations', 'rowid'),
      destinations: db.all<Destination>('destinations', 'rowid'),
      // Postes et exigences (shared/rules/exigences.ts) : aucune donnée personnelle, comme les équipes.
      postes: db.all<Poste>('postes', 'nom'),
      equipes: db.all<Equipe>('equipes', 'ordre'),
      projets: db.all<Projet>('projets', 'rowid'),
      chantiers: db.all<Chantier>('chantiers', 'debut'),
    },
    annuaire: employes.map(e => ({ id: e.id, nom: e.nom, equipe: e.equipe, poste: e.poste })),
    employes,
    // Nombre d'inscrits calculé sur toutes les données, avant la restriction au périmètre.
    // Session d'une base ancienne ou écrite sans plage : un seul jour (completerSession).
    sessions: avecInscrits(db.all<Omit<Session, 'inscrits'>>('sessions').map(completerSession), certs, inscriptions, participations),
    inscriptions,
    participations,
    plan: db.all<PlanAction>('planActions'),
    budgets,
    exercicesClos: db.all<ExerciceClos>('exercicesClos'),
    voyages: db.all<Voyage>('voyages'),
    demandesKeystone: db.all<DemandeKeystone>('demandesKeystone'),
    missions: db.all<Mission>('missions'),
    taches: db.all<TacheKeystone>('taches'),
    feuilles,
    absences: db.all<Absence>('absences'),
    cet: db.all<CetMouvement>('cet'),
    reports: db.all<ReportCp>('reports'),
    soldesReprise: db.all<SoldeReprise>('soldesReprise'),
    clotures: db.all<ClotureConges>('clotures'),
    entretiens: db.all<Entretien>('entretiens'),
    demandesCollab: db.all<DemandeCollab>('demandesCollab'),
    demandesVisite: db.all<DemandeVisite>('demandesVisite'),
    // Début de la saisie des feuilles, sur toutes les feuilles : transmis tel quel à tous les espaces (une date).
    debutSaisieFeuilles: debutSaisieDe(feuilles),
    // Lots de paie, sans leur contenu figé (lu par le téléchargement du fichier : server/src/fichier-paie.ts), et format
    // du fichier d'import réglé par la paie (shared/rules/lots-paie.ts).
    lotsPaie: lireLots(db),
    formatFichierPaie: lireFormatFichier(db),
    // Correspondance des rubriques avec le plan de paie Sage (lignes modifiées ; les autres : shared/rules/paie.ts).
    rubriquesPaie: db.all<RubriquePaie>('rubriquesPaie'),
    // Messagerie (Paramètres → Messagerie) et relevés transmis aux agences d'intérim, avec le statut de leur e-mail.
    messagerie: lireMessagerie(db),
    releves: db.all<Omit<ReleveInterim, 'envoi'>>('releves').map(r => ({ ...r, envoi: r.envoiId ? db.get<Envoi>('envois', r.envoiId)?.statut ?? null : null })),
    // Lots importés à la mise en service (écran Mise en service) : compte rendu nominatif, service RH seulement.
    reprises: db.all<LotReprise>('reprises').reverse(),
    // Dérogations au repos dominical par équipe (shared/rules/semaine.ts) et mandats au CSE (shared/rules/delegation.ts).
    derogationsDominicales: db.getSetting<DerogationDominicale[]>('derogationsDominicales', []),
    mandats: db.all<Mandat>('mandats'),
    // Effectif du site (un nombre) pour la limite de délégation d'un suppléant : calculé ici sur toutes les fiches, car
    // l'instantané de l'élu ne contient que lui-même (ou son équipe).
    effectifCse: effectifSite({ employes }, todayIso()),
  };
}

/** Dérogations au repos dominical sans la référence de l'accord (texte libre) : hors du service RH, le type suffit. */
const derogationsSansReference = (full: Dataset) => (full.derogationsDominicales ?? []).map(x => ({ ...x, reference: null }));

/**
 * Personne connectée dans l'espace actif de la session : le compte doit pouvoir se connecter et ouvrir
 * cet espace. Dans l'espace RH, la personne agit pour le service (`empId` null) mais signe de son nom.
 */
export function currentUser(db: Db, s: SessionInfo | null): CurrentUser | null {
  const c = compteValide(db, s?.compteId);
  if (!s || !c || !espacesDuCompte(db, c).includes(s.role)) return null;
  const compte = { compteId: c.id, profilRh: c.profilRh, salarieId: c.empId };
  if (s.role === 'rh') return { role: 'rh', empId: null, nom: nomDuCompte(db, c), intitule: PROFILS_RH[c.profilRh].label, ...compte };
  const empId = c.empId!;
  const e = db.get<EmpRow>('employes', empId)!;
  if (s.role === 'manager') {
    const teams = db.where<Equipe>('equipes', 'managerId', empId).map(q => q.nom);
    return { role: s.role, empId, nom: e.nom, intitule: `Manager · ${teams.join(', ')}`, ...compte };
  }
  return { role: s.role, empId, nom: e.nom, intitule: e.poste, ...compte };
}

/** Identifiants des collaborateurs visibles par l'utilisateur. */
export function scopeIds(d: Domain, user: CurrentUser): number[] {
  if (user.role === 'rh') return d.ds.employes.map(e => e.id);
  if (user.role === 'manager') {
    const team = d.ds.employes.filter(e => d.mgrOf(e) === user.empId).map(e => e.id);
    return [user.empId!, ...team];
  }
  return [user.empId!];
}

/** Semaines de planning Keystone envoyées au navigateur, avant et après la semaine en cours. */
export const SEMAINES_TACHES = 8;

/**
 * Tâches Keystone de l'instantané envoyé au navigateur : celles des semaines proches d'aujourd'hui, avec
 * leurs heures de ces semaines seulement. Le planning complet grossirait chaque réponse ; il ne sert qu'à
 * proposer « Proposer depuis Keystone » sur la semaine affichée. Côté serveur, `temps.suggest` lit tout.
 */
export function tachesProches(taches: TacheKeystone[], today: ISODate): TacheKeystone[] {
  const lundi = mondayOf(today), du = addD(lundi, -7 * SEMAINES_TACHES), au = addD(lundi, 7 * (SEMAINES_TACHES + 1) - 1);
  return taches.filter(t => t.debut <= au && t.fin >= du)
    .map(t => ({ ...t, heures: Object.fromEntries(Object.entries(t.heures ?? {}).filter(([jour]) => jour >= du && jour <= au)) }));
}

/**
 * Report de CP vu par le manager (membres de son équipe) et les profils restreints : sans motif (texte libre) et avec une
 * échéance ramenée à la fin de sa période. L'échéance d'un report légal (31 août, 15 mois après la période) désignerait
 * un salarié revenu d'arrêt, de maternité ou de paternité. Seul effet : leur calcul du solde d'un salarié ne retire pas
 * les jours d'un report légal échu en cours de période (le serveur, qui contrôle les demandes, les retire).
 */
const reportNeutre = (r: ReportCp): ReportCp => ({ ...r, motif: '', expire: finPeriodeCp(periodeReport(r).periode) });
/** Ligne de clôture des congés vue de même : sans motif de report imposé, échéance d'un report au 31 mai suivant. */
const clotureNeutre = (c: ClotureConges): ClotureConges => ({ ...c, motif: null, expire: c.expire ? finPeriodeCp(c.periode + 1) : null });
/**
 * Entretien vu sans la date de naissance du salarié (manager, profils restreints) : sections « fin de carrière » calculées
 * ici sur l'âge exact (`finCarriere`), pour que l'évaluateur rédige celles que le serveur accepte.
 */
const avecFinCarriere = (d: Domain, x: Entretien): Entretien => {
  const e = d.emp(x.empId);
  return e ? { ...x, finCarriere: needsFinCarriere(d, e, x) } : x;
};

export function buildSnapshot(db: Db, user: CurrentUser): Dataset {
  const full = loadFull(db, user);
  if (user.role === 'rh') {
    const droits = droitsRh(user);
    return droits.includes('rh') ? { ...full, taches: tachesProches(full.taches, full.today) } : vueProfil(full, droits);
  }
  const d = new Domain(full);
  const ids = new Set(scopeIds(d, user));
  const mine = <T extends { empId: number }>(list: T[]) => list.filter(x => ids.has(x.empId));
  const isMgr = user.role === 'manager';
  // Les managers voient le verdict d'aptitude, les restrictions de poste en vigueur et l'état des dossiers voyage,
  // jamais les données de santé (date de visite, avis daté, demande de visite, suivi médical, vaccinations). Une reprise ouverte par
  // un arrêt longue maladie leur est masquée : elle trahirait la nature de l'arrêt (l'entretien de reprise est suivi par le RH).
  // Du passeport d'un membre, seule la date d'expiration est transmise (l'écran n'affiche qu'elle) ; les visas restent montrés.
  // Le matricule de paie d'un membre ne lui sert à rien : il n'est pas transmis. De la sortie d'un membre, seule la date
  // (fin du contrat) et l'indication qu'elle est enregistrée (`sortieEnregistree`, pour que ses échéances soient celles du
  // service RH) : ni le motif (démission, licenciement…), ni la fin prévue. Du titre de séjour d'un membre, le verdict
  // seul (`autorisationVerdict`, « valide » aussi sans titre requis) : ni type, ni numéro, ni date. La période d'essai lui
  // est transmise : il en évalue l'issue avec le service RH. De la naissance d'un membre, l'année et l'indication « mineur »
  // du jour (`naissanceVueManager`), jamais la date complète.
  const employes = full.employes.filter(e => ids.has(e.id)).map(e => isMgr && e.id !== user.empId
    ? {
      ...e, visite: null, avis: null, restrictions: [], aptitude: aptitudeVueManager(e, d.medInfo(e).ok, full.today, visiteAProgrammer(d, e)), vaccins: [], matriculePaie: null,
      // Suivi médical (type, prochaine visite, examen d'aptitude, exposition) : jamais transmis au manager, qui ne voit que le
      // verdict ; d'une visite due (embauche, reprise, mi-carrière, fin de carrière), « visite à programmer » seulement.
      suivi: null, prochaineVisite: null, examenAptitude: null, expose: null,
      passeport: e.passeport && { expire: e.passeport.expire }, motifSortie: null, finPrevue: null, sortieEnregistree: !!e.motifSortie,
      autorisationTravail: null, autorisationVerdict: verdictAutorisation(e, full.today), ...naissanceVueManager(e, full.today),
      ...(repriseMedicale(e, full.absences) ? { repriseMotif: null, repriseDate: null } : { repriseMotif: e.repriseDate ? 'absence longue' : null }),
    }
    : e);
  // Motif d'une annulation (texte libre du service RH) et demandeur d'un déplacement importé (nom saisi dans le
  // formulaire) : jamais transmis hors du service RH.
  const voyages = mine(full.voyages).map(v => (v.annuleMotif || v.demandeur ? { ...v, annuleMotif: null, demandeur: null } : v)).map(v => {
    if (!isMgr || v.empId === user.empId) return v;
    const emp = d.emp(v.empId);
    return emp ? { ...v, dossierStatut: d.readiness(emp, v).status } : v;
  });
  return {
    ...full,
    referentiels: { ...full.referentiels, chantiers: [] },
    employes,
    // Le bilan d'une session (évaluation à chaud, motif d'annulation : textes libres, parfois nominatifs)
    // est réservé au service RH.
    sessions: full.sessions.map(s => s.bilan ? { ...s, bilan: null } : s),
    plan: [],
    budgets: {},
    exercicesClos: [],
    voyages,
    demandesKeystone: [],
    missions: mine(full.missions),
    taches: tachesProches(mine(full.taches), full.today),
    feuilles: mine(full.feuilles),
    // Arrêt maladie, accident, maladie professionnelle : le manager ne voit qu'une « Absence » (dates, état).
    // Demi-journées d'un congé (matin, après-midi) : transmises comme ses dates ; une absence hors congés n'en porte jamais.
    absences: mine(full.absences).map(a => isMgr && a.empId !== user.empId ? absenceVueManager(a) : a),
    cet: mine(full.cet),
    // Motif d'un report de CP (texte libre, « arrêt de travail »…) : celui d'un membre n'est pas transmis au manager, ni
    // l'échéance d'un report légal (`reportNeutre`).
    reports: mine(full.reports).map(r => isMgr && r.empId !== user.empId ? reportNeutre(r) : r),
    soldesReprise: mine(full.soldesReprise),
    // Clôture des congés : le motif d'un report imposé et son échéance laissent deviner une absence de santé, réservés à
    // l'intéressé (`clotureNeutre`).
    clotures: mine(full.clotures).map(c => isMgr && c.empId !== user.empId ? clotureNeutre(c) : c),
    // Sections « fin de carrière » des entretiens d'un membre calculées ici : sa date de naissance n'est pas transmise.
    entretiens: mine(full.entretiens).map(x => isMgr && x.empId !== user.empId ? avecFinCarriere(d, x) : x),
    // Les documents déclarés (passeport, visas, vaccinations) des membres ne sont pas montrés au manager ;
    // le contenu d'une déclaration et le motif d'un refus ne sont transmis qu'à l'intéressé (et au RH), même
    // quand le manager a fait la demande : la confirmation du refus l'annonce ainsi (client/src/state/confirmations.ts).
    demandesCollab: mine(full.demandesCollab).filter(r => !isMgr || r.empId === user.empId || r.type !== 'document')
      .map(r => r.empId === user.empId ? r : { ...r, declaration: null, motifRefus: null }),
    // Demandes de visite médicale : l'intéressé seulement (jamais le manager).
    demandesVisite: full.demandesVisite.filter(x => x.empId === user.empId),
    inscriptions: mine(full.inscriptions),
    participations: mine(full.participations),
    lotsPaie: [],
    formatFichierPaie: null,
    rubriquesPaie: [],
    messagerie: null,
    releves: [],
    reprises: [],
    derogationsDominicales: derogationsSansReference(full),
    // Mandats au CSE : l'élu voit les siens (compteur des heures de délégation) ; le manager, rien de ceux de son équipe.
    mandats: (full.mandats ?? []).filter(m => m.empId === user.empId),
    // Effectif du site, transmis à l'élu avec ses mandats (compteur identique à celui du service RH) ; rien sans mandat.
    effectifCse: (full.mandats ?? []).some(m => m.empId === user.empId) ? full.effectifCse : null,
  };
}

/** Référentiels des postes et des équipes vidés de leurs exigences (profil qui ne reçoit pas les titres). */
const sansExigences = (r: Dataset['referentiels']): Pick<Dataset['referentiels'], 'postes' | 'equipes'> => ({
  postes: r.postes.map(p => ({ ...p, formations: [], habilitations: [] })),
  equipes: r.equipes.map(q => ({ ...q, exigences: null })),
});

/**
 * Instantané d'un profil restreint de l'espace RH (sans le droit `rh`) : seulement ce que ses droits ouvrent,
 * jamais de donnée de santé détaillée. Pour tous, comme pour le manager : aptitude réduite au verdict (aptitude valide
 * ou non, avis) et aux restrictions de poste en vigueur, sans date ; ni visite, ni demande de visite, ni suivi médical, ni vaccinations ;
 * nature médicale des absences masquée et reprise d'un arrêt longue maladie retirée ; motif des reports de CP retiré
 * (texte libre), comme celui d'un report imposé à la clôture des congés, et échéances ramenées au 31 mai (celle d'un
 * report légal, 31 août, laisse deviner une absence de santé, de maternité ou de paternité : `reportNeutre`) ; de la
 * naissance, l'année et l'indication « mineur » seulement (`naissanceVueManager`), sans la date complète.
 * - `formations` (référent HSE) : sessions et résultats, certifications et habilitations, demandes de formation et
 *   d'habilitation, chantiers avec l'état précalculé des déplacements et les absences de leurs ressources (sans nature)
 *   pour les verdicts Go / No Go ; ni passeport, ni visas (dossiers de voyage réservés au service RH) ;
 * - `paie` : feuilles de temps, absences, soldes, CET, reports, clôtures des congés, lots de paie (sans leur contenu) et
 *   format du fichier d'import, correspondance des rubriques de paie, motif des sorties, période d'essai — aucune formation ;
 * - `consultation` (lecture seule) : tout ce qui précède, plus plan et budget, missions, entretiens sans le contenu
 *   des comptes rendus ; échéances des passeports (date d'expiration seule) et des visas, comme pour le manager, pour
 *   que les alertes et les échéances soient celles du service RH ; titre de séjour sans son numéro.
 * Hors lecture seule, le titre de séjour se réduit au verdict (`autorisationVerdict`), comme pour le manager.
 */
function vueProfil(full: Dataset, droits: readonly DroitRh[]): Dataset {
  const lecture = droits.includes('consultation');
  const formations = lecture || droits.includes('formations');
  const paie = lecture || droits.includes('paie');
  const d = new Domain(full);
  const employes = full.employes.map(e => ({
    ...e,
    visite: null, avis: null, restrictions: [], aptitude: formations ? aptitudeVueManager(e, d.medInfo(e).ok, full.today, visiteAProgrammer(d, e)) : undefined, vaccins: [],
    suivi: null, prochaineVisite: null, examenAptitude: null, expose: null,
    passeport: lecture ? e.passeport && { expire: e.passeport.expire } : null, visas: lecture ? e.visas : [],
    // Naissance : l'année et l'indication « mineur » du jour, comme pour le manager ; jamais la date complète.
    ...naissanceVueManager(e, full.today),
    certs: formations ? e.certs : [], habs: formations ? e.habs : [],
    // Motif de sortie : paie (solde de tout compte) et lecture seule ; le référent HSE ne voit que la date, et l'indication
    // qu'elle est enregistrée (ses échéances de fin de contrat sont celles du service RH).
    motifSortie: paie ? e.motifSortie : null, finPrevue: paie ? e.finPrevue : null, ...(paie ? {} : { sortieEnregistree: !!e.motifSortie }),
    essaiFin: paie ? e.essaiFin ?? null : null, essaiRenouveleJusquau: paie ? e.essaiRenouveleJusquau ?? null : null,
    // Titre de séjour : la lecture seule le voit sans numéro (échéances du service RH) ; les autres, le verdict seul.
    ...(lecture
      ? { autorisationTravail: e.autorisationTravail ? { ...e.autorisationTravail, numero: null } : null }
      : { autorisationTravail: null, autorisationVerdict: verdictAutorisation(e, full.today) }),
    ...(lecture && !repriseMedicale(e, full.absences) ? { repriseMotif: e.repriseDate ? 'absence longue' : null } : { repriseMotif: null, repriseDate: null }),
  }));
  const ressources = new Set(full.referentiels.chantiers.filter(c => c.statut !== 'archive').flatMap(c => c.ressources));
  // Déplacements : l'état du dossier et les formalités manquantes sont calculés ici, avec les pièces du dossier,
  // pour que le verdict Go / No Go soit exact sans les transmettre.
  // Ni motif d'annulation, ni demandeur d'un déplacement importé (textes du service RH).
  const voyages = !formations ? [] : full.voyages.map(v => (v.annuleMotif || v.demandeur ? { ...v, annuleMotif: null, demandeur: null } : v)).map(v => {
    const emp = d.emp(v.empId);
    if (!emp || !d.destOf(v.dest)) return v;
    const r = d.readiness(emp, v);
    return { ...v, dossierStatut: r.status, dossierManque: d.formalitesManquantes({ ...v, emp, r }) };
  });
  return {
    ...full,
    // Sans certifications ni habilitations (paie), les exigences des postes et des équipes compteraient tout le monde
    // « Non conforme » : elles ne sont pas transmises.
    referentiels: {
      ...full.referentiels, chantiers: formations ? full.referentiels.chantiers : [],
      ...(formations ? {} : sansExigences(full.referentiels)),
    },
    employes,
    sessions: formations ? full.sessions : [],
    inscriptions: formations ? full.inscriptions : [],
    participations: formations ? full.participations : [],
    plan: lecture ? full.plan : [],
    budgets: lecture ? full.budgets : {},
    exercicesClos: lecture ? full.exercicesClos : [],
    voyages,
    demandesKeystone: formations ? full.demandesKeystone : [],
    missions: lecture ? full.missions : [],
    taches: lecture ? tachesProches(full.taches, full.today) : [],
    feuilles: paie ? full.feuilles : [],
    // Le référent HSE ne reçoit, sans leur nature, que les absences des ressources des chantiers : celles qui comptent au
    // Go / No Go.
    absences: paie ? full.absences.map(absenceVueManager)
      : formations ? full.absences.filter(a => ressources.has(a.empId)).map(absenceVueManager) : [],
    cet: paie ? full.cet : [],
    reports: paie ? full.reports.map(reportNeutre) : [],
    soldesReprise: paie ? full.soldesReprise : [],
    clotures: paie ? full.clotures.map(clotureNeutre) : [],
    entretiens: lecture ? full.entretiens.map(x => ({ ...avecFinCarriere(d, x), cr: {} })) : [],
    // Demandes de formation et d'habilitation ; les documents déclarés (passeport, visa, vaccination) restent au RH.
    demandesCollab: formations ? full.demandesCollab.filter(r => r.type !== 'document').map(r => ({ ...r, declaration: null })) : [],
    demandesVisite: [],
    lotsPaie: paie ? full.lotsPaie : [],
    formatFichierPaie: paie ? full.formatFichierPaie : null,
    rubriquesPaie: paie ? full.rubriquesPaie : [],
    // Comptes rendus de la reprise depuis Lucca (noms, motifs de refus) : service RH seulement.
    reprises: [],
    derogationsDominicales: derogationsSansReference(full),
    // Compteur des heures de délégation : service RH et l'élu seulement.
    mandats: [],
    effectifCse: null,
  };
}


