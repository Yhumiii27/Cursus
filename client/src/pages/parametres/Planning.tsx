// Paramètres → Planning d'équipe (lot 12, chantier C5, étape 2 ; shared/rules/planning-controles.ts) : activation du module
// (désactivé jusqu'à l'avis du CSE, art. L2312-8), délai de prévenance (7 jours à défaut d'accord, art. L3121-47), repos
// quotidien réduit par l'accord en travail posté (9 h au moins, jamais pour un mineur), durées du travailleur de nuit (8 h et
// 40 h, jusqu'à 12 h et 44 h par accord), référence de l'accord (exigée dès qu'une valeur s'écarte de la loi : COHERENCE de
// shared/reglages.ts), planning des collègues visible du salarié (fermé par défaut : leurs postes planifiés seulement,
// jamais leurs absences), et reprise des équipes par quart en groupes de roulement, proposée une fois le module activé.
// Date de l'avis du CSE (`planningCseLe`) : notée avant l'activation, qui la suppose (COHERENCE, comme le badgeage).
// Réglages de l'administrateur RH ; les autres profils de l'espace RH consultent. Les cases s'enregistrent aussitôt ; les
// valeurs et la référence de l'accord, ensemble, au bouton « Enregistrer ».
import { useState } from 'react';
import {
  DELAI_PREVENANCE_PLANNING, DELAI_PREVENANCE_PLANNING_MIN, MSG_AVIS_CSE_PLANNING, NUIT_JOUR_ACCORD_MAX, NUIT_JOUR_LEGAL, NUIT_MOYENNE_ACCORD_MAX, NUIT_MOYENNE_LEGALE, planningHorsLoi,
  REPOS_QUOTIDIEN_ACCORD_MIN,
} from '../../../../shared/rules/planning-controles.ts';
import { equipesParQuart } from '../../../../shared/rules/planning-reprise.ts';
import { fmtIso } from '../../../../shared/format.ts';
import { REPOS_QUOTIDIEN } from '../../../../shared/rules/repos-nuit.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Valeurs réglables : clé, libellé (source anglaise, traduite au rendu), bornes. */
const VALEURS = [
  ['planningDelaiPrevenance', 'Notice period (days)', DELAI_PREVENANCE_PLANNING_MIN, 60],
  ['planningReposQuotidienAccord', 'Daily rest of the agreement (hours)', REPOS_QUOTIDIEN_ACCORD_MIN, REPOS_QUOTIDIEN],
  ['planningNuitJour', 'Night shift at most (hours)', NUIT_JOUR_LEGAL, NUIT_JOUR_ACCORD_MAX],
  ['planningNuitMoyenne', 'Average of the night worker over 12 weeks (hours)', NUIT_MOYENNE_LEGALE, NUIT_MOYENNE_ACCORD_MAX],
] as const;
type Cle = typeof VALEURS[number][0];
const valeursDe = (s: SectionProps['s']) => Object.fromEntries(VALEURS.map(([k]) => [k, String(s[k])])) as Record<Cle, string>;

export function Planning({ s }: SectionProps) {
  const { admin, espaceRh, rh } = useRole();
  const { openDialog } = useStore();
  const data = useData();
  const save = useEnregistrerReglages();
  const [valeurs, setValeurs] = useState(() => valeursDe(s));
  const [accord, setAccord] = useState(s.planningAccord);
  const [cseLe, setCseLe] = useState(s.planningCseLe ?? '');
  const [tente, setTente] = useState(false);
  // Activation demandée sans date d'avis du CSE enregistrée : refus à l'écran, sous la case.
  const [sansAvis, setSansAvis] = useState(false);
  const [busy, setBusy] = useState(false);
  // Réglages changés ailleurs (enregistrement, autre administrateur) : la saisie repart des valeurs en vigueur.
  const cle = `${VALEURS.map(([k]) => s[k]).join('|')}|${s.planningAccord}|${s.planningCseLe ?? ''}`;
  const [source, setSource] = useState(cle);
  if (source !== cle) { setSource(cle); setValeurs(valeursDe(s)); setAccord(s.planningAccord); setCseLe(s.planningCseLe ?? ''); setTente(false); setSansAvis(false); }
  if (!espaceRh) return null;

  const erreurs = Object.fromEntries(VALEURS.map(([k, , min, max]) => {
    const v = valeurs[k].trim(), n = Number(v);
    return [k, !/^\d{1,2}$/.test(v) || n < min || n > max ? `${t('A whole number from ')}${min}${t(' to #nombre')}${max}.` : null];
  })) as Record<Cle, string | null>;
  const nombres = Object.fromEntries(VALEURS.map(([k]) => [k, Number(valeurs[k])])) as Record<Cle, number>;
  const erreurAccord = !Object.values(erreurs).some(Boolean) && planningHorsLoi(nombres) && !accord.trim()
    ? t('A notice of less than 7 days, a reduced daily rest or other durations of night work assume a collective agreement: enter its reference.') : null;
  // Date de l'avis : facultative tant que le module est désactivé ; jamais effacée quand il est actif.
  const erreurCse = cseLe && !/^\d{4}-\d{2}-\d{2}$/.test(cseLe) ? t('A date (day, month, year).')
    : !cseLe && s.planningActif ? t('Module activated: the date of the CSE’s opinion stays required.') : null;
  const modifie = VALEURS.some(([k]) => nombres[k] !== s[k]) || accord.trim() !== s.planningAccord || (cseLe || null) !== s.planningCseLe;
  const enregistrer = async () => {
    const erreur = [...VALEURS.map(([k]) => [`pla-${k}`, erreurs[k]] as const), ['pla-accord', erreurAccord] as const, ['pla-cse', erreurCse] as const].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0])?.focus(); return; }
    setBusy(true);
    await save({ ...nombres, planningAccord: accord.trim(), planningCseLe: cseLe || null });
    setBusy(false);
  };
  const activer = (oui: boolean) => {
    if (oui && !s.planningCseLe) { setSansAvis(true); document.getElementById('pla-cse')?.focus(); return; }
    setSansAvis(false);
    void save({ planningActif: oui });
  };
  const quarts = equipesParQuart(data.referentiels.equipes);

  return (
    <Panel title={t('Team planning')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.planningActif} disabled={!admin} onChange={e => activer(e.target.checked)} aria-describedby={sansAvis ? 'pla-sans-avis' : undefined}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Activate the team planning')}
          <span className="text-muted sub" style={{ display: 'block' }}>
            {t('Rotation cycles, planning published to the employees, shift swaps. The cycles and the job needs are prepared beforehand (Reference data).')}
          </span>
        </span>
      </label>
      {sansAvis && <p className="field-erreur" id="pla-sans-avis" role="alert">{MSG_AVIS_CSE_PLANNING}{t(': note it below and save, then activate.')}</p>}
      {!s.planningActif && <NoteAccent>{t('Module deactivated: the organisation in cycles and the planning tool come under the consultation of the CSE (art. L2312-8). Activate it after its opinion.')}</NoteAccent>}
      {s.planningActif && s.planningCseLe && <Fine>{t('Activated after the CSE’s opinion of ')}{fmtIso(s.planningCseLe)}.</Fine>}
      <Field label={<>{t('Date of the CSE’s opinion')}{!s.planningActif && <span className="who">{t(' · required to activate')}</span>}</>} htmlFor="pla-cse" requis={s.planningActif} erreur={(tente || sansAvis) && erreurCse}>
        <input className="input" id="pla-cse" type="date" value={cseLe} disabled={!admin} onChange={e => setCseLe(e.target.value)} style={{ maxWidth: 200 }} />
      </Field>

      <div className="grid-2">
        {VALEURS.map(([k, label]) => (
          <Field key={k} label={t(label)} htmlFor={`pla-${k}`} requis erreur={tente && erreurs[k]}>
            <input className="input tnum" id={`pla-${k}`} inputMode="numeric" value={valeurs[k]} disabled={!admin} maxLength={2}
              onChange={e => setValeurs({ ...valeurs, [k]: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
        ))}
      </div>
      <Field label={<>{t('Reference of the agreement on the planning')}{!planningHorsLoi(nombres) && <span className="who">{t(' · optional')}</span>}</>} htmlFor="pla-accord"
        requis={planningHorsLoi(nombres)} erreur={tente && erreurAccord}>
        <input className="input" id="pla-accord" maxLength={120} placeholder={t('Company agreement on shift work of …')} value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the values')}</Btn></div>}
      <Fine>
        {t('Values of the law by default: notice period of ')}{DELAI_PREVENANCE_PLANNING}{t(' days (art. L3121-47), daily rest of ')}{REPOS_QUOTIDIEN}{t(' h (art. L3131-1; an agreement may bring it down to ')}{REPOS_QUOTIDIEN_ACCORD_MIN}{t(' h in shift work, never for a minor, with a compensatory rest), night shift of ')}{NUIT_JOUR_LEGAL}{t(' h and average of ')}{NUIT_MOYENNE_LEGALE}{t(' h over 12 weeks (art. L3122-6 and L3122-7). Below the notice period, the publication requires the reason of the exceptional circumstances, communicated to the employees.')}
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.planningCollegues} disabled={!admin} onChange={e => save({ planningCollegues: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Show the employee the planned shifts of their team colleagues')}
          <span className="text-muted sub" style={{ display: 'block' }}>
            {t('Unticked by default: each one only sees their planning and proposes a swap by naming the colleague. Ticked: name and schedule of the published shifts of the team, never an absence nor a rest. Inform the employees before opening it.')}
          </span>
        </span>
      </label>

      {s.planningActif && rh && (
        <div className="list-row">
          <div className="grow">
            <div>{t('Takeover of the teams per shift')}</div>
            <div className="text-muted sub">
              {t('The teams created per shift (2x8, 3x8) for the minimum coverage become the groups of a cycle: each member is assigned to it.')}
              {quarts.length ? `${t(' Spotted: ')}${quarts.map(x => `${x.parente} (${x.equipes.join(', ')})`).join(t('; '))}.` : t(' No team per shift spotted: choose the teams to take over.')}
            </div>
          </div>
          <Btn small onClick={() => openDialog({ type: 'planningReprise' })}>{t('Take over…')}</Btn>
        </div>
      )}
    </Panel>
  );
}
