// Modification d'un déplacement par le service RH (`voyage.modifier`) : dates, destination et motif, avec les contrôles
// de la création (conflits de dates contrôlés en direct, le déplacement lui-même exclu). Un déplacement venu de Keystone
// garde la destination et le motif de son chantier : seules ses dates changent, et Keystone en est prévenu.
import { useState } from 'react';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { formalitesCaduques } from '../../../shared/rules/deplacements.ts';
import { actifs } from '../../../shared/rules/referentiels.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreursPeriode, erreurTexte } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function TripModifierDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const t = d.ds.voyages.find(v => v.id === id);
  const [dest, setDest] = useState(t?.dest ?? '');
  const [depart, setDepart] = useState(t?.depart ?? '');
  const [retour, setRetour] = useState(t?.retour ?? '');
  const [motif, setMotif] = useState(t?.motif ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = t ? d.emp(t.empId) : undefined;
  if (!t || !emp) return null;

  const keystone = t.origine === 'keystone';
  // Destinations en vigueur, plus celle du déplacement si elle a été archivée depuis.
  const dests = [...actifs(d.ds.referentiels.destinations), ...d.ds.referentiels.destinations.filter(x => x.code === t.dest && x.archive)];
  const destDef = d.destOf(dest);
  const dates = erreursPeriode(depart, retour, { du: 'Indiquez la date de départ.', au: 'Indiquez la date de retour.' });
  const motifErr = keystone ? null : erreurTexte(motif, 'Indiquez le motif du déplacement.');
  const destErr = destDef ? null : 'Choisissez la destination.';
  const conflits = !dates.du && !dates.au ? conflitsDates(d, emp.id, depart, retour, 'voyage', { voyageId: t.id }) : [];
  const inchange = dest === t.dest && depart === t.depart && retour === t.retour && motif.trim() === t.motif;
  // Formalités de détachement que la modification rend caduques (autre pays, période élargie, autre durée).
  const caduques = !dates.du && !dates.au ? formalitesCaduques(t, { dest, depart, retour }) : {};
  const aRefaire = [
    'detachementLe' in caduques ? 'le certificat de sécurité sociale' : '',
    'informationLe' in caduques ? 'l’information écrite de la mission' : '',
  ].filter(Boolean);

  const confirm = async () => {
    if (busy || !v.verifier(destErr, dates.du, dates.au, motifErr, blocage(conflits))) return;
    // Rien de changé : rien à enregistrer.
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const r = await run('voyage.modifier', keystone ? { id, depart, retour } : { id, dest, depart, retour, motif });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Modifier le déplacement" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        {keystone
          ? <Field label="Destination"><Static>{destDef?.pays ?? t.dest}</Static></Field>
          : (
            <Field label="Destination" htmlFor="tm-dest" erreur={v.erreur(destErr)}>
              <select className="input" id="tm-dest" value={dest} onChange={e => setDest(e.target.value)}>
                {dests.map(o => <option key={o.code} value={o.code}>{o.pays}{o.archive ? ' (archivée)' : ''}</option>)}
              </select>
            </Field>
          )}
      </div>
      <div className="grid-2">
        <Field label="Départ" htmlFor="tm-dep" requis erreur={v.erreur(dates.du)}><input className="input" id="tm-dep" type="date" value={depart} onChange={e => setDepart(e.target.value)} /></Field>
        <Field label="Retour" htmlFor="tm-ret" requis erreur={retour && dates.au && !dates.du ? dates.au : v.erreur(dates.au)}>
          <input className="input" id="tm-ret" type="date" min={depart || undefined} value={retour} onChange={e => setRetour(e.target.value)} />
        </Field>
      </div>
      <Controles msgs={conflits} />
      {aRefaire.length > 0 && <Fine>Formalités de détachement à refaire après cette modification : {aRefaire.join(' et ')}. Le dossier redevient incomplet.</Fine>}
      {keystone
        ? <Field label="Motif"><Static>{t.motif}</Static></Field>
        : <Field label="Motif" htmlFor="tm-motif" requis erreur={v.erreur(motifErr)}><input className="input" id="tm-motif" type="text" value={motif} onChange={e => setMotif(e.target.value)} /></Field>}
      {keystone && <Fine>Déplacement venu de Keystone (chantier {t.chantier}) : destination et motif sont ceux du chantier. Keystone est prévenu des nouvelles dates.</Fine>}
      <p className="text-muted fine">{destDef ? d.destSummary(destDef) : ''}</p>
    </Dialog>
  );
}
