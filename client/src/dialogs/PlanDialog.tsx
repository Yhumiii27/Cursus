// Planifier un renouvellement : inscription à une session et convocation.
// Sans session ouverte, le RH crée une session ; un manager transmet une demande au service RH.
import { useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function PlanDialog({ empId, certId }: { empId: number; certId: number }) {
  const { d, upcoming } = useEnriched();
  const { run, closeDialog, openDialog } = useStore();
  const { rh } = useRole();
  const emp = d.emp(empId);
  const cert = emp?.certs.find(c => c.id === certId);
  const sessions = cert ? upcoming.filter(s => s.formation === cert.f) : [];
  const [sessionId, setSessionId] = useState<number | null>(sessions.find(s => s.inscrits < s.places)?.id ?? null);
  const [conv, setConv] = useState<'now' | 'later'>('now');
  const [busy, setBusy] = useState(false);
  if (!emp || !cert) return null;
  const fm = d.fm(cert.f);
  const ouvertes = sessions.some(s => s.inscrits < s.places);
  // Seul le service RH crée des sessions : les autres transmettent une demande de formation.
  const demander = !rh && !ouvertes;

  const confirm = async () => {
    setBusy(true);
    const r = await run('plan.inscrire', { empId, certId, sessionId, conv });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Planifier un renouvellement" width={540} actions={<>
      <CancelButton />
      {demander
        ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'reqForm', empId, f: cert.f })}>Demander au RH</button>
        : sessions.length === 0
          ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'session', f: cert.f })}>Créer une session</button>
          : <button type="button" className="btn btn-primary" disabled={!sessionId || busy} onClick={confirm}>Confirmer l’inscription</button>}
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Certification"><Static>{fm.nom}</Static></Field>
      </div>
      <Field label="Session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {sessions.map(s => {
            const full = s.inscrits >= s.places, checked = sessionId === s.id;
            return (
              <label key={s.id} className={`radio radio-opt${checked ? ' checked' : ''}${full ? ' full' : ''}`}>
                <input type="radio" name="session" checked={checked} disabled={full} onChange={() => setSessionId(s.id)} />
                <span className="dot" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
                  <div><div style={{ fontSize: 14 }}>{fmt(parse(s.date))}</div><div className="text-muted sub">{s.lieu} · {fm.organisme}</div></div>
                  <span className="text-muted sub nowrap">{full ? 'Complète' : plural(s.places - s.inscrits, 'place restante', 'places restantes')}</span>
                </div>
              </label>
            );
          })}
          {sessions.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{rh
            ? 'Aucune session à venir pour cette formation — créez-en une pour inscrire ce collaborateur.'
            : 'Aucune session à venir — la demande sera transmise au service RH.'}</p>}
          {sessions.length > 0 && demander && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Toutes les sessions sont complètes — la demande sera transmise au service RH.</p>}
        </div>
      </Field>
      {ouvertes && (
        <Field label="Convocation">
          <Seg name="convoc" label="Convocation" value={conv} onChange={setConv} options={[['now', 'Envoyer maintenant'], ['later', 'Envoyer plus tard']]} />
        </Field>
      )}
    </Dialog>
  );
}
