// Entretiens : obligations légales (parcours professionnel, état des lieux 8 ans, forfait jours),
// campagne annuelle et comptes rendus de l'année.
import { useMemo } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { days, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, rel } from '../../../shared/format.ts';
import { ENT_ST, obligations } from '../../../shared/rules/entretiens.ts';
import { Fine, Kpi, Kpis, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const RISK_TEXT = 'Conditions non remplies — abondement correctif de 3 000 € sur le CPF (entreprises de 50 salariés et plus)';

export function Entretiens() {
  const d = useDomain();
  const { rh, manager, collab, me } = useRole();
  const { openDialog } = useStore();
  const data = d.ds;
  const year = d.year;

  const v = useMemo(() => {
    const yStart = `${year}-01-01`;
    const scopeIds = data.employes.map(e => e.id);
    const inScope = new Set(scopeIds);
    const oblig = obligations(d, scopeIds);

    const obligRows = oblig.filter(o => o.st !== 'ok').sort((a, b) => a.due.localeCompare(b.due)).map(o => ({
      key: `${o.id}-${o.kind}`, o,
      due: o.pl ? `Prévu le ${fmt(parse(o.pl.date))}` : fmt(parse(o.due)),
      rel: o.pl ? `évaluateur : ${d.mgrName(d.mgrOf(o.e))}` : o.st === 'todo' ? 'non obligatoire' : rel(days(d.today, parse(o.due))),
      // Planification réservée au service RH et au manager direct (le serveur refuse sinon) ; déjà planifié, il se reprogramme.
      canPlan: rh || (manager && d.mgrOf(o.e) === me),
    }));

    const entRows = data.entretiens
      .filter(x => inScope.has(x.empId) && (x.statut === 'planifie' || x.date >= yStart))
      .sort((a, b) => (a.statut === 'planifie' ? 0 : 1) - (b.statut === 'planifie' ? 0 : 1) || a.date.localeCompare(b.date))
      .flatMap(x => {
        const e = d.emp(x.empId);
        if (!e) return [];
        const [statut, cls] = x.statut === 'planifie' ? ['Planifié', 'tag-outline'] : !x.signSal ? ['À signer', 'tag-outline'] : ['Signé', 'tag-neutral'];
        return [{ x, nom: e.nom, eval: `Évaluateur : ${d.mgrName(d.mgrOf(e))}`, statut, cls }];
      });

    const eppO = oblig.filter(o => o.kind === 'epp');
    const annO = data.employes.filter(e => !d.contratOf(e).interim).map(e => e.id);
    const annDone = annO.filter(id => data.entretiens.some(x => x.empId === id && x.type === 'annuel' && x.statut === 'realise' && x.date >= yStart)).length;
    const k = {
      late: eppO.filter(o => o.st === 'late').length,
      soon: eppO.filter(o => o.st === 'soon').length,
      bilans: oblig.filter(o => o.kind === 'bilan').length,
      risk: oblig.filter(o => o.risk).length,
      ann: `${annDone} / ${annO.length}`,
    };

    const nextEpp = oblig.find(o => o.kind === 'epp');
    const kicker = collab && nextEpp
      ? `Prochain entretien de parcours professionnel : avant le ${fmt(parse(nextEpp.due))}`
      : 'Code du travail · loi n° 2025-989 du 24 octobre 2025';

    return { obligRows, entRows, k, kicker };
  }, [d, data, year, rh, manager, collab, me]);

  return (
    <Page kicker={v.kicker} title="Entretiens">
      {!collab && (
        <Kpis>
          <Kpi kicker="Parcours pro en retard" value={v.k.late} sub="premier dans l’année, puis tous les 4 ans" />
          <Kpi kicker="À échéance sous 90 jours" value={v.k.soon} sub="entretiens de parcours professionnel" />
          <Kpi kicker="États des lieux 8 ans" value={v.k.bilans} sub={`${v.k.risk} avec risque d’abondement CPF`} />
          <Kpi kicker={`Campagne annuelle ${year}`} value={v.k.ann} sub="entretiens d’évaluation réalisés" />
        </Kpis>
      )}

      <div className="row-wrap">
        <Panel style={{ flex: '1 1 560px' }} title="Échéances à traiter">
          {v.obligRows.length > 0 ? (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Collaborateur</th><th>Entretien</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
                <tbody>
                  {v.obligRows.map(({ key, o, due, rel: relLabel, canPlan }) => (
                    <tr key={key}>
                      <td><Two main={o.e.nom} sub={equipeLabel(o.e)} nowrap /></td>
                      <td>
                        <Two main={ENT_TYPES[o.kind].nom} sub={o.detail} />
                        {o.risk && <div className="note-accent">{RISK_TEXT}</div>}
                      </td>
                      <td><Two main={due} sub={relLabel} nowrap subNowrap /></td>
                      <td><Tag cls={ENT_ST[o.st][1]}>{ENT_ST[o.st][0]}</Tag></td>
                      <td className="right">
                        {canPlan && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'entPlan', empId: o.id, kind: o.kind })}>{o.pl ? 'Reprogrammer' : 'Planifier'}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted empty">Aucune échéance à traiter.</p>}
        </Panel>

        <Panel style={{ flex: '1 1 360px', gap: 'var(--space-2)' }} title={`Entretiens ${year}`}>
          {v.entRows.map(r => (
            <div key={r.x.id} className="list-row top clickable" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}
              onClick={() => openDialog({ type: 'ent', entId: r.x.id })}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{r.nom} · {ENT_TYPES[r.x.type].nom}</div>
                <div className="text-muted sub">{fmt(parse(r.x.date))} · {r.eval}</div>
              </div>
              <Tag cls={r.cls} style={{ flex: 'none' }}>{r.statut}</Tag>
            </div>
          ))}
          {v.entRows.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun entretien en {year}.</p>}
          <Fine>L’entretien de parcours professionnel ne porte pas sur l’évaluation du travail : comptes rendus distincts de l’entretien annuel.</Fine>
        </Panel>
      </div>
    </Page>
  );
}
