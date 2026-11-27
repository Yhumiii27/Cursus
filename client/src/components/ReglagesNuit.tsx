// Paramètres → Décompte des heures (pages/parametres/DecompteHeures.tsx), bloc « Travail de nuit » (t048, étape 2 ; shared/rules/repos-nuit.ts) : plage de nuit,
// seuils du travailleur de nuit, majoration des heures de nuit et référence de l'accord. Valeurs légales supplétives par
// défaut (nuit de 21 h à 6 h, 3 h deux fois par semaine ou 270 h sur 12 mois, majoration à 0 %) tant que l'accord ou la CCN
// n'est pas connu ; s'en écarter exige la référence de l'accord (COHERENCE de shared/reglages.ts). Les six champs
// s'enregistrent ensemble ; la majoration, figée sur chaque feuille à sa validation, ne change rien aux semaines validées.
// Réglages de l'administrateur RH ; les autres profils consultent.
import { type FormEvent, useEffect, useState } from 'react';
import {
  NUIT_DEBUT_LEGAL, NUIT_FIN_LEGAL, NUIT_SEUIL_ANNUEL_LEGAL, NUIT_SEUIL_QUOTIDIEN_LEGAL, PAUSE_DES, PAUSE_MIN, REPOS_QUOTIDIEN, refusPlageNuit,
} from '../../../shared/rules/repos-nuit.ts';
import type { Settings } from '../../../shared/types.ts';
import { Field } from './Dialog.tsx';
import { Btn, Fine } from './ui.tsx';
import { useRole } from '../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from '../pages/parametres/commun.ts';
import { t } from '../i18n/langue.ts';

const MAJORATIONS = Array.from({ length: 21 }, (_, i) => i * 5);
const DEBUTS = [21, 22], FINS = [6, 7];
const SEUILS_QUOTIDIENS = Array.from({ length: 9 }, (_, i) => i + 1);

export function ReglagesNuit({ s }: Pick<SectionProps, 's'>) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const [debut, setDebut] = useState(s.nuitDebut);
  const [fin, setFin] = useState(s.nuitFin);
  const [quotidien, setQuotidien] = useState(s.nuitSeuilQuotidien);
  const [annuel, setAnnuel] = useState(String(s.nuitSeuilAnnuel));
  const [majoration, setMajoration] = useState(s.nuitMajoration);
  const [accord, setAccord] = useState(s.nuitAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDebut(s.nuitDebut); setFin(s.nuitFin); setQuotidien(s.nuitSeuilQuotidien); setAnnuel(String(s.nuitSeuilAnnuel));
    setMajoration(s.nuitMajoration); setAccord(s.nuitAccord); setTente(false);
  }, [s.nuitDebut, s.nuitFin, s.nuitSeuilQuotidien, s.nuitSeuilAnnuel, s.nuitMajoration, s.nuitAccord]);

  const n = Number(annuel.trim());
  const erreurAnnuel = !/^\d{2,4}$/.test(annuel.trim()) || n < 50 || n > 1000 || n % 10 ? t('Enter a number of hours from 50 to 1,000, in tens.') : null;
  const erreurPlage = refusPlageNuit({ nuitDebut: debut, nuitFin: fin });
  const horsLoi = debut !== NUIT_DEBUT_LEGAL || fin !== NUIT_FIN_LEGAL || quotidien !== NUIT_SEUIL_QUOTIDIEN_LEGAL || (!erreurAnnuel && n !== NUIT_SEUIL_ANNUEL_LEGAL);
  const erreurAccord = horsLoi && !accord.trim() ? t('Enter the reference of the collective agreement that sets these values.') : null;
  const modifie = debut !== s.nuitDebut || fin !== s.nuitFin || quotidien !== s.nuitSeuilQuotidien || annuel.trim() !== String(s.nuitSeuilAnnuel)
    || majoration !== s.nuitMajoration || accord.trim() !== s.nuitAccord;

  const enregistrer = async (ev: FormEvent) => {
    ev.preventDefault();
    const champ = erreurPlage ? 'tn-debut' : erreurAnnuel ? 'tn-annuel' : erreurAccord ? 'tn-accord' : null;
    if (champ) { setTente(true); document.getElementById(champ)?.focus(); return; }
    setBusy(true);
    await save({ nuitDebut: debut, nuitFin: fin, nuitSeuilQuotidien: quotidien, nuitSeuilAnnuel: n, nuitMajoration: majoration, nuitAccord: accord } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} noValidate>
      <div className="text-muted sub" style={{ fontWeight: 600 }}>{t('Night work, daily rest and break')}</div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Night from')} htmlFor="tn-debut" erreur={tente && erreurPlage}>
          <select className="input" id="tn-debut" value={debut} disabled={!admin} onChange={e => setDebut(Number(e.target.value))}>
            {DEBUTS.map(v => <option key={v} value={v}>{v}{t(' h#hours')}</option>)}
          </select>
        </Field>
        <Field label={t('to#time')} htmlFor="tn-fin">
          <select className="input" id="tn-fin" value={fin} disabled={!admin} onChange={e => setFin(Number(e.target.value))}>
            {FINS.map(v => <option key={v} value={v}>{v}{t(' h#hours')}</option>)}
          </select>
        </Field>
        <Field label={t('Increase of night hours')} htmlFor="tn-majoration">
          <select className="input" id="tn-majoration" value={majoration} disabled={!admin} onChange={e => setMajoration(Number(e.target.value))}>
            {MAJORATIONS.map(v => <option key={v} value={v}>{v ? `${v} %` : t('None (0 %)#fem')}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Night worker: night hours in the day')} htmlFor="tn-quotidien">
          <select className="input" id="tn-quotidien" value={quotidien} disabled={!admin} onChange={e => setQuotidien(Number(e.target.value))}>
            {SEUILS_QUOTIDIENS.map(v => <option key={v} value={v}>{v}{t(' h, twice a week')}</option>)}
          </select>
        </Field>
        <Field label={t('or night hours over 12 months')} htmlFor="tn-annuel" requis erreur={tente && erreurAnnuel}>
          <input className="input tnum" id="tn-annuel" inputMode="numeric" value={annuel} disabled={!admin} onChange={e => setAnnuel(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label={t('Reference of the agreement on night work')} htmlFor="tn-accord" requis={horsLoi} erreur={tente && erreurAccord}>
        <input className="input" id="tn-accord" maxLength={120} placeholder={t('CCN Chemical industries, company agreement of …')} value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" type="submit" disabled={busy}>{t('Save the night work')}</Btn></div>}
      {!s.nuitAccord && <div className="note-accent">{t('Default values of the law: night range, compensations and increase of the agreement or the CCN to be confirmed.')}</div>}
      <Fine>
        {t('With a shift schedule on the timesheet: night hours counted in the set range (the law: ')}{NUIT_DEBUT_LEGAL}{t(' h – ')}{NUIT_FIN_LEGAL}{t(' h, art. L3122-20; an agreement may retain 9 consecutive hours between 21:00 and 7:00, art. L3122-2), transmitted as quantity (HNUIT) and increased at the set rate (MAJ_NUIT), frozen on each timesheet at its approval; items deactivated as long as payroll has not confirmed them: to be entered in Sage. Night worker (art. L3122-5 and L3122-23): ')}{NUIT_SEUIL_QUOTIDIEN_LEGAL}{t(' night hours at least twice a week, according to the usual schedule, or')}
        {' '}{NUIT_SEUIL_ANNUEL_LEGAL}{t(' h over 12 rolling months; spotted on the sheet, adapted medical monitoring flagged. Daily rest of ')}{REPOS_QUOTIDIEN}{t(' h (art. L3131-1) and break of ')}{PAUSE_MIN}{t(' min from ')}{PAUSE_DES}{t(' h (art. L3121-16): alerts with reason, without blocking. No night for an employee under 18 (art. L3163-2): refused.')}
      </Fine>
    </form>
  );
}
