// Écran Référentiels, onglet Activités internes : codes hors projet Keystone (INT-… et ECOLE, shared/rules/activites.ts)
// imputables dans les feuilles de temps. Le service RH les crée, les renomme (dialogs/RefActiviteDialog.tsx), les archive
// (après confirmation) et les rétablit d'un clic ; la lecture seule consulte. Une activité archivée n'est plus proposée dans les feuilles, les
// heures déjà saisies restent. Les codes de base sont amorcés à l'installation (migration nommée).
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { plural } from '../../../shared/format.ts';
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
          <h2>Activités internes</h2>
          <div className="text-muted sub">{plural(enVigueur.length, 'activité en vigueur', 'activités en vigueur')}{nArchives ? ` · ${plural(nArchives, 'archivée', 'archivées')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les archivées
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refActivite' })}>Nouvelle activité</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">Aucune activité interne.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Activité</th><th>État</th><th></th></tr></thead>
            <tbody>
              {lignes.map(a => (
                <tr key={a.code}>
                  <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{a.code}</span> · {a.nom}</>} sub={a.code === CODE_DELEGATION ? 'Heures de délégation des élus au CSE : compteur mensuel' : undefined} /></td>
                  <td>{a.statut === 'archive' ? <Tag cls="tag-outline">Archivée</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                  <td className="right">
                    {rh && (
                      <div className="actions-end">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refActivite', code: a.code })}>Renommer</button>
                        {a.statut === 'archive'
                          ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('referentiel.activite.archiver', { id: a.code, archive: false }))}>Rétablir</button>
                          : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageActivite(a) })}>Archiver</button>}
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
        Codes hors projet Keystone imputables dans les feuilles de temps (production, maintenance, HSE, école, délégation…). Ils ne sont jamais envoyés à
        Keystone. Une activité archivée n’est plus proposée ; les heures déjà saisies restent sur les feuilles.
      </Fine>
    </Panel>
  );
}
