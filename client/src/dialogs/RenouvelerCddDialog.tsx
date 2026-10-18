// Renouvellement d'un CDD (service RH, t053) : nouveau terme, date de signature de l'avenant et sa référence. Le
// renouvellement s'inscrit dans l'historique des contrats ; la fiche garde le terme initial. Durée maximale et nombre de
// renouvellements (shared/rules/cdd.ts) sont rappelés avant l'envoi, sans bloquer : le serveur répète les mêmes avertissements.
import { useState } from 'react';
import { addD, isValidDate } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { controleCdd, dureeMaxCdd, estMotifRecours, MOTIFS_RECOURS, renouvellementsMax } from '../../../shared/rules/cdd.ts';
import { renouvellementsDe } from '../../../shared/rules/historique-contrat.ts';
import { erreurDate } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Référence d'un avenant : 60 caractères au plus (contrôlé aussi par le serveur). */
const REFERENCE_MAX = 60;

export function RenouvelerCddDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const [jusquau, setJusquau] = useState('');
  const [signeLe, setSigneLe] = useState(d.ti);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh || emp.typeContrat !== 'cdd' || !emp.fin) return null;

  const fin = emp.fin, s = d.ds.settings;
  const deja = renouvellementsDe(d, emp.id);
  const motif = estMotifRecours(emp.motifRecours) ? emp.motifRecours : null;
  const errJusquau = erreurDate(jusquau, 'Indiquez le nouveau terme du contrat.') ?? (jusquau <= fin ? `Nouveau terme après la fin actuelle, à partir du ${fmtIso(addD(fin, 1))}.` : null);
  const errSigne = erreurDate(signeLe, 'Indiquez la date de signature de l’avenant.') ?? (signeLe > d.ti ? 'Date de signature future : enregistrez le renouvellement une fois l’avenant signé.' : null);
  const errRef = reference.trim().length > REFERENCE_MAX ? `${REFERENCE_MAX} caractères au plus.` : null;
  // Avertissements du serveur, calculés sur la saisie : durée maximale, renouvellements admis.
  const avert = isValidDate(jusquau) && jusquau > fin
    ? controleCdd({ ...emp, fin: jusquau, cddFinInitiale: emp.cddFinInitiale ?? fin }, { renouvellements: deja.length + 1, reglages: s }).warnings : [];
  const max = motif ? dureeMaxCdd(motif, s) : null, nMax = renouvellementsMax(motif, s);

  const confirm = async () => {
    if (busy || !v.verifier(errJusquau, errSigne, errRef)) return;
    setBusy(true);
    const r = await run('employe.renouvelerCdd', { id: emp.id, jusquau, signeLe, reference: reference.trim() || null });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Renouveler le CDD" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Renouveler</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Fin actuelle du contrat">
          <Static>{fmtIso(fin)}<div className="text-muted sub">Entrée le {fmtIso(emp.entree)}{emp.cddFinInitiale && emp.cddFinInitiale !== fin ? ` · terme initial le ${fmtIso(emp.cddFinInitiale)}` : ''}</div></Static>
        </Field>
      </div>
      <div className="boxed text-muted sub">
        {motif ? MOTIFS_RECOURS[motif].label : 'Motif de recours non renseigné (fiche)'} · {deja.length ? plural(deja.length, 'renouvellement déjà enregistré', 'renouvellements déjà enregistrés') : 'aucun renouvellement enregistré'}
        {` · ${plural(nMax.n, 'renouvellement admis', 'renouvellements admis')} (${nMax.texte})`}{max ? ` · durée maximale ${max.texte}` : ''}
      </div>
      <div className="grid-2">
        <Field label="Nouveau terme" htmlFor="rc-jusquau" requis erreur={v.erreur(errJusquau)}>
          <input className="input" id="rc-jusquau" type="date" min={addD(fin, 1)} value={jusquau} onChange={ev => setJusquau(ev.target.value)} />
        </Field>
        <Field label="Avenant signé le" htmlFor="rc-signe" requis erreur={v.erreur(errSigne)}>
          <input className="input" id="rc-signe" type="date" min={emp.entree} max={d.ti} value={signeLe} onChange={ev => setSigneLe(ev.target.value)} />
        </Field>
      </div>
      <Field label={<>Référence de l’avenant <span className="who">· facultatif</span></>} htmlFor="rc-ref" erreur={v.erreur(errRef)}>
        <input className="input" id="rc-ref" type="text" maxLength={REFERENCE_MAX + 20} placeholder="Avenant n° 2 du …" value={reference} onChange={ev => setReference(ev.target.value)} />
        <span className="text-muted sub">Gardée dans l’historique du contrat (service RH, paie) ; jamais recopiée au journal</span>
      </Field>
      {avert.map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
      <Fine>
        Le renouvellement est proposé au salarié avant le terme du contrat et prend la forme d’un avenant écrit (art. L1243-13). La fin du contrat devient
        le nouveau terme : échéance « Fin de CDD », sortie et période de paie la suivent. Rien n’est bloqué : vérifiez le contrat et l’accord de branche.
      </Fine>
    </Dialog>
  );
}
