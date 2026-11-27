// Chantiers Keystone : verdict Go / No Go par ressource et réponse transmise à Keystone.
import { useMemo } from 'react';
import { GNG_CLS, GNG_LABEL } from '../../../shared/constants.ts';
import type { GngStatus } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { cap, fmt, fmtShort } from '../../../shared/format.ts';
import { identifiantKeystone } from '../../../shared/rules/matricules.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Empty, Fine, Page, Panel, Pre, Tag, Two } from '../components/ui.tsx';
import { CartePick, Ouvrir } from '../components/Cliquable.tsx';
import { useEnriched, useTrips } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function Chantiers() {
  const { d, emps } = useEnriched();
  const trips = useTrips();
  const { ui, setUi, go } = useStore();
  const detail = d.ds.settings.partageKeystone === 'detaille';

  const chant = useMemo(() => d.evaluateChantiers(emps, trips), [d, emps, trips]);
  const sel = chant.find(x => x.c.id === ui.goSel) || chant[0] || null;
  // Écran étroit : le détail s'affiche sous les cartes ; choisir un chantier l'amène dans le champ de vision.
  const panneau = usePanneauVisible<HTMLElement>(ui.goSel && sel?.c.id === ui.goSel ? ui.goSel : null);
  // Réponse de l'API v1 (GET /api/integrations/keystone/v1/chantiers/:id/go-no-go), horodatée comme elle à l'heure réelle
  // (ISO UTC), recalculée à chaque affichage : jamais une heure fictive.
  const payload = sel ? JSON.stringify(d.verdictKeystone(sel, detail, new Date().toISOString()), null, 2) : '';
  const gngCount = (st: GngStatus) => chant.filter(x => x.status === st).length;
  // Client et chef de projet sont facultatifs dans l'API Keystone : seuls ceux renseignés s'affichent.
  const entete = sel ? cap([sel.c.client && `${t('client ')}${sel.c.client}`, sel.c.chef && `${t('project manager ')}${sel.c.chef}`].filter(Boolean).join(' · ')) : '';

  return (
    <Page
      kicker={`${tn(chant.length, 'Keystone worksite', 'Keystone worksites')} · ${gngCount('go')} go · ${gngCount('reserve')}${t(' subject to conditions')} · ${gngCount('nogo')} no go`}
      title={`${t('Worksites')} · Go / No Go`}
      note={t('Keystone asks Cursus for each assigned resource. Only the verdict and reason codes leave Cursus: no medical data, no nature of absence, no passport number, no vaccination date.')}
    >
      <div className="cards-grid">
        {chant.map(x => {
          const dest = d.destOf(x.c.pays);
          const n = (st: GngStatus) => x.res.filter(r => r.status === st).length;
          // Toujours : contrat en cours et aucune absence sur la présence, aptitude médicale du jour ; hors de France, déplacement
          // couvrant la présence et formalités.
          const req = [t('availability (contract, absences)'), t('medical fitness'), ...x.c.habs.map(h => d.hm(h).nom), ...x.c.certs.map(f => d.fm(f).court),
            ...(x.c.pays !== 'FR' ? [t('trip covering the presence'), t('travel and posting formalities')] : [])];
          return (
            <CartePick key={x.c.id} selected={x === sel} onSelect={() => setUi({ goSel: x.c.id })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div className="card-kicker">{x.c.id}</div>
                <Tag cls={GNG_CLS[x.status]}>{GNG_LABEL[x.status]}</Tag>
              </div>
              <div className="card-title">{x.c.nom}</div>
              <p className="card-body dim">{x.c.lieu}{dest ? ', ' + dest.pays : ''} · {fmtShort(parse(x.c.debut))} → {fmt(parse(x.c.fin))}</p>
              <Fine>{t('Requirements: ')}{req.join(' · ')}</Fine>
              <div className="card-meta"><span>{n('go')} go · {n('reserve')}{t(' subject to conditions')} · {n('nogo')} no go</span></div>
            </CartePick>
          );
        })}
      </div>
      {chant.length === 0 && <Empty>{t('No Keystone worksite in progress.')}</Empty>}

      {sel && (
        <div className="row-wrap">
          <Panel panneau={panneau} nommePar="chantier-detail" style={{ flex: '1 1 520px' }} head={
            <div className="panel-head top">
              <div><h2 id="chantier-detail">{sel.c.id} — {sel.c.nom}</h2>{entete && <div className="text-muted sub">{entete}</div>}</div>
              <Tag cls={GNG_CLS[sel.status]}>{GNG_LABEL[sel.status]}</Tag>
            </div>
          }>
            <table className="table">
              <thead><tr><th>{t('Resource')}</th><th>{t('Verdict')}</th><th>{t('Reasons (HR view)')}</th></tr></thead>
              <tbody>
                {sel.res.map(r => (
                  <tr key={r.e.id} className="clickable" onClick={() => go('collaborateurs', { selectedId: r.e.id })}>
                    <td><Two nowrap main={<Ouvrir onOpen={() => go('collaborateurs', { selectedId: r.e.id })}>{r.e.nom}</Ouvrir>} sub={`${identifiantKeystone(d.ds.settings.identifiantKeystone, r.e)} · ${r.e.poste}`} /></td>
                    <td><Tag cls={GNG_CLS[r.status]}>{GNG_LABEL[r.status]}</Tag></td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.reasons.length
                          ? r.reasons.map((x, i) => <span key={i} className={x.level === 'nogo' ? 'note-accent' : 'sub text-n400'}>{x.detailed}</span>)
                          : <span className="sub text-n400">{t('All the requirements are met')}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel style={{ flex: '1 1 360px' }} title={t('Answer sent to Keystone')} aside={t(detail ? 'Reason codes and labels' : 'Reason codes only')}>
            <Pre>{payload}</Pre>
            <Fine>{t('Timestamp (“evalue_le”, UTC time): that of the moment of the consultation, as in the answer given to Keystone.')}</Fine>
            <Fine>{t('Identifier: employee number only. Re-evaluated at each consultation. A change of verdict of a resource (status or reason codes, never a label) is pushed to Keystone after the action that causes it, after an update received from Keystone and every day (expiries) — followed in Settings → Sendings. Level of detail adjustable in the settings.')}</Fine>
          </Panel>
        </div>
      )}
    </Page>
  );
}
