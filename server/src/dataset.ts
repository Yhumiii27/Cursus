// Assemblage de l'instantané complet depuis la base, puis restriction au
// périmètre de l'utilisateur connecté (RH : tout ; profils restreints de l'espace RH :
// ce que leurs droits ouvrent ; manager : son équipe ; collaborateur : ses propres données).
import { Domain } from '../../shared/domain.ts';
import { addD, iso, mondayOf } from '../../shared/dates.ts';
import { absenceVueManager, repriseMedicale } from '../../shared/rules/absences.ts';
import { avecInscrits } from '../../shared/rules/sessions.ts';
import type {
  Absence, Certification, Inscription, CetMouvement, Chantier, CurrentUser, Dataset, DemandeCollab, DemandeKeystone, Destination, Employe, Entretien,
  Equipe, FeuilleTemps, Formation, HabTitre, HabType, ISODate, Mission, Participation, PlanAction, Projet, ReportCp, SagePush, Session, Settings, SoldeReprise,
  TacheKeystone, Vaccination, Visa, Voyage,
} from '../../shared/types.ts';
import { droitsRh, PROFILS_RH, type DroitRh } from '../../shared/constants.ts';
import type { Db } from './db.ts';
import type { SessionInfo } from './auth.ts';
import { compteValide, espacesDuCompte, nomDuCompte } from './comptes.ts';

export const DEFAULT_SETTINGS: Settings = {
  horizonAlerte: 90, uniquementReglementaire: false, seuilBudget: 85, partageKeystone: 'minimal', rtt39: 23, vueInitiale: 'dashboard',
};

/** Date du jour : `CURSUS_TODAY` (AAAA-MM-JJ) permet de figer la démonstration. */
export function todayIso(): string {
  const env = process.env.CURSUS_TODAY;
  return env && /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : iso(new Date());
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
    passeport: passeportNumero && passeportExpire ? { numero: passeportNumero, expire: passeportExpire } : null,
    certs: certs.filter(c => c.empId === e.id),
    habs: habs.filter(h => h.empId === e.id),
    visas: visas.filter(v => v.empId === e.id),
    vaccins: vaccins.filter(v => v.empId === e.id),
  }));
  const budgets: Dataset['budgets'] = {};
  db.all<{ exercice: number; equipe: string; montant: number }>('budgets').forEach(b => {
    (budgets[String(b.exercice)] ||= {})[b.equipe] = b.montant;
  });
  return {
    today: todayIso(),
    user,
    settings: loadSettings(db),
    referentiels: {
      formations: db.all<Formation>('formations', 'rowid'),
      habilitations: db.all<HabType>('habilitations', 'rowid'),
      destinations: db.all<Destination>('destinations', 'rowid'),
      equipes: db.all<Equipe>('equipes', 'ordre'),
      projets: db.all<Projet>('projets', 'rowid'),
      chantiers: db.all<Chantier>('chantiers', 'debut'),
    },
    annuaire: employes.map(e => ({ id: e.id, nom: e.nom, equipe: e.equipe, poste: e.poste })),
    employes,
    // Nombre d'inscrits calculé sur toutes les données, avant la restriction au périmètre.
    sessions: avecInscrits(db.all<Omit<Session, 'inscrits'>>('sessions'), certs, inscriptions, participations),
    inscriptions,
    participations,
    plan: db.all<PlanAction>('planActions'),
    budgets,
    voyages: db.all<Voyage>('voyages'),
    demandesKeystone: db.all<DemandeKeystone>('demandesKeystone'),
    missions: db.all<Mission>('missions'),
    taches: db.all<TacheKeystone>('taches'),
    feuilles: db.all<FeuilleTemps>('feuilles'),
    absences: db.all<Absence>('absences'),
    cet: db.all<CetMouvement>('cet'),
    reports: db.all<ReportCp>('reports'),
    soldesReprise: db.all<SoldeReprise>('soldesReprise'),
    entretiens: db.all<Entretien>('entretiens'),
    demandesCollab: db.all<DemandeCollab>('demandesCollab'),
    lastSagePush: db.getSetting<SagePush | null>('lastSagePush', null),
  };
}

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
  // Les managers voient le verdict d'aptitude et l'état des dossiers voyage,
  // jamais les données de santé (visite, vaccinations). Une reprise ouverte par un arrêt longue maladie
  // leur est masquée : elle trahirait la nature de l'arrêt (l'entretien de reprise est suivi par le RH).
  const employes = full.employes.filter(e => ids.has(e.id)).map(e => isMgr && e.id !== user.empId
    ? {
      ...e, visite: null, aptitude: { ok: d.medInfo(e).ok }, vaccins: [],
      ...(repriseMedicale(e, full.absences) ? { repriseMotif: null, repriseDate: null } : { repriseMotif: e.repriseDate ? 'absence longue' : null }),
    }
    : e);
  const voyages = mine(full.voyages).map(v => {
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
    voyages,
    demandesKeystone: [],
    missions: mine(full.missions),
    taches: tachesProches(mine(full.taches), full.today),
    feuilles: mine(full.feuilles),
    // Arrêt maladie, accident, maladie professionnelle : le manager ne voit qu'une « Absence » (dates, état).
    absences: mine(full.absences).map(a => isMgr && a.empId !== user.empId ? absenceVueManager(a) : a),
    cet: mine(full.cet),
    reports: mine(full.reports),
    soldesReprise: mine(full.soldesReprise),
    entretiens: mine(full.entretiens),
    // Les documents déclarés (passeport, visas, vaccinations) des membres ne sont pas montrés au manager ;
    // le contenu d'une déclaration n'est de toute façon transmis qu'à l'intéressé (et au RH).
    demandesCollab: mine(full.demandesCollab).filter(r => !isMgr || r.empId === user.empId || r.type !== 'document')
      .map(r => r.empId === user.empId ? r : { ...r, declaration: null }),
    inscriptions: mine(full.inscriptions),
    participations: mine(full.participations),
    lastSagePush: null,
  };
}

/**
 * Instantané d'un profil restreint de l'espace RH (sans le droit `rh`) : seulement ce que ses droits ouvrent,
 * jamais de donnée de santé détaillée. Pour tous : aptitude réduite à apte / non apte, ni visite, ni vaccinations ;
 * ni passeport, ni visas (dossiers de voyage réservés au service RH) ; nature médicale des absences masquée et reprise
 * d'un arrêt longue maladie retirée, comme pour le manager ; motif des reports de CP retiré (texte libre).
 * - `formations` (référent HSE) : sessions et résultats, certifications et habilitations, demandes de formation et
 *   d'habilitation, chantiers avec l'état précalculé des déplacements pour les verdicts Go / No Go ;
 * - `paie` : feuilles de temps, absences, soldes, CET, reports, dernière transmission à Sage — aucune formation ;
 * - `consultation` (lecture seule) : tout ce qui précède, plus plan et budget, missions, entretiens sans le contenu
 *   des comptes rendus.
 */
function vueProfil(full: Dataset, droits: readonly DroitRh[]): Dataset {
  const lecture = droits.includes('consultation');
  const formations = lecture || droits.includes('formations');
  const paie = lecture || droits.includes('paie');
  const d = new Domain(full);
  const employes = full.employes.map(e => ({
    ...e,
    visite: null, aptitude: formations ? { ok: d.medInfo(e).ok } : undefined, vaccins: [], passeport: null, visas: [],
    certs: formations ? e.certs : [], habs: formations ? e.habs : [],
    ...(lecture && !repriseMedicale(e, full.absences) ? { repriseMotif: e.repriseDate ? 'absence longue' : null } : { repriseMotif: null, repriseDate: null }),
  }));
  // Déplacements : l'état du dossier et les formalités manquantes sont calculés ici, avec les pièces du dossier,
  // pour que le verdict Go / No Go soit exact sans les transmettre.
  const voyages = !formations ? [] : full.voyages.map(v => {
    const emp = d.emp(v.empId);
    if (!emp || !d.destOf(v.dest)) return v;
    const r = d.readiness(emp, v);
    return { ...v, dossierStatut: r.status, dossierManque: d.formalitesManquantes({ ...v, emp, r }) };
  });
  return {
    ...full,
    referentiels: { ...full.referentiels, chantiers: formations ? full.referentiels.chantiers : [] },
    employes,
    sessions: formations ? full.sessions : [],
    inscriptions: formations ? full.inscriptions : [],
    participations: formations ? full.participations : [],
    plan: lecture ? full.plan : [],
    budgets: lecture ? full.budgets : {},
    voyages,
    demandesKeystone: formations ? full.demandesKeystone : [],
    missions: lecture ? full.missions : [],
    taches: lecture ? tachesProches(full.taches, full.today) : [],
    feuilles: paie ? full.feuilles : [],
    absences: paie ? full.absences.map(absenceVueManager) : [],
    cet: paie ? full.cet : [],
    reports: paie ? full.reports.map(r => ({ ...r, motif: '' })) : [],
    soldesReprise: paie ? full.soldesReprise : [],
    entretiens: lecture ? full.entretiens.map(x => ({ ...x, cr: {} })) : [],
    // Demandes de formation et d'habilitation ; les documents déclarés (passeport, visa, vaccination) restent au RH.
    demandesCollab: formations ? full.demandesCollab.filter(r => r.type !== 'document').map(r => ({ ...r, declaration: null })) : [],
    lastSagePush: paie ? full.lastSagePush : null,
  };
}

/** Actions dont le message du journal peut nommer une donnée de santé (nature d'un arrêt, visite, vaccination). */
const JOURNAL_SANTE = new Set(['absence.saisir', 'absence.qualifier', 'absence.prolonger', 'absence.annuler', 'medical.demander', 'formalite.enregistrer', 'demande.accepter']);

/** Journal lu par un profil sans le droit `rh` (lecture seule) : messages des actions touchant à la santé masqués. */
export function journalPourProfil<T extends { action: string; message: string | null }>(user: CurrentUser, rows: T[]): T[] {
  if (droitsRh(user).includes('rh')) return rows;
  return rows.map(r => JOURNAL_SANTE.has(r.action) && r.message ? { ...r, message: 'Détail réservé au service RH' } : r);
}
