// Planning d'équipe dans l'instantané envoyé au navigateur (lot 12, chantier C5), appelé par server/src/dataset.ts (une
// ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Le service RH (droit « rh ») reçoit
// l'instantané complet. Module désactivé (réglage `planningActif`) : rien hors du service RH.
// - Manager : créneaux, affectations et échanges de son périmètre (`mine`) ; planificateur de son équipe directe et des
//   salariés qu'il planifie par délégation « planning », il en reçoit les motifs et les codes des alertes acceptées
//   (réserve d'aptitude comprise) ; en consultation N+2 ou par une délégation d'un autre périmètre, rien de tout cela. Créneaux « à pourvoir » des équipes de son périmètre.
// - Collaborateur : ses créneaux publiés (motif des circonstances exceptionnelles compris : il lui a été communiqué), sans
//   les alertes acceptées ; ses échanges. Si le réglage `planningCollegues` l'ouvre, les postes planifiés publiés de ses
//   collègues d'équipe, réduits au salarié, au jour et à l'horaire : jamais un repos, une absence ni un motif (un jour sans
//   poste s'affiche vide). Ces collègues sont ajoutés aux salariés lus par la vue (`collegueslus`, server/src/dataset.ts).
// - Profils restreints : lecture seule, toutes les grilles sans motifs ni alertes ; paie, les créneaux publiés sans motifs
//   (primes à venir) ; référent HSE, les postes publiés sans motifs ni affectations (couverture, sans absences). Jamais la
//   réserve d'aptitude ni un motif hors du planificateur.
// Les mêmes filtres servent l'historique à la demande (server/src/planning-historique.ts).
import type { DroitRh } from '../../shared/constants.ts';
import type { Domain } from '../../shared/domain.ts';
import { deleguesA } from '../../shared/rules/delegations-manager.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import type { Creneau, EchangePoste, Roulement } from '../../shared/types-planning.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Projection vide : module désactivé, ou profil sans planning. */
const VIDE: Projection = { cycles: [], besoinsPoste: [], publicationsPlanning: [], roulements: [], creneaux: [], creneauxAPourvoir: [], echangesPoste: [] };

/** Créneau sans motifs ni alertes acceptées (consultation, profils restreints). */
export const creneauSansMotif = (c: Creneau): Creneau =>
  (c.motif || c.motifAlertes || c.alertesAcceptees || c.annuleMotif ? { ...c, motif: null, motifAlertes: null, alertesAcceptees: null, annuleMotif: null } : c);
/** Créneau du salarié lui-même : le motif des circonstances exceptionnelles (communiqué), jamais les alertes acceptées. */
const creneauPourSoi = (c: Creneau): Creneau => (c.motifAlertes || c.alertesAcceptees ? { ...c, motifAlertes: null, alertesAcceptees: null } : c);
/** Poste planifié d'un collègue : salarié, jour, équipe et horaire seulement. */
const posteDeCollegue = (c: Creneau): Creneau => ({
  id: c.id, empId: c.empId, jour: c.jour, equipe: c.equipe, horaire: c.horaire, debut: c.debut, fin: c.fin, pause: c.pause, besoinId: null, source: 'cycle',
  statut: 'publie', remplaceId: null, version: null, publieLe: null, publiePar: null, communiqueLe: null, horsDelai: false, motif: null, motifAlertes: null,
  alertesAcceptees: null, creeLe: '', creePar: '', modifieLe: null, modifiePar: null, annuleLe: null, annulePar: null, annuleMotif: null,
});
const roulementSansMotif = (r: Roulement): Roulement => (r.finMotif ? { ...r, finMotif: null } : r);
const echangeSansMotif = (e: EchangePoste): EchangePoste => (e.motifRefus || e.alertesAcceptees ? { ...e, motifRefus: null, alertesAcceptees: null } : e);

/**
 * Collègues dont le collaborateur voit les postes planifiés : ceux de son équipe, présents, si le module et le réglage
 * `planningCollegues` l'ouvrent ; aucun sinon (ni pour le manager, qui voit son équipe à un autre titre).
 */
export function colleguesVisibles(full: Pick<Dataset, 'settings' | 'employes' | 'today'>, user: CurrentUser): number[] {
  if (user.role !== 'collaborateur' || !user.empId || !full.settings.planningActif || !full.settings.planningCollegues) return [];
  const equipe = full.employes.find(e => e.id === user.empId)?.equipe;
  return equipe ? full.employes.filter(e => e.equipe === equipe && e.id !== user.empId && (!e.fin || e.fin >= full.today)).map(e => e.id) : [];
}

/** Ce qu'une vue manager ou collaborateur lit des créneaux nominatifs (instantané, ou historique à la demande). */
export interface LecteurCreneaux {
  user: CurrentUser; ids: ReadonlySet<number>;
  /** Salariés dont le manager est le planificateur : son équipe directe, et ceux qu'il planifie par délégation « planning ». */
  planifies: ReadonlySet<number>;
  collegues: ReadonlySet<number>;
}

/** Salariés que le manager `user` planifie aujourd'hui : son équipe directe, et la délégation « planning » d'un manager absent. */
export function planifiesPar(d: Domain, user: CurrentUser): Set<number> {
  if (user.role !== 'manager' || !user.empId) return new Set();
  const m = user.empId;
  return new Set([
    ...d.ds.employes.filter(e => e.id !== m && d.mgrOf(e) === m).map(e => e.id),
    ...deleguesA(d.ds, m, d.ti).filter(x => x.perimetre.includes('planning')).map(x => x.empId),
  ].filter(id => id !== m));
}

/** Créneaux nominatifs vus par un manager ou un collaborateur, dans l'ordre reçu. */
export function creneauxPourSalarie(creneaux: readonly Creneau[], x: LecteurCreneaux): Creneau[] {
  const out: Creneau[] = [];
  const isMgr = x.user.role === 'manager';
  for (const c of creneaux) {
    if (c.empId == null) continue;
    if (c.empId === x.user.empId) { if (c.statut === 'publie' || c.statut === 'remplace' || c.statut === 'annule') out.push(creneauPourSoi(c)); continue; }
    if (isMgr && x.ids.has(c.empId)) { out.push(x.planifies.has(c.empId) ? c : creneauSansMotif(c)); continue; }
    if (x.collegues.has(c.empId) && c.statut === 'publie' && c.horaire) out.push(posteDeCollegue(c));
  }
  return out;
}

/** Créneaux nominatifs vus par un profil restreint de l'espace RH. */
export function creneauxPourProfil(creneaux: readonly Creneau[], droits: readonly DroitRh[]): Creneau[] {
  if (droits.includes('consultation')) return creneaux.map(creneauSansMotif);
  if (droits.includes('paie')) return creneaux.filter(c => c.statut === 'publie').map(creneauSansMotif);
  if (droits.includes('formations')) return creneaux.filter(c => c.statut === 'publie' && c.horaire).map(creneauSansMotif);
  return [];
}

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function planningVueSalarie(x: ContexteVueSalarie): Projection {
  const { full, d, user, ids, mine } = x;
  if (!full.settings.planningActif) return VIDE;
  const isMgr = user.role === 'manager';
  const collegues = new Set(colleguesVisibles(full, user));
  const planifies = planifiesPar(d, user);
  const lecteur: LecteurCreneaux = { user, ids, planifies, collegues };
  // Équipes du périmètre (créneaux « à pourvoir », publications) : celles des salariés de la vue, et celles qu'il encadre.
  const equipes = new Set([...full.employes.filter(e => ids.has(e.id) && e.equipe).map(e => e.equipe!), ...(isMgr && user.empId ? d.teamsOf(user.empId) : [])]);
  const planifiees = new Set(full.employes.filter(e => planifies.has(e.id) && e.equipe).map(e => e.equipe!));
  const siens = (e: EchangePoste) => e.demandeurId === user.empId || e.partenaireId === user.empId;
  return {
    cycles: full.cycles ?? [],
    besoinsPoste: full.besoinsPoste ?? [],
    publicationsPlanning: (full.publicationsPlanning ?? []).filter(p => equipes.has(p.equipe)),
    roulements: mine(full.roulements ?? []).filter(r => isMgr || r.empId === user.empId)
      .map(r => (planifies.has(r.empId) ? r : roulementSansMotif(r))),
    creneaux: creneauxPourSalarie((full.creneaux ?? []).filter(c => c.empId != null && (ids.has(c.empId) || collegues.has(c.empId))), lecteur),
    // « À pourvoir » : le planificateur des équipes de son périmètre seulement (motifs compris), jamais le collaborateur.
    creneauxAPourvoir: isMgr ? (full.creneauxAPourvoir ?? []).filter(c => c.equipe && equipes.has(c.equipe)).map(c => (planifiees.has(c.equipe!) ? c : creneauSansMotif(c))) : [],
    echangesPoste: (full.echangesPoste ?? []).filter(e => siens(e) || (isMgr && (ids.has(e.demandeurId) || ids.has(e.partenaireId))))
      .map(e => (siens(e) ? { ...e, alertesAcceptees: null } : planifies.has(e.demandeurId) && planifies.has(e.partenaireId) ? e : echangeSansMotif(e))),
  };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function planningVueProfil(x: ContexteVueProfil): Projection {
  const { full, droits } = x;
  if (!full.settings.planningActif) return VIDE;
  const lecture = droits.includes('consultation'), paie = droits.includes('paie'), formations = droits.includes('formations');
  if (!lecture && !paie && !formations) return VIDE;
  return {
    cycles: full.cycles ?? [],
    besoinsPoste: full.besoinsPoste ?? [],
    publicationsPlanning: full.publicationsPlanning ?? [],
    roulements: lecture || paie ? (full.roulements ?? []).map(roulementSansMotif) : [],
    creneaux: creneauxPourProfil(full.creneaux ?? [], droits),
    creneauxAPourvoir: creneauxPourProfil(full.creneauxAPourvoir ?? [], droits),
    echangesPoste: lecture ? (full.echangesPoste ?? []).map(echangeSansMotif) : [],
  };
}
