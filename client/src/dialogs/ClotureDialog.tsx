// Clôture d'une session passée (service RH) : présence de chaque inscrit et, si la formation l'exige,
// résultat de l'évaluation ; évaluation à chaud facultative. Présents (et reçus) : certification datée
// du jour de la session ; absents ou échecs : à replanifier. Tout est enregistré en une fois.
import { useMemo, useState } from 'react';
import { VALIDATION_LABEL } from '../../../shared/constants.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, plural } from '../../../shared/format.ts';
import { exigeEvaluation, inscritsDe } from '../../../shared/rules/sessions.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Empty, Fine, Seg, Tag } from '../components/ui.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ClotureDialog({ sessionId }: { sessionId: number }) {
  const { d } = useEnriched();
  const { run, closeDialog } = useStore();
  const s = d.session(sessionId);
  const inscrits = useMemo(() => s ? inscritsDe(d, s) : [], [d, s]);
  // Présent par défaut ; le résultat de l'évaluation se choisit toujours explicitement.
  const [presence, setPresence] = useState<Record<number, 'p' | 'a'>>({});
  const [resultat, setResultat] = useState<Record<number, 'ok' | 'ko'>>({});
  const [note, setNote] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const fm = d.fm(s.formation);
  if (!sessionActive(s) || s.date > d.ti) {
    return (
      <Dialog title="Clôturer la session" actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>{sessionActive(s) ? 'La session n’a pas encore eu lieu.' : `Session ${s.statut.toLowerCase()}.`}</p>
      </Dialog>
    );
  }
  const evaluation = exigeEvaluation(fm);
  const present = (id: number) => (presence[id] ?? 'p') === 'p';
  const decider = inscrits.filter(i => !i.dejaObtenue);
  const manquants = evaluation ? decider.filter(i => present(i.empId) && !resultat[i.empId]) : [];
  const obtenues = decider.filter(i => present(i.empId) && (!evaluation || resultat[i.empId] === 'ok')).length;
  const aReplanifier = decider.filter(i => !present(i.empId) || (evaluation && resultat[i.empId] === 'ko')).length;
  // L'action du plan passe « réalisée » si aucune autre session ouverte ne la porte.
  const plan = s.planId ? d.ds.plan.find(l => l.id === s.planId && l.statut !== 'realise') : undefined;
  const realise = !!plan && !d.ds.sessions.some(x => x.id !== s.id && x.planId === s.planId && sessionActive(x));
  const quand = fmt(parse(s.date));

  const confirm = async () => {
    setBusy(true);
    const r = await run('session.cloturer', {
      id: s.id,
      participants: decider.map(i => ({ empId: i.empId, present: present(i.empId), reussi: evaluation && present(i.empId) ? resultat[i.empId] === 'ok' : null })),
      note: note ? Number(note) : null,
      commentaire: commentaire.trim(),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Clôturer la session" width={640} tall actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={manquants.length > 0 || busy} onClick={confirm}>Clôturer la session</button>
    </>}>
      <div className="grid-2">
        <Field label="Session"><Static>{fm?.nom ?? s.formation}<div className="text-muted sub">{quand} · {s.lieu}</div></Static></Field>
        <Field label="Validation"><Static>{VALIDATION_LABEL[evaluation ? 'evaluation' : 'presence']}<div className="text-muted sub">{fm?.organisme}</div></Static></Field>
      </div>

      <Field label={`Inscrits (${inscrits.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {inscrits.map(i => (
            <div key={i.empId} className="boxed" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{i.nom}</div>
                <div className="text-muted sub">{equipeLabel(i)} · {i.parcours === 'recyclage' ? `recyclage (obtenue le ${fmt(parse(i.obtenue!))})` : 'formation initiale'}</div>
              </div>
              {i.dejaObtenue
                ? <Tag cls="tag-neutral">Déjà renouvelée le {fmt(parse(i.dejaObtenue.obtenue))}</Tag>
                : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Seg name={`pres-${i.empId}`} label={`Présence de ${i.nom}`} value={presence[i.empId] ?? 'p'}
                      onChange={v => setPresence(x => ({ ...x, [i.empId]: v }))} options={[['p', 'Présent'], ['a', 'Absent']]} />
                    {evaluation && present(i.empId) && (
                      <Seg name={`res-${i.empId}`} label={`Évaluation de ${i.nom}`} value={resultat[i.empId] ?? ('' as 'ok')}
                        onChange={v => setResultat(x => ({ ...x, [i.empId]: v }))} options={[['ok', 'Réussie'], ['ko', 'Échouée']]} />
                    )}
                  </div>
                )}
            </div>
          ))}
          {inscrits.length === 0 && <Empty pad="sm">Aucun inscrit : la session sera clôturée sans certification.</Empty>}
        </div>
      </Field>
      {manquants.length > 0 && <p className="form-error">Résultat de l’évaluation à renseigner : {manquants.map(i => i.nom).join(', ')}.</p>}

      <div className="grid-2">
        <Field label="Évaluation à chaud (facultative)" htmlFor="cl-note">
          <select className="input" id="cl-note" value={note} onChange={e => setNote(e.target.value)}>
            <option value="">Non renseignée</option>
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} / 5</option>)}
          </select>
        </Field>
      </div>
      <Field label="Commentaire (facultatif)" htmlFor="cl-comm">
        <textarea className="input short" id="cl-comm" rows={2} maxLength={1000} placeholder="Retours des participants, qualité de l’animation, organisation…"
          value={commentaire} onChange={e => setCommentaire(e.target.value)} />
      </Field>
      <Fine>
        À la validation : {plural(obtenues, 'certification enregistrée', 'certifications enregistrées')}, datée{obtenues > 1 ? 's' : ''} du {quand}
        {aReplanifier ? ` · ${plural(aReplanifier, 'inscrit', 'inscrits')} à replanifier (recyclage de nouveau à planifier, formation initiale à réinscrire)` : ''}
        {realise ? ' · action du plan réalisée' : ''}. La clôture est définitive.
      </Fine>
    </Dialog>
  );
}
