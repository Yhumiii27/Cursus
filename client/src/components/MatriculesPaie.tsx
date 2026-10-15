// Salariés d'un lot de paie sans matricule de paie (shared/rules/matricules.ts) : avertissement avant la transmission à
// Sage Paie — transmis sous leur matricule Cursus en simulation, refusés d'une transmission réelle.
import { plural } from '../../../shared/format.ts';
import { sansMatriculePaie } from '../../../shared/rules/matricules.ts';
import { useData, useStore } from '../state/store.tsx';
import { NoteAccent } from './ui.tsx';

export function SansMatriculePaie({ empIds }: { empIds: number[] }) {
  const data = useData();
  const { session } = useStore();
  const sans = sansMatriculePaie(data.employes, data.today, empIds);
  if (!sans.length) return null;
  // Toute transmission qui n'est pas une simulation (API, fichier d'import…) refuse ces salariés.
  const reel = !!session && session.integrations.sage !== 'simulation';
  return (
    <NoteAccent>
      {plural(sans.length, 'salarié sans matricule de paie', 'salariés sans matricule de paie')} : {sans.map(e => e.nom).join(', ')}.
      {' '}{reel ? 'La transmission sera refusée : saisissez-le sur leur fiche.' : 'Simulation : transmis sous le matricule Cursus ; une transmission réelle les refusera.'}
    </NoteAccent>
  );
}
