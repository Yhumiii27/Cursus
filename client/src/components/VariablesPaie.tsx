// Variables de paie d'une période (écran Temps, espace RH, t028) : export CSV pour le contrôle de la paie — une ligne par
// salarié, code Sage et origine (semaine d'une feuille, absence), avec la quantité, le détail et le lot (ou « en attente
// d'un lot »). Réservé à l'administrateur RH et au gestionnaire de paie : le code d'une absence révèle sa catégorie.
// Fichier produit et tracé par le serveur (GET /api/paie/variables/:periode, server/src/variables-paie.ts).
import { useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { periodeLabel, periodeOuverte } from '../../../shared/rules/paie.ts';
import { api } from '../api.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, SectionLabel } from './ui.tsx';

/** `periodes` : périodes des lots et de ce qui attend un lot, la plus récente d'abord ; la période ouverte s'y ajoute. */
export function VariablesPaie({ periodes }: { periodes: string[] }) {
  const d = useDomain();
  const { notify } = useStore();
  const ouverte = periodeOuverte(d.ti, d.ds.settings.clotureJour);
  const liste = [...new Set([ouverte, ...periodes])].sort().reverse();
  const [periode, setPeriode] = useState(ouverte);
  const [busy, setBusy] = useState(false);

  const exporter = async () => {
    setBusy(true);
    try {
      await api.variablesPaie(periode);
      notify(`Variables de paie ${/^[aeiou]/.test(periodeLabel(periode)) ? 'd’' : 'de '}${periodeLabel(periode)} exportées — export tracé dans le journal`);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>Variables de la période</SectionLabel>
      <div className="actions-end" style={{ justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="variables-periode" className="text-muted" style={{ fontSize: 13 }}>Période de paie</label>
        <select className="input" id="variables-periode" value={periode} onChange={e => setPeriode(e.target.value)} style={{ maxWidth: 220 }}>
          {liste.map(p => <option key={p} value={p}>{periodeLabel(p)}</option>)}
        </select>
        <Btn small icon={<DownloadSimpleIcon size={14} />} disabled={busy} onClick={exporter}>Exporter (CSV)</Btn>
      </div>
      <Fine>
        Matricule de paie, salarié, code Sage, libellé, quantité et détail (semaine, ou absence et ses dates, rappel d’une période close,
        régularisation) : lignes des lots générés ou transmis de la période, puis ce qui attend encore un lot. La nature d’une absence n’y figure
        jamais ; sa rubrique en dit la catégorie, d’où un export réservé à la paie. Chaque export est tracé dans le journal.
      </Fine>
    </>
  );
}
