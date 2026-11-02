// Écran Référentiels, onglets Cycles et Besoins de poste (lot 12, chantier C5, étape 2 ; shared/rules/cycles.ts,
// planning.ts). Le service RH tient les cycles de roulement (modèles Journée, 2x8, 3x8 et 5x8 amorcés, modifiables) et les
// besoins par poste de chaque équipe ; il les prépare avant l'activation du module. La lecture seule consulte. Un cycle
// s'archive (confirmé) au lieu d'être supprimé, une fois ses affectations terminées, et se rétablit d'un clic ; un besoin
// s'archive (confirmé). Indicateurs calculés à l'écran, jamais stockés.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fH, fmtIso, plural } from '../../../shared/format.ts';
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
  titre: 'Archiver le cycle', question: `Archiver le cycle ${c.code} (${c.nom}) ?`, bouton: 'Archiver', action: 'planning.cycle.archiver', payload: { code: c.code },
  suites: ['Il n’est plus proposé aux affectations ; les créneaux déjà générés ou publiés ne changent pas.', 'Il se rétablit d’un clic.'],
});
/** Confirmation de l'archivage d'un besoin de poste (définitif). */
export const archivageBesoin = (b: Pick<BesoinPoste, 'id' | 'equipe' | 'horaire' | 'effectifMin'>): Confirmation => ({
  titre: 'Archiver le besoin', question: `Archiver le besoin de l’équipe ${b.equipe} (${b.effectifMin} au poste ${b.horaire}) ?`, bouton: 'Archiver',
  action: 'planning.besoin.archiver', payload: { id: b.id }, suites: ['Il ne compte plus dans la couverture ni dans les exigences du créneau ; il ne se modifie plus.'],
});

/** Case « Afficher les archivés ». */
function CaseArchives({ n, coche, onChange }: { n: number; coche: boolean; onChange: (v: boolean) => void }) {
  if (!n) return null;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={coche} onChange={e => onChange(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
      Afficher les archivés
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
          <h2>Cycles de roulement</h2>
          <div className="text-muted sub">{plural(enVigueur.length, 'cycle en vigueur', 'cycles en vigueur')}{tous.length > enVigueur.length ? ` · ${plural(tous.length - enVigueur.length, 'archivé', 'archivés')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <CaseArchives n={tous.length - enVigueur.length} coche={archives} onChange={setArchives} />
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refCycle' })}>Nouveau cycle</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">Aucun cycle de roulement.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Cycle</th><th>Séquence</th><th>Groupes</th><th className="right">Moyenne</th><th>Affectations</th><th>État</th><th></th></tr></thead>
            <tbody>
              {lignes.map(c => {
                const ind = indicateursCycle(c, horaires, nuit), n = roulementsDuCycle(d.ds.roulements, c.code, d.ti).length;
                return (
                  <tr key={c.code}>
                    <td><Two main={<><span style={{ color: 'var(--color-accent-300)' }}>{c.code}</span> · {c.nom}</>} sub={`${plural(c.longueur, 'jour', 'jours')} · origine ${fmtIso(c.origine)}`} /></td>
                    <td className="sub tnum" style={{ maxWidth: 320 }}>{ecrireSequence(c.sequence)}</td>
                    <td className="nowrap">{c.groupes.map(g => `${g.code} (+${g.decalage} j)`).join(', ')}</td>
                    <td className="right"><Two main={fH(ind.heuresSemaine)} sub={ind.alertes.length ? 'au-delà de 44 h' : `${ind.nuitsSemaine.toLocaleString('fr-FR')} nuit${ind.nuitsSemaine > 1 ? 's' : ''} / sem.`} /></td>
                    <td>{n ? plural(n, 'en cours ou à venir', 'en cours ou à venir') : <span className="text-muted">—</span>}</td>
                    <td>{c.archive ? <Tag cls="tag-outline">Archivé</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                    <td className="right">
                      {rh && (
                        <div className="actions-end">
                          {!c.archive && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refCycle', code: c.code })}>Modifier</button>}
                          {c.archive
                            ? <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('planning.cycle.archiver', { code: c.code, archive: false }))}>Rétablir</button>
                            : <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: archivageCycle(c) })}>Archiver</button>}
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
        Un cycle décrit le poste de chaque jour (code d’horaire ou repos) pour le groupe de décalage 0 ; chaque groupe suit la même séquence, décalée. Les
        salariés y sont affectés depuis l’onglet Planning d’équipe de Temps de travail. Modèles génériques amorcés (Journée, 2x8, 3x8, 5x8) : à remplacer par
        les tableaux de roulement réels avant la mise en service. Moyenne : heures de travail par semaine sur le cycle, pauses retirées (alerte au-delà de 44 h
        en moyenne sur 12 semaines, art. L3121-22).
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
          <h2>Besoins de poste</h2>
          <div className="text-muted sub">{plural(enVigueur.length, 'besoin en vigueur', 'besoins en vigueur')}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <CaseArchives n={tous.length - enVigueur.length} coche={archives} onChange={setArchives} />
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refBesoin' })}>Nouveau besoin</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">Aucun besoin de poste : la ligne de couverture du planning compte les postes, sans minimum.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Équipe</th><th>Horaire</th><th>Jours</th><th className="right">Effectif minimal</th><th>Exigences du créneau</th><th>Période</th><th></th></tr></thead>
            <tbody>
              {lignes.map(b => {
                const ex = [...b.exigences.formations.map(f => nom(f, d.ds.referentiels.formations)), ...b.exigences.habilitations.map(h => nom(h, d.ds.referentiels.habilitations))];
                return (
                  <tr key={b.id}>
                    <td><Two main={b.equipe} sub={b.activite ?? undefined} /></td>
                    <td>{b.horaire}</td>
                    <td className="nowrap">{b.jours.map(j => JOURS_BESOIN[j]).join(' ')}</td>
                    <td className="right tnum">{b.effectifMin}</td>
                    <td>{ex.length ? ex.join(', ') : <span className="text-muted">—</span>}</td>
                    <td className="nowrap">{b.archive ? <Tag cls="tag-outline">Archivé</Tag> : `du ${fmtIso(b.du)}${b.au ? ` au ${fmtIso(b.au)}` : ''}`}</td>
                    <td className="right">
                      {rh && !b.archive && (
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'refBesoin', id: b.id })}>Modifier</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: archivageBesoin(b) })}>Archiver</button>
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
        Effectif minimal par horaire et par jour de la semaine, avec les exigences propres au créneau (en plus de celles du poste et de l’équipe), contrôlées à
        la date de chaque créneau avant la publication du planning.
      </Fine>
    </Panel>
  );
}
