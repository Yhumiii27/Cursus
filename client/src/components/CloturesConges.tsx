// Bandeau des clôtures de congés à faire (écran Congés & absences, espace RH) : périodes de CP terminées au 31 mai et
// années de RTT terminées au 31 décembre dont des salariés ne sont pas encore clôturés (shared/rules/clotures.ts),
// proposées à partir du 1er juin et du 1er janvier. Le service RH ouvre la clôture ; les autres profils la voient.
import { useMemo } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { cloturesAFaire } from '../../../shared/rules/clotures.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel } from './ui.tsx';

export function CloturesConges() {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const aFaire = useMemo(() => cloturesAFaire(d), [d]);
  if (!aFaire.length) return null;
  return (
    <Panel highlight title="Clôtures de congés à faire" aside="Proposées par Cursus, confirmées par le service RH · aucune perte d’office">
      <div className="list">
        {aFaire.map(c => (
          <div key={`${c.type}|${c.periode}`} className="list-row">
            <div className="grow">
              <div style={{ fontSize: 14 }}>{c.libelle} · terminée le {fmt(parse(c.fin))}</div>
              <div className="text-muted sub">
                {plural(c.restants, 'salarié', 'salariés')} à clôturer sur {c.total} · {c.type === 'CP'
                  ? 'report ou perte du solde, décidé pour chaque salarié'
                  : 'RTT non pris perdus (non reportables), après le rappel du compte épargne-temps'}
              </div>
            </div>
            {rh
              ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'clotureConges', conges: c.type, periode: c.periode })}>Clôturer</button>
              : <span className="text-muted sub">Clôture par le service RH</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}
