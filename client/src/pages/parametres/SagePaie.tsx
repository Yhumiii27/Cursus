// Paramètres → Sage Paie : mode réel de la transmission (simulation, fichier d'import, API), rubriques transmises et leur
// code Sage (réglés dans l'écran Temps, où la paie y a accès), dernière transmission.
import { parse } from '../../../../shared/dates.ts';
import { fmt, plural } from '../../../../shared/format.ts';
import { MODES_SAGE, periodeLabel, rubriquesPaie } from '../../../../shared/rules/paie.ts';
import { Fine, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps } from './commun.ts';

export function SagePaie(_: SectionProps) {
  const data = useData();
  const { session } = useStore();
  const mode = session?.integrations.sage ?? 'simulation';
  const push = data.lastSagePush;
  const rubriques = rubriquesPaie(data.rubriquesPaie);
  const aConfirmer = rubriques.filter(r => r.active && !r.confirmee).length;
  return (
    <Panel title="Sage Paie" aside={<Tag cls={mode === 'simulation' ? 'tag-outline' : mode === 'fichier' ? 'tag-neutral' : 'tag-accent'}>{MODES_SAGE[mode].label}</Tag>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {MODES_SAGE[mode].aide} Intérimaires exclus (relevé envoyé à l’agence). Mode choisi par le service informatique (SAGE_MODE).
      </p>
      <SectionLabel>Rubriques transmises</SectionLabel>
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
      <Fine>
        Codes du plan de paie saisis et confirmés par l’administrateur RH ou le gestionnaire de paie dans l’écran Temps de travail
        {aConfirmer ? ` : ${plural(aConfirmer, 'rubrique', 'rubriques')} à confirmer, seule la simulation est possible tant qu’une rubrique utilisée ne l’est pas.` : '.'}
      </Fine>
      <Fine>
        {push
          ? `Dernière transmission${push.mode === 'simulation' ? ' (simulation)' : ''} le ${fmt(parse(push.envoye_le.slice(0, 10)))} · ${push.periodes?.length ? push.periodes.map(periodeLabel).join(', ') : `période ${push.periode_paie ?? '—'}`} · ${plural(push.lignes.length, 'ligne', 'lignes')} · dossier ${push.dossier}`
          : 'Aucune transmission effectuée pour le moment.'}
      </Fine>
    </Panel>
  );
}
