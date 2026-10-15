// Rubriques de paie (écran Temps, espace RH) : chaque code interne émis par Cursus et son code dans le plan de paie Sage,
// pré-rempli avec le code interne, « à confirmer ». L'administrateur RH et le gestionnaire de paie, qui n'a pas accès
// aux Paramètres, les saisissent et les confirment ici (RubriqueDialog, action paie.rubrique) ; le service RH et la
// lecture seule consultent. Tant qu'une rubrique utilisée n'est pas confirmée, seule la simulation transmet.
import { fmtIso } from '../../../shared/format.ts';
import { rubriquesPaie } from '../../../shared/rules/paie.ts';
import { useAgir } from '../state/actions.ts';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';
import { SectionLabel, Tag, Two } from './ui.tsx';

const UNITE = { h: 'heures', j: 'jours', nombre: 'nombre' } as const;
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

/** `aConfirmer` : codes internes utilisés par les feuilles en attente et pas encore confirmés (signalés). */
export function RubriquesPaie({ aConfirmer }: { aConfirmer: ReadonlySet<string> }) {
  const data = useData();
  const { paie } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const table = rubriquesPaie(data.rubriquesPaie);
  return (
    <>
      <SectionLabel>Rubriques de paie</SectionLabel>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Cursus</th><th>Contenu</th><th>Code Sage</th><th>État</th><th></th></tr></thead>
          <tbody>
            {table.map(r => (
              <tr key={r.code}>
                <td className="nowrap" style={MONO}>{r.code}</td>
                <td><Two main={r.label} sub={UNITE[r.unite]} /></td>
                <td className="nowrap" style={MONO}>{r.codeSage}</td>
                <td>
                  {!r.active ? <Tag cls="tag-outline">Non exportée</Tag>
                    : r.confirmee ? <Two main={<Tag cls="tag-neutral">Confirmé</Tag>} sub={`le ${fmtIso(r.confirmeLe!)} · ${r.confirmePar}`} subNowrap />
                    : <Two main={<Tag cls={aConfirmer.has(r.code) ? 'tag-accent' : 'tag-outline'}>À confirmer</Tag>} sub={aConfirmer.has(r.code) ? 'utilisée par les feuilles en attente' : undefined} />}
                </td>
                <td className="right">
                  {paie && (
                    <div className="actions-end">
                      {r.active && !r.confirmee && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} title={`Code ${r.codeSage} vérifié dans le plan de paie Sage`}
                          onClick={agir(() => run('paie.rubrique', { code: r.code, confirmer: true }))}>Confirmer</button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'rubrique', code: r.code })}>Modifier</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
