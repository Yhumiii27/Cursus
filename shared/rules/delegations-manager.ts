// Délégation des validations d'un manager absent (t135) : pendant une période datée, un suppléant décide à sa place des
// demandes de son équipe. Décision de l'entreprise : un manager dépend de son propre responsable « pour tout » ; le
// suppléant proposé est donc son N+1 (`suppleantPropose`, hiérarchie de t136), sinon une personne choisie. Périmètre par
// défaut : absences et feuilles de temps ; les entretiens seulement si le réglage `delegationEntretiens` l'ouvre (désactivé
// par défaut). Sans délégation, rien ne change : le manager décide, et le service RH à défaut.
// Règles :
// - le manager reste valideur pendant sa délégation (retour anticipé) ; le suppléant s'y ajoute (`valideursDe`) ;
// - pas d'auto-validation : le suppléant membre de l'équipe ne décide jamais de ce qui le concerne ; ses propres demandes
//   vont, pendant la délégation, au N+1 du manager (le service RH à défaut), en plus du manager ;
// - une délégation ne se transmet pas : le suppléant ne délègue pas ce qu'il a reçu, et il ne peut pas lui-même avoir
//   délégué ses validations sur la même période ;
// - révoquée, elle cesse aussitôt ; une délégation passée ou révoquée reste dans l'historique.
import type { DelegationValidation, Employe, Equipe, ISODate, PerimetreDelegation, Settings } from '../types.ts';
import { isValidDate } from '../dates.ts';
import { valideurHierarchique } from './hierarchie.ts';

/** Périmètres possibles, dans l'ordre de l'écran ; les entretiens seulement si le réglage les ouvre. */
export const PERIMETRES_DELEGATION: Record<PerimetreDelegation, { label: string; court: string }> = {
  absences: { label: 'Congés et absences', court: 'congés' },
  feuilles: { label: 'Feuilles de temps', court: 'feuilles de temps' },
  entretiens: { label: 'Entretiens', court: 'entretiens' },
};
export const estPerimetre = (v: unknown): v is PerimetreDelegation => typeof v === 'string' && Object.hasOwn(PERIMETRES_DELEGATION, v);

/** Durée maximale d'une délégation (jours, bornes comprises) : une absence longue relève d'un changement de manager. */
export const DUREE_MAX_DELEGATION = 92;

type DsDelegation = {
  employes: readonly Pick<Employe, 'id' | 'equipe'>[];
  referentiels: { equipes: readonly Pick<Equipe, 'nom' | 'managerId' | 'parente'>[] };
  settings: Pick<Settings, 'delegationEntretiens'>;
  delegations?: readonly DelegationValidation[];
};

/** Périmètre retenu d'une délégation : celui saisi, sans les entretiens tant que le réglage ne les ouvre pas. */
export const perimetreEffectif = (s: Pick<Settings, 'delegationEntretiens'>, g: Pick<DelegationValidation, 'perimetre'>): PerimetreDelegation[] =>
  g.perimetre.filter(p => p !== 'entretiens' || s.delegationEntretiens);

/** Délégation en vigueur ce jour-là (bornes comprises), non révoquée. */
export const delegationEnVigueur = (g: DelegationValidation, jour: ISODate) => !g.revoqueeLe && g.du <= jour && jour <= g.au;

/** Délégation du manager en vigueur ce jour-là pour ce périmètre ; null sinon. */
export function delegationActive(ds: DsDelegation, managerId: number, jour: ISODate, perimetre: PerimetreDelegation): DelegationValidation | null {
  return (ds.delegations ?? []).find(g => g.managerId === managerId && delegationEnVigueur(g, jour) && perimetreEffectif(ds.settings, g).includes(perimetre)) ?? null;
}

const valideur = (ds: DsDelegation, e: Pick<Employe, 'id' | 'equipe'>) => valideurHierarchique(ds.referentiels.equipes, e);

/** Valideur d'un salarié, et la délégation qui l'en fait valideur (absente pour le valideur hiérarchique). */
export interface ValideurDelegue { id: number; delegation: DelegationValidation | null }

/**
 * Valideurs d'un salarié ce jour-là pour un périmètre (0 = le service RH) : son valideur hiérarchique (`Domain.mgrOf`),
 * puis, pendant une délégation de celui-ci, le suppléant ; pour le suppléant lui-même, le N+1 du manager à sa place
 * (le service RH à défaut). Jamais le salarié lui-même.
 */
export function valideursDe(ds: DsDelegation, e: Pick<Employe, 'id' | 'equipe'>, jour: ISODate, perimetre: PerimetreDelegation): ValideurDelegue[] {
  const m = valideur(ds, e);
  if (!m) return [{ id: 0, delegation: null }];
  const g = delegationActive(ds, m, jour, perimetre);
  if (!g) return [{ id: m, delegation: null }];
  if (g.suppleantId !== e.id) return [{ id: m, delegation: null }, { id: g.suppleantId, delegation: g }];
  const mgr = ds.employes.find(x => x.id === m);
  const n1 = mgr ? valideur(ds, mgr) : 0;
  return [{ id: m, delegation: null }, { id: n1 === e.id ? 0 : n1, delegation: g }];
}

/** Délégation par laquelle `empId` décide pour ce salarié ce jour-là ; null s'il ne la tient pas d'une délégation. */
export function delegationPour(ds: DsDelegation, e: Pick<Employe, 'id' | 'equipe'>, empId: number, jour: ISODate, perimetre: PerimetreDelegation): DelegationValidation | null {
  if (e.id === empId) return null;
  return valideursDe(ds, e, jour, perimetre).find(v => v.id === empId && v.delegation)?.delegation ?? null;
}

/** Salarié dont `empId` décide par délégation ce jour-là, avec le manager remplacé et les périmètres reçus. */
export interface Delegue { empId: number; managerId: number; perimetre: PerimetreDelegation[] }

/** Salariés dont `empId` décide par délégation ce jour-là (périmètre de chacun), hors ceux qu'il valide déjà. */
export function deleguesA(ds: DsDelegation, empId: number, jour: ISODate): Delegue[] {
  const out: Delegue[] = [];
  const actives = (ds.delegations ?? []).filter(g => delegationEnVigueur(g, jour));
  if (!actives.length) return out;
  for (const e of ds.employes) {
    if (e.id === empId || valideur(ds, e) === empId) continue;
    const perimetre = (Object.keys(PERIMETRES_DELEGATION) as PerimetreDelegation[]).filter(p => !!delegationPour(ds, e, empId, jour, p));
    if (perimetre.length) out.push({ empId: e.id, managerId: valideur(ds, e), perimetre });
  }
  return out;
}

/** Suppléant proposé : le responsable du manager (N+1, t136) ; 0 s'il n'en a pas (le service RH n'est pas un suppléant). */
export function suppleantPropose(ds: DsDelegation, managerId: number): number {
  const mgr = ds.employes.find(x => x.id === managerId);
  const n1 = mgr ? valideur(ds, mgr) : 0;
  return n1 && n1 !== managerId ? n1 : 0;
}

/** Les deux périodes se chevauchent-elles (bornes comprises) ? */
const chevauche = (a: { du: ISODate; au: ISODate }, b: { du: ISODate; au: ISODate }) => a.du <= b.au && b.du <= a.au;

/** Nombre de jours d'une période, bornes comprises. */
const jours = (du: ISODate, au: ISODate) => Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Contrôle d'une nouvelle délégation. `managerId` : manager qui délègue (il encadre au moins une équipe) ; `suppleant` :
 * salarié présent pendant toute la période, autre que le manager ; période d'au plus DUREE_MAX_DELEGATION jours, qui ne
 * finit pas avant aujourd'hui ; au moins un périmètre, les entretiens seulement si le réglage les ouvre ; aucune autre
 * délégation du manager sur la période ; le suppléant n'a pas lui-même délégué ses validations sur la période (une
 * délégation ne se transmet pas). Renvoie le motif du refus, ou null.
 */
export function controleDelegation(
  ds: DsDelegation & { today: ISODate },
  g: { managerId: number; suppleantId: number; du: unknown; au: unknown; perimetre: readonly unknown[] },
  noms: { suppleant: Pick<Employe, 'entree' | 'fin'> | null | undefined; nom: (id: number) => string },
): string | null {
  if (!ds.referentiels.equipes.some(q => q.managerId === g.managerId)) return 'Seul un manager d’équipe délègue ses validations';
  if (g.suppleantId === g.managerId) return 'Le suppléant doit être une autre personne que le manager';
  const s = noms.suppleant;
  if (!s) return 'Suppléant introuvable';
  if (typeof g.du !== 'string' || typeof g.au !== 'string' || !isValidDate(g.du) || !isValidDate(g.au)) return 'Dates de la délégation invalides';
  const du = g.du as ISODate, au = g.au as ISODate;
  if (au < du) return 'La fin de la délégation précède son début';
  if (au < ds.today) return 'La délégation serait déjà terminée : choisissez une fin à partir d’aujourd’hui';
  if (jours(du, au) > DUREE_MAX_DELEGATION) return `Délégation limitée à ${DUREE_MAX_DELEGATION} jours : au-delà, confiez l’équipe à un autre manager`;
  if ((s.entree && s.entree > du) || (s.fin && s.fin < au)) return `${noms.nom(g.suppleantId)} n’est pas présent dans l’entreprise pendant toute la période`;
  if (!g.perimetre.length || !g.perimetre.every(estPerimetre)) return 'Choisissez ce que le suppléant valide : congés, feuilles de temps';
  if (g.perimetre.includes('entretiens') && !ds.settings.delegationEntretiens) return 'La délégation des entretiens n’est pas ouverte (Paramètres → Hiérarchie des managers)';
  const actives = (ds.delegations ?? []).filter(x => !x.revoqueeLe && x.au >= ds.today);
  const deja = actives.find(x => x.managerId === g.managerId && chevauche(x, { du, au }));
  if (deja) return `${noms.nom(g.managerId)} a déjà délégué ses validations à ${noms.nom(deja.suppleantId)} sur une partie de cette période : révoquez-la d’abord`;
  const chaine = actives.find(x => x.managerId === g.suppleantId && chevauche(x, { du, au }));
  if (chaine) return `${noms.nom(g.suppleantId)} a lui-même délégué ses validations sur une partie de cette période : choisissez un autre suppléant`;
  const recue = actives.find(x => x.suppleantId === g.managerId && chevauche(x, { du, au }));
  if (recue) return `${noms.nom(g.managerId)} remplace lui-même ${noms.nom(recue.managerId)} sur une partie de cette période : une délégation ne se transmet pas`;
  return null;
}

/** État d'une délégation pour l'écran. */
export type EtatDelegation = 'a_venir' | 'en_cours' | 'terminee' | 'revoquee';
export const etatDelegation = (g: DelegationValidation, jour: ISODate): EtatDelegation =>
  g.revoqueeLe ? 'revoquee' : g.au < jour ? 'terminee' : g.du > jour ? 'a_venir' : 'en_cours';
export const ETAT_DELEGATION: Record<EtatDelegation, { label: string; cls: string }> = {
  a_venir: { label: 'À venir', cls: 'tag-outline' },
  en_cours: { label: 'En cours', cls: 'tag-accent' },
  terminee: { label: 'Terminée', cls: 'tag-neutral' },
  revoquee: { label: 'Révoquée', cls: 'tag-neutral' },
};

/** « congés et feuilles de temps » : périmètre en clair. */
export const perimetreTexte = (p: readonly PerimetreDelegation[]) => {
  const t = (Object.keys(PERIMETRES_DELEGATION) as PerimetreDelegation[]).filter(x => p.includes(x)).map(x => PERIMETRES_DELEGATION[x].court);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} et ${t[t.length - 1]}` : t[0] ?? '';
};
