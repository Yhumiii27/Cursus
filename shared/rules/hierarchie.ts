// Hiérarchie des équipes (t136) : équipe parente, valideur d'un manager et équipes descendantes.
// Décision de l'entreprise : un manager dépend de son propre responsable « pour tout » (absences, feuilles de temps,
// entretiens). Une équipe peut désigner une équipe parente ; le manager de l'équipe, quand il en est membre, a pour
// valideur le manager de l'équipe parente (N+1), sinon celui de l'équipe au-dessus, et à défaut le service RH.
// Sans équipe parente (par défaut), rien ne change : le manager membre de son équipe est validé par le service RH.
// La consultation N+2 (réglage `consultationN2`, désactivé par défaut) donne au manager la lecture des membres des
// équipes descendantes (server/src/dataset.ts) ; les décisions restent au valideur direct (N+1, `Domain.mgrOf`).
import type { Absence, Employe, Entretien, Equipe, FeuilleTemps } from '../types.ts';

/** Profondeur maximale d'une hiérarchie : site, service, atelier, équipe. */
export const PROFONDEUR_MAX = 4;

type EquipeH = Pick<Equipe, 'nom' | 'managerId'> & { parente?: string | null };

const equipeNommee = <Q extends EquipeH>(equipes: readonly Q[], nom: string | null | undefined) => (nom ? equipes.find(q => q.nom === nom) : undefined);

/** Équipes parentes d'une équipe, de la plus proche à la plus haute (une boucle, impossible à l'enregistrement, arrête la remontée). */
export function ancetres<Q extends EquipeH>(equipes: readonly Q[], nom: string): Q[] {
  const out: Q[] = [];
  const vues = new Set([nom]);
  let q = equipeNommee(equipes, nom);
  while (q?.parente && !vues.has(q.parente)) {
    vues.add(q.parente);
    q = equipeNommee(equipes, q.parente);
    if (q) out.push(q);
  }
  return out;
}

/** Équipes rattachées, directement ou non, à l'une des équipes nommées (elles-mêmes exclues). */
export function equipesDescendantes(equipes: readonly EquipeH[], noms: readonly string[]): string[] {
  const racines = new Set(noms);
  return equipes.filter(q => !racines.has(q.nom) && ancetres(equipes, q.nom).some(p => racines.has(p.nom))).map(q => q.nom);
}

/** Niveau d'une équipe : 1 sans équipe parente. */
export const niveau = (equipes: readonly EquipeH[], nom: string) => 1 + ancetres(equipes, nom).length;

/**
 * Valideur d'un salarié (0 = le service RH) : le manager de son équipe ; pour le manager lui-même, le premier manager
 * d'une équipe parente qui n'est pas lui (N+1), sinon le service RH. Une équipe sans manager reste validée par le service RH.
 */
export function valideurHierarchique(equipes: readonly EquipeH[], e: { id: number; equipe: string | null }): number {
  const q = equipeNommee(equipes, e.equipe);
  if (!q?.managerId) return 0;
  if (q.managerId !== e.id) return q.managerId;
  return ancetres(equipes, q.nom).find(p => p.managerId && p.managerId !== e.id)?.managerId ?? 0;
}

/**
 * Contrôle d'une équipe parente : existante, autre que l'équipe, sans boucle (l'équipe parente n'est pas rattachée à
 * l'équipe), et profondeur de la hiérarchie au plus PROFONDEUR_MAX. Renvoie le motif du refus, ou null.
 */
export function controleParente(equipes: readonly EquipeH[], nom: string, parente: string | null): string | null {
  if (!parente) return null;
  if (parente === nom) return 'Une équipe ne peut pas être sa propre équipe parente';
  if (!equipeNommee(equipes, parente)) return `Équipe parente ${parente} introuvable`;
  if (ancetres(equipes, parente).some(p => p.nom === nom)) return `L’équipe ${parente} est déjà rattachée à ${nom} : la hiérarchie formerait une boucle`;
  const apres = equipes.map(q => (q.nom === nom ? { ...q, parente } : q));
  const tropBas = apres.find(q => niveau(apres, q.nom) > PROFONDEUR_MAX);
  if (tropBas) return `Hiérarchie limitée à ${PROFONDEUR_MAX} niveaux : l’équipe ${tropBas.nom} serait au niveau ${niveau(apres, tropBas.nom)}`;
  return null;
}

/** Salariés qui se valideraient l'un l'autre (chacun valideur de l'autre) : paires « a-b », a < b. */
export function validationsCroisees(equipes: readonly EquipeH[], employes: readonly Pick<Employe, 'id' | 'equipe'>[]): string[] {
  const par = new Map(employes.map(e => [e.id, e]));
  const out = new Set<string>();
  for (const e of employes) {
    const v = valideurHierarchique(equipes, e), m = v ? par.get(v) : undefined;
    if (m && valideurHierarchique(equipes, m) === e.id) out.add(`${Math.min(e.id, v)}-${Math.max(e.id, v)}`);
  }
  return [...out];
}

/** Élément en attente d'une décision de son valideur : demande de congés, feuille soumise, entretien planifié. */
export type ElementRedirige =
  | { kind: 'absence'; id: number; empId: number; du: string; au: string; avant: number; apres: number }
  | { kind: 'feuille'; id: number; empId: number; week: string; avant: number; apres: number }
  | { kind: 'entretien'; id: number; empId: number; date: string; avant: number; apres: number };

/**
 * Éléments en attente qui changent de valideur entre deux états des équipes (enregistrement d'une équipe parente) :
 * demandes de congés, feuilles soumises, entretiens planifiés (l'évaluateur est le valideur).
 */
export function elementsRediriges(
  ds: { employes: readonly Employe[]; absences: readonly Absence[]; feuilles: readonly FeuilleTemps[]; entretiens: readonly Entretien[] },
  avant: readonly EquipeH[], apres: readonly EquipeH[],
): ElementRedirige[] {
  const change = new Map<number, [number, number]>();
  for (const e of ds.employes) {
    const a = valideurHierarchique(avant, e), b = valideurHierarchique(apres, e);
    if (a !== b) change.set(e.id, [a, b]);
  }
  if (!change.size) return [];
  const out: ElementRedirige[] = [];
  for (const a of ds.absences) {
    const c = change.get(a.empId);
    if (c && a.statut === 'demandee') out.push({ kind: 'absence', id: a.id, empId: a.empId, du: a.du, au: a.au, avant: c[0], apres: c[1] });
  }
  for (const f of ds.feuilles) {
    const c = change.get(f.empId);
    if (c && f.statut === 'soumise') out.push({ kind: 'feuille', id: f.id, empId: f.empId, week: f.week, avant: c[0], apres: c[1] });
  }
  for (const x of ds.entretiens) {
    const c = change.get(x.empId);
    if (c && x.statut === 'planifie') out.push({ kind: 'entretien', id: x.id, empId: x.empId, date: x.date, avant: c[0], apres: c[1] });
  }
  return out;
}

/**
 * Validation croisée créée par une modification (équipe parente, manager d'une équipe, affectation d'un salarié) : la
 * première paire de salariés qui deviendraient chacun le valideur de l'autre, absente avant la modification ; null sinon.
 * Une paire déjà présente avant n'est pas reprochée à la modification, qui ne l'a pas créée.
 */
export function croiseeNouvelle(
  avant: { equipes: readonly EquipeH[]; employes: readonly Pick<Employe, 'id' | 'equipe'>[] },
  apres: { equipes: readonly EquipeH[]; employes: readonly Pick<Employe, 'id' | 'equipe'>[] },
): [number, number] | null {
  const deja = new Set(validationsCroisees(avant.equipes, avant.employes));
  const c = validationsCroisees(apres.equipes, apres.employes).find(x => !deja.has(x));
  if (!c) return null;
  const [a, b] = c.split('-').map(Number);
  return [a, b];
}
