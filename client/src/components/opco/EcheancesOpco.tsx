// lot 11 — dossiers OPCO : échéances des dossiers en cours sur l'écran Échéances (filtre « Dossiers OPCO »), à part des
// échéances par salarié : dépôt avant le début de la formation, accord attendu, justificatifs après la fin, remboursement
// attendu (shared/rules/opco.ts, `echeanceOpco`). Dépassées d'abord, puis celles des 12 prochains mois. Une ligne ouvre le
// dossier dans Plan & budget. Service RH et lecture seule (qui reçoivent les dossiers) ; rien pour les autres profils.
import { useMemo } from 'react';
import { fmtIso, rel } from '../../../../shared/format.ts';
import { addD } from '../../../../shared/dates.ts';
import { echeanceOpco, STATUTS_OPCO } from '../../../../shared/rules/opco.ts';
import { Ouvrir } from '../Cliquable.tsx';
import { Empty, Panel, Tag } from '../ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { CLS_OPCO, nomDossierOpco } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

/** Horizon des échéances à venir montrées : 12 mois, comme les renouvellements. */
const HORIZON_JOURS = 366;

export function EcheancesOpcoPanel() {
  const d = useDomain();
  const { go } = useStore();
  const { rh, consultation } = useRole();
  const lignes = useMemo(() => {
    const fin = addD(d.ti, HORIZON_JOURS);
    return (d.ds.dossiersOpco ?? []).filter(x => !x.annuleLe)
      .map(x => ({ x, e: echeanceOpco(x, d.ds.versementsOpco, d.ds.settings, d.ti) }))
      .filter((l): l is { x: typeof l.x; e: NonNullable<typeof l.e> } => !!l.e && l.e.echeance <= fin)
      .sort((a, b) => a.e.echeance.localeCompare(b.e.echeance) || a.x.id - b.x.id);
  }, [d]);
  if (!rh && !consultation) return null;
  const retards = lignes.filter(l => l.e.retard).length;
  const ouvrir = (id: number, exercice: number) => go('budget', { budgetOnglet: 'opco', opcoSel: id, exercice, opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null });
  return (
    <Panel title={t('OPCO files')} aside={lignes.length ? `${tn(lignes.length, 'due date', 'due dates')}${retards ? ` · ${tn(retards, 'overdue#fem', 'overdue#fem-plural')}` : ''}` : undefined}>
      {lignes.length > 0 && (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Action of the plan')}</th><th>{t('Due date')}</th><th>{t('Date')}</th><th>{t('State')}</th></tr></thead>
            <tbody>
              {lignes.map(({ x, e }) => (
                <tr key={x.id} className="clickable" onClick={() => ouvrir(x.id, x.exercice)}>
                  <td><Ouvrir onOpen={() => ouvrir(x.id, x.exercice)}>{nomDossierOpco(d, x)}</Ouvrir></td>
                  <td>{e.libelle}</td>
                  <td className="nowrap">
                    <div className="tnum">{fmtIso(e.echeance)}</div>
                    <div className="sub" style={e.retard ? { color: 'var(--color-accent-300)' } : undefined}>{rel(e.jours)}</div>
                  </td>
                  <td><Tag cls={CLS_OPCO[x.statut]}>{STATUTS_OPCO[x.statut].label}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lignes.length === 0 && <Empty pad="sm">{t('No OPCO file due date over the next 12 months.')}</Empty>}
      <p className="fine text-muted">{t('Delays set in Settings → OPCO files, to confirm with the conditions of the OPCO. HR also receive these due dates in the summary by e-mail, without amount or name.')}</p>
    </Panel>
  );
}
