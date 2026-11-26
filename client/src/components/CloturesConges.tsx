// Bandeau des clôtures de congés à faire (écran Congés & absences, espace RH) : périodes de CP terminées au 31 mai et
// années de RTT terminées au 31 décembre dont des salariés ne sont pas encore clôturés (shared/rules/clotures.ts),
// proposées à partir du 1er juin et du 1er janvier. Le service RH ouvre la clôture ; les autres profils la voient.
import { useMemo } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { cloturesAFaire } from '../../../shared/rules/clotures.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function CloturesConges() {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const aFaire = useMemo(() => cloturesAFaire(d), [d]);
  if (!aFaire.length) return null;
  return (
    <Panel highlight title={t('Leave closings to do')} aside={t('Offered by Cursus, confirmed by HR · no automatic loss')}>
      <div className="list">
        {aFaire.map(c => (
          <div key={`${c.type}|${c.periode}`} className="list-row">
            <div className="grow">
              <div style={{ fontSize: 14 }}>{c.libelle}{t(' · ended on #fem')}{fmt(parse(c.fin))}</div>
              <div className="text-muted sub">
                {tn(c.restants, 'employee#salarie', 'employees#salarie')}{t(' to close out of ')}{c.total} · {t(c.type === 'CP'
                  ? 'carry-over or loss of the balance, decided for each employee'
                  : 'RTT not taken lost (not carried over), after the reminder of the time savings account')}
              </div>
            </div>
            {rh
              ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'clotureConges', conges: c.type, periode: c.periode })}>{t('Close#session')}</button>
              : <span className="text-muted sub">{t('Closing by HR')}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}
