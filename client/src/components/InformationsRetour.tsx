// Information des salariés sur leurs congés payés au retour d'un arrêt de maladie ou d'accident (art. L3141-19-3,
// shared/rules/information-retour.ts), écran Congés & absences :
// - service RH : tâche « Informations au retour à faire », une ligne par retour d'arrêt, « Informer » sur confirmation
//   (jours communiqués, échéances) ; à donner dans le mois qui suit la reprise ;
// - collaborateur : informations reçues (jours, date limite, échéance du report), dans son espace seulement.
// Le manager et les profils restreints n'en reçoivent rien : la tâche désigne un arrêt de santé (server/src/dataset.ts).
import { useMemo } from 'react';
import { equipeLabel, fJ, fmtIso } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { periodeCp } from '../../../shared/rules/conges.ts';
import { contenuInformation, retoursAInformer, type RetourAInformer } from '../../../shared/rules/information-retour.ts';
import type { Domain } from '../../../shared/domain.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Tag, Two } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Confirmation de l'information : ce qui sera communiqué au salarié, et ses effets. */
export function confirmationInformation(d: Domain, r: RetourAInformer): Confirmation {
  const c = contenuInformation(d, r.e, r.suite, d.ti);
  return {
    titre: t('Inform the employee of their leave'),
    question: `${t('Inform ')}${r.e.nom}${t(' of their paid leave on their return (absence ')}${periodeTexte(r.du, r.a.au)}) ?`,
    suites: [
      `${fJ(c.jours)}${t(' of paid leave on the period ')}${periodeCp(c.periode)}${t(', to take until ')}${fmtIso(c.limite)}${t('; ')}${fJ(c.arret)}${t(' accrued during the absence.')}`,
      `${t('The days not taken because of the absence are carried over until ')}${fmtIso(c.echeance)}${t(': the legal carry-overs in progress run for 15 months from today.')}`,
      `${r.e.nom}${t(' receives the information by e-mail, without the nature of the absence; it is recorded in Cursus.')}`,
    ],
    bouton: t('Inform'),
    action: 'conges.informer',
    payload: { id: r.a.id },
  };
}

export function InformationsRetour() {
  const d = useDomain();
  const { rh, collab, me, soi } = useRole();
  const { openDialog } = useStore();
  // Un membre du RH ne s'informe pas lui-même : un autre membre du service RH le fait.
  const aFaire = useMemo(() => (rh ? retoursAInformer(d).filter(r => r.e.id !== soi) : []), [d, rh, soi]);
  const recues = collab ? (d.ds.informationsCp ?? []).filter(i => i.empId === me).sort((a, b) => b.le.localeCompare(a.le)) : [];
  return (
    <>
      {aFaire.length > 0 && (
        <Panel highlight title={t('Information on return to give')} aside={`${tn(aFaire.length, 'return from sick leave', 'returns from sick leave')}${t(' · days of leave and deadline to communicate within the month (art. L3141-19-3)')}`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Absence')}</th><th>{t('Return#work')}</th><th>{t('To inform before')}</th><th></th></tr></thead>
              <tbody>
                {aFaire.map(r => (
                  <tr key={r.a.id}>
                    <td><Two main={r.e.nom} sub={equipeLabel(r.e)} nowrap /></td>
                    <td>{periodeTexte(r.du, r.a.au)}</td>
                    <td className="nowrap">{fmtIso(r.retour)}</td>
                    <td className="nowrap">{fmtIso(r.avant)}{r.retard && <> <Tag cls="tag-accent">{t('Late')}</Tag></>}</td>
                    <td className="right">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'confirmer', c: confirmationInformation(d, r) })}>{t('Inform')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {recues.length > 0 && (
        <Panel title={t('Your leave on your return')} aside={t('Information from HR after an absence (art. L3141-19-3)')}>
          <div className="list">
            {recues.map(i => (
              <div key={i.id} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{t('On#cap-le')} {fmtIso(i.le)}{t(', after your absence ')}{periodeTexte(i.du, i.au)}</div>
                  <div className="text-muted sub">
                    {fJ(i.jours)}{t(' to take until ')}{fmtIso(i.limite)} · {fJ(i.arret)}{t(' accrued during the absence · days not taken because of the absence carried over until ')}{fmtIso(i.echeance)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
