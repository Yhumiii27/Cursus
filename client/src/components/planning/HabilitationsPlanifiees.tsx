// Habilitations des postes déjà planifiés (CU-142, lot 18) : postes à venir (12 semaines de l'instantané) dont une
// habilitation ou une formation exigée par le poste, l'équipe ou le besoin de poste ne sera pas valide ce jour-là — absente,
// en attente, retirée, suspendue, ou expirée avant le poste (calcul : shared/rules/planning-habilitations.ts, mêmes
// contrôles qu'à la publication, refaits à chaque affichage, jamais stockés). Pour le planificateur seul : service RH (tous
// les salariés, sauf lui-même), manager et suppléant « planning » (ceux qu'il planifie). Sur l'onglet Planning d'équipe
// (`equipe` : l'équipe affichée) et sur le tableau de bord RH (toutes les équipes). Module désactivé : rien.
import { useMemo } from 'react';
import { t, tn } from '../../i18n/langue.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { decideur } from '../../state/delegues.ts';
import { Fine, Panel, Tag, Two } from '../ui.tsx';
import { habilitationsAVenir, jourCourt } from './planning-vue.ts';

export function HabilitationsPlanifieesPanel({ equipe }: { equipe?: string }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const manques = useMemo(() => {
    if (!rh && !manager) return [];
    const retenir = (id: number) => {
      const x = d.emp(id);
      return !!x && ((rh && id !== soi) || (manager && !!me && decideur(d, x, me, 'planning')));
    };
    return habilitationsAVenir(d, retenir, equipe);
  }, [d, rh, manager, me, soi, equipe]);
  if (!manques.length) return null;
  // Un poste peut manquer de plusieurs titres : les nombres comptent les postes (salarié et jour), pas les lignes.
  const postes = (l: typeof manques) => new Set(l.map(m => `${m.empId}|${m.jour}`)).size;
  const n = postes(manques), publies = postes(manques.filter(m => m.statut === 'publie'));
  return (
    <Panel highlight style={{ flex: '1 1 100%' }} title={t('Authorisations to review on the planned shifts')}
      aside={`${tn(n, 'shift', 'shifts')}${publies ? `${t(' · of which ')}${publies}${publies > 1 ? t(' already published#plural') : t(' already published')}` : ''}`}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Shift')}</th><th>{t('Employee#salarie')}</th><th>{t('Authorisation or training required')}</th><th>{t('State')}</th></tr></thead>
          <tbody>
            {manques.map(m => (
              <tr key={`${m.empId}|${m.jour}|${m.code}|${m.texte}`}>
                <td><Two main={`${jourCourt(m.jour)} · ${m.horaire}`} sub={equipe ? undefined : `${t('Team ')}${m.equipe}`} nowrap /></td>
                <td>{d.personName(m.empId)}</td>
                <td className="sub">{m.texte}</td>
                <td><Tag cls={m.statut === 'publie' ? 'tag-accent' : 'tag-neutral'}>{m.statut === 'publie' ? t('Published#masc') : t('To publish')}</Tag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Fine>
        {t('Upcoming shifts of the next 12 weeks for which an authorisation or a training required (Reference data → Jobs, team, Shift needs) will not be valid on the date of the shift: missing, awaiting issue, withdrawn, suspended, or expired before the shift. A draft will be refused or will ask for a reason at publication; a shift already published is corrected (other employee, swap) or waits for the renewal. Days of absence not counted.')}
      </Fine>
    </Panel>
  );
}
