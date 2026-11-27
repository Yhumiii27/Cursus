// Renouvellement d'un CDD (service RH, t053) : nouveau terme, date de signature de l'avenant et sa référence. Le
// renouvellement s'inscrit dans l'historique des contrats ; la fiche garde le terme initial. Durée maximale et nombre de
// renouvellements (shared/rules/cdd.ts) sont rappelés avant l'envoi, sans bloquer : le serveur répète les mêmes avertissements.
import { useState } from 'react';
import { addD, isValidDate } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controleCdd, dureeMaxCdd, estMotifRecours, MOTIFS_RECOURS, renouvellementsMax } from '../../../shared/rules/cdd.ts';
import { renouvellementsDe } from '../../../shared/rules/historique-contrat.ts';
import { erreurDate } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Référence d'un avenant : 60 caractères au plus (contrôlé aussi par le serveur). */
const REFERENCE_MAX = 60;

export function RenouvelerCddDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const [jusquau, setJusquau] = useState('');
  const [signeLe, setSigneLe] = useState(d.ti);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh || emp.typeContrat !== 'cdd' || !emp.fin) return null;

  const fin = emp.fin, s = d.ds.settings;
  const deja = renouvellementsDe(d, emp.id);
  const motif = estMotifRecours(emp.motifRecours) ? emp.motifRecours : null;
  const errJusquau = erreurDate(jusquau, t('Enter the new term of the contract.')) ?? (jusquau <= fin ? `${t('New term after the current end, from ')}${fmtIso(addD(fin, 1))}.` : null);
  const errSigne = erreurDate(signeLe, t('Enter the signature date of the amendment.')) ?? (signeLe > d.ti ? t('Future signature date: record the renewal once the amendment is signed.') : null);
  const errRef = reference.trim().length > REFERENCE_MAX ? t(`${REFERENCE_MAX} characters at most.`) : null;
  // Avertissements du serveur, calculés sur la saisie : durée maximale, renouvellements admis.
  const avert = isValidDate(jusquau) && jusquau > fin
    ? controleCdd({ ...emp, fin: jusquau, cddFinInitiale: emp.cddFinInitiale ?? fin }, { renouvellements: deja.length + 1, reglages: s }).warnings : [];
  const max = motif ? dureeMaxCdd(motif, s) : null, nMax = renouvellementsMax(motif, s);

  const confirm = async () => {
    if (busy || !v.verifier(errJusquau, errSigne, errRef)) return;
    setBusy(true);
    const r = await run('employe.renouvelerCdd', { id: emp.id, jusquau, signeLe, reference: reference.trim() || null });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Renew the fixed-term contract')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Renew')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
        <Field label={t('Current end of the contract')}>
          <Static>{fmtIso(fin)}<div className="text-muted sub">{t('Started on ')}{fmtIso(emp.entree)}{emp.cddFinInitiale && emp.cddFinInitiale !== fin ? `${t(' · initial term on ')}${fmtIso(emp.cddFinInitiale)}` : ''}</div></Static>
        </Field>
      </div>
      <div className="boxed text-muted sub">
        {motif ? MOTIFS_RECOURS[motif].label : t('Reason for use not entered (sheet)')} · {deja.length ? tn(deja.length, 'renewal already recorded', 'renewals already recorded') : t('no renewal recorded')}
        {` · ${tn(nMax.n, 'renewal allowed', 'renewals allowed')} (${nMax.texte})`}{max ? `${t(' · maximum duration ')}${max.texte}` : ''}
      </div>
      <div className="grid-2">
        <Field label={t('New term')} htmlFor="rc-jusquau" requis erreur={v.erreur(errJusquau)}>
          <input className="input" id="rc-jusquau" type="date" min={addD(fin, 1)} value={jusquau} onChange={ev => setJusquau(ev.target.value)} />
        </Field>
        <Field label={t('Amendment signed on')} htmlFor="rc-signe" requis erreur={v.erreur(errSigne)}>
          <input className="input" id="rc-signe" type="date" min={emp.entree} max={d.ti} value={signeLe} onChange={ev => setSigneLe(ev.target.value)} />
        </Field>
      </div>
      <Field label={<>{t('Reference of the amendment')} <span className="who">{t('· optional')}</span></>} htmlFor="rc-ref" erreur={v.erreur(errRef)}>
        <input className="input" id="rc-ref" type="text" maxLength={REFERENCE_MAX + 20} placeholder={t('Amendment no. 2 of …')} value={reference} onChange={ev => setReference(ev.target.value)} />
        <span className="text-muted sub">{t('Kept in the contract history (HR, payroll); never copied into the log')}</span>
      </Field>
      {avert.map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
      <Fine>
        {t('The renewal is offered to the employee before the term of the contract and takes the form of a written amendment (art. L1243-13). The end of the contract becomes the new term: “End of fixed-term contract” due date, departure and pay period follow it. Nothing is blocked: check the contract and the industry agreement.')}
      </Fine>
    </Dialog>
  );
}
