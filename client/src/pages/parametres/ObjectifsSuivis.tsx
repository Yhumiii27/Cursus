// lot 12 — C3 (entretiens suivis, t194) : Paramètres → Objectifs et points de suivi. Réglages de l'administrateur RH,
// enregistrés aussitôt (les autres profils les consultent) :
// - objectifs suivis aux entretiens annuels, nombre au plus par entretien, mode « objectifs facultatifs » (activé la
//   première année : la clôture n'exige pas l'évaluation des objectifs repris) ;
// - point de mi-année facultatif, ou dû dans une fenêtre réglable (échéance, relances) ;
// - versement des souhaits de formation (réponse du propriétaire du 1er novembre 2026 : à la clôture, avis favorable du
//   manager seulement ; pas de réglage) ;
// - feedback 360° (étape 3) : désactivé ; activable seulement avec la référence de l'avis du CSE et celle de l'AIPD
//   (refus du serveur sinon, COHERENCE de shared/reglages.ts) ; seuil de restitution (3 à 5), fenêtre de réponse,
//   conservation des réponses brutes (6 mois au plus). Références enregistrées d'un bloc.
import { type ReactNode, useState } from 'react';
import { miAnnee } from '../../../../shared/rules/entretiens.ts';
import { CONSERVATION_360_MAX_MOIS, QUESTIONNAIRE_360, SEUIL_360_MAX, SEUIL_360_MIN } from '../../../../shared/rules/feedback360.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { JourMois } from './Entretiens.tsx';
import { t } from '../../i18n/langue.ts';

/** Nombres proposés, tous acceptés par le réglage (`entier(1, 20)`, shared/reglages.ts). */
const MAXIMA = [3, 5, 8, 10, 12];

function Case({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: disabled ? undefined : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
      <span>{children}</span>
    </label>
  );
}

export function ObjectifsSuivis({ s }: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Fenêtre du point de mi-année en cours de saisie : enregistrée d'un bloc (le serveur refuse un début après la fin).
  const [debut, setDebut] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Feedback 360° : références de l'avis du CSE et de l'AIPD en cours de saisie, enregistrées d'un bloc.
  const [cse, setCse] = useState<string | null>(null);
  const [aipd, setAipd] = useState<string | null>(null);
  if (!espaceRh) return null;
  const rCse = cse ?? s.feedback360Cse, rAipd = aipd ?? s.feedback360Aipd;
  const refsModifiees = rCse !== s.feedback360Cse || rAipd !== s.feedback360Aipd;
  const enregistrerRefs = async () => {
    if (busy) return;
    setBusy(true);
    const r = await enregistrer({ feedback360Cse: rCse, feedback360Aipd: rAipd });
    setBusy(false);
    if (r.ok) { setCse(null); setAipd(null); }
  };
  const dDebut = debut ?? s.pointMiAnneeDebut, dFin = fin ?? s.pointMiAnneeFin;
  const modifiees = dDebut !== s.pointMiAnneeDebut || dFin !== s.pointMiAnneeFin;
  const ordre = dDebut > dFin ? t('The start of the window must precede its end, in the same year.') : null;
  const pm = miAnnee({ ...s, pointMiAnneeActif: true, pointMiAnneeDebut: dDebut, pointMiAnneeFin: dFin }, d.year)!;
  const enregistrerFenetre = async () => {
    if (busy || ordre) return;
    setBusy(true);
    const r = await enregistrer({ pointMiAnneeDebut: dDebut, pointMiAnneeFin: dFin });
    setBusy(false);
    if (r.ok) { setDebut(null); setFin(null); }
  };

  return (
    <Panel title={t('Objectives and follow-up reviews')} style={{ gap: 'var(--space-4)' }}>
      <Case checked={s.objectifsActifs} disabled={!admin} onChange={v => enregistrer({ objectifsActifs: v })}>
        {t('Follow structured objectives in the annual reviews')}
        <span className="text-muted sub" style={{ display: 'block' }}>{t('Set and evaluated at the annual review, adjusted during the year with a reason; the employee proposes, the manager approves. Deactivated: neither entry nor “My objectives”, the objectives already set stay in the database.')}</span>
      </Case>
      <Case checked={s.objectifsFacultatifs} disabled={!admin || !s.objectifsActifs} onChange={v => enregistrer({ objectifsFacultatifs: v })}>
        {t('Optional objectives (first year)')}
        <span className="text-muted sub" style={{ display: 'block' }}>{t('The closing of an annual review does not require the evaluation of the objectives taken over. A proposal of the employee stays to approve or withdraw before the closing.')}</span>
      </Case>
      <Field label={t('Objectives at most per review')}>
        <Seg name="param-objectifs-max" label={t('Number of objectives at most per review')} value={s.objectifsMax}
          options={[...new Set([...MAXIMA, s.objectifsMax])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
          disabled={!admin || !s.objectifsActifs} onChange={v => enregistrer({ objectifsMax: v })} style={{ flexWrap: 'wrap' }} />
      </Field>

      <Case checked={s.pointMiAnneeActif} disabled={!admin} onChange={v => enregistrer({ pointMiAnneeActif: v })}>
        {t('Make the mid-year review mandatory')}
        <span className="text-muted sub" style={{ display: 'block' }}>{t('Optional by default. Mandatory: it becomes a due date of each employee concerned by the campaign, reminded like the other reviews.')}</span>
      </Case>
      <div className="grid-2">
        <JourMois id="pm-debut" label={t('Opening of the window')} value={dDebut} onChange={setDebut} disabled={!admin || !s.pointMiAnneeActif} />
        <JourMois id="pm-fin" label={t('End of the window (due date)')} value={dFin} onChange={setFin} disabled={!admin || !s.pointMiAnneeActif} />
      </div>
      {ordre && <p className="form-error">{ordre}</p>}
      {admin && modifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setDebut(null); setFin(null); }}>{t('Cancel')}</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerFenetre}>{t('Save the window')}</Btn>
        </div>
      )}
      <Fine>{s.pointMiAnneeActif ? pm.libelle : `${pm.libelle.replace(/^Point de mi-année \d+ — /, t('Planned window '))}${t(' (applied if the review becomes mandatory)')}`}.</Fine>

      <Field label={t('Training wishes expressed in a review')}>
        <p style={{ fontSize: 14, margin: 0 }}>{t('Transferred automatically at the closing, only with the manager’s favourable opinion.')}</p>
      </Field>
      <Fine>{t('Each favourable wish becomes a training request to HR, checked like a request from the employee (never twice, nor during an upcoming enrolment); accepted, it gives a plan line of origin “review”. The other wishes stay in the report.')}</Fine>

      <Case checked={s.feedback360Actif} disabled={!admin} onChange={v => enregistrer({ feedback360Actif: v })}>
        {t('360° feedback (opinion of colleagues, the N+2 and supervised employees)')}
        <span className="text-muted sub" style={{ display: 'block' }}>
          {t('Means of evaluating employees: activated only with the reference of the CSE’s opinion (art. L2312-38) and of the impact assessment (DPIA), once the questionnaire (version ')}{QUESTIONNAIRE_360.version}{t(') has been brought to the employees’ attention (art. L1222-3). Deactivated: no more solicitation; the syntheses already attached stay.')}
        </span>
      </Case>
      <div className="grid-2">
        <Field label={t('Reference of the CSE’s opinion')} htmlFor="f360-cse">
          <input className="input" id="f360-cse" value={rCse} maxLength={120} disabled={!admin} placeholder={t('E.g.: CSE’s opinion of 12 March 2027')} onChange={ev => setCse(ev.target.value)} />
        </Field>
        <Field label={t('Reference of the DPIA')} htmlFor="f360-aipd">
          <input className="input" id="f360-aipd" value={rAipd} maxLength={120} disabled={!admin} placeholder={t('E.g.: AIPD-2027-02 approved by the DPO')} onChange={ev => setAipd(ev.target.value)} />
        </Field>
      </div>
      {admin && refsModifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setCse(null); setAipd(null); }}>{t('Cancel')}</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerRefs}>{t('Save the references')}</Btn>
        </div>
      )}
      <Field label={t('Restitution threshold (answers per group)')}>
        <Seg name="param-f360-seuil" label={t('Restitution threshold of the 360° feedback')} value={s.feedback360Seuil}
          options={Array.from({ length: SEUIL_360_MAX - SEUIL_360_MIN + 1 }, (_, i) => SEUIL_360_MIN + i).map(n => [n, String(n)] as [number, string])}
          disabled={!admin} onChange={v => enregistrer({ feedback360Seuil: v })} />
      </Field>
      <div className="grid-2">
        <Field label={t('Response window (days)')}>
          <Seg name="param-f360-fenetre" label={t('Response window of the 360° feedback')} value={s.feedback360FenetreJours}
            options={[...new Set([14, 21, 28, 42, s.feedback360FenetreJours])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
            disabled={!admin} onChange={v => enregistrer({ feedback360FenetreJours: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
        <Field label={t('Raw answers kept (months)')}>
          <Seg name="param-f360-conservation" label={t('Retention of the raw answers of the 360° feedback')} value={s.feedback360ConservationMois}
            options={[...new Set([2, 3, CONSERVATION_360_MAX_MOIS, s.feedback360ConservationMois])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
            disabled={!admin} onChange={v => enregistrer({ feedback360ConservationMois: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
      </div>
      <Fine>
        {t('Confidential answers: transferred in one block at the closing, without respondent nor date; returned as an average per group of at least ')}{s.feedback360Seuil}{t(' answers (never fewer than 3), comments after review by HR. Raw answers deleted at the closing of the review, and at the latest ')}{s.feedback360ConservationMois}{t(' months after sending; the synthesis stays in the report.')}
      </Fine>
      {!s.feedback360Actif && <NoteAccent>{t('360° feedback deactivated: to activate after the CSE’s opinion, the DPO’s impact assessment and informing the employees.')}</NoteAccent>}
    </Panel>
  );
}
