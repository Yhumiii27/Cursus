// Astreintes (t049, lot 7, étape 2), côté écran : heure présente, état d'une astreinte et personnes qui la planifient,
// d'après les mêmes règles que le serveur (shared/rules/astreintes.ts, server/src/actions/astreintes.ts). Le serveur
// décide toujours : un écran en retard (astreinte commencée depuis l'affichage) reçoit son refus.
import { ACTIVITE_ASTREINTE } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { astreinteActive, astreinteCommencee, astreinteTerminee, instant } from '../../../shared/rules/astreintes.ts';
import type { Astreinte, Employe, ISODate, LigneTemps } from '../../../shared/types.ts';

/** Ligne INT-AST de la feuille : ses heures viennent des interventions déclarées, jamais d'une saisie (grille en lecture). */
export const ligneAstreinte = (l: Pick<LigneTemps, 'projet'>) => l.projet === ACTIVITE_ASTREINTE.code;

const heureParis = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * Instant présent en minutes d'horloge (`instant`) : le jour de Cursus `ti` (figé en démonstration) à l'heure de Paris,
 * comme `instantPresent` du serveur (server/src/astreintes.ts).
 */
export function maintenant(ti: ISODate, quand: Date = new Date()): number {
  const p = Object.fromEntries(heureParis.formatToParts(quand).map(x => [x.type, x.value]));
  return instant(ti, `${p.hour}:${p.minute}`);
}

export type EtatAstreinte = 'avenir' | 'encours' | 'terminee' | 'annulee';
export const ETAT_ASTREINTE: Record<EtatAstreinte, { label: string; cls: string }> = {
  avenir: { label: 'À venir', cls: 'tag-accent' },
  encours: { label: 'En cours', cls: 'tag-neutral' },
  terminee: { label: 'Terminée', cls: 'tag-outline' },
  annulee: { label: 'Annulée', cls: 'tag-outline' },
};

/** État d'une astreinte à l'instant `m` (minutes d'horloge). */
export function etatAstreinte(a: Astreinte, m: number): EtatAstreinte {
  if (!astreinteActive(a)) return 'annulee';
  if (astreinteTerminee(a, m)) return 'terminee';
  return astreinteCommencee(a, m) ? 'encours' : 'avenir';
}

/**
 * Planning des astreintes de `e` : le service RH (jamais pour soi-même) ou son manager direct (pas un suppléant, pas la
 * consultation N+2), comme `requirePlanificateur` du serveur.
 */
export function peutPlanifier(d: Domain, role: { rh: boolean; manager: boolean; me: number | null; soi: number | null }, e: Pick<Employe, 'id' | 'equipe'>): boolean {
  if (role.rh) return e.id !== role.soi;
  return role.manager && e.id !== role.me && d.mgrOf(e as Employe) === role.me;
}

/** Salariés dont la personne connectée planifie les astreintes (présents, triés par nom). */
export function salariesPlanifiables(d: Domain, role: Parameters<typeof peutPlanifier>[1]): Employe[] {
  return d.ds.employes.filter(e => (!e.fin || e.fin >= d.ti) && peutPlanifier(d, role, e)).sort((a, b) => a.nom.localeCompare(b.nom));
}
