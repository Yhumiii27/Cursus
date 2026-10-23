// Écran Formations, Passeport de prévention (lot 7, t066 ; shared/rules/passeport-prevention.ts) : lignes exportées puis
// déclarées sur la plateforme, notées « déclarées » tel jour. Elles ne sont plus proposées à l'export ; une marque posée
// par erreur se retire ligne par ligne. Le jour se contrôle comme sur le serveur (ni à venir, ni avant la formation).
import { useState } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { erreurDateDeclaration, lignesPasseport, MENTION_PASSEPORT } from '../../../shared/rules/passeport-prevention.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function PasseportDeclarerDialog({ cles, du, au }: { cles: string[]; du: string; au: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  // Lignes encore à déclarer parmi celles choisies à l'ouverture (une autre personne a pu en marquer entre-temps).
  const [lignes] = useState(() => {
    const voulues = new Set(cles);
    return lignesPasseport(d, { du, au }).filter(l => voulues.has(l.cle));
  });
  const [le, setLe] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const derniere = lignes.reduce((m, l) => (l.au > m ? l.au : m), '');
  const erreur = erreurDateDeclaration(le, d.ti) ?? (le && derniere && le < derniere ? `Une formation se termine le ${fmtIso(derniere)} : la déclaration ne peut pas la précéder.` : null);
  const salaries = new Set(lignes.map(l => l.empId)).size;

  const envoyer = async () => {
    if (busy || !v.verifier(erreur, !lignes.length)) return;
    setBusy(true);
    const r = await run('passeport.declarer', { cles: lignes.map(l => l.cle), le });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Lignes déclarées au Passeport de prévention" width={560} onSubmit={envoyer}
      actions={!lignes.length ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>Marquer déclarées</SubmitButton>
      </>}>
      {!lignes.length ? <Bloquant>Plus aucune de ces lignes n’est à déclarer : elles ont été marquées entre-temps.</Bloquant> : <>
        <p style={{ margin: 0 }}>
          {plural(lignes.length, 'ligne', 'lignes')} ({plural(salaries, 'salarié', 'salariés')}) du {fmtIso(du)} au {fmtIso(au)}, à noter
          déclarées sur la plateforme : elles ne seront plus proposées à l’export.
        </p>
        <Field label="Déclarées sur la plateforme le" htmlFor="passeport-le" requis erreur={le ? erreur : v.erreur(erreur)}>
          <input className="input" id="passeport-le" type="date" value={le} max={d.ti} onChange={e => setLe(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        <Fine>
          À marquer une fois l’import accepté par la plateforme. {MENTION_PASSEPORT} : vérifiez le fichier avant l’envoi. Une marque posée par
          erreur se retire ligne par ligne (« Déjà déclarées » dans l’écran Formations).
        </Fine>
      </>}
    </Dialog>
  );
}
