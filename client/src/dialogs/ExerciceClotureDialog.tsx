// Clôture d'un exercice du plan de formation (`plan.cloturerExercice`, administrateur RH) : le plan et les enveloppes de
// l'exercice passent en lecture seule. Les actions prévues ou engagées se cochent pour être reportées sur l'exercice
// suivant (engagées cochées d'office, prévues non) : le report est proposé, jamais imposé. Les réalisées restent.
// La clôture est définitive : une confirmation remplace les boutons avant l'envoi.
import { useState } from 'react';
import { PLAN_CLS, PLAN_LABEL } from '../../../shared/constants.ts';
import { fmtEur } from '../../../shared/format.ts';
import { clotureDe, controleCloture, reportables } from '../../../shared/rules/exercices.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function ExerciceClotureDialog({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const actions = reportables(d.ds, exercice);
  const [coches, setCoches] = useState<Set<number>>(() => new Set(actions.filter(l => l.statut === 'engage').map(l => l.id)));
  const [confirmer, setConfirmer] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const refus = controleCloture(d.ds, exercice, d.year);
  // Report vers un exercice suivant déjà clos : impossible (il ne se modifie plus).
  const suivantClos = coches.size > 0 && !!clotureDe(d.ds, exercice + 1) ? `${t('The financial year ')}${exercice + 1}${t(' is closed: untick the actions to postpone.')}` : null;
  const realisees = d.ds.plan.filter(l => l.exercice === exercice && l.statut === 'realise').length;
  const basculer = (id: number, oui: boolean) => setCoches(s => { const n = new Set(s); if (oui) n.add(id); else n.delete(id); return n; });

  const envoyer = () => {
    if (busy || !v.verifier(refus, suivantClos)) return;
    setConfirmer(true);
  };
  const cloturer = async () => {
    setBusy(true);
    const r = await run('plan.cloturerExercice', { exercice, reporter: [...coches] });
    setBusy(false);
    setConfirmer(false);
    if (!r.ok) return;
    closeDialog();
    setUi({ planFilter: 'tous' });
  };
  const laissees = actions.length - coches.size;

  return (
    <Dialog title={`${t('Close the financial year ')}${exercice}`} width={720} tall onSubmit={envoyer} confirmation={confirmer ? {
      texte: `${t('Close the financial year ')}${exercice}${coches.size ? `${t(' and postpone ')}${tn(coches.size, 'action', 'actions')}${t(' to#year-after')}${exercice + 1}` : ''}${t('? The plan and the envelopes ')}${exercice}${t(' will no longer be editable; the closing is final.')}`,
      bouton: t('Close the financial year'), occupe: busy, confirmer: cloturer, annuler: () => setConfirmer(false),
    } : null} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Close the financial year')}</SubmitButton>
    </>}>
      <Fine>
        {tn(realisees, 'action done stays', 'actions done stay')}{t(' in the financial year ')}{exercice}{t('. Tick the planned or committed actions to postpone to ')}{exercice + 1}{t(': they are created again there in the first quarter, at the same planned cost and with the same status (the open sessions follow them), and appear “Postponed” in ')}{exercice}{t('. The others stay in ')}{exercice}{t(', as they are.')}
      </Fine>
      <Field label={`${t('Actions to postpone to ')}${exercice + 1}`}>
        {actions.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {actions.map(l => {
              const fm = l.f ? d.fm(l.f) : null;
              return (
                <label key={l.id} className="boxed" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={coches.has(l.id)} onChange={e => basculer(l.id, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 14 }}>{fm ? fm.nom : l.libelle}</span>
                    <span className="text-muted sub" style={{ display: 'block' }}>{l.equipe} · {l.periode} · {l.effectif}{t(' pers.')} · {fmtEur(l.cout)}</span>
                  </span>
                  <Tag cls={PLAN_CLS[l.statut]} style={{ flex: 'none' }}>{PLAN_LABEL[l.statut]}</Tag>
                </label>
              );
            })}
          </div>
        ) : <Empty pad="sm">{t('No planned or committed action: nothing to postpone.')}</Empty>}
      </Field>
      {refus && <Bloquant>{refus}.</Bloquant>}
      {suivantClos && <Bloquant>{suivantClos}</Bloquant>}
      {actions.length > 0 && <Fine>{tn(coches.size, 'action postponed', 'actions postponed')} · {tn(laissees, 'action left', 'actions left')}{t(' in#year')}{exercice}.</Fine>}
    </Dialog>
  );
}
