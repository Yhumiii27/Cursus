// Choix des formations et habilitations exigées (poste ou équipe : dialogs/RefPosteDialog.tsx, RefEquipeDialog.tsx) :
// cases à cocher du référentiel en vigueur, et éléments déjà exigés archivés depuis (plus exigés tant qu'ils le restent).
// Proposition : les titres que détiennent déjà tous les titulaires (shared/rules/exigences.ts), à valider.
import { actif } from '../../../shared/rules/referentiels.ts';
import type { Exigences } from '../../../shared/types.ts';
import { Field, Static } from './Dialog.tsx';
import { useDomain } from '../state/derived.ts';

/** Cases à cocher d'une liste (formations ou habilitations), dans l'ordre du référentiel. */
function Cases({ label, items, coches, onChange }: {
  label: string; items: { id: string; label: string; archive: boolean }[]; coches: string[]; onChange: (v: string[]) => void;
}) {
  const cocher = (id: string, oui: boolean) => onChange(oui ? items.map(x => x.id).filter(x => x === id || coches.includes(x)) : coches.filter(x => x !== id));
  return (
    <div className="chips" role="group" aria-label={label} style={{ gap: 'var(--space-2) var(--space-4)' }}>
      {items.map(x => (
        <label key={x.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={coches.includes(x.id)} onChange={e => cocher(x.id, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {x.label}{x.archive ? <span className="text-muted"> · archivée, plus exigée</span> : null}
        </label>
      ))}
    </div>
  );
}

export function ExigencesChoix({ value, onChange, avant, erreurs }: {
  value: Exigences; onChange: (v: Exigences) => void; avant: Exigences | null;
  erreurs: { formations?: string | null; habilitations?: string | null };
}) {
  const d = useDomain();
  const r = d.ds.referentiels;
  const formations = r.formations.filter(f => actif(f) || avant?.formations.includes(f.id)).map(f => ({ id: f.id, label: f.court, archive: !actif(f) }));
  const habilitations = r.habilitations.filter(h => actif(h) || avant?.habilitations.includes(h.id)).map(h => ({ id: h.id, label: h.nom, archive: !actif(h) }));
  return <>
    <Field label="Formations exigées" erreur={erreurs.formations}>
      {formations.length
        ? <Cases label="Formations exigées" items={formations} coches={value.formations} onChange={f => onChange({ ...value, formations: f })} />
        : <Static pad>Catalogue des formations vide (onglet Formations).</Static>}
    </Field>
    <Field label="Habilitations exigées" erreur={erreurs.habilitations}>
      {habilitations.length
        ? <Cases label="Habilitations exigées" items={habilitations} coches={value.habilitations} onChange={h => onChange({ ...value, habilitations: h })} />
        : <Static pad>Aucune habilitation au référentiel (onglet Habilitations).</Static>}
    </Field>
  </>;
}
