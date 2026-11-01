// lot 12 — C3 (entretiens suivis, t194) : « Mes objectifs », espace collaborateur. Le salarié y suit ses objectifs en
// cours (avancement de 0 à 100 % et court commentaire, `objectif.avancer`), voit ses propositions en attente de validation
// (et les retire), l'historique des objectifs évalués, et ses souhaits de formation exprimés en entretien avec la suite
// donnée par le service RH. Lisible depuis l'application installée ; l'avancement ne se saisit pas hors ligne au premier
// temps (pas d'action dans la file d'attente de l'appareil). Ouvert seulement si le réglage `objectifsActifs` l'est.
import { useMemo } from 'react';
import { ENT_TYPES, REQ_CLS, REQ_LABEL } from '../../../shared/constants.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
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
    <Page kicker="Entretiens suivis" title="Mes objectifs" note="Objectifs fixés à votre entretien annuel : mettez à jour leur avancement en cours d’année ; ils sont évalués à l’entretien annuel suivant.">
      {v.aMettreAJour.size > 0 && <NoteAccent>{plural(v.aMettreAJour.size, 'objectif approche', 'objectifs approchent')} de son échéance sans mise à jour depuis un mois : indiquez où vous en êtes.</NoteAccent>}
      <Panel title="En cours" aside={plural(v.enCours.length, 'objectif', 'objectifs')}>
        {v.enCours.length > 0 ? (
          <div className="list">
            {v.enCours.map(o => (
              <div key={o.id} className="list-row stack">
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{o.libelle}</div>
                    <div className="text-muted sub">{detailObjectif(o)}</div>
                    {o.mesure && <div className="text-muted sub">Mesure : {o.mesure}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                      <Bar pct={o.avancement} width={140} /><span className="text-muted sub tnum">{o.avancement} % · mis à jour le {fmtIso(derniereMiseAJour(o))}</span>
                    </div>
                    {o.commentaireSal && <div className="text-muted sub">Mon commentaire : {o.commentaireSal}</div>}
                  </div>
                  {v.aMettreAJour.has(o.id) ? <Tag cls="tag-accent" style={{ flex: 'none' }}>À mettre à jour</Tag> : <Tag cls="tag-neutral" style={{ flex: 'none' }}>En cours</Tag>}
                </div>
                <div className="actions-end">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'objectifAvancer', id: o.id })}>Mettre à jour l’avancement</button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>Aucun objectif en cours. Les objectifs se fixent à l’entretien annuel.</Empty>}
      </Panel>

      {(v.enPreparation.length > 0 || v.annuel) && (
        <Panel title="En préparation" aside={v.annuel ? `entretien annuel prévu le ${fmtIso(v.annuel.date)}` : undefined}>
          {v.enPreparation.length > 0 && (
            <div className="list">
              {v.enPreparation.map(o => (
                <div key={o.id} className="list-row stack">
                  <div className="item-head">
                    <Two main={o.libelle} sub={detailObjectif(o)} />
                    <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{o.statut === 'propose' ? 'Proposé, à valider' : 'Fixé'}</Tag>
                  </div>
                  {o.statut === 'propose' && (
                    <div className="actions-end">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: retraitProposition(o) })}>Retirer ma proposition</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {v.annuel && (
            <div className="actions-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'ent', entId: v.annuel!.id })}>Ouvrir le compte rendu</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'objectif', mode: 'proposer', entretienId: v.annuel!.id })}>Proposer un objectif</button>
            </div>
          )}
          <Fine>Votre évaluateur valide ou reformule vos propositions avant de clore l’entretien.</Fine>
        </Panel>
      )}

      <Panel title="Évalués" aside={plural(v.evalues.length, 'objectif', 'objectifs')}>
        {v.evalues.length > 0 ? (
          <div className="list">
            {v.evalues.map(o => {
              const x = entretienDe(o);
              return (
                <div key={o.id} className="list-row stack">
                  <div className="item-head">
                    <Two main={o.libelle} sub={`${x ? `Fixé à l’entretien du ${fmtIso(x.date)}` : ''}${o.evaluation ? ` · ${o.evaluation}` : ''}`} />
                    <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{STATUT_OBJECTIF_LABEL[o.statut]}</Tag>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>Aucun objectif évalué pour l’instant.</Empty>}
      </Panel>

      <Panel title="Mes souhaits de formation" aside="exprimés en entretien">
        {v.souhaits.length > 0 ? (
          <div className="list">
            {v.souhaits.map(({ x, s }) => {
              const r = s.demandeId ? d.ds.demandesCollab.find(y => y.id === s.demandeId) : undefined;
              return (
                <div key={`${x.id}-${s.cle}`} className="list-row stack">
                  <div className="item-head">
                    <Two main={nomSouhait(d, s)} sub={<><Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{ENT_TYPES[x.type].nom} du {fmtIso(x.date)}</Ouvrir>{s.avis ? ` · avis ${AVIS_SOUHAIT_LABEL[s.avis].toLowerCase()}` : ''}</>} />
                    {s.nonVerse ? <Tag cls="tag-outline" style={{ flex: 'none' }}>{NON_VERSE_LABEL[s.nonVerse]}</Tag>
                      : r ? <Tag cls={REQ_CLS[r.statut]} style={{ flex: 'none' }}>Demande {REQ_LABEL[r.statut].toLowerCase()}</Tag>
                      : <Tag cls="tag-outline" style={{ flex: 'none' }}>{x.statut === 'planifie' ? 'En préparation' : 'Au compte rendu'}</Tag>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty>Aucun souhait de formation exprimé en entretien.</Empty>}
        <Fine>Un souhait à avis favorable de votre manager devient, à la clôture de l’entretien, une demande au service RH, qui décide de la suite.</Fine>
      </Panel>
    </Page>
  );
}
