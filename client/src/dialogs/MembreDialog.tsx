// Ajouter un collaborateur à une équipe : RH pour toute équipe ; manager pour une équipe qu'il encadre, et seulement
// un salarié « à affecter » (libéré par son manager d'origine) ou membre d'une autre de ses équipes.
import { useState } from 'react';
import { equipeLabel, norm } from '../../../shared/format.ts';
import type { Personne } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function MembreDialog({ equipe: equipe0 }: { equipe?: string | null }) {
  const d = useDomain();
  const { rh, manager, me } = useRole();
  const { run, closeDialog } = useStore();
  const equipes = rh ? d.equipes : manager ? d.teamsOf(me) : [];
  const [equipe, setEquipe] = useState(equipe0 && equipes.includes(equipe0) ? equipe0 : equipes[0] ?? '');
  const [search, setSearch] = useState('');
  const [empId, setEmpId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!rh && !manager) return null;

  if (!equipes.length) {
    return (
      <Dialog title={t('Add a member')} width={520} actions={<CancelButton label={t('Close')} />}>
        <p className="text-muted" style={{ margin: 0 }}>
          {t(rh ? 'No team has been created yet.' : 'No team is entrusted to you — HR appoints the team managers.')}
        </p>
      </Dialog>
    );
  }

  // Manager : les managers d'équipe et son propre manager changent d'équipe par le service RH
  // (pas de validation croisée entre managers) ; le membre d'une autre équipe passe par une mutation décidée par le RH.
  const moi = d.ds.annuaire.find(p => p.id === me) ?? (me != null ? d.emp(me) : undefined);
  const monManager = !rh && moi ? d.mgrOf(moi) : 0;
  const mesEquipes = rh ? [] : d.teamsOf(me);
  const autreEquipe = (p: Personne) => !rh && !!p.equipe && !mesEquipes.includes(p.equipe);
  const reserveRh = (p: Personne) => !rh && (d.teamsOf(p.id).length > 0 || (!!monManager && p.id === monManager) || autreEquipe(p));
  // Hors membres actuels de l'équipe et hors l'utilisateur lui-même ; les personnes à affecter d'abord.
  const autres = d.ds.annuaire.filter(p => p.equipe !== equipe && p.id !== me);
  const candidats: Personne[] = autres
    .filter(p => !reserveRh(p))
    .sort((a, b) => Number(!!a.equipe) - Number(!!b.equipe) || a.nom.localeCompare(b.nom, 'fr'));
  const q = norm(search.trim());
  const shown = q ? candidats.filter(p => norm(`${p.nom} ${p.poste} ${equipeLabel(p)}`).includes(q)) : candidats;
  const exclus = autres.length - candidats.length;
  /** Personnes qui pourraient rejoindre l'équipe sans leur rôle de manager (ou de propre manager). */
  const managersExclus = autres.some(p => !autreEquipe(p) && reserveRh(p));
  const sel = candidats.find(p => p.id === empId) ?? null;
  const ancienMgr = sel?.equipe ? d.mgrOf(sel) : 0;
  const encadre = sel ? d.teamsOf(sel.id).filter(x => x !== equipe) : [];

  const selErr = !sel ? t('Choose the employee to add from the list.') : null;
  const confirm = async () => {
    if (busy || !v.verifier(selErr) || !sel) return;
    setBusy(true);
    const r = await run('equipe.affecter', { empId: sel.id, equipe });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Add a member')} width={560} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Add to the team')}</SubmitButton>
    </>}>
      {equipes.length > 1
        ? (
          <Field label={t('Team')} htmlFor="mb-eq">
            <select className="input" id="mb-eq" value={equipe} onChange={ev => { setEquipe(ev.target.value); setEmpId(null); }}>
              {equipes.map(nom => <option key={nom} value={nom}>{nom}</option>)}
            </select>
          </Field>
        )
        : <Field label={t('Team')}><Static>{equipe}</Static></Field>}

      <Field label={t('Employee')} htmlFor="mb-q">
        {/* Entrée dans la recherche n'envoie pas le formulaire : elle choisit le seul collaborateur trouvé. */}
        <input className="input" id="mb-q" type="search" placeholder={t('Search a name, a job, a team…')} value={search} onChange={ev => setSearch(ev.target.value)}
          onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (shown.length === 1) setEmpId(shown[0].id); } }} />
      </Field>
      <div role="radiogroup" aria-label={t('Employee')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 'min(320px, 40vh)', overflow: 'auto' }}>
        {shown.map(p => {
          const checked = empId === p.id;
          return (
            <label key={p.id} className={`radio radio-opt${checked ? ' checked' : ''}`}>
              <input type="radio" name="mb-emp" checked={checked} onChange={() => setEmpId(p.id)} />
              <span className="dot" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14 }}>{p.nom} <span className="text-muted">— {p.equipe ?? t('to assign')}</span></div>
                <div className="text-muted sub">{p.poste}</div>
              </div>
            </label>
          );
        })}
        {shown.length === 0 && (
          <Empty pad="sm">
            {candidats.length ? t('No employee matches this search.')
              : exclus ? t('No employee to add: the others are already part of this team or fall under HR.')
              : t('All the employees are already part of this team.')}
          </Empty>
        )}
      </div>
      {v.erreur(selErr) && <Bloquant>{selErr}</Bloquant>}
      {!q && candidats.length > 0 && <Fine>{tn(candidats.length, 'available employee', 'available employees')}</Fine>}
      {!rh && <Fine>{t('Only employees “to assign”, already released by their original manager, can join your team: for a member of another team, ask HR for their transfer.')}</Fine>}
      {managersExclus && <Fine>{`${t('Team managers')}${monManager ? t(', including your own manager,') : ''}${t(' are not offered: their assignment falls under HR.')}`}</Fine>}

      {sel?.equipe && (
        <NoteAccent>
          {sel.nom}{t(' will leave the team ')}{sel.equipe}{ancienMgr ? `${t(', managed by ')}${d.personName(ancienMgr)}` : ''}.
        </NoteAccent>
      )}
      {sel && encadre.length > 0 && <Fine>{sel.nom}{t(' remains manager ')}{t(encadre.length > 1 ? 'of the teams' : 'of the team')} {encadre.join(', ')}.</Fine>}
      <Fine>
        {rh
          ? `${t('Their hours and absences will be approved by ')}${d.mgrName(d.mgrOf({ id: sel?.id ?? -1, equipe }))}.`
          : t('The employee joins your team: you will approve their hours and absences.')}
      </Fine>
    </Dialog>
  );
}
