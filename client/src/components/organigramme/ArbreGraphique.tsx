// lot 12 — C7 (organigramme) : vue graphique de l'organigramme, arbre vertical (pages/Organigramme.tsx, choix « Graphique »).
// - Boîte de l'entité (ou du service choisi) en haut, ses équipes dessous, reliées par des traits verticaux et horizontaux
//   (pseudo-éléments ::before / ::after de `.orgg-*`, styles/app.css) : ni bibliothèque, ni SVG, ni style en ligne autre
//   que les props `style` de React (échelle du zoom), permises par la CSP.
// - Chaque boîte : nom, manager (suppléant selon les délégations déjà visibles, comme la liste), présents ; dépliée, les
//   membres en liste compacte dans la boîte, repliés derrière « N personnes » au-delà de `SEUIL_MEMBRES`.
// - Même sémantique et même clavier que la liste (role tree / treeitem / group, aria-level, aria-expanded, focus itinérant :
//   components/organigramme/clavier.ts) ; mêmes données (l'arbre filtré de organigramme-vue.ts), rien de plus.
// - Défilement dans son cadre (la page ne déborde pas) ; zoom borné (50 à 150 %) par `transform: scale`, la taille du
//   cadre intérieur suivant l'échelle pour que le défilement couvre tout l'arbre.
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BuildingsIcon, CaretDownIcon, CaretRightIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { plural } from '../../../../shared/format.ts';
import { TYPES_ENTITE } from '../../../../shared/rules/entites.ts';
import type { MembreArbre, NoeudEntite, NoeudEquipe } from '../../../../shared/rules/organigramme.ts';
import type { Site } from '../../../../shared/types.ts';
import { cleEntite, cleEquipe, cleMembres, clePersonne, libelleSite, SEUIL_MEMBRES, type ArbreFiltre } from '../../organigramme-vue.ts';
import { Avatar, Btn, Tag } from '../ui.tsx';
import { idNoeud, toucheArbre } from './clavier.ts';

/** Bornes et pas du zoom, en pour cent. */
export const ZOOM_MIN = 50, ZOOM_MAX = 150, ZOOM_PAS = 10;

export interface PropsArbreGraphique {
  vue: ArbreFiltre;
  /** Service choisi : seule racine dessinée (son entité et ses équipes parentes sont dans le fil d'Ariane de l'écran). */
  service: NoeudEquipe | null;
  ouverts: Set<string>; basculer: (cle: string, ouvrir?: boolean) => void; vueRh: boolean;
  sites: readonly Site[]; ficheOuvrable: (id: number) => boolean; ouvrirFiche: (id: number) => void;
  /** Clé du nœud « À affecter » (service RH). */
  cleAAffecter: string;
  /** Équipe touchée (clic ou focus) : l'écran propose « Voir ce service seul ». */
  surEquipe?: (nom: string) => void;
}

/** Clés des nœuds affichés, dans l'ordre du document (focus itinérant : le premier à défaut du nœud actif). */
function clesAffichees(p: Pick<PropsArbreGraphique, 'vue' | 'service' | 'ouverts' | 'cleAAffecter'>): string[] {
  const out: string[] = [];
  const membres = (q: NoeudEquipe) => {
    if (q.membres.length > SEUIL_MEMBRES) {
      out.push(cleMembres(q.nom));
      if (!p.ouverts.has(cleMembres(q.nom))) return;
    }
    for (const m of q.membres) out.push(clePersonne(m.id));
  };
  const equipe = (q: NoeudEquipe) => {
    out.push(cleEquipe(q.nom));
    if (!p.ouverts.has(cleEquipe(q.nom))) return;
    membres(q);
    q.equipes.forEach(equipe);
  };
  const entite = (n: NoeudEntite) => {
    out.push(cleEntite(n.code));
    if (!p.ouverts.has(cleEntite(n.code))) return;
    n.equipes.forEach(equipe);
    n.etablissements.forEach(entite);
  };
  if (p.service) equipe(p.service);
  else {
    p.vue.entites.forEach(entite);
    p.vue.sansEntite.forEach(equipe);
    if (p.vue.aAffecter.length) {
      out.push(p.cleAAffecter);
      if (p.ouverts.has(p.cleAAffecter)) for (const m of p.vue.aAffecter) out.push(clePersonne(m.id));
    }
  }
  return out;
}

export function ArbreGraphique(p: PropsArbreGraphique) {
  const { vue, service, ouverts, basculer, vueRh, sites, ficheOuvrable, ouvrirFiche, cleAAffecter, surEquipe } = p;
  const base = useId();
  const racine = useRef<HTMLUListElement>(null);
  const plan = useRef<HTMLDivElement>(null);
  const [actif, setActif] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  // Taille naturelle de l'arbre (sans l'échelle) : le cadre intérieur prend la taille mise à l'échelle.
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null);
  // Mesurée au montage, puis à chaque changement de taille (dépliage, filtre) : `transform` ne change pas la mise en page.
  useLayoutEffect(() => {
    const el = plan.current;
    if (!el) return;
    const mesurer = () => {
      const l = el.offsetWidth, h = el.offsetHeight;
      setTaille(t => (t && t.l === l && t.h === h ? t : { l, h }));
    };
    mesurer();
    if (typeof ResizeObserver !== 'function') return;
    const suivi = new ResizeObserver(mesurer);
    suivi.observe(el);
    return () => suivi.disconnect();
  }, []);

  const visibles = clesAffichees(p);
  const tabulable = actif && visibles.includes(actif) ? actif : visibles[0];
  const id = (cle: string) => idNoeud(base, cle);
  const focus = (cle: string) => (ev: { target: unknown; currentTarget: unknown }) => { if (ev.target === ev.currentTarget) setActif(cle); };

  const personne = (m: MembreArbre, niveau: number) => {
    const cle = clePersonne(m.id);
    const ouvrable = ficheOuvrable(m.id);
    return (
      <li key={cle} role="treeitem" aria-level={niveau} aria-labelledby={id(cle)} data-cle={cle} tabIndex={cle === tabulable ? 0 : -1}
        className={`orgg-personne${vue.trouves.has(m.id) ? ' trouve' : ''}${ouvrable ? ' ouvrable' : ''}`} onFocus={focus(cle)}>
        <div className="orgg-personne-ligne" id={id(cle)} onClick={() => { setActif(cle); ouvrirFiche(m.id); }} title={ouvrable ? 'Ouvrir la fiche' : undefined}>
          <Avatar nom={m.nom} size={20} />
          <span className="orgg-personne-texte">
            <span className="orgg-personne-nom">{m.nom}</span>
            <span className="orgg-detail">{[m.poste, m.manager ? 'manager' : ''].filter(Boolean).join(' · ')}</span>
          </span>
          {m.etiquette && <Tag cls="tag-outline">{m.etiquette}</Tag>}
          {ouvrable && <span className="sr-only">, Entrée : ouvrir la fiche</span>}
        </div>
      </li>
    );
  };

  /** Membres d'une équipe dépliée : en liste dans la boîte, ou derrière « N personnes » (nœud dépliable) au-delà du seuil. */
  const membres = (q: NoeudEquipe, niveau: number): ReactNode => {
    if (!q.membres.length) return null;
    if (q.membres.length <= SEUIL_MEMBRES) return <ul role="group" className="orgg-membres">{q.membres.map(m => personne(m, niveau))}</ul>;
    const cle = cleMembres(q.nom), ouvert = ouverts.has(cle);
    return (
      <ul role="group" className="orgg-membres">
        <li role="treeitem" aria-level={niveau} aria-expanded={ouvert} aria-labelledby={id(cle)} data-cle={cle} tabIndex={cle === tabulable ? 0 : -1}
          className="orgg-replie" onFocus={focus(cle)}>
          <div className="orgg-replie-ligne" id={id(cle)} onClick={ev => { ev.stopPropagation(); setActif(cle); basculer(cle); }}>
            <span className="org-caret" aria-hidden="true">{ouvert ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}</span>
            {plural(q.membres.length, 'personne', 'personnes')}
          </div>
          {ouvert && <ul role="group" className="orgg-membres orgg-membres-replies">{q.membres.map(m => personne(m, niveau + 1))}</ul>}
        </li>
      </ul>
    );
  };

  /**
   * Boîte d'un nœud dépliable : en-tête cliquable (déplier, replier), contenu de la boîte, puis nœuds rattachés dessous.
   * `trouve` marque aussi le treeitem (comme `org-item trouve` de la liste) : Entrée dans la recherche y place le focus.
   */
  const boite = (cle: string, niveau: number, classe: string, tete: ReactNode, dedans: ReactNode, dessous: ReactNode, surClic?: () => void, trouve = false) => {
    const ouvert = ouverts.has(cle);
    return (
      <li key={cle} role="treeitem" aria-level={niveau} aria-expanded={ouvert} aria-labelledby={id(cle)} data-cle={cle} tabIndex={cle === tabulable ? 0 : -1}
        className={`orgg-noeud${trouve ? ' trouve' : ''}`} onFocus={ev => { if (ev.target === ev.currentTarget) { setActif(cle); surClic?.(); } }}>
        <div className={`orgg-boite ${classe}`}>
          <div className="orgg-tete" id={id(cle)} onClick={() => { setActif(cle); basculer(cle); surClic?.(); }}>{tete}</div>
          {ouvert && dedans}
        </div>
        {ouvert && dessous}
      </li>
    );
  };
  const enfants = (liste: ReactNode[]) => (liste.length ? <ul role="group" className="orgg-enfants">{liste}</ul> : null);
  const caret = (cle: string) => <span className="org-caret" aria-hidden="true">{ouverts.has(cle) ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}</span>;

  const equipe = (q: NoeudEquipe, niveau: number, sansEntite = false): ReactNode => {
    const cle = cleEquipe(q.nom);
    const site = libelleSite(sites, q.siteCode);
    return boite(cle, niveau, `orgg-equipe${vue.equipesTrouvees.has(q.nom) ? ' trouve' : ''}`, <>
      <span className="orgg-titre">{caret(cle)}<UsersThreeIcon size={14} aria-hidden="true" className="org-icone" /><span className="orgg-nom">{q.nom}</span></span>
      <span className="orgg-detail">{q.manager ? `manager : ${q.manager}` : 'sans manager — validations par le service RH'}</span>
      {(q.suppleant || site || (vueRh && (q.uniteCode || sansEntite))) && (
        <span className="orgg-tags">
          {q.suppleant && <Tag cls="tag-accent">{`Suppléant : ${q.suppleant.nom}`}</Tag>}
          {site && <Tag cls="tag-neutral">{site}</Tag>}
          {vueRh && q.uniteCode && <Tag cls="tag-outline">{q.uniteCode}</Tag>}
          {vueRh && sansEntite && <Tag cls="tag-outline">Sans entité</Tag>}
        </span>
      )}
      <span className="orgg-effectif">{plural(q.effectif, 'présent', 'présents')}</span>
    </>, membres(q, niveau + 1), enfants(q.equipes.map(f => equipe(f, niveau + 1))), () => surEquipe?.(q.nom),
      vue.equipesTrouvees.has(q.nom));
  };

  const entite = (n: NoeudEntite, niveau: number): ReactNode => {
    const cle = cleEntite(n.code);
    return boite(cle, niveau, 'orgg-entite', <>
      <span className="orgg-titre">{caret(cle)}<BuildingsIcon size={15} aria-hidden="true" className="org-icone" /><span className="orgg-nom">{n.nom}</span></span>
      <span className="orgg-tags">
        <Tag cls="tag-neutral">{TYPES_ENTITE[n.type]}</Tag>
        {n.fermee && <Tag cls="tag-outline">Fermée</Tag>}
      </span>
      <span className="orgg-effectif">{plural(n.effectif, 'présent', 'présents')}</span>
    </>, null, enfants([...n.equipes.map(q => equipe(q, niveau + 1)), ...n.etablissements.map(e => entite(e, niveau + 1))]));
  };

  const racines: ReactNode[] = service ? [equipe(service, 1)] : [
    ...vue.entites.map(n => entite(n, 1)),
    ...vue.sansEntite.map(q => equipe(q, 1, true)),
    ...(vue.aAffecter.length ? [boite(cleAAffecter, 1, 'orgg-equipe orgg-a-affecter', <>
      <span className="orgg-titre">{caret(cleAAffecter)}<UsersThreeIcon size={14} aria-hidden="true" className="org-icone" /><span className="orgg-nom">À affecter</span></span>
      <span className="orgg-detail">sans équipe — validations par le service RH</span>
      <span className="orgg-effectif">{plural(vue.aAffecter.length, 'personne', 'personnes')}</span>
    </>, <ul role="group" className="orgg-membres">{vue.aAffecter.map(m => personne(m, 2))}</ul>, null)] : []),
  ];

  const changerZoom = (pas: number) => setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + pas)));
  const echelle = zoom / 100;
  return (
    <div className="orgg">
      <div className="orgg-zoom no-print" role="group" aria-label="Taille de l’arbre">
        <Btn small icon={<MagnifyingGlassMinusIcon size={14} />} onClick={() => changerZoom(-ZOOM_PAS)} disabled={zoom <= ZOOM_MIN}>Réduire</Btn>
        <span className="orgg-zoom-valeur" aria-live="polite">{`${zoom} %`}</span>
        <Btn small icon={<MagnifyingGlassPlusIcon size={14} />} onClick={() => changerZoom(ZOOM_PAS)} disabled={zoom >= ZOOM_MAX}>Agrandir</Btn>
      </div>
      <div className="orgg-cadre">
        <div className="orgg-echelle" style={taille ? { width: Math.ceil(taille.l * echelle), height: Math.ceil(taille.h * echelle) } : undefined}>
          <div className="orgg-plan" ref={plan} style={echelle === 1 ? undefined : { transform: `scale(${echelle})` }}>
            <ul role="tree" aria-label="Organigramme" className="orgg-arbre" ref={racine}
              onKeyDown={ev => toucheArbre(ev, racine.current, { basculer, ouvrirFiche, activer: setActif })}>
              {racines}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
