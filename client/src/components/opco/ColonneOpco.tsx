// lot 11 — dossiers OPCO : cellule « OPCO » d'une ligne du plan (écran Plan & budget) : état et montant accordé de ses
// dossiers, qui ouvrent l'onglet « Dossiers OPCO » sur le dossier ; « Créer » (ou « Nouveau dossier » à côté de ceux qui
// existent : un dossier par dispositif ou par financeur) pour le service RH, sur toute ligne non reportée (un exercice clos
// ne bloque pas un dossier). Le montant accordé d'un dossier abandonné n'est plus affiché : il ne finance plus rien.
import { fmtEur } from '../../../../shared/format.ts';
import { dossiersDeLaLigne, STATUTS_OPCO } from '../../../../shared/rules/opco.ts';
import type { PlanAction } from '../../../../shared/types.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { t } from '../../i18n/langue.ts';

export function ColonneOpco({ l }: { l: PlanAction }) {
  const d = useDomain();
  const { setUi, openDialog } = useStore();
  const { rh } = useRole();
  const dossiers = dossiersDeLaLigne(d.ds.dossiersOpco, l.id);
  const creer = rh && l.statut !== 'reporte';
  const accorde = (x: (typeof dossiers)[number]) => (x.accordLe && x.statut !== 'abandonne' ? x.montantAccorde ?? 0 : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      {dossiers.map(x => (
        <button key={x.id} type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 var(--space-1)', whiteSpace: 'nowrap' }}
          aria-label={`${t('OPCO file: ')}${STATUTS_OPCO[x.statut].label}${accorde(x) != null ? `, ${fmtEur(accorde(x)!)}${t(' granted')}` : ''}${t(' — open')}`}
          onClick={() => setUi({ budgetOnglet: 'opco', opcoSel: x.id, opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null })}>
          {STATUTS_OPCO[x.statut].label}{accorde(x) != null ? ` · ${fmtEur(accorde(x)!)}` : ''}
        </button>
      ))}
      {creer && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 var(--space-1)' }} aria-label={t(dossiers.length ? 'Create another OPCO file' : 'Create an OPCO file')} onClick={() => openDialog({ type: 'opcoDossier', planActionId: l.id })}>{t(dossiers.length ? 'New file#opco' : 'Create')}</button>}
      {!dossiers.length && !creer && <span className="text-muted">—</span>}
    </div>
  );
}
