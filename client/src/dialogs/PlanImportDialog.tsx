// Importer un plan prévisionnel de formation (CSV) : aperçu contrôlé ligne à ligne avant import.
import { useMemo, useState, type ChangeEvent } from 'react';
import { fmtEur, plural } from '../../../shared/format.ts';
import { parsePlan, SAMPLE_PLAN_CSV } from '../../../shared/rules/imports.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Seg, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Lit un fichier texte en UTF-8, puis en Windows-1252 si des caractères ne sont pas décodables (export Excel). */
function readText(file: File, onText: (text: string) => void) {
  const read = (enc: 'utf-8' | 'windows-1252') => {
    const r = new FileReader();
    r.onload = () => {
      const t = String(r.result || '');
      if (enc === 'utf-8' && t.includes('�')) read('windows-1252');
      else onText(t);
    };
    r.readAsText(file, enc);
  };
  read('utf-8');
}

export function PlanImportDialog({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { run, closeDialog, go } = useStore();
  const [ex, setEx] = useState(exercice);
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parsePlan(d, texte), [d, texte]);
  const okRows = parsed.filter(r => r.ok);
  const total = okRows.reduce((n, r) => n + r.cout, 0);
  const years = [...new Set([d.year, d.year + 1, exercice])].sort((a, z) => a - z);

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    readText(file, t => { setTexte(t); setFichier(file.name); });
  };

  const confirm = async () => {
    setBusy(true);
    const r = await run('plan.importer', { texte, exercice: ex, mode });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    go('budget', { exercice: ex, planFilter: 'tous' });
  };

  return (
    <Dialog title="Importer un plan prévisionnel" width={780} tall actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!okRows.length || busy} onClick={confirm}>
        {okRows.length ? `Importer ${plural(okRows.length, 'ligne', 'lignes')}` : 'Importer'}
      </button>
    </>}>
      <div className="grid-2">
        <Field label="Exercice" htmlFor="imp-ex">
          <select className="input" id="imp-ex" value={ex} onChange={e => setEx(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Lignes « Prévues » existantes">
          <Seg name="impmode" label="Mode d’import" value={mode} onChange={setMode} options={[['add', 'Compléter'], ['replace', 'Remplacer']]} />
        </Field>
      </div>
      <Field label="Fichier CSV" htmlFor="imp-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="imp-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTexte(SAMPLE_PLAN_CSV); setFichier(`exemple-plan-${ex}.csv`); }}>Charger un exemple</button>
          {fichier && <span className="note-accent">Fichier chargé : {fichier}</span>}
        </div>
        <span className="text-muted sub">Colonnes : formation ; équipe ; période (T1–T4) ; effectif ; coût total — le coût est estimé depuis le catalogue s’il manque. Séparateur « ; », « , » ou tabulation ; la ligne d’en-tête est détectée automatiquement.</span>
      </Field>
      <Field label="Ou coller le contenu" htmlFor="imp-text">
        <textarea className="input mono-input" id="imp-text" rows={4} value={texte} placeholder="formation;equipe;periode;effectif;cout"
          onChange={e => { setTexte(e.target.value); setFichier(''); }} />
      </Field>
      {parsed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>Aperçu</h3>
            <span className="text-muted sub">
              {plural(parsed.length, 'ligne', 'lignes')} · {plural(okRows.length, 'valide', 'valides')} · {plural(parsed.length - okRows.length, 'ignorée', 'ignorées')} · {fmtEur(total)}
            </span>
          </div>
          <div className="scroll-x">
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>Formation</th><th>Équipe</th><th>Période</th><th>Eff.</th><th>Coût</th><th>Contrôle</th></tr></thead>
              <tbody>
                {parsed.map(r => {
                  const fm = (r.f && d.fm(r.f)) || null;
                  const ctrl = r.ok ? (r.estime ? 'Coût estimé' : fm ? 'OK' : 'Hors catalogue') : r.errs[0];
                  const cls = r.ok ? (fm && !r.estime ? 'tag-neutral' : 'tag-outline') : 'tag-accent';
                  return (
                    <tr key={r.n} style={r.ok ? undefined : { opacity: 0.55 }}>
                      <td><div>{r.libelle || '—'}</div><div className="text-muted sub-11">{fm ? fm.nom : r.libelle ? 'Hors catalogue' : ''}</div></td>
                      <td className="nowrap">{r.equipe || '—'}</td>
                      <td>{r.periode || '—'}</td>
                      <td className="tnum">{r.effectif > 0 ? r.effectif : '—'}</td>
                      <td className="tnum nowrap">{r.cout >= 0 ? `${fmtEur(r.cout)}${r.estime ? ' (estimé)' : ''}` : '—'}</td>
                      <td><Tag cls={cls}>{ctrl}</Tag></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}
