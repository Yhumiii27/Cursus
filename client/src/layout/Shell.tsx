// Coque de l'application : barre latérale (rôle, navigation, utilisateur), en-tête, notification, et
// reconnexion par-dessus l'écran quand la session expire (le reste devient inerte).
// Les notifications passent par deux régions live toujours présentes (un lecteur d'écran n'annonce pas une
// région insérée avec son texte) : les succès en « status », les erreurs en « alert ».
import { useMemo, type ReactNode } from 'react';
import {
  AirplaneIcon, BellIcon, BookOpenIcon, BooksIcon, BriefcaseIcon, CalendarBlankIcon, ChartBarIcon, ChatIcon, CheckIcon, ClockIcon, GearSixIcon,
  HouseIcon, KeyIcon, MagnifyingGlassIcon, MapPinIcon, PlusIcon, ShieldCheckIcon, SignOutIcon, UserIcon, UsersThreeIcon, WarningIcon, XIcon, type Icon,
} from '@phosphor-icons/react';
import { droitsRh, PROFILS_RH, vuesDe } from '../../../shared/constants.ts';
import { Domain } from '../../../shared/domain.ts';
import { obligations, perimetreEntretiens } from '../../../shared/rules/entretiens.ts';
import type { Dataset, Role } from '../../../shared/types.ts';
import { Avatar } from '../components/ui.tsx';
import { useStore, type Toast as StoreToast, type View } from '../state/store.tsx';
import { Reconnexion } from './Reconnexion.tsx';

interface NavItem { view: View; label: string; icon: Icon; badge?: number }
type NavGroup = [string, NavItem[]];

function navGroups(data: Dataset | null, role: Role): NavGroup[] {
  if (!data) return [];
  const d = new Domain(data);
  const me = data.user.empId;
  // Entretiens en retard de l'équipe : ceux du manager lui-même relèvent de son responsable (espace collaborateur).
  const late = obligations(d, perimetreEntretiens(data)).filter(o => o.kind === 'epp' && o.st === 'late').length;
  // Service RH (jamais pour ses propres demandes) ou manager direct ; les profils restreints ne valident rien.
  const rh = droitsRh(data.user).includes('rh'), soi = data.user.salarieId ?? null;
  const canValidate = (empId: number) => {
    const e = d.emp(empId);
    return !!e && ((rh && empId !== soi) || (role === 'manager' && d.mgrOf(e) === me));
  };
  const nQ = data.feuilles.filter(f => f.statut === 'soumise' && canValidate(f.empId)).length;
  // Demandes à valider ; pour le RH, aussi les absences signalées à qualifier.
  const nAbs = data.absences.filter(a => (a.statut === 'demandee' && canValidate(a.empId)) || (rh && a.statut === 'signalee' && a.empId !== soi)).length;
  if (role === 'rh') {
    const nReq = droitsRh(data.user).includes('formations') ? data.demandesCollab.filter(r => r.statut === 'attente').length : 0;
    // Écrans du profil (référent HSE, paie, lecture seule : une partie de l'espace RH).
    const vues = vuesDe('rh', data.user.profilRh);
    const groupes: NavGroup[] = [
      ['Pilotage', [{ view: 'dashboard', label: 'Tableau de bord', icon: HouseIcon, badge: nReq }, { view: 'echeances', label: 'Échéances', icon: BellIcon }, { view: 'budget', label: 'Plan & budget', icon: ChartBarIcon }]],
      ['Collaborateurs', [{ view: 'collaborateurs', label: 'Annuaire', icon: UserIcon, badge: data.employes.filter(e => !e.equipe).length }, { view: 'equipes', label: 'Équipes & managers', icon: UsersThreeIcon }, { view: 'entretiens', label: 'Entretiens', icon: ChatIcon, badge: late }]],
      ['Compétences', [{ view: 'formations', label: 'Formations', icon: BookOpenIcon }, { view: 'habilitations', label: 'Habilitations', icon: ShieldCheckIcon }]],
      ['Temps & absences', [{ view: 'temps', label: 'Feuilles de temps', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Congés & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projets & déplacements', [{ view: 'missions', label: 'Missions', icon: MapPinIcon }, { view: 'voyages', label: 'Voyages', icon: AirplaneIcon, badge: data.demandesKeystone.filter(x => x.statut === 'attente').length }, { view: 'chantiers', label: 'Chantiers · Go / No Go', icon: BriefcaseIcon }]],
      ['Administration', [{ view: 'referentiels', label: 'Référentiels', icon: BooksIcon }, { view: 'parametres', label: 'Paramètres', icon: GearSixIcon }]],
    ];
    return groupes.map(([g, items]): NavGroup => [g, items.filter(i => vues.includes(i.view))]).filter(([, items]) => items.length > 0);
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

const VUES: [Role, string][] = [['rh', 'RH'], ['manager', 'Manager'], ['collaborateur', 'Utilisateur']];

function Sidebar({ groups }: { groups: NavGroup[] }) {
  const { session, data, view, go, switchMode, bascule, logout, openDialog } = useStore();
  const role = session?.role ?? 'rh';
  const user = session?.user ?? null;
  const compte = session?.compte ?? null;
  const roleLabel = user ? user.intitule : role === 'manager' ? 'Espace manager' : role === 'collaborateur' ? 'Espace collaborateur' : 'Espace RH';
  // Démonstration : les trois vues, connexion libre. Sinon : les espaces du compte, s'il en a plusieurs ; l'espace RH d'un
  // profil restreint porte le nom court du profil (HSE, Paie, Lecture).
  const vues = session?.demo ? VUES : user && compte && compte.espaces.length > 1
    ? VUES.filter(([r]) => compte.espaces.includes(r)).map(([r, l]): [Role, string] => [r, r === 'rh' ? PROFILS_RH[compte.profilRh]?.espace ?? l : l])
    : [];
  return (
    <aside className="sidebar">
      <span className="brand">
        <span className="brand-mark"><CheckIcon size={13} weight="bold" /></span>
        <span>Cursus</span>
      </span>
      {vues.length > 0 && (
        <div className="side-block">
          <span className="side-label">{session?.demo ? 'Vue' : 'Espace'}</span>
          {/* Pendant le changement, l'espace actuel reste affiché jusqu'à l'arrivée des données du nouveau. */}
          <div className="seg" role="radiogroup" aria-label="Espace" aria-busy={bascule} style={{ fontSize: 12, alignSelf: 'stretch', display: 'flex' }}>
            {vues.map(([r, l]) => (
              <label key={r} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                <input type="radio" name="mode" checked={role === r} disabled={bascule} onChange={() => switchMode(r)} />{l}
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
        {user && session?.methode === 'local' && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Changer mon mot de passe" title="Changer mon mot de passe" onClick={() => openDialog({ type: 'motDePasse' })} style={{ color: 'inherit', width: 30, height: 30, flex: 'none' }}>
            <KeyIcon size={14} />
          </button>
        )}
        {user && (
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
  // Espace RH : recherche si le profil ouvre l'annuaire, nouvelle session pour le service RH et le référent HSE.
  const user = data?.user;
  const recherche = user?.role === 'rh' && vuesDe('rh', user.profilRh).includes('collaborateurs');
  const sessions = !!user && droitsRh(user).includes('formations');
  return (
    <header className="topbar">
      <div className="crumb"><span>{g ? g[0] : 'Cursus'}</span><span className="sep">/</span><span className="here">{page ? page.label : 'Connexion'}</span></div>
      {session?.user && data && (recherche || sessions) && (
        <div className="topbar-actions">
          {recherche && (
            <label className="search">
              <MagnifyingGlassIcon size={14} />
              <input className="input" type="text" placeholder="Rechercher un collaborateur…" aria-label="Rechercher un collaborateur"
                value={ui.search} onChange={e => { setUi({ search: e.target.value }); if (view !== 'collaborateurs') go('collaborateurs'); }} />
            </label>
          )}
          {sessions && (
            <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'session', f: ui.formationFilter ?? undefined })}>
              <PlusIcon size={14} /><span>Nouvelle session</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/** Notification : coche pour un succès (effacé seul), avertissement pour une erreur (reste affichée). */
function Carte({ toast, fermer }: { toast: StoreToast; fermer: () => void }) {
  return (
    <div className={`toast${toast.error ? ' error' : ''}`}>
      {toast.error ? <WarningIcon size={16} weight="bold" aria-hidden="true" /> : <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      <span>{toast.error && <span className="sr-only">Erreur : </span>}{toast.text}</span>
      <button type="button" className="btn btn-ghost btn-icon toast-fermer" aria-label="Fermer la notification" title="Fermer" onClick={fermer}>
        <XIcon size={12} />
      </button>
    </div>
  );
}

export function Toast() {
  const { toast, fermerNotification } = useStore();
  return (
    <div className="toasts">
      <div role="status" aria-live="polite" aria-atomic="true">
        {toast && !toast.error && <Carte key={toast.id} toast={toast} fermer={fermerNotification} />}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {toast?.error && <Carte key={toast.id} toast={toast} fermer={fermerNotification} />}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { session, data, reconnexion } = useStore();
  const role = session?.role ?? 'rh';
  const groups = useMemo(() => navGroups(data, role), [data, role]);
  return (
    <>
      <div className="app" inert={!!reconnexion}>
        <Sidebar groups={groups} />
        <div className="main-col">
          <Topbar groups={groups} />
          <main className="content">{children}</main>
        </div>
      </div>
      {reconnexion && <Reconnexion />}
      <Toast />
    </>
  );
}
