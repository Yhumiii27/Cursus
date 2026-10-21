// Écran Missions, service RH (t031) : qualification « grand déplacement » des chantiers en France, qui fait partir à la
// paie les jours et nuits de grand déplacement et les trajets de leurs missions (shared/rules/deplacements-paie.ts).
// Proposée pour tout chantier en France (Keystone ne transmet que des chantiers chez les clients, hors du site), elle
// n'est retenue qu'une fois choisie par le service RH (`chantier.grandDeplacement`). Les chantiers à l'étranger n'en ont
// pas besoin : leurs jours partent avec le déplacement (pays de la destination).
import { plural } from '../../../shared/format.ts';
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
    <Panel title="Grand déplacement des chantiers en France" aside={aQualifier ? plural(aQualifier, 'chantier à qualifier', 'chantiers à qualifier') : 'chantiers qualifiés'}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Chantier</th><th>Lieu</th><th className="right">Missions</th><th>Qualification</th><th></th></tr></thead>
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
                      ? <Two main={<Tag cls="tag-accent">À qualifier</Tag>} sub="proposé : grand déplacement" />
                      : <Tag cls={c.grandDeplacement ? 'tag-neutral' : 'tag-outline'}>{c.grandDeplacement ? 'Grand déplacement' : 'Pas de grand déplacement'}</Tag>}
                  </td>
                  <td className="right">
                    <div className="actions-end">
                      {c.grandDeplacement !== true && <Btn small variant={c.grandDeplacement == null ? 'secondary' : undefined} disabled={occupe} onClick={agir(() => qualifier(c.id, true))}>Grand déplacement</Btn>}
                      {c.grandDeplacement !== false && <Btn small disabled={occupe} onClick={agir(() => qualifier(c.id, false))}>Pas de grand déplacement</Btn>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fine>
        Un chantier en grand déplacement donne à la paie, pour chaque mission, les jours calendaires sur place, les nuits (jours − 1) et deux
        trajets (aller et retour), jours d’absence exclus. Le critère de l’URSSAF (distance et temps de trajet) se vérifie hors de Cursus :
        la proposition ne vaut qu’une fois retenue. Un changement après la transmission se régularise au prochain lot de paie.
      </Fine>
    </Panel>
  );
}
