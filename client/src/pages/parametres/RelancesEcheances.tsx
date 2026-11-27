// Paramètres → Messagerie, récapitulatif des échéances (shared/rules/relances.ts, server/src/relances.ts) : envoi actif,
// paliers de relance (jours avant l'échéance ; l'échéance dépassée est toujours relancée) et jour d'envoi. Réglages de
// l'administrateur RH, enregistrés aussitôt ; les autres profils les consultent. Par défaut : actif, à 90, 30 et 7 jours
// puis échu, chaque jour à 7 h.
import { HEURE_RECAPITULATIF } from '../../../../shared/constants.ts';
import { JOURS_RELANCE, PALIERS_POSSIBLES, type JourRelance } from '../../../../shared/rules/relances.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Jour d'envoi : sources anglaises, traduites au rendu. */
const JOUR_LABEL: Record<JourRelance, string> = {
  quotidien: 'Every day', lundi: 'On Mondays', mardi: 'On Tuesdays', mercredi: 'On Wednesdays', jeudi: 'On Thursdays', vendredi: 'On Fridays',
};

export function RelancesEcheances({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Le dernier palier coché ne se décoche pas : le serveur garderait les paliers en vigueur.
  const cocher = (p: number, oui: boolean) => enregistrer({ relancesPaliers: PALIERS_POSSIBLES.filter(x => (x === p ? oui : s.relancesPaliers.includes(x))) });

  return (
    <Panel title={t('Messaging · summary of due dates')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={s.relancesActives} disabled={!admin} onChange={e => enregistrer({ relancesActives: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)' }} />
        {t('Send the summary of due dates by e-mail')}
      </label>
      <Fine>
        {t('HR (the whole scope), each manager (their team, without medical visit nor vaccination) and the HSE referent (training and authorisations) receive the titles, visits, travel formalities, reviews and ends of contract that reach a step: only once per step, from ')}{HEURE_RECAPITULATIF}{t(' h. The timesheets not submitted have their own reminder.')}
      </Fine>
      <Field label={t('Reminder steps')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
          {PALIERS_POSSIBLES.map(p => {
            const coche = s.relancesPaliers.includes(p);
            return (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
                <input type="checkbox" checked={coche} disabled={!admin || !s.relancesActives || (coche && s.relancesPaliers.length === 1)}
                  onChange={e => cocher(p, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                {p}{t(' days before')}
              </label>
            );
          })}
          <span className="text-muted sub">{t('then the due date passed (always)')}</span>
        </div>
      </Field>
      <Field label={t('Sending#e-mail')} htmlFor="relances-jour">
        <select className="input" id="relances-jour" value={s.relancesJour} disabled={!admin || !s.relancesActives}
          onChange={e => enregistrer({ relancesJour: e.target.value as JourRelance })}>
          {JOURS_RELANCE.map(j => <option key={j} value={j}>{t(JOUR_LABEL[j])}</option>)}
        </select>
      </Field>
    </Panel>
  );
}
