// Information des salariés sur leurs congés payés au retour d'un arrêt de maladie ou d'accident (art. L3141-19-3,
// shared/rules/information-retour.ts), écran Congés & absences :
// - service RH : tâche « Informations au retour à faire », une ligne par retour d'arrêt, « Informer » sur confirmation
//   (jours communiqués, échéances) ; à donner dans le mois qui suit la reprise ;
// - collaborateur : informations reçues (jours, date limite, échéance du report), dans son espace seulement.
// Le manager et les profils restreints n'en reçoivent rien : la tâche désigne un arrêt de santé (server/src/dataset.ts).
import { useMemo } from 'react';
import { equipeLabel, fJ, fmtIso, plural } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { periodeCp } from '../../../shared/rules/conges.ts';
import { contenuInformation, retoursAInformer, type RetourAInformer } from '../../../shared/rules/information-retour.ts';
import type { Domain } from '../../../shared/domain.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Tag, Two } from './ui.tsx';

/** Confirmation de l'information : ce qui sera communiqué au salarié, et ses effets. */
export function confirmationInformation(d: Domain, r: RetourAInformer): Confirmation {
  const c = contenuInformation(d, r.e, r.a, d.ti);
  return {
    titre: 'Informer le salarié de ses congés',
    question: `Informer ${r.e.nom} de ses congés payés à son retour (absence ${periodeTexte(r.a.du, r.a.au)}) ?`,
    suites: [
      `${fJ(c.jours)} de congés payés sur la période ${periodeCp(c.periode)}, à prendre jusqu’au ${fmtIso(c.limite)} ; ${fJ(c.arret)} acquis pendant l’absence.`,
      `Les jours non pris du fait de l’absence sont reportés jusqu’au ${fmtIso(c.echeance)} : les reports légaux en cours courent 15 mois à compter d’aujourd’hui.`,
      `${r.e.nom} reçoit l’information par e-mail, sans la nature de l’absence ; elle est enregistrée dans Cursus.`,
    ],
    bouton: 'Informer',
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
        <Panel highlight title="Informations au retour à faire" aside={`${plural(aFaire.length, 'retour d’arrêt', 'retours d’arrêt')} · jours de congés et date limite à communiquer dans le mois (art. L3141-19-3)`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Absence</th><th>Reprise</th><th>À informer avant le</th><th></th></tr></thead>
              <tbody>
                {aFaire.map(r => (
                  <tr key={r.a.id}>
                    <td><Two main={r.e.nom} sub={equipeLabel(r.e)} nowrap /></td>
                    <td>{periodeTexte(r.a.du, r.a.au)}</td>
                    <td className="nowrap">{fmtIso(r.retour)}</td>
                    <td className="nowrap">{fmtIso(r.avant)}{r.retard && <> <Tag cls="tag-accent">En retard</Tag></>}</td>
                    <td className="right">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'confirmer', c: confirmationInformation(d, r) })}>Informer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {recues.length > 0 && (
        <Panel title="Vos congés à votre retour" aside="Information du service RH après une absence (art. L3141-19-3)">
          <div className="list">
            {recues.map(i => (
              <div key={i.id} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>Le {fmtIso(i.le)}, après votre absence {periodeTexte(i.du, i.au)}</div>
                  <div className="text-muted sub">
                    {fJ(i.jours)} à prendre jusqu’au {fmtIso(i.limite)} · {fJ(i.arret)} acquis pendant l’absence · jours non pris du fait de l’absence reportés jusqu’au {fmtIso(i.echeance)}
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
