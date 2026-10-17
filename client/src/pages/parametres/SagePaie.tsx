// Paramètres → Sage Paie : mode réel de la transmission (simulation ou fichier d'import), rubriques transmises et leur
// code Sage (réglés dans l'écran Temps, où la paie y a accès), dernier lot de paie (historique complet : écran Temps).
import { fmtIso, plural } from '../../../../shared/format.ts';
import { STATUTS_LOT } from '../../../../shared/rules/lots-paie.ts';
import { MODES_SAGE, periodeLabel, rubriquesPaie } from '../../../../shared/rules/paie.ts';
import { Fine, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps } from './commun.ts';

export function SagePaie(_: SectionProps) {
  const data = useData();
  const { session } = useStore();
  const mode = session?.integrations.sage ?? 'simulation';
  const lot = data.lotsPaie[0];
  const rubriques = rubriquesPaie(data.rubriquesPaie);
  const aConfirmer = rubriques.filter(r => r.active && !r.confirmee).length;
  return (
    <Panel title="Sage Paie" aside={<Tag cls={mode === 'simulation' ? 'tag-outline' : 'tag-neutral'}>{MODES_SAGE[mode].label}</Tag>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {MODES_SAGE[mode].aide} Intérimaires exclus (relevé envoyé à l’agence). Mode choisi par le service informatique (SAGE_MODE).
      </p>
      <SectionLabel>Rubriques transmises</SectionLabel>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Rubrique</th><th>Contenu</th><th>Code Sage</th></tr></thead>
          <tbody>
            {rubriques.map(r => (
              <tr key={r.code}>
                <td className="nowrap" style={MONO}>{r.code}</td>
                <td className="text-muted" style={{ fontSize: 13 }}>{r.label}</td>
                <td className="nowrap" style={MONO}>{r.active ? `${r.codeSage}${r.confirmee ? '' : ' (à confirmer)'}` : 'non exportée'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Fine>
        Codes du plan de paie saisis et confirmés par l’administrateur RH ou le gestionnaire de paie dans l’écran Temps de travail
        {aConfirmer ? ` : ${plural(aConfirmer, 'rubrique', 'rubriques')} à confirmer, seule la simulation est possible tant qu’une rubrique utilisée ne l’est pas.` : '.'}
      </Fine>
      <Fine>
        {lot
          ? `Dernier lot de paie : n° ${lot.id}${lot.mode === 'simulation' ? ' (simulation)' : ''}, ${periodeLabel(lot.periode)}, ${STATUTS_LOT[lot.statut].label.toLowerCase()} · généré le ${fmtIso(lot.creation.slice(0, 10))} · ${plural(lot.feuilles.length, 'feuille', 'feuilles')}. Historique, fichier d’import et confirmation de l’import : écran Temps de travail.`
          : 'Aucun lot de paie pour le moment.'}
      </Fine>
    </Panel>
  );
}
