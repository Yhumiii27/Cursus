// Notes de frais dans l'instantané envoyé au navigateur (lot 11, chantier C5), appelé par server/src/dataset.ts :
// - manager : filtre propre aux frais, jamais `scopeIds` (relecture critique du lot 11) — notes, lignes, véhicules et
//   avances de son équipe directe et des salariés dont il valide les frais par délégation (périmètre « frais »), plus les
//   siens ; ni consultation N+2, ni suppléant d'un autre périmètre ; jamais une note médicale d'un autre ni ses lignes ;
//   justificatifs de ces notes (jamais une pièce de frais médicaux) ;
// - collaborateur : les siens ;
// - profils restreints : la paie reçoit les notes contrôlées, en paiement ou payées, sans leurs lignes (le détail des
//   remboursements part dans le lot), et les avances validées ou versées ; le référent HSE et la lecture seule, rien
//   (tableaux de bord agrégés à l'étape 2) ;
// - comptabilité (droit « compta » seul) : branche propre (`vueComptabilite`) — référentiels, annuaire, réglages, notes,
//   lignes (frais médicaux compris), véhicules, avances et justificatifs des frais ; aucun dossier du personnel, aucune
//   absence, aucune donnée de santé hors des lignes de frais médicaux.
import type { CurrentUser, Dataset, NoteFrais } from '../../shared/types.ts';
import { estObjetFrais } from '../../shared/rules/pieces.ts';

/** Notes de frais vues par un manager ou un collaborateur : les siennes, et celles des salariés `idsFrais` sans les notes médicales. */
export function fraisVueSalarie(full: Dataset, user: CurrentUser, idsFrais: ReadonlySet<number>): Pick<Dataset, 'notesFrais' | 'lignesFrais' | 'vehiculesPerso' | 'avancesFrais'> {
  const moi = user.empId;
  const voit = (empId: number) => empId === moi || idsFrais.has(empId);
  const notes = (full.notesFrais ?? []).filter(n => n.empId === moi || (idsFrais.has(n.empId) && !n.medicale));
  // Ligne par salarié : celle d'une note reçue, du même salarié (une ligne d'un autre salarié ne change jamais la vue).
  const parId = new Map(notes.map(n => [n.id, n]));
  return {
    notesFrais: notes,
    lignesFrais: (full.lignesFrais ?? []).filter(l => parId.get(l.noteId)?.empId === l.empId),
    vehiculesPerso: (full.vehiculesPerso ?? []).filter(v => voit(v.empId)),
    avancesFrais: (full.avancesFrais ?? []).filter(a => voit(a.empId)),
  };
}

/** Justificatifs de frais d'un manager : ceux des salariés `idsFrais` (hors les siens, déjà reçus), jamais une pièce médicale. */
export function piecesFraisManager(full: Dataset, user: CurrentUser, idsFrais: ReadonlySet<number>): NonNullable<Dataset['pieces']> {
  if (user.role !== 'manager') return [];
  return (full.pieces ?? []).filter(p => p.empId !== user.empId && idsFrais.has(p.empId) && !p.retireeLe && (p.objet === 'ligneFrais' || p.objet === 'vehiculePerso'))
    .map(p => ({ ...p, empreinte: null }));
}

/** Statuts que la paie reçoit : notes contrôlées, en paiement ou payées. */
const POUR_LA_PAIE: readonly NoteFrais['statut'][] = ['controlee', 'en_paiement', 'payee'];

/** Notes de frais d'un profil restreint de l'espace RH autre que la comptabilité (paie, référent HSE, lecture seule). */
export function fraisVueProfil(full: Dataset, paie: boolean): Pick<Dataset, 'notesFrais' | 'lignesFrais' | 'vehiculesPerso' | 'avancesFrais'> {
  if (!paie) return { notesFrais: [], lignesFrais: [], vehiculesPerso: [], avancesFrais: [] };
  return {
    // Sans le motif d'un renvoi ou d'une annulation (textes libres) ; une note médicale n'y est qu'un remboursement : ni
    // l'indicateur, ni les dates et auteurs du circuit, qui la trahiraient (validation du manager absente pour un salarié
    // qui a un manager). La paie n'en a pas l'usage : statut, lot et date de paiement lui suffisent.
    notesFrais: (full.notesFrais ?? []).filter(n => POUR_LA_PAIE.includes(n.statut)).map(n => ({
      ...n, renvoiMotif: null, annuleMotif: null, medicale: false,
      soumiseLe: null, valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null,
    })),
    lignesFrais: [],
    vehiculesPerso: [],
    avancesFrais: (full.avancesFrais ?? []).filter(a => a.statut === 'validee' || a.statut === 'en_paiement' || a.statut === 'versee').map(a => ({ ...a, refusMotif: null })),
  };
}

/**
 * Instantané du profil « Comptabilité » (droit « compta » seul) : liste blanche de champs. Les champs obligatoires du
 * Dataset sans objet pour ce profil sont vides ; les autres sont absents.
 */
export function vueComptabilite(full: Dataset): Dataset {
  const r = full.referentiels;
  return {
    today: full.today, revision: full.revision, user: full.user, settings: full.settings,
    // Destinations (devise du pays), projets et chantiers (imputation) ; ni postes, ni équipes et leurs exigences.
    referentiels: {
      formations: [], habilitations: [], destinations: r.destinations, postes: [], equipes: [], horaires: [], projets: r.projets,
      chantiers: r.chantiers.map(c => ({ ...c, ressources: [], habs: [], certs: [] })), baremesKm: r.baremesKm, forfaitsFrais: r.forfaitsFrais, tauxDevises: r.tauxDevises,
    },
    // Annuaire (nom, équipe, poste), déjà transmis à toute personne connectée : le nom des salariés des notes.
    annuaire: full.annuaire,
    employes: [], sessions: [], inscriptions: [], participations: [], plan: [], budgets: {}, exercicesClos: [], voyages: [], demandesKeystone: [],
    missions: [], taches: [], feuilles: [], absences: [], cet: [], reports: [], soldesReprise: [], clotures: [], entretiens: [], demandesCollab: [],
    demandesVisite: [], debutSaisieFeuilles: null, lotsPaie: [], formatFichierPaie: null, rubriquesPaie: [], messagerie: null, releves: [], reprises: [],
    calendrierFeries: full.calendrierFeries && Object.fromEntries(Object.entries(full.calendrierFeries).map(([annee, x]) => [annee, { ...x, motif: null }])),
    notesFrais: full.notesFrais ?? [],
    lignesFrais: full.lignesFrais ?? [],
    vehiculesPerso: full.vehiculesPerso ?? [],
    avancesFrais: full.avancesFrais ?? [],
    // Justificatifs des frais, frais médicaux compris, sans l'empreinte (service RH seulement, comme pour les autres).
    pieces: (full.pieces ?? []).filter(p => estObjetFrais(p.objet) && !p.retireeLe).map(p => ({ ...p, empreinte: null })),
  };
}
