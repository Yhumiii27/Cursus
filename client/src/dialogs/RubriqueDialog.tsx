// Correspondance d'une rubrique de paie avec le plan de paie Sage (administrateur RH et gestionnaire de paie, depuis
// l'écran Temps) : code Sage, rubrique exportée ou non, code vérifié dans le plan de paie. Tant qu'une rubrique utilisée
// n'a pas de code confirmé, seule la simulation transmet (server/src/actions/temps.ts).
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { confirmationEnvoyee, erreurCodeSage, rubriquesPaie, verifieApresSaisie } from '../../../shared/rules/paie.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

const UNITE: Record<string, string> = { h: 'heures', j: 'jours', nombre: 'nombre', eur: 'euros' };

export function RubriqueDialog({ code }: { code: string }) {
  const data = useData();
  const { run, closeDialog } = useStore();
  const r = rubriquesPaie(data.rubriquesPaie).find(x => x.code === code);
  const [codeSage, setCodeSage] = useState(r?.codeSage ?? code);
  const [active, setActive] = useState(r?.active ?? true);
  const [confirme, setConfirme] = useState(!!r?.confirmee);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!r) return null;

  // Une saisie incorrecte est signalée dès la saisie ; un champ vidé, après la première tentative.
  const erreur = erreurCodeSage(codeSage);
  const change = codeSage.trim() !== r.codeSage;

  const enregistrer = async () => {
    if (busy || !v.verifier(erreur)) return;
    const confirmer = confirmationEnvoyee(r, codeSage, confirme);
    setBusy(true);
    const res = await run('paie.rubrique', { code, codeSage: codeSage.trim(), active, ...(confirmer === undefined ? {} : { confirmer }) });
    setBusy(false);
    if (res.ok) closeDialog();
  };

  return (
    <Dialog title="Rubrique de paie" width={520} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Rubrique de Cursus"><Static>{r.code} · {r.label} ({UNITE[r.unite]})</Static></Field>
      <Field label="Code dans le plan de paie Sage" htmlFor="rb-code" requis erreur={codeSage.trim() ? erreur : v.erreur(erreur)}>
        <input className="input" id="rb-code" autoFocus maxLength={20} value={codeSage} onChange={ev => {
          // Un code modifié est à vérifier de nouveau : la case se décoche (rétablie si l'on revient au code enregistré).
          setCodeSage(ev.target.value);
          setConfirme(verifieApresSaisie(r, ev.target.value));
        }} style={{ maxWidth: 240 }} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={active} onChange={ev => setActive(ev.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Exporter cette rubrique
          <span className="text-muted sub" style={{ display: 'block' }}>Décochée, elle ne part plus vers Sage (heures normales des salariés mensualisés, par exemple).</span>
        </span>
      </label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={confirme} onChange={ev => setConfirme(ev.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Code vérifié dans le plan de paie Sage
          <span className="text-muted sub" style={{ display: 'block' }}>
            {r.confirmee && !change ? `Confirmé le ${fmtIso(r.confirmeLe!)} par ${r.confirmePar}.` : 'La confirmation est datée et porte votre nom.'}
          </span>
        </span>
      </label>
      <Fine>Tant qu’une rubrique exportée et utilisée par les feuilles à transmettre n’a pas de code confirmé, seule la simulation est possible. Un code modifié sans être vérifié repasse « à confirmer ». Chaque modification est tracée dans le journal.</Fine>
    </Dialog>
  );
}
