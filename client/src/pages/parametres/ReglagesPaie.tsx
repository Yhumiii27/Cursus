// Paramètres → Paie : heures supplémentaires payées avec majoration ou remplacées par un repos (seulement avec la
// référence de l'accord collectif qui le prévoit, art. L3121-33, ou, sans délégué syndical,
// de la décision de l'employeur non contestée par le CSE, art. L3121-37), rattachement d'une semaine à cheval sur deux mois et
// jour de clôture des variables (shared/rules/paie.ts), majoration des heures du dimanche. Réglages de l’administrateur RH ;
// les autres profils consultent.
// Le mode des heures supplémentaires est figé sur chaque feuille à sa validation : le changer ne recalcule rien.
import { useEffect, useState } from 'react';
import { MODES_HEURES_SUP, RATTACHEMENTS } from '../../../../shared/rules/paie.ts';
import type { ModeHeuresSup, RattachementPeriode } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Choix : sources anglaises, traduites au rendu. */
const MODES: [ModeHeuresSup, string][] = [['paiement', 'Paid with increase'], ['repos', 'Replaced by a rest']];
const RATTACHEMENT_OPTIONS = Object.entries(RATTACHEMENTS).map(([v, r]) => [v, r.label]) as [RattachementPeriode, string][];
/** Majoration des heures du dimanche (%) : de 0 à 100 par pas de 5 (contrôle entier(0, 100, 5) de shared/reglages.ts). */
const MAJORATIONS_DIMANCHE = Array.from({ length: 21 }, (_, i) => i * 5);
const CLOTURES = (): [number, string][] => [[0, t('Last day of the month')], ...Array.from({ length: 28 }, (_, i): [number, string] => [i + 1, i === 0 ? t('The 1st of the month') : `${t('The #day-of-month')}${i + 1}${t(' of the month')}`])];

export function ReglagesPaie({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  // Repos de remplacement : le mode ne s'enregistre qu'avec la référence de l'accord (contrôle COHERENCE du serveur).
  const [mode, setMode] = useState<ModeHeuresSup>(s.heuresSupMode);
  const [accord, setAccord] = useState(s.heuresSupAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(s.heuresSupMode); setAccord(s.heuresSupAccord); setTente(false); }, [s.heuresSupMode, s.heuresSupAccord]);
  const erreurAccord = mode === 'repos' && !accord.trim() ? t('Enter the reference of the collective agreement that provides for the replacement rest.') : null;
  const modifie = mode !== s.heuresSupMode || (mode === 'repos' && accord.trim() !== s.heuresSupAccord);

  const choisir = (v: ModeHeuresSup) => {
    setMode(v);
    setTente(false);
    // Retour au paiement : enregistré aussitôt, la référence de l'accord est gardée pour mémoire.
    if (v === 'paiement' && s.heuresSupMode !== 'paiement') void save({ heuresSupMode: 'paiement' });
  };
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('paie-accord')?.focus(); return; }
    setBusy(true);
    await save({ heuresSupMode: mode, heuresSupAccord: accord });
    setBusy(false);
  };

  return (
    <Panel title={t('Payroll#section')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Overtime')}>
        <Seg name="paie-hs" label={t('Overtime')} value={mode} options={MODES.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>{MODES_HEURES_SUP[mode].aide}{t(' The hours included in a weekly flat rate (HSF25, HSF50) stay paid. The mode is frozen on each timesheet at its approval: changing it does not recalculate the weeks already approved.')}</Fine>
      {mode === 'repos' && (
        <>
          <Field label={t('Reference of the collective agreement')} htmlFor="paie-accord" requis erreur={tente && erreurAccord}>
            <input className="input" id="paie-accord" maxLength={120} placeholder={t('Company agreement on working time of …')} value={accord} disabled={!admin}
              onChange={e => setAccord(e.target.value)} />
          </Field>
          {admin && modifie && (
            <div className="actions-end">
              <Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the replacement rest')}</Btn>
            </div>
          )}
        </>
      )}

      <Field label={t('Week straddling two months')}>
        <Seg name="paie-rattachement" label={t('Week straddling two months')} value={s.periodeRattachement} options={RATTACHEMENT_OPTIONS} disabled={!admin}
          onChange={v => save({ periodeRattachement: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>{RATTACHEMENTS[s.periodeRattachement].aide}</Fine>
      <Field label={t('Closing of payroll variables')} htmlFor="paie-cloture">
        <select className="input" id="paie-cloture" value={s.clotureJour} disabled={!admin} onChange={e => save({ clotureJour: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {CLOTURES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Fine>{t('Once the closing has passed, the period is closed: a week that belongs to it goes as a back pay on the next period, flagged at the transmission.')}</Fine>
      <Field label={t('Increase of Sunday hours')} htmlFor="paie-dimanche">
        <select className="input" id="paie-dimanche" value={s.majorationDimanche} disabled={!admin} onChange={e => save({ majorationDimanche: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {MAJORATIONS_DIMANCHE.map(v => <option key={v} value={v}>{v ? `${v} %` : t('None (0 %)#fem')}</option>)}
        </select>
      </Field>
      <Fine>{t('No legal Sunday increase apart from an agreement or exemption that provides for it. The Sunday hours always go as quantity (HDIM); an increase adds the item MAJ_DIM, frozen on each timesheet at its approval.')}</Fine>
    </Panel>
  );
}
