// Couverture minimale par poste planifié (lot 12, chantier C5, étape 3), sur le tableau de bord de l'espace RH : service
// RH, référent HSE et lecture seule (ceux qui reçoivent la couverture du jour, server/src/dataset.ts), le module activé
// (réglage `planningActif`). Jamais la paie : son instantané n'a ni seuils de couverture ni certifications, le panneau
// dirait à tort les secouristes au minimum. Postes publiés des deux semaines à
// venir, équipe par équipe et horaire par horaire : effectif face au besoin de poste, secouristes et équipiers
// d'intervention de l'équipe à chaque horaire tenu (calcul : components/planning/planning-vue.ts, `couvertureAVenir`).
// Le service RH voit la couverture absences retirées ; le référent HSE et la lecture seule, sans absences (le référent HSE ne doit pas
// pouvoir désigner un absent), avec un renvoi au service RH. Rien quand aucun planning n'est publié sur la période.
import { useMemo } from 'react';
import { t, tn } from '../../i18n/langue.ts';
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
    <Panel highlight={c.manques.length > 0} style={{ flex: '1 1 100%' }} title={t('Minimum coverage per planned shift')}
      aside={c.manques.length ? tn(c.manques.length, 'shift below the minimum', 'shifts below the minimum') : `${tn(c.creneaux, 'shift followed', 'shifts followed')}${t(' · minimum met')}`}>
      {c.manques.length === 0 ? <Empty pad="sm">{t('Staff and first aiders at the minimum on all the published shifts of the next ')}{JOURS_COUVERTURE}{t(' days.#prochains')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Shift')}</th><th>{t('Coverage')}</th><th>{t('Shortfall')}</th></tr></thead>
            <tbody>
              {c.manques.map(x => (
                <tr key={`${x.equipe}|${x.jour}|${x.horaire}`}>
                  <td><Two main={`${jourCourt(x.jour)} · ${x.horaire}`} sub={`${t('Team ')}${x.equipe}`} nowrap /></td>
                  <td className="sub">{x.texte}</td>
                  <td>{x.manques.map(m => <Tag key={m} cls="tag-accent" style={{ marginRight: 4 }}>{m === 'effectif' ? t('Staff') : m}</Tag>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        {t('Published shifts of the next ')}{JOURS_COUVERTURE}{t(' days, schedule by schedule: staff against the shift need (Reference data → Shift needs) and holders of a valid certification on the date of the shift for each coverage threshold of the team (Reference data → Jobs). ')}{rh
          ? t('Employees absent that day do not count.')
          : t('Coverage calculated without the absences: a shift may be uncovered by an absence, to check with HR.')}
      </Fine>
    </Panel>
  );
}
