// Équipes & managers (RH) : composition des équipes, désignation des managers et collaborateurs à affecter.
// Lot 11 (organigramme) : entité et site de chaque équipe (hérités d'une équipe au-dessus, le site à défaut de l'entité),
// rattachement par dialogs/EquipeRattachementDialog.tsx, alerte « équipe racine sans entité », lien vers l'organigramme.
import { useMemo, useState, type Ref } from 'react';
import { PlusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { CLS, EMP_LABEL, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } from '../../../shared/constants.ts';
import type { Domain, EmpX } from '../../../shared/domain.ts';
import { equipeLabel, fH, fJ } from '../../../shared/format.ts';
import { present } from '../../../shared/rules/contrats.ts';
import type { Employe, Equipe } from '../../../shared/types.ts';
import type { NomAction } from '../api.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Avatar, Btn, Empty, Fine, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { CartePick } from '../components/Cliquable.tsx';
import { ParenteEquipe, redirectionsManager } from '../components/Hierarchie.tsx';
import { changementManager, retraitEquipe, suppressionEquipe, type Confirmation } from '../state/confirmations.ts';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { CouvertureEquipe } from '../components/Couverture.tsx';
import { DelegationsManager } from '../components/Delegations.tsx';
// lot 11 — organigramme
import { TreeStructureIcon } from '@phosphor-icons/react';
import { entiteEquipe, rattachementSalarie } from '../../../shared/rules/entites.ts';
import { libelleSite } from '../organigramme-vue.ts';
import { t, tn } from '../i18n/langue.ts';

/** Contrat en deux lignes : « CDI · Cadre » et « Forfait jours · 218 j ». */
export function contratResume(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  const duree = c.forfait ? fJ(c.joursForfait) : c.annuel ? fH(c.heuresAnnuelles) : c.partiel || c.hebdo ? fH(c.base) : '';
  const temps = TEMPS_TRAVAIL[c.temps].court;
  return { main: `${TYPES_CONTRAT[c.typeContrat].label} · ${STATUTS[c.statut].court}`, sub: duree ? `${temps} · ${duree}` : temps };
}

/** Collaborateurs pouvant être désignés manager (les intérimaires et les salariés sortis sont exclus). */
export function managerCandidates(d: Domain): Employe[] {
  return d.ds.employes.filter(e => !d.contratOf(e).interim && present(e, d.ti)).sort((a, b) => a.nom.localeCompare(b.nom));
}

interface TeamView {
  q: Equipe;
  /** Lot 11 : entité (celle de l'équipe racine), site et unité Matrix effectifs ; `heriteSite` : site d'une équipe au-dessus ou de l'entité. */
  entite: string | null; site: string | null; unite: string | null; heriteSite: boolean;
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
  // Lecture seule : équipes, managers et membres consultés, sans modification.
  const { rh } = useRole();
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
      const entites = d.ds.referentiels.entites ?? [], sites = d.ds.referentiels.sites ?? [];
      const code = entiteEquipe(d.ds.referentiels.equipes, q.nom), ratt = rattachementSalarie(d.ds.referentiels.equipes, entites, q.nom);
      return {
        q, entite: entites.find(x => x.code === code)?.nom ?? null, site: ratt.siteCode ? libelleSite(sites, ratt.siteCode) : null, unite: ratt.uniteCode,
        heriteSite: !!ratt.siteCode && ratt.siteCode !== q.siteCode,
        members, conformes, pct: members.length ? Math.round(conformes / members.length * 100) : null,
        feuilles: soumises.filter(f => ids.has(f.empId)).length,
        absences: demandees.filter(a => ids.has(a.empId)).length,
        mgrNom: q.managerId ? d.personName(q.managerId) : null,
        mgrEquipe: mgr?.equipe,
        autres: d.teamsOf(q.managerId).filter(n => n !== q.nom),
        planLinked: d.ds.plan.some(l => l.equipe === q.nom),
      };
    });
    const aAffecter = emps.filter(e => !e.equipe).sort((a, b) => a.nom.localeCompare(b.nom));
    const managers = new Set(teams.map(x => x.q.managerId).filter(Boolean)).size;
    // Lot 11 : équipes racines sans entité (anomalie de l'organigramme, à rattacher par le service RH).
    const sansEntite = teams.filter(x => !x.q.parente && !x.entite).map(x => x.q.nom);
    return { teams, aAffecter, managers, candidates: managerCandidates(d), sansEntite };
  }, [d, emps]);

  const sel = v.teams.find(x => x.q.ordre === selOrdre) ?? v.teams[0] ?? null;
  // Écran étroit : le détail de l'équipe s'affiche sous les cartes ; choisir une équipe l'amène dans le champ de vision.
  const panneau = usePanneauVisible<HTMLElement>(sel && sel.q.ordre === selOrdre ? selOrdre : null);

  const act = async (name: NomAction, payload: Record<string, unknown>) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    return r;
  };

  return (
    <Page
      kicker={`${tn(v.teams.length, 'team', 'teams')} · ${tn(v.managers, 'manager', 'managers')} · ${tn(v.aAffecter.length, 'employee to assign', 'employees to assign')}`}
      title={t('Teams & managers')}
      actions={<>
        <Btn variant="secondary" icon={<TreeStructureIcon size={14} />} onClick={() => go('organigramme')}>{t('Organisation chart')}</Btn>
        {rh && <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'equipe' })}>{t('New team')}</Btn>}
      </>}
    >
      {v.sansEntite.length > 0 && (
        <Panel highlight title={t('Teams without an entity')} aside={tn(v.sansEntite.length, 'root team', 'root teams')}>
          <Fine>
            {v.sansEntite.join(', ')}{t(': ')}{t(v.sansEntite.length > 1 ? 'these teams belong' : 'this team belongs')}{t(' to no company and no establishment.')}
            {rh ? t(' Choose its entity with “Attachment” in the team detail (the approvals do not change).') : ''}
          </Fine>
        </Panel>
      )}
      {v.teams.length > 0 ? (
        <div className="cards-grid">
          {v.teams.map(tv => {
            const selected = sel?.q.ordre === tv.q.ordre;
            const pending = tv.feuilles + tv.absences;
            const select = () => setSelOrdre(tv.q.ordre);
            return (
              <CartePick key={tv.q.ordre} selected={selected} onSelect={select}>
                <div className="card-kicker">{tn(tv.members.length, 'member', 'members')}</div>
                <div className="card-title">{tv.q.nom}</div>
                {tv.q.parente && <div className="text-muted sub-11">{t('Attached to ')}{tv.q.parente}</div>}
                {/* Lot 11 : entité et site de l'équipe (colonnes Entité et Site). */}
                <div className="text-muted sub-11">
                  {tv.entite ?? (tv.q.parente ? t('No entity') : <Tag cls="tag-outline">{t('No entity')}</Tag>)}{tv.site ? ` · ${tv.site}` : ''}
                </div>
                {tv.mgrNom ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <Avatar nom={tv.mgrNom} size={24} />
                    <div style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontSize: 14 }}>{tv.mgrNom}</div>
                      <div className="text-muted sub">{tv.autres.length ? `${t('Manager · also manages ')}${tv.autres.join(', ')}` : t('Manager')}</div>
                    </div>
                  </div>
                ) : (
                  <div><Tag cls="tag-outline">{t('No manager — approvals by HR')}</Tag></div>
                )}
                <div className="stat-trio">
                  <div><div className="v">{tv.pct == null ? '—' : `${tv.pct} %`}</div><div className="text-muted sub-11">{t('compliant#plural')}</div></div>
                  <div><div className="v">{pending}</div><div className="text-muted sub-11">{t('pending approvals')}</div></div>
                </div>
                <div className="card-meta">
                  <span>{pending
                    ? [tv.feuilles && tn(tv.feuilles, 'timesheet#full', 'timesheets#full'), tv.absences && tn(tv.absences, 'absence', 'absences')].filter(Boolean).join(' · ') + t(' to approve')
                    : tv.members.length ? `${tv.conformes}${t(' of ')}${tv.members.length}${t(' without an expired item')}` : t('No employee assigned')}</span>
                </div>
              </CartePick>
            );
          })}
        </div>
      ) : (
        <Panel><Empty>{t('No team. Create the first team to assign employees to it and appoint its manager.')}</Empty></Panel>
      )}

      <div className="row-wrap">
        {sel && <TeamPanel panneau={panneau} t={sel} candidates={v.candidates} />}

        <Panel style={{ flex: '1 1 340px' }} highlight={v.aAffecter.length > 0} title={t('To assign')}
          aside={tn(v.aAffecter.length, 'employee', 'employees')}>
          <Fine>{t('Employees without a team: their hours, absences and reviews are approved by HR until their assignment.')}</Fine>
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
                      {rh && (
                        <select className="input" aria-label={`${t('Assign #verb')}${e.nom}${t(' to a team')}`} value="" disabled={busy || !v.teams.length}
                          onChange={ev => { if (ev.target.value) act('equipe.affecter', { empId: e.id, equipe: ev.target.value }); }}
                          style={{ width: 'auto', minWidth: 160 }}>
                          <option value="" disabled>{t('Assign to…')}</option>
                          {v.teams.map(x => <option key={x.q.ordre} value={x.q.nom}>{x.q.nom}</option>)}
                        </select>
                      )}
                      <Btn small onClick={() => go('collaborateurs', { selectedId: e.id })}>{t('Sheet →')}</Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {v.aAffecter.length === 0 && <Empty pad="sm">{t('All the employees are assigned to a team.')}</Empty>}
        </Panel>
      </div>
    </Page>
  );
}

/**
 * Détail de l'équipe choisie. Changer de manager, retirer un membre et supprimer l'équipe passent par une
 * confirmation (state/confirmations.ts) : la liste des managers changeait l'équipe dès la sélection, même
 * parcourue au clavier avec les flèches.
 */
function TeamPanel({ panneau, t: tv, candidates }: { panneau: Ref<HTMLElement>; t: TeamView; candidates: Employe[] }) {
  const { d } = useEnriched();
  const { openDialog, go } = useStore();
  const { rh, admin } = useRole();
  const nom = tv.q.nom;
  const mgrId = tv.q.managerId;
  const n = tv.members.length;
  const memberIds = new Set(tv.members.map(e => e.id));
  const inTeam = candidates.filter(e => memberIds.has(e.id));
  const others = candidates.filter(e => !memberIds.has(e.id));
  const mgrMissing = mgrId != null && !candidates.some(e => e.id === mgrId);
  const mgrIsMember = mgrId != null && memberIds.has(mgrId);

  const deleteBlock = n
    ? `${t('The team still has ')}${tn(n, 'member', 'members')}${t(': assign them to another team first.')}`
    : tv.planLinked ? t('Training plan actions are attached to this team.') : '';
  const confirmer = (c: Confirmation) => openDialog({ type: 'confirmer', c });
  const choisirManager = (val: string) => {
    const id = val ? Number(val) : null;
    if (id === mgrId) return;
    const nouveau = id != null ? candidates.find(e => e.id === id) ?? d.emp(id) : undefined;
    confirmer(changementManager(nom, tv.mgrNom, nouveau ? { id: nouveau.id, nom: nouveau.nom } : null, redirectionsManager(d, nom, id)));
  };

  const mgrNotes = [
    // Hiérarchie (t136) : le manager membre de l'équipe est validé par son responsable (équipe parente), sinon par le RH.
    `${t('The manager approves the hours, absences and reviews of the team. If they are a member of it, their own approvals go ')}${tv.q.parente ? `${t('to the manager of the parent team (')}${tv.q.parente})` : t('to HR, or to the manager of a parent team')}.`,
    tv.mgrNom && !mgrIsMember ? `${tv.mgrNom}${t(' is not a member of the team (')}${equipeLabel({ equipe: tv.mgrEquipe ?? null })}).` : '',
    tv.mgrNom && tv.autres.length ? `${tv.mgrNom}${t(' also manages ')}${tv.autres.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return (
    <Panel panneau={panneau} nommePar="equipe-detail" style={{ flex: '1 1 600px' }} head={
      <div className="panel-head center">
        {/* Lot 11 : aligné à gauche (la classe « center » centre aussi le texte), le détail tenant sur deux lignes. */}
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <h2 id="equipe-detail">{nom}</h2>
          <div className="text-muted sub">
            {tn(n, 'member', 'members')}{tv.pct != null ? ` · ${tv.pct}${t(' % compliant')}` : ''}{t(' · approvals: ')}{tv.mgrNom ?? t('HR#service')}{tv.q.parente ? `${t(' · attached to ')}${tv.q.parente}` : ''}
          </div>
          {/* Lot 11 : entité, site (hérité ou non) et unité de l'organigramme de Matrix. */}
          <div className="text-muted sub">
            {t('Entity: ')}{tv.entite ?? t('none#fem')}{t(' · Site: ')}{tv.site ? `${tv.site}${tv.heriteSite ? t(' (inherited)') : ''}` : t('none#masc')}{tv.unite ? `${t(' · Matrix unit: ')}${tv.unite}` : ''}
          </div>
        </div>
        {rh && (
          <div className="actions-end">
            <Btn small onClick={() => openDialog({ type: 'equipe', nom })}>{t('Rename')}</Btn>
            <Btn small onClick={() => openDialog({ type: 'equipeRattachement', nom })}>{t('Attachment')}</Btn>
            {admin && <Btn small disabled={!!deleteBlock} title={deleteBlock || undefined} onClick={() => confirmer(suppressionEquipe(nom))}>{t('Delete')}</Btn>}
            <Btn variant="secondary" small icon={<UserPlusIcon size={14} />} onClick={() => openDialog({ type: 'membre', equipe: nom })}>{t('Add a member')}</Btn>
          </div>
        )}
      </div>
    }>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <label htmlFor="equipe-manager">{t('Appoint the manager')}</label>
          {/* La liste garde le manager actuel tant que le changement n'est pas confirmé. */}
          <select className="input" id="equipe-manager" value={mgrId ?? ''} disabled={!rh} onChange={ev => choisirManager(ev.target.value)}>
            <option value="">{t('No manager — approvals by HR')}</option>
            {mgrMissing && <option value={mgrId!}>{tv.mgrNom}</option>}
            {inTeam.length > 0 && (
              <optgroup label={t('Members of the team')}>
                {inTeam.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={t('Other employees')}>
                {others.map(e => <option key={e.id} value={e.id}>{e.nom} — {equipeLabel(e)}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <ParenteEquipe q={tv.q} />
        <Fine>{mgrNotes}</Fine>
      </div>
      {/* Délégation des validations du manager pendant ses absences (t135). */}
      {mgrId != null && <DelegationsManager managerId={mgrId} cadre={false} />}

      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Employee')}</th><th>{t('Contract')}</th><th>{t('Compliance')}</th><th></th></tr></thead>
          <tbody>
            {tv.members.map(e => {
              const c = contratResume(d, e);
              return (
                <tr key={e.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Avatar nom={e.nom} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span className="nowrap">{e.nom}</span>
                          {e.id === mgrId && <Tag cls="tag-neutral">{t('Manager')}</Tag>}
                        </div>
                        <div className="text-muted sub">{e.poste}</div>
                      </div>
                    </div>
                  </td>
                  <td><Two main={c.main} sub={c.sub} nowrap /></td>
                  <td><Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag></td>
                  <td className="right">
                    <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                      {rh && <Btn small title={t('The employee becomes “to assign”')} onClick={() => confirmer(retraitEquipe(e.id, e.nom, nom))}>{t('Remove')}</Btn>}
                      <Btn small onClick={() => go('collaborateurs', { selectedId: e.id })}>{t('Sheet →')}</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Couverture minimale en SST et équipiers incendie (seuils : Référentiels → Postes). */}
      <CouvertureEquipe equipe={nom} />
      {n === 0 && <Empty pad="sm">{t('No member. Add employees to the team or delete it if it no longer has a reason to exist.')}</Empty>}
      {n === 0 && deleteBlock && <Fine>{t('Deletion impossible: ')}{deleteBlock.charAt(0).toLowerCase() + deleteBlock.slice(1)}</Fine>}
    </Panel>
  );
}
