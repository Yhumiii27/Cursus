// Écran Référentiels, onglet Activités internes : codes hors projet Keystone (INT-… et ECOLE, shared/rules/activites.ts)
// imputables dans les feuilles de temps. Le service RH les crée, les renomme (dialogs/RefActiviteDialog.tsx), les archive
// (après confirmation) et les rétablit d'un clic ; la lecture seule consulte. Une activité archivée n'est plus proposée dans les feuilles, les
// heures déjà saisies restent. Les codes de base sont amorcés à l'installation (migration nommée).
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { t, tn } from '../i18n/langue.ts';
import { activitesInternes, CODE_DELEGATION } from '../../../shared/rules/activites.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageActivite } from '../state/confirmations-referentiels.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function Activites() {
  const d = useDomain();
  const { rh } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [archives, setArchives] = useState(false);
  const toutes = activitesInternes(d.ds.referentiels.projets);
  const enVigueur = toutes.filter(a => a.statut !== 'archive'), nArchives = toutes.length - enVigueur.length;
  const lignes = archives ? toutes : enVigueur;
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>{t('Internal activities')}</h2>
          <div className="text-muted sub">{tn(enVigueur.length, 'activity in force', 'activities in force')}{nArchives ? ` · ${tn(nArchives, 'archived#fem', 'archived#fem-plural')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {t('Show the archived ones#fem')}
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refActivite' })}>{t('New activity')}</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{t('No internal activity.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Activity')}</th><th>{t('State')}</th><th></th></tr></thead>
            <tbody>
              {lignes.map(a => (
                <tr key={a.code}>
                  <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{a.code}</span> · {a.nom}</>} sub={a.code === CODE_DELEGATION ? t('Delegation hours of the CSE members: monthly counter') : undefined} /></td>
                  <td>{a.statut === 'archive' ? <Tag cls="tag-outline">{t('Archived#fem')}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                  <td className="right">
                    {rh && (
                      <div className="actions-end">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refActivite', code: a.code })}>{t('Rename')}</button>
                        {a.statut === 'archive'
                          ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('referentiel.activite.archiver', { id: a.code, archive: false }))}>{t('Restore')}</button>
                          : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageActivite(a) })}>{t('Archive')}</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        {t('Codes outside Keystone projects chargeable in the timesheets (production, maintenance, HSE, school, delegation…). They are never sent to Keystone. An archived activity is no longer offered; the hours already entered stay on the timesheets.')}
      </Fine>
    </Panel>
  );
}
