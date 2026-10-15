// Chantiers Keystone : verdict Go / No Go par ressource et réponse transmise à Keystone.
import { useMemo } from 'react';
import { GNG_CLS, GNG_LABEL } from '../../../shared/constants.ts';
import type { GngStatus } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { cap, fmt, fmtShort, matricule, plural } from '../../../shared/format.ts';
import { Empty, Fine, Page, Panel, Pre, Tag, Two } from '../components/ui.tsx';
import { useEnriched, useTrips } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function Chantiers() {
  const { d, emps } = useEnriched();
  const trips = useTrips();
  const { ui, setUi, go } = useStore();
  const detail = d.ds.settings.partageKeystone === 'detaille';

  const chant = useMemo(() => d.evaluateChantiers(emps, trips), [d, emps, trips]);
  const sel = chant.find(x => x.c.id === ui.goSel) || chant[0] || null;
  // Réponse de l'API v1 (GET /api/integrations/keystone/v1/chantiers/:id/go-no-go).
  const payload = useMemo(() => sel ? JSON.stringify(d.verdictKeystone(sel, detail), null, 2) : '', [d, sel, detail]);
  const gngCount = (st: GngStatus) => chant.filter(x => x.status === st).length;
  // Client et chef de projet sont facultatifs dans l'API Keystone : seuls ceux renseignés s'affichent.
  const entete = sel ? cap([sel.c.client && `client ${sel.c.client}`, sel.c.chef && `chef de projet ${sel.c.chef}`].filter(Boolean).join(' · ')) : '';

  return (
    <Page
      kicker={`${plural(chant.length, 'chantier Keystone', 'chantiers Keystone')} · ${gngCount('go')} go · ${gngCount('reserve')} sous réserve · ${gngCount('nogo')} no go`}
      title="Chantiers · Go / No Go"
      note="Keystone interroge Cursus pour chaque ressource affectée. Seul le verdict et des codes de motif sortent de Cursus : aucune donnée médicale, aucune nature d’absence, aucun numéro de passeport, aucune date de vaccination."
    >
      <div className="cards-grid">
        {chant.map(x => {
          const dest = d.destOf(x.c.pays);
          const n = (st: GngStatus) => x.res.filter(r => r.status === st).length;
          // Toujours : contrat en cours et aucune absence sur la présence, aptitude médicale du jour ; hors de France, déplacement
          // couvrant la présence et formalités.
          const req = ['disponibilité (contrat, absences)', 'aptitude médicale', ...x.c.habs.map(h => d.hm(h).nom), ...x.c.certs.map(f => d.fm(f).court),
            ...(x.c.pays !== 'FR' ? ['déplacement couvrant la présence', 'formalités de voyage et de détachement'] : [])];
          return (
            <article key={x.c.id} className={`card elev-sm pick${x === sel ? ' selected' : ''}`} onClick={() => setUi({ goSel: x.c.id })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div className="card-kicker">{x.c.id}</div>
                <Tag cls={GNG_CLS[x.status]}>{GNG_LABEL[x.status]}</Tag>
              </div>
              <div className="card-title">{x.c.nom}</div>
              <p className="card-body dim">{x.c.lieu}{dest ? ', ' + dest.pays : ''} · {fmtShort(parse(x.c.debut))} → {fmt(parse(x.c.fin))}</p>
              <Fine>Exigences : {req.join(' · ')}</Fine>
              <div className="card-meta"><span>{n('go')} go · {n('reserve')} sous réserve · {n('nogo')} no go</span></div>
            </article>
          );
        })}
      </div>
      {chant.length === 0 && <Empty>Aucun chantier Keystone en cours.</Empty>}

      {sel && (
        <div className="row-wrap">
          <Panel style={{ flex: '1 1 520px' }} head={
            <div className="panel-head top">
              <div><h2>{sel.c.id} — {sel.c.nom}</h2>{entete && <div className="text-muted sub">{entete}</div>}</div>
              <Tag cls={GNG_CLS[sel.status]}>{GNG_LABEL[sel.status]}</Tag>
            </div>
          }>
            <table className="table">
              <thead><tr><th>Ressource</th><th>Verdict</th><th>Motifs (vue RH)</th></tr></thead>
              <tbody>
                {sel.res.map(r => (
                  <tr key={r.e.id} className="clickable" onClick={() => go('collaborateurs', { selectedId: r.e.id })}>
                    <td><Two nowrap main={r.e.nom} sub={`${matricule(r.e.id)} · ${r.e.poste}`} /></td>
                    <td><Tag cls={GNG_CLS[r.status]}>{GNG_LABEL[r.status]}</Tag></td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.reasons.length
                          ? r.reasons.map((x, i) => <span key={i} className={x.level === 'nogo' ? 'note-accent' : 'sub text-n400'}>{x.detailed}</span>)
                          : <span className="sub text-n400">Toutes les exigences sont satisfaites</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel style={{ flex: '1 1 360px' }} title="Réponse transmise à Keystone" aside={detail ? 'Codes et libellés des motifs' : 'Codes de motifs uniquement'}>
            <Pre>{payload}</Pre>
            <Fine>Identifiant : matricule uniquement. Réévalué à chaque consultation. Un changement de verdict d’une ressource (statut ou codes de motif, jamais de libellé) est poussé à Keystone après l’action qui le provoque, après une mise à jour reçue de Keystone et chaque jour (expirations) — suivi dans Paramètres → Envois. Niveau de détail réglable dans les paramètres.</Fine>
          </Panel>
        </div>
      )}
    </Page>
  );
}
