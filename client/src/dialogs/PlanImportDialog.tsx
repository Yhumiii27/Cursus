// Importer un plan prévisionnel de formation (CSV) : aperçu contrôlé ligne à ligne avant import. « Remplacer » ne
// supprime que les lignes prévues issues d'un import : celles issues d'une demande acceptée, d'un report ou sans origine
// connue (ancienne base) sont conservées. Un exercice clos ne s'importe plus.
import { useMemo, useState, type ChangeEvent } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import { clotureDe, exercicesProposes } from '../../../shared/rules/exercices.ts';
import { parsePlan, SAMPLE_PLAN_CSV } from '../../../shared/rules/imports.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Seg, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Lit un fichier texte en UTF-8, puis en Windows-1252 si des caractères ne sont pas décodables (export Excel). */
export function readText(file: File, onText: (text: string) => void) {
  const read = (enc: 'utf-8' | 'windows-1252') => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      if (enc === 'utf-8' && s.includes('�')) read('windows-1252');
      else onText(s);
    };
    r.readAsText(file, enc);
  };
  read('utf-8');
}

export function PlanImportDialog({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { run, closeDialog, go } = useStore();
  const { admin } = useRole();
  const [ex, setEx] = useState(exercice);
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  // Remplacement des lignes prévues : confirmé avant l'envoi (suppression définitive).
  const [confirmer, setConfirmer] = useState(false);
  const parsed = useMemo(() => parsePlan(d, texte), [d, texte]);
  const okRows = parsed.filter(r => r.ok);
  const total = okRows.reduce((n, r) => n + r.cout, 0);
  const years = [...new Set([...exercicesProposes(d.ds, d.year), exercice])].filter(y => !clotureDe(d.ds, y)).sort((a, z) => a - z);

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    readText(file, s => { setTexte(s); setFichier(file.name); });
  };

  // Lignes que « Remplacer » supprime (prévues, issues d'un import) et lignes prévues conservées (demandes, reports…).
  const prevuesEx = d.ds.plan.filter(l => l.exercice === ex && l.statut === 'prevu');
  const prevues = prevuesEx.filter(l => l.origine === 'import').length, conservees = prevuesEx.length - prevues;
  const texteErr = !texte.trim() ? t('Load a file or paste the content of the plan.')
    : !okRows.length ? t('No valid line to import: correct the file (see the preview).') : null;
  const envoyer = () => {
    if (busy || !v.verifier(texteErr)) return;
    if (mode === 'replace' && prevues > 0) setConfirmer(true);
    else confirm();
  };
  const confirm = async () => {
    setBusy(true);
    const r = await run('plan.importer', { texte, exercice: ex, mode });
    setBusy(false);
    setConfirmer(false);
    if (!r.ok) return;
    closeDialog();
    go('budget', { exercice: ex, planFilter: 'tous' });
  };

  return (
    <Dialog title={t('Import a forecast plan')} width={780} tall onSubmit={envoyer} confirmation={confirmer ? {
      texte: `${t('Replace: ')}${tn(prevues, 'imported “Planned” line', 'imported “Planned” lines')}${t(' of the financial year ')}${ex} ${t(prevues > 1 ? 'will be deleted#plural' : 'will be deleted#fem')}${t(' before the import of ')}${tn(okRows.length, 'line', 'lines')}.${conservees ? ` ${conservees > 1 ? `${t('The ')}${conservees}${t(' planned lines from accepted requests, from postponements or entered otherwise are kept')}` : t('The planned line from an accepted request, from a postponement or entered otherwise is kept')}.` : ''}${t(' Continue?')}`,
      bouton: t('Replace and import'), occupe: busy, confirmer: confirm, annuler: () => setConfirmer(false),
    } : null} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{okRows.length ? `${t('Import ')}${tn(okRows.length, 'line', 'lines')}` : t('Import')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Financial year')} htmlFor="imp-ex">
          <select className="input" id="imp-ex" value={ex} onChange={e => setEx(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label={t('Imported “Planned” lines')}>
          {/* Remplacer supprime les lignes prévues importées de l'exercice : réservé à l'administrateur RH. */}
          {admin
            ? <Seg name="impmode" label={t('Import mode')} value={mode} onChange={setMode} options={[['add', t('Complete')], ['replace', t('Replace')]]} />
            : <Static pad>{t('Complete (replace: HR administrator)')}</Static>}
        </Field>
      </div>
      {mode === 'replace' && (
        <Fine>
          {t('Replace deletes ')}{prevues === 0 ? t('the imported planned lines (none to date)') : prevues === 1 ? t('the imported planned line') : `${t('the ')}${prevues}${t(' imported planned lines')}`}{t(' of the financial year ')}{ex}
          {conservees ? ` ; ${tn(conservees, 'planned line from a request or a postponement kept', 'planned lines from requests or postponements kept')}` : ''}{t('. Committed and done lines are never deleted.')}
        </Fine>
      )}
      <Field label={t('CSV file')} htmlFor="imp-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="imp-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTexte(SAMPLE_PLAN_CSV); setFichier(`exemple-plan-${ex}.csv`); }}>{t('Load an example')}</button>
          {fichier && <span className="note-accent">{t('File loaded: ')}{fichier}</span>}
        </div>
        <span className="text-muted sub">{t('Columns: training; team; period (T1–T4); headcount; total cost — the cost is estimated from the catalogue if missing. Separator “;”, “,” or tab; the header line is detected automatically.')}</span>
      </Field>
      <Field label={t('Or paste the content')} htmlFor="imp-text" erreur={v.erreur(texteErr)}>
        <textarea className="input mono-input" id="imp-text" rows={4} value={texte} placeholder="formation;equipe;periode;effectif;cout"
          onChange={e => { setTexte(e.target.value); setFichier(''); }} />
      </Field>
      {parsed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>{t('Preview')}</h3>
            <span className="text-muted sub">
              {tn(parsed.length, 'line', 'lines')} · {tn(okRows.length, 'valid', 'valid#plural')} · {tn(parsed.length - okRows.length, 'ignored#fem', 'ignored#fem-plural')} · {fmtEur(total)}
            </span>
          </div>
          <div className="scroll-x">
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t('Training#course')}</th><th>{t('Team')}</th><th>{t('Period')}</th><th>{t('Hc.')}</th><th>{t('Cost')}</th><th>{t('Check#column')}</th></tr></thead>
              <tbody>
                {parsed.map(r => {
                  const fm = (r.f && d.fm(r.f)) || null;
                  const ctrl = r.ok ? (r.estime ? t('Estimated cost') : fm ? 'OK' : t('Outside the catalogue')) : r.errs[0];
                  const cls = r.ok ? (fm && !r.estime ? 'tag-neutral' : 'tag-outline') : 'tag-accent';
                  return (
                    <tr key={r.n} style={r.ok ? undefined : { opacity: 0.55 }}>
                      <td><div>{r.libelle || '—'}</div><div className="text-muted sub-11">{fm ? fm.nom : r.libelle ? t('Outside the catalogue') : ''}</div></td>
                      <td className="nowrap">{r.equipe || '—'}</td>
                      <td>{r.periode || '—'}</td>
                      <td className="tnum">{r.effectif > 0 ? r.effectif : '—'}</td>
                      <td className="tnum nowrap">{r.cout >= 0 ? `${fmtEur(r.cout)}${r.estime ? t(' (estimated)') : ''}` : '—'}</td>
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
