// lot 11 — dossiers OPCO : cellule « OPCO » d'une ligne du plan (écran Plan & budget) : état et montant accordé de ses
// dossiers, qui ouvrent l'onglet « Dossiers OPCO » sur le dossier ; « Créer » pour le service RH, sur une ligne non
// reportée qui n'a pas de dossier en cours (un exercice clos ne bloque pas un dossier).
import { fmtEur } from '../../../../shared/format.ts';
import { dossierActif, dossiersDeLaLigne, STATUTS_OPCO } from '../../../../shared/rules/opco.ts';
import type { PlanAction } from '../../../../shared/types.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';

export function ColonneOpco({ l }: { l: PlanAction }) {
  const d = useDomain();
  const { setUi, openDialog } = useStore();
  const { rh } = useRole();
  const dossiers = dossiersDeLaLigne(d.ds.dossiersOpco, l.id);
  const creer = rh && l.statut !== 'reporte' && !dossiers.some(dossierActif);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      {dossiers.map(x => (
        <button key={x.id} type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 var(--space-1)', whiteSpace: 'nowrap' }}
          aria-label={`Dossier OPCO : ${STATUTS_OPCO[x.statut].label}${x.accordLe ? `, ${fmtEur(x.montantAccorde ?? 0)} accordés` : ''} — ouvrir`}
          onClick={() => setUi({ budgetOnglet: 'opco', opcoSel: x.id, opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null })}>
          {STATUTS_OPCO[x.statut].label}{x.accordLe ? ` · ${fmtEur(x.montantAccorde ?? 0)}` : ''}
        </button>
      ))}
      {creer && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 var(--space-1)' }} aria-label="Créer un dossier OPCO" onClick={() => openDialog({ type: 'opcoDossier', planActionId: l.id })}>Créer</button>}
      {!dossiers.length && !creer && <span className="text-muted">—</span>}
    </div>
  );
}
