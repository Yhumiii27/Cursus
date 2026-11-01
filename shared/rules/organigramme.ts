// Organigramme (lot 11, chantier C1, t195) : arbre société > établissement > équipe > équipe rattachée > personne, tiré des
// données déjà transmises à tous (annuaire : nom, équipe, poste ; équipes et leur manager ; entités), sans changer aucun
// valideur : l'équipe et son équipe parente gardent leur sens (shared/rules/hierarchie.ts), l'entité n'est qu'un
// regroupement au-dessus des équipes racines (shared/rules/entites.ts).
// - Présents seulement : entrée passée et fin à venir (`presentA`, plus strict que `present` de shared/rules/contrats.ts,
//   qui compte une embauche à venir), fiches anonymisées exclues. Hors du service RH, l'annuaire ne porte pas les dates :
//   le serveur transmet la liste des présents (`Dataset.presentsOrganigramme`, calculée par `presentsDe`).
// - Hors du service RH (réglage `organigrammeOuvert`, choix par défaut : ouvert à tous) : aucune étiquette de contrat, et
//   le suppléant d'un manager n'est montré que d'après les délégations que la personne voit déjà (server/src/dataset.ts,
//   `delegationsVisibles`), sans les dates. Le filtrage se fait ici : l'annuaire envoyé ne change pas.
// - Service RH : anomalies signalées (équipe sans manager, salarié à affecter, équipe racine sans entité, équipe racine
//   au nom de site) et étiquettes de contrat (intérim, alternance, stage) fournies par l'écran.
import type { DelegationValidation, Entite, Equipe, ISODate, OrganigrammeOuvert, Personne, Role } from '../types.ts';
import { delegationEnVigueur } from './delegations-manager.ts';
import { entiteDe, entiteEquipe, entiteOuverte, equipesRessemblantAUnSite } from './entites.ts';
import { ancetres, equipesDescendantes, valideurHierarchique } from './hierarchie.ts';

/** Présent à la date : entré (entrée au plus tard ce jour) et pas encore sorti (fin au plus tôt ce jour). */
export const presentA = (p: { entree?: ISODate | null; fin?: ISODate | null }, date: ISODate) => (!p.entree || p.entree <= date) && (!p.fin || p.fin >= date);

/** Identifiants des salariés présents à la date et non anonymisés, dans l'ordre des fiches (`Dataset.presentsOrganigramme`). */
export const presentsDe = (employes: readonly { id: number; entree?: ISODate | null; fin?: ISODate | null; anonymiseLe?: ISODate | null }[], date: ISODate) =>
  employes.filter(e => presentA(e, date) && !e.anonymiseLe).map(e => e.id);

/** L'organigramme est-il ouvert à l'espace `role` ? L'espace RH l'a toujours (tous ses profils, lecture seule comprise). */
export function organigrammeOuvertA(reglage: OrganigrammeOuvert | undefined, role: Role): boolean {
  if (role === 'rh') return true;
  const r = reglage ?? 'tous';
  return role === 'manager' ? r !== 'rh' : r === 'tous';
}

export const ORGANIGRAMME_OUVERT: Record<OrganigrammeOuvert, string> = {
  tous: 'Tous les salariés', managers: 'Managers et service RH', rh: 'Service RH seulement',
};

/** Personne de l'arbre : celle de l'annuaire, avec ses dates quand l'écran les a (service RH). */
export type PersonneArbre = Personne & { entree?: ISODate | null; fin?: ISODate | null; anonymiseLe?: ISODate | null };

export interface MembreArbre {
  id: number; nom: string; poste: string;
  /** Manager de son équipe. */
  manager: boolean;
  /** Valideur (N+1) : manager de l'équipe, ou d'une équipe parente pour le manager ; 0 : le service RH. */
  valideur: number;
  /** Étiquette de contrat (service RH seulement) : intérim, alternance, stage… */
  etiquette?: string;
}

export interface NoeudEquipe {
  nom: string;
  managerId: number | null;
  /** Nom du manager s'il figure dans l'annuaire ; null : équipe sans manager (validations par le service RH). */
  manager: string | null;
  /** Suppléant du manager aujourd'hui, d'après les délégations que la personne voit (jamais les dates). */
  suppleant: { id: number; nom: string } | null;
  /** Valideur du manager (N+1) ; 0 : le service RH. */
  valideurManager: number;
  siteCode: string | null;
  uniteCode: string | null;
  /** Présents de l'équipe, le manager en tête puis par nom. */
  membres: MembreArbre[];
  /** Équipes rattachées, dans l'ordre des équipes. */
  equipes: NoeudEquipe[];
  /** Présents de l'équipe et de ses équipes rattachées. */
  effectif: number;
}

export interface NoeudEntite {
  code: string; nom: string; type: Entite['type']; siret: string | null; siteCode: string | null;
  /** Fermée (montrée tant qu'une équipe en relève, ce que la fermeture refuse ; écriture directe en base). */
  fermee: boolean;
  /** Établissements d'une société. */
  etablissements: NoeudEntite[];
  /** Équipes racines rattachées à l'entité. */
  equipes: NoeudEquipe[];
  effectif: number;
}

export type AnomalieOrganigramme =
  | { kind: 'equipeSansManager'; equipe: string }
  | { kind: 'aAffecter'; empId: number }
  | { kind: 'racineSansEntite'; equipe: string }
  | { kind: 'equipeSite'; equipe: string };

export interface Arbre {
  /** Sociétés (avec leurs établissements), puis établissements dont la société manque. */
  entites: NoeudEntite[];
  /** Équipes racines sans entité (ou d'une entité inconnue). */
  sansEntite: NoeudEquipe[];
  /** Présents sans équipe ou d'une équipe inconnue : service RH seulement (vide ailleurs). */
  aAffecter: MembreArbre[];
  /** Anomalies : service RH seulement (vide ailleurs). */
  anomalies: AnomalieOrganigramme[];
  /** Présents dans l'arbre. */
  effectif: number;
}

export interface OptionsArbre {
  /** Service RH : anomalies, salariés à affecter et étiquettes. */
  rh?: boolean;
  /** Présents désignés par le serveur (`Dataset.presentsOrganigramme`), à la place des dates de l'annuaire. */
  presents?: ReadonlySet<number> | readonly number[];
  /** Étiquettes de contrat par salarié (service RH seulement : ignorées sinon). */
  etiquettes?: ReadonlyMap<number, string>;
}

const parNom = (a: { nom: string }, b: { nom: string }) => a.nom.localeCompare(b.nom, 'fr');

/**
 * Arbre de l'organigramme au jour `today` : entités (sociétés, leurs établissements), équipes racines de chacune, équipes
 * rattachées (hierarchie.ts) et présents de chaque équipe. Ordre : celui des entités et des équipes (`ordre`), membres
 * par nom après le manager. Aucun valideur n'est changé : `valideurHierarchique` est lu tel quel.
 */
export function arbre(
  entites: readonly Entite[], equipes: readonly Equipe[], annuaire: readonly PersonneArbre[], delegationsVisibles: readonly DelegationValidation[], today: ISODate,
  o: OptionsArbre = {},
): Arbre {
  const presents = o.presents ? new Set(o.presents) : null;
  const visibles = annuaire.filter(p => (presents ? presents.has(p.id) : presentA(p, today) && !p.anonymiseLe));
  const noms = new Map(annuaire.map(p => [p.id, p.nom]));
  const etiquette = (id: number) => (o.rh ? o.etiquettes?.get(id) : undefined);
  const parEquipe = new Map<string, PersonneArbre[]>();
  for (const p of visibles) if (p.equipe) parEquipe.set(p.equipe, [...parEquipe.get(p.equipe) ?? [], p]);
  // Suppléant en vigueur aujourd'hui, par manager (la plus récente des délégations visibles).
  const suppleants = new Map<number, number>();
  for (const g of delegationsVisibles) if (delegationEnVigueur(g, today)) suppleants.set(g.managerId, g.suppleantId);
  const triees = [...equipes].sort((a, b) => a.ordre - b.ordre || parNom(a, b));
  const connues = new Set(equipes.map(q => q.nom));

  const membre = (p: PersonneArbre, q: Equipe): MembreArbre => {
    const m: MembreArbre = { id: p.id, nom: p.nom, poste: p.poste, manager: q.managerId === p.id, valideur: valideurHierarchique(equipes, p) };
    const et = etiquette(p.id);
    return et ? { ...m, etiquette: et } : m;
  };
  const noeud = (q: Equipe): NoeudEquipe => {
    const membres = (parEquipe.get(q.nom) ?? []).map(p => membre(p, q)).sort((a, b) => Number(b.manager) - Number(a.manager) || parNom(a, b));
    const filles = triees.filter(x => x.parente === q.nom && x.nom !== q.nom).map(noeud);
    const s = q.managerId ? suppleants.get(q.managerId) : undefined;
    return {
      nom: q.nom, managerId: q.managerId, manager: q.managerId ? noms.get(q.managerId) ?? null : null,
      suppleant: s && noms.has(s) ? { id: s, nom: noms.get(s)! } : null,
      valideurManager: q.managerId ? valideurHierarchique(equipes, { id: q.managerId, equipe: q.nom }) : 0,
      siteCode: q.siteCode ?? null, uniteCode: q.uniteCode ?? null,
      membres, equipes: filles, effectif: membres.length + filles.reduce((n, f) => n + f.effectif, 0),
    };
  };
  // Équipes racines : sans équipe parente, ou d'une équipe parente inconnue (écriture directe en base).
  const racines = triees.filter(q => !q.parente || !connues.has(q.parente));
  const racinesDe = new Map<string, NoeudEquipe[]>();
  const sansEntite: NoeudEquipe[] = [];
  for (const q of racines) {
    const code = q.entite ?? null;
    if (code && entiteDe(entites, code)) racinesDe.set(code, [...racinesDe.get(code) ?? [], noeud(q)]);
    else sansEntite.push(noeud(q));
  }
  const ordreEntites = [...entites].sort((a, b) => a.ordre - b.ordre || parNom(a, b));
  const noeudEntite = (x: Entite): NoeudEntite => {
    const etablissements = x.type === 'societe' ? ordreEntites.filter(e => e.type === 'etablissement' && e.parente === x.code).map(noeudEntite).filter(garder) : [];
    const eq = racinesDe.get(x.code) ?? [];
    return {
      code: x.code, nom: x.nom, type: x.type, siret: x.siret, siteCode: x.siteCode, fermee: !entiteOuverte(x), etablissements, equipes: eq,
      effectif: eq.reduce((n, q) => n + q.effectif, 0) + etablissements.reduce((n, e) => n + e.effectif, 0),
    };
  };
  // Une entité fermée sans équipe n'apparaît plus.
  const garder = (n: NoeudEntite) => !n.fermee || n.equipes.length > 0 || n.etablissements.length > 0;
  const societes = new Set(entites.filter(x => x.type === 'societe').map(x => x.code));
  const hauts = ordreEntites.filter(x => x.type === 'societe' || !x.parente || !societes.has(x.parente)).map(noeudEntite).filter(garder);

  const dansArbre = new Set<number>();
  const marquer = (n: NoeudEquipe) => { for (const m of n.membres) dansArbre.add(m.id); n.equipes.forEach(marquer); };
  const toutes = (n: NoeudEntite): NoeudEquipe[] => [...n.equipes, ...n.etablissements.flatMap(toutes)];
  [...hauts.flatMap(toutes), ...sansEntite].forEach(marquer);
  const aAffecter = o.rh ? visibles.filter(p => !p.equipe || !connues.has(p.equipe)).sort(parNom)
    .map(p => ({ id: p.id, nom: p.nom, poste: p.poste, manager: false, valideur: 0, ...(etiquette(p.id) ? { etiquette: etiquette(p.id) } : {}) })) : [];
  const anomalies: AnomalieOrganigramme[] = !o.rh ? [] : [
    ...triees.filter(q => !q.managerId).map(q => ({ kind: 'equipeSansManager' as const, equipe: q.nom })),
    ...aAffecter.map(p => ({ kind: 'aAffecter' as const, empId: p.id })),
    ...sansEntite.map(q => ({ kind: 'racineSansEntite' as const, equipe: q.nom })),
    ...equipesRessemblantAUnSite(racines).map(nom => ({ kind: 'equipeSite' as const, equipe: nom })),
  ];
  return { entites: hauts, sansEntite, aAffecter, anomalies, effectif: dansArbre.size + aAffecter.length };
}

/** Texte d'une anomalie, pour le service RH. */
export function anomalieTexte(a: AnomalieOrganigramme, nom: (id: number) => string): string {
  switch (a.kind) {
    case 'equipeSansManager': return `L’équipe ${a.equipe} n’a pas de manager : ses validations reviennent au service RH.`;
    case 'aAffecter': return `${nom(a.empId)} n’est affecté à aucune équipe.`;
    case 'racineSansEntite': return `L’équipe ${a.equipe} ne relève d’aucune entité (société ou établissement).`;
    case 'equipeSite': return `L’équipe racine ${a.equipe} porte un nom de site : à convertir à la main en site ou en établissement si c’en est un.`;
  }
}

/** Chemin d'une équipe, de son équipe racine à elle (« Production › Maintenance »), et son entité. */
export function cheminEquipe(equipes: readonly Equipe[], nom: string): { chemin: string[]; entite: string | null } {
  return { chemin: [...ancetres(equipes, nom).map(q => q.nom).reverse(), nom], entite: entiteEquipe(equipes, nom) };
}

/** Équipes de l'arbre sous les équipes nommées, elles comprises (filtre de l'écran). */
export const sousArbre = (equipes: readonly Equipe[], noms: readonly string[]) => [...noms, ...equipesDescendantes(equipes, noms)];
