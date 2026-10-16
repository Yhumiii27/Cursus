// Entretiens : obligations légales (parcours professionnel, état des lieux 8 ans, forfait jours), campagne annuelle
// (réglée dans Paramètres → Campagne d’entretiens annuels) et comptes rendus de l'année, avec la remise de leur copie.
// Dans l'espace manager, ses propres entretiens n'apparaissent pas : son responsable les mène, et il les prépare et les
// signe dans son espace collaborateur, vers lequel un bouton le renvoie.
import { useMemo } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { days, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, rel } from '../../../shared/format.ts';
import { populationCampagne } from '../../../shared/rules/campagne.ts';
import { obligations, perimetreEntretiens, statutObligation } from '../../../shared/rules/entretiens.ts';
import { statutEntretien } from '../../../shared/rules/remise.ts';
import { Btn, Fine, Kpi, Kpis, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const RISK_TEXT = 'Conditions non remplies — abondement correctif de 3 000 € sur le CPF (entreprises de 50 salariés et plus)';

export function Entretiens() {
  const d = useDomain();
  // Lecture seule : obligations et calendrier, sans les comptes rendus (non transmis).
  const { rh, manager, collab, me, soi } = useRole();
  const { openDialog, switchMode, go, bascule } = useStore();
  const data = d.ds;
  const year = d.year;
  const compteRendu = rh || manager || collab;

  const v = useMemo(() => {
    const yStart = `${year}-01-01`;
    // Manager : son équipe, sans lui-même (échéances, liste, indicateurs ; pastille du menu : layout/Shell.tsx).
    const scopeIds = perimetreEntretiens(data);
    const inScope = new Set(scopeIds);
    const oblig = obligations(d, scopeIds);

    const obligRows = oblig.filter(o => o.st !== 'ok').sort((a, b) => a.due.localeCompare(b.due)).map(o => ({
      key: `${o.id}-${o.kind}`, o,
      due: o.pl ? `Prévu le ${fmt(parse(o.pl.date))}` : fmt(parse(o.due)),
      rel: o.pl ? `évaluateur : ${d.mgrName(d.mgrOf(o.e))}` : o.st === 'todo' ? 'non obligatoire' : rel(days(d.today, parse(o.due))),
      // Planification réservée au service RH (jamais pour son propre entretien) et au manager direct (le serveur refuse
      // sinon) ; déjà planifié, il se reprogramme.
      canPlan: (rh && o.id !== soi) || (manager && d.mgrOf(o.e) === me),
    }));

    const entRows = data.entretiens
      .filter(x => inScope.has(x.empId) && (x.statut === 'planifie' || x.date >= yStart))
      .sort((a, b) => (a.statut === 'planifie' ? 0 : 1) - (b.statut === 'planifie' ? 0 : 1) || a.date.localeCompare(b.date))
      .flatMap(x => {
        const e = d.emp(x.empId);
        if (!e) return [];
        // Planifié à une date passée sans avoir été clos : à clore s'il a eu lieu, sinon à reprogrammer ou annuler.
        const [statut, cls] = x.statut === 'planifie' && x.date < d.ti ? ['Date dépassée', 'tag-accent'] : statutEntretien(x);
        return [{ x, nom: e.nom, eval: `Évaluateur : ${d.mgrName(d.mgrOf(e))}`, statut, cls }];
      });

    const eppO = oblig.filter(o => o.kind === 'epp');
    // Population de la campagne, selon ses réglages (intérim toujours exclu).
    const annO = populationCampagne(d, scopeIds);
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
  }, [d, data, year, rh, manager, collab, me, soi]);

  // Le manager a aussi un espace collaborateur (tout compte manager est salarié) : ses propres entretiens s'y trouvent.
  const versMesEntretiens = async () => {
    await switchMode('collaborateur');
    go('entretiens');
  };

  return (
    <Page kicker={v.kicker} title="Entretiens">
      {manager && (
        <div className="boxed" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>Vos propres entretiens se préparent et se signent dans votre espace collaborateur ; votre responsable les conduit.</span>
          <Btn variant="secondary" small disabled={bascule} onClick={versMesEntretiens}>Mes entretiens</Btn>
        </div>
      )}
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
                      <td><Tag cls={statutObligation(o)[1]}>{statutObligation(o)[0]}</Tag></td>
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
            <div key={r.x.id} className={`list-row top${compteRendu ? ' clickable' : ''}`} style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}
              onClick={compteRendu ? () => openDialog({ type: 'ent', entId: r.x.id }) : undefined}>
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
