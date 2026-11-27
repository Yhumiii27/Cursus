// Écran Référentiels, onglets Cycles et Besoins de poste (lot 12, chantier C5, étape 2 ; shared/rules/cycles.ts,
// planning.ts). Le service RH tient les cycles de roulement (modèles Journée, 2x8, 3x8 et 5x8 amorcés, modifiables) et les
// besoins par poste de chaque équipe ; il les prépare avant l'activation du module. La lecture seule consulte. Un cycle
// s'archive (confirmé) au lieu d'être supprimé, une fois ses affectations terminées, et se rétablit d'un clic ; un besoin
// s'archive (confirmé). Indicateurs calculés à l'écran, jamais stockés.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fH, fmtIso } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { indicateursCycle, roulementsDuCycle } from '../../../shared/rules/cycles.ts';
import { horairesDe } from '../../../shared/rules/horaires.ts';
import { reglagesNuit } from '../../../shared/rules/repos-nuit.ts';
import type { BesoinPoste, Cycle } from '../../../shared/types-planning.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { ecrireSequence, JOURS_BESOIN } from '../dialogs/RefCycleDialog.tsx';
import { useAgir } from '../state/actions.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Confirmation de l'archivage d'un cycle (plus proposé aux affectations ; rétabli d'un clic). */
export const archivageCycle = (c: Pick<Cycle, 'code' | 'nom'>): Confirmation => ({
  titre: t('Archive the cycle'), question: `${t('Archive the cycle ')}${c.code} (${c.nom})${t('?#question')}`, bouton: t('Archive'), action: 'planning.cycle.archiver', payload: { code: c.code },
  suites: [t('It is no longer offered for assignments; the slots already generated or published do not change.'), t('It can be restored with one click.')],
});
/** Confirmation de l'archivage d'un besoin de poste (définitif). */
export const archivageBesoin = (b: Pick<BesoinPoste, 'id' | 'equipe' | 'horaire' | 'effectifMin'>): Confirmation => ({
  titre: t('Archive the need'), question: `${t('Archive the need of the team ')}${b.equipe} (${b.effectifMin}${t(' on the shift ')}${b.horaire})${t('?#question')}`, bouton: t('Archive'),
  action: 'planning.besoin.archiver', payload: { id: b.id }, suites: [t('It no longer counts in the coverage nor in the requirements of the slot; it can no longer be edited.')],
});

/** Case « Afficher les archivés ». */
function CaseArchives({ n, coche, onChange }: { n: number; coche: boolean; onChange: (v: boolean) => void }) {
  if (!n) return null;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
      {t('Show the archived ones#masc')}
    </label>
  );
}

export function Cycles() {
  const d = useDomain();
  const { rh } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [archives, setArchives] = useState(false);
  const tous = d.ds.cycles ?? [];
  const enVigueur = tous.filter(c => !c.archive), lignes = archives ? tous : enVigueur;
  const horaires = horairesDe(d.ds.referentiels), nuit = reglagesNuit(d.ds.settings);
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>{t('Rotation cycles')}</h2>
          <div className="text-muted sub">{tn(enVigueur.length, 'cycle in force', 'cycles in force')}{tous.length > enVigueur.length ? ` · ${tn(tous.length - enVigueur.length, 'archived#masc', 'archived#masc-plural')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <CaseArchives n={tous.length - enVigueur.length} coche={archives} onChange={setArchives} />
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refCycle' })}>{t('New cycle')}</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{t('No rotation cycle.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Cycle')}</th><th>{t('Sequence')}</th><th>{t('Groups')}</th><th className="right">{t('Average')}</th><th>{t('Assignments#planning')}</th><th>{t('State')}</th><th></th></tr></thead>
            <tbody>
              {lignes.map(c => {
                const ind = indicateursCycle(c, horaires, nuit), n = roulementsDuCycle(d.ds.roulements, c.code, d.ti).length;
                return (
                  <tr key={c.code}>
                    <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{c.code}</span> · {c.nom}</>} sub={`${tn(c.longueur, 'day', 'days')}${t(' · origin ')}${fmtIso(c.origine)}`} /></td>
                    <td className="sub tnum" style={{ maxWidth: 320 }}>{ecrireSequence(c.sequence)}</td>
                    <td className="nowrap">{c.groupes.map(g => `${g.code} (+${g.decalage} j)`).join(', ')}</td>
                    <td className="right"><Two main={fH(ind.heuresSemaine)} sub={ind.alertes.length ? t('beyond 44 h') : `${ind.nuitsSemaine.toLocaleString('fr-FR')}${t(ind.nuitsSemaine > 1 ? ' nights / wk.' : ' night / wk.')}`} /></td>
                    <td>{n ? tn(n, 'current or upcoming', 'current or upcoming#plural') : <span className="text-muted">—</span>}</td>
                    <td>{c.archive ? <Tag cls="tag-outline">{t('Archived#masc')}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                    <td className="right">
                      {rh && (
                        <div className="actions-end">
                          {!c.archive && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refCycle', code: c.code })}>{t('Edit')}</button>}
                          {c.archive
                            ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('planning.cycle.archiver', { code: c.code, archive: false }))}>{t('Restore')}</button>
                            : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageCycle(c) })}>{t('Archive')}</button>}
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
      <Fine>
        {t('A cycle describes the shift of each day (schedule code or rest) for the offset group 0; each group follows the same sequence, offset. The employees are assigned to it from the Team planning tab of Working time. Generic templates seeded (Day, 2x8, 3x8, 5x8): to be replaced by the real rotation tables before going live. Average: working hours per week over the cycle, breaks removed (alert beyond 44 h on average over 12 weeks, art. L3121-22).')}
      </Fine>
    </Panel>
  );
}

export function Besoins() {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const [archives, setArchives] = useState(false);
  const tous = d.ds.besoinsPoste ?? [];
  const enVigueur = tous.filter(b => !b.archive), lignes = (archives ? tous : enVigueur).slice().sort((a, b) => a.equipe.localeCompare(b.equipe) || a.horaire.localeCompare(b.horaire));
  const nom = (id: string, liste: { id: string; nom?: string; court?: string }[]) => { const x = liste.find(y => y.id === id); return x?.court ?? x?.nom ?? id; };
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>{t('Job needs')}</h2>
          <div className="text-muted sub">{tn(enVigueur.length, 'need in force', 'needs in force')}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <CaseArchives n={tous.length - enVigueur.length} coche={archives} onChange={setArchives} />
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refBesoin' })}>{t('New need')}</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{t('No job need: the coverage line of the planning counts the shifts, without minimum.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Team')}</th><th>{t('Schedule')}</th><th>{t('Days')}</th><th className="right">{t('Minimum headcount')}</th><th>{t('Requirements of the slot')}</th><th>{t('Period')}</th><th></th></tr></thead>
            <tbody>
              {lignes.map(b => {
                const ex = [...b.exigences.formations.map(f => nom(f, d.ds.referentiels.formations)), ...b.exigences.habilitations.map(h => nom(h, d.ds.referentiels.habilitations))];
                return (
                  <tr key={b.id}>
                    <td><Two main={b.equipe} sub={b.activite ?? undefined} /></td>
                    <td>{b.horaire}</td>
                    <td className="nowrap">{b.jours.map(j => t(JOURS_BESOIN[j])).join(' ')}</td>
                    <td className="right tnum">{b.effectifMin}</td>
                    <td>{ex.length ? ex.join(', ') : <span className="text-muted">—</span>}</td>
                    <td className="nowrap">{b.archive ? <Tag cls="tag-outline">{t('Archived#masc')}</Tag> : `${t('from #date')}${fmtIso(b.du)}${b.au ? `${t(' to #date')}${fmtIso(b.au)}` : ''}`}</td>
                    <td className="right">
                      {rh && !b.archive && (
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refBesoin', id: b.id })}>{t('Edit')}</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: archivageBesoin(b) })}>{t('Archive')}</button>
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
      <Fine>
        {t('Minimum headcount per schedule and per day of the week, with the requirements specific to the slot (on top of those of the job and of the team), checked at the date of each slot before the planning is published.')}
      </Fine>
    </Panel>
  );
}
