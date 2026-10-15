// Importer un plan prévisionnel de formation (CSV) : aperçu contrôlé ligne à ligne avant import. « Remplacer » ne
// supprime que les lignes prévues issues d'un import : celles issues d'une demande acceptée, d'un report ou sans origine
// connue (ancienne base) sont conservées. Un exercice clos ne s'importe plus.
import { useMemo, useState, type ChangeEvent } from 'react';
import { fmtEur, plural } from '../../../shared/format.ts';
import { clotureDe, exercicesProposes } from '../../../shared/rules/exercices.ts';
import { parsePlan, SAMPLE_PLAN_CSV } from '../../../shared/rules/imports.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Seg, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
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
    readText(file, t => { setTexte(t); setFichier(file.name); });
  };

  // Lignes que « Remplacer » supprime (prévues, issues d'un import) et lignes prévues conservées (demandes, reports…).
  const prevuesEx = d.ds.plan.filter(l => l.exercice === ex && l.statut === 'prevu');
  const prevues = prevuesEx.filter(l => l.origine === 'import').length, conservees = prevuesEx.length - prevues;
  const texteErr = !texte.trim() ? 'Chargez un fichier ou collez le contenu du plan.'
    : !okRows.length ? 'Aucune ligne valide à importer : corrigez le fichier (voir l’aperçu).' : null;
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
    <Dialog title="Importer un plan prévisionnel" width={780} tall onSubmit={envoyer} confirmation={confirmer ? {
      texte: `Remplacer : ${plural(prevues, 'ligne « Prévue » importée', 'lignes « Prévues » importées')} de l’exercice ${ex} ${prevues > 1 ? 'seront supprimées' : 'sera supprimée'} avant l’import de ${plural(okRows.length, 'ligne', 'lignes')}.${conservees ? ` ${conservees > 1 ? `Les ${conservees} lignes prévues issues de demandes acceptées, de reports ou saisies autrement sont conservées` : 'La ligne prévue issue d’une demande acceptée, d’un report ou saisie autrement est conservée'}.` : ''} Continuer ?`,
      bouton: 'Remplacer et importer', occupe: busy, confirmer: confirm, annuler: () => setConfirmer(false),
    } : null} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{okRows.length ? `Importer ${plural(okRows.length, 'ligne', 'lignes')}` : 'Importer'}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Exercice" htmlFor="imp-ex">
          <select className="input" id="imp-ex" value={ex} onChange={e => setEx(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Lignes « Prévues » importées">
          {/* Remplacer supprime les lignes prévues importées de l'exercice : réservé à l'administrateur RH. */}
          {admin
            ? <Seg name="impmode" label="Mode d’import" value={mode} onChange={setMode} options={[['add', 'Compléter'], ['replace', 'Remplacer']]} />
            : <Static pad>Compléter (remplacer : administrateur RH)</Static>}
        </Field>
      </div>
      {mode === 'replace' && (
        <Fine>
          Remplacer supprime {prevues === 0 ? 'les lignes prévues importées (aucune à ce jour)' : prevues === 1 ? 'la ligne prévue importée' : `les ${prevues} lignes prévues importées`} de l’exercice {ex}
          {conservees ? ` ; ${plural(conservees, 'ligne prévue issue d’une demande ou d’un report conservée', 'lignes prévues issues de demandes ou de reports conservées')}` : ''}. Les lignes engagées et réalisées ne sont jamais supprimées.
        </Fine>
      )}
      <Field label="Fichier CSV" htmlFor="imp-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="imp-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTexte(SAMPLE_PLAN_CSV); setFichier(`exemple-plan-${ex}.csv`); }}>Charger un exemple</button>
          {fichier && <span className="note-accent">Fichier chargé : {fichier}</span>}
        </div>
        <span className="text-muted sub">Colonnes : formation ; équipe ; période (T1–T4) ; effectif ; coût total — le coût est estimé depuis le catalogue s’il manque. Séparateur « ; », « , » ou tabulation ; la ligne d’en-tête est détectée automatiquement.</span>
      </Field>
      <Field label="Ou coller le contenu" htmlFor="imp-text" erreur={v.erreur(texteErr)}>
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
