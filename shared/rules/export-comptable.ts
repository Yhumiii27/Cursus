// Fichier d'écritures pour la comptabilité (lot 11, chantier C5, notes de frais) : types du gabarit d'export, posés par le
// socle commun du lot 11 (S0) pour que les chantiers qui produisent des écritures partagent une même forme, sans se
// disputer la création du fichier. Le calcul des écritures, les réglages (Paramètres) et les gabarits proposés viennent
// avec le chantier, dans un bloc « // lot 11 — <module> ». Réponses du propriétaire (31 octobre 2026) : remboursement
// des frais avec la paie du mois suivant, plus un fichier d'écritures pour la comptabilité ; pas d'export comptable des
// versements OPCO (version simple). Le plan de comptes, le compte du salarié, le journal, le format d'import et les
// règles de TVA sont à fournir par la comptabilité : rien n'en est figé ici. Mêmes conventions que le fichier d'import
// Sage (FormatFichierPaie, shared/rules/lots-paie.ts) pour le séparateur, la décimale, l'encodage et les dates.
import type { Encodage } from '../encodage.ts';
import type { ISODate } from '../types.ts';

/** Une ligne d'écriture : un compte mouvementé au débit ou au crédit (l'autre montant à 0), en euros. */
export interface LigneEcriture {
  /** Code du journal comptable (fourni par la comptabilité). */
  journal: string;
  /** Date de l'écriture. */
  date: ISODate;
  /** Compte général. */
  compte: string;
  /** Compte auxiliaire (tiers : le salarié remboursé), ou null. */
  compteTiers: string | null;
  /** Référence de la pièce (numéro de la note ou de l'export). */
  piece: string;
  /** Libellé : générique pour une dépense médicale (jamais la nature de la dépense). */
  libelle: string;
  debit: number;
  credit: number;
}

export type ColonneEcriture = keyof LigneEcriture;

/** Gabarit du fichier d'écritures : colonnes dans l'ordre et forme du texte, comme FormatFichierPaie. */
export interface GabaritExportComptable {
  separateur: ';' | ',' | 'tab';
  colonnes: ColonneEcriture[];
  decimale: ',' | '.';
  entete: boolean;
  encodage: Encodage;
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ' | 'JJMMAAAA';
}
