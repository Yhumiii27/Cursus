// Liste d'attente des sessions de formation complètes (lot 7, chantier C, t120). Une demande acceptée sur une session
// pleine place le salarié en file, par ordre d'arrivée, sans priorité métier (aucune donnée par l'entreprise). Quand une
// place se libère, le premier encore admissible est proposé au service RH, qui confirme l'inscription (réponse de
// l'entreprise du 23 octobre 2026), ou, réglage `automatique`, inscrit et convoqué aussitôt. Règles pures, communes à
// l'écran et au serveur (server/src/liste-attente.ts) : file et place de chacun, places à proposer, admissibilité.
import { parse } from '../dates.ts';
import { certEnVigueur, type Domain, sessionActive } from '../domain.ts';
import { fmt } from '../format.ts';
import { blocage, conflitsSession } from './conflits.ts';
import { horsContratLe } from './contrats.ts';
import { finSession } from './plage-session.ts';
import type { AttenteSession, DemandeCollab, IssueAttente, Session } from '../types.ts';

/** Attente encore en file : en attente, ou proposée au service RH. */
export const attenteActive = (a: Pick<AttenteSession, 'statut'>) => a.statut === 'attente' || a.statut === 'proposee';

/** Attentes en file d'une session, par ordre d'arrivée (rang, puis identifiant). */
export function fileDe<T extends Pick<AttenteSession, 'sessionId' | 'statut' | 'rang' | 'id'>>(attentes: readonly T[], sessionId: number): T[] {
  return attentes.filter(a => a.sessionId === sessionId && attenteActive(a)).sort((a, b) => a.rang - b.rang || a.id - b.id);
}

/**
 * Place de chacun dans la file de sa session (1 : le premier), calculée sur toutes les attentes avant la restriction au
 * périmètre (server/src/dataset.ts) : le salarié voit sa place sans voir les autres. Hors de la file : null.
 */
export function avecPositions<T extends AttenteSession>(attentes: readonly T[]): T[] {
  const pos = new Map<number, number>();
  for (const id of new Set(attentes.map(a => a.sessionId))) fileDe(attentes, id).forEach((a, i) => pos.set(a.id, i + 1));
  return attentes.map(a => ({ ...a, position: pos.get(a.id) ?? null }));
}

/** Rang donné au suivant de la file d'une session (ordre d'arrivée), attentes closes comprises. */
export const rangSuivant = (attentes: readonly Pick<AttenteSession, 'sessionId' | 'rang'>[], sessionId: number) =>
  Math.max(0, ...attentes.filter(a => a.sessionId === sessionId).map(a => a.rang)) + 1;

/** Places libres de la session qui ne sont pas déjà proposées au service RH. */
export function placesAProposer(s: Pick<Session, 'id' | 'places' | 'inscrits'>, attentes: readonly Pick<AttenteSession, 'sessionId' | 'statut'>[]): number {
  const proposees = attentes.filter(a => a.sessionId === s.id && a.statut === 'proposee').length;
  return Math.max(0, s.places - s.inscrits - proposees);
}

/** Libellé de la fin d'une attente, à placer après « Retiré de la liste d'attente : ». */
export const ISSUE_ATTENTE_LABEL: Record<IssueAttente, string> = {
  inscription: 'inscrit à la session',
  salarie: 'retrait par le salarié',
  manager: 'retrait par le manager',
  rh: 'retrait par le service RH',
  session_annulee: 'session annulée',
  session_cloturee: 'session clôturée',
  session_commencee: 'session commencée',
  hors_contrat: 'session après la fin du contrat',
  deja_inscrit: 'déjà inscrit à la session',
  deja_certifie: 'certification enregistrée depuis',
  certification_remplacee: 'certification remplacée ou supprimée depuis',
  demande_rouverte: 'demande rouverte par le service RH',
};

/**
 * Non-admissibilité d'une attente : motif (codé, pour le journal), texte, et `definitif` quand l'attente n'a plus d'objet
 * (elle sort alors de la file) ; sinon le salarié est seulement passé cette fois (absent ces jours-là, inscrit à une autre
 * session, session précédente à clôturer d'abord).
 */
export interface NonAdmissible {
  motif: IssueAttente | 'conflit' | 'attend_cloture'; texte: string; definitif: boolean;
  /**
   * Conflit de dates en clair (absence, déplacement, autre session), pour le service RH qui confirme : jamais dans le
   * message d'une action faite par un autre (manager), ni au journal, où `texte` reste générique.
   */
  detail?: string;
}

/**
 * Le salarié de l'attente peut-il être inscrit à la session maintenant ? Mêmes contrôles que `plan.inscrire`
 * (server/src/actions/conformite.ts) : session ouverte et pas commencée, dans le contrat, sans absence ni autre session ces
 * jours-là, pas déjà inscrit ; en plus, la certification à renouveler toujours en vigueur (aucun recyclage enregistré
 * depuis), et, pour une formation initiale, aucune certification obtenue depuis. La place libre se contrôle à part
 * (`placesAProposer`). null : admissible.
 */
export function nonAdmissible(d: Domain, a: Pick<AttenteSession, 'sessionId' | 'empId' | 'certId' | 'le'>): NonAdmissible | null {
  const s = d.session(a.sessionId);
  if (!s || !sessionActive(s)) {
    const motif = s?.statut === 'Clôturée' ? 'session_cloturee' : 'session_annulee';
    return { motif, texte: ISSUE_ATTENTE_LABEL[motif], definitif: true };
  }
  if (s.date < d.ti) return { motif: 'session_commencee', texte: ISSUE_ATTENTE_LABEL.session_commencee, definitif: true };
  const emp = d.emp(a.empId);
  const hors = emp ? horsContratLe(emp, finSession(s)) : 'salarié introuvable';
  if (!emp || hors) return { motif: 'hors_contrat', texte: hors ?? ISSUE_ATTENTE_LABEL.hors_contrat, definitif: true };
  const cert = certEnVigueur(emp.certs, s.formation);
  const insc = d.ds.inscriptions.find(i => i.empId === emp.id && i.sessionId === s.id);
  if (cert?.sessionId === s.id || insc) return { motif: 'deja_inscrit', texte: ISSUE_ATTENTE_LABEL.deja_inscrit, definitif: true };
  if (a.certId != null && cert?.id !== a.certId) {
    // Recyclage enregistré depuis (cert.ajouter, clôture d'une autre session) ou certification supprimée.
    const motif = cert && cert.obtenue >= a.le ? 'deja_certifie' : 'certification_remplacee';
    return { motif, texte: ISSUE_ATTENTE_LABEL[motif], definitif: true };
  }
  if (a.certId == null && cert && cert.obtenue >= a.le) return { motif: 'deja_certifie', texte: ISSUE_ATTENTE_LABEL.deja_certifie, definitif: true };
  // Session quittée par l'inscription (recyclage planifié ailleurs, formation initiale à replanifier) : elle ne compte pas
  // comme un conflit ; passée sans être clôturée, elle attend d'abord sa clôture (présence, résultat).
  const quittee = cert ? cert.sessionId : d.ds.inscriptions.find(i => i.empId === emp.id && d.session(i.sessionId)?.formation === s.formation)?.sessionId ?? null;
  const avant = d.session(quittee);
  if (avant && sessionActive(avant) && avant.date < d.ti) {
    return { motif: 'attend_cloture', texte: `session du ${fmt(parse(avant.date))} à clôturer d’abord`, definitif: false };
  }
  const conflit = blocage(conflitsSession(d, emp.id, s, { sessionId: quittee }));
  if (conflit) return { motif: 'conflit', texte: 'indisponible un jour de la session', definitif: false, detail: `${conflit.charAt(0).toLowerCase()}${conflit.slice(1)}` };
  return null;
}

/** Texte de la place dans la file : « 1er en liste d'attente », « 3e en liste d'attente ». */
export const placeTexte = (position: number | null | undefined) =>
  position ? `${position === 1 ? '1er' : `${position}e`} en liste d’attente` : 'en liste d’attente';

/**
 * Session souhaitée par une demande de formation, ouverte et à venir, sans place libre à proposer : son acceptation
 * demande un choix (liste d'attente ou plan de formation) quand la liste d'attente est activée. null sinon.
 */
export function sessionDemandeeComplete(d: Domain, r: Pick<DemandeCollab, 'type' | 'f' | 'sessionId'>): Session | null {
  if (r.type !== 'formation' || !r.f || !r.sessionId || !d.ds.settings.formationsListeAttente) return null;
  const s = d.session(r.sessionId);
  if (!s || s.formation !== r.f || !sessionActive(s) || s.date < d.ti) return null;
  return placesAProposer(s, d.ds.attentesSession ?? []) > 0 ? null : s;
}
