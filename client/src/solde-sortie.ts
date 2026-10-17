// Solde de sortie d'un salarié (t128) : état imprimable et export CSV, depuis la section Sortie de la fiche
// (components/SoldeSortie.tsx). Mêmes lignes que l'écran (`lignesEtat` de shared/rules/solde-sortie.ts) ; quantités au
// centième, jours (récupération en heures) ; rubrique de sortie et état de la transmission à la paie. Le montant de
// l'indemnité n'y figure pas : Sage le calcule. Jamais de donnée de santé (aucune absence n'est citée). Impression et
// téléchargement (components/SoldeSortie.tsx) sont signalés au journal (`printDocument`, `downloadCsv` de print.ts).
// Module sans React ni feuille d'impression : tests/solde-sortie.test.ts.
import { MOTIFS_SORTIE } from '../../shared/rules/contrats.ts';
import type { Domain } from '../../shared/domain.ts';
import { fmtIso, matricule } from '../../shared/format.ts';
import { rubriquesPaie } from '../../shared/rules/paie.ts';
import { etatTransmission, lignesEtat, photographieTexte, quantiteTexte } from '../../shared/rules/solde-sortie.ts';
import type { Employe, EtatSortie, SoldeSortie } from '../../shared/types.ts';
import { MENTION_SOLDES, nombre, type ListeCsv } from './listes-csv.ts';
import type { PrintSection } from './print.ts';

/** Solde affiché : celui photographié à l'enregistrement, ou, à défaut (sortie d'avant t128), le calcul du jour. */
export interface SoldeAffiche { etat: EtatSortie; solde: SoldeSortie | null }

/** Source du solde, en clair : photographie (date, auteur) et transmission, ou calcul du jour non photographié. */
export function sourceSolde(d: Domain, x: SoldeAffiche): string {
  if (!x.solde) return `Calculé le ${fmtIso(d.ti)}, non photographié : modifiez la sortie pour le photographier`;
  return `${photographieTexte(x.solde)} · ${etatTransmission(x.solde, rubriquesPaie(d.ds.rubriquesPaie), d.ti, d.ds.settings.clotureJour)}`;
}

const cellule = (n: number | null, unite: 'j' | 'h') => (n == null ? '' : quantiteTexte(n, unite));

/**
 * Export CSV : une ligne par compteur (droit ou acquis, pris, posés, solde, rubrique de sortie), avec la date de
 * sortie, la source du solde et la mention des soldes calculés par Cursus.
 */
export function csvSoldeSortie(d: Domain, e: Employe, x: SoldeAffiche): ListeCsv {
  const jma = x.etat.date.split('-').reverse().join('/');
  return {
    fichier: `solde-sortie-${matricule(e.id)}-${x.etat.date}.csv`,
    head: ['Collaborateur', 'Matricule', 'Matricule de paie', 'Date de sortie', 'Compteur', 'Unité', 'Droit ou acquis', 'Pris', 'Posés', 'Solde', 'Rubrique de paie', 'Source'],
    rows: lignesEtat(x.etat).map(l => [
      e.nom, matricule(e.id), e.matriculePaie ?? '', jma, l.libelle, l.unite === 'h' ? 'heures' : 'jours',
      l.droit == null ? '' : nombre(l.droit), l.pris == null ? '' : nombre(l.pris), l.poses == null ? '' : nombre(l.poses), nombre(l.solde),
      l.rubrique ?? '', `${MENTION_SOLDES} · ${sourceSolde(d, x)}`,
    ]),
  };
}

/** Sections de l'état imprimé : contrat et sortie, compteurs, points à voir, transmission à la paie. */
export function sectionsSoldeSortie(d: Domain, e: Employe, x: SoldeAffiche): PrintSection[] {
  const lignes = lignesEtat(x.etat);
  return [
    {
      title: 'Sortie',
      rows: [
        ['Dernier jour du contrat', fmtIso(x.etat.date)],
        ...(e.motifSortie ? [['Motif', MOTIFS_SORTIE[e.motifSortie]] as [string, string]] : []),
        ['Contrat', d.contratOf(e).libelle],
        ['Entrée', fmtIso(e.entree)],
      ],
    },
    {
      title: `Compteurs au ${fmtIso(x.etat.date)}`,
      ...(lignes.length
        ? { table: { head: ['Compteur', 'Droit ou acquis', 'Pris', 'Posés', 'Solde', 'Rubrique'], rows: lignes.map(l => [l.libelle, cellule(l.droit, l.unite), cellule(l.pris, l.unite), cellule(l.poses, l.unite), cellule(l.solde, l.unite), l.rubrique ?? '']) } }
        : { text: 'Aucun compteur de congés géré par Cursus pour ce contrat.' }),
    },
    ...(x.etat.avertissements.length ? [{ title: 'Points à voir', text: x.etat.avertissements.join('\n') }] : []),
    {
      title: 'Transmission à la paie',
      text: `${sourceSolde(d, x)}. ${MENTION_SOLDES}, qui fait foi pour les compteurs. Le montant de l’indemnité compensatrice de congés payés (règle du dixième ou maintien de salaire) est calculé par Sage Paie ; un trop-pris de RTT est signalé, sans retenue automatique.`,
    },
  ];
}
