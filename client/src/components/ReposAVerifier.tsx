// Écran Temps, espace RH : feuilles soumises ou validées des dernières semaines qui portent une alerte de repos
// hebdomadaire ou dominical (shared/rules/repos-a-verifier.ts). Une feuille validée par son manager, une à une ou en
// groupe, y reste signalée au service RH ; rien n'est bloqué. Un clic ouvre la feuille. Masqué quand rien n'est à vérifier.
import { isoWeek, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmtShort, plural } from '../../../shared/format.ts';
import { TS_CLS, TS_LABEL } from '../../../shared/constants.ts';
import { reposAVerifier, SEMAINES_REPOS } from '../../../shared/rules/repos-a-verifier.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Ouvrir } from './Cliquable.tsx';
import { Fine, Panel, stop, Tag, Two } from './ui.tsx';

export function ReposAVerifier() {
  const d = useDomain();
  const { setUi } = useStore();
  const lignes = reposAVerifier(d);
  if (!lignes.length) return null;
  return (
    <Panel title="Repos hebdomadaire à vérifier" aside={plural(lignes.length, 'feuille', 'feuilles')}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Collaborateur</th><th>Semaine</th><th>Alerte</th><th>État</th><th></th></tr></thead>
          <tbody>
            {lignes.map(({ sh, e, alertes }) => {
              const open = () => setUi({ tsEmp: e.id, weekStart: sh.week });
              return (
                <tr key={sh.id} className="clickable" onClick={open}>
                  <td><Two main={<Ouvrir onOpen={open}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                  <td className="nowrap">S{isoWeek(sh.week)} · {fmtShort(parse(sh.week))}</td>
                  <td>{alertes.map(a => <div key={a}>{a}</div>)}</td>
                  <td><Tag cls={TS_CLS[sh.statut]}>{TS_LABEL[sh.statut]}</Tag></td>
                  <td className="right"><button type="button" className="btn btn-ghost btn-sm" onClick={stop(open)}>Ouvrir</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fine>
        Feuilles soumises ou validées des {SEMAINES_REPOS} dernières semaines : sept jours travaillés (art. L3132-1 et L3132-2), ou heures le dimanche
        sans dérogation réglée pour l’équipe (art. L3132-3 ; Paramètres → Repos hebdomadaire). Signalées sans blocage, elles restent ici après leur validation.
      </Fine>
    </Panel>
  );
}
