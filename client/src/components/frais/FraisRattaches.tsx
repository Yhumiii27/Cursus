// lot 11 — notes de frais : notes rattachées à un déplacement (fiche de Voyages) ou aux missions Keystone (écran Missions),
// pour qui les reçoit dans son instantané (service RH ; manager : son équipe et ses délégations « frais », sans note
// médicale). Un clic ouvre la note dans l'écran Notes de frais. Rien si le module est désactivé.
import { plural } from '../../../../shared/format.ts';
import { STATUTS_NOTE_FRAIS } from '../../../../shared/rules/frais.ts';
import type { NoteFrais } from '../../../../shared/types.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Fine, Tag } from '../ui.tsx';
import { euros, nomNote, rattachement, syntheseNote } from './commun.ts';

export function FraisRattaches({ filtre, titre, avecRattachement, nouvelle }: {
  filtre: (n: NoteFrais) => boolean; titre: string; avecRattachement?: boolean;
  /** Bouton « Nouvelle note » (service RH, fiche d'un déplacement) : salarié et déplacement présélectionnés. */
  nouvelle?: { empId: number; voyageId?: number };
}) {
  const d = useDomain();
  const { go, openDialog } = useStore();
  if (!d.ds.settings.notesFraisActives) return null;
  const notes = (d.ds.notesFrais ?? []).filter(n => n.statut !== 'annulee' && filtre(n)).sort((a, b) => b.id - a.id);
  return (
    <section aria-label={titre} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h4 className="section-label">{titre}{notes.length ? ` · ${plural(notes.length, 'note', 'notes')}` : ''}</h4>
      {notes.length === 0 ? <Fine>Aucune note de frais rattachée.</Fine> : notes.map(n => {
        const s = syntheseNote(d, n), st = STATUTS_NOTE_FRAIS[n.statut];
        return (
          <div key={n.id} className="list-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div>{d.personName(n.empId)} — {nomNote(n)}</div>
              {avecRattachement && <div className="text-muted sub">{rattachement(d, n)}</div>}
            </div>
            <Tag cls={st.cls}>{st.label}</Tag>
            <span className="tnum">{euros(s.retenu)}</span>
            <Btn small onClick={() => go('frais', { fraisOnglet: d.ds.user.role === 'manager' ? 'equipe' : 'notes', fraisNote: n.id })}>Ouvrir</Btn>
          </div>
        );
      })}
      {nouvelle && <div><Btn small onClick={() => openDialog({ type: 'fraisNote', empId: nouvelle.empId, voyageId: nouvelle.voyageId ?? null })}>Nouvelle note de frais</Btn></div>}
    </section>
  );
}
