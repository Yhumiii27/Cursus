// Compte rendu d'entretien : sections rédigées par l'évaluateur et le salarié, clôture, signatures, impression.
// Un entretien se clôt une fois tenu : prévu à une date à venir, l'évaluateur indique la date à laquelle il a eu lieu,
// pas avant sa planification (`debutCloture`).
// Chaque section s'enregistre en quittant le champ ; elle n'est réputée enregistrée qu'après la réponse du
// serveur. Une section refusée (ou un réseau coupé) interrompt la clôture et la signature : le compte rendu ne
// serait plus modifiable ensuite. La fermeture enregistre d'abord, et demande confirmation en cas d'échec ;
// « Fermer sans enregistrer » abandonne la saisie restante : ni le champ quitté pour cette confirmation, ni le
// démontage du dialogue ne l'envoient.
// Clore et signer sont définitifs : une confirmation remplace les boutons avant l'envoi.
import { useEffect, useRef, useState } from 'react';
import { ENT_TYPES, type EntSection } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt } from '../../../shared/format.ts';
import { debutCloture, needsFinCarriere, obligations } from '../../../shared/rules/entretiens.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { printDocument, type PrintSection } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { EnregistrementAuFil } from '../state/enregistrement.ts';
import { useStore } from '../state/store.tsx';

const FIN_CARRIERE: EntSection = ['fincarriere', 'Fin de carrière : maintien dans l’emploi, aménagements souhaités', 'sal'];
const INFO_LABEL = 'Information remise : CPF, VAE, conseil en évolution professionnelle (CEP), abondement employeur';
const whoLabel = (who: EntSection[2]) => who === 'mgr' ? 'Évaluateur' : 'Salarié';
/**
 * Focus pris par la confirmation de fermeture affichée après un échec (« Reprendre la saisie » ciblé à son
 * apparition, ou bouton choisi) : la section n'est pas renvoyée en quittant le champ, sans quoi un envoi parti
 * avant « Fermer sans enregistrer » écrirait après coup le texte abandonné.
 */
const versConfirmation = (cible: EventTarget | null) => cible instanceof Element && !!cible.closest('.confirmer-fermeture');

export function EntDialog({ entId }: { entId: number }) {
  const d = useDomain();
  const { rh, manager, collab, me, soi } = useRole();
  const { run, closeDialog, notify, openDialog } = useStore();
  const x = d.ds.entretiens.find(y => y.id === entId);
  const e = x ? d.emp(x.empId) : undefined;

  // Par section : texte saisi (local) et motif d'un refus ; l'enregistrement suit ce que le serveur a accepté.
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...(x?.cr ?? {}) }));
  const [info, setInfo] = useState(!!x?.info);
  const [busy, setBusy] = useState(false);
  // Date à laquelle l'entretien a eu lieu, demandée quand la date prévue n'est pas encore passée.
  const [tenu, setTenu] = useState(d.ti);
  // Clôture ou signature demandée, en attente de confirmation.
  const [aConfirmer, setAConfirmer] = useState<'entretien.clore' | 'entretien.signer' | null>(null);
  const [echecs, setEchecs] = useState<Record<string, string>>({});
  const runRef = useRef(run);
  runRef.current = run;
  const [enregistrement] = useState(() => new EnregistrementAuFil(
    x?.cr ?? {},
    (section, value) => runRef.current('entretien.modifier', { id: entId, section, value }, { silent: true }),
    (k, refus) => setEchecs(s => {
      const n = { ...s };
      if (refus) n[k] = refus; else delete n[k];
      return n;
    }),
  ));
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

  /** Enregistre les sections modifiables ; renvoie celles qui ne le sont pas telles qu'affichées. */
  const flush = () => enregistrement.toutEnregistrer(editableRef.current, valsRef.current);
  // Fermeture (Échap, fond, « Fermer ») : enregistrement d'abord (`enregistrer` de <Dialog>). Dialogue démonté
  // autrement (changement d'espace) : dernier envoi de ce qui reste, sauf si la personne a choisi « Fermer sans
  // enregistrer » (`abandonner` de <Dialog>, qui arrête l'enregistrement) : le texte abandonné n'arrive jamais
  // dans le compte rendu.
  useEffect(() => () => { enregistrement.toutEnregistrer(editableRef.current, valsRef.current); }, [enregistrement]);

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
    const restantes = await flush();
    if (restantes.length) {
      setBusy(false);
      setAConfirmer(null);
      const noms = sections.filter(([k]) => restantes.includes(k)).map(([, label]) => `« ${label} »`);
      notify(`${action === 'entretien.clore' ? 'Clôture' : 'Signature'} interrompue : ${noms.length > 1 ? `${noms.join(', ')} ne sont pas enregistrées` : `${noms[0] ?? 'une section'} n’est pas enregistrée`}. Réessayez une fois le problème réglé.`, true);
      return;
    }
    const r = await run(action, action === 'entretien.clore' && aVenir ? { id: x.id, date: tenu } : { id: x.id });
    setBusy(false);
    if (r.ok) closeDialog();
    else setAConfirmer(null);
  };
  const confirmation = aConfirmer && {
    texte: aConfirmer === 'entretien.clore'
      ? `Clore l’entretien${aVenir ? `, tenu le ${fmt(parse(tenu))},` : ''} et le signer ? Vos sections ne seront plus modifiables ; ${e.nom} pourra encore compléter les siennes, puis signer.`
      : 'Signer le compte rendu ? La signature est définitive : vos sections ne seront plus modifiables.',
    bouton: aConfirmer === 'entretien.clore' ? 'Clore et signer' : 'Signer',
    occupe: busy,
    confirmer: () => finish(aConfirmer),
    annuler: () => setAConfirmer(null),
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
    <Dialog title={T0.nom} width={720} tall enregistrer={async () => (await flush()).length === 0} abandonner={() => enregistrement.abandonner()}
      confirmation={confirmation} actions={<>
      <CancelButton label="Fermer" />
      {!!x.signSal && <button type="button" className="btn btn-ghost" onClick={download}>Télécharger le compte rendu</button>}
      {canSign && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setAConfirmer('entretien.signer')}>Signer le compte rendu</button>}
      {canMgr && <button type="button" className="btn btn-secondary" disabled={busy} onClick={reprogrammer}>Reprogrammer</button>}
      {canMgr && <button type="button" className="btn btn-primary" disabled={busy || !!tenuErr} onClick={() => setAConfirmer('entretien.clore')}>Clore et signer</button>}
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
              ? <textarea className="input mid" id={`ent-${k}`} rows={3} value={vals[k] ?? ''} aria-invalid={echecs[k] ? true : undefined}
                  aria-describedby={echecs[k] ? `ent-${k}-echec` : undefined}
                  onChange={ev => setVals(s => ({ ...s, [k]: ev.target.value }))} onBlur={ev => { if (!versConfirmation(ev.relatedTarget)) enregistrement.enregistrer(k, ev.target.value); }} />
              : <div className="text-n300" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{x.cr[k] || 'Non renseigné'}</div>}
            {ed && echecs[k] && <p className="form-error" id={`ent-${k}-echec`}>Non enregistrée : {echecs[k]}</p>}
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
