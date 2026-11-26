// Clôture d'une session passée (service RH) : présence de chaque inscrit et, si la formation l'exige,
// résultat de l'évaluation ; appréciation de la session facultative et, pour le service RH, avis à chaud de chaque présent
// recueilli en son nom (lot 7, t121 : il pourra le modifier dans son espace). Présents (et reçus) : certification datée
// du jour de la session (du dernier jour d'une session sur plusieurs jours) ; absents ou échecs : à replanifier.
// Tout est enregistré en une fois.
// L'action du plan rattachée, réalisée par cette clôture, reçoit son coût réel (prérempli du coût prévu).
import { useMemo, useState } from 'react';
import { VALIDATION_LABEL } from '../../../shared/constants.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtEur } from '../../../shared/format.ts';
import { finSession, plageCourte } from '../../../shared/rules/plage-session.ts';
import { exigeEvaluation, inscritsDe } from '../../../shared/rules/sessions.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, Seg, Tag } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { erreurCoutReel } from './PlanRealiserDialog.tsx';
import { t, tn } from '../i18n/langue.ts';

export function ClotureDialog({ sessionId }: { sessionId: number }) {
  const { d } = useEnriched();
  const { run, closeDialog } = useStore();
  const s = d.session(sessionId);
  const inscrits = useMemo(() => s ? inscritsDe(d, s) : [], [d, s]);
  // La clôture est définitive : présence et résultat de l'évaluation se choisissent toujours explicitement.
  const [presence, setPresence] = useState<Record<number, 'p' | 'a'>>({});
  const [resultat, setResultat] = useState<Record<number, 'ok' | 'ko'>>({});
  const [note, setNote] = useState('');
  // Avis à chaud des présents recueilli par le service RH (lot 7, t121), facultatif : note de 1 à 5 par participant.
  const [avis, setAvis] = useState<Record<number, string>>({});
  const { rh } = useRole();
  const [commentaire, setCommentaire] = useState('');
  // Coût réel de l'action du plan rattachée : prérempli de son coût prévu.
  const [coutReel, setCoutReel] = useState(() => {
    const l = s?.planId ? d.ds.plan.find(x => x.id === s.planId) : undefined;
    return l ? String(l.cout) : '';
  });
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!s) return null;
  const fm = d.fm(s.formation);
  // Session sur plusieurs jours : clôturée à partir de son dernier jour.
  const dernier = finSession(s);
  if (!sessionActive(s) || dernier > d.ti) {
    return (
      <Dialog title={t('Close the session')} actions={<CancelButton label={t('Close')} />}>
        <p className="text-muted" style={{ margin: 0 }}>
          {!sessionActive(s) ? `${t('Session ')}${s.statut.toLowerCase()}.` : s.date > d.ti ? t('The session has not taken place yet.') : `${t('The session lasts until ')}${fmt(parse(dernier))}${t(': close it from its last day.')}`}
        </p>
      </Dialog>
    );
  }
  const evaluation = exigeEvaluation(fm);
  const recueillir = rh && d.ds.settings.evaluationsActives;
  const present = (id: number) => presence[id] === 'p';
  const decider = inscrits.filter(i => !i.dejaObtenue);
  const sansPresence = decider.filter(i => !presence[i.empId]);
  const manquants = evaluation ? decider.filter(i => present(i.empId) && !resultat[i.empId]) : [];
  const obtenues = decider.filter(i => present(i.empId) && (!evaluation || resultat[i.empId] === 'ok')).length;
  const aReplanifier = decider.filter(i => presence[i.empId] === 'a' || (evaluation && present(i.empId) && resultat[i.empId] === 'ko')).length;
  // L'action du plan passe « réalisée » si aucune autre session ouverte ne la porte.
  const plan = s.planId ? d.ds.plan.find(l => l.id === s.planId && l.statut !== 'realise') : undefined;
  const realise = !!plan && plan.statut !== 'reporte' && !d.ds.sessions.some(x => x.id !== s.id && x.planId === s.planId && sessionActive(x));
  const coutErr = realise ? erreurCoutReel(coutReel) : null;
  const quand = fmt(parse(dernier));

  const confirm = async () => {
    if (busy || !v.verifier(sansPresence.length, manquants.length, coutErr)) return;
    setBusy(true);
    const r = await run('session.cloturer', {
      id: s.id,
      participants: decider.map(i => ({
        empId: i.empId, present: present(i.empId), reussi: evaluation && present(i.empId) ? resultat[i.empId] === 'ok' : null,
        ...(recueillir && present(i.empId) && avis[i.empId] ? { note: Number(avis[i.empId]) } : {}),
      })),
      note: note ? Number(note) : null,
      commentaire: commentaire.trim(),
      ...(realise ? { coutReel: coutReel.trim().replace(',', '.') } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Close the session')} width={640} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Close the session')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Session')}><Static>{fm?.nom ?? s.formation}<div className="text-muted sub">{plageCourte(s)} · {s.lieu}</div></Static></Field>
        <Field label={t('Validation')}><Static>{VALIDATION_LABEL[evaluation ? 'evaluation' : 'presence']}<div className="text-muted sub">{fm?.organisme}</div></Static></Field>
      </div>

      <Field label={`${t('Enrolled')} (${inscrits.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {inscrits.map(i => (
            <div key={i.empId} className="boxed" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{i.nom}</div>
                <div className="text-muted sub">{equipeLabel(i)} · {i.parcours === 'recyclage' ? `${t('refresher (obtained on ')}${fmt(parse(i.obtenue!))})` : t('initial training#lower')}</div>
              </div>
              {i.dejaObtenue
                ? <Tag cls="tag-neutral">{t('Already renewed on ')}{fmt(parse(i.dejaObtenue.obtenue))}</Tag>
                : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Seg name={`pres-${i.empId}`} label={`${t('Attendance of ')}${i.nom}`} value={presence[i.empId] ?? ('' as 'p')}
                      onChange={v => setPresence(x => ({ ...x, [i.empId]: v }))} options={[['p', t('Present')], ['a', t('Absent')]]} />
                    {evaluation && present(i.empId) && (
                      <Seg name={`res-${i.empId}`} label={`${t('Assessment of ')}${i.nom}`} value={resultat[i.empId] ?? ('' as 'ok')}
                        onChange={v => setResultat(x => ({ ...x, [i.empId]: v }))} options={[['ok', t('Passed#fem')], ['ko', t('Failed#fem')]]} />
                    )}
                    {recueillir && present(i.empId) && (
                      <select className="input" aria-label={`${t('Immediate feedback of ')}${i.nom}`} value={avis[i.empId] ?? ''} style={{ width: 'auto' }}
                        onChange={e => setAvis(x => ({ ...x, [i.empId]: e.target.value }))}>
                        <option value="">{t('Feedback: not collected')}</option>
                        {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{t('Feedback: ')}{n} / 5</option>)}
                      </select>
                    )}
                  </div>
                )}
            </div>
          ))}
          {inscrits.length === 0 && <Empty pad="sm">{t('No one enrolled: the session will be closed without certification.')}</Empty>}
        </div>
      </Field>
      {/* Choix explicites (aucune valeur par défaut) : ce qui manque est listé, et ciblé à l'envoi. */}
      {sansPresence.length > 0 && <Bloquant>{t('Attendance to enter: ')}{sansPresence.map(i => i.nom).join(', ')}.</Bloquant>}
      {manquants.length > 0 && <Bloquant>{t('Result of the assessment to enter: ')}{manquants.map(i => i.nom).join(', ')}.</Bloquant>}

      <div className="grid-2">
        <Field label={t('Rating of the session (optional)')} htmlFor="cl-note">
          <select className="input" id="cl-note" value={note} onChange={e => setNote(e.target.value)}>
            <option value="">{t('Not entered#fem')}</option>
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} / 5</option>)}
          </select>
        </Field>
      </div>
      {realise && plan && (
        <Field label={`${t('Actual cost of the action of the plan ')}${plan.exercice} (€)`} htmlFor="cl-cout" requis erreur={v.erreur(coutErr) || (coutReel.trim() ? coutErr : null)}>
          <input className="input tnum" id="cl-cout" inputMode="decimal" value={coutReel} onChange={e => setCoutReel(e.target.value)} style={{ maxWidth: 200 }} />
          <span className="text-muted sub">{plan.equipe}{t(' · planned ')}{fmtEur(plan.cout)}{t(': enter the amount invoiced, it counts in the actual of the budget.')}</span>
        </Field>
      )}
      <Field label={t('Comment (optional)')} htmlFor="cl-comm">
        <textarea className="input short" id="cl-comm" rows={2} maxLength={1000} placeholder={t('Feedback from the participants, quality of the facilitation, organisation…')}
          value={commentaire} onChange={e => setCommentaire(e.target.value)} />
      </Field>
      <Fine>
        {t('On validation: ')}{tn(obtenues, 'certification recorded', 'certifications recorded')}{t(obtenues > 1 ? ', dated#plural' : ', dated')}{t(' on #du')}{quand}
        {aReplanifier ? ` · ${tn(aReplanifier, 'enrolled', 'enrolled#plural')}${t(' to plan again (refresher to plan again, initial training to re-enrol)')}` : ''}
        {realise ? t(' · action of the plan carried out') : ''}{t('. The closing is final.')}
        {recueillir ? t(' Immediate feedback: rating given by each person present (form, round table), recorded in their name; without feedback collected, they give it in their space for a month.') : ''}
      </Fine>
    </Dialog>
  );
}
