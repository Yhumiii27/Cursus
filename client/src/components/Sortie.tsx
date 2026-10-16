// Sortie d'un salarié dans sa fiche (Collaborateurs, section Contrat) : date et motif enregistrés, fin prévue au contrat
// rétablie par une annulation, boutons du service RH (enregistrer, modifier ou annuler la sortie). Le motif n'est transmis
// qu'au service RH, à la paie, à la lecture seule et à l'intéressé (server/src/dataset.ts) : le manager ne voit que la date.
import { days, parse } from '../../../shared/dates.ts';
import { fmtIso, rel } from '../../../shared/format.ts';
import { sorti, sortieTexte } from '../../../shared/rules/contrats.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { annulationSortie } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { NoteAccent, Tag } from './ui.tsx';

const BOUTONS = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' } as const;

export function SortieFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const enregistree = !!e.motifSortie;
  const parti = sorti(e, d.ti);
  const enregistrer = <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'sortie', empId: e.id })}>
    {enregistree ? 'Modifier la sortie' : 'Enregistrer une sortie'}
  </button>;
  // Sans sortie enregistrée, la fin prévue d'un CDD ou d'une mission figure déjà dans la nature du contrat.
  if (!enregistree) return rh ? <div style={BOUTONS}>{enregistrer}</div> : null;
  const texte = sortieTexte(e)!, avant = e.fin ? days(d.today, parse(e.fin)) : null;
  const annuler = () => openDialog({ type: 'confirmer', c: annulationSortie(e, texte, e.typeContrat !== 'cdi' && (e.finPrevue ?? e.fin) ? fmtIso((e.finPrevue ?? e.fin)!) : null) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <div className="text-muted sub">Sortie</div>
        <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {texte}{parti && <Tag cls="tag-outline">Sorti</Tag>}
        </div>
        {rh && e.finPrevue && <div className="text-muted sub">Fin prévue au contrat : {fmtIso(e.finPrevue)}</div>}
      </div>
      {!parti && avant != null && <NoteAccent>Dernier jour {rel(avant)} : accès à Cursus jusqu’au {fmtIso(e.fin!)} inclus</NoteAccent>}
      {rh && (
        <div style={BOUTONS}>
          {enregistrer}
          <button type="button" className="btn btn-ghost btn-sm" onClick={annuler}>Annuler la sortie</button>
        </div>
      )}
    </div>
  );
}
