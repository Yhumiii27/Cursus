// Délivrer ou renouveler une habilitation, après contrôle des prérequis ; le titre à signer s'imprime aussitôt après (t115,
// client/src/titre-habilitation.ts), case cochée par défaut. Un renouvellement garde la délivrance précédente à l'historique.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import { erreurDate, erreurTexte } from '../components/controles.ts';
import { Bloquant, CancelButton, CheckList, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { ReferentielVide } from '../components/ReferentielVide.tsx';
import { useEnriched } from '../state/derived.ts';
import { t } from '../i18n/langue.ts';
import { useStore } from '../state/store.tsx';
import { imprimerTitre, MODELE_TITRE_COURT } from '../titre-habilitation.ts';

export function HabDialog({ empId: empId0, h: h0, mode }: { empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }) {
  const { d, emps, horizon } = useEnriched();
  const { run, closeDialog, notify } = useStore();
  // Habilitations en vigueur (référentiel), et celle du titre visé même archivée : le serveur dira pourquoi il refuse.
  const habs = d.ds.referentiels.habilitations.filter(x => actif(x) || x.id === h0);
  const [empId, setEmpId] = useState<number>(empId0 ?? d.ds.employes[0]?.id ?? 0);
  const [h, setH] = useState<string>(h0 ?? habs[0]?.id ?? '');
  const [date, setDate] = useState<string>(d.ds.today);
  const [par, setPar] = useState<string>(d.hm(h0 ?? habs[0]?.id ?? '')?.signataire ?? '');
  const [busy, setBusy] = useState(false);
  const [imprimer, setImprimer] = useState(true);
  const v = useVerification();
  // Titre d'habilitation signé joint à la délivrance (pièce justificative, components/PieceJointe.tsx).
  const piece = usePieceJointe();
  const emp = emps.find(e => e.id === empId) ?? emps[0];
  const hm = d.hm(h);
  if (!habs.length) return <ReferentielVide titre={t('Issue an authorisation')} onglet="habilitations" texte={t('No authorisation in the reference data.')} />;
  if (!emp || !hm) return null;

  const lock = mode !== 'new';
  const valid = isValidDate(date);
  const info = d.habInfo({ h, delivree: valid ? date : null }, emp.rawCerts, emp.med, horizon);
  const checks = info.checks.map(c => ({
    key: c.label, label: c.label, text: c.text,
    cls: c.ok ? (c.due ? 'tag-outline' : 'tag-neutral') : 'tag-accent', statut: c.ok ? (c.due ? t('To renew') : 'OK') : t('Missing'),
  }));
  // Une suspension se lève d'abord ; après un retrait, la nouvelle délivrance est possible, à partir de la date du retrait.
  const titre = emp.habs.find(x => x.h === h && x.delivree);
  const suspendu = titre?.mesure === 'suspension';
  const retraitLe = titre?.mesure === 'retrait' ? titre.mesureDate : null;
  const avantRetrait = valid && !!retraitLe && date < retraitLe;
  // Blocage du titre (suspension, prérequis) : affiché en accent et ciblé à l'envoi ; sinon la validité.
  const blocage = suspendu ? `${t('Title suspended on ')}${fmt(titre.mesureLe!)}${t(' — lift the suspension first.')}`
    : !info.prereqOk ? `${t('Issue impossible')} — ${info.failing.map(c => c.label).join(', ')}.` : null;
  const hint = `${t('Validity ')}${validiteLabel(hm.validite)}${valid ? t(' — the title will expire on ') + fmt(addMonths(parse(date), hm.validite)) : ''}.${retraitLe ? ` ${t('New issue after the withdrawal of ')}${fmt(parse(retraitLe))}.` : ''}`;
  const dateErr = erreurDate(date, t('Enter the issue date.'))
    ?? (avantRetrait ? `${t('New issue before the withdrawal of ')}${fmt(parse(retraitLe!))}${t(': choose a later date.')}` : null);
  const parErr = erreurTexte(par, t('Enter the signatory.'));
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
    if (!r.ok) return;
    closeDialog();
    if (imprimer && !imprimerTitre(emp, hm, { delivree: date, par: par.trim() })) notify(t('Authorisation issued — allow pop-up windows to print the title'), true);
  };

  return (
    <Dialog title={mode === 'renew' ? t('Renew an authorisation') : t('Issue an authorisation')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{mode === 'renew' ? t('Renew the title') : t('Issue the title')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')} htmlFor="hab-emp">
          <select className="input" id="hab-emp" value={emp.id} disabled={lock} onChange={e => setEmpId(Number(e.target.value))}>
            {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
        <Field label={t('Authorisation')} htmlFor="hab-h">
          <select className="input" id="hab-h" value={h} disabled={lock} onChange={e => changeH(e.target.value)}>
            {habs.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('Prerequisite check')}><CheckList checks={checks} /></Field>
      <div className="grid-2">
        <Field label={t('Issue date')} htmlFor="hab-date" requis erreur={avantRetrait ? dateErr : v.erreur(dateErr)}>
          <input className="input" id="hab-date" type="date" min={retraitLe ?? undefined} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label={t('Signatory (employer)')} htmlFor="hab-par" requis erreur={v.erreur(parErr)}><input className="input" id="hab-par" type="text" value={par} onChange={e => setPar(e.target.value)} /></Field>
      </div>
      <PiecesJointes objet="habTitre" objetId={emp.habs.find(x => x.h === h)?.id} label={t('Signed titles already attached')} />
      <ChoixPiece piece={piece} id="hab-piece" label={t('Signed authorisation title (optional)')} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={imprimer} onChange={e => setImprimer(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
        {t('Print the title to sign after the issue')} ({t(MODELE_TITRE_COURT[hm.modele ?? 'generique'])})
      </label>
      {blocage ? <Bloquant>{blocage}</Bloquant> : <p className="text-muted fine">{hint}</p>}
    </Dialog>
  );
}
