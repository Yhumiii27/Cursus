// Coque de l'application (Norma 2.0, norma/charte/COQUE.md ; classes de norma/charte/coque.css) : barre latérale de
// 232 px (marque, recherche de pages ⌘K, sections du menu repliables en capitales, pied : espace et personne connectée),
// contenu où chaque page porte son en-tête (layout/Coque.tsx : fil d'Ariane, titre, recherche, actions, paire langue /
// affichage en dernier), notification, et reconnexion par-dessus l'écran quand la session expire (le reste devient inerte).
// Pas de barre d'en-tête globale sur grand écran. À 1024 px et moins, la barre latérale devient un tiroir ouvert par le
// bouton « Menu » de la barre supérieure (layout/Tiroir.tsx), qui porte aussi la paire langue / affichage. Lien
// « Aller au contenu » en tête, titre de l'onglet par page et focus sur le titre après un changement de page
// (layout/navigation.ts). Chaque pastille du menu est lue « N à traiter » par un lecteur d'écran.
// Les notifications passent par deux régions live toujours présentes (un lecteur d'écran n'annonce pas une
// région insérée avec son texte) : les succès en « status », les erreurs en « alert ».
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AirplaneIcon, BellIcon, BookOpenIcon, CaretDownIcon, CaretRightIcon, MagnifyingGlassIcon, /* lot 12 — C5 */ CalendarCheckIcon, BooksIcon, BriefcaseIcon, CalendarBlankIcon, ChartBarIcon, ChartLineIcon, ChatIcon, CheckIcon, ClockIcon, GearSixIcon, HardHatIcon,
  HouseIcon, IdentificationCardIcon, KeyIcon, LifebuoyIcon, LockSimpleIcon, MapPinIcon, PlusIcon, ReceiptIcon, ShieldCheckIcon, SignOutIcon, TargetIcon, TreeStructureIcon, UserIcon, UsersThreeIcon, WarningIcon, XIcon, type Icon,
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
// lot 11 — pwa : bandeaux hors ligne et mise à jour, installation, barre d'onglets de l'application installée.
import { BandeauHorsLigne } from '../components/BandeauHorsLigne.tsx';
import { InstallerApplication } from '../components/InstallerApplication.tsx';
import { BarreOnglets } from './BarreOnglets.tsx';
// Norma 2.0 (COQUE.md) : en-tête de page commun, paire langue / affichage, recherche de pages ⌘K (règle de la charte).
import { CoqueContexte, Preferences, type Coque } from './Coque.tsx';
import { matchPages } from '../../../norma/charte/ds/coque-rules.ts';
// Norma § 2 et § 7 (CU-N01) : chaînes sources anglaises traduites.
import { t, useLangue } from '../i18n/langue.ts';
import { ongletsDe } from './onglets.ts';
// lot 12 — C5 (planning d'équipe)
import { planifieLuiMeme } from '../components/planning/planning-vue.ts';
// lot 12 — C3 (entretiens suivis et 360°)
import { ChatsCircleIcon } from '@phosphor-icons/react';
import { avisADonner } from '../../../shared/rules/a-faire.ts';
// lot 12 — C6 (badgeage virtuel)
import { TimerIcon } from '@phosphor-icons/react';
import { correctionsAValider, pointe } from '../components/temps/pointage-etat.ts';

/** Entrée du menu : `label` et le nom du groupe sont des chaînes sources anglaises, traduites là où elles s'affichent (t). */
interface NavItem { view: View; label: string; icon: Icon; badge?: number }
type NavGroup = [string, NavItem[]];

/**
 * lot 12 — entrées du menu des chantiers (socle) : une fonction par chantier, dans son bloc, qui rend ses entrées pour
 * l'espace affiché, chacune avec le groupe où elle se range (un groupe existant de l'espace, à sa fin, ou un nouveau
 * groupe, en fin de menu) et sa pastille. Les groupes de `navGroups` ne changent pas ; dans l'espace RH, les entrées sont
 * filtrées ensuite par les écrans du profil, comme les autres.
 */
type EntreesMenu = (data: Dataset, d: ReturnType<typeof domaineDe>, role: Role) => [string, NavItem][];
const ENTREES_LOT12: readonly EntreesMenu[] = [
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°) : « Mes objectifs » du collaborateur (réglage objectifsActifs), pastille : objectifs
  // proches de leur échéance sans mise à jour (shared/rules/a-faire.ts).
  (data, d, role) => (role === 'collaborateur' && data.settings.objectifsActifs
    ? [['My space', { view: 'objectifs', label: 'My objectives', icon: TargetIcon, badge: aFaireCollaborateur(d, data.user.empId).objectifs.length }]] : []),
  // Feedback 360° (étape 3) : « Avis demandés » le module activé, pour qui est ou a été sollicité comme répondant
  // (collaborateur ; manager sollicité comme N+2 ou collègue) ; pastille : avis encore à donner.
  (data, d, role) => {
    const me = data.user.empId;
    if (!data.settings.feedback360Actif || me == null || role === 'rh') return [];
    if (role === 'manager' && !(data.feedbackSollicitations ?? []).some(s => s.repondantEmpId === me)) return [];
    return [['My space', { view: 'avis', label: 'Feedback requested', icon: ChatsCircleIcon, badge: avisADonner(data.feedbackSollicitations ?? [], me, d.ti).length }]];
  },
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe) : « Mon planning » du collaborateur, le module activé ; pastille : échanges proposés à
  // lui, à accepter ou refuser. Le planning de l'équipe est un onglet de Temps de travail.
  // Le manager lui-même planifié (ses postes ou des échanges qui le concernent dans son instantané) l'a aussi.
  (data, _d, role) => (data.settings.planningActif && (role === 'collaborateur' || (role === 'manager' && data.user.empId != null && planifieLuiMeme(data, data.user.empId)))
    ? [['Time & absences', { view: 'planning', label: 'My schedule', icon: CalendarCheckIcon, badge: (data.echangesPoste ?? []).filter(e => e.statut === 'propose' && e.partenaireId === data.user.empId).length }]]
    : []),
  // lot 12 — C6 (badgeage virtuel) : entrée « Pointages » le module activé, pour qui pointe ou décide de corrections
  // (manager, service RH ; profils restreints : jamais, `vuesDe`) ; pastille : corrections à valider.
  (data, d, role) => {
    if (!data.settings.pointageActif) return [];
    const rh = droitsRh(data.user).includes('rh'), me = data.user.empId, soi = data.user.salarieId ?? null;
    if (role === 'collaborateur' && !pointe(data, me)) return [];
    const badge = correctionsAValider(d, { rh, manager: role === 'manager', me, soi }).length;
    return [['Time & absences', { view: 'pointages', label: role === 'collaborateur' ? 'My clock-ins' : 'Clock-ins', icon: TimerIcon, badge }]];
  },
];

/** Entrées du lot 12 pour cet espace (`ENTREES_LOT12`). */
const entreesLot12: EntreesMenu = (data, d, role) => ENTREES_LOT12.flatMap(f => f(data, d, role));

/** Groupes du menu avec les entrées du lot 12 (`entreesLot12`) rangées dans leur groupe. */
function avecLot12(groupes: NavGroup[], entrees: readonly [string, NavItem][]): NavGroup[] {
  if (!entrees.length) return groupes;
  const out = groupes.map(([g, items]): NavGroup => [g, [...items]]);
  for (const [g, item] of entrees) {
    const groupe = out.find(([nom]) => nom === g);
    if (groupe) groupe[1].push(item);
    else out.push([g, [item]]);
  }
  return out;
}

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
  // lot 11 — notes de frais : entrée du menu le module activé ; pastille : notes à contrôler (service RH, comptabilité), à
  // valider (manager : équipe directe et délégations « frais »), à corriger (collaborateur).
  const fraisActifs = !!data.settings.notesFraisActives;
  const notesFrais = data.notesFrais ?? [];
  const frais = (label: string, badge: number): NavItem[] => (fraisActifs ? [{ view: 'frais', label, icon: ReceiptIcon, badge }] : []);
  if (role === 'rh') {
    const nReq = droitsRh(data.user).includes('formations') ? data.demandesCollab.filter(r => r.statut === 'attente').length : 0;
    // Écrans du profil (référent HSE, paie, lecture seule : une partie de l'espace RH).
    const vues = vuesDe('rh', data.user.profilRh);
    const groupes: NavGroup[] = [
      ['Steering', [{ view: 'dashboard', label: 'Dashboard', icon: HouseIcon, badge: nReq }, { view: 'echeances', label: 'Due dates', icon: BellIcon }, { view: 'budget', label: 'Training plan & budget', icon: ChartBarIcon },
        // lot 11 — indicateurs : BDESE et index d'égalité (service RH et lecture seule).
        { view: 'indicateurs', label: 'Social indicators', icon: ChartLineIcon }]],
      ['Employees', [{ view: 'collaborateurs', label: 'Directory', icon: UserIcon, badge: data.employes.filter(e => !e.equipe).length }, { view: 'equipes', label: 'Teams & managers', icon: UsersThreeIcon }, /* lot 11 — organigramme */ { view: 'organigramme', label: 'Organisation chart', icon: TreeStructureIcon }, { view: 'entretiens', label: 'Reviews', icon: ChatIcon, badge: late },
        /* lot 14 — personnes sur site */ { view: 'site', label: 'People on site', icon: IdentificationCardIcon }]],
      ['Skills', [{ view: 'formations', label: 'Training', icon: BookOpenIcon }, { view: 'habilitations', label: 'Authorisations', icon: ShieldCheckIcon }]],
      // Compte professionnel de prévention (lot 7) : service RH, référent HSE et lecture seule.
      ['Prevention', [{ view: 'prevention', label: 'Exposures (C2P)', icon: HardHatIcon }]],
      ['Time & absences', [{ view: 'temps', label: 'Timesheets', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Leave & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projects & travel', [{ view: 'missions', label: 'Assignments', icon: MapPinIcon }, { view: 'voyages', label: 'Trips', icon: AirplaneIcon, badge: data.demandesKeystone.filter(x => x.statut === 'attente').length }, { view: 'chantiers', label: 'Worksites · Go / No Go', icon: BriefcaseIcon },
        // lot 11 — notes de frais : contrôle (service RH, comptabilité), jamais sa propre note.
        ...frais('Expense reports', notesFrais.filter(n => n.statut === 'validee' && n.empId !== soi).length)]],
      ['Administration', [{ view: 'referentiels', label: 'Reference data', icon: BooksIcon }, { view: 'parametres', label: 'Settings', icon: GearSixIcon }]],
    ];
    // Profil Paie : le groupe « Collaborateurs » ne garde que l'organigramme (lot 11).
    return avecLot12(groupes, entreesLot12(data, d, role)).map(([g, items]): NavGroup => [g, items.filter(i => vues.includes(i.view))]).filter(([, items]) => items.length > 0);
  }
  // lot 11 — organigramme : entrée du menu selon le réglage `organigrammeOuvert` (shared/rules/organigramme.ts).
  const organigramme: NavItem[] = organigrammeOuvertA(data.settings.organigrammeOuvert, role) ? [{ view: 'organigramme', label: 'Organisation chart', icon: TreeStructureIcon }] : [];
  if (role === 'manager') {
    return avecLot12([
      // Formations : évaluations à froid à faire sur l'équipe directe (lot 7, t121, shared/rules/evaluation-formation.ts).
      ['My team', [{ view: 'collaborateurs', label: 'Team', icon: UserIcon }, { view: 'formations', label: 'Training', icon: BookOpenIcon, badge: evaluationsAFaireManager(d, me).length }, { view: 'entretiens', label: 'Reviews', icon: ChatIcon, badge: late }]],
      ['Time & absences', [{ view: 'temps', label: 'Timesheets', icon: ClockIcon, badge: nQ }, { view: 'absences', label: 'Leave & absences', icon: CalendarBlankIcon, badge: nAbs }]],
      ['Projects & travel', [{ view: 'missions', label: 'Assignments', icon: MapPinIcon },
        // lot 11 — notes de frais
        ...frais('Expense reports', notesFrais.filter(n => n.statut === 'soumise' && !n.medicale && canValidate(n.empId, 'frais')).length)]],
      ...(organigramme.length ? [['Organisation', organigramme] as NavGroup] : []),
    ], entreesLot12(data, d, role));
  }
  // Collaborateur : comptes rendus à signer, feuilles renvoyées ou semaine passée à soumettre, évaluations de formation
  // attendues (accueil, lot 7 t121) : shared/rules/a-faire.ts.
  const aFaire = aFaireCollaborateur(d, me);
  return avecLot12([
    ['My space', [{ view: 'portail', label: 'Home', icon: HouseIcon, badge: aFaire.evaluations.length },
      // lot 11 — notes de frais : en deuxième, pour la barre d'onglets de l'application installée (saisie au téléphone).
      ...frais('My expenses', notesFrais.filter(n => n.empId === me && n.statut === 'a_corriger').length),
      { view: 'entretiens', label: 'My reviews', icon: ChatIcon, badge: aFaire.comptesRendus.length }]],
    ['Time & absences', [{ view: 'temps', label: 'My hours', icon: ClockIcon, badge: aFaire.feuilles.length }, { view: 'absences', label: 'My absences', icon: CalendarBlankIcon }]],
    ...(organigramme.length ? [['Organisation', organigramme] as NavGroup] : []),
  ], entreesLot12(data, d, role));
}

const VUES: [Role, string][] = [['rh', 'HR'], ['manager', 'Manager'], ['collaborateur', 'User']];

/** Groupe et libellé de la page affichée, traduits : fil d'Ariane de l'en-tête et titre de l'onglet. */
function pageAffichee(groups: NavGroup[], view: View, connecte: boolean): [string, string] {
  if (view === 'confidentialite') return ['Cursus', t('Privacy')];
  if (view === 'aide') return ['Cursus', t('Help')];
  // Hors du menu : ouverte depuis Paramètres.
  if (view === 'miseEnService') return [t('Administration'), t('Commissioning')];
  const g = groups.find(([, items]) => items.some(i => i.view === view));
  const page = g?.[1].find(i => i.view === view);
  return g && page ? [t(g[0]), t(page.label)] : ['Cursus', connecte ? 'Cursus' : t('Sign-in')];
}

/** Fil d'Ariane de l'en-tête de page : section › page du menu (le nom de l'outil est dans la marque). */
function filAriane(groups: NavGroup[], view: View, connecte: boolean): string[] {
  const [groupe, page] = pageAffichee(groups, view, connecte);
  return groupe === 'Cursus' ? [] : [groupe, page];
}

/** Pastille d'une entrée du menu : le nombre, lu « N à traiter » par un lecteur d'écran. */
const Pastille = ({ n }: { n: number }) => (
  <span className="coque-badge"><span aria-hidden="true">{n}</span><span className="sr-only">, {t(`${n} to handle`)}</span></span>
);

/** Sections du menu repliées, gardées dans le cookie `cursus-menu` (noms sources des groupes, un an). */
const MENU_COOKIE = 'cursus-menu';
function sectionsRepliees(): Set<string> {
  const v = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith(`${MENU_COOKIE}=`));
  return new Set(v ? decodeURIComponent(v.slice(MENU_COOKIE.length + 1)).split('|').filter(Boolean) : []);
}
function garderSections(replies: Set<string>) {
  document.cookie = `${MENU_COOKIE}=${encodeURIComponent([...replies].join('|'))}; path=/; max-age=31536000; samesite=lax`;
}

/** Entrée du menu (`.coque-entry`), page courante `aria-current="page"` ; le choix referme le tiroir. */
function Entree({ view, label, icon: I, badge, actif, item, choisir }: { view: View; label: string; icon: Icon; badge?: number; actif: boolean; item?: boolean; choisir: (v: View) => void }) {
  return (
    <a href={`/${view}`} className={`coque-entry${item ? ' is-item' : ''}`} aria-current={actif ? 'page' : undefined}
      onClick={e => { e.preventDefault(); choisir(view); }}>
      <I size={16} className="coque-entry-icon" aria-hidden="true" />
      <span className="coque-entry-label">{label}</span>
      {!!badge && <Pastille n={badge} />}
    </a>
  );
}

/**
 * Recherche de pages ⌘K (COQUE.md § 2), juste sous la marque : ⌘K / Ctrl+K y met le focus (hors dialogue), Entrée ouvre
 * la première page trouvée, Échap vide ; pendant la saisie, les pages trouvées (page et section) remplacent le menu.
 */
function RecherchePages({ pages, choisir, children }: { pages: { view: View; label: string; section: string; icon: Icon; badge?: number }[]; choisir: (v: View) => void; children: ReactNode }) {
  const [q, setQ] = useState('');
  const champ = useRef<HTMLInputElement>(null);
  const trouvees = useMemo(() => matchPages(pages, q), [pages, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k' || document.querySelector('[aria-modal="true"]:not(aside)')) return;
      e.preventDefault();
      champ.current?.focus();
      champ.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const aller = (v: View) => { setQ(''); choisir(v); };
  return (
    <>
      <div className="coque-pagesearch">
        <MagnifyingGlassIcon size={13} className="coque-pagesearch-icon" aria-hidden="true" />
        <input ref={champ} className="input" type="search" value={q} placeholder={t('Go to a page…')} aria-label={t('Go to a page…')}
          aria-keyshortcuts="Control+K Meta+K" autoComplete="off" spellCheck={false} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); }
            else if (e.key === 'Enter' && trouvees.length) { e.preventDefault(); aller(trouvees[0].view); }
          }} />
        <span className="coque-kbd" aria-hidden="true">⌘K</span>
      </div>
      {q.trim() ? (
        <nav className="coque-nav" aria-label={t('Main menu')}>
          {trouvees.map(p => (
            <a key={p.view} href={`/${p.view}`} className="coque-entry" onClick={e => { e.preventDefault(); aller(p.view); }}>
              <p.icon size={16} className="coque-entry-icon" aria-hidden="true" />
              <span className="coque-entry-hit">
                <span className="coque-entry-label">{p.label}</span>
                <span className="coque-entry-section">{p.section}</span>
              </span>
              {!!p.badge && <Pastille n={p.badge} />}
            </a>
          ))}
          {!trouvees.length && <span className="coque-nav-empty">{t('No page matches')}</span>}
        </nav>
      ) : children}
    </>
  );
}

function Sidebar({ groups, tiroir }: { groups: NavGroup[]; tiroir: Tiroir }) {
  const { session, data, view, go, switchMode, bascule, logout, openDialog, reconnexion, horsLigne } = useStore();
  // lot 11 — pwa : saisies encore gardées sur l'appareil, tous espaces confondus (la déconnexion purge toute la file) :
  // confirmation d'abord.
  const deconnecter = () => void horsLigne.taille().then(n => n ? openDialog({ type: 'deconnexion', n }) : logout());
  const barre = useRef<HTMLElement>(null);
  const [replies, setReplies] = useState<Set<string>>(sectionsRepliees);
  const basculerSection = (g: string) => setReplies(r => {
    const n = new Set(r);
    if (n.has(g)) n.delete(g); else n.add(g);
    garderSections(n);
    return n;
  });
  // Écran étroit : un choix (page, espace, mot de passe, déconnexion) referme d'abord le tiroir.
  const puis = (f: () => void) => () => { tiroir.fermer(); f(); };
  const choisir = (v: View) => { tiroir.fermer(); go(v); };
  const role = session?.role ?? 'rh';
  const user = session?.user ?? null;
  const compte = session?.compte ?? null;
  const roleLabel = user ? user.intitule : t(role === 'manager' ? 'Manager space' : role === 'collaborateur' ? 'Employee space' : 'HR space');
  // Démonstration : les trois vues, connexion libre. Sinon : les espaces du compte, s'il en a plusieurs ; l'espace RH d'un
  // profil restreint porte le nom court du profil (HSE, Paie, Lecture).
  const vues = session?.demo ? VUES : user && compte && compte.espaces.length > 1
    ? VUES.filter(([r]) => compte.espaces.includes(r)).map(([r, l]): [Role, string] => [r, r === 'rh' ? PROFILS_RH[compte.profilRh]?.espace ?? t(l) : t(l)])
    : [];
  const vuesAffichees = session?.demo ? vues.map(([r, l]): [Role, string] => [r, t(l)]) : vues;
  const ouvert = tiroir.ouvert;
  // Pages de la recherche ⌘K : celles du menu de l'espace, puis Confidentialité et Aide.
  const pages = useMemo(() => [
    ...groups.flatMap(([g, items]) => items.map(i => ({ view: i.view, label: t(i.label), section: t(g), icon: i.icon, badge: i.badge }))),
    ...(data ? [{ view: 'confidentialite' as View, label: t('Privacy'), section: 'Cursus', icon: LockSimpleIcon }, { view: 'aide' as View, label: t('Help'), section: 'Cursus', icon: LifebuoyIcon }] : []),
  ], [groups, data]);
  return (
    <>
      {/* Tiroir ouvert : fond qui le referme ; la page derrière devient inerte. */}
      <div className={`coque-backdrop${ouvert ? ' is-on' : ''}`} aria-hidden="true" onClick={tiroir.fermer} />
      <aside ref={barre} id={ID_MENU} className={`coque-side${ouvert ? ' is-open' : ''}`} tabIndex={ouvert ? -1 : undefined}
        role={ouvert ? 'dialog' : undefined} aria-modal={ouvert || undefined} aria-label={t('Main menu')}>
        {ouvert && <PiegeTiroir barre={barre} actif={!reconnexion} fermer={tiroir.fermer} />}
        <div className="coque-brand">
          <span className="coque-logo"><CheckIcon size={15} weight="bold" aria-hidden="true" /></span>
          <span className="coque-wordmark">Cursus</span>
          <button type="button" className="btn btn-ghost btn-icon coque-side-close" aria-label={t('Close menu')} title={t('Close menu')} onClick={tiroir.fermer}>
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>
        {data && (
          <RecherchePages pages={pages} choisir={choisir}>
            <nav aria-label={t('Main navigation')} className="coque-nav-sections">
              {groups.map(([label, items]) => {
                const courante = items.some(i => i.view === view);
                // La section de la page affichée reste ouverte.
                const ouverte = courante || !replies.has(label);
                const aTraiter = items.reduce((n, i) => n + (i.badge ?? 0), 0);
                return (
                  <div key={label} className="coque-sec">
                    <button type="button" className={`coque-sec-head${courante ? ' is-bright' : ''}`} aria-expanded={ouverte} onClick={() => basculerSection(label)}>
                      {ouverte ? <CaretDownIcon size={11} className="coque-entry-icon" aria-hidden="true" /> : <CaretRightIcon size={11} className="coque-entry-icon" aria-hidden="true" />}
                      <span className="coque-entry-label">{t(label)}</span>
                      {!ouverte && aTraiter > 0 && <span className="coque-sec-badge"><span aria-hidden="true">{aTraiter}</span><span className="sr-only">, {t(`${aTraiter} to handle`)}</span></span>}
                    </button>
                    {ouverte && items.map(it => <Entree key={it.view} {...it} label={t(it.label)} item actif={view === it.view} choisir={choisir} />)}
                  </div>
                );
              })}
              {/* Information sur les données personnelles : dans tous les espaces (et depuis l'écran de connexion). Guide par
                  rôle (shared/aide.ts), ouvert aussi depuis l'écran de connexion. */}
              <div className="coque-nav">
                <Entree view="confidentialite" label={t('Privacy')} icon={LockSimpleIcon} actif={view === 'confidentialite'} choisir={choisir} />
                <Entree view="aide" label={t('Help')} icon={LifebuoyIcon} actif={view === 'aide'} choisir={choisir} />
                {/* lot 11 — pwa : proposé par le navigateur (Android, Chrome, Edge), jamais une fois installée. */}
                <InstallerApplication menu fermer={tiroir.fermer} />
              </div>
            </nav>
          </RecherchePages>
        )}
        {/* Pied : l'espace (RH, manager, collaborateur ; « Vue » en démonstration), puis la personne connectée. */}
        <div className="coque-side-foot">
          {vuesAffichees.length > 0 && (
            <div className="side-block">
              <span className="side-label">{t(session?.demo ? 'View' : 'Workspace')}</span>
              {/* Pendant le changement, l'espace actuel reste affiché jusqu'à l'arrivée des données du nouveau. */}
              <div className="seg seg-espace" role="radiogroup" aria-label={t('Workspace')} aria-busy={bascule}>
                {vuesAffichees.map(([r, l]) => (
                  <label key={r} className="seg-opt">
                    <input type="radio" name="mode" checked={role === r} disabled={bascule} onChange={puis(() => switchMode(r))} />{l}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="coque-user">
            {user ? <Avatar nom={user.nom} size={28} /> : <span className="coque-avatar" aria-hidden="true">—</span>}
            <div className="coque-who">
              <span className="coque-who-name">{user ? user.nom : t('Not signed in')}</span>
              <span className="coque-who-role">{roleLabel}</span>
            </div>
            <span className="coque-user-actions">
              {user && session?.methode === 'local' && (
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Change my password')} title={t('Change my password')} onClick={puis(() => openDialog({ type: 'motDePasse' }))}>
                  <KeyIcon size={14} aria-hidden="true" />
                </button>
              )}
              {user && (
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Sign out')} title={t('Sign out')} onClick={puis(deconnecter)}>
                  <SignOutIcon size={14} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Barre supérieure (≤ 1024 px, COQUE.md § 8), premier élément de <main> : bouton « Menu » (sa pastille totalise celles
 * du menu) · marque · paire langue / affichage, dernier élément. Masquée sur grand écran (coque.css).
 */
function BarreSuperieure({ groups, tiroir }: { groups: NavGroup[]; tiroir: Tiroir }) {
  const aTraiter = groups.reduce((n, [, items]) => n + items.reduce((m, i) => m + (i.badge ?? 0), 0), 0);
  return (
    <div className="coque-topbar" data-print-hide="">
      <BoutonMenu tiroir={tiroir} aTraiter={aTraiter} />
      <span className="coque-topbar-brand"><CheckIcon size={15} weight="bold" className="coque-topbar-logo" aria-hidden="true" />Cursus</span>
      <div className="coque-topbar-tools"><Preferences /></div>
    </div>
  );
}

/** Ce que la coque donne à l'en-tête de chaque page : fil d'Ariane, recherche des collaborateurs, « Nouvelle session ». */
function useCoque(groups: NavGroup[]): Coque {
  const { session, view, ui, openDialog, data } = useStore();
  const fil = filAriane(groups, view, !!session?.user);
  // Recherche si l'espace ouvre l'annuaire (service RH, profils de l'espace RH qui l'ont, manager sur son équipe) ;
  // nouvelle session pour le service RH et le référent HSE.
  const user = data?.user;
  const recherche = !!user && user.role !== 'collaborateur' && vuesDe(user.role, user.profilRh).includes('collaborateurs');
  const sessions = !!user && droitsRh(user).includes('formations');
  const connecte = !!session?.user && !!data;
  return {
    fil,
    // Suggestions au fil de la frappe ; la fiche s'ouvre sur Entrée ou au clic (t152, layout/RechercheGlobale.tsx).
    recherche: connecte && recherche ? <RechercheGlobale data={data} role={user.role} /> : undefined,
    nouvelleSession: connecte && sessions ? (principale: boolean) => (
      <button type="button" className={`btn btn-${principale ? 'primary' : 'secondary'}`} onClick={() => openDialog({ type: 'session', f: ui.formationFilter ?? undefined })}>
        <PlusIcon size={14} aria-hidden="true" /><span>{t('New session')}</span>
      </button>
    ) : undefined,
  };
}

/** Notification : coche pour un succès (effacé seul), avertissement pour une erreur (reste affichée). */
function Carte({ toast, fermer }: { toast: StoreToast; fermer: () => void }) {
  return (
    <div className={`toast${toast.error ? ' error' : ''}`}>
      {toast.error ? <WarningIcon size={16} weight="bold" aria-hidden="true" /> : <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      <span>{toast.error && <span className="sr-only">{t('Error: ')}</span>}{toast.text}</span>
      <button type="button" className="btn btn-ghost btn-icon toast-fermer" aria-label={t('Close the notification')} title={t('Close')} onClick={fermer}>
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
  // Langue affichée : la coque et les pages sont rendues de nouveau quand elle change (sélecteur FR / EN).
  useLangue();
  const role = session?.role ?? 'rh';
  const groups = useMemo(() => navGroups(data, role), [data, role]);
  const tiroir = useTiroir();
  const coque = useCoque(groups);
  // Page affichée (null pendant le chargement) : titre de l'onglet, focus sur son titre quand elle change.
  const connecte = !!session?.user;
  const enCours = loading || (connecte && !data);
  useNavigationAnnoncee(enCours ? null : connecte ? `${role}/${view}` : view === 'confidentialite' || view === 'aide' ? view : 'connexion',
    enCours ? null : pageAffichee(groups, view, connecte)[1]);
  const allerAuContenu = (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(ID_CONTENU)?.focus(); };
  return (
    <>
      <a className="coque-skip" href={`#${ID_CONTENU}`} onClick={allerAuContenu}>{t('Skip to main content')}</a>
      {/* Coque commune (Norma 2.0, COQUE.md) : barre latérale de 232 px | contenu ; ≤ 1024 px, tiroir et barre supérieure. */}
      <div className="coque app" inert={!!reconnexion}>
        <Sidebar groups={groups} tiroir={tiroir} />
        <main className="coque-main content" id={ID_CONTENU} tabIndex={-1} inert={tiroir.ouvert}>
          <BarreSuperieure groups={groups} tiroir={tiroir} />
          <BandeauHorsLigne />
          <CoqueContexte.Provider value={coque}>{children}</CoqueContexte.Provider>
        </main>
        {connecte && data && <BarreOnglets onglets={ongletsDe(groups)} tiroir={tiroir} />}
      </div>
      {reconnexion && <Reconnexion />}
      <Toast />
    </>
  );
}
