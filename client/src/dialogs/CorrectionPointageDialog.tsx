// Badgeage virtuel (lot 12, chantier C6, étape 2) : demande de correction d'un pointage (`pointage.corriger`) — ajout d'un
// pointage oublié (jour, heure de Paris, arrivée ou départ) ou retrait d'un pointage erroné (`pointageId`). Motif tiré
// d'une liste fermée, commentaire facultatif (jamais recopié au journal). Le salarié la demande pour lui-même sous le délai
// réglé ; son valideur (manager, suppléant « feuilles », service RH) la saisit pour lui, validée d'emblée. Contrôles du
// serveur : server/src/actions/pointage.ts ; règles : shared/rules/pointage.ts.
import { useState } from 'react';
import { addD } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { normaliserHeure } from '../../../shared/rules/horaires.ts';
import { instantParis, MOTIFS_CORRECTION, refusDelaiCorrection, TEXTE_CORRECTION_MAX } from '../../../shared/rules/pointage.ts';
import type { ISODate, MotifCorrectionPointage, SensPointage } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

const SENS = (): [SensPointage, string][] => [['E', t('In')], ['S', t('Out')]];

export function CorrectionPointageDialog({ empId, nature, pointageId, jour: jourInitial, heure: heureVisee, sens: sensVise }: {
  empId: number; nature: 'ajout' | 'neutralisation'; pointageId?: number; jour?: ISODate; heure?: string; sens?: SensPointage;
}) {
  const d = useDomain();
  const { rh, me } = useRole();
  const { run, closeDialog } = useStore();
  const e = d.emp(empId);
  const soi = empId === me;
  const delai = d.ds.settings.pointageDelaiCorrectionJours;
  const [jour, setJour] = useState<string>(jourInitial ?? d.ti);
  const [heure, setHeure] = useState('');
  const [sens, setSens] = useState<SensPointage>('E');
  const [motif, setMotif] = useState<MotifCorrectionPointage | ''>('');
  const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!e) return null;

  const ajout = nature === 'ajout';
  const h = normaliserHeure(heure);
  // Délai : le salarié et son manager ; le service RH corrige sans délai (règle du serveur).
  const refusJour = ajout ? (!jour ? t('Enter the day of the missed clock-in.') : refusDelaiCorrection(jour, d.ti, delai, rh && !soi)) : null;
  const erreurHeure = ajout ? (!heure.trim() ? t('Enter the time of the missed clock-in (8:00, 17 h 30…).') : !h ? t('Invalid time: 8:00, 17 h 30…') : null) : null;
  const erreurMotif = !motif ? t('Choose the reason for the correction.') : null;
  const erreurCommentaire = commentaire.trim().length > TEXTE_CORRECTION_MAX ? t(`${TEXTE_CORRECTION_MAX} characters at most.`) : null;

  const envoyer = async () => {
    if (busy || !v.verifier(refusJour, erreurHeure, erreurMotif, erreurCommentaire)) return;
    setBusy(true);
    const base = { empId, nature, motif, commentaire: commentaire.trim() };
    const payload = ajout
      ? { ...base, horodatage: new Date(instantParis(jour, Number(h!.slice(0, 2)) * 60 + Number(h!.slice(3, 5)))).toISOString(), sens }
      : { ...base, pointageId };
    const r = await run('pointage.corriger', payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(!ajout ? 'Remove a clock-in' : soi ? 'Report a missed clock-in#dialog' : 'Add a clock-in')} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(soi ? 'Send the request' : 'Save the correction')}</SubmitButton>
    </>}>
      {!soi && <Field label={t('Employee')}><Static>{e.nom}</Static></Field>}
      {ajout ? <>
        <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Field label={t('Day')} htmlFor="cp-jour" requis erreur={v.erreur(refusJour)}>
            <input className="input" id="cp-jour" type="date" value={jour} min={rh && !soi ? undefined : addD(d.ti, -delai)} max={d.ti} onChange={x => setJour(x.target.value)} style={{ maxWidth: 200 }} />
          </Field>
          <Field label={t('Time')} htmlFor="cp-heure" requis erreur={v.erreur(erreurHeure)}>
            <input className="input tnum" id="cp-heure" type="text" inputMode="numeric" autoFocus value={heure} maxLength={8} placeholder="08:00" onChange={x => setHeure(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
        </div>
        <Field label={t('Direction')}>
          <Seg name="cp-sens" label={t('Clock-in direction')} value={sens} options={SENS()} onChange={setSens} />
        </Field>
      </> : (
        <Field label={t('Clock-in to remove')}><Static>{jourInitial ? fmtIso(jourInitial) : ''}{heureVisee ? `${t(' at ')}${heureVisee}` : ''}{sensVise ? ` · ${sensVise === 'S' ? t('out') : t('in')}` : ''}</Static></Field>
      )}
      <Field label={t('Reason')} htmlFor="cp-motif" requis erreur={v.erreur(erreurMotif)}>
        <select className="input" id="cp-motif" value={motif} onChange={x => setMotif(x.target.value as MotifCorrectionPointage | '')}>
          <option value="">{t('Choose…')}</option>
          {Object.entries(MOTIFS_CORRECTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label={t('Comment (optional)')} htmlFor="cp-commentaire" erreur={erreurCommentaire}>
        <textarea className="input" id="cp-commentaire" rows={2} value={commentaire} maxLength={TEXTE_CORRECTION_MAX + 50} onChange={x => setCommentaire(x.target.value)}
          placeholder={t('Phone badge not charged on arrival…')} />
      </Field>
      <Fine>
        {soi
          ? `${t(`Request approved by your manager (or their deputy) or by HR, within ${delai} days of the clock-in.`)} `
          : `${t('Entered by you, the correction is approved at once; the employee sees where it comes from.')} `}
        {t('The comment is never copied to the log: do not put any medical information in it. A week whose timesheet is approved is corrected after it is reopened.')}
      </Fine>
    </Dialog>
  );
}
