// Coque de l'application : barre latérale (rôle, navigation, utilisateur), en-tête, notification, et
// reconnexion par-dessus l'écran quand la session expire (le reste devient inerte).
// Sur écran étroit, la barre latérale devient un tiroir ouvert par le bouton « Menu » (layout/Tiroir.tsx). Lien
// « Aller au contenu » en tête, titre de l'onglet par page et focus sur le titre après un changement de page
// (layout/navigation.ts). Chaque pastille du menu est lue « N à traiter » par un lecteur d'écran.
// Les notifications passent par deux régions live toujours présentes (un lecteur d'écran n'annonce pas une
// région insérée avec son texte) : les succès en « status », les erreurs en « alert ».
import { useMemo, useRef, type ReactNode } from 'react';
import {
  AirplaneIcon, BellIcon, BookOpenIcon, BooksIcon, BriefcaseIcon, CalendarBlankIcon, ChartBarIcon, ChatIcon, CheckIcon, ClockIcon, GearSixIcon, HardHatIcon,
  HouseIcon, KeyIcon, LifebuoyIcon, LockSimpleIcon, MapPinIcon, PlusIcon, ShieldCheckIcon, SignOutIcon, TreeStructureIcon, UserIcon, UsersThreeIcon, WarningIcon, XIcon, type Icon,
} from '@phosphor-icons/react';
import { droitsRh, PROFILS_RH, vuesDe } from '../../../shared/constants.ts';
import { aFaireCollaborateur } from '../../../shared/rules/a-faire.ts';
import { obligations, perimetreEntretiens } from '../../../shared/rules/entretiens.ts';
import { organigrammeOuvertA } from '../../../shared/rules/organigramme.ts';
import { evaluationsAFaireManager } from '../../../shared/rules/evaluation-formation.ts';
import type { Dataset, PerimetreDelegation, Role } from '../../../shared/types.ts';
import { Avatar } from '../components/ui.tsx';
import { domaineDe } from '../state/derived.ts';
import { useStore, type Toast as StoreToast, type View } from '../state/store.tsx';
import { ID_CONTENU, useNavigationAnnoncee } from './navigation.ts';
import { Reconnexion } from './Reconnexion.tsx';
import { RechercheGlobale } from './RechercheGlobale.tsx';
import { BoutonMenu, ID_MENU, PiegeTiroir, useTiroir, type Tiroir } from './Tiroir.tsx';
import { decideur } from '../state/delegues.ts';

interface NavItem { view: View; label: string; icon: Icon; badge?: number }
type NavGroup = [string, NavItem[]];

function navGroups(data: Dataset | null, role: Role): NavGroup[] {
  if (!data) return [];
  const d = domaineDe(data);
  const me = data.user.empId;
  // Entretiens en retard de l'équipe : ceux du manager lui-même relèvent de son responsable (espace collaborateur).
  const late = obligations(d, perimetreEntretiens(data)).filter(o => o.kind === 'epp' && o.st === 'late').length;
  // Service RH (jamais pour ses propres demandes) ou manager direct ; les profils restreints ne valident rien.
  const rh = droitsRh(data.user).includes('rh'), soi = data.user.salarieId ?? null;
  // Délégation (t135) : aussi les demandes dont le manager connecté décide comme suppléant (state/delegues.ts).
  const canValidate = (empId: number, perimetre: PerimetreDelegation) => {
    const e = d.emp(empId);
    return !!e && ((rh && empId !== soi) || (role === 'manager' && decideur(d, e, me, perimetre)));
  };
  const nQ = data.feuilles.filter(f => f.statut === 'soumise' && canValidate(f.empId, 'feuilles')).length;
  // Demandes à valider ; pour le RH, aussi les absences signalées à qualifier.
  const nAbs = data.absences.filter(a => (a.statut === 'demandee' && canValidate(a.empId, 'absences')) || (rh && a.statut === 'signalee' && a.empId !== soi)).length;
  if (role === 'rh') {
    const nReq = droitsRh(data.user).includes('formations') ? data.demandesCollab.filter(r => r.statut === 'attente').length : 0;
    // Écrans du profil (référent HSE, paie, lecture seule : une partie de l'espace RH).
    const vues = vuesDe('rh', data.user.profilRh);
    const groupes: NavGroup[] = [
      ['Pilotage', [{ view: 'dashboard', label: 'Tableau de bord', icon: HouseIcon, badge: nReq }, { view: 'echeances', label: 'Échéances', icon: BellIcon }, { view: 'budget', label: 'Plan & budget', icon: ChartBarIcon }]],
      ['Collaborateurs', [{ view: 'collaborateurs', label: 'Annuaire', icon: UserIcon, badge: data.employes.filter(e => !e.equipe).length }, { view: 'equipes', label: 'Équipes & managers', icon: UsersThreeIcon }, /* lot 11 — organigramme */ { view: 'organigramme', label: 'Organigramme', icon: TreeStructureIcon }, { view: 'entretiens', label: 'Entretiens', icon: ChatIcon, badge: late }]],
      ['Compétences', [{ view: 'formations', label: 'Formations', icon: BookOpenIcon }, { view: 'habilitations', label: 'Habilitations', icon: ShieldCheckIcon }]],
      // Compte professionnel de prévention (lot 7) : service RH, référent HSE et lecture seule.
      ['Prévention', [{ view: 'prevention', label: 'Expositions (C2P)', icon: HardHatIcon }]],
      ['Temps & absences', [{ view: 'temps', label: 'Feuilles de temps', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Congés & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projets & déplacements', [{ view: 'missions', label: 'Missions', icon: MapPinIcon }, { view: 'voyages', label: 'Voyages', icon: AirplaneIcon, badge: data.demandesKeystone.filter(x => x.statut === 'attente').length }, { view: 'chantiers', label: 'Chantiers · Go / No Go', icon: BriefcaseIcon }]],
      ['Administration', [{ view: 'referentiels', label: 'Référentiels', icon: BooksIcon }, { view: 'parametres', label: 'Paramètres', icon: GearSixIcon }]],
    ];
    // Profil Paie : le groupe « Collaborateurs » ne garde que l'organigramme (lot 11).
    return groupes.map(([g, items]): NavGroup => [g, items.filter(i => vues.includes(i.view))]).filter(([, items]) => items.length > 0);
  }
  // lot 11 — organigramme : entrée du menu selon le réglage `organigrammeOuvert` (shared/rules/organigramme.ts).
  const organigramme: NavItem[] = organigrammeOuvertA(data.settings.organigrammeOuvert, role) ? [{ view: 'organigramme', label: 'Organigramme', icon: TreeStructureIcon }] : [];
  if (role === 'manager') {
    return [
      // Formations : évaluations à froid à faire sur l'équipe directe (lot 7, t121, shared/rules/evaluation-formation.ts).
      ['Mon équipe', [{ view: 'collaborateurs', label: 'Équipe', icon: UserIcon }, { view: 'formations', label: 'Formations', icon: BookOpenIcon, badge: evaluationsAFaireManager(d, me).length }, { view: 'entretiens', label: 'Entretiens', icon: ChatIcon, badge: late }]],
      ['Temps & absences', [{ view: 'temps', label: 'Feuilles de temps', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Congés & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projets & déplacements', [{ view: 'missions', label: 'Missions', icon: MapPinIcon }]],
      ...(organigramme.length ? [['Organisation', organigramme] as NavGroup] : []),
    ];
  }
  // Collaborateur : comptes rendus à signer, feuilles renvoyées ou semaine passée à soumettre, évaluations de formation
  // attendues (accueil, lot 7 t121) : shared/rules/a-faire.ts.
  const aFaire = aFaireCollaborateur(d, me);
  return [
    ['Mon espace', [{ view: 'portail', label: 'Accueil', icon: HouseIcon, badge: aFaire.evaluations.length }, { view: 'entretiens', label: 'Mes entretiens', icon: ChatIcon, badge: aFaire.comptesRendus.length }]],
    ['Temps & absences', [{ view: 'temps', label: 'Mes heures', icon: ClockIcon, badge: aFaire.feuilles.length }, { view: 'absences', label: 'Mes absences', icon: CalendarBlankIcon }]],
    ...(organigramme.length ? [['Organisation', organigramme] as NavGroup] : []),
  ];
}

const VUES: [Role, string][] = [['rh', 'RH'], ['manager', 'Manager'], ['collaborateur', 'Utilisateur']];

/** Groupe et libellé de la page affichée : fil d'Ariane de l'en-tête et titre de l'onglet. */
function pageAffichee(groups: NavGroup[], view: View, connecte: boolean): [string, string] {
  if (view === 'confidentialite') return ['Cursus', 'Confidentialité'];
  if (view === 'aide') return ['Cursus', 'Aide'];
  // Hors du menu : ouverte depuis Paramètres.
  if (view === 'miseEnService') return ['Administration', 'Mise en service'];
  const g = groups.find(([, items]) => items.some(i => i.view === view));
  const page = g?.[1].find(i => i.view === view);
  return g && page ? [g[0], page.label] : ['Cursus', connecte ? 'Cursus' : 'Connexion'];
}

/** Pastille d'une entrée du menu : le nombre, lu « N à traiter » par un lecteur d'écran. */
const Pastille = ({ n }: { n: number }) => (
  <span className="tag tag-accent nav-badge"><span aria-hidden="true">{n}</span><span className="sr-only">, {n} à traiter</span></span>
);

function Sidebar({ groups, tiroir }: { groups: NavGroup[]; tiroir: Tiroir }) {
  const { session, data, view, go, switchMode, bascule, logout, openDialog, reconnexion } = useStore();
  const barre = useRef<HTMLElement>(null);
  // Écran étroit : un choix (page, espace, mot de passe, déconnexion) referme d'abord le tiroir.
  const puis = (f: () => void) => () => { tiroir.fermer(); f(); };
  const role = session?.role ?? 'rh';
  const user = session?.user ?? null;
  const compte = session?.compte ?? null;
  const roleLabel = user ? user.intitule : role === 'manager' ? 'Espace manager' : role === 'collaborateur' ? 'Espace collaborateur' : 'Espace RH';
  // Démonstration : les trois vues, connexion libre. Sinon : les espaces du compte, s'il en a plusieurs ; l'espace RH d'un
  // profil restreint porte le nom court du profil (HSE, Paie, Lecture).
  const vues = session?.demo ? VUES : user && compte && compte.espaces.length > 1
    ? VUES.filter(([r]) => compte.espaces.includes(r)).map(([r, l]): [Role, string] => [r, r === 'rh' ? PROFILS_RH[compte.profilRh]?.espace ?? l : l])
    : [];
  const ouvert = tiroir.ouvert;
  return (
    <aside ref={barre} id={ID_MENU} className={`sidebar${ouvert ? ' ouvert' : ''}`} tabIndex={ouvert ? -1 : undefined}
      role={ouvert ? 'dialog' : undefined} aria-modal={ouvert || undefined} aria-label={ouvert ? 'Menu' : undefined}>
      {ouvert && <PiegeTiroir barre={barre} actif={!reconnexion} fermer={tiroir.fermer} />}
      <div className="side-tete">
        <span className="brand">
          <span className="brand-mark"><CheckIcon size={13} weight="bold" /></span>
          <span>Cursus</span>
        </span>
        <button type="button" className="btn btn-ghost btn-icon fermer-tiroir" aria-label="Fermer le menu" title="Fermer le menu" onClick={tiroir.fermer}>
          <XIcon size={16} />
        </button>
      </div>
      {vues.length > 0 && (
        <div className="side-block">
          <span className="side-label">{session?.demo ? 'Vue' : 'Espace'}</span>
          {/* Pendant le changement, l'espace actuel reste affiché jusqu'à l'arrivée des données du nouveau. */}
          <div className="seg" role="radiogroup" aria-label="Espace" aria-busy={bascule} style={{ fontSize: 12, alignSelf: 'stretch', display: 'flex' }}>
            {vues.map(([r, l]) => (
              <label key={r} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                <input type="radio" name="mode" checked={role === r} disabled={bascule} onChange={puis(() => switchMode(r))} />{l}
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
                onClick={e => { e.preventDefault(); tiroir.fermer(); go(it.view); }}>
                <it.icon size={16} />
                <span>{it.label}</span>
                {!!it.badge && <Pastille n={it.badge} />}
              </a>
            ))}
          </div>
        ))}
        {/* Information sur les données personnelles : dans tous les espaces (et depuis l'écran de connexion). */}
        {data && (
          <div className="nav-group">
            <a href="/confidentialite" className="nav-item" aria-current={view === 'confidentialite' ? 'page' : undefined}
              onClick={e => { e.preventDefault(); tiroir.fermer(); go('confidentialite'); }}>
              <LockSimpleIcon size={16} />
              <span>Confidentialité</span>
            </a>
            {/* Guide par rôle (shared/aide.ts), ouvert aussi depuis l'écran de connexion. */}
            <a href="/aide" className="nav-item" aria-current={view === 'aide' ? 'page' : undefined}
              onClick={e => { e.preventDefault(); tiroir.fermer(); go('aide'); }}>
              <LifebuoyIcon size={16} />
              <span>Aide</span>
            </a>
          </div>
        )}
      </nav>
      <div className="side-user">
        {user ? <Avatar nom={user.nom} size={32} /> : <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>—</span>}
        <div className="who">
          <div style={{ fontSize: 13 }}>{user ? user.nom : 'Non connecté'}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{roleLabel}</div>
        </div>
        {user && session?.methode === 'local' && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Changer mon mot de passe" title="Changer mon mot de passe" onClick={puis(() => openDialog({ type: 'motDePasse' }))} style={{ color: 'inherit', width: 30, height: 30, flex: 'none' }}>
            <KeyIcon size={14} />
          </button>
        )}
        {user && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Se déconnecter" title="Se déconnecter" onClick={puis(logout)} style={{ color: 'inherit', width: 30, height: 30, flex: 'none' }}>
            <SignOutIcon size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}

function Topbar({ groups, tiroir }: { groups: NavGroup[]; tiroir: Tiroir }) {
  const { session, view, ui, openDialog, data } = useStore();
  const [groupe, page] = pageAffichee(groups, view, !!session?.user);
  // Pastilles du menu replié : leur total sur le bouton « Menu ».
  const aTraiter = groups.reduce((n, [, items]) => n + items.reduce((m, i) => m + (i.badge ?? 0), 0), 0);
  // Recherche si l'espace ouvre l'annuaire (service RH, profils de l'espace RH qui l'ont, manager sur son équipe) ;
  // nouvelle session pour le service RH et le référent HSE.
  const user = data?.user;
  const recherche = !!user && user.role !== 'collaborateur' && vuesDe(user.role, user.profilRh).includes('collaborateurs');
  const sessions = !!user && droitsRh(user).includes('formations');
  return (
    <header className="topbar">
      <BoutonMenu tiroir={tiroir} aTraiter={aTraiter} />
      <div className="crumb"><span>{groupe}</span><span className="sep">/</span><span className="here">{page}</span></div>
      {session?.user && data && (recherche || sessions) && (
        <div className="topbar-actions">
          {/* Suggestions au fil de la frappe ; la fiche s'ouvre sur Entrée ou au clic (t152, layout/RechercheGlobale.tsx). */}
          {recherche && <RechercheGlobale data={data} role={user.role} />}
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
  const { session, data, reconnexion, loading, view } = useStore();
  const role = session?.role ?? 'rh';
  const groups = useMemo(() => navGroups(data, role), [data, role]);
  const tiroir = useTiroir();
  // Page affichée (null pendant le chargement) : titre de l'onglet, focus sur son titre quand elle change.
  const connecte = !!session?.user;
  const enCours = loading || (connecte && !data);
  useNavigationAnnoncee(enCours ? null : connecte ? `${role}/${view}` : view === 'confidentialite' || view === 'aide' ? view : 'connexion',
    enCours ? null : pageAffichee(groups, view, connecte)[1]);
  const allerAuContenu = (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(ID_CONTENU)?.focus(); };
  return (
    <>
      <div className="app" inert={!!reconnexion}>
        <a className="lien-evitement" href={`#${ID_CONTENU}`} onClick={allerAuContenu}>Aller au contenu</a>
        <Sidebar groups={groups} tiroir={tiroir} />
        {/* Tiroir ouvert : fond qui le referme ; la page derrière devient inerte. */}
        {tiroir.ouvert && <div className="tiroir-fond" aria-hidden="true" onClick={tiroir.fermer} />}
        <div className="main-col" inert={tiroir.ouvert}>
          <Topbar groups={groups} tiroir={tiroir} />
          <main className="content" id={ID_CONTENU} tabIndex={-1}>{children}</main>
        </div>
      </div>
      {reconnexion && <Reconnexion />}
      <Toast />
    </>
  );
}
