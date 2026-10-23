// Écran Référentiels, onglet Horaires : horaires de poste des feuilles de temps (shared/rules/horaires.ts), distincts des
// postes et de leurs exigences. Le service RH les crée, les modifie (dialogs/RefHoraireDialog.tsx), les archive (après
// confirmation) et les rétablit d'un clic ; la lecture seule consulte. Chaque équipe peut en proposer un par défaut
// (onglet Postes, exigences et organisation de l'équipe). Les exemples J, M, AM, N sont amorcés à l'installation.
// Compte professionnel de prévention (lot 7, shared/rules/c2p.ts) : un horaire de nuit (1 h au moins entre 0 h et 5 h) se
// qualifie « équipes successives alternantes » ou non, par le service RH ou le référent HSE ; à qualifier par défaut.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fH, plural } from '../../../shared/format.ts';
import { dureeHoraire, equipesDeLHoraire, horairesDe, plageTexte } from '../../../shared/rules/horaires.ts';
import { alternantTexte, horaireDeNuitC2p } from '../../../shared/rules/c2p.ts';
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
 * sinon le texte ; « — » pour un horaire de jour jamais qualifié.
 */
function QualificationC2p({ h, peut }: { h: Horaire; peut: boolean }) {
  const { run } = useStore();
  const { occupe, agir } = useAgir();
  const nuit = horaireDeNuitC2p(h);
  if (!nuit && h.alternant == null) return <span className="text-muted">—</span>;
  if (!peut || h.archive) return h.alternant == null ? <Tag cls="tag-accent">À qualifier</Tag> : <span>{alternantTexte(h.alternant)}</span>;
  const valeur = QUALIFS.find(([, v]) => v === (h.alternant ?? null))![0];
  return (
    <select className="input" aria-label={`Horaire ${h.code} : équipes successives alternantes (C2P)`} value={valeur} disabled={occupe} style={{ minWidth: 190 }}
      onChange={e => agir(() => run('referentiel.horaire.alternant', { id: h.code, alternant: QUALIFS.find(([k]) => k === e.target.value)![1] }))()}>
      <option value="">À qualifier</option>
      <option value="oui">Équipes successives alternantes</option>
      <option value="non">Non alternant</option>
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
            <thead><tr><th>Horaire</th><th>Plage</th><th className="right">Travail</th><th>Équipes</th><th>Équipes alternantes (C2P)</th><th>État</th><th></th></tr></thead>
            <tbody>
              {lignes.map(h => {
                const equipes = equipesDeLHoraire(d.ds.referentiels.equipes, h.code);
                return (
                  <tr key={h.code}>
                    <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{h.code}</span> · {h.nom}</>} /></td>
                    <td className="nowrap"><Two main={plageTexte(h)} sub={h.pause ? `pause ${h.pause} min` : 'sans pause'} /></td>
                    <td className="right tnum nowrap">{fH(dureeHoraire(h))}</td>
                    <td>{equipes.length ? equipes.join(', ') : <span className="text-muted">—</span>}</td>
                    <td><QualificationC2p h={h} peut={formations} /></td>
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
        feuille se tient comme avant. Une fin antérieure au début finit le lendemain (poste de nuit). Compte professionnel de prévention : un horaire
        qui compte au moins 1 h de travail entre 0 h et 5 h se qualifie « équipes successives alternantes » (2x8, 3x8 en roulement : seuil de 50 nuits
        par an) ou non (travail de nuit : 120 nuits) ; à qualifier, ses nuits comptent au travail de nuit (écran Expositions).
      </Fine>
    </Panel>
  );
}
