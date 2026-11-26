// Avis d'un répondant au feedback 360° (lot 12, chantier C3, étape 3 ; `feedback360.repondre`, `feedback360.decliner`,
// questionnaire fixe et versionné : shared/rules/feedback360.ts). Une note de 1 à 4 par question (ou « je ne peux pas me
// prononcer »), un commentaire facultatif. L'avis reste modifiable tant que la collecte est ouverte : il est relu sur le
// serveur (GET /api/feedback360/reponse/:id, son auteur seul), jamais gardé sur l'appareil (ni brouillon de reconnexion,
// ni file hors ligne). Décliner efface un avis déjà donné.
import { useEffect, useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { ECHELLE_360, QUESTIONNAIRE_360, RELATION_360_UN, TEXTE_CONFIDENTIALITE_360, VERBATIM_360_MAX } from '../../../shared/rules/feedback360.ts';
import { api } from '../api.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function Avis360Dialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog, notify } = useStore();
  const s = (d.ds.feedbackSollicitations ?? []).find(y => y.id === id && y.repondantEmpId === d.ds.user.empId);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verbatim, setVerbatim] = useState('');
  const [charge, setCharge] = useState(s?.statut !== 'repondue');
  const [busy, setBusy] = useState(false);
  const [decliner, setDecliner] = useState(false);
  const v = useVerification();
  // Avis déjà donné : relu sur le serveur (jamais gardé dans l'instantané ni sur l'appareil).
  const sid = s?.id, repondue = s?.statut === 'repondue';
  useEffect(() => {
    if (sid == null || !repondue) return;
    let actif = true;
    api.reponse360(sid).then(r => {
      if (!actif) return;
      if (r.reponse) {
        setNotes(Object.fromEntries(Object.entries(r.reponse.notes).map(([k, n]) => [k, String(n)])));
        setVerbatim(r.reponse.verbatim ?? '');
      }
      setCharge(true);
    }).catch(() => { if (actif) { setCharge(true); notify(t('Your feedback could not be read again: try again'), true); } });
    return () => { actif = false; };
  }, [sid, repondue, notify]);
  if (!s) return null;
  const evalue = d.ds.annuaire.find(p => p.id === s.empId)?.nom ?? t('a colleague');
  const repondues = Object.values(notes).filter(Boolean).length;
  const notesErr = !repondues ? t('Answer at least one question, or decline the request.') : null;
  const verbatimErr = verbatim.trim().length > VERBATIM_360_MAX ? t(`${VERBATIM_360_MAX} characters at most.`) : null;

  const envoyer = async () => {
    if (busy || !charge || !v.verifier(notesErr, verbatimErr)) return;
    setBusy(true);
    const r = await run('feedback360.repondre', { id: s.id, notes: Object.fromEntries(Object.entries(notes).filter(([, n]) => n).map(([k, n]) => [k, Number(n)])), verbatim });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const confirmerRefus = async () => {
    setBusy(true);
    const r = await run('feedback360.decliner', { id: s.id });
    setBusy(false);
    if (r.ok) closeDialog();
    else setDecliner(false);
  };

  return (
    <Dialog title={`${t('Feedback requested#one')} — ${evalue}`} width={640} tall onSubmit={envoyer}
      confirmation={decliner ? {
        texte: t(s.statut === 'repondue' ? 'Decline the request? Your feedback already given will be erased.' : 'Decline the request? You will no longer be able to give feedback.'),
        bouton: t('Decline'), occupe: busy, confirmer: confirmerRefus, annuler: () => setDecliner(false),
      } : null}
      actions={<>
        <CancelButton />
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDecliner(true)}>{t('Decline')}</button>
        <SubmitButton busy={busy}>{t(s.statut === 'repondue' ? 'Save my changes' : 'Send my feedback')}</SubmitButton>
      </>}>
      <div className="text-muted sub">
        {t('You are asked as ')}{RELATION_360_UN[s.relation].toLowerCase()} · {t('answers until ')}{fmtIso(s.echeance ?? d.ti)} · {t('questionnaire ')}{QUESTIONNAIRE_360.version}
      </div>
      <Fine>{TEXTE_CONFIDENTIALITE_360}</Fine>
      {!charge ? <p className="text-muted" style={{ fontSize: 13 }}>{t('Reading your feedback…')}</p> : (<>
        <Field label={t('Behaviours observed at work')} erreur={v.erreur(notesErr)} requis>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {QUESTIONNAIRE_360.questions.map(q => (
              <fieldset key={q.cle} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <legend style={{ fontSize: 14, padding: 0, marginBottom: 'var(--space-1)' }}><strong>{q.theme}</strong> — {q.libelle}</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
                  {ECHELLE_360.map(([n, label]) => (
                    <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 13 }}>
                      <input type="radio" name={`f360-${q.cle}`} value={n} checked={notes[q.cle] === String(n)} style={{ accentColor: 'var(--color-accent)' }}
                        onChange={() => setNotes(x => ({ ...x, [q.cle]: String(n) }))} />
                      {label}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 13 }}>
                    <input type="radio" name={`f360-${q.cle}`} value="" checked={!notes[q.cle]} style={{ accentColor: 'var(--color-accent)' }}
                      onChange={() => setNotes(x => ({ ...x, [q.cle]: '' }))} />
                    {t('I cannot say')}
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
        </Field>
        <Field label={t('Comment (optional)')} htmlFor="f360-verbatim" erreur={v.erreur(verbatimErr)}>
          <textarea className="input mid" id="f360-verbatim" rows={3} value={verbatim} maxLength={VERBATIM_360_MAX} onChange={ev => setVerbatim(ev.target.value)} />
        </Field>
        <Fine>{t('Comment: facts observed at work, nothing about the person’s health, private life or opinions, and no detail that points to you. HR reads it before any feedback is shared.')}</Fine>
      </>)}
    </Dialog>
  );
}
