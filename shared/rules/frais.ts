// Notes de frais (lot 11, chantier C5) : catégories, statuts et circuit, montants et totaux (calculés, jamais stockés),
// doublons, frais médicaux isolés. Partagé par les actions (server/src/actions/frais.ts), la paie (server/src/frais-paie.ts),
// l'instantané (server/src/dataset.ts) et les écrans de l'étape 2.
// Réponses du propriétaire du 31 octobre 2026 : Cursus porte tout le module ; remboursement avec la paie du mois suivant ;
// contrôle après le manager par le profil « Comptabilité », qui voit aussi les frais médicaux.
// - Circuit : brouillon → soumise → validée (manager, ou son suppléant au périmètre « frais ») → contrôlée (comptabilité
//   ou service RH) → en paiement (lot de paie) → payée (import confirmé). Renvoi pour correction (« à corriger », motif
//   jamais recopié au journal) ; annulation avant le paiement. Le manager sans valideur (aucun N+1) et la note médicale
//   passent d'emblée à « validée », en attente du contrôle. Circuit réglé « manager » : la validation vaut contrôle.
// - Frais médicaux (vaccin, pharmacie, consultation en mission) : catégorie `medical`, dans une note séparée
//   (`medicale`), qui ne contient que cette catégorie ; jamais vue du manager, exclue de ses totaux, compteurs et tableaux
//   de bord ; au journal, la catégorie devient « divers » (`categorieJournal`).
// - Montant retenu d'une ligne : montant en euros, ou montant ramené au plafond de la politique (`montantRetenu`) ; une
//   ligne refusée au contrôle ne compte plus.
// - Doublons : même empreinte de justificatif (SHA-256 de la pièce) sur deux lignes, ou même (salarié, date, montant,
//   commerçant) dans deux lignes en vigueur.
import type { CategorieFrais, LigneFrais, NoteFrais, StatutNoteFrais } from '../types.ts';

/** Arrondi au centime. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Catégories, dans l'ordre de l'écran : libellé, nature (pour le cumul avec les forfaits de grand déplacement), justificatif
 * exigé (une indemnité kilométrique ou une allocation forfaitaire n'en demande pas).
 */
export const CATEGORIES_FRAIS: Record<CategorieFrais, { label: string; nature: 'repas' | 'logement' | 'transport' | 'vehicule' | 'autre'; justificatif: boolean }> = {
  repas: { label: 'Repas', nature: 'repas', justificatif: true },
  repas_affaires: { label: 'Repas d’affaires (invités)', nature: 'repas', justificatif: true },
  hotel: { label: 'Hôtel', nature: 'logement', justificatif: true },
  train: { label: 'Train', nature: 'transport', justificatif: true },
  avion: { label: 'Avion', nature: 'transport', justificatif: true },
  taxi: { label: 'Taxi ou VTC', nature: 'transport', justificatif: true },
  transport: { label: 'Transports en commun', nature: 'transport', justificatif: true },
  carburant: { label: 'Carburant', nature: 'vehicule', justificatif: true },
  peage: { label: 'Péage', nature: 'vehicule', justificatif: true },
  parking: { label: 'Parking', nature: 'vehicule', justificatif: true },
  location: { label: 'Location de véhicule', nature: 'vehicule', justificatif: true },
  ik: { label: 'Indemnités kilométriques', nature: 'vehicule', justificatif: false },
  forfait: { label: 'Allocation forfaitaire', nature: 'autre', justificatif: false },
  divers: { label: 'Divers', nature: 'autre', justificatif: true },
  medical: { label: 'Frais médicaux en mission', nature: 'autre', justificatif: true },
};
export const LISTE_CATEGORIES_FRAIS = Object.keys(CATEGORIES_FRAIS) as CategorieFrais[];
export const estCategorieFrais = (v: unknown): v is CategorieFrais => typeof v === 'string' && Object.hasOwn(CATEGORIES_FRAIS, v);

/**
 * Catégorie recopiée au journal, dans un message ou un export : jamais « medical » (donnée de santé), remplacée par
 * « divers », une catégorie réelle : une valeur propre aux frais médicaux (« autre ») les désignerait (relecture du lot 11).
 */
export const categorieJournal = (c: CategorieFrais): CategorieFrais => (c === 'medical' ? 'divers' : c);

export const STATUTS_NOTE_FRAIS: Record<StatutNoteFrais, { label: string; cls: string }> = {
  brouillon: { label: 'Brouillon', cls: 'tag-outline' },
  soumise: { label: 'À valider', cls: 'tag-accent' },
  a_corriger: { label: 'À corriger', cls: 'tag-accent' },
  validee: { label: 'À contrôler', cls: 'tag-accent' },
  controlee: { label: 'Contrôlée, en attente de paie', cls: 'tag-neutral' },
  en_paiement: { label: 'En paiement', cls: 'tag-neutral' },
  payee: { label: 'Payée', cls: 'tag-neutral' },
  annulee: { label: 'Annulée', cls: 'tag-outline' },
};

/** Transitions admises, par statut de départ (l'action contrôle en plus les droits). */
export const TRANSITIONS_NOTE: Record<StatutNoteFrais, readonly StatutNoteFrais[]> = {
  brouillon: ['soumise', 'validee', 'annulee'],
  a_corriger: ['soumise', 'validee', 'annulee'],
  soumise: ['validee', 'controlee', 'a_corriger', 'annulee'],
  validee: ['controlee', 'a_corriger', 'annulee'],
  controlee: ['en_paiement', 'a_corriger', 'annulee'],
  en_paiement: ['payee', 'controlee'],
  payee: [],
  annulee: [],
};
export const transitionPermise = (de: StatutNoteFrais, vers: StatutNoteFrais) => TRANSITIONS_NOTE[de].includes(vers);

/** Note dont les lignes se saisissent encore (brouillon, ou renvoyée pour correction). */
export const noteModifiable = (n: Pick<NoteFrais, 'statut'>) => n.statut === 'brouillon' || n.statut === 'a_corriger';
/** Note soumise : ses justificatifs sont scellés et ne se retirent plus (pièce immuable après soumission). */
export const noteSoumise = (n: Pick<NoteFrais, 'statut'>) => !noteModifiable(n) && n.statut !== 'annulee';
/** Note réglée ou en cours de paiement : elle ne s'annule plus ni ne repart. */
export const notePayee = (n: Pick<NoteFrais, 'statut'>) => n.statut === 'en_paiement' || n.statut === 'payee';

/**
 * Statut d'une note qu'on soumet : « validée » d'emblée (en attente du contrôle) pour une note médicale, qui ne passe
 * jamais par le manager, et pour un salarié sans valideur (manager sans N+1, `valideur` 0) ; sinon « soumise ».
 */
export const statutASoumission = (n: Pick<NoteFrais, 'medicale'>, valideur: number): StatutNoteFrais => (n.medicale || !valideur ? 'validee' : 'soumise');

/** Statut après la validation du manager : « contrôlée » d'office quand le circuit ne prévoit pas de contrôle. */
export const statutApresValidation = (circuit: 'manager_controle' | 'manager'): StatutNoteFrais => (circuit === 'manager' ? 'controlee' : 'validee');

/** Contrôle d'une ligne pour sa note : une note médicale ne porte que des frais médicaux, une autre jamais. */
export function erreurCategoriePourNote(n: Pick<NoteFrais, 'medicale'>, c: CategorieFrais): string | null {
  if (n.medicale && c !== 'medical') return 'Une note de frais médicaux ne contient que des frais médicaux : créez une autre note pour cette dépense';
  if (!n.medicale && c === 'medical') return 'Les frais médicaux forment une note séparée, contrôlée sans passer par le manager : créez une note de frais médicaux';
  return null;
}

// — Montants —

/** Montant en euros d'une dépense : euros tels quels ; autre devise : montant × taux saisi (null : taux manquant). */
export function enEuros(montant: number, devise: string, taux: number | null | undefined): number | null {
  if (devise === 'EUR') return r2(montant);
  return taux && taux > 0 ? r2(montant * taux) : null;
}

/** Ligne qui compte dans les totaux : ni refusée au contrôle. */
export const ligneEnVigueur = (l: Pick<LigneFrais, 'refuseeLe'>) => !l.refuseeLe;

/** Montant retenu d'une ligne, en euros : plafonné par la politique s'il l'a été, nul pour une ligne refusée. */
export const montantRetenu = (l: Pick<LigneFrais, 'refuseeLe' | 'montantEur' | 'montantRetenu'>) => (ligneEnVigueur(l) ? r2(l.montantRetenu ?? l.montantEur) : 0);

/** Totaux d'une note, calculés sur ses lignes : nombre de lignes en vigueur, montant demandé et montant retenu (euros). */
export interface TotauxNote { lignes: number; refusees: number; demande: number; retenu: number }
export function totauxNote(lignes: readonly Pick<LigneFrais, 'refuseeLe' | 'montantEur' | 'montantRetenu'>[]): TotauxNote {
  let demande = 0, retenu = 0, refusees = 0;
  for (const l of lignes) {
    if (!ligneEnVigueur(l)) { refusees++; continue; }
    demande += l.montantEur;
    retenu += montantRetenu(l);
  }
  return { lignes: lignes.length - refusees, refusees, demande: r2(demande), retenu: r2(retenu) };
}

/** Lignes d'une note, dans l'ordre de la table. */
export const lignesDe = <L extends Pick<LigneFrais, 'noteId'>>(lignes: readonly L[] | undefined, noteId: number) => (lignes ?? []).filter(l => l.noteId === noteId);

/**
 * Totaux montrés au manager (écran de l'équipe, tableau de bord) : notes non médicales seulement, quelle que soit la note
 * reçue — une note médicale ne lui est jamais transmise, et ses montants ne doivent pas se déduire par différence.
 */
export function totauxEquipe(notes: readonly Pick<NoteFrais, 'id' | 'medicale' | 'statut'>[], lignes: readonly Pick<LigneFrais, 'noteId' | 'refuseeLe' | 'montantEur' | 'montantRetenu'>[]) {
  const ids = new Set(notes.filter(n => !n.medicale && n.statut !== 'annulee').map(n => n.id));
  return { notes: ids.size, ...totauxNote(lignes.filter(l => ids.has(l.noteId))) };
}

// — Doublons —

/** Commerçant ramené à une forme comparable : minuscules, sans accent ni ponctuation, espaces réduits. */
export const commercantNormalise = (c: string | null | undefined) =>
  (c ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Clé de doublon d'une ligne : salarié, date, montant au centime (euros) et commerçant. */
export const cleDoublon = (l: Pick<LigneFrais, 'empId' | 'date' | 'montantEur' | 'commercant'>) =>
  `${l.empId}|${l.date}|${r2(l.montantEur).toFixed(2)}|${commercantNormalise(l.commercant)}`;

/**
 * Lignes en vigueur d'autres notes non annulées (ou de la même) qui doublonnent `l` : même clé (salarié, date, montant,
 * commerçant). Une indemnité kilométrique ou une allocation forfaitaire n'a pas de commerçant : seule la même clé compte.
 */
export function doublonsDe(l: Pick<LigneFrais, 'id' | 'empId' | 'date' | 'montantEur' | 'commercant'>, lignes: readonly LigneFrais[], notes: readonly Pick<NoteFrais, 'id' | 'statut'>[]): number[] {
  const annulees = new Set(notes.filter(n => n.statut === 'annulee').map(n => n.id));
  const cle = cleDoublon(l);
  return lignes.filter(x => x.id !== l.id && ligneEnVigueur(x) && !annulees.has(x.noteId) && cleDoublon(x) === cle).map(x => x.id);
}

/**
 * lot 12 — C2 (notes de frais : activation) : `doublonsDe` pour plusieurs lignes, sur les mêmes `lignes` et `notes`, en un
 * seul parcours (index par clé de doublon) : mêmes identifiants, dans le même ordre. Les alertes d'une vue (toutes les
 * lignes en circuit contre toutes les lignes de l'instantané) coûtaient un parcours complet par ligne (essai de charge du
 * lot 12 : vue d'un manager de 10 s sur 3 ans de frais).
 */
export function indexDoublons(lignes: readonly LigneFrais[], notes: readonly Pick<NoteFrais, 'id' | 'statut'>[]): (l: Pick<LigneFrais, 'id' | 'empId' | 'date' | 'montantEur' | 'commercant'>) => number[] {
  const annulees = new Set(notes.filter(n => n.statut === 'annulee').map(n => n.id));
  const par = new Map<string, number[]>();
  for (const x of lignes) {
    if (!ligneEnVigueur(x) || annulees.has(x.noteId)) continue;
    const k = cleDoublon(x), g = par.get(k);
    if (g) g.push(x.id);
    else par.set(k, [x.id]);
  }
  return l => (par.get(cleDoublon(l)) ?? []).filter(id => id !== l.id);
}

/**
 * Doublons par empreinte : pour chaque empreinte de justificatif portée par plusieurs lignes, la liste de ces lignes
 * (le même reçu photographié deux fois). `pieces` : empreinte et ligne de chaque justificatif en vigueur.
 */
export function doublonsEmpreinte(pieces: readonly { ligneId: number; empreinte: string | null | undefined }[]): number[][] {
  const par = new Map<string, Set<number>>();
  for (const p of pieces) {
    if (!p.empreinte) continue;
    const g = par.get(p.empreinte) ?? new Set<number>();
    g.add(p.ligneId);
    par.set(p.empreinte, g);
  }
  return [...par.values()].filter(g => g.size > 1).map(g => [...g].sort((a, b) => a - b));
}

/** Période d'une note : mois AAAA-MM valide. */
export const estPeriodeFrais = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Code de devise ISO 4217 : trois lettres majuscules. */
export const estDevise = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
