// Congés & absences : soldes CP / RTT / récupération / CET, demandes à valider,
// règles appliquées (CCN Industries chimiques).
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ABS_CLS, ABS_LABEL, ABS_ST, STATUTS } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { cpPeriods, parse } from '../../../shared/dates.ts';
import { equipeLabel, fH, fJ, fmt, fmtShort, plural } from '../../../shared/format.ts';
import { absenceKinds, cetInfo, cpInfo, recupInfo, reposForfait, rttInfo } from '../../../shared/rules/conges.ts';
import type { Employe } from '../../../shared/types.ts';
import { Empty, Kpi, Kpis, Page, Panel, Tag, Two, stop } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/**
 * Soldes d'un collaborateur, mis en forme pour le tableau et les cartes.
 * Intérim : congés gérés par l'agence — ni absence à poser, ni compte épargne-temps.
 */
function soldeRow(d: Domain, e: Employe) {
  const c = d.contratOf(e), cp = cpInfo(d, e), rt = rttInfo(d, e), rc = recupInfo(d, e), ct = cetInfo(d, e);
  const cet = !c.interim && ct.eligible;
  return {
    e, cpSolde: cp ? cp.solde : 0, cetPlaceable: cet && (ct.placeCp > 0 || ct.placeRtt > 0),
    poser: absenceKinds(d, e).length > 0, cpGere: !!cp,
    contrat: `${STATUTS[c.statut].court} · ${c.label}`,
    cp: cp ? fJ(cp.solde) : 'Agence',
    cpSub: cp
      ? `sur ${cp.droit} j${cp.ageSupp ? ' · dont 5 j CCN (59 ans et +)' : ''}${cp.recu ? ` · report +${cp.recu} j` : ''}${cp.accorde ? ` · ${cp.accorde} j protégés au-delà du 31 mai` : ''}`
      : 'géré par l’agence d’intérim',
    cpN: cp ? fJ(cp.enCours) : '—',
    rtt: rt ? fJ(rt.solde) : '—',
    rttSub: rt ? `${rt.label} · sur ${rt.droit} j · perdus au 31 déc.` : 'non concerné',
    rttLabel: rt ? rt.label : 'RTT',
    rttCard: rt ? `sur ${rt.droit} j · perdus au 31 déc.`
      : c.dirigeant ? 'cadre dirigeant : congés payés uniquement'
      : c.annuel ? 'forfait annuel en heures : pas de RTT'
      : 'non concerné',
    rec: rc ? fH(rc.solde) : '—',
    recSub: rc ? `≈ ${fJ(rc.solde / rc.dh)}` : 'non concerné',
    cet: cet ? fJ(ct.total) : '—',
    cetSub: cet ? (ct.total ? `${ct.cp} j CP · ${ct.rtt} j RTT` : 'aucun jour épargné') : 'non concerné',
  };
}

function Num({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <><div className="tnum">{main}</div>{sub != null && <div className="text-muted sub">{sub}</div>}</>;
}

export function Absences() {
  const d = useDomain();
  const data = d.ds;
  const { rh, manager, collab, me } = useRole();
  const { openDialog, run } = useStore();
  const P = cpPeriods(data.today);
  const Y = d.year;

  const rows = data.employes.map(e => soldeRow(d, e)).sort((a, b) => a.e.nom.localeCompare(b.e.nom));
  const mine = collab ? rows.find(r => r.e.id === me) : undefined;
  // « Poser une absence » pour soi-même : masqué quand aucun type n'est ouvert (intérim).
  const canPoseMe = !rh && !!rows.find(r => r.e.id === me)?.poser;
  const canCet = (r: ReturnType<typeof soldeRow>) => (rh || r.e.id === me) && r.cetPlaceable;

  const absList = data.absences
    .filter(a => a.au >= P.prisStart)
    .map(a => ({ a, e: d.emp(a.empId) }))
    .filter((x): x is { a: typeof x.a; e: Employe } => !!x.e)
    .sort((x, y) => (x.a.statut === 'demandee' ? 0 : 1) - (y.a.statut === 'demandee' ? 0 : 1) || x.a.du.localeCompare(y.a.du))
    .map(({ a, e }) => ({ a, e, canDecide: a.statut === 'demandee' && (rh || (manager && d.mgrOf(e) === me)) }));
  const nDecide = absList.filter(x => x.canDecide).length;

  return (
    <Page
      kicker={rh ? 'Période de référence CP : 1er juin – 31 mai · décompte en jours ouvrés · CCN Industries chimiques' : 'Congés payés en jours ouvrés · RTT perdus au 31 décembre'}
      title="Congés & absences"
      actions={canPoseMe && me != null ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'abs', empId: me })}>Poser une absence</button> : undefined}
    >
      {mine && (
        <Kpis>
          <Kpi kicker={`Congés payés ${P.label}`} value={mine.cp} sub={mine.cpGere ? `${mine.cpSub} · avant le ${fmt(parse(P.deadline))}` : mine.cpSub} />
          <Kpi kicker="En cours d’acquisition" value={mine.cpN} sub={mine.cpGere ? `période ${P.labelN} · 2,08 j par mois` : 'géré par l’agence d’intérim'} />
          <Kpi kicker={`${mine.rttLabel} ${Y}`} value={mine.rtt} sub={mine.rttCard} />
          <Kpi kicker="Récupération" value={mine.rec} sub={mine.recSub} />
          <Kpi kicker="Compte épargne-temps" value={mine.cet} sub={mine.cetSub}
            action={canCet(mine) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: mine.e.id })}>Épargner</button> : undefined} />
        </Kpis>
      )}

      {!collab && (
        <Panel title="Soldes">
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>CP {P.label}</th><th>En acquisition</th><th>RTT / repos {Y}</th><th>Récupération</th><th>CET</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const canPose = r.poser && (rh || r.e.id === me || (manager && d.mgrOf(r.e) === me));
                  return (
                    <tr key={r.e.id}>
                      <td><Two main={r.e.nom} sub={r.contrat} nowrap /></td>
                      <td><Num main={r.cp} sub={r.cpSub} /></td>
                      <td className="tnum">{r.cpN}</td>
                      <td><Num main={r.rtt} sub={r.rttSub} /></td>
                      <td><Num main={r.rec} sub={r.recSub} /></td>
                      <td><Num main={r.cet} sub={r.cetSub} /></td>
                      <td className="right">
                        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {canCet(r) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: r.e.id })}>Épargner</button>}
                          {rh && r.cpSolde > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'report', empId: r.e.id })}>Reporter</button>}
                          {canPose && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'abs', empId: r.e.id })}>Poser</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Demandes et absences prévues" aside={`${plural(nDecide, 'demande à valider', 'demandes à valider')} · absences validées transmises à Keystone pour la planification`}>
        {absList.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Absence</th><th>Jours</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {absList.map(({ a, e, canDecide }) => {
                  const m = data.missions.find(x => x.empId === a.empId && x.du <= a.au && x.au >= a.du);
                  const ks = a.statut === 'validee' ? 'Transmise à Keystone' : a.statut === 'demandee' ? `Validation : ${d.mgrName(d.mgrOf(e))}` : '';
                  return (
                    <tr key={a.id}>
                      <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                      <td>
                        <div>{ABS_LABEL[a.type]} · {a.du === a.au ? fmt(parse(a.du)) : `${fmtShort(parse(a.du))} → ${fmt(parse(a.au))}`}</div>
                        {m && <div className="note-accent">Chevauche la mission {m.projet} · {m.lieu}</div>}
                      </td>
                      <td className="tnum nowrap">{fJ(d.countDays(e, a.du, a.au, a.type))}</td>
                      <td>
                        <Tag cls={ABS_CLS[a.statut]}>{ABS_ST[a.statut]}</Tag>
                        <div className="text-muted sub-11" style={{ marginTop: 'var(--space-1)' }}>{ks}</div>
                      </td>
                      <td className="right">
                        {canDecide && (
                          <div className="actions-end">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => run('absence.decider', { id: a.id, ok: false }))}>Refuser</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={stop(() => run('absence.decider', { id: a.id, ok: true }))}>Valider</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucune absence prévue.</Empty>}
      </Panel>

      {rh && (
        <Panel title="Règles appliquées">
          <Rtt39Field />
          <ul className="rules">
            <li>Congés payés : 25 jours ouvrés par an, acquis à raison de 2,08 j par mois du 1er juin au 31 mai, arrondis à l’entier supérieur.</li>
            <li>CCN Industries chimiques : pas de congés d’ancienneté ; +5 jours ouvrés à partir de 59 ans.</li>
            <li>Forfait annuel en jours : jours de repos calculés individuellement selon le nombre de jours du forfait (jours calendaires − week-ends − 25 CP − fériés ouvrés − jours du forfait) ; {reposForfait(Y, 218)} jours en {Y} pour un forfait de 218 jours.</li>
            <li>Forfait annuel en heures : pas de RTT ni de repos compensateur hebdomadaire ; les heures au-delà du forfait sont régularisées en fin d’année.</li>
            <li>Forfait hebdomadaire en heures : heures supplémentaires incluses au forfait (au-delà de 35 h) majorées dans la rémunération ; repos compensateur pour les heures effectuées au-delà du forfait.</li>
            <li>Cadre dirigeant (art. L3111-2) : congés payés uniquement — ni RTT, ni repos compensateur.</li>
            <li>Temps partiel : même droit à congés ; le décompte des CP inclut les jours non travaillés de la période.</li>
            <li>Report d’une année sur l’autre : CP uniquement, au cas par cas par le service RH. RTT perdus au 31 décembre.</li>
            <li>Compte épargne-temps : jusqu’à 5 RTT par an (avant le 31 décembre) et 5 CP par période, uniquement ceux de la 5e semaine (au-delà de 20 jours ouvrés).</li>
            <li>Intérim : congés gérés par l’agence ; CDD : indemnité compensatrice des CP non pris à l’échéance.</li>
          </ul>
        </Panel>
      )}
    </Page>
  );
}

/** Nombre de RTT des contrats 39 h : enregistré à la sortie du champ ou sur Entrée. */
function Rtt39Field() {
  const d = useDomain();
  const { run } = useStore();
  const value = Number(d.ds.settings.rtt39) || 0;
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(String(value)); }

  const commit = async () => {
    const n = Math.max(0, Math.min(40, Math.round(Number(text) || 0)));
    setText(String(n));
    if (n === value) return;
    const r = await run('parametres.maj', { rtt39: n, silent: true });
    if (!r.ok) setText(String(value));
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => { if (ev.key === 'Enter') ev.currentTarget.blur(); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 14 }}>
      <label htmlFor="rtt39">Contrats 39 h : nombre de RTT par an</label>
      <input className="input" id="rtt39" type="number" min={0} max={40} value={text} onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={onKey} style={{ width: 80, textAlign: 'right' }} />
    </div>
  );
}
