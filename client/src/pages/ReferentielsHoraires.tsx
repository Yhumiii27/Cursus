// Écran Référentiels, onglet Horaires : horaires de poste des feuilles de temps (shared/rules/horaires.ts), distincts des
// postes et de leurs exigences. Le service RH les crée, les modifie (dialogs/RefHoraireDialog.tsx), les archive (après
// confirmation) et les rétablit d'un clic ; la lecture seule consulte. Chaque équipe peut en proposer un par défaut
// (onglet Postes, exigences et organisation de l'équipe). Les exemples J, M, AM, N sont amorcés à l'installation.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fH, plural } from '../../../shared/format.ts';
import { dureeHoraire, equipesDeLHoraire, horairesDe, plageTexte } from '../../../shared/rules/horaires.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageHoraire } from '../state/confirmations-referentiels.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function Horaires() {
  const d = useDomain();
  const { rh } = useRole();
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
          <h2>Horaires de poste</h2>
          <div className="text-muted sub">{plural(enVigueur.length, 'horaire en vigueur', 'horaires en vigueur')}{nArchives ? ` · ${plural(nArchives, 'archivé', 'archivés')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les archivés
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refHoraire' })}>Nouvel horaire</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">Aucun horaire de poste : les feuilles de temps se tiennent sans horaire.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Horaire</th><th>Plage</th><th className="right">Travail</th><th>Équipes</th><th>État</th><th></th></tr></thead>
            <tbody>
              {lignes.map(h => {
                const equipes = equipesDeLHoraire(d.ds.referentiels.equipes, h.code);
                return (
                  <tr key={h.code}>
                    <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{h.code}</span> · {h.nom}</>} /></td>
                    <td className="nowrap"><Two main={plageTexte(h)} sub={h.pause ? `pause ${h.pause} min` : 'sans pause'} /></td>
                    <td className="right tnum nowrap">{fH(dureeHoraire(h))}</td>
                    <td>{equipes.length ? equipes.join(', ') : <span className="text-muted">—</span>}</td>
                    <td>{h.archive ? <Tag cls="tag-outline">Archivé</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                    <td className="right">
                      {rh && (
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refHoraire', code: h.code })}>Modifier</button>
                          {h.archive
                            ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('referentiel.horaire.archiver', { id: h.code, archive: false }))}>Rétablir</button>
                            : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageHoraire(h) })}>Archiver</button>}
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
        Horaire du jour choisi sur la feuille de temps (un par jour, pour toute la feuille ; les heures restent saisies par projet), proposé d’après
        l’horaire par défaut de l’équipe (onglet Postes) et modifiable par le salarié, son manager ou le service RH. Il est facultatif : sans horaire, la
        feuille se tient comme avant. Une fin antérieure au début finit le lendemain (poste de nuit).
      </Fine>
    </Panel>
  );
}
