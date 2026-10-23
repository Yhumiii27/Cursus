// Déclarer une intervention pendant une astreinte (t049, lot 7, étape 2) : depuis la feuille de temps, par le salarié, son
// manager direct (ou le suppléant qui saisit ses feuilles) ou le service RH, comme une saisie d'heures. Jour où elle
// commence, heures de début et de fin (une fin avant le début : le lendemain). Ses heures vont sur la ligne INT-AST de la
// feuille de ce jour-là : du travail effectif, décompté avec les autres (heures normales, supplémentaires, de nuit, du
// dimanche). Contrôles du serveur (`controlerIntervention`, shared/rules/astreintes.ts) affichés à l'envoi ; les autres
// (feuille modifiable, absence, jour férié, 24 h par jour) viennent de la réponse du serveur.
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { astreinteActive, astreinteCommencee, controlerIntervention, dureeIntervention, periodeAstreinteTexte } from '../../../shared/rules/astreintes.ts';
import { normaliserHeure } from '../../../shared/rules/horaires.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { maintenant } from '../components/astreintes-etat.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** `jour` : jour proposé (dans la semaine de la feuille affichée) ; `astreinteId` : astreinte présélectionnée. */
export function InterventionAstreinteDialog({ empId, jour, astreinteId }: { empId: number; jour?: ISODate | null; astreinteId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const m = maintenant(d.ti);
  // Astreintes en vigueur déjà commencées (une intervention se déclare une fois faite), les plus récentes d'abord.
  const astreintes = (d.ds.astreintes ?? []).filter(a => a.empId === empId && astreinteActive(a) && astreinteCommencee(a, m))
    .sort((a, b) => b.du.localeCompare(a.du) || b.debut.localeCompare(a.debut));
  const [sel, setSel] = useState<number | null>(() => astreinteId ?? astreintes[0]?.id ?? null);
  const a = astreintes.find(x => x.id === sel) ?? null;
  const [le, setLe] = useState<string>(() => (jour && jour <= d.ti ? jour : d.ti));
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  if (!emp) return null;

  const autres = (d.ds.interventionsAstreinte ?? []).filter(x => x.empId === empId);
  const r = a ? controlerIntervention(a, { jour: le, debut, fin }, autres, d.ti) : null;
  const e = r?.erreurs ?? {};
  const astErr = !a ? 'Choisissez l’astreinte pendant laquelle l’intervention a eu lieu.' : null;
  const h = normaliserHeure(debut) && normaliserHeure(fin) ? dureeIntervention(normaliserHeure(debut)!, normaliserHeure(fin)!) : null;

  const confirm = async () => {
    if (busy || !v.verifier(astErr, e.jour, e.debut, e.fin, e.general)) return;
    setBusy(true);
    const res = await run('astreinte.intervention', { astreinteId: a!.id, jour: le, debut, fin });
    setBusy(false);
    if (res.ok) closeDialog();
  };

  return (
    <Dialog title="Déclarer une intervention d’astreinte" width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Déclarer l’intervention</SubmitButton>
    </>}>
      <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
      <Field label="Astreinte" htmlFor={astreintes.length ? 'int-ast' : undefined} requis erreur={v.erreur(astErr)}>
        {astreintes.length
          ? (
            <select className="input" id="int-ast" value={sel ?? ''} onChange={ev => setSel(ev.target.value ? Number(ev.target.value) : null)}>
              <option value="">Choisir…</option>
              {astreintes.map(x => <option key={x.id} value={x.id}>{periodeAstreinteTexte(x)}</option>)}
            </select>
          )
          : <Static>Aucune astreinte commencée</Static>}
      </Field>
      <div className="grid-2">
        <Field label="Jour où elle commence" htmlFor="int-jour" requis erreur={v.erreur(e.jour)}>
          <input className="input" id="int-jour" type="date" value={le} min={a?.du} max={d.ti} onChange={ev => setLe(ev.target.value)} />
        </Field>
        <Field label="Durée">
          <Static>{h != null ? fH(h) : '—'}</Static>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Début" htmlFor="int-debut" requis erreur={v.erreur(e.debut)}>
          <input className="input" id="int-debut" type="time" value={debut} onChange={ev => setDebut(ev.target.value)} />
        </Field>
        <Field label="Fin" htmlFor="int-fin" requis erreur={v.erreur(e.fin)}>
          <input className="input" id="int-fin" type="time" value={fin} onChange={ev => setFin(ev.target.value)} />
        </Field>
      </div>
      {v.tente && e.general && <Bloquant>{e.general}</Bloquant>}
      <Fine>
        Du travail effectif : les heures s’ajoutent à la ligne « Intervention d’astreinte » de la feuille, le jour où l’intervention commence, et se décomptent
        avec les autres (heures supplémentaires, de nuit, du dimanche). Une fin avant le début vaut pour le lendemain. Après l’intervention, 11 heures de repos
        consécutives sont dues avant la reprise.
      </Fine>
    </Dialog>
  );
}
