// Catalogue des formations : titulaires, renouvellements et sessions à venir.
// Le RH gère les sessions ; le manager suit son équipe et planifie ses recyclages.
import { useMemo, type ReactNode } from 'react';
import { CalendarBlankIcon, PlusIcon } from '@phosphor-icons/react';
import { CERT_LABEL, CLS } from '../../../shared/constants.ts';
import type { CertInfo, EmpX } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtShort, plural, rel, validiteLabel } from '../../../shared/format.ts';
import { Bar, Btn, Empty, Fine, Page, Panel, Seg, Tag, Two, stop } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore, type UiState } from '../state/store.tsx';
import { sessionView } from './Dashboard.tsx';

const TYPES: Record<UiState['typeForm'], string | null> = { toutes: null, reg: 'Réglementaire', rec: 'Recommandée', int: 'Interne' };

/** Carte de catalogue sélectionnable (formations, habilitations) : un clic bascule le filtre. */
export function PickCard({ kicker, title, body, stats, meta, selected, onClick }: {
  kicker: ReactNode; title: ReactNode; body: ReactNode; stats: [number, string][]; meta: ReactNode; selected: boolean; onClick: () => void;
}) {
  return (
    <article className={`card elev-sm pick${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="card-kicker">{kicker}</div>
      <div className="card-title">{title}</div>
      <p className="card-body dim">{body}</p>
      <div className="stat-trio">
        {stats.map(([v, l]) => <div key={l}><div className="v">{v}</div><div className="text-muted sub-11">{l}</div></div>)}
      </div>
      <div className="card-meta">{meta}</div>
    </article>
  );
}

/** Certification d'un membre de l'équipe à renouveler (ou expirée) sans session planifiée. */
interface Renewal { e: EmpX; c: CertInfo; demande: string | null }

export function Formations() {
  const { emps, forms, upcoming, d } = useEnriched();
  const { rh, manager, me } = useRole();
  const { ui, setUi, go, openDialog } = useStore();

  // Manager : les membres des équipes qu'il encadre (hors lui-même). RH : tout le monde.
  const teams = useMemo(() => manager ? d.teamsOf(me) : [], [d, manager, me]);
  const scope = useMemo(() => manager ? emps.filter(e => e.id !== me && d.mgrOf(e) === me) : emps, [d, emps, manager, me]);

  const cards = useMemo(() => {
    const allCerts = scope.flatMap(e => e.certs);
    const typeSel = TYPES[ui.typeForm];
    return forms.filter(f => !typeSel || f.type === typeSel).map(f => {
      const holders = allCerts.filter(c => c.f === f.id);
      const next = upcoming.find(s => s.formation === f.id);
      return {
        f,
        titulaires: holders.length, due: holders.filter(c => c.key === 'due').length, exp: holders.filter(c => c.key === 'exp').length,
        next: next ? `Prochaine session le ${fmtShort(parse(next.date))} · ${plural(Math.max(0, next.places - next.inscrits), 'place restante', 'places restantes')}` : 'Aucune session planifiée',
      };
    });
  }, [scope, forms, upcoming, ui.typeForm]);

  // Renouvellements de l'équipe : certification en vigueur de chaque formation, à renouveler ou expirée, sans session.
  const renewals = useMemo<Renewal[]>(() => {
    if (!manager) return [];
    return scope.flatMap(e => e.certs
      .filter(c => c.key !== 'ok' && !c.session)
      .map(c => {
        const r = d.ds.demandesCollab.find(x => x.empId === e.id && x.type === 'formation' && x.f === c.f && x.statut === 'attente');
        return { e, c, demande: r ? `Demande transmise au service RH le ${fmtShort(parse(r.date))}` : null };
      }))
      .sort((a, b) => a.c.d - b.c.d || a.e.nom.localeCompare(b.e.nom));
  }, [d, scope, manager]);

  const sessions = upcoming.filter(s => !ui.formationFilter || s.formation === ui.formationFilter);
  const filteredFm = ui.formationFilter ? d.fm(ui.formationFilter) ?? null : null;
  const shownRenewals = renewals.filter(r => !ui.formationFilter || r.c.f === ui.formationFilter);
  const openSession = (f: string) => upcoming.find(s => s.formation === f && s.inscrits < s.places) ?? null;
  /**
   * Membres de l'équipe inscrits à une session. Une certification remplacée ne garde sa place que dans la session
   * qui a produit le recyclage (les autres places sont libérées à l'enregistrement) : elle compte aussi.
   */
  const enrolled = (sessionId: number) => scope.filter(e => [...e.rawCerts, ...e.anciennes].some(c => c.sessionId === sessionId)).map(e => e.nom);

  const kicker = manager
    ? [
        teams.length ? `${teams.length > 1 ? 'Équipes' : 'Équipe'} ${teams.join(', ')}` : 'Aucune équipe encadrée',
        plural(scope.length, 'collaborateur', 'collaborateurs'),
        plural(renewals.length, 'renouvellement à prévoir', 'renouvellements à prévoir'),
        plural(upcoming.length, 'session à venir', 'sessions à venir'),
      ].join(' · ')
    : `${plural(forms.length, 'formation suivie', 'formations suivies')} · ${plural(upcoming.length, 'session à venir', 'sessions à venir')}`;

  return (
    <Page
      kicker={kicker}
      title="Formations"
      actions={<Seg name="typeForm" label="Type de formation" value={ui.typeForm} onChange={v => setUi({ typeForm: v })}
        options={[['toutes', 'Toutes'], ['reg', 'Réglementaires'], ['rec', 'Recommandées'], ['int', 'Internes']]} />}
    >
      {manager && (
        <Panel highlight={shownRenewals.length > 0}
          title={filteredFm ? `À renouveler dans votre équipe — ${filteredFm.court}` : 'À renouveler dans votre équipe'}
          aside={plural(shownRenewals.length, 'certification sans session planifiée', 'certifications sans session planifiée')}>
          {shownRenewals.length > 0 && (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Collaborateur</th><th>Certification</th><th>Échéance</th><th>Statut</th><th>Prochaine session</th><th></th></tr></thead>
                <tbody>
                  {shownRenewals.map(({ e, c, demande }) => {
                    const s = openSession(c.f);
                    return (
                      <tr key={c.id} className="clickable" onClick={() => go('collaborateurs', { selectedId: e.id })}>
                        <td><Two main={e.nom} sub={e.poste} nowrap /></td>
                        <td><Two main={c.fm.court} sub={c.fm.type} /></td>
                        <td><Two main={fmt(c.exp)} sub={rel(c.d)} nowrap subNowrap /></td>
                        <td><Tag cls={CLS[c.key]}>{CERT_LABEL[c.key]}</Tag></td>
                        <td>
                          <Two nowrap main={s ? fmt(parse(s.date)) : 'Aucune session ouverte'}
                            sub={s ? `${s.lieu} · ${plural(s.places - s.inscrits, 'place restante', 'places restantes')}` : 'à demander au service RH'} />
                        </td>
                        <td className="right">
                          {demande
                            ? <span className="note-accent nowrap">{demande}</span>
                            : (
                              <div className="actions-end">
                                <Btn small onClick={stop(() => openDialog({ type: 'reqForm', empId: e.id, f: c.f }))}>Demander au RH</Btn>
                                {s && <Btn small variant="secondary" onClick={stop(() => openDialog({ type: 'plan', empId: e.id, certId: c.id }))}>Planifier</Btn>}
                              </div>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {shownRenewals.length === 0 && (
            <Empty pad="sm">{scope.length === 0
              ? 'Aucun collaborateur dans votre équipe.'
              : filteredFm ? 'Aucun renouvellement à prévoir pour cette formation.' : 'Aucune certification à renouveler dans votre équipe.'}</Empty>
          )}
          <Fine>Planifier inscrit directement le collaborateur à une session ouverte. Sans session, la demande est transmise au service RH, qui l’inscrit ou l’ajoute au plan de formation.</Fine>
        </Panel>
      )}

      <div className="cards-grid">
        {cards.map(c => {
          const selected = ui.formationFilter === c.f.id;
          return (
            <PickCard key={c.f.id} kicker={c.f.type} title={c.f.nom} selected={selected}
              body={`Validité ${validiteLabel(c.f.validite)} · ${c.f.duree} · ${c.f.organisme}`}
              stats={[[c.titulaires, 'titulaires'], [c.due, 'à renouveler'], [c.exp, 'expirées']]}
              meta={<><CalendarBlankIcon size={13} /><span>{c.next}</span></>}
              onClick={() => setUi({ formationFilter: selected ? null : c.f.id })} />
          );
        })}
      </div>

      <Panel head={
        <div className="panel-head center">
          <h2>{filteredFm ? `Sessions à venir — ${filteredFm.court}` : 'Sessions à venir'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {filteredFm && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ formationFilter: null })}>Toutes les sessions</button>}
            {rh && <Btn variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'session', f: ui.formationFilter ?? undefined })}>Nouvelle session</Btn>}
          </div>
        </div>
      }>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Date</th><th>Formation</th><th>Lieu</th><th>Inscrits</th>{manager && <th>Votre équipe</th>}<th>Statut</th></tr></thead>
            <tbody>
              {sessions.map(s => {
                const fm = d.fm(s.formation);
                const sv = sessionView(s, fm.nom);
                const team = manager ? enrolled(s.id) : [];
                return (
                  <tr key={s.id}>
                    <td className="nowrap">{fmt(sv.date)}</td>
                    <td><Two main={sv.nom} sub={fm.organisme} /></td>
                    <td className="text-muted">{s.lieu}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Bar pct={sv.pct} width={72} color={sv.full ? 'var(--color-accent-300)' : 'var(--color-accent-600)'} />
                        <span className="tnum nowrap">{s.inscrits} / {s.places}</span>
                      </div>
                    </td>
                    {manager && <td className={team.length ? undefined : 'text-muted'} style={{ fontSize: 13 }}>{team.length ? team.join(', ') : '—'}</td>}
                    <td><Tag cls={sv.cls}>{sv.statut}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sessions.length === 0 && <Empty pad="sm">Aucune session à venir pour cette formation.</Empty>}
      </Panel>
    </Page>
  );
}
