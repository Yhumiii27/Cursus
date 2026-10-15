// Ajouter un collaborateur à une équipe : RH pour toute équipe ; manager pour une équipe qu'il encadre, et seulement
// un salarié « à affecter » (libéré par son manager d'origine) ou membre d'une autre de ses équipes.
import { useState } from 'react';
import { equipeLabel, norm, plural } from '../../../shared/format.ts';
import type { Personne } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function MembreDialog({ equipe: equipe0 }: { equipe?: string | null }) {
  const d = useDomain();
  const { rh, manager, me } = useRole();
  const { run, closeDialog } = useStore();
  const equipes = rh ? d.equipes : manager ? d.teamsOf(me) : [];
  const [equipe, setEquipe] = useState(equipe0 && equipes.includes(equipe0) ? equipe0 : equipes[0] ?? '');
  const [search, setSearch] = useState('');
  const [empId, setEmpId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rh && !manager) return null;

  if (!equipes.length) {
    return (
      <Dialog title="Ajouter un membre" width={520} actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>
          {rh ? 'Aucune équipe n’est encore créée.' : 'Aucune équipe ne vous est confiée — le service RH désigne les managers d’équipe.'}
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
  const encadre = sel ? d.teamsOf(sel.id).filter(t => t !== equipe) : [];

  const confirm = async () => {
    if (!sel) return;
    setBusy(true);
    const r = await run('equipe.affecter', { empId: sel.id, equipe });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Ajouter un membre" width={560} tall actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!sel || !equipe || busy} onClick={confirm}>Ajouter à l’équipe</button>
    </>}>
      {equipes.length > 1
        ? (
          <Field label="Équipe" htmlFor="mb-eq">
            <select className="input" id="mb-eq" value={equipe} onChange={ev => { setEquipe(ev.target.value); setEmpId(null); }}>
              {equipes.map(nom => <option key={nom} value={nom}>{nom}</option>)}
            </select>
          </Field>
        )
        : <Field label="Équipe"><Static>{equipe}</Static></Field>}

      <Field label="Collaborateur" htmlFor="mb-q">
        <input className="input" id="mb-q" type="search" placeholder="Rechercher un nom, un poste, une équipe…" value={search} onChange={ev => setSearch(ev.target.value)} />
      </Field>
      <div role="radiogroup" aria-label="Collaborateur" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 'min(320px, 40vh)', overflow: 'auto' }}>
        {shown.map(p => {
          const checked = empId === p.id;
          return (
            <label key={p.id} className={`radio radio-opt${checked ? ' checked' : ''}`}>
              <input type="radio" name="mb-emp" checked={checked} onChange={() => setEmpId(p.id)} />
              <span className="dot" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14 }}>{p.nom} <span className="text-muted">— {p.equipe ?? 'à affecter'}</span></div>
                <div className="text-muted sub">{p.poste}</div>
              </div>
            </label>
          );
        })}
        {shown.length === 0 && (
          <Empty pad="sm">
            {candidats.length ? 'Aucun collaborateur ne correspond à cette recherche.'
              : exclus ? 'Aucun collaborateur à ajouter : les autres font déjà partie de cette équipe ou relèvent du service RH.'
              : 'Tous les collaborateurs font déjà partie de cette équipe.'}
          </Empty>
        )}
      </div>
      {!q && candidats.length > 0 && <Fine>{plural(candidats.length, 'collaborateur disponible', 'collaborateurs disponibles')}</Fine>}
      {!rh && <Fine>Seuls les salariés « à affecter », déjà libérés par leur manager d’origine, peuvent rejoindre votre équipe : pour un membre d’une autre équipe, demandez sa mutation au service RH.</Fine>}
      {managersExclus && <Fine>{`Les managers d’équipe${monManager ? ', dont votre propre manager,' : ''} ne sont pas proposés : leur affectation relève du service RH.`}</Fine>}

      {sel?.equipe && (
        <NoteAccent>
          {sel.nom} quittera l’équipe {sel.equipe}{ancienMgr ? `, encadrée par ${d.personName(ancienMgr)}` : ''}.
        </NoteAccent>
      )}
      {sel && encadre.length > 0 && <Fine>{sel.nom} reste manager {encadre.length > 1 ? 'des équipes' : 'de l’équipe'} {encadre.join(', ')}.</Fine>}
      <Fine>
        {rh
          ? `Ses temps et ses absences seront validés par ${d.mgrName(d.mgrOf({ id: sel?.id ?? -1, equipe }))}.`
          : 'Le collaborateur rejoint votre équipe : vous validerez ses temps et ses absences.'}
      </Fine>
    </Dialog>
  );
}
