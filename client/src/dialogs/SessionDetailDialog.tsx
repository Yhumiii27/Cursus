// Détail d'une session (service RH) : inscrits nominatifs, ou résultats après la clôture ; confirmation
// avec la liste à transmettre à l'organisme (affichage et export CSV), modification, annulation, clôture.
import { useState } from 'react';
import { DownloadSimpleIcon, PencilSimpleIcon, XCircleIcon } from '@phosphor-icons/react';
import { PLAN_LABEL, SESS_CLS, VALIDATION_LABEL } from '../../../shared/constants.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, plural } from '../../../shared/format.ts';
import { exigeEvaluation, inscritsDe, listeOrganisme, resultatsDe } from '../../../shared/rules/sessions.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Tag, Two } from '../components/ui.tsx';
import { downloadCsv } from '../print.ts';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function SessionDetailDialog({ sessionId }: { sessionId: number }) {
  const { d } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog, openDialog, notify } = useStore();
  const [annulation, setAnnulation] = useState(false);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const s = d.session(sessionId);
  if (!s) return null;
  const fm = d.fm(s.formation);
  const statut = d.sessionStatut(s);
  const ouverte = sessionActive(s);
  // Clôture possible le jour même ; confirmation tant que la session n'est pas passée.
  const cloturable = ouverte && s.date <= d.ti;
  const inscrits = ouverte ? inscritsDe(d, s) : [];
  const resultats = s.statut === 'Clôturée' ? resultatsDe(d, s) : [];
  const plan = s.planId ? d.ds.plan.find(l => l.id === s.planId) : undefined;
  const titre = `${fm?.court ?? s.formation} — ${fmt(parse(s.date))}`;

  const exporter = () => {
    const l = listeOrganisme(d, s);
    downloadCsv(l.fichier, l.head, l.rows);
    notify(`Liste exportée — ${plural(l.rows.length, 'inscrit', 'inscrits')}`);
  };
  const act = async (name: string, payload: Record<string, unknown>) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (annulation) {
    return (
      <Dialog title="Annuler la session" width={540} actions={<>
        <button type="button" className="btn btn-secondary" onClick={() => setAnnulation(false)}>Retour</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('session.annuler', { id: s.id, motif: motif.trim() })}>Annuler la session</button>
      </>}>
        <Field label="Session"><Static>{fm?.nom ?? s.formation} · {fmt(parse(s.date))} · {s.lieu}</Static></Field>
        <Field label="Motif (facultatif)" htmlFor="sd-motif">
          <textarea className="input short" id="sd-motif" rows={2} maxLength={500} placeholder="Report par l’organisme, effectif insuffisant…" value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>
          {inscrits.length
            ? `${plural(inscrits.length, 'inscrit redevient', 'inscrits redeviennent')} à planifier : les recyclages reviennent dans les échéances, les formations initiales sont à replanifier depuis la fiche du collaborateur.`
            : 'Aucun inscrit.'}
          {plan?.statut === 'engage' ? ' L’action du plan engagée pour cette session redevient « prévue » si aucune autre session ne la porte.' : ''}
        </Fine>
      </Dialog>
    );
  }

  return (
    <Dialog title={titre} width={680} tall actions={<>
      <CancelButton label="Fermer" />
      {rh && cloturable && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'cloture', sessionId: s.id })}>Clôturer la session</button>}
      {rh && ouverte && !cloturable && s.statut === 'À confirmer' && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('session.confirmer', { id: s.id })}>Confirmer la session</button>
      )}
    </>}>
      <div className="grid-2">
        <Field label="Formation"><Static>{fm?.nom ?? s.formation}<div className="text-muted sub">{fm?.organisme} · {fm?.duree}</div></Static></Field>
        <Field label="Statut"><Static><Tag cls={SESS_CLS[statut]}>{statut}</Tag></Static></Field>
        <Field label="Date et lieu"><Static>{fmt(parse(s.date))}<div className="text-muted sub">{s.lieu}</div></Static></Field>
        <Field label="Places"><Static>{ouverte ? `${s.inscrits} / ${s.places}` : s.statut === 'Clôturée' ? plural(s.inscrits, 'inscrit', 'inscrits') : `${s.places} (annulée)`}<div className="text-muted sub">Validation : {VALIDATION_LABEL[exigeEvaluation(fm) ? 'evaluation' : 'presence'].toLowerCase()}</div></Static></Field>
      </div>
      {plan && <Fine>Action du plan {plan.exercice} · {plan.equipe} · {plan.periode} · {PLAN_LABEL[plan.statut].toLowerCase()}</Fine>}

      {ouverte && <>
        <div className="panel-head center">
          <h3 className="section-label">Inscrits</h3>
          {rh && (
            <div className="actions-end">
              <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={!inscrits.length}>Exporter la liste (CSV)</Btn>
              <Btn small icon={<PencilSimpleIcon size={14} />} onClick={() => openDialog({ type: 'session', sessionId: s.id })}>Modifier</Btn>
              <Btn small icon={<XCircleIcon size={14} />} onClick={() => setAnnulation(true)}>Annuler la session</Btn>
            </div>
          )}
        </div>
        {inscrits.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Équipe</th><th>Parcours</th><th>Convocation</th></tr></thead>
              <tbody>
                {inscrits.map(i => (
                  <tr key={i.empId}>
                    <td><Two main={i.nom} sub={i.poste} /></td>
                    <td className="text-muted nowrap">{equipeLabel(i)}</td>
                    <td>
                      <Two main={i.parcours === 'recyclage' ? 'Recyclage' : 'Formation initiale'}
                        sub={i.dejaObtenue ? `Déjà renouvelée le ${fmt(parse(i.dejaObtenue.obtenue))}` : i.obtenue ? `Obtenue le ${fmt(parse(i.obtenue))}` : ''} />
                    </td>
                    <td><Tag cls={i.convoc === 'now' ? 'tag-neutral' : 'tag-outline'}>{i.convoc === 'now' ? 'Envoyée' : 'À envoyer'}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty pad="sm">Aucun inscrit pour l’instant.</Empty>}
        {rh && s.statut === 'À confirmer' && !cloturable && (
          <Fine>Confirmez la session une fois la date validée par {fm?.organisme ?? 'l’organisme'}, et transmettez-lui cette liste (export CSV) : l’envoi par e-mail viendra avec le module d’e-mails.</Fine>
        )}
        {cloturable && <NoteAccent>{s.date < d.ti ? 'Session passée — à clôturer : présence, résultats et certifications.' : 'Session du jour : clôturez-la une fois terminée.'}</NoteAccent>}
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
