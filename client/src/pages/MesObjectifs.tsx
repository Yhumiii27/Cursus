// lot 12 — C3 (entretiens suivis, t194) : « Mes objectifs », espace collaborateur. Le salarié y suit ses objectifs en
// cours (avancement de 0 à 100 % et court commentaire, `objectif.avancer`), voit ses propositions en attente de validation
// (et les retire), l'historique des objectifs évalués, et ses souhaits de formation exprimés en entretien avec la suite
// donnée par le service RH. Lisible depuis l'application installée ; l'avancement ne se saisit pas hors ligne au premier
// temps (pas d'action dans la file d'attente de l'appareil). Ouvert seulement si le réglage `objectifsActifs` l'est.
import { useMemo } from 'react';
import { ENT_TYPES, REQ_CLS, REQ_LABEL } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { estEvalue, STATUT_OBJECTIF_LABEL, TYPES_FIXATION } from '../../../shared/rules/objectifs.ts';
import { derniereMiseAJour, objectifsAMettreAJour } from '../../../shared/rules/objectifs-suivi.ts';
import { AVIS_SOUHAIT_LABEL, NON_VERSE_LABEL, souhaitsDe } from '../../../shared/rules/souhaits.ts';
import type { Objectif } from '../../../shared/types.ts';
import { detailObjectif, nomSouhait, STATUT_OBJECTIF_CLS } from '../components/EntretienSuivi.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { Bar, Empty, Fine, NoteAccent, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { retraitProposition } from '../state/confirmations-objectifs.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function MesObjectifs() {
  const d = useDomain();
  const { me } = useRole();
  const { openDialog } = useStore();
  const v = useMemo(() => {
    const miens = (d.ds.objectifs ?? []).filter(o => o.empId === me);
    const clos = new Set(d.ds.entretiens.filter(x => x.statut === 'realise').map(x => x.id));
    const parEcheance = (a: Objectif, b: Objectif) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || a.id - b.id;
    return {
      enCours: miens.filter(o => o.statut === 'ouvert' && clos.has(o.entretienId)).sort(parEcheance),
      // Fixés ou proposés à un entretien annuel encore planifié : en préparation.
      enPreparation: miens.filter(o => !clos.has(o.entretienId) && (o.statut === 'ouvert' || o.statut === 'propose')).sort(parEcheance),
      evalues: miens.filter(o => estEvalue(o)).sort((a, b) => b.id - a.id),
      aMettreAJour: new Set(me ? objectifsAMettreAJour(d.ds.objectifs ?? [], d.ds.entretiens, me, d.ti).map(o => o.id) : []),
      // Entretien annuel planifié : on peut y proposer un objectif.
      annuel: d.ds.entretiens.find(x => x.empId === me && x.statut === 'planifie' && TYPES_FIXATION.includes(x.type)) ?? null,
      souhaits: d.ds.entretiens.filter(x => x.empId === me).sort((a, b) => b.date.localeCompare(a.date)).flatMap(x => souhaitsDe(x).map(s => ({ x, s }))),
    };
  }, [d, me]);
  const entretienDe = (o: Objectif) => d.ds.entretiens.find(x => x.id === o.entretienId);

  return (
    <Page kicker={t('Followed reviews')} title={t('My objectives')} note={t('Objectives set at your annual review: update their progress during the year; they are evaluated at the next annual review.')}>
      {v.aMettreAJour.size > 0 && <NoteAccent>{tn(v.aMettreAJour.size, 'objective nears', 'objectives near')}{t(' its due date without an update for a month: say where you stand.')}</NoteAccent>}
      <Panel title={t('In progress')} aside={tn(v.enCours.length, 'objective', 'objectives')}>
        {v.enCours.length > 0 ? (
          <div className="list">
            {v.enCours.map(o => (
              <div key={o.id} className="list-row stack">
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{o.libelle}</div>
                    <div className="text-muted sub">{detailObjectif(o)}</div>
                    {o.mesure && <div className="text-muted sub">{t('Measure: ')}{o.mesure}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                      <Bar pct={o.avancement} width={140} /><span className="text-muted sub tnum">{o.avancement} % · {t('updated on ')}{fmtIso(derniereMiseAJour(o))}</span>
                    </div>
                    {o.commentaireSal && <div className="text-muted sub">{t('My comment: ')}{o.commentaireSal}</div>}
                  </div>
                  {v.aMettreAJour.has(o.id) ? <Tag cls="tag-accent" style={{ flex: 'none' }}>{t('To update')}</Tag> : <Tag cls="tag-neutral" style={{ flex: 'none' }}>{t('In progress')}</Tag>}
                </div>
                <div className="actions-end">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'objectifAvancer', id: o.id })}>{t('Update the progress')}</button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>{t('No objective in progress. Objectives are set at the annual review.')}</Empty>}
      </Panel>

      {(v.enPreparation.length > 0 || v.annuel) && (
        <Panel title={t('In preparation')} aside={v.annuel ? `${t('annual review planned on ')}${fmtIso(v.annuel.date)}` : undefined}>
          {v.enPreparation.length > 0 && (
            <div className="list">
              {v.enPreparation.map(o => (
                <div key={o.id} className="list-row stack">
                  <div className="item-head">
                    <Two main={o.libelle} sub={detailObjectif(o)} />
                    <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{t(o.statut === 'propose' ? 'Proposed, to approve' : 'Set#objective')}</Tag>
                  </div>
                  {o.statut === 'propose' && (
                    <div className="actions-end">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: retraitProposition(o) })}>{t('Withdraw my proposal')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {v.annuel && (
            <div className="actions-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'ent', entId: v.annuel!.id })}>{t('Open the report')}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'objectif', mode: 'proposer', entretienId: v.annuel!.id })}>{t('Propose an objective')}</button>
            </div>
          )}
          <Fine>{t('Your reviewer approves or rephrases your proposals before closing the review.')}</Fine>
        </Panel>
      )}

      <Panel title={t('Evaluated#plural')} aside={tn(v.evalues.length, 'objective', 'objectives')}>
        {v.evalues.length > 0 ? (
          <div className="list">
            {v.evalues.map(o => {
              const x = entretienDe(o);
              return (
                <div key={o.id} className="list-row stack">
                  <div className="item-head">
                    <Two main={o.libelle} sub={`${x ? `${t('Set at the review of ')}${fmtIso(x.date)}` : ''}${o.evaluation ? ` · ${o.evaluation}` : ''}`} />
                    <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{STATUT_OBJECTIF_LABEL[o.statut]}</Tag>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>{t('No objective evaluated yet.')}</Empty>}
      </Panel>

      <Panel title={t('My training wishes')} aside={t('expressed in a review')}>
        {v.souhaits.length > 0 ? (
          <div className="list">
            {v.souhaits.map(({ x, s }) => {
              const r = s.demandeId ? d.ds.demandesCollab.find(y => y.id === s.demandeId) : undefined;
              return (
                <div key={`${x.id}-${s.cle}`} className="list-row stack">
                  <div className="item-head">
                    <Two main={nomSouhait(d, s)} sub={<><Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{ENT_TYPES[x.type].nom}{t(' of #date')}{fmtIso(x.date)}</Ouvrir>{s.avis ? ` · ${t('opinion ')}${AVIS_SOUHAIT_LABEL[s.avis].toLowerCase()}` : ''}</>} />
                    {s.nonVerse ? <Tag cls="tag-outline" style={{ flex: 'none' }}>{NON_VERSE_LABEL[s.nonVerse]}</Tag>
                      : r ? <Tag cls={REQ_CLS[r.statut]} style={{ flex: 'none' }}>{t('Request ')}{REQ_LABEL[r.statut].toLowerCase()}</Tag>
                      : <Tag cls="tag-outline" style={{ flex: 'none' }}>{t(x.statut === 'planifie' ? 'In preparation' : 'In the report')}</Tag>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>{t('No training wish expressed in a review.')}</Empty>}
        <Fine>{t('A wish with a favourable opinion of your manager becomes, at the closing of the review, a request to HR, who decides what follows.')}</Fine>
      </Panel>
    </Page>
  );
}
