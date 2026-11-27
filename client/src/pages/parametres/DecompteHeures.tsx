// Paramètres → Décompte des heures (shared/rules/majorations.ts et durees.ts) : saisie un jour férié et majoration des
// fériés autres que le 1er mai (celui-ci : 100 %, fixé par la loi), plafond des heures complémentaires du temps partiel
// (le tiers seulement avec la référence d'un accord), moyenne maximale sur 12 semaines (46 h seulement avec la référence
// d'un accord), contingent annuel d'heures supplémentaires et seuil d'alerte ; travail de nuit, repos quotidien et pause
// (components/ReglagesNuit.tsx, lot 6) ; forfait annuel en heures (components/temps/ReglagesForfaitHeures.tsx, lot 12 — C1).
// Réglages de l'administrateur RH ; les
// autres profils consultent. Les choix qui supposent un accord ne s'enregistrent qu'avec sa référence (COHERENCE de
// shared/reglages.ts) ; revenir à la valeur légale s'enregistre aussitôt, la référence gardée pour mémoire.
import { useEffect, useState } from 'react';
import { CONTINGENT_A_VERIFIER, CONTINGENT_LEGAL, MOYENNE_LEGALE, TAUX_COR } from '../../../../shared/rules/durees.ts';
import { MAJORATION_1ER_MAI } from '../../../../shared/rules/majorations.ts';
import type { PlafondComplementaires, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { ReglagesNuit } from '../../components/ReglagesNuit.tsx';
// lot 12 — C1 (forfait annuel en heures)
import { ReglagesForfaitHeures } from '../../components/temps/ReglagesForfaitHeures.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Majoration des fériés (%) : de 0 à 100 par pas de 5 (contrôle entier(0, 100, 5) de shared/reglages.ts). */
const MAJORATIONS = Array.from({ length: 21 }, (_, i) => i * 5);
/** Choix : sources anglaises, traduites au rendu. */
const PLAFONDS: [PlafondComplementaires, string][] = [['dixieme', 'One tenth (law)'], ['tiers', 'One third (agreement)']];
const MOYENNES: [number, string][] = [[44, '44 h (law)'], [45, '45 h (agreement)'], [46, '46 h (agreement)']];
const ALERTES = Array.from({ length: 11 }, (_, i) => 50 + i * 5);

/**
 * Choix qui suppose un accord collectif : la valeur légale s'enregistre aussitôt ; une autre, avec la référence de
 * l'accord, au bouton « Enregistrer ».
 */
function useChoixAccord<T>(valeur: T, accordEnVigueur: string, legal: T, enregistrer: (v: T, accord: string) => Promise<unknown>) {
  const [choix, setChoix] = useState<T>(valeur);
  const [accord, setAccord] = useState(accordEnVigueur);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChoix(valeur); setAccord(accordEnVigueur); setTente(false); }, [valeur, accordEnVigueur]);
  const choisir = (v: T) => {
    setChoix(v);
    setTente(false);
    if (v === legal && valeur !== legal) void enregistrer(v, accordEnVigueur);
  };
  const erreur = choix !== legal && !accord.trim() ? t('Enter the reference of the collective agreement.') : null;
  const modifie = choix !== valeur || (choix !== legal && accord.trim() !== accordEnVigueur);
  const valider = async (id: string) => {
    if (erreur) { setTente(true); document.getElementById(id)?.focus(); return; }
    setBusy(true);
    await enregistrer(choix, accord);
    setBusy(false);
  };
  return { choix, choisir, accord, setAccord, erreur: tente ? erreur : null, modifie, valider, busy };
}

export function DecompteHeures({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const hc = useChoixAccord<PlafondComplementaires>(s.plafondHeuresComplementaires, s.heuresComplementairesAccord, 'dixieme',
    (v, accord) => save({ plafondHeuresComplementaires: v, heuresComplementairesAccord: accord }));
  const moy = useChoixAccord<number>(s.moyenne12SemainesMax, s.moyenne12SemainesAccord, MOYENNE_LEGALE,
    (v, accord) => save({ moyenne12SemainesMax: v, moyenne12SemainesAccord: accord }));

  // Contingent : trois champs enregistrés ensemble.
  const [contingent, setContingent] = useState(String(s.contingentHeuresSup));
  const [alerte, setAlerte] = useState(s.contingentAlerte);
  const [reference, setReference] = useState(s.contingentAccord);
  const [busy, setBusy] = useState(false);
  const [tente, setTente] = useState(false);
  useEffect(() => { setContingent(String(s.contingentHeuresSup)); setAlerte(s.contingentAlerte); setReference(s.contingentAccord); setTente(false); },
    [s.contingentHeuresSup, s.contingentAlerte, s.contingentAccord]);
  const n = Number(contingent.replace(',', '.'));
  const erreurContingent = !/^\d{1,4}$/.test(contingent.trim()) || n > 1000 ? t('Enter a whole number of hours, from 0 to 1,000.') : null;
  const contingentModifie = contingent.trim() !== String(s.contingentHeuresSup) || alerte !== s.contingentAlerte || reference.trim() !== s.contingentAccord;
  const enregistrerContingent = async () => {
    if (erreurContingent) { setTente(true); document.getElementById('dh-contingent')?.focus(); return; }
    setBusy(true);
    await save({ contingentHeuresSup: n, contingentAlerte: alerte, contingentAccord: reference } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <Panel title={t('Counting of hours')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.feriesTravaillesAutorises} disabled={!admin} onChange={e => save({ feriesTravaillesAutorises: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Allow entering hours on a public holiday')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('“Public holiday worked” mention on the timesheet; each entry is traced in the log of actions.')}</span>
        </span>
      </label>
      <Field label={t('Increase for public holidays (except 1 May)')} htmlFor="dh-ferie">
        <select className="input" id="dh-ferie" value={s.tauxMajorationFerie} disabled={!admin} onChange={e => save({ tauxMajorationFerie: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {MAJORATIONS.map(v => <option key={v} value={v}>{v ? `${v} %` : t('None (0 %)#fem')}</option>)}
        </select>
      </Field>
      <Fine>
        {t('1 May worked is paid double: increase of ')}{MAJORATION_1ER_MAI}{t(' % set by law (art. L3133-6, item MAJ_1MAI). The other public holidays have no legal increase: their hours go as quantity (FERIE_TRAV), and an increase provided by the agreement or a collective agreement adds MAJ_FERIE, frozen on each timesheet at its approval. Solidarity day and public holidays not taken off: section “Public holidays and solidarity day”, year by year; a day so worked is no longer a public holiday (neither FERIE_TRAV, nor increase).')}
      </Fine>

      <Field label={t('Additional hours of part-time work')}>
        <Seg name="dh-hc" label={t('Additional hours of part-time work')} value={hc.choix} options={PLAFONDS.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={hc.choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      {hc.choix === 'tiers' && (
        <>
          <Field label={t('Reference of the collective agreement')} htmlFor="dh-hc-accord" requis erreur={hc.erreur}>
            <input className="input" id="dh-hc-accord" maxLength={120} placeholder={t('Branch or company agreement of …')} value={hc.accord} disabled={!admin}
              onChange={e => hc.setAccord(e.target.value)} />
          </Field>
          {admin && hc.modifie && <div className="actions-end"><Btn variant="primary" disabled={hc.busy} onClick={() => hc.valider('dh-hc-accord')}>{t('Save the one-third ceiling')}</Btn></div>}
        </>
      )}
      <Fine>
        {t('Without an agreement, additional hours are limited to one tenth of the contractual duration (art. L3123-28); a collective agreement may raise the limit to one third (art. L3123-20). Beyond, the timesheet requires a reason on submission. Increase: 10 % up to one tenth, 25 % beyond (art. L3123-29).')}
      </Fine>

      <Field label={t('Maximum average over 12 weeks')}>
        <Seg name="dh-moyenne" label={t('Maximum average over 12 weeks')} value={moy.choix} options={MOYENNES.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={moy.choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      {moy.choix !== MOYENNE_LEGALE && (
        <>
          <Field label={t('Reference of the collective agreement')} htmlFor="dh-moyenne-accord" requis erreur={moy.erreur}>
            <input className="input" id="dh-moyenne-accord" maxLength={120} placeholder={t('Company agreement on working time of …')} value={moy.accord} disabled={!admin}
              onChange={e => moy.setAccord(e.target.value)} />
          </Field>
          {admin && moy.modifie && <div className="actions-end"><Btn variant="primary" disabled={moy.busy} onClick={() => moy.valider('dh-moyenne-accord')}>{t('Save the average')}</Btn></div>}
        </>
      )}
      <Fine>
        {t('Average of the last 12 weeks worked (approved timesheets; a week without an approved timesheet or of full absence is skipped): 44 h at most (art. L3121-22), 46 h with an agreement (art. L3121-23). Part-time work whose actual schedule exceeds the contract by at least 2 h during 12 weeks out of 15 is flagged (art. L3123-13). Alerts to HR on the Working time screen, without blocking.')}
      </Fine>

      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Annual overtime quota')} htmlFor="dh-contingent" requis erreur={tente && erreurContingent}>
          <input className="input tnum" id="dh-contingent" inputMode="numeric" value={contingent} disabled={!admin} onChange={e => setContingent(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label={t('Alert at')} htmlFor="dh-alerte">
          <select className="input" id="dh-alerte" value={alerte} disabled={!admin} onChange={e => setAlerte(Number(e.target.value))}>
            {ALERTES.map(v => <option key={v} value={v}>{v} %</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('Reference of the agreement or collective agreement')} htmlFor="dh-contingent-accord">
        <input className="input" id="dh-contingent-accord" maxLength={120} placeholder={t('CCN Chemical industries, company agreement of …')} value={reference} disabled={!admin}
          onChange={e => setReference(e.target.value)} />
      </Field>
      {admin && contingentModifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrerContingent}>{t('Save the quota')}</Btn></div>}
      {!s.contingentAccord && <div className="note-accent">{CONTINGENT_A_VERIFIER.charAt(0).toUpperCase() + CONTINGENT_A_VERIFIER.slice(1)}.</div>}
      <Fine>
        {t('Overtime of the calendar year, on the approved timesheets and the hours taken over from the former tool, without those replaced by a rest (art. L3121-30) nor temp work; ')}{CONTINGENT_LEGAL}{t(' h by default (art. D3121-24). Beyond, a mandatory compensatory rest of ')}{TAUX_COR}{t(' % (more than 20 employees, art. L3121-38) is frozen on each timesheet at its approval, credited to the recovery counter and transmitted to payroll (COR_ACQUIS).')}
      </Fine>

      <ReglagesNuit s={s} />
      {/* lot 12 — C1 (forfait annuel en heures) */}
      <ReglagesForfaitHeures s={s} />
    </Panel>
  );
}
