// Missions & déplacements (source Keystone) : présents en mission, planning sur
// 4 semaines (missions, absences, fériés : PlanningMissions.tsx, lisible sans la couleur) et missions en cours ou à venir ;
// pour le service RH, qualification « grand déplacement » des chantiers en France (t031, components/GrandDeplacement.tsx).
import { useMemo, type CSSProperties } from 'react';
import { TRIP_LABEL } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort } from '../../../shared/format.ts';
import { Empty, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { MARQUE, planningMissions } from './planning-missions.ts';
import { t, tn } from '../i18n/langue.ts';
import { FOND, PlanningGrille, ferieBg } from './PlanningMissions.tsx';
import { GrandDeplacementChantiers } from '../components/GrandDeplacement.tsx';
// lot 11 — notes de frais
import { FraisRattaches } from '../components/frais/FraisRattaches.tsx';

const swatch: CSSProperties = { width: 14, height: 14, borderRadius: 3, display: 'inline-grid', placeItems: 'center', fontSize: 9, fontWeight: 600 };

export function Missions() {
  const d = useDomain();
  const { manager, rh } = useRole();
  const data = d.ds;
  const ti = data.today;

  const v = useMemo(() => {
    const voyages = data.voyages.filter(x => x.retour >= ti && !x.annuleLe && d.emp(x.empId));
    const rows = data.missions.filter(m => m.au >= ti).sort((a, b) => a.du.localeCompare(b.du)).map(m => {
      const v = voyages.find(x => x.empId === m.empId && x.chantier === m.projet), now = m.du <= ti;
      const e = d.emp(m.empId);
      return {
        m, now, nom: d.personName(m.empId), equipe: e ? equipeLabel(e) : '', projet: `${m.projet} · ${d.projet(m.projet)}`,
        dates: `${fmtShort(parse(m.du))} → ${fmt(parse(m.au))}`,
        dossier: v ? `${t('Travel file: ')}${TRIP_LABEL[d.tripStatus(v)]}` : m.type.includes('international') ? t('Travel file to create') : t('Assignment in France'),
      };
    });
    const { days, lignes } = planningMissions(d, manager);
    return { rows, now: rows.filter(r => r.now), days, grid: lignes };
  }, [d, data, ti, manager]);

  return (
    <Page
      kicker={`${t('Source Keystone · ')}${tn(v.now.length, 'person on assignment today', 'people on assignment today')} · ${tn(v.rows.length, 'assignment in progress or upcoming', 'assignments in progress or upcoming')}`}
      title={t('Assignments & travel')}
    >
      <Panel title={t('On assignment today')}>
        {v.now.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
            {v.now.map(r => (
              <div key={r.m.id} className="boxed-lg" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 14 }}>{r.nom}</div>
                <div className="note-accent">{r.projet}</div>
                <div className="text-muted sub">{r.m.lieu} · {r.dates}</div>
              </div>
            ))}
          </div>
        )}
        {v.now.length === 0 && <Empty>{t('Nobody on assignment today.')}</Empty>}
      </Panel>

      <Panel title={t('Schedule of the next 4 weeks')} aside={
        <div className="legend" style={{ color: 'var(--color-neutral-400)' }}>
          <span><span className="planning-marque mission" style={{ ...swatch, ...FOND.mission }} aria-hidden="true">{MARQUE.mission}</span>{t('Keystone assignment')}</span>
          <span><span className="planning-marque absence" style={{ ...swatch, ...FOND.absence }} aria-hidden="true">{MARQUE.absence}</span>{t('Absence approved or reported')}</span>
          <span><span className="planning-marque demande" style={{ ...swatch, ...FOND.demande }} aria-hidden="true">{MARQUE.demande}</span>{t('Absence requested')}</span>
          <span><span className="planning-marque ferie" style={{ ...swatch, background: ferieBg('--color-neutral-700') }} aria-hidden="true">{MARQUE.ferie}</span>{t('Public holiday')}</span>
        </div>
      }>
        {v.grid.length === 0 ? <Empty>{t('Nobody on assignment or absent over the 4 weeks.')}</Empty> : <div className="scroll-x">
          <PlanningGrille days={v.days} lignes={v.grid} ti={ti} />
        </div>}
      </Panel>

      <GrandDeplacementChantiers />

      {/* lot 11 — notes de frais : notes rattachées à une mission Keystone (service RH ; manager : son équipe). */}
      {(rh || manager) && d.ds.settings.notesFraisActives && (
        <Panel title={t('Expense reports of the assignments')}>
          <FraisRattaches titre={t('Linked to an assignment')} avecRattachement filtre={n => n.missionId != null} />
        </Panel>
      )}

      <Panel title={t('Assignments in progress and upcoming')}>
        {v.rows.length === 0 ? <Empty>{t('No assignment in progress or upcoming.')}</Empty> : <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Employee')}</th><th>{t('Keystone project')}</th><th>{t('Place')}</th><th>{t('Dates')}</th><th>{t('Status')}</th></tr></thead>
            <tbody>
              {v.rows.map(r => (
                <tr key={r.m.id}>
                  <td><Two nowrap main={r.nom} sub={r.equipe} /></td>
                  <td><Two main={r.projet} sub={r.m.type} /></td>
                  <td><Two main={r.m.lieu} sub={r.dossier} /></td>
                  <td className="nowrap">{r.dates}</td>
                  <td><Tag cls={r.now ? 'tag-accent' : 'tag-outline'}>{r.now ? t('In progress') : t('Upcoming')}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </Panel>
    </Page>
  );
}
