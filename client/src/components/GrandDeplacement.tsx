// Écran Missions, service RH (t031) : qualification « grand déplacement » des chantiers en France, qui fait partir à la
// paie les jours et nuits de grand déplacement et les trajets de leurs missions (shared/rules/deplacements-paie.ts).
// Proposée pour tout chantier en France (Keystone ne transmet que des chantiers chez les clients, hors du site), elle
// n'est retenue qu'une fois choisie par le service RH (`chantier.grandDeplacement`). Les chantiers à l'étranger n'en ont
// pas besoin : leurs jours partent avec le déplacement (pays de la destination).
import { t, tn } from '../i18n/langue.ts';
import { grandDeplacementPropose } from '../../../shared/rules/deplacements-paie.ts';
import { useAgir } from '../state/actions.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, Panel, Tag, Two } from './ui.tsx';

export function GrandDeplacementChantiers() {
  const d = useDomain();
  const { run } = useStore();
  const { rh } = useRole();
  const { occupe, agir } = useAgir();
  // Chantiers en France en cours, à venir ou qui ont des missions (archivés compris s'ils en ont).
  const chantiers = d.ds.referentiels.chantiers.filter(c => grandDeplacementPropose(c) && (c.statut !== 'archive' || d.ds.missions.some(m => m.projet === c.id)));
  if (!rh || !chantiers.length) return null;
  const aQualifier = chantiers.filter(c => c.grandDeplacement == null).length;
  const qualifier = (id: string, grandDeplacement: boolean) => run('chantier.grandDeplacement', { id, grandDeplacement });
  return (
    <Panel title={t('Long-distance travel of the worksites in France')} aside={aQualifier ? tn(aQualifier, 'worksite to qualify', 'worksites to qualify') : t('worksites qualified')}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Worksite')}</th><th>{t('Place')}</th><th className="right">{t('Assignments')}</th><th>{t('Qualification')}</th><th></th></tr></thead>
          <tbody>
            {chantiers.map(c => {
              const missions = d.ds.missions.filter(m => m.projet === c.id).length;
              return (
                <tr key={c.id}>
                  <td><Two main={`${c.id} · ${c.nom}`} sub={c.client} /></td>
                  <td>{c.lieu}</td>
                  <td className="right tnum">{missions}</td>
                  <td>
                    {c.grandDeplacement == null
                      ? <Two main={<Tag cls="tag-accent">{t('To qualify')}</Tag>} sub={t('proposed: long-distance travel')} />
                      : <Tag cls={c.grandDeplacement ? 'tag-neutral' : 'tag-outline'}>{c.grandDeplacement ? t('Long-distance travel') : t('No long-distance travel')}</Tag>}
                  </td>
                  <td className="right">
                    <div className="actions-end">
                      {c.grandDeplacement !== true && <Btn small variant={c.grandDeplacement == null ? 'secondary' : undefined} disabled={occupe} onClick={agir(() => qualifier(c.id, true))}>{t('Long-distance travel')}</Btn>}
                      {c.grandDeplacement !== false && <Btn small disabled={occupe} onClick={agir(() => qualifier(c.id, false))}>{t('No long-distance travel')}</Btn>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fine>
        {t('A worksite in long-distance travel gives payroll, for each assignment, the calendar days on site, the nights (days − 1) and two journeys (outward and return), days of absence excluded. The URSSAF criterion (distance and travel time) is checked outside Cursus: the proposal only counts once retained. A change after the transfer is adjusted in the next payroll batch.')}
      </Fine>
    </Panel>
  );
}
