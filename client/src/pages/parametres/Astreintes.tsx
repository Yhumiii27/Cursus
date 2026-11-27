// Paramètres → Astreintes (t049, lot 7, étape 2 ; shared/rules/astreintes.ts) : délai de prévenance de la programmation
// (15 jours à défaut d'accord, art. R3121-3 ; plus court, seulement avec la référence de l'accord collectif, COHERENCE de
// shared/reglages.ts, art. L3121-11), forme de la compensation (financière par défaut, réponse de l'entreprise du
// 23 octobre 2026), astreinte d'un salarié mineur (refusée par défaut). Réglages de l'administrateur RH ; les autres
// profils de l'espace RH consultent. La compensation et la case des mineurs s'enregistrent aussitôt ; le délai et la
// référence de l'accord, ensemble, au bouton « Enregistrer ».
// lot 17 (CU-051) : barème de la compensation de la forme réglée (euros par période et par heure, ou heures de repos par
// période et minutes par heure d'astreinte), 0 par défaut (rien n'est chiffré) ; enregistré avec la référence de l'accord,
// exigée dès qu'une valeur n'est pas nulle (COHERENCE de shared/reglages.ts).
import { useEffect, useState } from 'react';
import { baremeTexte, COMPENSATION_LABEL, DELAI_JOUR_FRANC, DELAI_PREVENANCE_LEGAL, MONTANT_HEURE_MAX, MONTANT_PERIODE_MAX, REPOS_PERIODE_MAX } from '../../../../shared/rules/astreintes.ts';
import type { CompensationAstreinte } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const COMPENSATIONS = Object.entries(COMPENSATION_LABEL) as [CompensationAstreinte, string][];
/** Délai de prévenance au plus (jours), comme le contrôle du réglage (shared/reglages.ts). */
const DELAI_MAX = 60;

export function Astreintes({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Délai et accord : enregistrés ensemble (un délai de moins de 15 jours exige la référence de l'accord).
  const [delai, setDelai] = useState(String(s.astreinteDelaiPrevenance));
  const [accord, setAccord] = useState(s.astreinteAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDelai(String(s.astreinteDelaiPrevenance)); setAccord(s.astreinteAccord); setTente(false); }, [s.astreinteDelaiPrevenance, s.astreinteAccord]);
  // lot 17 — barème de la forme réglée : par période, par heure.
  const repos = s.astreinteCompensation === 'repos';
  const parPeriode = (repos ? s.astreinteReposPeriode : s.astreinteMontantPeriode) ?? 0;
  const parHeure = (repos ? s.astreinteReposHeure : s.astreinteMontantHeure) ?? 0;
  const [periode, setPeriode] = useState(String(parPeriode));
  const [heure, setHeure] = useState(String(parHeure));
  const [tenteBareme, setTenteBareme] = useState(false);
  useEffect(() => { setPeriode(String(parPeriode)); setHeure(String(parHeure)); setTenteBareme(false); }, [parPeriode, parHeure]);
  if (!espaceRh) return null;

  const nombre = (v: string) => Number(v.trim().replace(',', '.'));
  const maxPeriode = repos ? REPOS_PERIODE_MAX : MONTANT_PERIODE_MAX, maxHeure = repos ? 60 : MONTANT_HEURE_MAX;
  const erreurPeriode = !/^\d+([.,]\d{1,2})?$/.test(periode.trim()) || nombre(periode) > maxPeriode ? `${t('Enter a number from 0 to ')}${maxPeriode}${t(', two decimals at most.')}` : null;
  const erreurHeure = (repos ? !/^\d{1,2}$/.test(heure.trim()) : !/^\d+([.,]\d{1,2})?$/.test(heure.trim())) || nombre(heure) > maxHeure
    ? (repos ? `${t('Enter a whole number of minutes, from 0 to ')}${maxHeure}.` : `${t('Enter an amount from 0 to ')}${maxHeure}${t(', two decimals at most.')}`) : null;
  const erreurBaremeAccord = !erreurPeriode && !erreurHeure && (nombre(periode) > 0 || nombre(heure) > 0) && !accord.trim()
    ? t('A scale assumes the collective agreement or the employer’s decision that sets it (art. L3121-11 and L3121-12): enter its reference.') : null;
  const baremeModifie = nombre(periode) !== parPeriode || nombre(heure) !== parHeure;
  const enregistrerBareme = async () => {
    const erreur = [['ast-bareme-periode', erreurPeriode], ['ast-bareme-heure', erreurHeure], ['ast-accord', erreurBaremeAccord]].find(([, e]) => e);
    if (erreur) { setTenteBareme(true); document.getElementById(erreur[0]!)?.focus(); return; }
    setBusy(true);
    await save(repos
      ? { astreinteReposPeriode: nombre(periode), astreinteReposHeure: nombre(heure), astreinteAccord: accord }
      : { astreinteMontantPeriode: nombre(periode), astreinteMontantHeure: nombre(heure), astreinteAccord: accord });
    setBusy(false);
  };
  const bareme = baremeTexte(s);

  const n = Number(delai);
  const erreurDelai = !/^\d{1,2}$/.test(delai.trim()) || n < DELAI_JOUR_FRANC || n > DELAI_MAX ? `${t('Enter a whole number of days, from ')}${DELAI_JOUR_FRANC}${t(' to #nombre')}${DELAI_MAX}.` : null;
  const erreurAccord = !erreurDelai && n < DELAI_PREVENANCE_LEGAL && !accord.trim()
    ? `${t('A notice of less than ')}${DELAI_PREVENANCE_LEGAL}${t(' days assumes a collective agreement (art. L3121-11): enter its reference.')}` : null;
  const modifie = n !== s.astreinteDelaiPrevenance || accord.trim() !== s.astreinteAccord;
  const enregistrer = async () => {
    const erreur = [['ast-delai', erreurDelai], ['ast-accord', erreurAccord]].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0]!)?.focus(); return; }
    setBusy(true);
    await save({ astreinteDelaiPrevenance: n, astreinteAccord: accord });
    setBusy(false);
  };

  return (
    <Panel title={t('On-call duty')} style={{ gap: 'var(--space-4)' }}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Notice period (days)')} htmlFor="ast-delai" requis erreur={tente && erreurDelai}>
          <input className="input tnum" id="ast-delai" inputMode="numeric" value={delai} disabled={!admin} onChange={e => setDelai(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label={<>{t('Reference of the agreement on on-call duty')}{n >= DELAI_PREVENANCE_LEGAL && <span className="who">{t(' · optional')}</span>}</>} htmlFor="ast-accord"
        requis={n < DELAI_PREVENANCE_LEGAL} erreur={tente && erreurAccord}>
        <input className="input" id="ast-accord" maxLength={120} placeholder={t('Company agreement on working time of …')} value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the notice')}</Btn></div>}
      <Fine>
        {t('The individual schedule is given to the employee at least ')}{DELAI_PREVENANCE_LEGAL}{t(' days in advance failing an agreement (art. R3121-3): e-mail and calendar event. Below the set notice, the planning requires the reason of the exceptional circumstances; never less than one clear day.')}
      </Fine>

      <Field label={t('Form of compensation')}>
        <Seg name="ast-compensation" label={t('Form of compensation')} value={s.astreinteCompensation} options={COMPENSATIONS} disabled={!admin}
          onChange={v => save({ astreinteCompensation: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={repos ? t('Rest per period (hours)') : t('Compensation per period (euros)')} htmlFor="ast-bareme-periode" erreur={tenteBareme && erreurPeriode}>
          <input className="input tnum" id="ast-bareme-periode" inputMode="decimal" value={periode} disabled={!admin} onChange={e => setPeriode(e.target.value)} style={{ maxWidth: 140 }} />
        </Field>
        <Field label={repos ? t('Rest per on-call hour (minutes)') : t('Compensation per on-call hour (euros)')} htmlFor="ast-bareme-heure" erreur={tenteBareme && erreurHeure}>
          <input className="input tnum" id="ast-bareme-heure" inputMode="decimal" value={heure} disabled={!admin} onChange={e => setHeure(e.target.value)} style={{ maxWidth: 140 }} />
        </Field>
      </div>
      {tenteBareme && erreurBaremeAccord && <NoteAccent>{erreurBaremeAccord}</NoteAccent>}
      {admin && baremeModifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrerBareme}>{t('Save the scale')}</Btn></div>}
      <Fine>
        {bareme ? `${t('Scale in force: ')}${bareme}. ` : t('No scale set: the compensation is neither calculated nor transmitted. ')}
        {t('Each completed on-call duty receives its compensation in the month of its start (')}{repos ? t('AST_REPOS, in hours') : t('AST_COMP, in euros')}{t('), frozen in the payroll batch that carries it.')}
      </Fine>
      {!s.astreinteAccord && <NoteAccent>{t('Agreement on on-call duty not referenced: form and amount of the compensation to be confirmed. The monthly summary given to the employee (art. R3121-2) states the form set here.')}</NoteAccent>}
      <Fine>
        {t('Each on-call duty gives rise to a compensation, financial or in rest (art. L3121-9). Cursus transmits to payroll the hours (AST_H) and the periods (AST_PER) of completed on-call duty, and the compensation calculated from the scale above (AST_COMP or AST_REPOS). These items are deactivated as long as payroll has not given their codes: the items are listed “to be entered in Sage” in the batch summary. The interventions are actual work, counted on the timesheet (normal, overtime, night and Sunday hours).')}
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.astreinteMineurs} disabled={!admin} onChange={e => save({ astreinteMineurs: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Allow the on-call duty of an employee under 18')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('Unticked by default: night work is forbidden to them (art. L3163-2) and an intervention is not scheduled.')}</span>
        </span>
      </label>
    </Panel>
  );
}
