// Paramètres → Indicateurs sociaux (lot 11, chantier C3, t197 ; shared/rules/indicateurs-legaux.ts) : seuil d'anonymat
// des agrégats (5 par défaut, de 3 à 10) et natures d'absence comptées dans l'absentéisme (santé, enfant malade, sans
// solde, injustifiée par défaut : définition à arrêter avec le CSE). Réglages de l'administrateur RH, enregistrés
// aussitôt ; le gestionnaire RH et la lecture seule les consultent. Un arrêté annuel garde le seuil appliqué à sa date.
import { CATEGORIES_ABSENCE, type CategorieAbsence, NATURES_ABSENCE } from '../../../../shared/constants.ts';
import { NATURES_ABSENTEISME_DEFAUT, NATURES_ABSENTEISME_POSSIBLES, SEUIL_INDICATEURS_MAX, SEUIL_INDICATEURS_MIN } from '../../../../shared/rules/indicateurs-legaux.ts';
import type { NatureAbsence } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const SEUILS: [number, string][] = Array.from({ length: SEUIL_INDICATEURS_MAX - SEUIL_INDICATEURS_MIN + 1 }, (_, i) => {
  const n = SEUIL_INDICATEURS_MIN + i;
  return [n, String(n)];
});

/** Natures par catégorie d'absence (santé, parentalité, famille, non payée), dans l'ordre de NATURES_ABSENCE. */
const PAR_CATEGORIE = (Object.keys(CATEGORIES_ABSENCE) as CategorieAbsence[])
  .map(c => [c, NATURES_ABSENTEISME_POSSIBLES.filter(n => NATURES_ABSENCE[n].categorie === c)] as const)
  .filter(([, ns]) => ns.length > 0);

export function Indicateurs({ s }: SectionProps) {
  const { admin, espaceRh, consultation } = useRole();
  const { go } = useStore();
  const enregistrer = useEnregistrerReglages();
  // Service RH et lecture seule (droit « consultation ») : ceux qui ouvrent l'écran Indicateurs sociaux.
  if (!espaceRh || !consultation) return null;
  const cocher = (n: NatureAbsence, oui: boolean) => enregistrer({ absenteismeNatures: NATURES_ABSENTEISME_POSSIBLES.filter(x => (x === n ? oui : s.absenteismeNatures.includes(x))) });
  const parDefaut = NATURES_ABSENTEISME_DEFAUT.length === s.absenteismeNatures.length && NATURES_ABSENTEISME_DEFAUT.every(n => s.absenteismeNatures.includes(n));
  return (
    <Panel title={t('Social indicators')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Anonymity threshold')}>
        <Seg name="param-ind-seuil" label={t('Anonymity threshold of the indicators')} value={s.indicateursSeuil} disabled={!admin} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={SEUILS} onChange={v => enregistrer({ indicateursSeuil: v })} />
        <span className="text-muted sub">{t('A cell that covers fewer than ')}{s.indicateursSeuil}{t(' people is shown “< ')}{s.indicateursSeuil}{t('”, and another one is too when a total would let it be found')}</span>
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>{t('Absences counted in absenteeism')}{parDefaut ? t(' (default choice)') : ''}</legend>
        {PAR_CATEGORIE.map(([c, natures]) => (
          <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span className="text-muted sub">{CATEGORIES_ABSENCE[c]}</span>
            {natures.map(n => (
              <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={s.absenteismeNatures.includes(n)} disabled={!admin || (s.absenteismeNatures.length === 1 && s.absenteismeNatures.includes(n))}
                  onChange={e => cocher(n, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
                <span>{NATURES_ABSENCE[n].label}</span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <Fine>
        {t('The absence days are counted in the theoretical working days of each employee’s regime (a sick leave in calendar days does not count its weekends), over the calendar year. By default: health, sick child, unpaid and unjustified absence, apart from leave and parenthood — definition to be decided with the CSE. An annual statement keeps the threshold and the version of the rules of its date.')}{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('indicateurs')}>{t('Open the indicators')}</button>
      </Fine>
    </Panel>
  );
}
