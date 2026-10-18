// Poser une absence (CP, RTT / repos, récupération) : décompte et contrôles en direct.
// Posée par le manager direct pour un membre de son équipe, l'absence est validée d'emblée.
// Intérim : aucun type ouvert (congés gérés par l'agence), le dialogue l'indique sans proposer d'envoi.
// Demi-journées (CP, RTT ou repos, récupération) : l'après-midi seul le premier jour, le matin seul le dernier, ou une
// seule demi-journée pour un congé d'un jour (shared/rules/demi-journees.ts).
import { useState } from 'react';
import { absenceKinds, checkAbsence } from '../../../shared/rules/conges.ts';
import { demiAutorisee } from '../../../shared/rules/demi-journees.ts';
import type { CongeType, DemiJournee } from '../../../shared/types.ts';
import { erreursPeriode } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AbsDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { manager, me } = useRole();
  const emp = d.emp(empId);
  const kinds = emp ? absenceKinds(d, emp) : [];
  const [kind, setKind] = useState<CongeType>(() => kinds[0]?.[0] || 'CP');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  // Congé d'un seul jour : journée entière, matin ou après-midi ; sur plusieurs jours : premier et dernier jour.
  const [unJour, setUnJour] = useState<DemiJournee | ''>('');
  const [debutApresMidi, setDebutApresMidi] = useState(false);
  const [finMatin, setFinMatin] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp) return null;

  if (!kinds.length) {
    return (
      <Dialog title="Poser une absence" width={520} actions={<CancelButton label="Fermer" />}>
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Congés gérés par l’agence d’intérim — aucune absence à poser dans Cursus</p>
      </Dialog>
    );
  }

  const parManager = manager && emp.id !== me && d.mgrOf(emp) === me;
  const demiPossible = demiAutorisee(kind) && !!du && !!au && au >= du, seul = du === au;
  const demi = !demiPossible ? { debutDemi: null, finDemi: null }
    : seul ? { debutDemi: unJour || null, finDemi: null }
    : { debutDemi: debutApresMidi ? 'apres_midi' as const : null, finDemi: finMatin ? 'matin' as const : null };
  // Posée par le manager, l'absence est validée d'emblée : des heures saisies ces jours-là la bloquent.
  const chk = checkAbsence(d, emp, kind, du, au, parManager, demi);
  const periode = erreursPeriode(du, au, { du: 'Indiquez le premier jour d’absence.', au: 'Indiquez le dernier jour d’absence.' });
  // Période sans jour décompté (week-end, jours fériés, jour non travaillé) : rien à poser.
  const aucunJour = chk.valid && chk.n === 0 ? 'Aucun jour à décompter sur cette période (week-end, jours fériés, jour non travaillé).' : null;

  const pickDu = (x: string) => { setDu(x); if (!au || au < x) setAu(x); };
  const confirm = async () => {
    if (busy || !v.verifier(periode.du, periode.au, aucunJour, chk.cant)) return;
    setBusy(true);
    const r = await run('absence.demander', { empId, kind, du, au, ...demi });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Poser une absence" width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{parManager ? 'Poser et valider' : 'Envoyer la demande'}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Type" htmlFor="ab-k">
          <select className="input" id="ab-k" value={kind} onChange={ev => setKind(ev.target.value as CongeType)}>
            {chk.kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Du" htmlFor="ab-du" requis erreur={v.erreur(periode.du)}><input className="input" id="ab-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Au (inclus)" htmlFor="ab-au" requis erreur={v.erreur(periode.au ?? aucunJour)}><input className="input" id="ab-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
        {demiPossible && seul && (
          <Field label="Durée" htmlFor="ab-un">
            <select className="input" id="ab-un" value={unJour} onChange={ev => setUnJour(ev.target.value as DemiJournee | '')}>
              <option value="">Journée entière</option>
              <option value="matin">Matin</option>
              <option value="apres_midi">Après-midi</option>
            </select>
          </Field>
        )}
        {demiPossible && !seul && <>
          <Field label="Premier jour" htmlFor="ab-deb">
            <select className="input" id="ab-deb" value={debutApresMidi ? 'apres_midi' : ''} onChange={ev => setDebutApresMidi(ev.target.value === 'apres_midi')}>
              <option value="">Journée entière</option>
              <option value="apres_midi">À partir de l’après-midi</option>
            </select>
          </Field>
          <Field label="Dernier jour" htmlFor="ab-fin">
            <select className="input" id="ab-fin" value={finMatin ? 'matin' : ''} onChange={ev => setFinMatin(ev.target.value === 'matin')}>
              <option value="">Journée entière</option>
              <option value="matin">Jusqu’au matin</option>
            </select>
          </Field>
        </>}
      </div>
      <div style={{ fontSize: 13 }}>{chk.soldeLabel}</div>
      <Controles msgs={chk.msgs} />
      {parManager && <p style={{ fontSize: 12, margin: 0, color: 'var(--color-neutral-400)' }}>Posée par le manager : l’absence est validée immédiatement et transmise à Keystone</p>}
    </Dialog>
  );
}
