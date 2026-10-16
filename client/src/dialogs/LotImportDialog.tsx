// Confirmation de l'import d'un lot de paie dans Sage (administrateur RH et gestionnaire de paie, écran Temps) : la
// confirmation datée et signée tient lieu d'accusé et seule marque les feuilles du lot transmises. Lot de fichier : la
// personne atteste que l'import est fait et ses totaux contrôlés, avec la référence de l'import si Sage en donne une.
// Lot de simulation : rien n'est envoyé, les feuilles sont seulement marquées transmises.
import { useState } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { erreurReference, totauxTexte } from '../../../shared/rules/lots-paie.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

export function LotImportDialog({ id }: { id: number }) {
  const data = useData();
  const { run, closeDialog } = useStore();
  const lot = data.lotsPaie.find(l => l.id === id);
  const [atteste, setAtteste] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!lot) return null;

  const simulation = lot.mode === 'simulation';
  const erreurAtteste = !simulation && !atteste ? 'Confirmez que l’import est fait dans Sage et ses totaux contrôlés.' : null;
  const erreurRef = erreurReference(reference);
  const salaries = new Set(lot.feuilles.map(f => f.empId)).size;

  const confirmer = async () => {
    if (busy || !v.verifier(erreurAtteste, erreurRef)) return;
    setBusy(true);
    const r = await run('paie.lotConfirmer', { id: lot.id, ...(reference.trim() ? { reference: reference.trim() } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={simulation ? 'Marquer le lot transmis (simulation)' : 'Confirmer l’import dans Sage'} width={540} onSubmit={confirmer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{simulation ? 'Marquer transmis' : 'Confirmer l’import'}</SubmitButton>
    </>}>
      <Field label="Lot">
        <Static>
          Lot n° {lot.id} · {periodeLabel(lot.periode)} · {plural(lot.feuilles.length, 'feuille', 'feuilles')} ({plural(salaries, 'salarié', 'salariés')}) · {plural(lot.resume.lignes, 'ligne', 'lignes')}
        </Static>
      </Field>
      {lot.resume.lignes > 0 && <Fine>Totaux du fichier : {totauxTexte(lot.resume)}.</Fine>}
      {lot.telechargeLe && <Fine>Fichier téléchargé le {fmtIso(lot.telechargeLe.slice(0, 10))} par {lot.telechargePar}{lot.telechargements > 1 ? ` (${lot.telechargements} téléchargements)` : ''}.</Fine>}
      {simulation ? (
        <Fine muted={false}>Simulation : rien n’est envoyé à Sage Paie. Les feuilles du lot sont seulement marquées transmises et ne seront plus proposées.</Fine>
      ) : (
        <Field label="Import dans Sage" requis erreur={v.erreur(erreurAtteste)}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={atteste} onChange={e => setAtteste(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
            <span>J’ai importé ce fichier dans Sage Paie et contrôlé ses totaux.</span>
          </label>
        </Field>
      )}
      <Field label="Référence de l’import dans Sage (facultative)" htmlFor="lot-reference" erreur={reference.trim() ? erreurRef : v.erreur(erreurRef)}>
        <input className="input" id="lot-reference" maxLength={40} value={reference} placeholder="Numéro du lot d’import, si Sage en donne un"
          onChange={e => setReference(e.target.value)} style={{ maxWidth: 320 }} />
      </Field>
      <Fine>
        La confirmation est datée et porte votre nom ; elle seule marque les feuilles du lot transmises à la paie. Ensuite, le lot ne
        s’annule plus : une correction se fait dans Sage, en attendant le lot correctif.
      </Fine>
    </Dialog>
  );
}
