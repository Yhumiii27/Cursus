// Fichier d'écritures des notes de frais pour la comptabilité (lot 11, chantier C5, étape 2), sur le gabarit commun du
// socle (shared/rules/export-comptable.ts). Réponse du propriétaire du 31 octobre 2026 : remboursement avec la paie du mois
// suivant, plus un fichier d'écritures pour la comptabilité ; pas de virement SEPA (question 2 : par la paie).
// Une note contrôlée (en paiement ou payée) donne une écriture équilibrée, datée du jour de son contrôle :
// - au débit, un compte de charge par catégorie (montant retenu moins la TVA récupérable), regroupé par compte ;
// - au débit, la TVA récupérable (shared/rules/frais-tva.ts), au prorata du montant retenu quand la dépense a été plafonnée ;
// - au crédit, le compte du salarié (421 par défaut), compte auxiliaire = son matricule de paie (matricule Cursus à défaut).
// Frais médicaux : compte générique (`compteDefaut`) et libellé de toutes les lignes identique (« NDF <n°> <nom> ») ; rien
// ne les distingue d'une dépense « divers » ni ne nomme la nature d'une dépense. Plan de comptes, compte du salarié et
// journal sont des valeurs par défaut à confirmer par la comptabilité (Paramètres → Notes de frais) : rien n'en est figé.
// Avances : versées et déduites par la paie, elles n'entrent pas dans ces écritures (à rapprocher dans la comptabilité).
import type { CategorieFrais, ISODate, LigneFrais, NoteFrais, Settings } from '../types.ts';
import { encoderTexte } from '../encodage.ts';
import { DECIMALES, ENCODAGES, FORMATS_DATE, SEPARATEURS, dateFichier } from './lots-paie.ts';
import type { ColonneEcriture, GabaritExportComptable, LigneEcriture } from './export-comptable.ts';
import { LISTE_CATEGORIES_FRAIS, ligneEnVigueur, montantRetenu, r2 } from './frais.ts';
import { tvaRecuperable } from './frais-tva.ts';

/**
 * Comptes de charge proposés par catégorie (plan comptable général, classe 625 : déplacements, missions et réceptions ;
 * 6061 : carburant ; 6135 : locations) ; null : le compte générique. `medical` n'a jamais de compte propre.
 */
export const COMPTES_FRAIS_DEFAUT: Record<CategorieFrais, string | null> = {
  repas: '6256', repas_affaires: '6257', hotel: '6256', train: '6251', avion: '6251', taxi: '6251', transport: '6251',
  carburant: '6061', peage: '6251', parking: '6251', location: '6135', ik: '6251', forfait: '6256', divers: null, medical: null,
};
/** Compte générique (dépenses diverses, frais médicaux), TVA déductible, compte du salarié et journal proposés. */
export const COMPTE_FRAIS_GENERIQUE = '6256';
export const COMPTE_TVA_DEDUCTIBLE = '44566';
export const COMPTE_SALARIE = '421';
export const JOURNAL_FRAIS = 'OD';

/** Compte comptable : chiffres et lettres majuscules, 13 caractères au plus. */
export const estCompte = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-Z]{1,13}$/.test(v);
/** Code de journal : 1 à 6 lettres majuscules ou chiffres. */
export const estJournal = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-Z]{1,6}$/.test(v);

/** Libellé des colonnes (écran du gabarit) et nom dans la ligne d'en-tête du fichier (sans accent). */
export const COLONNES_ECRITURE: Record<ColonneEcriture, { label: string; entete: string }> = {
  journal: { label: 'Journal', entete: 'journal' },
  date: { label: 'Date', entete: 'date' },
  compte: { label: 'Compte général', entete: 'compte' },
  compteTiers: { label: 'Compte auxiliaire (salarié)', entete: 'compte_tiers' },
  piece: { label: 'Pièce', entete: 'piece' },
  libelle: { label: 'Libellé', entete: 'libelle' },
  debit: { label: 'Débit', entete: 'debit' },
  credit: { label: 'Crédit', entete: 'credit' },
};
export const LISTE_COLONNES_ECRITURE = Object.keys(COLONNES_ECRITURE) as ColonneEcriture[];
/** Colonnes sans lesquelles une écriture ne s'importe pas. */
export const COLONNES_ECRITURE_OBLIGATOIRES: readonly ColonneEcriture[] = ['date', 'compte', 'debit', 'credit'];
/** Colonnes facultatives, cochées ou non dans Paramètres → Notes de frais (toutes par défaut). */
export const COLONNES_ECRITURE_FACULTATIVES = LISTE_COLONNES_ECRITURE.filter(c => !COLONNES_ECRITURE_OBLIGATOIRES.includes(c));

/** Gabarit proposé : point-virgule, virgule décimale, en-tête, UTF-8, dates JJ/MM/AAAA (comme le fichier de paie). */
export const GABARIT_FRAIS_DEFAUT: GabaritExportComptable = {
  separateur: ';', colonnes: [...LISTE_COLONNES_ECRITURE], decimale: ',', entete: true, encodage: 'utf-8', formatDate: 'JJ/MM/AAAA',
};

/**
 * Gabarit reçu de l'écran, contrôlé : valeurs des listes fermées, colonnes connues sans doublon dans l'ordre reçu, les
 * obligatoires présentes. Message d'erreur sinon.
 */
export function lireGabarit(v: unknown): GabaritExportComptable | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Gabarit du fichier d’écritures attendu';
  const p = v as Record<string, unknown>;
  const dans = <T extends string>(table: Record<T, unknown>, x: unknown): x is T => typeof x === 'string' && Object.hasOwn(table, x);
  if (!dans(SEPARATEURS, p.separateur)) return 'Séparateur inconnu';
  if (!dans(DECIMALES, p.decimale)) return 'Séparateur décimal inconnu';
  if (!dans(ENCODAGES, p.encodage)) return 'Encodage inconnu';
  if (!dans(FORMATS_DATE, p.formatDate)) return 'Format de date inconnu';
  if (!Array.isArray(p.colonnes)) return 'Colonnes du fichier attendues';
  const colonnes = [...new Set(p.colonnes.filter((c): c is ColonneEcriture => dans(COLONNES_ECRITURE, c)))];
  if (colonnes.length !== p.colonnes.length) return 'Colonne inconnue ou en double';
  const manque = COLONNES_ECRITURE_OBLIGATOIRES.filter(c => !colonnes.includes(c));
  if (manque.length) return `Colonnes obligatoires : ${manque.map(c => COLONNES_ECRITURE[c].label.toLowerCase()).join(', ')}`;
  return { separateur: p.separateur, colonnes, decimale: p.decimale, entete: !!p.entete, encodage: p.encodage, formatDate: p.formatDate };
}

/** Réglages des écritures (Paramètres → Notes de frais). */
export type ReglagesEcritures = Pick<Settings, 'fraisComptes' | 'fraisCompteGenerique' | 'fraisCompteTva' | 'fraisCompteSalarie' | 'fraisJournal'>;

/** Compte de charge d'une catégorie : réglé, sinon celui proposé, sinon le générique ; frais médicaux : toujours le générique. */
export function compteDeCharge(c: CategorieFrais, r: ReglagesEcritures): string {
  if (c === 'medical') return r.fraisCompteGenerique;
  return r.fraisComptes[c] || COMPTES_FRAIS_DEFAUT[c] || r.fraisCompteGenerique;
}

/** Comptes réglés par catégorie, contrôlés (Paramètres) : catégories connues hors `medical`, comptes valides ; vide : proposé. */
export function lireComptes(v: unknown): Partial<Record<CategorieFrais, string>> | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Comptes par catégorie attendus';
  const out: Partial<Record<CategorieFrais, string>> = {};
  for (const c of LISTE_CATEGORIES_FRAIS) {
    const x = (v as Record<string, unknown>)[c];
    if (x === undefined || x === null || x === '' || c === 'medical') continue;
    const compte = String(x).trim().toUpperCase();
    if (!estCompte(compte)) return 'Compte comptable : chiffres et lettres, 13 caractères au plus';
    out[c] = compte;
  }
  return out;
}

/** Salarié d'une note, tel qu'il paraît dans l'écriture. */
export interface TitulaireNote { nom: string; compteTiers: string }

/** TVA récupérable d'une ligne au prorata du montant retenu (dépense ramenée au plafond). */
export function tvaRetenue(l: LigneFrais): number {
  const tva = tvaRecuperable(l), retenu = montantRetenu(l);
  if (!tva || !retenu || !l.montantEur) return 0;
  return r2(Math.min(tva, tva * retenu / l.montantEur));
}

/** Date de l'écriture d'une note : jour de son contrôle, sinon `defaut` (jour de l'export). */
export const dateEcriture = (n: Pick<NoteFrais, 'controleeLe'>, defaut: ISODate): ISODate => (n.controleeLe ? n.controleeLe.slice(0, 10) : defaut);

/**
 * Écriture d'une note : débits par compte de charge (ordre des comptes), TVA, crédit du salarié. Aucune ligne si rien
 * n'est retenu (dépenses toutes refusées). Montants en euros au centime ; débits et crédit égaux.
 */
export function ecrituresNote(n: NoteFrais, lignes: readonly LigneFrais[], t: TitulaireNote, r: ReglagesEcritures, date: ISODate): LigneEcriture[] {
  const charges = new Map<string, number>();
  let tva = 0, total = 0;
  for (const l of lignes) {
    if (l.noteId !== n.id || !ligneEnVigueur(l)) continue;
    const retenu = montantRetenu(l);
    if (!retenu) continue;
    const t2 = tvaRetenue(l);
    const compte = compteDeCharge(l.categorie, r);
    charges.set(compte, r2((charges.get(compte) ?? 0) + retenu - t2));
    tva = r2(tva + t2);
    total = r2(total + retenu);
  }
  if (!total) return [];
  const commun = { journal: r.fraisJournal, date, piece: `NDF-${n.id}`, libelle: `NDF ${n.id} ${t.nom}`.slice(0, 60) };
  const out: LigneEcriture[] = [...charges.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([compte, debit]) => ({ ...commun, compte, compteTiers: null, debit, credit: 0 }));
  if (tva) out.push({ ...commun, compte: r.fraisCompteTva, compteTiers: null, debit: tva, credit: 0 });
  out.push({ ...commun, compte: r.fraisCompteSalarie, compteTiers: t.compteTiers, debit: 0, credit: total });
  return out;
}

/** Statuts d'une note qui entre dans un export : contrôlée, en paiement ou payée. */
export const STATUTS_EXPORTABLES: readonly NoteFrais['statut'][] = ['controlee', 'en_paiement', 'payee'];

/** Export enregistré (table exportsFrais, hors de l'instantané) : notes emportées et annulation. */
export interface ExportFraisResume { id: number; notes: readonly number[] | null; annuleLe: string | null }

/** Notes déjà emportées par un export non annulé. */
export const notesExportees = (exports: readonly ExportFraisResume[]) => new Set(exports.filter(e => !e.annuleLe).flatMap(e => e.notes ?? []));

/** Notes à exporter : contrôlées, en paiement ou payées, pas encore dans un export en vigueur, dans l'ordre des identifiants. */
export function notesAExporter<N extends Pick<NoteFrais, 'id' | 'statut'>>(notes: readonly N[], exports: readonly ExportFraisResume[]): N[] {
  const deja = notesExportees(exports);
  return notes.filter(n => STATUTS_EXPORTABLES.includes(n.statut) && !deja.has(n.id)).sort((a, b) => a.id - b.id);
}

/** Totaux d'écritures : nombre, débit et crédit (égaux pour des écritures équilibrées). */
export function totauxEcritures(lignes: readonly LigneEcriture[]) {
  let debit = 0, credit = 0;
  for (const l of lignes) { debit = r2(debit + l.debit); credit = r2(credit + l.credit); }
  return { ecritures: lignes.length, debit, credit };
}

/** Texte du fichier d'écritures au gabarit (fin de ligne CRLF, cellules entre guillemets au besoin). */
export function fichierEcritures(lignes: readonly LigneEcriture[], g: GabaritExportComptable = GABARIT_FRAIS_DEFAUT): string {
  const sep = g.separateur === 'tab' ? '\t' : g.separateur;
  const cellule = (s: string) => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const montant = (n: number) => n.toFixed(2).replace('.', g.decimale);
  const valeur = (l: LigneEcriture, c: ColonneEcriture): string => {
    switch (c) {
      case 'date': return dateFichier(l.date, g.formatDate);
      case 'debit': case 'credit': return montant(l[c]);
      case 'compteTiers': return l.compteTiers ?? '';
      default: return l[c];
    }
  };
  const rows = lignes.map(l => g.colonnes.map(c => cellule(valeur(l, c))).join(sep));
  return [...(g.entete ? [g.colonnes.map(c => COLONNES_ECRITURE[c].entete).join(sep)] : []), ...rows].join('\r\n') + '\r\n';
}

/** Octets du fichier, dans l'encodage du gabarit. */
export const octetsEcritures = (texte: string, g: Pick<GabaritExportComptable, 'encodage'>) => encoderTexte(texte, g.encodage);

/** Nom du fichier téléchargé : `ecritures-frais-<n°>.csv` (`.txt` avec la tabulation). */
export const nomFichierEcritures = (id: number, g: Pick<GabaritExportComptable, 'separateur'>) => `ecritures-frais-${id}.${g.separateur === 'tab' ? 'txt' : 'csv'}`;
