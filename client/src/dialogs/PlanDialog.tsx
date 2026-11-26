// Planifier un renouvellement (certification détenue) ou replanifier une formation initiale
// (session annulée, absent, évaluation échouée) : inscription à une session et convocation.
// Sans session ouverte, le RH crée une session ; un manager transmet une demande au service RH. La session créée ramène
// ici, présélectionnée (`sessionId`, t107 : dialogs/retour-session.ts).
// Un inscrit d'une session passée, pas encore clôturée, attend d'abord la clôture.
// Conflits de dates (absence, déplacement, autre session, entretien) contrôlés en direct : un salarié absent ne s'inscrit pas.
import { useState } from 'react';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { blocage, conflitsSession } from '../../../shared/rules/conflits.ts';
import { finSession, joursSession, plageCourte, sessionDu, surPlusieursJours } from '../../../shared/rules/plage-session.ts';
import { horsContratLe } from '../../../shared/rules/contrats.ts';
import { placesDirectes } from '../../../shared/rules/liste-attente.ts';
import type { Session } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { sessionPreselectionnee } from './retour-session.ts';
import { t, tn } from '../i18n/langue.ts';

export function PlanDialog({ empId, certId, inscriptionId, sessionId: demandee }: { empId: number; certId?: number; inscriptionId?: number; sessionId?: number }) {
  const { d, upcoming } = useEnriched();
  const { run, closeDialog, openDialog } = useStore();
  // Sessions et clôtures : service RH et référent HSE ; le manager transmet une demande.
  const { formations } = useRole();
  const emp = d.emp(empId);
  const cert = certId != null ? emp?.certs.find(c => c.id === certId) : undefined;
  const insc = inscriptionId != null ? d.ds.inscriptions.find(i => i.id === inscriptionId && i.empId === empId) : undefined;
  const f = cert?.f ?? (insc && d.session(insc.sessionId)?.formation);
  const sessions = f ? upcoming.filter(s => s.formation === f) : [];
  const [sessionId, setSessionId] = useState<number | null>(sessionPreselectionnee(sessions, demandee));
  const [conv, setConv] = useState<'now' | 'later'>('now');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !f) return null;
  const fm = d.fm(f);
  // Inscrit d'une session passée, pas encore clôturée : la clôture (présence, résultat) précède toute nouvelle inscription.
  const actuelle = d.session((cert ?? insc)?.sessionId ?? null);
  if (actuelle && sessionActive(actuelle) && actuelle.date < d.ti) {
    return (
      <Dialog title={t(insc ? 'Plan the training course' : 'Plan a renewal')} width={540} actions={<>
        <CancelButton label={t('Close')} />
        {formations && finSession(actuelle) <= d.ti && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'cloture', sessionId: actuelle.id })}>{t('Close the session')}</button>}
      </>}>
        <p className="text-muted" style={{ margin: 0 }}>
          {`${emp.nom}${t(' is enrolled in the session ')}${fm.court} ${sessionDu(actuelle)}, ${finSession(actuelle) < d.ti ? t('past#session') : `${t('in progress until ')}${fmt(parse(finSession(actuelle)))}`}${t(formations ? ': close it first' : ': HR closes it first')}${t(' (attendance, result).')}`}
        </p>
      </Dialog>
    );
  }
  // Places libres proposées à la liste d'attente (lot 7, t120) : réservées à la file, sauf pour le service RH et le
  // référent HSE, qui peuvent passer outre (la proposition en trop revient en attente, comme le fait le serveur).
  const libres = (s: Session) => (formations ? s.places - s.inscrits : placesDirectes(s));
  const ouvertes = sessions.some(s => libres(s) > 0);
  // Seul le service RH crée des sessions : les autres transmettent une demande de formation.
  const demander = !formations && !ouvertes;
  const choisie = sessions.find(s => s.id === sessionId);
  // Chacun des jours de la session (plusieurs jours : shared/rules/plage-session.ts).
  const conflits = choisie ? conflitsSession(d, empId, choisie, { sessionId: actuelle?.id }) : [];

  // Session postérieure au départ (sortie enregistrée, fin de CDD…) : refusée, comme par le serveur.
  const sessionErr = !sessionId ? t('Choose a session.') : choisie ? horsContratLe(emp, finSession(choisie)) : null;
  const confirm = async () => {
    if (busy || !v.verifier(sessionErr, blocage(conflits))) return;
    setBusy(true);
    const r = await run('plan.inscrire', insc ? { empId, inscriptionId: insc.id, sessionId, conv } : { empId, certId, sessionId, conv });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(insc ? 'Plan the training course' : 'Plan a renewal')} width={540} onSubmit={demander || sessions.length === 0 ? undefined : confirm} actions={<>
      <CancelButton />
      {demander
        ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'reqForm', empId, f })}>{t('Ask HR')}</button>
        : sessions.length === 0
          ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'session', f, retour: { type: 'plan', empId, certId, inscriptionId } })}>{t('Create a session')}</button>
          : <SubmitButton busy={busy}>{t('Confirm the enrolment')}</SubmitButton>}
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
        <Field label={t(insc ? 'Initial training' : 'Certification')}><Static>{fm.nom}</Static></Field>
      </div>
      <Field label={t('Session')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {sessions.map(s => {
            const full = libres(s) <= 0, checked = sessionId === s.id;
            const proposees = s.proposees ?? 0;
            return (
              <label key={s.id} className={`radio radio-opt${checked ? ' checked' : ''}${full ? ' full' : ''}`}>
                <input type="radio" name="session" checked={checked} disabled={full} onChange={() => setSessionId(s.id)} />
                <span className="dot" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
                  <div><div style={{ fontSize: 14 }}>{plageCourte(s)}</div><div className="text-muted sub">{s.lieu} · {fm.organisme}{surPlusieursJours(s) ? ` · ${tn(joursSession(s).length, 'day', 'days')}` : ''}</div></div>
                  <span className="text-muted sub nowrap">{full
                    ? t(s.inscrits < s.places ? 'Places offered to the waiting list' : 'Full#fem')
                    : `${tn(libres(s), 'place left', 'places left')}${formations && proposees ? `${t(', of which ')}${tn(proposees, 'offered', 'offered#fem-plural')}${t(' to the waiting list')}` : ''}`}</span>
                </div>
              </label>
            );
          })}
          {sessions.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t(formations
            ? 'No upcoming session for this training course — create one to enrol this employee.'
            : 'No upcoming session — the request will be sent to HR.')}</p>}
          {sessions.length > 0 && demander && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('All sessions are full — the request will be sent to HR')}{d.ds.settings.formationsListeAttente ? t(', who may put it on the waiting list') : ''}.</p>}
          {v.erreur(sessionErr) && <Bloquant>{sessionErr}</Bloquant>}
        </div>
      </Field>
      <Controles msgs={conflits} />
      {ouvertes && (
        <Field label={t('Notice')}>
          <Seg name="convoc" label={t('Notice')} value={conv} onChange={setConv} options={[['now', t('Send now')], ['later', t('Send later')]]} />
        </Field>
      )}
    </Dialog>
  );
}
