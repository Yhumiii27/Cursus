// Fractionnement des congés payés sur l'écran Congés & absences (t046, shared/rules/fractionnement.ts) :
// - « Congé principal à prévoir » : dans les 60 jours qui précèdent la fin de la période du congé principal (31 octobre par
//   défaut), salariés qui n'ont pas encore posé la fraction continue de 12 jours ouvrables (10 ouvrés) dans la période ;
//   service RH et manager (son équipe), pour en parler avec le salarié — rien n'est bloqué.
// - « Jours de fractionnement à décider » : après la fin de la période, jours proposés par Cursus, crédités ou notés en
//   renonciation par le service RH (dialogue « fractionnement ») ; les autres profils de l'espace RH les voient.
import { useMemo } from 'react';
import { fJ } from '../../../shared/format.ts';
import { periodeCp } from '../../../shared/rules/conges.ts';
import { fenetrePrincipale, fenetreTexte, fractionnementsAFaire, jourMois, principauxAPrevoir } from '../../../shared/rules/fractionnement.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Two } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function Fractionnement() {
  const d = useDomain();
  const { espaceRh, rh, manager } = useRole();
  const { openDialog } = useStore();
  const aPrevoir = useMemo(() => (espaceRh || manager ? principauxAPrevoir(d) : []), [d, espaceRh, manager]);
  const aFaire = useMemo(() => (espaceRh ? fractionnementsAFaire(d) : []), [d, espaceRh]);
  const f = fenetrePrincipale(d.ds.settings, d.year);
  return (
    <>
      {aFaire.length > 0 && (
        <Panel highlight title={t('Split days to decide')} aside={t('Offered by Cursus, credited by HR · never automatically')}>
          <div className="list">
            {aFaire.map(g => (
              <div key={g.periode} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{t('Paid leave ')}{periodeCp(g.periode)}{t(' · main leave ')}{fenetreTexte(g.fenetre)}</div>
                  <div className="text-muted sub">
                    {tn(g.lignes.length, 'employee#salarie', 'employees#salarie')} · {fJ(g.lignes.reduce((n, l) => n + l.propose, 0))}{t(' offered (art. L3141-23), credit or waiver of the employee')}
                  </div>
                </div>
                {rh
                  ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'fractionnement', periode: g.periode })}>{t('Decide')}</button>
                  : <span className="text-muted sub">{t('Decision by HR')}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {aPrevoir.length > 0 && (
        <Panel title={t('Main leave to plan')} aside={`${t('12 consecutive working days (Mon–Sat) (10 Mon–Fri) to take before ')}${jourMois(f.au)}${t(' · art. L3141-18')}`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Longest leave in the period')}</th><th>{t('Balance of the period')}</th></tr></thead>
              <tbody>
                {aPrevoir.map(x => (
                  <tr key={x.e.id}>
                    <td>{x.e.nom}</td>
                    <td><Two main={`${fJ(x.etat.plusLong)}${t(' working#plural')}`} sub={`${fJ(x.etat.besoin)}${t(' consecutive expected')}`} /></td>
                    <td className="tnum">{fJ(x.reste)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
