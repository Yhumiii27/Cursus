// Demander une habilitation au service RH, avec le contrôle des prérequis :
// le collaborateur pour lui-même, ou le manager pour un membre de son équipe.
import { useState } from 'react';
import { habEnCours } from '../../../shared/domain.ts';
import { actifs } from '../../../shared/rules/referentiels.ts';
import { erreurTexte } from '../components/controles.ts';
import { Bloquant, CancelButton, CheckList, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ReferentielVide } from '../components/ReferentielVide.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { CibleField, useCible } from './ReqFormDialog.tsx';

export function ReqHabDialog({ empId }: { empId?: number | null }) {
  const { d, emps, horizon } = useEnriched();
  const { me: meId } = useRole();
  const { run, closeDialog } = useStore();
  const c = useCible(empId);
  const habs = actifs(d.ds.referentiels.habilitations);
  const [h, setH] = useState(habs[0]?.id ?? '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  // Manager : le membre concerné (éventuellement à choisir) ; collaborateur : lui-même.
  const who = c.pourMembre ? c.cible : emps.find(e => e.id === meId);
  if (!habs.length) return <ReferentielVide titre="Demander une habilitation" onglet="habilitations" texte="Aucune habilitation au référentiel." />;
  if (!h || (!c.pourMembre && !who)) return null;

  const info = who ? d.habInfo({ h }, who.rawCerts, who.med, horizon) : null;
  const already = !!who && (who.habs.some(x => x.h === h && habEnCours(x))
    || d.ds.demandesCollab.some(r => r.empId === who.id && r.type === 'habilitation' && r.h === h && r.statut === 'attente'));
  const checks = (info?.checks ?? []).map(x => ({
    key: x.label, label: x.label, text: x.text,
    cls: x.ok ? (x.due ? 'tag-outline' : 'tag-neutral') : 'tag-accent',
    statut: x.ok ? (x.due ? 'À renouveler' : 'OK') : 'Manquant',
  }));
  const hint = !who || !info
    ? 'Choisissez le collaborateur concerné pour contrôler ses prérequis.'
    : already
      ? (c.pourMembre ? `${who.nom} détient déjà ce titre, ou une demande est déjà en cours.` : 'Vous détenez déjà ce titre, ou une demande est déjà en cours.')
      : info.prereqOk
        ? 'Tous les prérequis sont satisfaits : le service RH pourra délivrer le titre.'
        : `Prérequis manquants (${info.failing.map(x => x.label).join(', ')}) : le service RH planifiera la formation ou la visite nécessaire.`;
  const cibleErr = !who ? 'Choisissez le collaborateur concerné.' : null;
  const motifErr = erreurTexte(motif, 'Indiquez le motif de la demande.');

  const confirm = async () => {
    if (busy || !v.verifier(cibleErr, already, motifErr) || !who) return;
    setBusy(true);
    const r = await run('demande.habilitation', { h, motif: motif.trim(), ...(c.pourMembre ? { empId: who.id } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Demander une habilitation" width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Envoyer la demande</SubmitButton>
    </>}>
      {c.pourMembre && <CibleField c={c} id="rh-emp" erreur={v.erreur(cibleErr)} />}
      <Field label="Habilitation" htmlFor="rh-h">
        <select className="input" id="rh-h" value={h} onChange={e => setH(e.target.value)}>
          {habs.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      {who && <Field label={c.pourMembre ? `Prérequis de ${who.nom}` : 'Vos prérequis'}><CheckList checks={checks} /></Field>}
      <Field label="Motif" htmlFor="rh-m" requis erreur={v.erreur(motifErr)}>
        <textarea className="input mid" id="rh-m" rows={3} placeholder="Pour quelles interventions ?" value={motif} onChange={e => setMotif(e.target.value)} />
      </Field>
      {already ? <Bloquant>{hint}</Bloquant> : <Fine>{hint}</Fine>}
      {c.pourMembre && who && <Fine>Demande transmise au service RH pour {who.nom}, qui contrôle les prérequis et délivre le titre.</Fine>}
    </Dialog>
  );
}
