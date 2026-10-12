// Planifier un renouvellement (certification détenue) ou replanifier une formation initiale
// (session annulée, absent, évaluation échouée) : inscription à une session et convocation.
// Sans session ouverte, le RH crée une session ; un manager transmet une demande au service RH.
// Un inscrit d'une session passée, pas encore clôturée, attend d'abord la clôture.
import { useState } from 'react';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function PlanDialog({ empId, certId, inscriptionId }: { empId: number; certId?: number; inscriptionId?: number }) {
  const { d, upcoming } = useEnriched();
  const { run, closeDialog, openDialog } = useStore();
  const { rh } = useRole();
  const emp = d.emp(empId);
  const cert = certId != null ? emp?.certs.find(c => c.id === certId) : undefined;
  const insc = inscriptionId != null ? d.ds.inscriptions.find(i => i.id === inscriptionId && i.empId === empId) : undefined;
  const f = cert?.f ?? (insc && d.session(insc.sessionId)?.formation);
  const sessions = f ? upcoming.filter(s => s.formation === f) : [];
  const [sessionId, setSessionId] = useState<number | null>(sessions.find(s => s.inscrits < s.places)?.id ?? null);
  const [conv, setConv] = useState<'now' | 'later'>('now');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !f) return null;
  const fm = d.fm(f);
  // Inscrit d'une session passée, pas encore clôturée : la clôture (présence, résultat) précède toute nouvelle inscription.
  const actuelle = d.session((cert ?? insc)?.sessionId ?? null);
  if (actuelle && sessionActive(actuelle) && actuelle.date < d.ti) {
    return (
      <Dialog title={insc ? 'Planifier la formation' : 'Planifier un renouvellement'} width={540} actions={<>
        <CancelButton label="Fermer" />
        {rh && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'cloture', sessionId: actuelle.id })}>Clôturer la session</button>}
      </>}>
        <p className="text-muted" style={{ margin: 0 }}>
          {emp.nom} est inscrit à la session {fm.court} du {fmt(parse(actuelle.date))}, passée : {rh ? 'clôturez-la d’abord' : 'le service RH la clôture d’abord'} (présence, résultat).
        </p>
      </Dialog>
    );
  }
  const ouvertes = sessions.some(s => s.inscrits < s.places);
  // Seul le service RH crée des sessions : les autres transmettent une demande de formation.
  const demander = !rh && !ouvertes;

  const sessionErr = !sessionId ? 'Choisissez une session.' : null;
  const confirm = async () => {
    if (busy || !v.verifier(sessionErr)) return;
    setBusy(true);
    const r = await run('plan.inscrire', insc ? { empId, inscriptionId: insc.id, sessionId, conv } : { empId, certId, sessionId, conv });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={insc ? 'Planifier la formation' : 'Planifier un renouvellement'} width={540} onSubmit={demander || sessions.length === 0 ? undefined : confirm} actions={<>
      <CancelButton />
      {demander
        ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'reqForm', empId, f })}>Demander au RH</button>
        : sessions.length === 0
          ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'session', f })}>Créer une session</button>
          : <SubmitButton busy={busy}>Confirmer l’inscription</SubmitButton>}
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label={insc ? 'Formation initiale' : 'Certification'}><Static>{fm.nom}</Static></Field>
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
          {v.erreur(sessionErr) && <Bloquant>{sessionErr}</Bloquant>}
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
