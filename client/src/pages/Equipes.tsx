// Équipes & managers (RH) : composition des équipes, désignation des managers et collaborateurs à affecter.
import { useMemo, useState } from 'react';
import { PlusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { CLS, EMP_LABEL, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } from '../../../shared/constants.ts';
import type { Domain, EmpX } from '../../../shared/domain.ts';
import { equipeLabel, fH, fJ, plural } from '../../../shared/format.ts';
import type { Employe, Equipe } from '../../../shared/types.ts';
import { Avatar, Btn, Empty, Fine, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Contrat en deux lignes : « CDI · Cadre » et « Forfait jours · 218 j ». */
export function contratResume(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  const duree = c.forfait ? fJ(c.joursForfait) : c.annuel ? fH(c.heuresAnnuelles) : c.partiel || c.hebdo ? fH(c.base) : '';
  const temps = TEMPS_TRAVAIL[c.temps].court;
  return { main: `${TYPES_CONTRAT[c.typeContrat].label} · ${STATUTS[c.statut].court}`, sub: duree ? `${temps} · ${duree}` : temps };
}

/** Collaborateurs pouvant être désignés manager (les intérimaires sont exclus). */
export function managerCandidates(d: Domain): Employe[] {
  return d.ds.employes.filter(e => !d.contratOf(e).interim).sort((a, b) => a.nom.localeCompare(b.nom));
}

interface TeamView {
  q: Equipe;
  members: EmpX[];
  conformes: number;
  pct: number | null;
  feuilles: number;
  absences: number;
  mgrNom: string | null;
  mgrEquipe: string | null | undefined;
  autres: string[];
  planLinked: boolean;
}

export function Equipes() {
  const { emps, d } = useEnriched();
  const { run, openDialog, go } = useStore();
  const [selOrdre, setSelOrdre] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const v = useMemo(() => {
    const soumises = d.ds.feuilles.filter(f => f.statut === 'soumise');
    const demandees = d.ds.absences.filter(a => a.statut === 'demandee');
    const teams: TeamView[] = [...d.ds.referentiels.equipes].sort((a, b) => a.ordre - b.ordre).map(q => {
      const members = emps.filter(e => e.equipe === q.nom)
        .sort((a, b) => Number(b.id === q.managerId) - Number(a.id === q.managerId) || a.nom.localeCompare(b.nom));
      const ids = new Set(members.map(e => e.id));
      const conformes = members.filter(e => e.worst !== 'exp').length;
      const mgr = q.managerId ? d.emp(q.managerId) : undefined;
      return {
        q, members, conformes, pct: members.length ? Math.round(conformes / members.length * 100) : null,
        feuilles: soumises.filter(f => ids.has(f.empId)).length,
        absences: demandees.filter(a => ids.has(a.empId)).length,
        mgrNom: q.managerId ? d.personName(q.managerId) : null,
        mgrEquipe: mgr?.equipe,
        autres: d.teamsOf(q.managerId).filter(n => n !== q.nom),
        planLinked: d.ds.plan.some(l => l.equipe === q.nom),
      };
    });
    const aAffecter = emps.filter(e => !e.equipe).sort((a, b) => a.nom.localeCompare(b.nom));
    const managers = new Set(teams.map(t => t.q.managerId).filter(Boolean)).size;
    return { teams, aAffecter, managers, candidates: managerCandidates(d) };
  }, [d, emps]);

  const sel = v.teams.find(t => t.q.ordre === selOrdre) ?? v.teams[0] ?? null;

  const act = async (name: string, payload: Record<string, unknown>) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    return r;
  };

  return (
    <Page
      kicker={`${plural(v.teams.length, 'équipe', 'équipes')} · ${plural(v.managers, 'manager', 'managers')} · ${plural(v.aAffecter.length, 'collaborateur à affecter', 'collaborateurs à affecter')}`}
      title="Équipes & managers"
      actions={<Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'equipe' })}>Nouvelle équipe</Btn>}
    >
      {v.teams.length > 0 ? (
        <div className="cards-grid">
          {v.teams.map(t => {
            const selected = sel?.q.ordre === t.q.ordre;
            const pending = t.feuilles + t.absences;
            const select = () => setSelOrdre(t.q.ordre);
            return (
              <article key={t.q.ordre} className={`card elev-sm pick${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-pressed={selected}
                onClick={select} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); } }}>
                <div className="card-kicker">{plural(t.members.length, 'membre', 'membres')}</div>
                <div className="card-title">{t.q.nom}</div>
                {t.mgrNom ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <Avatar nom={t.mgrNom} size={24} />
                    <div style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontSize: 14 }}>{t.mgrNom}</div>
                      <div className="text-muted sub">{t.autres.length ? `Manager · encadre aussi ${t.autres.join(', ')}` : 'Manager'}</div>
                    </div>
                  </div>
                ) : (
                  <div><Tag cls="tag-outline">Aucun manager — validations par le RH</Tag></div>
                )}
                <div className="stat-trio">
                  <div><div className="v">{t.pct == null ? '—' : `${t.pct} %`}</div><div className="text-muted sub-11">conformes</div></div>
                  <div><div className="v">{pending}</div><div className="text-muted sub-11">validations en attente</div></div>
                </div>
                <div className="card-meta">
                  <span>{pending
                    ? [t.feuilles && plural(t.feuilles, 'feuille de temps', 'feuilles de temps'), t.absences && plural(t.absences, 'absence', 'absences')].filter(Boolean).join(' · ') + ' à valider'
                    : t.members.length ? `${t.conformes} sur ${t.members.length} sans élément expiré` : 'Aucun collaborateur affecté'}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel><Empty>Aucune équipe. Créez la première équipe pour y affecter des collaborateurs et désigner son manager.</Empty></Panel>
      )}

      <div className="row-wrap">
        {sel && <TeamPanel t={sel} candidates={v.candidates} busy={busy} act={act} onDeleted={() => setSelOrdre(null)} />}

        <Panel style={{ flex: '1 1 340px' }} highlight={v.aAffecter.length > 0} title="À affecter"
          aside={plural(v.aAffecter.length, 'collaborateur', 'collaborateurs')}>
          <Fine>Collaborateurs sans équipe : leurs heures, absences et entretiens sont validés par le service RH jusqu’à leur affectation.</Fine>
          {v.aAffecter.length > 0 && (
            <div className="list">
              {v.aAffecter.map(e => {
                const c = contratResume(d, e);
                return (
                  <div key={e.id} className="list-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    <Avatar nom={e.nom} />
                    <div className="grow">
                      <div className="ellipsis" style={{ fontSize: 14 }}>{e.nom}</div>
                      <div className="text-muted sub ellipsis">{[e.poste, c.main].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 'none' }}>
                      <select className="input" aria-label={`Affecter ${e.nom} à une équipe`} value="" disabled={busy || !v.teams.length}
                        onChange={ev => { if (ev.target.value) act('equipe.affecter', { empId: e.id, equipe: ev.target.value }); }}
                        style={{ width: 'auto', minWidth: 160 }}>
                        <option value="" disabled>Affecter à…</option>
                        {v.teams.map(t => <option key={t.q.ordre} value={t.q.nom}>{t.q.nom}</option>)}
                      </select>
                      <Btn small onClick={() => go('collaborateurs', { selectedId: e.id })}>Fiche →</Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {v.aAffecter.length === 0 && <Empty pad="sm">Tous les collaborateurs sont affectés à une équipe.</Empty>}
        </Panel>
      </div>
    </Page>
  );
}

function TeamPanel({ t, candidates, busy, act, onDeleted }: {
  t: TeamView; candidates: Employe[]; busy: boolean;
  act: (name: string, payload: Record<string, unknown>) => Promise<{ ok: boolean }>; onDeleted: () => void;
}) {
  const { d } = useEnriched();
  const { openDialog, go } = useStore();
  const nom = t.q.nom;
  const mgrId = t.q.managerId;
  const n = t.members.length;
  const memberIds = new Set(t.members.map(e => e.id));
  const inTeam = candidates.filter(e => memberIds.has(e.id));
  const others = candidates.filter(e => !memberIds.has(e.id));
  const mgrMissing = mgrId != null && !candidates.some(e => e.id === mgrId);
  const mgrIsMember = mgrId != null && memberIds.has(mgrId);

  const deleteBlock = n
    ? `L’équipe compte encore ${plural(n, 'membre', 'membres')} : affectez-les d’abord à une autre équipe.`
    : t.planLinked ? 'Des actions du plan de formation sont rattachées à cette équipe.' : '';
  const supprimer = async () => {
    if (!window.confirm(`Supprimer l’équipe ${nom} ? Ses enveloppes budgétaires de formation seront supprimées.`)) return;
    const r = await act('equipe.supprimer', { nom });
    if (r.ok) onDeleted();
  };

  const mgrNotes = [
    'Le manager valide les heures, les absences et les entretiens de l’équipe. S’il en est membre, ses propres validations reviennent au service RH.',
    t.mgrNom && !mgrIsMember ? `${t.mgrNom} n’est pas membre de l’équipe (${equipeLabel({ equipe: t.mgrEquipe ?? null })}).` : '',
    t.mgrNom && t.autres.length ? `${t.mgrNom} encadre aussi ${t.autres.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return (
    <Panel style={{ flex: '1 1 600px' }} head={
      <div className="panel-head center">
        <div style={{ minWidth: 0 }}>
          <h2>{nom}</h2>
          <div className="text-muted sub">
            {plural(n, 'membre', 'membres')}{t.pct != null ? ` · ${t.pct} % conformes` : ''} · validations : {t.mgrNom ?? 'service RH'}
          </div>
        </div>
        <div className="actions-end">
          <Btn small onClick={() => openDialog({ type: 'equipe', nom })}>Renommer</Btn>
          <Btn small disabled={busy || !!deleteBlock} title={deleteBlock || undefined} onClick={supprimer}>Supprimer</Btn>
          <Btn variant="secondary" small icon={<UserPlusIcon size={14} />} onClick={() => openDialog({ type: 'membre', equipe: nom })}>Ajouter un membre</Btn>
        </div>
      </div>
    }>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <label htmlFor="equipe-manager">Désigner le manager</label>
          <select className="input" id="equipe-manager" value={mgrId ?? ''} disabled={busy}
            onChange={ev => act('equipe.manager', { nom, managerId: ev.target.value ? Number(ev.target.value) : null })}>
            <option value="">Aucun manager — validations par le RH</option>
            {mgrMissing && <option value={mgrId!}>{t.mgrNom}</option>}
            {inTeam.length > 0 && (
              <optgroup label="Membres de l’équipe">
                {inTeam.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Autres collaborateurs">
                {others.map(e => <option key={e.id} value={e.id}>{e.nom} — {equipeLabel(e)}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <Fine>{mgrNotes}</Fine>
      </div>

      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Collaborateur</th><th>Contrat</th><th>Conformité</th><th></th></tr></thead>
          <tbody>
            {t.members.map(e => {
              const c = contratResume(d, e);
              return (
                <tr key={e.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Avatar nom={e.nom} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span className="nowrap">{e.nom}</span>
                          {e.id === mgrId && <Tag cls="tag-neutral">Manager</Tag>}
                        </div>
                        <div className="text-muted sub">{e.poste}</div>
                      </div>
                    </div>
                  </td>
                  <td><Two main={c.main} sub={c.sub} nowrap /></td>
                  <td><Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag></td>
                  <td className="right">
                    <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                      <Btn small disabled={busy} title="Le collaborateur devient « à affecter »" onClick={() => act('equipe.affecter', { empId: e.id, equipe: null })}>Retirer</Btn>
                      <Btn small onClick={() => go('collaborateurs', { selectedId: e.id })}>Fiche →</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {n === 0 && <Empty pad="sm">Aucun membre. Ajoutez des collaborateurs à l’équipe ou supprimez-la si elle n’a plus lieu d’être.</Empty>}
      {n === 0 && deleteBlock && <Fine>Suppression impossible : {deleteBlock.charAt(0).toLowerCase() + deleteBlock.slice(1)}</Fine>}
    </Panel>
  );
}
