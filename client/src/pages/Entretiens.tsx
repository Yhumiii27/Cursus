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
import { Ouvrir } from '../components/Cliquable.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { decideur } from '../state/delegues.ts';
// lot 12 — C3 (entretiens suivis) : onglets Objectifs et Points de suivi (espaces RH et manager).
import { Seg } from '../components/ui.tsx';
import { OngletObjectifs, OngletPoints } from './EntretiensSuivi.tsx';
import { OngletFeedback360 } from './EntretiensFeedback360.tsx';
import type { OngletEntretiens } from './entretiens-onglets.ts';
import { t } from '../i18n/langue.ts';

const RISK_TEXT = 'Conditions not met — corrective top-up of €3,000 on the CPF (companies of 50 employees or more)';

export function Entretiens() {
  const d = useDomain();
  // Lecture seule : obligations et calendrier, sans les comptes rendus (non transmis).
  const { rh, manager, collab, me, soi } = useRole();
  const { openDialog, switchMode, go, bascule, ui, setUi } = useStore();
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
      due: o.pl ? `${t('Planned on ')}${fmt(parse(o.pl.date))}` : fmt(parse(o.due)),
      rel: o.pl ? `${t('reviewer: ')}${d.mgrName(d.mgrOf(o.e))}` : o.st === 'todo' ? t('not compulsory') : rel(days(d.today, parse(o.due))),
      // Planification réservée au service RH (jamais pour son propre entretien) et au manager direct (le serveur refuse
      // sinon) ; déjà planifié, il se reprogramme.
      canPlan: (rh && o.id !== soi) || (manager && decideur(d, o.e, me, 'entretiens')),
    }));

    const entRows = data.entretiens
      .filter(x => inScope.has(x.empId) && (x.statut === 'planifie' || x.date >= yStart))
      .sort((a, b) => (a.statut === 'planifie' ? 0 : 1) - (b.statut === 'planifie' ? 0 : 1) || a.date.localeCompare(b.date))
      .flatMap(x => {
        const e = d.emp(x.empId);
        if (!e) return [];
        // Planifié à une date passée sans avoir été clos : à clore s'il a eu lieu, sinon à reprogrammer ou annuler.
        const [statut, cls] = x.statut === 'planifie' && x.date < d.ti ? [t('Date passed'), 'tag-accent'] : statutEntretien(x);
        return [{ x, nom: e.nom, eval: `${t('Reviewer: ')}${d.mgrName(d.mgrOf(e))}`, statut, cls }];
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
      ? `${t('Next career review: before ')}${fmt(parse(nextEpp.due))}`
      : t('Labour Code · law no. 2025-989 of 24 October 2025');

    return { obligRows, entRows, k, kicker, scopeIds };
  }, [d, data, year, rh, manager, collab, me, soi]);

  // lot 12 — C3 (entretiens suivis) : onglet de l'écran ; le collaborateur n'a que les échéances et ses comptes rendus.
  // Feedback 360° (étape 3) : onglet du service RH, le module activé.
  const feedback = rh && data.settings.feedback360Actif;
  const onglet: OngletEntretiens = collab || (ui.entOnglet === 'feedback' && !feedback) ? 'echeances' : ui.entOnglet;

  // Le manager a aussi un espace collaborateur (tout compte manager est salarié) : ses propres entretiens s'y trouvent.
  const versMesEntretiens = async () => {
    await switchMode('collaborateur');
    go('entretiens');
  };

  return (
    <Page kicker={v.kicker} title={t('Reviews')}>
      {manager && (
        <div className="boxed" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{t('Your own reviews are prepared and signed in your employee space; your manager conducts them.')}</span>
          <Btn variant="secondary" small disabled={bascule} onClick={versMesEntretiens}>{t('My reviews')}</Btn>
        </div>
      )}
      {/* lot 12 — C3 (entretiens suivis) : onglets, hors de l'espace collaborateur (« Mes objectifs » y a sa page). */}
      {!collab && (
        <Seg name="entOnglet" label={t('Reviews tab')} value={onglet} onChange={o => setUi({ entOnglet: o })} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}
          options={[['echeances', t('Due dates and reports')], ['objectifs', t('Objectives')], ['points', t('Follow-up meetings')], ...(feedback ? [['feedback', t('360° feedback')] as [OngletEntretiens, string]] : [])]} />
      )}
      {onglet === 'feedback' ? <OngletFeedback360 /> : onglet === 'objectifs' ? <OngletObjectifs ids={v.scopeIds} /> : onglet === 'points' ? <OngletPoints ids={v.scopeIds} /> : <>
      {!collab && (
        <Kpis>
          <Kpi kicker={t('Career reviews late')} value={v.k.late} sub={t('first within the year, then every 4 years')} />
          <Kpi kicker={t('Due within 90 days')} value={v.k.soon} sub={t('career reviews')} />
          <Kpi kicker={t('8-year assessments')} value={v.k.bilans} sub={`${v.k.risk}${t(' with a risk of CPF top-up')}`} />
          <Kpi kicker={`${t('Annual campaign ')}${year}`} value={v.k.ann} sub={t('appraisal reviews held')} />
        </Kpis>
      )}

      <div className="row-wrap">
        <Panel style={{ flex: '1 1 560px' }} title={t('Due dates to handle')}>
          {v.obligRows.length > 0 ? (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{t('Employee')}</th><th>{t('Review')}</th><th>{t('Due date')}</th><th>{t('Status')}</th><th></th></tr></thead>
                <tbody>
                  {v.obligRows.map(({ key, o, due, rel: relLabel, canPlan }) => (
                    <tr key={key}>
                      <td><Two main={o.e.nom} sub={equipeLabel(o.e)} nowrap /></td>
                      <td>
                        <Two main={o.libelle ?? ENT_TYPES[o.kind].nom} sub={o.detail} />
                        {o.risk && <div className="note-accent">{t(RISK_TEXT)}</div>}
                      </td>
                      <td><Two main={due} sub={relLabel} nowrap subNowrap /></td>
                      <td><Tag cls={statutObligation(o)[1]}>{statutObligation(o)[0]}</Tag></td>
                      <td className="right">
                        {canPlan && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'entPlan', empId: o.id, kind: o.kind })}>{t(o.pl ? 'Reschedule' : 'Plan')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted empty">{t('No due date to handle.')}</p>}
        </Panel>

        <Panel style={{ flex: '1 1 360px', gap: 'var(--space-2)' }} title={`${t('Reviews ')}${year}`}>
          {v.entRows.map(r => (
            <div key={r.x.id} className={`list-row top${compteRendu ? ' clickable' : ''}`} style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}
              onClick={compteRendu ? () => openDialog({ type: 'ent', entId: r.x.id }) : undefined}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{compteRendu
                  ? <Ouvrir onOpen={() => openDialog({ type: 'ent', entId: r.x.id })}>{r.nom} · {ENT_TYPES[r.x.type].nom}</Ouvrir>
                  : <>{r.nom} · {ENT_TYPES[r.x.type].nom}</>}</div>
                <div className="text-muted sub">{fmt(parse(r.x.date))} · {r.eval}</div>
              </div>
              <Tag cls={r.cls} style={{ flex: 'none' }}>{r.statut}</Tag>
            </div>
          ))}
          {v.entRows.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No review in ')}{year}.</p>}
          <Fine>{t('The career review does not cover the appraisal of work: reports separate from the annual review.')}</Fine>
        </Panel>
      </div>
      </>}
    </Page>
  );
}
