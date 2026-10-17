// Solde de sortie (t128) : tableau des compteurs à la date de sortie (dialogue de sortie, avant confirmation) et section
// de la fiche d'un salarié dont la sortie est enregistrée : solde photographié à l'enregistrement, état de sa
// transmission à la paie, impression et export CSV (client/src/solde-sortie.ts). Service RH, paie et lecture seule :
// les autres profils ne reçoivent pas les soldes photographiés (server/src/dataset.ts).
import { DownloadSimpleIcon, PrinterIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../shared/format.ts';
import { etatSortie, lignesEtat, quantiteTexte, resumeEtat } from '../../../shared/rules/solde-sortie.ts';
import type { Employe, EtatSortie } from '../../../shared/types.ts';
import { downloadCsv, matriculesImprimes, printDocument } from '../print.ts';
import { csvSoldeSortie, sectionsSoldeSortie, sourceSolde, type SoldeAffiche } from '../solde-sortie.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent } from './ui.tsx';

const cellule = (n: number | null, unite: 'j' | 'h') => (n == null ? '—' : quantiteTexte(n, unite));

/** Compteurs à la date de sortie : droit ou acquis, pris, posés, solde ; lignes émises à la paie en gras. */
export function EtatSortieTableau({ etat }: { etat: EtatSortie }) {
  const lignes = lignesEtat(etat);
  if (!lignes.length) return <Fine>Aucun compteur de congés géré par Cursus pour ce contrat.</Fine>;
  return (
    <div className="scroll-x">
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>Compteur</th><th className="right">Droit ou acquis</th><th className="right">Pris</th><th className="right">Posés</th><th className="right">Solde</th></tr></thead>
        <tbody>
          {lignes.map(l => (
            <tr key={l.libelle} style={l.rubrique ? { fontWeight: 600 } : undefined}>
              <td>{l.libelle}</td>
              <td className="right tnum nowrap">{cellule(l.droit, l.unite)}</td>
              <td className="right tnum nowrap">{cellule(l.pris, l.unite)}</td>
              <td className="right tnum nowrap">{cellule(l.poses, l.unite)}</td>
              <td className="right tnum nowrap">{cellule(l.solde, l.unite)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Section « Solde de sortie » de la fiche : photographie (ou calcul du jour pour une sortie enregistrée avant qu'elle
 * existe), points à voir, transmission, impression et export. Un calcul du jour différent de la photographie est signalé
 * au service RH tant que le solde n'est pas parti à la paie (une feuille ou une absence corrigée depuis).
 */
export function SoldeSortieFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, paie, consultation } = useRole();
  const { notify } = useStore();
  if (!(rh || paie || consultation) || !e.motifSortie || !e.fin) return null;
  const solde = d.ds.soldesSortie?.find(s => s.empId === e.id) ?? null;
  const x: SoldeAffiche = { etat: solde?.etat ?? etatSortie(d, e, e.fin), solde };
  // Comparaison au calcul du jour : service RH seulement (la paie ne reçoit pas la nature des absences).
  const aJour = rh && solde && solde.lotId == null ? resumeEtat(etatSortie(d, e, e.fin)) : null;
  const imprimer = () => { if (!printDocument(`Solde de sortie — ${e.nom}`, `${e.poste} · dernier jour du contrat le ${fmtIso(x.etat.date)}`, sectionsSoldeSortie(d, e, x), e.id, matriculesImprimes(e))) notify('Autorisez les fenêtres surgissantes pour imprimer le solde de sortie', true); };
  const exporter = () => { const l = csvSoldeSortie(d, e, x); downloadCsv(l.fichier, l.head, l.rows, e.id); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <div className="text-muted sub">Solde de sortie au {fmtIso(x.etat.date)}</div>
        <div style={{ fontSize: 14 }}>{resumeEtat(x.etat)}</div>
        <div className="text-muted sub">{sourceSolde(d, x)}</div>
      </div>
      <EtatSortieTableau etat={x.etat} />
      {x.etat.avertissements.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
      {aJour && aJour !== resumeEtat(x.etat) && (
        <NoteAccent>Calcul à ce jour différent ({aJour}) : une feuille ou une absence a changé depuis. Modifiez la sortie pour photographier de nouveau le solde.</NoteAccent>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Btn small icon={<PrinterIcon size={14} />} onClick={imprimer}>Imprimer l’état</Btn>
        <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter (CSV)</Btn>
      </div>
      <Fine>Montant de l’indemnité calculé par Sage Paie (règle du dixième ou maintien de salaire) ; CET liquidé en entier ; un trop-pris de RTT est signalé, sans retenue automatique.</Fine>
    </div>
  );
}
