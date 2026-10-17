// Écran Temps, espace RH : durées du travail sur plusieurs semaines (shared/rules/durees.ts), calculées sur les feuilles
// validées : moyenne sur 12 semaines au-delà du maximum, temps partiel à requalifier (12 semaines sur 15 à 2 h au moins
// au-delà du contrat), contingent annuel d'heures supplémentaires au seuil d'alerte ou dépassé. Alertes seulement, rien
// n'est bloqué. Un clic ouvre la feuille de la semaine en cours du salarié. Masqué quand rien n'est à signaler.
import { mondayOf } from '../../../shared/dates.ts';
import { equipeLabel, plural } from '../../../shared/format.ts';
import { alertesDurees, type TypeAlerteDuree } from '../../../shared/rules/durees.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Ouvrir } from './Cliquable.tsx';
import { Fine, Panel, stop, Tag, Two } from './ui.tsx';

const TYPE: Record<TypeAlerteDuree, string> = { moyenne: 'Moyenne 12 semaines', requalification: 'Temps partiel', contingent: 'Contingent' };

export function AlertesDurees() {
  const d = useDomain();
  const { setUi } = useStore();
  const lignes = alertesDurees(d);
  if (!lignes.length) return null;
  const salaries = new Set(lignes.map(l => l.e.id)).size;
  return (
    <Panel title="Durées du travail à surveiller" aside={plural(salaries, 'salarié', 'salariés')}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>Collaborateur</th><th>Alerte</th><th>Détail</th><th></th></tr></thead>
          <tbody>
            {lignes.map(({ e, type, texte }) => {
              const open = () => setUi({ tsEmp: e.id, weekStart: mondayOf(d.ti) });
              return (
                <tr key={`${e.id}-${type}`} className="clickable" onClick={open}>
                  <td><Two main={<Ouvrir onOpen={open}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                  <td className="nowrap"><Tag cls="tag-accent">{TYPE[type]}</Tag></td>
                  <td>{texte}</td>
                  <td className="right"><button type="button" className="btn btn-ghost btn-sm" onClick={stop(open)}>Ouvrir</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fine>
        Calculées sur les feuilles validées ; une semaine sans feuille validée ou d’absence complète est sautée. Moyenne de 44 h au plus sur
        12 semaines (art. L3121-22 ; 46 h avec un accord, art. L3121-23), requalification d’un temps partiel (art. L3123-13), contingent annuel
        d’heures supplémentaires et contrepartie obligatoire en repos au-delà (Paramètres → Décompte des heures). Signalées sans blocage.
      </Fine>
    </Panel>
  );
}
