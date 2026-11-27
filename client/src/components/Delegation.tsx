// Heures de délégation des élus au CSE (shared/rules/delegation.ts) : mandats sur la fiche (Collaborateurs, section
// Contrat ; saisis par le service RH, dialogs/MandatDialog.tsx) et compteur des 12 derniers mois sous la feuille de temps
// (écran Temps), comparé au crédit, avec report et limite d'une fois et demie le crédit. Alertes seulement.
// Le service RH et l'élu seuls reçoivent les mandats (server/src/dataset.ts) : sans mandat transmis, rien ne s'affiche ;
// le manager ne voit que la ligne INT-DELEG de la feuille.
import { parse } from '../../../shared/dates.ts';
import { fH, fmtIso } from '../../../shared/format.ts';
import { compteurDelegation, effectifReference, mandatsDe, ROLES_MANDAT } from '../../../shared/rules/delegation.ts';
import { CODE_DELEGATION } from '../../../shared/rules/activites.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Fine, NoteAccent, Panel } from './ui.tsx';
import { t } from '../i18n/langue.ts';

const moisLabel = (m: string) => parse(`${m}-01`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

/** Mandats de la fiche : service RH (saisie, modification) ; l'élu les voit dans son compteur. */
export function MandatsFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, soi } = useRole();
  const { openDialog } = useStore();
  const mandats = mandatsDe(d.ds, e.id);
  if (!rh) return null;
  // Sa propre fiche : un autre membre du service RH saisit le mandat (refusé par le serveur, refuserSoiMeme).
  const modifiable = e.id !== soi;
  return (
    <div>
      <div className="text-muted sub">{t('CSE mandate')}</div>
      {mandats.map(m => (
        <div key={m.id} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {ROLES_MANDAT[m.role]} · {m.au ? `${t('from #du-min')}${fmtIso(m.du)}${t(' to #au')}${fmtIso(m.au)}` : `${t('since ')}${fmtIso(m.du)}`} · {fH(m.credit)}{t(' a month')}
          {modifiable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'mandat', empId: e.id, id: m.id })}>{t('Edit')}</button>}
        </div>
      ))}
      {modifiable ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'mandat', empId: e.id })}>
          {t(mandats.length ? 'Add a mandate' : 'Record a CSE mandate')}
        </button>
      ) : !mandats.length ? <div className="text-muted" style={{ fontSize: 13 }}>{t('No mandate: another member of HR enters yours.')}</div> : null}
    </div>
  );
}

/** Compteur des heures de délégation d'un élu (écran Temps) : service RH, ou l'élu lui-même. */
export function CompteurDelegation({ emp }: { emp: Employe }) {
  const d = useDomain();
  const lignes = compteurDelegation(d.ds, emp.id, d.ti, effectifReference(d.ds, d.ti));
  if (!lignes?.length) return null;
  const alertes = lignes.flatMap(l => l.alertes.map(a => `${moisLabel(l.mois)}${t(': ')}${a}`));
  return (
    <Panel title={t('Delegation hours (CSE)')} aside={ROLES_MANDAT[lignes.at(-1)!.role]}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>{t('Month')}</th><th className="right">{t('Credit#noun')}</th><th className="right">{t('Used#fem-plural')}</th><th className="right">{t('Limit of the month')}</th><th className="right">{t('Carry-over over 12 months')}</th></tr></thead>
          <tbody>
            {lignes.map(l => (
              <tr key={l.mois}>
                <td className="nowrap">{moisLabel(l.mois)}</td>
                <td className="right tnum">{fH(l.credit)}</td>
                <td className="right tnum" style={{ color: l.alertes.length ? 'var(--color-accent-300)' : 'inherit' }}>{fH(l.utilisees)}</td>
                <td className="right tnum">{fH(l.limite)}</td>
                <td className="right tnum">{fH(l.report)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {alertes.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
      <Fine>
        {t('Hours charged to the code ')}{CODE_DELEGATION}{t(' in the approved timesheets. Unused hours are carried over for 12 months; within the month, one and a half times the credit at most, pooling between elected members included (art. R2315-5 and R2315-6). An excess is reported, never blocked (exceptional circumstances, art. L2315-7). Visible to HR and the elected member only.')}
      </Fine>
    </Panel>
  );
}
