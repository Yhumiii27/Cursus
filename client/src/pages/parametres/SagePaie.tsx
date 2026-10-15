// Paramètres → Sage Paie : mode de transmission, rubriques transmises, dernier envoi.
import { parse } from '../../../../shared/dates.ts';
import { fmt, plural } from '../../../../shared/format.ts';
import { Fine, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps } from './commun.ts';

const SAGE_RUBRIQUES: [string, string][] = [
  ['HN', 'Heures normales'],
  ['HS25', 'Heures supplémentaires majorées à 25 %'],
  ['HS50', 'Heures supplémentaires majorées à 50 %'],
  ['HC10', 'Heures complémentaires majorées à 10 % (temps partiel)'],
  ['HC25', 'Heures complémentaires majorées à 25 % (temps partiel)'],
  ['RCR_ACQUIS', 'Repos compensateur de remplacement acquis'],
  ['JTRAV', 'Jours travaillés (cadres au forfait jours)'],
];

function ModeTag({ mode }: { mode: string }) {
  return mode === 'api' ? <Tag cls="tag-neutral">API connectée</Tag> : <Tag cls="tag-outline">Simulation</Tag>;
}

export function SagePaie(_: SectionProps) {
  const data = useData();
  const { session } = useStore();
  const sageMode = session?.integrations.sage ?? 'simulation';
  const push = data.lastSagePush;
  return (
    <Panel title="Sage Paie" aside={<ModeTag mode={sageMode} />}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {sageMode === 'api'
          ? 'Mode API : les variables de paie des feuilles de temps validées sont envoyées à Sage Paie depuis l’écran Feuilles de temps.'
          : 'Mode simulation : la transmission depuis l’écran Feuilles de temps renvoie un accusé de réception fictif.'}
        {' '}Intérimaires exclus (relevé envoyé à l’agence).
      </p>
      <SectionLabel>Rubriques transmises</SectionLabel>
      <table className="table">
        <thead><tr><th>Rubrique</th><th>Contenu</th></tr></thead>
        <tbody>
          {SAGE_RUBRIQUES.map(([code, label]) => (
            <tr key={code}><td className="nowrap" style={MONO}>{code}</td><td className="text-muted" style={{ fontSize: 13 }}>{label}</td></tr>
          ))}
        </tbody>
      </table>
      <Fine>Correspondance avec le plan de paie Sage à paramétrer.</Fine>
      <Fine>
        {push
          ? `Dernier envoi le ${fmt(parse(push.envoye_le.slice(0, 10)))} · période ${push.periode_paie} · ${plural(push.lignes.length, 'ligne', 'lignes')} · dossier ${push.dossier}`
          : 'Aucune transmission effectuée pour le moment.'}
      </Fine>
    </Panel>
  );
}
