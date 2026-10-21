// Délivrer ou renouveler une habilitation, après contrôle des prérequis.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import { erreurDate, erreurTexte } from '../components/controles.ts';
import { Bloquant, CancelButton, CheckList, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { ReferentielVide } from '../components/ReferentielVide.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function HabDialog({ empId: empId0, h: h0, mode }: { empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }) {
  const { d, emps, horizon } = useEnriched();
  const { run, closeDialog } = useStore();
  // Habilitations en vigueur (référentiel), et celle du titre visé même archivée : le serveur dira pourquoi il refuse.
  const habs = d.ds.referentiels.habilitations.filter(x => actif(x) || x.id === h0);
  const [empId, setEmpId] = useState<number>(empId0 ?? d.ds.employes[0]?.id ?? 0);
  const [h, setH] = useState<string>(h0 ?? habs[0]?.id ?? '');
  const [date, setDate] = useState<string>(d.ds.today);
  const [par, setPar] = useState<string>(d.hm(h0 ?? habs[0]?.id ?? '')?.signataire ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  // Titre d'habilitation signé joint à la délivrance (pièce justificative, components/PieceJointe.tsx).
  const piece = usePieceJointe();
  const emp = emps.find(e => e.id === empId) ?? emps[0];
  const hm = d.hm(h);
  if (!habs.length) return <ReferentielVide titre="Délivrer une habilitation" onglet="habilitations" texte="Aucune habilitation au référentiel." />;
  if (!emp || !hm) return null;

  const lock = mode !== 'new';
  const valid = isValidDate(date);
  const info = d.habInfo({ h, delivree: valid ? date : null }, emp.rawCerts, emp.med, horizon);
  const checks = info.checks.map(c => ({
    key: c.label, label: c.label, text: c.text,
    cls: c.ok ? (c.due ? 'tag-outline' : 'tag-neutral') : 'tag-accent', statut: c.ok ? (c.due ? 'À renouveler' : 'OK') : 'Manquant',
  }));
  // Une suspension se lève d'abord ; après un retrait, la nouvelle délivrance est possible, à partir de la date du retrait.
  const titre = emp.habs.find(x => x.h === h && x.delivree);
  const suspendu = titre?.mesure === 'suspension';
  const retraitLe = titre?.mesure === 'retrait' ? titre.mesureDate : null;
  const avantRetrait = valid && !!retraitLe && date < retraitLe;
  // Blocage du titre (suspension, prérequis) : affiché en accent et ciblé à l'envoi ; sinon la validité.
  const blocage = suspendu ? `Titre suspendu le ${fmt(titre.mesureLe!)} — levez d’abord la suspension.`
    : !info.prereqOk ? `Délivrance impossible — ${info.failing.map(c => c.label).join(', ')}.` : null;
  const hint = `Validité ${validiteLabel(hm.validite)}${valid ? ' — le titre expirera le ' + fmt(addMonths(parse(date), hm.validite)) : ''}.${retraitLe ? ` Nouvelle délivrance après le retrait du ${fmt(parse(retraitLe))}.` : ''}`;
  const dateErr = erreurDate(date, 'Indiquez la date de délivrance.')
    ?? (avantRetrait ? `Nouvelle délivrance antérieure au retrait du ${fmt(parse(retraitLe!))} : choisissez une date postérieure.` : null);
  const parErr = erreurTexte(par, 'Indiquez le signataire.');
  const empOptions = [...d.ds.employes].sort((a, b) => a.nom.localeCompare(b.nom));

  const changeH = (id: string) => {
    setH(id);
    setPar(d.hm(id)?.signataire ?? '');
  };

  const confirm = async () => {
    if (busy || !v.verifier(blocage, dateErr, parErr, piece.erreur)) return;
    setBusy(true);
    const pieces = await piece.envoyer();
    if (!pieces) { setBusy(false); return; }
    const r = await run('hab.delivrer', { empId: emp.id, h, date, par: par.trim(), mode, ...(pieces.length ? { pieces } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={mode === 'renew' ? 'Renouveler une habilitation' : 'Délivrer une habilitation'} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{mode === 'renew' ? 'Renouveler le titre' : 'Délivrer le titre'}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur" htmlFor="hab-emp">
          <select className="input" id="hab-emp" value={emp.id} disabled={lock} onChange={e => setEmpId(Number(e.target.value))}>
            {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
        <Field label="Habilitation" htmlFor="hab-h">
          <select className="input" id="hab-h" value={h} disabled={lock} onChange={e => changeH(e.target.value)}>
            {habs.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Contrôle des prérequis"><CheckList checks={checks} /></Field>
      <div className="grid-2">
        <Field label="Date de délivrance" htmlFor="hab-date" requis erreur={avantRetrait ? dateErr : v.erreur(dateErr)}>
          <input className="input" id="hab-date" type="date" min={retraitLe ?? undefined} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label="Signataire (employeur)" htmlFor="hab-par" requis erreur={v.erreur(parErr)}><input className="input" id="hab-par" type="text" value={par} onChange={e => setPar(e.target.value)} /></Field>
      </div>
      <PiecesJointes objet="habTitre" objetId={emp.habs.find(x => x.h === h)?.id} label="Titres signés déjà joints" />
      <ChoixPiece piece={piece} id="hab-piece" label="Titre d’habilitation signé (facultatif)" />
      {blocage ? <Bloquant>{blocage}</Bloquant> : <p className="text-muted fine">{hint}</p>}
    </Dialog>
  );
}
