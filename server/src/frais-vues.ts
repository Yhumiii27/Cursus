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
// Alertes des notes en circuit (`alertesFrais`, relecture de l'étape 2) : calculées ici sur l'instantané complet, pour
// que ces vues montrent celles que le serveur applique (chantiers en grand déplacement, absences, empreintes des
// justificatifs leur manquent) ; le texte d'une alerte ne dit ni la nature d'une absence ni à qui est un doublon.
import { Domain } from '../../shared/domain.ts';
import type { CurrentUser, Dataset, LigneFrais, NoteFrais, Piece } from '../../shared/types.ts';
import { alertesDesNotes } from '../../shared/rules/frais-alertes.ts';
import { estObjetFrais } from '../../shared/rules/pieces.ts';

// lot 12 — C2 (notes de frais : activation) : règles de projection par ligne, communes à l'instantané (ci-dessous) et à la
// route d'historique (server/src/frais-historique.ts), qui les applique aux notes lues en base : une seule définition de
// ce que chacun voit des frais.

/** Notes d'un manager ou d'un collaborateur `moi` : les siennes, et celles des salariés `idsFrais` sans les notes médicales. */
export const notesVuesSalarie = <N extends Pick<NoteFrais, 'empId' | 'medicale'>>(notes: readonly N[], moi: number | null | undefined, idsFrais: ReadonlySet<number>): N[] =>
  notes.filter(n => n.empId === moi || (idsFrais.has(n.empId) && !n.medicale));

/** Lignes des notes reçues, du même salarié que leur note (une ligne d'un autre salarié ne change jamais la vue). */
export function lignesDesNotes<L extends Pick<LigneFrais, 'noteId' | 'empId'>>(lignes: readonly L[], notes: readonly Pick<NoteFrais, 'id' | 'empId'>[]): L[] {
  const parId = new Map(notes.map(n => [n.id, n]));
  return lignes.filter(l => parId.get(l.noteId)?.empId === l.empId);
}

/**
 * Justificatifs de frais d'un manager : ceux des salariés `idsFrais` (hors les siens), jamais une pièce médicale ; sans
 * l'empreinte. Ses propres pièces lui viennent par `piecesVisibles` (server/src/pieces.ts).
 */
export const piecesFraisDeManager = (pieces: readonly Piece[], moi: number | null | undefined, idsFrais: ReadonlySet<number>): Piece[] =>
  pieces.filter(p => p.empId != null && p.empId !== moi && idsFrais.has(p.empId) && !p.retireeLe && (p.objet === 'ligneFrais' || p.objet === 'vehiculePerso'))
    .map(p => ({ ...p, empreinte: null }));

/** Statuts que la paie reçoit : notes contrôlées, en paiement ou payées. */
export const POUR_LA_PAIE: readonly NoteFrais['statut'][] = ['controlee', 'en_paiement', 'payee'];

/**
 * Notes reçues par la paie : contrôlées, en paiement ou payées, sans le motif d'un renvoi ou d'une annulation (textes
 * libres) ; une note médicale n'y est qu'un remboursement : ni l'indicateur, ni les dates et auteurs du circuit, qui la
 * trahiraient (validation du manager absente pour un salarié qui a un manager). La paie n'en a pas l'usage : statut, lot
 * et date de paiement lui suffisent. Jamais leurs lignes.
 */
export const notesPourLaPaie = (notes: readonly NoteFrais[]): NoteFrais[] => notes.filter(n => POUR_LA_PAIE.includes(n.statut)).map(n => ({
  ...n, renvoiMotif: null, annuleMotif: null, medicale: false,
  soumiseLe: null, valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null,
}));

/** Justificatifs de frais de la comptabilité : frais médicaux compris, en vigueur, sans l'empreinte (service RH seulement). */
export const piecesFraisComptabilite = (pieces: readonly Piece[]): Piece[] => pieces.filter(p => estObjetFrais(p.objet) && !p.retireeLe).map(p => ({ ...p, empreinte: null }));

/**
 * Notes de frais vues par un manager ou un collaborateur : les siennes, et celles des salariés `idsFrais` sans les notes
 * médicales ; `d` : domaine de l'instantané complet (alertes).
 */
export function fraisVueSalarie(full: Dataset, d: Domain, user: CurrentUser, idsFrais: ReadonlySet<number>): Pick<Dataset, 'notesFrais' | 'lignesFrais' | 'vehiculesPerso' | 'avancesFrais' | 'alertesFrais'> {
  const moi = user.empId;
  const voit = (empId: number) => empId === moi || idsFrais.has(empId);
  const notes = notesVuesSalarie(full.notesFrais ?? [], moi, idsFrais);
  const lignes = lignesDesNotes(full.lignesFrais ?? [], notes);
  return {
    notesFrais: notes,
    lignesFrais: lignes,
    vehiculesPerso: (full.vehiculesPerso ?? []).filter(v => voit(v.empId)),
    avancesFrais: (full.avancesFrais ?? []).filter(a => voit(a.empId)),
    alertesFrais: alertesDesNotes(d, notes, lignes),
  };
}

/** Justificatifs de frais d'un manager : ceux des salariés `idsFrais` (hors les siens, déjà reçus), jamais une pièce médicale. */
export function piecesFraisManager(full: Dataset, user: CurrentUser, idsFrais: ReadonlySet<number>): NonNullable<Dataset['pieces']> {
  if (user.role !== 'manager') return [];
  return piecesFraisDeManager(full.pieces ?? [], user.empId, idsFrais);
}

/** Notes de frais d'un profil restreint de l'espace RH autre que la comptabilité (paie, référent HSE, lecture seule). */
export function fraisVueProfil(full: Dataset, paie: boolean): Pick<Dataset, 'notesFrais' | 'lignesFrais' | 'vehiculesPerso' | 'avancesFrais'> {
  if (!paie) return { notesFrais: [], lignesFrais: [], vehiculesPerso: [], avancesFrais: [] };
  return {
    notesFrais: notesPourLaPaie(full.notesFrais ?? []),
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
    alertesFrais: alertesDesNotes(new Domain(full), full.notesFrais ?? [], full.lignesFrais ?? []),
    // Justificatifs des frais, frais médicaux compris, sans l'empreinte (service RH seulement, comme pour les autres).
    pieces: piecesFraisComptabilite(full.pieces ?? []),
  };
}
