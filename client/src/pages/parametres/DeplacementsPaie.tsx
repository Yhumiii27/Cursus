// Paramètres → Déplacements et paie (t031, shared/rules/deplacements-paie.ts) : jours et nuits de grand déplacement, jours
// à l'étranger et trajets dans le fichier d'import de la paie. Désactivé par défaut (réponse de l'entreprise du 18 octobre
// 2026) : la paie l'active après avoir confirmé ses codes Sage ; d'ici là, les quantités sont calculées et listées « à
// saisir dans Sage » dans le résumé de chaque lot et l'export des variables. Date de mise en service : premier jour de
// déplacement transmis. Rappel de vérification de la vigilance des pays avant un départ (t068). Réglages de
// l'administrateur RH, enregistrés aussitôt (la date en quittant le champ) ; les autres profils les consultent.
import { useEffect, useState } from 'react';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const RAPPELS = (): [number, string][] => [15, 30, 60, 90].map(n => [n, `${n}${t(' d#days')}`]);

export function DeplacementsPaie({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  const [depart, setDepart] = useState(s.deplacementsPaieAPartirDu ?? '');
  useEffect(() => setDepart(s.deplacementsPaieAPartirDu ?? ''), [s.deplacementsPaieAPartirDu]);
  if (!espaceRh) return null;
  const enregistrerDepart = () => {
    if (depart !== (s.deplacementsPaieAPartirDu ?? '')) enregistrer({ deplacementsPaieAPartirDu: depart || null });
  };
  return (
    <Panel title={t('Trips and payroll')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.deplacementsFichierPaie} disabled={!admin} onChange={e => enregistrer({ deplacementsFichierPaie: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Transmit the trips in the payroll import file')}</span>
      </label>
      <Fine>
        {t('Each payroll batch calculates, month by month: days and nights of long-distance travel in France (worksite assignments qualified by HR, Assignments screen), days of assignment abroad by country (trips), and a flat rate per outbound or return journey; absence days excluded, cancelled trips removed (adjustment in the next batch). Quantities only: the scale stays in Sage. Unticked (by default, as long as payroll has not confirmed its codes), as for a deactivated item, the quantities go without a Sage code: listed “to be entered in Sage” in the batch summary and the export of variables, they do not go again once the batch is confirmed.')}
      </Fine>
      <Field label={t('Trips transmitted from')} htmlFor="param-deplacements-depuis">
        <input className="input" id="param-deplacements-depuis" type="date" value={depart} disabled={!admin} style={{ maxWidth: 200 }}
          onChange={ev => setDepart(ev.target.value)} onBlur={enregistrerDepart} />
      </Field>
      <Fine>
        {t('Go-live date (recommended: 1 January 2027, like the absences): no trip day before it goes, Lucca and Sage processed them. Without a date, the first payroll batch sets its own at the first day of the open period.')}
      </Fine>
      <Field label={t('Country vigilance: reminder before a departure')}>
        <Seg name="param-vigilance-rappel" label={t('Country vigilance: reminder before a departure')} value={s.vigilanceRappelJours} options={RAPPELS()} disabled={!admin}
          onChange={v => enregistrer({ vigilanceRappelJours: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        {t('The travel file reminds to check the country’s vigilance on France Diplomatie as long as the check is missing or is older than this number of days (Reference data screen, destinations). France Diplomatie has no API: the update stays manual.')}
      </Fine>
    </Panel>
  );
}
