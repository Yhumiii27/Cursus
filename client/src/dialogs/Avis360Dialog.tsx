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
    }).catch(() => { if (actif) { setCharge(true); notify('Votre avis n’a pas pu être relu : réessayez', true); } });
    return () => { actif = false; };
  }, [sid, repondue, notify]);
  if (!s) return null;
  const evalue = d.ds.annuaire.find(p => p.id === s.empId)?.nom ?? 'un collègue';
  const repondues = Object.values(notes).filter(Boolean).length;
  const notesErr = !repondues ? 'Répondez à au moins une question, ou déclinez la sollicitation.' : null;
  const verbatimErr = verbatim.trim().length > VERBATIM_360_MAX ? `${VERBATIM_360_MAX} caractères au plus.` : null;

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
    <Dialog title={`Avis demandé — ${evalue}`} width={640} tall onSubmit={envoyer}
      confirmation={decliner ? {
        texte: s.statut === 'repondue' ? 'Décliner la sollicitation ? Votre avis déjà donné sera effacé.' : 'Décliner la sollicitation ? Vous ne pourrez plus donner d’avis.',
        bouton: 'Décliner', occupe: busy, confirmer: confirmerRefus, annuler: () => setDecliner(false),
      } : null}
      actions={<>
        <CancelButton />
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDecliner(true)}>Décliner</button>
        <SubmitButton busy={busy}>{s.statut === 'repondue' ? 'Enregistrer mes modifications' : 'Envoyer mon avis'}</SubmitButton>
      </>}>
      <div className="text-muted sub">
        Vous êtes sollicité comme {RELATION_360_UN[s.relation].toLowerCase()} · réponses jusqu’au {fmtIso(s.echeance ?? d.ti)} · questionnaire {QUESTIONNAIRE_360.version}
      </div>
      <Fine>{TEXTE_CONFIDENTIALITE_360}</Fine>
      {!charge ? <p className="text-muted" style={{ fontSize: 13 }}>Lecture de votre avis…</p> : (<>
        <Field label="Comportements observés au travail" erreur={v.erreur(notesErr)} requis>
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
                    Je ne peux pas me prononcer
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
        </Field>
        <Field label="Commentaire (facultatif)" htmlFor="f360-verbatim" erreur={v.erreur(verbatimErr)}>
          <textarea className="input mid" id="f360-verbatim" rows={3} value={verbatim} maxLength={VERBATIM_360_MAX} onChange={ev => setVerbatim(ev.target.value)} />
        </Field>
        <Fine>Commentaire : des faits observés au travail, sans rien sur la santé, la vie personnelle ou les opinions de la personne, et sans détail qui vous désigne. Le service RH le relit avant toute restitution.</Fine>
      </>)}
    </Dialog>
  );
}
