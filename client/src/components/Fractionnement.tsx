// Fractionnement des congés payés sur l'écran Congés & absences (t046, shared/rules/fractionnement.ts) :
// - « Congé principal à prévoir » : dans les 60 jours qui précèdent la fin de la période du congé principal (31 octobre par
//   défaut), salariés qui n'ont pas encore posé la fraction continue de 12 jours ouvrables (10 ouvrés) dans la période ;
//   service RH et manager (son équipe), pour en parler avec le salarié — rien n'est bloqué.
// - « Jours de fractionnement à décider » : après la fin de la période, jours proposés par Cursus, crédités ou notés en
//   renonciation par le service RH (dialogue « fractionnement ») ; les autres profils de l'espace RH les voient.
import { useMemo } from 'react';
import { fJ, plural } from '../../../shared/format.ts';
import { periodeCp } from '../../../shared/rules/conges.ts';
import { fenetrePrincipale, fenetreTexte, fractionnementsAFaire, jourMois, principauxAPrevoir } from '../../../shared/rules/fractionnement.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Two } from './ui.tsx';

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
        <Panel highlight title="Jours de fractionnement à décider" aside="Proposés par Cursus, crédités par le service RH · jamais d’office">
          <div className="list">
            {aFaire.map(g => (
              <div key={g.periode} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>Congés payés {periodeCp(g.periode)} · congé principal {fenetreTexte(g.fenetre)}</div>
                  <div className="text-muted sub">
                    {plural(g.lignes.length, 'salarié', 'salariés')} · {fJ(g.lignes.reduce((n, l) => n + l.propose, 0))} proposés (art. L3141-23), crédit ou renonciation du salarié
                  </div>
                </div>
                {rh
                  ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'fractionnement', periode: g.periode })}>Décider</button>
                  : <span className="text-muted sub">Décision par le service RH</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {aPrevoir.length > 0 && (
        <Panel title="Congé principal à prévoir" aside={`12 jours ouvrables continus (10 ouvrés) à prendre avant le ${jourMois(f.au)} · art. L3141-18`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Plus long congé dans la période</th><th>Solde de la période</th></tr></thead>
              <tbody>
                {aPrevoir.map(x => (
                  <tr key={x.e.id}>
                    <td>{x.e.nom}</td>
                    <td><Two main={`${fJ(x.etat.plusLong)} ouvrés`} sub={`${fJ(x.etat.besoin)} continus attendus`} /></td>
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
