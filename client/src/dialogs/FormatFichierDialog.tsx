// Format du fichier d'import Sage (administrateur RH et gestionnaire de paie, écran Temps) : séparateur, ordre des
// colonnes, format de la période, séparateur décimal, ligne d'en-tête, ajustés par le gestionnaire de paie au modèle
// d'import de son Sage. Aperçu sur deux lignes d'exemple ; le format s'applique aux prochains téléchargements.
import { useState } from 'react';
import { COLONNES_FICHIER, controlerFormat, DECIMALES, fichierLot, FORMAT_FICHIER_DEFAUT, FORMATS_PERIODE, SEPARATEURS } from '../../../shared/rules/lots-paie.ts';
import type { ColonneFichierPaie, FormatFichierPaie } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Pre } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

const EXEMPLE = { lignes: [{ matricule: '004102', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35, HS25: 2.5 } }] };
const options = <K extends string>(r: Record<K, string>) => Object.entries(r) as [K, string][];

export function FormatFichierDialog() {
  const data = useData();
  const { run, closeDialog } = useStore();
  const actuel = data.formatFichierPaie ?? FORMAT_FICHIER_DEFAUT;
  const [f, setF] = useState<FormatFichierPaie>(actuel);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const maj = (patch: Partial<FormatFichierPaie>) => setF(x => ({ ...x, ...patch }));
  const controle = controlerFormat(f as unknown as Record<string, unknown>, actuel);
  const erreur = typeof controle === 'string' ? controle : null;
  const erreurColonnes = erreur?.startsWith('Ordre') ? erreur : null;
  const erreurDecimale = erreur && !erreurColonnes ? erreur : null;

  const enregistrer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('paie.formatFichier', { ...f });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const colonne = (i: number, c: ColonneFichierPaie) => maj({ colonnes: f.colonnes.map((x, j) => (j === i ? c : x)) });

  return (
    <Dialog title="Format du fichier d’import" width={560} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Séparateur de colonnes" htmlFor="ff-sep">
          <select className="input" id="ff-sep" value={f.separateur} onChange={e => maj({ separateur: e.target.value as FormatFichierPaie['separateur'] })}>
            {options(SEPARATEURS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Séparateur décimal" htmlFor="ff-dec" erreur={erreurDecimale}>
          <select className="input" id="ff-dec" value={f.decimale} onChange={e => maj({ decimale: e.target.value as FormatFichierPaie['decimale'] })}>
            {options(DECIMALES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Période" htmlFor="ff-per">
          <select className="input" id="ff-per" value={f.formatPeriode} onChange={e => maj({ formatPeriode: e.target.value as FormatFichierPaie['formatPeriode'] })}>
            {options(FORMATS_PERIODE).map(([k, l]) => <option key={k} value={k}>{k} ({l})</option>)}
          </select>
        </Field>
      </div>
      <Field label="Ordre des colonnes" erreur={erreurColonnes}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {f.colonnes.map((c, i) => (
            <select key={i} className="input" aria-label={`Colonne ${i + 1}`} value={c} onChange={e => colonne(i, e.target.value as ColonneFichierPaie)} style={{ width: 'auto' }}>
              {options(COLONNES_FICHIER).map(([k, l]) => <option key={k} value={k}>{i + 1}. {l}</option>)}
            </select>
          ))}
        </div>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.entete} onChange={e => maj({ entete: e.target.checked })} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
        <span>Première ligne d’en-tête (noms des colonnes)</span>
      </label>
      {!erreur && <>
        <Fine>Aperçu (deux lignes d’exemple) :</Fine>
        <Pre maxHeight={120}>{fichierLot(EXEMPLE, f).replace(/\t/g, '→')}</Pre>
      </>}
      <Fine>Une ligne par salarié, période de paie et rubrique, quantités additionnées sur la période. Réglez le format sur le modèle d’import de votre Sage ; il s’applique aux prochains téléchargements, sans changer le contenu des lots.</Fine>
    </Dialog>
  );
}
