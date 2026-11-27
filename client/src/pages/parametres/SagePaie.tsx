// Paramètres → Sage Paie : mode réel de la transmission (simulation ou fichier d'import), rubriques transmises et leur
// code Sage (réglés dans l'écran Temps, où la paie y a accès), dernier lot de paie (historique complet : écran Temps).
import { fmtIso } from '../../../../shared/format.ts';
import { STATUTS_LOT } from '../../../../shared/rules/lots-paie.ts';
import { MODES_SAGE, periodeLabel, rubriquesPaie } from '../../../../shared/rules/paie.ts';
import { Fine, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

export function SagePaie(_: SectionProps) {
  const data = useData();
  const { session } = useStore();
  const mode = session?.integrations.sage ?? 'simulation';
  const lot = data.lotsPaie[0];
  const rubriques = rubriquesPaie(data.rubriquesPaie);
  const aConfirmer = rubriques.filter(r => r.active && !r.confirmee).length;
  return (
    <Panel title={t('Sage Paie')} aside={<Tag cls={mode === 'simulation' ? 'tag-outline' : 'tag-neutral'}>{MODES_SAGE[mode].label}</Tag>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {MODES_SAGE[mode].aide}{t(' Temps excluded (statement sent to the agency). Mode chosen by the IT department (SAGE_MODE).')}
      </p>
      <SectionLabel>{t('Items transmitted')}</SectionLabel>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Item#rubrique')}</th><th>{t('Content')}</th><th>{t('Sage code')}</th></tr></thead>
          <tbody>
            {rubriques.map(r => (
              <tr key={r.code}>
                <td className="nowrap" style={MONO}>{r.code}</td>
                <td className="text-muted" style={{ fontSize: 13 }}>{r.label}</td>
                <td className="nowrap" style={MONO}>{r.active ? `${r.codeSage}${r.confirmee ? '' : t(' (to be confirmed)')}` : t('not exported#fem')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Fine>
        {t('Codes of the payroll plan entered and confirmed by the HR administrator or the payroll manager in the Working time screen')}
        {aConfirmer ? `${t(': ')}${tn(aConfirmer, 'item', 'items')}${t(' to confirm, only the simulation is possible as long as an item used is not.')}` : '.'}
      </Fine>
      <Fine>
        {lot
          ? `${t('Last payroll batch: no. ')}${lot.id}${lot.mode === 'simulation' ? t(' (simulation)') : ''}, ${periodeLabel(lot.periode)}, ${STATUTS_LOT[lot.statut].label.toLowerCase()}${t(' · generated on ')}${fmtIso(lot.creation.slice(0, 10))} · ${tn(lot.feuilles.length, 'timesheet#count', 'timesheets#count')}${t('. History, import file and confirmation of the import: Working time screen.')}`
          : t('No payroll batch for now.')}
      </Fine>
    </Panel>
  );
}
