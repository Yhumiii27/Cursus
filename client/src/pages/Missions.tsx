// Missions & déplacements (source Keystone) : présents en mission, planning sur
// 4 semaines (missions, absences, fériés : PlanningMissions.tsx, lisible sans la couleur) et missions en cours ou à venir ;
// pour le service RH, qualification « grand déplacement » des chantiers en France (t031, components/GrandDeplacement.tsx).
import { useMemo, type CSSProperties } from 'react';
import { TRIP_LABEL } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, plural } from '../../../shared/format.ts';
import { Empty, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { planningMissions } from './planning-missions.ts';
import { FOND, PlanningGrille, ferieBg } from './PlanningMissions.tsx';
import { GrandDeplacementChantiers } from '../components/GrandDeplacement.tsx';

const swatch: CSSProperties = { width: 14, height: 14, borderRadius: 3, display: 'inline-grid', placeItems: 'center', fontSize: 9, fontWeight: 600 };

export function Missions() {
  const d = useDomain();
  const { manager } = useRole();
  const data = d.ds;
  const ti = data.today;

  const v = useMemo(() => {
    const voyages = data.voyages.filter(t => t.retour >= ti && !t.annuleLe && d.emp(t.empId));
    const rows = data.missions.filter(m => m.au >= ti).sort((a, b) => a.du.localeCompare(b.du)).map(m => {
      const t = voyages.find(x => x.empId === m.empId && x.chantier === m.projet), now = m.du <= ti;
      const e = d.emp(m.empId);
      return {
        m, now, nom: d.personName(m.empId), equipe: e ? equipeLabel(e) : '', projet: `${m.projet} · ${d.projet(m.projet)}`,
        dates: `${fmtShort(parse(m.du))} → ${fmt(parse(m.au))}`,
        dossier: t ? `Dossier voyage : ${TRIP_LABEL[d.tripStatus(t)]}` : m.type.includes('international') ? 'Dossier voyage à créer' : 'Mission en France',
      };
    });
    const { days, lignes } = planningMissions(d, manager);
    return { rows, now: rows.filter(r => r.now), days, grid: lignes };
  }, [d, data, ti, manager]);

  return (
    <Page
      kicker={`Source Keystone · ${plural(v.now.length, 'personne en mission aujourd’hui', 'personnes en mission aujourd’hui')} · ${plural(v.rows.length, 'mission en cours ou à venir', 'missions en cours ou à venir')}`}
      title="Missions & déplacements"
    >
      <Panel title="En mission aujourd’hui">
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
        {v.now.length === 0 && <Empty>Personne en mission aujourd’hui.</Empty>}
      </Panel>

      <Panel title="Planning des 4 prochaines semaines" aside={
        <div className="legend" style={{ color: 'var(--color-neutral-400)' }}>
          <span><span className="planning-marque mission" style={{ ...swatch, ...FOND.mission }} aria-hidden="true">M</span>Mission Keystone</span>
          <span><span className="planning-marque absence" style={{ ...swatch, ...FOND.absence }} aria-hidden="true">A</span>Absence validée ou signalée</span>
          <span><span className="planning-marque demande" style={{ ...swatch, ...FOND.demande }} aria-hidden="true">D</span>Absence demandée</span>
          <span><span className="planning-marque ferie" style={{ ...swatch, background: ferieBg('--color-neutral-700') }} aria-hidden="true">F</span>Férié</span>
        </div>
      }>
        {v.grid.length === 0 ? <Empty>Personne en mission ni absent sur les 4 semaines.</Empty> : <div className="scroll-x">
          <PlanningGrille days={v.days} lignes={v.grid} ti={ti} />
        </div>}
      </Panel>

      <GrandDeplacementChantiers />

      <Panel title="Missions en cours et à venir">
        {v.rows.length === 0 ? <Empty>Aucune mission en cours ou à venir.</Empty> : <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Collaborateur</th><th>Projet Keystone</th><th>Lieu</th><th>Dates</th><th>Statut</th></tr></thead>
            <tbody>
              {v.rows.map(r => (
                <tr key={r.m.id}>
                  <td><Two nowrap main={r.nom} sub={r.equipe} /></td>
                  <td><Two main={r.projet} sub={r.m.type} /></td>
                  <td><Two main={r.m.lieu} sub={r.dossier} /></td>
                  <td className="nowrap">{r.dates}</td>
                  <td><Tag cls={r.now ? 'tag-accent' : 'tag-outline'}>{r.now ? 'En cours' : 'À venir'}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </Panel>
    </Page>
  );
}
