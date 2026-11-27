// Fiche d'un salarié de moins de 18 ans (Collaborateurs, section Contrat) : fin des règles des jeunes travailleurs (18 ans),
// durées et repos contrôlés sur la feuille de temps, rappel de l'interdiction du travail de nuit tant que la case de son
// équipe n'est pas renseignée, dérogation pour travaux réglementés (service RH, référent HSE, lecture seule ; le manager
// n'a que l'indication « mineur », server/src/dataset.ts). Règles : shared/rules/mineurs.ts.
import { days, parse } from '../../../shared/dates.ts';
import { fmtIso, rel } from '../../../shared/format.ts';
import { equipeDeNuit, etatMineur, MINEUR_JOUR_MAX, MINEUR_SEMAINE_MAX } from '../../../shared/rules/mineurs.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { NoteAccent, Tag } from './ui.tsx';
import { t } from '../i18n/langue.ts';

export function MineurFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, formations, consultation } = useRole();
  const m = etatMineur(e, d.ti);
  if (!m) return null;
  const s = d.ds.settings;
  const q = d.ds.referentiels.equipes.find(x => x.nom === e.equipe);
  const g = m.derogation, n = g ? days(d.today, parse(g.fin)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div className="text-muted sub">{t('Employee under 18')}</div>
        <div style={{ fontSize: 14 }}>
          {m.majeurLe ? `${t('Rules for minors until ')}${fmtIso(m.majeurLe)}${t(m.aLAnnee ? ' (year of birth only: enter the full date)' : ' (18 years old)')}` : t('Rules for minors until they turn 18')}
        </div>
        <div className="text-muted sub">
          {MINEUR_JOUR_MAX}{t(' h a day and ')}{MINEUR_SEMAINE_MAX}{t(' h a week at most (art. L3162-1), two consecutive rest days including Sunday (art. L3164-2): checked on the timesheet, an excess is approved with a reason or the reference of a labour inspectorate derogation.')}
        </div>
      </div>
      {/* Case de l'équipe pas encore renseignée (ou salarié sans équipe) : rappel permanent ; l'horaire du jour, quand la
          feuille en porte un, est contrôlé à part (shared/rules/repos-nuit.ts). */}
      {(!q || q.nuit == null) && (
        <NoteAccent>
          {t('No night work (art. L3163-2): neither between 10 pm and 6 am, nor between 8 pm and 6 am before 16.')}
          {q ? `${t(' “Night or continuous work” box of the team ')}${q.nom}${t(' to fill in (Reference data → Jobs).')}` : ''}
        </NoteAccent>
      )}
      {q && equipeDeNuit(q) && <NoteAccent>{t('Team ')}{q.nom}{t(' ticked “night or continuous work”: assignment to review (art. L3163-2).')}</NoteAccent>}
      {(rh || formations || consultation) && (
        <div>
          <div className="text-muted sub">{t('Derogation for regulated work')}</div>
          <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {g ? <>{t('declared on ')}{fmtIso(g.le)}{t(' · until ')}{fmtIso(g.fin)}
              {g.expiree ? <Tag cls="tag-accent">{t('Expired#fem-cap')}</Tag> : n != null && n <= s.horizonAlerte ? <Tag cls="tag-outline">{t('To renew ')}{rel(n)}</Tag> : null}</>
              : t('None: no regulated work (art. D4153-15 et seq.)')}
          </div>
          <div className="text-muted sub">{t('Declaration to the labour inspectorate, renewed every 3 years (art. R4153-40 and R4153-41); entered on the sheet.')}</div>
        </div>
      )}
    </div>
  );
}
