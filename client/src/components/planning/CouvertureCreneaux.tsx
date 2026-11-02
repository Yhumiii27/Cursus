// Couverture minimale par poste planifié (lot 12, chantier C5, étape 3), sur le tableau de bord de l'espace RH : service
// RH, référent HSE et lecture seule (ceux qui reçoivent la couverture du jour, server/src/dataset.ts), le module activé
// (réglage `planningActif`). Jamais la paie : son instantané n'a ni seuils de couverture ni certifications, le panneau
// dirait à tort les secouristes au minimum. Postes publiés des deux semaines à
// venir, équipe par équipe et horaire par horaire : effectif face au besoin de poste, secouristes et équipiers
// d'intervention de l'équipe à chaque horaire tenu (calcul : components/planning/planning-vue.ts, `couvertureAVenir`).
// Le service RH voit la couverture absences retirées ; le référent HSE et la lecture seule, sans absences (le référent HSE ne doit pas
// pouvoir désigner un absent), avec un renvoi au service RH. Rien quand aucun planning n'est publié sur la période.
import { useMemo } from 'react';
import { plural } from '../../../../shared/format.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import { couvertureAVenir, jourCourt } from './planning-vue.ts';

/** Jours suivis : deux semaines à partir d'aujourd'hui. */
export const JOURS_COUVERTURE = 14;

export function CouvertureCreneauxPanel() {
  const d = useDomain();
  const { rh, formations, consultation } = useRole();
  const actif = (rh || formations || consultation) && !!d.ds.settings.planningActif;
  const c = useMemo(() => (actif ? couvertureAVenir(d, JOURS_COUVERTURE, rh) : null), [d, actif, rh]);
  if (!c || !c.creneaux) return null;
  return (
    <Panel highlight={c.manques.length > 0} style={{ flex: '1 1 100%' }} title="Couverture minimale par poste planifié"
      aside={c.manques.length ? plural(c.manques.length, 'poste sous le minimum', 'postes sous le minimum') : `${plural(c.creneaux, 'poste suivi', 'postes suivis')} · minimum tenu`}>
      {c.manques.length === 0 ? <Empty pad="sm">Effectif et secouristes au minimum sur tous les postes publiés des {JOURS_COUVERTURE} prochains jours.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Poste</th><th>Couverture</th><th>Manque</th></tr></thead>
            <tbody>
              {c.manques.map(x => (
                <tr key={`${x.equipe}|${x.jour}|${x.horaire}`}>
                  <td><Two main={`${jourCourt(x.jour)} · ${x.horaire}`} sub={`Équipe ${x.equipe}`} nowrap /></td>
                  <td className="sub">{x.texte}</td>
                  <td>{x.manques.map(m => <Tag key={m} cls="tag-accent" style={{ marginRight: 4 }}>{m === 'effectif' ? 'Effectif' : m}</Tag>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        Postes publiés des {JOURS_COUVERTURE} prochains jours, horaire par horaire : effectif face au besoin de poste (Référentiels → Besoins de poste) et titulaires
        d’une certification valide à la date du poste pour chaque seuil de couverture de l’équipe (Référentiels → Postes). {rh
          ? 'Les salariés absents ce jour-là ne comptent pas.'
          : 'Couverture calculée sans les absences : un poste peut être découvert par une absence, à vérifier avec le service RH.'}
      </Fine>
    </Panel>
  );
}
