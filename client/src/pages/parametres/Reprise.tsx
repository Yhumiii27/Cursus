// Paramètres → Mise en service : outil de référence après la reprise depuis Lucca (avertissement), lots importés et accès
// à l'écran Mise en service (pages/MiseEnService.tsx, imports réservés à l'administrateur RH). Service RH seulement.
import { REPRISES, type TypeReprise, TYPES_REPRISE } from '../../../../shared/rules/reprise.ts';
import { Fine, NoteAccent, Panel, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

export function Reprise(_: SectionProps) {
  const data = useData();
  const { go } = useStore();
  const { rh, admin } = useRole();
  if (!rh) return null;
  const faits = TYPES_REPRISE.filter(ty => data.reprises.some(l => l.type === ty));
  const manquent = TYPES_REPRISE.filter(ty => !faits.includes(ty as TypeReprise));
  return (
    <Panel title={t('Set-up')} style={{ gap: 'var(--space-3)' }}
      aside={data.reprises.length ? <Tag cls="tag-neutral">{tn(data.reprises.length, 'batch imported', 'batches imported')}</Tag> : <Tag cls="tag-outline">{t('No import')}</Tag>}>
      <NoteAccent>
        {t('After the takeover from Lucca, Cursus is the reference for the list of employees and for the leave counters: entries, departures, employee numbers and balances are kept in Cursus, no longer in Lucca.')}
      </NoteAccent>
      <Fine>
        {faits.length ? `${t('Imported: ')}${faits.map(ty => REPRISES[ty].court).join(', ')}.` : t('Nothing has been imported yet.')}
        {manquent.length ? `${t(' Left to import: ')}${manquent.map(ty => REPRISES[ty].court).join(', ')}.` : ''}{t(' Recommended closing date of the balances: 1 January 2027.')}
      </Fine>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => go('miseEnService')}>
          {admin ? t('Open the set-up') : t('See the imported batches')}
        </button>
      </div>
    </Panel>
  );
}
