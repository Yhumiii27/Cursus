// Organigramme (lot 11, chantier C1, étape 2 ; shared/rules/organigramme.ts, client/src/organigramme-vue.ts) : sociétés,
// établissements, équipes racines et rattachées, présents de chaque équipe. Ouvert à tout l'espace RH et, selon le
// réglage `organigrammeOuvert` (choix par défaut : tous), aux managers et aux collaborateurs.
// - Construit sur les données déjà envoyées à tous : annuaire (nom, équipe, poste), équipes et leur manager, entités et
//   sites ; les présents viennent du serveur pour tous les espaces (`presentsOrganigramme`, sans les dates). Aucune donnée
//   de contrat, de sortie, d'absence ni de santé ; le suppléant d'un manager n'est montré que d'après les délégations que la
//   personne voit déjà, sans les dates.
// - Service RH (droit `rh`) et lecture seule : anomalies (équipe sans manager, salarié à affecter, équipe racine sans
//   entité, équipe racine au nom de site), salariés à affecter et étiquettes de contrat (intérim, CDD, alternance).
// - Arbre en listes imbriquées (role tree / treeitem / group, aria-expanded) reliées par des traits CSS ; clavier : flèches
//   haut et bas, droite (déplier, puis premier nœud rattaché), gauche (replier, puis nœud parent), Début, Fin, Entrée
//   (déplier, ou ouvrir la fiche quand le profil y a accès). Sous 600 px, liste indentée sans traits (app.css).
// - Recherche (nom, poste, équipe) : les nœuds qui mènent aux résultats sont dépliés, les personnes surlignées, Entrée
//   place le focus sur le premier résultat. Filtres entité et site gardés dans l'adresse (state/url.ts).
// - Impression (paysage, une entité par page) et CSV (colonnes de l'annuaire) signalés au journal par
//   `organigramme.imprimer` et `organigramme.exporter` : entité et nombre de lignes, jamais le nom d'une personne (lot 12 —
//   C7 : avec le service choisi, nom d'une équipe du référentiel, contrôlé par le serveur).
// - lot 12 — C7 : choix d'un service (une équipe et ses sous-équipes, `?service=`), fil d'Ariane de son rattachement,
//   « Voir ce service seul » après un clic sur une équipe ; présentation « Liste » ou « Graphique » (`?vue=`, arbre vertical
//   de components/organigramme/ArbreGraphique.tsx, liste indentée d'office sous 600 px) ; impression de l'arbre vertical.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BuildingsIcon, CaretDownIcon, CaretRightIcon, DownloadSimpleIcon, MagnifyingGlassIcon, PrinterIcon, UsersThreeIcon, WarningIcon,
  // lot 12 — C7 (organigramme)
  ListBulletsIcon, TreeStructureIcon, XIcon,
} from '@phosphor-icons/react';
import { TYPES_CONTRAT, vuesDe } from '../../../shared/constants.ts';
import { TYPES_ENTITE } from '../../../shared/rules/entites.ts';
import { anomalieTexte, arbre, type MembreArbre, type NoeudEntite, type NoeudEquipe } from '../../../shared/rules/organigramme.ts';
import type { Site } from '../../../shared/types.ts';
import { Avatar, Btn, Empty, Fine, Page, Panel, Seg, Tag } from '../components/ui.tsx';
// lot 12 — C7 (organigramme)
import { useMedia } from '../components/media.ts';
import { ArbreGraphique } from '../components/organigramme/ArbreGraphique.tsx';
import { idNoeud, toucheArbre } from '../components/organigramme/clavier.ts';
import { csvOrganigramme } from '../listes-csv.ts';
import {
  cleEntite, cleEquipe, clePersonne, clesDepliables, depliageInitial, filtrerArbre, formaterSiren, libelleSite, lignesOrganigramme, mentionEtat, sectionsImpression, siteEffectif,
  type ArbreFiltre,
  // lot 12 — C7 (organigramme)
  choixServices, clesDepliablesGraphique, ECHELLE_MIN, filAriane, noeudService, sectionsImpressionGraphique,
} from '../organigramme-vue.ts';
import { downloadCsv, printDocument } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Nœud « À affecter » (service RH) : clé à part, hors des entités et des équipes. */
const CLE_A_AFFECTER = 'a:';
// lot 12 — C7 (organigramme)
/** Sous cette largeur, la vue graphique laisse la place à la liste indentée (le choix reste dans l'adresse). */
const ECRAN_TELEPHONE = '(max-width: 600px)';

export function Organigramme() {
  const d = useDomain();
  const { ui, setUi, go, run, notify } = useStore();
  const { rh, consultation, user } = useRole();
  const data = d.ds;
  const r = data.referentiels;
  const entites = useMemo(() => r.entites ?? [], [r.entites]);
  const sites = useMemo(() => r.sites ?? [], [r.sites]);
  // Service RH et lecture seule : anomalies, salariés à affecter, étiquettes de contrat.
  const vueRh = user.role === 'rh' && (rh || consultation);
  const [recherche, setRecherche] = useState('');

  const brut = useMemo(() => {
    // Présents du jour : la liste transmise par le serveur (`presentsOrganigramme`, `presentsDe` : même règle `presentA`,
    // fiches anonymisées exclues), pour tous les espaces ; elle l'emporte sur les dates dans `arbre()`.
    const etiquettes = vueRh ? new Map(data.employes.filter(e => e.typeContrat && e.typeContrat !== 'cdi').map(e => [e.id, TYPES_CONTRAT[e.typeContrat].label])) : undefined;
    return arbre(entites, r.equipes, data.annuaire, data.delegations ?? [], data.today, { rh: vueRh, presents: data.presentsOrganigramme, etiquettes });
  }, [data, entites, r.equipes, vueRh]);
  const vue = useMemo(() => filtrerArbre(brut, r.equipes, entites, { entite: ui.orgEntite, site: ui.orgSite, recherche, service: ui.orgService }),
    [brut, r.equipes, entites, ui.orgEntite, ui.orgSite, recherche, ui.orgService]);
  // lot 12 — C7 (organigramme) : services proposés (équipes de l'arbre sous l'entité et le site choisis, aucune de plus),
  // service affiché seul (sa boîte en haut) et présentation effective (la liste sur un téléphone).
  const services = useMemo(() => choixServices(filtrerArbre(brut, r.equipes, entites, { entite: ui.orgEntite, site: ui.orgSite, recherche: '' }), r.equipes),
    [brut, r.equipes, entites, ui.orgEntite, ui.orgSite]);
  const racineService = ui.orgService ? noeudService(vue, ui.orgService) : null;
  const telephone = useMedia(ECRAN_TELEPHONE);
  const graphique = ui.orgVue === 'graphique' && !telephone;
  // Équipe touchée dans l'arbre (clic, focus) : « Voir ce service seul » la propose.
  const [equipeTouchee, setEquipeTouchee] = useState<string | null>(null);
  const choisirService = (nom: string | null) => { setUi({ orgService: nom }); setEquipeTouchee(null); };

  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set([...depliageInitial(brut), CLE_A_AFFECTER]));
  // Recherche : les nœuds qui mènent aux résultats s'ajoutent aux nœuds dépliés (la personne peut ensuite les replier).
  useEffect(() => {
    if (vue.chemins.size) setOuverts(o => ([...vue.chemins].every(c => o.has(c)) ? o : new Set([...o, ...vue.chemins])));
  }, [vue.chemins]);
  // lot 12 — C7 (organigramme) : le service choisi (champ, adresse, fil d'Ariane, « Voir ce service seul ») s'affiche
  // déplié, avec ses sous-équipes directes, comme les équipes racines au départ : ses membres sont visibles d'emblée.
  // Clés jointes en une chaîne : l'effet ne rejoue qu'au changement de service (« Tout replier » reste respecté).
  const clesService = useMemo(() => {
    const q = noeudService(brut, ui.orgService);
    return q ? [cleEquipe(q.nom), ...q.equipes.map(f => cleEquipe(f.nom))].join('\n') : '';
  }, [brut, ui.orgService]);
  useEffect(() => {
    if (!clesService) return;
    const cles = clesService.split('\n');
    setOuverts(o => (cles.every(c => o.has(c)) ? o : new Set([...o, ...cles])));
  }, [clesService]);
  const basculer = (cle: string, ouvrir?: boolean) => setOuverts(o => {
    const n = new Set(o);
    if (ouvrir ?? !n.has(cle)) n.add(cle); else n.delete(cle);
    return n;
  });

  // Fiche ouverte depuis l'organigramme : seulement si le profil a l'annuaire et la personne dans son périmètre.
  const fiches = vuesDe(user.role, user.profilRh).includes('collaborateurs');
  const ficheOuvrable = (id: number) => fiches && data.employes.some(e => e.id === id);
  const ouvrirFiche = (id: number) => { if (ficheOuvrable(id)) go('collaborateurs', { selectedId: id }); };

  const nomDe = (id: number) => d.personName(id);
  const contexte = { equipes: r.equipes, entites, sites, nom: nomDe };
  const entiteChoisie = entites.find(x => x.code === ui.orgEntite) ?? null;
  const portee = [entiteChoisie?.nom, ui.orgSite ? `${t('site ')}${libelleSite(sites, ui.orgSite)}` : '', /* lot 12 — C7 */ ui.orgService ? `${t('service ')}${ui.orgService}` : '']
    .filter(Boolean).join(' · ') || t('All entities');
  const imprimer = () => {
    const lignes = lignesOrganigramme(vue, contexte);
    // lot 12 — C7 (organigramme) : en vue graphique, l'arbre vertical (le service choisi seul, ou une page par entité),
    // réduit à l'échelle de la page s'il est trop large ; en liste, les listes imbriquées, le service choisi seul s'il y en a un.
    const reduites = graphique ? sectionsImpressionGraphique(vue, contexte, ui.orgService) : [];
    const sections = graphique
      ? reduites.map((s, i) => ({
        title: s.titre, arbre: s.arbre, saut: i > 0, vertical: true, echelle: s.echelle,
        sub: [s.sousTitre, s.echelle < 100 ? `${t('tree reduced to ')}${s.echelle}${t(' % to fit the width of the page')}${s.echelle <= ECHELLE_MIN ? t(': some boxes may overflow') : ''}` : ''].filter(Boolean).join(' · '),
      }))
      : (racineService
        ? sectionsImpressionGraphique(vue, contexte, ui.orgService).map(s => ({ title: s.titre, sub: s.sousTitre, arbre: s.arbre }))
        : sectionsImpression(vue, contexte).map((s, i) => ({ title: s.titre, sub: s.sousTitre, arbre: s.arbre, saut: i > 0 })));
    if (!printDocument(t('Organisation chart'), `${portee} · ${mentionEtat(d.ti)}`, sections, undefined, undefined, { paysage: true, journal: false })) {
      notify(t('Printing impossible: allow Cursus’s windows in the browser.'), true);
      return;
    }
    const reduite = reduites.find(s => s.echelle < 100);
    if (reduite) notify(`${t('Tree too wide for a page: printed reduced (down to ')}${Math.min(...reduites.map(s => s.echelle))} %).`);
    void run('organigramme.imprimer', { entite: ui.orgEntite ?? '', lignes: lignes.length, /* lot 12 — C7 */ ...(ui.orgService ? { service: ui.orgService } : {}) }, { silent: true });
  };
  const exporter = () => {
    const x = csvOrganigramme(d.ti, lignesOrganigramme(vue, contexte), ui.orgEntite);
    downloadCsv(x.fichier, x.head, x.rows, undefined, { journal: false });
    void run('organigramme.exporter', { entite: ui.orgEntite ?? '', lignes: x.rows.length, /* lot 12 — C7 */ ...(ui.orgService ? { service: ui.orgService } : {}) }, { silent: true });
    notify(`${t('CSV export generated — ')}${tn(x.rows.length, 'line', 'lines')}`);
  };

  const nEquipes = r.equipes.length, nEntites = entites.filter(x => x.actif && !x.fermeLe).length;
  const kicker = `${tn(brut.effectif, 'person present', 'people present')} · ${tn(nEquipes, 'team', 'teams')} · ${tn(nEntites, 'entity', 'entities')}`;
  const filtre = !!(ui.orgEntite || ui.orgSite || recherche.trim() || /* lot 12 — C7 */ ui.orgService);
  // Entités proposées : celles de l'arbre (sociétés, puis leurs établissements).
  const choixEntites = brut.entites.flatMap(n => [n, ...n.etablissements]);
  const choixSites = sites.filter(s => s.actif || s.code === ui.orgSite || r.equipes.some(q => siteEffectif(r.equipes, entites, q.nom) === s.code));

  return (
    <Page kicker={kicker} title={t('Organisation chart')} actions={<>
      <Btn variant="secondary" icon={<PrinterIcon size={14} />} onClick={imprimer} disabled={vue.effectif === 0}>{t('Print')}</Btn>
      <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={vue.effectif === 0}>{t('Export (CSV)')}</Btn>
    </>}>
      {vueRh && brut.anomalies.length > 0 && <Anomalies arbreBrut={brut} nom={nomDe} rh={rh} />}
      <Panel className="org-panel">
        <div className="filtres-liste org-filtres no-print">
          <label className="org-recherche">
            <MagnifyingGlassIcon size={14} aria-hidden="true" />
            <span className="sr-only">{t('Search the organisation chart')}</span>
            <input className="input" type="search" value={recherche} placeholder={ui.orgService ? `${t('Name or job in ')}${ui.orgService}` : t('Name, job or team')} onChange={e => setRecherche(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                document.querySelector<HTMLElement>('.org-arbre [role="treeitem"].trouve, .orgg-arbre [role="treeitem"].trouve')?.focus();
              }} />
          </label>
          {choixEntites.length > 1 && (
            <select className="input" aria-label={t('Entity')} value={ui.orgEntite ?? ''} onChange={e => setUi({ orgEntite: e.target.value || null })}>
              <option value="">{t('All entities')}</option>
              {choixEntites.map(x => <option key={x.code} value={x.code}>{x.type === 'etablissement' ? `— ${x.nom}` : x.nom}</option>)}
            </select>
          )}
          {choixSites.length > 0 && (
            <select className="input" aria-label={t('Site')} value={ui.orgSite ?? ''} onChange={e => setUi({ orgSite: e.target.value || null })}>
              <option value="">{t('All sites')}</option>
              {choixSites.map(s => <option key={s.code} value={s.code}>{s.libelle}</option>)}
            </select>
          )}
          {/* lot 12 — C7 (organigramme) */}
          {services.length > 0 && <ChoixService services={services} service={ui.orgService} choisir={choisirService} />}
          <Seg name="org-vue" label={t('Presentation')} value={ui.orgVue} onChange={v => setUi({ orgVue: v })} options={[
            ['liste', <span key="l" className="org-seg"><ListBulletsIcon size={14} aria-hidden="true" />{t('List')}</span>],
            ['graphique', <span key="g" className="org-seg"><TreeStructureIcon size={14} aria-hidden="true" />{t('Chart')}</span>],
          ]} />
          <span className="grow" />
          <Btn small onClick={() => setOuverts(new Set([...(graphique ? clesDepliablesGraphique(vue) : clesDepliables(vue)), CLE_A_AFFECTER]))}>{t('Expand all')}</Btn>
          <Btn small onClick={() => setOuverts(new Set())}>{t('Collapse all')}</Btn>
        </div>
        {/* lot 12 — C7 (organigramme) : rattachement du service choisi, proposition de l'équipe touchée, message du téléphone. */}
        {ui.orgService && <Ariane service={ui.orgService} etapes={filAriane(r.equipes, entites, ui.orgService)} choisir={choisirService} />}
        {equipeTouchee && equipeTouchee !== ui.orgService && (
          <div className="org-proposition no-print">
            <span>{`${t('Team ')}${equipeTouchee}`}</span>
            <Btn small variant="secondary" onClick={() => choisirService(equipeTouchee)}>{t('See this department alone')}</Btn>
          </div>
        )}
        {ui.orgVue === 'graphique' && telephone && <p className="org-note no-print">{t('Chart view unavailable on a narrow screen: the organisation chart is shown as a list.')}</p>}
        <p className="sr-only" role="status">{filtre ? `${tn(vue.effectif, 'person shown', 'people shown')}${recherche.trim() ? `, ${tn(vue.trouves.size, 'result', 'results')}` : ''}` : ''}</p>
        {vue.effectif === 0 && !vue.entites.length && !vue.sansEntite.length
          ? <Empty pad="sm">{t(filtre ? 'No team or person matches these filters.' : 'No team yet: the organisation chart is built from the teams and their members.')}</Empty>
          : (ui.orgService && !racineService
            ? <Empty pad="sm">{t('This department has no team or person under these filters.')}</Empty>
            : (graphique
              ? <ArbreGraphique vue={vue} service={racineService} ouverts={ouverts} basculer={basculer} vueRh={vueRh} sites={sites} ficheOuvrable={ficheOuvrable}
                ouvrirFiche={ouvrirFiche} cleAAffecter={CLE_A_AFFECTER} surEquipe={setEquipeTouchee} />
              : <Arbre vue={vue} service={racineService} ouverts={ouverts} basculer={basculer} vueRh={vueRh} sites={sites} ficheOuvrable={ficheOuvrable}
                ouvrirFiche={ouvrirFiche} surEquipe={setEquipeTouchee} />))}
        <Fine>
          {vueRh
            ? t('Present today, from the directory and the teams; contract labels, employees to assign and anomalies are shown to HR only. Approvals follow the managers and the parent teams: the entity changes no approver.')
            : t('Present today, from the directory: name, job, team and manager. No contract, absence or health data appears there.')}
          {' '}{t('Printed in landscape, one entity per page (or the chosen department alone; in chart view, the vertical tree); the CSV export takes the people shown.')}
        </Fine>
      </Panel>
    </Page>
  );
}

/** Anomalies (service RH, lecture seule) : à corriger dans Équipes & managers ou Référentiels → Entités et sites. */
function Anomalies({ arbreBrut, nom, rh }: { arbreBrut: Pick<ArbreFiltre, 'anomalies'>; nom: (id: number) => string; rh: boolean }) {
  const { go } = useStore();
  const [toutes, setToutes] = useState(false);
  const liste = arbreBrut.anomalies;
  const montrees = toutes ? liste : liste.slice(0, 6);
  return (
    <Panel highlight title={<span className="org-titre-alerte"><WarningIcon size={16} aria-hidden="true" /> {t('To check')}</span>} aside={tn(liste.length, 'point', 'points')}>
      <ul className="org-anomalies">
        {montrees.map(a => <li key={`${a.kind}-${'equipe' in a ? a.equipe : a.empId}`}>{anomalieTexte(a, nom)}</li>)}
      </ul>
      <div className="actions-end no-print" style={{ justifyContent: 'flex-start' }}>
        {liste.length > montrees.length && <Btn small onClick={() => setToutes(true)}>{`${t('Show the #all')}${liste.length}`}</Btn>}
        <Btn small onClick={() => go('equipes')}>{t('Teams & managers')} →</Btn>
        {rh && <Btn small onClick={() => go('referentiels', { refOnglet: 'entites' })}>{t('Entities and sites')} →</Btn>}
      </div>
    </Panel>
  );
}

interface PropsArbre {
  vue: ArbreFiltre; ouverts: Set<string>; basculer: (cle: string, ouvrir?: boolean) => void; vueRh: boolean;
  sites: readonly Site[]; ficheOuvrable: (id: number) => boolean; ouvrirFiche: (id: number) => void;
  // lot 12 — C7 (organigramme) : service choisi (seule racine) et équipe touchée (« Voir ce service seul »).
  service?: NoeudEquipe | null; surEquipe?: (nom: string) => void;
}

/** Arbre navigable au clavier (focus itinérant : un seul nœud dans l'ordre de tabulation). */
function Arbre({ vue, ouverts, basculer, vueRh, sites, ficheOuvrable, ouvrirFiche, service, surEquipe }: PropsArbre) {
  const base = useId();
  const racine = useRef<HTMLUListElement>(null);
  const [actif, setActif] = useState<string | null>(null);
  const idDe = (cle: string) => idNoeud(base, cle);

  // Nœuds affichés, dans l'ordre : le nœud actif disparu (replié, filtré), le premier reprend le focus itinérant.
  const visibles: string[] = [];
  const parcourirEquipe = (q: NoeudEquipe) => {
    visibles.push(cleEquipe(q.nom));
    if (!ouverts.has(cleEquipe(q.nom))) return;
    for (const m of q.membres) visibles.push(clePersonne(m.id));
    q.equipes.forEach(parcourirEquipe);
  };
  const parcourirEntite = (n: NoeudEntite) => {
    visibles.push(cleEntite(n.code));
    if (!ouverts.has(cleEntite(n.code))) return;
    n.equipes.forEach(parcourirEquipe);
    n.etablissements.forEach(parcourirEntite);
  };
  // lot 12 — C7 (organigramme) : le service choisi seul, sinon tout l'arbre.
  if (service) parcourirEquipe(service);
  else vue.entites.forEach(parcourirEntite);
  if (!service) vue.sansEntite.forEach(parcourirEquipe);
  if (!service && vue.aAffecter.length) {
    visibles.push(CLE_A_AFFECTER);
    if (ouverts.has(CLE_A_AFFECTER)) for (const m of vue.aAffecter) visibles.push(clePersonne(m.id));
  }
  const tabulable = actif && visibles.includes(actif) ? actif : visibles[0];

  // lot 12 — C7 (organigramme) : clavier commun aux deux présentations (components/organigramme/clavier.ts).
  const surTouche = (ev: Parameters<typeof toucheArbre>[0]) => toucheArbre(ev, racine.current, { basculer, ouvrirFiche, activer: setActif });

  /**
   * Nœud dépliable (entité, équipe, « À affecter ») : ligne cliquable, puis groupe des nœuds rattachés s'il est déplié.
   * Fonction de rendu et non composant : un composant déclaré ici serait remonté à chaque rendu et perdrait le focus.
   */
  const branche = (cle: string, niveau: number, classe: string, ligne: ReactNode, enfants: ReactNode, surClic?: () => void) => {
    const ouvert = ouverts.has(cle);
    return (
      <li key={cle} role="treeitem" aria-level={niveau} aria-expanded={ouvert} aria-labelledby={idDe(cle)} data-cle={cle} tabIndex={cle === tabulable ? 0 : -1}
        className={`org-item ${classe}`} onFocus={ev => { if (ev.target === ev.currentTarget) { setActif(cle); surClic?.(); } }}>
        <div className="org-ligne" id={idDe(cle)} onClick={() => { setActif(cle); basculer(cle); surClic?.(); }}>
          <span className="org-caret" aria-hidden="true">{ouvert ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}</span>
          {ligne}
        </div>
        {ouvert && <ul role="group" className="org-groupe">{enfants}</ul>}
      </li>
    );
  };

  const personne = (m: MembreArbre, niveau: number) => {
    const cle = clePersonne(m.id);
    const ouvrable = ficheOuvrable(m.id);
    return (
      <li key={cle} role="treeitem" aria-level={niveau} aria-labelledby={idDe(cle)} data-cle={cle} tabIndex={cle === tabulable ? 0 : -1}
        className={`org-item org-personne${vue.trouves.has(m.id) ? ' trouve' : ''}${ouvrable ? ' ouvrable' : ''}`}
        onFocus={ev => { if (ev.target === ev.currentTarget) setActif(cle); }}>
        <div className="org-ligne" id={idDe(cle)} onClick={() => { setActif(cle); ouvrirFiche(m.id); }} title={ouvrable ? t('Open the sheet') : undefined}>
          <Avatar nom={m.nom} size={24} />
          <span className="org-nom">{m.nom}</span>
          <span className="org-detail">{m.poste}</span>
          {m.manager && <Tag cls="tag-neutral">Manager</Tag>}
          {m.etiquette && <Tag cls="tag-outline">{m.etiquette}</Tag>}
          {ouvrable && <span className="sr-only">{t(', Enter: open the sheet')}</span>}
        </div>
      </li>
    );
  };

  const equipe = (q: NoeudEquipe, niveau: number, sansEntite = false): ReactNode => {
    const cle = cleEquipe(q.nom);
    const site = libelleSite(sites, q.siteCode);
    return (
      branche(cle, niveau, `org-equipe${vue.equipesTrouvees.has(q.nom) ? ' trouve' : ''}`, <>
        <UsersThreeIcon size={14} aria-hidden="true" className="org-icone" />
        <span className="org-nom">{q.nom}</span>
        <span className="org-detail">{q.manager ? `${t('manager: ')}${q.manager}` : t('no manager — approvals by HR')}</span>
        {q.suppleant && <Tag cls="tag-accent">{`${t('Deputy: ')}${q.suppleant.nom}`}</Tag>}
        {site && <Tag cls="tag-neutral">{site}</Tag>}
        {vueRh && q.uniteCode && <Tag cls="tag-outline">{q.uniteCode}</Tag>}
        {vueRh && sansEntite && <Tag cls="tag-outline">{t('No entity')}</Tag>}
        <span className="org-effectif">{tn(q.effectif, 'person', 'people')}</span>
      </>, <>
        {q.membres.map(m => personne(m, niveau + 1))}
        {q.equipes.map(f => equipe(f, niveau + 1))}
      </>, () => surEquipe?.(q.nom))
    );
  };

  const entite = (n: NoeudEntite, niveau: number): ReactNode => {
    const cle = cleEntite(n.code);
    return (
      branche(cle, niveau, 'org-entite', <>
        <BuildingsIcon size={15} aria-hidden="true" className="org-icone" />
        <span className="org-nom">{n.nom}</span>
        <Tag cls="tag-neutral">{TYPES_ENTITE[n.type]}</Tag>
        {n.fermee && <Tag cls="tag-outline">{t('Closed#fem')}</Tag>}
        {n.siret && <span className="org-detail">SIRET {formaterSiren(n.siret)}</span>}
        <span className="org-effectif">{tn(n.effectif, 'person', 'people')}</span>
      </>, <>
        {n.equipes.map(q => equipe(q, niveau + 1))}
        {n.etablissements.map(e => entite(e, niveau + 1))}
      </>)
    );
  };

  return (
    <ul role="tree" aria-label={t('Organisation chart')} className="org-arbre" ref={racine} onKeyDown={surTouche}>
      {/* lot 12 — C7 (organigramme) : le service choisi seul, en haut de l'arbre. */}
      {service && equipe(service, 1)}
      {!service && vue.entites.map(n => entite(n, 1))}
      {!service && vue.sansEntite.map(q => equipe(q, 1, true))}
      {!service && vue.aAffecter.length > 0 && branche(CLE_A_AFFECTER, 1, 'org-equipe org-a-affecter', <>
        <UsersThreeIcon size={14} aria-hidden="true" className="org-icone" />
        <span className="org-nom">{t('To assign')}</span>
        <span className="org-detail">{t('no team — approvals by HR')}</span>
        <span className="org-effectif">{tn(vue.aAffecter.length, 'person', 'people')}</span>
      </>, vue.aAffecter.map(m => personne(m, 2)))}
    </ul>
  );
}

// lot 12 — C7 (organigramme)
/**
 * Choix d'un service : champ de saisie avec la liste des services (`datalist`, chemins « Production › Maintenance »).
 * Un libellé de la liste (ou un nom d'équipe exact) choisit le service ; un texte qui ne correspond à rien est refusé
 * et le champ revient au service affiché quand il perd le focus. La croix revient à tous les services.
 */
function ChoixService({ services, service, choisir }: { services: ReturnType<typeof choixServices>; service: string | null; choisir: (nom: string | null) => void }) {
  const liste = useId();
  const libelle = (nom: string | null) => (nom ? services.find(x => x.nom === nom)?.libelle ?? nom : '');
  const [saisie, setSaisie] = useState(() => libelle(service));
  // Service changé ailleurs (fil d'Ariane, « Voir ce service seul », adresse) : le champ le reprend.
  const [suivi, setSuivi] = useState(service);
  if (suivi !== service) { setSuivi(service); setSaisie(libelle(service)); }
  const trouver = (v: string) => { const s = v.trim(); return services.find(x => x.libelle === s || x.nom === s) ?? null; };
  return (
    <span className="org-service">
      <UsersThreeIcon size={14} aria-hidden="true" />
      <input className="input" list={liste} aria-label={t('Department')} placeholder={t('All departments')} value={saisie}
        onChange={e => {
          setSaisie(e.target.value);
          const x = trouver(e.target.value);
          if (x) choisir(x.nom);
          else if (!e.target.value.trim() && service) choisir(null);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const x = trouver(saisie);
          if (x) choisir(x.nom);
        }}
        onBlur={() => { if (!trouver(saisie)) setSaisie(libelle(service)); }} />
      <datalist id={liste}>{services.map(x => <option key={x.nom} value={x.libelle} />)}</datalist>
      {service && (
        <button type="button" className="org-service-effacer" aria-label={t('Clear the department (all departments)')} title={t('All departments')} onClick={() => { setSaisie(''); choisir(null); }}>
          <XIcon size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** Fil d'Ariane du service choisi : son entité (retour à tous les services), ses équipes parentes (remonter d'un niveau). */
function Ariane({ service, etapes, choisir }: { service: string; etapes: ReturnType<typeof filAriane>; choisir: (nom: string | null) => void }) {
  return (
    <nav className="org-ariane no-print" aria-label={t('Department’s attachment')}>
      <ol>
        <li><button type="button" className="org-ariane-lien" onClick={() => choisir(null)}>{t('All departments')}</button></li>
        {etapes.map(x => (
          <li key={`${x.service ?? 'entite'}-${x.libelle}`}>
            {x.service
              ? <button type="button" className="org-ariane-lien" onClick={() => choisir(x.service)}>{x.libelle}</button>
              : <span className="org-ariane-entite">{x.libelle}</span>}
          </li>
        ))}
        <li aria-current="page"><span className="org-ariane-courant">{service}</span></li>
      </ol>
    </nav>
  );
}
