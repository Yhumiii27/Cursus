// Organigramme à l'écran (lot 11, chantier C1, étape 2 ; pages/Organigramme.tsx) : filtres, recherche, dépliage, lignes
// du CSV et document imprimé, tirés de l'arbre de shared/rules/organigramme.ts. Module sans React, testé sous Node
// (tests/organigramme-ecran.test.ts).
// - Filtres : entité (une société avec ses établissements, ou un établissement seul) et site de rattachement (celui de
//   l'équipe ou d'une équipe au-dessus, à défaut celui de l'entité : `rattachementSalarie`). Une équipe d'un autre site
//   reste affichée, sans ses membres, si une équipe rattachée en est. Avec un filtre, les équipes sans entité et les
//   salariés à affecter ne sont plus montrés.
// - Recherche : nom et poste de la personne (accents et casse ignorés, comme l'annuaire : `norm`), ou nom de l'équipe
//   (une équipe trouvée garde tous ses membres) ; les personnes trouvées sont surlignées et les nœuds qui y mènent dépliés.
// - CSV et impression : les seules colonnes de l'annuaire (nom, poste, équipe) et la structure (entité, site, chemin des
//   équipes, manager, valideur) ; ni contrat, ni étiquette, ni sortie, ni santé, même pour le service RH.
import { norm } from '../../shared/format.ts';
import { entiteDe, rattachementSalarie, societeDe } from '../../shared/rules/entites.ts';
import { ancetres } from '../../shared/rules/hierarchie.ts';
import { cheminEquipe, sousArbre, type Arbre, type MembreArbre, type NoeudEntite, type NoeudEquipe } from '../../shared/rules/organigramme.ts';
import type { Entite, Equipe, ISODate, Site } from '../../shared/types.ts';
import type { PrintArbre } from './print.ts';

/** Clés des nœuds de l'arbre (dépliage, focus) : entité, équipe, personne. */
export const cleEntite = (code: string) => `e:${code}`;
export const cleEquipe = (nom: string) => `q:${nom}`;
export const clePersonne = (id: number) => `p:${id}`;

export interface FiltreOrganigramme {
  entite: string | null; site: string | null; recherche: string;
  // lot 12 — C7 (organigramme) : service choisi (nom d'équipe) ; la recherche ne porte alors que sur lui.
  service?: string | null;
}

/** Arbre filtré, avec les nœuds à déplier pour montrer les résultats de la recherche et les personnes trouvées. */
export interface ArbreFiltre extends Arbre {
  /** Clés des nœuds qui mènent à un résultat (recherche) : dépliés d'office. */
  chemins: Set<string>;
  /** Personnes qui correspondent à la recherche (surlignées) ; vide sans recherche. */
  trouves: Set<number>;
  /** Équipes dont le nom correspond à la recherche. */
  equipesTrouvees: Set<string>;
}

/** Site de rattachement effectif d'une équipe : le sien, celui d'une équipe au-dessus, sinon celui de son entité. */
export const siteEffectif = (equipes: readonly Equipe[], entites: readonly Entite[], nom: string) => rattachementSalarie(equipes, entites, nom).siteCode;

const effectifDe = (q: NoeudEquipe): number => q.membres.length + q.equipes.reduce((n, f) => n + f.effectif, 0);

/**
 * Filtre l'arbre (entité, site, recherche). Les effectifs sont recomptés sur ce qui reste affiché. Sans filtre ni
 * recherche, l'arbre est rendu tel quel (chemins et résultats vides).
 */
export function filtrerArbre(brut: Arbre, equipes: readonly Equipe[], entites: readonly Entite[], f: FiltreOrganigramme): ArbreFiltre {
  const q = norm(f.recherche.trim());
  const chemins = new Set<string>(), trouves = new Set<number>(), equipesTrouvees = new Set<string>();
  // lot 12 — C7 (organigramme) : le service choisi d'abord, les autres filtres ensuite, sur ce qui en reste.
  const a = restreindreAuService(brut, equipes, f.service ?? null);
  if (!f.entite && !f.site && !q) return { ...a, chemins, trouves, equipesTrouvees };
  const personne = (m: Pick<MembreArbre, 'nom' | 'poste'>) => norm(`${m.nom} ${m.poste}`).includes(q);

  /** Nœud d'équipe filtré, ou null s'il ne mène à rien. `parents` : clés des nœuds au-dessus (à déplier sur un résultat). */
  const equipe = (n: NoeudEquipe, parents: string[]): NoeudEquipe | null => {
    const cle = cleEquipe(n.nom);
    const filles = n.equipes.map(x => equipe(x, [...parents, cle])).filter((x): x is NoeudEquipe => !!x);
    const dansSite = !f.site || siteEffectif(equipes, entites, n.nom) === f.site;
    const nomTrouve = !!q && norm(n.nom).includes(q);
    let membres = dansSite ? n.membres : [];
    if (q && !nomTrouve) membres = membres.filter(personne);
    if (q) {
      for (const m of membres) if (personne(m)) trouves.add(m.id);
      if (nomTrouve && dansSite) equipesTrouvees.add(n.nom);
    }
    const garde = filles.length > 0 || (q ? membres.length > 0 || (nomTrouve && dansSite) : dansSite);
    if (!garde) return null;
    if (q && (membres.length > 0 || filles.length > 0 || nomTrouve)) for (const c of parents) chemins.add(c);
    if (q && (membres.length > 0 || filles.length > 0)) chemins.add(cle);
    const r = { ...n, membres, equipes: filles };
    return { ...r, effectif: effectifDe(r) };
  };
  const entite = (n: NoeudEntite, parents: string[]): NoeudEntite | null => {
    const cle = cleEntite(n.code);
    const etablissements = n.etablissements.map(x => entite(x, [...parents, cle])).filter((x): x is NoeudEntite => !!x);
    const eq = n.equipes.map(x => equipe(x, [...parents, cle])).filter((x): x is NoeudEquipe => !!x);
    if (!etablissements.length && !eq.length) return null;
    if (q) chemins.add(cle);
    return { ...n, etablissements, equipes: eq, effectif: eq.reduce((s, x) => s + x.effectif, 0) + etablissements.reduce((s, x) => s + x.effectif, 0) };
  };
  // Entité choisie : la société avec ses établissements, ou l'établissement seul.
  const tous = a.entites.flatMap(n => [n, ...n.etablissements]);
  const hauts = f.entite ? tous.filter(n => n.code === f.entite) : a.entites;
  const entitesF = hauts.map(n => entite(n, [])).filter((x): x is NoeudEntite => !!x);
  const sansEntite = f.entite ? [] : a.sansEntite.map(x => equipe(x, [])).filter((x): x is NoeudEquipe => !!x);
  const aAffecter = f.entite || f.site ? [] : a.aAffecter.filter(m => !q || personne(m));
  if (q) for (const m of aAffecter) trouves.add(m.id);
  const effectif = entitesF.reduce((s, x) => s + x.effectif, 0) + sansEntite.reduce((s, x) => s + x.effectif, 0) + aAffecter.length;
  return { entites: entitesF, sansEntite, aAffecter, anomalies: a.anomalies, effectif, chemins, trouves, equipesTrouvees };
}

/** Clés de tous les nœuds dépliables de l'arbre (« Tout déplier »). */
export function clesDepliables(a: Pick<Arbre, 'entites' | 'sansEntite'>): string[] {
  const out: string[] = [];
  const equipe = (n: NoeudEquipe) => { out.push(cleEquipe(n.nom)); n.equipes.forEach(equipe); };
  const entite = (n: NoeudEntite) => { out.push(cleEntite(n.code)); n.equipes.forEach(equipe); n.etablissements.forEach(entite); };
  a.entites.forEach(entite);
  a.sansEntite.forEach(equipe);
  return out;
}

/** Dépliage de départ : les entités et leurs équipes racines (membres des équipes racines visibles, sous-équipes repliées). */
export function depliageInitial(a: Pick<Arbre, 'entites' | 'sansEntite'>): string[] {
  const out: string[] = [];
  const entite = (n: NoeudEntite) => { out.push(cleEntite(n.code)); for (const q of n.equipes) out.push(cleEquipe(q.nom)); n.etablissements.forEach(entite); };
  a.entites.forEach(entite);
  for (const q of a.sansEntite) out.push(cleEquipe(q.nom));
  return out;
}

/** « 552 100 554 » et « 552 100 554 00013 » : SIREN et SIRET lisibles (chiffres groupés par trois, puis le NIC). */
export const formaterSiren = (v: string | null | undefined) => (v ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d*)$/, (_, a: string, b: string, c: string, d: string) => [a, b, c, d].filter(Boolean).join(' ')) : '');

/** Libellé d'un site d'après le cache `sites` (son code s'il n'y figure pas). */
export const libelleSite = (sites: readonly Site[], code: string | null | undefined) => (code ? sites.find(s => s.code === code)?.libelle ?? code : '');

interface Contexte {
  equipes: readonly Equipe[]; entites: readonly Entite[]; sites: readonly Site[];
  /** Nom d'une personne de l'annuaire (valideur) ; « Service RH » pour 0. */
  nom: (id: number) => string;
}

/**
 * Société d'un nœud placé en haut de l'arbre : son propre nom pour une société ; pour un établissement (filtre sur un
 * établissement seul), le nom de sa société parente lu dans les entités, pour que l'export et l'impression gardent l'employeur.
 */
const societeHaut = (c: Contexte, n: NoeudEntite) => (n.type === 'societe' ? n.nom : societeDe(c.entites, entiteDe(c.entites, n.code))?.nom ?? '');

/** Ligne du CSV de l'organigramme : une par personne affichée. */
export interface LigneOrganigramme {
  societe: string; etablissement: string; site: string; chemin: string; equipe: string; nom: string; poste: string; manager: string; valideur: string;
}

/** Lignes de l'arbre filtré, une par personne affichée, dans l'ordre de l'écran (salariés à affecter à la fin). */
export function lignesOrganigramme(a: Pick<Arbre, 'entites' | 'sansEntite' | 'aAffecter'>, c: Contexte): LigneOrganigramme[] {
  const out: LigneOrganigramme[] = [];
  const valideur = (id: number) => (id ? c.nom(id) : 'Service RH');
  const equipe = (n: NoeudEquipe, societe: string, etablissement: string, chemin: string[]) => {
    const ch = [...chemin, n.nom];
    const site = libelleSite(c.sites, siteEffectif(c.equipes, c.entites, n.nom));
    for (const m of n.membres) {
      out.push({ societe, etablissement, site, chemin: ch.join(' › '), equipe: n.nom, nom: m.nom, poste: m.poste, manager: n.manager ?? '', valideur: valideur(m.valideur) });
    }
    for (const f of n.equipes) equipe(f, societe, etablissement, ch);
  };
  const entite = (n: NoeudEntite, societe: string | null) => {
    const soc = societe ?? societeHaut(c, n);
    const etab = n.type === 'etablissement' ? n.nom : '';
    for (const q of n.equipes) equipe(q, soc, etab, []);
    for (const e of n.etablissements) entite(e, soc);
  };
  for (const n of a.entites) entite(n, null);
  for (const q of a.sansEntite) equipe(q, '', '', []);
  for (const m of a.aAffecter) out.push({ societe: '', etablissement: '', site: '', chemin: '', equipe: 'À affecter', nom: m.nom, poste: m.poste, manager: '', valideur: 'Service RH' });
  return out;
}

/** Fichier CSV de l'organigramme (client/src/listes-csv.ts le met en forme) : en-tête et lignes. */
export const ENTETE_CSV_ORGANIGRAMME = ['Société', 'Établissement', 'Site', 'Chemin des équipes', 'Équipe', 'Collaborateur', 'Poste', 'Manager de l’équipe', 'Validé par'];

/** Document imprimé : une section par entité (société, puis chacun de ses établissements ; saut de page entre elles), arbre en listes imbriquées. */
export interface SectionOrganigramme { titre: string; sousTitre: string; arbre: PrintArbre[] }

export function sectionsImpression(a: Pick<Arbre, 'entites' | 'sansEntite' | 'aAffecter'>, c: Contexte): SectionOrganigramme[] {
  const membre = (m: MembreArbre): PrintArbre => ({ libelle: m.nom, detail: [m.poste, m.manager ? 'manager' : ''].filter(Boolean).join(' · ') });
  const equipe = (n: NoeudEquipe): PrintArbre => ({
    libelle: n.nom,
    detail: [n.manager ? `manager : ${n.manager}` : 'sans manager (validations par le service RH)', n.suppleant ? `suppléant : ${n.suppleant.nom}` : '',
      libelleSite(c.sites, siteEffectif(c.equipes, c.entites, n.nom)), `${n.effectif} pers.`].filter(Boolean).join(' · '),
    enfants: [...n.membres.map(membre), ...n.equipes.map(equipe)],
    groupe: true,
  });
  const entite = (n: NoeudEntite): PrintArbre => ({
    libelle: n.nom, detail: [n.type === 'societe' ? 'Société' : 'Établissement', n.siret ? `SIRET ${formaterSiren(n.siret)}` : '', `${n.effectif} pers.`].filter(Boolean).join(' · '),
    enfants: [...n.equipes.map(equipe), ...n.etablissements.map(entite)], groupe: true,
  });
  // Une section (une page) par entité : la société avec ses équipes racines, puis chacun de ses établissements.
  const sections: SectionOrganigramme[] = [];
  // Une entité sans équipe (société ouverte encore vide, ou dont seuls les établissements portent des équipes) n'a pas de
  // page : ses établissements gardent la leur.
  const section = (n: NoeudEntite, societe: string) => {
    const e = entite({ ...n, etablissements: [] });
    if (n.equipes.length) {
      sections.push({ titre: n.type === 'etablissement' && societe ? `${n.nom} (${societe})` : n.nom, sousTitre: entite(n).detail ?? '', arbre: e.enfants ?? [] });
    }
    for (const x of n.etablissements) section(x, n.nom);
  };
  for (const n of a.entites) section(n, societeHaut(c, n));
  if (a.sansEntite.length) sections.push({ titre: 'Équipes sans entité', sousTitre: '', arbre: a.sansEntite.map(equipe) });
  if (a.aAffecter.length) sections.push({ titre: 'À affecter', sousTitre: 'Salariés sans équipe : validations par le service RH', arbre: a.aAffecter.map(membre) });
  return sections;
}

/** Mention des documents de l'organigramme : document interne, état du jour (JJ/MM/AAAA). */
export const mentionEtat = (today: ISODate) => `Document interne — état au ${today.split('-').reverse().join('/')}`;

// lot 12 — C7 (organigramme) : choix d'un service (une équipe et ses sous-équipes), vue graphique en arbre vertical et
// son impression (pages/Organigramme.tsx, components/organigramme/ArbreGraphique.tsx). Rien de neuf n'est lu : l'arbre
// de shared/rules/organigramme.ts, réduit ou dessiné autrement.

/** Clé du nœud « N personnes » d'une équipe de plus de `SEUIL_MEMBRES` membres (vue graphique : replié par défaut). */
export const cleMembres = (nom: string) => `m:${nom}`;
/** Au-delà de ce nombre de membres, la vue graphique les replie derrière « N personnes ». */
export const SEUIL_MEMBRES = 8;

/** Service proposé au choix : nom de l'équipe, chemin depuis son équipe racine et libellé (« Production › Maintenance »). */
export interface ChoixService { nom: string; chemin: string[]; libelle: string }

/** Équipe nommée dans l'arbre (entités, établissements, équipes sans entité), ou null. */
export function noeudService(a: Pick<Arbre, 'entites' | 'sansEntite'>, nom: string | null | undefined): NoeudEquipe | null {
  if (!nom) return null;
  const equipe = (n: NoeudEquipe): NoeudEquipe | null => (n.nom === nom ? n : n.equipes.reduce<NoeudEquipe | null>((r, f) => r ?? equipe(f), null));
  const entite = (n: NoeudEntite): NoeudEquipe | null => n.equipes.reduce<NoeudEquipe | null>((r, q) => r ?? equipe(q), null) ?? n.etablissements.reduce<NoeudEquipe | null>((r, e) => r ?? entite(e), null);
  return a.entites.reduce<NoeudEquipe | null>((r, n) => r ?? entite(n), null) ?? a.sansEntite.reduce<NoeudEquipe | null>((r, q) => r ?? equipe(q), null);
}

/**
 * Arbre réduit au service `service` et à ses sous-équipes (`sousArbre` : equipesDescendantes) : ses équipes parentes et
 * son entité restent, vides de membres, pour garder le chemin (CSV, impression) ; ni autre équipe, ni salarié à affecter.
 * Service absent, inconnu ou hors de l'arbre : l'arbre tel quel (comme l'adresse, qui ramène la valeur par défaut).
 */
export function restreindreAuService(a: Arbre, equipes: readonly Equipe[], service: string | null): Arbre {
  if (!service || !noeudService(a, service)) return a;
  const dessous = new Set(sousArbre(equipes, [service]));
  const dessus = new Set(ancetres(equipes, service).map(q => q.nom));
  const equipe = (n: NoeudEquipe): NoeudEquipe | null => {
    if (n.nom === service || dessous.has(n.nom)) return n;
    if (!dessus.has(n.nom)) return null;
    const filles = n.equipes.map(equipe).filter((x): x is NoeudEquipe => !!x);
    return filles.length ? { ...n, membres: [], equipes: filles, effectif: filles.reduce((s, x) => s + x.effectif, 0) } : null;
  };
  const entite = (n: NoeudEntite): NoeudEntite | null => {
    const eq = n.equipes.map(equipe).filter((x): x is NoeudEquipe => !!x);
    const etablissements = n.etablissements.map(entite).filter((x): x is NoeudEntite => !!x);
    if (!eq.length && !etablissements.length) return null;
    return { ...n, equipes: eq, etablissements, effectif: eq.reduce((s, x) => s + x.effectif, 0) + etablissements.reduce((s, x) => s + x.effectif, 0) };
  };
  const entites = a.entites.map(entite).filter((x): x is NoeudEntite => !!x);
  const sansEntite = a.sansEntite.map(equipe).filter((x): x is NoeudEquipe => !!x);
  const effectif = entites.reduce((s, x) => s + x.effectif, 0) + sansEntite.reduce((s, x) => s + x.effectif, 0);
  return { entites, sansEntite, aAffecter: [], anomalies: a.anomalies, effectif };
}

/** Comparaison de deux chemins d'équipes, niveau par niveau (« Production » avant « Production › Maintenance »). */
const parChemin = (x: string[], y: string[]): number => {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i].localeCompare(y[i], 'fr');
    if (c) return c;
  }
  return x.length - y.length;
};

/**
 * Services proposés : les équipes présentes dans l'arbre `a` (déjà réduit par l'entité et le site : aucune équipe de plus
 * que celles que la personne voit), avec leur chemin, triées par chemin.
 */
export function choixServices(a: Pick<Arbre, 'entites' | 'sansEntite'>, equipes: readonly Equipe[]): ChoixService[] {
  const noms: string[] = [];
  const equipe = (n: NoeudEquipe) => { noms.push(n.nom); n.equipes.forEach(equipe); };
  const entite = (n: NoeudEntite) => { n.equipes.forEach(equipe); n.etablissements.forEach(entite); };
  a.entites.forEach(entite);
  a.sansEntite.forEach(equipe);
  return [...new Set(noms)].map(nom => { const chemin = cheminEquipe(equipes, nom).chemin; return { nom, chemin, libelle: chemin.join(' › ') }; })
    .sort((x, y) => parChemin(x.chemin, y.chemin));
}

/** Élément du fil d'Ariane d'un service : son entité (`service: null` : revenir à tous les services), puis ses équipes parentes. */
export interface EtapeAriane { libelle: string; service: string | null }

/** Fil d'Ariane du service choisi : entité (si l'équipe racine en a une), puis équipes au-dessus, de la plus haute à la plus proche. */
export function filAriane(equipes: readonly Equipe[], entites: readonly Entite[], service: string): EtapeAriane[] {
  const { chemin, entite } = cheminEquipe(equipes, service);
  const nomEntite = entite ? entiteDe(entites, entite)?.nom ?? null : null;
  return [...(nomEntite ? [{ libelle: nomEntite, service: null }] : []), ...chemin.slice(0, -1).map(nom => ({ libelle: nom, service: nom }))];
}

/** Clés dépliables de la vue graphique : celles de la liste, plus les « N personnes » des équipes nombreuses. */
export function clesDepliablesGraphique(a: Pick<Arbre, 'entites' | 'sansEntite'>): string[] {
  const out = clesDepliables(a);
  const equipe = (n: NoeudEquipe) => { if (n.membres.length > SEUIL_MEMBRES) out.push(cleMembres(n.nom)); n.equipes.forEach(equipe); };
  const entite = (n: NoeudEntite) => { n.equipes.forEach(equipe); n.etablissements.forEach(entite); };
  a.entites.forEach(entite);
  a.sansEntite.forEach(equipe);
  return out;
}

/** Largeur utile d'une page A4 en paysage (marges de 12 mm) et largeur d'une boîte de l'arbre imprimé, écart compris (mm). */
const LARGEUR_PAGE_MM = 273, LARGEUR_BOITE_MM = 48;
/** Échelle minimale de l'arbre imprimé (en dessous, illisible) : au-delà, des boîtes débordent, l'avertissement le dit. */
export const ECHELLE_MIN = 30;

/** Nombre de boîtes côte à côte au niveau le plus large de l'arbre imprimé (une boîte par nœud `groupe`). */
export function boitesEnLargeur(noeuds: readonly PrintArbre[]): number {
  const largeur = (n: PrintArbre): number => Math.max(1, (n.enfants ?? []).filter(x => x.groupe).reduce((s, x) => s + largeur(x), 0));
  return Math.max(1, noeuds.reduce((s, n) => s + largeur(n), 0));
}

/**
 * Échelle de l'arbre vertical imprimé, en pour cent (de 100 à `ECHELLE_MIN`, par dizaines) : l'arbre tient dans la
 * largeur d'une page en paysage. Une classe `echelle-NN` de styles/print.css l'applique (ni style ni script en ligne).
 */
export function echelleImpression(noeuds: readonly PrintArbre[]): number {
  const besoin = boitesEnLargeur(noeuds) * LARGEUR_BOITE_MM;
  if (besoin <= LARGEUR_PAGE_MM) return 100;
  return Math.max(ECHELLE_MIN, Math.floor((LARGEUR_PAGE_MM / besoin) * 10) * 10);
}

/**
 * Sections de l'arbre vertical imprimé : le service choisi seul (une page : sa boîte en haut, sous-titre de son chemin),
 * sinon une page par entité (sa boîte en haut, ses équipes racines dessous ; établissements sur leur propre page), puis
 * les équipes sans entité et les salariés à affecter. Chaque section porte son échelle (`echelleImpression`).
 */
export function sectionsImpressionGraphique(a: Pick<Arbre, 'entites' | 'sansEntite' | 'aAffecter'>, c: Contexte, service?: string | null): (SectionOrganigramme & { echelle: number })[] {
  const membre = (m: MembreArbre): PrintArbre => ({ libelle: m.nom, detail: [m.poste, m.manager ? 'manager' : ''].filter(Boolean).join(' · ') });
  const equipe = (n: NoeudEquipe): PrintArbre => ({
    libelle: n.nom,
    detail: [n.manager ? `manager : ${n.manager}` : 'sans manager', n.suppleant ? `suppléant : ${n.suppleant.nom}` : '', `${n.effectif} pers.`].filter(Boolean).join(' · '),
    enfants: [...n.membres.map(membre), ...n.equipes.map(equipe)], groupe: true,
  });
  const avecEchelle = (s: SectionOrganigramme) => ({ ...s, echelle: echelleImpression(s.arbre) });
  const choisi = noeudService(a, service);
  if (choisi) {
    const { chemin } = cheminEquipe(c.equipes, choisi.nom);
    const ariane = filAriane(c.equipes, c.entites, choisi.nom).map(x => x.libelle);
    return [avecEchelle({ titre: `Service ${chemin.join(' › ')}`, sousTitre: ariane.length ? `Rattachement : ${ariane.join(' › ')}` : 'Équipe racine', arbre: [equipe(choisi)] })];
  }
  const sections: SectionOrganigramme[] = [];
  const section = (n: NoeudEntite, societe: string) => {
    if (n.equipes.length) {
      const detail = [n.type === 'societe' ? 'Société' : 'Établissement', n.siret ? `SIRET ${formaterSiren(n.siret)}` : '', `${n.effectif} pers.`].filter(Boolean).join(' · ');
      sections.push({
        titre: n.type === 'etablissement' && societe ? `${n.nom} (${societe})` : n.nom, sousTitre: detail,
        arbre: [{ libelle: n.nom, detail, enfants: n.equipes.map(equipe), groupe: true }],
      });
    }
    for (const x of n.etablissements) section(x, n.nom);
  };
  for (const n of a.entites) section(n, societeHaut(c, n));
  if (a.sansEntite.length) sections.push({ titre: 'Équipes sans entité', sousTitre: '', arbre: a.sansEntite.map(equipe) });
  if (a.aAffecter.length) {
    sections.push({ titre: 'À affecter', sousTitre: 'Salariés sans équipe : validations par le service RH', arbre: [{ libelle: 'À affecter', detail: `${a.aAffecter.length} pers.`, enfants: a.aAffecter.map(membre), groupe: true }] });
  }
  return sections.map(avecEchelle);
}
