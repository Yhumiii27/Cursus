// Missions & déplacements (source Keystone) : présents en mission, planning sur
// 4 semaines (missions, absences, fériés) et missions en cours ou à venir ; pour le service RH, qualification « grand
// déplacement » des chantiers en France (t031, components/GrandDeplacement.tsx).
import { useMemo, type CSSProperties } from 'react';
import { ABS_LABEL, TRIP_LABEL } from '../../../shared/constants.ts';
import { addD, isFerie, mondayOf, parse, weekday } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, plural } from '../../../shared/format.ts';
import { absenceActive, absenceBloque, statutAbsence } from '../../../shared/rules/absences.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Empty, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { GrandDeplacementChantiers } from '../components/GrandDeplacement.tsx';

const GRID_COLS = '160px repeat(20, minmax(0, 1fr))';
const swatch: CSSProperties = { width: 12, height: 12, borderRadius: 3 };
const cellBase: CSSProperties = { height: 22, borderRadius: 3 };
const ferieBg = (c: string) => `repeating-linear-gradient(45deg, var(${c}), var(${c}) 3px, transparent 3px, transparent 6px)`;

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
    const days: ISODate[] = [];
    for (let s = mondayOf(ti); days.length < 20; s = addD(s, 1)) if (weekday(s) < 5) days.push(s);
    const first = days[0], last = days[days.length - 1];
    const ids = data.employes.map(e => e.id).filter(id => manager
      || data.missions.some(m => m.empId === id && m.du <= last && m.au >= first)
      || data.absences.some(a => a.empId === id && absenceActive(a) && a.du <= last && a.au >= first));
    const grid = ids.map(id => ({
      id, nom: d.personName(id),
      cells: days.map(s => {
        const m = data.missions.find(x => x.empId === id && x.du <= s && x.au >= s), a = d.absOn(id, s, true), fer = isFerie(s);
        const style: CSSProperties = fer ? { background: ferieBg('--color-neutral-800') }
          : m ? { background: 'var(--color-accent-600)' }
          : a ? (absenceBloque(a) ? { background: 'var(--color-neutral-500)' } : { boxShadow: 'inset 0 0 0 1px var(--color-neutral-500)' })
          : { background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' };
        const title = `${fmt(parse(s))} — ${fer ? 'Férié' : m ? `${m.projet} · ${m.lieu}` : a ? `${ABS_LABEL[a.type]} (${statutAbsence(a).toLowerCase()})` : 'Présent'}`;
        return { s, style, title };
      }),
    }));
    return { rows, now: rows.filter(r => r.now), days, grid };
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
          <span><span style={{ ...swatch, background: 'var(--color-accent-600)' }} />Mission Keystone</span>
          <span><span style={{ ...swatch, background: 'var(--color-neutral-500)' }} />Absence validée ou signalée</span>
          <span><span style={{ ...swatch, boxShadow: 'inset 0 0 0 1px var(--color-neutral-500)' }} />Absence demandée</span>
          <span><span style={{ ...swatch, background: ferieBg('--color-neutral-700') }} />Férié</span>
        </div>
      }>
        {v.grid.length === 0 ? <Empty>Personne en mission ni absent sur les 4 semaines.</Empty> : <div className="scroll-x">
          <div style={{ minWidth: 720, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, gap: 3, alignItems: 'end' }}>
              <span />
              {v.days.map(s => (
                <div key={s} className="center sub-11 tnum" style={{ color: s === ti ? 'var(--color-accent)' : 'var(--color-neutral-400)' }}>
                  <div>{parse(s).toLocaleDateString('fr-FR', { weekday: 'narrow' })}</div>
                  <div>{parse(s).getDate()}</div>
                </div>
              ))}
            </div>
            {v.grid.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: GRID_COLS, gap: 3, alignItems: 'center' }}>
                <span className="ellipsis" style={{ fontSize: 13 }}>{r.nom}</span>
                {r.cells.map(c => <div key={c.s} title={c.title} style={{ ...cellBase, ...c.style }} />)}
              </div>
            ))}
          </div>
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
