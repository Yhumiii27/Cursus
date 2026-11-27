// Paramètres → Badgeage (lot 12, chantier C6, étape 2 ; shared/rules/pointage.ts) : module livré désactivé. Activation
// refusée sans la référence de l'accord d'entreprise ni la date de l'avis du CSE (COHERENCE de shared/reglages.ts, art.
// L2312-38 et L1222-4) ; populations badgées (critère, valeur, mode, date d'effet ; mode « contrôlé » proposé pour la
// première), forfait jours et cadres dirigeants toujours exclus, intérimaires sur option ; délai des corrections, pointage
// hors ligne, seuils des anomalies, conservation des pointages bruts. Mention d'information des salariés générée d'après
// ces réglages (shared/rules/pointage-information.ts). Réglages de l'administrateur RH ; le service RH et la lecture seule
// consultent. Les champs s'enregistrent ensemble, au bouton « Enregistrer ». Étape 3 : géolocalisation au pointage et zones
// (components/temps/GeolocPointage.tsx), enregistrées à part.
import { useEffect, useState } from 'react';
import { TEMPS_TRAVAIL } from '../../../../shared/constants.ts';
import type { CriterePopulation, ModeTemps, PopulationPointage, Settings } from '../../../../shared/types.ts';
import { CONSERVATION_POINTAGES_MAX, CONSERVATION_POINTAGES_MIN, CRITERES_POPULATION, lirePopulations, MODES_TEMPS, POPULATIONS_MAX, refusActivationPointage } from '../../../../shared/rules/pointage.ts';
import { mentionInformationPointage } from '../../../../shared/rules/pointage-information.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, CloseButton, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { GeolocPointage } from '../../components/temps/GeolocPointage.tsx';
import { t, tn } from '../../i18n/langue.ts';

/** Régimes qui peuvent pointer (jamais le forfait jours ni le cadre dirigeant). */
const REGIMES = (['35h', '39h_rtt', 'forfait_heures_hebdo', 'forfait_heures_annuel', 'partiel'] as const).map(r => [r, TEMPS_TRAVAIL[r].label] as const);
const CHAMPS = ['pointageActif', 'pointageAccord', 'pointageCseLe', 'pointagePopulations', 'pointageInterim', 'pointageDelaiCorrectionJours', 'pointageHorsLigne',
  'pointageEcartDiffereMin', 'pointageEcartAnomalieMin', 'conservationPointagesAns'] as const;
type Champs = Pick<Settings, typeof CHAMPS[number]>;
const depuis = (s: Settings): Champs => Object.fromEntries(CHAMPS.map(k => [k, s[k]])) as Champs;

export function Badgeage({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const data = useData();
  const { notify } = useStore();
  const save = useEnregistrerReglages();
  const [v, setV] = useState<Champs>(() => depuis(s));
  const [busy, setBusy] = useState(false);
  const [tente, setTente] = useState(false);
  const [mention, setMention] = useState(false);
  // oxlint-disable-next-line react/exhaustive-deps -- relu quand l'un des réglages enregistrés change, pas à chaque rendu.
  useEffect(() => { setV(depuis(s)); setTente(false); }, CHAMPS.map(k => JSON.stringify(s[k])));
  if (!espaceRh) return null;

  const maj = (x: Partial<Champs>) => setV(o => ({ ...o, ...x }));
  const populations = v.pointagePopulations ?? [];
  const majPopulation = (i: number, x: Partial<PopulationPointage>) => maj({ pointagePopulations: populations.map((p, j) => (j === i ? { ...p, ...x } : p)) });
  const valeurs = (c: CriterePopulation): readonly (readonly [string, string])[] => c === 'equipe' ? data.referentiels.equipes.map(q => [q.nom, q.nom] as const)
    : c === 'entite' ? (data.referentiels.entites ?? []).map(x => [x.code, `${x.code} · ${x.nom}`] as const)
    : c === 'site' ? (data.referentiels.sites ?? []).map(x => [x.code, `${x.code} · ${x.libelle}`] as const) : REGIMES;
  const lues = lirePopulations(populations);
  const erreurPopulations = typeof lues === 'string' ? lues : null;
  const erreurActivation = refusActivationPointage({ pointageActif: v.pointageActif, pointageAccord: v.pointageAccord.trim(), pointageCseLe: v.pointageCseLe });
  const modifie = CHAMPS.some(k => JSON.stringify(v[k]) !== JSON.stringify(s[k]));
  const enregistrer = async () => {
    if (erreurPopulations || erreurActivation) { setTente(true); document.getElementById(erreurActivation ? 'bdg-accord' : 'bdg-populations')?.focus(); return; }
    setBusy(true);
    await save({ ...v, pointageAccord: v.pointageAccord.trim() } satisfies Partial<Settings>);
    setBusy(false);
  };
  const texte = mentionInformationPointage(s);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte.join('\n\n'));
      notify(t('Information notice copied'));
    } catch {
      notify(t('Copy impossible in this browser: select the text'), true);
    }
  };
  const entier = (k: 'pointageDelaiCorrectionJours' | 'pointageEcartDiffereMin' | 'pointageEcartAnomalieMin' | 'conservationPointagesAns', valeurs: number[], unite: (n: number) => string, id: string, label: string) => (
    <Field label={label} htmlFor={id}>
      <select className="input" id={id} value={v[k]} disabled={!admin} onChange={e => maj({ [k]: Number(e.target.value) })} style={{ maxWidth: 200 }}>
        {valeurs.map(n => <option key={n} value={n}>{unite(n)}</option>)}
      </select>
    </Field>
  );

  return (
    <Panel title={t('Badge clocking')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.pointageActif} disabled={!admin} onChange={e => { maj({ pointageActif: e.target.checked }); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Activate the clocking of hours (“Clock in” button on the phone and the computer)')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('Means of controlling the activity: after informing and consulting the CSE (art. L2312-38), on the basis of the company agreement, and informing each employee (art. L1222-4).')}</span>
        </span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Reference of the company agreement')} htmlFor="bdg-accord" requis={v.pointageActif} erreur={tente && erreurActivation && !v.pointageAccord.trim() ? t('Enter the reference of the agreement.') : null}>
          <input className="input" id="bdg-accord" maxLength={200} placeholder={t('Agreement on the organisation of working time of …')} value={v.pointageAccord} disabled={!admin} onChange={e => maj({ pointageAccord: e.target.value })} />
        </Field>
        <Field label={t('CSE’s opinion on')} htmlFor="bdg-cse" requis={v.pointageActif} erreur={tente && erreurActivation && !v.pointageCseLe ? t('Enter the date of the CSE’s opinion.') : null}>
          <input className="input" id="bdg-cse" type="date" value={v.pointageCseLe ?? ''} disabled={!admin} onChange={e => maj({ pointageCseLe: e.target.value || null })} style={{ maxWidth: 200 }} />
        </Field>
      </div>

      <Field label={t('Populations who clock in')} htmlFor="bdg-populations" erreur={tente ? erreurPopulations : null}>
        <div id="bdg-populations" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {!populations.length && <span className="text-muted sub">{t('None: all staff declare their time on the timesheet.')}</span>}
          {populations.map((p, i) => (
            <div key={i} className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
              <select className="input" aria-label={`${t('Population ')}${i + 1}${t(': criterion')}`} value={p.critere} disabled={!admin} onChange={e => majPopulation(i, { critere: e.target.value as CriterePopulation, valeur: '' })} style={{ maxWidth: 220 }}>
                {Object.entries(CRITERES_POPULATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="input" aria-label={`${t('Population ')}${i + 1}${t(': value')}`} value={p.valeur} disabled={!admin} onChange={e => majPopulation(i, { valeur: e.target.value })} style={{ maxWidth: 220 }}>
                <option value="">{t('Choose…')}</option>
                {valeurs(p.critere).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                {p.valeur && !valeurs(p.critere).some(([k]) => k === p.valeur) && <option value={p.valeur}>{p.valeur}{t(' (missing from the reference data)')}</option>}
              </select>
              <select className="input" aria-label={`${t('Population ')}${i + 1}${t(': mode')}`} value={p.mode} disabled={!admin} onChange={e => majPopulation(i, { mode: e.target.value as ModeTemps })} style={{ maxWidth: 300 }}>
                {Object.entries(MODES_TEMPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input className="input" type="date" aria-label={`${t('Population ')}${i + 1}${t(': effective date')}`} value={p.effet} disabled={!admin} onChange={e => majPopulation(i, { effet: e.target.value })} style={{ maxWidth: 170 }} />
              {admin && <CloseButton size={28} label={`${t('Remove population ')}${i + 1}`} onClick={() => maj({ pointagePopulations: populations.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          {admin && populations.length < POPULATIONS_MAX && (
            <div>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => maj({ pointagePopulations: [...populations, { critere: 'equipe', valeur: '', mode: 'controle', effet: data.today }] })}>{t('Add a population')}</button>
            </div>
          )}
        </div>
      </Field>
      <Fine>
        {t('The most recent population that designates the employee at a date says their mode, frozen on each timesheet at its creation: changing a population never recalculates a past week. Controlled: the timesheet stays declarative, the gaps with the clock-ins are flagged. Calculated: the hours of each day come from the clock-ins (“PTG” line of the timesheet), to be split over the projects. Fixed-days and executive staff never clock in.')}
      </Fine>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.pointageInterim} disabled={!admin} onChange={e => maj({ pointageInterim: e.target.checked })} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
        <span>{t('The temps of the populations clock in too')}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.pointageHorsLigne} disabled={!admin} onChange={e => maj({ pointageHorsLigne: e.target.checked })} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
        <span>{t('Allow clocking without network (device time, marked “deferred”)')}</span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        {entier('pointageDelaiCorrectionJours', [3, 5, 7, 10, 14, 21, 31], n => tn(n, 'day', 'days'), 'bdg-delai', t('Time limit of a correction request'))}
        {entier('pointageEcartDiffereMin', [1, 2, 5, 10, 15, 30, 60], n => `${n}${t(' min')}`, 'bdg-differe', t('Gap tolerated offline'))}
        {entier('pointageEcartAnomalieMin', [0, 5, 10, 15, 30, 60], n => (n ? `${n}${t(' min per day')}` : t('Any gap')), 'bdg-ecart', t('Gap declared / clocked flagged'))}
        {entier('conservationPointagesAns', Array.from({ length: CONSERVATION_POINTAGES_MAX - CONSERVATION_POINTAGES_MIN + 1 }, (_, i) => CONSERVATION_POINTAGES_MIN + i), n => tn(n, 'year#count', 'years#count'), 'bdg-conservation', t('Retention of clock-ins'))}
      </div>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the badge clocking')}</Btn></div>}
      {!s.pointageActif && <NoteAccent>{t('Badge clocking deactivated: no “Clock in” button, no “Clock-ins” entry in the menus. Before activation: CSE’s opinion, agreement, impact assessment (DPIA) with the DPO and informing the employees.')}</NoteAccent>}
      <Fine>
        {t('Retention: 1 year at least (art. D3171-16), 5 years at most (CNIL reference for personnel management); duration to be confirmed with the DPO. No wall badge reader: clocking is done in Cursus, on the phone or the computer. No “missing exit” reminder is sent: the anomaly is shown on opening and in the manager’s queue.')}
      </Fine>
      {/* Étape 3 : géolocalisation au pointage (option désactivée) et zones (components/temps/GeolocPointage.tsx). */}
      <GeolocPointage s={s} />
      <div>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={mention} onClick={() => setMention(m => !m)}>{mention ? t('Hide the employees’ information notice') : t('Show the employees’ information notice')}</button>
      </div>
      {mention && (
        <div className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <strong>{texte[0]}</strong>
          {texte.slice(1).map(p => <p key={p} className="sub" style={{ margin: 0 }}>{p}</p>)}
          <div className="actions-end"><Btn small onClick={copier}>{t('Copy the text')}</Btn></div>
          <Fine>{t('Text proposed from the saved settings, to be reviewed by the DPO before posting and handing over to each employee concerned.')}</Fine>
        </div>
      )}
    </Panel>
  );
}
