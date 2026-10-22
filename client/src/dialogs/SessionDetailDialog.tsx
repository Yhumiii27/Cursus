// Détail d'une session (service RH) : inscrits nominatifs, ou résultats après la clôture ; confirmation
// avec la liste à transmettre à l'organisme (affichage et export CSV), modification, annulation, clôture.
import { useState } from 'react';
import { DownloadSimpleIcon, PaperPlaneTiltIcon, PencilSimpleIcon, XCircleIcon } from '@phosphor-icons/react';
import { PLAN_LABEL, SESS_CLS, VALIDATION_LABEL } from '../../../shared/constants.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, plural } from '../../../shared/format.ts';
import { finSession, joursSession, joursTexte, plageCourte, sessionDu, surPlusieursJours } from '../../../shared/rules/plage-session.ts';
import { convocationEnvoyee, exigeEvaluation, type Inscrit, inscritsDe, listeOrganisme, resultatsDe } from '../../../shared/rules/sessions.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Tag, Two } from '../components/ui.tsx';
import type { NomAction } from '../api.ts';
import { downloadCsv } from '../print.ts';
import { useEnriched, useRole } from '../state/derived.ts';
import { desinscription } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';

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
    notify(`Liste exportée — ${plural(l.rows.length, 'inscrit', 'inscrits')}`);
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
      <Dialog title="Annuler la session" width={540} onSubmit={() => { if (!busy) act('session.annuler', { id: s.id, motif: motif.trim() }); }} actions={<>
        <button type="button" className="btn btn-secondary" onClick={() => setAnnulation(false)}>Retour</button>
        <SubmitButton busy={busy}>Annuler la session</SubmitButton>
      </>}>
        <Field label="Session"><Static>{fm?.nom ?? s.formation} · {plageCourte(s)} · {s.lieu}</Static></Field>
        <Field label="Motif (facultatif)" htmlFor="sd-motif">
          <textarea className="input short" id="sd-motif" rows={2} maxLength={500} placeholder="Report par l’organisme, effectif insuffisant…" value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>
          {inscrits.length
            ? `${plural(inscrits.length, 'inscrit redevient', 'inscrits redeviennent')} à planifier : les recyclages reviennent dans les échéances, les formations initiales sont à replanifier depuis la fiche du collaborateur.`
            : 'Aucun inscrit.'}
          {plan?.statut === 'engage' ? ' L’action du plan engagée pour cette session redevient « prévue » si aucune autre session ne la porte.' : ''}
          {convoques ? ` ${convoques > 1 ? `Les ${convoques} convocations déjà envoyées sont annulées` : 'La convocation déjà envoyée est annulée'} par e-mail, sans le motif.` : ''}
        </Fine>
      </Dialog>
    );
  }

  return (
    <Dialog title={titre} width={680} tall actions={<>
      <CancelButton label="Fermer" />
      {formations && cloturable && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'cloture', sessionId: s.id })}>Clôturer la session</button>}
      {formations && ouverte && !cloturable && s.statut === 'À confirmer' && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('session.confirmer', { id: s.id })}>Confirmer la session</button>
      )}
    </>}>
      <div className="grid-2">
        <Field label="Formation"><Static>{fm?.nom ?? s.formation}<div className="text-muted sub">{fm?.organisme} · {fm?.duree}</div></Static></Field>
        <Field label="Statut"><Static><Tag cls={SESS_CLS[statut]}>{statut}</Tag></Static></Field>
        <Field label={surPlusieursJours(s) ? 'Dates et lieu' : 'Date et lieu'}><Static>{plageCourte(s)}<div className="text-muted sub">{s.lieu}</div></Static></Field>
        <Field label="Places"><Static>{ouverte ? `${s.inscrits} / ${s.places}` : s.statut === 'Clôturée' ? plural(s.inscrits, 'inscrit', 'inscrits') : `${s.places} (annulée)`}<div className="text-muted sub">Validation : {VALIDATION_LABEL[exigeEvaluation(fm) ? 'evaluation' : 'presence'].toLowerCase()}</div></Static></Field>
      </div>
      {plan && <Fine>Action du plan {plan.exercice} · {plan.equipe} · {plan.periode} · {PLAN_LABEL[plan.statut].toLowerCase()}</Fine>}
      {(surPlusieursJours(s) || s.horaires.length > 0) && (
        <Field label={surPlusieursJours(s) ? `Jours de la session (${joursSession(s).length})` : 'Horaires'}>
          <Static>{joursTexte(s).map(j => <div key={j}>{j}</div>)}</Static>
        </Field>
      )}

      {ouverte && <>
        <div className="panel-head center">
          <h3 className="section-label">Inscrits</h3>
          <div className="actions-end">
            {formations && convocable && aEnvoyer.length > 0 && (
              <Btn small variant="secondary" icon={<PaperPlaneTiltIcon size={14} />} disabled={busy} onClick={() => convoquer()}>Envoyer les convocations ({aEnvoyer.length})</Btn>
            )}
            <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={!inscrits.length}>Exporter la liste (CSV)</Btn>
            {formations && <>
              <Btn small icon={<PencilSimpleIcon size={14} />} onClick={() => openDialog({ type: 'session', sessionId: s.id })}>Modifier</Btn>
              <Btn small icon={<XCircleIcon size={14} />} onClick={() => setAnnulation(true)}>Annuler la session</Btn>
            </>}
          </div>
        </div>
        {inscrits.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Équipe</th><th>Parcours</th><th>Convocation</th>{formations && convocable && <th></th>}</tr></thead>
              <tbody>
                {inscrits.map(i => (
                  <tr key={i.empId}>
                    <td><Two main={i.nom} sub={i.poste} /></td>
                    <td className="text-muted nowrap">{equipeLabel(i)}</td>
                    <td>
                      <Two main={i.parcours === 'recyclage' ? 'Recyclage' : 'Formation initiale'}
                        sub={i.dejaObtenue ? `Déjà renouvelée le ${fmt(parse(i.dejaObtenue.obtenue))}` : i.obtenue ? `Obtenue le ${fmt(parse(i.obtenue))}` : ''} />
                    </td>
                    <td>
                      <Tag cls={i.convoc === 'now' ? 'tag-neutral' : 'tag-outline'}>{i.convoc === 'now' ? 'Envoyée' : i.convocLe ? 'À renvoyer' : 'À envoyer'}</Tag>
                      {i.convocLe && <div className="text-muted sub nowrap">{i.convoc === 'now' ? 'le' : 'envoyée le'} {fmtShort(parse(i.convocLe))}</div>}
                    </td>
                    {formations && convocable && (
                      <td className="right">
                        <div className="actions-end">
                          {!i.dejaObtenue && <Btn small disabled={busy} onClick={() => convoquer(i)}>{convocationEnvoyee(i) ? 'Renvoyer' : 'Envoyer'}</Btn>}
                          {aVenir && <Btn small disabled={busy} onClick={() => desinscrire(i)}>Désinscrire</Btn>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty pad="sm">Aucun inscrit pour l’instant.</Empty>}
        {formations && s.statut === 'À confirmer' && !cloturable && (
          <Fine>Confirmez la session une fois la date validée par {fm?.organisme ?? 'l’organisme'}, et transmettez-lui cette liste (export CSV). Les convocations partent par e-mail aux inscrits, avec le fichier qui ajoute la session à leur agenda.</Fine>
        )}
        {cloturable && <NoteAccent>{dernier < d.ti ? 'Session passée — à clôturer : présence, résultats et certifications.' : surPlusieursJours(s) ? 'Dernier jour de la session : clôturez-la une fois terminée.' : 'Session du jour : clôturez-la une fois terminée.'}</NoteAccent>}
      </>}

      {s.statut === 'Clôturée' && <>
        <h3 className="section-label">Résultats</h3>
        {resultats.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Parcours</th><th>Présence</th><th>Résultat</th></tr></thead>
              <tbody>
                {resultats.map(r => (
                  <tr key={r.p.id}>
                    <td><Two main={r.nom} sub={equipeLabel(r)} /></td>
                    <td>{r.p.parcours === 'recyclage' ? 'Recyclage' : 'Formation initiale'}</td>
                    <td>{r.p.present ? 'Présent' : 'Absent'}</td>
                    <td><Tag cls={r.obtenue ? 'tag-neutral' : 'tag-accent'}>{r.label}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty pad="sm">Aucun inscrit.</Empty>}
        <Fine>
          Clôturée le {s.bilan ? fmt(parse(s.bilan.le)) : '—'}{s.bilan?.par ? ` par ${s.bilan.par}` : ''} · validation : {fm && exigeEvaluation(fm) ? 'évaluation réussie requise' : 'présence'}.
          {s.bilan?.note != null ? ` Évaluation à chaud : ${s.bilan.note} / 5.` : ' Évaluation à chaud non renseignée.'}
        </Fine>
        {s.bilan?.commentaire && <p className="boxed" style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{s.bilan.commentaire}</p>}
      </>}

      {s.statut === 'Annulée' && (
        <Fine>Annulée le {s.bilan ? fmt(parse(s.bilan.le)) : '—'}{s.bilan?.par ? ` par ${s.bilan.par}` : ''}{s.bilan?.motif ? ` — ${s.bilan.motif}` : ''}.</Fine>
      )}
    </Dialog>
  );
}
