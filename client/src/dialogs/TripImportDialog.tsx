// Importer des demandes de déplacement depuis l'export CSV du formulaire de demande.
// Lignes refusées : collaborateur ou destination inconnus, dates impossibles, déplacement ou absence qui chevauche (conflits.ts).
import { useMemo, useState, type ChangeEvent } from 'react';
import { TRIP_CLS, TRIP_LABEL } from '../../../shared/constants.ts';
import { parseTrips, SAMPLE_TRIPS_CSV } from '../../../shared/rules/imports.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function TripImportDialog() {
  const d = useDomain();
  const { run, closeDialog, go } = useStore();
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const rows = useMemo(() => parseTrips(d, texte).map(r => {
    const status = r.ok ? d.readiness(r.emp!, { dest: r.dest!.code, depart: r.depart!, retour: r.retour! }).status : null;
    return { ...r, ctrl: status ? TRIP_LABEL[status] : r.errs[0], cls: status ? TRIP_CLS[status] : 'tag-accent' };
  }), [d, texte]);
  const ok = rows.filter(r => r.ok).length;

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const read = (enc: string) => {
      const fr = new FileReader();
      fr.onload = () => {
        const lu = String(fr.result || '');
        if (enc === 'utf-8' && lu.includes('�')) read('windows-1252');
        else { setTexte(lu); setFichier(file.name); }
      };
      fr.readAsText(file, enc);
    };
    read('utf-8');
  };

  const texteErr = !texte.trim() ? t('Load a file or paste the content of the export.')
    : !ok ? t('No valid request to import: correct the file (see the preview).') : null;
  const confirm = async () => {
    if (busy || !v.verifier(texteErr)) return;
    setBusy(true);
    const r = await run('voyages.importer', { texte });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    go('voyages', { tripSel: null });
  };

  return (
    <Dialog title={t('Import trip requests')} width={760} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{ok ? `${t('Create #creer')}${tn(ok, 'trip', 'trips')}` : t('Import')}</SubmitButton>
    </>}>
      <Field label={t('Export of the request form (CSV)')} htmlFor="ti-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="ti-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <Btn small onClick={() => { setTexte(SAMPLE_TRIPS_CSV); setFichier('export-demandes-deplacement.csv'); }}>{t('Load an example')}</Btn>
          {fichier && <span className="note-accent">{t('File loaded: ')}{fichier}</span>}
        </div>
        <span className="text-muted sub">{t('Columns: référence; collaborateur; destination; départ; retour; motif; demandeur. Dates DD/MM/YYYY or YYYY-MM-DD. References already imported are ignored; without a reference, the trip receives “DD-” followed by its number in Cursus (DD-12, for example).')}</span>
      </Field>
      <Field label={t('Or paste the content')} htmlFor="ti-text" erreur={v.erreur(texteErr)}>
        <textarea className="input mono-input" id="ti-text" rows={4} value={texte} onChange={e => { setTexte(e.target.value); setFichier(''); }}
          placeholder="reference;collaborateur;destination;depart;retour;motif;demandeur" style={{ height: 'auto', minHeight: 88, resize: 'vertical' }} />
      </Field>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>{t('Preview')}</h3>
            <span className="text-muted sub">{tn(rows.length, 'request', 'requests')} · {ok}{t(' valid#plural')} · {rows.length - ok}{t(' ignored#fem-plural')}</span>
          </div>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t('Ref.')}</th><th>{t('Employee')}</th><th>{t('Destination')}</th><th>{t('Dates')}</th><th>{t('Requester')}</th><th>{t('Check#controle')}</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.n} style={r.ok ? undefined : { opacity: 0.55 }}>
                  <td className="nowrap">{r.ref || '—'}</td>
                  <td className="nowrap">{r.nomLabel}</td>
                  <td>{r.destLabel}</td>
                  <td className="nowrap">{r.dates}</td>
                  {/* Demandeur reconnu parmi les salariés, sinon gardé tel que saisi. */}
                  <td>{r.demandeur ?? '—'}{r.demandeur && !r.demandeurConnu ? <span className="text-muted sub">{t(' · outside the directory')}</span> : null}</td>
                  {/* Motif du refus en clair (conflit de dates, doublon…) : il peut être long, il passe à la ligne. */}
                  <td>{r.ok ? <Tag cls={r.cls}>{r.ctrl}</Tag> : <span className="note-accent">{r.errs.join(' · ')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
