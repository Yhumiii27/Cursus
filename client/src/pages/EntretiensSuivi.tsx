// lot 12 — C3 (entretiens suivis, t194) : onglets « Objectifs » et « Points de suivi » de l'écran Entretiens
// (pages/Entretiens.tsx), espaces RH et manager ; filtres dans l'adresse (state/url.ts : onglet, statut, échéance).
// - Objectifs : indicateurs de la campagne (taux d'entretiens annuels avec objectifs, taux d'objectifs évalués, résultats
//   par équipe masqués sous le seuil d'anonymat, souhaits exprimés, versés, acceptés et réalisés), ce qui attend
//   l'évaluateur avant la clôture (souhaits sans avis, propositions du salarié), puis les objectifs du périmètre, filtrés
//   par statut et par échéance, avec l'avancement et l'ajustement en cours d'année. La lecture seule (direction, DPO,
//   auditeur) et la consultation N+2 ne reçoivent que des compteurs par équipe (server/src/vues-entretiens-suivis.ts) :
//   jamais un libellé ni un résultat individuel.
// - Points de suivi : points de mi-année et points de suivi de l'année, et la planification d'un point pour chaque membre.
//   Facultatifs, sauf réglage `pointMiAnneeActif` (le point de mi-année devient alors une échéance de l'onglet Échéances).
import { useMemo } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { miAnnee } from '../../../shared/rules/entretiens.ts';
import { STATUT_OBJECTIF_LABEL, STATUTS_EVALUATION, estEvalue } from '../../../shared/rules/objectifs.ts';
import { aArbitrer, derniereMiseAJour, HORIZON_OBJECTIFS_JOURS, indicateursSuivi, taux } from '../../../shared/rules/objectifs-suivi.ts';
import { statutEntretien } from '../../../shared/rules/remise.ts';
import type { Objectif } from '../../../shared/types.ts';
import { detailObjectif, STATUT_OBJECTIF_CLS, useEvaluateur } from '../components/EntretienSuivi.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { Bar, Fine, Kpi, Kpis, NoteAccent, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { decideur } from '../state/delegues.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

const pct = (n: number | null) => (n == null ? '—' : `${n} %`);

/** Compteurs par équipe (lecture seule, consultation N+2) : nombres seulement, équipes de moins de 3 salariés masquées. */
function Compteurs({ titre }: { titre?: string }) {
  const d = useDomain();
  const compteurs = d.ds.compteursObjectifs ?? [];
  return (
    <Panel title={titre ?? t('Objectives by team')} aside={t('numbers only')}>
      {compteurs.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">{t('Team')}</th><th scope="col" className="right">{t('Employees#salarie')}</th><th scope="col" className="right">{t('Objectives')}</th><th scope="col" className="right">{t('In progress')}</th><th scope="col" className="right">{t('Evaluated#plural')}</th></tr></thead>
            <tbody>
              {compteurs.map(c => (
                <tr key={c.equipe || '—'}>
                  <th scope="row" style={{ fontWeight: 'normal' }}>{c.equipe || t('No team')}</th>
                  {c.masque
                    ? <td colSpan={4} className="text-muted">{t('Fewer than 3 employees concerned: not shown')}</td>
                    : <><td className="right tnum">{c.salaries}</td><td className="right tnum">{c.objectifs}</td><td className="right tnum">{c.ouverts}</td><td className="right tnum">{c.evalues}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">{t('No objective followed.')}</p>}
      <Fine>{t('Labels, evaluations and reports are sent only to the reviewer, the employee and HR.')}</Fine>
    </Panel>
  );
}

export function OngletObjectifs({ ids }: { ids: number[] }) {
  const d = useDomain();
  const { rh, manager } = useRole();
  const { ui, setUi, openDialog } = useStore();
  const s = d.ds.settings;
  const year = d.year;
  const v = useMemo(() => {
    const perimetre = new Set(ids);
    const objectifs = (d.ds.objectifs ?? []).filter(o => perimetre.has(o.empId));
    const ind = indicateursSuivi(d.ds, perimetre, year);
    const proches = addD(d.ti, HORIZON_OBJECTIFS_JOURS);
    const filtres = objectifs.filter(o => (ui.objStatut === 'tous' || (ui.objStatut === 'ouverts' && o.statut === 'ouvert')
      || (ui.objStatut === 'proposes' && o.statut === 'propose') || (ui.objStatut === 'evalues' && estEvalue(o)))
      && (ui.objEcheance === 'toutes' || (!!o.echeance && o.statut === 'ouvert' && (ui.objEcheance === 'depassees' ? o.echeance < d.ti : o.echeance >= d.ti && o.echeance <= proches))))
      .sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || a.empId - b.empId || a.id - b.id);
    return { ind, filtres, arbitrer: aArbitrer(d.ds.entretiens, d.ds.objectifs ?? [], perimetre), total: objectifs.length };
  }, [d, ids, year, ui.objStatut, ui.objEcheance]);

  // Lecture seule (consultation) et profils sans le droit « rh » : compteurs seulement.
  if (!rh && !manager) return <Compteurs />;
  if (!s.objectifsActifs) return <Panel title={t('Objectives')}><p className="text-muted empty">{t('Objectives are not followed in Cursus (Settings → Objectives and follow-up meetings).')}</p></Panel>;
  const { ind } = v;
  const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));

  return (<>
    <Kpis>
      <Kpi kicker={`${t('Annual reviews ')}${year}${t(' with objectives')}`} value={pct(taux(ind.annuelsAvecObjectifs, ind.annuels))} sub={`${ind.annuelsAvecObjectifs}${t(' out of ')}${tn(ind.annuels, 'annual review closed', 'annual reviews closed')}`} />
      <Kpi kicker={t('Objectives evaluated')} value={pct(taux(ind.evalues, ind.aEvaluer))} sub={`${ind.evalues}${t(' out of ')}${tn(ind.aEvaluer, 'objective', 'objectives')}${t(' of the previous period')}`} />
      <Kpi kicker={`${t('Training wishes ')}${year}`} value={ind.souhaits.exprimes} sub={`${ind.souhaits.favorables}${t(' favourable')} · ${ind.souhaits.verses}${t(' added#wishes')} · ${ind.souhaits.acceptes}${t(' accepted#wishes')} · ${ind.souhaits.realises}${t(' completed#wishes')}`} />
    </Kpis>

    {v.arbitrer.length > 0 && (
      <Panel highlight title={t('To settle before the closing')} aside={tn(v.arbitrer.length, 'review#lower', 'reviews#lower')}>
        <div className="list">
          {v.arbitrer.map(a => {
            const e = d.emp(a.entretien.empId);
            return (
              <div key={a.entretien.id} className="list-row clickable" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }} onClick={() => openDialog({ type: 'ent', entId: a.entretien.id })}>
                <Two main={<Ouvrir onOpen={() => openDialog({ type: 'ent', entId: a.entretien.id })}>{e?.nom ?? d.personName(a.entretien.empId)} · {ENT_TYPES[a.entretien.type].nom}</Ouvrir>}
                  sub={`${t('Planned on ')}${fmtIso(a.entretien.date)}`} />
                <span className="text-muted sub">{[a.souhaits ? tn(a.souhaits, 'wish without opinion', 'wishes without opinion') : '', a.propositions ? tn(a.propositions, 'objective proposed', 'objectives proposed') : ''].filter(Boolean).join(' · ')}</span>
              </div>
            );
          })}
        </div>
      </Panel>
    )}

    <Panel title={t('Team’s objectives')} aside={tn(v.filtres.length, 'objective', 'objectives')}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Seg name="objStatut" label={t('Status of the objectives')} value={ui.objStatut} onChange={x => setUi({ objStatut: x })} style={{ flexWrap: 'wrap' }}
          options={[['tous', t('All#masc')], ['ouverts', t('In progress')], ['proposes', t('Proposed#plural')], ['evalues', t('Evaluated#plural')]]} />
        <Seg name="objEcheance" label={t('Due date of the objectives')} value={ui.objEcheance} onChange={x => setUi({ objEcheance: x })} style={{ flexWrap: 'wrap' }}
          options={[['toutes', t('All due dates')], ['proches', t('Within 30 days')], ['depassees', t('Overdue#fem-plural')]]} />
      </div>
      {v.filtres.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">{t('Employee')}</th><th scope="col">{t('Objective')}</th><th scope="col">{t('Progress')}</th><th scope="col">{t('Status')}</th><th scope="col"></th></tr></thead>
            <tbody>
              {v.filtres.map((o: Objectif) => {
                const e = d.emp(o.empId);
                const fixe = d.ds.entretiens.find(y => y.id === o.entretienId);
                const enCours = o.statut === 'ouvert' && clos.has(o.entretienId);
                return (
                  <tr key={o.id}>
                    <td><Two main={e?.nom ?? d.personName(o.empId)} sub={equipeLabel(e)} nowrap /></td>
                    <td style={{ minWidth: 220 }}><Two main={o.libelle} sub={detailObjectif(o) || (fixe ? `${t('set on ')}${fmtIso(fixe.date)}` : '')} /></td>
                    <td>{enCours
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Bar pct={o.avancement} width={80} /><span className="text-muted sub tnum">{o.avancement} %</span></div>
                      : <span className="text-muted sub">—</span>}
                      {enCours && <div className="text-muted sub nowrap">{t('updated on ')}{fmtIso(derniereMiseAJour(o))}</div>}</td>
                    <td><Tag cls={STATUT_OBJECTIF_CLS[o.statut]}>{STATUT_OBJECTIF_LABEL[o.statut]}</Tag></td>
                    <td className="right"><ActionsObjectif o={o} enCours={enCours} entId={fixe?.statut === 'planifie' ? fixe.id : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">{t(v.total ? 'No objective for these filters.' : 'No objective set: they are set at the annual review.')}</p>}
      <Fine>{t('Objectives set and evaluated at the annual review, adjusted during the year with a reason. No objective in a career review (art. L6315-1).')}</Fine>
    </Panel>

    <Panel title={`${t('Results ')}${year}${t(' by team')}`} aside={t('objectives evaluated in the year')}>
      {ind.resultats.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">{t('Team')}</th>{STATUTS_EVALUATION.map(x => <th key={x} scope="col" className="right">{STATUT_OBJECTIF_LABEL[x]}</th>)}</tr></thead>
            <tbody>
              {ind.resultats.map(r => (
                <tr key={r.equipe || '—'}>
                  <th scope="row" style={{ fontWeight: 'normal' }}>{r.equipe || t('No team')}</th>
                  {r.masque
                    ? <td colSpan={STATUTS_EVALUATION.length} className="text-muted">{t('Fewer than 3 employees evaluated: not shown')}</td>
                    : STATUTS_EVALUATION.map(x => <td key={x} className="right tnum">{r.resultats[x]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">{t('No objective evaluated in ')}{year}.</p>}
      <Fine>{t('Indicators computed, never stored; a team of fewer than 3 employees evaluated is hidden, so that no individual result can be deduced.')}</Fine>
    </Panel>
    {/* Consultation N+2 (t136) : compteurs des équipes consultées, jamais leurs objectifs. */}
    {manager && (d.ds.compteursObjectifs?.length ?? 0) > 0 && <Compteurs titre={t('Teams consulted (read only)')} />}
  </>);
}

/** Actions sur un objectif de la liste : compte rendu de l'entretien planifié qui le fixe, avancement, ajustement. */
function ActionsObjectif({ o, enCours, entId }: { o: Objectif; enCours: boolean; entId: number | null }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const evaluateur = useEvaluateur(d.emp(o.empId));
  if (!evaluateur) return null;
  return (
    <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
      {entId != null && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'ent', entId })}>{t('Report')}</button>}
      {enCours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'objectifAvancer', id: o.id })}>{t('Progress')}</button>}
      {enCours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'objectif', mode: 'ajuster', id: o.id })}>{t('Adjust')}</button>}
    </div>
  );
}

export function OngletPoints({ ids }: { ids: number[] }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { openDialog } = useStore();
  const year = d.year;
  const pm = miAnnee(d.ds.settings, year);
  const v = useMemo(() => {
    const perimetre = new Set(ids);
    const points = d.ds.entretiens.filter(x => perimetre.has(x.empId) && (x.type === 'mi_annee' || x.type === 'point') && (x.statut === 'planifie' || x.date >= `${year}-01-01`))
      .sort((a, b) => (a.statut === 'planifie' ? 0 : 1) - (b.statut === 'planifie' ? 0 : 1) || a.date.localeCompare(b.date));
    const membres = ids.map(id => d.emp(id)).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
      const siens = d.ds.entretiens.filter(x => x.empId === e.id && (x.type === 'mi_annee' || x.type === 'point'));
      const dernier = siens.filter(x => x.statut === 'realise').map(x => x.date).sort().at(-1) ?? null;
      const prevu = siens.find(x => x.statut === 'planifie') ?? null;
      const enCours = (d.ds.objectifs ?? []).filter(o => o.empId === e.id && o.statut === 'ouvert').length;
      return { e, dernier, prevu, enCours };
    });
    return { points, membres };
  }, [d, ids, year]);
  if (!rh && !manager) return <Panel title={t('Follow-up meetings')}><p className="text-muted empty">{t('The reports of follow-up meetings are not sent to this profile.')}</p></Panel>;
  const peutPlanifier = (empId: number) => { const e = d.emp(empId); return !!e && ((rh && empId !== soi) || (manager && decideur(d, e, me, 'entretiens'))); };

  return (<>
    {pm
      ? <NoteAccent>{pm.libelle}{t(': the mid-year meeting is expected of each employee concerned (Due dates tab, summary of the due dates).')}</NoteAccent>
      : <Fine>{t('Mid-year and follow-up meetings optional: they are planned when the reviewer finds it useful (Settings → Objectives and follow-up meetings to make the mid-year meeting compulsory).')}</Fine>}
    <div className="row-wrap">
      <Panel style={{ flex: '1 1 480px' }} title={t('Members')} aside={t('last meeting, next meeting, objectives in progress')}>
        {v.membres.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th scope="col">{t('Employee')}</th><th scope="col">{t('Last meeting')}</th><th scope="col">{t('Next#masc')}</th><th scope="col" className="right">{t('Objectives in progress')}</th><th scope="col"></th></tr></thead>
              <tbody>
                {v.membres.map(({ e, dernier, prevu, enCours }) => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                    <td className="nowrap">{dernier ? fmtIso(dernier) : <span className="text-muted">—</span>}</td>
                    <td className="nowrap">{prevu ? <Ouvrir onOpen={() => openDialog({ type: 'ent', entId: prevu.id })}>{ENT_TYPES[prevu.type].court} · {fmtIso(prevu.date)}</Ouvrir> : <span className="text-muted">—</span>}</td>
                    <td className="right tnum">{enCours}</td>
                    <td className="right">{peutPlanifier(e.id) && !prevu && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'entPlan', empId: e.id, kind: 'mi_annee' })}>{t('Plan a meeting')}</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-muted empty">{t('No employee.')}</p>}
      </Panel>
      <Panel style={{ flex: '1 1 320px', gap: 'var(--space-2)' }} title={`${t('Follow-up meetings ')}${year}`}>
        {v.points.map(x => {
          const e = d.emp(x.empId);
          const [statut, cls] = x.statut === 'planifie' && x.date < d.ti ? [t('Date passed'), 'tag-accent'] : statutEntretien(x);
          return (
            <div key={x.id} className="list-row top clickable" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }} onClick={() => openDialog({ type: 'ent', entId: x.id })}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}><Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{e?.nom ?? d.personName(x.empId)} · {ENT_TYPES[x.type].nom}</Ouvrir></div>
                <div className="text-muted sub">{fmtIso(x.date)}</div>
              </div>
              <Tag cls={cls} style={{ flex: 'none' }}>{statut}</Tag>
            </div>
          );
        })}
        {v.points.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No follow-up meeting in ')}{year}.</p>}
        <Fine>{t('The mid-year meeting and the follow-up meeting only cover the follow-up of the objectives (progress, adjustment): the evaluation is made at the annual review.')}</Fine>
      </Panel>
    </div>
  </>);
}
