// lot 12 — C4 (organismes de formation et e-learning) : import d'un fichier d'avancement exporté d'une plateforme
// d'e-learning (CSV, droit « formations »). Colonnes fermées : matricule ou e-mail professionnel, code du module, statut,
// avancement, date de fin, réussite ; toute autre colonne (temps de connexion, journal d'activité, score détaillé) fait
// refuser le fichier entier. Aperçu ligne à ligne (même règle que le serveur, shared/rules/elearning.ts), puis lignes
// valides appliquées ; une valeur identique ne change rien. Fin d'office seulement si le réglage l'admet, pour un module
// sans attestation exigée, une ligne « terminé » et « réussi » ; sinon la fin attend la validation du service RH.
import { useMemo, useState, type ChangeEvent } from 'react';
import { COLONNES_IMPORT_ELEARNING, effetImport, finAutomatique, lireImportElearning } from '../../../shared/rules/elearning.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Exemple affiché (« Charger un exemple ») : colonnes admises seulement. */
const EXEMPLE = 'matricule;module;statut;avancement;date de fin;reussite\n';

export function ElearningImportDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const auto = !!d.ds.settings.elearningFinAutoImport;

  const lu = useMemo(() => (texte.trim() ? lireImportElearning(texte, { ...d.ds, employes: d.ds.employes }, d.ti) : null), [d, texte]);
  const lignes = lu && 'lignes' in lu ? lu.lignes : [];
  const ins = d.ds.inscriptionsElearning ?? [], modules = d.ds.modulesElearning ?? [];
  // Effet de chaque ligne valide : mise à jour, inchangée, fin d'office.
  const effets = lignes.map(l => {
    if (l.errs.length) return null;
    const i = ins.find(x => x.id === l.inscriptionId);
    const m = modules.find(x => x.id === l.moduleId);
    if (!i || !m) return null;
    const fin = finAutomatique(auto, m, l);
    return fin ? 'fin' : effetImport(l, i, d.ti) ? 'maj' : 'inchangee';
  });
  const valides = effets.filter(Boolean).length;

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const read = (enc: string) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        if (enc === 'utf-8' && s.includes('�')) read('windows-1252');
        else { setTexte(s); setFichier(file.name); }
      };
      fr.readAsText(file, enc);
    };
    read('utf-8');
  };
  // Exemple : les inscriptions ouvertes de la liste reçue, sans rien inventer.
  const exemple = () => {
    const ouvertes = ins.filter(i => !i.annuleLe && (i.statut === 'inscrit' || i.statut === 'en_cours')).slice(0, 3);
    const corps = ouvertes.map((i, n) => {
      const e = d.emp(i.empId), m = modules.find(x => x.id === i.moduleId);
      return `${e?.matriculePaie || `EMP-${String(i.empId).padStart(4, '0')}`};${m?.code ?? ''};${n === 0 ? 'terminé' : 'en cours'};${n === 0 ? 100 : 50};${n === 0 ? d.ti : ''};${n === 0 ? 'oui' : ''}`;
    });
    setTexte(EXEMPLE + corps.join('\n'));
    setFichier('exemple-avancement.csv');
  };

  const errTexte = !texte.trim() ? t('Load a file or paste its content.') : lu && 'refus' in lu ? lu.refus : !valides ? t('No valid line: correct the file (see the preview).') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errTexte)) return;
    setBusy(true);
    const r = await run('elearning.importer', { texte });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const nom = (id: number | null) => (id != null ? d.emp(id)?.nom ?? '—' : '—');
  const code = (id: number | null) => modules.find(x => x.id === id)?.code ?? '—';
  return (
    <Dialog title={t('Import the e-learning progress')} width={760} tall onSubmit={envoyer}
      actions={<><CancelButton /><SubmitButton busy={busy}>{valides ? `${t('Apply #verb')}${tn(valides, 'line', 'lines')}` : t('Import')}</SubmitButton></>}>
      <Field label={t('File exported from the platform (CSV)')} htmlFor="ie-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="ie-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <Btn small onClick={exemple}>{t('Load an example')}</Btn>
          {fichier && <span className="note-accent">{t('File loaded: ')}{fichier}</span>}
        </div>
        <span className="text-muted sub">
          {t('Columns accepted: ')}{COLONNES_IMPORT_ELEARNING}{t('. Any other column (connection time, activity log, detailed score) makes the file refused. The employee must already be enrolled in the module: the import enrols no one.')}
        </span>
      </Field>
      <Field label={t('Or paste the content')} htmlFor="ie-text" erreur={texte.trim() ? errTexte : v.erreur(errTexte)}>
        <textarea className="input mono-input" id="ie-text" rows={4} value={texte} onChange={e => { setTexte(e.target.value); setFichier(''); }}
          placeholder={EXEMPLE.trim()} style={{ height: 'auto', minHeight: 88, resize: 'vertical' }} />
      </Field>
      {lignes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>{t('Preview')}</h3>
            <span className="text-muted sub">{tn(lignes.length, 'line', 'lines')} · {valides}{t(' valid#plural')} · {lignes.length - valides}{t(' in error')}</span>
          </div>
          <div className="scroll-x">
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t('Line')}</th><th>{t('Employee#salarie')}</th><th>{t('Module')}</th><th>{t('Progress')}</th><th>{t('Effect')}</th></tr></thead>
              <tbody>
                {lignes.map((l, k) => (
                  <tr key={l.n} style={l.errs.length ? { opacity: 0.6 } : undefined}>
                    <td className="tnum">{l.n}</td>
                    <td className="nowrap">{nom(l.empId)}</td>
                    <td className="nowrap">{code(l.moduleId)}</td>
                    <td className="nowrap">{l.statut === 'termine' || l.dateFin ? `${t('completed#masc')}${l.dateFin ? `${t(' on #le')}${l.dateFin.split('-').reverse().join('/')}` : ''}` : l.avancement != null ? `${l.avancement} %` : '—'}{l.reussi === true ? t(' · passed') : l.reussi === false ? t(' · not passed') : ''}</td>
                    <td>{l.errs.length ? <span className="note-accent">{l.errs.join(' · ')}</span>
                      : effets[k] === 'fin' ? <Tag cls="tag-accent">{t('Completion approved automatically')}</Tag>
                      : effets[k] === 'maj' ? <Tag cls="tag-neutral">{t('Update#noun')}</Tag> : <Tag cls="tag-outline">{t('Unchanged#fem')}</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {auto
        ? <NoteAccent>{t('Automatic completion on import enabled (Settings): a “completed” and “passed” line of a module without a required certificate creates the attended training course.')}</NoteAccent>
        : <Fine>{t('The imported completions await HR approval (E-learning tab, “Completions to approve”).')}</Fine>}
      <Fine>{t('The log only keeps the number of lines. The DPO validates the import from a third-party platform; this tracking is never a monitoring of activity.')}</Fine>
    </Dialog>
  );
}
