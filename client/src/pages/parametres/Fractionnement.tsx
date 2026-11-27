// Paramètres → Fractionnement des congés (t046, shared/rules/fractionnement.ts) : règle des jours de fractionnement
// (légale supplétive par défaut, fixée par un accord d'entreprise, ou aucun jour par accord collectif, avec la référence
// de l'accord exigée hors de la loi) et période du congé principal (du 1er mai au 31 octobre par défaut). Réglages de
// l'administrateur RH, enregistrés ensemble ; les autres profils de l'espace RH les consultent.
import { useEffect, useState } from 'react';
import type { RegleFractionnement } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { JourMois } from './Entretiens.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Règles : sources anglaises, traduites au rendu. */
const REGLES: [RegleFractionnement, string][] = [['legal', 'Legal rule'], ['accord', 'Company agreement'], ['aucun', 'No day (agreement)']];

export function Fractionnement({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  const [regle, setRegle] = useState(s.fractionnementRegle);
  const [accord, setAccord] = useState(s.fractionnementAccord);
  const [debut, setDebut] = useState(s.fractionnementDebut);
  const [fin, setFin] = useState(s.fractionnementFin);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRegle(s.fractionnementRegle); setAccord(s.fractionnementAccord); setDebut(s.fractionnementDebut); setFin(s.fractionnementFin); setTente(false);
  }, [s.fractionnementRegle, s.fractionnementAccord, s.fractionnementDebut, s.fractionnementFin]);
  if (!espaceRh) return null;
  const erreurAccord = regle !== 'legal' && !accord.trim() ? t('Enter the reference of the company collective agreement (art. L3141-21).') : null;
  const ordre = debut >= fin ? t('The start of the period must precede its end, in the same year.') : null;
  const modifie = regle !== s.fractionnementRegle || accord.trim() !== s.fractionnementAccord || debut !== s.fractionnementDebut || fin !== s.fractionnementFin;
  const enregistrer = async () => {
    if (erreurAccord || ordre) { setTente(true); if (erreurAccord) document.getElementById('param-fract-accord')?.focus(); return; }
    setBusy(true);
    await save({ fractionnementRegle: regle, fractionnementAccord: accord, fractionnementDebut: debut, fractionnementFin: fin });
    setBusy(false);
  };
  return (
    <Panel title={t('Splitting of leave')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Splitting days')}>
        <Seg name="param-fract-regle" label={t('Splitting days')} value={regle} options={REGLES.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={setRegle} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Reference of the agreement')} htmlFor="param-fract-accord" requis={regle !== 'legal'} erreur={tente && erreurAccord}>
        <input className="input" id="param-fract-accord" maxLength={120} placeholder={t('Company agreement on leave of …')} value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      <div className="grid-2">
        <JourMois id="fract-debut" label={t('Main leave: start of the period')} value={debut} onChange={setDebut} disabled={!admin} />
        <JourMois id="fract-fin" label={t('End of the period')} value={fin} onChange={setFin} disabled={!admin} />
      </div>
      {tente && ordre && <p className="form-error">{ordre}</p>}
      {admin && modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the splitting')}</Btn>
        </div>
      )}
      <Fine>
        {t('Legal, default rule (art. L3141-23): 2 more working days when the employee takes outside the period at least 6 days of their main leave (4 weeks, 5th excluded), 1 day for 3 to 5; credited in working days. A company agreement may set other rules or other dates, or rule out these days (art. L3141-21): to be checked with the agreements and the CCN of the chemical industries. The main leave, at least 12 continuous working days and 24 at most in a row, is only flagged; the splitting days are offered after the period and credited by HR, never automatically, or ruled out by the employee’s written waiver (art. L3141-19).')}
      </Fine>
    </Panel>
  );
}
