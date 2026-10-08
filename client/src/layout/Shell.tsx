// Coque de l'application : barre latérale (rôle, navigation, utilisateur), en-tête, notification.
import { useMemo, type ReactNode } from 'react';
import {
  AirplaneIcon, BellIcon, BookOpenIcon, BriefcaseIcon, CalendarBlankIcon, ChartBarIcon, ChatIcon, CheckIcon, ClockIcon, GearSixIcon,
  HouseIcon, MagnifyingGlassIcon, MapPinIcon, PlusIcon, ShieldCheckIcon, SignOutIcon, UserIcon, UsersThreeIcon, type Icon,
} from '@phosphor-icons/react';
import { Domain } from '../../../shared/domain.ts';
import { obligations } from '../../../shared/rules/entretiens.ts';
import type { Dataset, Role } from '../../../shared/types.ts';
import { Avatar } from '../components/ui.tsx';
import { useStore, type View } from '../state/store.tsx';

interface NavItem { view: View; label: string; icon: Icon; badge?: number }
type NavGroup = [string, NavItem[]];

function navGroups(data: Dataset | null, role: Role): NavGroup[] {
  if (!data) return [];
  const d = new Domain(data);
  const me = data.user.empId;
  const scope = data.employes.map(e => e.id);
  const late = obligations(d, scope).filter(o => o.kind === 'epp' && o.st === 'late').length;
  const canValidate = (empId: number) => {
    const e = d.emp(empId);
    return !!e && (role === 'rh' || (role === 'manager' && d.mgrOf(e) === me));
  };
  const nQ = data.feuilles.filter(f => f.statut === 'soumise' && canValidate(f.empId)).length;
  const nAbs = data.absences.filter(a => a.statut === 'demandee' && canValidate(a.empId)).length;
  if (role === 'rh') {
    const nReq = data.demandesCollab.filter(r => r.statut === 'attente').length;
    return [
      ['Pilotage', [{ view: 'dashboard', label: 'Tableau de bord', icon: HouseIcon, badge: nReq }, { view: 'echeances', label: 'Échéances', icon: BellIcon }, { view: 'budget', label: 'Plan & budget', icon: ChartBarIcon }]],
      ['Collaborateurs', [{ view: 'collaborateurs', label: 'Annuaire', icon: UserIcon, badge: data.employes.filter(e => !e.equipe).length }, { view: 'equipes', label: 'Équipes & managers', icon: UsersThreeIcon }, { view: 'entretiens', label: 'Entretiens', icon: ChatIcon, badge: late }]],
      ['Compétences', [{ view: 'formations', label: 'Formations', icon: BookOpenIcon }, { view: 'habilitations', label: 'Habilitations', icon: ShieldCheckIcon }]],
      ['Temps & absences', [{ view: 'temps', label: 'Feuilles de temps', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Congés & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projets & déplacements', [{ view: 'missions', label: 'Missions', icon: MapPinIcon }, { view: 'voyages', label: 'Voyages', icon: AirplaneIcon, badge: data.demandesKeystone.length }, { view: 'chantiers', label: 'Chantiers · Go / No Go', icon: BriefcaseIcon }]],
      ['Administration', [{ view: 'parametres', label: 'Paramètres', icon: GearSixIcon }]],
    ];
  }
  if (role === 'manager') {
    return [
      ['Mon équipe', [{ view: 'collaborateurs', label: 'Équipe', icon: UserIcon }, { view: 'formations', label: 'Formations', icon: BookOpenIcon }, { view: 'entretiens', label: 'Entretiens', icon: ChatIcon, badge: late }]],
      ['Temps & absences', [{ view: 'temps', label: 'Feuilles de temps', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Congés & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projets & déplacements', [{ view: 'missions', label: 'Missions', icon: MapPinIcon }]],
    ];
  }
  return [
    ['Mon espace', [{ view: 'portail', label: 'Accueil', icon: HouseIcon }, { view: 'entretiens', label: 'Mes entretiens', icon: ChatIcon }]],
    ['Temps & absences', [{ view: 'temps', label: 'Mes heures', icon: ClockIcon }, { view: 'absences', label: 'Mes absences', icon: CalendarBlankIcon }]],
  ];
}

function Sidebar({ groups }: { groups: NavGroup[] }) {
  const { session, data, view, go, switchMode, logout } = useStore();
  const role = session?.role ?? 'rh';
  const user = session?.user ?? null;
  const roleLabel = user ? user.intitule : role === 'manager' ? 'Espace manager' : role === 'collaborateur' ? 'Espace collaborateur' : 'Espace RH';
  return (
    <aside className="sidebar">
      <span className="brand">
        <span className="brand-mark"><CheckIcon size={13} weight="bold" /></span>
        <span>Cursus</span>
      </span>
      {session?.demo && (
        <div className="side-block">
          <span className="side-label">Vue</span>
          <div className="seg" role="radiogroup" aria-label="Rôle" style={{ fontSize: 12, alignSelf: 'stretch', display: 'flex' }}>
            {([['rh', 'RH'], ['manager', 'Manager'], ['collaborateur', 'Utilisateur']] as [Role, string][]).map(([r, l]) => (
              <label key={r} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                <input type="radio" name="mode" checked={role === r} onChange={() => switchMode(r)} />{l}
              </label>
            ))}
          </div>
        </div>
      )}
      <nav aria-label="Navigation principale" className="side-nav">
        {data && groups.map(([label, items]) => (
          <div key={label} className="nav-group">
            <span className="side-label">{label}</span>
            {items.map(it => (
              <a key={it.view} href={`/${it.view}`} className="nav-item" aria-current={view === it.view ? 'page' : undefined}
                onClick={e => { e.preventDefault(); go(it.view); }}>
                <it.icon size={16} />
                <span>{it.label}</span>
                {!!it.badge && <span className="tag tag-accent nav-badge">{it.badge}</span>}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-user">
        {user ? <Avatar nom={user.nom} size={32} /> : <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>—</span>}
        <div className="who">
          <div style={{ fontSize: 13 }}>{user ? user.nom : 'Non connecté'}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{roleLabel}</div>
        </div>
        {user && (role !== 'rh' || !session?.demo) && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Se déconnecter" title="Se déconnecter" onClick={logout} style={{ color: 'inherit', width: 30, height: 30, flex: 'none' }}>
            <SignOutIcon size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}

function Topbar({ groups }: { groups: NavGroup[] }) {
  const { session, view, ui, setUi, go, openDialog, data } = useStore();
  const g = groups.find(([, items]) => items.some(i => i.view === view));
  const page = g?.[1].find(i => i.view === view);
  const rh = session?.user?.role === 'rh';
  return (
    <header className="topbar">
      <div className="crumb"><span>{g ? g[0] : 'Cursus'}</span><span className="sep">/</span><span className="here">{page ? page.label : 'Connexion'}</span></div>
      {rh && data && (
        <div className="topbar-actions">
          <label className="search">
            <MagnifyingGlassIcon size={14} />
            <input className="input" type="text" placeholder="Rechercher un collaborateur…" aria-label="Rechercher un collaborateur"
              value={ui.search} onChange={e => { setUi({ search: e.target.value }); if (view !== 'collaborateurs') go('collaborateurs'); }} />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'session', f: ui.formationFilter ?? undefined })}>
            <PlusIcon size={14} /><span>Nouvelle session</span>
          </button>
        </div>
      )}
    </header>
  );
}

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div role="status" className={`toast${toast.error ? ' error' : ''}`}>
      <CheckIcon size={14} weight="bold" />
      <span>{toast.text}</span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { session, data } = useStore();
  const role = session?.role ?? 'rh';
  const groups = useMemo(() => navGroups(data, role), [data, role]);
  return (
    <div className="app">
      <Sidebar groups={groups} />
      <div className="main-col">
        <Topbar groups={groups} />
        <main className="content">{children}</main>
      </div>
      <Toast />
    </div>
  );
}
