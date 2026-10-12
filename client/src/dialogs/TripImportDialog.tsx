// Importer des demandes de déplacement depuis l'export CSV du formulaire de demande.
import { useMemo, useState, type ChangeEvent } from 'react';
import { TRIP_CLS, TRIP_LABEL } from '../../../shared/constants.ts';
import { plural } from '../../../shared/format.ts';
import { parseTrips, SAMPLE_TRIPS_CSV } from '../../../shared/rules/imports.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
        const t = String(fr.result || '');
        if (enc === 'utf-8' && t.includes('�')) read('windows-1252');
        else { setTexte(t); setFichier(file.name); }
      };
      fr.readAsText(file, enc);
    };
    read('utf-8');
  };

  const texteErr = !texte.trim() ? 'Chargez un fichier ou collez le contenu de l’export.'
    : !ok ? 'Aucune demande valide à importer : corrigez le fichier (voir l’aperçu).' : null;
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
    <Dialog title="Importer des demandes de déplacement" width={760} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{ok ? `Créer ${plural(ok, 'déplacement', 'déplacements')}` : 'Importer'}</SubmitButton>
    </>}>
      <Field label="Export du formulaire de demande (CSV)" htmlFor="ti-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="ti-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <Btn small onClick={() => { setTexte(SAMPLE_TRIPS_CSV); setFichier('export-demandes-deplacement.csv'); }}>Charger un exemple</Btn>
          {fichier && <span className="note-accent">Fichier chargé : {fichier}</span>}
        </div>
        <span className="text-muted sub">Colonnes : référence ; collaborateur ; destination ; départ ; retour ; motif ; demandeur. Dates JJ/MM/AAAA ou AAAA-MM-JJ. Les références déjà importées sont ignorées.</span>
      </Field>
      <Field label="Ou coller le contenu" htmlFor="ti-text" erreur={v.erreur(texteErr)}>
        <textarea className="input mono-input" id="ti-text" rows={4} value={texte} onChange={e => { setTexte(e.target.value); setFichier(''); }}
          placeholder="reference;collaborateur;destination;depart;retour;motif;demandeur" style={{ height: 'auto', minHeight: 88, resize: 'vertical' }} />
      </Field>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>Aperçu</h3>
            <span className="text-muted sub">{plural(rows.length, 'demande', 'demandes')} · {ok} valides · {rows.length - ok} ignorées</span>
          </div>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Réf.</th><th>Collaborateur</th><th>Destination</th><th>Dates</th><th>Contrôle</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.n} style={r.ok ? undefined : { opacity: 0.55 }}>
                  <td className="nowrap">{r.ref || '—'}</td>
                  <td className="nowrap">{r.nomLabel}</td>
                  <td>{r.destLabel}</td>
                  <td className="nowrap">{r.dates}</td>
                  <td><Tag cls={r.cls}>{r.ctrl}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
