// Écran Référentiels, onglet Horaires : horaires de poste des feuilles de temps (shared/rules/horaires.ts), distincts des
// postes et de leurs exigences. Le service RH les crée, les modifie (dialogs/RefHoraireDialog.tsx), les archive (après
// confirmation) et les rétablit d'un clic ; la lecture seule consulte. Chaque équipe peut en proposer un par défaut
// (onglet Postes, exigences et organisation de l'équipe). Les exemples J, M, AM, N sont amorcés à l'installation.
// Compte professionnel de prévention (lot 7, shared/rules/c2p.ts) : un horaire de nuit (1 h au moins entre 0 h et 5 h) se
// qualifie « équipes successives alternantes » ou non, par le service RH ou le référent HSE ; à qualifier par défaut,
// archivé compris.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fH } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { dureeHoraire, equipesDeLHoraire, horairesDe, plageTexte } from '../../../shared/rules/horaires.ts';
import { alternantTexte, horaireDeNuitC2p } from '../../../shared/rules/c2p.ts';
// lot 12 — C6 (badgeage virtuel)
import { estVariable } from '../../../shared/rules/horaires-variables.ts';
import type { Horaire } from '../../../shared/types.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageHoraire } from '../state/confirmations-referentiels.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Choix de la qualification dans la liste : « » à qualifier, « oui », « non ». */
const QUALIFS: [string, boolean | null][] = [['', null], ['oui', true], ['non', false]];

/**
 * Qualification C2P d'un horaire : liste de choix pour le service RH et le référent HSE (enregistrée au changement),
 * sinon le texte ; « — » pour un horaire de jour jamais qualifié. Un horaire archivé reste qualifiable : ses nuits de
 * l'année comptent encore et l'écran Expositions le liste « à qualifier » (le référent HSE ne peut pas le rétablir).
 */
function QualificationC2p({ h, peut }: { h: Horaire; peut: boolean }) {
  const { run } = useStore();
  const { occupe, agir } = useAgir();
  const nuit = horaireDeNuitC2p(h);
  if (!nuit && h.alternant == null) return <span className="text-muted">—</span>;
  if (!peut) return h.alternant == null ? <Tag cls="tag-accent">{t('To qualify')}</Tag> : <span>{alternantTexte(h.alternant)}</span>;
  const valeur = QUALIFS.find(([, v]) => v === (h.alternant ?? null))![0];
  return (
    <select className="input" aria-label={`${t('Schedule ')}${h.code}${t(': alternating successive shifts (C2P)')}`} value={valeur} disabled={occupe} style={{ minWidth: 190 }}
      onChange={e => agir(() => run('referentiel.horaire.alternant', { id: h.code, alternant: QUALIFS.find(([k]) => k === e.target.value)![1] }))()}>
      <option value="">{t('To qualify')}</option>
      <option value="oui">{t('Alternating successive shifts')}</option>
      <option value="non">{t('Non-alternating')}</option>
    </select>
  );
}

export function Horaires() {
  const d = useDomain();
  const { rh, formations } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [archives, setArchives] = useState(false);
  const tous = horairesDe(d.ds.referentiels);
  const enVigueur = tous.filter(h => !h.archive), nArchives = tous.length - enVigueur.length;
  const lignes = archives ? tous : enVigueur;
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>{t('Shift schedules')}</h2>
          <div className="text-muted sub">{tn(enVigueur.length, 'schedule in force', 'schedules in force')}{nArchives ? ` · ${tn(nArchives, 'archived#masc', 'archived#masc-plural')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {t('Show the archived ones#masc')}
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refHoraire' })}>{t('New schedule')}</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{t('No shift schedule: the timesheets are kept without a schedule.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Schedule')}</th><th>{t('Range')}</th><th className="right">{t('Work')}</th><th>{t('Teams')}</th><th>{t('Alternating shifts (C2P)')}</th><th>{t('State')}</th><th></th></tr></thead>
            <tbody>
              {lignes.map(h => {
                const equipes = equipesDeLHoraire(d.ds.referentiels.equipes, h.code);
                return (
                  <tr key={h.code}>
                    <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{h.code}</span> · {h.nom}</>} /></td>
                    <td className="nowrap"><Two main={plageTexte(h)} sub={<>{h.pause ? `${t('break ')}${h.pause}${t(' min')}` : t('without break')}{/* lot 12 — C6 (badgeage virtuel) */ estVariable(h) && <> · <Tag cls="tag-accent-2">{t('Variable')}</Tag></>}</>} /></td>
                    <td className="right tnum nowrap">{fH(dureeHoraire(h))}</td>
                    <td>{equipes.length ? equipes.join(', ') : <span className="text-muted">—</span>}</td>
                    <td><QualificationC2p h={h} peut={formations} /></td>
                    <td>{h.archive ? <Tag cls="tag-outline">{t('Archived#masc')}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                    <td className="right">
                      {rh && (
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refHoraire', code: h.code })}>{t('Edit')}</button>
                          {/* lot 12 — C6 (badgeage virtuel) : plages fixes et mobiles, plafonds du report. */}
                          {!h.archive && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'horaireVariable', code: h.code })}>{estVariable(h) ? t('Variable schedule') : t('Make variable')}</button>}
                          {h.archive
                            ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('referentiel.horaire.archiver', { id: h.code, archive: false }))}>{t('Restore')}</button>
                            : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageHoraire(h) })}>{t('Archive')}</button>}
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
        {t('The schedule of the day is chosen on the timesheet (one per day, for the whole timesheet; the hours stay entered by project), offered from the team’s default schedule (Jobs tab) and editable by the employee, their manager or HR. It is optional: without a schedule, the timesheet is kept as before. An end earlier than the start ends the next day (night shift). Professional prevention account: a schedule with at least 1 h of work between 0:00 and 5:00 is qualified “alternating successive shifts” (2x8, 3x8 in rotation: threshold of 50 nights a year) or not (night work: 120 nights); while to qualify, its nights count as night work (Exposures screen).')}
      </Fine>
    </Panel>
  );
}
