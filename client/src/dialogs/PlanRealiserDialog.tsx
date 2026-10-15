// Clôture d'une action engagée du plan de formation (`plan.avancer` vers « réalisé ») : coût réel (prérempli du coût
// prévu, 0 accepté) et effectif réel (prérempli de l'effectif prévu, facultatif). Le coût réel compte dans le réalisé des
// enveloppes ; l'écart au prévu s'affiche dans Plan & budget.
import { useState } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import { COUT_REEL_MAX, effectifReel, montantReel } from '../../../shared/rules/exercices.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Message sous le champ du coût réel (aussi dans la clôture d'une session, ClotureDialog). */
export function erreurCoutReel(v: string): string | null {
  if (!v.trim()) return 'Indiquez le coût réel (0 si l’action n’a rien coûté).';
  return montantReel(v) === null ? `Montant en euros, de 0 à ${fmtEur(COUT_REEL_MAX)}.` : null;
}

export function PlanRealiserDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const l = d.ds.plan.find(x => x.id === id);
  const [cout, setCout] = useState(() => (l ? String(l.cout) : ''));
  const [effectif, setEffectif] = useState(() => (l ? String(l.effectif) : ''));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!l) return null;
  const fm = l.f ? d.fm(l.f) : null;
  const coutErr = erreurCoutReel(cout);
  const effectifErr = effectif.trim() && effectifReel(effectif) === null ? 'Nombre entier de personnes, 0 ou plus.' : null;
  const montant = montantReel(cout);
  const ecart = montant === null ? 0 : montant - l.cout;

  const envoyer = async () => {
    if (busy || !v.verifier(coutErr, effectifErr)) return;
    setBusy(true);
    const r = await run('plan.avancer', { id: l.id, de: 'engage', coutReel: cout.trim().replace(',', '.'), effectifReel: effectif.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Clôturer l’action du plan" width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer l’action</SubmitButton>
    </>}>
      <Field label="Action">
        <Static>{fm ? fm.nom : l.libelle}<div className="text-muted sub">{l.equipe} · {l.periode} {l.exercice} · prévu {fmtEur(l.cout)} pour {l.effectif} pers.</div></Static>
      </Field>
      <div className="grid-2">
        <Field label="Coût réel (€)" htmlFor="pr-cout" requis erreur={v.erreur(coutErr) || (cout.trim() ? coutErr : null)}>
          <input className="input tnum" id="pr-cout" inputMode="decimal" value={cout} onChange={e => setCout(e.target.value)} autoFocus />
        </Field>
        <Field label="Effectif réel" htmlFor="pr-effectif" erreur={effectifErr}>
          <input className="input tnum" id="pr-effectif" inputMode="numeric" value={effectif} onChange={e => setEffectif(e.target.value)} />
        </Field>
      </div>
      <Fine>
        {montant !== null && ecart ? `Écart au prévu : ${ecart > 0 ? '+' : '−'}${fmtEur(Math.abs(ecart))}. ` : ''}
        L’action passe « Réalisée » : son coût réel compte dans le réalisé de l’enveloppe {l.equipe}.
      </Fine>
    </Dialog>
  );
}
