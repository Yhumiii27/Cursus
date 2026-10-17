// Heures de délégation des élus au CSE (shared/rules/delegation.ts) : mandats sur la fiche (Collaborateurs, section
// Contrat ; saisis par le service RH, dialogs/MandatDialog.tsx) et compteur des 12 derniers mois sous la feuille de temps
// (écran Temps), comparé au crédit, avec report et limite d'une fois et demie le crédit. Alertes seulement.
// Le service RH et l'élu seuls reçoivent les mandats (server/src/dataset.ts) : sans mandat transmis, rien ne s'affiche ;
// le manager ne voit que la ligne INT-DELEG de la feuille.
import { parse } from '../../../shared/dates.ts';
import { fH, fmtIso } from '../../../shared/format.ts';
import { compteurDelegation, effectifSite, mandatsDe, ROLES_MANDAT } from '../../../shared/rules/delegation.ts';
import { CODE_DELEGATION } from '../../../shared/rules/activites.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Fine, NoteAccent, Panel } from './ui.tsx';

const moisLabel = (m: string) => parse(`${m}-01`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

/** Mandats de la fiche : service RH (saisie, modification) ; l'élu les voit dans son compteur. */
export function MandatsFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const mandats = mandatsDe(d.ds, e.id);
  if (!rh) return null;
  return (
    <div>
      <div className="text-muted sub">Mandat au CSE</div>
      {mandats.map(m => (
        <div key={m.id} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {ROLES_MANDAT[m.role]} · {m.au ? `du ${fmtIso(m.du)} au ${fmtIso(m.au)}` : `depuis le ${fmtIso(m.du)}`} · {fH(m.credit)} par mois
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'mandat', empId: e.id, id: m.id })}>Modifier</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'mandat', empId: e.id })}>
        {mandats.length ? 'Ajouter un mandat' : 'Enregistrer un mandat au CSE'}
      </button>
    </div>
  );
}

/** Compteur des heures de délégation d'un élu (écran Temps) : service RH, ou l'élu lui-même. */
export function CompteurDelegation({ emp }: { emp: Employe }) {
  const d = useDomain();
  const lignes = compteurDelegation(d.ds, emp.id, d.ti, effectifSite(d.ds, d.ti));
  if (!lignes?.length) return null;
  const alertes = lignes.flatMap(l => l.alertes.map(a => `${moisLabel(l.mois)} : ${a}`));
  return (
    <Panel title="Heures de délégation (CSE)" aside={ROLES_MANDAT[lignes.at(-1)!.role]}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Mois</th><th className="right">Crédit</th><th className="right">Utilisées</th><th className="right">Limite du mois</th><th className="right">Report sur 12 mois</th></tr></thead>
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
        Heures imputées au code {CODE_DELEGATION} dans les feuilles validées. Les heures non utilisées se reportent sur 12 mois ; dans le mois, une fois et demie
        le crédit au plus, mutualisation entre élus comprise (art. R2315-5 et R2315-6). Un dépassement est signalé, jamais bloqué (circonstances exceptionnelles,
        art. L2315-7). Visible par le service RH et l’élu seulement.
      </Fine>
    </Panel>
  );
}
