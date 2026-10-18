// Hiérarchie des managers (t136) : choix de l'équipe parente (écran Équipes & managers, service RH), éléments en attente
// qui changent de valideur annoncés avant l'enregistrement, et consultation N+2 (réglage `consultationN2`) : salariés
// transmis en lecture seule au manager (`Dataset.lectureSeule`, server/src/dataset.ts), marqués comme tels à l'écran.
import { useMemo } from 'react';
import { isoWeek } from '../../../shared/dates.ts';
import type { Domain } from '../../../shared/domain.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controleParente, elementsRediriges, type ElementRedirige, valideurHierarchique } from '../../../shared/rules/hierarchie.ts';
import type { Equipe } from '../../../shared/types.ts';
import { rattachementEquipe } from '../state/confirmations.ts';
import { useData, useStore } from '../state/store.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { Tag } from './ui.tsx';

/** Salariés consultés en lecture seule par le manager connecté (consultation N+2) ; vide ailleurs. */
export function useLectureSeule(): Set<number> {
  const data = useData();
  return useMemo(() => new Set(data.lectureSeule ?? []), [data]);
}

/** Mention d'un salarié consulté en lecture seule : ses décisions reviennent à son manager direct. */
export function LectureSeule({ d, empId }: { d: Domain; empId: number }) {
  const e = d.emp(empId);
  return <Tag cls="tag-outline"><span title={e ? `Consultation : les décisions reviennent à ${d.mgrName(d.mgrOf(e))}` : undefined}>Lecture seule</span></Tag>;
}

/** Élément redirigé, en une ligne : « Karim Haddad, congés du 07/12/2026 au 08/12/2026 ». */
function decrire(d: Domain, x: ElementRedirige): string {
  const nom = d.personName(x.empId);
  if (x.kind === 'absence') return `${nom}, congés du ${fmtIso(x.du)} au ${fmtIso(x.au)}`;
  if (x.kind === 'feuille') return `${nom}, feuille de la semaine ${isoWeek(x.week)}`;
  return `${nom}, entretien du ${fmtIso(x.date)}`;
}

/**
 * Équipe parente d'une équipe : liste des équipes qui peuvent l'accueillir (ni elle-même, ni une équipe qui lui est
 * rattachée, ni une hiérarchie au-delà de la profondeur maximale), choix confirmé avec les éléments redirigés.
 */
export function ParenteEquipe({ q }: { q: Equipe }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { rh } = useRole();
  const equipes = d.ds.referentiels.equipes;
  const possibles = equipes.filter(x => x.nom === q.parente || (x.nom !== q.nom && !controleParente(equipes, q.nom, x.nom))).map(x => x.nom);
  const choisir = (val: string) => {
    const parente = val || null;
    if (parente === (q.parente ?? null)) return;
    const apres = equipes.map(x => (x.nom === q.nom ? { ...x, parente } : x));
    const rediriges = elementsRediriges(d.ds, equipes, apres);
    const mgr = q.managerId ? d.emp(q.managerId) : undefined;
    // Manager membre de l'équipe : son valideur une fois l'équipe rattachée (mêmes règles que `Domain.mgrOf`).
    const valideur = mgr && mgr.equipe === q.nom ? d.mgrName(valideurHierarchique(apres, mgr)) : null;
    openDialog({ type: 'confirmer', c: rattachementEquipe(q.nom, parente, valideur, rediriges.map(x => decrire(d, x))) });
  };
  return (
    <div className="field" style={{ flex: '1 1 220px', maxWidth: 320 }}>
      <label htmlFor="equipe-parente">Équipe parente</label>
      {/* La liste garde l'équipe parente actuelle tant que le changement n'est pas confirmé. */}
      <select className="input" id="equipe-parente" value={q.parente ?? ''} disabled={!rh} onChange={ev => choisir(ev.target.value)}>
        <option value="">Aucune — manager validé par le RH</option>
        {possibles.map(nom => <option key={nom} value={nom}>{nom}</option>)}
      </select>
    </div>
  );
}
