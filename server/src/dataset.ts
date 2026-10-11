// Assemblage de l'instantané complet depuis la base, puis restriction au
// périmètre de l'utilisateur connecté (RH : tout ; manager : son équipe ;
// collaborateur : ses propres données).
import { Domain } from '../../shared/domain.ts';
import { iso } from '../../shared/dates.ts';
import type {
  Absence, Certification, Inscription, CetMouvement, Chantier, CurrentUser, Dataset, DemandeCollab, DemandeKeystone, Destination, Employe, Entretien,
  Equipe, FeuilleTemps, Formation, HabTitre, HabType, Mission, PlanAction, Projet, ReportCp, SagePush, Session, Settings, SoldeReprise,
  TacheKeystone, Vaccination, Visa, Voyage,
} from '../../shared/types.ts';
import type { Db } from './db.ts';
import type { SessionInfo } from './auth.ts';

export const DEFAULT_SETTINGS: Settings = {
  horizonAlerte: 90, uniquementReglementaire: false, seuilBudget: 85, partageKeystone: 'minimal', rtt39: 23,
  rhNom: 'Sandrine Vidal', rhIntitule: 'Responsable RH', vueInitiale: 'dashboard',
};

/** Date du jour : `CURSUS_TODAY` (AAAA-MM-JJ) permet de figer la démonstration. */
export function todayIso(): string {
  const env = process.env.CURSUS_TODAY;
  return env && /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : iso(new Date());
}

export function loadSettings(db: Db): Settings {
  return { ...DEFAULT_SETTINGS, ...db.getSetting<Partial<Settings>>('app', {}) };
}

type EmpRow = Omit<Employe, 'passeport' | 'certs' | 'habs' | 'visas' | 'vaccins'> & { passeportNumero: string | null; passeportExpire: string | null };

export function loadFull(db: Db, user: CurrentUser): Dataset {
  const certs = db.all<Certification>('certifications');
  const habs = db.all<HabTitre>('habTitres');
  const visas = db.all<Visa>('visas');
  const vaccins = db.all<Vaccination>('vaccinations');
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
    sessions: db.all<Session>('sessions'),
    inscriptions: db.all<Inscription>('inscriptions'),
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

export function currentUser(db: Db, s: SessionInfo | null): CurrentUser | null {
  if (!s) return null;
  const settings = loadSettings(db);
  if (s.role === 'rh') return { role: 'rh', empId: null, nom: settings.rhNom, intitule: settings.rhIntitule };
  const empId = s.role === 'manager' ? s.managerId : s.collabId;
  if (!empId) return null;
  const e = db.get<EmpRow>('employes', empId);
  if (!e) return null;
  if (s.role === 'manager') {
    const teams = db.where<Equipe>('equipes', 'managerId', empId).map(q => q.nom);
    return { role: s.role, empId, nom: e.nom, intitule: teams.length ? `Manager · ${teams.join(', ')}` : 'Manager · aucune équipe' };
  }
  return { role: s.role, empId, nom: e.nom, intitule: e.poste };
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

export function buildSnapshot(db: Db, user: CurrentUser): Dataset {
  const full = loadFull(db, user);
  if (user.role === 'rh') return full;
  const d = new Domain(full);
  const ids = new Set(scopeIds(d, user));
  const mine = <T extends { empId: number }>(list: T[]) => list.filter(x => ids.has(x.empId));
  const isMgr = user.role === 'manager';
  // Les managers voient le verdict d'aptitude et l'état des dossiers voyage,
  // jamais les données de santé (visite, vaccinations).
  const employes = full.employes.filter(e => ids.has(e.id)).map(e => isMgr && e.id !== user.empId
    ? { ...e, visite: null, aptitude: { ok: d.medInfo(e).ok }, vaccins: [], repriseMotif: e.repriseDate ? 'absence longue' : null }
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
    plan: [],
    budgets: {},
    voyages,
    demandesKeystone: [],
    missions: mine(full.missions),
    taches: mine(full.taches),
    feuilles: mine(full.feuilles),
    absences: mine(full.absences),
    cet: mine(full.cet),
    reports: mine(full.reports),
    soldesReprise: mine(full.soldesReprise),
    entretiens: mine(full.entretiens),
    // Les documents déclarés (passeport, visas, vaccinations) des membres ne sont pas montrés au manager ;
    // le contenu d'une déclaration n'est de toute façon transmis qu'à l'intéressé (et au RH).
    demandesCollab: mine(full.demandesCollab).filter(r => !isMgr || r.empId === user.empId || r.type !== 'document')
      .map(r => r.empId === user.empId ? r : { ...r, declaration: null }),
    inscriptions: mine(full.inscriptions),
    lastSagePush: null,
  };
}
