// Détail d'une session (service RH) : inscrits nominatifs, ou résultats après la clôture ; confirmation
// avec la liste à transmettre à l'organisme (affichage et export CSV), modification, annulation, clôture.
import { useState } from 'react';
import { DownloadSimpleIcon, PaperPlaneTiltIcon, PencilSimpleIcon, XCircleIcon } from '@phosphor-icons/react';
import { PLAN_LABEL, SESS_CLS, VALIDATION_LABEL } from '../../../shared/constants.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort } from '../../../shared/format.ts';
import { finSession, joursSession, joursTexte, plageCourte, sessionDu, surPlusieursJours } from '../../../shared/rules/plage-session.ts';
import { convocationEnvoyee, exigeEvaluation, type Inscrit, inscritsDe, listeOrganisme, resultatsDe } from '../../../shared/rules/sessions.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Tag, Two } from '../components/ui.tsx';
import type { NomAction } from '../api.ts';
import { downloadCsv } from '../print.ts';
import { useEnriched, useRole } from '../state/derived.ts';
import { desinscription } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { ListeAttenteSession } from '../components/ListeAttente.tsx';
import { AvisSession } from '../components/Evaluations.tsx';
import { t, tn } from '../i18n/langue.ts';

export function SessionDetailDialog({ sessionId }: { sessionId: number }) {
  const { d } = useEnriched();
  // Gestion des sessions : service RH et référent HSE ; la lecture seule consulte et exporte la liste.
  const { formations } = useRole();
  const { run, closeDialog, openDialog, notify } = useStore();
  const [annulation, setAnnulation] = useState(false);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const s = d.session(sessionId);
  if (!s) return null;
  const fm = d.fm(s.formation);
  const statut = d.sessionStatut(s);
  const ouverte = sessionActive(s);
  // Clôture possible dès le dernier jour (le jour même pour une session d'une journée) ; confirmation tant que la session
  // n'a pas commencé.
  const dernier = finSession(s);
  const cloturable = ouverte && dernier <= d.ti;
  const inscrits = ouverte ? inscritsDe(d, s) : [];
  const resultats = s.statut === 'Clôturée' ? resultatsDe(d, s) : [];
  const plan = s.planId ? d.ds.plan.find(l => l.id === s.planId) : undefined;
  const titre = `${fm?.court ?? s.formation} — ${plageCourte(s)}`;

  const exporter = () => {
    const l = listeOrganisme(d, s);
    downloadCsv(l.fichier, l.head, l.rows);
    notify(`${t('List exported')} — ${tn(l.rows.length, 'enrolled', 'enrolled#plural')}`);
  };
  const act = async (name: NomAction, payload: Record<string, unknown>) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };
  // Convocations : session à venir, ou en cours jusqu'à son dernier jour (renvoi après un changement des jours restants) ;
  // une session passée attend sa clôture. Désinscription : session à venir seulement. Le dialogue reste ouvert.
  const aVenir = ouverte && s.date >= d.ti, convocable = ouverte && dernier >= d.ti;
  const aEnvoyer = inscrits.filter(i => i.convoc !== 'now' && !i.dejaObtenue);
  // Annulation d'une session à venir : les convocations déjà envoyées (même « à renvoyer ») sont annulées par e-mail.
  const convoques = aVenir ? inscrits.filter(convocationEnvoyee).length : 0;
  const agir = async (name: NomAction, payload: Record<string, unknown>) => {
    setBusy(true);
    await run(name, payload);
    setBusy(false);
  };
  const convoquer = (i?: Inscrit) => agir('convocation.envoyer', { sessionId: s.id, ...(i ? { empIds: [i.empId] } : {}) });
  // Confirmation (state/confirmations.ts), puis retour au détail de la session.
  const desinscrire = (i: Inscrit) => openDialog({ type: 'confirmer', c: desinscription({ empId: i.empId, sessionId: s.id }, i.nom, `${fm?.court ?? s.formation} ${sessionDu(s)}`,
    { recyclage: i.parcours === 'recyclage', convoque: convocationEnvoyee(i), retour: { type: 'sessionDetail', sessionId: s.id } }) });

  if (annulation) {
    return (
      <Dialog title={t('Cancel the session')} width={540} onSubmit={() => { if (!busy) act('session.annuler', { id: s.id, motif: motif.trim() }); }} actions={<>
        <button type="button" className="btn btn-secondary" onClick={() => setAnnulation(false)}>{t('Back')}</button>
        <SubmitButton busy={busy}>{t('Cancel the session')}</SubmitButton>
      </>}>
        <Field label={t('Session')}><Static>{fm?.nom ?? s.formation} · {plageCourte(s)} · {s.lieu}</Static></Field>
        <Field label={t('Reason (optional)')} htmlFor="sd-motif">
          <textarea className="input short" id="sd-motif" rows={2} maxLength={500} placeholder={t('Postponed by the provider, too few participants…')} value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>
          {inscrits.length
            ? `${tn(inscrits.length, 'enrolled person becomes', 'enrolled people become')}${t(' to plan again: the refreshers come back in the due dates, the initial training courses are to plan again from the employee’s sheet.')}`
            : t('No one enrolled.')}
          {plan?.statut === 'engage' ? t(' The action of the plan committed for this session becomes “planned” again if no other session carries it.') : ''}
          {convoques ? ` ${convoques > 1 ? `${t('The ')}${convoques}${t(' notices already sent are cancelled')}` : t('The notice already sent is cancelled')}${t(' by e-mail, without the reason.')}` : ''}
        </Fine>
      </Dialog>
    );
  }

  return (
    <Dialog title={titre} width={680} tall actions={<>
      <CancelButton label={t('Close')} />
      {formations && cloturable && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'cloture', sessionId: s.id })}>{t('Close the session')}</button>}
      {formations && ouverte && !cloturable && s.statut === 'À confirmer' && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('session.confirmer', { id: s.id })}>{t('Confirm the session')}</button>
      )}
    </>}>
      <div className="grid-2">
        <Field label={t('Training course')}><Static>{fm?.nom ?? s.formation}<div className="text-muted sub">{fm?.organisme} · {fm?.duree}</div></Static></Field>
        <Field label={t('Status')}><Static><Tag cls={SESS_CLS[statut]}>{statut}</Tag></Static></Field>
        <Field label={t(surPlusieursJours(s) ? 'Dates and place' : 'Date and place')}><Static>{plageCourte(s)}<div className="text-muted sub">{s.lieu}</div></Static></Field>
        <Field label={t('Places')}><Static>{ouverte ? `${s.inscrits} / ${s.places}` : s.statut === 'Clôturée' ? tn(s.inscrits, 'enrolled', 'enrolled#plural') : `${s.places}${t(' (cancelled)')}`}<div className="text-muted sub">{t('Validation: ')}{VALIDATION_LABEL[exigeEvaluation(fm) ? 'evaluation' : 'presence'].toLowerCase()}</div></Static></Field>
      </div>
      {plan && <Fine>{t('Action of the plan ')}{plan.exercice} · {plan.equipe} · {plan.periode} · {PLAN_LABEL[plan.statut].toLowerCase()}</Fine>}
      {(surPlusieursJours(s) || s.horaires.length > 0) && (
        <Field label={surPlusieursJours(s) ? `${t('Days of the session')} (${joursSession(s).length})` : t('Times')}>
          <Static>{joursTexte(s).map(j => <div key={j}>{j}</div>)}</Static>
        </Field>
      )}

      {ouverte && <>
        <div className="panel-head center">
          <h3 className="section-label">{t('Enrolled')}</h3>
          <div className="actions-end">
            {formations && convocable && aEnvoyer.length > 0 && (
              <Btn small variant="secondary" icon={<PaperPlaneTiltIcon size={14} />} disabled={busy} onClick={() => convoquer()}>{t('Send the notices')} ({aEnvoyer.length})</Btn>
            )}
            <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={!inscrits.length}>{t('Export the list (CSV)')}</Btn>
            {formations && <>
              <Btn small icon={<PencilSimpleIcon size={14} />} onClick={() => openDialog({ type: 'session', sessionId: s.id })}>{t('Edit')}</Btn>
              <Btn small icon={<XCircleIcon size={14} />} onClick={() => setAnnulation(true)}>{t('Cancel the session')}</Btn>
            </>}
          </div>
        </div>
        {inscrits.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Team')}</th><th>{t('Path')}</th><th>{t('Notice')}</th>{formations && convocable && <th></th>}</tr></thead>
              <tbody>
                {inscrits.map(i => (
                  <tr key={i.empId}>
                    <td><Two main={i.nom} sub={i.poste} /></td>
                    <td className="text-muted nowrap">{equipeLabel(i)}</td>
                    <td>
                      <Two main={t(i.parcours === 'recyclage' ? 'Refresher' : 'Initial training')}
                        sub={i.dejaObtenue ? `${t('Already renewed on ')}${fmt(parse(i.dejaObtenue.obtenue))}` : i.obtenue ? `${t('Obtained on ')}${fmt(parse(i.obtenue))}` : ''} />
                    </td>
                    <td>
                      <Tag cls={i.convoc === 'now' ? 'tag-neutral' : 'tag-outline'}>{t(i.convoc === 'now' ? 'Sent#fem' : i.convocLe ? 'To send again' : 'To send')}</Tag>
                      {i.convocLe && <div className="text-muted sub nowrap">{t(i.convoc === 'now' ? 'on#le' : 'sent on#fem')} {fmtShort(parse(i.convocLe))}</div>}
                    </td>
                    {formations && convocable && (
                      <td className="right">
                        <div className="actions-end">
                          {!i.dejaObtenue && <Btn small disabled={busy} onClick={() => convoquer(i)}>{t(convocationEnvoyee(i) ? 'Send again' : 'Send')}</Btn>}
                          {aVenir && <Btn small disabled={busy} onClick={() => desinscrire(i)}>{t('Unenrol')}</Btn>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty pad="sm">{t('No one enrolled yet.')}</Empty>}
        {formations && s.statut === 'À confirmer' && !cloturable && (
          <Fine>{t('Confirm the session once the date is approved by ')}{fm?.organisme ?? t('the provider')}{t(', and send it this list (CSV export). The notices go by e-mail to those enrolled, with the file that adds the session to their calendar.')}</Fine>
        )}
        {cloturable && <NoteAccent>{t(dernier < d.ti ? 'Past session — to close: attendance, results and certifications.' : surPlusieursJours(s) ? 'Last day of the session: close it once finished.' : 'Session of the day: close it once finished.')}</NoteAccent>}
        {/* Liste d'attente de la session complète (lot 7, t120) : place proposée à confirmer, retrait. */}
        <ListeAttenteSession s={s} />
      </>}

      {s.statut === 'Clôturée' && <>
        <h3 className="section-label">{t('Results')}</h3>
        {resultats.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Path')}</th><th>{t('Attendance')}</th><th>{t('Result')}</th></tr></thead>
              <tbody>
                {resultats.map(r => (
                  <tr key={r.p.id}>
                    <td><Two main={r.nom} sub={equipeLabel(r)} /></td>
                    <td>{t(r.p.parcours === 'recyclage' ? 'Refresher' : 'Initial training')}</td>
                    <td>{t(r.p.present ? 'Present' : 'Absent')}</td>
                    <td><Tag cls={r.obtenue ? 'tag-neutral' : 'tag-accent'}>{r.label}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty pad="sm">{t('No one enrolled.')}</Empty>}
        <Fine>
          {t('Closed on ')}{s.bilan ? fmt(parse(s.bilan.le)) : '—'}{s.bilan?.par ? `${t(' by ')}${s.bilan.par}` : ''}{t(' · validation: ')}{t(fm && exigeEvaluation(fm) ? 'assessment passed required' : 'attendance')}.
          {s.bilan?.note != null ? `${t(' Rating of the session: ')}${s.bilan.note} / 5.` : ''}
        </Fine>
        {s.bilan?.commentaire && <p className="boxed" style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{s.bilan.commentaire}</p>}
        {/* Avis des participants (lot 7, t121) : service RH seulement. */}
        <AvisSession s={s} />
      </>}

      {s.statut === 'Annulée' && (
        <Fine>{t('Cancelled on #fem')}{s.bilan ? fmt(parse(s.bilan.le)) : '—'}{s.bilan?.par ? `${t(' by ')}${s.bilan.par}` : ''}{s.bilan?.motif ? ` — ${s.bilan.motif}` : ''}.</Fine>
      )}
    </Dialog>
  );
}
