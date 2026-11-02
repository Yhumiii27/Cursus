// Évaluation d'un objectif de la période précédente à l'entretien annuel suivant, tant qu'il est planifié (lot 12,
// chantier C3 ; `objectif.evaluer`) : atteint, partiellement, non atteint, devenu sans objet (motif exigé) ou reconduit
// (nouvelle ligne fixée à cet entretien, échéance nouvelle facultative). Modifiable jusqu'à la clôture : une reconduction
// défaite retire sa ligne. Le commentaire de l'évaluateur figure au compte rendu, jamais au journal.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { EVALUATION_MAX, estStatutEvaluation, STATUT_OBJECTIF_LABEL, STATUTS_EVALUATION, type StatutEvaluation } from '../../../shared/rules/objectifs.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ObjectifEvaluerDialog({ id, entretienId, retour }: { id: number; entretienId: number; retour?: number }) {
  const d = useDomain();
  const { run, openDialog, closeDialog } = useStore();
  const o = (d.ds.objectifs ?? []).find(y => y.id === id);
  const x = d.ds.entretiens.find(y => y.id === entretienId);
  const fixe = o ? d.ds.entretiens.find(y => y.id === o.entretienId) : undefined;
  const [statut, setStatut] = useState<StatutEvaluation | ''>(o && estStatutEvaluation(o.statut) ? o.statut : '');
  const [evaluation, setEvaluation] = useState(o?.evaluation ?? '');
  const [echeance, setEcheance] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const e = o ? d.emp(o.empId) : undefined;
  if (!o || !x || !e) return null;
  const statutErr = statut ? null : 'Choisissez le résultat.';
  const evaluationErr = evaluation.trim().length > EVALUATION_MAX ? `${EVALUATION_MAX} caractères au plus.`
    : statut === 'sans_objet' && !evaluation.trim() ? 'Objectif devenu sans objet : indiquez pourquoi.' : null;
  const echeanceErr = statut === 'reconduit' && echeance ? erreurDate(echeance, '') : null;
  const revenir = () => (retour ? openDialog({ type: 'ent', entId: retour }) : closeDialog());

  const envoyer = async () => {
    if (busy || !v.verifier(statutErr, evaluationErr, echeanceErr)) return;
    setBusy(true);
    const r = await run('objectif.evaluer', { id: o.id, entretienId: x.id, statut, evaluation, ...(statut === 'reconduit' && echeance ? { echeance } : {}) });
    setBusy(false);
    if (r.ok) revenir();
  };

  return (
    <Dialog title={`Évaluer l’objectif — ${e.nom}`} width={560} onSubmit={envoyer} fermer={retour ? revenir : undefined} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer l’évaluation</SubmitButton>
    </>}>
      <Field label="Objectif">
        <Static>
          {o.libelle}
          <div className="text-muted sub">
            {fixe ? `Fixé à l’entretien du ${fmtIso(fixe.date)}` : 'Fixé à un entretien précédent'}{o.echeance ? ` · échéance le ${fmtIso(o.echeance)}` : ''} · avancement {o.avancement} %
          </div>
          {o.mesure && <div className="text-muted sub">Mesure : {o.mesure}</div>}
          {o.commentaireSal && <div className="text-muted sub">Commentaire du salarié : {o.commentaireSal}</div>}
        </Static>
      </Field>
      <Field label="Résultat" requis erreur={v.erreur(statutErr)}>
        <div role="radiogroup" aria-label="Résultat de l’objectif" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {STATUTS_EVALUATION.map(s => (
            <label key={s} className="boxed" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" name="obj-statut" value={s} checked={statut === s} onChange={() => setStatut(s)} style={{ accentColor: 'var(--color-accent)' }} />
              {STATUT_OBJECTIF_LABEL[s]}
            </label>
          ))}
        </div>
      </Field>
      <Field label={statut === 'sans_objet' ? 'Pourquoi l’objectif est devenu sans objet' : 'Commentaire de l’évaluateur (facultatif)'} htmlFor="obj-evaluation"
        requis={statut === 'sans_objet'} erreur={v.erreur(evaluationErr)}>
        <textarea className="input mid" id="obj-evaluation" rows={3} value={evaluation} maxLength={EVALUATION_MAX} onChange={ev => setEvaluation(ev.target.value)} />
      </Field>
      {statut === 'reconduit' && (
        <Field label="Nouvelle échéance (facultatif)" htmlFor="obj-reconduit" erreur={v.erreur(echeanceErr)}>
          <input className="input" id="obj-reconduit" type="date" min={d.ti} value={echeance} onChange={ev => setEcheance(ev.target.value)} />
        </Field>
      )}
      <Fine>
        {statut === 'reconduit'
          ? 'Reconduit : l’objectif est repris tel quel dans cet entretien, avec la nouvelle échéance ; modifiez-le ensuite si besoin.'
          : 'L’évaluation reste modifiable jusqu’à la clôture de l’entretien ; elle figure au compte rendu, que le salarié signe.'}
      </Fine>
    </Dialog>
  );
}
