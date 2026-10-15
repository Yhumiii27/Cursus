// Compte rendu d'entretien : sections rédigées par l'évaluateur et le salarié, clôture, signatures, impression.
// Un entretien se clôt une fois tenu : prévu à une date à venir, l'évaluateur indique la date à laquelle il a eu lieu,
// pas avant sa planification (`debutCloture`).
import { useEffect, useRef, useState } from 'react';
import { ENT_TYPES, type EntSection } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt } from '../../../shared/format.ts';
import { debutCloture, needsFinCarriere, obligations } from '../../../shared/rules/entretiens.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { printDocument, type PrintSection } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const FIN_CARRIERE: EntSection = ['fincarriere', 'Fin de carrière : maintien dans l’emploi, aménagements souhaités', 'sal'];
const INFO_LABEL = 'Information remise : CPF, VAE, conseil en évolution professionnelle (CEP), abondement employeur';
const whoLabel = (who: EntSection[2]) => who === 'mgr' ? 'Évaluateur' : 'Salarié';

export function EntDialog({ entId }: { entId: number }) {
  const d = useDomain();
  const { rh, manager, collab, me, soi } = useRole();
  const { run, closeDialog, notify, openDialog } = useStore();
  const x = d.ds.entretiens.find(y => y.id === entId);
  const e = x ? d.emp(x.empId) : undefined;

  // Texte saisi (local) et dernière valeur envoyée au serveur, par section.
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...(x?.cr ?? {}) }));
  const [info, setInfo] = useState(!!x?.info);
  const [busy, setBusy] = useState(false);
  // Date à laquelle l'entretien a eu lieu, demandée quand la date prévue n'est pas encore passée.
  const [tenu, setTenu] = useState(d.ti);
  const saved = useRef<Record<string, string>>({ ...(x?.cr ?? {}) });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const valsRef = useRef(vals);
  valsRef.current = vals;

  const T0 = x ? ENT_TYPES[x.type] : null;
  const mgr = e ? d.mgrOf(e) : 0;
  // Évaluateur : manager direct ou service RH, jamais un membre du RH pour son propre entretien.
  const canMgr = !!x && x.statut === 'planifie' && ((rh && x.empId !== soi) || (manager && mgr === me));
  const canSal = !!x && !x.signSal && collab && x.empId === me;
  const sections: EntSection[] = x && e && T0 ? [...T0.sections, ...(needsFinCarriere(d, e, x.type) ? [FIN_CARRIERE] : [])] : [];
  const editable = sections.filter(([, , who]) => who === 'mgr' ? canMgr : canSal || canMgr).map(([k]) => k);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /** Enregistre une section si elle a changé ; les envois sont sérialisés. */
  const save = (k: string, value: string) => {
    if (!x || (saved.current[k] ?? '') === value) return queue.current;
    saved.current[k] = value;
    queue.current = queue.current.then(() => run('entretien.modifier', { id: x.id, section: k, value }, { silent: true }));
    return queue.current;
  };
  const flush = async () => {
    editableRef.current.forEach(k => save(k, valsRef.current[k] ?? ''));
    await queue.current;
  };
  // Fermeture du dialogue (Échap, fond, « Fermer ») : rien de ce qui a été saisi n'est perdu.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { flushRef.current(); }, []);

  if (!x || !e || !T0) return null;

  const hasInfo = ['epp', 'reprise'].includes(x.type);
  const bilan = x.type === 'bilan' ? obligations(d, [e.id]).find(o => o.kind === 'bilan') : undefined;
  const canSign = collab && x.empId === me && x.statut === 'realise' && !x.signSal;
  const evaluateur = d.mgrName(mgr);
  const status = x.statut === 'planifie'
    ? `Planifié le ${fmt(parse(x.date))} — le salarié peut préparer sa partie à l’avance.`
    : !x.signSal
      ? `Clos et signé par l’évaluateur le ${fmt(parse(x.signMgr ?? x.date))} — en attente de la signature du salarié.`
      : `Signé par les deux parties le ${fmt(parse(x.signSal))} — copie remise au salarié.`;

  const toggleInfo = async (checked: boolean) => {
    setInfo(checked);
    const r = await run('entretien.modifier', { id: x.id, info: checked }, { silent: true });
    if (!r.ok) setInfo(!checked);
  };

  const aVenir = x.statut === 'planifie' && x.date > d.ti;
  const debut = debutCloture(d, x);
  const tenuErr = !aVenir ? '' : !isValidDate(tenu) ? 'Date invalide.' : tenu > d.ti ? 'Aujourd’hui au plus tard.'
    : tenu < debut.min ? `Le ${fmt(parse(debut.min))} au plus tôt (${debut.raison}).` : '';

  const finish = async (action: 'entretien.clore' | 'entretien.signer') => {
    setBusy(true);
    await flush();
    const r = await run(action, action === 'entretien.clore' && aVenir ? { id: x.id, date: tenu } : { id: x.id });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  // Entretien à déplacer (absence accordée ce jour-là, empêchement) ou non tenu : la planification le reprogramme.
  const reprogrammer = async () => {
    await flush();
    openDialog({ type: 'entPlan', empId: x.empId, kind: x.type });
  };

  const download = () => {
    const doc: PrintSection[] = [
      { title: 'Entretien', rows: [
        ['Collaborateur', `${e.nom} — ${e.poste}, ${equipeLabel(e)}`],
        ['Date de l’entretien', fmt(parse(x.date))],
        ['Évaluateur', evaluateur],
      ] },
      { title: 'Base légale', text: T0.base },
      ...(bilan ? [{ title: 'Contrôle automatique', text: bilan.detail }] : []),
      ...sections.map(([k, label, who]) => ({ title: `${label} · ${whoLabel(who)}`, text: x.cr[k]?.trim() || 'Non renseigné' })),
      ...(hasInfo ? [{ title: 'Information du salarié', text: x.info ? `${INFO_LABEL}.` : 'Information sur le CPF, la VAE, le CEP et l’abondement employeur non remise.' }] : []),
      { title: 'Signatures', rows: [
        ['Évaluateur', x.signMgr ? `${evaluateur} — signé le ${fmt(parse(x.signMgr))}` : 'Non signé'],
        ['Salarié', x.signSal ? `${e.nom} — signé le ${fmt(parse(x.signSal))}` : 'Non signé'],
      ] },
    ];
    const ok = printDocument(`${T0.nom} — compte rendu`, `${e.nom} · ${e.poste} · ${fmt(parse(x.date))}`, doc, e.id);
    if (!ok) notify('Autorisez les fenêtres surgissantes pour télécharger le compte rendu', true);
  };

  return (
    <Dialog title={T0.nom} label="Entretien" width={720} tall actions={<>
      <CancelButton label="Fermer" />
      {!!x.signSal && <button type="button" className="btn btn-ghost" onClick={download}>Télécharger le compte rendu</button>}
      {canSign && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => finish('entretien.signer')}>Signer le compte rendu</button>}
      {canMgr && <button type="button" className="btn btn-secondary" disabled={busy} onClick={reprogrammer}>Reprogrammer</button>}
      {canMgr && <button type="button" className="btn btn-primary" disabled={busy || !!tenuErr} onClick={() => finish('entretien.clore')}>Clore et signer</button>}
    </>}>
      <div>
        <div style={{ fontSize: 14 }}>{e.nom} · {e.poste} · {fmt(parse(x.date))}</div>
        <div className="text-muted sub">Évaluateur : {evaluateur}</div>
      </div>
      <Fine>{T0.base}</Fine>
      {bilan && <div className="boxed" style={{ fontSize: 13, padding: 'var(--space-3)' }}>Contrôle automatique : {bilan.detail}</div>}
      {sections.map(([k, label, who]) => {
        const ed = editable.includes(k);
        return (
          <Field key={k} htmlFor={ed ? `ent-${k}` : undefined} label={<>{label} <span className="text-muted who">· {whoLabel(who)}</span></>}>
            {ed
              ? <textarea className="input mid" id={`ent-${k}`} rows={3} value={vals[k] ?? ''}
                  onChange={ev => setVals(s => ({ ...s, [k]: ev.target.value }))} onBlur={ev => { save(k, ev.target.value); }} />
              : <div className="text-n300" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{x.cr[k] || 'Non renseigné'}</div>}
          </Field>
        );
      })}
      {hasInfo && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
          <input type="checkbox" checked={info} disabled={!canMgr} onChange={ev => toggleInfo(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {INFO_LABEL}
        </label>
      )}
      {canMgr && aVenir && (
        <Field label="Date à laquelle l’entretien a eu lieu" htmlFor="ent-tenu">
          <input className="input" id="ent-tenu" type="date" min={debut.min} max={d.ti} value={tenu} onChange={ev => setTenu(ev.target.value)} aria-invalid={tenuErr ? true : undefined} />
          {tenuErr
            ? <p className="fine note-accent">{tenuErr}</p>
            : <Fine>Prévu le {fmt(parse(x.date))} : la clôture enregistre la date réelle de l’entretien (échéance suivante, état des lieux à 8 ans).</Fine>}
        </Field>
      )}
      <p className="fine note-accent">{status}</p>
    </Dialog>
  );
}
