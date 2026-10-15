// Clôture d'un exercice du plan de formation (`plan.cloturerExercice`, administrateur RH) : le plan et les enveloppes de
// l'exercice passent en lecture seule. Les actions prévues ou engagées se cochent pour être reportées sur l'exercice
// suivant (engagées cochées d'office, prévues non) : le report est proposé, jamais imposé. Les réalisées restent.
// La clôture est définitive : une confirmation remplace les boutons avant l'envoi.
import { useState } from 'react';
import { PLAN_CLS, PLAN_LABEL } from '../../../shared/constants.ts';
import { fmtEur, plural } from '../../../shared/format.ts';
import { clotureDe, controleCloture, reportables } from '../../../shared/rules/exercices.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
  const suivantClos = coches.size > 0 && !!clotureDe(d.ds, exercice + 1) ? `L’exercice ${exercice + 1} est clos : décochez les actions à reporter.` : null;
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
    <Dialog title={`Clôturer l’exercice ${exercice}`} width={720} tall onSubmit={envoyer} confirmation={confirmer ? {
      texte: `Clôturer l’exercice ${exercice}${coches.size ? ` et reporter ${plural(coches.size, 'action', 'actions')} sur ${exercice + 1}` : ''} ? Le plan et les enveloppes ${exercice} ne seront plus modifiables ; la clôture est définitive.`,
      bouton: 'Clôturer l’exercice', occupe: busy, confirmer: cloturer, annuler: () => setConfirmer(false),
    } : null} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer l’exercice</SubmitButton>
    </>}>
      <Fine>
        {plural(realisees, 'action réalisée reste', 'actions réalisées restent')} dans l’exercice {exercice}. Cochez les actions prévues ou engagées à reporter
        sur {exercice + 1} : elles y sont recréées au premier trimestre, au même coût prévu et au même statut (les sessions ouvertes les suivent), et
        apparaissent « Reportées » dans {exercice}. Les autres restent dans {exercice}, telles quelles.
      </Fine>
      <Field label={`Actions à reporter sur ${exercice + 1}`}>
        {actions.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {actions.map(l => {
              const fm = l.f ? d.fm(l.f) : null;
              return (
                <label key={l.id} className="boxed" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={coches.has(l.id)} onChange={e => basculer(l.id, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 14 }}>{fm ? fm.nom : l.libelle}</span>
                    <span className="text-muted sub" style={{ display: 'block' }}>{l.equipe} · {l.periode} · {l.effectif} pers. · {fmtEur(l.cout)}</span>
                  </span>
                  <Tag cls={PLAN_CLS[l.statut]} style={{ flex: 'none' }}>{PLAN_LABEL[l.statut]}</Tag>
                </label>
              );
            })}
          </div>
        ) : <Empty pad="sm">Aucune action prévue ou engagée : rien à reporter.</Empty>}
      </Field>
      {refus && <Bloquant>{refus}.</Bloquant>}
      {suivantClos && <Bloquant>{suivantClos}</Bloquant>}
      {actions.length > 0 && <Fine>{plural(coches.size, 'action reportée', 'actions reportées')} · {plural(laissees, 'action laissée', 'actions laissées')} dans {exercice}.</Fine>}
    </Dialog>
  );
}
